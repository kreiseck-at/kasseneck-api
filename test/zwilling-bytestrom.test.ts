import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { escPosLayoutBytes, type ReceiptLayout } from '../src/receipt/index.js';

/**
 * **Der Zwilling am Bytestrom.** Die bindende Zusage der beiden Pakete lautet:
 * derselbe Beleg, derselbe Bytestrom -- egal ob ihn dieses Paket oder
 * `kasseneck_api` (Dart) setzt. Geprueft wurde das bisher nur von Hand, mit
 * einem Skript neben dem Repo; damit war die Gleichheit eine Behauptung, die
 * jede spaetere Aenderung still brechen konnte. `tool/zwillinge.sh pruefen`
 * deckt die Vertragsdateien ab, nicht den Strom, und die gemeinsamen
 * Pruef-Faelle vergleichen Raster, Zeilen und Blatt -- alles Stufen VOR den
 * Bytes.
 *
 * Darum stehen die vier Digests unten **wortgleich** im Dart-Paket
 * (`test/printing/zwilling_bytestrom_test.dart`). Wer in einem der beiden
 * Pakete am Druckweg dreht, macht dort oder hier rot -- und die CI beider
 * Repos faehrt diese Datei. Die beiden ohne Marke sind zusaetzlich der
 * Bestandsschutz aus `qr-bestandsschutz.test.ts`; sie stehen hier ein zweites
 * Mal, weil sie dort eine andere Frage beantworten (Bestandsgeraete) als hier
 * (Zwillings-Gleichheit).
 *
 * Die vier Digests sind mit 0.26.0 einmal neu gezogen worden: seither traegt
 * der Vorspann den Druckbereich des Blatts (`GS L` / `GS W`, acht Bytes).
 *
 * Der QR laeuft im nativen Modus, weil nur der ohne gerastertes Bild auskommt
 * und damit in beiden Paketen aus derselben Quelle entsteht -- das gerasterte
 * Symbol baut jede Seite mit ihrer eigenen QR-Bibliothek, dort ist
 * Byte-Gleichheit weder zugesagt noch moeglich.
 *
 * Die Marke ist bewusst mit dabei: ihr Raster entsteht hier beim Bauen und
 * reist als Vertragsdatei ins Dart-Paket. Der Digest haelt das Raster fest,
 * das der Druckweg wirklich benutzt -- weicht die Dart-Seite um ein Bit ab,
 * wird dort genau der betroffene Fall rot (selbst nachgestellt). Dass die
 * gezogene Vertragsdatei zur Dart-Quelle passt, prueft dort
 * `test/marke_test.dart`; beides zusammen schliesst die Kette.
 *
 * Ersatzdaten (23.10.2026, R12): der Golden-Beleg traegt statt `ATU12345678` die pruefziffernrichtige
 * `ATU12345675`; die Digests sind darum neu gezogen (nur die UID-Zeile aendert sich).
 *
 * Kartenseriennummer (1.2.2/0.32.2): die Fixtures tragen statt einer echten die erfundene
 * Seriennummer `5A1C3E07` (gleiche Laenge); die Digests sind darum neu gezogen.
 * Gegenprobe: das alte Layout mit ersetzter Seriennummer ergibt Byte fuer Byte die neuen
 * Ausgaben -- sonst hat sich nichts verschoben.
 */

const layout = (paperSize: 'mm58' | 'mm80'): ReceiptLayout => ({
  ...(JSON.parse(
    readFileSync(new URL('../../fixtures/expected/sale-cash.lines.json', import.meta.url), 'utf8'),
  ) as ReceiptLayout),
  paperSize,
});

const digest = (paperSize: 'mm58' | 'mm80', marke: boolean): string =>
  createHash('sha256').update(escPosLayoutBytes(layout(paperSize), { brandMark: marke })).digest('hex');

test('58 mm ohne Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm58', false), 'a805e7a09063c9b8cf781d3dc03d5028a23b785c15a8101f0d589328ac6424fd');
});

test('80 mm ohne Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm80', false), 'b62ab3a13df22fd6e507c4f685cb634c58933abf912d37188fa345001bacb287');
});

test('58 mm mit Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm58', true), 'c70419bd79bed9a860f9f506bf72b4954b57050346ab344467f20c27d1edc9c3');
});

test('80 mm mit Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm80', true), '0e476d59f8ff4995869b4e084d4632040f313d5dfdc6a6254c457e0396e1cd3d');
});

/*
 * Bon der Schicht mit fetter Spaltenzeile („Bleibt in der Kassenlade“, Wechselgeld 1.11.0):
 * der einzige Weg, auf dem eine Spaltenzeile fett gedruckt wird (`ESC E 1`/`ESC E 0`).
 * Ohne Marke; dieselben Digests stehen im Dart-Paket.
 */
const schichtBon = (paperSize: 'mm58' | 'mm80'): string =>
  createHash('sha256')
    .update(escPosLayoutBytes({
      ...(JSON.parse(readFileSync(new URL('../../fixtures/expected/shift-close-take-out.lines.json', import.meta.url), 'utf8')) as ReceiptLayout),
      paperSize,
    }, { brandMark: false }))
    .digest('hex');

test('Z-Bon mit Entnahme, 58 mm: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(schichtBon('mm58'), '289d0ec5dbdd72fdb0a4b93b316b6909a985e625c7c8845dc23f18a7a7baa9ca');
});

test('Z-Bon mit Entnahme, 80 mm: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(schichtBon('mm80'), 'c0bb40b6c93e0f105d704283f6c997c5bba9878c03f94ea14eebab2d98e1e3ee');
});
