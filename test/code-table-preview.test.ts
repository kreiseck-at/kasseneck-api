import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { CODE_TABLES, codeTablePreviewText, encodeForCodeTable, type CodeTableId } from '../src/printing/index.js';

/**
 * Die Vorschau im Drucker-Wizard: so steht ein Beispiel am Bon, wenn die
 * gewaehlte Zeile gilt. Gemeinsamer Prueffall mit dem Dart-Zwilling:
 * `fixtures/code-table-preview.json` (von Hand geschrieben, nicht erzeugt).
 */

interface Vorschau {
  sample: string[];
  tables: Record<CodeTableId, string>;
}
const FALL = JSON.parse(readFileSync(new URL('../../fixtures/code-table-preview.json', import.meta.url), 'utf8')) as Vorschau;

test('Vorschau: je Tabelle genau der Text aus dem gemeinsamen Prueffall', () => {
  assert.deepEqual(Object.keys(FALL.tables), CODE_TABLES.map((t) => t.id));
  for (const t of CODE_TABLES) assert.equal(codeTablePreviewText(t.id), FALL.tables[t.id], t.id);
});

test('Vorschau: fehlende Zeichen als Ersatzbuchstaben, vorhandene unveraendert', () => {
  assert.equal(codeTablePreviewText('pc437'), 'Käsekrainer 3,50 EUR\nTee 80°');
  assert.equal(codeTablePreviewText('replacement'), 'Kaesekrainer 3,50 EUR\nTee 80Grad');
  assert.equal(codeTablePreviewText('wpc1252'), FALL.sample.join('\n'));
});

test('Vorschau: dieselben Zeichen, die der Drucker mit der Tabelle wirklich bekommt', () => {
  // Die Vorschau zeigt nichts, was am Papier anders stuende: kodiert man sie
  // mit derselben Tabelle, kommen genau die Bytes des Beispiels heraus.
  for (const t of CODE_TABLES) {
    const bon = FALL.sample.map((z) => Array.from(encodeForCodeTable(z, t.id)));
    const vorschau = codeTablePreviewText(t.id).split('\n').map((z) => Array.from(encodeForCodeTable(z, t.id)));
    assert.deepEqual(vorschau, bon, t.id);
  }
});

test('Vorschau: unbekannte Tabelle wird gemeldet', () => {
  assert.throws(() => codeTablePreviewText('cp1252' as CodeTableId), /Unbekannte Code-Tabelle/);
});
