import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createEscPosDocument,
  escPosBytes,
  escPosQrCode,
  escPosQrRaster,
  escPosReset,
  qrModulAnzahl,
  qrRasterPunkte,
  type QrMatrix,
} from '../src/printing/index.js';
import { escPosLayoutBytes, escPosLayoutErgebnis, type ReceiptLayout } from '../src/receipt/index.js';

/**
 * Der Druckweg: gerechnete Modulgroesse am nativen Befehl, der Notausgang auf
 * den Bildweg und Modell 1. Zwilling von `qr_native_groesse_test.dart` und
 * `qr_ausweich_weg_test.dart` im Flutter-Paket.
 */

const GS_K = [0x1d, 0x28, 0x6b];
const MODELL1 = [...GS_K, 0x04, 0x00, 0x31, 0x41, 0x31, 0x00];

/** Index der Folge `teil` in `bytes`, oder -1. */
function findeFolge(bytes: Uint8Array, teil: readonly number[]): number {
  for (let i = 0; i + teil.length <= bytes.length; i++) {
    let treffer = true;
    for (let k = 0; k < teil.length; k++) {
      if (bytes[i + k] !== teil[k]) { treffer = false; break; }
    }
    if (treffer) return i;
  }
  return -1;
}

/** Modulgroesse aus Funktion 167 (`GS ( k 03 00 31 43 n`), oder null. */
function modulgroesse(bytes: Uint8Array): number | null {
  const i = findeFolge(bytes, [...GS_K, 0x03, 0x00, 0x31, 0x43]);
  return i < 0 ? null : (bytes[i + 7] as number);
}

const kurz = 'TESTQRDATA';
const lang = (n: number): string => 'X'.repeat(n);

function qrBytes(text: string, optionen: Parameters<typeof escPosQrCode>[2], papier: 'mm58' | 'mm80' = 'mm58') {
  const doc = createEscPosDocument({ paperSize: papier });
  escPosQrCode(doc, text, optionen);
  return { bytes: escPosBytes(doc), doc };
}

// -------------------------------------------------- gerechnete Modulgroesse

test('nativ: ohne Wahl bleibt es beim Bestandswert 4, mit Wahl rechnet die Regel', () => {
  assert.equal(modulgroesse(qrBytes(kurz, {}).bytes), 4);
  assert.equal(modulgroesse(qrBytes(kurz, { groesse: 'klein' }).bytes), 4);
  assert.equal(modulgroesse(qrBytes(kurz, { groesse: 'mittel' }).bytes), 6);
  assert.equal(modulgroesse(qrBytes(kurz, { groesse: 'gross' }).bytes), 8);
});

test('nativ: der Deckel wird heruntergerechnet, wo das Papier nicht reicht', () => {
  // 93 Module (600 Byte) auf 58 mm: (93 + 8) * 3 = 303 <= 384, mit 4 waeren es 404.
  assert.equal(qrModulAnzahl(lang(600)), 93);
  const { bytes, doc } = qrBytes(lang(600), { groesse: 'gross' });
  assert.equal(modulgroesse(bytes), 3);
  assert.match(doc.qrAusweich ?? '', /unter dem Mindestmass/);
  assert.equal(doc.qrFehler, null);
  // Auf 80 mm reicht der Platz fuer den vollen Deckel.
  assert.equal(modulgroesse(qrBytes(lang(600), { groesse: 'gross' }, 'mm80').bytes), 5);
});

test('nativ: feste Groesse schaltet die Rechnung ab', () => {
  const { bytes, doc } = qrBytes(lang(600), { size: 8 });
  assert.equal(modulgroesse(bytes), 8);
  assert.equal(doc.qrAusweich, null);
});

test('nativ: was nicht aufs Papier passt, wird nicht als Befehl vorgetaeuscht', () => {
  assert.equal(qrModulAnzahl(lang(1000)), 121);
  const { bytes, doc } = qrBytes(lang(1000), {});
  assert.equal(modulgroesse(bytes), null, 'es steht doch ein QR-Befehl im Strom');
  assert.match(doc.qrFehler ?? '', /121 Modulen ist fuer 58 mm \(384 Punkte\) zu breit/);
  assert.equal(doc.qrAusweich, null);
  // Auf 80 mm passt dasselbe Symbol mit 4 Punkten.
  const breit = qrBytes(lang(1000), {}, 'mm80');
  assert.equal(modulgroesse(breit.bytes), 4);
  assert.equal(breit.doc.qrFehler, null);
});

test('nativ: leere Nutzlast geht unveraendert den Bestandsweg', () => {
  const { bytes, doc } = qrBytes('', {});
  assert.equal(modulgroesse(bytes), 4);
  assert.equal(doc.qrFehler, null);
});

test('nativ: eine Nutzlast, die in keine QR-Version passt, wird gemeldet', () => {
  assert.throws(() => qrBytes(lang(2332), {}), /zu lang/);
});

test('escPosReset raeumt die QR-Meldungen des vorigen Belegs weg', () => {
  const doc = createEscPosDocument({ paperSize: 'mm58' });
  escPosQrCode(doc, lang(1000));
  assert.ok(doc.qrFehler !== null);
  escPosReset(doc);
  assert.equal(doc.qrFehler, null);
  assert.equal(doc.qrAusweich, null);
});

// ---------------------------------------------------------------- Modell 1

test('Modell 1: der Wahlbefehl steht vorn — und nur, wenn er verlangt ist', () => {
  const ohne = qrBytes(kurz, {}).bytes;
  const mit = qrBytes(kurz, { modell1: true }).bytes;
  assert.equal(findeFolge(ohne, MODELL1), -1, 'der Bestandsweg schickt einen Modellbefehl');
  const i = findeFolge(mit, MODELL1);
  assert.ok(i >= 0, 'Modell-1-Befehl fehlt');
  assert.ok(i < (findeFolge(mit, [...GS_K, 0x03, 0x00, 0x31, 0x43]) as number), 'Modellbefehl steht nicht vorn');
  // Sonst ist der Strom Byte fuer Byte derselbe.
  assert.deepEqual(Array.from(mit.slice(i + MODELL1.length)), Array.from(ohne.slice(i)));
});

test('Modell 1: nimmt dieselbe gerechnete Modulgroesse', () => {
  assert.equal(modulgroesse(qrBytes(lang(600), { modell1: true, groesse: 'gross' }).bytes), 3);
});

// ------------------------------------------------------------- Bildweg/GS v 0

test('Bildweg: Rasterbild traegt Kopf, Ruhezone und Skalierung', () => {
  const matrix: QrMatrix = Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => true));
  const doc = createEscPosDocument({ paperSize: 'mm58' });
  escPosQrRaster(doc, matrix, { punkteJeModul: 1, ruhezoneModule: 0 });
  const bytes = escPosBytes(doc);
  const i = findeFolge(bytes, [0x1d, 0x76, 0x30, 0x00]);
  assert.ok(i >= 0, 'GS v 0 fehlt');
  assert.deepEqual(Array.from(bytes.slice(i + 4, i + 8)), [3, 0, 21, 0], 'Kopf (xL xH yL yH) falsch');
  // 21 volle Module: je Zeile 0xFF 0xFF 0xF8.
  for (let y = 0; y < 21; y++) {
    assert.deepEqual(Array.from(bytes.slice(i + 8 + y * 3, i + 11 + y * 3)), [0xff, 0xff, 0xf8]);
  }
});

test('Bildweg: die Ruhezone bleibt weiss und das Bild bleibt auf dem Papier', () => {
  const matrix: QrMatrix = Array.from({ length: 121 }, () => Array.from({ length: 121 }, () => true));
  const doc = createEscPosDocument({ paperSize: 'mm58' });
  escPosQrRaster(doc, matrix);
  const bytes = escPosBytes(doc);
  const i = findeFolge(bytes, [0x1d, 0x76, 0x30, 0x00]);
  const byteJeZeile = bytes[i + 4] as number;
  const zeilen = (bytes[i + 6] as number) + ((bytes[i + 7] as number) << 8);
  assert.equal(qrRasterPunkte('mm58', 121), 2);
  assert.equal(zeilen, (121 + 8) * 2, 'Gesamtbreite falsch');
  assert.ok(zeilen <= 384, 'Bild breiter als das Papier');
  assert.equal(byteJeZeile, Math.ceil(zeilen / 8));
  // Erste Rasterzeile liegt in der Ruhezone: alles weiss.
  assert.ok(Array.from(bytes.slice(i + 8, i + 8 + byteJeZeile)).every((b) => b === 0));
});

test('Bildweg: kaputte Raster werden abgelehnt', () => {
  const doc = createEscPosDocument({ paperSize: 'mm58' });
  assert.throws(() => escPosQrRaster(doc, []), /leer/);
  assert.throws(() => escPosQrRaster(doc, [[true, false]]), /quadratisch/);
  assert.throws(() => escPosQrRaster(doc, [[true]], { punkteJeModul: 0 }), /punkteJeModul/);
});

// -------------------------------------------------------------- Belegweg

const wurzel = new URL('../../fixtures/', import.meta.url);
const basis: ReceiptLayout = {
  ...(JSON.parse(readFileSync(new URL('erwartet/verkauf-bar.lines.json', wurzel), 'utf8')) as ReceiptLayout),
  paperSize: 'mm58',
};

const mitQr = (nutzlast: string): ReceiptLayout => ({
  ...basis,
  lines: basis.lines.map((z) => (z.kind === 'qr' ? { ...z, data: nutzlast } : z)),
});

const rasterFuer = (nutzlast: string): QrMatrix => {
  const n = qrModulAnzahl(nutzlast);
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => ((x + y) & 1) === 0));
};

test('Belegweg: ohne Optionen ist das Ergebnis Byte fuer Byte der Bestand', () => {
  const ergebnis = escPosLayoutErgebnis(basis);
  assert.deepEqual(ergebnis.bytes, escPosLayoutBytes(basis));
  assert.deepEqual([ergebnis.qrFehler, ergebnis.qrAusweich], [null, null]);
  assert.equal(modulgroesse(ergebnis.bytes), 4);
});

test('Belegweg: qrGroesse waehlt den Deckel, qrModus waehlt Modell 1', () => {
  // 45 Module auf 58 mm: (45 + 8) * 7 = 371 <= 384, mit 8 waeren es 424 --
  // der Deckel 'gross' erlaubt 8, das Papier gibt nur 7 her.
  assert.equal(modulgroesse(escPosLayoutBytes(basis, { qrGroesse: 'gross' })), 7);
  assert.equal(modulgroesse(escPosLayoutBytes({ ...basis, paperSize: 'mm80' }, { qrGroesse: 'gross' })), 8);
  const m1 = escPosLayoutBytes(basis, { qrModus: 'nativeModel1' });
  assert.ok(findeFolge(m1, MODELL1) >= 0);
  assert.equal(findeFolge(escPosLayoutBytes(basis, { qrModus: 'native' }), MODELL1), -1);
});

test('Belegweg: ohne Bildweg geht der Beleg ohne QR hinaus — und sagt es', () => {
  const ohneBild = escPosLayoutErgebnis(mitQr(lang(1000)));
  assert.equal(modulgroesse(ohneBild.bytes), null);
  assert.equal(findeFolge(ohneBild.bytes, [0x1d, 0x76, 0x30, 0x00]), -1);
  assert.match(ohneBild.qrFehler ?? '', /zu breit/);
});

test('Belegweg: der Notausgang druckt das Bild statt gar nichts', () => {
  const mitBild = escPosLayoutErgebnis(mitQr(lang(1000)), { qrMatrix: rasterFuer });
  assert.ok(findeFolge(mitBild.bytes, [0x1d, 0x76, 0x30, 0x00]) >= 0, 'kein Rasterbild im Strom');
  assert.equal(modulgroesse(mitBild.bytes), null, 'der native Befehl steht trotzdem im Strom');
});

test('Belegweg: der Notausgang nennt den Grund und meldet keinen Ausfall', () => {
  const mitBild = escPosLayoutErgebnis(mitQr(lang(1000)), { qrMatrix: rasterFuer });
  assert.match(mitBild.qrAusweich ?? '', /passt nativ nicht auf 58 mm \(384 Punkte\) -- als Bild gedruckt/);
  assert.equal(mitBild.qrFehler, null, 'der QR steht ja auf dem Papier');
});

test('Belegweg: wo der native Weg reicht, rastert der Notausgang nicht', () => {
  const mitBild = escPosLayoutErgebnis(basis, { qrMatrix: rasterFuer });
  assert.deepEqual(mitBild.bytes, escPosLayoutBytes(basis));
});

test('Belegweg: qrModus imageRaster rastert immer — und braucht ein Raster', () => {
  const ergebnis = escPosLayoutErgebnis(basis, { qrModus: 'imageRaster', qrMatrix: rasterFuer });
  assert.ok(findeFolge(ergebnis.bytes, [0x1d, 0x76, 0x30, 0x00]) >= 0);
  assert.equal(modulgroesse(ergebnis.bytes), null);
  assert.throws(() => escPosLayoutErgebnis(basis, { qrModus: 'imageRaster' }), /qrMatrix/);
});

test('Belegweg: feste qrSize schaltet Rechnung und Notausgang ab', () => {
  const ergebnis = escPosLayoutErgebnis(mitQr(lang(1000)), { qrSize: 8, qrMatrix: rasterFuer });
  assert.equal(modulgroesse(ergebnis.bytes), 8);
  assert.deepEqual([ergebnis.qrFehler, ergebnis.qrAusweich], [null, null]);
});
