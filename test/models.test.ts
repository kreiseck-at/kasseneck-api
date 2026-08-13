import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VatRate, ReceiptType, KeckPaymentMethod, CreditCardProvider, VoucherType, VoucherAction } from '../src/enums/index.js';
import {
  type ReceiptItem,
  toReceiptItemPayload,
  fromReceiptItemPayload,
  receiptItemTotalCents,
  receiptItemIsValid,
  negateReceiptItem,
} from '../src/models/receipt-item.js';
import { type Voucher, toVoucherPayload, fromVoucherPayload, voucherIsValid } from '../src/models/voucher.js';
import {
  type Receipt,
  type ReceiptPayload,
  toReceiptPayload,
  fromReceiptPayload,
  receiptSubSumCents,
  receiptSumCents,
} from '../src/models/receipt.js';
import {
  type CashregisterPayload,
  fromCashregisterPayload,
} from '../src/models/cashregister.js';
import { fromReceiptSummaryPayload } from '../src/models/receipt-summary.js';
import { centsToEuro, euroToCents } from '../src/money.js';
import {
  type ReportMonth,
  previousReportMonth,
  nextReportMonth,
  reportMonthKey,
  reportMonthReadable,
  reportMonthFromDate,
} from '../src/models/report-month.js';
import {
  type StripeUrlSession,
  toStripeUrlSessionPayload,
  fromStripeUrlSessionPayload,
} from '../src/models/stripe-url-session.js';
import {
  type HobexReceipt,
  toHobexReceiptPayload,
  fromHobexReceiptPayload,
  hobexReceiptToCardPaymentData,
  hobexReceiptNeedsSignature,
} from '../src/models/hobex-receipt.js';

// --- Belegposition -----------------------------------------------------

test('Belegposition: Nutzlast hin und zurueck ergibt denselben Wert', () => {
  const item: ReceiptItem = { name: 'Espresso', quantity: 2, vat: VatRate.vat10, priceCents: 250 };
  const payload = toReceiptItemPayload(item);
  assert.deepEqual(payload, { name: 'Espresso', quantity: 2, unitPriceCents: 250, vatRate: 10 });
  assert.deepEqual(fromReceiptItemPayload(payload), item);
});

test('Belegposition: Betraege bleiben ganzzahlig ueber drei krumme Positionen', () => {
  const items: ReceiptItem[] = [
    { name: 'A', quantity: 1, vat: VatRate.vat20, priceCents: 29 },
    { name: 'B', quantity: 1, vat: VatRate.vat20, priceCents: 29 },
    { name: 'C', quantity: 1, vat: VatRate.vat20, priceCents: 29 },
  ];
  const summe = items.reduce((acc, item) => acc + receiptItemTotalCents(item), 0);
  // 3 * 29 Cent = 87 Cent exakt (Integer-Addition). Mit Euro-Gleitkomma
  // (0.29 + 0.29 + 0.29) landet man dagegen bei 0.8699999999999999 statt
  // 0.87 — genau der Rundungsfehler, den Cent-Integer-Arithmetik vermeidet.
  assert.equal(summe, 87);
  assert.notEqual(0.29 + 0.29 + 0.29, 0.87);
});

test('Belegposition: liest die woertliche v1-Nutzlast, wie das Backend sie speichert', () => {
  // Das Backend bildet die v2-Felder am Eingang auf v1 ab und speichert v1
  // (normalizeMoneyInputs in functions/index.js): amount, vat, priceOne,
  // priceOneCents. Ein gespeicherter Beleg traegt v2 nur dann, wenn der
  // erzeugende Client sie mitgesendet hat — v1 traegt er IMMER. Von Hand aus
  // dieser Speicherform abgeschrieben, nicht ueber toReceiptItemPayload erzeugt.
  const v1 = { name: 'Kaffee', amount: 2, vat: 20, priceOne: 3.2, priceOneCents: 320 };
  assert.deepEqual(fromReceiptItemPayload(v1), { name: 'Kaffee', quantity: 2, vat: VatRate.vat20, priceCents: 320 });
});

test('Belegposition: v1 ohne Cent-Feld faellt exakt auf die Euro-Rundung zurueck', () => {
  const v1 = { name: 'Kaffee', amount: 1, vat: 10, priceOne: 3.2 };
  assert.deepEqual(fromReceiptItemPayload(v1), { name: 'Kaffee', quantity: 1, vat: VatRate.vat10, priceCents: 320 });
});

test('Belegposition: tragen beide Formen widersprechende Werte, gewinnt v2 vor v1 und Cent vor Euro', () => {
  // Bewusst widerspruechlich befuellt: mit gleichen Werten auf beiden Seiten
  // haelt der Test die Reihenfolge gar nicht fest — er bliebe auch dann gruen,
  // wenn die Kette auf v1-vor-v2 gedreht waere.
  const beide = {
    name: 'Kaffee',
    quantity: 3,
    unitPriceCents: 333,
    vatRate: 13,
    amount: 7,
    vat: 20,
    priceOne: 99.99,
    priceOneCents: 999,
  };
  assert.deepEqual(fromReceiptItemPayload(beide), { name: 'Kaffee', quantity: 3, vat: VatRate.vat13, priceCents: 333 });
});

test('Belegposition: fehlt das v2-Cent-Feld, gewinnt die v1-Cent-Angabe vor der v1-Euro-Angabe', () => {
  // Zweite Stufe der Kette, ebenfalls widerspruechlich befuellt: exakt vor
  // gerundet, auch innerhalb von v1.
  const v1 = { name: 'Kaffee', amount: 1, vat: 10, priceOne: 99.99, priceOneCents: 320 };
  assert.deepEqual(fromReceiptItemPayload(v1), { name: 'Kaffee', quantity: 1, vat: VatRate.vat10, priceCents: 320 });
});

test('Belegposition: ein v1-Beleg bleibt stornierbar — die gelesene Position ist gueltig', () => {
  // Regressionsschutz: kennt der Lesepfad v1 nicht, kommt quantity als
  // undefined zurueck, receiptItemIsValid schlaegt fehl, und der Beleg laesst
  // sich ueber dieses Paket nie stornieren.
  const gelesen = fromReceiptItemPayload({ name: 'Kaffee', amount: 1, vat: 20, priceOne: 3.2, priceOneCents: 320 });
  assert.equal(receiptItemIsValid(gelesen), true);
  assert.deepEqual(negateReceiptItem(gelesen), { name: 'Kaffee', quantity: 1, vat: VatRate.vat20, priceCents: -320 });
});

test('Belegposition: unbekannter Steuersatz aus der Nutzlast bleibt beim Lesen erhalten statt zu werfen', () => {
  // Lesepfad muss tolerant sein: ein Steuersatz, den dieses Paket noch nicht
  // kennt (z. B. weil das Backend inzwischen einen neuen eingefuehrt hat),
  // darf eine bestehende Belegliste nicht zum Absturz bringen.
  const bogus = { name: 'X', quantity: 1, unitPriceCents: 100, vatRate: 999 };
  const item = fromReceiptItemPayload(bogus);
  // Roher Nutzlast-Wert bleibt exakt erhalten (nie `undefined`) und ist am
  // Typ erkennbar: eine Zahl statt des bekannten Steuersatz-Objekts.
  assert.equal(item.vat, 999);
  assert.equal(typeof item.vat, 'number');
});

test('Belegposition: unbekannter Steuersatz wirft beim Schreiben weiterhin', () => {
  const item: ReceiptItem = { name: 'X', quantity: 1, vat: 999, priceCents: 100 };
  assert.throws(() => toReceiptItemPayload(item), /Steuersatz/);
});

test('Belegposition: gueltig heisst Name da und Menge positiv — negativer Preis bleibt gueltig', () => {
  assert.equal(receiptItemIsValid({ name: 'Kaffee', quantity: 1, vat: VatRate.vat20, priceCents: 320 }), true);
  // Storno: der negative Preis ist der Normalfall, kein Fehler.
  assert.equal(receiptItemIsValid({ name: 'Kaffee', quantity: 1, vat: VatRate.vat20, priceCents: -320 }), true);
  assert.equal(receiptItemIsValid({ name: '', quantity: 1, vat: VatRate.vat20, priceCents: 320 }), false);
  assert.equal(receiptItemIsValid({ name: 'Kaffee', quantity: 0, vat: VatRate.vat20, priceCents: 320 }), false);
  assert.equal(receiptItemIsValid({ name: 'Kaffee', quantity: -1, vat: VatRate.vat20, priceCents: 320 }), false);
});

test('Belegposition: Negation kehrt den Preis um und laesst die Menge positiv', () => {
  const item: ReceiptItem = { name: 'Kaffee', quantity: 2, vat: VatRate.vat20, priceCents: 320 };
  const storno = negateReceiptItem(item);
  assert.deepEqual(storno, { name: 'Kaffee', quantity: 2, vat: VatRate.vat20, priceCents: -320 });
  // Die Ausgangsposition bleibt unberuehrt — sonst waere der Originalbeleg
  // nach dem Storno im Speicher veraendert.
  assert.equal(item.priceCents, 320);
  assert.deepEqual(negateReceiptItem(storno), item);
});

// --- Gutschein -----------------------------------------------------------

test('Gutschein: Nutzlast hin und zurueck ergibt denselben Wert', () => {
  const voucher: Voucher = { name: 'Weihnachten', code: 'XMAS', action: VoucherAction.sell, type: VoucherType.value, valueCents: 550 };
  const payload = toVoucherPayload(voucher);
  assert.equal(payload.value, 5.5);
  assert.equal(payload.valueCents, 550);
  assert.deepEqual(fromVoucherPayload(payload), voucher);
});

test('Gutschein: Wert ohne valueCents faellt exakt auf Euro-Rundung zurueck', () => {
  const payload = { name: null, code: null, action: 'redeem', type: 'promo', value: 5, valueCents: null };
  const voucher = fromVoucherPayload(payload);
  assert.equal(voucher.valueCents, 500);
});

test('Gutschein: unbekannte Aktion aus der Nutzlast bleibt beim Lesen erhalten statt zu werfen', () => {
  const bogus = { name: null, code: null, action: 'teleport', type: 'promo', value: null, valueCents: null };
  const voucher = fromVoucherPayload(bogus);
  assert.equal(voucher.action, 'teleport');
});

test('Gutschein: unbekannte Aktion wirft beim Schreiben weiterhin', () => {
  const voucher: Voucher = { action: 'teleport', type: VoucherType.promo, valueCents: 100 };
  assert.throws(() => toVoucherPayload(voucher), /Aktion/);
});

test('Gutschein: Gueltigkeitsregeln des Vorbilds', () => {
  const wert = (valueCents?: number): Voucher => ({ action: VoucherAction.sell, type: VoucherType.value, ...(valueCents == null ? {} : { valueCents }) });
  assert.equal(voucherIsValid(wert(500)), true);
  // Wertgutschein ohne Wert ergibt keinen Umsatz.
  assert.equal(voucherIsValid(wert()), false);
  // Ein Promotionsgutschein wird eingeloest, nie verkauft.
  assert.equal(voucherIsValid({ action: VoucherAction.redeem, type: VoucherType.promo, valueCents: 500 }), true);
  assert.equal(voucherIsValid({ action: VoucherAction.sell, type: VoucherType.promo, valueCents: 500 }), false);
  assert.equal(voucherIsValid({ action: VoucherAction.redeem, type: VoucherType.promo }), false);
  // Ein gesetzter Wert muss positiv sein — 0 und negativ sind Unsinn.
  assert.equal(voucherIsValid(wert(0)), false);
  assert.equal(voucherIsValid(wert(-100)), false);
});

// --- Beleg -----------------------------------------------------------------

function baueBeleg(items: ReceiptItem[], vouchers: Voucher[] = []): Receipt {
  return {
    receiptId: 'r1',
    cashregisterId: 'cr1',
    timeStamp: '2026-08-13T10:00:00.000Z',
    items,
    vouchers,
    paymentMethod: KeckPaymentMethod.cash,
    turnoverCounterAES256ICM: 'aes',
    signaturePreviousReceipt: 'sig-prev',
    certificateSerialNumber: 'cert-123',
    receiptType: ReceiptType.standard,
    sig: 'sig',
    qr: 'qr-data',
    fullReceiptId: 'AT1-r1',
    customerDetails: ['Zeile 1', 'Zeile 2'],
    legalMessage: ['Beleg gemaess RKSV'],
    // fromReceiptPayload traegt fehlende optionale Felder explizit als
    // `undefined` ein (nicht als fehlender Schluessel) — hier ebenso, damit
    // der Rundtrip-Vergleich dieselbe Objektform hat.
    creditCardProvider: undefined,
    cardPaymentId: undefined,
    cardPaymentData: undefined,
    signatureSuccess: undefined,
    customProjectId: undefined,
  };
}

test('Beleg: Nutzlast hin und zurueck ergibt denselben Wert', () => {
  const beleg = baueBeleg([{ name: 'Kaffee', quantity: 1, vat: VatRate.vat10, priceCents: 350 }]);
  const payload = toReceiptPayload(beleg);
  assert.equal(payload.customerDetails, 'Zeile 1\nZeile 2');
  assert.deepEqual(fromReceiptPayload(payload), beleg);
});

test('Beleg mit allen Steuersaetzen behaelt seine Summen nach der Nutzlast-Runde', () => {
  const items: ReceiptItem[] = Object.values(VatRate).map((vat, i) => ({
    name: `Position ${i}`,
    quantity: 1,
    vat,
    priceCents: 100 + i,
  }));
  const beleg = baueBeleg(items);
  const erwarteteSumme = items.reduce((acc, item) => acc + receiptItemTotalCents(item), 0);
  assert.equal(receiptSubSumCents(beleg), erwarteteSumme);
  assert.equal(receiptSumCents(beleg), erwarteteSumme);

  const rundtrip = fromReceiptPayload(toReceiptPayload(beleg));
  assert.equal(receiptSumCents(rundtrip), erwarteteSumme);
});

test('Beleg: eingeloester Wertgutschein senkt die Gesamtsumme, nicht die Zwischensumme', () => {
  const beleg = baueBeleg(
    [{ name: 'Kaffee', quantity: 1, vat: VatRate.vat10, priceCents: 350 }],
    [{ name: null as unknown as string, code: null as unknown as string, action: VoucherAction.redeem, type: VoucherType.value, valueCents: 100 }],
  );
  assert.equal(receiptSubSumCents(beleg), 350);
  assert.equal(receiptSumCents(beleg), 250);
});

test('Beleg: unbekannter Belegtyp aus der Nutzlast bleibt beim Lesen erhalten statt zu werfen', () => {
  const beleg = baueBeleg([{ name: 'Kaffee', quantity: 1, vat: VatRate.vat10, priceCents: 350 }]);
  const payload = { ...toReceiptPayload(beleg), receiptType: 'unbekannt' };
  const gelesen = fromReceiptPayload(payload);
  assert.equal(gelesen.receiptType, 'unbekannt');
  // Der Rest des Belegs bleibt vollstaendig lesbar.
  assert.equal(gelesen.items.length, 1);
  assert.equal(gelesen.sig, 'sig');
});

test('Beleg: unbekannter Belegtyp wirft beim Schreiben weiterhin', () => {
  const beleg = baueBeleg([{ name: 'Kaffee', quantity: 1, vat: VatRate.vat10, priceCents: 350 }]);
  const mitUnbekanntemTyp: Receipt = { ...beleg, receiptType: 'unbekannt' };
  assert.throws(() => toReceiptPayload(mitUnbekanntemTyp), /Belegtyp/);
});

test('Beleg: unbekannter Steuersatz in einer Position laesst die uebrigen Positionen und den Beleg unversehrt', () => {
  const beleg = baueBeleg([{ name: 'Bekannt', quantity: 1, vat: VatRate.vat10, priceCents: 300 }]);
  const payload = toReceiptPayload(beleg);
  // Simuliert: das Backend kennt inzwischen einen Steuersatz, den dieses
  // Paket noch nicht kennt — genau der Fall, der frueher die ganze Liste
  // ueber `.map()` zum Werfen gebracht haette.
  payload.items.push({ name: 'Unbekannt', quantity: 1, unitPriceCents: 500, vatRate: 999 });
  const gelesen = fromReceiptPayload(payload);
  assert.equal(gelesen.items.length, 2);
  assert.deepEqual(gelesen.items[0]?.vat, VatRate.vat10);
  assert.equal(gelesen.items[1]?.vat, 999);
  assert.equal(gelesen.sig, 'sig');
});

test('Beleg: ein gespeicherter Beleg in v1-Positionsform ergibt echte Summen statt NaN', () => {
  const beleg = baueBeleg([{ name: 'Kaffee', quantity: 1, vat: VatRate.vat10, priceCents: 350 }]);
  // So liegt der Beleg im Firestore: das Backend speichert die v1-Form.
  const payload = { ...toReceiptPayload(beleg), items: [{ name: 'Kaffee', amount: 1, vat: 10, priceOne: 3.5, priceOneCents: 350 }] };
  const gelesen = fromReceiptPayload(payload);
  assert.deepEqual(gelesen.items, [{ name: 'Kaffee', quantity: 1, vat: VatRate.vat10, priceCents: 350 }]);
  assert.equal(receiptSumCents(gelesen), 350);
});

test('Beleg: liest eine woertliche, dem Flutter-Vorbild nachgebaute Nutzlast ueber alle Felder', () => {
  // Nicht ueber toReceiptPayload erzeugt — bewusst von Hand aus
  // kasseneck_receipt.dart::toReceiptJson() abgeschrieben, damit ein falsch
  // benannter Nutzlast-Schluessel auffaellt (der selbstreferenzielle
  // Rundtrip wuerde einen solchen Fehler auf beiden Seiten gleich falsch
  // machen und ihn dadurch verdecken).
  const payload: ReceiptPayload = {
    qr: 'https://kasseneck.at/beleg/AT1-r1',
    sig: 'c2ln',
    certificateSerialNumber: '1234567890',
    signaturePreviousReceipt: 'c2lnLXByZXY=',
    turnoverCounterAES256ICM: 'dW1zYXR6emFlaGxlcg==',
    paymentMethod: 'cash',
    items: [{ name: 'Kaffee', quantity: 2, unitPriceCents: 350, vatRate: 10 }],
    vouchers: [{ name: 'Weihnachten', code: 'XMAS', action: 'sell', type: 'value', value: 5, valueCents: 500 }],
    timeStamp: '2026-08-13T10:00:00',
    cashregisterId: 'cr1',
    receiptType: 'standard',
    receiptId: 'r1',
    fullReceiptId: 'AT1-r1',
    creditCardProvider: null,
    cardPaymentId: null,
    cardPaymentData: null,
    customerDetails: 'Mustermann GmbH\nHauptstrasse 1',
    legalMessage: 'Dieser Beleg dient als Zahlungsbeleg.',
    signatureSuccess: true,
    customProjectId: null,
  };
  const beleg = fromReceiptPayload(payload);
  assert.equal(beleg.receiptId, 'r1');
  assert.equal(beleg.cashregisterId, 'cr1');
  assert.equal(beleg.timeStamp, '2026-08-13T10:00:00');
  assert.deepEqual(beleg.items, [{ name: 'Kaffee', quantity: 2, vat: VatRate.vat10, priceCents: 350 }]);
  assert.deepEqual(beleg.vouchers, [{ name: 'Weihnachten', code: 'XMAS', action: VoucherAction.sell, type: VoucherType.value, valueCents: 500 }]);
  assert.equal(beleg.paymentMethod, KeckPaymentMethod.cash);
  assert.equal(beleg.turnoverCounterAES256ICM, 'dW1zYXR6emFlaGxlcg==');
  assert.equal(beleg.signaturePreviousReceipt, 'c2lnLXByZXY=');
  assert.equal(beleg.certificateSerialNumber, '1234567890');
  assert.equal(beleg.receiptType, ReceiptType.standard);
  assert.equal(beleg.sig, 'c2ln');
  assert.equal(beleg.qr, 'https://kasseneck.at/beleg/AT1-r1');
  assert.equal(beleg.fullReceiptId, 'AT1-r1');
  assert.equal(beleg.creditCardProvider, undefined);
  assert.equal(beleg.cardPaymentId, undefined);
  assert.equal(beleg.cardPaymentData, undefined);
  assert.deepEqual(beleg.customerDetails, ['Mustermann GmbH', 'Hauptstrasse 1']);
  assert.deepEqual(beleg.legalMessage, ['Dieser Beleg dient als Zahlungsbeleg.']);
  assert.equal(beleg.signatureSuccess, true);
  assert.equal(beleg.customProjectId, undefined);
});

// --- Kasse -----------------------------------------------------------------

test('Kasse: liest die woertliche Antwort von listMyCashregisters (Kassen-Benutzer)', () => {
  // Von Hand aus dem Antwortblock von `listMyCashregisters` in
  // functions/index.js (origin/main) abgeschrieben — nicht aus dieser
  // Umsetzung erzeugt. Fuer einen Kassen-Benutzer sendet das Backend `token`
  // ausdruecklich als null, und `aes_key` steht in dieser Antwort gar nicht.
  const payload: CashregisterPayload = {
    id: 'cr7',
    label: 'Schank',
    description: 'Kasse im Gastgarten',
    create_time: '2026-01-05T09:00:00.000Z',
    signature_id: 'sig-42',
    token: null,
    onboarding: {
      cashbox_registered: true,
      startbeleg_created: true,
      startbeleg_transmitted: false,
      cashbox_registered_at: '2026-01-05T09:05:00.000Z',
      startbeleg_created_at: '2026-01-05T09:06:00.000Z',
      startbeleg_transmitted_at: null,
    },
  };
  const kasse = fromCashregisterPayload(payload, 'ignoriert');
  assert.equal(kasse.id, 'cr7');
  assert.equal(kasse.label, 'Schank');
  assert.equal(kasse.description, 'Kasse im Gastgarten');
  assert.equal(kasse.createTime?.toISOString(), '2026-01-05T09:00:00.000Z');
  assert.equal(kasse.signatureId, 'sig-42');
  assert.equal(kasse.token, undefined, 'ein null-Token darf keine Zeichenkette werden');
  assert.deepEqual(kasse.onboarding, {
    cashboxRegistered: true,
    startbelegCreated: true,
    startbelegTransmitted: false,
    cashboxRegisteredAt: new Date('2026-01-05T09:05:00.000Z'),
    startbelegCreatedAt: new Date('2026-01-05T09:06:00.000Z'),
  });
});

test('Kasse: ein fehlender Zeitstempel wird nicht still zur Epoche', () => {
  // `isoTs` im Backend liefert null, wenn das Dokument keinen Zeitstempel
  // traegt. `new Date(null)` ergaebe den 1.1.1970 — ein erfundenes Datum, das
  // in einer Kassenliste als echtes Anlagedatum durchginge.
  const kasse = fromCashregisterPayload({ id: 'cr1', create_time: null, token: null }, 'cr1');
  assert.equal(kasse.createTime, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(kasse, 'createTime'), false);
  assert.equal(kasse.token, undefined);
  assert.deepEqual(kasse.onboarding, {
    cashboxRegistered: false,
    startbelegCreated: false,
    startbelegTransmitted: false,
  });
});

test('Kasse: der Kassen-Token kommt durch, wenn das Backend ihn sendet', () => {
  // Nur der api_key-Pfad bekommt ihn; fuer Kassen-Benutzer ist er null.
  const kasse = fromCashregisterPayload({ id: 'cr1', token: 'cb_live_ABC', create_time: null }, 'cr1');
  assert.equal(kasse.token, 'cb_live_ABC');
});

test('Kasse: ein unlesbarer Zeitstempel laesst die uebrigen Angaben stehen', () => {
  // Tolerante Leserichtung wie beim Enum-Lesen: eine Kassenliste darf nicht an
  // einem einzelnen kaputten Datum scheitern.
  const kasse = fromCashregisterPayload({ id: 'cr1', create_time: 'gestern frueh' }, 'cr1');
  assert.equal(kasse.createTime, undefined);
  assert.equal(kasse.id, 'cr1');
});

test('Kasse: ein offsetloser Zeitstempel gilt als Wiener Wanduhrzeit', () => {
  // Nicht `new Date(text)`: das deutete ihn als lokale Zeit des ausfuehrenden
  // Rechners. 09:00 Wiener Winterzeit sind 08:00 UTC.
  const kasse = fromCashregisterPayload({ id: 'cr1', create_time: '2026-01-05T09:00:00' }, 'cr1');
  assert.equal(kasse.createTime?.toISOString(), '2026-01-05T08:00:00.000Z');
});

// --- Belegzeile der Liste ----------------------------------------------------

test('Belegzeile: liest die woertliche Antwort von listMyReceipts', () => {
  // Von Hand aus `projectReceiptForCustomer` in functions/index.js
  // (origin/main) abgeschrieben.
  const zeile = fromReceiptSummaryPayload({
    receiptId: 'r-9',
    counter: 42,
    receiptType: 'standard',
    timeStamp: '2026-08-13T10:15:00',
    total: 19.9,
    paymentMethod: 'cash',
    transmission_status: 'success',
    ts_transmission: '2026-08-13T10:16:00',
    signature_ok: true,
  });
  assert.equal(zeile.receiptId, 'r-9');
  assert.equal(zeile.counter, 42);
  assert.equal(zeile.receiptType, ReceiptType.standard);
  assert.equal(zeile.timeStamp, '2026-08-13T10:15:00');
  // Euro der Antwort, ganze Cent im Modell — und 19.9 * 100 ist in
  // Gleitkomma 1989.9999999999998, deshalb wird gerundet und nicht gekuerzt.
  assert.equal(zeile.totalCents, 1990);
  assert.equal(zeile.paymentMethod, KeckPaymentMethod.cash);
  assert.equal(zeile.transmissionStatus, 'success');
  assert.equal(zeile.transmissionTime, '2026-08-13T10:16:00');
  assert.equal(zeile.signatureOk, true);
});

test('Belegzeile: ein Storno behaelt sein Vorzeichen in ganzen Cent', () => {
  assert.equal(fromReceiptSummaryPayload({ total: -19.9 }).totalCents, -1990);
  // Von der Null weg runden — sonst heben sich Beleg und Storno nicht auf.
  assert.equal(fromReceiptSummaryPayload({ total: 0.005 }).totalCents, 1);
  assert.equal(fromReceiptSummaryPayload({ total: -0.005 }).totalCents, -1);
});

test('Belegzeile: unbekannte Schluessel bleiben roh, statt die Liste zu kippen', () => {
  const zeile = fromReceiptSummaryPayload({ receiptType: 'sonderbeleg', paymentMethod: 'klarna' });
  assert.equal(zeile.receiptType, 'sonderbeleg');
  assert.equal(zeile.paymentMethod, 'klarna');
});

test('Belegzeile: nur ein ausdrueckliches false heisst "Signatur ausgefallen"', () => {
  assert.equal(fromReceiptSummaryPayload({}).signatureOk, true);
  assert.equal(fromReceiptSummaryPayload({ signature_ok: false }).signatureOk, false);
});

// --- Berichtsmonat -----------------------------------------------------------

test('Berichtsmonat: Jaenner rueckwaerts wechselt ins Vorjahr auf Dezember', () => {
  const jaenner: ReportMonth = { month: 1, year: 2026 };
  assert.deepEqual(previousReportMonth(jaenner), { month: 12, year: 2025 });
});

test('Berichtsmonat: Dezember vorwaerts wechselt ins Folgejahr auf Jaenner', () => {
  const dezember: ReportMonth = { month: 12, year: 2026 };
  assert.deepEqual(nextReportMonth(dezember), { month: 1, year: 2027 });
});

test('Berichtsmonat: Schluessel- und Lesbar-Format stimmen mit dem Flutter-Paket ueberein', () => {
  const rm: ReportMonth = { month: 3, year: 2026 };
  assert.equal(reportMonthKey(rm), 'march_2026');
  assert.equal(reportMonthReadable(rm), 'März 2026');
});

test('Berichtsmonat: aus Datum abgeleitet trifft Monat und Jahr', () => {
  assert.deepEqual(reportMonthFromDate(new Date(2026, 7, 13)), { month: 8, year: 2026 });
});

test('Berichtsmonat: ein Zeitpunkt wird nach Wiener Zeit eingeordnet, nicht nach Rechnerzeit', () => {
  // 28.02. 23:30 UTC ist in Wien bereits der 01.03. 00:30 (Winterzeit, +1) —
  // der Berichtsmonat ist Maerz. Mit den eingebauten getMonth()/getFullYear()
  // waere es auf einer UTC-Maschine Februar, und der Monatsbericht liefe auf
  // den falschen Monat.
  assert.deepEqual(reportMonthFromDate(new Date('2026-02-28T23:30:00Z')), { month: 3, year: 2026 });
  // Dasselbe im Sommer (+2): 31.07. 22:30 UTC ist in Wien der 01.08. 00:30.
  assert.deepEqual(reportMonthFromDate(new Date('2026-07-31T22:30:00Z')), { month: 8, year: 2026 });
  // Und die Gegenrichtung: 01.03. 00:30 UTC ist in Wien 01:30 desselben Tages.
  assert.deepEqual(reportMonthFromDate(new Date('2026-03-01T00:30:00Z')), { month: 3, year: 2026 });
});

// --- Stripe-Sitzung ----------------------------------------------------------

test('Stripe-Sitzung: Nutzlast hin und zurueck ergibt denselben Wert', () => {
  const session: StripeUrlSession = {
    id: 'sess_1',
    url: 'https://checkout.stripe.com/pay/sess_1',
    shortenUrl: 'https://kasseneck.at/s/abc',
    expiresAt: new Date('2026-08-14T00:00:00.000Z'),
  };
  const payload = toStripeUrlSessionPayload(session);
  assert.deepEqual(payload, {
    id: 'sess_1',
    url: 'https://checkout.stripe.com/pay/sess_1',
    shorten_payment_url: 'https://kasseneck.at/s/abc',
    expires_at: '2026-08-14T00:00:00.000Z',
  });
  assert.deepEqual(fromStripeUrlSessionPayload(payload), session);
});

// --- Hobex-Beleg ---------------------------------------------------------------

test('Hobex-Beleg: Nutzlast hin und zurueck ergibt denselben Wert', () => {
  const beleg: HobexReceipt = {
    transactionId: 'tx1',
    tid: 't1',
    receipt: '000123',
    approvalCode: '00',
    reference: undefined,
    transactionDate: '2026-08-13 10:00:00',
    cardNumber: '****1234',
    cardExpiry: '12/28',
    brand: 'visa',
    cardIssuer: 'Bank',
    responseCode: '00',
    transactionType: 'purchase',
    currency: 'EUR',
    amountCents: 1999,
    tipCents: 150,
    cvm: '0',
    creditCardProvider: CreditCardProvider.hobexCloudApi,
  };
  const payload = toHobexReceiptPayload(beleg);
  assert.equal(payload.amount, 19.99);
  assert.equal(payload.tip, 1.5);
  assert.deepEqual(fromHobexReceiptPayload(payload), beleg);
});

test('Hobex-Beleg: Transaktionsdatum wird wie im Flutter-Paket normalisiert (Bruchteil + T entfernt)', () => {
  const payload = {
    transactionId: 'tx1',
    tid: 't1',
    receipt: '000123',
    approvalCode: '00',
    reference: null,
    transactionDate: '2026-08-13T10:00:00.123+02:00',
    cardNumber: '****1234',
    cardExpiry: '12/28',
    brand: 'visa',
    cardIssuer: 'Bank',
    responseCode: '00',
    transactionType: 'purchase',
    currency: 'EUR',
    amount: 19.99,
    tip: 0,
    cvm: 0,
  };
  const beleg = fromHobexReceiptPayload(payload);
  assert.equal(beleg.transactionDate, '2026-08-13 10:00:00');
  assert.equal(beleg.cvm, '0');
});

test('Hobex-Beleg: toCardPaymentData liefert die vom Beleg-Rendering erwarteten Schluessel', () => {
  const beleg: HobexReceipt = {
    transactionId: 'tx1',
    tid: 't1',
    receipt: '000123',
    approvalCode: '00',
    reference: undefined,
    transactionDate: '2026-08-13 10:00:00',
    cardNumber: '****1234',
    cardExpiry: '12/28',
    brand: 'visa',
    cardIssuer: 'Bank',
    responseCode: '00',
    transactionType: 'purchase',
    currency: 'EUR',
    amountCents: 1999,
    tipCents: 0,
    cvm: '1',
    creditCardProvider: CreditCardProvider.hobexCloudApi,
  };
  const data = hobexReceiptToCardPaymentData(beleg);
  assert.deepEqual(data, {
    transactionId: 'tx1',
    date: '2026-08-13 10:00:00',
    tid: 't1',
    no: '000123',
    type: 'purchase',
    cardBrand: 'visa',
    cardNumber: '****1234',
    responseCode: '00',
    cvm: '1',
  });
  assert.equal(hobexReceiptNeedsSignature(beleg), true);
});

test('Berichtsmonat: ein unbrauchbarer Zeitpunkt wirft statt NaN zu liefern', () => {
  // Ein NaN-Berichtsmonat wanderte sonst ungebremst in die Monatsberichtslogik
  // des Aufrufers und faellt dort erst viel spaeter auf.
  assert.throws(() => reportMonthFromDate(new Date(NaN)), /Zeitpunkt/);
});

// --- Geld-Grenze ------------------------------------------------------------

test('Geld: Euro der Antwort werden von der Null weg auf ganze Cent gerundet', () => {
  // Die Regel steht seit dem Zusammenziehen an genau einer Stelle (src/money.ts)
  // und gilt damit fuer die Belegzeile wie fuer die Kennzahlen der Liste.
  assert.equal(euroToCents(19.9), 1990);
  assert.equal(euroToCents(-19.9), -1990);
  // Von der Null weg — mit Math.round allein ergaebe -0.005 hier -0.
  assert.equal(euroToCents(0.005), 1);
  assert.equal(euroToCents(-0.005), -1);
  assert.equal(euroToCents(0), 0);
});

test('Geld: ein unbrauchbarer Betrag ergibt 0, statt die Liste zu kippen', () => {
  for (const wert of [null, undefined, 'zehn', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(euroToCents(wert), 0, `${String(wert)} muss 0 ergeben`);
  }
});

test('Geld: Cent -> Euro ist die Gegenrichtung fuer fremde Schnittstellen', () => {
  assert.equal(centsToEuro(1990), 19.9);
  assert.equal(centsToEuro(0), 0);
  assert.equal(centsToEuro(-250), -2.5);
});
