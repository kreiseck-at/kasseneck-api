import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CREDIT_NOTE_REASONS,
  INVOICE_ERROR_CODES,
  POSITION_FELDER,
  RECHNUNG_ANFRAGEN,
  RECHNUNG_AUFRUFE,
  RECHNUNG_VERTRAG_VERSION,
  type Feld,
} from '../src/rechnung/vertrag.js';

// Woerter, die nach aussen nichts verloren haben: die Schnittstelle spricht
// Englisch (siehe api-vokabular im Backend). Ein deutscher Feldname faellt hier
// auf, nicht erst beim Fremdsystem.
const DEUTSCH = ['kunde', 'rechnung', 'betrag', 'grund', 'notiz', 'menge', 'preis', 'datum', 'steuer'];

/** Alle Feldpfade einer Anfrage, rekursiv — Listen als `name[]`. */
function pfade(felder: Record<string, Feld>, vorsilbe = ''): string[] {
  const raus: string[] = [];
  for (const [name, feld] of Object.entries(felder)) {
    const pfad = vorsilbe + name;
    raus.push(pfad);
    if (feld.typ === 'object') raus.push(...pfade(feld.felder, pfad + '.'));
    if (feld.typ === 'list' && feld.eintrag.typ === 'object') raus.push(...pfade(feld.eintrag.felder, pfad + '[].'));
  }
  return raus;
}

test('Vertrag: Version 1', () => {
  assert.equal(RECHNUNG_VERTRAG_VERSION, 1);
});

test('Vertrag: jeder Aufruf hat eine Anfragebeschreibung und keine darueber hinaus', () => {
  assert.deepEqual(Object.keys(RECHNUNG_ANFRAGEN).sort(), [...RECHNUNG_AUFRUFE].sort());
});

test('Vertrag: Positionen von Rechnung und Gutschrift sind dieselbe Beschreibung', () => {
  for (const aufruf of ['issueInvoice', 'createCreditNote'] as const) {
    const items = RECHNUNG_ANFRAGEN[aufruf]['items'];
    assert.ok(items && items.typ === 'list', `${aufruf}.items fehlt`);
    assert.equal(items.eintrag.typ, 'object');
    assert.equal(items.eintrag.typ === 'object' ? items.eintrag.felder : null, POSITION_FELDER);
  }
});

test('Vertrag: kein Feldname ist deutsch', () => {
  for (const [aufruf, felder] of Object.entries(RECHNUNG_ANFRAGEN)) {
    for (const pfad of pfade(felder)) {
      const klein = pfad.toLowerCase();
      assert.ok(!/[äöüß]/.test(klein), `${aufruf}: ${pfad} enthaelt Umlaute`);
      for (const wort of DEUTSCH) assert.ok(!klein.includes(wort), `${aufruf}: ${pfad} enthaelt "${wort}"`);
    }
  }
});

test('Vertrag: Fehlercodes und Gruende sind eindeutige Bezeichner', () => {
  for (const liste of [INVOICE_ERROR_CODES, CREDIT_NOTE_REASONS]) {
    assert.equal(new Set(liste).size, liste.length);
    for (const code of liste) assert.match(code, /^[a-z]+(_[a-z]+)*$/);
  }
});

test('Vertrag: Betraege sind ganze Cent, nie Kommazahlen', () => {
  const preis = POSITION_FELDER['unitPriceCents'];
  assert.ok(preis && preis.typ === 'integer' && preis.pflicht);
  assert.equal(preis.typ === 'integer' ? preis.min : undefined, 0);
});

test('Vertrag: idempotencyKey ist Pflicht bei allem, was eine Rechnung erzeugt', () => {
  for (const aufruf of ['issueInvoice', 'cancelInvoice', 'createCreditNote'] as const) {
    const key = RECHNUNG_ANFRAGEN[aufruf]['idempotencyKey'];
    assert.ok(key && key.pflicht, `${aufruf}.idempotencyKey muss Pflicht sein`);
  }
});

test('Vertrag: Rechnungsdatum, Nummer und Status sind nicht setzbar', () => {
  const felder = pfade(RECHNUNG_ANFRAGEN.issueInvoice);
  for (const verboten of ['invoiceDate', 'number', 'status', 'docType', 'totals']) {
    assert.ok(!felder.includes(verboten), `issueInvoice darf ${verboten} nicht annehmen`);
  }
});
