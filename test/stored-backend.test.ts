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
import { FAELLE_NEU, dokument } from './stored-gutschein-docs.js';
import { unknownPosSettingValues, type PosSettings } from '../src/pos/settings.js';
import { buildReceiptLayout, type ReceiptLayout } from '../src/receipt/index.js';
import { receiptSumCents } from '../src/models/index.js';

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
  // Teile aus beleg-voll.js (Firma, Testsignatur, Layout), die index.js belegAntwort und listReceipts teilen.
  const { belegTeile } = lade!('./beleg-voll')({ belegKopfCore: kopf, layoutFuerBeleg: layout.layoutFuerBeleg });
  // Verkettung wie index.js belegAntwort.
  const pruefangaben = await pruefangabenFuerBeleg('uid', doc.cashregisterId, doc);
  // Ein nicht baubares Layout (Fall layoutRegeln: 3) meldet belegTeile auf console.error; hier gewollt.
  const fehler = console.error;
  console.error = () => {};
  let teile: Json;
  try {
    teile = still(() => belegTeile(doc, { version, testKasse, pruefangaben, mitLayout: true, ort: 'stored-backend' }));
  } finally {
    console.error = fehler;
  }
  const { betrieb, testSignatur, layout: lay } = teile;
  const huelle = {
    receipt: storno.ohneInterneBelegFelder(doc), ...betrieb, logo_url: kopf.logoFuerBeleg(version, konto, doc),
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
    { ...storno, lagerStandortId: 'van-1', items: storno.items.map((it: Json, i: number) => (i === 0 ? { ...it, articleId: 'rye-bread', originalIndex: 0, rueckgabe: 'defekt' } : it)) },
    { ...storno, items: storno.items.map((it: Json) => ({ ...it, articleId: 'rye-bread', rueckgabe: 'verloren' })) },
    { ...docs[2], lagerStandortId: 'store-1', cancellations: [{ receiptId: 'X-2', at: 1, by: null, note: null, items: [{ index: 0, quantity: 1, rueckgabe: 'entsorgt' }] }] },
    // Alter Kartenbeleg ohne payments[]: die Kartenfelder gehen an die Kasse hinaus wie die Anbieterdaten in payments[].
    (() => { const { payments: _p, ...alt } = docs[1]; return { ...alt, cardPaymentId: 'cp-1', cardPaymentData: { terminal: 'T1' }, creditCardProvider: 'sumup' }; })(),
  ];
  // Gespeicherte Belege der neuen Gutscheinform (Einzweck, Leistung, Mehrzweck im Nulltopf, Auszahlung ...).
  const gutscheinDocs: Json[] = FAELLE_NEU.map((name) => dokument(name).doc);
  for (const doc of [...docs, ...extra, ...gutscheinDocs]) {
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
    ['a9', { standorte: ['haupt', 'van-1'], einkauf: { standardMicros: 1200000 }, bestandsart: 'menge', mindestJeStandort: { haupt: 5000 } }],
  ];
  for (const [id, doc] of faelle) {
    const erwartet = artikelServer(id, doc);
    assert.deepEqual(_storedArticleToWire(id, doc), erwartet, `${id} Draht`);
    assert.deepEqual(stored.fromStoredArticle(id, doc), fromPosArticlePayload(erwartet as PosArticlePayload), `${id} Modell`);
  }
});

// ---- Gutschein-Katalog des Backends ---------------------------------------------

/*
 * Jeder Erfolgsfall des Gutschein-Katalogs (functions/test/unit/fixtures/gutschein-faelle.json) und sein
 * Storno, gespeichert wie createReceipt/cancelReceipt (Helfer gutschein-gespeichert): das Paket zeigt den
 * Beleg roh (neue Form, wie der Server seit 0.34) mit Gesamt = Zahlbetrag des Servers
 * (gutschein-beleg.zahlbetrag) und der Steuertabelle = signierte Toepfe. Dieselbe Pruefung wie
 * beleg-layout-gutschein.test.js im Backend, Vorfall 16.10.2026.
 */
const GUTSCHEIN_VOR_STICHTAG = ['mz_verkauf_vor_stichtag', 'alt_value_verkauf_vor_stichtag_unveraendert'];
// Rabattgutschein + Trinkgeld verteilt das Paket anders als belegToepfe (Backend-Test: BEKANNT).
const GUTSCHEIN_BEKANNT = ['ak_prozent_mit_trinkgeld'];

test('stored-backend: Gutschein-Katalog - Gesamt = Zahlbetrag, Steuertabelle = Toepfe', (t: TestContext) => {
  if (!lade) { t.skip(HINWEIS); return; }
  const g = globalThis as Json;
  const vorher = { beforeAll: g.beforeAll, afterAll: g.afterAll, emu: process.env['FUNCTIONS_EMULATOR'], ab: process.env['GUTSCHEIN_NULLTOPF_AB_TEST'] };
  g.beforeAll = g.beforeAll ?? (() => {});
  g.afterAll = g.afterAll ?? (() => {});
  const welt = lade('./test/unit/helpers/gutschein-gespeichert.js');
  const gb = lade('./gemeinsam/gutschein-beleg.js');
  // Stichtag des 0-%-Topfs aus dem Katalog (wie welt.stichtagAusKatalog im Backend).
  process.env['FUNCTIONS_EMULATOR'] = 'true';
  process.env['GUTSCHEIN_NULLTOPF_AB_TEST'] = welt.katalog.nulltopfAb;
  try {
    const firma = { companyName: 'Bäckerei Kornblum', street: 'Neubaugasse 12', zip: '1070', city: 'Wien', vatId: 'ATU12345675', taxNumber: '', isSmallBusiness: false, thanksMessage: [], showKreiseckLogo: false } as Json;
    const euro = (c: number): string => `${(c / 100).toFixed(2).replace('.', ',')} €`;
    const gesamt = (l: ReceiptLayout): string | null => {
      const z = l.lines.find((x) => x.kind === 'columns' && x.columns[0]!.text === 'Gesamt:');
      return z && z.kind === 'columns' ? z.columns[1]!.text : null;
    };
    const kategorie: Record<string, string> = { A: 'amountRateStandard', B: 'amountRateReduced1', C: 'amountRateReduced2', D: 'amountRateZero', E: 'amountRateSpecial' };
    const steuer = (l: ReceiptLayout): Record<string, number> => {
      const r: Record<string, number> = {};
      for (const z of l.lines) {
        if (z.kind !== 'columns' || z.columns.length !== 4) continue;
        const m = /^([A-E]) /.exec(z.columns[0]!.text);
        const c = m ? Math.round(Number(z.columns[3]!.text.replace(/\./g, '').replace(',', '.')) * 100) : 0;
        if (m && c !== 0) r[m[1]!] = c;
      }
      return r;
    };
    const toepfe = (b: Json): Record<string, number> => {
      const r: Record<string, number> = {};
      for (const [k, feld] of Object.entries(kategorie)) {
        const c = Math.round((Number(b[feld]) || 0) * 100);
        if (c !== 0) r[k] = c;
      }
      return r;
    };
    const abweichend: string[] = [];
    let geprueft = 0;
    for (const f of welt.erfolgsFaelle() as Json[]) {
      const o = welt.gespeichert(f);
      const belege: Array<[string, Json]> = [['', o]];
      try { belege.push([' (Storno)', welt.storniert(o)]); } catch { /* nicht stornierbar */ }
      for (const [zusatz, doc] of belege) {
        geprueft += 1;
        const soll = gb.zahlbetrag(doc.items, doc.vouchers, doc.receiptType) as number;
        const r = stored.fromStoredReceipt({ sig: '', qr: '', fullReceiptId: '', cashregisterId: 'KECK-1', ...doc });
        const beleg = r;
        const l = buildReceiptLayout(beleg, firma, { paperSize: 'mm80' });
        const name = `${f.name}${zusatz}`;
        if (receiptSumCents(beleg) !== soll) abweichend.push(`${name}: receiptSumCents ${receiptSumCents(beleg)}, Zahlbetrag ${soll}`);
        if (gesamt(l) !== euro(soll)) abweichend.push(`${name}: Gesamt ${gesamt(l)}, Zahlbetrag ${euro(soll)}`);
        const ohneTopf = GUTSCHEIN_VOR_STICHTAG.includes(f.name) || GUTSCHEIN_BEKANNT.includes(f.name);
        if (!ohneTopf && JSON.stringify(steuer(l)) !== JSON.stringify(toepfe(doc))) abweichend.push(`${name}: Steuer ${JSON.stringify(steuer(l))}, Toepfe ${JSON.stringify(toepfe(doc))}`);
      }
    }
    assert.ok(geprueft > 30, `nur ${geprueft} Belege`);
    assert.deepEqual(abweichend, []);
  } finally {
    g.beforeAll = vorher.beforeAll;
    g.afterAll = vorher.afterAll;
    for (const [k, v] of [['FUNCTIONS_EMULATOR', vorher.emu], ['GUTSCHEIN_NULLTOPF_AB_TEST', vorher.ab]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
