import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromReceiptPayload } from '../src/models/index.js';
import { buildReceiptLayout, renderReceiptGrid, gridToText } from '../src/receipt/index.js';

// Rueckgabe als Gutschein (Spec 2026-11-02, A.5): der Storno-Beleg zeigt wie ein Bar-Storno die Summe der
// Waren, statt „Barzahlung“ steht der neue Gutschein als Zahlweg. Kein „Zwischensumme“, kein „Rest am Gutschein“.

const FIRMA = {
  companyName: 'Bäckerei Kornblum', street: 'Hauptplatz 1', zip: '1010', city: 'Wien', phone: '', vatId: 'ATU12345675',
  taxNumber: '', isSmallBusiness: false, footer1: '', footer2: '', thanksMessage: [], showKreiseckLogo: false,
};
const RUECKGABE = { action: 'redeem', type: 'value', voucherType: 'multi_purpose', valueCents: 2490, value: 24.9, name: 'Gutschein', code: '····-····-2D9A', codeSuffix: '2D9A', voucherId: 'g1', fromReturn: true, typeId: 's1', typeName: 'Rückgabe' };
function storno(extra: Record<string, unknown> = {}) {
  return fromReceiptPayload({
    receiptId: 'KASSE1-ID-12', cashregisterId: 'KASSE1', timeStamp: '2026-11-02T10:15:30', receiptType: 'cancellation',
    items: [{ name: 'Torte', quantity: 1, unitPriceCents: -2490, vatRate: 10 }], vouchers: [RUECKGABE], paymentMethod: 'cash', payments: [],
    turnoverCounterAES256ICM: 'U', signaturePreviousReceipt: 'V', certificateSerialNumber: '5A1C3E07', sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.SIG',
    qr: '_R1-AT1_KASSE1_KASSE1-ID-12_2026-11-02T10:15:30_0,00_-24,90_0,00_0,00_0,00_U_V_5A1C3E07_SIG', fullReceiptId: 'F',
    customerDetails: '', legalMessage: '', cancellationReason: 'customer_cancelled', cancellationOf: { receiptId: 'KASSE1-ID-10', fullReceiptId: null },
    ...extra,
  } as never);
}
const text = (r: ReturnType<typeof storno>, chars = 32) => gridToText(renderReceiptGrid(buildReceiptLayout(r, FIRMA as never, {}), { charsPerLine: chars }));

test('Gutschein-Storno: Gesamt −24,90, Zahlweg „Gutschein ····-2D9A −24,90“, keine Barzahlung', () => {
  const t = text(storno());
  assert.match(t, /Gesamt: +-24,90 €/);
  assert.match(t, /Gutschein ····-2D9A +-24,90 €/);
  assert.doesNotMatch(t, /Zwischensumme/);
  assert.doesNotMatch(t, /Barzahlung/);
  assert.doesNotMatch(t, /Rest am Gutschein/);
});

test('mit Mitarbeiter-Trinkgeld bar: Gutschein −20,00 und Barzahlung −2,00 je mit Betrag', () => {
  const t = text(storno({
    items: [{ name: 'Haarschnitt', quantity: 1, unitPriceCents: -2000, vatRate: 20 }, { name: 'Trinkgeld Personal', quantity: 1, unitPriceCents: -200, vatRate: 0, kind: 'tip', recipient: { registerUserId: 'ru', name: 'Mirela Weinzierl' } }],
    vouchers: [{ ...RUECKGABE, valueCents: 2000, value: 20 }],
    payments: [{ id: 'p1', method: 'cash', amountCents: -200 }],
    qr: '_R1-AT1_KASSE1_KASSE1-ID-12_2026-11-02T10:15:30_-20,00_0,00_0,00_-2,00_0,00_U_V_5A1C3E07_SIG',
  }));
  assert.match(t, /Gesamt: +-22,00 €/);
  assert.match(t, /Gutschein ····-2D9A +-20,00 €/);
  assert.match(t, /Barzahlung +-2,00 €/);
});

test('Storno einer Einlösung (ohne fromReturn) bleibt wie bisher', () => {
  const { fromReturn, ...einloesung } = RUECKGABE; void fromReturn;
  const t = text(storno({ vouchers: [einloesung] }));
  assert.match(t, /Zwischensumme +-24,90 €/);
  assert.match(t, /Gutschein ····-2D9A +24,90 €/);
  assert.match(t, /Gesamt: +0,00 €/);
});

test('58 mm: keine Zeile über 32 Zeichen', () => {
  for (const zeile of text(storno()).split('\n')) assert.ok(zeile.length <= 32, zeile);
});
