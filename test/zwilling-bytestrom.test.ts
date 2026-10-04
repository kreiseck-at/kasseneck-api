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
 * Kartenseriennummer (0.32.2): die Fixtures tragen statt einer echten die erfundene
 * Seriennummer `5A1C3E07` (gleiche Laenge); die Digests sind darum neu gezogen.
 * Gegenprobe: im alten Strom die Seriennummer ersetzt ergibt Byte fuer Byte den neuen,
 * Laenge gleich -- sonst hat sich nichts verschoben.
 */

const layout = (paperSize: 'mm58' | 'mm80'): ReceiptLayout => ({
  ...(JSON.parse(
    readFileSync(new URL('../../fixtures/erwartet/verkauf-bar.lines.json', import.meta.url), 'utf8'),
  ) as ReceiptLayout),
  paperSize,
});

const digest = (paperSize: 'mm58' | 'mm80', marke: boolean): string =>
  createHash('sha256').update(escPosLayoutBytes(layout(paperSize), { marke })).digest('hex');

test('58 mm ohne Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm58', false), '521e45bb716bc552eab2163868806be07e626a6dc47cb1fdd71c3018d2c9d48b');
});

test('80 mm ohne Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm80', false), '947423a069cb37ada914bb9db3feeda4a07a5f9b627795cc769f98d06f605158');
});

test('58 mm mit Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm58', true), '83d391bdf5ab85602686009c59281223d267b10b57cca9750a88007d9c984823');
});

test('80 mm mit Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm80', true), 'b40133de3fc03e9a3884123ebc16a5dc8bf97b089e7609952590dfb119203ace');
});
