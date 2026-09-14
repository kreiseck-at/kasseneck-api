import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { escPosLayoutBytes, type ReceiptLayout } from '../src/receipt/index.js';
import { createEscPosDocument, escPosBytes, escPosQrCode } from '../src/printing/index.js';

/**
 * Bestandsschutz: **ohne ausdrueckliche Wahl aendert sich kein Byte.**
 *
 * Die Modulgroessen-Rechnung darf den Bon eines Geraets, an dem niemand etwas
 * eingestellt hat, nicht anfassen — weder groesser noch kleiner. Der einzige
 * Fall, in dem sie eingreifen darf, ist der, in dem heute **gar kein** QR
 * herauskommt (Symbol breiter als das Papier; der Drucker schneidet nicht ab,
 * er laesst weg).
 *
 * Deshalb haengen hier feste SHA-256 ueber den **gesamten** Bytestrom eines
 * Belegs. Wer sie anfasst, aendert das Druckbild jedes Bestandsgeraets.
 *
 * 0.14.0 hat den Bestand bewusst geaendert (Beleg-Blatt, Ruling 11 und 12):
 * `auto` deckelt wie im Dart-Zwilling bei 6 statt 4, und der native QR-Befehl
 * setzt Fehlerkorrektur M statt L. Die Werte vom Stand 0.8.0 bleiben als
 * Beweis stehen: mit `klein` und `L` kommt Byte fuer Byte der alte Strom
 * heraus -- die neuen Werte unterscheiden sich also nur in diesen zwei Punkten.
 */

const wurzel = new URL('../../fixtures/', import.meta.url);
const erwartet = (name: string): ReceiptLayout =>
  JSON.parse(readFileSync(new URL(`erwartet/${name}.lines.json`, wurzel), 'utf8')) as ReceiptLayout;

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

test('Bestandsschutz: Beleg auf 58 mm ist byteidentisch zum zugesagten Stand', () => {
  const layout = { ...erwartet('verkauf-bar'), paperSize: 'mm58' as const };
  assert.equal(
    digest(escPosLayoutBytes(layout)),
    // Ruling 11/12: QR mit 6 Punkten je Modul und Korrektur M (vorher 00be1eff…, 4 Punkte, L).
    '16c5b606c57b4e9fa5157258026d3416a80e57394b48fceb3a9de5d3179206b1',
  );
  // Der alte Strom (Stand 0.8.0) ist weiter erreichbar: `klein` + `L`.
  assert.equal(
    digest(escPosLayoutBytes(layout, { qrGroesse: 'klein', qrCorrection: 'L' })),
    '00be1effb300ecae1ddade6de0cf72be33f3933ad582c5ccf5f95bb8b27e38a6',
  );
});

test('Bestandsschutz: Beleg auf 80 mm ist byteidentisch zum zugesagten Stand', () => {
  const layout = { ...erwartet('verkauf-bar'), paperSize: 'mm80' as const };
  assert.equal(
    digest(escPosLayoutBytes(layout)),
    // Ruling 11/12: QR mit 6 Punkten je Modul und Korrektur M (vorher e8edc30e…, 4 Punkte, L).
    'e2424f0326fddf1a09babf807637e81448ca980c1da982566606ac1142f828e8',
  );
  // Der alte Strom (Stand 0.8.0) ist weiter erreichbar: `klein` + `L`.
  assert.equal(
    digest(escPosLayoutBytes(layout, { qrGroesse: 'klein', qrCorrection: 'L' })),
    'e8edc30e61d3867f42f0278f890e482abf3e46c9157ee2e30b10b8698dcabc1b',
  );
});

/**
 * Der schaerfere der beiden Faelle: hier passt rechnerisch mehr, als `auto`
 * zulaesst. Auf 80 mm liesse die Rechnung fuer diesen QR 9 Punkte je Modul zu
 * — gedruckt werden 6, weil `auto` in diesem Paket dasselbe heisst wie im
 * Dart-Zwilling: hoechstens 6 (Ruling 11; bis 0.13 hier 4). Faellt der Deckel
 * oder weicht er vom Zwilling ab, faellt dieser Test.
 */
test('Bestandsschutz: auto heisst wie im Dart-Zwilling hoechstens 6 -- der nackte QR-Befehl druckt auf beiden Papierbreiten Groesse 6', () => {
  for (const paperSize of ['mm58', 'mm80'] as const) {
    const doc = createEscPosDocument({ paperSize });
    escPosQrCode(doc, '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-13T10:15:30_5,00');
    const bytes = escPosBytes(doc);
    // Funktion 167 (Modulgroesse) steht als `GS ( k 03 00 31 43 n` im Strom.
    const i = bytes.findIndex(
      (_, k) =>
        bytes[k] === 0x1d && bytes[k + 1] === 0x28 && bytes[k + 2] === 0x6b &&
        bytes[k + 5] === 0x31 && bytes[k + 6] === 0x43,
    );
    assert.ok(i >= 0, `${paperSize}: Funktion 167 nicht gefunden`);
    // Ruling 11: auto = 6 wie im Dart-Zwilling (vorher 4).
    assert.equal(bytes[i + 7], 6, `${paperSize}: Modulgroesse abgewichen`);
  }
});
