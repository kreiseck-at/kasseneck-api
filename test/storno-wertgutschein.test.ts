import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KeckPaymentMethod, ReceiptType, VatRate, VoucherAction, VoucherType } from '../src/enums/index.js';
import type { Receipt, ReceiptCompany } from '../src/models/index.js';
import { receiptSubSumCents, receiptSumCents } from '../src/models/index.js';
import { buildReceiptLayout, type ReceiptLayout } from '../src/receipt/layout.js';

/**
 * Storno eines Belegs mit Wertgutschein. Das Backend spiegelt die
 * Wertgutscheine beim Vollstorno mit UNVERAENDERTER action und positivem Wert
 * (storno-core.stornoVouchers); der Fluss dreht sich am Storno-Beleg um
 * (zahlungen-core.wertgutscheinFlussCents): ein
 * eingeloester Gutschein mindert die Rueckzahlung, ein verkaufter wird
 * zurueckgezahlt. Summe und Bon muessen dasselbe sagen wie die Zahlungen.
 */
const FIRMA: ReceiptCompany = {
  companyName: 'Bäckerei Kornblum', street: 'Hauptstraße 5', zip: '1010', city: 'Wien', phone: '+43 1 1234567',
  uid: 'ATU12345675', taxnr: '', isSmallBusiness: false,
  footer1: '', footer2: '', thanksMessage: [], showKreiseckLogo: false,
};
const QR = '_R1-AT1_KASSE1_AT0-KASSE1-43_2026-10-17T09:00:00_0,00_-22,40_0,00_0,00_0,00_UMSATZ_VORGAENGER_5A1C3E07_SIGNATUR';
const KOPF = {
  cashregisterId: 'KASSE1', timeStamp: '2026-10-17T09:00:00', turnoverCounterAES256ICM: 'UMSATZ', signaturePreviousReceipt: 'VORGAENGER',
  certificateSerialNumber: '5A1C3E07', sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.SIGNATURWERT', qr: QR, fullReceiptId: 'VOLL', customerDetails: [], legalMessage: [],
};
const STORNO_KOPF = { receiptType: ReceiptType.cancellation, cancellationOf: { receiptId: 'AT0-KASSE1-42', fullReceiptId: null }, cancellationReason: 'customer_cancelled' };

const EINLOESUNG = { name: undefined, code: 'GS-7', action: VoucherAction.redeem, type: VoucherType.value, valueCents: 1750 };
const VERKAUF = { name: undefined, code: 'GS-8', action: VoucherAction.sell, type: VoucherType.value, valueCents: 3000 };

// Torte 22,40 €, davon 17,50 € per Wertgutschein, 4,90 € bar.
const ORIGINAL_EINLOESUNG: Receipt = {
  ...KOPF, receiptId: 'AT0-KASSE1-42', receiptType: ReceiptType.standard,
  items: [{ name: 'Torte', quantity: 1, vat: VatRate.vat10, priceCents: 2240 }],
  vouchers: [EINLOESUNG], paymentMethod: KeckPaymentMethod.cash,
  payments: [{ id: 'p1', method: KeckPaymentMethod.cash, amountCents: 490 }],
};
const STORNO_EINLOESUNG: Receipt = {
  ...KOPF, ...STORNO_KOPF, receiptId: 'AT0-KASSE1-43',
  items: [{ name: 'Torte', quantity: 1, vat: VatRate.vat10, priceCents: -2240 }],
  vouchers: [EINLOESUNG], paymentMethod: KeckPaymentMethod.cash,
  payments: [{ id: 'p1', method: KeckPaymentMethod.cash, amountCents: -490, refundOf: 'p1' }],
};
// Wertgutschein 30,00 € verkauft, bar.
const STORNO_VERKAUF: Receipt = {
  ...KOPF, ...STORNO_KOPF, receiptId: 'AT0-KASSE1-44',
  items: [], vouchers: [VERKAUF], paymentMethod: KeckPaymentMethod.cash,
  payments: [{ id: 'p1', method: KeckPaymentMethod.cash, amountCents: -3000, refundOf: 'p1' }],
};

const alsText = (l: ReceiptLayout): string[] => l.lines.map((z) => {
  switch (z.kind) {
    case 'text': return z.text;
    case 'columns': return z.columns.map((s) => s.text).join(' | ');
    default: return `<${z.kind}>`;
  }
});
const zeile = (l: ReceiptLayout, anfang: string): string | undefined => alsText(l).find((z) => z.startsWith(anfang));

test('Original mit Einloesung: Summe 4,90 wie bisher (Rot-Probe fuer den Storno)', () => {
  assert.equal(receiptSubSumCents(ORIGINAL_EINLOESUNG), 2240);
  assert.equal(receiptSumCents(ORIGINAL_EINLOESUNG), 490);
  const l = buildReceiptLayout(ORIGINAL_EINLOESUNG, FIRMA);
  assert.equal(zeile(l, 'Wertgutschein GS-7'), 'Wertgutschein GS-7 | -17,50 €');
  assert.equal(zeile(l, 'Gesamt:'), 'Gesamt: | 4,90 €');
});

test('Storno einer Einloesung: Gesamt -4,90 = Rueckzahlung, der Gutschein wird gutgeschrieben', () => {
  assert.equal(receiptSubSumCents(STORNO_EINLOESUNG), -2240);
  assert.equal(receiptSumCents(STORNO_EINLOESUNG), -490);
  const l = buildReceiptLayout(STORNO_EINLOESUNG, FIRMA);
  assert.equal(zeile(l, 'Zwischensumme'), 'Zwischensumme | -22,40 €');
  assert.equal(zeile(l, 'Wertgutschein GS-7'), 'Wertgutschein GS-7 | 17,50 €');
  assert.equal(zeile(l, 'Gesamt:'), 'Gesamt: | -4,90 €');
});

test('Storno eines Gutschein-Verkaufs: Gesamt -30,00, Zeile und 0-%-Gruppe negativ', () => {
  assert.equal(receiptSubSumCents(STORNO_VERKAUF), -3000);
  assert.equal(receiptSumCents(STORNO_VERKAUF), -3000);
  const l = buildReceiptLayout(STORNO_VERKAUF, FIRMA);
  assert.equal(zeile(l, '1  x Wertgutschein'), '1  x Wertgutschein GS-8 | -30,00 D');
  assert.match(zeile(l, 'D 0%') ?? '', /-30,00$/);
  assert.equal(zeile(l, 'Gesamt:'), 'Gesamt: | -30,00 €');
});

test('Belegtyp als roher Serverwert: dieselbe Summe', () => {
  assert.equal(receiptSumCents({ ...STORNO_EINLOESUNG, receiptType: 'cancellation' }), -490);
});

// Aktionsgutschein (type 'promo'): der Server spiegelt ihn an den Storno, nimmt den Rabatt aber ueber
// Ausgleichspositionen (kind 'discount') zurueck; der gespiegelte Eintrag mindert dort nichts.
const AKTION = { name: 'Aktion', code: '····-····-P3AK', action: VoucherAction.redeem, type: VoucherType.promo, valueCents: 1000 };
const STORNO_AKTION: Receipt = {
  ...KOPF, ...STORNO_KOPF, receiptId: 'AT0-KASSE1-45',
  items: [
    { name: 'Geschenkkorb', quantity: 1, vat: VatRate.vat20, priceCents: -2240 },
    { name: 'Torte', quantity: 1, vat: VatRate.vat10, priceCents: -1190 },
    { name: 'Gutschein-Ausgleich', quantity: 1, vat: VatRate.vat20, priceCents: 654, kind: 'discount' },
    { name: 'Gutschein-Ausgleich', quantity: 1, vat: VatRate.vat10, priceCents: 346, kind: 'discount' },
  ],
  vouchers: [AKTION], paymentMethod: KeckPaymentMethod.cash,
  payments: [{ id: 'p1', method: KeckPaymentMethod.cash, amountCents: -2430, refundOf: 'p1' }],
};

test('Storno mit Aktionsgutschein: Gesamt -24,30 = Rueckzahlung, der Gutschein nur als Bezug', () => {
  assert.equal(receiptSumCents(STORNO_AKTION), -2430);
  const l = buildReceiptLayout(STORNO_AKTION, FIRMA);
  assert.equal(zeile(l, 'Gesamt:'), 'Gesamt: | -24,30 €');
  assert.equal(zeile(l, 'Aktionsgutschein'), 'Aktionsgutschein ····-P3AK - Aktion | ');
});
