import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fromReceiptPayload } from '../src/models/index.js';
import { fromStoredReceipt } from '../src/stored/index.js';
import { buildReceiptLayout } from '../src/receipt/layout.js';

const firma = { companyName: 'Bäckerei Kornblum', street: 'Mühlweg 7', zip: '4600', city: 'Wels', phone: '', vatId: 'ATU12345675', taxNumber: '', isSmallBusiness: false, footer1: '', footer2: '', footer3: '', footer4: '', thanksMessage: [], showKreiseckLogo: false } as never;
const rumpf = { qr: 'qr', sig: 's', certificateSerialNumber: '5A1C3E07', signaturePreviousReceipt: 'v', turnoverCounterAES256ICM: 'u', paymentMethod: 'cash', timeStamp: '2026-08-13T10:15:30', cashregisterId: 'KASSE1', receiptType: 'standard', receiptId: 'AT0-KASSE1-1', fullReceiptId: 'v', creditCardProvider: null, cardPaymentId: null, cardPaymentData: null, customerDetails: '', legalMessage: '', vouchers: [] };
const ware = { name: 'Cola Dose', quantity: 2, unitPriceCents: 200, vatRate: 20 };

function texte(items: unknown[], extra: Record<string, unknown> = {}): string[] {
  const r = fromReceiptPayload({ ...rumpf, items, ...extra } as never);
  return buildReceiptLayout(r, firma).lines.flatMap((z) => ('columns' in z ? [z.columns.map((c) => c.text).join('|')] : 'text' in z ? [z.text] : []));
}

test('Pfandzeile steht nach den Zusaetzen ihrer Ware, die eines Zusatzes direkt unter dem Zusatz', () => {
  const z = texte([
    ware,
    { name: 'Eis', quantity: 1, unitPriceCents: 50, vatRate: 20, addOnOf: 0 },
    { name: 'Pfand Mehrweg', quantity: 1, unitPriceCents: 20, vatRate: 20, kind: 'deposit', depositFor: 1, depositKind: 'reusable' },
    { name: 'Pfand Einweg', quantity: 2, unitPriceCents: 25, vatRate: 0, kind: 'deposit', depositFor: 0, depositKind: 'single_use' },
  ]);
  const i = (s: string): number => z.findIndex((t) => t.includes(s));
  assert.ok(i('Cola') < i('Eis') && i('Eis') < i('Pfand Mehrweg') && i('Pfand Mehrweg') < i('Pfand Einweg'));
  assert.ok(z.some((t) => t.startsWith('  + ') && t.includes('Pfand Einweg')));
});

test('Pfand ohne gueltigen Verweis bleibt an seinem Platz und ohne Einrueckung', () => {
  const z = texte([{ name: 'Pfand Einweg', quantity: 1, unitPriceCents: 25, vatRate: 0, kind: 'deposit', depositFor: 7, depositKind: 'single_use' }, ware]);
  assert.ok(z.findIndex((t) => t.includes('Pfand Einweg')) < z.findIndex((t) => t.includes('Cola')));
  assert.ok(!z.some((t) => t.startsWith('  + ')));
});

test('Belege ohne Pfand tragen weder Steuerzusatz noch Rueckgabe-Fusszeile', () => {
  const z = texte([ware]);
  assert.ok(!z.some((t) => t.includes('Pfand') || t.includes('Leergut')));
});

test('Pfandstelle und vorOrt: Fusszeile aus der Antwort wie aus der gespeicherten Form', () => {
  const items = [ware, { name: 'Pfand Mehrweg', quantity: 2, unitPriceCents: 20, vatRate: 20, kind: 'deposit', depositFor: 0, depositKind: 'reusable' }];
  const stelle = { name: 'Max Hollerer GmbH', address: 'Mühlweg 9, 4600 Wels' };
  const r = fromReceiptPayload({ ...rumpf, items, onPremises: true, sharedReturnPoint: stelle } as never);
  assert.equal(r.onPremises, true);
  assert.deepEqual(r.sharedReturnPoint, stelle);
  assert.ok(texte(items, { sharedReturnPoint: stelle }).some((t) => t === 'Leergut-Rückgabe: Max Hollerer GmbH, Mühlweg 9, 4600 Wels'));
  const gespeichert = fromStoredReceipt({ ...rumpf, items: [{ name: 'Cola Dose', amount: 2, priceOne: 2, vat: 20 }], vorOrt: false, pfandStelle: { name: stelle.name, adresse: stelle.address } });
  assert.equal(gespeichert.onPremises, false);
  assert.deepEqual(gespeichert.sharedReturnPoint, stelle);
});

test('Reiner Leergutbeleg: Ueberschrift und Bar ausgezahlt; gemischter Beleg nicht', () => {
  const leergut = { name: 'Leergut Einweg', quantity: 4, unitPriceCents: -25, vatRate: 0, kind: 'deposit_return', depositKind: 'single_use' };
  const rein = texte([leergut], { payments: [{ method: 'cash', amountCents: -100 }] });
  assert.ok(rein.includes('Leergut-Rückgabe'));
  assert.ok(rein.some((t) => t.startsWith('Bar ausgezahlt')));
  assert.ok(rein.some((t) => t.includes('Pfand, nicht steuerbar')));
  const gemischt = texte([ware, leergut]);
  assert.ok(!gemischt.includes('Leergut-Rückgabe'));
  assert.ok(!gemischt.some((t) => t.startsWith('Bar ausgezahlt')));
});
