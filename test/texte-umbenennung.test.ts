import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECEIPT_EMAIL_ERROR_MESSAGES, LABELS, ERROR_RULES, MESSAGES, CANCELLATION_PAYMENT_ERROR_MESSAGES, receiptEmailErrorMessage } from '../src/pos/texte.js';
import { RECEIPT_EMAIL_SEND_ERROR_CODES } from '../src/models/index.js';
import { INVOICE_TEXTS } from '../src/invoice/texte.js';

/*
 * Zwilling der Umbenennung der Textkatalog-Schluessel (1.0): die Tabelle
 * `fixtures/texte-umbenennung.json` (erzeugt von scripts/texte-umbenennung.mjs)
 * gegen den eingefrorenen 0.x-Stand in `test/fixtures/texte-vor-1.0/`.
 *
 * - jeder alte Schluessel steht genau einmal in der Tabelle, keiner dazu;
 * - die neuen Schluessel sind eindeutig und englisch geschrieben;
 * - Wert, Platzhalter und `nur` sind byte-gleich, in jeder Sprache; seit
 *   1.0 heissen auch die Strukturschluessel englisch (`placeholders`,
 *   `only`, `messages` ...), nach Abschnitt `struktur` der Tabelle;
 * - was auf einen Schluessel zeigt (Fehlerregeln, Code-Zuordnungen), zeigt
 *   auf den umbenannten;
 * - kasse-meldungen-faelle.json ist der 0.x-Stand, nur umbenannt.
 *
 * Die Texte selbst bleiben deutsch: sie sind fuer Kassiere und
 * Rechnungsempfaenger in Oesterreich geschrieben.
 */

type Json = Record<string, any>;
const lies = (pfad: string): Json => JSON.parse(readFileSync(new URL(`../../${pfad}`, import.meta.url), 'utf8')) as Json;

const TABELLE = lies('fixtures/texte-umbenennung.json');
const ALT_KASSE = lies('test/fixtures/texte-vor-1.0/kasse-texte.json');
const ALT_RECHNUNG = lies('test/fixtures/texte-vor-1.0/rechnung-texte.json');
const ALT_FAELLE = lies('test/fixtures/texte-vor-1.0/kasse-meldungen-faelle.json');
const NEU_FAELLE = lies('fixtures/kasse-meldungen-faelle.json');
const STRUKTUR = TABELLE.struktur as Record<string, Record<string, Record<string, string>>>;
const K = STRUKTUR['kasse-texte.json']!;

/** Schluessel eines Objekts nach `zuordnung` umbenennen, Reihenfolge und Werte bleiben. */
function umbenannt(objekt: Json, zuordnung: Record<string, string>): Json {
  return Object.fromEntries(Object.entries(objekt).map(([k, v]) => {
    assert.ok(k in zuordnung, `Strukturschluessel ${k} fehlt in der Tabelle`);
    return [zuordnung[k], v];
  }));
}
const neuerEintrag = (e: Json): Json => umbenannt(e, K['eintrag']!);
const NEU_KASSE = lies('fixtures/kasse-texte.json');
const NEU_RECHNUNG = lies('fixtures/rechnung-texte.json');
const VOKABULAR = lies('fixtures/v3/v3-vokabular.json');

/** Eine Schreibweise fuer beide Kataloge: klein mit Unterstrich, Laendercodes (`country.AT`) ausgenommen. */
const TEIL = '(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|[A-Z]{2})';
const SCHREIBWEISE = new RegExp(`^[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:\\.${TEIL})+$`);
const UMLAUT = /[äöüÄÖÜß]/;

/** Jeder alte Schluessel genau einmal, keiner dazu, neue eindeutig und englisch geschrieben. */
function tabellePruefen(name: string, tabelle: Record<string, string>, alteSchluessel: string[]): void {
  assert.deepEqual(Object.keys(tabelle), alteSchluessel, `${name}: Tabelle deckt nicht genau die alten Schluessel`);
  const neu = Object.values(tabelle);
  assert.equal(new Set(neu).size, neu.length, `${name}: ein neuer Schluessel ist doppelt vergeben`);
  for (const schluessel of neu) {
    assert.match(schluessel, SCHREIBWEISE, `${name}: ${schluessel}`);
    assert.ok(!UMLAUT.test(schluessel), `${name}: ${schluessel}`);
  }
}

/**
 * Ein Katalog nach der Umbenennung: dieselben Eintraege in derselben
 * Reihenfolge, Werte byte-gleich. `eintrag` bildet einen alten Eintrag auf
 * den neuen ab (Kasse: Strukturschluessel englisch; Rechnung: Text bleibt).
 */
function katalogPruefen(name: string, tabelle: Record<string, string>, alt: Json, neu: Json, eintrag: (e: Json) => Json = (e) => e): void {
  assert.deepEqual(Object.keys(neu), Object.keys(alt).map((s) => tabelle[s]), `${name}: Schluessel nicht wie in der Tabelle`);
  for (const [alterSchluessel, neuerSchluessel] of Object.entries(tabelle)) {
    assert.equal(JSON.stringify(neu[neuerSchluessel]), JSON.stringify(eintrag(alt[alterSchluessel])), `${name}: ${alterSchluessel} -> ${neuerSchluessel}`);
  }
}

test('Umbenennung: Tabelle deckt jeden alten Schluessel genau einmal, die neuen sind eindeutig', () => {
  tabellePruefen('Kasse/Meldungen', TABELLE.kasse.meldungen, Object.keys(ALT_KASSE.meldungen));
  tabellePruefen('Kasse/Beschriftungen', TABELLE.kasse.beschriftungen, Object.keys(ALT_KASSE.beschriftungen));
  tabellePruefen('Rechnung', TABELLE.rechnung, Object.keys(ALT_RECHNUNG.texte.de));
  // Meldungen und Beschriftungen teilten sich keinen Schluessel; das bleibt so.
  const meldungen = new Set(Object.values(TABELLE.kasse.meldungen) as string[]);
  for (const s of Object.values(TABELLE.kasse.beschriftungen) as string[]) assert.ok(!meldungen.has(s), s);
});

test('Umbenennung: das Beispiel aus dem Nachtrag', () => {
  assert.equal(TABELLE.kasse.meldungen['storno.ergebnis_unklar'], 'cancellation.outcome_unknown');
  assert.equal(TABELLE.rechnung['steuer.igLieferung.titel'], 'tax.intra_community_supply.title');
});

test('Umbenennung: Kassentexte byte-gleich unter neuem Schluessel (Datei und Quelle)', () => {
  assert.deepEqual(Object.keys(NEU_KASSE), Object.keys(ALT_KASSE).map((s) => K['datei']![s]), 'Kasse: Dateischluessel nicht wie in der Tabelle');
  katalogPruefen('Meldungen', TABELLE.kasse.meldungen, ALT_KASSE.meldungen, NEU_KASSE.messages, neuerEintrag);
  katalogPruefen('Beschriftungen', TABELLE.kasse.beschriftungen, ALT_KASSE.beschriftungen, NEU_KASSE.labels, neuerEintrag);
  katalogPruefen('Meldungen (Quelle)', TABELLE.kasse.meldungen, ALT_KASSE.meldungen, MESSAGES, neuerEintrag);
  katalogPruefen('Beschriftungen (Quelle)', TABELLE.kasse.beschriftungen, ALT_KASSE.beschriftungen, LABELS, neuerEintrag);
});

test('Umbenennung: die Texte selbst sind Zeichen fuer Zeichen die alten (nur Schluessel umbenannt)', () => {
  // Unabhaengig von der Strukturtabelle: gleiche Texte und Platzhalter in gleicher Reihenfolge.
  const texte = (k: Json): string[] => Object.values(k as Record<string, Json>).map((e) => `${e.text}|${JSON.stringify(e.platzhalter ?? e.placeholders ?? null)}|${JSON.stringify(e.nur ?? e.only ?? null)}`);
  assert.deepEqual(texte(NEU_KASSE.messages), texte(ALT_KASSE.meldungen));
  assert.deepEqual(texte(NEU_KASSE.labels), texte(ALT_KASSE.beschriftungen));
});

test('Umbenennung: kasse-meldungen-faelle.json ist der 0.x-Stand, nur umbenannt', () => {
  const F = STRUKTUR['kasse-meldungen-faelle.json']!;
  const meldungen = TABELLE.kasse.meldungen as Record<string, string>;
  const art = K['art']!;
  const soll = umbenannt({ ...ALT_FAELLE, faelle: (ALT_FAELLE.faelle as Json[]).map((fall) => {
    const neu = umbenannt(fall, F['fall']!);
    neu.error = umbenannt({ ...fall.fehler, art: art[fall.fehler.art] }, F['fehler']!);
    if (typeof fall.erwartet === 'object') neu.expected = umbenannt({ ...fall.erwartet, schluessel: meldungen[fall.erwartet.schluessel] }, F['erwartet']!);
    // Der Name beginnt mit der Art: auch dort der neue Wert.
    neu.name = String(fall.name).replace(/^[a-z]+(?=:)/, (a: string) => art[a] ?? a);
    return neu;
  }) }, F['datei']!);
  assert.deepEqual(NEU_FAELLE, soll);
});

test('Umbenennung: Rechnungstexte byte-gleich in jeder Sprache, Einheiten unveraendert', () => {
  assert.deepEqual(Object.keys(NEU_RECHNUNG), Object.keys(ALT_RECHNUNG).map((s) => STRUKTUR['rechnung-texte.json']!['datei']![s]));
  assert.deepEqual(NEU_RECHNUNG.languages, ALT_RECHNUNG.sprachen);
  assert.deepEqual(NEU_RECHNUNG.units, ALT_RECHNUNG.einheiten);
  for (const sprache of ALT_RECHNUNG.sprachen as string[]) {
    katalogPruefen(`Rechnung/${sprache}`, TABELLE.rechnung, ALT_RECHNUNG.texte[sprache], NEU_RECHNUNG.texts[sprache]);
    katalogPruefen(`Rechnung/${sprache} (Quelle)`, TABELLE.rechnung, ALT_RECHNUNG.texte[sprache], (INVOICE_TEXTS as Json)[sprache]);
  }
});

test('Umbenennung: Fehlerregeln und Code-Zuordnungen zeigen auf die neuen Schluessel', () => {
  const meldungen = TABELLE.kasse.meldungen as Record<string, string>;
  assert.deepEqual(
    ERROR_RULES,
    (ALT_KASSE.fehlerregeln as Json[]).map((r) => umbenannt({
      ...r,
      art: K['art']![r.art],
      ...('verhalten' in r ? { verhalten: K['verhalten']![r.verhalten] } : {}),
      ...('schluessel' in r ? { schluessel: meldungen[r.schluessel] } : {}),
    }, K['fehlerregel']!)),
  );
  assert.deepEqual(CANCELLATION_PAYMENT_ERROR_MESSAGES, Object.fromEntries(
    Object.entries(ALT_KASSE.stornoZahlungFehler as Record<string, string>).map(([code, s]) => [code, meldungen[s]]),
  ));
  // Die Belegmail-Codes kommen unter /v3 englisch (Uebersetzung laut Vokabular).
  const uebersetzt = VOKABULAR.errorCodes.translation as Record<string, string>;
  assert.deepEqual(RECEIPT_EMAIL_ERROR_MESSAGES, Object.fromEntries(
    Object.entries(ALT_KASSE.belegMailFehler as Record<string, string>).map(([code, s]) => [uebersetzt[code], meldungen[s]]),
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

test('Umbenennung: der Erzeuger gibt die eingecheckte Tabelle byte-gleich wieder (nie von Hand pflegen)', async () => {
  const pfad = new URL('../../scripts/texte-umbenennung.mjs', import.meta.url).href;
  const erzeuger = (await import(pfad)) as { umbenennungsDatei: () => string };
  const eingecheckt = readFileSync(new URL('../../fixtures/texte-umbenennung.json', import.meta.url), 'utf8');
  assert.equal(erzeuger.umbenennungsDatei(), eingecheckt, 'fixtures/texte-umbenennung.json weicht vom Erzeuger ab: npm run fixtures:texte-umbenennung');
});
