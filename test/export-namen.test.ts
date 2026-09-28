import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Waechter: die oeffentliche Oberflaeche von 1.0 ist englisch.
 *
 * Geprueft wird, was ein Verbraucher sieht: jeder Unterpfad in `exports` der
 * `package.json`, jeder Name, den ein Einstieg exportiert, und jeder
 * Feldname, der von einem exportierten Typ oder Wert aus erreichbar ist.
 * Die Einstiege werden aus der `package.json` abgelesen (Bauziel
 * `dist/esm/X.d.ts` -> Quelle `src/X.ts(x)`), nicht aufgezaehlt: ein neuer
 * Unterpfad faellt damit automatisch unter den Waechter.
 *
 * Deutsch erkennt der Waechter an Umlauten und am Wortschatz unten. Die
 * Liste ist bewusst eine Sperrliste deutscher Woerter und Wortstaemme, keine
 * Positivliste englischer: sie haelt, was die Umbenennung zu 1.0 entfernt
 * hat, und die naheliegenden Nachbarn. Wer ein neues deutsches Wort
 * einfuehrt, das hier fehlt, faellt im Review auf; wer eines von hier
 * zurueckbringt, faellt sofort auf.
 *
 * Ausnahmen nur mit Grund (`AUSNAHMEN_*`). Feste Begriffe von BMF/RKSV
 * (`rksv`, `dep`, `zda`, `fon`, `startbeleg`, …) stehen gar nicht erst in
 * der Sperrliste: sie sind Fachbegriffe, keine Uebersetzungsluecke.
 */

const wurzel = fileURLToPath(new URL('../../', import.meta.url));

/** Ganze Teilwoerter (nach camelCase/`_` getrennt), die deutsch sind. */
const WOERTER = new Set([
  'als', 'alt', 'anteil', 'art', 'aufruf', 'aus', 'aufrufe', 'ausweich', 'betrieb', 'bild', 'blatt', 'bloecke',
  'breite', 'breiten', 'deckel', 'druck', 'fall', 'faelle', 'fehler', 'fehlerart', 'fehlercode',
  'fehlerregeln', 'feld', 'fett', 'fuer', 'geraet', 'gilt', 'grund', 'hoehe', 'ist', 'je', 'kasse',
  'kein', 'klein', 'leer', 'marke', 'mass', 'meldung', 'meldungen', 'mit', 'mittel', 'modell', 'modul',
  'neu', 'nur', 'oder', 'ohne', 'papier', 'passt', 'platzhalter', 'preis', 'punkte', 'rabatt',
  'rechnen', 'rechnung', 'rund', 'satz', 'schluessel', 'schritt', 'seite', 'spalten', 'stufe', 'stufen',
  'summe', 'summen', 'und', 'verhalten', 'vorhanden', 'zeichen', 'zeile', 'zeilen',
]);

/**
 * Wortstaemme, die auch mitten in einem Teilwort deutsch sind
 * (`Beschriftungs`, `Zulaessig`, `Umwandlungs` …).
 */
const STAEMME = [
  'ausnahme', 'beleg', 'berechn', 'beschrift', 'betrag', 'darstell', 'ergebnis', 'fehler',
  'groesse', 'grenze', 'hoechst', 'mindest', 'nutzlast', 'optionen', 'pruef', 'rechen',
  'ruhezone', 'steuer', 'storno', 'umwandl', 'verdeckt', 'verteil', 'wort', 'zahlung', 'zulaessig',
  'anzahl', 'zeilenanfang',
];

const UMLAUT = /[äöüÄÖÜß]/;

/**
 * Feste Begriffe aus BMF/RKSV, die deutsch bleiben, obwohl ein Stamm oben sie
 * trifft. Teilwort -> Grund.
 */
const FACHBEGRIFFE: Record<string, string> = {
  startbeleg: 'RKSV-Begriff Startbeleg (§ 6 Abs. 4 RKSV), so auch in FinanzOnline und am Draht (/v3 behaelt ihn)',
};

/** Teilwoerter eines Bezeichners: camelCase, GROSS_SCHRIFT, Ziffern, Pfadtrenner. */
function teile(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_./\-*]+|(?<=\D)(?=\d)|(?<=\d)(?=\D)/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** Warum ein Name deutsch ist, oder `null`. */
export function deutschIn(name: string): string | null {
  if (UMLAUT.test(name)) return 'Umlaut';
  for (const t of teile(name)) {
    if (t in FACHBEGRIFFE) continue;
    if (WOERTER.has(t)) return `Wort "${t}"`;
    for (const s of STAEMME) if (t.includes(s)) return `Stamm "${s}"`;
  }
  return null;
}

// ---------------------------------------------------------------- Ausnahmen

/** Exportierte Namen, die trotz deutschem Teilwort bleiben. Name -> Grund. */
const AUSNAHMEN_NAMEN: Record<string, string> = {};

/**
 * Feldnamen, die trotz deutschem Teilwort bleiben. Schluessel
 * `<Export>.<Feld>` (der Export, ueber den der Waechter das Feld zuerst
 * erreicht) -> Grund.
 */
const AUSNAHMEN_FELDER: Record<string, string> = {
  'fromStoredPosSettings.betrieb': 'gespeicherte Firestore-Form (users/{uid}.register_settings), die ./stored liest; kein Draht, nicht Teil des 1.0-Modells',
  'fromStoredPosSettings.geraet': 'wie betrieb: gespeicherte Firestore-Form, die ./stored als Eingabe annimmt',
  'TextEntry.nur': 'Struktur der Textkataloge, als fixtures/kasse-texte.json Vertrag mit dem Dart-Zwilling; Strukturschluessel der Vertragsdateien folgen in Aufgabe 10',
  'TextEntry.platzhalter': 'Struktur der Textkataloge wie nur (fixtures/kasse-texte.json, Aufgabe 10)',
  'ERROR_RULES.art': 'Fehlerregeln als fixtures/kasse-texte.json Vertrag mit dem Dart-Zwilling (Aufgabe 10)',
  'ERROR_RULES.verhalten': 'Fehlerregeln als fixtures/kasse-texte.json Vertrag mit dem Dart-Zwilling (Aufgabe 10)',
  'ERROR_RULES.schluessel': 'Fehlerregeln als fixtures/kasse-texte.json Vertrag mit dem Dart-Zwilling (Aufgabe 10)',
};

/** Welche Ausnahmen die Laeufe unten wirklich gebraucht haben. */
const gebraucht = new Set<string>();

// ------------------------------------------------------------ Einstiege lesen

const paket = JSON.parse(readFileSync(join(wurzel, 'package.json'), 'utf8')) as {
  exports: Record<string, string | { import?: { types?: string } }>;
};

interface Einstieg { unterpfad: string; quelle: string }

function einstiege(): Einstieg[] {
  const aus: Einstieg[] = [];
  for (const [unterpfad, ziel] of Object.entries(paket.exports)) {
    if (unterpfad.includes('*')) continue;
    const typen = typeof ziel === 'string' ? ziel : ziel.import?.types;
    assert.ok(typen, `${unterpfad}: keine types-Bedingung`);
    const basis = typen.replace(/^\.\/dist\/esm\//, 'src/').replace(/\.d\.ts$/, '');
    const quelle = [`${basis}.ts`, `${basis}.tsx`].map((p) => join(wurzel, p)).find((p) => existsSync(p));
    assert.ok(quelle, `${unterpfad}: keine Quelle zu ${typen}`);
    aus.push({ unterpfad, quelle });
  }
  return aus;
}

const EINSTIEGE = einstiege();
const programm = ts.createProgram(EINSTIEGE.map((e) => e.quelle), {
  strict: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022, skipLibCheck: true, noEmit: true,
});
const pruefer = programm.getTypeChecker();

function exporteVon(quelle: string): ts.Symbol[] {
  const datei = programm.getSourceFile(quelle);
  assert.ok(datei, quelle);
  const modul = pruefer.getSymbolAtLocation(datei);
  assert.ok(modul, `${quelle}: kein Modul`);
  return pruefer.getExportsOfModule(modul);
}

/** Alle Feldnamen, die von einem Typ aus erreichbar sind (Unterobjekte, Parameter, Rueckgaben). */
function felder(wurzelName: string, typ: ts.Type, gesehen: Set<ts.Type>, aus: Map<string, string>, tiefe = 0): void {
  if (tiefe > 8 || gesehen.has(typ)) return;
  gesehen.add(typ);
  if (typ.isUnion() || typ.isIntersection()) {
    for (const t of typ.types) felder(wurzelName, t, gesehen, aus, tiefe + 1);
    return;
  }
  for (const s of [...typ.getCallSignatures(), ...typ.getConstructSignatures()]) {
    for (const p of s.parameters) felder(wurzelName, pruefer.getTypeOfSymbol(p), gesehen, aus, tiefe + 1);
    felder(wurzelName, s.getReturnType(), gesehen, aus, tiefe + 1);
  }
  if (!(typ.flags & ts.TypeFlags.Object)) return;
  if ((typ as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
    for (const a of pruefer.getTypeArguments(typ as ts.TypeReference)) felder(wurzelName, a, gesehen, aus, tiefe + 1);
  }
  for (const eig of typ.getProperties()) {
    const deklaration = eig.declarations?.[0];
    // Nur eigene Typen: Felder aus lib.d.ts, React oder Node sind nicht unsere.
    if (!deklaration || !deklaration.getSourceFile().fileName.startsWith(join(wurzel, 'src'))) continue;
    if (!aus.has(eig.name)) aus.set(eig.name, wurzelName);
    felder(wurzelName, pruefer.getTypeOfSymbol(eig), gesehen, aus, tiefe + 1);
  }
}

// ------------------------------------------------------------------- Tests

test('Exportnamen: die Teilwort-Erkennung trifft Deutsch und laesst Englisch stehen', () => {
  for (const d of ['belegBlatt', 'LogoStufe', 'logoPixelZulaessig', 'rasterZeilenBase64', 'QR_MINDEST_PUNKTE', 'istZeroKind',
    'rund', 'positionAusEuro', 'UmwandlungsGrund', 'MeldungsSchluessel', 'STEUERFREIE_FAELLE', 'KASSE_BASE_URL', 'getKasseSettings',
    'rechnung/rechnen', 'Größe']) {
    assert.ok(deutschIn(d), `nicht erkannt: ${d}`);
  }
  for (const e of ['receiptSheet', 'KasseneckApiError', 'createKasseneckApi', 'isAustrianState', 'AUSTRIAN_STATES', 'eposXmlEscape',
    'TURNOVER', 'receiptZdaText', 'FonLinkResult', 'AvvMode', 'SECRET_MASK', 'euroCents', 'BUSINESS_FIELDS', 'PosTheme']) {
    assert.equal(deutschIn(e), null, `faelschlich erkannt: ${e}`);
  }
});

test('Exportnamen: jeder Unterpfad der package.json ist englisch', () => {
  const deutsch = Object.keys(paket.exports).filter((p) => !p.startsWith('./fixtures/')).map((p) => [p, deutschIn(p)]).filter(([, g]) => g);
  assert.deepEqual(deutsch, []);
});

test('Exportnamen: kein exportierter Name eines Einstiegs ist deutsch', () => {
  const deutsch: string[] = [];
  let gezaehlt = 0;
  for (const { unterpfad, quelle } of EINSTIEGE) {
    for (const s of exporteVon(quelle)) {
      gezaehlt += 1;
      const grund = deutschIn(s.name);
      if (grund && s.name in AUSNAHMEN_NAMEN) gebraucht.add(s.name);
      else if (grund) deutsch.push(`${unterpfad}: ${s.name} (${grund})`);
    }
  }
  assert.ok(gezaehlt > 800, `nur ${gezaehlt} Exporte gelesen, Einstiege nicht gefunden?`);
  assert.deepEqual(deutsch, []);
});

test('Exportnamen: kein Feldname, der von einem Export erreichbar ist, ist deutsch', () => {
  const gefunden = new Map<string, string>();
  const gesehen = new Set<ts.Type>();
  for (const { quelle } of EINSTIEGE) {
    for (const e of exporteVon(quelle)) {
      const s = e.flags & ts.SymbolFlags.Alias ? pruefer.getAliasedSymbol(e) : e;
      if (s.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class)) {
        felder(e.name, pruefer.getDeclaredTypeOfSymbol(s), gesehen, gefunden);
      }
      if (s.flags & ts.SymbolFlags.Value) felder(e.name, pruefer.getTypeOfSymbol(s), gesehen, gefunden);
    }
  }
  assert.ok(gefunden.size > 500, `nur ${gefunden.size} Felder gelesen`);
  const deutsch: string[] = [];
  for (const [feld, ueber] of gefunden) {
    // Textkatalog-Schluessel (`checkout.tip`) sind englisch; ihre Werte bleiben deutsch und sind keine Felder.
    const grund = deutschIn(feld);
    if (grund && `${ueber}.${feld}` in AUSNAHMEN_FELDER) gebraucht.add(`${ueber}.${feld}`);
    else if (grund) deutsch.push(`${ueber}.${feld} (${grund})`);
  }
  assert.deepEqual(deutsch.sort(), []);
});

test('Exportnamen: jede Ausnahme hat einen Grund und wird noch gebraucht', () => {
  for (const [k, grund] of Object.entries({ ...AUSNAHMEN_NAMEN, ...AUSNAHMEN_FELDER })) {
    assert.ok(grund.length > 20, `${k}: Grund fehlt`);
    assert.ok(gebraucht.has(k), `${k}: Ausnahme wird nicht mehr gebraucht, bitte streichen`);
  }
});
