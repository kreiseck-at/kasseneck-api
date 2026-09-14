// Schreibt den Vertrag der Rechnungs-API als JSON Schema nach
// fixtures/rechnung-api.schema.json.
//
// Quelle ist src/rechnung/vertrag.ts — die Datei hier liest nur ab und
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
import * as rechnung from '../dist/esm/rechnung/index.js';

function schema(feld) {
  switch (feld.typ) {
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
      if (feld.exklusivMin) s.exclusiveMinimum = feld.min;
      else s.minimum = feld.min;
      s.maximum = feld.max;
      s['x-decimals'] = feld.nachkomma;
      return s;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'enum':
      return { enum: [...feld.werte] };
    case 'object':
      return objekt(feld.felder);
    case 'list':
      return { type: 'array', minItems: feld.min, maxItems: feld.max, items: schema(feld.eintrag) };
    case 'map':
      return {
        type: 'object',
        maxProperties: feld.maxSchluessel,
        propertyNames: { pattern: feld.schluesselMuster },
        additionalProperties: { type: 'string', maxLength: feld.wertMax },
      };
    default:
      throw new Error(`Unbekannter Feldtyp: ${JSON.stringify(feld)}`);
  }
}

function objekt(felder) {
  const properties = {};
  const required = [];
  for (const [name, feld] of Object.entries(felder)) {
    properties[name] = schema(feld);
    if (feld.pflicht) required.push(name);
  }
  const s = { type: 'object', properties };
  if (required.length) s.required = required;
  s.additionalProperties = false;
  return s;
}

const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const aufrufe = {};
for (const name of rechnung.RECHNUNG_AUFRUFE) {
  const eintrag = { anfrage: objekt(rechnung.RECHNUNG_ANFRAGEN[name]) };
  const genauEins = rechnung.RECHNUNG_GENAU_EINS[name];
  if (genauEins) eintrag.genauEins = genauEins.map((gruppe) => [...gruppe]);
  const mindestensEins = rechnung.RECHNUNG_MINDESTENS_EINS[name];
  if (mindestensEins) eintrag.mindestensEins = mindestensEins.map((gruppe) => [...gruppe]);
  aufrufe[name] = eintrag;
}

const vertrag = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Kasseneck Rechnungs-API',
  version: rechnung.RECHNUNG_VERTRAG_VERSION,
  paket: paket.version,
  aufrufe,
  codes: [...rechnung.INVOICE_ERROR_CODES],
  gruende: [...rechnung.CREDIT_NOTE_REASONS],
};

writeFileSync(
  new URL('../fixtures/rechnung-api.schema.json', import.meta.url),
  JSON.stringify(vertrag, null, 2) + '\n',
);
console.log('Rechnungs-Vertrag geschrieben:', Object.keys(aufrufe).length, 'Aufrufe,',
  vertrag.codes.length, 'Codes,', vertrag.gruende.length, 'Gruende');
