import { BRAND_MARK_RASTERS } from './marke-daten.js';
import type { PosPaperSize, RasterImage } from '../printing/escpos.js';

/** Base64 -> Bytes ohne `Buffer` -- laeuft im Browser und in Node gleich (wie `rasterRowsBase64`). */
function base64Bytes(base64: string): Uint8Array {
  const binaer = atob(base64);
  const bytes = new Uint8Array(binaer.length);
  for (let i = 0; i < binaer.length; i++) bytes[i] = binaer.charCodeAt(i);
  return bytes;
}

/**
 * Entpackt gepackte Rasterzeilen (Base64, MSB zuerst, je Zeile auf volle Bytes
 * aufgefuellt -- die Form von [rasterRowsBytes]) in ein Punkt-je-Byte-Bild.
 *
 * Eigene, exportierte Funktion statt Code inline in `brandMarkImage`: ein
 * Rundlauf-Test (packen mit `rasterRowsBytes`, entpacken hiermit) kann so
 * denselben Entpacker pruefen, den die Marke zur Laufzeit auch benutzt --
 * ein vertauschter Bit-Index waere sonst nur am schiefen Ausdruck sichtbar.
 */
export function entpackeRasterBits(bits: string, breite: number, hoehe: number): RasterImage {
  const byteJeZeile = Math.ceil(breite / 8);
  const roh = base64Bytes(bits);
  const punkte = new Uint8Array(breite * hoehe);
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const byte = roh[y * byteJeZeile + (x >> 3)] as number;
      punkte[y * breite + x] = (byte >> (7 - (x & 7))) & 1;
    }
  }
  return { width: breite, height: hoehe, dots: punkte };
}

/**
 * Die Marke als Rasterbild fuer diese Papierbreite.
 *
 * Entpackt die gepackten Zeilen in ein Punkt-je-Byte-Bild, wie es
 * [escPosRasterImage] erwartet. Zur Laufzeit wird nichts gerechnet und nichts
 * skaliert -- die beiden Masse stehen fest, damit JS und Dart fuer denselben
 * Beleg dieselben Bytes erzeugen.
 */
export function brandMarkImage(paperSize: PosPaperSize): RasterImage {
  const d = BRAND_MARK_RASTERS[paperSize];
  return entpackeRasterBits(d.bits, d.width, d.height);
}
