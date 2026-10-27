import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  VOUCHER_SETTINGS_DEFAULTS, VOUCHER_TYPE_KINDS, VOUCHER_AMOUNT_MODES, VOUCHER_TYPE_VALIDITY_PATTERNS, VOUCHER_PAYOUTS,
  posVoucherSettingsFromWire, checkVoucher, fromPosArticlePayload, labelText, messageText, voucherErrorMessage, sanitizePosSettings,
  type PosVoucherType,
} from '../src/pos/index.js';
import * as stored from '../src/stored/index.js';
import { receiptDueBreakdown, receiptDueCents, ReceiptDueError, type ReceiptDueOptions, type VoucherDueType } from '../src/receipt/due.js';
import { createReceiptParams } from '../src/client/receipts.js';
import { fromVoucherPayload, toVoucherPayload, voucherIsValid, isNewFormVoucher, type Voucher } from '../src/models/index.js';
import { createTransport, type FetchLike, type HttpRequestInit, type HttpResponseLike } from '../src/client/transport.js';
import { registerUserAuth } from '../src/client/auth.js';
import { isKasseneckValidationError } from '../src/client/errors.js';

/*
 * Gutscheine Stufe 4b: Gutschein-Sorten an der Kasse. Die Kasse bekommt die
 * verkaufbaren Sorten aus `getKasseSettings` (`vouchers.types[]`), verkauft
 * einen Wertgutschein nur noch ueber eine Sorte (`typeId`) und rechnet den
 * Zahlbetrag mit Art und Satz der Sorte. Spec 2026-10-26-gutscheine-stufe4b
 * im Backend („Alte Clients“, „Kasse“, Nachtrag E1/E2).
 */

type Json = Record<string, any>;
const lies = (datei: string): Json => JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/v3/${datei}`, import.meta.url)), 'utf8')) as Json;
const KASSE = lies('antworten/kasse.json').endpoints as Record<string, { cases: Json[] }>;
const VOKABULAR = lies('v3-vokabular.json');
const fall = (endpunkt: string, name: string): Json => {
  const f = KASSE[endpunkt]!.cases.find((c) => c.case === name);
  assert.ok(f, `${endpunkt}/${name} fehlt im Vertrag`);
  return f;
};

/** Eine stimmige Sorte in der Drahtform; `aendern` setzt einzelne Felder (undefined loescht). */
function sorte(aendern: Json = {}): Json {
  const s: Json = {
    id: 'vt_geschenk', name: 'Geschenkgutschein', kind: 'multi_purpose', vatRateBp: null, amount: { mode: 'free' },
    validity: { pattern: 'unlimited' }, payout: 'allowed',
    label: { layout: 'a', size: '40x30', fields: { qr: true, value: true, designation: true }, freeText: [] },
    order: 0, active: true, soldCount: 0,
  };
  for (const [k, w] of Object.entries(aendern)) {
    if (w === undefined) delete s[k];
    else s[k] = w;
  }
  return s;
}
const STANDARD = { layout: 'a', size: '40x30', fields: { logo: true, qr: true, business: true, value: true, validity: true, checkPage: true, designation: true }, freeText: [] };
const block = (aendern: Json = {}): Json => ({
  sale: false, typeSale: true, valueVoucherType: null, vatRateBp: null, labelDefault: STANDARD, types: [sorte()], serviceArticles: false, ...aendern,
});

// --- Einstellungen: Block vouchers -----------------------------------------------

test('Sorten: der Vertragsfall owner_with_voucher_type liest jede Sorte mit allen Feldern', () => {
  const draht = fall('getKasseSettings', 'owner_with_voucher_type').response.data.vouchers;
  const s = posVoucherSettingsFromWire(draht);
  assert.equal(s.sale, false);
  assert.equal(s.typeSale, false);
  assert.equal(s.serviceArticles, false);
  assert.deepEqual(s.labelDefault, draht.labelDefault);
  assert.equal(s.types!.length, 1);
  const t: PosVoucherType = s.types![0]!;
  assert.deepEqual(t, {
    id: 'sorte_geschenk50', name: 'Geschenkgutschein 50 €', kind: 'single_purpose', vatRateBp: 2000,
    amount: { mode: 'fixed', cents: 5000 }, validity: { pattern: 'years', years: 3 }, payout: 'allowed',
    label: draht.types[0].label, order: 0, active: true, soldCount: 2,
  });
  // Eine Kopie, kein Verweis auf die Antwort.
  assert.notEqual(t.label, draht.types[0].label);
  assert.notEqual(s.labelDefault, draht.labelDefault);
});

test('Sorten: ein Block eines aelteren Servers (nur sale, Art, Satz) liest die neuen Felder als aus', () => {
  const s = posVoucherSettingsFromWire({ sale: true, valueVoucherType: 'single_purpose', vatRateBp: 2000 });
  assert.deepEqual(s, { sale: true, valueVoucherType: 'single_purpose', vatRateBp: 2000, typeSale: false, types: [], serviceArticles: false, labelDefault: null });
});

test('Sorten: stimmiger Block mit Sorten geht durch (Mehrzweck ohne Satz, freier Betrag, unbefristet)', () => {
  const b = block();
  assert.deepEqual(posVoucherSettingsFromWire(b), b);
  // Einzweck mit Satz, Fixbetrag, Jahre, Auszahlung nie nur unbefristet.
  const einzweck = block({ types: [sorte({ kind: 'single_purpose', vatRateBp: 1000, amount: { mode: 'fixed', cents: 2000 }, validity: { pattern: 'years', years: 1 } })] });
  assert.deepEqual(posVoucherSettingsFromWire(einzweck), einzweck);
  const nie = block({ types: [sorte({ payout: 'never' })] });
  assert.deepEqual(posVoucherSettingsFromWire(nie), nie);
});

test('Sorten: eine unstimmige Sorte faellt weg, die anderen bleiben (geschlossen im Zweifel)', () => {
  const kaputt: unknown[] = [
    sorte({ id: undefined }), sorte({ id: '' }), sorte({ id: '__intern__' }), sorte({ id: 'a b' }), sorte({ id: 7 }),
    sorte({ name: undefined }), sorte({ name: '  ' }), sorte({ name: 5 }),
    sorte({ kind: 'service' }), sorte({ kind: 'promotion' }), sorte({ kind: 'mehrzweck' }),
    sorte({ vatRateBp: 2000 }),
    sorte({ kind: 'single_purpose', vatRateBp: null }), sorte({ kind: 'single_purpose', vatRateBp: 0 }), sorte({ kind: 'single_purpose', vatRateBp: 10.5 }),
    sorte({ amount: undefined }), sorte({ amount: { mode: 'fix', cents: 100 } }), sorte({ amount: { mode: 'fixed' } }),
    sorte({ amount: { mode: 'fixed', cents: 0 } }), sorte({ amount: { mode: 'fixed', cents: 99 } }), sorte({ amount: { mode: 'fixed', cents: 1_000_001 } }),
    sorte({ amount: { mode: 'fixed', cents: 120.5 } }),
    sorte({ validity: undefined }), sorte({ validity: { pattern: '1+3' } }), sorte({ validity: { pattern: 'years' } }),
    sorte({ validity: { pattern: 'years', years: 0 } }), sorte({ validity: { pattern: 'years', years: 31 } }), sorte({ validity: { pattern: 'years', years: 2.5 } }),
    sorte({ payout: undefined }), sorte({ payout: 'sometimes' }),
    // Auszahlung nie nur zusammen mit unbefristet (Regel des Servers).
    sorte({ payout: 'never', validity: { pattern: 'years', years: 2 } }),
    sorte({ order: 1.5 }), sorte({ order: '1' }),
    sorte({ active: false }), sorte({ active: undefined }),
    sorte({ soldCount: -1 }), sorte({ soldCount: 'viele' }),
    'sorte', null, [], 3,
  ];
  for (const k of kaputt) {
    const gut = sorte({ id: 'vt_gut' });
    const s = posVoucherSettingsFromWire(block({ types: [k, gut] }));
    assert.deepEqual(s.types, [gut], JSON.stringify(k));
    assert.equal(s.typeSale, true, JSON.stringify(k));
  }
});

test('Sorten: fehlende Reihenfolge oder Verkaufszahl gelten als 0, eine unbrauchbare Vorlage als keine', () => {
  const s = posVoucherSettingsFromWire(block({ types: [sorte({ order: undefined, soldCount: undefined, label: 'gross' })] }));
  assert.equal(s.types!.length, 1);
  assert.equal(s.types![0]!.order, 0);
  assert.equal(s.types![0]!.soldCount, 0);
  assert.equal(s.types![0]!.label, null);
  for (const vorlage of [undefined, null, [], { size: 40, layout: 'a' }, { size: '40x30' }]) {
    assert.equal(posVoucherSettingsFromWire(block({ types: [sorte({ label: vorlage })] })).types![0]!.label, null, JSON.stringify(vorlage));
  }
});

test('Sorten: dieselbe Kennung zweimal – die erste gilt', () => {
  const erste = sorte({ name: 'Erste' });
  const s = posVoucherSettingsFromWire(block({ types: [erste, sorte({ name: 'Zweite' })] }));
  assert.deepEqual(s.types, [erste]);
});

test('Sorten: typeSale nur mit einer verkaufbaren Sorte oder freigegebenen Leistungsartikeln', () => {
  // Alle Sorten unstimmig und keine Leistung: kein Reiter.
  assert.equal(posVoucherSettingsFromWire(block({ types: [sorte({ kind: 'x' })] })).typeSale, false);
  assert.equal(posVoucherSettingsFromWire(block({ types: [] })).typeSale, false);
  // Nur Leistung: Reiter mit der festen Kachel.
  const leistung = posVoucherSettingsFromWire(block({ types: [], serviceArticles: true }));
  assert.equal(leistung.typeSale, true);
  assert.equal(leistung.serviceArticles, true);
  // Schalter aus: nie, auch mit Sorten.
  assert.equal(posVoucherSettingsFromWire(block({ typeSale: false })).typeSale, false);
});

test('Sorten: ein unstimmiges Feld des Blocks schliesst den ganzen Block', () => {
  const zu = { ...VOUCHER_SETTINGS_DEFAULTS, types: [] };
  for (const f of [block({ typeSale: 'ja' }), block({ types: 'alle' }), block({ types: { a: 1 } }), block({ serviceArticles: 1 }), block({ sale: 'nein' }), block({ valueVoucherType: 'x' })]) {
    assert.deepEqual(posVoucherSettingsFromWire(f), zu, JSON.stringify(f));
  }
  // Eine unbrauchbare Standardvorlage schliesst nicht: ein Verkauf scheitert nie an der Vorlage.
  const ohneVorlage = posVoucherSettingsFromWire(block({ labelDefault: 'standard' }));
  assert.equal(ohneVorlage.labelDefault, null);
  assert.equal(ohneVorlage.typeSale, true);
  assert.equal(ohneVorlage.types!.length, 1);
});

test('Sorten: ein gelesener Block liest sich wieder gleich (Kassen legen den Stand ab und lesen ihn mit sanitizePosSettings)', () => {
  for (const b of [
    fall('getKasseSettings', 'owner_with_voucher_type').response.data.vouchers,
    block({ types: [sorte({ label: undefined, order: undefined, soldCount: undefined })], labelDefault: undefined }),
    { sale: false, valueVoucherType: null, vatRateBp: null },
  ]) {
    const einmal = posVoucherSettingsFromWire(b);
    assert.deepEqual(posVoucherSettingsFromWire(JSON.parse(JSON.stringify(einmal))), einmal);
    assert.deepEqual(sanitizePosSettings({ business: {}, device: {}, vouchers: einmal }).vouchers, einmal);
  }
});

test('Sorten: das alte Feld label (Kassen vor 1.15) liest das Paket nicht', () => {
  const draht = fall('getKasseSettings', 'owner').response.data.vouchers;
  assert.ok(draht.label, 'der Vertrag traegt das alte Feld');
  assert.equal('label' in posVoucherSettingsFromWire(draht), false);
});

test('Sorten: die Wertemengen der Sorte sind die Kataloge des Vokabulars', () => {
  const katalog = (name: string) => Object.values(VOKABULAR.catalogs[name] as Record<string, string>);
  // Eine Sorte ist Mehrzweck oder Einzweck; Leistung und Aktion sind keine Sorte.
  for (const k of VOUCHER_TYPE_KINDS) assert.ok(katalog('GUTSCHEIN_ART').includes(k), k);
  assert.deepEqual([...VOUCHER_TYPE_KINDS], ['multi_purpose', 'single_purpose']);
  assert.deepEqual([...VOUCHER_AMOUNT_MODES], katalog('GUTSCHEIN_BETRAG_MODUS'));
  assert.deepEqual([...VOUCHER_TYPE_VALIDITY_PATTERNS], katalog('GUTSCHEIN_SORTE_MUSTER'));
  assert.deepEqual([...VOUCHER_PAYOUTS], katalog('GUTSCHEIN_AUSZAHLUNG'));
});

// --- Gutschein pruefen: Sortenname, Auszahlung, Jahre ------------------------------

function antwortMit(data: Json): FetchLike {
  const rumpf = JSON.stringify({ status: 'success', message: '', data });
  return async (_url: string, _init: HttpRequestInit): Promise<HttpResponseLike> => ({
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : n.toLowerCase() === 'kasseneck-api-version' ? 'v3' : null) },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer as ArrayBuffer,
  });
}
const kasse = (data: Json) => createTransport({ auth: registerUserAuth({ getIdToken: () => 'eyJ-ID', getSessionId: () => 'sess-1', cashregisterId: 'KASSE1' }), fetch: antwortMit(data), timeoutMs: 50 });
const PRUEFUNG = fall('checkVoucher', 'success_cashier').response.data;

test('checkVoucher: Sortenname, Auszahlung und Jahre einer Sorte werden gelesen', async () => {
  const v = await checkVoucher(kasse({
    ...PRUEFUNG, typeName: 'Geschenkgutschein', payout: 'never',
    validity: { pattern: 'custom', redeemableYears: 3, redeemableUntil: '2029-09-20', refundableUntil: '2032-09-20', validUntil: null },
  }), 'B1KK5EQ57DHP');
  assert.equal(v.typeName, 'Geschenkgutschein');
  assert.equal(v.payout, 'never');
  assert.deepEqual(v.validity, { pattern: 'custom', redeemableYears: 3, redeemableUntil: '2029-09-20', refundableUntil: '2032-09-20' });
  // Ein Gutschein ohne Sorte (Stufe 4 und aelter): die Felder fehlen.
  const alt = await checkVoucher(kasse(PRUEFUNG), 'B1KK5EQ57DHP');
  assert.equal('typeName' in alt, false);
  assert.equal('payout' in alt, false);
  assert.equal('redeemableYears' in alt.validity!, false);
});

test('checkVoucher: eine unbekannte Auszahlungs-Angabe gilt als never, ein kaputtes Feld ist ein Lesefehler', async () => {
  for (const wert of ['sometimes', 1, true]) {
    assert.equal((await checkVoucher(kasse({ ...PRUEFUNG, payout: wert }), 'B1KK5EQ57DHP')).payout, 'never', String(wert));
  }
  assert.equal((await checkVoucher(kasse({ ...PRUEFUNG, payout: 'allowed' }), 'B1KK5EQ57DHP')).payout, 'allowed');
  for (const data of [
    { ...PRUEFUNG, typeName: 5 },
    { ...PRUEFUNG, typeName: '' },
    { ...PRUEFUNG, validity: { ...PRUEFUNG.validity, redeemableYears: 2.5 } },
    { ...PRUEFUNG, validity: { ...PRUEFUNG.validity, redeemableYears: 0 } },
    { ...PRUEFUNG, validity: { ...PRUEFUNG.validity, redeemableYears: '3' } },
  ]) {
    await assert.rejects(checkVoucher(kasse(data), 'B1KK5EQ57DHP'), (e: unknown) => isKasseneckValidationError(e), JSON.stringify(data));
  }
  // Das neue innere Muster `years` geht nie hinaus (E1): es bleibt ein Lesefehler.
  await assert.rejects(checkVoucher(kasse({ ...PRUEFUNG, validity: { pattern: 'years', redeemableYears: 3 } }), 'B1KK5EQ57DHP'), (e: unknown) => isKasseneckValidationError(e));
});

// --- Artikel als Leistungsgutschein ------------------------------------------------

test('Artikel: serviceVoucher nur bei true, sonst false (auch aus dem gespeicherten Dokument)', () => {
  assert.equal(fromPosArticlePayload({ id: 'a', name: 'Maniküre', serviceVoucher: true }).serviceVoucher, true);
  for (const w of [undefined, null, false, 'true', 1]) {
    assert.equal(fromPosArticlePayload({ id: 'a', name: 'Maniküre', serviceVoucher: w as never }).serviceVoucher, false, String(w));
  }
  assert.equal(stored.fromStoredArticle('art_mani', { name: 'Maniküre', price: 35, vatRate: 20, active: true, gutscheinLeistung: true }).serviceVoucher, true);
  assert.equal(stored.fromStoredArticle('art_mani', { name: 'Maniküre', price: 35, vatRate: 20, active: true }).serviceVoucher, false);
});

// --- Wunsch: Verkauf ueber eine Sorte ----------------------------------------------

const ZAHLUNG = [{ method: 'cash', amountCents: 5000 }] as never;
const v = (o: Json): Voucher => o as Voucher;

test('Wunsch: ein Wertgutschein geht mit typeId hinaus, mit oder ohne Art', () => {
  for (const wunsch of [
    { action: 'sell', type: 'multi_purpose', typeId: 'vt_geschenk', amountCents: 5000 },
    { action: 'sell', typeId: 'vt_geschenk', amountCents: 5000 },
  ]) {
    assert.ok(isNewFormVoucher(v(wunsch)), JSON.stringify(wunsch));
    assert.ok(voucherIsValid(v(wunsch)), JSON.stringify(wunsch));
    const p = createReceiptParams({ receiptType: 'standard', items: [], vouchers: [v(wunsch)], payments: ZAHLUNG });
    assert.deepEqual(p['vouchers'], [wunsch]);
    // Lesen und wieder schreiben: dieselbe Form (die Art bleibt weg, wenn sie fehlte).
    assert.deepEqual(toVoucherPayload(fromVoucherPayload(wunsch as never)), wunsch);
  }
});

test('Wunsch: ein Wertgutschein ohne Sorte geht nicht hinaus (voucher_type_required)', () => {
  for (const type of ['multi_purpose', 'single_purpose']) {
    const wunsch = v({ action: 'sell', type, amountCents: 5000 });
    assert.equal(voucherIsValid(wunsch), false, type);
    assert.throws(
      () => createReceiptParams({ receiptType: 'standard', items: [], vouchers: [wunsch], payments: ZAHLUNG }),
      (e: unknown) => isKasseneckValidationError(e) && /voucher_type_required/.test((e as Error).message),
      type,
    );
  }
});

test('Wunsch: typeId nur am Wert-Verkauf, in der Form des Servers; Sortenname und Auszahlung setzt nur der Server', () => {
  const schlecht = [
    { action: 'sell', typeId: '', amountCents: 100 },
    { action: 'sell', typeId: 'a b', amountCents: 100 },
    { action: 'sell', typeId: 'x'.repeat(129), amountCents: 100 },
    { action: 'sell', typeId: 7, amountCents: 100 },
    { action: 'sell', typeId: 'vt_1' },
    { action: 'sell', typeId: 'vt_1', amountCents: 0 },
    { action: 'sell', typeId: 'vt_1', type: 'service', articleId: 'a', quantity: 1 },
    { action: 'sell', typeId: 'vt_1', type: 'promotion' },
    { action: 'sell', typeId: 'vt_1', amountCents: 100, articleId: 'a' },
    { action: 'sell', typeId: 'vt_1', amountCents: 100, reason: 'x' },
    { action: 'redeem', type: 'multi_purpose', typeId: 'vt_1', code: 'C', amountCents: 1 },
    { action: 'payout', type: 'multi_purpose', typeId: 'vt_1', code: 'C', amountCents: 1, reason: 'x' },
    { action: 'sell', typeId: 'vt_1', amountCents: 100, typeName: 'Geschenkgutschein' },
    { action: 'sell', typeId: 'vt_1', amountCents: 100, payout: 'allowed' },
  ];
  for (const g of schlecht) assert.equal(voucherIsValid(v(g)), false, JSON.stringify(g));
  // Eine reservierte Kennung ist der Form nach gueltig; der Server kennt sie nicht (voucher_type_not_found).
  assert.ok(voucherIsValid(v({ action: 'sell', typeId: '__intern__', amountCents: 100 })));
  assert.ok(voucherIsValid(v({ action: 'sell', typeId: 'x'.repeat(128), amountCents: 100 })));
});

test('Wunsch: Sortenname und Auszahlung am Wunsch werden vor dem Senden abgewiesen', () => {
  for (const feld of [{ typeName: 'Geschenkgutschein' }, { payout: 'allowed' }]) {
    assert.throws(
      () => createReceiptParams({ receiptType: 'standard', items: [], vouchers: [v({ action: 'sell', typeId: 'vt_1', amountCents: 5000, ...feld })], payments: ZAHLUNG }),
      /voucher_invalid/,
    );
  }
});

test('Wunsch: eine Sorte an einem Altform-Gutschein geht nicht hinaus (der Server setzt sie nur selbst)', () => {
  const posi = [{ name: 'a', quantity: 1, priceCents: 100, vat: 20 } as never];
  for (const g of [{ action: 'sell', type: 'value', valueCents: 100, typeId: 'vt_1' }, { action: 'redeem', type: 'value', valueCents: 100, code: 'WG-1', typeId: 'vt_1' }]) {
    assert.throws(
      () => createReceiptParams({ receiptType: 'standard', items: posi, vouchers: [v(g)], payments: [{ method: 'cash', amountCents: 100 }] as never }),
      /voucher_invalid/,
      JSON.stringify(g),
    );
  }
  // Am gelesenen Beleg bleibt der Mehrzweck-Verkauf (type value) mit Sorte gueltig: er zaehlt im 0-%-Satz des Bons.
  assert.ok(voucherIsValid(v({ action: 'sell', type: 'value', valueCents: 5000, typeId: 'vt_mz', typeName: 'Geschenkgutschein', payout: 'allowed', voucherId: 'g1', codeSuffix: 'NNNY' })));
});

test('Beleg lesen: Sorte, Sortenname und Auszahlung am Eintrag bleiben erhalten und schreiben sich zurueck', () => {
  const eintrag = {
    action: 'sell', type: 'value', voucherType: 'multi_purpose', value: 50, valueCents: 5000, name: 'Geschenkgutschein (Mehrzweckgutschein)',
    typeId: 'vt_mz', typeName: 'Geschenkgutschein', payout: 'allowed', code: '····-····-NNNY', codeSuffix: 'NNNY', voucherId: 'auto4',
  };
  const g = fromVoucherPayload(eintrag as never);
  assert.equal(g.typeId, 'vt_mz');
  assert.equal(g.typeName, 'Geschenkgutschein');
  assert.equal(g.payout, 'allowed');
  const zurueck = toVoucherPayload(g) as unknown as Json;
  for (const k of ['typeId', 'typeName', 'payout']) assert.equal(zurueck[k], eintrag[k as keyof typeof eintrag], k);
  // Ein Altbeleg ohne Sorte bleibt schlank.
  const alt = fromVoucherPayload({ action: 'redeem', type: 'value', valueCents: 500, code: 'WG-1' } as never);
  for (const k of ['typeId', 'typeName', 'payout']) assert.equal(k in alt, false, k);
});

// --- Zahlbetrag: Art und Satz aus der Sorte ----------------------------------------

const LEER = { amountRateStandard: 0, amountRateReduced1: 0, amountRateReduced2: 0, amountRateZero: 0, amountRateSpecial: 0, amountRatOthers: 0 };
const toepfe = (werte: Partial<typeof LEER>) => ({ ...LEER, ...werte });
const MEHRZWECK: VoucherDueType = { id: 'vt_mz', kind: 'multi_purpose', vatRateBp: null, amount: { mode: 'free' } };
const EINZWECK: VoucherDueType = { id: 'vt_ez10', kind: 'single_purpose', vatRateBp: 1000, amount: { mode: 'free' } };
const FIX: VoucherDueType = { id: 'vt_fix50', kind: 'single_purpose', vatRateBp: 2000, amount: { mode: 'fixed', cents: 5000 } };
const SORTEN: ReceiptDueOptions = { voucherTypes: [MEHRZWECK, EINZWECK, FIX] };

function wirft(f: () => unknown, code: string): void {
  assert.throws(f, (e: unknown) => {
    assert.ok(e instanceof ReceiptDueError, String(e));
    assert.equal(e.reason, 'invalid_voucher');
    assert.equal(e.voucherErrorCode, code);
    return true;
  });
}

test('Zahlbetrag: Mehrzweck-Sorte verkauft als Wertgutschein-Fluss (vor dem Stichtag), ab dem Stichtag im 0-%-Topf', () => {
  for (const wunsch of [v({ action: 'sell', typeId: 'vt_mz', amountCents: 5000 }), v({ action: 'sell', type: 'multi_purpose', typeId: 'vt_mz', amountCents: 5000 })]) {
    assert.deepEqual(receiptDueBreakdown([], [wunsch], 'standard', SORTEN), {
      dueCents: 5000, counterDeltaCents: 0, valueVoucherFlowCents: 5000, bucketsCents: toepfe({}),
    });
    assert.deepEqual(receiptDueBreakdown([], [wunsch], 'standard', { ...SORTEN, zeroRateBucketFrom: '2026-10-01', today: '2026-10-27' }), {
      dueCents: 5000, counterDeltaCents: 5000, valueVoucherFlowCents: 0, bucketsCents: toepfe({ amountRateZero: 5000 }),
    });
  }
});

test('Zahlbetrag: Einzweck-Sorte als Position im Satz der Sorte, Kleinunternehmer zu 0 %', () => {
  const wunsch = v({ action: 'sell', typeId: 'vt_ez10', amountCents: 5000 });
  assert.deepEqual(receiptDueBreakdown([], [wunsch], 'standard', SORTEN), {
    dueCents: 5000, counterDeltaCents: 5000, valueVoucherFlowCents: 0, bucketsCents: toepfe({ amountRateReduced1: 5000 }),
  });
  assert.deepEqual(receiptDueBreakdown([], [wunsch], 'standard', { ...SORTEN, smallBusiness: true }).bucketsCents, toepfe({ amountRateZero: 5000 }));
  // Die Sorte entscheidet, nicht die alte Einstellung der Kasse.
  const alt: ReceiptDueOptions = { ...SORTEN, voucherSettings: { sale: true, valueVoucherType: 'multi_purpose', vatRateBp: null } };
  assert.deepEqual(receiptDueBreakdown([], [wunsch], 'standard', alt).bucketsCents, toepfe({ amountRateReduced1: 5000 }));
});

test('Zahlbetrag: Fixbetrag muss stimmen (voucher_amount_mismatch), die Art passt zur Sorte (voucher_invalid)', () => {
  assert.equal(receiptDueCents([], [v({ action: 'sell', typeId: 'vt_fix50', amountCents: 5000 })], 'standard', SORTEN), 5000);
  wirft(() => receiptDueCents([], [v({ action: 'sell', typeId: 'vt_fix50', amountCents: 4999 })], 'standard', SORTEN), 'voucher_amount_mismatch');
  wirft(() => receiptDueCents([], [v({ action: 'sell', type: 'multi_purpose', typeId: 'vt_ez10', amountCents: 5000 })], 'standard', SORTEN), 'voucher_invalid');
});

test('Zahlbetrag: eine unstimmige Sorte verkauft der Server nicht (voucher_type_not_found)', () => {
  const wunsch = v({ action: 'sell', typeId: 'vt_x', amountCents: 5000 });
  for (const t of [
    { id: 'vt_x', kind: 'single_purpose', vatRateBp: null, amount: { mode: 'free' } },
    { id: 'vt_x', kind: 'multi_purpose', vatRateBp: 2000, amount: { mode: 'free' } },
    { id: 'vt_x', kind: 'single_purpose', vatRateBp: 2000, amount: { mode: 'fixed', cents: 50 } },
    { id: 'vt_x', kind: 'service', vatRateBp: 2000, amount: { mode: 'free' } },
  ]) {
    wirft(() => receiptDueCents([], [wunsch], 'standard', { voucherTypes: [t as VoucherDueType] }), 'voucher_type_not_found');
  }
});

test('Zahlbetrag: eine Sorte, die die Kasse nicht hat, ist voucher_type_not_found', () => {
  wirft(() => receiptDueCents([], [v({ action: 'sell', typeId: 'vt_weg', amountCents: 5000 })], 'standard', SORTEN), 'voucher_type_not_found');
  wirft(() => receiptDueCents([], [v({ action: 'sell', typeId: 'vt_mz', amountCents: 5000 })], 'standard'), 'voucher_type_not_found');
  wirft(() => receiptDueCents([], [v({ action: 'sell', typeId: '__intern__', amountCents: 5000 })], 'standard', SORTEN), 'voucher_type_not_found');
});

test('Zahlbetrag: ein Wert-Verkauf ohne Sorte und ohne alte Einstellung ist voucher_type_required', () => {
  for (const type of ['multi_purpose', 'single_purpose']) {
    wirft(() => receiptDueCents([], [v({ action: 'sell', type, amountCents: 5000 })], 'standard', SORTEN), 'voucher_type_required');
    wirft(() => receiptDueCents([], [v({ action: 'sell', type, amountCents: 5000 })], 'standard'), 'voucher_type_required');
  }
});

test('Zahlbetrag: Aufrufer von 1.14 mit voucherSettings rechnen den Verkauf ohne Sorte wie bisher', () => {
  const wunsch = v({ action: 'sell', type: 'single_purpose', amountCents: 5000 });
  const o: ReceiptDueOptions = { voucherSettings: { sale: true, valueVoucherType: 'single_purpose', vatRateBp: 1000 } };
  assert.deepEqual(receiptDueBreakdown([], [wunsch], 'standard', o).bucketsCents, toepfe({ amountRateReduced1: 5000 }));
});

test('Zahlbetrag: Auszahlung eines Gutscheins mit Auszahlung nie ist voucher_payout_not_allowed', () => {
  const code = 'DTD1-NKT1-8CN5';
  const wunsch = v({ action: 'payout', type: 'multi_purpose', code, amountCents: 1000, reason: 'Kulanz' });
  const check = { type: 'multi_purpose' as const, status: 'active' as const, codeSuffix: '8CN5', balanceCents: 3000 };
  assert.equal(receiptDueCents([], [wunsch], 'standard', { voucherInfo: [{ code, check: { ...check, payout: 'allowed' } }] }), -1000);
  wirft(() => receiptDueCents([], [wunsch], 'standard', { voucherInfo: [{ code, check: { ...check, payout: 'never' } }] }), 'voucher_payout_not_allowed');
  // Auch abgelaufen: nie bleibt nie.
  wirft(() => receiptDueCents([], [wunsch], 'standard', { voucherInfo: [{ code, check: { ...check, status: 'expired', payout: 'never' } }] }), 'voucher_payout_not_allowed');
});

test('Zahlbetrag: ein Leistungsartikel ohne Freigabe ist voucher_service_not_allowed', () => {
  const wunsch = v({ action: 'sell', type: 'service', articleId: 'art_mani', quantity: 2 });
  const artikel = { id: 'art_mani', priceCents: 3500, vatRateBp: 2000 };
  assert.equal(receiptDueCents([], [wunsch], 'standard', { voucherArticles: [{ ...artikel, serviceVoucher: true }] }), 7000);
  // Ohne Angabe (Aufrufer von 1.14) rechnet das Paket wie bisher; der Server prueft den Haken selbst.
  assert.equal(receiptDueCents([], [wunsch], 'standard', { voucherArticles: [artikel] }), 7000);
  wirft(() => receiptDueCents([], [wunsch], 'standard', { voucherArticles: [{ ...artikel, serviceVoucher: false }] }), 'voucher_service_not_allowed');
});

// --- Woerter (Ruling R10) ------------------------------------------------------------

test('Woerter: Reiter, Kacheln und Fehlersaetze der Gutschein-Sorten mit genau diesem Text', () => {
  assert.equal(labelText('voucher.tab'), 'Gutscheine');
  assert.equal(labelText('voucher.enter_amount'), 'Betrag eingeben');
  assert.equal(labelText('voucher.service_tile'), 'Leistungsgutschein');
  assert.equal(labelText('voucher.kind_multi_short'), 'Mehrzweck');
  assert.equal(labelText('voucher.kind_single_short', { rate: '20' }), 'Einzweck 20 %');
  const saetze: Record<string, string> = {
    voucher_type_required: 'Bitte eine Gutschein-Sorte wählen.',
    voucher_type_not_found: 'Diese Gutschein-Sorte gibt es nicht mehr. Die Kasse lädt die Sorten neu.',
    voucher_amount_mismatch: 'Die Gutschein-Sorte hat sich geändert. Die Kasse lädt die Sorten neu.',
    voucher_service_not_allowed: 'Dieser Artikel ist nicht als Leistungsgutschein freigegeben.',
    voucher_payout_not_allowed: 'Dieser Gutschein kann nicht ausgezahlt werden.',
  };
  for (const [code, satz] of Object.entries(saetze)) {
    const key = voucherErrorMessage(code);
    assert.ok(key, code);
    assert.equal(key, `voucher_error.${code.replace(/^voucher_/, '')}`, code);
    assert.equal(messageText(key), satz, code);
  }
  // Codes nur des Kundenbereichs (Sorten pflegen) sind keine Kassen-Codes.
  for (const code of ['invalid_voucher_type', 'voucher_type_in_use', 'too_many_voucher_types']) assert.equal(voucherErrorMessage(code), undefined, code);
});
