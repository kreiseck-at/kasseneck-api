import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listMyCashregisters } from '../src/client/cashregisters.js';
import { listMyReceipts } from '../src/client/receipts.js';
import { createKasseneckApi } from '../src/client/api.js';
import {
  createTransport,
  DEFAULT_BASE_URL,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
} from '../src/client/transport.js';
import { apiKeyAuth, registerUserAuth } from '../src/client/auth.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import { KeckPaymentMethod, ReceiptType } from '../src/enums/index.js';

/**
 * Vertragstests der beiden Listen-Endpunkte.
 *
 * Endpunktname, Parameternamen und Antwortform sind aus `origin/main`
 * (functions/index.js, `listMyCashregisters` und `listMyReceipts` samt
 * `projectReceiptForCustomer`) **abgeschrieben** — nicht aus dieser Umsetzung
 * abgeleitet. Die Falle sitzt beim Parameternamen: der Endpunkt verlangt
 * `cashregisterid` **klein**, waehrend die Anmeldung `cashregisterId` in die
 * Nutzlast legt. Ein Tippfehler hier faellt der Typpruefung nicht auf.
 */

const API_KEY = 'kr_live_GEHEIMERAPIKEY';
const KASSEN_TOKEN = 'cb_live_GEHEIMESKASSENTOKEN';
const ID_TOKEN = 'eyJ-GEHEIMESIDTOKEN';
const SITZUNG = 'sess-GEHEIMESITZUNG';
const KASSEN_ID = 'kasse-1';

interface Aufruf {
  url: string;
  init: HttpRequestInit;
}

function antwort(rumpf: string): HttpResponseLike {
  return {
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
  };
}

const erfolg = (daten: unknown): HttpResponseLike =>
  antwort(JSON.stringify({ status: 'success', message: '', data: daten }));

function fetchFake(antwortWert: HttpResponseLike): { holen: FetchLike; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const holen: FetchLike = async (url, init) => {
    aufrufe.push({ url, init });
    return antwortWert;
  };
  return { holen, aufrufe };
}

const rumpfVon = (aufruf: Aufruf): { params: Record<string, unknown> } =>
  JSON.parse(aufruf.init.body) as { params: Record<string, unknown> };

/** Antwort von `listMyCashregisters`, woertlich nachgebaut. */
const KASSEN_ANTWORT = {
  cashregisters: [
    {
      id: 'kasse-1',
      label: 'Schank',
      description: null,
      create_time: '2026-01-05T09:00:00.000Z',
      signature_id: 'sig-42',
      token: null,
      onboarding: {
        cashbox_registered: true,
        startbeleg_created: true,
        startbeleg_transmitted: true,
        cashbox_registered_at: '2026-01-05T09:05:00.000Z',
        startbeleg_created_at: '2026-01-05T09:06:00.000Z',
        startbeleg_transmitted_at: '2026-01-05T09:07:00.000Z',
      },
    },
    {
      id: 'kasse-2',
      label: null,
      description: null,
      create_time: null,
      signature_id: null,
      token: null,
      onboarding: {
        cashbox_registered: false,
        startbeleg_created: false,
        startbeleg_transmitted: false,
        cashbox_registered_at: null,
        startbeleg_created_at: null,
        startbeleg_transmitted_at: null,
      },
    },
  ],
};

/** Antwort von `listMyReceipts`, woertlich nachgebaut. */
const BELEGLISTE_ANTWORT = {
  receipts: [
    {
      receiptId: 'r-2',
      counter: 2,
      receiptType: 'standard',
      timeStamp: '2026-08-13T10:15:00',
      total: 19.9,
      paymentMethod: 'cash',
      transmission_status: 'success',
      ts_transmission: '2026-08-13T10:16:00',
      signature_ok: true,
    },
    {
      receiptId: 'r-1',
      counter: 1,
      receiptType: 'start',
      timeStamp: '2026-08-13T09:00:00',
      total: 0,
      paymentMethod: null,
      transmission_status: null,
      ts_transmission: null,
      signature_ok: true,
    },
  ],
  stats: {
    today: { umsatz: 19.9, count: 2 },
    trendPct: 25,
    days: [
      { date: '2026-08-07', umsatz: 0 },
      { date: '2026-08-08', umsatz: 12.5 },
      { date: '2026-08-09', umsatz: 0 },
      { date: '2026-08-10', umsatz: 0 },
      { date: '2026-08-11', umsatz: 0 },
      { date: '2026-08-12', umsatz: 15.92 },
      { date: '2026-08-13', umsatz: 19.9 },
    ],
  },
};

function kassenBenutzerWeg(antwortWert: HttpResponseLike) {
  const { holen, aufrufe } = fetchFake(antwortWert);
  const rufen = createTransport({
    auth: registerUserAuth({
      getIdToken: () => ID_TOKEN,
      getSessionId: () => SITZUNG,
      cashregisterId: KASSEN_ID,
    }),
    fetch: holen,
  });
  return { rufen, aufrufe };
}

function apiSchluesselWeg(antwortWert: HttpResponseLike) {
  const { holen, aufrufe } = fetchFake(antwortWert);
  const rufen = createTransport({
    auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }),
    fetch: holen,
  });
  return { rufen, aufrufe };
}

// ------------------------------------------------------- listMyCashregisters

test('listMyCashregisters: Endpunktname und leere Nutzlast', async () => {
  const { rufen, aufrufe } = kassenBenutzerWeg(erfolg(KASSEN_ANTWORT));
  await listMyCashregisters(rufen);

  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0]?.url, `${DEFAULT_BASE_URL}/listMyCashregisters`);
  // Nur die Kassenbindung der Anmeldung, kein eigener Parameter.
  assert.deepEqual(rumpfVon(aufrufe[0]!).params, { cashregisterId: KASSEN_ID });
});

test('listMyCashregisters: beide Anmeldewege setzen ihre eigenen Kopfzeilen', async () => {
  const kasse = kassenBenutzerWeg(erfolg(KASSEN_ANTWORT));
  await listMyCashregisters(kasse.rufen);
  assert.equal(kasse.aufrufe[0]?.init.headers['Authorization'], `Bearer ${ID_TOKEN}`);
  assert.equal(kasse.aufrufe[0]?.init.headers['register-session'], SITZUNG);

  const geraet = apiSchluesselWeg(erfolg(KASSEN_ANTWORT));
  await listMyCashregisters(geraet.rufen);
  assert.equal(geraet.aufrufe[0]?.init.headers['Authorization'], `Bearer ${API_KEY}`);
  assert.equal(geraet.aufrufe[0]?.init.headers['cashregister-token'], KASSEN_TOKEN);
});

test('listMyCashregisters: liest die Kassen samt Inbetriebnahme-Stand', async () => {
  const { rufen } = kassenBenutzerWeg(erfolg(KASSEN_ANTWORT));
  const kassen = await listMyCashregisters(rufen);

  assert.equal(kassen.length, 2);
  assert.equal(kassen[0]?.id, 'kasse-1');
  assert.equal(kassen[0]?.label, 'Schank');
  assert.equal(kassen[0]?.createTime?.toISOString(), '2026-01-05T09:00:00.000Z');
  assert.equal(kassen[0]?.signatureId, 'sig-42');
  assert.equal(kassen[0]?.token, undefined, 'fuer Kassen-Benutzer sendet das Backend null');
  assert.equal(kassen[0]?.onboarding.startbelegTransmitted, true);

  // Zweite Kasse: alles null — und daraus wird nichts erfunden.
  assert.equal(kassen[1]?.id, 'kasse-2');
  assert.equal(kassen[1]?.createTime, undefined);
  assert.equal(kassen[1]?.label, undefined);
  assert.equal(kassen[1]?.onboarding.cashboxRegistered, false);
});

test('listMyCashregisters: eine Antwort ohne Liste ist ein Antwortfehler', async () => {
  const { rufen } = kassenBenutzerWeg(erfolg({ irgendwas: true }));
  await assert.rejects(listMyCashregisters(rufen), (fehler: unknown) => {
    assert.ok(isKasseneckValidationError(fehler));
    assert.equal(fehler.scope, 'response');
    assert.equal(fehler.functionName, 'listMyCashregisters');
    return true;
  });
});

// ------------------------------------------------------------ listMyReceipts

test('listMyReceipts: Kassen-ID geht als "cashregisterid" klein geschrieben raus', async () => {
  const { rufen, aufrufe } = kassenBenutzerWeg(erfolg(BELEGLISTE_ANTWORT));
  await listMyReceipts(rufen, { cashregisterId: KASSEN_ID });

  assert.equal(aufrufe[0]?.url, `${DEFAULT_BASE_URL}/listMyReceipts`);
  const params = rumpfVon(aufrufe[0]!).params;
  // Der Pflichtparameter des Backends heisst klein geschrieben; die Anmeldung
  // legt daneben ihr cashregisterId. Beide muessen da sein.
  assert.equal(params['cashregisterid'], KASSEN_ID);
  assert.equal(params['cashregisterId'], KASSEN_ID);
  assert.equal('limit' in params, false, 'ohne Angabe darf kein limit gesendet werden');
});

test('listMyReceipts: limit geht als Zahl mit', async () => {
  const { rufen, aufrufe } = kassenBenutzerWeg(erfolg(BELEGLISTE_ANTWORT));
  await listMyReceipts(rufen, { cashregisterId: KASSEN_ID, limit: 20 });
  assert.equal(rumpfVon(aufrufe[0]!).params['limit'], 20);
});

test('listMyReceipts: unbrauchbares limit wird abgelehnt, bevor etwas rausgeht', async () => {
  for (const limit of [0, -5, 12.5, Number.NaN]) {
    const { rufen, aufrufe } = kassenBenutzerWeg(erfolg(BELEGLISTE_ANTWORT));
    await assert.rejects(listMyReceipts(rufen, { cashregisterId: KASSEN_ID, limit }), (fehler: unknown) => {
      assert.ok(isKasseneckValidationError(fehler), `limit ${limit}`);
      assert.equal(fehler.scope, 'request');
      return true;
    });
    assert.equal(aufrufe.length, 0, `limit ${limit}: es darf nichts gesendet werden`);
  }
});

test('listMyReceipts: fehlende Kassen-ID wird abgelehnt, bevor etwas rausgeht', async () => {
  const { rufen, aufrufe } = kassenBenutzerWeg(erfolg(BELEGLISTE_ANTWORT));
  await assert.rejects(listMyReceipts(rufen, { cashregisterId: '  ' }), (fehler: unknown) => {
    assert.ok(isKasseneckValidationError(fehler));
    assert.equal(fehler.scope, 'request');
    return true;
  });
  assert.equal(aufrufe.length, 0);
});

test('listMyReceipts: liest Belegzeilen und Kennzahlen in ganzen Cent', async () => {
  const { rufen } = kassenBenutzerWeg(erfolg(BELEGLISTE_ANTWORT));
  const liste = await listMyReceipts(rufen, { cashregisterId: KASSEN_ID });

  assert.equal(liste.receipts.length, 2);
  assert.equal(liste.receipts[0]?.receiptId, 'r-2');
  assert.equal(liste.receipts[0]?.totalCents, 1990);
  assert.equal(liste.receipts[0]?.receiptType, ReceiptType.standard);
  assert.equal(liste.receipts[0]?.paymentMethod, KeckPaymentMethod.cash);
  assert.equal(liste.receipts[0]?.transmissionStatus, 'success');
  assert.equal(liste.receipts[1]?.receiptType, ReceiptType.start);
  assert.equal(liste.receipts[1]?.totalCents, 0);

  assert.deepEqual(liste.stats.today, { revenueCents: 1990, count: 2 });
  assert.equal(liste.stats.trendPercent, 25);
  assert.equal(liste.stats.days.length, 7);
  assert.deepEqual(liste.stats.days[5], { date: '2026-08-12', revenueCents: 1592 });
});

test('listMyReceipts: fehlende Kennzahlen machen die Belegliste nicht unbrauchbar', async () => {
  const { rufen } = kassenBenutzerWeg(erfolg({ receipts: BELEGLISTE_ANTWORT.receipts }));
  const liste = await listMyReceipts(rufen, { cashregisterId: KASSEN_ID });
  assert.equal(liste.receipts.length, 2);
  assert.deepEqual(liste.stats, { today: { revenueCents: 0, count: 0 }, trendPercent: null, days: [] });
});

test('listMyReceipts: eine Antwort ohne Belegliste ist ein Antwortfehler', async () => {
  const { rufen } = kassenBenutzerWeg(erfolg({ stats: BELEGLISTE_ANTWORT.stats }));
  await assert.rejects(listMyReceipts(rufen, { cashregisterId: KASSEN_ID }), (fehler: unknown) => {
    assert.ok(isKasseneckValidationError(fehler));
    assert.equal(fehler.scope, 'response');
    assert.equal(fehler.functionName, 'listMyReceipts');
    return true;
  });
});

// ------------------------------------------------------------------ Fassade

test('die Fassade bindet beide Listen-Aufrufe an denselben Transport', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(KASSEN_ANTWORT));
  const api = createKasseneckApi({
    auth: registerUserAuth({ getIdToken: () => ID_TOKEN, getSessionId: () => SITZUNG, cashregisterId: KASSEN_ID }),
    fetch: holen,
  });
  await api.listMyCashregisters();

  const { holen: holen2, aufrufe: aufrufe2 } = fetchFake(erfolg(BELEGLISTE_ANTWORT));
  const api2 = createKasseneckApi({
    auth: registerUserAuth({ getIdToken: () => ID_TOKEN, getSessionId: () => SITZUNG, cashregisterId: KASSEN_ID }),
    fetch: holen2,
  });
  await api2.listMyReceipts({ cashregisterId: KASSEN_ID });

  assert.equal(aufrufe[0]?.url, `${DEFAULT_BASE_URL}/listMyCashregisters`);
  assert.equal(aufrufe2[0]?.url, `${DEFAULT_BASE_URL}/listMyReceipts`);
});
