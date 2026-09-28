import type { PosPaperSize, QrSize } from './escpos.js';

/**
 * Die Rechenregel fuer die Modulgroesse des Beleg-QR — rein, ohne Drucker.
 * Zwilling von `kasseneck_api/lib/src/printing/qr_groesse.dart` (Flutter).
 *
 * Vorgeschichte: der native QR-Befehl bekommt eine feste Modulgroesse in
 * Druckpunkten mit und rechnet nicht nach, ob das Symbol aufs Papier passt.
 * Ein Beleg-QR mit realer RKSV-Nutzlast hat 57 Module, mit Ruhezone also
 * (57 + 8) Module breit; bei sechs Punkten je Modul sind das 390 Druckpunkte,
 * und ein 58-mm-Kopf hat 384. Zu breit heisst bei den meisten Geraeten nicht
 * "abgeschnitten", sondern **gar kein QR** — auf einem Pflichtbeleg der
 * schlechteste aller Ausgaenge. (Im Flutter-Zwilling war genau das der
 * belegte Fehler.) Die Regel deckelt darum auch eine ausdruecklich gewaehlte
 * groessere Modulgroesse gegen den Papierrand ab.
 */

// ------------------------------------------------------------------- Typen

/**
 * Wie gross die Module des Beleg-QR werden duerfen — ein **Deckel**, keine
 * Vorgabe: gedruckt wird immer die groesste Groesse, die noch aufs Papier
 * passt, hoechstens aber diese hier.
 *
 * `auto` heisst "gerechnet, hoechstens 6 Punkte je Modul" — in diesem Paket
 * und im Flutter-Zwilling dasselbe. Bis 0.13 deckelte `auto` hier bei 4 (dem
 * alten Wert des nativen ESC/POS-Wegs), in Dart bei 6; derselbe Beleg kam
 * dadurch je nach Paket verschieden gross aus dem Drucker. Einheitlich gilt
 * jetzt 6: der Wert von Dart und vom Epson-Weg, und ein groesseres Modul
 * liest sich besser. `small` (4) druckt den QR so gross wie frueher `auto`;
 * `medium` (6) und `large` (8) waehlt ein Mensch.
 */
export type QrModuleSize = 'auto' | 'small' | 'medium' | 'large';

/** Groesste Modulgroesse in Druckpunkten, die der jeweilige Deckel zulaesst. */
export const QR_MODULE_SIZE_CAP: Readonly<Record<QrModuleSize, number>> = {
  auto: 6,
  small: 4,
  medium: 6,
  large: 8,
};

/**
 * Ergebnis der Modulgroessen-Rechnung.
 *
 * Traegt bewusst mehr als die Zahl: ob ueberhaupt etwas passt (`fits`), ob
 * nur unter der Mindestgroesse (`belowMinimum`) und wie breit das Symbol
 * wird (`widthDots`). Eine blosse Zahl haette die Ausnahme verschwiegen.
 */
export interface QrSizing {
  /**
   * Modulgroesse in Druckpunkten, `null` wenn das Symbol auch mit der
   * Ausnahmegroesse nicht aufs Papier passt.
   */
  readonly moduleDots: QrSize | null;
  /** Modulanzahl des Symbols (ohne Ruhezone). */
  readonly modules: number;
  /** Gesamtbreite inklusive Ruhezone in Druckpunkten; 0, wenn nichts passt. */
  readonly widthDots: number;
  /**
   * Gedruckt wird unter `QR_MIN_MODULE_DOTS`. Erlaubt, aber eine Ausnahme, von
   * der der Aufrufer erfahren muss — billige Thermodrucker und Handykameras
   * tun sich damit schwer, besonders auf gewelltem Papier.
   */
  readonly belowMinimum: boolean;
  /** Kurz fuer `punkte !== null`. */
  readonly fits: boolean;
}

// --------------------------------------------------------------- Konstanten

/** Ruhezone je Seite, in Modulen (QR-Norm). */
export const QR_QUIET_ZONE_MODULES = 4;

/** Untergrenze: 4 Punkte sind bei 203 dpi rund 0,5 mm je Modul. */
export const QR_MIN_MODULE_DOTS = 4;

/** Ausnahme, wenn `QR_MIN_MODULE_DOTS` nicht passt – gemeldet, nicht still. */
export const QR_EXCEPTION_MODULE_DOTS = 3;

/** Obergrenze des Druckbefehls in diesem Stack (`GS ( k` Funktion 167: 1..8). */
export const QR_MAX_MODULE_DOTS = 8;

/**
 * Druckbreite des Kopfes in Punkten (203 dpi): 58 mm = 384, 80 mm = 576 —
 * Zwilling von `KeckPaperSize.druckPunkte`.
 *
 * Nicht dasselbe wie die Spaltenbreite in `escpos.ts` (372/558): die stammt
 * aus `EscPaperSize.width` und laesst absichtlich Rand fuer die
 * Textpositionierung. Wer rechnet, ob ein Symbol aufs Papier passt, braucht
 * die echte Kopfbreite — ein QR, der auch nur einen Punkt zu breit ist, wird
 * von den meisten Geraeten gar nicht gedruckt.
 */
export const QR_PRINT_WIDTH_DOTS: Readonly<Record<PosPaperSize, number>> = { mm58: 384, mm80: 576 };

/**
 * Nutzlast in Byte, die eine QR-Version 1..40 bei Fehlerkorrektur **M** im
 * Byte-Modus aufnimmt (ISO/IEC 18004, Tabelle 7).
 *
 * Byte-Modus, weil die RKSV-Nutzlast beliebige Zeichen traegt; Ziffern- oder
 * Alphanumerik-Modus waere enger gefasst und wuerde fuer denselben Text
 * weniger Module ergeben — also zu klein rechnen.
 */
const BYTE_KAPAZITAET_M: readonly number[] = [
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213,
  251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
  711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370,
  1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331,
];

// ------------------------------------------------------------- oeffentlich

/**
 * Modulanzahl, die `payload` bei Fehlerkorrektur **M** braucht.
 *
 * Alle Druckwege setzen den QR mit Fehlerkorrektur **M** (nativer
 * ESC/POS-Befehl, ePOS `level_m`; das Raster fuer den Bildweg rechnet der
 * Aufrufer ebenfalls mit M) — rechnet und druckt also mit M: gerechnete und
 * gedruckte Modulanzahl stimmen ueberein, und der Anteil am Blatt
 * (Bildschirm, PDF) ist genau der am Bon. Die Byte-Zaehlung ist
 * konservativ: hier zaehlt UTF-8 (wie im Flutter-Zwilling), waehrend
 * `qrCodeBytes` die Nutzlast als Latin-1 sendet — UTF-8 ist nie kuerzer, die
 * Rechnung also nie zu klein.
 *
 * Wirft, wenn die Nutzlast in keine Version passt — wie `qrCodeBytes` bei zu
 * langem Inhalt. Ein still zurueckgegebenes "passt nicht" haette den
 * Datenfehler als Papierfehler getarnt.
 */
export function qrModuleCount(nutzlast: string): number {
  const laenge = new TextEncoder().encode(nutzlast).length;
  for (let i = 0; i < BYTE_KAPAZITAET_M.length; i++) {
    if (laenge <= (BYTE_KAPAZITAET_M[i] as number)) return 17 + 4 * (i + 1);
  }
  throw new Error('QR-Inhalt ist zu lang');
}

/**
 * Ob `payload` in irgendeine QR-Version 1..40 bei Fehlerkorrektur M passt --
 * dieselbe Tabelle wie `qrModuleCount`, aber ohne zu werfen.
 *
 * Fuer Aufrufer, denen ein zu langer Inhalt kein Programmierfehler ist,
 * sondern ein Datenfehler, den sie selbst behandeln (das Beleg-Blatt: ohne
 * QR weiterbauen statt den ganzen Zeichner mitzureissen).
 */
export function qrFitsInVersion(nutzlast: string): boolean {
  const laenge = new TextEncoder().encode(nutzlast).length;
  return laenge <= (BYTE_KAPAZITAET_M[BYTE_KAPAZITAET_M.length - 1] as number);
}

/**
 * Groesste Modulgroesse, mit der `moduleCount` Module **samt Ruhezone** in
 * `paperWidthDots` passen, gedeckelt durch `moduleSize`.
 *
 * Wirft bei sinnlosen Eingaben: eine Papierbreite von 0 oder ein Symbol ohne
 * Module ist ein Programmierfehler, und ein still zurueckgegebenes "passt
 * nicht" haette ihn als Druckerproblem getarnt.
 */
export function computeQrSizing(options: {
  paperWidthDots: number;
  moduleCount: number;
  moduleSize?: QrModuleSize;
}): QrSizing {
  const { paperWidthDots: papierbreitePunkte, moduleCount: moduleAnzahl } = options;
  const groesse = options.moduleSize ?? 'auto';
  if (!Number.isInteger(papierbreitePunkte) || papierbreitePunkte <= 0) {
    throw new Error('papierbreitePunkte muss eine Ganzzahl > 0 sein');
  }
  if (!Number.isInteger(moduleAnzahl) || moduleAnzahl <= 0) {
    throw new Error('moduleAnzahl muss eine Ganzzahl > 0 sein');
  }
  const roh = QR_MODULE_SIZE_CAP[groesse];
  if (roh === undefined) {
    throw new Error(`Unbekannte QR-Modulgroesse: ${String(groesse)}`);
  }
  const gesamtModule = moduleAnzahl + QR_QUIET_ZONE_MODULES * 2;
  const passend = Math.floor(papierbreitePunkte / gesamtModule);
  if (passend < QR_EXCEPTION_MODULE_DOTS) {
    return { moduleDots: null, modules: moduleAnzahl, widthDots: 0, belowMinimum: false, fits: false };
  }
  const deckel = Math.min(Math.max(roh, QR_EXCEPTION_MODULE_DOTS), QR_MAX_MODULE_DOTS);
  const punkte = passend < QR_MIN_MODULE_DOTS ? QR_EXCEPTION_MODULE_DOTS : Math.min(passend, deckel);
  return {
    moduleDots: punkte as QrSize,
    modules: moduleAnzahl,
    widthDots: gesamtModule * punkte,
    belowMinimum: punkte < QR_MIN_MODULE_DOTS,
    fits: true,
  };
}

/**
 * Wie `computeQrSizing`, nur mit der Modulanzahl aus `payload`.
 *
 * Eine leere Nutzlast ergibt kein Symbol — sie "passt nicht", statt zu
 * werfen: der Aufrufer behandelt den Fall ohnehin schon (leerer QR am Beleg
 * ist ein Datenfehler, kein Papierfehler).
 */
export function qrSizingFor(options: {
  payload: string;
  paperWidthDots: number;
  moduleSize?: QrModuleSize;
}): QrSizing {
  if (options.payload === '') {
    return { moduleDots: null, modules: 0, widthDots: 0, belowMinimum: false, fits: false };
  }
  const weiter: Parameters<typeof computeQrSizing>[0] = {
    paperWidthDots: options.paperWidthDots,
    moduleCount: qrModuleCount(options.payload),
  };
  if (options.moduleSize !== undefined) weiter.moduleSize = options.moduleSize;
  return computeQrSizing(weiter);
}
