import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import * as stored from '../src/stored/index.js';
import { _storedArticleToWire } from '../src/stored/draht.js';
import { belegMitFirmaAusHuelle } from '../src/client/receipts.js';
import { posSettingsFromWire } from '../src/pos/client.js';
import { fromPosArticlePayload, type PosArticlePayload } from '../src/pos/artikel.js';
import { unknownPosSettingValues, type PosSettings } from '../src/pos/settings.js';

/**
 * Backend-Vergleich fuer `./stored`: dieselben gespeicherten Dokumente laufen
 * durch die Funktionen des Backends (so, wie die Handler sie verketten) und
 * durch `./stored`; die Modelle muessen gleich sein. Das faengt, was die
 * Vertragspaare nicht zeigen (Randfaelle abseits der Gutfaelle).
 *
 * Braucht einen Backend-Checkout (KASSENECK_BACKEND, Repo kasseneck auf dem
 * Stand von origin/main, `npm ci` in functions und functions-kasse). Ohne ihn
 * wird der Test mit Hinweis uebersprungen; der Quelltext-Waechter
 * (stored-zwillinge.test.ts) haelt die Zwillinge dann am letzten belegten
 * Stand.
 *
 * Die Handler selbst lassen sich ohne Firebase nicht laden. Ihre Verkettung
 * steht darum hier (belegAntwort, die Artikelzeile aus listMyArticles,
 * getPosSettings); der Quelltext-Waechter haelt genau diese Stellen fest.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const BACKEND = process.env['KASSENECK_BACKEND'];
const HINWEIS = 'KASSENECK_BACKEND fehlt: Pfad zum Backend-Checkout (Repo kasseneck, npm ci in functions und functions-kasse), sonst ist nichts zu vergleichen';
const lade = BACKEND ? createRequire(resolve(BACKEND, 'functions/package.json')) : null;
const lies = (datei: string): Json =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/v3/${datei}`, import.meta.url)), 'utf8')) as Json;

/** Backend-Aufrufe ohne ihre Warnzeilen (nurBekannte schreibt auf console.warn). */
function still<T>(f: () => T): T {
  const warn = console.warn;
  console.warn = () => {};
  try { return f(); } finally { console.warn = warn; }
}
const json = (x: unknown): Json => JSON.parse(JSON.stringify(x));

// ---- Einstellungen -------------------------------------------------------------

const EINSTELLUNGEN: Json[] = [
  {},
  { betrieb: { stil: 'nacht', farbe: '#222222' }, geraet: { layout: 'links', papier: 'mm58' } },
  { betrieb: { saetze: { 7: true, 20: false, 13: 'ja' }, tgStufen: { 7: true, 5: false } } },
  { betrieb: { saetze: [true], tgStufen: true } },
  { betrieb: { saetze: null } },
  { geraet: { tasten: { altAktion: ['Mod+B'] } } },
  { geraet: { tasten: { cash: ['Mod+K'] } } },
  { geraet: { tasten: { bar: ['Mod+Ü'] } } },
  { geraet: { tasten: { frei: ['Mod+F'], kassieren: ['Enter'], abschliessen: ['Mod+Enter'] } } },
  { geraet: { tasten: [['Mod+B']] } },
  { geraet: { tasten: null } },
  { geraet: { tasten: { bar: ['A', 'B', 'C', 'D'], karte: 'Mod+K', gegebenLeeren: ['Mod+X'] } } },
  {
    betrieb: {
      wzPos: 500, wzPosV: 12.5, farbe: '#abcdef', logoText: 'abcd', tgChips: [5, 5], rabattChips: [0.15, 2.5], logoBild: 'https://evil.example/x.png',
      stil: 'night', autoAbMin: '5', schrift: 'XXL', uhr: 'ja', theme: 'night', zahlGetrennt: true, fertigSekunden: 7, wzStaerke: 6,
    },
  },
  {
    geraet: {
      druckerIp: '300.1.1.1', druckerName: '  ', terminalTid: 'x1', papier: 7, layout: 'links', druckerArt: 'netz', ladeAuto: 'immer',
      druckerPort: 0, spaltenExtra: -3, hoehe: 'L', terminalVia: 'direkt', terminalArt: 'hps', druckerBt: 'AA:BB', zeichensatz: 'CP437',
    },
  },
  { betrieb: { stil: 'sepia', kartenanbieter: 'neu' }, geraet: { druckerArt: 'neuart', ladeAuto: 5 } },
  { geraet: { druckerName: ' TM ', druckerIp: '', connectDruckerId: 'a b', druckerId: 'x/y' } },
  { betrieb: 'x', geraet: [] },
];

function einstellungenServer(stand: Json): { modell: PosSettings; weg: string[] } {
  const core = lade!('../functions-kasse/kasse-settings-core');
  const v3 = lade!('../functions-kasse/kasse-settings-v3');
  const vok = lade!('./gemeinsam/api-vokabular-v3');
  const weg: string[] = [];
  const s = istObjekt(stand) ? stand : {};
  const betrieb = v3.nurGueltig('betrieb', core.mische(core.BETRIEB_STANDARD, s.betrieb), (p: string) => weg.push(p));
  const geraet = v3.nurGueltig('geraet', core.mische(core.GERAET_STANDARD, s.geraet), (p: string) => weg.push(p));
  const aus = vok.antwortNachAussen('getKasseSettings', { status: 'success', data: { betrieb, geraet } });
  return { modell: posSettingsFromWire(json(aus.data)), weg };
}
const istObjekt = (w: unknown): w is Record<string, unknown> => w !== null && typeof w === 'object' && !Array.isArray(w);

test('stored-backend: Einstellungen wie mische, nurGueltig und Rand des Servers', (t: TestContext) => {
  if (!lade) { t.skip(HINWEIS); return; }
  for (const stand of EINSTELLUNGEN) {
    const name = JSON.stringify(stand);
    const server = einstellungenServer(stand);
    const ist = stored.fromStoredPosSettings(stand) as Json;
    // Bewusste Abweichung: ein unbekannter Aufzaehlungswert bleibt stehen (der Server nimmt die Vorgabe).
    const unbekannt = unknownPosSettingValues(ist);
    for (const pfad of unbekannt) {
      const [teil, feld] = pfad.split('.') as ['business' | 'device', string];
      ist[teil][feld] = (server.modell as Json)[teil][feld];
    }
    assert.deepEqual(ist, server.modell, name);
    assert.deepEqual([...stored.invalidStoredPosSettings(stand), ...unbekannt].sort(), [...server.weg].sort(), `${name} Meldungen`);
  }
});

// ---- Belege ------------------------------------------------------------------

async function belegServer(doc: Json, version: Json, konto: Json, testKasse: boolean): Promise<Json> {
  const kopf = lade!('./beleg-kopf-core');
  const layout = lade!('./beleg-layout');
  const storno = lade!('./gemeinsam/storno-core');
  const vok = lade!('./gemeinsam/api-vokabular-v3');
  // Nachschlagen an Karte und Kasse findet nichts (ein Beleg ohne festgehaltene Angaben).
  const leer = { get: async () => ({ empty: true, exists: false }), where: () => leer, limit: () => leer };
  const db = { collection: () => leer, doc: () => leer };
  const { pruefangabenFuerBeleg } = lade!('./beleg-pruefangaben')({ db });
  // Verkettung wie index.js belegAntwort.
  const betrieb = kopf.alsBetriebPayload(version);
  const testSignatur = kopf.istTestsignatur(doc.qr) && !testKasse;
  const pruefangaben = await pruefangabenFuerBeleg('uid', doc.cashregisterId, doc);
  let lay = null;
  try {
    lay = layout.layoutFuerBeleg({ beleg: doc, betrieb, testKasse, testSignatur, regelwerk: doc.layoutRegeln, pruefangaben });
  } catch { /* wie belegAntwort: kein Layout */ }
  const huelle = {
    receipt: storno.ohneInterneStornoFelder(doc), ...betrieb, logo_url: kopf.logoFuerBeleg(version, konto, doc),
    logo_skala: kopf.logoStufeFuerKonto(konto), kopfId: version ? version.id : null, layout: lay, pruefangaben, testSignatur, testKasse,
  };
  const aus = vok.antwortNachAussen('getReceipt', { status: 'success', data: huelle }, { kanal: 'app', art: 'kasse' });
  return belegMitFirmaAusHuelle(json(aus.data), 'getReceipt');
}

test('stored-backend: Belege mit Firma und Layout wie belegAntwort und Rand des Servers', async (t: TestContext) => {
  if (!lade) { t.skip(HINWEIS); return; }
  const docs = Object.values(lies('stored/belege.json').documents) as Json[];
  const kopf = lies('stored/kasse.json').endpoints.createReceipt.cases.start_receipt['users/kw_betrieb1/beleg_kopf/auto1'];
  const { logoUrl: _l, ...kopfOhneLogo } = kopf;
  const versionen: Json[] = [kopf, kopfOhneLogo, { ...kopf, logoUrl: null, thanksMessage: ['Danke', 'Bis bald'], uid: null, footer3: 'F3' }, {}];
  const konten: Json[] = [{}, { logo_url: 'https://example.invalid/profil.png', register_settings: { kasse: { logoSkala: 'XL' } } }];
  const null0 = docs.find((d) => d.receiptType === 'zero');
  const storno = docs.find((d) => d.cancellationOf);
  const extra: Json[] = [
    { ...null0, pruefangaben: { karteRegistriertAm: '2025-01-01T10:00:00+01:00', kasseRegistriertAm: '2025-01-01', extra: 1 } },
    { ...null0, pruefangaben: { karteRegistriertAm: 0, kasseRegistriertAm: 'kein Datum' } },
    { ...null0, pruefangaben: { karteRegistriertAm: 1710144000000 } },
    (() => { const { pruefangaben: _p, ...ohne } = null0; return ohne; })(),
    { ...docs[1], layoutRegeln: 1 },
    { ...docs[1], layoutRegeln: 3 },
    { ...docs[1], layoutRegeln: undefined },
    { ...storno, cancellationOf: { ...storno.cancellationOf, marke: 'm1' }, stornoMarke: 'm0' },
    { ...docs[2], cancellations: [{ receiptId: 'X-1', marke: 'm2', items: [] }] },
  ];
  for (const doc of [...docs, ...extra]) {
    for (const data of versionen) {
      for (const konto of konten) {
        for (const testKasse of [false, true]) {
          const id = typeof doc.kopfId === 'string' ? doc.kopfId : 'auto1';
          const erwartet = await belegServer(doc, { id, ...data }, konto, testKasse);
          const ist = stored.fromStoredReceiptWithCompany(doc, { headerVersion: { id, data }, account: konto, testCashregister: testKasse });
          assert.deepEqual(ist, erwartet, `${doc.receiptId} ${JSON.stringify(data).slice(0, 40)} ${JSON.stringify(konto)} ${testKasse}`);
        }
      }
    }
  }
});

// ---- Artikel ------------------------------------------------------------------

function artikelServer(id: string, a: Json): Json {
  const gruppen = lade!('../functions-kasse/article-groups-core');
  const vok = lade!('./gemeinsam/api-vokabular-v3');
  // Die Zeile aus article-endpoints.js listMyArticles.
  const obj = { id, ...a, groupId: a.groupId || null, revenueGroupId: a.revenueGroupId || null, kasse: gruppen.kachelAttribute(a.kasse), create_time: undefined, update_time: undefined };
  const aus = still(() => vok.antwortNachAussen('listMyArticles', { status: 'success', data: { articles: [obj] } }));
  return json(aus.data).articles[0];
}

test('stored-backend: Artikel wie listMyArticles und Rand des Servers', (t: TestContext) => {
  if (!lade) { t.skip(HINWEIS); return; }
  const bestand = lies('stored/kasse.json').baseline;
  const faelle: [string, Json][] = [
    ['art_kaffee', bestand['users/kw_betrieb1/articles/art_kaffee']],
    ['art_kuchen', bestand['users/kw_betrieb1/articles/art_kuchen']],
    ['a0', {}],
    ['a1', { kasse: { farbe: 'x' } }],
    ['a2', { kasse: { sichtbar: 'ja', sort: 2.5 } }],
    ['a3', { kasse: { sichtbar: false, sort: 3 } }],
    ['a4', { mengenregel: 'dezimal', mengeFragen: true, maxMenge: 2, unit: 'kg' }],
    ['a5', { mengenregel: 'neu', e1aGroup: 'neu' }],
    ['a6', { e1aGroup: 'waren', priceCents: 1, fremd: 1, groupId: '', revenueGroupId: 'rg1', unitPriceCents: 100, create_time: 1, active: false }],
    ['a7', { kasse: null, mengenregel: null, e1aGroup: null }],
    ['a8', { kasse: [1], stockTracked: true, stockQty: 3, ean: '123', source: 'foreign', codeSpec: { a: 1 } }],
  ];
  for (const [id, doc] of faelle) {
    const erwartet = artikelServer(id, doc);
    assert.deepEqual(_storedArticleToWire(id, doc), erwartet, `${id} Draht`);
    assert.deepEqual(stored.fromStoredArticle(id, doc), fromPosArticlePayload(erwartet as PosArticlePayload), `${id} Modell`);
  }
});
