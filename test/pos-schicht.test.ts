import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getMyDrawerState, openMyShift, recordMyCashMovement, logMyDrawerOpenings, getMyShiftReport, closeMyShift,
  EUR_DENOMINATIONS, MOVEMENT_TYPES, MANUAL_MOVEMENT_TYPES, OPENING_REASONS, MANUAL_OPENING_REASONS, CASH_LOCATIONS,
  SHIFT_RECEIPT_KINDS, newIdempotencyKey,
  isPosError, POS_ERROR_CODES, MESSAGES, LABELS, messageText, labelText, findErrorRule,
  POS_DEVICE_DEFAULTS, POS_DEVICE_OPTIONAL_FIELDS, posSettingsFromWire, setMyRegisterDeviceSettings,
  type LabelKey, type MessageKey,
} from '../src/pos/index.js';
import { shiftTipLines } from '../src/pos/index.js';
import { createTransport, POS_BASE_URL, type FetchLike, type HttpRequestInit, type HttpResponseLike } from '../src/client/transport.js';
import { registerUserAuth } from '../src/client/auth.js';
import { isKasseneckValidationError, isOutcomeUnknown, KasseneckNetworkError } from '../src/client/errors.js';

/*
 * Schicht, Kassenstand und Lade-Protokoll an der Kasse (1.9.0) am Kassenweg
 * `/api/v3` gegen den Vertrags-Export (fixtures/v3/antworten/kasse.json):
 * was gesendet wird, wie gelesen wird, jeder Fehler am Code. Dazu die
 * Kataloge, der Idempotenzschluessel und die Saetze.
 */

type Json = Record<string, any>;
interface Fall { case: string; caller: string; params: Json; httpStatus: number; headers: Record<string, string>; response: Json }

const lies = (datei: string): Json => JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/${datei}`, import.meta.url)), 'utf8')) as Json;
const KASSE = lies('v3/antworten/kasse.json').endpoints as Record<string, { cases: Fall[] }>;
const VOKABULAR = lies('v3/v3-vokabular.json');
const ENDPUNKTE = ['getMyDrawerState', 'openMyShift', 'recordMyCashMovement', 'logMyDrawerOpenings', 'getMyShiftReport', 'closeMyShift'] as const;
type Endpunkt = (typeof ENDPUNKTE)[number];

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

function kassenweg(holen: FetchLike) {
  return createTransport({
    auth: registerUserAuth({ getIdToken: () => 'eyJ-ID', getSessionId: () => 'sess-1', cashregisterId: 'KASSE1' }),
    fetch: holen,
    timeoutMs: 50,
  });
}

/** Ruft den Fall ueber die Paketfunktion; `cashregisterId` der Anmeldung zaehlt beim Vergleich nur, wenn der Fall sie nennt. */
async function rufe(endpunkt: Endpunkt, f: Fall): Promise<{ ergebnis?: unknown; fehler?: unknown; gesendet: Json[] }> {
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
    getMyDrawerState: () => getMyDrawerState(r, p),
    openMyShift: () => openMyShift(r, p),
    recordMyCashMovement: () => recordMyCashMovement(r, p),
    logMyDrawerOpenings: () => logMyDrawerOpenings(r, p),
    getMyShiftReport: () => getMyShiftReport(r, p),
    closeMyShift: () => closeMyShift(r, p),
  };
  try {
    return { ergebnis: await aufrufe[endpunkt](), gesendet };
  } catch (fehler) {
    return { fehler, gesendet };
  }
}

const fall = (endpunkt: Endpunkt, name: string): Fall => {
  const f = KASSE[endpunkt]!.cases.find((c) => c.case === name);
  if (!f) throw new Error(`kasse.json: kein Fall ${endpunkt}/${name}`);
  return f;
};

/** Faelle, die das Paket schon vor dem Senden abweist (sicher falsch ohne Netz): genau diese. Fall -> Grund. */
const VOR_DEM_SENDEN: Record<string, string> = {
  'openMyShift/data_missing': 'drawerId fehlt',
  'openMyShift/key_missing': 'idempotencyKey fehlt',
  'recordMyCashMovement/data_missing': 'drawerId fehlt',
  'recordMyCashMovement/key_missing': 'idempotencyKey fehlt',
  'logMyDrawerOpenings/data_missing': 'drawerId fehlt',
  'logMyDrawerOpenings/entries_empty': 'leere Liste',
  'logMyDrawerOpenings/key_missing': 'idempotencyKey eines Eintrags leer',
  'getMyShiftReport/data_missing': 'shiftId fehlt',
  'closeMyShift/data_missing': 'shiftId fehlt',
  'closeMyShift/key_missing': 'idempotencyKey fehlt',
};

test('Kassenweg Schicht: jeder Erfolgsfall sendet die Parameter des Falls und liest das Modell wie gesendet', async () => {
  let n = 0;
  for (const endpunkt of ENDPUNKTE) {
    for (const f of KASSE[endpunkt]!.cases.filter((c) => c.response.status === 'success' && !('$body' in c.params))) {
      const { ergebnis, fehler, gesendet } = await rufe(endpunkt, f);
      assert.equal(fehler, undefined, `${endpunkt}/${f.case}: ${String(fehler)}`);
      assert.deepEqual(gesendet, [f.params], `${endpunkt}/${f.case}`);
      // Die Modelle sind die Drahtform, Feld fuer Feld: was fehlt (kein Recht), fehlt auch im Modell.
      assert.deepEqual(ergebnis, f.response.data, `${endpunkt}/${f.case}`);
      n += 1;
    }
  }
  assert.ok(n >= 18, `nur ${n} Erfolgsfaelle`);
});

test('getMyDrawerState ohne Recht shift: die offene Schicht nur mit Grunddaten, kein Betrag, kein Abschluss', async () => {
  const f = fall('getMyDrawerState', 'success_cashier_without_permission');
  const { ergebnis } = await rufe('getMyDrawerState', f);
  const stand = ergebnis as Json;
  assert.equal(stand.rights.shift, false);
  assert.deepEqual(Object.keys(stand.shift).sort(), ['cashregisterId', 'drawerId', 'id', 'number', 'openedAt', 'openedBy', 'status']);
  assert.equal(stand.shift.status, 'open');
  assert.equal(stand.shift.openedBy.name, 'Anna Chef');
  for (const feld of ['openingFloatCents', 'openingFloatTakenOver', 'runningTotals', 'expectedCents', 'blind', 'closedAt']) assert.ok(!(feld in stand.shift), feld);
});

test('getMyDrawerState: Trinkgeld je Mitarbeiter (sofort, ueber Lohn, genommen, offen), auch blind (Nachtrag 3)', async () => {
  const { ergebnis } = await rufe('getMyDrawerState', fall('getMyDrawerState', 'success_cashier_tip_taken'));
  const stand = ergebnis as Json;
  assert.equal(stand.rights.cashView, false);
  assert.ok(!('expectedCents' in stand));
  assert.deepEqual(stand.tips, [
    { registerUserId: 'ru_chef', name: 'Anna Chef', receivedImmediatelyCents: 0, retainedCents: 0, paidOutCents: 0, refundedByEmployeeCents: 0, carriedOverCents: 0, openCents: 300 },
    { registerUserId: 'ru_kellner', name: 'Ben Kellner', receivedImmediatelyCents: 400, retainedCents: 150, paidOutCents: 250, refundedByEmployeeCents: 0, carriedOverCents: 0, openCents: 150 },
  ]);
  // Ohne Trinkgeld eine leere Liste, nie ein fehlendes Feld.
  const ohne = (await rufe('getMyDrawerState', fall('getMyDrawerState', 'success_owner_new_main_drawer'))).ergebnis as Json;
  assert.deepEqual(ohne.tips, []);
});

test('getMyDrawerState: selbst zurückgegeben als eigene Zahl, schon genommen bleibt 0 (Fix-Runde 1, R62)', async () => {
  const { ergebnis } = await rufe('getMyDrawerState', fall('getMyDrawerState', 'success_cashier_tip_self_refunded'));
  assert.deepEqual((ergebnis as Json).tips, [
    { registerUserId: 'ru_kellner', name: 'Ben Kellner', receivedImmediatelyCents: 400, retainedCents: 0, paidOutCents: 0, refundedByEmployeeCents: 200, carriedOverCents: 0, openCents: 600 },
  ]);
});

test('getMyDrawerState: aus früheren Schichten als eigene Zahl (Fix-Runde 2, R64)', async () => {
  const { ergebnis } = await rufe('getMyDrawerState', fall('getMyDrawerState', 'success_cashier_tip_carried_over'));
  const [tip] = (ergebnis as Json).tips;
  assert.deepEqual(tip, { registerUserId: 'ru_kellner', name: 'Ben Kellner', receivedImmediatelyCents: 900, retainedCents: 0, paidOutCents: 0, refundedByEmployeeCents: 0, carriedOverCents: 600, openCents: 1500 });
  assert.deepEqual(shiftTipLines(tip).map((z) => [z.text, z.cents]), [['aus früheren Schichten', 600], ['verdient', 900], ['offen', 1500]]);
});

test('recordMyCashMovement: Trinkgeld an sich selbst (tip_payout + recipientId); fremd ohne cashMove ist not_permitted', async () => {
  const eigen = fall('recordMyCashMovement', 'success_cashier_tip_own');
  const { ergebnis, gesendet } = await rufe('recordMyCashMovement', eigen);
  assert.deepEqual(gesendet[0], { drawerId: 'haupt_KASSE1', type: 'tip_payout', amountCents: 250, recipientId: 'ru_kellner', idempotencyKey: 'b-6' });
  assert.equal((ergebnis as Json).movement.type, 'tip_payout');
  assert.equal((ergebnis as Json).receipt.movement.recipientName, 'Ben Kellner');
  const fremd = await rufe('recordMyCashMovement', fall('recordMyCashMovement', 'cashier_tip_foreign'));
  assert.ok(isPosError(fremd.fehler), String(fremd.fehler));
  assert.equal((fremd.fehler as { code?: string }).code, 'not_permitted');
});

test('logMyDrawerOpenings: gepufferte Eintraege senden Bediener und Lade; die Antwort nennt die wirksame Lade', async () => {
  const f = fall('logMyDrawerOpenings', 'success_operator_reported_late');
  const { ergebnis, gesendet } = await rufe('logMyDrawerOpenings', f);
  assert.deepEqual((gesendet[0]!.entries as Json[]).map((e) => [e.drawerId, e.operator.registerUserId]), [['haupt_KASSE1', 'ru_kellner'], ['haupt_KASSE1', 'ru_kellner']]);
  assert.deepEqual(ergebnis, { accepted: 2, duplicates: 0, drawerId: 'haupt_KASSE1' });
  const still = await rufe('logMyDrawerOpenings', fall('logMyDrawerOpenings', 'success_drawer_decommissioned'));
  assert.equal((still.ergebnis as Json).drawerId, 'haupt_KASSE1');
});

test('Kassenweg Schicht: jeder Fehlerfall wird am Code erkannt; vor dem Senden abgewiesen nur die benannten', async () => {
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
  for (const c of VOKABULAR.errorCodes.shift as string[]) assert.ok((POS_ERROR_CODES as readonly string[]).includes(c), c);
});

test('getMyDrawerState: ohne Lade gilt die Kasse der Anmeldung (Hauptlade), mit Lade nur die Lade', async () => {
  const gesendet: Json[] = [];
  const holen: FetchLike = async (_url, init) => {
    gesendet.push((JSON.parse(init.body) as { params: Json }).params);
    return antwortAus(fall('getMyDrawerState', 'success_owner_new_main_drawer'));
  };
  const r = kassenweg(holen);
  const ohne = await getMyDrawerState(r);
  assert.equal(ohne.shift, null);
  assert.deepEqual(ohne.recentOpenings, []);
  await getMyDrawerState(r, { drawerId: 'lade_bar' });
  assert.deepEqual(gesendet, [{ cashregisterId: 'KASSE1' }, { drawerId: 'lade_bar', cashregisterId: 'KASSE1' }]);
});

test('Blind: ohne cashView fehlen Soll, Ist, Vorschlag und Laufstand im Modell, nicht 0', async () => {
  const kassier = (await rufe('getMyDrawerState', fall('getMyDrawerState', 'success_cashier'))).ergebnis as Json;
  assert.deepEqual(kassier.rights, { shift: true, cashMove: false, cashView: false, drawer: false });
  for (const k of ['expectedCents', 'suggestedFloatCents', 'recentOpenings']) assert.equal(k in kassier, false, k);
  for (const k of ['expectedCents', 'countedCents', 'runningTotals', 'differenceCents', 'suggestedFloatCents']) assert.equal(k in kassier.shift, false, `shift.${k}`);
  const chef = (await rufe('getMyDrawerState', fall('getMyDrawerState', 'success_manager'))).ergebnis as Json;
  assert.equal(chef.expectedCents, 29400);
  assert.deepEqual(chef.shift.runningTotals.nonCashByMethod, [{ method: 'card', cents: 3200 }]);
  assert.deepEqual(chef.tipClaims, [{ registerUserId: 'ru_kellner', name: 'Ben Kellner', cents: 400 }]);
  const blind = (await rufe('closeMyShift', fall('closeMyShift', 'success_cashier_blind'))).ergebnis as Json;
  assert.equal(blind.status, 'closed');
  for (const k of ['expectedCents', 'countedCents', 'differenceCents', 'cashSalesCents', 'countedDenominations']) assert.equal(blind.receipt[k], null, k);
});

test('closeMyShift: recount ist kein Fehler, sondern ein Stand; attempt geht hinaus, wirkt aber nicht', async () => {
  const { ergebnis, gesendet } = await rufe('closeMyShift', fall('closeMyShift', 'success_cashier_recount'));
  assert.deepEqual(ergebnis, { status: 'recount' });
  assert.equal(gesendet[0]!.attempt, 1);
  const zu = (await rufe('closeMyShift', fall('closeMyShift', 'success_manager'))).ergebnis as Json;
  assert.equal(zu.status, 'closed');
  assert.equal(zu.lastShiftOfRegister, true);
  assert.equal(zu.receipt.kind, 'shift_close');
});

test('Vor dem Senden: Betraege als Ganzzahl, genau eine Startgeld-Angabe, Pflichtkennungen', async () => {
  const nie: FetchLike = async () => { throw new Error('darf nicht senden'); };
  const r = kassenweg(nie);
  const abgewiesen = async (p: Promise<unknown>, muster: RegExp) => {
    await assert.rejects(p, (e) => isKasseneckValidationError(e) && e.scope === 'request' && muster.test(e.message));
  };
  await abgewiesen(openMyShift(r, { idempotencyKey: 'o', drawerId: 'lade_bar', openingFloatCents: 12.5 }), /openingFloatCents/);
  await abgewiesen(recordMyCashMovement(r, { idempotencyKey: 'b', drawerId: 'lade_bar', type: 'owner_deposit', amountCents: 1.5 }), /amountCents/);
  await abgewiesen(closeMyShift(r, { idempotencyKey: 'z', shiftId: 's1', countedCents: Number.NaN }), /countedCents/);
  await abgewiesen(closeMyShift(r, { idempotencyKey: 'z', shiftId: 's1', countedCents: 100, tipPayouts: [{ registerUserId: 'ru', cents: 0.5 }] }), /tipPayouts/);
  await abgewiesen(logMyDrawerOpenings(r, { drawerId: 'lade_bar', entries: [] }), /entries/);
  await abgewiesen(getMyShiftReport(r, { shiftId: '' }), /shiftId/);
  await abgewiesen(openMyShift(r, { idempotencyKey: 'x'.repeat(121), drawerId: 'lade_bar', takeOver: true }), /idempotencyKey/);
  await abgewiesen(recordMyCashMovement(r, { idempotencyKey: 'b', drawerId: 'lade_bar', type: 'cash_drop', amountCents: 100, location: 'cellar' as never }), /location/);
  await abgewiesen(recordMyCashMovement(r, { idempotencyKey: 'b', drawerId: 'lade_bar', type: 'cash_drop', amountCents: 100, location: '' as never }), /location/);
  await abgewiesen(closeMyShift(r, { idempotencyKey: 'z', shiftId: 's1', countedCents: 100, afterCount: { type: 'cash_drop', amountCents: 0.5 } }), /afterCount\.amountCents/);
  await abgewiesen(closeMyShift(r, { idempotencyKey: 'z', shiftId: 's1', countedCents: 100, afterCount: [] as never }), /afterCount/);
});

test('closeMyShift: Entnehmen/Einlegen nach dem Zaehlen geht hinaus; Schicht, Z-Bon und Bon fuers Kuvert kommen zurueck (Wechselgeld)', async () => {
  const { ergebnis, gesendet } = await rufe('closeMyShift', fall('closeMyShift', 'success_manager_take_out'));
  assert.deepEqual(gesendet[0]!.afterCount, { type: 'cash_drop', amountCents: 14000 });
  const zu = ergebnis as Json;
  assert.deepEqual(zu.shift.afterCount, { type: 'cash_drop', amountCents: 14000 });
  assert.equal(zu.shift.leftInDrawerCents, 15000);
  assert.deepEqual(zu.receipt.afterCount, { type: 'cash_drop', amountCents: 14000 });
  assert.equal(zu.receipt.leftInDrawerCents, 15000);
  assert.equal(zu.afterCountReceipt.kind, 'cash_movement');
  assert.equal(zu.afterCountReceipt.movement.type, 'cash_drop');
  assert.equal(zu.afterCountReceipt.movement.amountCents, -14000);
  // Ohne Geldbewegung fehlen alle drei (der Abschluss bleibt wie bisher).
  const ohne = (await rufe('closeMyShift', fall('closeMyShift', 'success_manager'))).ergebnis as Json;
  for (const feld of ['afterCount', 'leftInDrawerCents']) {
    assert.ok(!(feld in ohne.shift), feld);
    assert.ok(!(feld in ohne.receipt), feld);
  }
  assert.ok(!('afterCountReceipt' in ohne));
  // Ohne Recht cashMove: eigener Code, die Kasse erkennt ihn.
  const ohneRecht = await rufe('closeMyShift', fall('closeMyShift', 'cashier_after_count_without_permission'));
  assert.ok(isPosError(ohneRecht.fehler, 'after_count_not_permitted'), String(ohneRecht.fehler));
});

test('getMyDrawerState: Wechselgeld der Lade und „von Schicht N übernommen“ nur, wenn gesendet', async () => {
  const mit = (await rufe('getMyDrawerState', fall('getMyDrawerState', 'success_manager_change_in'))).ergebnis as Json;
  assert.equal(mit.drawer.changeFloatCents, 15000);
  assert.equal(typeof mit.suggestedFromShiftNumber, 'number');
  const ohne = (await rufe('getMyDrawerState', fall('getMyDrawerState', 'success_manager'))).ergebnis as Json;
  assert.ok(!('changeFloatCents' in ohne.drawer));
  assert.ok(!('suggestedFromShiftNumber' in ohne));
});

test('Ort ist freiwillig: Wechselgeld ohne location geht hinaus, wie der Vertragsfall', async () => {
  const f = fall('recordMyCashMovement', 'success_manager_change_in_without_location');
  assert.equal('location' in f.params, false);
  const { ergebnis, fehler, gesendet } = await rufe('recordMyCashMovement', f);
  assert.equal(fehler, undefined);
  assert.equal(gesendet.length, 1);
  assert.equal('location' in gesendet[0]!, false);
  const r = ergebnis as Json;
  assert.equal(r.movement.type, 'change_in');
  assert.equal(r.movement.location, null);
  assert.equal(r.receipt.movement.location, null);
});

test('Unklarer Ausgang: Oeffnen, Bewegung, Protokoll und Abschluss sind unknown, Lesen bleibt rejected', async () => {
  const haengt: FetchLike = (_url, init) => new Promise((_, ab) => init.signal.addEventListener('abort', () => ab(new Error('abgebrochen')), { once: true }));
  const r = kassenweg(haengt);
  const unklar = [
    openMyShift(r, { idempotencyKey: 'o-1', drawerId: 'lade_bar', takeOver: true }),
    recordMyCashMovement(r, { idempotencyKey: 'b-1', drawerId: 'lade_bar', type: 'owner_deposit', amountCents: 1000 }),
    logMyDrawerOpenings(r, { drawerId: 'lade_bar', entries: [{ idempotencyKey: 'l-1', reason: 'check', ok: true, deviceTime: 1790409540000 }] }),
    closeMyShift(r, { idempotencyKey: 'z-1', shiftId: 'lade_bar_s2', countedCents: 2800 }),
  ];
  for (const p of unklar) await assert.rejects(p, (e) => e instanceof KasseneckNetworkError && isOutcomeUnknown(e));
  await assert.rejects(getMyDrawerState(r, { drawerId: 'lade_bar' }), (e) => e instanceof KasseneckNetworkError && e.outcome === 'rejected');
  await assert.rejects(getMyShiftReport(r, { shiftId: 'lade_bar_s2' }), (e) => e instanceof KasseneckNetworkError && e.outcome === 'rejected');
});

test('Kaputte Antwort: ein Betrag, der keine Ganzzahl ist, ist ein Antwortfehler, nie 0', async () => {
  const f = structuredClone(fall('getMyDrawerState', 'success_manager'));
  f.response.data.expectedCents = '29400';
  await assert.rejects(rufe('getMyDrawerState', f).then((r) => { if (r.fehler) throw r.fehler; }), (e) => isKasseneckValidationError(e) && e.scope === 'response');
  const g = structuredClone(fall('closeMyShift', 'success_manager'));
  g.response.data.status = 'vielleicht';
  await assert.rejects(rufe('closeMyShift', g).then((r) => { if (r.fehler) throw r.fehler; }), (e) => isKasseneckValidationError(e) && e.scope === 'response');
});

test('Kataloge: Bewegungsarten, Orte, Oeffnungsgruende, Bon-Arten sind die des /v3-Vokabulars', () => {
  const werte = (k: string) => Object.values(VOKABULAR.catalogs[k] as Record<string, string>);
  assert.deepEqual([...MOVEMENT_TYPES], werte('KASSEN_BEWEGUNG_ART'));
  assert.deepEqual([...CASH_LOCATIONS], werte('KASSEN_ORT'));
  assert.deepEqual([...OPENING_REASONS], werte('LADE_OEFFNUNG_GRUND'));
  assert.deepEqual([...SHIFT_RECEIPT_KINDS].sort(), werte('SCHICHT_BON_ART').sort());
  // Von Hand senden darf die Kasse genau diese (der Rest vergibt der Server).
  assert.deepEqual([...MANUAL_MOVEMENT_TYPES], ['change_in', 'cash_drop', 'owner_deposit', 'owner_withdrawal', 'tip_payout', 'other_in', 'other_out', 'transfer_out']);
  assert.deepEqual([...MANUAL_OPENING_REASONS], ['change', 'check', 'misoperation', 'other']);
  // Scheine und Muenzen in Euro-Cent, vom groessten Schein abwaerts.
  assert.deepEqual([...EUR_DENOMINATIONS], [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]);
  assert.ok(Object.isFrozen(EUR_DENOMINATIONS) && Object.isFrozen(MOVEMENT_TYPES));
});

test('newIdempotencyKey: kasse- und 32 Hex-Zeichen aus sicherem Zufall, jedes Mal neu', () => {
  const schluessel = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const k = newIdempotencyKey();
    assert.match(k, /^kasse-[0-9a-f]{32}$/);
    schluessel.add(k);
  }
  assert.equal(schluessel.size, 200);
});

test('Geraete-Einstellung drawerId: optional wie am Draht, ohne Standardwert; schreiben mit Kennung oder null', async () => {
  assert.deepEqual([...POS_DEVICE_OPTIONAL_FIELDS], ['drawerId']);
  assert.equal('drawerId' in POS_DEVICE_DEFAULTS, false);
  assert.equal('drawerId' in posSettingsFromWire({ device: {} }).device, false);
  assert.equal(posSettingsFromWire({ device: { drawerId: 'lade_bar' } }).device.drawerId, 'lade_bar');
  // Was keine Kennung ist, kommt nicht ins Modell (der Server sendet es so nie).
  for (const fremd of [null, '', 'lade bar', 7]) assert.equal('drawerId' in posSettingsFromWire({ device: { drawerId: fremd } }).device, false, String(fremd));
  // Das Vokabular kennt das Feld.
  assert.equal((VOKABULAR.schemas.getKasseSettings.data.device as Json).drawerId, 'ladeId');
  const gesendet: Json[] = [];
  const holen: FetchLike = async (_url, init) => {
    gesendet.push((JSON.parse(init.body) as { params: Json }).params);
    return antwortAus({ httpStatus: 200, headers: { 'Kasseneck-Api-Version': 'v3' }, response: { status: 'success', message: '', data: { device: { drawerId: 'lade_bar' } } } });
  };
  const r = kassenweg(holen);
  assert.equal((await setMyRegisterDeviceSettings(r, 'dev_pin', { drawerId: 'lade_bar' })).drawerId, 'lade_bar');
  await setMyRegisterDeviceSettings(r, 'dev_pin', { drawerId: null });
  assert.deepEqual(gesendet.map((p) => p.device), [{ drawerId: 'lade_bar' }, { drawerId: null }]);
  for (const falsch of ['', 'lade bar', 12]) {
    await assert.rejects(setMyRegisterDeviceSettings(r, 'dev_pin', { drawerId: falsch as never }), (e) => isKasseneckValidationError(e) && /device\.drawerId/.test(e.message));
  }
  assert.equal(gesendet.length, 2);
});

test('Saetze und Beschriftungen der Schicht: Wortlaut exakt, beide Seiten, kein Geviertstrich', () => {
  const meldungen: Record<string, string> = {
    'shift.required': 'Bitte zuerst die Schicht öffnen.',
    'shift.required_other': 'Die Schicht muss ein berechtigter Mitarbeiter öffnen.',
    'shift.recount': 'Bitte noch einmal zählen.',
    'shift.comment_required': 'Die Abweichung ist größer als erlaubt – bitte kurz begründen.',
    'shift.closed': 'Schicht {number} geschlossen.',
    'shift.long_open': 'Die Schicht läuft seit {since}.',
    'shift.already_open': 'An dieser Lade läuft schon eine Schicht.',
    'shift.already_closed': 'Diese Schicht ist schon geschlossen.',
    'shift.recount_exhausted': 'Es wurde schon zweimal gezählt. Bitte den Betrag der zweiten Zählung senden oder den Chef rufen.',
    'shift.mode_off': 'An dieser Lade ist der Schichtbetrieb aus. Bitte im Panel einschalten.',
    'shift.outcome_unknown': 'Unklar, ob das angekommen ist. „Erneut senden“ schickt denselben Vorgang – er zählt nur einmal.',
    'cash_movement.exceeds_balance': 'So viel Bargeld ist laut Kassenstand nicht in der Lade.',
    'cash_movement.note_required': 'Bitte einen Grund eingeben.',
    'cash_movement.booked': '{type} über {amount} gebucht.',
    'cash_movement.type_invalid': 'Diese Art der Kassenbewegung ist hier nicht möglich.',
    'cash_movement.same_drawer': 'Eine Umbuchung in dieselbe Lade geht nicht. Bitte eine andere Lade wählen.',
    'tip_payout.exceeds_claim': 'Mehr als der offene Anspruch kann nicht ausgezahlt werden.',
    'denominations.invalid': 'Scheine und Münzen ergeben nicht den Betrag.',
    'amount.invalid': 'Bitte einen gültigen Betrag eingeben.',
    'drawer.not_found': 'Diese Lade gibt es nicht mehr. Bitte im Panel die Lade dieses Geräts prüfen.',
    'drawer.inactive': 'Diese Lade ist stillgelegt. Bitte im Panel eine andere Lade zuordnen.',
  };
  const beschriftungen: Record<string, string> = {
    'shift.open_title': 'Schicht öffnen',
    'shift.take_over': 'Bestand übernehmen',
    'shift.count': 'Zählen',
    'shift.by_denomination': 'Nach Scheinen und Münzen',
    'shift.close_title': 'Schicht schließen',
    'shift.cash_title': 'Kassenstand',
    'shift.x_report': 'Zwischenbericht',
    'shift.pay_out_tips': 'Trinkgeld auszahlen',
    'shift_receipt.tips': 'Trinkgeld',
    'shift_receipt.tip_earned': 'verdient',
    'shift_receipt.tip_retained': 'über Lohn',
    'shift_receipt.tip_paid_out': 'schon genommen',
    'shift_receipt.tip_open': 'offen',
    'drawer.reason_title': 'Warum öffnen Sie die Lade?',
    'drawer.reason_change': 'Wechselgeld',
    'drawer.reason_check': 'Kontrolle',
    'drawer.reason_misoperation': 'Fehlbedienung',
    'drawer.reason_other': 'Sonstiges',
    'cash_movement.type_change_in': 'Wechselgeld',
    'cash_movement.type_cash_drop': 'Abschöpfung',
    'cash_movement.type_owner_deposit': 'Privateinlage',
    'cash_movement.type_owner_withdrawal': 'Privatentnahme',
    'cash_movement.type_tip_payout': 'Trinkgeld-Auszahlung',
    'cash_movement.type_other_in': 'Sonstige Einzahlung',
    'cash_movement.type_other_out': 'Sonstige Auszahlung',
    'cash_movement.type_transfer_out': 'Umbuchung',
  };
  for (const [k, text] of Object.entries(meldungen)) {
    assert.ok(k in MESSAGES, k);
    assert.equal(MESSAGES[k as MessageKey].text, text, k);
    assert.equal(MESSAGES[k as MessageKey].only, undefined, `${k}: gilt in Web- und App-Kasse`);
  }
  for (const [k, text] of Object.entries(beschriftungen)) {
    assert.ok(k in LABELS, k);
    assert.equal(LABELS[k as LabelKey].text, text, k);
    assert.equal(LABELS[k as LabelKey].only, undefined, k);
  }
  // Jede Bewegungsart hat ihre Beschriftung (auch die, die nur der Server vergibt: sie stehen auf dem Bon).
  for (const art of MOVEMENT_TYPES) assert.ok(`cash_movement.type_${art}` in LABELS, art);
  // Die Bons tragen keinen Hinweis „Kein Registrierkassenbeleg“ mehr; der Text ist weg, nicht nur ungenutzt.
  assert.ok(!('shift.not_a_receipt' in LABELS));
  // „sofort“ steht nirgends mehr (Nachtrag 3: verdient, über Lohn, schon genommen, offen).
  assert.ok(!('shift_receipt.tip_immediately' in LABELS));
  assert.ok(!Object.values(LABELS as Record<string, { text: string }>).some((l) => /Registrierkassenbeleg/.test(l.text)));
  for (const grund of MANUAL_OPENING_REASONS) assert.ok(`drawer.reason_${grund}` in LABELS, grund);
  assert.equal(messageText('shift.closed', { number: 3 }), 'Schicht 3 geschlossen.');
  assert.equal(messageText('cash_movement.booked', { type: labelText('cash_movement.type_cash_drop'), amount: '200,00 €' }), 'Abschöpfung über 200,00 € gebucht.');
  assert.match(messageText('shift.outcome_unknown'), /denselben Vorgang/);
});

test('Fehlerregeln: jeder neue Schicht-Code zeigt seinen Satz, nie den Satz des Backends', () => {
  const regeln: Record<string, MessageKey> = {
    shift_not_open: 'shift.required',
    shift_already_open: 'shift.already_open',
    shift_closed: 'shift.already_closed',
    comment_required: 'shift.comment_required',
    recount_exhausted: 'shift.recount_exhausted',
    cash_movement_exceeds_balance: 'cash_movement.exceeds_balance',
    note_required: 'cash_movement.note_required',
    invalid_movement_type: 'cash_movement.type_invalid',
    transfer_same_drawer: 'cash_movement.same_drawer',
    tip_payout_exceeds_claim: 'tip_payout.exceeds_claim',
    invalid_denominations: 'denominations.invalid',
    invalid_amount: 'amount.invalid',
    drawer_not_found: 'drawer.not_found',
    drawer_inactive: 'drawer.inactive',
  };
  for (const [code, key] of Object.entries(regeln)) {
    const regel = findErrorRule('api', { code });
    assert.ok('key' in regel && regel.key === key, `${code} -> ${JSON.stringify(regel)}`);
  }
  // Codes mit lesbarem Satz des Backends bleiben dabei.
  for (const code of ['validation', 'module_inactive', 'not_permitted', 'idempotency_conflict']) {
    assert.deepEqual(findErrorRule('api', { code }), { kind: 'api', behavior: 'server_text' }, code);
  }
});
