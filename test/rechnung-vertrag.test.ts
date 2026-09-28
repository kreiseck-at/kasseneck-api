import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ALL_CALLS } from '../src/client/aufrufe.js';
import { INVOICE_TEXTS, type InvoiceTextKey } from '../src/invoice/texte.js';
import {
  CREDIT_NOTE_REASONS,
  INVOICE_ERROR_CODES,
  INVOICE_LANGUAGES,
  INVOICE_NOTICE_CODES,
  INVOICE_PAYMENT_METHODS,
  REVERSE_CHARGE_REASONS,
  TAX_SCHEMES,
  INVOICE_UNITS,
  PAYMENT_FIELDS,
  CUSTOMER_FIELDS,
  INVOICE_UNIT_CODES,
  ITEM_FIELDS,
  ITEM_PRICE_EXACTLY_ONE,
  INVOICE_REQUESTS,
  INVOICE_ENDPOINTS,
  INVOICE_CONTRACT_VERSION,
  type Field,
} from '../src/invoice/vertrag.js';

// Woerter, die nach aussen nichts verloren haben: die Schnittstelle spricht
// Englisch (siehe api-vokabular im Backend). Ein deutscher Feldname faellt hier
// auf, nicht erst beim Fremdsystem.
const DEUTSCH = ['kunde', 'rechnung', 'betrag', 'grund', 'notiz', 'menge', 'preis', 'datum', 'steuer'];

/** Alle Feldpfade einer Anfrage, rekursiv — Listen als `name[]`. */
function pfade(felder: Record<string, Field>, vorsilbe = ''): string[] {
  const raus: string[] = [];
  for (const [name, feld] of Object.entries(felder)) {
    const pfad = vorsilbe + name;
    raus.push(pfad);
    if (feld.type === 'object') raus.push(...pfade(feld.fields, pfad + '.'));
    if (feld.type === 'list' && feld.item.type === 'object') raus.push(...pfade(feld.item.fields, pfad + '[].'));
  }
  return raus;
}

test('Vertrag: Version 2 (englische Werte und Schluessel ab 1.0)', () => {
  assert.equal(INVOICE_CONTRACT_VERSION, 2);
});

test('Vertrag: jeder Aufruf hat eine Anfragebeschreibung und keine darueber hinaus', () => {
  assert.deepEqual(Object.keys(INVOICE_REQUESTS).sort(), [...INVOICE_ENDPOINTS].sort());
});

test('Vertrag: Positionen von Rechnung und Gutschrift sind dieselbe Beschreibung', () => {
  for (const aufruf of ['issueInvoice', 'createCreditNote'] as const) {
    const items = INVOICE_REQUESTS[aufruf]['items'];
    assert.ok(items && items.type === 'list', `${aufruf}.items fehlt`);
    assert.equal(items.item.type, 'object');
    assert.equal(items.item.type === 'object' ? items.item.fields : null, ITEM_FIELDS);
  }
});

test('Vertrag: kein Feldname ist deutsch', () => {
  for (const [aufruf, felder] of Object.entries(INVOICE_REQUESTS)) {
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

test('Vertrag: Betraege sind ganze Zahlen, nie Kommazahlen', () => {
  for (const name of ['unitPriceCents', 'unitPriceMicros'] as const) {
    const preis = ITEM_FIELDS[name];
    assert.ok(preis && preis.type === 'integer', `${name} muss ganzzahlig sein`);
    assert.equal(preis.type === 'integer' ? preis.min : undefined, 0, `${name}.min`);
  }
});

// § 9.1: genau eines der beiden Preisfelder. Als zwei PFLICHTfelder liesse
// sich das nicht ausdruecken, als zwei optionale waere eine Position ohne
// Preis gueltig -- darum sind beide optional UND in der Genau-eins-Regel.
test('Vertrag: der Preis einer Position ist Cent ODER Mikro-Euro', () => {
  for (const name of ['unitPriceCents', 'unitPriceMicros'] as const) {
    assert.equal(ITEM_FIELDS[name]?.required, false, `${name} darf nicht Pflicht sein`);
  }
  assert.deepEqual(
    ITEM_PRICE_EXACTLY_ONE.map((g) => [...g]),
    [['unitPriceCents'], ['unitPriceMicros']],
  );
});

// Derselbe Bereich, nur feiner aufgeloest: 10^12 Mikro-Euro und 10^8 Cent
// sind beide 10.000.000,00 €. Eine andere Obergrenze waere eine stille
// Bereichsaenderung je nachdem, welches Feld ein Kunde benutzt.
test('Vertrag: beide Preisfelder decken denselben Betragsbereich', () => {
  const cents = ITEM_FIELDS['unitPriceCents'];
  const micros = ITEM_FIELDS['unitPriceMicros'];
  assert.ok(cents?.type === 'integer' && micros?.type === 'integer');
  if (cents.type !== 'integer' || micros.type !== 'integer') return;
  assert.equal(micros.max, cents.max * 10_000);
});

test('Vertrag: die Menge reicht bis 10^9 (passend zu quantityMilli)', () => {
  const menge = ITEM_FIELDS['quantity'];
  assert.ok(menge?.type === 'number');
  if (menge.type !== 'number') return;
  assert.equal(menge.max, 1_000_000_000);
  assert.equal(menge.decimals, 3);
});

test('Vertrag: idempotencyKey ist Pflicht bei allem, was eine Rechnung erzeugt', () => {
  for (const aufruf of ['issueInvoice', 'cancelInvoice', 'createCreditNote'] as const) {
    const key = INVOICE_REQUESTS[aufruf]['idempotencyKey'];
    assert.ok(key && key.required, `${aufruf}.idempotencyKey muss Pflicht sein`);
  }
});

test('Vertrag: jeder Rechnungs-Aufruf steht in der Aufrufliste des Pakets', () => {
  const bekannt = new Set<string>(ALL_CALLS);
  for (const aufruf of INVOICE_ENDPOINTS) assert.ok(bekannt.has(aufruf), `${aufruf} fehlt in ALL_CALLS`);
});

// ---- Schema-Datei (erzeugt von scripts/rechnung-vertrag.mjs) ----------------

const veraltet = 'fixtures/invoice-api.schema.json ist veraltet — `npm run fixtures:rechnung` ausfuehren';
const schemaDatei = new URL('../../fixtures/invoice-api.schema.json', import.meta.url);
const beispielOrdner = new URL('../../fixtures/invoice-api-examples/', import.meta.url);

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
  assert.equal(s.package, pkg.version, veraltet);
  assert.equal(s.version, INVOICE_CONTRACT_VERSION, veraltet);
  assert.deepEqual(Object.keys(s.endpoints), [...INVOICE_ENDPOINTS], veraltet);
  assert.deepEqual(s.codes, [...INVOICE_ERROR_CODES], veraltet);
  assert.deepEqual(s.creditNoteReasons, [...CREDIT_NOTE_REASONS], veraltet);
});

test('Schema: jede Objektebene weist unbekannte Felder ab', () => {
  const s = JSON.parse(readFileSync(schemaDatei, 'utf8'));
  for (const [aufruf, eintrag] of Object.entries(s.endpoints as Record<string, { request: SchemaKnoten }>)) {
    assert.deepEqual(offeneObjekte(eintrag.request, ''), [], `${aufruf}: offene Objektebene`);
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
  for (const aufruf of INVOICE_ENDPOINTS) {
    assert.deepEqual(ausSchema(s.endpoints[aufruf].request), pfade(INVOICE_REQUESTS[aufruf]), `${veraltet} (${aufruf})`);
  }
});

test('Beispiele: jede Datei nennt einen bekannten Aufruf und eine vollstaendige Erwartung', () => {
  const dateien = readdirSync(beispielOrdner).filter((d) => d.endsWith('.json')).sort();
  assert.ok(dateien.length >= 12, 'zu wenige Beispiele — dann prueft das Backend kaum etwas');
  const bekannt = new Set<string>(INVOICE_ENDPOINTS);
  const codes = new Set<string>(INVOICE_ERROR_CODES);
  let gute = 0;
  let schlechte = 0;
  for (const datei of dateien) {
    const b = JSON.parse(readFileSync(new URL(datei, beispielOrdner), 'utf8'));
    assert.ok(bekannt.has(b.endpoint), `${datei}: unbekannter Aufruf ${b.endpoint}`);
    assert.equal(typeof b.request, 'object', `${datei}: request fehlt`);
    if (b.expected.ok === true) gute += 1;
    else {
      schlechte += 1;
      assert.ok(codes.has(b.expected.code), `${datei}: unbekannter Code ${b.expected.code}`);
      assert.ok(Array.isArray(b.expected.fields) && b.expected.fields.length > 0, `${datei}: fields fehlt`);
    }
  }
  assert.ok(gute > 0 && schlechte > 0, 'Beispiele brauchen gueltige UND ungueltige Anfragen');
});

test('Vertrag: Rechnungsdatum, Nummer und Status sind nicht setzbar', () => {
  const felder = pfade(INVOICE_REQUESTS.issueInvoice);
  for (const verboten of ['invoiceDate', 'number', 'status', 'docType', 'totals']) {
    assert.ok(!felder.includes(verboten), `issueInvoice darf ${verboten} nicht annehmen`);
  }
});

// ---- Sprache und Marke (0.17.0) ----------------------------------------------

test('Vertrag: Sprachen de und en, Deutsch zuerst', () => {
  assert.deepEqual([...INVOICE_LANGUAGES], ['de', 'en']);
});

test('Vertrag: Sprache am Kunden und an der Rechnung, Marke an der Rechnung, Sprache fuer die PDF-Kopie', () => {
  assert.deepEqual(CUSTOMER_FIELDS['language'], { type: 'enum', required: false, values: INVOICE_LANGUAGES });
  assert.deepEqual(INVOICE_REQUESTS.issueInvoice['language'], { type: 'enum', required: false, values: INVOICE_LANGUAGES });
  assert.deepEqual(INVOICE_REQUESTS.issueInvoice['brandId'], { type: 'string', required: false, min: 1, max: 128 });
  assert.deepEqual(INVOICE_REQUESTS.getInvoicePdf['language'], { type: 'enum', required: false, values: INVOICE_LANGUAGES });
  assert.deepEqual(INVOICE_REQUESTS.listBrands, {});
});

test('Vertrag: neue Codes am Ende, bestehende Reihenfolge unveraendert', () => {
  // Angehaengt wird hinten: ein Fremdsystem, das die Liste als Reihenfolge
  // gespeichert hat, behaelt seine Zuordnung. Die sechs vor 0.23.0 stehen an
  // derselben Stelle wie zuvor, die beiden neuen (0.23.0) hinten dran.
  assert.deepEqual(INVOICE_ERROR_CODES.slice(-8, -2), [
    'tax_scheme_mismatch', 'vat_rate_not_in_country', 'reverse_charge_reason_required',
    'reverse_charge_threshold', 'mixed_supply_not_allowed', 'oss_not_enabled',
  ]);
  assert.deepEqual(INVOICE_ERROR_CODES.slice(-2), ['einvoice_unavailable', 'amount_too_large']);
  assert.equal(INVOICE_ERROR_CODES[0], 'validation');
});

test('Vertrag: listBrands ist Aufruf der Rechnungs-API und des Clients', () => {
  assert.ok((INVOICE_ENDPOINTS as readonly string[]).includes('listBrands'));
  assert.ok((ALL_CALLS as readonly string[]).includes('listBrands'));
});

test('Vertrag: recordInvoicePayment ist Aufruf der Rechnungs-API und des Clients', () => {
  assert.ok((INVOICE_ENDPOINTS as readonly string[]).includes('recordInvoicePayment'));
  assert.ok((ALL_CALLS as readonly string[]).includes('recordInvoicePayment'));
});

test('Vertrag: Zahlung nimmt nur bekannte Arten, der Betrag ist optional und ganzzahlig', () => {
  assert.deepEqual([...INVOICE_PAYMENT_METHODS], ['transfer', 'card', 'online', 'cash']);
  const felder = INVOICE_REQUESTS.recordInvoicePayment;
  assert.deepEqual(felder['method'], { type: 'enum', required: true, values: INVOICE_PAYMENT_METHODS });
  // Ohne Betrag gilt das volle Brutto; 0 Cent waere keine Zahlung.
  assert.deepEqual(felder['amountCents'], { type: 'integer', required: false, min: 1, max: 100_000_000 });
  assert.equal(felder['idempotencyKey']?.required, true, 'ohne Schluessel bucht eine Wiederholung zweimal');
  assert.equal(felder['invoiceId']?.required, true);
  // Am Ausstellen haengt derselbe Block, damit es nur eine Form gibt.
  assert.deepEqual(Object.keys(PAYMENT_FIELDS), ['method', 'amountCents', 'paidAt', 'reference', 'onSite']);
  const zahlung = INVOICE_REQUESTS.issueInvoice['payment'];
  assert.equal(zahlung?.type, 'object');
  assert.equal(zahlung?.type === 'object' ? zahlung.fields : null, PAYMENT_FIELDS);
});

test('Vertrag: der Steuerfall ist optional, der Grund gehoert zum Inlands-RC', () => {
  // Der Server leitet ab; eine Angabe wird geprueft. Pflicht waere ein
  // Rueckschritt: dann muesste das Fremdsystem den Fall wieder selbst kennen.
  assert.equal(INVOICE_REQUESTS.issueInvoice['taxScheme']?.required, false);
  assert.equal(INVOICE_REQUESTS.issueInvoice['reverseChargeReason']?.required, false);
  assert.ok((TAX_SCHEMES as readonly string[]).includes('domesticReverseCharge'));
  assert.ok((TAX_SCHEMES as readonly string[]).includes('oss'));
  assert.ok((TAX_SCHEMES as readonly string[]).includes('outsideScope'));
  // Neue Faelle stehen hinten — gespeicherte Reihenfolgen bleiben gueltig.
  assert.deepEqual(TAX_SCHEMES.slice(0, 5), ['normal', 'smallBusiness', 'reverseCharge', 'intraCommunitySupply', 'exportThirdCountry']);
});

test('Vertrag: jeder Reverse-Charge-Grund nennt Stelle, Schwelle und Aufdruck', () => {
  const gruende = Object.keys(REVERSE_CHARGE_REASONS) as (keyof typeof REVERSE_CHARGE_REASONS)[];
  assert.ok(gruende.length >= 11);
  for (const g of gruende) {
    const eintrag = REVERSE_CHARGE_REASONS[g];
    assert.match(eintrag.legalBasis, /§|BGBl/, `${g} ohne Fundstelle`);
    assert.ok(eintrag.thresholdCents === null || eintrag.thresholdCents > 0, g);
    for (const sprache of INVOICE_LANGUAGES) {
      const text = INVOICE_TEXTS[sprache][`tax.reverse_charge_reason.${g}` as InvoiceTextKey];
      assert.ok(text && text.length > 0, `${sprache}: Aufdruck fuer ${g} fehlt`);
      assert.match(text, /§|BGBl/, `${sprache}.${g}: der Aufdruck traegt den Hinweis und braucht die Stelle`);
    }
  }
  // Die beiden Geraete-Faelle tragen dieselbe Schwelle von 5.000 Euro.
  assert.equal(REVERSE_CHARGE_REASONS.mobile_devices.thresholdCents, 500_000);
  assert.equal(REVERSE_CHARGE_REASONS.it_devices.thresholdCents, 500_000);
});

test('Vertrag: Hinweise sind keine Fehler und tragen eigene Codes', () => {
  assert.deepEqual([...INVOICE_NOTICE_CODES], ['cash_receipt_required', 'recapitulative_statement_due', 'place_of_supply_check']);
  for (const code of INVOICE_NOTICE_CODES) {
    assert.ok(!(INVOICE_ERROR_CODES as readonly string[]).includes(code), `${code} steht faelschlich bei den Fehlern`);
  }
});

test('Vertrag: Einheiten sind Schluessel mit UN/ECE-Code, die Position nimmt nur sie an', () => {
  assert.ok(INVOICE_UNITS.length >= 45, 'der Katalog soll abdecken, was Betriebe abrechnen');
  assert.equal(new Set(INVOICE_UNITS).size, INVOICE_UNITS.length);
  for (const einheit of INVOICE_UNITS) assert.match(einheit, /^[a-z]+(_[a-z]+)*$/);
  assert.deepEqual(Object.keys(INVOICE_UNIT_CODES), [...INVOICE_UNITS]);
  for (const [einheit, code] of Object.entries(INVOICE_UNIT_CODES)) assert.match(code, /^[A-Z0-9]{2,3}$/, einheit);
  assert.equal(INVOICE_UNITS[0], 'piece');
  assert.deepEqual(ITEM_FIELDS['unit'], { type: 'enum', required: false, values: INVOICE_UNITS });
});
