import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as kasse from '../src/pos/index.js';
import {
  POS_BUSINESS_DEFAULTS, POS_DEVICE_DEFAULTS, POS_SHORTCUT_ACTIONS, POS_SHORTCUT_DEFAULTS,
  POS_BUSINESS_VALUES, POS_DEVICE_VALUES, POS_ERROR_CODES,
  getPosSettings, setMyPosSettings, setMyRegisterDeviceSettings, setMyPosLogo,
  listMyArticleGroups, listMyArticles, listMyPrinters, createPrintJob, getPrintJob, listMyTipRecipients,
  listMyStockLocations, listMyStock, setMyCashregisterStockLocation, STOCK_LOCATION_TYPES,
  isPosError, posFieldErrors, mergePosSettings, stockViewOf,
  type PosBusinessSettings, type PosDeviceSettings,
} from '../src/pos/index.js';
import {
  pairRegisterDevice, listRegisterUsersForDevice, listRegisterSessionsForDevice, registerUserLogin,
  registerPinLogin, renewRegisterSession, endRegisterSession, unpairRegisterDevice,
  REGISTER_ERROR_CODES, isRegisterError, registerErrorDetails, registerErrorCode,
} from '../src/register/index.js';
import { createTransport, POS_BASE_URL, type FetchLike, type HttpRequestInit, type HttpResponseLike } from '../src/client/transport.js';
import { registerUserAuth } from '../src/client/auth.js';
import { isKasseneckApiError, isKasseneckValidationError, KasseneckApiError } from '../src/client/errors.js';
import type { ReceiptLayout } from '../src/receipt/layout.js';
import { _ALTFORM_0X } from '../src/pos/settings.js';
import { partnerZugangsCodes, randUndAnmeldung } from './kassenweg-codes.js';

/*
 * Kasse und Anmeldung am Kassenweg `/api/v3` gegen den Vertrags-Export des
 * Backends (fixtures/v3/antworten/kasse.json, v3-vokabular.json). Jeder Fall
 * aller Kassen-Endpunkte ausser der Belegwelt (die pruefen receipts-v3):
 * was das Paket sendet, sind die Parameter des Falls; was es liest, traegt die
 * englischen Namen; jeder Fehler wird am `code` erkannt, nie am Text.
 */

type Json = Record<string, any>;
interface Fall {
  case: string;
  caller: string;
  params: Json;
  httpStatus: number;
  headers: Record<string, string>;
  response: Json;
}

const lies = (datei: string): Json =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/${datei}`, import.meta.url)), 'utf8')) as Json;
const KASSE = lies('v3/antworten/kasse.json').endpoints as Record<string, { cases: Fall[] }>;
const VOKABULAR = lies('v3/v3-vokabular.json');
const STANDARD = lies('pos-settings-defaults.json');
const STANDARD_INNEN = lies('stored/pos-settings-defaults.json');

const faelle = (endpunkt: string): Fall[] => KASSE[endpunkt]!.cases;
const fall = (endpunkt: string, name: string): Fall => {
  const f = faelle(endpunkt).find((c) => c.case === name);
  assert.ok(f, `${endpunkt}/${name} fehlt im Vertrag`);
  return f;
};
/**
 * Eine gefilterte Fallliste ist nie leer: benennt ein neuer Export
 * `response.status` um oder streicht die Faelle eines Endpunkts, fielen die
 * Schleifen sonst still durch und prueften nichts.
 */
function nichtLeer<T>(liste: T[], was: string): T[] {
  assert.ok(liste.length > 0, `${was}: keine Faelle im Vertrag`);
  return liste;
}
const erfolge = (endpunkt: string) =>
  nichtLeer(faelle(endpunkt).filter((f) => f.response.status === 'success' && !('$body' in f.params)), `${endpunkt} (Erfolg)`);
const fehler = (endpunkt: string) => nichtLeer(faelle(endpunkt).filter((f) => f.response.status === 'error'), `${endpunkt} (Fehler)`);

function antwortAus(f: Fall): HttpResponseLike {
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

interface Mitschrift { url: string; params: Json }
function holenFuer(f: Fall): { holen: FetchLike; aufrufe: Mitschrift[] } {
  const aufrufe: Mitschrift[] = [];
  const holen: FetchLike = async (url: string, init: HttpRequestInit) => {
    aufrufe.push({ url, params: (JSON.parse(init.body) as { params: Json }).params });
    return antwortAus(f);
  };
  return { holen, aufrufe };
}
/** Transport der angemeldeten Kasse; `cashregisterId` der Anmeldung wird beim Vergleich herausgenommen. */
function kassenweg(f: Fall) {
  const { holen, aufrufe } = holenFuer(f);
  const rufen = createTransport({
    auth: registerUserAuth({ getIdToken: () => 'eyJ-ID', getSessionId: () => 'sess-1', cashregisterId: 'KASSE1' }),
    fetch: holen,
  });
  return { rufen, aufrufe };
}
function gesendet(aufrufe: Mitschrift[], endpunkt: string, f: Fall): Json {
  assert.equal(aufrufe.length, 1, `${endpunkt}/${f.case}: genau ein Aufruf`);
  assert.equal(aufrufe[0]!.url, `${POS_BASE_URL}/${endpunkt}`);
  const params = { ...aufrufe[0]!.params };
  if (!('cashregisterId' in f.params)) delete params.cashregisterId;
  return params;
}
async function wurf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  assert.fail('Fehler erwartet');
}

const GERAET = { ownerUid: 'kw_betrieb1', deviceId: 'dev_pin', deviceSecret: 'EXAMPLE-GEHEIM-0123456789abcdef' };

// --- Standardwerte: aus dem Vertrag abgeleitet, nie geraten ---------------------

test('Standardwerte: die Drahtform ist die Antwort ohne gespeicherte Einstellungen', () => {
  assert.deepEqual(STANDARD.business, fall('listRegisterUsersForDevice', 'account_without_settings').response.data.settings.business);
  assert.deepEqual(STANDARD.device, fall('getKasseSettings', 'cashier_unknown_device').response.data.device);
  assert.deepEqual(JSON.parse(JSON.stringify(POS_BUSINESS_DEFAULTS)), STANDARD.business);
  assert.deepEqual(JSON.parse(JSON.stringify(POS_DEVICE_DEFAULTS)), STANDARD.device);
  assert.deepEqual({ ...POS_SHORTCUT_DEFAULTS }, STANDARD.device.shortcuts);
});

/** Drahtform -> innere Form mit dem Schema `getPosSettings` und den Katalogen, unabhaengig vom Erzeuger. */
function nachInnen(teil: 'business' | 'device', block: Json): Json {
  const schema = VOKABULAR.schemas.getKasseSettings;
  const raus: Json = {};
  for (const [aussen, wert] of Object.entries(block)) {
    const eintrag = schema.data[teil][aussen];
    assert.ok(eintrag !== undefined, `${teil}.${aussen} fehlt im Schema`);
    if (typeof eintrag === 'object') {
      raus[eintrag.__] = Object.fromEntries(Object.entries(wert as Json).map(([k, v]) => [eintrag[k], v]));
      continue;
    }
    const verweis = schema.werte[`${teil}.${aussen}`];
    const innen = verweis
      ? Object.entries(VOKABULAR.catalogs[verweis.$catalog] as Record<string, string>).find(([, a]) => a === wert)?.[0]
      : wert;
    raus[eintrag] = innen;
  }
  return raus;
}

test('Standardwerte: die innere Form unter fixtures/stored ist dieselbe Vorgabe, deutsch', () => {
  assert.deepEqual(STANDARD_INNEN, { betrieb: nachInnen('business', STANDARD.business), geraet: nachInnen('device', STANDARD.device) });
  // Kein Schluessel der Drahtform bleibt ohne Gegenstueck, und die innere
  // Form traegt die alten Namen (0.x-Datei: stil, saetze, tasten ...).
  assert.equal(Object.keys(STANDARD_INNEN.betrieb).length, Object.keys(STANDARD.business).length);
  assert.equal(STANDARD_INNEN.betrieb.stil, 'klar');
  assert.equal(STANDARD_INNEN.geraet.tasten.kassieren[0], 'Enter');
});

test('Einstellungen: jedes Feld und jede Tasten-Aktion steht im Schema, in beide Richtungen', () => {
  const schema = VOKABULAR.schemas.getKasseSettings.data;
  const aussen = (teil: Json) => Object.keys(teil).filter((k) => k !== '__').sort();
  assert.deepEqual(Object.keys(POS_BUSINESS_DEFAULTS).sort(), aussen(schema.business));
  assert.deepEqual(Object.keys(POS_DEVICE_DEFAULTS).sort(), aussen(schema.device));
  assert.deepEqual([...POS_SHORTCUT_ACTIONS], Object.keys(schema.device.shortcuts).filter((k) => k !== '__'));
});

test('Einstellungen: jede Wertemenge mit Katalog ist der Katalog, Wert fuer Wert und in der Reihenfolge', () => {
  const werte = VOKABULAR.schemas.getKasseSettings.werte as Record<string, { $catalog: string }>;
  const paket: Record<string, readonly (string | number)[] | undefined> = {
    ...Object.fromEntries(Object.entries(POS_BUSINESS_VALUES).map(([k, v]) => [`business.${k}`, v])),
    ...Object.fromEntries(Object.entries(POS_DEVICE_VALUES).map(([k, v]) => [`device.${k}`, v])),
  };
  for (const [pfad, { $catalog }] of Object.entries(werte)) {
    assert.deepEqual([...(paket[pfad] ?? [])], Object.values(VOKABULAR.catalogs[$catalog]), pfad);
  }
  // Jede Liste heisst wie ihr Feld (TILE_STYLE -> tileStyle).
  const raum = kasse as unknown as Record<string, unknown>;
  for (const [feld, liste] of Object.entries({ ...POS_BUSINESS_VALUES, ...POS_DEVICE_VALUES })) {
    assert.equal(raum[feld.replace(/([A-Z])/g, '_$1').toUpperCase()], liste, feld);
  }
  // Kein deutscher Wert mehr in einer Liste.
  const alleWerte = Object.values({ ...POS_BUSINESS_VALUES, ...POS_DEVICE_VALUES }).flatMap((l) => [...(l ?? [])]);
  for (const deutsch of ['klar', 'nacht', 'aus', 'fragen', 'keiner', 'rechts', 'oben', 'netz', 'bar', 'direkt', 'keins', 'streifen', 'mitte', 'seite', 'beides']) {
    assert.equal(alleWerte.includes(deutsch), false, deutsch);
  }
});

// --- Einstellungen am Draht ----------------------------------------------------

test('getPosSettings: sendet deviceId wie der Fall, liest {business, device}', async () => {
  for (const f of erfolge('getKasseSettings')) {
    const { rufen, aufrufe } = kassenweg(f);
    const stand = await getPosSettings(rufen, f.params.deviceId ? { deviceId: f.params.deviceId } : {});
    assert.deepEqual(gesendet(aufrufe, 'getKasseSettings', f), f.params, f.case);
    assert.deepEqual(stand, { business: f.response.data.business, device: f.response.data.device }, f.case);
  }
});

test('setMyPosSettings: sendet business wie der Fall, liest die Antwort', async () => {
  for (const f of erfolge('setMyKasseSettings')) {
    const { rufen, aufrufe } = kassenweg(f);
    const stand = await setMyPosSettings(rufen, f.params.business);
    assert.deepEqual(gesendet(aufrufe, 'setMyKasseSettings', f), f.params, f.case);
    assert.deepEqual(stand, f.response.data.business, f.case);
  }
});

test('setMyRegisterDeviceSettings: sendet deviceId und device wie der Fall', async () => {
  for (const f of erfolge('setMyRegisterDeviceSettings')) {
    const { rufen, aufrufe } = kassenweg(f);
    const stand = await setMyRegisterDeviceSettings(rufen, f.params.deviceId, f.params.device);
    assert.deepEqual(gesendet(aufrufe, 'setMyRegisterDeviceSettings', f), f.params, f.case);
    assert.deepEqual(stand, f.response.data.device, f.case);
  }
});

test('Einstellungen: deutscher Schluessel, deutscher Wert, halbe Steuersatz-Karte und fremde Taste gehen nicht hinaus', async () => {
  const f = fall('setMyKasseSettings', 'success_manager');
  const faelleVorab: [string, () => Promise<unknown>, RegExp][] = [
    ['business.stil', () => setMyPosSettings(kassenweg(f).rufen, { stil: 'nacht' } as unknown as Partial<PosBusinessSettings>), /business\.stil/],
    ['business.theme', () => setMyPosSettings(kassenweg(f).rufen, { theme: 'nacht' } as unknown as Partial<PosBusinessSettings>), /business\.theme/],
    ['business.vatRates', () => setMyPosSettings(kassenweg(f).rufen, { vatRates: { 20: false } }), /business\.vatRates/],
    ['device.shortcuts', () => setMyRegisterDeviceSettings(kassenweg(f).rufen, 'dev_pin', { shortcuts: { kassieren: ['Enter'] } } as unknown as Partial<PosDeviceSettings>), /device\.shortcuts\.kassieren/],
    ['device.tasten', () => setMyRegisterDeviceSettings(kassenweg(f).rufen, 'dev_pin', { tasten: {} } as unknown as Partial<PosDeviceSettings>), /device\.tasten/],
    ['device.layout', () => setMyRegisterDeviceSettings(kassenweg(f).rufen, 'dev_pin', { layout: 'rechts' } as unknown as Partial<PosDeviceSettings>), /device\.layout/],
  ];
  for (const [name, aufruf, muster] of faelleVorab) {
    const e = await wurf(aufruf());
    assert.ok(isKasseneckValidationError(e), name);
    assert.match((e as Error).message, muster, name);
  }
  // Die ganze Karte geht durch, unveraendert.
  const { rufen, aufrufe } = kassenweg(f);
  await setMyPosSettings(rufen, { vatRates: { ...POS_BUSINESS_DEFAULTS.vatRates, 19: true } });
  assert.deepEqual(aufrufe[0]!.params.business, { vatRates: { 0: true, 10: true, 13: true, 19: true, 20: true, 4.9: true } });
});

test('Einstellungen: ein 0.x-Stand (deutsche Schluessel) ergibt beim Mischen die Standardwerte, nie einen Absturz', () => {
  assert.deepEqual(mergePosSettings(POS_BUSINESS_DEFAULTS, STANDARD_INNEN.betrieb), JSON.parse(JSON.stringify(POS_BUSINESS_DEFAULTS)));
  assert.deepEqual(mergePosSettings(POS_DEVICE_DEFAULTS, STANDARD_INNEN.geraet), JSON.parse(JSON.stringify(POS_DEVICE_DEFAULTS)));
  // Gleichnamige Felder mit deutschem Wert und deutsche Tasten-Aktionen kommen nicht ins Modell.
  const gemischt = mergePosSettings(POS_DEVICE_DEFAULTS, { layout: 'rechts', terminalVia: 'direkt', shortcuts: { kassieren: ['F1'], cash: ['Mod+X'] } } as never);
  assert.equal(gemischt.layout, 'right');
  assert.equal(gemischt.terminalVia, 'direct');
  assert.equal('kassieren' in gemischt.shortcuts, false);
  assert.deepEqual(gemischt.shortcuts.cash, ['Mod+X']);
  assert.equal(mergePosSettings(POS_BUSINESS_DEFAULTS, { theme: 'night' }).theme, 'night');
});

test('setMyPosLogo: image bzw. remove wie der Fall, liefert logoImage', async () => {
  for (const f of erfolge('setMyKasseLogo')) {
    const { rufen, aufrufe } = kassenweg(f);
    const bild = await setMyPosLogo(rufen, f.params.remove ? { remove: true } : { image: f.params.image });
    assert.deepEqual(gesendet(aufrufe, 'setMyKasseLogo', f), f.params, f.case);
    assert.equal(bild, f.response.data.logoImage, f.case);
  }
});

// --- Artikel, Drucker, Trinkgeld --------------------------------------------------

test('listMyArticles/listMyArticleGroups: englische Felder, tile.visible/sort', async () => {
  for (const f of erfolge('listMyArticles')) {
    const artikel = await listMyArticles(kassenweg(f).rufen);
    assert.equal(artikel.length, f.response.data.articles.length, f.case);
    artikel.forEach((a, i) => {
      const roh = f.response.data.articles[i];
      assert.equal(a.visible, roh.tile.visible !== false);
      assert.equal(a.sort, roh.tile.sort);
      assert.equal(a.revenueGroupId, roh.revenueGroupId);
      assert.equal(a.groupId, roh.groupId);
    });
  }
  for (const f of erfolge('listMyArticleGroups')) {
    const gruppen = await listMyArticleGroups(kassenweg(f).rufen);
    assert.deepEqual(gruppen.map((g) => g.id), f.response.data.groups.map((g: Json) => g.id));
  }
  // Mengenregel englisch (Katalog MENGENREGEL); ein deutscher Altwert wird nicht Regel.
  assert.deepEqual([...kasse.QUANTITY_RULES], Object.values(VOKABULAR.catalogs.MENGENREGEL));
  const a = kasse.fromPosArticlePayload({ id: 'w', unit: 'kg', quantityRule: 'decimal', askQuantity: true, maxQuantity: 2.5 });
  assert.deepEqual([a.quantityRule, a.askQuantity, a.maxQuantity], ['decimal', true, 2.5]);
  assert.equal(kasse.fromPosArticlePayload({ id: 'w', quantityRule: 'dezimal' }).quantityRule, null);
  assert.deepEqual(kasse.quantityDefaults(a), { rule: 'decimal', ask: true, decimals: 3 });
});

test('Drucker: listMyPrinters, getPrintJob englisch; createPrintJob sendet wie der Fall', async () => {
  for (const f of erfolge('listMyPrinters')) {
    const liste = await listMyPrinters(kassenweg(f).rufen);
    const roh = f.response.data.printers[0];
    assert.deepEqual(liste[0], {
      id: roh.id, name: roh.name, kind: roh.kind, paperSize: roh.paperSize, active: roh.active, createdAt: roh.createdAt,
      lastSeenAt: roh.lastSeenAt, lastResult: { success: true, code: null, at: roh.lastResult.at }, printerSerial: roh.printerSerial,
      ...(roh.sdpUrl ? { sdpUrl: roh.sdpUrl } : {}),
    }, f.case);
  }
  for (const f of erfolge('getPrintJob')) {
    const { rufen, aufrufe } = kassenweg(f);
    const job = await getPrintJob(rufen, { printerId: f.params.printerId, jobId: f.params.jobId });
    assert.deepEqual(gesendet(aufrufe, 'getPrintJob', f), f.params, f.case);
    assert.equal(job.status, f.response.data.status);
    assert.equal(job.sentAt, f.response.data.sentAt);
    assert.equal(job.result?.success ?? null, f.response.data.result?.success ?? null);
  }
  assert.deepEqual([...kasse.PRINT_JOB_STATUSES], Object.values(VOKABULAR.catalogs.DRUCKJOB));
  assert.deepEqual([...kasse.PRINT_JOB_SOURCES], Object.values(VOKABULAR.catalogs.DRUCK_QUELLE));
  for (const f of nichtLeer(erfolge('createPrintJob').filter((x) => !x.params.logo), 'createPrintJob ohne Logo')) {
    const { rufen, aufrufe } = kassenweg(f);
    const job = await createPrintJob(rufen, {
      printerId: f.params.printerId, layout: f.params.layout as ReceiptLayout,
      ...(f.params.receiptId ? { receiptId: f.params.receiptId } : {}),
      ...(f.params.title ? { title: f.params.title } : {}),
      ...(f.params.source ? { source: f.params.source } : {}),
      ...(f.params.brand ? { brandMark: true } : {}),
    });
    assert.deepEqual(gesendet(aufrufe, 'createPrintJob', f), f.params, f.case);
    assert.deepEqual(job, { jobId: 'auto1', status: 'pending', result: null });
  }
});

test('createPrintJob: das Logo geht als {scale, pxWidth, pxHeight, width, height, rows}', async () => {
  const f = fall('createPrintJob', 'success_logo_qr');
  const soll = f.params.logo;
  // Rasterbild aus den Zeilen des Falls zurueckgebaut: 10 x 2 Punkte, MSB zuerst.
  const bytes = Uint8Array.from(atob(soll.rows), (z) => z.charCodeAt(0));
  const punkte = new Uint8Array(soll.width * soll.height);
  const proZeile = Math.ceil(soll.width / 8);
  for (let y = 0; y < soll.height; y++) for (let x = 0; x < soll.width; x++) {
    punkte[y * soll.width + x] = (bytes[y * proZeile + (x >> 3)]! >> (7 - (x & 7))) & 1;
  }
  const { rufen, aufrufe } = kassenweg(f);
  await createPrintJob(rufen, {
    printerId: f.params.printerId, layout: f.params.layout as ReceiptLayout, receiptId: f.params.receiptId,
    title: f.params.title, source: f.params.source, brandMark: true,
    logo: { size: soll.scale, pixelWidth: soll.pxWidth, pixelHeight: soll.pxHeight, raster: { width: soll.width, height: soll.height, dots: punkte } },
  });
  assert.deepEqual(gesendet(aufrufe, 'createPrintJob', f), f.params);
});

test('listMyTipRecipients: Empfaenger wie im Fall', async () => {
  for (const f of erfolge('listMyTipRecipients')) {
    assert.deepEqual(await listMyTipRecipients(kassenweg(f).rufen), f.response.data.recipients, f.case);
  }
});

// --- Lager an der Kasse --------------------------------------------------------

test('listMyStockLocations: Standorte wie im Fall, virtual nur am Hauptstandort', async () => {
  for (const f of erfolge('listMyStockLocations')) {
    const orte = await listMyStockLocations(kassenweg(f).rufen);
    assert.deepEqual(orte, f.response.data.locations.map((l: Json) => ({ ...l, virtual: l.virtual === true })), f.case);
  }
  assert.deepEqual([...STOCK_LOCATION_TYPES], Object.values(VOKABULAR.catalogs.STANDORT_TYP));
});

test('listMyStock: Bestand wie im Fall, values nur mit Recht stockCosts, Filter wie gesendet', async () => {
  for (const f of erfolge('listMyStock')) {
    const { rufen, aufrufe } = kassenweg(f);
    const liste = await listMyStock(rufen, f.params as { locationId?: string });
    assert.deepEqual(gesendet(aufrufe, 'listMyStock', f), f.params, f.case);
    assert.deepEqual(liste.stock, f.response.data.stock, f.case);
    assert.deepEqual(liste.values, f.response.data.values ?? null, f.case);
  }
});

test('setMyCashregisterStockLocation: sendet wie der Fall, leerer Standort heisst zurueckgesetzt', async () => {
  for (const f of erfolge('setMyCashregisterStockLocation')) {
    const { rufen, aufrufe } = kassenweg(f);
    const ziel = f.params.stockLocationId === '' ? null : (f.params.stockLocationId as string);
    const stand = await setMyCashregisterStockLocation(rufen, { cashregisterId: f.params.cashregisterId as string, stockLocationId: ziel });
    assert.deepEqual(gesendet(aufrufe, 'setMyCashregisterStockLocation', f), f.params, f.case);
    assert.deepEqual(stand, f.response.data, f.case);
  }
  // Ohne cashregisterId gilt die Kasse der Anmeldung (registerUserAuth: KASSE1).
  const f = fall('setMyCashregisterStockLocation', 'success_manager');
  const { rufen, aufrufe } = kassenweg(f);
  await setMyCashregisterStockLocation(rufen, { stockLocationId: 'auto1' });
  assert.deepEqual(aufrufe[0]!.params, { cashregisterId: 'KASSE1', stockLocationId: 'auto1' });
});

// --- Anmeldung ------------------------------------------------------------------

test('pairRegisterDevice: sendet wie der Fall, liest companyName, cashregisterLabel, testEnvironment', async () => {
  for (const f of erfolge('pairRegisterDevice')) {
    const { holen, aufrufe } = holenFuer(f);
    const geraet = await pairRegisterDevice({ ...(f.params as { code: string }), fetch: holen });
    assert.deepEqual(aufrufe[0]!.params, f.params, f.case);
    assert.equal(aufrufe[0]!.url, `${POS_BASE_URL}/pairRegisterDevice`);
    assert.deepEqual(geraet, f.response.data, f.case);
  }
});

test('listRegisterUsersForDevice: englische Antwort, Einstellungen, Belegkopf, Kassenzustand', async () => {
  for (const f of erfolge('listRegisterUsersForDevice')) {
    const { holen, aufrufe } = holenFuer(f);
    const d = f.response.data;
    const stand = await listRegisterUsersForDevice({ ...(f.params as typeof GERAET), fetch: holen });
    assert.deepEqual(aufrufe[0]!.params, f.params, f.case);
    assert.equal(stand.loginMode, d.loginMode, f.case);
    assert.deepEqual(stand.policy, d.policy, f.case);
    assert.deepEqual(stand.users, d.users.map((u: Json) => ({ ...u, pinPolicyOutdated: u.pinPolicyOutdated === true })), f.case);
    assert.deepEqual(stand.settings, d.settings, f.case);
    assert.equal(stand.locationLock, d.locationLock, f.case);
    assert.equal(stand.testEnvironment, d.testEnvironment, f.case);
    assert.deepEqual(stand.cashregister, { ready: d.cashregister.ready, reason: d.cashregister.reason ?? null }, f.case);
    assert.equal(stand.receiptHeader?.companyName, d.receiptHeader.company, f.case);
    assert.equal(stand.receiptHeader?.vatId, d.receiptHeader.vatId, f.case);
  }
  // Die Kataloge der Anmeldung: PIN-Zeichen und Anmeldemodus.
  assert.deepEqual(Object.values(VOKABULAR.catalogs.ANMELDEMODUS), ['select_user', 'pin']);
  assert.deepEqual(Object.values(VOKABULAR.catalogs.PIN_ZEICHEN), ['digits', 'alphanumeric']);
});

test('listRegisterUsersForDevice: der Standort der gebundenen Kasse reist mit, fehlt er, fehlt das Feld', async () => {
  const basis = erfolge('listRegisterUsersForDevice')[0]!;
  const d = basis.response.data;
  const mit = { ...basis, response: { ...basis.response, data: { ...d, cashregister: { ...d.cashregister, stockLocationId: 'auto1' } } } };
  const stand = await listRegisterUsersForDevice({ ...(mit.params as typeof GERAET), fetch: holenFuer(mit).holen });
  assert.equal(stand.cashregister?.stockLocationId, 'auto1');
  const ohne = await listRegisterUsersForDevice({ ...(basis.params as typeof GERAET), fetch: holenFuer(basis).holen });
  assert.equal(ohne.cashregister !== undefined && 'stockLocationId' in ohne.cashregister, false);
});

test('listRegisterUsersForDevice: leerer oder kein Text als Standort der Kasse ergibt kein Feld', async () => {
  const basis = erfolge('listRegisterUsersForDevice')[0]!;
  const d = basis.response.data;
  for (const wert of ['', 7, null, ['auto1'], {}]) {
    const f = { ...basis, response: { ...basis.response, data: { ...d, cashregister: { ...d.cashregister, stockLocationId: wert } } } };
    const stand = await listRegisterUsersForDevice({ ...(f.params as typeof GERAET), fetch: holenFuer(f).holen });
    assert.equal(stand.cashregister?.ready, d.cashregister.ready, JSON.stringify(wert));
    assert.equal('stockLocationId' in stand.cashregister!, false, JSON.stringify(wert));
  }
});

test('Anmeldung: fehlendes stockView gilt als erteilt, ausdrueckliches false sperrt (echter Leseweg)', async () => {
  const basis = erfolge('registerUserLogin')[0]!;
  const user = basis.response.data.user;
  const anmelden = async (perms: Json) => {
    const f = { ...basis, response: { ...basis.response, data: { ...basis.response.data, user: { ...user, perms } } } };
    return registerUserLogin({ ...(f.params as Json), fetch: holenFuer(f).holen } as Parameters<typeof registerUserLogin>[0]);
  };
  const { stockView: _weg, ...ohne } = { ...user.perms, stockView: true } as Json;
  const fehlt = await anmelden(ohne);
  assert.equal('stockView' in fehlt.user.perms, false);
  assert.equal(stockViewOf(fehlt.user.perms), true);
  assert.equal(stockViewOf((await anmelden({ ...ohne, stockView: false })).user.perms), false);
  assert.equal(stockViewOf((await anmelden({ ...ohne, stockView: true })).user.perms), true);
  // Die uebrigen Lager-Rechte gelten ohne Schluessel als verweigert.
  assert.equal(fehlt.user.perms['stockMove'], undefined);
});

test('listRegisterSessionsForDevice: own statt selbst, deviceLabel null statt „Kasse"', async () => {
  for (const f of erfolge('listRegisterSessionsForDevice')) {
    const { holen } = holenFuer(f);
    const stand = await listRegisterSessionsForDevice({ ...(f.params as typeof GERAET), fetch: holen });
    assert.deepEqual(stand, {
      licenses: f.response.data.licenses,
      sessions: f.response.data.sessions.map((s: Json) => ({ ...s, own: s.own === true })),
    }, f.case);
  }
  const ohneName = fall('listRegisterSessionsForDevice', 'success_without_license_field');
  assert.ok(ohneName.response.data.sessions.some((s: Json) => s.deviceLabel === null), 'der Vertrag fuehrt einen Fall ohne Geraetenamen');
});

test('registerUserLogin/registerPinLogin: Sitzung wie im Fall', async () => {
  for (const endpunkt of ['registerUserLogin', 'registerPinLogin'] as const) {
    for (const f of erfolge(endpunkt)) {
      const { holen, aufrufe } = holenFuer(f);
      const optionen = { ...(f.params as Json), fetch: holen } as Parameters<typeof registerUserLogin>[0];
      const sitzung = endpunkt === 'registerUserLogin' ? await registerUserLogin(optionen) : await registerPinLogin(optionen);
      assert.deepEqual(aufrufe[0]!.params, f.params, `${endpunkt}/${f.case}`);
      assert.equal(sitzung.sessionId, f.response.data.sessionId);
      assert.deepEqual(sitzung.user.perms, f.response.data.user.perms);
    }
  }
});

// --- Fehler am Code ---------------------------------------------------------------

const ANMELDE_AUFRUFE: Record<string, (holen: FetchLike) => Promise<unknown>> = {
  pairRegisterDevice: (holen) => pairRegisterDevice({ code: 'EXMPXV29', fetch: holen }),
  listRegisterUsersForDevice: (holen) => listRegisterUsersForDevice({ ...GERAET, fetch: holen }),
  listRegisterSessionsForDevice: (holen) => listRegisterSessionsForDevice({ ...GERAET, fetch: holen }),
  registerUserLogin: (holen) => registerUserLogin({ ...GERAET, userId: 'ru_chef', pin: '0001', cashregisterId: 'KASSE1', fetch: holen }),
  registerPinLogin: (holen) => registerPinLogin({ ...GERAET, pin: '0001', cashregisterId: 'KASSE1', fetch: holen }),
  unpairRegisterDevice: (holen) => unpairRegisterDevice({ ...GERAET, fetch: holen }),
  renewRegisterSession: (holen) => renewRegisterSession(createTransport({ auth: registerUserAuth({ getIdToken: () => 'eyJ', getSessionId: () => 's', cashregisterId: 'KASSE1' }), fetch: holen })),
  endRegisterSession: (holen) => endRegisterSession(createTransport({ auth: registerUserAuth({ getIdToken: () => 'eyJ', getSessionId: () => 's', cashregisterId: 'KASSE1' }), fetch: holen })),
};

test('Anmeldung: jeder Fehlerfall des Vertrags wird am Code erkannt, samt seinen Daten', async () => {
  let gezaehlt = 0;
  for (const [endpunkt, aufruf] of Object.entries(ANMELDE_AUFRUFE)) {
    for (const f of fehler(endpunkt)) {
      const e = await wurf(aufruf(holenFuer(f).holen));
      const code = f.response.code as string;
      assert.ok(isKasseneckApiError(e), `${endpunkt}/${f.case}`);
      assert.equal(registerErrorCode(e), code, `${endpunkt}/${f.case}`);
      assert.ok(isRegisterError(e, code as never), `${endpunkt}/${f.case}`);
      const daten = registerErrorDetails(e);
      const roh = f.response.data as Json;
      if ('deviceLabel' in roh) assert.equal(daten.deviceLabel, roh.deviceLabel, `${endpunkt}/${f.case}`);
      if ('takeoverAllowed' in roh) assert.equal(daten.takeoverAllowed, roh.takeoverAllowed);
      if ('retryAfterSec' in roh) assert.equal(daten.retryAfterSec, roh.retryAfterSec);
      if ('distanceM' in roh) assert.equal(daten.distanceM, roh.distanceM);
      if ('licenses' in roh) assert.deepEqual([daten.pairedDevices, daten.licenses], [roh.pairedDevices, roh.licenses]);
      gezaehlt += 1;
    }
  }
  assert.ok(gezaehlt > 60, `nur ${gezaehlt} Fehlerfaelle`);
});

test('Anmeldung: die Kernfaelle der Kasse, am Code und ohne Text', async () => {
  const belegt = await wurf(ANMELDE_AUFRUFE.registerPinLogin!(holenFuer(fall('registerPinLogin', 'in_use')).holen));
  assert.ok(isRegisterError(belegt, 'cashregister_in_use'));
  assert.deepEqual([registerErrorDetails(belegt).deviceLabel, registerErrorDetails(belegt).takeoverAllowed], ['Tablet vorne', false]);
  const ohneName = await wurf(ANMELDE_AUFRUFE.registerUserLogin!(holenFuer(fall('registerUserLogin', 'in_use_device_without_label')).holen));
  assert.equal(registerErrorDetails(ohneName).deviceLabel, null);
  const gesperrt = await wurf(ANMELDE_AUFRUFE.registerPinLogin!(holenFuer(fall('registerPinLogin', 'device_locked_steps')).holen));
  assert.ok(isRegisterError(gesperrt, 'too_many_attempts'));
  assert.equal(registerErrorDetails(gesperrt).retryAfterSec, 42);
  const falsch = await wurf(ANMELDE_AUFRUFE.registerPinLogin!(holenFuer(fall('registerPinLogin', 'pin_wrong')).holen));
  assert.ok(isRegisterError(falsch, 'login_failed'));
  assert.equal(isRegisterError(falsch, 'too_many_attempts'), false);
  const abgelaufen = await wurf(ANMELDE_AUFRUFE.renewRegisterSession!(holenFuer(fall('renewRegisterSession', 'session_expired')).holen));
  assert.ok(isRegisterError(abgelaufen, 'session_expired'));
  // Derselbe Text mit einem anderen Code ist ein anderer Fehler: entschieden wird am Code.
  const umbenannt = new KasseneckApiError('registerPinLogin', 'Anmeldung fehlgeschlagen.', {}, 'too_many_attempts');
  assert.equal(isRegisterError(umbenannt, 'login_failed'), false);
  // Ein fremder Code und ein Nicht-API-Fehler sind keine Anmeldefehler.
  assert.equal(isRegisterError(new KasseneckApiError('x', 'y', {}, 'receipt_not_found')), false);
  assert.equal(isRegisterError(new Error('Anmeldung fehlgeschlagen.')), false);
});

test('Kasse: jeder Fehlerfall der uebrigen Kassen-Aufrufe wird am Code erkannt', async () => {
  const layout = fall('createPrintJob', 'success_owner').params.layout as ReceiptLayout;
  const aufrufe: Record<string, (rufen: ReturnType<typeof kassenweg>['rufen']) => Promise<unknown>> = {
    listMyArticleGroups: (r) => listMyArticleGroups(r),
    listMyArticles: (r) => listMyArticles(r),
    getKasseSettings: (r) => getPosSettings(r),
    setMyKasseSettings: (r) => setMyPosSettings(r, { theme: 'clear' }),
    setMyKasseLogo: (r) => setMyPosLogo(r, { remove: true }),
    setMyRegisterDeviceSettings: (r) => setMyRegisterDeviceSettings(r, 'dev_pin', { layout: 'right' }),
    listMyPrinters: (r) => listMyPrinters(r),
    createPrintJob: (r) => createPrintJob(r, { printerId: 'dr_theke', layout }),
    getPrintJob: (r) => getPrintJob(r, { printerId: 'dr_theke', jobId: 'job1' }),
    listMyTipRecipients: (r) => listMyTipRecipients(r),
    listMyStockLocations: (r) => listMyStockLocations(r),
    listMyStock: (r) => listMyStock(r),
    setMyCashregisterStockLocation: (r) => setMyCashregisterStockLocation(r, { cashregisterId: 'KASSE1', stockLocationId: 'auto1' }),
  };
  for (const [endpunkt, aufruf] of Object.entries(aufrufe)) {
    for (const f of fehler(endpunkt)) {
      const e = await wurf(aufruf(kassenweg(f).rufen));
      assert.ok(isPosError(e, f.response.code), `${endpunkt}/${f.case}`);
    }
  }
  const e = await wurf(setMyPosSettings(kassenweg(fall('setMyKasseSettings', 'nothing_valid')).rufen, { theme: 'clear' }));
  assert.deepEqual(posFieldErrors(e).map((x) => x.field), ['business.gibtsnicht', 'business.theme']);
});

test('Fehlercode-Listen: deckungsgleich mit dem Vertrag (Faelle + Handler-Codes je Endpunkt)', () => {
  const ableiten = (endpunkte: string[]) => {
    const codes = new Set<string>();
    for (const e of endpunkte) {
      for (const f of fehler(e)) codes.add(f.response.code);
      for (const c of VOKABULAR.errorCodes.registerHandlersByEndpoint[e] ?? []) codes.add(c);
    }
    // Was Anmeldung und Rand auf jedem Kassen-Endpunkt erzeugen koennen (test/kassenweg-codes.ts).
    for (const c of randUndAnmeldung()) codes.add(c);
    // Zuletzt der Code, den das Paket selbst vergibt (HTML statt Backend).
    return [...[...codes].sort(), 'route_missing'];
  };
  assert.deepEqual([...REGISTER_ERROR_CODES], ableiten(Object.keys(ANMELDE_AUFRUFE)));
  assert.deepEqual([...POS_ERROR_CODES], ableiten([
    'listMyArticleGroups', 'listMyArticles', 'getKasseSettings', 'setMyKasseSettings', 'setMyKasseLogo',
    'setMyRegisterDeviceSettings', 'listMyPrinters', 'createPrintJob', 'getPrintJob', 'listMyTipRecipients',
    'listMyStockLocations', 'listMyStock', 'setMyCashregisterStockLocation',
    'listMyStocktakes', 'listMyStocktakeItems', 'listMyStocktakeCounts', 'recordMyStocktakeCount', 'voidMyStocktakeCount',
  ]));
  for (const c of ['register_user_not_found', 'not_found', 'dialect_mismatch', 'response_translation_failed', 'validation', 'route_missing']) {
    assert.ok((REGISTER_ERROR_CODES as readonly string[]).includes(c) && (POS_ERROR_CODES as readonly string[]).includes(c), c);
  }
  // Der geloeschte Benutzer mitten in der Sitzung ist erkennbar.
  const weg = new KasseneckApiError('listMyArticles', 'Kassen-Benutzer nicht gefunden.', {}, 'register_user_not_found');
  assert.ok(isPosError(weg, 'register_user_not_found'));
  assert.ok(isRegisterError(weg, 'register_user_not_found'));
});

// --- Gespeicherte Staende (B2) ------------------------------------------------------

test('B2: ein 0.x-Geraetesatz der Web-Kasse (betrieb/kasse) meldet sich ohne neue Kopplung an', async () => {
  // So legt die Web-Kasse 0.x ihren Satz ab (apps/kasse/src/lib/geraet.ts):
  // die Anzeigefelder heissen betrieb/kasse, das Paket liest sie nie.
  const alt = { ...GERAET, cashregisterId: 'KASSE1', betrieb: 'Café Welt', kasse: 'Theke 1' };
  const listeFall = fall('listRegisterUsersForDevice', 'success_only_pin');
  const liste = holenFuer(listeFall);
  await listRegisterUsersForDevice({ ...alt, fetch: liste.holen });
  assert.deepEqual(liste.aufrufe[0]!.params, GERAET);

  const loginFall = fall('registerPinLogin', 'success');
  const login = holenFuer(loginFall);
  const sitzung = await registerPinLogin({ ...alt, pin: '0002', fetch: login.holen });
  assert.deepEqual(login.aufrufe[0]!.params, { ...GERAET, pin: '0002', cashregisterId: 'KASSE1' });
  assert.equal(sitzung.sessionId, loginFall.response.data.sessionId);

  // Ebenso ein abgelegtes 0.x-Kopplungsergebnis (companyName/cashregisterLabel, ohne testEnvironment).
  const paired0x = { ...GERAET, cashregisterId: 'KASSE1', companyName: 'Café Welt', cashregisterLabel: 'Theke 1' };
  const sitzungen = holenFuer(fall('listRegisterSessionsForDevice', 'success_only_pin'));
  await listRegisterSessionsForDevice({ ...paired0x, fetch: sitzungen.holen });
  assert.deepEqual(sitzungen.aufrufe[0]!.params, GERAET);
});

test('Kein Geheimnis in den Fehlerdaten: deviceSecret und PIN bleiben draussen', async () => {
  const f = fall('registerPinLogin', 'in_use');
  const e = await wurf(ANMELDE_AUFRUFE.registerPinLogin!(holenFuer(f).holen));
  const text = JSON.stringify({ message: (e as Error).message, details: (e as KasseneckApiError).details });
  assert.equal(text.includes(GERAET.deviceSecret), false);
});

// --- Nachbesserung Review Aufgabe 7 ---------------------------------------------

test('F1: ein unbekannter Wert des Servers bleibt beim Lesen stehen und geht beim Teil-Schreiben nicht verloren', async () => {
  const basis = fall('getKasseSettings', 'owner');
  const neu: Fall = JSON.parse(JSON.stringify(basis));
  neu.response.data.business.theme = 'sepia';
  neu.response.data.device.printerType = 'star';
  const stand = await getPosSettings(kassenweg(neu).rufen);
  assert.equal(stand.business.theme, 'sepia');
  assert.equal(stand.device.printerType, 'star');
  assert.deepEqual(kasse.unknownPosSettingValues(stand), ['business.theme', 'device.printerType']);

  // Ein anderes Feld aendern und schreiben: gesendet wird nur dieses Feld.
  const geaendert = { ...stand.business, fontSize: 'L' as const };
  const aenderung = kasse.posSettingsChanges(stand.business, geaendert);
  assert.deepEqual(aenderung, { fontSize: 'L' });
  const schreiben = fall('setMyKasseSettings', 'success_owner');
  const weg = kassenweg(schreiben);
  await setMyPosSettings(weg.rufen, aenderung);
  assert.deepEqual(weg.aufrufe[0]!.params.business, { fontSize: 'L' });
  assert.equal('theme' in weg.aufrufe[0]!.params.business, false);

  // Den ganzen Block zu senden, weist die Vorab-Pruefung laut ab statt 'sepia' still zu ersetzen.
  const e = await wurf(setMyPosSettings(kassenweg(schreiben).rufen, geaendert));
  assert.ok(isKasseneckValidationError(e));
  assert.match((e as Error).message, /business\.theme/);

  // vatRates geht bei einer Aenderung als ganze Karte, Tasten nur mit dem geaenderten Eintrag.
  const saetze = kasse.posSettingsChanges(stand.business, { ...stand.business, vatRates: { ...stand.business.vatRates, 19: true } });
  assert.deepEqual(Object.keys(saetze), ['vatRates']);
  assert.equal(Object.keys(saetze.vatRates!).length, Object.keys(stand.business.vatRates).length);
  const taste = kasse.posSettingsChanges(stand.device, { ...stand.device, shortcuts: { ...stand.device.shortcuts, cash: ['Mod+X'] } });
  assert.deepEqual(taste, { shortcuts: { ...stand.device.shortcuts, cash: ['Mod+X'] } });
});

test('F2: der 0.x-Filter gilt immer, auch fuer eine Kopie der Standards', () => {
  const kopie = structuredClone(POS_DEVICE_DEFAULTS) as PosDeviceSettings;
  const g = mergePosSettings(kopie, { layout: 'rechts', terminalVia: 'direkt', shortcuts: { kassieren: ['F1'] } } as never);
  assert.equal(g.layout, 'right');
  assert.equal(g.terminalVia, 'direct');
  assert.equal('kassieren' in g.shortcuts, false);
  // Gegen einen eigenen Zustand gemischt (wie die Web-Kasse mitGeraet(alt, ...)).
  const alt = { ...POS_DEVICE_DEFAULTS, printerType: 'bluetooth' as const };
  assert.equal(mergePosSettings(alt, { layout: 'links' } as never).layout, 'right');
  // sanitizePosSettings fuer einen selbst abgelegten Stand.
  const s = kasse.sanitizePosSettings({ business: { theme: 'nacht', fontSize: 'L', stil: 'nacht' }, device: { layout: 'vollbild' } });
  assert.equal(s.business.theme, 'clear');
  assert.equal(s.business.fontSize, 'L');
  assert.equal(s.device.layout, 'right');
  assert.deepEqual(kasse.sanitizePosSettings(null), { business: JSON.parse(JSON.stringify(POS_BUSINESS_DEFAULTS)), device: JSON.parse(JSON.stringify(POS_DEVICE_DEFAULTS)) });
  // Ein neuer englischer Wert ist kein Altwert und bleibt.
  assert.equal(kasse.sanitizePosSettings({ business: { theme: 'sepia' } }).business.theme, 'sepia');
});

test('F2: die Tabelle der Altwerte ist aus den Katalogen des Vokabulars (innere Werte ohne die gleichlautenden)', () => {
  const werte = VOKABULAR.schemas.getKasseSettings.werte as Record<string, { $catalog: string }>;
  const erwartet: Record<string, string[]> = {};
  for (const [pfad, { $catalog }] of Object.entries(werte)) {
    const karte = VOKABULAR.catalogs[$catalog] as Record<string, string>;
    const aussen = new Set(Object.values(karte));
    const alt = Object.keys(karte).filter((innen) => !aussen.has(innen));
    if (alt.length) erwartet[pfad.split('.')[1]!] = alt;
  }
  const tabelle = _ALTFORM_0X;
  assert.deepEqual(Object.fromEntries(Object.entries(tabelle.werte).map(([k, v]) => [k, [...v]])), erwartet);
  const tasten = VOKABULAR.schemas.getKasseSettings.data.device.shortcuts as Record<string, string>;
  assert.deepEqual([...tabelle.aktionen].sort(), Object.entries(tasten).filter(([k]) => k !== '__').map(([, v]) => v).sort());
});

test('F2: doppelt geladenes Paket (CJS und ESM im selben Prozess) filtert ebenso', async (t) => {
  const { createRequire } = await import('node:module');
  const { existsSync } = await import('node:fs');
  const cjsPfad = fileURLToPath(new URL('../../dist/cjs/pos/index.js', import.meta.url));
  const esmPfad = new URL('../../dist/esm/pos/index.js', import.meta.url);
  if (!existsSync(cjsPfad) || !existsSync(fileURLToPath(esmPfad))) {
    t.skip('dist fehlt (npm run build)');
    return;
  }
  const cjs = createRequire(import.meta.url)(cjsPfad) as typeof kasse;
  const esm = (await import(esmPfad.href)) as typeof kasse;
  assert.notEqual(cjs.POS_DEVICE_DEFAULTS, esm.POS_DEVICE_DEFAULTS);
  const g = esm.mergePosSettings(cjs.POS_DEVICE_DEFAULTS, { layout: 'rechts', terminalVia: 'direkt' } as never);
  assert.equal(g.layout, 'right');
  assert.equal(g.terminalVia, 'direct');
});

test('F3: geerbte Namen (toString, constructor, __proto__) bringen nichts zum Absturz', async () => {
  const boese = JSON.parse('{"toString":"y","constructor":1,"hasOwnProperty":2,"__proto__":{"x":1},"theme":"night"}');
  const b = mergePosSettings(POS_BUSINESS_DEFAULTS, boese);
  assert.equal(b.theme, 'night');
  assert.equal(typeof b.toString, 'function');
  assert.equal(Object.prototype.hasOwnProperty.call(b, 'constructor'), false);
  assert.equal(Object.getPrototypeOf(b), Object.prototype);
  const d = mergePosSettings(POS_DEVICE_DEFAULTS, JSON.parse('{"shortcuts":{"__proto__":{"x":1},"toString":["F2"]}}'));
  assert.equal(Object.getPrototypeOf(d.shortcuts), Object.prototype);
  const f = fall('setMyKasseSettings', 'success_manager');
  for (const k of ['constructor', 'toString', '__proto__']) {
    const e = await wurf(setMyPosSettings(kassenweg(f).rufen, JSON.parse(`{"${k}":1}`)));
    assert.ok(isKasseneckValidationError(e), k);
    assert.match((e as Error).message, new RegExp(`business\\.${k}`), k);
  }
  const e = await wurf(setMyRegisterDeviceSettings(kassenweg(f).rufen, 'dev_pin', JSON.parse('{"shortcuts":{"constructor":["F1"]}}')));
  assert.ok(isKasseneckValidationError(e));
  assert.deepEqual(kasse.posSettingsChanges(POS_BUSINESS_DEFAULTS, JSON.parse('{"__proto__":{"x":1}}')), {});
  assert.equal(kasse.unknownPosSettingValues(kasse.sanitizePosSettings(JSON.parse('{"__proto__":{"business":1}}'))).length, 0);
});

test('F4: ein Feld mit undefined wird vorab weder geprueft noch gesendet', async () => {
  const f = fall('setMyKasseSettings', 'success_manager');
  const { rufen, aufrufe } = kassenweg(f);
  await setMyPosSettings(rufen, { stil: undefined, theme: 'night' } as unknown as Partial<PosBusinessSettings>);
  assert.deepEqual(aufrufe[0]!.params.business, { theme: 'night' });
  const e = await wurf(setMyPosSettings(kassenweg(f).rufen, { stil: undefined } as unknown as Partial<PosBusinessSettings>));
  assert.match((e as Error).message, /keine Einstellungen/);
});

test('F5: source nimmt Freitext wie der Server (success_owner: labor)', async () => {
  const f = fall('createPrintJob', 'success_owner');
  assert.equal(f.params.source, 'labor');
  const { rufen, aufrufe } = kassenweg(f);
  await createPrintJob(rufen, { printerId: f.params.printerId, layout: f.params.layout as ReceiptLayout, source: 'labor' });
  assert.deepEqual(gesendet(aufrufe, 'createPrintJob', f), f.params);
});

test('F7: ein unbekannter Druckjob-Stand ist sichtbar unknown und beendet die Abfrage', async () => {
  const basis = fall('getPrintJob', 'success_open');
  const neu: Fall = JSON.parse(JSON.stringify(basis));
  neu.response.data.status = 'cancelled';
  const job = await getPrintJob(kassenweg(neu).rufen, { printerId: 'dr_theke', jobId: 'job2' });
  assert.equal(job.status, 'unknown');
  assert.equal(kasse.isPrintJobFinished(job.status), true);
  assert.equal(kasse.isPrintJobFinished('pending'), false);
  assert.equal(kasse.isPrintJobFinished('sent'), false);
  assert.equal(kasse.isPrintJobFinished('printed'), true);
  const ohne: Fall = JSON.parse(JSON.stringify(basis));
  delete ohne.response.data.status;
  assert.equal((await getPrintJob(kassenweg(ohne).rufen, { printerId: 'dr_theke', jobId: 'job2' })).status, 'unknown');
});

// --- Nachpruefung Aufgabe 7 (N1 bis N4) -------------------------------------------

test('N1: eine Tastenaenderung sendet die ganze Karte bekannter Aktionen, eine Doppelbelegung geht nicht hinaus', async () => {
  // Gespeichert: bar (cash) liegt auf Mod+B, vom Chef gesetzt. Neu soll karte (card) Mod+B bekommen.
  const vorher = mergePosSettings(POS_DEVICE_DEFAULTS, { shortcuts: { ...POS_SHORTCUT_DEFAULTS, cash: ['Mod+B'], druckNochmal: ['Mod+R'] } } as never);
  const nachher = { ...vorher, shortcuts: { ...vorher.shortcuts, card: ['Mod+B'] } };
  const aenderung = kasse.posSettingsChanges(vorher, nachher);
  assert.deepEqual(Object.keys(aenderung), ['shortcuts']);
  assert.deepEqual(Object.keys(aenderung.shortcuts!).sort(), [...POS_SHORTCUT_ACTIONS].sort(), 'ganze Karte, nur bekannte Aktionen');
  const f = fall('setMyRegisterDeviceSettings', 'success_manager');
  const { rufen, aufrufe } = kassenweg(f);
  const e = await wurf(setMyRegisterDeviceSettings(rufen, 'dev_pin', aenderung));
  assert.ok(isKasseneckValidationError(e));
  assert.match((e as Error).message, /device\.shortcuts\.(card|cash): Taste Mod\+B schon belegt/);
  assert.equal(aufrufe.length, 0, 'nichts ging hinaus');
  // Die erlaubten Paare teilen sich eine Taste (Vorgabe: checkout/complete auf Enter).
  assert.equal(kasse.posShortcutConflict(POS_SHORTCUT_DEFAULTS), null);
  assert.deepEqual(kasse.posShortcutConflict({ cash: ['Mod+B'], card: ['Mod+B'] }), { action: 'card', key: 'Mod+B', heldBy: 'cash' });
  // Wird cash zugleich frei, geht die ganze Karte hinaus.
  const sauber = kasse.posSettingsChanges(vorher, { ...vorher, shortcuts: { ...vorher.shortcuts, cash: ['Mod+Y'], card: ['Mod+B'] } });
  const w = kassenweg(f);
  await setMyRegisterDeviceSettings(w.rufen, 'dev_pin', sauber);
  assert.equal(w.aufrufe[0]!.params.device.shortcuts.card[0], 'Mod+B');
  assert.equal('druckNochmal' in w.aufrufe[0]!.params.device.shortcuts, false);
});

test('N2: die Abweisung eines unbekannten Serverwerts nennt posSettingsChanges, ein 0.x-Wert die innere Form', async () => {
  const f = fall('setMyKasseSettings', 'success_manager');
  const e = await wurf(setMyPosSettings(kassenweg(f).rufen, { theme: 'sepia' }));
  assert.match((e as Error).message, /business\.theme: .*posSettingsChanges/);
  const alt = await wurf(setMyPosSettings(kassenweg(f).rufen, { theme: 'nacht' }));
  assert.match((alt as Error).message, /business\.theme: .*0\.x/);
});

test('N3: unknownPosSettingValues nennt auch unbekannte Tasten-Aktionen', () => {
  const s = kasse.sanitizePosSettings({ device: { shortcuts: { druckNochmal: ['Mod+R'] } } });
  assert.deepEqual(kasse.unknownPosSettingValues(s), ['device.shortcuts.druckNochmal']);
});

test('N4: der Partner-Zugang ist aus dem Vertrag abgeleitet und steht vollstaendig in errorCodes.auth', () => {
  const partner = partnerZugangsCodes();
  assert.deepEqual(partner, ['partner_locked', 'scope_missing', 'rate_limited', 'not_a_partner',
    'partner_membership_missing', 'partner_owner_only', 'partner_account_not_allowed']);
  for (const c of partner) assert.ok((VOKABULAR.errorCodes.auth as string[]).includes(c), c);
  for (const c of partner) assert.equal((REGISTER_ERROR_CODES as readonly string[]).includes(c), false, c);
});
