import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KeckPaymentMethod, ReceiptType, VatRate } from '../src/enums/index.js';
import type { Receipt, ReceiptCompany } from '../src/models/index.js';
import { fromReceiptPayload } from '../src/models/index.js';
import { buildReceiptLayout, receiptSignatureIsTest, type ReceiptLayout } from '../src/receipt/layout.js';

/**
 * Belegart-Aufdruck (RKSV § 11 Abs. 3: Trainings- und Stornobuchungen sind
 * ausdruecklich als solche zu bezeichnen), reduzierter Nullbeleg, Testkasse/
 * Testsignatur-Rahmen. Regelwerk 1.
 */
const FIRMA: ReceiptCompany = {
  companyName: 'Café Kreiseck', street: 'Hauptstraße 5', zip: '1010', city: 'Wien', phone: '+43 1 1234567',
  uid: 'ATU12345678', taxnr: '', isSmallBusiness: false,
  footer1: 'Vielen Dank für Ihren Einkauf', footer2: 'www.kreiseck.com', thanksMessage: ['Bis bald!'], showKreiseckLogo: false,
};
const QR = '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-13T00:30:00_5,00_2,70_0,00_0,00_0,00_UMSATZ_VORGAENGER_6F0404F0_SIGNATUR';
const BELEG: Receipt = {
  receiptId: 'AT0-KASSE1-42', cashregisterId: 'KASSE1', timeStamp: '2026-08-13T00:30:00',
  items: [{ name: 'Espresso', quantity: 2, vat: VatRate.vat20, priceCents: 250 }],
  vouchers: [], paymentMethod: KeckPaymentMethod.cash, turnoverCounterAES256ICM: 'UMSATZ', signaturePreviousReceipt: 'VORGAENGER',
  certificateSerialNumber: '6F0404F0', receiptType: ReceiptType.standard, sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.SIGNATURWERT', qr: QR,
  fullReceiptId: 'VOLL', customerDetails: [], legalMessage: [],
};

const alsText = (l: ReceiptLayout): string[] => l.lines.map((z) => {
  switch (z.kind) {
    case 'text': return z.text;
    case 'columns': return z.columns.map((s) => s.text).join(' ');
    case 'rule': return `<rule ${z.char}>`;
    case 'space': return `<space ${z.lines}>`;
    case 'qr': return `<qr>`;
    case 'banner': return `<banner ${z.text}>`;
  }
});
const banner = (l: ReceiptLayout): string[] => l.lines.filter((z): z is Extract<typeof z, { kind: 'banner' }> => z.kind === 'banner').map((z) => z.text);
const stelle = (l: ReceiptLayout, teil: string): number => alsText(l).findIndex((z) => z.includes(teil));

test('Verkaufsbeleg traegt keinen Belegart-Aufdruck (Rot-Probe fuer die anderen)', () => {
  const l = buildReceiptLayout(BELEG, FIRMA);
  assert.deepEqual(banner(l), []);
});

test('Stornobeleg: STORNOBELEG unter dem Kopf, Stornobuchung mit Bezug und Grund', () => {
  const storno: Receipt = { ...BELEG, receiptId: 'AT0-KASSE1-43', receiptType: ReceiptType.cancellation,
    items: [{ name: 'Espresso', quantity: -2, vat: VatRate.vat20, priceCents: 250 }],
    cancellationOf: { receiptId: 'AT0-KASSE1-42', fullReceiptId: null }, cancellationReason: 'kunde_storniert' };
  const l = buildReceiptLayout(storno, FIRMA);
  assert.deepEqual(banner(l), ['STORNOBELEG']);
  const t = alsText(l);
  assert.ok(t.some((z) => z === 'Stornobuchung zu Beleg AT0-KASSE1-42'), t.join('\n'));
  // direkt unter dem Betriebskopf (nach Telefon), vor der Belegkennung
  assert.ok(stelle(l, '<banner STORNOBELEG>') > stelle(l, '+43 1 1234567'));
  assert.ok(stelle(l, '<banner STORNOBELEG>') < stelle(l, 'Datum:'));
});

test('Trainingsbeleg: TRAININGSBELEG mit Erklaerung -- kein Kauf, keine Zahlung, dem Betrieb Bescheid sagen', () => {
  const l = buildReceiptLayout({ ...BELEG, receiptType: ReceiptType.training }, FIRMA);
  assert.deepEqual(banner(l), ['TRAININGSBELEG']);
  const t = alsText(l).join('\n');
  assert.match(t, /Trainingsbuchung/);
  assert.match(t, /kein Kauf, keine Zahlung/);
  assert.match(t, /Bescheid/);
});

test('Nullbeleg: reduziert -- Kopf, Aufdruck, Kennung, Betrag 0, QR; keine Positionen, MwSt-Tabelle, Zahlungsart, Fusszeilen', () => {
  const null0: Receipt = { ...BELEG, receiptType: ReceiptType.zero, items: [], paymentMethod: '' };
  const l = buildReceiptLayout(null0, FIRMA);
  assert.deepEqual(banner(l), ['NULLBELEG']);
  const t = alsText(l);
  assert.ok(t.includes('Prüfbeleg'), t.join('\n'));
  assert.ok(t.some((z) => z.startsWith('Café Kreiseck')));
  assert.ok(t.some((z) => z.startsWith('Datum:')));
  assert.ok(t.some((z) => z.startsWith('Kassen-ID:')));
  assert.ok(t.some((z) => z.startsWith('Beleg-ID:')));
  assert.ok(t.some((z) => z === 'Betrag: 0,00 €'), t.join('\n'));
  assert.equal(l.lines.filter((z) => z.kind === 'qr').length, 1);
  // Rot-Proben: was NICHT drauf ist
  assert.ok(!t.some((z) => z.startsWith('MwSt%')));
  assert.ok(!t.some((z) => z.startsWith('Zahlungsart:')));
  assert.ok(!t.includes('Vielen Dank für Ihren Einkauf'));
  assert.ok(!t.includes('www.kreiseck.com'));
  assert.ok(!t.includes('Bis bald!'));
});

test('Nullbeleg-Arten: Untertitel aus zeroKind (Start/Monat/Jahr/Schluss/Ausfall/manuell)', () => {
  const zero = (extra: Partial<Receipt>): Receipt => ({ ...BELEG, receiptType: ReceiptType.zero, items: [], paymentMethod: '', ...extra });
  assert.deepEqual(banner(buildReceiptLayout({ ...zero({}), receiptType: ReceiptType.start }, FIRMA)), ['STARTBELEG']);
  assert.ok(alsText(buildReceiptLayout({ ...zero({}), receiptType: ReceiptType.start }, FIRMA)).includes('Nullbeleg zur Inbetriebnahme'));
  const monat = buildReceiptLayout(zero({ zeroKind: 'monthly', timeStamp: '2026-08-31T23:59:30' }), FIRMA);
  assert.deepEqual(banner(monat), ['MONATSBELEG']);
  assert.ok(alsText(monat).includes('Nullbeleg 08/2026'));
  const jahr = buildReceiptLayout(zero({ zeroKind: 'annual', timeStamp: '2026-12-31T23:59:30' }), FIRMA);
  assert.deepEqual(banner(jahr), ['JAHRESBELEG']);
  assert.ok(alsText(jahr).includes('Nullbeleg 2026 — Prüfung mit BMF-App'));
  assert.deepEqual(banner(buildReceiptLayout(zero({ zeroKind: 'annual_replacement', timeStamp: '2027-01-10T10:00:00' }), FIRMA)), ['JAHRESBELEG']);
  assert.deepEqual(banner(buildReceiptLayout(zero({ zeroKind: 'final' }), FIRMA)), ['SCHLUSSBELEG']);
  assert.ok(alsText(buildReceiptLayout(zero({ zeroKind: 'final' }), FIRMA)).includes('Nullbeleg zur Außerbetriebnahme'));
  const ausfall = buildReceiptLayout(zero({ zeroKind: 'outage_end' }), FIRMA);
  assert.deepEqual(banner(ausfall), ['NULLBELEG']);
  assert.ok(alsText(ausfall).includes('Prüfbeleg nach Signaturausfall'));
  assert.ok(alsText(buildReceiptLayout(zero({ zeroKind: 'manual' }), FIRMA)).includes('Prüfbeleg'));
});

test('Testkasse: Rahmen oben UND unten -- zusaetzlich zur Belegart', () => {
  const l = buildReceiptLayout({ ...BELEG, receiptType: ReceiptType.training }, FIRMA, { testKasse: true });
  const b = banner(l);
  assert.equal(b[0], 'TESTKASSE — kein gültiger Beleg');
  assert.equal(b[b.length - 1], 'TESTKASSE — kein gültiger Beleg');
  assert.ok(b.includes('TRAININGSBELEG'));
  assert.equal(stelle(l, 'TESTKASSE'), 0); // ganz oben, ueber dem Kopf
});

test('Testsignatur: erkannt am ZDA AT100 im QR; Aufdruck nur, wenn der Aufrufer es verlangt (Produktionskonto)', () => {
  const testQr = QR.replace('_R1-AT1_', '_R1-AT100_');
  assert.equal(receiptSignatureIsTest({ ...BELEG, qr: testQr }), true);
  assert.equal(receiptSignatureIsTest(BELEG), false);
  const l = buildReceiptLayout({ ...BELEG, qr: testQr }, FIRMA, { testSignatur: true });
  assert.ok(banner(l).includes('TESTSIGNATUR — kein gültiger Beleg'));
  // Rot-Probe: ohne Verlangen kein Aufdruck (Testumgebung signiert immer mit AT100)
  assert.deepEqual(banner(buildReceiptLayout({ ...BELEG, qr: testQr }, FIRMA)), []);
});

test('Regelwerk: 1 ist die Vorgabe und steht am Layout; unbekannt wirft', () => {
  assert.equal(buildReceiptLayout(BELEG, FIRMA).regelwerk, 1);
  assert.equal(buildReceiptLayout(BELEG, FIRMA, { regelwerk: 1 }).regelwerk, 1);
  assert.throws(() => buildReceiptLayout(BELEG, FIRMA, { regelwerk: 99 as 1 }), /Regelwerk/);
});

test('Receipt-Modell: zeroKind wird auch am Vollbeleg gelesen', () => {
  const r = fromReceiptPayload({ receiptId: 'x', cashregisterId: 'K', timeStamp: '2026-08-31T23:59:30', items: [], vouchers: [], paymentMethod: null,
    turnoverCounterAES256ICM: 'u', signaturePreviousReceipt: 'v', certificateSerialNumber: 'c', receiptType: 'zero', sig: 'a.b.c', qr: QR, fullReceiptId: 'f',
    customerDetails: '', legalMessage: '', zeroKind: 'monthly' } as never);
  assert.equal(r.zeroKind, 'monthly');
});
