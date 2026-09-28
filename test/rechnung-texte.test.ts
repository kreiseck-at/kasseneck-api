import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INVOICE_LANGUAGES, INVOICE_UNITS, INVOICE_UNIT_CODES } from '../src/rechnung/vertrag.js';
import { INVOICE_TEXTS, invoiceText, type InvoiceTextKey } from '../src/rechnung/texte.js';

const platzhalter = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort();
const schluessel = Object.keys(INVOICE_TEXTS.de) as InvoiceTextKey[];

test('Katalog: jede Sprache hat genau dieselben Schluessel', () => {
  const de = [...schluessel].sort();
  for (const sprache of INVOICE_LANGUAGES) assert.deepEqual(Object.keys(INVOICE_TEXTS[sprache]).sort(), de, sprache);
});

test('Katalog: kein leerer Text, dieselben Platzhalter je Schluessel', () => {
  for (const s of schluessel) {
    const erwartet = platzhalter(INVOICE_TEXTS.de[s]);
    for (const sprache of INVOICE_LANGUAGES) {
      const text = INVOICE_TEXTS[sprache][s];
      assert.ok(text.trim().length > 0, `${sprache}.${s} leer`);
      assert.deepEqual(platzhalter(text), erwartet, `${sprache}.${s}: Platzhalter weichen ab`);
    }
  }
});

test('Katalog: Englisch ist nicht einfach Deutsch (ausser neutrale Kuerzel)', () => {
  // Neutral sind nur Woerter, die in beiden Sprachen gleich lauten.
  const neutral = new Set<InvoiceTextKey>(['pdf.table.pos', 'pdf.payment.iban', 'pdf.payment.bic', 'pdf.status.link', 'payment_method.online', 'country.LI']);
  for (const s of schluessel) {
    // Kuerzel wie kg oder kWh sind international gleich; die Namen muessen uebersetzt sein.
    if (neutral.has(s) || s.startsWith('unit_symbol.')) continue;
    assert.notEqual(INVOICE_TEXTS.en[s], INVOICE_TEXTS.de[s], `${s} ist nicht uebersetzt`);
  }
});

test('Katalog: Steuerhinweise nennen in jeder Sprache die Gesetzesstelle', () => {
  const stellen: InvoiceTextKey[] = ['tax.small_business', 'tax.intra_community_supply.text', 'tax.export_third_country', 'tax.reverse_charge.text',
    'einvoice.exemption.small_business', 'einvoice.exemption.intra_community_supply', 'einvoice.exemption.export_third_country'];
  for (const sprache of INVOICE_LANGUAGES) {
    for (const s of stellen) assert.match(INVOICE_TEXTS[sprache][s], /UStG|2006\/112/, `${sprache}.${s} ohne Gesetzesstelle`);
  }
});

test('Katalog: Reverse Charge behauptet keine Steuerbefreiung', () => {
  // Der Umsatz bleibt steuerpflichtig, nur die Steuer schuldet der Empfaenger
  // (§ 11 Abs. 1a UStG). „Steuerfrei" waere sachlich falsch — und der nach
  // Art. 226 Nr. 11a MwSt-RL vorgesehene Begriff gehoert in den Titel.
  assert.match(INVOICE_TEXTS.de['tax.reverse_charge.title'], /Steuerschuldnerschaft des Leistungsempfängers/);
  assert.match(INVOICE_TEXTS.en['tax.reverse_charge.title'], /liability of the recipient/i);
  for (const sprache of INVOICE_LANGUAGES) {
    const titel = INVOICE_TEXTS[sprache]['tax.reverse_charge.title'];
    assert.doesNotMatch(titel, /steuerfrei/i, `${sprache}: der Titel behauptet eine Befreiung`);
    assert.doesNotMatch(titel, /VAT-exempt/i, `${sprache}: der Titel behauptet eine Befreiung`);
  }
});

test('Katalog: die UID-Zeile gilt fuer Reverse Charge UND ig. Lieferung', () => {
  // Beide brauchen beide UID-Nummern auf der Rechnung: § 11 Abs. 1a bzw.
  // Art. 11 Abs. 2 UStG. Ein gemeinsamer Text, damit es nur eine Form gibt.
  for (const sprache of INVOICE_LANGUAGES) {
    const zeile = INVOICE_TEXTS[sprache]['tax.vat_id_line'];
    assert.ok(zeile.includes('{verkaeufer}') && zeile.includes('{kaeufer}'), sprache);
    assert.ok(INVOICE_TEXTS[sprache]['tax.intra_community_supply.title'].length > 0, sprache);
  }
});

test('Katalog: jeder Gutschrift-Grund des Vertrags hat einen Text', async () => {
  const { CREDIT_NOTE_REASONS } = await import('../src/rechnung/vertrag.js');
  for (const grund of CREDIT_NOTE_REASONS) assert.ok(`credit_note.reason.${grund}` in INVOICE_TEXTS.de, grund);
});

test('invoiceText: setzt Werte ein und wirft bei fehlendem Wert', () => {
  assert.equal(invoiceText('en', 'pdf.totals.vat', { satz: 20 }), 'VAT 20%');
  assert.equal(invoiceText('de', 'copy.invoice', { nummer: '2026-0042', datum: '15.09.2026' }),
    'Übersetzung – keine eigene Rechnung · Original: Rechnung Nr. 2026-0042 vom 15.09.2026');
  assert.throws(() => invoiceText('de', 'pdf.totals.vat'), /satz/);
});

test('Golden: der Katalog steht in fixtures/rechnung-texte.json', () => {
  const datei = JSON.parse(readFileSync(new URL('../../fixtures/rechnung-texte.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const veraltet = 'fixtures/rechnung-texte.json ist veraltet — `npm run fixtures:rechnungstexte` ausfuehren';
  assert.deepEqual(datei.texte, INVOICE_TEXTS, veraltet);
  assert.equal(datei.version, pkg.version, veraltet);
  assert.deepEqual(datei.sprachen, [...INVOICE_LANGUAGES], veraltet);
  assert.deepEqual(datei.einheiten, INVOICE_UNIT_CODES, veraltet);
});

test('Katalog: jede Einheit hat Kuerzel und Namen in jeder Sprache', () => {
  for (const sprache of INVOICE_LANGUAGES) {
    for (const einheit of INVOICE_UNITS) {
      assert.ok(`unit_symbol.${einheit}` in INVOICE_TEXTS[sprache], `${sprache}: Kuerzel fuer ${einheit} fehlt`);
      assert.ok(`unit_name.${einheit}` in INVOICE_TEXTS[sprache], `${sprache}: Name fuer ${einheit} fehlt`);
    }
  }
  assert.equal(INVOICE_TEXTS.de['unit_symbol.piece'], 'Stk');
  assert.equal(INVOICE_TEXTS.en['unit_symbol.piece'], 'pcs');
});
