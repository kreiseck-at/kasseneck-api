/**
 * Zeilenmodell und Drucklogo in der inneren Form (deutsch) <-> Form 1.0.
 *
 * Die innere Form ist die, die das Backend speichert und am Draht `/api`
 * (Kanal intern) spricht, und die, in der 0.x das Zeilenmodell im Browser
 * zwischengespeichert hat:
 *
 * - Zeilenmodell: `regelwerk` statt `ruleset`, Bannerzeilen mit `ton`
 *   (`belegart`, `warnung`) statt `tone` (`receipt_type`, `warning`);
 * - Drucklogo (`createPrintJob`, Parameter `logo`): `stufe`, `pxBreite`,
 *   `pxHoehe`, `breite`, `hoehe`, `zeilen` (Base64, MSB zuerst) statt
 *   [PrintLogo] (`size`, `pixelWidth`, `pixelHeight`, `raster`).
 *
 * Dieselben Namen wie der Rand des Backends unter `/v3` (Vokabular
 * `createPrintJob`/`getReceiptWithCompany`: `layout.ruleset` <-> `regelwerk`,
 * `lines[].tone` <-> `ton`, Katalog `LAYOUT_TON`, `logo.scale` <-> `stufe` ...).
 * Ein unbekannter Ton geht woertlich durch, wie ihn auch der Rand durchreicht.
 */
import type { LayoutRuleset, ReceiptLayout } from '../receipt/layout.js';
import type { PrintLogo } from '../receipt/layout-escpos.js';
import type { SheetLogoSize } from '../receipt/blatt.js';
import { rasterRowsBase64, type RasterImage } from '../printing/escpos.js';
import { KasseneckValidationError } from '../client/errors.js';

type Objekt = Record<string, unknown>;
const istObjekt = (w: unknown): w is Objekt => w !== null && typeof w === 'object' && !Array.isArray(w);

const TON_NACH_1_0: Readonly<Record<string, string>> = { belegart: 'receipt_type', warnung: 'warning' };
const TON_NACH_INNEN: Readonly<Record<string, string>> = { receipt_type: 'belegart', warning: 'warnung' };

/**
 * Ein Zeilenmodell in der inneren Form (0.x-Zwischenspeicher, Antwort unter
 * `/api`) als [ReceiptLayout]. Nimmt auch die Form 1.0 an und laesst sie
 * unveraendert; so liest eine Funktion alte und neue Eintraege. Kein
 * Zeilenmodell (fehlt, kein Objekt, keine `lines`) -> `null`: ein
 * unlesbarer Eintrag im Zwischenspeicher soll den Beleg nicht mitreissen.
 */
export function fromStoredLayout(stored: unknown): ReceiptLayout | null {
  if (!istObjekt(stored) || !Array.isArray(stored.lines)) return null;
  const { regelwerk, ...rest } = stored;
  const lines = (stored.lines as unknown[]).map((z) => {
    if (!istObjekt(z)) return z;
    const { ton, ...zeile } = z;
    if (zeile.tone === undefined && typeof ton === 'string') zeile.tone = TON_NACH_1_0[ton] ?? ton;
    return zeile;
  });
  const ruleset = rest.ruleset ?? regelwerk;
  return { ...rest, lines, ...(ruleset !== undefined ? { ruleset: ruleset as LayoutRuleset } : {}) } as unknown as ReceiptLayout;
}

/**
 * Ein [ReceiptLayout] in der inneren Form, fuer einen Aufruf unter `/api`
 * (`createPrintJob`, `renderBelegPdfAdmin`) oder einen Leser der 0.x-Form.
 * Ohne diese Uebersetzung liest das Backend den Ton nicht, und der Rahmen
 * der Warnzeilen (TESTKASSE, Sicherheitseinrichtung ausgefallen) und des
 * Belegart-Aufdrucks fiele am Bon und im PDF weg.
 */
export function toStoredLayout(layout: ReceiptLayout): Record<string, unknown> {
  if (!istObjekt(layout) || !Array.isArray((layout as unknown as Objekt).lines)) {
    throw new KasseneckValidationError('toStoredLayout', 'layout ohne lines', 'request');
  }
  const { ruleset, lines, ...rest } = layout as unknown as Objekt & { lines: unknown[] };
  const zeilen = lines.map((z) => {
    if (!istObjekt(z)) return z;
    const { tone, ...zeile } = z;
    return typeof tone === 'string' ? { ...zeile, ton: TON_NACH_INNEN[tone] ?? tone } : zeile;
  });
  return { ...rest, ...(ruleset !== undefined ? { regelwerk: ruleset } : {}), lines: zeilen };
}

/**
 * Ein [PrintLogo] in der inneren Form des Druckjobs (`createPrintJob` unter
 * `/api`): dieselben Punkte, die das Paket unter `/v3` als `logo` schickt.
 */
export function toStoredPrintLogo(logo: PrintLogo): Record<string, unknown> {
  return {
    stufe: logo.size, pxBreite: logo.pixelWidth, pxHoehe: logo.pixelHeight,
    breite: logo.raster.width, hoehe: logo.raster.height, zeilen: rasterRowsBase64(logo.raster),
  };
}

const STUFEN: ReadonlySet<string> = new Set(['S', 'M', 'L', 'XL']);
const ganz = (w: unknown): w is number => typeof w === 'number' && Number.isInteger(w) && w > 0;

/**
 * Ein Drucklogo in der inneren Form als [PrintLogo]. Die Zeilen sind die
 * Rasterzeilen als Base64 (MSB zuerst, jede Zeile auf volle Bytes
 * aufgefuellt). Wirft `KasseneckValidationError`, wenn Stufe, Masse oder
 * Zeilen nicht zusammenpassen.
 */
export function fromStoredPrintLogo(stored: unknown): PrintLogo {
  const name = 'fromStoredPrintLogo';
  if (!istObjekt(stored)) throw new KasseneckValidationError(name, 'kein Logo-Objekt', 'request');
  const { stufe, pxBreite, pxHoehe, breite, hoehe, zeilen } = stored;
  if (typeof stufe !== 'string' || !STUFEN.has(stufe)) throw new KasseneckValidationError(name, 'stufe ist nicht S, M, L oder XL', 'request');
  if (!ganz(pxBreite) || !ganz(pxHoehe) || !ganz(breite) || !ganz(hoehe)) {
    throw new KasseneckValidationError(name, 'pxBreite, pxHoehe, breite und hoehe muessen ganze Zahlen > 0 sein', 'request');
  }
  if (typeof zeilen !== 'string') throw new KasseneckValidationError(name, 'zeilen fehlt', 'request');
  let binaer: string;
  try {
    binaer = atob(zeilen);
  } catch {
    throw new KasseneckValidationError(name, 'zeilen ist kein Base64', 'request');
  }
  const byteJeZeile = Math.ceil(breite / 8);
  if (binaer.length !== byteJeZeile * hoehe) throw new KasseneckValidationError(name, 'zeilen passen nicht zu breite und hoehe', 'request');
  const dots = new Uint8Array(breite * hoehe);
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      if (binaer.charCodeAt(y * byteJeZeile + (x >> 3)) & (0x80 >> (x & 7))) dots[y * breite + x] = 1;
    }
  }
  const raster: RasterImage = { width: breite, height: hoehe, dots };
  return { size: stufe as SheetLogoSize, pixelWidth: pxBreite, pixelHeight: pxHoehe, raster };
}
