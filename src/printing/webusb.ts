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

/** Bytes blockweise an den OUT-Endpunkt; liefert die geschriebene Gesamtzahl, wirft bei Fehlstatus. */
export async function usbWriteAll(dev: UsbWriterLike, endpointNumber: number, bytes: Uint8Array, blockSize = 16384): Promise<number> {
  const groesse = Math.max(1, Math.floor(blockSize));
  let n = 0;
  for (let von = 0; von < bytes.length; von += groesse) {
    // eigener ArrayBuffer je Block (BufferSource verlangt kein SharedArrayBuffer)
    const block = new Uint8Array(Math.min(groesse, bytes.length - von));
    block.set(bytes.subarray(von, von + block.length));
    const r = await dev.transferOut(endpointNumber, block);
    if (r.status !== 'ok') throw new Error(`USB-Übertragung: ${r.status} nach ${n} Byte`);
    n += r.bytesWritten;
  }
  return n;
}

/**
 * Geraet oeffnen, Konfiguration waehlen, Druckerschnittstelle belegen. Wirft
 * verstaendlich, wenn ein Treiber das Geraet haelt oder kein Drucker-Endpunkt
 * da ist -- und schliesst das Geraet dann wieder.
 */
export async function usbConnectPrinter(device: UsbDeviceLike): Promise<UsbPrinterConnection> {
  if (!device.opened) await device.open();
  try {
    if (!device.configuration) await device.selectConfiguration(1);
    const ep = usbFindPrinterEndpoint(device);
    if (!ep) throw new Error('Kein Drucker-Endpunkt am USB-Gerät gefunden — ist das ein Bondrucker?');
    try {
      await device.claimInterface(ep.interfaceNumber);
    } catch (e) {
      const grund = e instanceof Error && e.message ? ` (${e.message})` : '';
      throw new Error(`USB-Schnittstelle belegt${grund} — ein Treiber hält den Drucker. Windows: Epson-Treiber entfernen oder mit Zadig auf WinUSB umstellen.`);
    }
    if (ep.alternateSetting !== 0) await device.selectAlternateInterface(ep.interfaceNumber, ep.alternateSetting);
    const name = [device.manufacturerName, device.productName].filter((t): t is string => !!t).join(' ') || 'USB-Drucker';
    return { device, name, interfaceNumber: ep.interfaceNumber, endpointNumber: ep.endpointNumber, key: usbDeviceKey(device) };
  } catch (e) {
    try { await device.close(); } catch { /* schon zu */ }
    throw e;
  }
}

/** Bytes an eine bestehende Verbindung. */
export function usbPrint(c: UsbPrinterConnection, bytes: Uint8Array): Promise<number> {
  return usbWriteAll(c.device, c.endpointNumber, bytes);
}

/** Schnittstelle freigeben und schliessen; Fehler dabei sind egal (Geraet ist ohnehin weg). */
export async function usbDisconnect(c: UsbPrinterConnection): Promise<void> {
  try { await c.device.releaseInterface(c.interfaceNumber); } catch { /* egal */ }
  try { await c.device.close(); } catch { /* egal */ }
}
