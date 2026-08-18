import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KeckPaymentMethod, ReceiptType, VatRate } from '../src/enums/index.js';
import type { Receipt, ReceiptCompany } from '../src/models/index.js';
import { fromReceiptPayload } from '../src/models/index.js';
import { AKTUELLES_REGELWERK, buildReceiptLayout, receiptAmountsAreZero, receiptIsSmallBusinessConsistent, receiptSignatureIsTest, type ReceiptLayout } from '../src/receipt/layout.js';
import { CANCELLATION_REASONS } from '../src/models/index.js';

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

test('Nullbeleg (Regelwerk 1, Altbelege): reduziert -- Kopf, Aufdruck, Kennung, Betrag 0, QR; keine Positionen, MwSt-Tabelle, Zahlungsart, Fusszeilen', () => {
  const null0: Receipt = { ...BELEG, receiptType: ReceiptType.zero, items: [], paymentMethod: '' };
  const l = buildReceiptLayout(null0, FIRMA, { regelwerk: 1 });
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

test('Regelwerk: 2 ist die Vorgabe und steht am Layout; 1 setzt Altbelege wie bisher; unbekannt wirft', () => {
  assert.equal(AKTUELLES_REGELWERK, 2);
  assert.equal(buildReceiptLayout(BELEG, FIRMA).regelwerk, 2);
  assert.equal(buildReceiptLayout(BELEG, FIRMA, { regelwerk: 1 }).regelwerk, 1);
  assert.throws(() => buildReceiptLayout(BELEG, FIRMA, { regelwerk: 99 as 1 }), /Regelwerk/);
  // Vollbelege sind in beiden Regelwerken zeilengleich -- Regelwerk 2 aendert nur den Nullbeleg.
  assert.deepEqual(alsText(buildReceiptLayout(BELEG, FIRMA, { regelwerk: 2 })), alsText(buildReceiptLayout(BELEG, FIRMA, { regelwerk: 1 })));
});

// --- Regelwerk 2: Nullbeleg als Pruefbeleg -------------------------------------
const NULL0: Receipt = { ...BELEG, receiptType: ReceiptType.zero, items: [], paymentMethod: '', zeroKind: 'monthly', timeStamp: '2026-08-31T23:59:30',
  qr: '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-31T23:59:30_0,00_0,00_0,00_0,00_0,00_UMSATZ_VORGAENGER_6F0404F0_SIGNATUR' };

test('Regelwerk 2: Nullbeleg traegt einen Block "Prüfangaben" statt der Summenzeile', () => {
  const l = buildReceiptLayout(NULL0, FIRMA, { pruefangaben: { karteRegistriertAm: '2024-03-12', kasseRegistriertAm: '2024-03-12' } });
  const t = alsText(l);
  assert.deepEqual(banner(l), ['MONATSBELEG']);
  assert.ok(t.includes('Prüfangaben'), t.join('\n'));
  assert.ok(!t.some((z) => z === 'Betrag: 0,00 €'), 'Summenzeile darf nicht mehr da sein');
  assert.ok(t.some((z) => z === 'Barumsatz: 0,00 €'), t.join('\n'));
  assert.ok(t.some((z) => z === 'Signatur: signiert'), t.join('\n'));
  // Zertifikat-Seriennummer ist hexadezimal -- als solche gekennzeichnet
  assert.ok(t.some((z) => z === 'Signaturkarte: 0x6F0404F0'), t.join('\n'));
  assert.ok(t.some((z) => z === 'Zertifizierungsdienst: A-Trust (AT1)'), t.join('\n'));
  assert.ok(t.some((z) => z === 'Karte registriert: 12.03.2024'), t.join('\n'));
  assert.ok(t.some((z) => z === 'Kasse registriert: 12.03.2024'), t.join('\n'));
  // Reihenfolge: Kennung -> Pruefangaben -> QR; nach wie vor keine Positionen/Fusszeilen
  assert.ok(stelle(l, 'Beleg-ID:') < stelle(l, 'Prüfangaben'));
  assert.ok(stelle(l, 'Prüfangaben') < l.lines.findIndex((z) => z.kind === 'qr'));
  assert.ok(!t.some((z) => z.startsWith('MwSt%')));
  assert.ok(!t.includes('Vielen Dank für Ihren Einkauf'));
  assert.equal(l.lines.filter((z) => z.kind === 'qr').length, 1);
});

test('Regelwerk 2: unbekannte Registrierdaten lassen die Zeile weg; ZDA-Kennungen; Ausfall', () => {
  const ohne = alsText(buildReceiptLayout(NULL0, FIRMA));
  assert.ok(!ohne.some((z) => z.startsWith('Karte registriert:')));
  assert.ok(!ohne.some((z) => z.startsWith('Kasse registriert:')));
  assert.ok(ohne.some((z) => z === 'Signaturkarte: 0x6F0404F0'));
  const zda = (kennung: string) => alsText(buildReceiptLayout({ ...NULL0, qr: NULL0.qr.replace('_R1-AT1_', `_R1-${kennung}_`) }, FIRMA)).find((z) => z.startsWith('Zertifizierungsdienst:'));
  assert.equal(zda('AT0'), 'Zertifizierungsdienst: geschlossenes System (AT0)');
  assert.equal(zda('AT2'), 'Zertifizierungsdienst: GlobalTrust (AT2)');
  assert.equal(zda('AT3'), 'Zertifizierungsdienst: PrimeSign (AT3)');
  assert.equal(zda('AT100'), 'Zertifizierungsdienst: Testsignatur (AT100)');
  assert.equal(zda('AT7'), 'Zertifizierungsdienst: AT7');
  // Signaturausfall: Zeile im Block UND der Pflichthinweis (§ 17 RKSV) bleiben
  const ausfall = alsText(buildReceiptLayout({ ...NULL0, signatureSuccess: false, sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.U2ljaGVyaGVpdHNlaW5yaWNodHVuZyBhdXNnZWZhbGxlbg' }, FIRMA));
  assert.ok(ausfall.some((z) => z === 'Signatur: ausgefallen'), ausfall.join('\n'));
  assert.ok(ausfall.some((z) => z.includes('Sicherheitseinrichtung ausgefallen')), ausfall.join('\n'));
});

test('Regelwerk 2: "Nullbeleg" mit echten Betraegen wird NICHT reduziert -- die Zahlen stehen drauf', () => {
  const falsch: Receipt = { ...NULL0, items: [{ name: 'Espresso', quantity: 1, vat: VatRate.vat20, priceCents: 250 }] };
  const t = alsText(buildReceiptLayout(falsch, FIRMA));
  assert.ok(!t.includes('Prüfangaben'));
  assert.ok(t.some((z) => z.startsWith('MwSt%')));
  assert.ok(t.some((z) => z.startsWith('Gesamt:')));
  assert.equal(receiptAmountsAreZero(falsch), false);
  assert.equal(receiptAmountsAreZero(NULL0), true);
  // Gutschein-Einloesung ohne Positionen ist auch kein Nullbeleg
  assert.equal(receiptAmountsAreZero({ ...NULL0, vouchers: [{ type: 'value', action: 'redeem', value: 5, name: null } as never] }), false);
});

test('Receipt-Modell: zeroKind wird auch am Vollbeleg gelesen', () => {
  const r = fromReceiptPayload({ receiptId: 'x', cashregisterId: 'K', timeStamp: '2026-08-31T23:59:30', items: [], vouchers: [], paymentMethod: null,
    turnoverCounterAES256ICM: 'u', signaturePreviousReceipt: 'v', certificateSerialNumber: 'c', receiptType: 'zero', sig: 'a.b.c', qr: QR, fullReceiptId: 'f',
    customerDetails: '', legalMessage: '', zeroKind: 'monthly' } as never);
  assert.equal(r.zeroKind, 'monthly');
});

test('Storno-Grund: jeder Katalogwert (CANCELLATION_REASONS) wird als Text gedruckt, nie als roher Code', () => {
  for (const [code, text] of Object.entries(CANCELLATION_REASONS)) {
    const l = buildReceiptLayout({ ...BELEG, receiptType: ReceiptType.cancellation, cancellationOf: { receiptId: 'AT0-KASSE1-42', fullReceiptId: null }, cancellationReason: code }, FIRMA);
    const t = alsText(l).join('\n');
    assert.ok(t.includes(`Grund: ${text}`), `${code}: ${t}`);
    assert.ok(!t.includes(`Grund: ${code}`), `${code} roh gedruckt`);
  }
  // unbekannter Code (Fremdclient): kommt sichtbar, aber ohne zu werfen
  const fremd = alsText(buildReceiptLayout({ ...BELEG, receiptType: ReceiptType.cancellation, cancellationOf: { receiptId: 'x', fullReceiptId: null }, cancellationReason: 'xyz' }, FIRMA)).join('\n');
  assert.ok(fremd.includes('Grund: xyz'));
});

test('Kleinunternehmer: alle Positionen 0 % -> USt-Tabelle nur mit der 0 %-Zeile, Hinweis; receiptIsSmallBusinessConsistent', () => {
  const ku: ReceiptCompany = { ...FIRMA, isSmallBusiness: true };
  const beleg0: Receipt = { ...BELEG, items: [{ name: 'Espresso', quantity: 2, vat: VatRate.vat0, priceCents: 250 }, { name: 'Kuchen', quantity: 1, vat: VatRate.vat0, priceCents: 390 }] };
  const t = alsText(buildReceiptLayout(beleg0, ku));
  const tabelle = t.filter((z) => /^[A-G] \d+(,\d)?%/.test(z));
  assert.deepEqual(tabelle.map((z) => z.split(' ')[0]), ['D']);
  assert.ok(t.some((z) => z.includes('Kleinunternehmer')));
  assert.equal(receiptIsSmallBusinessConsistent(beleg0), true);
  // Widerspruch: KU-Konto, aber 20 %-Position -> als solcher erkennbar (der Aufrufer/Backend weist ab)
  assert.equal(receiptIsSmallBusinessConsistent(BELEG), false);
});
