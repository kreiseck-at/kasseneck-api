import { CHARS_PER_PAPER_SIZE } from '../receipt/grid.js';
import type { PosCodePage, PosCut, PosPaperSize, PosQrMode } from './settings.js';

/*
 * Druckerkatalog der Kasse: bekannte Bondrucker mit den Druck-Einstellungen, die an ihnen im Geraetetest stimmen.
 * Findet Kasseneck Connect ein bekanntes Modell, uebernimmt die Kasse diese Werte mit einem Klick; bei einem unbekannten
 * Modell fragt sie nur die Papierbreite. Der Katalog liegt im Paket (nicht im Admin, nicht in Connect), damit Web-Kasse
 * und Kassen-App offline dieselben Werte haben und jede Aenderung versioniert und getestet ausgeliefert wird.
 *
 * Vertrag ist fixtures/printer-catalog.json: dieselben Eintraege wie hier und die Prueffaelle, die der Dart-Zwilling
 * (lib/src/kasse/drucker_katalog.dart) gegen dieselbe Datei rechnet. Die Daten unten prueft nur der Test
 * (printerCatalogProblems); zur Laufzeit wird nichts still repariert oder verworfen.
 */

// ------------------------------------------------------------------ Wertemengen

/**
 * Schnitt eines Eintrags: nur, was die Kasse unter „Papier abschneiden“ anbietet (Teilschnitt oder keiner). Die
 * Einstellung kennt auch `full`, Bondrucker schneiden aber nie ganz durch; ein Katalogwert, den die Kasse nicht
 * anzeigt, waere fuer den Chef nicht pruefbar.
 */
export const PRINTER_CATALOG_CUTS = ['partial', 'none'] as const satisfies readonly PosCut[];
export type PrinterCatalogCut = typeof PRINTER_CATALOG_CUTS[number];

/** QR-Weg eines Eintrags. `auto` heisst „noch niemand hat entschieden“ und ist darum keine Aussage ueber ein Modell. */
export const PRINTER_CATALOG_QR_MODES = ['escpos', 'raster'] as const satisfies readonly PosQrMode[];
export type PrinterCatalogQrMode = typeof PRINTER_CATALOG_QR_MODES[number];

// ------------------------------------------------------------------ Typen

/** Druck-Werte eines Modells mit den Namen und Werten der Geraete-Einstellungen unter /v3. */
export interface PrinterCatalogValues {
  readonly paperSize: PosPaperSize;
  /**
   * Zeichen je Zeile, im Geraetetest bestaetigt. Keine Einstellung: die Kasse leitet sie aus `paperSize` ab
   * (CHARS_PER_PAPER_SIZE). Der Eintrag haelt fest, dass beides an diesem Drucker zusammenpasst; ein Drucker mit
   * anderer Zeichenzahl braeuchte erst eine neue Einstellung.
   */
  readonly charsPerLine: number;
  readonly cut: PrinterCatalogCut;
  /** Ladenanschluss, der auf den Impuls der Kasse (ESC p 0 25 250) oeffnet; Vorschlag fuer `drawerEnabled`. */
  readonly drawerKick: boolean;
  readonly qrMode: PrinterCatalogQrMode;
  readonly codePage: PosCodePage;
}

/** Protokoll des Geraetetests, der einen Eintrag freigibt. */
export interface PrinterDeviceTest {
  /** Tag des Tests, `JJJJ-MM-TT` (Wiener Tag). */
  readonly date: string;
  /** Version von Kasseneck Connect, mit der geprueft wurde. */
  readonly connectVersion: string;
  /** Firmware des geprueften Druckers. */
  readonly firmware: string;
  /** Wer geprueft hat: Kuerzel, kein voller Name (die Datei reist im Paket mit). */
  readonly testedBy: string;
}

/** Freigabe eines Eintrags. Nur `approved: true` wirkt; ohne Geraetetest gibt es keine Freigabe. */
export interface PrinterCatalogApproval {
  readonly approved: boolean;
  readonly deviceTest: PrinterDeviceTest | null;
}

export interface PrinterCatalogEntry {
  /** Feste Kennung `<hersteller>-<modell>`, klein. */
  readonly id: string;
  readonly manufacturer: string;
  /** Modellname zum Anzeigen, so geschrieben wie vom Hersteller. */
  readonly model: string;
  /** Normierte Modellnamen (aus mDNS und `GS I`), an denen der Eintrag erkannt wird. */
  readonly matchNames: readonly string[];
  readonly values: PrinterCatalogValues;
  readonly approval: PrinterCatalogApproval;
}

/** Der Teil der Geraete-Einstellungen, den ein bekanntes Modell vorschlaegt. */
export interface PrinterCatalogSettings {
  readonly paperSize: PosPaperSize;
  readonly codePage: PosCodePage;
  readonly cut: PrinterCatalogCut;
  readonly qrMode: PrinterCatalogQrMode;
  readonly drawerEnabled: boolean;
}

// ------------------------------------------------------------------ Daten

const eingefroren = (e: PrinterCatalogEntry): PrinterCatalogEntry => Object.freeze({
  ...e,
  matchNames: Object.freeze([...e.matchNames]),
  values: Object.freeze({ ...e.values }),
  approval: Object.freeze({ ...e.approval, deviceTest: e.approval.deviceTest && Object.freeze({ ...e.approval.deviceTest }) }),
});

/**
 * Startbestand laut Spec connect-betrieb (Stufe 1), noch ohne Geraetetest und darum nicht freigegeben. Je Eintrag
 * stehen die Werte ausgeschrieben, auch wo sie gleich sind: jeder ist eine eigene Aussage ueber ein Modell und wird
 * einzeln freigegeben.
 */
export const PRINTER_CATALOG: readonly PrinterCatalogEntry[] = Object.freeze(([
  {
    id: 'epson-tm-m30iii', manufacturer: 'Epson', model: 'TM-m30III', matchNames: ['TM-M30III'],
    values: { paperSize: 'mm80', charsPerLine: 48, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
  {
    id: 'epson-tm-m30ii', manufacturer: 'Epson', model: 'TM-m30II', matchNames: ['TM-M30II'],
    values: { paperSize: 'mm80', charsPerLine: 48, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
  {
    id: 'epson-tm-t20iii', manufacturer: 'Epson', model: 'TM-T20III', matchNames: ['TM-T20III'],
    values: { paperSize: 'mm80', charsPerLine: 48, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
  {
    id: 'epson-tm-t88vi', manufacturer: 'Epson', model: 'TM-T88VI', matchNames: ['TM-T88VI'],
    values: { paperSize: 'mm80', charsPerLine: 48, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
  {
    id: 'epson-tm-t88vii', manufacturer: 'Epson', model: 'TM-T88VII', matchNames: ['TM-T88VII'],
    values: { paperSize: 'mm80', charsPerLine: 48, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
  {
    id: 'epson-tm-m10', manufacturer: 'Epson', model: 'TM-m10', matchNames: ['TM-M10'],
    values: { paperSize: 'mm58', charsPerLine: 32, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
] satisfies PrinterCatalogEntry[]).map(eingefroren));

// ------------------------------------------------------------------ Normierung

/** Trenner im normierten Namen. */
const TRENNER = '-';

/**
 * Grossbuchstaben und Teile: aus `a-z` wird `A-Z` (nur ASCII, damit npm und Dart gleich rechnen; `toUpperCase` machte
 * aus „ß“ zwei Zeichen), jede Folge anderer Zeichen als `A-Z`/`0-9` wird ein Trenner, am Rand keiner.
 *
 * Die Trenner bleiben als ein Zeichen stehen statt zu verschwinden: sonst waere das eigene Modell TM-T20II-i gleich
 * TM-T20III und TM-T88V-i gleich TM-T88VI. Leerzeichen, Bindestrich, Unterstrich und Klammer gelten dabei gleich, damit
 * „tm m30iii“, „TM-m30III“ und „(EPSON TM-m30III)“ (IPP `product`) denselben Namen ergeben.
 */
function inTeilen(text: string): string {
  return text.replace(/[a-z]/g, (c) => c.toUpperCase()).split(/[^A-Z0-9]+/).filter((t) => t !== '').join(TRENNER);
}

/** Hersteller als Vorsilbe (`EPSON-`), aus den Eintraegen selbst: ein neuer Hersteller braucht keine zweite Liste. */
const HERSTELLER_VORSILBEN: readonly string[] = [...new Set(PRINTER_CATALOG.map((e) => inTeilen(e.manufacturer) + TRENNER))];

/**
 * Normierter Modellname: [inTeilen], dann ohne einen vorangestellten Hersteller des Katalogs. `null` ohne Namen.
 * `EPSON TM-m30III`, `TM-M30III` und `tm m30iii` ergeben `TM-M30III`; der Hersteller allein (`EPSON`) bleibt stehen.
 */
export function normalizePrinterModel(model: string | null): string | null {
  if (typeof model !== 'string') return null;
  const name = inTeilen(model);
  if (name === '') return null;
  const vorsilbe = HERSTELLER_VORSILBEN.find((v) => name.startsWith(v));
  return vorsilbe === undefined ? name : name.slice(vorsilbe.length);
}

// ------------------------------------------------------------------ Erkennen

/**
 * Der freigegebene Eintrag aus `catalog`, an dem `model` erkannt wird, sonst `null`. Ein nicht freigegebener Eintrag
 * verhaelt sich wie ein unbekanntes Modell. Das Ergebnis ist eindeutig, weil kein Name in zwei Eintraegen steht
 * (Prueffall `match_name_ambiguous`).
 */
export function findPrinterCatalogEntry(catalog: readonly PrinterCatalogEntry[], model: string | null): PrinterCatalogEntry | null {
  const name = normalizePrinterModel(model);
  if (name === null) return null;
  return catalog.find((e) => e.approval.approved && e.matchNames.includes(name)) ?? null;
}

/**
 * Der freigegebene Katalogeintrag zu einem Modellnamen, wie Connect ihn meldet (mDNS, `GS I`), oder `null` fuer ein
 * unbekanntes Modell. Gross- und Kleinschreibung, ein vorangestelltes `EPSON` und die Art der Trenner zaehlen nicht.
 */
export function printerCatalogEntry(model: string | null): PrinterCatalogEntry | null {
  return findPrinterCatalogEntry(PRINTER_CATALOG, model);
}

/** Die Geraete-Einstellungen, die ein Eintrag vorschlaegt; `drawerKick` wird zu `drawerEnabled`. */
export function printerCatalogSettings(entry: PrinterCatalogEntry): PrinterCatalogSettings {
  const { paperSize, codePage, cut, qrMode, drawerKick } = entry.values;
  return { paperSize, codePage, cut, qrMode, drawerEnabled: drawerKick };
}

// ------------------------------------------------------------------ Pruefung

/**
 * Was an einem Katalog nicht stimmt. Jeder Grund gehoert zu genau einem Feld des Eintrags, darum traegt ein Fund kein
 * eigenes Feld. Reihenfolge = Reihenfolge der Pruefung je Eintrag.
 */
export const PRINTER_CATALOG_PROBLEM_REASONS = [
  'duplicate_id',
  'match_names_missing',
  'match_name_not_normalized',
  'match_name_ambiguous',
  'model_not_matched',
  'cut_not_allowed',
  'qr_mode_not_allowed',
  'chars_per_line_mismatch',
  'device_test_missing',
  'device_test_incomplete',
] as const;
export type PrinterCatalogProblemReason = typeof PRINTER_CATALOG_PROBLEM_REASONS[number];

/** Ein Fund der Pruefung: welcher Eintrag, welcher Grund. */
export interface PrinterCatalogProblem {
  readonly id: string;
  readonly reason: PrinterCatalogProblemReason;
}

/** Tag im Format `JJJJ-MM-TT`. */
const TAG = /^\d{4}-\d{2}-\d{2}$/;

const vollstaendig = (t: PrinterDeviceTest): boolean =>
  TAG.test(t.date) && t.connectVersion !== '' && t.firmware !== '' && t.testedBy !== '';

/**
 * Alle Funde in einem Katalog; leer = gueltig. Die einzige Stelle, an der die Regeln stehen. Der Test ruft sie fuer den
 * ausgelieferten Katalog und die Prueffaelle; ein Fund macht ihn rot, statt zur Laufzeit still zu wirken.
 */
export function printerCatalogProblems(catalog: readonly PrinterCatalogEntry[]): PrinterCatalogProblem[] {
  const probleme: PrinterCatalogProblem[] = [];
  const ids = new Set<string>();
  /** Name -> Index des Eintrags, der ihn zuerst fuehrt. */
  const namen = new Map<string, number>();
  catalog.forEach((e, index) => {
    const melde = (reason: PrinterCatalogProblemReason): void => { probleme.push({ id: e.id, reason }); };
    if (ids.has(e.id)) melde('duplicate_id');
    ids.add(e.id);
    if (e.matchNames.length === 0) melde('match_names_missing');
    for (const name of e.matchNames) {
      if (normalizePrinterModel(name) !== name) melde('match_name_not_normalized');
      const erster = namen.get(name);
      if (erster === undefined) namen.set(name, index);
      else if (erster !== index) melde('match_name_ambiguous');
    }
    // Der eigene Modellname muss den Eintrag finden; sonst passen Anzeige und Erkennung nicht zusammen (Tippfehler).
    const eigenerName = normalizePrinterModel(e.model);
    if (eigenerName === null || !e.matchNames.includes(eigenerName)) melde('model_not_matched');
    // Die Typen schliessen beides schon aus; die Pruefung gilt Daten, die als JSON kommen (Prueffaelle des Vertrags).
    if (!(PRINTER_CATALOG_CUTS as readonly string[]).includes(e.values.cut)) melde('cut_not_allowed');
    if (!(PRINTER_CATALOG_QR_MODES as readonly string[]).includes(e.values.qrMode)) melde('qr_mode_not_allowed');
    if (CHARS_PER_PAPER_SIZE[e.values.paperSize] !== e.values.charsPerLine) melde('chars_per_line_mismatch');
    const test = e.approval.deviceTest;
    if (e.approval.approved && test === null) melde('device_test_missing');
    if (test !== null && !vollstaendig(test)) melde('device_test_incomplete');
  });
  return probleme;
}
