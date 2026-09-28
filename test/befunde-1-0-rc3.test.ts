import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listMyCashregisters } from '../src/client/cashregisters.js';
import { sendReceiptEmail } from '../src/client/receipts.js';
import { fromCashregisterPayload, type CashregisterPayload } from '../src/models/index.js';
import {
  POS_SHORTCUT_DEFAULTS, listMyPrinters, createPrintJob, getPrintJob, setMyRegisterDeviceSettings, posSettingsChanges,
  mergePosSettings, POS_DEVICE_DEFAULTS, type PosDeviceSettings,
} from '../src/pos/index.js';
import { createTransport, type FetchLike, type HttpRequestInit, type HttpResponseLike } from '../src/client/transport.js';
import { apiKeyAuth, registerUserAuth } from '../src/client/auth.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import type { ReceiptLayout } from '../src/receipt/layout.js';

/*
 * Befunde des Dart-Zwillings (kasseneck_api 10.0.0) an 1.0.0-rc.2, gegen den
 * Vertrags-Export des Backends (fixtures/v3/antworten).
 *
 * Rot-Probe, jeder Fall am Stand rc.2 belegt:
 * - B1: `fromCashregisterPayload` las `startbeleg_*` -> Inbetriebnahme immer
 *   „Startbeleg fehlt“, und der Lesewaechter meldet die fremden Schluessel.
 * - B2: `sendReceiptEmail` warf ohne `to`/`at` -> der Aufrufer schickte nach
 *   einer schon verschickten Mail ein zweites Mal.
 * - B3: ohne `printers` kam eine leere Liste, ohne `jobId` ein Job mit `''`
 *   bzw. der erfragten Kennung.
 * - B4: eine halbe Tastenkarte ging hinaus; der Server prueft Doppelbelegungen
 *   nur in der gesendeten Karte.
 */

type Json = Record<string, any>;
interface KassenFall {
  case: string;
  params: Json;
  httpStatus: number;
  headers: Record<string, string>;
  response: Json;
}

const lies = (datei: string): Json =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/v3/${datei}`, import.meta.url)), 'utf8')) as Json;
const KASSE = lies('antworten/kasse.json').endpoints as Record<string, { cases: KassenFall[] }>;
const BELEGMAIL = lies('antworten/belegmail.json').cases as (KassenFall & { name: string })[];

function antwortAus(f: { httpStatus: number; headers: Record<string, string>; response: Json }): HttpResponseLike {
  const rumpf = JSON.stringify(f.response);
  const kopf: Record<string, string> = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(f.headers)) kopf[k.toLowerCase()] = v;
  return {
    status: f.httpStatus,
    headers: { get: (name: string) => kopf[name.toLowerCase()] ?? null },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
  };
}

function weg(f: { httpStatus: number; headers: Record<string, string>; response: Json }, kasse = true) {
  const aufrufe: Json[] = [];
  const holen: FetchLike = async (_url: string, init: HttpRequestInit) => {
    aufrufe.push((JSON.parse(init.body) as { params: Json }).params);
    return antwortAus(f);
  };
  const rufen = createTransport({
    auth: kasse
      ? registerUserAuth({ getIdToken: () => 'eyJ-ID', getSessionId: () => 'sess-1', cashregisterId: 'KASSE1' })
      : apiKeyAuth({ apiKey: 'kr_test_GEHEIMERAPIKEY', cashregisterToken: 'cb_test_GEHEIMESKASSENTOKEN' }),
    fetch: holen,
  });
  return { rufen, aufrufe };
}

const kopie = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const erfolge = (endpunkt: string): KassenFall[] => {
  const liste = KASSE[endpunkt]!.cases.filter((c) => c.response.status === 'success');
  assert.ok(liste.length > 0, `${endpunkt}: keine Erfolgsfaelle im Vertrag`);
  return liste;
};
const erfolgMit = (endpunkt: string, daten: (d: Json) => void): KassenFall => {
  const f = kopie(erfolge(endpunkt)[0]!);
  daten(f.response.data);
  return f;
};

async function wurf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  assert.fail('Fehler erwartet');
}

function antwortfehler(e: unknown, name: string): void {
  assert.ok(isKasseneckValidationError(e), `${name}: KasseneckValidationError erwartet`);
  assert.equal(e.scope, 'response');
  assert.equal(e.functionName, name);
}

// --- B1: listMyCashregisters liest die Schluessel des Vertrags -------------------

test('B1: listMyCashregisters liest die Inbetriebnahme unter start_receipt_* (Vertrag /v3)', async () => {
  for (const f of erfolge('listMyCashregisters')) {
    const kassen = await listMyCashregisters(weg(f).rufen);
    const roh = f.response.data.cashregisters as Json[];
    assert.equal(kassen.length, roh.length, f.case);
    roh.forEach((r, i) => {
      const ob = kassen[i]!.onboarding;
      assert.equal(kassen[i]!.id, r.id, f.case);
      assert.equal(ob.cashboxRegistered, r.onboarding.cashbox_registered === true, `${f.case}/${r.id}`);
      assert.equal(ob.startbelegCreated, r.onboarding.start_receipt_created === true, `${f.case}/${r.id}: Startbeleg erzeugt`);
      assert.equal(ob.startbelegTransmitted, r.onboarding.start_receipt_transmitted === true, `${f.case}/${r.id}: Startbeleg uebermittelt`);
    });
  }
  // Mindestens eine Kasse des Vertrags hat den Startbeleg: sonst waere die
  // Pruefung oben mit dem alten Schluessel ebenfalls gruen.
  assert.ok(erfolge('listMyCashregisters').some((f) => f.response.data.cashregisters.some((r: Json) => r.onboarding.start_receipt_created === true)));
});

test('B1: die Zeitpunkte der Inbetriebnahme kommen aus start_receipt_*_at', () => {
  const r = kopie(erfolge('listMyCashregisters')[0]!.response.data.cashregisters[0]) as Json;
  r.onboarding.start_receipt_created_at = '2026-01-02T09:05:00.000Z';
  r.onboarding.start_receipt_transmitted_at = '2026-01-02T09:06:00.000Z';
  const k = fromCashregisterPayload(r as CashregisterPayload, 'x');
  assert.equal(k.onboarding.startbelegCreatedAt?.toISOString(), '2026-01-02T09:05:00.000Z');
  assert.equal(k.onboarding.startbelegTransmittedAt?.toISOString(), '2026-01-02T09:06:00.000Z');
});

test('B1: fromCashregisterPayload liest nur Schluessel, die der Vertrag sendet', () => {
  for (const f of erfolge('listMyCashregisters')) {
    for (const r of f.response.data.cashregisters as Json[]) {
      const gelesen = new Set<string>();
      const mitschreiben = (ziel: Json, pfad: string): Json =>
        new Proxy(ziel, {
          get(t, k) {
            if (typeof k !== 'string') return Reflect.get(t, k);
            gelesen.add(pfad + k);
            const wert = Reflect.get(t, k);
            return wert !== null && typeof wert === 'object' ? mitschreiben(wert as Json, `${pfad}${k}.`) : wert;
          },
        });
      fromCashregisterPayload(mitschreiben(r, '') as CashregisterPayload, 'x');
      const gesendet = new Set<string>();
      for (const [k, v] of Object.entries(r)) {
        gesendet.add(k);
        if (v !== null && typeof v === 'object') for (const u of Object.keys(v)) gesendet.add(`${k}.${u}`);
      }
      const fremd = [...gelesen].filter((k) => !gesendet.has(k));
      assert.deepEqual(fremd, [], `${f.case}/${r.id}: gelesen, aber nicht im Vertrag`);
    }
  }
});

// --- B2: sendReceiptEmail liest die Erfolgsantwort nachsichtig ---------------------

test('B2: fehlen to/at in der Erfolgsantwort, gilt die Mail als verschickt (kein Wurf, kein zweiter Versand)', async () => {
  const basis = BELEGMAIL.find((c) => c.response.status === 'success');
  assert.ok(basis);
  const p = basis.params;
  for (const [daten, soll] of [
    [{}, { to: p.to, at: null, via: null }],
    [{ via: 'own' }, { to: p.to, at: null, via: 'own' }],
    [{ to: 'max@example.at' }, { to: 'max@example.at', at: null, via: null }],
    [{ at: '2026-09-26T10:00:00+02:00', via: 'platform' }, { to: p.to, at: '2026-09-26T10:00:00+02:00', via: 'platform' }],
    [{ to: 42, at: 7 }, { to: p.to, at: null, via: null }],
    [{ to: '  ', at: '' }, { to: p.to, at: null, via: null }],
  ] as const) {
    const f = kopie(basis);
    f.response.data = daten;
    const { rufen, aufrufe } = weg(f, false);
    const ergebnis = await sendReceiptEmail(rufen, { fullReceiptId: p.fullReceiptId, to: p.to });
    assert.deepEqual(ergebnis, soll, JSON.stringify(daten));
    assert.equal(aufrufe.length, 1);
  }
  // Ohne data ueberhaupt ebenso.
  const ohne = kopie(basis);
  delete ohne.response.data;
  assert.deepEqual(await sendReceiptEmail(weg(ohne, false).rufen, { fullReceiptId: p.fullReceiptId, to: ` ${p.to} ` }), { to: p.to, at: null, via: null });
});

// --- B3: Druckerliste und Job-Kennung sind Pflicht der Antwort --------------------

test('B3: listMyPrinters ohne data.printers ist ein Antwortfehler, eine leere Liste bleibt leer', async () => {
  for (const daten of [(d: Json) => { delete d.printers; }, (d: Json) => { d.printers = null; }, (d: Json) => { d.printers = {}; }]) {
    antwortfehler(await wurf(listMyPrinters(weg(erfolgMit('listMyPrinters', daten)).rufen)), 'listMyPrinters');
  }
  assert.deepEqual(await listMyPrinters(weg(erfolgMit('listMyPrinters', (d) => { d.printers = []; })).rufen), []);
});

test('B3: createPrintJob und getPrintJob ohne (oder mit leerer) data.jobId sind Antwortfehler', async () => {
  const layout = erfolge('createPrintJob')[0]!.params.layout as ReceiptLayout;
  for (const daten of [(d: Json) => { delete d.jobId; }, (d: Json) => { d.jobId = ''; }, (d: Json) => { d.jobId = 7; }]) {
    antwortfehler(await wurf(createPrintJob(weg(erfolgMit('createPrintJob', daten)).rufen, { printerId: 'dr_theke', layout })), 'createPrintJob');
    antwortfehler(await wurf(getPrintJob(weg(erfolgMit('getPrintJob', daten)).rufen, { printerId: 'dr_theke', jobId: 'job1' })), 'getPrintJob');
  }
  // Mit Kennung wie bisher.
  assert.equal((await createPrintJob(weg(erfolge('createPrintJob')[0]!).rufen, { printerId: 'dr_theke', layout })).jobId, 'auto1');
  const job = erfolge('getPrintJob')[0]!;
  assert.equal((await getPrintJob(weg(job).rufen, { printerId: 'dr_theke', jobId: job.params.jobId })).jobId, job.response.data.jobId);
});

// --- B4: shortcuts nur als ganze Karte -------------------------------------------

test('B4: setMyRegisterDeviceSettings nimmt shortcuts nur als ganze Karte aller bekannten Aktionen', async () => {
  const f = KASSE.setMyRegisterDeviceSettings!.cases.find((c) => c.case === 'success_manager')!;
  // Gespeichert liegt card auf Mod+K (Vorgabe); eine halbe Karte mit cash auf
  // Mod+K saehe der Server nur fuer sich und liesse die Doppelbelegung durch.
  assert.deepEqual(POS_SHORTCUT_DEFAULTS.card, ['Mod+K']);
  for (const halb of [{ cash: ['Mod+K'] }, { ...POS_SHORTCUT_DEFAULTS, card: undefined }]) {
    const { rufen, aufrufe } = weg(f);
    const e = await wurf(setMyRegisterDeviceSettings(rufen, 'dev_pin', { shortcuts: halb } as unknown as Partial<PosDeviceSettings>));
    assert.ok(isKasseneckValidationError(e));
    assert.equal(e.scope, 'request');
    assert.match(e.reason, /device\.shortcuts: ganze Karte senden \(posSettingsChanges\), es fehlen .*card/);
    assert.equal(aufrufe.length, 0, 'nichts ging hinaus');
  }
  // Ueber posSettingsChanges geht die ganze Karte hinaus, und die Doppelbelegung faellt vorab auf.
  const vorher = mergePosSettings(POS_DEVICE_DEFAULTS, null);
  const doppelt = posSettingsChanges(vorher, { ...vorher, shortcuts: { ...vorher.shortcuts, cash: ['Mod+K'] } });
  const d = weg(f);
  const e = await wurf(setMyRegisterDeviceSettings(d.rufen, 'dev_pin', doppelt));
  assert.ok(isKasseneckValidationError(e));
  assert.match(e.reason, /Mod\+K schon belegt/);
  assert.equal(d.aufrufe.length, 0);
  const sauber = posSettingsChanges(vorher, { ...vorher, shortcuts: { ...vorher.shortcuts, cash: ['Mod+Y'] } });
  const s = weg(f);
  await setMyRegisterDeviceSettings(s.rufen, 'dev_pin', sauber);
  assert.deepEqual(Object.keys(s.aufrufe[0]!.device.shortcuts).sort(), Object.keys(POS_SHORTCUT_DEFAULTS).sort());
});
