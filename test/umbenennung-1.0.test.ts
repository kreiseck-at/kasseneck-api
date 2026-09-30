import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECEIPT_EMAIL_ERROR_MESSAGES, LABELS, ERROR_RULES, MESSAGES, CANCELLATION_PAYMENT_ERROR_MESSAGES, receiptEmailErrorMessage, messageText, labelText, type MessageKey, type LabelKey } from '../src/pos/texte.js';
import { RECEIPT_EMAIL_SEND_ERROR_CODES } from '../src/models/index.js';
import { INVOICE_TEXTS, invoiceText, type InvoiceTextKey } from '../src/invoice/texte.js';

/*
 * Zwilling der Umbenennung 0.x -> 1.0: die Tabelle `fixtures/renames-1.0.json`
 * (erzeugt von scripts/umbenennung-1.0.mjs) gegen den eingefrorenen 0.x-Stand
 * in `test/fixtures/vor-1.0/`.
 *
 * - jeder alte Katalogschluessel steht genau einmal in der Tabelle, die neuen
 *   sind eindeutig und englisch geschrieben;
 * - Platzhalter: die Zuordnung ist eins zu eins, und jeder Text jedes
 *   Katalogs ergibt, alt und neu mit denselben Werten gefuellt, Zeichen fuer
 *   Zeichen denselben Satz;
 * - Strukturschluessel nach Abschnitt `structure`, Dateipfade nach `files`;
 * - was auf einen Schluessel zeigt (Fehlerregeln, Code-Zuordnungen), zeigt
 *   auf den umbenannten.
 *
 * Die Texte bleiben deutsch: sie sind fuer Kassiere und Rechnungsempfaenger in
 * Oesterreich geschrieben.
 */

type Json = Record<string, any>;
const wurzel = fileURLToPath(new URL('../../', import.meta.url));
const lies = (pfad: string): Json => JSON.parse(readFileSync(join(wurzel, pfad), 'utf8')) as Json;

const TABELLE = lies('fixtures/renames-1.0.json');
const ALT_KASSE = lies('test/fixtures/vor-1.0/kasse-texte.json');
const ALT_RECHNUNG = lies('test/fixtures/vor-1.0/rechnung-texte.json');
const ALT_FAELLE = lies('test/fixtures/vor-1.0/kasse-meldungen-faelle.json');
const NEU_KASSE = lies('fixtures/pos-texts.json');
const NEU_RECHNUNG = lies('fixtures/invoice-texts.json');
const NEU_FAELLE = lies('fixtures/pos-message-cases.json');
const VOKABULAR = lies('fixtures/v3/v3-vokabular.json');
const STRUKTUR = TABELLE.structure as Record<string, Record<string, Record<string, string>>>;
const K = STRUKTUR['pos-texts.json']!;
const WERTE = TABELLE.values as Record<string, Record<string, Record<string, string>>>;
const ART = WERTE['pos-texts.json']!['errorRules[].kind']!;

/**
 * Nach dem Umstieg dazugekommen (1.0.0-rc.5, Befunde aus dem Web-Umstieg):
 * ohne 0.x-Vorgaenger, darum in keiner Umbenennung. Alles andere bleibt der
 * 0.x-Stand, nur umbenannt.
 */
const NACH_1_0 = {
  messages: ['network.outcome_unknown', 'server.connection_disturbed', 'server.response_unreadable', 'codetable.question', 'codetable.instruction'],
  labels: ['register.device_unnamed', 'login.locked_seconds', 'split.remaining_with_rounding', 'codetable.title', 'codetable.reference', 'codetable.replacement_note', 'codetable.missing', 'codetable.print_again', 'codetable.not_checked', 'codetable.check', 'codetable.current'],
  // Faelle mit `code` oder `outcome` (seit Version 2 der Datei): die Verfeinerungen.
  caseVersion: 2,
  // Dateischluessel von pos-texts.json: die Verfeinerungen neben errorRules.
  fileKeys: ['errorCodeRules', 'errorOutcomeRules', 'callsWithEffect'],
};
const ohne = (o: Record<string, unknown>, weg: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !weg.includes(k)));
const VERHALTEN = WERTE['pos-texts.json']!['errorRules[].behavior']!;
const PLATZ = TABELLE.placeholders as Record<string, string>;
const MELDUNGEN = TABELLE.texts.pos.messages as Record<string, string>;
const BESCHRIFTUNGEN = TABELLE.texts.pos.labels as Record<string, string>;
const RECHNUNG = TABELLE.texts.invoice as Record<string, string>;

/** Schluessel eines Objekts nach `zuordnung` umbenennen, Reihenfolge und Werte bleiben; unbekannt bricht ab. */
function umbenannt(objekt: Json, zuordnung: Record<string, string>): Json {
  return Object.fromEntries(Object.entries(objekt).map(([k, v]) => {
    assert.ok(k in zuordnung, `Strukturschluessel ${k} fehlt in der Tabelle`);
    return [zuordnung[k], v];
  }));
}

/** Eine Schreibweise fuer beide Kataloge: klein mit Unterstrich, Laendercodes (`country.AT`) ausgenommen. */
const TEIL = '(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|[A-Z]{2})';
const SCHREIBWEISE = new RegExp(`^[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:\\.${TEIL})+$`);
const UMLAUT = /[äöüÄÖÜß]/;

function tabellePruefen(name: string, tabelle: Record<string, string>, alteSchluessel: string[]): void {
  assert.deepEqual(Object.keys(tabelle), alteSchluessel, `${name}: Tabelle deckt nicht genau die alten Schluessel`);
  const neu = Object.values(tabelle);
  assert.equal(new Set(neu).size, neu.length, `${name}: ein neuer Schluessel ist doppelt vergeben`);
  for (const schluessel of neu) {
    assert.match(schluessel, SCHREIBWEISE, `${name}: ${schluessel}`);
    assert.ok(!UMLAUT.test(schluessel), `${name}: ${schluessel}`);
  }
}

// ---- Platzhalter -------------------------------------------------------------

const namenIn = (text: string): string[] => [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!);
/** Derselbe Probewert fuer einen Platzhalter, alt wie neu: eindeutig je alter Name. */
const probe = (alterName: string): string => `<${Object.keys(PLATZ).indexOf(alterName)}:${alterName}>`;
const alteWerte = (text: string): Record<string, string> => Object.fromEntries(namenIn(text).map((n) => [n, probe(n)]));
const neueWerte = (alterText: string): Record<string, string> => Object.fromEntries(namenIn(alterText).map((n) => [PLATZ[n]!, probe(n)]));
/** Einen Text mit Werten fuellen, wie es beide Linien tun; ein fehlender Wert bricht ab. */
function fuelle(text: string, werte: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z]+)\}/g, (_v, n: string) => {
    assert.ok(n in werte, `Wert fuer {${n}} fehlt`);
    return werte[n]!;
  });
}

test('Umbenennung: Tabelle deckt jeden alten Schluessel genau einmal, die neuen sind eindeutig', () => {
  tabellePruefen('Kasse/Meldungen', MELDUNGEN, Object.keys(ALT_KASSE.meldungen));
  tabellePruefen('Kasse/Beschriftungen', BESCHRIFTUNGEN, Object.keys(ALT_KASSE.beschriftungen));
  tabellePruefen('Rechnung', RECHNUNG, Object.keys(ALT_RECHNUNG.texte.de));
  // Meldungen und Beschriftungen teilten sich keinen Schluessel; das bleibt so.
  const meldungen = new Set(Object.values(MELDUNGEN));
  for (const s of Object.values(BESCHRIFTUNGEN)) assert.ok(!meldungen.has(s), s);
});

test('Umbenennung: das Beispiel aus dem Nachtrag', () => {
  assert.equal(MELDUNGEN['storno.ergebnis_unklar'], 'cancellation.outcome_unknown');
  assert.equal(RECHNUNG['steuer.igLieferung.titel'], 'tax.intra_community_supply.title');
  assert.equal(PLATZ['betrag'], 'amount');
  assert.equal(PLATZ['grund'], 'reason');
});

test('Platzhalter: die Zuordnung ist eins zu eins und deckt genau die alten Namen', () => {
  const alt = new Set<string>([
    ...[...Object.values(ALT_KASSE.meldungen as Record<string, Json>), ...Object.values(ALT_KASSE.beschriftungen as Record<string, Json>)].flatMap((e) => namenIn(e.text)),
    ...Object.values(ALT_RECHNUNG.texte as Record<string, Record<string, string>>).flatMap((t) => Object.values(t).flatMap((x) => namenIn(x))),
  ]);
  assert.deepEqual(Object.keys(PLATZ).sort(), [...alt].sort());
  const neu = Object.values(PLATZ);
  assert.equal(new Set(neu).size, neu.length, 'zwei alte Platzhalter auf demselben neuen');
  for (const n of neu) assert.ok(!UMLAUT.test(n) && /^[a-z][A-Za-z]*$/.test(n), n);
  // Kein umbenannter Platzhalter traegt den Namen eines anderen alten: ein halb umgestellter Text bliebe sonst unerkannt.
  for (const [a, n] of Object.entries(PLATZ)) if (a !== n) assert.ok(!(n in PLATZ), `${a} -> ${n} ist selbst ein alter Name`);
});

/** Jeder Kassentext alt und neu, mit denselben Werten gefuellt: Zeichen fuer Zeichen gleich. */
function kasseGerendert(name: string, alt: Json, tabelle: Record<string, string>, neuDatei: Json, neuText: (s: string, w: Record<string, string>) => string): number {
  let n = 0;
  for (const [alterSchluessel, eintrag] of Object.entries(alt as Record<string, Json>)) {
    const neuerSchluessel = tabelle[alterSchluessel]!;
    const soll = fuelle(eintrag.text, alteWerte(eintrag.text));
    assert.equal(neuText(neuerSchluessel, neueWerte(eintrag.text)), soll, `${name} (Quelle): ${alterSchluessel} -> ${neuerSchluessel}`);
    const ausDatei = neuDatei[neuerSchluessel] as Json;
    assert.equal(fuelle(ausDatei.text, neueWerte(eintrag.text)), soll, `${name} (Datei): ${neuerSchluessel}`);
    // Die Liste der Platzhalter ist die alte, eins zu eins umbenannt; `only` bleibt.
    assert.deepEqual(ausDatei.placeholders, eintrag.platzhalter?.map((p: string) => PLATZ[p]), `${name}: ${neuerSchluessel} placeholders`);
    assert.deepEqual(ausDatei.only, eintrag.nur, `${name}: ${neuerSchluessel} only`);
    assert.deepEqual(Object.keys(ausDatei), Object.keys(eintrag).map((k) => K['entry']![k]), `${name}: ${neuerSchluessel} Struktur`);
    n += 1;
  }
  return n;
}

test('Platzhalter: jeder Kassentext ergibt alt und neu gefuellt denselben Satz (Datei und Quelle)', () => {
  assert.deepEqual(Object.keys(NEU_KASSE).filter((k) => !NACH_1_0.fileKeys.includes(k)), Object.keys(ALT_KASSE).map((s) => K['file']![s]), 'Kasse: Dateischluessel nicht wie in der Tabelle');
  assert.deepEqual(Object.keys(NEU_KASSE).filter((k) => NACH_1_0.fileKeys.includes(k)), NACH_1_0.fileKeys);
  const m = kasseGerendert('Meldungen', ALT_KASSE.meldungen, MELDUNGEN, NEU_KASSE.messages, (s, w) => messageText(s as MessageKey, w));
  const l = kasseGerendert('Beschriftungen', ALT_KASSE.beschriftungen, BESCHRIFTUNGEN, NEU_KASSE.labels, (s, w) => labelText(s as LabelKey, w));
  assert.deepEqual(Object.keys(ohne(NEU_KASSE.messages, NACH_1_0.messages)), Object.keys(ALT_KASSE.meldungen).map((s) => MELDUNGEN[s]));
  assert.deepEqual(Object.keys(ohne(NEU_KASSE.labels, NACH_1_0.labels)), Object.keys(ALT_KASSE.beschriftungen).map((s) => BESCHRIFTUNGEN[s]));
  assert.deepEqual(Object.keys(MESSAGES), Object.keys(NEU_KASSE.messages));
  assert.deepEqual(Object.keys(LABELS), Object.keys(NEU_KASSE.labels));
  // Was nach 1.0 dazukam, steht wirklich im Katalog und traegt keinen alten Namen.
  for (const k of NACH_1_0.messages) assert.ok(k in MESSAGES && !Object.values(MELDUNGEN).includes(k), k);
  for (const k of NACH_1_0.labels) assert.ok(k in LABELS && !Object.values(BESCHRIFTUNGEN).includes(k), k);
  assert.equal(m + l + NACH_1_0.messages.length + NACH_1_0.labels.length, Object.keys(MESSAGES).length + Object.keys(LABELS).length);
});

test('Platzhalter: jeder Rechnungstext ergibt alt und neu gefuellt denselben Satz, in jeder Sprache', () => {
  assert.deepEqual(Object.keys(NEU_RECHNUNG), Object.keys(ALT_RECHNUNG).map((s) => STRUKTUR['invoice-texts.json']!['file']![s]));
  assert.deepEqual(NEU_RECHNUNG.languages, ALT_RECHNUNG.sprachen);
  assert.deepEqual(NEU_RECHNUNG.units, ALT_RECHNUNG.einheiten);
  for (const sprache of ALT_RECHNUNG.sprachen as ('de' | 'en')[]) {
    assert.deepEqual(Object.keys(NEU_RECHNUNG.texts[sprache]), Object.keys(ALT_RECHNUNG.texte[sprache]).map((s) => RECHNUNG[s]));
    for (const [alterSchluessel, text] of Object.entries(ALT_RECHNUNG.texte[sprache] as Record<string, string>)) {
      const neu = RECHNUNG[alterSchluessel]!;
      const soll = fuelle(text, alteWerte(text));
      assert.equal(invoiceText(sprache, neu as InvoiceTextKey, neueWerte(text)), soll, `${sprache}: ${alterSchluessel} -> ${neu}`);
      assert.equal(fuelle(NEU_RECHNUNG.texts[sprache][neu], neueWerte(text)), soll, `${sprache} (Datei): ${neu}`);
    }
    assert.deepEqual(Object.keys(INVOICE_TEXTS[sprache]), Object.keys(NEU_RECHNUNG.texts[sprache]));
  }
});

test('Platzhalter: die Probe faellt auf (ein Zeichen anders, Platzhalter vertauscht, alter Name stehen geblieben)', () => {
  const alt = 'Die Karte ist bereits mit {betrag} belastet (Kennung {kennung}).';
  const soll = fuelle(alt, alteWerte(alt));
  assert.equal(fuelle('Die Karte ist bereits mit {amount} belastet (Kennung {reference}).', neueWerte(alt)), soll);
  assert.notEqual(fuelle('Die Karte ist bereits mit {amount} belastet (Kennung {reference})!', neueWerte(alt)), soll);
  assert.notEqual(fuelle('Die Karte ist bereits mit {reference} belastet (Kennung {amount}).', neueWerte(alt)), soll);
  assert.throws(() => fuelle('Die Karte ist bereits mit {betrag} belastet (Kennung {reference}).', neueWerte(alt)), /betrag/);
});

test('Umbenennung: pos-message-cases.json ist der 0.x-Stand, nur umbenannt', () => {
  const F = STRUKTUR['pos-message-cases.json']!;
  const art = ART;
  const soll = umbenannt({ ...ALT_FAELLE, faelle: (ALT_FAELLE.faelle as Json[]).map((fall) => {
    const neu = umbenannt(fall, F['case']!);
    neu.error = umbenannt({ ...fall.fehler, art: art[fall.fehler.art] }, F['error']!);
    if (typeof fall.erwartet === 'object') neu.expected = umbenannt({ ...fall.erwartet, schluessel: MELDUNGEN[fall.erwartet.schluessel] }, F['expected']!);
    // Der Name beginnt mit der Art: auch dort der neue Wert.
    neu.name = String(fall.name).replace(/^[a-z]+(?=:)/, (a: string) => art[a] ?? a);
    return neu;
  }) }, F['file']!);
  // Seit Version 2 tragen Faelle der Art api einen `code`; die ohne Code sind der 0.x-Stand.
  assert.equal(NEU_FAELLE.version, NACH_1_0.caseVersion);
  const alteFaelle = (NEU_FAELLE.cases as Json[]).filter((f) => f.error.code === undefined && f.error.outcome === undefined);
  assert.deepEqual({ ...NEU_FAELLE, version: soll.version, cases: alteFaelle }, soll);
  assert.ok((NEU_FAELLE.cases as Json[]).every((f) => f.error.code === undefined || f.error.kind === 'api'));
  assert.ok((NEU_FAELLE.cases as Json[]).every((f) => f.error.outcome === undefined || ['timeout', 'network'].includes(f.error.kind)));
});

test('Umbenennung: Fehlerregeln und Code-Zuordnungen zeigen auf die neuen Schluessel', () => {
  // ERROR_RULES ist der 0.x-Stand, nur umbenannt; die Verfeinerungen nach 1.0 stehen eigens.
  assert.deepEqual(
    ERROR_RULES,
    (ALT_KASSE.fehlerregeln as Json[]).map((r) => umbenannt({
      ...r,
      art: ART[r.art],
      ...('verhalten' in r ? { verhalten: VERHALTEN[r.verhalten] } : {}),
      ...('schluessel' in r ? { schluessel: MELDUNGEN[r.schluessel] } : {}),
    }, K['errorRule']!)),
  );
  assert.deepEqual(CANCELLATION_PAYMENT_ERROR_MESSAGES, Object.fromEntries(
    Object.entries(ALT_KASSE.stornoZahlungFehler as Record<string, string>).map(([code, s]) => [code, MELDUNGEN[s]]),
  ));
  // Die Belegmail-Codes kommen unter /v3 englisch (Uebersetzung laut Vokabular).
  const uebersetzt = VOKABULAR.errorCodes.translation as Record<string, string>;
  assert.deepEqual(RECEIPT_EMAIL_ERROR_MESSAGES, Object.fromEntries(
    Object.entries(ALT_KASSE.belegMailFehler as Record<string, string>).map(([code, s]) => [uebersetzt[code], MELDUNGEN[s]]),
  ));
  assert.deepEqual(NEU_KASSE.errorRules, ERROR_RULES);
  assert.deepEqual(NEU_KASSE.receiptEmailErrors, RECEIPT_EMAIL_ERROR_MESSAGES);
  assert.deepEqual(NEU_KASSE.cancellationPaymentErrors, CANCELLATION_PAYMENT_ERROR_MESSAGES);
});

test('Belegmail: RECEIPT_EMAIL_ERROR_MESSAGES kennt genau die Codes aus errorCodes.receiptEmail (und RECEIPT_EMAIL_SEND_ERROR_CODES)', () => {
  // Kommt ein Code dazu, faellt er hier auf, statt am Tresen still den
  // allgemeinen Satz zu zeigen.
  const codes = VOKABULAR.errorCodes.receiptEmail as string[];
  assert.deepEqual(Object.keys(RECEIPT_EMAIL_ERROR_MESSAGES).sort(), [...codes].sort());
  assert.deepEqual([...RECEIPT_EMAIL_SEND_ERROR_CODES].sort(), [...codes].sort());
  for (const code of codes) assert.equal(receiptEmailErrorMessage(code), RECEIPT_EMAIL_ERROR_MESSAGES[code as keyof typeof RECEIPT_EMAIL_ERROR_MESSAGES], code);
});

// ---- Dateien und Pruefgeruest ------------------------------------------------

function alleDateien(): string[] {
  const aus: string[] = [];
  const basis = join(wurzel, 'fixtures');
  const gehe = (pfad: string): void => {
    for (const name of readdirSync(pfad).sort()) {
      const voll = join(pfad, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else aus.push(relative(basis, voll).split('\\').join('/'));
    }
  };
  gehe(basis);
  return aus;
}

/** Eingefrorener Bestand der 0.x-Linie (0.31.0): Dateien und Schluessel je JSON-Datei. */
const BESTAND = lies('test/fixtures/vor-1.0/fixtures-0.x.json') as { version: string; dateien: string[]; schluesselMengen: string[][]; schluesselJeDatei: Record<string, number> };
const FILES = TABELLE.files as Record<string, string>;
/** Dateien, die erst mit 1.0 kamen (kein 0.x-Vorgaenger). Der v3-Export des Backends kommt dazu, ohne Eintrag hier. */
/** Bons je Code-Tabelle (1.1.0): die Faelle und je Fall und Tabelle eine Hex-Datei. */
const BONS_JE_TABELLE = JSON.parse(readFileSync(join(wurzel, 'fixtures', 'code-table-receipts.json'), 'utf8')) as { tables: string[]; cases: Array<{ name: string }> };
const NEU_SEIT_1_0 = ['code-table-receipts.json', ...BONS_JE_TABELLE.cases.flatMap((c) => BONS_JE_TABELLE.tables.map((t) => `expected/code-table-receipt.${c.name}.${t}.hex`)), 'code-tables.json', 'expected/code-table-test-sheet.lines.json', 'expected/code-table-test-sheet.mm58.hex', 'expected/code-table-test-sheet.mm80.hex', 'receipt-due-errors.json', 'receipt-due-generated.json', 'renames-1.0.json', 'stored/pos-settings-defaults.json'];

const glob = (muster: string): RegExp => new RegExp(`^${muster.replace(/[.$]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
const gruppen = (neu: string, abschnitt: Record<string, unknown>): string[] => Object.keys(abschnitt).filter((m) => glob(m).test(neu));
function schluessel(o: unknown, s = new Set<string>()): Set<string> {
  if (Array.isArray(o)) o.forEach((x) => schluessel(x, s));
  else if (o !== null && typeof o === 'object') for (const [k, v] of Object.entries(o)) { s.add(k); schluessel(v, s); }
  return s;
}

/** Was die Tabelle fuer eine Datei in 1.0 als alten Namen nennt. */
function gedeckt(neu: string): Set<string> {
  const aus = new Set<string>([
    ...gruppen(neu, STRUKTUR).flatMap((g) => Object.values(STRUKTUR[g]!).flatMap((m) => Object.keys(m))),
    ...gruppen(neu, TABELLE.removed).flatMap((g) => Object.keys(TABELLE.removed[g])),
    ...(TABELLE.shapes as Array<{ file: string; before: string }>).filter((f) => glob(f.file).test(neu)).map((f) => f.before.split(' ')[0]!),
  ]);
  if (neu === 'pos-texts.json') for (const k of [...Object.keys(MELDUNGEN), ...Object.keys(BESCHRIFTUNGEN)]) aus.add(k);
  if (neu === 'invoice-texts.json') for (const k of Object.keys(RECHNUNG)) aus.add(k);
  // Im Manifest sind die Schluessel die Namen der Golden-Belege (files: belege/<alt>.json).
  if (neu === 'manifest.json') for (const f of Object.keys(FILES)) if (f.startsWith('belege/')) aus.add(f.slice('belege/'.length, -'.json'.length));
  return aus;
}

/** Jeder Schluessel einer 0.x-Datei, den die 1.0-Datei nicht mehr traegt und die Tabelle nicht nennt. */
function ungenannt(bestand: typeof BESTAND, files: Record<string, string>, lese: (neu: string) => unknown): string[] {
  const aus: string[] = [];
  for (const [alt, idx] of Object.entries(bestand.schluesselJeDatei)) {
    const neu = files[alt]!;
    const heute = schluessel(lese(neu));
    const bekannt = gedeckt(neu);
    for (const k of bestand.schluesselMengen[idx]!) if (!heute.has(k) && !bekannt.has(k)) aus.push(`${alt} -> ${neu}: ${k}`);
  }
  return aus;
}

test('Dateien: jede Datei der 0.x-Linie hat genau einen neuen Pfad, der existiert', () => {
  assert.equal(BESTAND.version, '0.31.0');
  assert.deepEqual(Object.keys(FILES), BESTAND.dateien);
  assert.equal(new Set(Object.values(FILES)).size, Object.values(FILES).length, 'zwei alte Dateien auf demselben neuen Pfad');
  for (const neu of Object.values(FILES)) assert.ok(existsSync(join(wurzel, 'fixtures', neu)), neu);
  assert.equal(FILES['belege/storno-voll.json'], 'receipts/cancellation-full.json');
  assert.equal(FILES['erwartet/storno-voll.blatt48.json'], 'expected/cancellation-full.sheet48.json');
  assert.equal(FILES['rechnung-summen.json'], 'invoice-totals.json');
});

test('Dateien: jede Datei heute kommt aus der 0.x-Linie, ist neu seit 1.0 oder liegt im Backend-Export (v3/)', () => {
  const ziele = new Set(Object.values(FILES));
  const fremd = alleDateien().filter((d) => !ziele.has(d) && !NEU_SEIT_1_0.includes(d) && !d.startsWith('v3/'));
  assert.deepEqual(fremd, [], 'neue Datei unter fixtures/: umbenannt -> files, neu -> NEU_SEIT_1_0');
  for (const d of NEU_SEIT_1_0) assert.ok(existsSync(join(wurzel, 'fixtures', d)), `tote Zeile in NEU_SEIT_1_0: ${d}`);
});

test('Tabelle: jeder Schluessel der 0.x-Linie, den es in 1.0 nicht mehr gibt, steht in der Tabelle', () => {
  assert.deepEqual(ungenannt(BESTAND, FILES, (neu) => lies(`fixtures/${neu}`)), []);
});

test('Tabelle: jeder alte Name in structure kam in 0.x auch vor (keine erfundene Umbenennung)', () => {
  const je: Record<string, Set<string>> = {};
  for (const [alt, idx] of Object.entries(BESTAND.schluesselJeDatei)) {
    for (const g of gruppen(FILES[alt]!, STRUKTUR)) for (const k of BESTAND.schluesselMengen[idx]!) (je[g] ??= new Set()).add(k);
  }
  const erfunden: string[] = [];
  for (const [g, ebenen] of Object.entries(STRUKTUR)) {
    for (const [ebene, m] of Object.entries(ebenen)) for (const alt of Object.keys(m)) if (!je[g]?.has(alt)) erfunden.push(`${g}/${ebene}: ${alt}`);
  }
  assert.deepEqual(erfunden, []);
});

test('Tabelle: die Pruefung faellt auf einen ungenannten Schluessel (Rot-Probe)', () => {
  const idx = BESTAND.schluesselMengen.length;
  const probe = { ...BESTAND, schluesselMengen: [...BESTAND.schluesselMengen, ['zeitraumNeu', 'version']], schluesselJeDatei: { 'hobex-hps-codes.json': idx } };
  assert.deepEqual(ungenannt(probe, FILES, (neu) => lies(`fixtures/${neu}`)), ['hobex-hps-codes.json -> hobex-hps-codes.json: zeitraumNeu']);
  // Ein Schluessel, den structure nennt, ist gedeckt.
  const gedeckte = { ...probe, schluesselMengen: [...BESTAND.schluesselMengen, ['gemessenAn']] };
  assert.deepEqual(ungenannt(gedeckte, FILES, (neu) => lies(`fixtures/${neu}`)), []);
});

test('Dateien: die Zuordnung bricht bei unbekanntem Pfad oder Schluessel laut ab (Rot-Probe)', async () => {
  const erzeuger = (await import(new URL('../../scripts/umbenennung-1.0.mjs', import.meta.url).href)) as {
    neuerPfad: (p: string) => string;
    umbenannt: (w: unknown, datei: string) => unknown;
  };
  assert.equal(erzeuger.neuerPfad('belege/verkauf-bar.json'), 'receipts/sale-cash.json');
  assert.throws(() => erzeuger.neuerPfad('belege/unbekannt.json'), /unbekannt/);
  assert.throws(() => erzeuger.neuerPfad('erwartet/verkauf-bar.fremd.txt'), /Endung/);
  assert.throws(() => erzeuger.neuerPfad('neu.json'), /keiner Liste/);
  assert.deepEqual(erzeuger.umbenannt({ beschreibung: 'x', regel: { zeile: 'l' }, faelle: [] }, 'rechnung-summen.json'), { description: 'x', rule: { line: 'l' }, cases: [] });
  assert.throws(() => erzeuger.umbenannt({ beschreibung: 'x', fremd: 1 }, 'rechnung-summen.json'), /fremd/);
  assert.throws(() => erzeuger.umbenannt({ faelle: [{ name: 'a', neuesFeld: 1 }] }, 'rechnung-summen.json'), /neuesFeld/);
  assert.throws(() => erzeuger.umbenannt({ unbekannt: { a: 1 } }, 'hobex-hps-codes.json'), /unbekannt/);
});

test('Umbenennung: der Erzeuger gibt die eingecheckte Tabelle byte-gleich wieder (nie von Hand pflegen)', async () => {
  const erzeuger = (await import(new URL('../../scripts/umbenennung-1.0.mjs', import.meta.url).href)) as { umbenennungsDatei: () => string };
  const eingecheckt = readFileSync(join(wurzel, 'fixtures/renames-1.0.json'), 'utf8');
  assert.equal(erzeuger.umbenennungsDatei(), eingecheckt, 'fixtures/renames-1.0.json weicht vom Erzeuger ab: npm run fixtures:umbenennung');
});
