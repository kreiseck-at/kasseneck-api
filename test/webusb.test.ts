import { test } from 'node:test';
import assert from 'node:assert/strict';

import { usbFindPrinterEndpoint, usbWriteAll, usbDeviceKey, usbConnectPrinter, type UsbDeviceLike } from '../src/printing/index.js';

/**
 * Bondrucker am USB-Kabel (WebUSB): Druckerschnittstelle (Klasse 7) bevorzugt,
 * sonst herstellerspezifisch (0xFF); Bytes blockweise an den Bulk-OUT-Endpunkt.
 * Die WebUSB-Objekte kommen strukturell herein -- testbar ohne Browser.
 */
const KONF = { configurationValue: 1, interfaces: [
  { interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 3, endpoints: [{ direction: 'out', type: 'interrupt', endpointNumber: 1 }] }] },
  { interfaceNumber: 1, alternates: [{ alternateSetting: 0, interfaceClass: 7, endpoints: [{ direction: 'in', type: 'bulk', endpointNumber: 2 }, { direction: 'out', type: 'bulk', endpointNumber: 3 }] }] },
] };

test('WebUSB: Drucker-Interface + Bulk-OUT-Endpunkt; Herstellerklasse als Ausweg; nichts -> null', () => {
  assert.deepEqual(usbFindPrinterEndpoint({ configuration: KONF }), { interfaceNumber: 1, alternateSetting: 0, endpointNumber: 3 });
  assert.deepEqual(usbFindPrinterEndpoint({ configuration: { configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 255, endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 4 }] }] }] } }), { interfaceNumber: 0, alternateSetting: 0, endpointNumber: 4 });
  assert.equal(usbFindPrinterEndpoint({ configuration: null }), null);
  assert.equal(usbFindPrinterEndpoint({ configuration: { configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 3, endpoints: [] }] }] } }), null);
});

test('WebUSB: Bloecke schreiben, Summe = Laenge; Fehlstatus wirft', async () => {
  const geschrieben: number[] = [];
  const dev = { transferOut: async (ep: number, data: Uint8Array) => { assert.equal(ep, 3); geschrieben.push(data.byteLength); return { status: 'ok', bytesWritten: data.byteLength }; } };
  const bytes = new Uint8Array(40000).fill(65);
  assert.equal(await usbWriteAll(dev, 3, bytes, 16384), 40000);
  assert.deepEqual(geschrieben, [16384, 16384, 7232]);
  await assert.rejects(usbWriteAll({ transferOut: async () => ({ status: 'stall', bytesWritten: 0 }) }, 3, bytes), /stall/);
});

function geraet(over: Partial<UsbDeviceLike> = {}): UsbDeviceLike & { protokoll: string[] } {
  const p: string[] = [];
  const d: UsbDeviceLike & { protokoll: string[] } = {
    protokoll: p,
    vendorId: 0x04b8, productId: 0x0e28, serialNumber: 'X7XF000001', productName: 'TM-T20III', manufacturerName: 'EPSON',
    opened: false, configuration: null,
    open: async () => { p.push('open'); d.opened = true; },
    close: async () => { p.push('close'); d.opened = false; },
    selectConfiguration: async (v) => { p.push(`konf ${v}`); d.configuration = KONF; },
    claimInterface: async (n) => { p.push(`claim ${n}`); },
    releaseInterface: async (n) => { p.push(`release ${n}`); },
    selectAlternateInterface: async (n, a) => { p.push(`alt ${n}/${a}`); },
    transferOut: async (_ep, data) => ({ status: 'ok', bytesWritten: data.byteLength }),
    ...over,
  };
  return d;
}

test('WebUSB: verbinden = oeffnen, Konfiguration, Interface belegen; Kennung fuers Wiederfinden; belegt -> verstaendlicher Fehler', async () => {
  const d = geraet();
  const c = await usbConnectPrinter(d);
  assert.deepEqual(d.protokoll, ['open', 'konf 1', 'claim 1']);
  assert.equal(c.name, 'EPSON TM-T20III');
  assert.equal(c.endpointNumber, 3);
  assert.equal(usbDeviceKey(d), '04b8:0e28:X7XF000001');
  assert.equal(usbDeviceKey({ vendorId: 1, productId: 2 }), '0001:0002:');
  // belegt (Treiber haelt das Geraet)
  const belegt = geraet({ claimInterface: async () => { throw new Error('Unable to claim interface.'); } });
  await assert.rejects(usbConnectPrinter(belegt), /Treiber/);
  assert.ok(belegt.protokoll.includes('close'), 'nach Fehler geschlossen');
  // kein Drucker-Endpunkt
  const leer = geraet({ selectConfiguration: async function (this: UsbDeviceLike) { (leer as UsbDeviceLike).configuration = { configurationValue: 1, interfaces: [] }; } });
  await assert.rejects(usbConnectPrinter(leer), /Endpunkt/);
});
