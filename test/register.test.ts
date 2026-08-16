import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

import * as registerModul from '../src/register/index.js';
import {
  pairRegisterDevice,
  listRegisterUsersForDevice,
  unpairRegisterDevice,
  registerUserLogin,
  registerPinLogin,
  renewRegisterSession,
  endRegisterSession,
} from '../src/register/index.js';
import {
  createTransport,
  DEFAULT_BASE_URL,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
} from '../src/client/transport.js';
import { registerUserAuth } from '../src/client/auth.js';
import { createKasseneckApi } from '../src/client/api.js';
import {
  isKasseneckApiError,
  isKasseneckNetworkError,
  isKasseneckValidationError,
} from '../src/client/errors.js';

/**
 * Vertragstests der fuenf Endpunkte der Kassen-Anmeldung.
 *
 * Endpunktnamen, Parameternamen und Antwortfelder sind aus dem Backend
 * **abgeschrieben** (functions/register-endpoints.js, Zweig
 * `feat/kopplung-mit-kasse`) — nicht aus der Umsetzung in diesem Paket
 * abgeleitet. Ein Tippfehler in einer Zeichenkette sieht die Typpruefung nicht;
 * er faellt sonst erst am Geraet des Kunden auf, und beim Kopplungs-Code kostet
 * das einen verbrauchten Code.
 *
 * Der zweite Schwerpunkt ist die Geheimnis-Zusage: diese drei Aufrufe fuehren
 * **PIN**, **Geraetegeheimnis** und **Kopplungs-Code** in der Nutzlast. Keiner
 * dieser Werte darf je in einem geworfenen Fehler landen — auch nicht in einem
 * Zusatzfeld, auch nicht ueber eine verdichtete Ursache.
 */

// --- Werte, die dieser Test als Geheimnis behandelt --------------------

/** Kopplungs-Code: 8 Zeichen aus `ra.CODE_ALPHABET` (ohne 0/1/I/O). */
const CODE = 'K7NPQR34';
/** Geraetegeheimnis: 32 zufaellige Bytes als base64url (`ra.generateDeviceSecret`). */
const GERAETE_GEHEIMNIS = 'Gk7xQv9Zr2Lp4Tn8Wb3Yd6Ms1Hj5Fc0Ae7Ru2Iq4Xo';
/** PIN eines Kassen-Benutzers: 4 bis 8 Ziffern (`ra.validatePinFormat`). */
const PIN = '4711';

const geheimnisse = [CODE, GERAETE_GEHEIMNIS, PIN];

const OWNER_UID = 'owner-1';
const GERAET_ID = 'dev-1';
const BENUTZER_ID = 'ru-1';
const KASSEN_ID = 'kasse-1';

const ID_TOKEN = 'eyJ-GEHEIMESIDTOKEN';
const SITZUNG = 'sess-GEHEIMESITZUNG';

// --- Attrappen ---------------------------------------------------------

interface Aufruf {
  url: string;
  init: HttpRequestInit;
}

function antwort(
  rumpf: string,
  { status = 200, contentType = 'application/json' }: { status?: number; contentType?: string | null } = {},
): HttpResponseLike {
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
  };
}

const erfolg = (daten: unknown): HttpResponseLike =>
  antwort(JSON.stringify({ status: 'success', message: '', data: daten }));
const fachfehler = (meldung: string): HttpResponseLike =>
  antwort(JSON.stringify({ status: 'error', message: meldung }));

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

// --- Antworten des Backends, woertlich nachgebaut ----------------------

/** `pairRegisterDevice` (successResponse am Ende des Handlers). */
const KOPPLUNGS_ANTWORT = {
  deviceId: GERAET_ID,
  deviceSecret: GERAETE_GEHEIMNIS,
  ownerUid: OWNER_UID,
  cashregisterId: KASSEN_ID,
  betrieb: 'Cafe Kreiseck',
  kasse: 'Schanigarten',
};

/** `listRegisterUsersForDevice` — users samt Regel und Geraete-Modus.
 * `altbestand: true` steht NUR an Benutzern, deren PIN nicht unter der
 * aktuellen Regel gesetzt wurde (Backend laesst das Feld sonst weg). */
const BENUTZER_ANTWORT = {
  users: [
    { id: 'ru-1', name: 'Anna', kind: 'person' },
    { id: 'ru-2', name: 'Terminal 2', kind: 'device', altbestand: true },
  ],
  policy: { stellen: 4, zeichen: 'ziffern' },
  loginMode: 'auswahl',
};

/** `registerUserLogin` — customToken, sessionId, expiresAt, user{id,name,perms}. */
const ANMELDE_ANTWORT = {
  customToken: 'eyJ-CUSTOM-TOKEN',
  sessionId: 'sess-neu',
  expiresAt: 1_776_000_090_000,
  user: {
    id: BENUTZER_ID,
    name: 'Anna',
    // ra.PERMS_KASSIER
    perms: { sell: true, cancel: true, articles: false, layout: false, reports: false, takeover: false },
  },
};

// --- pairRegisterDevice ------------------------------------------------

test('pairRegisterDevice: Endpunktname und Nutzlast — nur der Code', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(KOPPLUNGS_ANTWORT));
  await pairRegisterDevice({ code: CODE, fetch: holen });

  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0]?.url, `${DEFAULT_BASE_URL}/pairRegisterDevice`);
  assert.equal(aufrufe[0]?.init.method, 'POST');
  assert.deepEqual(rumpfVon(aufrufe[0]!).params, { code: CODE });
});

test('pairRegisterDevice: label geht als "label" mit, fehlt es, wird es nicht gesendet', async () => {
  const mitLabel = fetchFake(erfolg(KOPPLUNGS_ANTWORT));
  await pairRegisterDevice({ code: CODE, label: 'Schank-Tablet', fetch: mitLabel.holen });
  assert.deepEqual(rumpfVon(mitLabel.aufrufe[0]!).params, { code: CODE, label: 'Schank-Tablet' });

  const ohneLabel = fetchFake(erfolg(KOPPLUNGS_ANTWORT));
  await pairRegisterDevice({ code: CODE, fetch: ohneLabel.holen });
  assert.equal('label' in rumpfVon(ohneLabel.aufrufe[0]!).params, false);
});

test('pairRegisterDevice: sendet keine einzige Anmelde-Kopfzeile', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(KOPPLUNGS_ANTWORT));
  await pairRegisterDevice({ code: CODE, fetch: holen });

  const kopf = aufrufe[0]!.init.headers;
  assert.equal('Authorization' in kopf, false, 'dieser Aufruf hat keine Identitaet');
  assert.equal('cashregister-token' in kopf, false);
  assert.equal('register-session' in kopf, false);
  assert.deepEqual(Object.keys(kopf), ['Content-Type']);
});

test('pairRegisterDevice: liest das gekoppelte Geraet samt Anzeigenamen', async () => {
  const { holen } = fetchFake(erfolg(KOPPLUNGS_ANTWORT));
  const geraet = await pairRegisterDevice({ code: CODE, fetch: holen });

  assert.equal(geraet.deviceId, GERAET_ID);
  assert.equal(geraet.deviceSecret, GERAETE_GEHEIMNIS);
  assert.equal(geraet.ownerUid, OWNER_UID);
  assert.equal(geraet.cashregisterId, KASSEN_ID);
  // Backend: `betrieb` und `kasse` — hier unter den Namen dieses Pakets.
  assert.equal(geraet.companyName, 'Cafe Kreiseck');
  assert.equal(geraet.cashregisterLabel, 'Schanigarten');
});

test('pairRegisterDevice: leere Anzeigenamen sind kein Grund, die Kopplung zu verwerfen', async () => {
  // Das Backend liefert bewusst leere Zeichenketten statt undefined, wenn der
  // Betrieb keinen Firmennamen bzw. die Kasse keine Bezeichnung traegt.
  const { holen } = fetchFake(erfolg({ ...KOPPLUNGS_ANTWORT, betrieb: '', kasse: '' }));
  const geraet = await pairRegisterDevice({ code: CODE, fetch: holen });
  assert.equal(geraet.companyName, '');
  assert.equal(geraet.cashregisterLabel, '');
  assert.equal(geraet.deviceSecret, GERAETE_GEHEIMNIS);
});

test('pairRegisterDevice: eine unvollstaendige Kopplung ist ein Antwortfehler', async () => {
  // Halb gekoppelt weiterzumachen faellt sonst erst beim naechsten Aufruf auf,
  // und der Kopplungs-Code ist dann bereits verbraucht.
  for (const feld of ['deviceId', 'deviceSecret', 'ownerUid', 'cashregisterId'] as const) {
    const luecke: Record<string, unknown> = { ...KOPPLUNGS_ANTWORT };
    delete luecke[feld];
    const { holen } = fetchFake(erfolg(luecke));
    await assert.rejects(pairRegisterDevice({ code: CODE, fetch: holen }), (fehler: unknown) => {
      assert.ok(isKasseneckValidationError(fehler), `${feld}: muss ein Formfehler sein`);
      assert.equal(fehler.scope, 'response');
      assert.equal(fehler.functionName, 'pairRegisterDevice');
      return true;
    });
  }
});

test('pairRegisterDevice: fehlender Code wird abgelehnt, bevor etwas rausgeht', async () => {
  for (const code of ['', '   ']) {
    const { holen, aufrufe } = fetchFake(erfolg(KOPPLUNGS_ANTWORT));
    await assert.rejects(pairRegisterDevice({ code, fetch: holen }), (fehler: unknown) => {
      assert.ok(isKasseneckValidationError(fehler));
      assert.equal(fehler.scope, 'request');
      assert.equal(fehler.functionName, 'pairRegisterDevice');
      return true;
    });
    assert.equal(aufrufe.length, 0, 'ohne Code darf nichts gesendet werden');
  }
});

test('pairRegisterDevice: eine mitgegebene Anmeldung wird nicht gesetzt', async () => {
  // Der Typ verbietet das; ein Verbraucher ohne Typen kaeme sonst durch und
  // haette den Aufruf still zu einem angemeldeten gemacht.
  const { holen, aufrufe } = fetchFake(erfolg(KOPPLUNGS_ANTWORT));
  const geschmuggelt = {
    code: CODE,
    fetch: holen,
    auth: () => ({ headers: { Authorization: 'Bearer kr_live_GESCHMUGGELT' }, params: { userid: 'fremd' } }),
  };
  await pairRegisterDevice(geschmuggelt as unknown as Parameters<typeof pairRegisterDevice>[0]);

  assert.equal('Authorization' in aufrufe[0]!.init.headers, false);
  assert.deepEqual(rumpfVon(aufrufe[0]!).params, { code: CODE });
});

// --- listRegisterUsersForDevice ---------------------------------------

test('listRegisterUsersForDevice: Endpunktname und die drei Geraeteangaben', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(BENUTZER_ANTWORT));
  await listRegisterUsersForDevice({
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    fetch: holen,
  });

  assert.equal(aufrufe[0]?.url, `${DEFAULT_BASE_URL}/listRegisterUsersForDevice`);
  assert.deepEqual(rumpfVon(aufrufe[0]!).params, {
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
  });
  assert.equal('Authorization' in aufrufe[0]!.init.headers, false);
});

test('unpairRegisterDevice: Endpunktname, die drei Geraeteangaben, ohne Authorization', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({ id: GERAET_ID }));
  await unpairRegisterDevice({ ownerUid: OWNER_UID, deviceId: GERAET_ID, deviceSecret: GERAETE_GEHEIMNIS, fetch: holen });
  assert.equal(aufrufe[0]?.url, `${DEFAULT_BASE_URL}/unpairRegisterDevice`);
  assert.deepEqual(rumpfVon(aufrufe[0]!).params, { ownerUid: OWNER_UID, deviceId: GERAET_ID, deviceSecret: GERAETE_GEHEIMNIS });
  assert.equal('Authorization' in aufrufe[0]!.init.headers, false);
  await assert.rejects(() => unpairRegisterDevice({ ownerUid: OWNER_UID, deviceId: GERAET_ID, deviceSecret: '', fetch: holen }));
});

test('listRegisterUsersForDevice: liest Benutzer, Regel und Modus', async () => {
  const { holen } = fetchFake(erfolg(BENUTZER_ANTWORT));
  const geraet = await listRegisterUsersForDevice({
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    fetch: holen,
  });

  assert.equal(geraet.users.length, 2);
  assert.deepEqual(geraet.users[0], { id: 'ru-1', name: 'Anna', kind: 'person', altbestand: false });
  assert.deepEqual(geraet.users[1], { id: 'ru-2', name: 'Terminal 2', kind: 'device', altbestand: true });
  assert.deepEqual(geraet.policy, { stellen: 4, zeichen: 'ziffern' });
  assert.equal(geraet.loginMode, 'auswahl');
});

test('listRegisterUsersForDevice: eine Antwort ohne Regel bleibt lesbar (altes Backend)', async () => {
  // policy fehlt -> null: die Kasse faellt aufs Freifeld zurueck, statt
  // Kaestchen mit einer erratenen Stellenzahl zu zeigen.
  const { holen } = fetchFake(erfolg({ users: [{ id: 'ru-1', name: 'Anna', kind: 'person' }] }));
  const geraet = await listRegisterUsersForDevice({
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    fetch: holen,
  });

  assert.equal(geraet.policy, null);
  assert.equal(geraet.loginMode, 'auswahl');
  assert.equal(geraet.users[0]?.altbestand, false);
});

test('listRegisterUsersForDevice: eine Antwort ohne Liste ist ein Antwortfehler', async () => {
  const { holen } = fetchFake(erfolg({ irgendwas: true }));
  await assert.rejects(
    listRegisterUsersForDevice({
      ownerUid: OWNER_UID,
      deviceId: GERAET_ID,
      deviceSecret: GERAETE_GEHEIMNIS,
      fetch: holen,
    }),
    (fehler: unknown) => {
      assert.ok(isKasseneckValidationError(fehler));
      assert.equal(fehler.scope, 'response');
      assert.equal(fehler.functionName, 'listRegisterUsersForDevice');
      return true;
    },
  );
});

test('listRegisterUsersForDevice: ein Benutzer ohne Kennung ist ein Antwortfehler', async () => {
  // Ein Eintrag ohne id ist nicht anmeldbar — ihn anzuzeigen hiesse, dem
  // Kassier eine Schaltflaeche zu geben, die nichts tun kann.
  const { holen } = fetchFake(erfolg({ users: [{ name: 'Anna' }] }));
  await assert.rejects(
    listRegisterUsersForDevice({
      ownerUid: OWNER_UID,
      deviceId: GERAET_ID,
      deviceSecret: GERAETE_GEHEIMNIS,
      fetch: holen,
    }),
    (fehler: unknown) => isKasseneckValidationError(fehler) && fehler.scope === 'response',
  );
});

test('listRegisterUsersForDevice: fehlende Geraeteangaben werden abgelehnt, bevor etwas rausgeht', async () => {
  const vollstaendig = { ownerUid: OWNER_UID, deviceId: GERAET_ID, deviceSecret: GERAETE_GEHEIMNIS };
  for (const feld of ['ownerUid', 'deviceId', 'deviceSecret'] as const) {
    const { holen, aufrufe } = fetchFake(erfolg(BENUTZER_ANTWORT));
    await assert.rejects(
      listRegisterUsersForDevice({ ...vollstaendig, [feld]: '', fetch: holen }),
      (fehler: unknown) => {
        assert.ok(isKasseneckValidationError(fehler), feld);
        assert.equal(fehler.scope, 'request');
        return true;
      },
    );
    assert.equal(aufrufe.length, 0, `${feld}: es darf nichts gesendet werden`);
  }
});

// --- registerUserLogin -------------------------------------------------

test('registerUserLogin: Endpunktname und die sechs Pflichtparameter', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(ANMELDE_ANTWORT));
  await registerUserLogin({
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    userId: BENUTZER_ID,
    pin: PIN,
    cashregisterId: KASSEN_ID,
    fetch: holen,
  });

  assert.equal(aufrufe[0]?.url, `${DEFAULT_BASE_URL}/registerUserLogin`);
  // Die Namen und ihre Reihenfolge stehen so in der Pflichtfeld-Schleife des
  // Backends: ownerUid, deviceId, deviceSecret, userId, pin, cashregisterId.
  assert.deepEqual(rumpfVon(aufrufe[0]!).params, {
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    userId: BENUTZER_ID,
    pin: PIN,
    cashregisterId: KASSEN_ID,
  });
  assert.equal('Authorization' in aufrufe[0]!.init.headers, false);
});

test('registerUserLogin: takeover geht nur mit, wenn es ausdruecklich true ist', async () => {
  const grund = {
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    userId: BENUTZER_ID,
    pin: PIN,
    cashregisterId: KASSEN_ID,
  };

  const mit = fetchFake(erfolg(ANMELDE_ANTWORT));
  await registerUserLogin({ ...grund, takeover: true, fetch: mit.holen });
  assert.equal(rumpfVon(mit.aufrufe[0]!).params['takeover'], true);

  for (const wert of [false, undefined]) {
    const ohne = fetchFake(erfolg(ANMELDE_ANTWORT));
    await registerUserLogin({ ...grund, takeover: wert, fetch: ohne.holen });
    assert.equal('takeover' in rumpfVon(ohne.aufrufe[0]!).params, false, `takeover=${wert}`);
  }
});

test('registerUserLogin: liest Token, Sitzung, Ablauf und den Benutzer samt Rechten', async () => {
  const { holen } = fetchFake(erfolg(ANMELDE_ANTWORT));
  const sitzung = await registerUserLogin({
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    userId: BENUTZER_ID,
    pin: PIN,
    cashregisterId: KASSEN_ID,
    fetch: holen,
  });

  assert.equal(sitzung.customToken, 'eyJ-CUSTOM-TOKEN');
  assert.equal(sitzung.sessionId, 'sess-neu');
  assert.equal(sitzung.expiresAt, 1_776_000_090_000);
  assert.equal(sitzung.user.id, BENUTZER_ID);
  assert.equal(sitzung.user.name, 'Anna');
  assert.equal(sitzung.user.perms.sell, true);
  assert.equal(sitzung.user.perms.takeover, false);
  assert.equal(sitzung.user.perms.reports, false);
});

test('registerUserLogin: ein fehlendes Recht gilt als nicht erteilt', async () => {
  const { holen } = fetchFake(
    erfolg({ ...ANMELDE_ANTWORT, user: { id: BENUTZER_ID, name: 'Anna', perms: { sell: true } } }),
  );
  const sitzung = await registerUserLogin({
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    userId: BENUTZER_ID,
    pin: PIN,
    cashregisterId: KASSEN_ID,
    fetch: holen,
  });

  assert.equal(sitzung.user.perms.sell, true);
  assert.equal(sitzung.user.perms.takeover, false, 'im Zweifel weniger anbieten, nicht mehr');
  assert.equal(sitzung.user.perms.cancel, false);
});

test('registerUserLogin: eine unvollstaendige Antwort ist ein Antwortfehler', async () => {
  const faelle: Array<[string, unknown]> = [
    ['ohne customToken', { ...ANMELDE_ANTWORT, customToken: undefined }],
    ['ohne sessionId', { ...ANMELDE_ANTWORT, sessionId: '' }],
    ['ohne expiresAt', { ...ANMELDE_ANTWORT, expiresAt: undefined }],
    ['ohne user', { ...ANMELDE_ANTWORT, user: undefined }],
    ['user ohne id', { ...ANMELDE_ANTWORT, user: { name: 'Anna', perms: {} } }],
  ];
  for (const [name, daten] of faelle) {
    const { holen } = fetchFake(erfolg(daten));
    await assert.rejects(
      registerUserLogin({
        ownerUid: OWNER_UID,
        deviceId: GERAET_ID,
        deviceSecret: GERAETE_GEHEIMNIS,
        userId: BENUTZER_ID,
        pin: PIN,
        cashregisterId: KASSEN_ID,
        fetch: holen,
      }),
      (fehler: unknown) => {
        assert.ok(isKasseneckValidationError(fehler), name);
        assert.equal(fehler.scope, 'response', name);
        assert.equal(fehler.functionName, 'registerUserLogin');
        return true;
      },
    );
  }
});

test('registerUserLogin: fehlende Pflichtangaben werden abgelehnt, bevor etwas rausgeht', async () => {
  const vollstaendig = {
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    userId: BENUTZER_ID,
    pin: PIN,
    cashregisterId: KASSEN_ID,
  };
  for (const feld of ['ownerUid', 'deviceId', 'deviceSecret', 'userId', 'pin', 'cashregisterId'] as const) {
    const { holen, aufrufe } = fetchFake(erfolg(ANMELDE_ANTWORT));
    await assert.rejects(registerUserLogin({ ...vollstaendig, [feld]: '', fetch: holen }), (fehler: unknown) => {
      assert.ok(isKasseneckValidationError(fehler), feld);
      assert.equal(fehler.scope, 'request');
      assert.equal(fehler.functionName, 'registerUserLogin');
      return true;
    });
    assert.equal(aufrufe.length, 0, `${feld}: es darf nichts gesendet werden`);
  }
});

// --- registerPinLogin --------------------------------------------------

test('registerPinLogin: Endpunktname und die fuenf Pflichtparameter — ohne userId', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(ANMELDE_ANTWORT));
  await registerPinLogin({
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    pin: PIN,
    cashregisterId: KASSEN_ID,
    fetch: holen,
  });

  assert.equal(aufrufe[0]?.url, `${DEFAULT_BASE_URL}/registerPinLogin`);
  // Namen und Reihenfolge aus der Pflichtfeld-Schleife des Backends:
  // ownerUid, deviceId, deviceSecret, pin, cashregisterId.
  assert.deepEqual(rumpfVon(aufrufe[0]!).params, {
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    pin: PIN,
    cashregisterId: KASSEN_ID,
  });
  assert.equal('Authorization' in aufrufe[0]!.init.headers, false);
});

test('registerPinLogin: takeover geht nur mit, wenn es ausdruecklich true ist', async () => {
  const grund = {
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    pin: PIN,
    cashregisterId: KASSEN_ID,
  };
  const mit = fetchFake(erfolg(ANMELDE_ANTWORT));
  await registerPinLogin({ ...grund, takeover: true, fetch: mit.holen });
  assert.equal(rumpfVon(mit.aufrufe[0]!).params['takeover'], true);
  const ohne = fetchFake(erfolg(ANMELDE_ANTWORT));
  await registerPinLogin({ ...grund, fetch: ohne.holen });
  assert.equal('takeover' in rumpfVon(ohne.aufrufe[0]!).params, false);
});

test('registerPinLogin: liest dieselbe Sitzungsantwort wie registerUserLogin', async () => {
  const { holen } = fetchFake(erfolg(ANMELDE_ANTWORT));
  const sitzung = await registerPinLogin({
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    pin: PIN,
    cashregisterId: KASSEN_ID,
    fetch: holen,
  });

  assert.equal(sitzung.customToken, 'eyJ-CUSTOM-TOKEN');
  assert.equal(sitzung.sessionId, 'sess-neu');
  assert.equal(sitzung.expiresAt, 1_776_000_090_000);
  assert.equal(sitzung.user.id, BENUTZER_ID);
  assert.equal(sitzung.user.perms.sell, true);
});

test('registerPinLogin: fehlende Pflichtangaben werden abgelehnt, bevor etwas rausgeht', async () => {
  const vollstaendig = {
    ownerUid: OWNER_UID,
    deviceId: GERAET_ID,
    deviceSecret: GERAETE_GEHEIMNIS,
    pin: PIN,
    cashregisterId: KASSEN_ID,
  };
  for (const feld of ['ownerUid', 'deviceId', 'deviceSecret', 'pin', 'cashregisterId'] as const) {
    const { holen, aufrufe } = fetchFake(erfolg(ANMELDE_ANTWORT));
    await assert.rejects(registerPinLogin({ ...vollstaendig, [feld]: '', fetch: holen }), (fehler: unknown) => {
      assert.ok(isKasseneckValidationError(fehler), feld);
      assert.equal(fehler.scope, 'request');
      assert.equal(fehler.functionName, 'registerPinLogin');
      return true;
    });
    assert.equal(aufrufe.length, 0, `${feld}: es darf nichts gesendet werden`);
  }
});

test('registerPinLogin: PIN und Geraetegeheimnis landen in keinem Fehler', async () => {
  const { holen } = fetchFake(fachfehler('Anmeldung fehlgeschlagen.'));
  await assert.rejects(
    registerPinLogin({
      ownerUid: OWNER_UID,
      deviceId: GERAET_ID,
      deviceSecret: GERAETE_GEHEIMNIS,
      pin: PIN,
      cashregisterId: KASSEN_ID,
      fetch: holen,
    }),
    (fehler: unknown) => {
      assert.ok(isKasseneckApiError(fehler));
      const abbild = inspect(fehler, { depth: 6 });
      for (const geheim of geheimnisse) {
        assert.equal(abbild.includes(geheim), false, 'Geheimnis im Fehlerabbild');
      }
      return true;
    },
  );
});

// --- renewRegisterSession / endRegisterSession -------------------------

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

test('renewRegisterSession: Endpunktname, keine eigenen Parameter, Kopfzeilen der Kassen-Identitaet', async () => {
  const { rufen, aufrufe } = kassenBenutzerWeg(erfolg({ expiresAt: 1_776_000_090_000 }));
  const expiresAt = await renewRegisterSession(rufen);

  assert.equal(aufrufe[0]?.url, `${DEFAULT_BASE_URL}/renewRegisterSession`);
  // Nur die Kassenbindung der Anmeldung — der Endpunkt nimmt keinen Parameter.
  assert.deepEqual(rumpfVon(aufrufe[0]!).params, { cashregisterId: KASSEN_ID });
  assert.equal(aufrufe[0]?.init.headers['Authorization'], `Bearer ${ID_TOKEN}`);
  assert.equal(aufrufe[0]?.init.headers['register-session'], SITZUNG);
  assert.equal(expiresAt, 1_776_000_090_000);
});

test('renewRegisterSession: eine Antwort ohne Ablaufzeitpunkt ist ein Antwortfehler', async () => {
  for (const daten of [{}, { expiresAt: 'bald' }, { expiresAt: Number.NaN }]) {
    const { rufen } = kassenBenutzerWeg(erfolg(daten));
    await assert.rejects(renewRegisterSession(rufen), (fehler: unknown) => {
      assert.ok(isKasseneckValidationError(fehler));
      assert.equal(fehler.scope, 'response');
      assert.equal(fehler.functionName, 'renewRegisterSession');
      return true;
    });
  }
});

test('renewRegisterSession: der fachliche Fehler der beendeten Sitzung kommt durch', async () => {
  const { rufen } = kassenBenutzerWeg(fachfehler('Sitzung beendet — bitte neu anmelden.'));
  await assert.rejects(renewRegisterSession(rufen), (fehler: unknown) => {
    assert.ok(isKasseneckApiError(fehler));
    assert.equal(fehler.serverMessage, 'Sitzung beendet — bitte neu anmelden.');
    return true;
  });
});

test('endRegisterSession: Endpunktname und keine eigenen Parameter', async () => {
  const { rufen, aufrufe } = kassenBenutzerWeg(erfolg({ ok: true }));
  await endRegisterSession(rufen);

  assert.equal(aufrufe[0]?.url, `${DEFAULT_BASE_URL}/endRegisterSession`);
  assert.deepEqual(rumpfVon(aufrufe[0]!).params, { cashregisterId: KASSEN_ID });
  assert.equal(aufrufe[0]?.init.headers['register-session'], SITZUNG);
});

// --- Die Fassade -------------------------------------------------------

test('die Fassade traegt die beiden Sitzungs-Aufrufe', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({ expiresAt: 1_776_000_090_000 }));
  const api = createKasseneckApi({
    auth: registerUserAuth({ getIdToken: () => ID_TOKEN, getSessionId: () => SITZUNG, cashregisterId: KASSEN_ID }),
    fetch: holen,
  });
  assert.equal(await api.renewRegisterSession(), 1_776_000_090_000);
  assert.equal(aufrufe[0]?.url, `${DEFAULT_BASE_URL}/renewRegisterSession`);

  const beenden = fetchFake(erfolg({ ok: true }));
  const api2 = createKasseneckApi({
    auth: registerUserAuth({ getIdToken: () => ID_TOKEN, getSessionId: () => SITZUNG, cashregisterId: KASSEN_ID }),
    fetch: beenden.holen,
  });
  await api2.endRegisterSession();
  assert.equal(beenden.aufrufe[0]?.url, `${DEFAULT_BASE_URL}/endRegisterSession`);
});

test('die Fassade traegt die drei anmeldungsfreien Aufrufe NICHT', () => {
  // Sie wird mit genau einer Anmeldung gebaut; diese drei haben keine. Stuenden
  // sie darin, sagte die Fassade eine Anmeldung zu, die fuer sie nicht gilt.
  const api = createKasseneckApi({
    auth: registerUserAuth({ getIdToken: () => ID_TOKEN, getSessionId: () => SITZUNG, cashregisterId: KASSEN_ID }),
    fetch: fetchFake(erfolg({})).holen,
  }) as unknown as Record<string, unknown>;
  for (const name of ['pairRegisterDevice', 'listRegisterUsersForDevice', 'registerUserLogin']) {
    assert.equal(name in api, false, `${name} gehoert nicht in die Fassade`);
  }
});

// --- Kein anmeldungsfreier Transport nach draussen ---------------------

test('der Unterpfad ./register exportiert genau die sieben Aufrufe — und keine Anmeldung', () => {
  // Die anmeldungsfreien Aufrufe bauen ihren Transport selbst, mit einer
  // Anmeldung ohne Zugangsdaten. Waere die exportiert, koennte damit jeder
  // Aufruf des Pakets ohne Anmeldung gebaut werden — auch createReceipt. Diese
  // Liste haelt genau das fest.
  assert.deepEqual(
    Object.keys(registerModul).sort(),
    [
      'endRegisterSession',
      'listRegisterUsersForDevice',
      'pairRegisterDevice',
      'registerPinLogin',
      'registerUserLogin',
      'renewRegisterSession',
      'unpairRegisterDevice',
    ],
  );
  for (const wert of Object.values(registerModul)) {
    assert.equal(typeof wert, 'function');
  }
});

// --- Kein Geheimnis in einem geworfenen Fehler -------------------------

/** Alles, was ueblicherweise in Protokollen und Fehlerdiensten landet. */
function protokollSpuren(fehler: unknown): string[] {
  const err = fehler as Error;
  return [
    err.message,
    String(err),
    err.toString(),
    JSON.stringify(err) ?? '',
    String(err.stack ?? ''),
    inspect(err, { depth: 5 }),
    // Eigene Felder einzeln, damit ein Zusatzfeld nicht durch eine leere
    // JSON-Darstellung (Error-Felder sind nicht aufzaehlbar) verdeckt wird.
    ...Object.entries(err as unknown as Record<string, unknown>).map(
      ([name, wert]) => `${name}=${typeof wert === 'string' ? wert : JSON.stringify(wert) ?? ''}`,
    ),
  ];
}

function keineGeheimnisse(fehler: unknown, hinweis = ''): true {
  for (const spur of protokollSpuren(fehler)) {
    for (const geheim of geheimnisse) {
      assert.ok(!spur.includes(geheim), `${hinweis}Geheimnis "${geheim.slice(0, 8)}…" steckt in "${spur}"`);
    }
  }
  return true;
}

/**
 * Die Fehlerwege, auf denen PIN, Geraetegeheimnis und Kopplungs-Code
 * herausfallen koennten. Der schaerfste ist der letzte: eine fremde
 * fetch-Umsetzung haengt Kontext an ihren Fehler, und `console.error(err)`
 * druckt die Ursachenkette mit. Die Kopfzeilen sind hier ausdruecklich **leer**
 * — der uebliche Schutz des Transports (er kennt die gesendeten Kopfzeilen)
 * greift bei diesen drei Aufrufen also gerade nicht.
 *
 * [gesendet] sind die Geheimnisse, die der jeweilige Aufruf wirklich in der
 * Nutzlast fuehrt. Nur die kann er schuetzen — `pairRegisterDevice` kennt das
 * Geraetegeheimnis noch gar nicht, es entsteht erst durch ihn.
 */
function fehlerwege(...gesendet: string[]): Array<[string, FetchLike]> {
  return [
    ['fachlich', async () => fachfehler('Kopplungs-Code unbekannt.')],
    ['fachlich-anmeldung', async () => fachfehler('Anmeldung fehlgeschlagen.')],
    ['http', async () => antwort('<html>500</html>', { status: 500, contentType: 'text/html' })],
    ['nicht-json', async () => antwort('<!doctype html><html>App</html>')],
    ['antwortfehler', async () => erfolg({ irgendwas: true })],
    [
      'netz',
      async () => {
        throw new Error('socket hang up');
      },
    ],
    [
      'netz-mit-kontext',
      async () => {
        // Wie axios/got: Kontext am Fehler — hier mit den gesendeten
        // Geheimnissen darin, im freien Text wie in bezeichner-foermigen
        // Feldern (die kommen durch jeden reinen Formfilter).
        throw Object.assign(new Error(`POST fehlgeschlagen: ${gesendet.join(' ')}`), {
          name: gesendet[0] ?? 'AxiosError',
          code: gesendet[1] ?? gesendet[0] ?? 'ECONNREFUSED',
          config: { body: gesendet },
        });
      },
    ],
  ];
}

test('pairRegisterDevice: kein Geheimnis in irgendeinem Fehler', async () => {
  for (const [name, holen] of fehlerwege(CODE)) {
    await assert.rejects(pairRegisterDevice({ code: CODE, fetch: holen }), (fehler: unknown) =>
      keineGeheimnisse(fehler, `Weg ${name}: `),
    );
  }
  // Und der Weg, auf dem gar nichts gesendet wird.
  await assert.rejects(pairRegisterDevice({ code: '' }), (fehler: unknown) => keineGeheimnisse(fehler, 'Weg leer: '));

  // Das Geraetegeheimnis kommt bei DIESEM Aufruf aus der Antwort — eine
  // unvollstaendige Antwort darf es nicht in ihre Fehlermeldung nehmen.
  const { holen } = fetchFake(erfolg({ ...KOPPLUNGS_ANTWORT, ownerUid: undefined }));
  await assert.rejects(pairRegisterDevice({ code: CODE, fetch: holen }), (fehler: unknown) =>
    keineGeheimnisse(fehler, 'Weg halbe-antwort: '),
  );
});

test('listRegisterUsersForDevice: kein Geheimnis in irgendeinem Fehler', async () => {
  for (const [name, holen] of fehlerwege(GERAETE_GEHEIMNIS)) {
    await assert.rejects(
      listRegisterUsersForDevice({
        ownerUid: OWNER_UID,
        deviceId: GERAET_ID,
        deviceSecret: GERAETE_GEHEIMNIS,
        fetch: holen,
      }),
      (fehler: unknown) => keineGeheimnisse(fehler, `Weg ${name}: `),
    );
  }
});

test('registerUserLogin: kein Geheimnis in irgendeinem Fehler', async () => {
  for (const [name, holen] of fehlerwege(GERAETE_GEHEIMNIS, PIN)) {
    await assert.rejects(
      registerUserLogin({
        ownerUid: OWNER_UID,
        deviceId: GERAET_ID,
        deviceSecret: GERAETE_GEHEIMNIS,
        userId: BENUTZER_ID,
        pin: PIN,
        cashregisterId: KASSEN_ID,
        fetch: holen,
      }),
      (fehler: unknown) => keineGeheimnisse(fehler, `Weg ${name}: `),
    );
  }
});

test('registerUserLogin: auch die Zeitueberschreitung traegt kein Geheimnis', async () => {
  const haengendesFetch: FetchLike = (_url, init) =>
    new Promise((_erfuellen, ablehnen) => {
      init.signal.addEventListener('abort', () => ablehnen(new Error(`abgebrochen, pin war ${PIN}`)));
    });
  await assert.rejects(
    registerUserLogin({
      ownerUid: OWNER_UID,
      deviceId: GERAET_ID,
      deviceSecret: GERAETE_GEHEIMNIS,
      userId: BENUTZER_ID,
      pin: PIN,
      cashregisterId: KASSEN_ID,
      fetch: haengendesFetch,
      timeoutMs: 20,
    }),
    (fehler: unknown) => {
      assert.ok(isKasseneckNetworkError(fehler));
      assert.equal(fehler.timedOut, true);
      return keineGeheimnisse(fehler, 'Weg zeitlimit: ');
    },
  );
});

test('die verdichtete Ursache verwirft Geraetegeheimnis und Kopplungs-Code', async () => {
  // Beide sind bezeichner-foermig und kaemen durch jeden reinen Formfilter —
  // verworfen werden sie nur, weil die Aufrufe ihre Geheimnisse dem Transport
  // nennen. Die PIN faellt schon an der Form (sie beginnt mit einer Ziffer).
  const kaputt = (werte: { name: string; code: string }): FetchLike => {
    return async () => {
      throw Object.assign(new Error('kaputt'), werte);
    };
  };

  await assert.rejects(
    pairRegisterDevice({ code: CODE, fetch: kaputt({ name: 'AxiosError', code: CODE }) }),
    (fehler: unknown) => {
      assert.ok(isKasseneckNetworkError(fehler));
      assert.equal(fehler.causeCode, undefined, 'ein Code, der der Kopplungs-Code ist, wird verworfen');
      // Was unbedenklich ist, bleibt erkennbar — sonst waere die Diagnose weg.
      assert.equal(fehler.causeName, 'AxiosError');
      return keineGeheimnisse(fehler);
    },
  );

  await assert.rejects(
    listRegisterUsersForDevice({
      ownerUid: OWNER_UID,
      deviceId: GERAET_ID,
      deviceSecret: GERAETE_GEHEIMNIS,
      fetch: kaputt({ name: GERAETE_GEHEIMNIS, code: 'ECONNREFUSED' }),
    }),
    (fehler: unknown) => {
      assert.ok(isKasseneckNetworkError(fehler));
      assert.equal(fehler.causeName, undefined, 'ein Name, der das Geraetegeheimnis ist, wird verworfen');
      assert.equal(fehler.causeCode, 'ECONNREFUSED');
      return keineGeheimnisse(fehler);
    },
  );
});
