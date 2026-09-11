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
 * Belegs. Die Werte stammen vom Stand 0.8.0, also von vor dem Umbau. Wer sie
 * anfasst, aendert das Druckbild jedes Bestandsgeraets.
 */

const wurzel = new URL('../../fixtures/', import.meta.url);
const erwartet = (name: string): ReceiptLayout =>
  JSON.parse(readFileSync(new URL(`erwartet/${name}.lines.json`, wurzel), 'utf8')) as ReceiptLayout;

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

test('Bestandsschutz: Beleg auf 58 mm ist byteidentisch zum Stand vor der Rechnung', () => {
  const layout = { ...erwartet('verkauf-bar'), paperSize: 'mm58' as const };
  assert.equal(
    digest(escPosLayoutBytes(layout)),
    '00be1effb300ecae1ddade6de0cf72be33f3933ad582c5ccf5f95bb8b27e38a6',
  );
});

test('Bestandsschutz: Beleg auf 80 mm ist byteidentisch zum Stand vor der Rechnung', () => {
  const layout = { ...erwartet('verkauf-bar'), paperSize: 'mm80' as const };
  assert.equal(
    digest(escPosLayoutBytes(layout)),
    'e8edc30e61d3867f42f0278f890e482abf3e46c9157ee2e30b10b8698dcabc1b',
  );
});

/**
 * Der schaerfere der beiden Faelle: hier passte rechnerisch mehr, als der
 * Bestand druckt. Auf 80 mm liesse die Rechnung fuer diesen QR 10 Punkte je
 * Modul zu — gedruckt werden trotzdem 4, weil der Deckel von `auto` der
 * Bestandswert dieses Pakets ist. Faellt der Deckel, faellt dieser Test.
 */
test('Bestandsschutz: der nackte QR-Befehl bleibt auf beiden Papierbreiten Groesse 4', () => {
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
    assert.equal(bytes[i + 7], 4, `${paperSize}: Modulgroesse abgewichen`);
  }
});
