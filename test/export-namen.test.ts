import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { deutschIn, teile } from './deutsch.js';

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
 * Deutsch erkennt der Waechter an Umlauten und am Wortschatz in `test/deutsch.ts`. Die
 * Liste ist bewusst eine Sperrliste deutscher Woerter und Wortstaemme, keine
 * Positivliste englischer: sie haelt, was die Umbenennung zu 1.0 entfernt
 * hat, und die naheliegenden Nachbarn. Wer ein neues deutsches Wort
 * einfuehrt, das hier fehlt, faellt im Review auf; wer eines von hier
 * zurueckbringt, faellt sofort auf.
 *
 * Ausnahmen nur mit Grund (`AUSNAHMEN_*`). Feste Begriffe von BMF/RKSV
 * (`rksv`, `dep`, `zda`, `fon`, …) stehen gar nicht erst in
 * der Sperrliste: sie sind Fachbegriffe, keine Uebersetzungsluecke.
 */

const wurzel = fileURLToPath(new URL('../../', import.meta.url));

// ---------------------------------------------------------------- Ausnahmen

/** Exportierte Namen, die trotz deutschem Teilwort bleiben. Name -> Grund. */
const AUSNAHMEN_NAMEN: Record<string, string> = {};

/**
 * Feldnamen, die trotz deutschem Teilwort bleiben. Schluessel
 * `<Datei>:<Typ>.<Feld>`: gebunden an die Deklaration des Feldes (Interface,
 * Typalias, Klasse, Konstante oder Funktion, in der es steht), nicht an den
 * Export, ueber den der Waechter es findet. Ein gleichnamiges Feld an anderer
 * Stelle bleibt damit ein Fund.
 */
const AUSNAHMEN_FELDER: Record<string, string> = {
  'src/stored/index.ts:fromStoredPosSettings.betrieb': 'gespeicherte Firestore-Form (users/{uid}.register_settings), die ./stored liest; kein Draht, nicht Teil des 1.0-Modells',
  'src/stored/index.ts:fromStoredPosSettings.geraet': 'wie betrieb: gespeicherte Firestore-Form, die ./stored als Eingabe annimmt',
  'src/stored/index.ts:invalidStoredPosSettings.betrieb': 'dieselbe gespeicherte Firestore-Form als Eingabe der Pruefung',
  'src/stored/index.ts:invalidStoredPosSettings.geraet': 'dieselbe gespeicherte Firestore-Form als Eingabe der Pruefung',
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

const SRC = join(wurzel, 'src');

/** Wo ein Feld deklariert ist: `<Datei>:<Typ>.<Feld>`, unabhaengig von der Besuchsreihenfolge. */
function herkunft(deklaration: ts.Declaration, feld: string): string {
  let knoten: ts.Node | undefined = deklaration.parent;
  while (knoten && !ts.isSourceFile(knoten)) {
    if ((ts.isInterfaceDeclaration(knoten) || ts.isTypeAliasDeclaration(knoten) || ts.isClassDeclaration(knoten)
      || ts.isFunctionDeclaration(knoten) || ts.isVariableDeclaration(knoten)) && knoten.name && ts.isIdentifier(knoten.name)) {
      break;
    }
    knoten = knoten.parent;
  }
  const datei = deklaration.getSourceFile().fileName.slice(wurzel.length);
  const typ = knoten && !ts.isSourceFile(knoten) ? ((knoten as ts.NamedDeclaration).name as ts.Identifier).text : '<anonym>';
  return `${datei}:${typ}.${feld}`;
}

interface Feld { feld: string; herkunft: string }

/**
 * Alle Feldnamen, die von einem Typ aus erreichbar sind (Unterobjekte,
 * Parameter, Rueckgaben), auch die Schluessel von `Record<K, V>` und anderen
 * Mapped Types: deren Eigenschaften haben keine eigene Deklaration in `src`,
 * ihre Schluessel kommen aber aus unseren Literaltypen.
 */
function felder(wurzelName: string, typ: ts.Type, gesehen: Set<ts.Type>, aus: Feld[], tiefe = 0): void {
  if (tiefe > 10 || gesehen.has(typ)) return;
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
  const flags = (typ as ts.ObjectType).objectFlags;
  if (flags & ts.ObjectFlags.Reference) {
    for (const a of pruefer.getTypeArguments(typ as ts.TypeReference)) felder(wurzelName, a, gesehen, aus, tiefe + 1);
  }
  const abgebildet = (flags & ts.ObjectFlags.Mapped) !== 0;
  const alias = typ.aliasSymbol;
  const aliasEigen = alias?.declarations?.[0]?.getSourceFile().fileName.startsWith(SRC) === true;
  // `Record`/`Readonly` nennen nichts; dann der Export, ueber den das Feld erreicht wurde.
  const name = alias && aliasEigen ? alias.name : wurzelName;
  for (const eig of pruefer.getPropertiesOfType(typ)) {
    const deklaration = eig.declarations?.[0];
    const eigen = deklaration !== undefined && deklaration.getSourceFile().fileName.startsWith(SRC);
    // Felder aus lib.d.ts, React oder Node sind nicht unsere; Schluessel eines
    // Mapped Type dagegen schon, auch wenn ihre Deklaration in lib.d.ts steht.
    if (!eigen && !abgebildet) continue;
    aus.push({ feld: eig.name, herkunft: eigen ? herkunft(deklaration, eig.name) : `<abgebildet>:${name}.${eig.name}` });
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

/** Alle erreichbaren Felder aus allen Einstiegen. */
function alleFelder(): Feld[] {
  const gefunden: Feld[] = [];
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
  return gefunden;
}

test('Exportnamen: kein Feldname, der von einem Export erreichbar ist, ist deutsch', () => {
  const gefunden = alleFelder();
  assert.ok(new Set(gefunden.map((f) => f.feld)).size > 500, `nur ${gefunden.length} Felder gelesen`);
  // Die Schluessel der Mapped Types werden wirklich gelesen (Textkatalog, Standardwerte).
  for (const probe of ['checkout.tip', 'paperSize']) {
    assert.ok(gefunden.some((f) => f.feld === probe), `${probe} nicht erreicht`);
  }
  const deutsch = new Set<string>();
  for (const { feld, herkunft: wo } of gefunden) {
    const grund = deutschIn(feld);
    if (!grund) continue;
    if (wo in AUSNAHMEN_FELDER) gebraucht.add(wo);
    else deutsch.add(`${wo} (${grund})`);
  }
  assert.deepEqual([...deutsch].sort(), []);
});

test('Exportnamen: jede Ausnahme hat einen Grund und wird noch gebraucht', () => {
  for (const [k, grund] of Object.entries({ ...AUSNAHMEN_NAMEN, ...AUSNAHMEN_FELDER })) {
    assert.ok(grund.length > 20, `${k}: Grund fehlt`);
    assert.ok(gebraucht.has(k), `${k}: Ausnahme wird nicht mehr gebraucht, bitte streichen`);
  }
});

// ------------------------------------------------------ Parameternamen (d.ts)

/**
 * Deutsche Teilwoerter, die nur als Parametername vorkamen. Sie stehen hier
 * und nicht in `test/deutsch.ts`, weil diese Liste auch die Draht-Fixtures
 * prueft, wo manche davon (`standard`) englische Werte sind.
 */
const PARAMETER_WOERTER: ReadonlySet<string> = new Set([
  'abfrage', 'anfrage', 'aussen', 'bekannt', 'daten', 'eintrag', 'eintraege', 'geheimnisse', 'gespeichert',
  'huelle', 'intervall', 'kennung', 'kopf', 'monate', 'nachricht', 'recht', 'roh', 'rufen', 'sprache', 'suche',
  'ursache', 'vorgabe', 'weiteres', 'wert', 'werte', 'zeitpunkt', 'zwoelftel', 'binaer', 'anzahl', 'positionen', 'zertifikat',
]);

/**
 * Positivliste: jedes Teilwort eines oeffentlichen Parameternamens ist ein
 * englisches Wort aus dieser Liste oder ein Kuerzel aus [PARAMETER_KUERZEL].
 * Ein unbekanntes Teilwort laesst den Test fallen, auch wenn es in keiner
 * Sperrliste steht (`menge`, `kunde`, `wochentag`). Wer einen neuen,
 * englischen Namen einfuehrt, traegt sein Teilwort hier ein.
 */
const PARAMETER_ENGLISCH: ReadonlySet<string> = new Set(`
after alternate before binary block body budget business bytes cashregister cause cents certificate chars client code
columns company connect content count customer data date detail details device dimensions discount email endpoint error event
extra fallback fetch field fields font format function grid header height image index inner instant interface interval
invoice item items key kind label language layout logo matrix max message month months mode module name now number options
out outcome paper patch payload payment price query rate raw reason receipt report request result scheme scope search
secret serial server session setting settings shortcuts size standard status step stored stripe styles surface table
target tax terminal text timed timeout transport twelfths type unit value values version voucher vouchers wanted webhook
width
`.split(/\s+/).filter(Boolean));

/** Kuerzel und Fachbegriffe in Parameternamen: Teilwort -> Grund. */
const PARAMETER_KUERZEL: Record<string, string> = {
  a: 'Einzelbuchstabe (Vergleichsfunktion a/b)', b: 'Einzelbuchstabe (Vergleichsfunktion a/b)', c: 'Einzelbuchstabe (Zeichen/Code in kurzen Helfern)',
  d: 'Einzelbuchstabe (Datum/Daten in kurzen Helfern)', n: 'Einzelbuchstabe (Anzahl)', o: 'Einzelbuchstabe (Optionen)',
  p: 'Einzelbuchstabe (Parameter)', w: 'Einzelbuchstabe (Breite)', bp: 'Basispunkte (rateBp)', ms: 'Millisekunden',
  px: 'Pixel', qr: 'QR-Code', rgba: 'Farbkanaele RGBA', rm: 'Rundungsmodus (rm) wie im Rechenkern', devid: 'Geraetekennung von WebUSB/HPS',
  fn: 'Funktion (fetchFn)', hex: 'hexadezimal', http: 'HTTP', id: 'Kennung', ip: 'IP-Adresse', xml: 'XML', url: 'URL',
  res: 'Antwort (res) wie in Node/Express', init: 'RequestInit wie in fetch', dev: 'USB-Geraet (WebUSB)', doc: 'Dokument',
  ref: 'Referenz', perms: 'Rechte (permissions)', micros: 'Millionstel (unitPriceMicros)', params: 'Parameter (params)',
};

/** Warum ein Parametername nicht zugelassen ist, oder `null`. */
function parameterNichtEnglisch(name: string): string | null {
  const deutsch = deutschIn(name, PARAMETER_WOERTER);
  if (deutsch) return deutsch;
  for (const t of teile(name)) {
    if (!PARAMETER_ENGLISCH.has(t) && !(t in PARAMETER_KUERZEL)) return `Teilwort "${t}" nicht in der Positivliste`;
  }
  return null;
}

/** Parameternamen, die trotz deutschem Teilwort bleiben. `<d.ts>:<Deklaration>(<Parameter>)` -> Grund. */
const AUSNAHMEN_PARAMETER: Record<string, string> = {};

/**
 * Die Deklarationen, wie ein Verbraucher sie sieht: die `.d.ts`, die `tsc`
 * aus `src` erzeugt, im Speicher erzeugt und von dort gelesen. So zaehlt
 * genau der Name, den der Tooltip der IDE zeigt.
 */
function dtsProgramm(): { programm: ts.Program; ordner: string; einstiege: string[] } {
  const ordner = join(wurzel, '.dts-waechter');
  const optionen: ts.CompilerOptions = {
    strict: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022, skipLibCheck: true, declaration: true, emitDeclarationOnly: true,
    rootDir: SRC, outDir: ordner,
  };
  const dateien = new Map<string, string>();
  const erzeugt = ts.createProgram(EINSTIEGE.map((e) => e.quelle), optionen).emit(undefined, (name, text) => dateien.set(name, text));
  assert.equal(erzeugt.emitSkipped, false, 'd.ts nicht erzeugt');
  const wirt = ts.createCompilerHost({ ...optionen, noEmit: true });
  const lesen = wirt.readFile.bind(wirt);
  const gibt = wirt.fileExists.bind(wirt);
  const quelle = wirt.getSourceFile.bind(wirt);
  wirt.readFile = (p) => dateien.get(p) ?? lesen(p);
  wirt.fileExists = (p) => dateien.has(p) || gibt(p);
  // Den Ordner gibt es nur im Speicher; ohne das sucht die Modulaufloesung dort gar nicht erst.
  wirt.directoryExists = (d) => d === ordner || d.startsWith(`${ordner}/`) || ts.sys.directoryExists(d);
  wirt.getSourceFile = (p, sprachversion, ...rest) => {
    const text = dateien.get(p);
    return text !== undefined ? ts.createSourceFile(p, text, sprachversion, true) : quelle(p, sprachversion, ...rest);
  };
  const einstiege = EINSTIEGE.map((e) => e.quelle.replace(SRC, ordner).replace(/\.tsx?$/, '.d.ts'));
  for (const e of einstiege) assert.ok(dateien.has(e), `${e} nicht erzeugt`);
  return { programm: ts.createProgram(einstiege, { ...optionen, noEmit: true }, wirt), ordner, einstiege };
}

interface Parameter { name: string; wo: string }

/** Alle Parameternamen, die von den Exporten der Einstiege aus erreichbar sind (Funktionen, Methoden, Konstruktoren). */
function alleParameter(): Parameter[] {
  const { programm: dts, ordner, einstiege } = dtsProgramm();
  const p = dts.getTypeChecker();
  const aus: Parameter[] = [];
  const gesehen = new Set<ts.Type>();
  const eigen = (d: ts.Node | undefined) => d !== undefined && d.getSourceFile().fileName.startsWith(ordner);
  const ort = (d: ts.Declaration) => {
    const datei = d.getSourceFile().fileName.slice(ordner.length + 1);
    let k: ts.Node | undefined = d;
    const kette: string[] = [];
    while (k && !ts.isSourceFile(k)) {
      const n = (k as ts.NamedDeclaration).name;
      if (n && ts.isIdentifier(n)) kette.unshift(n.text);
      else if (ts.isConstructorDeclaration(k)) kette.unshift('constructor');
      k = k.parent;
    }
    return `${datei}:${kette.join('.')}`;
  };
  const signatur = (s: ts.Signature) => {
    const d = s.getDeclaration() as ts.SignatureDeclaration | undefined;
    if (!eigen(d)) return;
    for (const par of s.parameters) {
      const pd = par.declarations?.[0];
      if (pd && eigen(pd) && ts.isParameter(pd) && ts.isIdentifier(pd.name)) aus.push({ name: pd.name.text, wo: `${ort(d!)}(${pd.name.text})` });
    }
  };
  const typ = (t: ts.Type, tiefe: number): void => {
    if (tiefe > 12 || gesehen.has(t)) return;
    gesehen.add(t);
    if (t.isUnion() || t.isIntersection()) { for (const u of t.types) typ(u, tiefe + 1); return; }
    for (const s of [...t.getCallSignatures(), ...t.getConstructSignatures()]) {
      signatur(s);
      for (const par of s.parameters) typ(p.getTypeOfSymbol(par), tiefe + 1);
      typ(s.getReturnType(), tiefe + 1);
    }
    if (!(t.flags & ts.TypeFlags.Object)) return;
    if ((t as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
      for (const a of p.getTypeArguments(t as ts.TypeReference)) typ(a, tiefe + 1);
    }
    for (const eig of p.getPropertiesOfType(t)) {
      if (!eigen(eig.declarations?.[0])) continue;
      typ(p.getTypeOfSymbol(eig), tiefe + 1);
    }
  };
  for (const e of einstiege) {
    const modul = p.getSymbolAtLocation(dts.getSourceFile(e)!);
    assert.ok(modul, `${e}: kein Modul`);
    for (const x of p.getExportsOfModule(modul)) {
      const s = x.flags & ts.SymbolFlags.Alias ? p.getAliasedSymbol(x) : x;
      if (s.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class)) typ(p.getDeclaredTypeOfSymbol(s), 0);
      if (s.flags & ts.SymbolFlags.Value) typ(p.getTypeOfSymbol(s), 0);
    }
  }
  return aus;
}

test('Parameternamen: kein Parameter einer exportierten Funktion, Methode oder Klasse ist deutsch (gelesen aus der d.ts)', () => {
  const gefunden = alleParameter();
  assert.ok(gefunden.length > 400, `nur ${gefunden.length} Parameter gelesen`);
  // Stichproben: Funktion, Methode einer Fassade, Konstruktor.
  for (const probe of ['receipt/bild.d.ts:rasterizeLogo(rgba)', 'client/errors.d.ts:KasseneckApiError.constructor(functionName)']) {
    assert.ok(gefunden.some((g) => g.wo === probe), `${probe} nicht erreicht`);
  }
  assert.ok(gefunden.some((g) => g.wo.startsWith('invoice/api.d.ts:InvoiceApi.')), 'Methoden der Rechnungs-Fassade nicht erreicht');
  const deutsch = new Set<string>();
  for (const { name, wo } of gefunden) {
    const grund = parameterNichtEnglisch(name);
    if (!grund) continue;
    if (wo in AUSNAHMEN_PARAMETER) continue;
    deutsch.add(`${wo} (${grund})`);
  }
  assert.deepEqual([...deutsch].sort(), []);
});

test('Parameternamen: die Ausnahmen tragen einen Grund', () => {
  for (const [k, grund] of Object.entries(AUSNAHMEN_PARAMETER)) assert.ok(grund.length > 20, `${k}: Grund fehlt`);
});

test('Parameternamen: die Positivliste faengt deutsche Namen, die in keiner Sperrliste stehen', () => {
  // Rot-Probe des Nachreviews: zwoelf deutsche Parameter, von denen die
  // Sperrliste allein nur zwei erkannte.
  for (const name of ['betragCents', 'fehlerText', 'menge', 'kunde', 'ziel', 'eingabe', 'artikel', 'datum', 'liste', 'bestellung', 'quelle', 'wochentag']) {
    assert.ok(parameterNichtEnglisch(name), `nicht erkannt: ${name}`);
  }
  for (const name of ['transport', 'options', 'unitPriceMicros', 'certificateSerialHex', 'pxWidth', 'fetchFn', 'rateBp']) {
    assert.equal(parameterNichtEnglisch(name), null, name);
  }
});

test('Parameternamen: jedes Kuerzel hat einen Grund', () => {
  for (const [k, grund] of Object.entries(PARAMETER_KUERZEL)) assert.ok(grund.length >= 3, `${k}: Grund fehlt`);
});
