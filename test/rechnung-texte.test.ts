import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INVOICE_LANGUAGES, INVOICE_UNITS, RECHNUNG_EINHEITEN_CODES } from '../src/rechnung/vertrag.js';
import { RECHNUNG_TEXTE, rechnungText, type RechnungTextSchluessel } from '../src/rechnung/texte.js';

const platzhalter = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort();
const schluessel = Object.keys(RECHNUNG_TEXTE.de) as RechnungTextSchluessel[];

test('Katalog: jede Sprache hat genau dieselben Schluessel', () => {
  const de = [...schluessel].sort();
  for (const sprache of INVOICE_LANGUAGES) assert.deepEqual(Object.keys(RECHNUNG_TEXTE[sprache]).sort(), de, sprache);
});

test('Katalog: kein leerer Text, dieselben Platzhalter je Schluessel', () => {
  for (const s of schluessel) {
    const erwartet = platzhalter(RECHNUNG_TEXTE.de[s]);
    for (const sprache of INVOICE_LANGUAGES) {
      const text = RECHNUNG_TEXTE[sprache][s];
      assert.ok(text.trim().length > 0, `${sprache}.${s} leer`);
      assert.deepEqual(platzhalter(text), erwartet, `${sprache}.${s}: Platzhalter weichen ab`);
    }
  }
});

test('Katalog: Englisch ist nicht einfach Deutsch (ausser neutrale Kuerzel)', () => {
  // Neutral sind nur Woerter, die in beiden Sprachen gleich lauten.
  const neutral = new Set<RechnungTextSchluessel>(['pdf.tabelle.pos', 'pdf.zahlung.iban', 'pdf.zahlung.bic', 'pdf.status.link', 'zahlungsart.online', 'land.LI']);
  for (const s of schluessel) {
    // Kuerzel wie kg oder kWh sind international gleich; die Namen muessen uebersetzt sein.
    if (neutral.has(s) || s.startsWith('einheit.')) continue;
    assert.notEqual(RECHNUNG_TEXTE.en[s], RECHNUNG_TEXTE.de[s], `${s} ist nicht uebersetzt`);
  }
});

test('Katalog: Steuerhinweise nennen in jeder Sprache die Gesetzesstelle', () => {
  const stellen: RechnungTextSchluessel[] = ['steuer.kleinunternehmer', 'steuer.igLieferung.text', 'steuer.ausfuhr', 'steuer.reverseCharge.text',
    'einvoice.befreiung.kleinunternehmer', 'einvoice.befreiung.igLieferung', 'einvoice.befreiung.ausfuhr'];
  for (const sprache of INVOICE_LANGUAGES) {
    for (const s of stellen) assert.match(RECHNUNG_TEXTE[sprache][s], /UStG|2006\/112/, `${sprache}.${s} ohne Gesetzesstelle`);
  }
});

test('Katalog: Reverse Charge behauptet keine Steuerbefreiung', () => {
  // Der Umsatz bleibt steuerpflichtig, nur die Steuer schuldet der Empfaenger
  // (§ 11 Abs. 1a UStG). „Steuerfrei" waere sachlich falsch — und der nach
  // Art. 226 Nr. 11a MwSt-RL vorgesehene Begriff gehoert in den Titel.
  assert.match(RECHNUNG_TEXTE.de['steuer.reverseCharge.titel'], /Steuerschuldnerschaft des Leistungsempfängers/);
  assert.match(RECHNUNG_TEXTE.en['steuer.reverseCharge.titel'], /liability of the recipient/i);
  for (const sprache of INVOICE_LANGUAGES) {
    const titel = RECHNUNG_TEXTE[sprache]['steuer.reverseCharge.titel'];
    assert.doesNotMatch(titel, /steuerfrei/i, `${sprache}: der Titel behauptet eine Befreiung`);
    assert.doesNotMatch(titel, /VAT-exempt/i, `${sprache}: der Titel behauptet eine Befreiung`);
  }
});

test('Katalog: die UID-Zeile gilt fuer Reverse Charge UND ig. Lieferung', () => {
  // Beide brauchen beide UID-Nummern auf der Rechnung: § 11 Abs. 1a bzw.
  // Art. 11 Abs. 2 UStG. Ein gemeinsamer Text, damit es nur eine Form gibt.
  for (const sprache of INVOICE_LANGUAGES) {
    const zeile = RECHNUNG_TEXTE[sprache]['steuer.uidZeile'];
    assert.ok(zeile.includes('{verkaeufer}') && zeile.includes('{kaeufer}'), sprache);
    assert.ok(RECHNUNG_TEXTE[sprache]['steuer.igLieferung.titel'].length > 0, sprache);
  }
});

test('Katalog: jeder Gutschrift-Grund des Vertrags hat einen Text', async () => {
  const { CREDIT_NOTE_REASONS } = await import('../src/rechnung/vertrag.js');
  for (const grund of CREDIT_NOTE_REASONS) assert.ok(`gutschrift.grund.${grund}` in RECHNUNG_TEXTE.de, grund);
});

test('rechnungText: setzt Werte ein und wirft bei fehlendem Wert', () => {
  assert.equal(rechnungText('en', 'pdf.summe.umsatzsteuer', { satz: 20 }), 'VAT 20%');
  assert.equal(rechnungText('de', 'kopie.rechnung', { nummer: '2026-0042', datum: '15.09.2026' }),
    'Übersetzung – keine eigene Rechnung · Original: Rechnung Nr. 2026-0042 vom 15.09.2026');
  assert.throws(() => rechnungText('de', 'pdf.summe.umsatzsteuer'), /satz/);
});

test('Golden: der Katalog steht in fixtures/rechnung-texte.json', () => {
  const datei = JSON.parse(readFileSync(new URL('../../fixtures/rechnung-texte.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const veraltet = 'fixtures/rechnung-texte.json ist veraltet — `npm run fixtures:rechnungstexte` ausfuehren';
  assert.deepEqual(datei.texte, RECHNUNG_TEXTE, veraltet);
  assert.equal(datei.version, pkg.version, veraltet);
  assert.deepEqual(datei.sprachen, [...INVOICE_LANGUAGES], veraltet);
  assert.deepEqual(datei.einheiten, RECHNUNG_EINHEITEN_CODES, veraltet);
});

test('Katalog: jede Einheit hat Kuerzel und Namen in jeder Sprache', () => {
  for (const sprache of INVOICE_LANGUAGES) {
    for (const einheit of INVOICE_UNITS) {
      assert.ok(`einheit.${einheit}` in RECHNUNG_TEXTE[sprache], `${sprache}: Kuerzel fuer ${einheit} fehlt`);
      assert.ok(`einheitName.${einheit}` in RECHNUNG_TEXTE[sprache], `${sprache}: Name fuer ${einheit} fehlt`);
    }
  }
  assert.equal(RECHNUNG_TEXTE.de['einheit.piece'], 'Stk');
  assert.equal(RECHNUNG_TEXTE.en['einheit.piece'], 'pcs');
});
