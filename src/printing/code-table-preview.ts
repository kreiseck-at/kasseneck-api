/**
 * Die Vorschau im Drucker-Wizard: nach der Wahl einer Zeile zeigt der
 * Bildschirm ein Beispiel so, wie es mit dieser Tabelle am Bon steht. Wer
 * Zeile 4 (PC437) waehlt, sieht „3,50 EUR“ statt „3,50 €“, bevor er
 * uebernimmt. Gemeinsamer Prueffall mit dem Dart-Zwilling:
 * `fixtures/code-table-preview.json`.
 */
import { codeTableById, type CodeTableId } from './code-tables.js';
import { escPosPrintableText } from './printable.js';

/** Das Beispiel: Umlaut, €, °. */
const BEISPIEL = ['Käsekrainer 3,50 €', 'Tee 80°'] as const;

/**
 * Das Beispiel mit den Ersetzungen der Tabelle, Zeilen durch `\n` getrennt:
 * fehlt der Tabelle ein Zeichen, stehen seine Ersatzbuchstaben da
 * (`pc437` -> „Käsekrainer 3,50 EUR“, `replacement` -> „Kaesekrainer 3,50 EUR“).
 * Eine unbekannte Kennung wird gemeldet.
 */
export function codeTablePreviewText(table: CodeTableId): string {
  codeTableById(table);
  return BEISPIEL.map((zeile) => escPosPrintableText(zeile, table)).join('\n');
}
