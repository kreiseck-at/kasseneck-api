import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  listMyStocktakes, listMyStocktakeItems, listMyStocktakeCounts, recordMyStocktakeCount, voidMyStocktakeCount,
  parseQuantityMilli, isPosError, POS_ERROR_CODES, MESSAGES, LABELS, messageText, labelText,
  type LabelKey, type MessageKey,
} from '../src/pos/index.js';
import { createTransport, POS_BASE_URL, type FetchLike, type HttpRequestInit, type HttpResponseLike } from '../src/client/transport.js';
import { registerUserAuth } from '../src/client/auth.js';
import { isKasseneckValidationError, isOutcomeUnknown, KasseneckNetworkError } from '../src/client/errors.js';

/*
 * Inventur zaehlen an der Kasse (Lager-Kern Stufe 3) am Kassenweg `/api/v3`
 * gegen den Vertrags-Export (fixtures/v3/antworten/kasse.json): was gesendet
 * wird, wie gelesen wird, jeder Fehler am Code. Dazu die Mengen-Eingabe ohne
 * Gleitkomma (gemeinsame Faelle mit dem Dart-Zwilling) und die Saetze.
 */

type Json = Record<string, any>;
interface Fall { case: string; caller: string; params: Json; httpStatus: number; headers: Record<string, string>; response: Json }

const lies = (datei: string): Json => JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/${datei}`, import.meta.url)), 'utf8')) as Json;
const KASSE = lies('v3/antworten/kasse.json').endpoints as Record<string, { cases: Fall[] }>;
const ENDPUNKTE = ['listMyStocktakes', 'listMyStocktakeItems', 'listMyStocktakeCounts', 'recordMyStocktakeCount', 'voidMyStocktakeCount'] as const;

function antwortAus(f: Fall): HttpResponseLike {
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

function kassenweg(holen: FetchLike) {
  return createTransport({
    auth: registerUserAuth({ getIdToken: () => 'eyJ-ID', getSessionId: () => 'sess-1', cashregisterId: 'KASSE1' }),
    fetch: holen,
    timeoutMs: 50,
  });
}

/** Ruft den Fall ueber die Paketfunktion; `cashregisterId` der Anmeldung zaehlt beim Vergleich nur, wenn der Fall sie nennt. */
async function rufe(endpunkt: (typeof ENDPUNKTE)[number], f: Fall): Promise<{ ergebnis?: unknown; fehler?: unknown; gesendet: Json[] }> {
  const gesendet: Json[] = [];
  const holen: FetchLike = async (url: string, init: HttpRequestInit) => {
    assert.equal(url, `${POS_BASE_URL}/${endpunkt}`);
    const p = (JSON.parse(init.body) as { params: Json }).params;
    if (!('cashregisterId' in f.params)) delete p.cashregisterId;
    gesendet.push(p);
    return antwortAus(f);
  };
  const r = kassenweg(holen);
  const p = f.params as never;
  const aufrufe = {
    listMyStocktakes: () => listMyStocktakes(r, p),
    listMyStocktakeItems: () => listMyStocktakeItems(r, p),
    listMyStocktakeCounts: () => listMyStocktakeCounts(r, p),
    recordMyStocktakeCount: () => recordMyStocktakeCount(r, p),
    voidMyStocktakeCount: () => voidMyStocktakeCount(r, p),
  };
  try {
    return { ergebnis: await aufrufe[endpunkt](), gesendet };
  } catch (fehler) {
    return { fehler, gesendet };
  }
}

/**
 * Faelle, die das Paket schon vor dem Senden abweist (sicher falsch ohne
 * Netz): genau diese. Fall -> Grund.
 */
const VOR_DEM_SENDEN: Record<string, string> = {
  'listMyStocktakeItems/data_missing': 'stocktakeId fehlt',
  'listMyStocktakeCounts/data_missing': 'stocktakeId fehlt',
  'recordMyStocktakeCount/data_missing': 'stocktakeId fehlt',
  'recordMyStocktakeCount/key_missing': 'idempotencyKey fehlt',
  'voidMyStocktakeCount/data_missing': 'countId fehlt',
  'voidMyStocktakeCount/reason_missing': 'leerer Grund',
  'voidMyStocktakeCount/key_missing': 'idempotencyKey fehlt',
};

test('Kassenweg Inventur: jeder Erfolgsfall sendet die Parameter des Falls und liest das Modell', async () => {
  let n = 0;
  for (const endpunkt of ENDPUNKTE) {
    for (const f of KASSE[endpunkt]!.cases.filter((c) => c.response.status === 'success' && !('$body' in c.params))) {
      const { ergebnis, fehler, gesendet } = await rufe(endpunkt, f);
      assert.equal(fehler, undefined, `${endpunkt}/${f.case}: ${String(fehler)}`);
      assert.deepEqual(gesendet, [f.params], `${endpunkt}/${f.case}`);
      const d = f.response.data as Json;
      const e = ergebnis as Json;
      if (endpunkt === 'listMyStocktakes') {
        assert.deepEqual(e.map((s: Json) => s.id), d.stocktakes.map((s: Json) => s.id), f.case);
        assert.deepEqual(e.map((s: Json) => s.status), d.stocktakes.map((s: Json) => s.status), f.case);
      } else if (endpunkt === 'listMyStocktakeItems') {
        assert.deepEqual(e.items.map((i: Json) => [i.articleId, i.quantity, i.counted, i.expectedQuantity]), d.items.map((i: Json) => [i.articleId, i.quantity, i.counted, i.expectedQuantity]), f.case);
        assert.equal(e.nextCursor, d.nextCursor);
      } else if (endpunkt === 'listMyStocktakeCounts') {
        assert.deepEqual(e.counts.map((z: Json) => [z.id, z.quantity, z.voided?.reason ?? null]), d.counts.map((z: Json) => [z.id, z.quantity, z.voided?.reason ?? null]), f.case);
      } else {
        assert.equal(e.count.id, d.count.id, f.case);
        assert.equal(e.item.quantity, d.item.quantity, f.case);
        assert.equal(e.count.cashregisterId, d.count.cashregisterId, f.case);
      }
      n += 1;
    }
  }
  assert.ok(n >= 20, `nur ${n} Erfolgsfaelle`);
});

test('Kassenweg Inventur: jeder Fehlerfall wird am Code erkannt; vor dem Senden abgewiesen nur die benannten', async () => {
  const abgewiesen: string[] = [];
  for (const endpunkt of ENDPUNKTE) {
    for (const f of KASSE[endpunkt]!.cases.filter((c) => c.response.status === 'error' && !('$body' in c.params))) {
      const { fehler, gesendet } = await rufe(endpunkt, f);
      if (gesendet.length === 0) {
        assert.ok(isKasseneckValidationError(fehler) && fehler.scope === 'request', `${endpunkt}/${f.case}: ${String(fehler)}`);
        abgewiesen.push(`${endpunkt}/${f.case}`);
        continue;
      }
      assert.ok(isPosError(fehler, f.response.code), `${endpunkt}/${f.case}: ${String(fehler)}`);
    }
  }
  assert.deepEqual(abgewiesen.sort(), Object.keys(VOR_DEM_SENDEN).sort());
  for (const c of ['stocktake_not_open', 'stocktake_closed', 'article_not_in_scope', 'count_already_voided', 'serial_already_counted', 'too_many_counts']) {
    assert.ok((POS_ERROR_CODES as readonly string[]).includes(c), c);
  }
});

test('Kassenweg Inventur: Kassen-Benutzer mit stocktakeCount sehen kein Soll, der Chef ab der Pruefung schon', async () => {
  const fall = (name: string) => KASSE.listMyStocktakeItems!.cases.find((c) => c.case === name)!;
  const kassier = (await rufe('listMyStocktakeItems', fall('success_cashier_check'))).ergebnis as Json;
  for (const it of kassier.items) assert.equal('expectedQuantity' in it, false, 'stocktakeCount: kein Soll');
  const chef = (await rufe('listMyStocktakeItems', fall('success_manager_check'))).ergebnis as Json;
  assert.equal(chef.items[0].expectedQuantity, 10000);
  assert.equal('differenceValueCents' in chef.items[0], false, 'ohne stockCosts kein Wert');
  assert.equal(chef.items[1].expectedQuantity, null, 'ungezaehlt: Soll null, nicht 0');
  assert.equal(chef.items[1].recount.reason, 'Kiste hinten nachzählen');
});

test('Kassenweg Inventur: unklarer Ausgang beim Zaehlen (unknown), Lesen bleibt rejected', async () => {
  const haengt: FetchLike = (_url, init) => new Promise((_, ab) => init.signal.addEventListener('abort', () => ab(new Error('abgebrochen')), { once: true }));
  const r = kassenweg(haengt);
  const zaehlen = recordMyStocktakeCount(r, { idempotencyKey: 'k-kornspitz-1', stocktakeId: 'inv_laden', articleId: 'kornspitz', quantity: 37000 });
  await assert.rejects(zaehlen, (e) => e instanceof KasseneckNetworkError && isOutcomeUnknown(e));
  const storno = voidMyStocktakeCount(r, { idempotencyKey: 's-1', stocktakeId: 'inv_laden', countId: 'z1', reason: 'Doppelt gezählt' });
  await assert.rejects(storno, (e) => isOutcomeUnknown(e));
  await assert.rejects(listMyStocktakes(r), (e) => e instanceof KasseneckNetworkError && e.outcome === 'rejected');
});

test('listMyStocktakes: leerer Standort geht nicht hinaus, Status wie gegeben', async () => {
  const gesendet: Json[] = [];
  const holen: FetchLike = async (_url, init) => {
    gesendet.push((JSON.parse(init.body) as { params: Json }).params);
    return antwortAus({ case: 'x', caller: 'x', params: {}, httpStatus: 200, headers: { 'Kasseneck-Api-Version': 'v3' }, response: { status: 'success', message: '', data: { stocktakes: [] } } });
  };
  const r = kassenweg(holen);
  assert.deepEqual(await listMyStocktakes(r, { locationId: '' }), []);
  await listMyStocktakes(r, { locationId: 'haupt', status: 'review' });
  assert.deepEqual(gesendet.map(({ cashregisterId: _k, ...p }) => p), [{}, { locationId: 'haupt', status: 'review' }]);
});

test('parseQuantityMilli: die gemeinsamen Faelle (fixtures/stocktake-quantity-cases.json), ohne Gleitkomma', () => {
  const { cases } = lies('stocktake-quantity-cases.json') as { cases: Array<{ text: string; unit: string | null; expected: number | null }> };
  assert.ok(cases.length >= 30);
  for (const { text, unit, expected } of cases) {
    assert.equal(parseQuantityMilli(text, unit), expected, JSON.stringify({ text, unit }));
  }
  // Wo Gleitkomma irrte (0,1 + 0,2), stimmt es hier auf das Tausendstel.
  assert.equal(parseQuantityMilli('0,3', 'kg'), 300);
  assert.equal(parseQuantityMilli('1,005', 'kg'), 1005);
  assert.equal(parseQuantityMilli('4,35', 'kg'), 4350);
  // Ohne Einheit wie Stueckware; kein Text ergibt null statt eines Wurfs.
  assert.equal(parseQuantityMilli('3'), 3000);
  assert.equal(parseQuantityMilli(undefined as never, 'kg'), null);
});

test('Saetze der Inventur: Wortlaut exakt, Platzhalter, Halbgeviertstrich mit Leerraum, beide Seiten', () => {
  const meldungen: Record<string, string> = {
    'stocktake.none_open': 'An diesem Standort läuft gerade keine Inventur. Eine Inventur legt der Inhaber im Panel an.',
    'stocktake.scan_or_search': 'Artikel scannen oder suchen.',
    'stocktake.counted': '{name}: {quantity} gezählt.',
    'stocktake.blind_hint': 'Blind zählen – die Kasse zeigt keinen Buchbestand. Bitte zählen, was wirklich da ist.',
    'stocktake.recount_hint': 'Bitte die markierten Positionen nachzählen.',
    'stocktake.unknown_code': 'Zu „{code}“ gibt es keinen Artikel. Bitte den Code prüfen oder den Artikel suchen.',
    'stocktake.quantity_invalid': 'Bitte eine gültige Menge eingeben – höchstens drei Nachkommastellen, bei Stückware nur ganze Zahlen.',
    'stocktake.serials_capture': 'Bitte für jedes Stück die Seriennummer scannen.',
    'stocktake.serials_mismatch': 'Je Stück genau eine Seriennummer: {count} erfasst, {quantity} gezählt.',
    'stocktake.reason_missing': 'Bitte einen Grund für das Stornieren eingeben.',
    'stocktake.outcome_unknown': 'Unklar, ob die Zählung angekommen ist. „Erneut senden“ schickt dieselbe Zählung – sie zählt auch dann nur einmal.',
  };
  const beschriftungen: Record<string, string> = {
    'stocktake.title': 'Inventur zählen',
    'stocktake.quantity': 'Menge',
    'stocktake.defective': 'Defekt',
    'stocktake.count_zero': '0 zählen',
    'stocktake.next': 'Weiter',
    'stocktake.void': 'Stornieren',
    'stocktake.reason': 'Grund',
    'stocktake.progress': '{counted} von {total} gezählt',
    'stocktake.serial_numbers': 'Seriennummern erfassen',
    'stocktake.recount': 'Nachzählen',
    'stocktake.resend': 'Erneut senden',
    'stocktake.my_counts': 'Meine Zählungen',
    'stocktake.sent': 'gesendet',
    'stocktake.unconfirmed': 'unbestätigt',
    'stocktake.voided': 'storniert',
  };
  assert.deepEqual(Object.keys(MESSAGES).filter((k) => k.startsWith('stocktake.')).sort(), Object.keys(meldungen).sort());
  assert.deepEqual(Object.keys(LABELS).filter((k) => k.startsWith('stocktake.')).sort(), Object.keys(beschriftungen).sort());
  for (const [k, text] of [...Object.entries(meldungen), ...Object.entries(beschriftungen)]) {
    const eintrag = k in MESSAGES ? MESSAGES[k as MessageKey] : LABELS[k as LabelKey];
    assert.equal(eintrag.text, text, k);
    assert.equal(eintrag.only, undefined, `${k}: gilt in Web- und App-Kasse`);
    assert.ok(!text.includes('\u2014') && !text.includes('"'), k);
  }
  assert.equal(messageText('stocktake.counted', { name: 'Kornspitz', quantity: '37 Stk' }), 'Kornspitz: 37 Stk gezählt.');
  assert.equal(messageText('stocktake.unknown_code', { code: '9001234567896' }), 'Zu „9001234567896“ gibt es keinen Artikel. Bitte den Code prüfen oder den Artikel suchen.');
  assert.equal(labelText('stocktake.progress', { counted: 12, total: 40 }), '12 von 40 gezählt');
  assert.throws(() => labelText('stocktake.progress', { counted: 12 }), /\{total\}/);
  // Der Satz zum unklaren Ausgang raet zum Senden mit demselben Schluessel, nie zu einer neuen Zaehlung.
  assert.match(messageText('stocktake.outcome_unknown'), /dieselbe Zählung/);
});
