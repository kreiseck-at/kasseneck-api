import type { RasterBild } from '../printing/escpos.js';
import { logoRasterMass, type LogoMass } from './blatt.js';

/**
 * RGBA-Pixel (wie `ImageData.data` im Browser oder ein dekodiertes PNG in
 * Node/Dart) -> einfarbiges Rasterbild in genau der Groesse, die das Blatt
 * dem Logo gibt.
 *
 * Die Rechnung ist Vertrag und hat einen Dart-Zwilling (Golden
 * `erwartet/logo-probe.raster32.txt`): Flaechenmittel je Druckpunkt,
 * Durchsichtiges auf Papierweiss, Helligkeit nach BT.601, Floyd-Steinberg mit
 * Schwelle 128. Die Reihenfolge der Rechenschritte nicht aendern -- beide
 * Sprachen rechnen mit IEEE-Doubles und kommen nur so auf dieselben Punkte.
 */
export function logoRaster(rgba: ArrayLike<number>, pxBreite: number, pxHoehe: number, mass: LogoMass, zeichen: number): RasterBild {
  if (!Number.isInteger(pxBreite) || !Number.isInteger(pxHoehe) || pxBreite < 1 || pxHoehe < 1 || rgba.length !== pxBreite * pxHoehe * 4) {
    throw new Error('RGBA-Laenge passt nicht zum Pixelmass');
  }
  const { breite, hoehe } = logoRasterMass(mass, zeichen);
  const grau = new Float64Array(breite * hoehe);
  const sx = pxBreite / breite;
  const sy = pxHoehe / hoehe;
  for (let y = 0; y < hoehe; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(pxHoehe, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < breite; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(pxBreite, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let summe = 0;
      let anzahl = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * pxBreite + px) * 4;
          const deckung = (rgba[i + 3] as number) / 255;
          const hell = 0.299 * (rgba[i] as number) + 0.587 * (rgba[i + 1] as number) + 0.114 * (rgba[i + 2] as number);
          summe += hell * deckung + 255 * (1 - deckung);
          anzahl += 1;
        }
      }
      grau[y * breite + x] = anzahl === 0 ? 255 : summe / anzahl;
    }
  }
  const punkte = new Uint8Array(breite * hoehe);
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const i = y * breite + x;
      const alt = grau[i] as number;
      const neu = alt < 128 ? 0 : 255;
      if (neu === 0) punkte[i] = 1;
      const fehler = alt - neu;
      if (x + 1 < breite) grau[i + 1] = (grau[i + 1] as number) + (fehler * 7) / 16;
      if (y + 1 < hoehe) {
        if (x > 0) grau[i + breite - 1] = (grau[i + breite - 1] as number) + (fehler * 3) / 16;
        grau[i + breite] = (grau[i + breite] as number) + (fehler * 5) / 16;
        if (x + 1 < breite) grau[i + breite + 1] = (grau[i + breite + 1] as number) + fehler / 16;
      }
    }
  }
  return { breite, hoehe, punkte };
}
