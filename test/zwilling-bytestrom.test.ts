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
  assert.equal(digest('mm58', false), '7589f2fa8b9de73efddf4095add15b6d54b7e8638f02532c0498701e5df28a1d');
});

test('80 mm ohne Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm80', false), 'fb1520fb7705c9ef486c3aa2ff302bbedb79832ed9665de9afc668939beef2a8');
});

test('58 mm mit Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm58', true), 'b85ee5c1e9f69ce0e566596d06b4415115b2b13ac756fb87fae3b072be81e858');
});

test('80 mm mit Marke: Byte fuer Byte wie das Dart-Paket', () => {
  assert.equal(digest('mm80', true), '77f594a7205004164233ced3cd3da8263d3325634d25610253b23c9c9d12aed7');
});
