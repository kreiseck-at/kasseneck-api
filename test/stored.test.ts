import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as stored from '../src/stored/index.js';
import { _storedArticleToWire, _storedPosSettingsToWire, _storedReceiptToWire } from '../src/stored/draht.js';
import { ARTIKEL_FELDER, KATALOGE, SCHEMAS, VOKABULAR_QUELLE } from '../src/stored/vokabular.js';
import type { InternerTransport } from '../src/client/aufrufe.js';
import { getReceipt, getReceiptWithCompany } from '../src/client/receipts.js';
import { posSettingsFromWire } from '../src/kasse/client.js';
import { fromPosArticlePayload, type PosArticlePayload } from '../src/kasse/artikel.js';
import { unknownPosSettingValues, POS_DEVICE_DEFAULTS } from '../src/kasse/settings.js';
import { buildReceiptLayout, CURRENT_LAYOUT_RULESET } from '../src/receipt/layout.js';
import { isKasseneckValidationError } from '../src/client/errors.js';

/**
 * `./stored`: gespeicherte Firestore-Dokumente (innen, deutsch) ergeben
 * dasselbe englische Modell wie die Antwort des Servers, nachdem sie durch den
 * normalen Leser dieses Pakets gegangen ist. Paare aus dem Vertrags-Export
 * (fixtures/v3): `stored/` haelt die Dokumente, aus denen `antworten/`
 * entstand (README dort). Zusaetzlich auf Drahtebene: die innere Uebersetzung
 * ergibt die Antwort des Servers Feld fuer Feld, nicht nur das, was der Leser
 * davon behaelt.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const lies = (datei: string): Json =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/v3/${datei}`, import.meta.url)), 'utf8')) as Json;

const VOKABULAR = lies('v3-vokabular.json');
const BELEGE_GESPEICHERT = lies('stored/belege.json').documents as Record<string, Json>;
const KASSE_GESPEICHERT = lies('stored/kasse.json');
const KASSE_BELEGE = lies('antworten/kasse-belege.json');
const BELEGE = lies('antworten/belege.json');
const STORNO = lies('antworten/storno.json');
const KASSE = lies('antworten/kasse.json').endpoints as Record<string, { cases: Json[] }>;

const rufenMit = (daten: unknown): InternerTransport => (async () => daten) as unknown as InternerTransport;

/** Das gespeicherte Belegdokument mit dieser Nummer (Welt der Belege). */
function belegDokument(receiptId: string): Json {
  const treffer = Object.values(BELEGE_GESPEICHERT).filter((d) => d.receiptId === receiptId);
  assert.equal(treffer.length, 1, `Belegdokument ${receiptId}`);
  return treffer[0];
}
const kasseBelegFall = (name: string): Json => {
  const f = KASSE_BELEGE.cases.find((c: Json) => c.name === name);
  assert.ok(f && f.response.status === 'success', `Fall ${name}`);
  return f.response.data;
};
const kasseFall = (endpunkt: string, name: string): Json => {
  const f = KASSE[endpunkt]!.cases.find((c: Json) => c.case === name);
  assert.ok(f && f.response.status === 'success', `Fall ${endpunkt}/${name}`);
  return f;
};

/**
 * Die Welt eines Falls der Kassen-Welt: Ausgangsbestand plus das, was der Fall
 * aenderte (`null` = geloescht).
 */
function welt(endpunkt: string | null, fall: string | null): Record<string, Json> {
  const raus: Record<string, Json> = { ...KASSE_GESPEICHERT.baseline };
  if (endpunkt && fall) {
    for (const [pfad, doc] of Object.entries(KASSE_GESPEICHERT.endpoints[endpunkt].cases[fall] as Record<string, Json>)) {
      if (doc === null) delete raus[pfad];
      else raus[pfad] = doc;
    }
  }
  return raus;
}

const ohneAnbieterdaten = (d: Json): Json => {
  const { cardPaymentId: _i, cardPaymentData: _d, ...rest } = d;
  if (Array.isArray(rest.payments)) {
    rest.payments = rest.payments.map((z: Json) => {
      const { providerData: _p, providerPaymentId: _q, ...z2 } = z;
      return z2;
    });
  }
  return rest;
};

// ---- Vokabular: abgeleitet, nie doppelt gepflegt -----------------------------

test('stored: das Vokabular stammt woertlich aus dem Vertrags-Export', () => {
  assert.equal(VOKABULAR_QUELLE, VOKABULAR._quelle.sha256);
  for (const name of Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[]) {
    assert.deepEqual(SCHEMAS[name].data, VOKABULAR.schemas[name].data, `${name}.data`);
    assert.deepEqual(SCHEMAS[name].werte, VOKABULAR.schemas[name].werte, `${name}.werte`);
  }
  assert.deepEqual(ARTIKEL_FELDER, VOKABULAR.articleFields.outer);
  const verwiesen = new Set(Object.values(SCHEMAS).flatMap((s) => Object.values(s.werte).map((w) => w.$catalog)));
  assert.deepEqual(Object.keys(KATALOGE).sort(), [...verwiesen].sort());
  for (const [name, katalog] of Object.entries(KATALOGE)) assert.deepEqual(katalog, VOKABULAR.catalogs[name], name);
});

// ---- Belege ------------------------------------------------------------------

/**
 * Kanal `app` (mit Anbieterdaten): je gespeichertem Beleg die Antwort, die
 * denselben Stand zeigt. KECK-1-ID-3 wurde nach seiner Antwort storniert
 * (cancellations[]); es kommt ueber den Bericht unten.
 */
const PAARE_APP: [string, () => Json][] = [
  ['KECK-1-ID-1', () => kasseBelegFall('start_receipt')],
  ['KECK-1-ID-2', () => kasseBelegFall('get_card_receipt_with_cancellation')],
  ['KECK-1-ID-4', () => kasseBelegFall('get_mixed_receipt')],
  ['KECK-1-ID-5', () => kasseBelegFall('sale_v2_items_value_voucher')],
  ['KECK-1-ID-6', () => kasseBelegFall('get_zero_receipt')],
  ['KECK-1-ID-7', () => kasseBelegFall('get_cancellation_receipt')],
  ['KECK-1-ID-8', () => STORNO.cases.find((c: Json) => c.name === 'cancel_partial_items' && c.channel === 'app').response.data],
];

test('stored: jeder gespeicherte Beleg (Kanal app) ergibt die Antwort des Servers, Draht und Modell', async () => {
  for (const [id, antwort] of PAARE_APP) {
    const daten = antwort();
    const doc = belegDokument(id);
    assert.equal(daten.receipt.receiptId, id);
    assert.deepEqual(_storedReceiptToWire(doc), daten.receipt, `${id} Draht`);
    assert.deepEqual(stored.fromStoredReceipt(doc), await getReceipt(rufenMit({ receipt: daten.receipt }), id), `${id} Modell`);
  }
  // Mit Anbieterdaten: der Kartenbeleg traegt sie am Modell.
  const karte = stored.fromStoredReceipt(belegDokument('KECK-1-ID-2'));
  assert.ok(karte.payments?.some((z) => z.providerPaymentId), 'providerPaymentId am Kartenbeleg');
});

test('stored: alle gespeicherten Belege gleichen dem Bericht (Kanal api, ohne Anbieterdaten)', () => {
  const bericht = BELEGE.cases.find((c: Json) => c.name === 'report').response.data.receipts as Json[];
  const docs = Object.values(BELEGE_GESPEICHERT);
  assert.equal(bericht.length, docs.length);
  for (const doc of docs) {
    const antwort = bericht.find((r) => r.receiptId === doc.receiptId);
    assert.ok(antwort, doc.receiptId);
    assert.deepEqual(ohneAnbieterdaten(_storedReceiptToWire(doc)), antwort, doc.receiptId);
  }
});

test('stored: Layout aus dem gespeicherten Beleg gleicht dem Layout des Servers', async () => {
  for (const [id, antwort] of PAARE_APP) {
    const daten = antwort();
    if (!daten.layout) continue; // cancelReceipt liefert kein Layout
    const mitFirma = await getReceiptWithCompany(rufenMit(daten), id);
    const layout = buildReceiptLayout(stored.fromStoredReceipt(belegDokument(id)), mitFirma.company, {
      paperSize: 'mm80', ruleset: CURRENT_LAYOUT_RULESET,
      testCashregister: mitFirma.testCashregister, testSignature: mitFirma.testSignature, registrationInfo: mitFirma.registrationInfo,
    });
    assert.deepEqual(layout, daten.layout, `${id} Layout`);
  }
});

/** Kassen-Welt: Belege aus createReceipt mit Kopf-Version und Konto, ganz wie die Antwort. */
const KASSE_BELEGE_FAELLE = ['start_receipt', 'sale_cashregister', 'sale_payments', 'sale_device'];

test('stored: Beleg mit Firma und Layout aus Kopf-Version und Konto (Kassen-Welt)', async () => {
  const kopfPfad = 'users/kw_betrieb1/beleg_kopf/auto1';
  const kopf = KASSE_GESPEICHERT.endpoints.createReceipt.cases.start_receipt[kopfPfad];
  assert.ok(kopf);
  for (const fall of KASSE_BELEGE_FAELLE) {
    const w = welt('createReceipt', fall);
    const antwort = kasseFall('createReceipt', fall).response.data;
    const doc = w[`users/kw_betrieb1/cashregisters/KASSE1/receipts/${antwort.receipt.receiptId}`];
    assert.ok(doc, fall);
    const erwartet = await getReceiptWithCompany(rufenMit(antwort), antwort.receipt.receiptId);
    const ist = stored.fromStoredReceiptWithCompany(doc, { headerVersion: { id: 'auto1', data: kopf }, account: w['users/kw_betrieb1'] });
    assert.deepEqual(ist, erwartet, fall);
    assert.ok(ist.layout && ist.layout.lines.length > 0);
    assert.deepEqual(stored.fromStoredCompany(kopf, { account: w['users/kw_betrieb1'] }), erwartet.company, `${fall} Firma`);
  }
});

test('stored: Testumgebung zeigt TESTKASSE statt der Testsignatur-Warnung (wie belegAntwort)', () => {
  const kopf = KASSE_GESPEICHERT.endpoints.createReceipt.cases.start_receipt['users/kw_betrieb1/beleg_kopf/auto1'];
  const doc = belegDokument('KECK-1-ID-2');
  assert.match(doc.qr, /^_R1-AT100_/);
  const prod = stored.fromStoredReceiptWithCompany(doc, { headerVersion: { id: 'auto1', data: kopf } });
  assert.equal(prod.testSignature, true);
  assert.equal(prod.testCashregister, false);
  const test = stored.fromStoredReceiptWithCompany(doc, { headerVersion: { id: 'auto1', data: kopf }, testCashregister: true });
  assert.equal(test.testSignature, false);
  assert.equal(test.testCashregister, true);
  const texte = (test.layout?.lines ?? []).flatMap((z) => (z.kind === 'banner' ? [z.text] : []));
  assert.ok(texte.some((t) => t.startsWith('TESTKASSE')), texte.join('|'));
  assert.ok(!texte.some((t) => t.startsWith('TESTSIGNATUR')), texte.join('|'));
  assert.throws(() => stored.fromStoredReceiptWithCompany(doc, {} as never), (e) => isKasseneckValidationError(e));
});

test('stored: Freitextzeilen als Liste gespeichert werden Zeilen (wie beleg-layout.belegPayload)', () => {
  const b = stored.fromStoredReceipt({ ...belegDokument('KECK-1-ID-4'), customerDetails: ['Firma X', '', 'Wien'], legalMessage: 'Hinweis' });
  assert.deepEqual(b.customerDetails, ['Firma X', 'Wien']);
  assert.deepEqual(b.legalMessage, ['Hinweis']);
});

test('stored: Firma folgt dem Server (Nullbeleg ohne Logo, alte Version nimmt das Profil-Logo)', () => {
  const kopf = KASSE_GESPEICHERT.endpoints.createReceipt.cases.start_receipt['users/kw_betrieb1/beleg_kopf/auto1'];
  const konto = { logo_url: 'https://example.invalid/profil.png' };
  assert.equal(stored.fromStoredCompany(kopf, { receipt: { receiptType: 'zero' } }).logoUrl, undefined);
  const { logoUrl: _l, ...alt } = kopf;
  assert.equal(stored.fromStoredCompany(alt, { account: konto }).logoUrl, 'https://example.invalid/profil.png');
  assert.equal(stored.fromStoredCompany({ ...kopf, logoUrl: null }, { account: konto }).logoUrl, undefined);
  // Luecken wie nurKopf: fehlende Pflichtfelder leer, Dank als Zeilen.
  const leer = stored.fromStoredCompany({});
  assert.equal(leer.companyName, '');
  assert.deepEqual(leer.thanksMessage, []);
  assert.deepEqual(stored.fromStoredCompany({ thanksMessage: ['Danke', 'Bis bald'] }).thanksMessage, ['Danke', 'Bis bald']);
});

test('stored: Storno-Marke faellt weg, Grund englisch, unbekannter Grund bleibt woertlich', () => {
  const doc = {
    ...belegDokument('KECK-1-ID-7'),
    cancellationOf: { receiptId: 'KECK-1-ID-2', fullReceiptId: 'x', timeStamp: '2026-09-26T10:00:00', marke: 'm1' },
    cancellations: [{ receiptId: 'KECK-1-ID-9', marke: 'm2', items: [] }],
  };
  const draht: Json = _storedReceiptToWire(doc);
  assert.equal('stornoMarke' in draht, false);
  assert.equal('marke' in draht.cancellationOf, false);
  assert.equal('marke' in draht.cancellations[0], false);
  assert.equal(draht.cancellationReason, 'input_error');
  assert.equal(_storedReceiptToWire({ ...doc, cancellationReason: 'neu_am_server' }).cancellationReason, 'neu_am_server');
  // Das Dokument selbst bleibt unberuehrt.
  assert.equal(doc.cancellationOf.marke, 'm1');
  assert.equal(doc.stornoMarke, 'mui3ncw0-1111111111');
});

test('stored: Registrierdaten als Firestore-Zeitstempel werden ISO-Zeitpunkte', () => {
  const doc = belegDokument('KECK-1-ID-6');
  const zeit = { toDate: () => new Date('2024-03-11T08:00:00.000Z') };
  const b = stored.fromStoredReceipt({ ...doc, pruefangaben: { karteRegistriertAm: zeit, kasseRegistriertAm: null } });
  assert.deepEqual(b.registrationInfo, { cardRegisteredAt: '2024-03-11T08:00:00.000Z', cashregisterRegisteredAt: null });
});

test('stored: kein Belegdokument -> Fehler, nie ein halbes Modell', () => {
  for (const kaputt of [null, undefined, 'x', [], {}]) {
    assert.throws(() => stored.fromStoredReceipt(kaputt), (e) => isKasseneckValidationError(e), String(kaputt));
  }
});

// ---- Kassen-Einstellungen -----------------------------------------------------

/** Welt-Fall -> Antwort-Fall; Geraet aus den Parametern der Antwort. */
const EINSTELLUNGEN: { welt: [string, string] | null; antwort: [string, string]; teil: 'business' | 'device' | 'beide' }[] = [
  { welt: null, antwort: ['getKasseSettings', 'owner'], teil: 'beide' },
  { welt: null, antwort: ['getKasseSettings', 'owner_with_device'], teil: 'beide' },
  { welt: null, antwort: ['getKasseSettings', 'manager_with_device'], teil: 'beide' },
  { welt: null, antwort: ['getKasseSettings', 'cashier_unknown_device'], teil: 'beide' },
  { welt: ['listRegisterUsersForDevice', 'success_only_pin'], antwort: ['listRegisterUsersForDevice', 'success_only_pin'], teil: 'beide' },
  { welt: null, antwort: ['listRegisterUsersForDevice', 'success_select'], teil: 'beide' },
  // Der Fall leert register_settings vor dem Aufruf; der Export fuehrt diese
  // Vorbereitung nicht als Aenderung (Backend-Folgepunkt). Darum nur das Geraet.
  { welt: ['listRegisterUsersForDevice', 'account_without_settings'], antwort: ['listRegisterUsersForDevice', 'account_without_settings'], teil: 'device' },
  { welt: ['setMyKasseSettings', 'success_manager'], antwort: ['setMyKasseSettings', 'success_manager'], teil: 'business' },
  { welt: ['setMyKasseSettings', 'success_owner'], antwort: ['setMyKasseSettings', 'success_owner'], teil: 'business' },
  { welt: ['setMyRegisterDeviceSettings', 'success_manager'], antwort: ['setMyRegisterDeviceSettings', 'success_manager'], teil: 'device' },
  { welt: ['setMyRegisterDeviceSettings', 'success_owner'], antwort: ['setMyRegisterDeviceSettings', 'success_owner'], teil: 'device' },
];

/**
 * Drahtebene der Einstellungen: `./stored` uebersetzt nur die gespeicherten
 * Felder (die Vorgaben mischt der Leser dazu), der Server sendet den
 * gemischten Stand. Jedes uebersetzte Feld steht also mit demselben Wert in
 * der Antwort, Landkarten eintragsweise.
 */
function teilVon(ist: Json, soll: Json, name: string): void {
  for (const [k, w] of Object.entries(ist)) {
    if (w !== null && typeof w === 'object' && !Array.isArray(w)) {
      for (const [e, v] of Object.entries(w as Json)) assert.deepEqual(v, soll[k]?.[e], `${name}: ${k}.${e}`);
    } else {
      assert.deepEqual(w, soll[k], `${name}: ${k}`);
    }
  }
}

test('stored: gespeicherte Kassen-Einstellungen ergeben die Antwort des Servers, Draht und Modell', () => {
  for (const e of EINSTELLUNGEN) {
    const w = welt(e.welt?.[0] ?? null, e.welt?.[1] ?? null);
    const fall = kasseFall(e.antwort[0], e.antwort[1]);
    const daten = fall.response.data.settings ?? fall.response.data;
    const konto = w['users/kw_betrieb1'] ?? {};
    const geraet = fall.params.deviceId ? w[`users/kw_betrieb1/register_devices/${fall.params.deviceId}`] : undefined;
    const innen = { betrieb: (konto.register_settings ?? {}).kasse, geraet: geraet?.kasse };
    const name = e.antwort.join('/');
    const draht = _storedPosSettingsToWire(innen);
    const modell = stored.fromStoredPosSettings(innen);
    const erwartet = posSettingsFromWire(daten);
    if (e.teil !== 'device') {
      teilVon(draht.business, daten.business, `${name} business Draht`);
      assert.deepEqual(modell.business, erwartet.business, `${name} business`);
    }
    if (e.teil !== 'business') {
      teilVon(draht.device, daten.device, `${name} device Draht`);
      assert.deepEqual(modell.device, erwartet.device, `${name} device`);
    }
  }
});

test('stored: Einstellungen behalten unbekannte Werte, verwerfen unbekannte Schluessel und 0.x-Reste', () => {
  const s = stored.fromStoredPosSettings({
    betrieb: { stil: 'sepia', schrift: 'L', theme: 'night', unbekannt: 1 },
    geraet: { layout: 'rechts', druckerArt: 'neuart', terminalVia: 'direkt' },
  });
  // Unbekannter Wert eines bekannten Feldes bleibt woertlich stehen (wie vom Server, F1).
  assert.equal(s.business.theme, 'sepia');
  assert.equal(s.device.printerType, 'neuart');
  assert.deepEqual(unknownPosSettingValues(s).sort(), ['business.theme', 'device.printerType']);
  assert.equal(s.business.fontSize, 'L');
  assert.equal(s.device.layout, 'right');
  assert.equal(s.device.terminalVia, 'direct');
  // Ein englischer Schluessel im gespeicherten Stand ist innen unbekannt: weg (mische).
  assert.equal(stored.fromStoredPosSettings({ betrieb: { theme: 'night' } }).business.theme, 'clear');
  assert.equal('unbekannt' in s.business, false);
  // 0.x-Filter: ein Rest der inneren Form an einem Feld mit gleichem Namen innen und aussen.
  const alt = stored.fromStoredPosSettings({ geraet: { layout: 'links' } });
  assert.equal(alt.device.layout, 'left');
  // Kein Stand, kaputter Stand: Standardwerte, nie ein Absturz.
  for (const leer of [undefined, null, 'x', [], { betrieb: 'x', geraet: [] }]) {
    assert.deepEqual(stored.fromStoredPosSettings(leer as never).device, POS_DEVICE_DEFAULTS);
  }
});

test('stored: gespeicherte Tasten gewinnen, die Vorgabe raeumt eine beanspruchte Taste (mische)', () => {
  const s = stored.fromStoredPosSettings({ geraet: { tasten: { frei: ['Mod+F'], kassieren: ['Enter'], unbekannt: ['Mod+X'] } } });
  assert.deepEqual(s.device.shortcuts.customAmount, ['Mod+F']);
  // Mod+F gehoert in der Vorgabe dem Vollbild: geraeumt.
  assert.deepEqual(s.device.shortcuts.fullscreen, []);
  // Enter teilen kassieren und abschliessen (erlaubtes Paar): bleibt.
  assert.deepEqual(s.device.shortcuts.complete, ['Enter']);
  assert.equal('unbekannt' in s.device.shortcuts, false);
});

// ---- Artikel ---------------------------------------------------------------------

test('stored: gespeicherte Artikel ergeben die Antwort des Servers, Draht und Modell', () => {
  const w = welt(null, null);
  const antwort = kasseFall('listMyArticles', 'success_owner');
  const artikel = antwort.response.data.articles as Json[];
  assert.ok(artikel.length > 0);
  for (const a of artikel) {
    const doc = w[`users/kw_betrieb1/articles/${a.id}`];
    assert.ok(doc, a.id);
    assert.deepEqual(_storedArticleToWire(a.id, doc), a, `${a.id} Draht`);
    assert.deepEqual(stored.fromStoredArticle(a.id, doc), fromPosArticlePayload(a as PosArticlePayload), `${a.id} Modell`);
  }
});

test('stored: Artikel verlieren unbekannte Felder und unbekannte Katalogwerte wie am Server', () => {
  const draht = _storedArticleToWire('a1', {
    name: 'Wurst', unit: 'kg', unitPriceCents: 1290, priceCents: 12.9, mengenregel: 'dezimal', mengeFragen: true, maxMenge: 2.5,
    e1aGroup: 'waren', kasse: { sichtbar: false, sort: 3, farbe: '#aa5500' }, create_time: 1, update_time: 2, geheim: 'x',
  });
  assert.deepEqual(draht, {
    id: 'a1', name: 'Wurst', unit: 'kg', unitPriceCents: 1290, e1aGroup: 'goods_materials', groupId: null, revenueGroupId: null,
    quantityRule: 'decimal', askQuantity: true, maxQuantity: 2.5, tile: { visible: false, sort: 3 },
  });
  const unbekannt = _storedArticleToWire('a2', { name: 'X', mengenregel: 'neu', e1aGroup: 'neu' });
  assert.equal('quantityRule' in unbekannt, false);
  assert.equal('e1aGroup' in unbekannt, false);
  const m = stored.fromStoredArticle('a1', { name: 'Wurst', unit: 'kg', mengenregel: 'dezimal', kasse: { sichtbar: false, sort: -1 } });
  assert.equal(m.quantityRule, 'decimal');
  assert.equal(m.visible, false);
  assert.equal(m.sort, 0);
});
