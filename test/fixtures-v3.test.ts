import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deutschIn, teile } from './deutsch.js';
import { CANCELLATION_REASONS } from '../src/models/index.js';

/**
 * Die Fixtures von 1.0 sprechen `/v3`: kein deutsches Wort in den
 * Draht-Fixtures, die innere (gespeicherte) Form nur unter `stored/`.
 *
 * Jede Datei unter `fixtures/` gehoert genau einer Klasse an:
 *   - innen:       liegt in einem Verzeichnis `stored/` (Firestore-Form, deutsch);
 *   - ausgenommen: steht in AUSGENOMMEN, mit Grund;
 *   - Draht:       alles andere. Das ist die Vorgabe: eine neue Datei faellt
 *                  unter den Waechter, bis jemand begruendet, warum nicht.
 *
 * Geprueft werden in Draht-Dateien jeder Schluessel und jeder
 * maschinenlesbare Wert (klein geschrieben, ohne Leerzeichen, etwa
 * `input_error` oder `creditCard`). Ausgenommen sind nur Werte, nie
 * Schluessel, und nur, wo der Waechter ohne die Ausnahme etwas faende
 * (AUSNAHMEN_WERT; der Test streicht jede ueberfluessige). Die Sperrliste ist die der Exportnamen
 * (`test/deutsch.ts`) plus die Katalogwerte der inneren Form, die es unter
 * `/v1` gab (DEUTSCH_WERTE).
 */

const wurzel = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = join(wurzel, 'fixtures');
type Json = unknown;

/** Datei (relativ zu fixtures/, `**` = alles darunter) -> Grund. */
const AUSGENOMMEN: Record<string, string> = {
  'v3/**': 'Vertrags-Export des Backends, byte-gleich uebernommen (test/v3-vertrag.test.ts: _quelle). Bewacht an der Quelle: functions-kasse/test/unit/fixtures/v3-waechter.js ueber jede Antwort; v3-vokabular.json fuehrt die deutschen Namen der inneren Form als Uebersetzungstabelle',
  'code-tables.json': 'Katalog der Code-Tabellen: die Schluessel unter bytes sind die gedruckten Zeichen selbst (ä, ß, € ...), kein Wort; ids und Feldnamen sind englisch (test/code-tables.test.ts prueft die Form)',
  'renames-1.0.json': 'Umstiegstabelle von 0.x auf 1.0: die alten, deutschen Schluessel sind ihr Inhalt',
};

/**
 * Werte an genau diesen Stellen werden nicht geprueft; Schluessel immer.
 * `pfad` ist der Pfad des Werts (`calls.pos[]` fuer einen Eintrag der Liste
 * `calls.pos`), gebunden an eine Datei. Jede Ausnahme muss einen Fund
 * verhindern, sonst streicht sie der Test.
 */
const AUSNAHMEN_WERT: Array<{ datei: string; pfad: RegExp; grund: string }> = [
  { datei: 'surface.json', pfad: /^(calls|routes)\.(public|pos)\[\]$/, grund: 'Namen der Backend-Functions (URL-Pfad) unter /v3 und /api/v3, wie das Backend sie fuehrt (v3-vokabular.json endpoints; getKasseSettings, setMyKasseLogo ...)' },
  { datei: 'surface.json', pfad: /^unknownOutcomeCalls\[\]$/, grund: 'dieselben Backend-Namen wie unter calls/routes, hier die mit Wirkung (setMyKasseSettings, setMyKasseLogo ...)' },
  { datei: 'invoice-api-examples/credit-error-reason.json', pfad: /^request\.reason$/, grund: 'absichtlich ungueltiger Grund ("storno"): das Beispiel zeigt, dass der Server ihn mit validation abweist' },
  { datei: 'pos-texts.json', pfad: /^(messages|labels)\..+\.text$/, grund: 'Text fuer den Kassier ("Kein", "Bar"); die Texte bleiben deutsch' },
  { datei: 'invoice-calc-random.json', pfad: /^cases\[\]\.name$/, grund: 'Name eines Pruffalls fuer Menschen (etwa "steuerfrei" als Pflichtklasse)' },
];

/** Kopf erzeugter Dateien: der Schluessel wird geprueft, sein Wert (Hinweistext, Dateinamen des Backends) nicht. */
const KOPF = new Set(['_note', '_source']);

/** Katalogwerte und Schluesselteile der inneren Form (0.x, /v1), die am Draht nicht mehr vorkommen duerfen. */
const DEUTSCH_VON_HAND = `
aktiv an art aus auswahl bar beides betrag betrieb bild breite druck drucker eigen einheit ersatz extern fehleingabe fragen
geraet gesamt immer kasse kassen keiner keins klartext kunde_storniert links mitte nacht netz nie oben papier pruefangaben
rechts regelwerk seite sonst sonstiges stil storniert taxnr testkasse testsignatur unerwartet verhalten vollbild zeitablauf
doppelt erfasst falsche zahlart eigener_text schluessel storno grund
beschreibung regel faelle erwartet positionen eingabe gemessen ergaenzt dokumentiert gruende zeitraum quelle erhalten kennzeichen
hoch rundung steuerfrei hinweis gutschein teilweise verkauf karte kunde trinkgeld
`.split(/\s+/).filter(Boolean);

/**
 * Alles, was 1.0 umbenannt hat, darf nicht zurueckkommen: jeder alte Name aus
 * fixtures/renames-1.0.json (structure, values, placeholders, Katalog-
 * schluessel, Dateinamen), zerlegt in Teilwoerter. Ein Teilwort, das auch in
 * einem neuen Namen vorkommt (`logo` aus `logoAn`), bleibt erlaubt.
 */
function ausDerTabelle(): string[] {
  const t = JSON.parse(readFileSync(join(fixtures, 'renames-1.0.json'), 'utf8')) as Record<string, any>;
  const paare: Array<[string, string]> = [];
  const karte = (m: Record<string, string>): void => { for (const [a, n] of Object.entries(m)) if (a !== n) paare.push([a, n]); };
  for (const ebenen of Object.values(t.structure as Record<string, Record<string, Record<string, string>>>)) Object.values(ebenen).forEach(karte);
  for (const orte of Object.values(t.values as Record<string, Record<string, Record<string, string>>>)) Object.values(orte).forEach(karte);
  karte(t.placeholders);
  karte(t.texts.pos.messages); karte(t.texts.pos.labels); karte(t.texts.invoice);
  karte(t.files);
  // Teile alter Namen, die zugleich gewoehnliche englische Teilwoerter sind
  // (receiptType `standard`, JSON-Schema `minLength`, Kennung `uid` ...).
  const englisch = new Set(['am', 'bt', 'devid', 'es', 'im', 'min', 're', 'rc', 'standard', 'uid']);
  const neueTeile = new Set([...paare.flatMap(([, n]) => teile(n)), ...englisch]);
  const aus = new Set<string>();
  for (const [a] of paare) {
    for (const teil of teile(a)) if (!neueTeile.has(teil) && !/^\d+$/.test(teil) && teil.length > 1) aus.add(teil);
  }
  return [...aus];
}

/** Umbenannte Namen (alt != neu), fuer die Rot-Probe. */
export const ALTE_PLATZHALTER: string[] = Object.entries(JSON.parse(readFileSync(join(fixtures, 'renames-1.0.json'), 'utf8')).placeholders as Record<string, string>)
  .filter(([a, n]) => a !== n).map(([a]) => a);

const DEUTSCH_WERTE = new Set([...DEUTSCH_VON_HAND, ...ausDerTabelle()]);
const ALTE_PLATZHALTER_MENGE = new Set(ALTE_PLATZHALTER);

function deutsch(text: string): string | null {
  // Ganze Werte wie `kunde_storniert` stehen als Ganzes in der Liste.
  if (DEUTSCH_WERTE.has(text)) return `Wort "${text}"`;
  return deutschIn(text, DEUTSCH_WERTE);
}

const MASCHINENWERT = /^[a-z][a-z0-9]*(?:[_.-][a-z0-9]+)*$|^[a-z]+(?:[A-Z][a-z0-9]*)+$/;

const benutzteAusnahmen = new Set<object>();

/** Fundstellen in einem Dokument (Pfad: Schluessel). `ohne`: diese Ausnahme gilt nicht (Notwendigkeit). */
export function deutscheStellen(wert: Json, datei = '', pfad = '', ohne: object | null = null): string[] {
  const aus: string[] = [];
  if (Array.isArray(wert)) {
    wert.forEach((w) => aus.push(...deutscheStellen(w, datei, `${pfad}[]`, ohne)));
    return aus;
  }
  if (wert !== null && typeof wert === 'object') {
    for (const [k, v] of Object.entries(wert)) {
      const hier = pfad ? `${pfad}.${k}` : k;
      if (k === '$schema') continue;
      const grund = deutsch(k);
      if (grund) aus.push(`${hier} (Schluessel: ${grund})`);
      if (pfad === '' && KOPF.has(k)) continue;
      aus.push(...deutscheStellen(v, datei, hier, ohne));
    }
    return aus;
  }
  // Ein alter Platzhalter faellt ueberall auf: als Eintrag einer
  // placeholders-Liste und als `{name}` in einem Text (auch einem, der sonst
  // als Menschentext frei ist).
  if (typeof wert === 'string') {
    if (/\.placeholders\[\]$/.test(pfad) && ALTE_PLATZHALTER_MENGE.has(wert)) aus.push(`${pfad} = "${wert}" (alter Platzhalter)`);
    for (const m of wert.matchAll(/\{([a-zA-Z]+)\}/g)) if (ALTE_PLATZHALTER_MENGE.has(m[1]!)) aus.push(`${pfad}: {${m[1]}} (alter Platzhalter)`);
  }
  // Pruefsummen (sha256 hex) sind keine Woerter.
  if (typeof wert === 'string' && MASCHINENWERT.test(wert) && !/^[0-9a-f]{32,}$/.test(wert)) {
    const grund = deutsch(wert);
    if (!grund) return aus;
    const ausnahme = AUSNAHMEN_WERT.find((a) => a !== ohne && a.datei === datei && a.pfad.test(pfad));
    if (ausnahme) benutzteAusnahmen.add(ausnahme);
    else aus.push(`${pfad || '(Wurzel)'} = "${wert}" (${grund})`);
  }
  return aus;
}

function alleDateien(): string[] {
  const aus: string[] = [];
  const gehe = (pfad: string): void => {
    for (const name of readdirSync(pfad).sort()) {
      const voll = join(pfad, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else aus.push(relative(fixtures, voll).split('\\').join('/'));
    }
  };
  gehe(fixtures);
  return aus;
}

function ausnahmeFuer(datei: string): string | null {
  for (const [muster, grund] of Object.entries(AUSGENOMMEN)) {
    if (muster.endsWith('/**') ? datei.startsWith(muster.slice(0, -2)) : datei === muster) return grund;
  }
  return null;
}
const istInnen = (datei: string): boolean => datei.split('/').slice(0, -1).includes('stored');

const DRAHT = alleDateien().filter((d) => !istInnen(d) && ausnahmeFuer(d) === null);
const lies = (datei: string): Json => JSON.parse(readFileSync(join(fixtures, datei), 'utf8'));

test('Fixtures: jede Datei ist Draht, innen (unter stored/) oder begruendet ausgenommen', () => {
  // Ausnahmen, die auf keine Datei mehr passen, sind tot.
  for (const muster of Object.keys(AUSGENOMMEN)) {
    assert.ok(alleDateien().some((d) => ausnahmeFuer(d) === AUSGENOMMEN[muster]), `tote Ausnahme: ${muster}`);
  }
  // Draht ist JSON (die Klartext-Raster und ESC/POS-Bytes in Hex unter expected/ sind gedruckte Ausgabe, kein Draht).
  const nichtJson = DRAHT.filter((d) => !d.endsWith('.json') && !/^expected\/.*\.(txt|hex)$/.test(d));
  assert.deepEqual(nichtJson, [], 'unbekannte Dateiart unter fixtures/');
  assert.ok(DRAHT.length > 200, `zu wenige Draht-Dateien gefunden: ${DRAHT.length}`);
});

test('Fixtures: kein deutsches Wort in den Draht-Fixtures (Schluessel und Maschinenwerte)', () => {
  const treffer: string[] = [];
  for (const datei of DRAHT.filter((d) => d.endsWith('.json'))) {
    for (const t of deutscheStellen(lies(datei), datei)) treffer.push(`${datei}: ${t}`);
  }
  assert.deepEqual(treffer, []);
  // Keine tote Ausnahme: jede greift in mindestens einer Draht-Datei, und
  // ohne sie faende der Waechter etwas (sonst ist sie ueberfluessig).
  assert.deepEqual(AUSNAHMEN_WERT.filter((a) => !benutzteAusnahmen.has(a)).map((a) => String(a.pfad)), []);
  const unnoetig = AUSNAHMEN_WERT.filter((a) => DRAHT.filter((d) => d.endsWith('.json')).every((d) => deutscheStellen(lies(d), d, '', a).length === 0));
  assert.deepEqual(unnoetig.map((a) => String(a.pfad)), [], 'Ausnahme ohne Fund: streichen');
});

test('Fixtures: der Waechter erkennt die alten Namen (Rot-Probe)', () => {
  assert.notDeepEqual(deutscheStellen({ receipt: { cancellationReason: 'fehleingabe' } }), []);
  assert.notDeepEqual(deutscheStellen({ receipt: { cancellationReason: 'kunde_storniert' } }), []);
  assert.notDeepEqual(deutscheStellen({ company: { taxnr: '' } }), []);
  assert.notDeepEqual(deutscheStellen({ options: { testKasse: true } }), []);
  assert.notDeepEqual(deutscheStellen({ options: { pruefangaben: null } }), []);
  assert.notDeepEqual(deutscheStellen({ meldungen: {} }), []);
  assert.notDeepEqual(deutscheStellen({ errorRules: [{ kind: 'klartext' }] }), []);
  assert.notDeepEqual(deutscheStellen({ errorRules: [{ art: 'api' }] }), []);
  assert.notDeepEqual(deutscheStellen({ x: { platzhalter: ['status'] } }), []);
  assert.notDeepEqual(deutscheStellen({ enums: { layout: ['vollbild'] } }), []);
  // Pruefgeruest (seit 1.0 ebenfalls englisch).
  assert.notDeepEqual(deutscheStellen({ beschreibung: 'x' }), []);
  assert.notDeepEqual(deutscheStellen({ cases: [{ erwartet: {} }] }), []);
  assert.notDeepEqual(deutscheStellen({ gemessenAn: {} }), []);
  // Ausnahmen gelten fuer Werte, nie fuer Schluessel.
  assert.notDeepEqual(deutscheStellen({ text: { beleg: 1 } }), []);
  // Dateigebundene Ausnahmen gelten nur in ihrer Datei.
  assert.notDeepEqual(deutscheStellen({ request: { reason: 'storno' } }, 'invoice-api-examples/credit-ok.json'), []);
  assert.deepEqual(deutscheStellen({ request: { reason: 'storno' } }, 'invoice-api-examples/credit-error-reason.json'), []);
  // Ausnahmen sind an den Pfad gebunden: der Abschnitt pos in surface.json ist nicht frei.
  assert.deepEqual(deutscheStellen({ calls: { pos: ['getKasseSettings'] } }, 'surface.json'), []);
  assert.notDeepEqual(deutscheStellen({ pos: { posErrorCodes: ['kasse_fehlt'], printJobStatuses: ['rechnung'] } }, 'surface.json'), []);
  assert.notDeepEqual(deutscheStellen({ baseUrls: { pos: 'kasse' } }, 'surface.json'), []);
  // Nur _note und _source sind Kopf; ein anderer `_`-Schluessel wird geprueft.
  assert.notDeepEqual(deutscheStellen({ _irgendwas: { fehler: 'storno' } }), []);
  assert.deepEqual(deutscheStellen({ _source: { 'beleg-toepfe.js': 'x' } }), []);
  // Jeder alte Platzhalter, als Liste und im Text-Kontext der Platzhalter.
  assert.ok(ALTE_PLATZHALTER.length >= 20, `nur ${ALTE_PLATZHALTER.length} alte Platzhalter`);
  for (const p of ALTE_PLATZHALTER) {
    assert.notDeepEqual(deutscheStellen({ messages: { 'x.y': { text: 'T', placeholders: [p] } } }, 'pos-texts.json'), [], p);
    assert.notDeepEqual(deutscheStellen({ messages: { 'x.y': { text: `Am {${p}}.` } } }, 'pos-texts.json'), [], `{${p}}`);
  }
  // Was 1.0 umbenannt hat, faellt als Schluessel und als Wert auf.
  for (const alt of ['sprachen', 'texte', 'einheiten', 'werte', 'rechte', 'tastenAktionen', 'logoProbe', 'autoAbMin', 'kachelstil', 'kartenanbieter', 'kassierenModus',
    'ladeAuto', 'schnitt', 'schrift', 'tgModus', 'wasserzeichen', 'zeichensatz', 'menge', 'webhookUmschlagFelder', 'kunde', 'gutschein', 'trinkgeld', 'karte', 'datum', 'nummer']) {
    assert.notDeepEqual(deutscheStellen({ [alt]: 1 }), [], `Schluessel ${alt}`);
  }
  for (const alt of ['karte', 'gutschein', 'trinkgeld', 'verkauf', 'voll', 'teilweise', 'karte-neu']) assert.notDeepEqual(deutscheStellen({ kind: alt }), [], `Wert ${alt}`);
  // Menschentext und Englisch bleiben still.
  assert.deepEqual(deutscheStellen({ text: 'Keine Verbindung', placeholders: ['amount'], receipt: { cancellationReason: 'input_error', items: [{ name: 'Semmel' }] } }), []);
  // Platzhalter sind seit 1.0 englisch und keine Ausnahme mehr.
  assert.notDeepEqual(deutscheStellen({ placeholders: ['betrag'] }), []);
});

test('Fixtures: Golden-Belege sind englisch und werden ohne Lader gelesen', () => {
  const namen = readdirSync(join(fixtures, 'receipts')).filter((f) => f.endsWith('.json'));
  const gruende = new Set<string>(Object.keys(CANCELLATION_REASONS));
  for (const name of namen) {
    const f = lies(`receipts/${name}`) as { company: Record<string, unknown>; receipt: Record<string, unknown>; options?: Record<string, unknown> };
    assert.ok(!('uid' in f.company) && !('taxnr' in f.company), `${name}: Firma mit uid/taxnr`);
    const grund = f.receipt['cancellationReason'];
    if (grund !== undefined) assert.ok(gruende.has(String(grund)), `${name}: Storno-Grund ${String(grund)}`);
  }
  assert.equal(existsSync(join(wurzel, 'test', 'belege-fixture.ts')), false, 'der Lader 0.x -> 1.0 gehoert entfernt');
  assert.doesNotMatch(readFileSync(join(wurzel, 'scripts', 'belege-fixtures.mjs'), 'utf8'), /taxnr|fehleingabe|testKasse/);
});

test('Fixtures: das Manifest ist englisch (ruleset, receipts, logoSample)', () => {
  const manifest = lies('manifest.json') as Record<string, unknown>;
  assert.deepEqual(Object.keys(manifest), ['ruleset', 'receipts', 'logoSample']);
  assert.deepEqual(Object.keys((manifest['receipts'] as Record<string, object>)['sale-cash']!), ['input', 'expected', 'grid32', 'grid48', 'sheet32', 'sheet48']);
  assert.equal(typeof manifest['ruleset'], 'number');
});

test('Fixtures: fixtures/v3 ist byte-gleich mit dem Export des Backends (KASSENECK_BACKEND)', (t) => {
  const backend = process.env['KASSENECK_BACKEND'];
  if (!backend) {
    t.skip('KASSENECK_BACKEND fehlt; der Fingerabdruck (_quelle) prueft test/v3-vertrag.test.ts');
    return;
  }
  const quelle = join(backend, 'functions', 'vertrag', 'v3');
  const hier = alleDateien().filter((d) => d.startsWith('v3/')).map((d) => d.slice(3));
  const dort: string[] = [];
  const gehe = (pfad: string): void => {
    for (const name of readdirSync(pfad).sort()) {
      const voll = join(pfad, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else dort.push(relative(quelle, voll).split('\\').join('/'));
    }
  };
  gehe(quelle);
  assert.deepEqual(hier, dort);
  for (const d of hier) assert.ok(readFileSync(join(fixtures, 'v3', d)).equals(readFileSync(join(quelle, d))), `fixtures/v3/${d} weicht vom Backend ab`);
});

test('Fixtures: receipt-due-generated.json stammt vom Backend-Stand in KASSENECK_BACKEND (_source)', (t) => {
  const backend = process.env['KASSENECK_BACKEND'];
  if (!backend) {
    t.skip('KASSENECK_BACKEND fehlt; vor der Veroeffentlichung mit frischem keck main laufen lassen');
    return;
  }
  const quelle = (lies('receipt-due-generated.json') as { _source: Record<string, string> })._source;
  assert.deepEqual(Object.keys(quelle).sort(), ['beleg-toepfe.js', 'tip-core.js', 'vat-buckets.js', 'zahlungen-core.js']);
  for (const [datei, hash] of Object.entries(quelle)) {
    const ist: string = createHash('sha256').update(readFileSync(join(backend, 'functions', 'gemeinsam', datei))).digest('hex');
    assert.equal(ist, hash, `${datei}: Backend weicht ab, KASSENECK_BACKEND=... node scripts/v3-zahlbetrag-generieren.mjs`);
  }
});
