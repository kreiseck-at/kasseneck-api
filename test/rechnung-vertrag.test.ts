import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUFRUFE } from '../src/client/aufrufe.js';
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

test('Vertrag: jeder Rechnungs-Aufruf steht in der Aufrufliste des Pakets', () => {
  const bekannt = new Set<string>(AUFRUFE);
  for (const aufruf of RECHNUNG_AUFRUFE) assert.ok(bekannt.has(aufruf), `${aufruf} fehlt in AUFRUFE`);
});

// ---- Schema-Datei (erzeugt von scripts/rechnung-vertrag.mjs) ----------------

const veraltet = 'fixtures/rechnung-api.schema.json ist veraltet — `npm run fixtures:rechnung` ausfuehren';
const schemaDatei = new URL('../../fixtures/rechnung-api.schema.json', import.meta.url);
const beispielOrdner = new URL('../../fixtures/rechnung-api-beispiele/', import.meta.url);

interface SchemaKnoten {
  type?: string;
  properties?: Record<string, SchemaKnoten>;
  required?: string[];
  additionalProperties?: boolean | SchemaKnoten;
  items?: SchemaKnoten;
  propertyNames?: unknown;
  [schluessel: string]: unknown;
}

/** Jede Objektebene mit festen Feldern muss unbekannte Felder abweisen. */
function offeneObjekte(knoten: SchemaKnoten, pfad: string): string[] {
  const raus: string[] = [];
  if (knoten.type === 'object' && knoten.properties) {
    if (knoten.additionalProperties !== false) raus.push(pfad || '(Wurzel)');
    for (const [name, kind] of Object.entries(knoten.properties)) raus.push(...offeneObjekte(kind, pfad ? `${pfad}.${name}` : name));
  }
  if (knoten.type === 'array' && knoten.items) raus.push(...offeneObjekte(knoten.items, `${pfad}[]`));
  return raus;
}

test('Schema: Datei existiert, nennt die Paketversion und genau die Aufrufe des Vertrags', () => {
  const s = JSON.parse(readFileSync(schemaDatei, 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(s.paket, pkg.version, veraltet);
  assert.equal(s.version, RECHNUNG_VERTRAG_VERSION, veraltet);
  assert.deepEqual(Object.keys(s.aufrufe), [...RECHNUNG_AUFRUFE], veraltet);
  assert.deepEqual(s.codes, [...INVOICE_ERROR_CODES], veraltet);
  assert.deepEqual(s.gruende, [...CREDIT_NOTE_REASONS], veraltet);
});

test('Schema: jede Objektebene weist unbekannte Felder ab', () => {
  const s = JSON.parse(readFileSync(schemaDatei, 'utf8'));
  for (const [aufruf, eintrag] of Object.entries(s.aufrufe as Record<string, { anfrage: SchemaKnoten }>)) {
    assert.deepEqual(offeneObjekte(eintrag.anfrage, ''), [], `${aufruf}: offene Objektebene`);
  }
});

test('Schema: Feldpfade stimmen mit vertrag.ts ueberein (Erzeuger nicht vergessen)', () => {
  const s = JSON.parse(readFileSync(schemaDatei, 'utf8'));
  const ausSchema = (knoten: SchemaKnoten, vorsilbe = ''): string[] => Object.entries(knoten.properties ?? {}).flatMap(([name, kind]) => {
    const pfad = vorsilbe + name;
    if (kind.type === 'object' && kind.properties) return [pfad, ...ausSchema(kind, pfad + '.')];
    if (kind.type === 'array' && kind.items?.type === 'object') return [pfad, ...ausSchema(kind.items, pfad + '[].')];
    return [pfad];
  });
  for (const aufruf of RECHNUNG_AUFRUFE) {
    assert.deepEqual(ausSchema(s.aufrufe[aufruf].anfrage), pfade(RECHNUNG_ANFRAGEN[aufruf]), `${veraltet} (${aufruf})`);
  }
});

test('Beispiele: jede Datei nennt einen bekannten Aufruf und eine vollstaendige Erwartung', () => {
  const dateien = readdirSync(beispielOrdner).filter((d) => d.endsWith('.json')).sort();
  assert.ok(dateien.length >= 12, 'zu wenige Beispiele — dann prueft das Backend kaum etwas');
  const bekannt = new Set<string>(RECHNUNG_AUFRUFE);
  const codes = new Set<string>(INVOICE_ERROR_CODES);
  let gute = 0;
  let schlechte = 0;
  for (const datei of dateien) {
    const b = JSON.parse(readFileSync(new URL(datei, beispielOrdner), 'utf8'));
    assert.ok(bekannt.has(b.aufruf), `${datei}: unbekannter Aufruf ${b.aufruf}`);
    assert.equal(typeof b.anfrage, 'object', `${datei}: anfrage fehlt`);
    if (b.erwartet.ok === true) gute += 1;
    else {
      schlechte += 1;
      assert.ok(codes.has(b.erwartet.code), `${datei}: unbekannter Code ${b.erwartet.code}`);
      assert.ok(Array.isArray(b.erwartet.fields) && b.erwartet.fields.length > 0, `${datei}: fields fehlt`);
    }
  }
  assert.ok(gute > 0 && schlechte > 0, 'Beispiele brauchen gueltige UND ungueltige Anfragen');
});

test('Vertrag: Rechnungsdatum, Nummer und Status sind nicht setzbar', () => {
  const felder = pfade(RECHNUNG_ANFRAGEN.issueInvoice);
  for (const verboten of ['invoiceDate', 'number', 'status', 'docType', 'totals']) {
    assert.ok(!felder.includes(verboten), `issueInvoice darf ${verboten} nicht annehmen`);
  }
});
