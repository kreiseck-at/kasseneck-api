import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KeckPaymentMethod, ReceiptType, VatRate } from '../src/enums/index.js';
import type { ManualReceipt, Receipt, ReceiptCompany } from '../src/models/index.js';
import { buildReceiptLayout, type ReceiptLayout } from '../src/receipt/layout.js';
import { gridToText, renderReceiptGrid } from '../src/receipt/index.js';

/**
 * Block „NACHERFASSUNG“ (manualReceipt): unter dem Kopf, vor den
 * Pflichtangaben; Wortlaut nach dem Spec 2026-10-30-nacherfassung-handbeleg.
 */
const FIRMA: ReceiptCompany = {
  companyName: 'Praxis Mag. Mirela Weinzierl', street: 'Hauptplatz 1', zip: '4830', city: 'Hallstatt', phone: '+43 6134 12345',
  vatId: '', taxNumber: '91-123/4565', isSmallBusiness: false,
  footer1: 'Danke für Ihren Besuch', footer2: '', thanksMessage: [], showKreiseckLogo: false,
};
const BELEG: Receipt = {
  receiptId: 'AT0-KASSE1-67', cashregisterId: 'KASSE1', timeStamp: '2027-01-02T09:12:40',
  items: [{ name: 'Psychotherapie 50 Min.', quantity: 1, vat: VatRate.vat0, priceCents: 12000 }],
  vouchers: [], paymentMethod: KeckPaymentMethod.cash, turnoverCounterAES256ICM: 'UMSATZ', signaturePreviousReceipt: 'VORGAENGER',
  certificateSerialNumber: '5A1C3E07', receiptType: ReceiptType.standard, sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.SIGNATURWERT',
  qr: '_R1-AT1_KASSE1_AT0-KASSE1-67', fullReceiptId: 'VOLL', customerDetails: [], legalMessage: [],
};

const alsText = (l: ReceiptLayout): string[] => l.lines.map((z) => {
  switch (z.kind) {
    case 'text': return z.text;
    case 'columns': return z.columns.map((s) => s.text).join(' ');
    case 'rule': return `<rule ${z.char}>`;
    case 'space': return `<space ${z.lines}>`;
    case 'qr': return '<qr>';
    case 'banner': return `<banner ${z.text}>`;
  }
});
/** Die Zeilen vom Banner bis vor die Leerzeile vor „Datum:“. */
function block(manualReceipt: ManualReceipt): string[] {
  const zeilen = alsText(buildReceiptLayout({ ...BELEG, manualReceipt }, FIRMA));
  const von = zeilen.indexOf('<banner NACHERFASSUNG>');
  const datum = zeilen.findIndex((z) => z.startsWith('Datum:'));
  assert.ok(von > 0 && datum > von, 'Block steht vor „Datum:“');
  assert.equal(zeilen[von - 1], '<space 1>');
  assert.equal(zeilen[datum - 1], '<space 1>');
  return zeilen.slice(von, datum - 1);
}

test('Einzelbeleg nach Internet-Ausfall mit Uhrzeit', () => {
  assert.deepEqual(block({ number: '17', date: '2026-12-31', time: '14:30', reason: 'network_outage' }), [
    '<banner NACHERFASSUNG>', 'nach Ausfall der Kasse', 'Grund: Internet', '<space 1>',
    'Handbeleg Nr. 17', 'vom 31.12.2026, 14:30 Uhr', 'USt: Duplikat des Handbelegs',
  ]);
});

test('Gründe des Ausfalls und eigener Text', () => {
  const grund = (reason: string, note?: string) => block({ number: '1', date: '2026-11-03', reason, ...(note ? { note } : {}) })[2];
  assert.equal(grund('power_outage'), 'Grund: Strom');
  assert.equal(grund('device_failure'), 'Grund: Gerät defekt');
  assert.equal(grund('system_outage'), 'Grund: Störung');
  assert.equal(grund('other', 'Kasse beim Umzug abgebaut'), 'Grund: Kasse beim Umzug abgebaut');
});

test('Einzelbeleg ohne Uhrzeit', () => {
  assert.equal(block({ number: '233', date: '2026-11-03', reason: 'power_outage' })[5], 'vom 03.11.2026');
});

test('Tagessammelbeleg mit und ohne Anzahl', () => {
  const sammel = { number: '201', numberTo: '248', date: '2026-11-03', reason: 'power_outage' };
  assert.deepEqual(block({ ...sammel, count: 48 }).slice(4), [
    'Tagessammelbeleg', 'Handbelege Nr. 201 bis 248', '48 Belege vom 03.11.2026', 'USt: Duplikat der Handbelege',
  ]);
  assert.equal(block(sammel)[6], 'vom 03.11.2026');
});

test('Leistung außer Haus ohne Grund-Zeile', () => {
  assert.deepEqual(block({ number: '5', date: '2026-10-29', time: '11:00', reason: 'outside_premises' }), [
    '<banner NACHERFASSUNG>', 'Leistung außer Haus', '<space 1>',
    'Handbeleg Nr. 5', 'vom 29.10.2026, 11:00 Uhr', 'USt: Duplikat des Handbelegs',
  ]);
});

test('Unbekannter Grund: Ausfall ohne Grund-Zeile, kein Absturz', () => {
  assert.deepEqual(block({ number: '9', date: '2026-11-03', reason: 'flood' }).slice(0, 3), [
    '<banner NACHERFASSUNG>', 'nach Ausfall der Kasse', '<space 1>',
  ]);
});

test('Ohne manualReceipt kein Block (Rot-Probe)', () => {
  assert.equal(alsText(buildReceiptLayout(BELEG, FIRMA)).includes('<banner NACHERFASSUNG>'), false);
});

test('58 mm: langer eigener Text bricht um, keine Zeile über 32 Zeichen', () => {
  const layout = buildReceiptLayout({ ...BELEG, manualReceipt: {
    number: 'B-500', numberTo: 'B-547', count: 48, date: '2026-12-01', reason: 'other',
    note: 'Kassen-Tablet nach Wasserschaden außer Betrieb genommen',
  } }, FIRMA);
  const raster = gridToText(renderReceiptGrid(layout, { charsPerLine: 32 })).split('\n');
  assert.ok(raster.every((z) => z.length <= 32), 'keine Zeile breiter als 32');
  assert.ok(raster.some((z) => z.includes('Wasserschaden')));
});

test('Kleinunternehmer: keine USt-Zeile im Block', () => {
  const zeilen = alsText(buildReceiptLayout({ ...BELEG, manualReceipt: { number: '17', date: '2026-12-31', reason: 'network_outage' } },
    { ...FIRMA, isSmallBusiness: true }));
  assert.ok(zeilen.includes('Handbeleg Nr. 17'));
  assert.equal(zeilen.some((z) => z.startsWith('USt: Duplikat')), false);
});
