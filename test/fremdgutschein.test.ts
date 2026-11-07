import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fromReceiptPayload, fromVoucherPayload, toVoucherPayload, isExternalVoucher, type Receipt, type ReceiptCompany } from '../src/models/index.js';
import { buildReceiptLayout, type ReceiptLayout } from '../src/receipt/index.js';

/**
 * Fremdgutscheine auf der 0.x-Linie (nur Lesen und Bon): das Backend setzt mit dieser Linie Bon, PDF und Mail und
 * muss gespeicherte Belege mit `quelle: 'extern'` genauso drucken wie das Paket 1.x (layout.ts, Fremdgutscheine).
 * Die Belege stehen in der internen Form, die das Backend ablegt (gutschein-faelle.json, fg_*).
 */

const FIRMA: ReceiptCompany = {
  companyName: 'Bäckerei Kornblum', street: 'Neubaugasse 12', zip: '1070', city: 'Wien', phone: '',
  uid: 'ATU12345675', taxnr: '', isSmallBusiness: false, footer1: '', footer2: '', thanksMessage: [], showKreiseckLogo: false,
};
const texte = (l: ReceiptLayout): string[] => l.lines.map((z) => (z.kind === 'columns' ? z.columns.map((c) => c.text).join(' | ') : 'text' in z ? String(z.text) : ''));
const beleg = (items: unknown[], vouchers: unknown[], extra: Record<string, unknown> = {}): Receipt => fromReceiptPayload({
  receiptId: 'AT0-KASSE1-90', cashregisterId: 'KASSE1', timeStamp: '2026-11-05T10:15:30', items, vouchers, paymentMethod: 'cash',
  turnoverCounterAES256ICM: 'U', signaturePreviousReceipt: 'V', certificateSerialNumber: '1', receiptType: 'standard', sig: '', qr: '',
  fullReceiptId: '', customerDetails: '', legalMessage: '', ...extra,
} as never);
const bon = (r: Receipt): string[] => texte(buildReceiptLayout(r, FIRMA, { paperSize: 'mm80' }));

test('interne Form: quelle extern -> source external, nummer -> number; Schreiben gibt die interne Form zurueck', () => {
  const innen = { quelle: 'extern', action: 'redeem', type: 'einzweck', art: 'einzweck', nummer: 'FG-1234', betragCents: 2000, satzBp: 2000, versteuertMit: 'FG-1234-V', name: 'Gutschein Nr. FG-1234' };
  const v = fromVoucherPayload(innen);
  assert.equal(v.source, 'external');
  assert.equal(v.number, 'FG-1234');
  assert.equal(isExternalVoucher(v), true);
  assert.deepEqual(toVoucherPayload(v), innen);
  // Auch die /v3-Form liest sich (englischer Name vor dem internen).
  assert.equal(fromVoucherPayload({ source: 'external', number: 'W-77', action: 'redeem', type: 'value', valueCents: 300 }).source, 'external');
  // Eigene Gutscheine bleiben ohne die Felder.
  const eigen = fromVoucherPayload({ action: 'redeem', type: 'value', code: 'GS-1', value: 3, valueCents: 300 });
  assert.equal('source' in eigen, false);
  assert.equal('number' in eigen, false);
  assert.equal(isExternalVoucher(eigen), false);
});

test('Einloesung Einzweck + Mehrzweck (fg_ez_und_mz_einloesung_bon): Nummer voll, Vermerk ohne „Beleg“, kein Rest', () => {
  const r = beleg([
    { name: 'Brauereiführung', quantity: 1, unitPriceCents: 2000, vatRate: 20 },
    { name: 'Bier 0,5', quantity: 1, unitPriceCents: 450, vatRate: 20 },
    { name: 'Gutschein Nr. FG-1234', quantity: 1, unitPriceCents: -2000, vatRate: 20, kind: 'voucher' },
  ], [
    // saldoNachCents an einem Fremdgutschein (schreibt der Server nie): trotzdem kein Rest am Bon.
    { quelle: 'extern', action: 'redeem', type: 'einzweck', art: 'einzweck', nummer: 'FG-1234', betragCents: 2000, satzBp: 2000, versteuertMit: 'FG-1234-V', saldoNachCents: 500, name: 'Gutschein Nr. FG-1234' },
    { quelle: 'extern', action: 'redeem', type: 'value', art: 'mehrzweck', nummer: 'W-77', value: 3, valueCents: 300, saldoNachCents: 700, name: 'Gutschein Nr. W-77' },
  ]);
  const t = bon(r);
  const i = t.indexOf('Gutschein Nr. FG-1234 | -20,00 A');
  assert.ok(i > 0, t.join('\n'));
  assert.equal(t[i + 1], '  Einzweck, versteuert mit FG-1234-V');
  const z = t.indexOf('Zwischensumme | 4,50 €');
  assert.deepEqual(t.slice(z, z + 2), ['Zwischensumme | 4,50 €', 'Gutschein Nr. W-77 | -3,00 €']);
  assert.ok(t.includes('Gesamt: | 1,50 €'), t.join('\n'));
  assert.ok(!t.some((x) => x.includes('Rest am Gutschein')), t.join('\n'));
  assert.ok(!t.some((x) => x.includes('····')), t.join('\n'));
});

test('Einzweck ohne versteuertMit: kein Vermerk', () => {
  const t = bon(beleg([
    { name: 'Torte', quantity: 1, unitPriceCents: 3000, vatRate: 10 },
    { name: 'Gutschein Nr. FG-9', quantity: 1, unitPriceCents: -1000, vatRate: 10, kind: 'voucher' },
  ], [{ quelle: 'extern', action: 'redeem', type: 'einzweck', art: 'einzweck', nummer: 'FG-9', betragCents: 1000, satzBp: 1000, name: 'Gutschein Nr. FG-9' }]));
  const i = t.indexOf('Gutschein Nr. FG-9 | -10,00 B');
  assert.ok(i > 0, t.join('\n'));
  assert.ok(!t[i + 1]!.includes('versteuert'), t.join('\n'));
});

test('Mehrzweck-Verkauf vor dem Stichtag (nur Eintrag): „Gutschein Nr. … (Mehrzweckgutschein)“ + „USt bei Einlösung“', () => {
  const t = bon(beleg([], [{ quelle: 'extern', action: 'sell', type: 'value', art: 'mehrzweck', nummer: 'W-77', value: 30, valueCents: 3000, name: 'Gutschein Nr. W-77 (Mehrzweckgutschein)' }]));
  const i = t.indexOf('1  x Gutschein Nr. W-77 (Mehrzweckgutschein) | 30,00 D');
  assert.ok(i > 0, t.join('\n'));
  assert.equal(t[i + 1], '  USt bei Einlösung');
  assert.ok(t.includes('Gesamt: | 30,00 €'), t.join('\n'));
});

test('Auszahlung Einzweck: „Auszahlung Gutschein Nr. …“ mit Grund, kein Vermerk', () => {
  const t = bon(beleg([
    { name: 'Auszahlung Gutschein Nr. FG-1', quantity: 1, unitPriceCents: -500, vatRate: 20, kind: 'voucher' },
  ], [{ quelle: 'extern', action: 'payout', type: 'einzweck', art: 'einzweck', nummer: 'FG-1', betragCents: 500, satzBp: 2000, versteuertMit: 'X-1', grund: 'Restbetrag', name: 'Auszahlung Gutschein Nr. FG-1' }]));
  const i = t.indexOf('Auszahlung Gutschein Nr. FG-1 | -5,00 A');
  assert.ok(i > 0, t.join('\n'));
  assert.equal(t[i + 1], '  Grund: Restbetrag');
  assert.ok(!t.some((x) => x.includes('versteuert')), t.join('\n'));
});
