import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  POS_BUSINESS_DEFAULTS, POS_BUSINESS_OPTIONAL_FIELDS, POS_BUSINESS_OPTIONAL_CHOICES, POS_BUSINESS_VALUES, TIP_KEPT_MODE, TIP_CLAIM_SCOPES,
  EXPECTED_PART_KEYS, POS_ERROR_CODES,
  mergePosSettings, posTipCardKeptMode, posTipCardKeptByDefault, posTipSelfPayout, tipKeptFor, tipStatus, shiftTipLines, labelText, messageText,
  getMyTipBalance, TIP_CLAIM_SCOPE_LABELS, TIP_KEPT_MODE_LABELS, type PosBusinessSettings, type ShiftTip,
} from '../src/pos/index.js';
import { KATALOGE } from '../src/stored/vokabular.js';
import { createTransport, POS_BASE_URL, type FetchLike, type HttpRequestInit, type HttpResponseLike } from '../src/client/transport.js';
import { registerUserAuth } from '../src/client/auth.js';
import { isKasseneckApiError } from '../src/client/errors.js';

/*
 * Kartentrinkgeld an der Kasse (Backend-Spec 2026-11-11-kartentrinkgeld, Stufe 1 und 2): dieselben drei Stufen
 * wie bei Bar (business.tipCardKeptMode, tipCardKeptByDefault), der Not-Aus tipSelfPayout, die eine Zeile mit
 * Betrag (tipStatus), „Mein Trinkgeld“ (getMyTipBalance gegen den Vertrag) und die Zeile „davon Kartentrinkgeld
 * bar genommen“ auf Bon und Kassenstand. Die gemeinsamen Faelle mit dem Backend liegen in
 * fixtures/stored/card-tip-cases.json.
 */

type Json = Record<string, any>;
const lies = (datei: string): Json => JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/${datei}`, import.meta.url)), 'utf8')) as Json;
const FAELLE = lies('stored/card-tip-cases.json') as {
  receipts: Array<{ name: string; tips: Record<string, ShiftTip>; tipLines: Array<[string, number]>; tipStatus?: { method: 'cash' | 'card'; kept: boolean; status: string; key: string } }>;
};
const mit = (b: Partial<PosBusinessSettings>) => mergePosSettings(POS_BUSINESS_DEFAULTS, b);

test('Einstellungen: Karten-Stufe und Vorbelegung optional wie bei Bar, Not-Aus optional, Katalog wie der Vertrag', () => {
  assert.ok((POS_BUSINESS_OPTIONAL_CHOICES as readonly string[]).includes('tipCardKeptMode'));
  assert.ok((POS_BUSINESS_OPTIONAL_FIELDS as readonly string[]).includes('tipCardKeptByDefault'));
  assert.ok((POS_BUSINESS_OPTIONAL_FIELDS as readonly string[]).includes('tipSelfPayout'));
  for (const k of ['tipCardKeptMode', 'tipCardKeptByDefault', 'tipSelfPayout']) assert.equal(k in POS_BUSINESS_DEFAULTS, false, k);
  assert.deepEqual(POS_BUSINESS_VALUES.tipCardKeptMode, TIP_KEPT_MODE);
  assert.deepEqual([...TIP_KEPT_MODE], Object.values(KATALOGE['KASSE_BETRIEB_WERTE.tipCardKeptMode']!));
  // Lesen: fehlend = ask, aus, an; deutsche Altwerte kommen nicht ins Modell.
  assert.equal(posTipCardKeptMode(POS_BUSINESS_DEFAULTS), 'ask');
  assert.equal(posTipCardKeptMode(mit({ tipCardKeptMode: 'never' })), 'never');
  assert.equal('tipCardKeptMode' in mit({ tipCardKeptMode: 'immer' } as unknown as Partial<PosBusinessSettings>), false);
  assert.equal(posTipCardKeptByDefault(POS_BUSINESS_DEFAULTS), false);
  assert.equal(posTipCardKeptByDefault(mit({ tipCardKeptByDefault: true })), true);
  assert.equal(posTipSelfPayout(POS_BUSINESS_DEFAULTS), true);
  assert.equal(posTipSelfPayout(mit({ tipSelfPayout: false })), false);
  assert.equal(posTipSelfPayout(null), true);
});

test('tipKeptFor je Zahlart: bar wie bisher (ohne drittes Argument), Karte nach der Karten-Stufe', () => {
  const b = mit({ tipKeptMode: 'always', tipKeptByDefault: false, tipCardKeptMode: 'ask', tipCardKeptByDefault: true });
  // Bar: unveraendert (die Bar-Stufe), auch mit ausdruecklichem 'cash'.
  assert.deepEqual(tipKeptFor(b), { showSwitch: false, kept: true });
  assert.deepEqual(tipKeptFor(b, undefined, 'cash'), { showSwitch: false, kept: true });
  // Karte: Schalter, vorbelegt aus tipCardKeptByDefault, die Wahl gewinnt.
  assert.deepEqual(tipKeptFor(b, undefined, 'card'), { showSwitch: true, kept: true });
  assert.deepEqual(tipKeptFor(b, false, 'card'), { showSwitch: true, kept: false });
  // Karte always/never: kein Schalter, Wahl und Vorbelegung zaehlen nicht.
  for (const wahl of [undefined, true, false]) {
    assert.deepEqual(tipKeptFor(mit({ tipCardKeptMode: 'always', tipCardKeptByDefault: false }), wahl, 'card'), { showSwitch: false, kept: true });
    assert.deepEqual(tipKeptFor(mit({ tipCardKeptMode: 'never', tipCardKeptByDefault: true }), wahl, 'card'), { showSwitch: false, kept: false });
  }
  // Rot-Probe: die Karten-Stufe aendert nichts an Bar und umgekehrt.
  assert.deepEqual(tipKeptFor(mit({ tipCardKeptMode: 'always' })), { showSwitch: true, kept: false });
  assert.deepEqual(tipKeptFor(mit({ tipKeptMode: 'always' }), undefined, 'card'), { showSwitch: true, kept: false });
  assert.deepEqual(tipKeptFor(undefined, undefined, 'card'), { showSwitch: true, kept: false });
});

test('tipStatus: die eine Zeile je Zahlart und Ergebnis, mit Betrag; einzeilig', () => {
  assert.deepEqual(tipStatus('cash', true), { status: 'kept', key: 'tip.line_cash_kept' });
  assert.deepEqual(tipStatus('cash', false), { status: 'open', key: 'tip.line_cash_open' });
  assert.deepEqual(tipStatus('card', true), { status: 'kept', key: 'tip.line_card_kept' });
  assert.deepEqual(tipStatus('card', false), { status: 'open', key: 'tip.line_card_open' });
  assert.equal(labelText(tipStatus('cash', true).key, { amount: '5,00 €' }), '5,00 € gleich einstecken');
  assert.equal(labelText(tipStatus('cash', false).key, { amount: '5,00 €' }), '5,00 € in der Lade lassen');
  assert.equal(labelText(tipStatus('card', true).key, { amount: '5,00 €' }), '5,00 € aus der Lade nehmen');
  assert.equal(labelText(tipStatus('card', false).key, { amount: '5,00 €' }), '5,00 € später auszahlen');
  for (const k of ['tip.line_cash_kept', 'tip.line_cash_open', 'tip.line_card_kept', 'tip.line_card_open', 'done.tip_open', 'cancellation.tip_deducted', 'my_tips.overpaid'] as const) {
    assert.equal(labelText(k, { amount: '1', open: '2', name: 'Livia' }).includes('\n'), false, k);
  }
  assert.equal(labelText('cancellation.tip_deducted', { amount: '5,00 €', name: 'Livia Lindmayr' }), '5,00 € Trinkgeld werden vom Guthaben von Livia Lindmayr abgezogen');
  assert.equal(labelText('my_tips.nothing_open'), 'Nichts offen');
  assert.equal(labelText('shift_receipt.tip_card_taken'), 'davon Kartentrinkgeld bar genommen');
  assert.match(messageText('tip.card_kept_setting_hint'), /bar aus der Lade/);
});

test('shiftTipLines: „davon Kartentrinkgeld bar genommen“ nach „schon genommen“, nur ≠ 0; Soll-Teil card_tips_taken', () => {
  const z = shiftTipLines({ registerUserId: 'ru_livia', name: 'Livia Lindmayr', receivedImmediatelyCents: 500, retainedCents: 0, paidOutCents: 500, refundedByEmployeeCents: 0, cardTipsTakenCents: 500, openCents: 0 });
  assert.deepEqual(z.map((x) => [x.key, x.cents]), [['shift_receipt.tip_earned', 500], ['shift_receipt.tip_paid_out', 500], ['shift_receipt.tip_card_taken', 500]]);
  assert.equal(z[2]!.text, 'davon Kartentrinkgeld bar genommen');
  // Ohne das Feld (Server vor 1.37.0, bar) keine Zeile – byte-gleich wie bisher.
  assert.deepEqual(shiftTipLines({ registerUserId: 'ru_livia', name: 'L', receivedImmediatelyCents: 500, retainedCents: 0, paidOutCents: 500, refundedByEmployeeCents: 0, openCents: 0 }).map((x) => x.key),
    ['shift_receipt.tip_earned', 'shift_receipt.tip_paid_out']);
  assert.ok((EXPECTED_PART_KEYS as readonly string[]).includes('card_tips_taken'));
  assert.equal(labelText('shift.part_card_tips_taken'), 'Kartentrinkgeld bar genommen');
  assert.deepEqual([...TIP_CLAIM_SCOPES], Object.values((lies('v3/v3-vokabular.json').catalogs as Json).TRINKGELD_ANSPRUCH));
  assert.ok((POS_ERROR_CODES as readonly string[]).includes('not_a_person_login'));
});

test('Prueffaelle (Vertrag mit dem Backend): Zeilen und Zeile je Beleg', () => {
  assert.ok(FAELLE.receipts.length >= 6);
  for (const f of FAELLE.receipts) {
    for (const t of Object.values(f.tips)) {
      assert.deepEqual(shiftTipLines(t).map((x) => [x.key, x.cents]), f.tipLines, f.name);
    }
    if (f.tipStatus) {
      const s = tipStatus(f.tipStatus.method, f.tipStatus.kept);
      assert.deepEqual({ status: s.status, key: s.key }, { status: f.tipStatus.status, key: f.tipStatus.key }, f.name);
    }
  }
});

// --- getMyTipBalance gegen den Vertrag ---------------------------------------------------------------------
interface Fall { case: string; caller: string; params: Json; httpStatus: number; headers: Record<string, string>; response: Json }
const KASSE = lies('v3/antworten/kasse.json').endpoints as Record<string, { cases: Fall[] }>;

function antwortAus(f: Pick<Fall, 'httpStatus' | 'headers' | 'response'>): HttpResponseLike {
  const rumpf = JSON.stringify(f.response);
  const kopf: Record<string, string> = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(f.headers)) kopf[k.toLowerCase()] = v;
  return {
    status: f.httpStatus,
    headers: { get: (name: string) => kopf[name.toLowerCase()] ?? null },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer as ArrayBuffer,
  };
}
async function rufe(f: Fall): Promise<{ ergebnis?: unknown; fehler?: unknown; gesendet: Json[] }> {
  const gesendet: Json[] = [];
  const holen: FetchLike = async (url: string, init: HttpRequestInit) => {
    assert.equal(url, `${POS_BASE_URL}/getMyTipBalance`);
    const p = (JSON.parse(init.body) as { params: Json }).params;
    if (!('cashregisterId' in f.params)) delete p.cashregisterId;
    gesendet.push(p);
    return antwortAus(f);
  };
  const r = createTransport({ auth: registerUserAuth({ getIdToken: () => 'eyJ-ID', getSessionId: () => 'sess-1', cashregisterId: 'KASSE1' }), fetch: holen, timeoutMs: 50 });
  try {
    return { ergebnis: await getMyTipBalance(r, f.params as never), gesendet };
  } catch (fehler) {
    return { fehler, gesendet };
  }
}
const fall = (name: string): Fall => {
  const f = KASSE.getMyTipBalance!.cases.find((c) => c.case === name);
  if (!f) throw new Error(`kasse.json: kein Fall getMyTipBalance/${name}`);
  return f;
};

test('getMyTipBalance: Erfolgsfaelle des Vertrags, Modell wie gesendet (offen je Lade, andere Laden, je Person)', async () => {
  const erfolg = KASSE.getMyTipBalance!.cases.filter((c) => c.response.status === 'success');
  assert.ok(erfolg.length >= 3);
  for (const f of erfolg) {
    const { ergebnis, fehler, gesendet } = await rufe(f);
    assert.equal(fehler, undefined, `${f.case}: ${String(fehler)}`);
    assert.deepEqual(gesendet, [f.params], f.case);
    assert.deepEqual(ergebnis, f.response.data, f.case);
  }
  const andere = (await rufe(fall('success_cashier_other_drawer'))).ergebnis as Json;
  assert.equal(andere.claimScope, 'per_drawer');
  assert.deepEqual(andere.otherDrawers, [{ drawerId: 'lade_bar', name: 'Bar', openCents: 150 }]);
  const person = (await rufe(fall('success_cashier_per_person'))).ergebnis as Json;
  assert.deepEqual([person.claimScope, person.openCents, person.otherDrawers], ['per_person', 550, []]);
});

test('getMyTipBalance: Fehler am Code – Inhaber not_a_person_login, Lade unbekannt, fremde Kasse', async () => {
  for (const [name, code] of [['owner', 'not_a_person_login'], ['drawer_unknown', 'drawer_not_found'], ['foreign_cashregister', 'cashregister_not_assigned']] as const) {
    const { fehler } = await rufe(fall(name));
    assert.ok(isKasseneckApiError(fehler), `${name}: ${String(fehler)}`);
    assert.equal(fehler.code, code, name);
  }
});

test('getMyTipBalance: unlesbare Antwort ist ein Fehler, nie ein Stand mit 0', async () => {
  const f = fall('success_cashier');
  const kaputt: Fall = { ...f, response: { status: 'success', message: '', data: { drawerId: 'haupt_KASSE1', claimScope: 'per_drawer', openCents: 'viel', keptTodayCents: 0, currency: 'EUR', otherDrawers: [] } } };
  const { fehler, ergebnis } = await rufe(kaputt);
  assert.equal(ergebnis, undefined);
  assert.ok(fehler instanceof Error);
  assert.match(String((fehler as Error).message), /openCents/);
});

test('Stufe 3: Anspruchs-Modus je Lade / je Person mit Beschriftung je Wert (Kundenbereich), Satz ohne Auszahl-Recht', () => {
  // Jeder Wert des Katalogs hat genau eine Beschriftung -- eine neue Stufe ohne Wort waere hier rot.
  assert.deepEqual(Object.keys(TIP_CLAIM_SCOPE_LABELS).sort(), [...TIP_CLAIM_SCOPES].sort());
  assert.deepEqual(TIP_CLAIM_SCOPES.map((s) => labelText(TIP_CLAIM_SCOPE_LABELS[s])), ['Je Kassenlade', 'Je Person (alle Kassenladen)']);
  assert.equal(labelText('tip_claim_scope.title'), 'Offenes Trinkgeld zählt');
  assert.match(messageText('tip_claim_scope.hint'), /^Je Kassenlade: .+ Je Person: .+\.$/);
  assert.equal(messageText('my_tips.payout_not_allowed'), 'Auszahlen nur mit dem Recht „Schicht“.');
  // Die Karten-Stufe nimmt dieselben Woerter wie Bar (eine Zuordnung, keine zweite Liste).
  assert.deepEqual(TIP_KEPT_MODE.map((m) => labelText(TIP_KEPT_MODE_LABELS[m])), ['Jedes Mal fragen', 'Immer gleich behalten', 'Immer offen lassen']);
});
