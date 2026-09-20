import { MARKE_RASTER } from './marke-daten.js';
import type { PosPaperSize, RasterBild } from '../printing/escpos.js';

/** Base64 -> Bytes ohne `Buffer` -- laeuft im Browser und in Node gleich (wie `rasterZeilenBase64`). */
function base64Bytes(base64: string): Uint8Array {
  const binaer = atob(base64);
  const bytes = new Uint8Array(binaer.length);
  for (let i = 0; i < binaer.length; i++) bytes[i] = binaer.charCodeAt(i);
  return bytes;
}

/**
 * Die Marke als Rasterbild fuer diese Papierbreite.
 *
 * Entpackt die gepackten Zeilen in ein Punkt-je-Byte-Bild, wie es
 * [escPosRasterBild] erwartet. Zur Laufzeit wird nichts gerechnet und nichts
 * skaliert -- die beiden Masse stehen fest, damit JS und Dart fuer denselben
 * Beleg dieselben Bytes erzeugen.
 */
export function markeBild(paperSize: PosPaperSize): RasterBild {
  const d = MARKE_RASTER[paperSize];
  const byteJeZeile = Math.ceil(d.breite / 8);
  const roh = base64Bytes(d.bits);
  const punkte = new Uint8Array(d.breite * d.hoehe);
  for (let y = 0; y < d.hoehe; y++) {
    for (let x = 0; x < d.breite; x++) {
      const byte = roh[y * byteJeZeile + (x >> 3)] as number;
      punkte[y * d.breite + x] = (byte >> (7 - (x & 7))) & 1;
    }
  }
  return { breite: d.breite, hoehe: d.hoehe, punkte };
}
