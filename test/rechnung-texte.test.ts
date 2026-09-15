import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INVOICE_LANGUAGES } from '../src/rechnung/vertrag.js';
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
    if (neutral.has(s)) continue;
    assert.notEqual(RECHNUNG_TEXTE.en[s], RECHNUNG_TEXTE.de[s], `${s} ist nicht uebersetzt`);
  }
});

test('Katalog: Steuerhinweise nennen in jeder Sprache die Gesetzesstelle', () => {
  const stellen: RechnungTextSchluessel[] = ['steuer.kleinunternehmer', 'steuer.igLieferung', 'steuer.ausfuhr', 'steuer.reverseCharge.text',
    'einvoice.befreiung.kleinunternehmer', 'einvoice.befreiung.igLieferung', 'einvoice.befreiung.ausfuhr'];
  for (const sprache of INVOICE_LANGUAGES) {
    for (const s of stellen) assert.match(RECHNUNG_TEXTE[sprache][s], /UStG|2006\/112/, `${sprache}.${s} ohne Gesetzesstelle`);
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
});
