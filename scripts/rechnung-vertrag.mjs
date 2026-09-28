// Schreibt den Vertrag der Rechnungs-API als JSON Schema nach
// fixtures/rechnung-api.schema.json.
//
// Quelle ist src/invoice/vertrag.ts — die Datei hier liest nur ab und
// uebersetzt. Das Backend vergleicht das Schema in beide Richtungen mit seiner
// eigenen Pruefung, der Dart-Zwilling haelt eine byteweise Kopie. Wer ein Feld
// aendert, aendert es in vertrag.ts und laesst diesen Erzeuger laufen; eine
// Aenderung nur hier waere beim naechsten Lauf wieder weg.
//
// Formate ausserhalb des JSON-Schema-Standards (phone, vatId, country,
// shortCode) stehen trotzdem unter `format`: dort sind sie eine Anmerkung, die
// ein Validator ohne eigene Pruefung ueberliest. Nachkommastellen stehen unter
// `x-decimals` statt `multipleOf`, weil 0.001 als Gleitkommazahl nicht exakt
// darstellbar ist und Validatoren daran unterschiedlich scheitern.
//
// Aufruf: `npm run fixtures:rechnung` (bewusst, nie automatisch).
import { readFileSync, writeFileSync } from 'node:fs';
import * as rechnung from '../dist/esm/invoice/index.js';

function schema(feld) {
  switch (feld.type) {
    case 'string': {
      const s = { type: 'string' };
      if (feld.min !== undefined) s.minLength = feld.min;
      s.maxLength = feld.max;
      if (feld.format) s.format = feld.format;
      return s;
    }
    case 'integer':
      return { type: 'integer', minimum: feld.min, maximum: feld.max };
    case 'number': {
      const s = { type: 'number' };
      if (feld.exclusiveMin) s.exclusiveMinimum = feld.min;
      else s.minimum = feld.min;
      s.maximum = feld.max;
      s['x-decimals'] = feld.decimals;
      return s;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'enum':
      return { enum: [...feld.values] };
    case 'object':
      return objekt(feld.fields, feld.exactlyOne);
    case 'list':
      return { type: 'array', minItems: feld.min, maxItems: feld.max, items: schema(feld.item) };
    case 'map':
      return {
        type: 'object',
        maxProperties: feld.maxKeys,
        propertyNames: { pattern: feld.keyPattern },
        additionalProperties: { type: 'string', maxLength: feld.valueMax },
      };
    default:
      throw new Error(`Unbekannter Feldtyp: ${JSON.stringify(feld)}`);
  }
}

function objekt(felder, genauEins) {
  const properties = {};
  const required = [];
  for (const [name, feld] of Object.entries(felder)) {
    properties[name] = schema(feld);
    if (feld.required) required.push(name);
  }
  const s = { type: 'object', properties };
  if (required.length) s.required = required;
  // Genau eine der Gruppen (§ 9.1): `oneOf` trifft zu, wenn GENAU EIN
  // Unterschema passt -- fehlen beide Preise, passt keines; stehen beide da,
  // passen zwei. Beides ist ungueltig, und genau das ist gemeint.
  if (genauEins) s.oneOf = genauEins.map((gruppe) => ({ required: [...gruppe] }));
  s.additionalProperties = false;
  return s;
}

const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const aufrufe = {};
for (const name of rechnung.INVOICE_ENDPOINTS) {
  const eintrag = { request: objekt(rechnung.INVOICE_REQUESTS[name]) };
  const genauEins = rechnung.INVOICE_EXACTLY_ONE[name];
  if (genauEins) eintrag.exactlyOne = genauEins.map((gruppe) => [...gruppe]);
  const mindestensEins = rechnung.INVOICE_AT_LEAST_ONE[name];
  if (mindestensEins) eintrag.atLeastOne = mindestensEins.map((gruppe) => [...gruppe]);
  aufrufe[name] = eintrag;
}

const vertrag = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Kasseneck Rechnungs-API',
  version: rechnung.INVOICE_CONTRACT_VERSION,
  package: paket.version,
  endpoints: aufrufe,
  codes: [...rechnung.INVOICE_ERROR_CODES],
  creditNoteReasons: [...rechnung.CREDIT_NOTE_REASONS],
};

writeFileSync(
  new URL('../fixtures/rechnung-api.schema.json', import.meta.url),
  JSON.stringify(vertrag, null, 2) + '\n',
);
console.log('Rechnungs-Vertrag geschrieben:', Object.keys(aufrufe).length, 'Aufrufe,',
  vertrag.codes.length, 'Codes,', vertrag.creditNoteReasons.length, 'Gruende');
