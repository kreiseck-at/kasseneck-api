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
 * Entpackt gepackte Rasterzeilen (Base64, MSB zuerst, je Zeile auf volle Bytes
 * aufgefuellt -- die Form von [rasterZeilenBytes]) in ein Punkt-je-Byte-Bild.
 *
 * Eigene, exportierte Funktion statt Code inline in `markeBild`: ein
 * Rundlauf-Test (packen mit `rasterZeilenBytes`, entpacken hiermit) kann so
 * denselben Entpacker pruefen, den die Marke zur Laufzeit auch benutzt --
 * ein vertauschter Bit-Index waere sonst nur am schiefen Ausdruck sichtbar.
 */
export function entpackeRasterBits(bits: string, breite: number, hoehe: number): RasterBild {
  const byteJeZeile = Math.ceil(breite / 8);
  const roh = base64Bytes(bits);
  const punkte = new Uint8Array(breite * hoehe);
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const byte = roh[y * byteJeZeile + (x >> 3)] as number;
      punkte[y * breite + x] = (byte >> (7 - (x & 7))) & 1;
    }
  }
  return { breite, hoehe, punkte };
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
  return entpackeRasterBits(d.bits, d.breite, d.hoehe);
}
