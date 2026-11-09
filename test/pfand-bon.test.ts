import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fromReceiptPayload, toReceiptItemPayload, fromReceiptItemPayload } from '../src/models/index.js';
import { buildReceiptLayout } from '../src/receipt/layout.js';

// Die Eingaben sind die INTERNE (gespeicherte) Form, wie das Backend sie uebergibt: kind pfand/pfand_rueckgabe,
// pfandZu, pfandArt, jeStueck, eigen, zusatzZu; am Beleg vorOrt und pfandStelle.
const firma = { companyName: 'Bäckerei Kornblum', street: 'Mühlweg 7', zip: '4600', city: 'Wels', phone: '', uid: 'ATU12345675', taxnr: '', isSmallBusiness: false, footer1: '', footer2: '', footer3: '', footer4: '', thanksMessage: [], showKreiseckLogo: false } as never;
const rumpf = { qr: 'qr', sig: 's', certificateSerialNumber: '5A1C3E07', signaturePreviousReceipt: 'v', turnoverCounterAES256ICM: 'u', paymentMethod: 'cash', timeStamp: '2026-08-13T10:15:30', cashregisterId: 'KASSE1', receiptType: 'standard', receiptId: 'AT0-KASSE1-1', fullReceiptId: 'v', creditCardProvider: null, cardPaymentId: null, cardPaymentData: null, customerDetails: '', legalMessage: '', vouchers: [] };
const ware = { name: 'Cola Dose', quantity: 2, unitPriceCents: 200, vatRate: 20 };

function texte(items: unknown[], extra: Record<string, unknown> = {}): string[] {
  const r = fromReceiptPayload({ ...rumpf, items, ...extra } as never);
  return buildReceiptLayout(r, firma).lines.flatMap((z) => (z.kind === 'columns' ? [z.columns.map((c) => c.text).join('|')] : z.kind === 'text' ? [z.text] : []));
}

test('Pfandzeilen werden aus der inneren Form gelesen und wieder so geschrieben', () => {
  const innen = { name: 'Pfand Einweg', quantity: 2, unitPriceCents: 25, vatRate: 0, kind: 'pfand', pfandZu: 0, pfandArt: 'einweg', pfandartId: 'einweg', jeStueck: 25, eigen: true, gtin: '90311017', ean: '9031101700018', codes: { '90311017': 2, kaputt: 0 } };
  const modell = fromReceiptItemPayload(innen as never);
  assert.equal(modell.kind, 'deposit');
  assert.equal(modell.depositFor, 0);
  assert.equal(modell.depositKind, 'single_use');
  assert.equal(modell.depositTypeId, 'einweg');
  assert.equal(modell.perUnit, 25);
  assert.equal(modell.ownFilling, true);
  assert.deepEqual(modell.codes, { '90311017': 2 });
  const zurueck = toReceiptItemPayload(modell);
  assert.equal(zurueck.kind, 'pfand');
  assert.equal(zurueck.pfandArt, 'einweg');
  assert.equal(zurueck.pfandZu, 0);
  assert.equal(zurueck.jeStueck, 25);
  const rueck = fromReceiptItemPayload({ name: 'Leergut', quantity: 1, unitPriceCents: -20, vatRate: 20, kind: 'pfand_rueckgabe', pfandArt: 'mehrweg' } as never);
  assert.equal(rueck.kind, 'deposit_return');
  assert.equal(rueck.depositKind, 'reusable');
});

test('Pfandzeile steht nach den Zusaetzen ihrer Ware, die eines Zusatzes direkt unter dem Zusatz', () => {
  const z = texte([
    ware,
    { name: 'Eis', quantity: 1, unitPriceCents: 50, vatRate: 20, zusatzZu: 0 },
    { name: 'Pfand Mehrweg', quantity: 1, unitPriceCents: 20, vatRate: 20, kind: 'pfand', pfandZu: 1, pfandArt: 'mehrweg' },
    { name: 'Pfand Einweg', quantity: 2, unitPriceCents: 25, vatRate: 0, kind: 'pfand', pfandZu: 0, pfandArt: 'einweg' },
  ]);
  const i = (s: string): number => z.findIndex((t) => t.includes(s));
  assert.ok(i('Cola') < i('Eis') && i('Eis') < i('Pfand Mehrweg') && i('Pfand Mehrweg') < i('Pfand Einweg'));
  assert.ok(z.some((t) => t.startsWith('  + ') && t.includes('Pfand Einweg')));
});

test('Pfand ohne gueltigen Verweis bleibt an seinem Platz und ohne Einrueckung', () => {
  const z = texte([{ name: 'Pfand Einweg', quantity: 1, unitPriceCents: 25, vatRate: 0, kind: 'pfand', pfandZu: 7, pfandArt: 'einweg' }, ware]);
  assert.ok(z.findIndex((t) => t.includes('Pfand Einweg')) < z.findIndex((t) => t.includes('Cola')));
  assert.ok(!z.some((t) => t.startsWith('  + ')));
});

test('Belege ohne Pfand tragen weder Steuerzusatz noch Rueckgabe-Fusszeile', () => {
  const z = texte([ware]);
  assert.ok(!z.some((t) => t.includes('Pfand') || t.includes('Leergut')));
});

test('Pfandstelle und vorOrt aus der gespeicherten Form ergeben die Fusszeile', () => {
  const items = [ware, { name: 'Pfand Mehrweg', quantity: 2, unitPriceCents: 20, vatRate: 20, kind: 'pfand', pfandZu: 0, pfandArt: 'mehrweg' }];
  const r = fromReceiptPayload({ ...rumpf, items, vorOrt: true, pfandStelle: { name: 'Max Hollerer GmbH', adresse: 'Mühlweg 9, 4600 Wels' } } as never);
  assert.equal(r.onPremises, true);
  assert.deepEqual(r.sharedReturnPoint, { name: 'Max Hollerer GmbH', address: 'Mühlweg 9, 4600 Wels' });
  assert.equal(fromReceiptPayload({ ...rumpf, items, vorOrt: false } as never).onPremises, false);
  assert.equal(fromReceiptPayload({ ...rumpf, items } as never).sharedReturnPoint, undefined);
  assert.ok(texte(items, { pfandStelle: { name: 'Max Hollerer GmbH', adresse: 'Mühlweg 9, 4600 Wels' } }).some((t) => t === 'Leergut-Rückgabe: Max Hollerer GmbH, Mühlweg 9, 4600 Wels'));
});

test('Reiner Leergutbeleg: Ueberschrift und Bar ausgezahlt; gemischter Beleg nicht', () => {
  const leergut = { name: 'Leergut Einweg', quantity: 4, unitPriceCents: -25, vatRate: 0, kind: 'pfand_rueckgabe', pfandArt: 'einweg' };
  const rein = texte([leergut], { payments: [{ method: 'cash', amountCents: -100 }] });
  assert.ok(rein.includes('Leergut-Rückgabe'));
  assert.ok(rein.some((t) => t.startsWith('Bar ausgezahlt')));
  assert.ok(rein.some((t) => t.includes('Pfand, nicht steuerbar')));
  const gemischt = texte([ware, leergut]);
  assert.ok(!gemischt.includes('Leergut-Rückgabe'));
  assert.ok(!gemischt.some((t) => t.startsWith('Bar ausgezahlt')));
});
