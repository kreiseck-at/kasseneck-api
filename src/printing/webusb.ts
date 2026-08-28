/**
 * Bondrucker am USB-Kabel ueber WebUSB (Chrome/Edge auf Windows, macOS,
 * Android, ChromeOS -- kein Safari, kein iPad). Der Browser bekommt das Geraet
 * nur, wenn kein Treiber es haelt (Windows: ggf. WinUSB statt Epson-Treiber).
 * Die Bytes sind dieselben wie am Bluetooth-Drucker: ESC/POS aus
 * `escPosLayoutBytes`, exakt die Rasterzeilen.
 *
 * Alles hier ist strukturell getippt (kein `USBDevice`-DOM-Typ noetig), damit
 * es ohne Browser testbar bleibt und in jeder App gleich laeuft.
 */

export interface UsbEndpointLike { direction: string; type: string; endpointNumber: number }
export interface UsbAlternateLike { alternateSetting: number; interfaceClass: number; endpoints: UsbEndpointLike[] }
export interface UsbInterfaceLike { interfaceNumber: number; alternates: UsbAlternateLike[] }
export interface UsbConfigurationLike { configurationValue: number; interfaces: UsbInterfaceLike[] }
export interface UsbTransferOutResultLike { status: string; bytesWritten: number }
export interface UsbWriterLike { transferOut: (endpointNumber: number, data: Uint8Array) => Promise<UsbTransferOutResultLike> }
export interface UsbIdentityLike { vendorId: number; productId: number; serialNumber?: string | null }

/** Das, was ein WebUSB-`USBDevice` bietet -- soweit hier gebraucht. */
export interface UsbDeviceLike extends UsbWriterLike, UsbIdentityLike {
  productName?: string | null;
  manufacturerName?: string | null;
  opened: boolean;
  configuration: UsbConfigurationLike | null;
  open: () => Promise<void>;
  close: () => Promise<void>;
  selectConfiguration: (value: number) => Promise<void>;
  claimInterface: (interfaceNumber: number) => Promise<void>;
  releaseInterface: (interfaceNumber: number) => Promise<void>;
  selectAlternateInterface: (interfaceNumber: number, alternateSetting: number) => Promise<void>;
}

export interface UsbPrinterEndpoint { interfaceNumber: number; alternateSetting: number; endpointNumber: number }

export interface UsbPrinterConnection {
  device: UsbDeviceLike;
  /** "Hersteller Produkt", z. B. "EPSON TM-T20III". */
  name: string;
  interfaceNumber: number;
  endpointNumber: number;
  /** Kennung fuers Wiederfinden ueber `navigator.usb.getDevices()`. */
  key: string;
}

/** Epson Seiko USB-Vendor-ID -- als Vorfilter im Geraetedialog. */
export const USB_VENDOR_EPSON = 0x04b8;
/** USB-Geraeteklasse "Drucker". */
export const USB_CLASS_PRINTER = 7;

const HEX4 = (n: number): string => n.toString(16).padStart(4, '0');

/** Kennung `vvvv:pppp:serial` -- stabil ueber Neustarts, wenn der Drucker eine Seriennummer meldet. */
export function usbDeviceKey(d: UsbIdentityLike): string {
  return `${HEX4(d.vendorId)}:${HEX4(d.productId)}:${d.serialNumber ?? ''}`;
}

/** Druckerschnittstelle (Klasse 7) bevorzugt, sonst herstellerspezifisch (0xFF), sonst irgendein Bulk-OUT. */
export function usbFindPrinterEndpoint(d: { configuration: UsbConfigurationLike | null }): UsbPrinterEndpoint | null {
  const konf = d.configuration;
  if (!konf) return null;
  const kandidaten: { rang: number; e: UsbPrinterEndpoint }[] = [];
  for (const i of konf.interfaces) {
    for (const alt of i.alternates) {
      const ep = alt.endpoints.find((x) => x.direction === 'out' && x.type === 'bulk');
      if (!ep) continue;
      const rang = alt.interfaceClass === USB_CLASS_PRINTER ? 0 : alt.interfaceClass === 0xff ? 1 : 2;
      kandidaten.push({ rang, e: { interfaceNumber: i.interfaceNumber, alternateSetting: alt.alternateSetting, endpointNumber: ep.endpointNumber } });
    }
  }
  kandidaten.sort((a, b) => a.rang - b.rang);
  return kandidaten[0]?.e ?? null;
}

/**
 * Ein USB-Schritt kam nicht innerhalb der Frist zurueck. Anders als bei einem
 * HTTP-Aufruf (siehe `receipt/epos.ts`, `EposConnectionError`) kennt WebUSB
 * fuer diese Methoden kein Abbruchsignal -- der zugrunde liegende Transfer
 * kann am Geraet WEITERLAUFEN, auch nachdem dieser Fehler geworfen wurde. Was
 * hier begrenzt wird, ist NUR das Warten dieses Aufrufers, nicht der Transfer
 * selbst. Dieselbe ehrliche Einschraenkung wie beim Dart-Zwilling
 * `HpsPayments` (`_abortBudget`-Kommentar): ein weicher Zeitablauf ist besser
 * als gar keiner, aber kein echtes Abbrechen.
 */
export class UsbTimeoutError extends Error {
  override readonly name = 'UsbTimeoutError';
  readonly schritt: string;
  readonly timeoutMs: number;

  constructor(schritt: string, timeoutMs: number) {
    super(`USB-Drucker antwortet nicht (${schritt}, Zeitlimit ${timeoutMs} ms überschritten) — Kabel/Gerät prüfen.`);
    this.schritt = schritt;
    this.timeoutMs = timeoutMs;
  }
}

/** Vorgabe-Zeitlimit je USB-Schritt. Ein einzelner Block/Schritt braucht Millisekunden; alles darueber ist ein haengendes Geraet. */
const USB_ZEITLIMIT_VORGABE_MS = 15000;

/** Begrenzt das WARTEN auf [promise] -- siehe [UsbTimeoutError] fuer die Einschraenkung. */
function mitZeitlimit<T>(promise: Promise<T>, ms: number, schritt: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UsbTimeoutError(schritt, ms)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Bytes blockweise an den OUT-Endpunkt; liefert die geschriebene Gesamtzahl,
 * wirft bei Fehlstatus. [timeoutMs] gilt JE Block, nicht fuer den gesamten
 * Druckauftrag -- ein grosser Beleg darf laenger brauchen, ein EINZELNER
 * haengender Block soll trotzdem auffallen, statt den ganzen Aufruf
 * unbegrenzt festzuhalten (genau das Muster, das im Flutter-Paket einen
 * Verkauf angehalten hat).
 */
export async function usbWriteAll(dev: UsbWriterLike, endpointNumber: number, bytes: Uint8Array, blockSize = 16384, timeoutMs = USB_ZEITLIMIT_VORGABE_MS): Promise<number> {
  const groesse = Math.max(1, Math.floor(blockSize));
  let n = 0;
  for (let von = 0; von < bytes.length; von += groesse) {
    // eigener ArrayBuffer je Block (BufferSource verlangt kein SharedArrayBuffer)
    const block = new Uint8Array(Math.min(groesse, bytes.length - von));
    block.set(bytes.subarray(von, von + block.length));
    const r = await mitZeitlimit(dev.transferOut(endpointNumber, block), timeoutMs, 'transferOut');
    if (r.status !== 'ok') throw new Error(`USB-Übertragung: ${r.status} nach ${n} Byte`);
    n += r.bytesWritten;
  }
  return n;
}

/**
 * Geraet oeffnen, Konfiguration waehlen, Druckerschnittstelle belegen. Wirft
 * verstaendlich, wenn ein Treiber das Geraet haelt oder kein Drucker-Endpunkt
 * da ist -- und schliesst das Geraet dann wieder. Jeder Schritt steht unter
 * [timeoutMs] (siehe [UsbTimeoutError]).
 */
export async function usbConnectPrinter(device: UsbDeviceLike, timeoutMs = USB_ZEITLIMIT_VORGABE_MS): Promise<UsbPrinterConnection> {
  if (!device.opened) await mitZeitlimit(device.open(), timeoutMs, 'open');
  try {
    if (!device.configuration) await mitZeitlimit(device.selectConfiguration(1), timeoutMs, 'selectConfiguration');
    const ep = usbFindPrinterEndpoint(device);
    if (!ep) throw new Error('Kein Drucker-Endpunkt am USB-Gerät gefunden — ist das ein Bondrucker?');
    try {
      await mitZeitlimit(device.claimInterface(ep.interfaceNumber), timeoutMs, 'claimInterface');
    } catch (e) {
      // Ein Zeitablauf ist etwas anderes als ein abgelehnter Claim: Ersterer
      // sagt "das Geraet antwortet gar nicht", Letzterer "ein Treiber haelt
      // es". Beide unter derselben Meldung zu verstecken, waere dieselbe
      // Verwechslung, die an anderer Stelle in diesem Vorhaben schon einmal
      // Kartendaten falsch eingeordnet hat -- hier nur mit einem Drucker
      // statt eines Terminals.
      if (e instanceof UsbTimeoutError) throw e;
      const grund = e instanceof Error && e.message ? ` (${e.message})` : '';
      throw new Error(`USB-Schnittstelle belegt${grund} — ein Treiber hält den Drucker. Windows: Epson-Treiber entfernen oder mit Zadig auf WinUSB umstellen.`);
    }
    if (ep.alternateSetting !== 0) await mitZeitlimit(device.selectAlternateInterface(ep.interfaceNumber, ep.alternateSetting), timeoutMs, 'selectAlternateInterface');
    const name = [device.manufacturerName, device.productName].filter((t): t is string => !!t).join(' ') || 'USB-Drucker';
    return { device, name, interfaceNumber: ep.interfaceNumber, endpointNumber: ep.endpointNumber, key: usbDeviceKey(device) };
  } catch (e) {
    try { await mitZeitlimit(device.close(), timeoutMs, 'close'); } catch { /* schon zu, oder haengt ebenfalls -- egal, wir werfen ohnehin schon */ }
    throw e;
  }
}

/** Bytes an eine bestehende Verbindung. */
export function usbPrint(c: UsbPrinterConnection, bytes: Uint8Array, timeoutMs = USB_ZEITLIMIT_VORGABE_MS): Promise<number> {
  return usbWriteAll(c.device, c.endpointNumber, bytes, undefined, timeoutMs);
}

/**
 * Schnittstelle freigeben und schliessen; Fehler dabei sind egal (Geraet ist
 * ohnehin weg) -- ABER ein haengender Aufruf ist etwas anderes als ein Fehler:
 * ein `catch` faengt nur eine ABLEHNUNG ab, nicht ein Versprechen, das nie
 * aufloest. Ohne die Frist haette ein steckengebliebenes `releaseInterface`
 * `usbDisconnect` selbst unbegrenzt haengen lassen, trotz des `try/catch`.
 */
export async function usbDisconnect(c: UsbPrinterConnection, timeoutMs = USB_ZEITLIMIT_VORGABE_MS): Promise<void> {
  try { await mitZeitlimit(c.device.releaseInterface(c.interfaceNumber), timeoutMs, 'releaseInterface'); } catch { /* egal */ }
  try { await mitZeitlimit(c.device.close(), timeoutMs, 'close'); } catch { /* egal */ }
}
