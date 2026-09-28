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
 * - Wert, Platzhalter und `nur` sind byte-gleich, in jeder Sprache;
 * - was auf einen Schluessel zeigt (Fehlerregeln, Code-Zuordnungen), zeigt
 *   auf den umbenannten.
 *
 * Die Texte selbst bleiben deutsch: sie sind fuer Kassiere und
 * Rechnungsempfaenger in Oesterreich geschrieben.
 */

type Json = Record<string, any>;
const lies = (pfad: string): Json => JSON.parse(readFileSync(new URL(`../../${pfad}`, import.meta.url), 'utf8')) as Json;

const TABELLE = lies('fixtures/texte-umbenennung.json');
const ALT_KASSE = lies('test/fixtures/texte-vor-1.0/kasse-texte.json');
const ALT_RECHNUNG = lies('test/fixtures/texte-vor-1.0/rechnung-texte.json');
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

/** Ein Katalog nach der Umbenennung: dieselben Eintraege in derselben Reihenfolge, Werte byte-gleich. */
function katalogPruefen(name: string, tabelle: Record<string, string>, alt: Json, neu: Json): void {
  assert.deepEqual(Object.keys(neu), Object.keys(alt).map((s) => tabelle[s]), `${name}: Schluessel nicht wie in der Tabelle`);
  for (const [alterSchluessel, neuerSchluessel] of Object.entries(tabelle)) {
    assert.equal(JSON.stringify(neu[neuerSchluessel]), JSON.stringify(alt[alterSchluessel]), `${name}: ${alterSchluessel} -> ${neuerSchluessel}`);
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
  katalogPruefen('Meldungen', TABELLE.kasse.meldungen, ALT_KASSE.meldungen, NEU_KASSE.meldungen);
  katalogPruefen('Beschriftungen', TABELLE.kasse.beschriftungen, ALT_KASSE.beschriftungen, NEU_KASSE.beschriftungen);
  katalogPruefen('Meldungen (Quelle)', TABELLE.kasse.meldungen, ALT_KASSE.meldungen, MESSAGES);
  katalogPruefen('Beschriftungen (Quelle)', TABELLE.kasse.beschriftungen, ALT_KASSE.beschriftungen, LABELS);
});

test('Umbenennung: Rechnungstexte byte-gleich in jeder Sprache, Einheiten unveraendert', () => {
  assert.deepEqual(NEU_RECHNUNG.sprachen, ALT_RECHNUNG.sprachen);
  assert.deepEqual(NEU_RECHNUNG.einheiten, ALT_RECHNUNG.einheiten);
  for (const sprache of ALT_RECHNUNG.sprachen as string[]) {
    katalogPruefen(`Rechnung/${sprache}`, TABELLE.rechnung, ALT_RECHNUNG.texte[sprache], NEU_RECHNUNG.texte[sprache]);
    katalogPruefen(`Rechnung/${sprache} (Quelle)`, TABELLE.rechnung, ALT_RECHNUNG.texte[sprache], (INVOICE_TEXTS as Json)[sprache]);
  }
});

test('Umbenennung: Fehlerregeln und Code-Zuordnungen zeigen auf die neuen Schluessel', () => {
  const meldungen = TABELLE.kasse.meldungen as Record<string, string>;
  assert.deepEqual(
    ERROR_RULES,
    (ALT_KASSE.fehlerregeln as Json[]).map((r) => ('schluessel' in r ? { ...r, schluessel: meldungen[r.schluessel] } : r)),
  );
  assert.deepEqual(CANCELLATION_PAYMENT_ERROR_MESSAGES, Object.fromEntries(
    Object.entries(ALT_KASSE.stornoZahlungFehler as Record<string, string>).map(([code, s]) => [code, meldungen[s]]),
  ));
  // Die Belegmail-Codes kommen unter /v3 englisch (Uebersetzung laut Vokabular).
  const uebersetzt = VOKABULAR.errorCodes.translation as Record<string, string>;
  assert.deepEqual(RECEIPT_EMAIL_ERROR_MESSAGES, Object.fromEntries(
    Object.entries(ALT_KASSE.belegMailFehler as Record<string, string>).map(([code, s]) => [uebersetzt[code], meldungen[s]]),
  ));
  assert.deepEqual(NEU_KASSE.fehlerregeln, ERROR_RULES);
  assert.deepEqual(NEU_KASSE.belegMailFehler, RECEIPT_EMAIL_ERROR_MESSAGES);
  assert.deepEqual(NEU_KASSE.stornoZahlungFehler, CANCELLATION_PAYMENT_ERROR_MESSAGES);
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
