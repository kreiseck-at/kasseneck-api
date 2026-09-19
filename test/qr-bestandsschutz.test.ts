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
 *
 * Ausrichtung-vor-Position-Umbau: eine weitere, ebenso bewusste Abweichung.
 * Jede volle Textzeile dieses Belegs verliert den ueberfluessigen Positions-
 * befehl `ESC $ 0 0` (Zwilling: `generator.dart`, `_text`, `colInd===0 &&
 * colWidth===12`); das betrifft praktisch jede Zeile, weil dieser Beleg keine
 * echten Spalten setzt. Gegenprobe: der alte und der neue Bytestrom wurden
 * tokenisiert (ESC-/GS-/FS-Befehle statt Rohbytes) und stimmen bis auf genau
 * diese entfallenen `ESC $`-Token ueberein -- weder QR-Nutzlast noch sonst ein
 * Befehl hat sich verschoben.
 *
 * Rueckweg-Entfernung (0.25.0): der Sofort-Reset der Ausrichtung direkt nach
 * dem QR faellt weg, weil die Ursache (Positionsbefehl mitten in der Zeile)
 * seit 0.24.0 behoben ist -- der naechste echte Stil-Aufruf (das Element nach
 * dem QR) setzt die Ausrichtung ohnehin selbst zurueck, jetzt an seiner
 * eigenen Zeile statt vorgezogen. Gegenprobe: der Bytestrom vor und nach der
 * Entfernung wurde tokenisiert verglichen -- die einzige Abweichung ist genau
 * diese Verschiebung der Trias `ESC a 0 / FS. / ESC t` vom Punkt direkt nach
 * dem QR-Druckbefehl an die Stelle vor dem naechsten Element; sonst ist der
 * Strom byteidentisch.
 */

const wurzel = new URL('../../fixtures/', import.meta.url);
const erwartet = (name: string): ReceiptLayout =>
  JSON.parse(readFileSync(new URL(`erwartet/${name}.lines.json`, wurzel), 'utf8')) as ReceiptLayout;

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

test('Bestandsschutz: Beleg auf 58 mm ist byteidentisch zum zugesagten Stand', () => {
  const layout = { ...erwartet('verkauf-bar'), paperSize: 'mm58' as const };
  assert.equal(
    digest(escPosLayoutBytes(layout)),
    // Rueckweg-Entfernung (vorher 08c1d6f7…): Ausrichtung-Trias nach dem QR
    // verschiebt sich zum naechsten Element, siehe Kopfkommentar. Belegt:
    // tokenisierter Vorher/Nachher-Vergleich, einzige Abweichung ist genau
    // diese Verschiebung.
    '7589f2fa8b9de73efddf4095add15b6d54b7e8638f02532c0498701e5df28a1d',
  );
  // Der alte Strom (Stand 0.8.0) ist weiter erreichbar: `klein` + `L`.
  assert.equal(
    digest(escPosLayoutBytes(layout, { qrGroesse: 'klein', qrCorrection: 'L' })),
    // Rueckweg-Entfernung (vorher 8b9eb8cc…), gleiche Gegenprobe wie oben.
    '35a02b3c5efa1448a752223772a3c379ed86897b8c35421a0db772839e166178',
  );
});

test('Bestandsschutz: Beleg auf 80 mm ist byteidentisch zum zugesagten Stand', () => {
  const layout = { ...erwartet('verkauf-bar'), paperSize: 'mm80' as const };
  assert.equal(
    digest(escPosLayoutBytes(layout)),
    // Rueckweg-Entfernung (vorher 49c45fd8…), gleiche Gegenprobe wie oben.
    'fb1520fb7705c9ef486c3aa2ff302bbedb79832ed9665de9afc668939beef2a8',
  );
  // Der alte Strom (Stand 0.8.0) ist weiter erreichbar: `klein` + `L`.
  assert.equal(
    digest(escPosLayoutBytes(layout, { qrGroesse: 'klein', qrCorrection: 'L' })),
    // Rueckweg-Entfernung (vorher 76755a9c…), gleiche Gegenprobe wie oben.
    'b82394e68f0d0f74eff3285ec6567693fa3eef800625fb7695fd8fad86981f47',
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
