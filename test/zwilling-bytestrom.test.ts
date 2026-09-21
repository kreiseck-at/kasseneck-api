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
  assert.equal(digest('mm58', false), '42a673115d099035009a72aa171d0785f1ec697bd9042a669720e3b416d6d749');
});

test('80 mm ohne Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm80', false), '76d9c93b23f062ffa53ff1a0cba53a2b2f0db3dd9bd36ad6cced638c20e547d8');
});

test('58 mm mit Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm58', true), '98e98cfdbd54741634a6b2189970c72ea01594c97f193ca8f69c6df4b5013a34');
});

test('80 mm mit Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm80', true), '31fee883750041872ce63d07e5f4ba819be78892f6569611b4bdc98f66913fe6');
});
