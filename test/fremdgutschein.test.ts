import { readFileSync } from 'node:fs';
import { VoucherCode } from '@kreiseck/validator';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTERNAL_VOUCHER_VAT_RATES_BP, VOUCHER_SOURCES, checkExternalVoucherNumber, externalVoucherIsValid, fromVoucherPayload, isExternalVoucher,
  isNewFormVoucher, normalizeExternalVoucherNumber, toVoucherPayload, voucherIsValid, type Voucher,
} from '../src/models/index.js';
import { receiptDueBreakdown, ReceiptDueError, type ReceiptDueOptions } from '../src/receipt/due.js';
import { buildReceiptLayout, formatCents, type ReceiptLayout } from '../src/receipt/index.js';
import { createReceiptParams } from '../src/client/receipts.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import { fromStoredReceipt } from '../src/stored/index.js';
import { messageText, voucherErrorMessage } from '../src/pos/texte.js';
import { RECEIPT_WEBHOOK_EVENTS, parseInventoryWebhookEvent } from '../src/inventory/index.js';
import { fromReceiptPayload } from '../src/models/index.js';
import { pruefungAus } from './gutschein-setup.js';

/*
 * Fremdgutscheine (Server 2026-11, Spec 2026-11-06-fremdgutschein-design.md): Nummer, Form des Wunschs,
 * Zahlbetrag und Bon gegen die Pruefaelle des Backends (fixtures/stored/voucher-cases.json, byte-gleich
 * functions/test/unit/fixtures/gutschein-faelle.json), dazu die Beleg-Ereignisse der Konto-Webhooks.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const KATALOG = JSON.parse(readFileSync(new URL('../../fixtures/stored/voucher-cases.json', import.meta.url), 'utf8')) as {
  nulltopfAb: string;
  faelle: { name: string; eingabe: Json; erwartet: Json }[];
};

// ---- Nummer ----------------------------------------------------------------------

test('Fremdnummer: Rand weg (fester Leerraum-Satz, ohne NEL), keine Normalisierung, 1-40 aus A-Z a-z 0-9 - _ . /', () => {
  const n = normalizeExternalVoucherNumber;
  assert.equal(n('FG-1234'), 'FG-1234');
  assert.equal(n(' fg-1 '), 'fg-1');
  assert.equal(n(' FG-1'), 'FG-1');
  assert.equal(n('FG-1 '), 'FG-1');
  assert.equal(n('﻿FG-1'), 'FG-1');
  assert.equal(n('　FG-1 '), 'FG-1');
  assert.equal(n('\t\n\v\f\r       A_b.c/9  '), 'A_b.c/9');
  assert.equal(n('K'), 'K');
  assert.equal(n('FG-K1'), 'FG-K1');
  assert.equal(n('A'.repeat(40)), 'A'.repeat(40));
  for (const falsch of ['', '   ', 'A'.repeat(41), 'a b', 'ä', '<x>', 'FG-1\u0085', '\u0085FG-1', 'FG​1', 'ＦＧ-1', 'ä', null, 12, undefined]) {
    assert.equal(n(falsch), null, JSON.stringify(falsch));
  }
});

test('Fremdnummer: ein gueltiger eigener Gutscheincode (jede Schreibweise der Kasse) ist keine Fremdnummer, und das zuerst', () => {
  for (const c of ['7148FGQA935K', '7148-FGQA-935K', '7148 fgqa 935k', ' 7148-FGQA-935K ']) {
    assert.deepEqual(checkExternalVoucherNumber(c), { ok: false, code: 'external_voucher_number_is_own_code' }, c);
  }
  for (const c of ['K', 'FG-K1', 'FG-1234', '7148-FGQA-935J']) assert.equal(checkExternalVoucherNumber(c).ok, true, c);
  assert.deepEqual(checkExternalVoucherNumber(' fg-1 '), { ok: true, number: 'fg-1' });
  assert.deepEqual(checkExternalVoucherNumber(''), { ok: false, code: 'external_voucher_number_invalid' });
  assert.deepEqual(checkExternalVoucherNumber('FG-1\u0085'), { ok: false, code: 'external_voucher_number_invalid' });
});

// ---- Wunsch ------------------------------------------------------------------------

const mz = (extra: Partial<Voucher> = {}): Voucher => ({ source: 'external', action: 'redeem', type: 'multi_purpose', number: 'W-77', amountCents: 300, ...extra });
const ez = (extra: Partial<Voucher> = {}): Voucher => ({ source: 'external', action: 'redeem', type: 'single_purpose', number: 'FG-1234', amountCents: 2000, vatRateBp: 2000, ...extra });

test('Wunsch: Fremdgutscheine der Form des Servers sind sendbar, sonst nicht', () => {
  assert.deepEqual([...VOUCHER_SOURCES], ['external']);
  assert.deepEqual([...EXTERNAL_VOUCHER_VAT_RATES_BP].sort((a, b) => a - b), [0, 490, 1000, 1300, 1900, 2000]);
  const gut: Voucher[] = [
    mz(), mz({ action: 'sell' }), mz({ action: 'payout', reason: 'Kulanz' }),
    ez(), ez({ action: 'sell' }), ez({ taxedWith: 'FG-1234-V' }), ez({ vatRateBp: 0 }), ez({ vatRateBp: 490 }),
    ez({ action: 'payout', reason: 'Kulanz', taxedWith: 'X' }), mz({ number: ' fg-1 ' }), mz({ amountCents: 1_000_000 }),
  ];
  for (const v of gut) {
    assert.equal(isExternalVoucher(v), true);
    assert.equal(isNewFormVoucher(v), true);
    assert.equal(externalVoucherIsValid(v), true, JSON.stringify(v));
    assert.equal(voucherIsValid(v), true, JSON.stringify(v));
  }
  const schlecht: Voucher[] = [
    mz({ type: 'value' }), mz({ type: 'service' }), mz({ action: 'storno' }), mz({ number: '' }), mz({ number: 'a b' }), mz({ number: '7148-FGQA-935K' }),
    mz({ amountCents: 0 }), mz({ amountCents: 1_000_001 }), mz({ amountCents: 1.5 }), mz({ vatRateBp: 2000 }), mz({ taxedWith: 'X' }),
    mz({ code: 'GS-1' }), mz({ code: null as never }), mz({ typeId: 's1' }), mz({ articleId: 'a1' }), mz({ quantity: 1 }), mz({ positions: [0] }),
    mz({ valueCents: 300 }), mz({ voucherId: 'g1' }), mz({ codeSuffix: 'ABCD' }), mz({ balanceAfterCents: 0 }),
    mz({ action: 'payout' }), mz({ action: 'payout', reason: '  ' }), mz({ action: 'payout', reason: 'x'.repeat(201) }),
    ez({ vatRateBp: undefined }), ez({ vatRateBp: 700 }), ez({ vatRateBp: 2000.5 }),
    ez({ action: 'sell', taxedWith: 'X' }), ez({ taxedWith: '' }), ez({ taxedWith: 'x'.repeat(41) }), ez({ taxedWith: 'a\u0007b' }),
  ];
  for (const v of schlecht) assert.equal(voucherIsValid(v), false, JSON.stringify(v));
});

test('Wunsch: Felder nur des Fremdgutscheins an einem eigenen Wunsch sind ungueltig, auch als null (wie der Server)', () => {
  const eigen: Voucher = { action: 'redeem', type: 'multi_purpose', code: '7148-FGQA-935K', amountCents: 500 };
  assert.equal(voucherIsValid(eigen), true);
  for (const feld of ['number', 'taxedWith', 'vatRateBp', 'source'] as const) {
    for (const wert of ['FG-1', null]) assert.equal(voucherIsValid({ ...eigen, [feld]: wert } as Voucher), false, `${feld}=${wert}`);
  }
});

test('Wunsch: geht mit source und number hinaus, ohne valueCents, und liest sich so zurueck', () => {
  const p = toVoucherPayload(ez({ taxedWith: 'FG-1234-V' }));
  assert.deepEqual(p, { action: 'redeem', type: 'single_purpose', source: 'external', number: 'FG-1234', amountCents: 2000, vatRateBp: 2000, taxedWith: 'FG-1234-V' });
  assert.deepEqual(fromVoucherPayload(p), { name: undefined, code: undefined, valueCents: undefined, ...p });
  const params = createReceiptParams({ receiptType: 'standard', items: [{ name: 'Bier', quantity: 1, priceCents: 450, vat: 20 }], vouchers: [mz()], payments: [{ method: 'cash', amountCents: 150 }] } as never);
  assert.deepEqual(params['vouchers'], [{ action: 'redeem', type: 'multi_purpose', source: 'external', number: 'W-77', amountCents: 300 }]);
  // Ein Fremdgutschein-Verkauf braucht keine Sorte (kein voucher_type_required) und keine Positionen.
  const verkauf = createReceiptParams({ receiptType: 'standard', items: [], vouchers: [mz({ action: 'sell', amountCents: 3000 })], payments: [{ method: 'cash', amountCents: 3000 }] } as never);
  assert.deepEqual(verkauf['items'], []);
  assert.throws(() => createReceiptParams({ receiptType: 'standard', items: [], vouchers: [mz({ action: 'sell', number: 'a b' })], payments: [] } as never), isKasseneckValidationError);
});

test('Texte: jeder Code der Fremdgutscheine hat einen Satz (Woerter des Backends)', () => {
  const erwartet: Record<string, string> = {
    external_voucher_not_enabled: 'Fremde Gutscheine sind für dieses Konto nicht freigegeben.',
    external_voucher_type_not_enabled: 'Fremde Einzweckgutscheine sind für dieses Konto nicht freigegeben.',
    external_voucher_number_invalid: 'Gutscheinnummer prüfen: 1 bis 40 Zeichen, nur Buchstaben, Ziffern und - _ . / sind erlaubt.',
    external_voucher_number_is_own_code: 'Das ist ein eigener Gutscheincode. Bitte als eigenen Gutschein einlösen.',
    external_voucher_duplicate: 'Diese Gutscheinnummer steht schon auf dem Beleg.',
  };
  for (const [code, text] of Object.entries(erwartet)) assert.equal(messageText(voucherErrorMessage(code)!), text, code);
});

// ---- Pruefaelle: Zahlbetrag ------------------------------------------------------

const ART: Record<string, string> = { mehrzweck: 'multi_purpose', einzweck: 'single_purpose', leistung: 'service', aktion: 'promotion' };
const FREIGABE: Record<string, 'off' | 'multi_purpose' | 'all'> = { aus: 'off', wert: 'multi_purpose', beide: 'all' };
const UMBENANNT: Record<string, string> = {
  betragCents: 'amountCents', nummer: 'number', satzBp: 'vatRateBp', versteuertMit: 'taxedWith', grund: 'reason', sorteId: 'typeId',
  artikelId: 'articleId', stueck: 'quantity', positionen: 'positions',
};

/**
 * Code eines eigenen Gutscheins im Fall: der Server loest ihn vorher zur `gutscheinId` auf (die Codes der Datei tragen
 * kein gueltiges Pruefzeichen); die Kasse sendet einen gueltigen Code und kennt seine Pruefung (checkVoucher).
 */
const codeFuer = (gutscheinId: string): string => VoucherCode.generate(Uint8Array.from({ length: 11 }, (_, k) => (gutscheinId.charCodeAt(k % gutscheinId.length) + k * 5) & 31));

/** Ein Wunsch des Falls (innere Form) so, wie eine Kasse ihn unter /v3 sendet. */
function wunsch(v: Json): Voucher {
  const raus: Json = {};
  for (const [k, w] of Object.entries(v)) {
    if (k === 'artikel') continue;
    if (k === 'gutscheinId') { raus.code = codeFuer(w as string); continue; }
    if (k === 'code' && v.gutscheinId) continue;
    if (k === 'quelle') raus.source = w === 'extern' ? 'external' : w;
    else if (k === 'type') raus.type = ART[w as string] ?? w;
    else raus[UMBENANNT[k] ?? k] = w;
  }
  return raus as Voucher;
}
const position = (it: Json) => ({ name: it.name, quantity: it.amount, priceCents: it.priceOneCents, vat: it.vat, ...(it.kind ? { kind: it.kind } : {}), ...(it.recipient !== undefined ? { recipient: it.recipient } : {}) });

function optionen(e: Json): ReceiptDueOptions {
  const info = (e.vouchers as Json[]).filter((v) => v.gutscheinId && e.gutscheine?.[v.gutscheinId]).map((v) => ({ code: codeFuer(v.gutscheinId), check: pruefungAus(e.gutscheine[v.gutscheinId]) }));
  return {
    externalVouchers: FREIGABE[e.fremd ?? 'aus'],
    smallBusiness: e.kleinunternehmer === true,
    today: e.heute,
    zeroRateBucketFrom: KATALOG.nulltopfAb,
    ...(info.length > 0 ? { voucherInfo: info } : {}),
  };
}

const FREMD_FAELLE = KATALOG.faelle.filter((f) => f.name.startsWith('fg_'));

test('Pruefaelle: die Kopie ist die Datei des Backends (mit KASSENECK_BACKEND byte-gleich)', (t) => {
  assert.ok(FREMD_FAELLE.length >= 30, `${FREMD_FAELLE.length} Fremdfaelle`);
  const backend = process.env['KASSENECK_BACKEND'];
  if (!backend) { t.skip('KASSENECK_BACKEND fehlt'); return; }
  const quelle = readFileSync(resolve(backend, 'functions/test/unit/fixtures/gutschein-faelle.json'));
  assert.ok(readFileSync(new URL('../../fixtures/stored/voucher-cases.json', import.meta.url)).equals(quelle), 'fixtures/stored/voucher-cases.json weicht vom Backend ab');
});

test('Pruefaelle: Zahlbetrag, Zaehler, Toepfe und Abweisungscode jedes Fremdfalls wie der Server', () => {
  let gerechnet = 0;
  for (const f of FREMD_FAELLE) {
    const e = f.eingabe;
    if (e.stornoVon) continue;
    const items = (e.items as Json[]).map(position);
    const vouchers = (e.vouchers as Json[]).map(wunsch);
    const rechne = () => receiptDueBreakdown(items as never, vouchers, 'standard', optionen(e));
    if (f.erwartet.fehler) {
      assert.throws(rechne, (x: unknown) => x instanceof ReceiptDueError && x.voucherErrorCode === f.erwartet.fehler, f.name);
    } else {
      const r = rechne();
      assert.equal(r.dueCents, f.erwartet.zahlbetragCents, `${f.name}: Zahlbetrag`);
      assert.equal(r.counterDeltaCents, f.erwartet.zaehlerDeltaCents, `${f.name}: Zaehler`);
      const toepfe = Object.fromEntries(Object.entries(r.bucketsCents!).filter(([, c]) => c !== 0));
      assert.deepEqual(toepfe, f.erwartet.toepfeCents, `${f.name}: Toepfe`);
    }
    gerechnet++;
  }
  assert.ok(gerechnet >= 25, `${gerechnet} Faelle gerechnet`);
});

test('Pruefaelle: ohne Freigabe-Angabe prueft nur der Server die Freigabe', () => {
  const f = KATALOG.faelle.find((x) => x.name === 'fg_fehler_nicht_freigegeben')!;
  const { externalVouchers: _weg, ...ohne } = optionen(f.eingabe);
  assert.doesNotThrow(() => receiptDueBreakdown((f.eingabe.items as Json[]).map(position) as never, (f.eingabe.vouchers as Json[]).map(wunsch), 'standard', ohne));
});

// ---- Pruefaelle: Bon ------------------------------------------------------------------

const FIRMA = JSON.parse(readFileSync(new URL('../../fixtures/receipts/voucher-external-redeem.json', import.meta.url), 'utf8')).company as Json;

/** Der Beleg eines Falls, wie der Server ihn speichert (Ware + Gutscheinzeilen, Eintraege innen). */
function gespeichert(f: { name: string; eingabe: Json; erwartet: Json }): Json {
  const storno = Boolean(f.eingabe.stornoVon);
  const items = storno ? f.erwartet.positionen : [...f.eingabe.items, ...f.erwartet.positionen];
  return {
    receiptId: 'KASSE1-ID-7', cashregisterId: 'KASSE1', timeStamp: '2026-11-05T10:15:30', receiptType: storno ? 'cancellation' : 'standard',
    items, vouchers: f.erwartet.vouchers, paymentMethod: 'cash', payments: [], qr: 'QR', sig: 'SIG', customerDetails: [], legalMessage: [],
  };
}
const texte = (l: ReceiptLayout): string[] => l.lines.flatMap((z) => (z.kind === 'text' ? [z.text] : z.kind === 'columns' ? [z.columns.map((c) => c.text).join(' | ')] : []));
const euro = (c: number): string => `${formatCents(c)} €`;

test('Pruefaelle: jeder Fremdbeleg zeigt „Gutschein Nr. …“, den Vermerk, nie einen Rest, und Gesamt = Zahlbetrag', () => {
  let gezeigt = 0;
  for (const f of FREMD_FAELLE) {
    if (f.erwartet.fehler || !Array.isArray(f.erwartet.vouchers)) continue;
    const beleg = fromStoredReceipt(gespeichert(f));
    const fremde = beleg.vouchers.filter(isExternalVoucher);
    assert.equal(fremde.length, (f.erwartet.vouchers as Json[]).filter((v) => v.quelle === 'extern').length, f.name);
    const l = buildReceiptLayout(beleg, FIRMA, { paperSize: 'mm80' });
    const zeilen = texte(l);
    // Rest nur bei eigenen Gutscheinen (fg_eigen_und_fremd): je eigener hoechstens eine Zeile.
    const reste = zeilen.filter((z) => z.includes('Rest am Gutschein')).length;
    assert.ok(reste <= beleg.vouchers.length - fremde.length, `${f.name}: Rest am Bon`);
    for (const v of fremde) {
      assert.ok(zeilen.some((z) => z.includes(`Gutschein Nr. ${v.number}`)), `${f.name}: Zeile ${v.number}`);
      // Vermerk an der Einloesung; die Auszahlung traegt wie beim eigenen Gutschein den Grund.
      if (v.taxedWith && v.action === 'redeem') assert.ok(zeilen.includes(`  Einzweck, versteuert mit ${v.taxedWith}`), `${f.name}: Vermerk`);
      if (v.action === 'payout' && v.reason) assert.ok(zeilen.includes(`  Grund: ${v.reason}`), `${f.name}: Grund`);
    }
    const gesamt = zeilen.find((z) => z.startsWith('Gesamt: | '));
    assert.equal(gesamt, `Gesamt: | ${euro(f.erwartet.zahlbetragCents)}`, f.name);
    gezeigt++;
  }
  assert.ok(gezeigt >= 20, `${gezeigt} Bons`);
});

test('Bon: das Beispiel der Spec (fg_ez_und_mz_einloesung_bon) Zeile fuer Zeile', () => {
  const f = KATALOG.faelle.find((x) => x.name === 'fg_ez_und_mz_einloesung_bon')!;
  const zeilen = texte(buildReceiptLayout(fromStoredReceipt(gespeichert(f)), FIRMA, { paperSize: 'mm80' }));
  const von = zeilen.indexOf('1  x Brauereiführung | 20,00 A');
  assert.ok(von >= 0, zeilen.join('\n'));
  assert.deepEqual(zeilen.slice(von, von + 4), [
    '1  x Brauereiführung | 20,00 A',
    '1  x Bier 0,5 | 4,50 A',
    'Gutschein Nr. FG-1234 | -20,00 A',
    '  Einzweck, versteuert mit FG-1234-V',
  ]);
  const zs = zeilen.indexOf('Zwischensumme | 4,50 €');
  assert.deepEqual(zeilen.slice(zs, zs + 2), ['Zwischensumme | 4,50 €', 'Gutschein Nr. W-77 | -3,00 €']);
  assert.ok(zeilen.includes('Gesamt: | 1,50 €'));
  assert.ok(!zeilen.some((z) => z.includes('Rest am Gutschein')));
});

test('Bon: der stored-Leser uebersetzt quelle/nummer wie der Rand (source external, number)', () => {
  const f = KATALOG.faelle.find((x) => x.name === 'fg_ez_und_mz_einloesung_bon')!;
  const [e, m] = fromStoredReceipt(gespeichert(f)).vouchers;
  assert.deepEqual([e!.source, e!.number, e!.type, e!.voucherType, e!.amountCents, e!.vatRateBp, e!.taxedWith], ['external', 'FG-1234', 'single_purpose', 'single_purpose', 2000, 2000, 'FG-1234-V']);
  assert.deepEqual([m!.source, m!.number, m!.type, m!.voucherType, m!.valueCents], ['external', 'W-77', 'value', 'multi_purpose', 300]);
  // Gelesen ist kein Wunsch: nie sendbar (Serverfeld voucherType).
  assert.equal(voucherIsValid(e!), false);
});

// ---- Beleg-Webhooks --------------------------------------------------------------------

const ROH = JSON.parse(readFileSync(new URL('../../fixtures/receipts/voucher-external-redeem.json', import.meta.url), 'utf8')).receipt as Json;
// Die Golden-Eingabe fuehrt Freitextzeilen als Liste; am Draht stehen sie als Text.
const BELEG = { ...ROH, customerDetails: '', legalMessage: '' } as Json;
const huelle = (type: string, data: Json) => JSON.stringify({ id: 'evt_0123456789abcdefghij', type, createdAt: 1_762_334_130_000, accountId: 'kw_betrieb1', data });

test('Beleg-Webhooks: receipt.created traegt den Beleg wie listReceipts view full', () => {
  assert.deepEqual([...RECEIPT_WEBHOOK_EVENTS], ['receipt.created', 'receipt.cancelled']);
  const e = parseInventoryWebhookEvent(huelle('receipt.created', { receipt: BELEG }))!;
  assert.equal(e.type, 'receipt.created');
  assert.equal(e.test, false);
  if (e.type !== 'receipt.created') return;
  assert.deepEqual(e.data, { receipt: fromReceiptPayload(BELEG) });
  assert.deepEqual(e.data.receipt.vouchers.map((v) => v.number), ['FG-1234', 'W-77']);
  // Gekuerzt: ohne Positionen, mit Hinweis.
  const { items: _weg, ...ohne } = BELEG;
  const k = parseInventoryWebhookEvent(huelle('receipt.created', { receipt: ohne, truncated: true, hint: 'Beleg zu groß' }))!;
  assert.ok(k.type === 'receipt.created' && k.data.truncated === true && k.data.hint === 'Beleg zu groß' && k.data.receipt.items.length === 0);
  assert.throws(() => parseInventoryWebhookEvent(huelle('receipt.created', {})), isKasseneckValidationError);
});

test('Beleg-Webhooks: receipt.cancelled mit Bezug, stornierten Positionen und Rueckzahlungen', () => {
  const storno = { ...BELEG, receiptType: 'cancellation' };
  const daten = {
    receipt: storno, cancellationOf: 'KASSE1-ID-6', cancelledItems: [{ index: 0, quantity: 1 }, { index: null, quantity: 1 }],
    refunds: [{ refundOf: 'p1', amountCents: 150, method: 'cash' }, { refundOf: null, amountCents: 100, method: 'cash' }],
  };
  const e = parseInventoryWebhookEvent(huelle('receipt.cancelled', daten))!;
  assert.ok(e.type === 'receipt.cancelled');
  if (e.type !== 'receipt.cancelled') return;
  assert.deepEqual(e.data, { ...daten, receipt: fromReceiptPayload(storno) });
  // Der veraltete Storno ohne Bezug: cancellationOf null.
  const alt = parseInventoryWebhookEvent(huelle('receipt.cancelled', { ...daten, cancellationOf: null }))!;
  assert.ok(alt.type === 'receipt.cancelled' && alt.data.cancellationOf === null);
  for (const kaputt of [{ ...daten, cancellationOf: 7 }, { ...daten, cancelledItems: null }, { ...daten, refunds: [1] }]) {
    assert.throws(() => parseInventoryWebhookEvent(huelle('receipt.cancelled', kaputt)), isKasseneckValidationError);
  }
});
