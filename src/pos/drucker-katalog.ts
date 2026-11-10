import { CHARS_PER_PAPER_SIZE } from '../receipt/grid.js';
import { PAPER_SIZE, type PosCodePage, type PosCut, type PosPaperSize, type PosQrMode } from './settings.js';

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
  /** Werkseinstellung der Papierbreite; welche Breiten das Modell sonst kann, steht in `paperSizes`. */
  readonly paperSize: PosPaperSize;
  /**
   * Zeichen je Zeile bei der Werkseinstellung, im Geraetetest bestaetigt. Keine Einstellung: die Kasse leitet sie aus
   * `paperSize` ab (CHARS_PER_PAPER_SIZE). Der Eintrag haelt fest, dass beides an diesem Drucker zusammenpasst; ein
   * Drucker mit anderer Zeichenzahl braeuchte erst eine neue Einstellung.
   */
  readonly charsPerLine: number;
  readonly cut: PrinterCatalogCut;
  /** Ladenanschluss, der auf den Impuls der Kasse (ESC p 0 25 250) oeffnet. */
  readonly drawerKick: boolean;
  readonly qrMode: PrinterCatalogQrMode;
  readonly codePage: PosCodePage;
}

/** Ein Wertfeld eines Eintrags; der Geraetetest nennt, welche am Geraet geprueft sind. */
export type PrinterCatalogValueField = keyof PrinterCatalogValues;

/** Alle Wertfelder, in der Reihenfolge von [PrinterCatalogValues]; ein Test haelt sie vollstaendig. */
export const PRINTER_CATALOG_VALUE_FIELDS = [
  'paperSize', 'charsPerLine', 'cut', 'drawerKick', 'qrMode', 'codePage',
] as const satisfies readonly PrinterCatalogValueField[];

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
  /**
   * Die am Geraet geprueften Wertfelder (`codePage` heisst: € und Umlaute stehen richtig am Bon). Vollstaendig ist der
   * Test erst mit jedem Feld aus `values`: eine Freigabe soll nichts behaupten, was niemand gesehen hat.
   */
  readonly checked: readonly PrinterCatalogValueField[];
  /** Die Papierbreiten, mit denen am Geraet gedruckt wurde; jede aus `paperSizes` muss dabei sein. */
  readonly checkedPaperSizes: readonly PosPaperSize[];
}

/** Freigabe eines Eintrags. Nur `approved: true` wirkt; ohne vollstaendigen Geraetetest gibt es keine Freigabe. */
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
  /**
   * Die Einstellungen der Papierbreite, die an diesem Modell passen (fuer eine andere Rolle mit Papierfuehrung und
   * Einstellung am Drucker), in der Reihenfolge von PAPER_SIZE. Mehr als eine heisst: die Werkseinstellung in `values`
   * kann am Geraet anders stehen.
   */
  readonly paperSizes: readonly PosPaperSize[];
  /**
   * Zeichen je Zeile, die der Drucker in seiner Werkseinstellung mit Schrift A selbst druckt (Datenblatt). Keine
   * Breite aus `paperSizes` darf mehr Zeichen setzen; ist es mehr als `values.charsPerLine`, nutzt die Kasse bewusst
   * ihr schmaleres Layout, bis es eine Einstellung mit dieser Zeichenzahl gibt.
   */
  readonly nativeCharsPerLine: number;
  readonly values: PrinterCatalogValues;
  readonly approval: PrinterCatalogApproval;
}

/** Der Teil der Geraete-Einstellungen, den ein bekanntes Modell beim ersten Einrichten vorschlaegt. */
export interface PrinterCatalogDeviceSettings {
  readonly paperSize: PosPaperSize;
  readonly codePage: PosCodePage;
  readonly cut: PrinterCatalogCut;
  readonly qrMode: PrinterCatalogQrMode;
  /**
   * Aus `drawerKick`: nur ein Vorschlag fuer das erste Einrichten. Hat der Chef die Lade bewusst ausgeschaltet, bleibt
   * sie aus; die Kasse ueberschreibt eine getroffene Wahl nie.
   */
  readonly drawerEnabled: boolean;
}

/** Was ein Eintrag beim Einrichten vorschlaegt. */
export interface PrinterCatalogSettings {
  /** Unveraendert als Teil der Geraete-Einstellungen sendbar (setMyRegisterDeviceSettings). */
  readonly device: PrinterCatalogDeviceSettings;
  /**
   * Das Modell kann mehr als eine Papierbreite: `device.paperSize` ist dann nur die Werkseinstellung, und die Kasse
   * bestaetigt die Breite beim ersten Einrichten mit einem Testdruck.
   */
  readonly paperSizeNeedsCheck: boolean;
}

// ------------------------------------------------------------------ Daten

const eingefroren = (e: PrinterCatalogEntry): PrinterCatalogEntry => {
  const test = e.approval.deviceTest;
  return Object.freeze({
    ...e,
    matchNames: Object.freeze([...e.matchNames]),
    paperSizes: Object.freeze([...e.paperSizes]),
    values: Object.freeze({ ...e.values }),
    approval: Object.freeze({
      ...e.approval,
      deviceTest: test && Object.freeze({ ...test, checked: Object.freeze([...test.checked]), checkedPaperSizes: Object.freeze([...test.checkedPaperSizes]) }),
    }),
  });
};

/**
 * Startbestand laut Spec connect-betrieb (Stufe 1), noch ohne Geraetetest und darum nicht freigegeben. Je Eintrag
 * stehen die Werte ausgeschrieben, auch wo sie gleich sind: jeder ist eine eigene Aussage ueber ein Modell und wird
 * einzeln freigegeben.
 *
 * Papierbreiten laut Epson-Datenblatt: TM-m30III, TM-m30II und TM-T20III lassen sich mit der beiliegenden
 * Papierfuehrung auf 58 mm umstellen (dann 420 Punkte, Schrift A 35 Spalten; die Kasse setzt 32 Zeichen), der TM-m10
 * kann nur 58 mm. Bestaetigt ist das erst mit dem Geraetetest.
 *
 * TM-T88VI und TM-T88VII drucken mit 180 dpi (512 Punkte auf 80 mm, Schrift A 42 Spalten); 48 Zeichen passen nicht.
 * Sie bekommen darum das 58-mm-Layout der Kasse (32 Zeichen, die 384 Punkte von `GS W` passen in ihre 512), auch mit
 * 80-mm-Papier, bis es eine Einstellung mit 42 Zeichen gibt.
 */
export const PRINTER_CATALOG: readonly PrinterCatalogEntry[] = Object.freeze(([
  {
    id: 'epson-tm-m30iii', manufacturer: 'Epson', model: 'TM-m30III', matchNames: ['TM-M30III'],
    paperSizes: ['mm58', 'mm80'], nativeCharsPerLine: 48,
    values: { paperSize: 'mm80', charsPerLine: 48, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
  {
    id: 'epson-tm-m30ii', manufacturer: 'Epson', model: 'TM-m30II', matchNames: ['TM-M30II'],
    paperSizes: ['mm58', 'mm80'], nativeCharsPerLine: 48,
    values: { paperSize: 'mm80', charsPerLine: 48, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
  {
    id: 'epson-tm-t20iii', manufacturer: 'Epson', model: 'TM-T20III', matchNames: ['TM-T20III'],
    paperSizes: ['mm58', 'mm80'], nativeCharsPerLine: 48,
    values: { paperSize: 'mm80', charsPerLine: 48, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
  {
    id: 'epson-tm-t88vi', manufacturer: 'Epson', model: 'TM-T88VI', matchNames: ['TM-T88VI'],
    paperSizes: ['mm58'], nativeCharsPerLine: 42,
    values: { paperSize: 'mm58', charsPerLine: 32, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
  {
    id: 'epson-tm-t88vii', manufacturer: 'Epson', model: 'TM-T88VII', matchNames: ['TM-T88VII'],
    paperSizes: ['mm58'], nativeCharsPerLine: 42,
    values: { paperSize: 'mm58', charsPerLine: 32, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
  {
    id: 'epson-tm-m10', manufacturer: 'Epson', model: 'TM-m10', matchNames: ['TM-M10'],
    paperSizes: ['mm58'], nativeCharsPerLine: 35,
    values: { paperSize: 'mm58', charsPerLine: 32, cut: 'partial', drawerKick: true, qrMode: 'escpos', codePage: 'CP1252' },
    approval: { approved: false, deviceTest: null },
  },
] satisfies PrinterCatalogEntry[]).map(eingefroren));

// ------------------------------------------------------------------ Normierung

/** Trenner im normierten Namen. */
const TRENNER = '-';

/** Ein Zeichen ausserhalb von ASCII, das weder Satzzeichen noch Leerraum ist. */
const FREMDES_ZEICHEN = /[^\x00-\x7F\p{P}\p{Z}]/u;

/**
 * Grossbuchstaben und Teile, oder `null` fuer einen Namen mit fremdem Zeichen.
 *
 * Gefaltet wird nur `a-z` zu `A-Z`: `toUpperCase` machte aus „ı“ ein I und aus „ﬀ“ ein FF und damit aus einem fremden
 * Namen womoeglich einen bekannten. Steht danach ein Zeichen ausserhalb von ASCII, das weder Satzzeichen noch
 * Leerraum ist (Ï, é, ®), gilt der Name als unbekannt. Jede Folge anderer Zeichen als `A-Z`/`0-9` wird ein Trenner,
 * am Rand keiner; Leerzeichen, Bindestrich, Unterstrich, Klammer und geschuetzter Bindestrich gelten dabei gleich,
 * damit „tm m30iii“, „TM-m30III“ und „(EPSON TM-m30III)“ (IPP `product`) denselben Namen ergeben.
 *
 * Der Trenner bleibt als ein Zeichen stehen, statt zu verschwinden: TM-T20II-i ist ein eigenes Modell und darf nicht
 * TM-T20III werden. Das traegt nur, wo der Name einen Trenner hat; „TM-T20IIi“ ohne Bindestrich ist von TM-T20III
 * nicht zu unterscheiden (Prueffall).
 */
function inTeilen(text: string): string | null {
  const gross = text.replace(/[a-z]/g, (c) => c.toUpperCase());
  if (FREMDES_ZEICHEN.test(gross)) return null;
  return gross.split(/[^A-Z0-9]+/).filter((t) => t !== '').join(TRENNER);
}

/**
 * Die Hersteller eines Katalogs als Vorsilben (`EPSON-`), laengste zuerst: „Star Micronics“ muss vor „Star“ greifen.
 * Aus den Eintraegen selbst, damit ein neuer Hersteller keine zweite Liste braucht. Gleich lange Vorsilben koennen
 * nicht beide vor demselben Namen stehen, ihre Reihenfolge ist darum gleichgueltig.
 */
function herstellerVorsilben(catalog: readonly PrinterCatalogEntry[]): string[] {
  const vorsilben = new Set<string>();
  for (const e of catalog) {
    const hersteller = inTeilen(e.manufacturer);
    if (hersteller) vorsilben.add(hersteller + TRENNER);
  }
  return [...vorsilben].sort((a, b) => b.length - a.length);
}

/** [inTeilen], dann ohne die erste passende Vorsilbe; `null` ohne Namen oder mit fremdem Zeichen. */
function normiert(model: string | null | undefined, vorsilben: readonly string[]): string | null {
  if (typeof model !== 'string') return null;
  const name = inTeilen(model);
  if (!name) return null;
  const vorsilbe = vorsilben.find((v) => name.startsWith(v));
  return vorsilbe === undefined ? name : name.slice(vorsilbe.length);
}

/**
 * Normierter Modellname, die Hersteller aus `catalog`. `EPSON TM-m30III`, `TM-M30III` und `tm m30iii` ergeben
 * `TM-M30III`; der Hersteller allein (`EPSON`) bleibt stehen.
 */
export function normalizePrinterModel(model: string | null | undefined, catalog: readonly PrinterCatalogEntry[] = PRINTER_CATALOG): string | null {
  return normiert(model, herstellerVorsilben(catalog));
}

// ------------------------------------------------------------------ Erkennen

/**
 * Der freigegebene Eintrag aus `catalog`, an dem `model` erkannt wird, sonst `null`. Ein nicht freigegebener Eintrag
 * verhaelt sich wie ein unbekanntes Modell. Das Ergebnis ist eindeutig, weil kein Name in zwei Eintraegen steht
 * (Prueffall `match_name_ambiguous`).
 */
export function findPrinterCatalogEntry(catalog: readonly PrinterCatalogEntry[], model: string | null | undefined): PrinterCatalogEntry | null {
  const name = normalizePrinterModel(model, catalog);
  if (name === null) return null;
  return catalog.find((e) => e.approval.approved && e.matchNames.includes(name)) ?? null;
}

/**
 * Der freigegebene Katalogeintrag zu einem Modellnamen, wie Connect ihn meldet (mDNS, `GS I`), oder `null` fuer ein
 * unbekanntes Modell. Gross- und Kleinschreibung, ein vorangestelltes `EPSON` und die Art der Trenner zaehlen nicht.
 * `undefined` ist erlaubt, weil Connect `model` im Fund weglaesst, wenn es keines kennt.
 */
export function printerCatalogEntry(model: string | null | undefined): PrinterCatalogEntry | null {
  return findPrinterCatalogEntry(PRINTER_CATALOG, model);
}

/** Was ein Eintrag beim Einrichten vorschlaegt; `drawerKick` wird zu `drawerEnabled`. */
export function printerCatalogSettings(entry: PrinterCatalogEntry): PrinterCatalogSettings {
  const { paperSize, codePage, cut, qrMode, drawerKick } = entry.values;
  return {
    device: { paperSize, codePage, cut, qrMode, drawerEnabled: drawerKick },
    paperSizeNeedsCheck: entry.paperSizes.some((p) => p !== paperSize),
  };
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
  'paper_sizes_invalid',
  'paper_size_not_listed',
  'paper_size_too_wide',
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

/** Ein Geraetetest belegt den Eintrag ganz: Kopf ausgefuellt, jedes Wertfeld und jede Breite geprueft. */
const vollstaendig = (t: PrinterDeviceTest, e: PrinterCatalogEntry): boolean =>
  TAG.test(t.date) && t.connectVersion !== '' && t.firmware !== '' && t.testedBy !== ''
  && PRINTER_CATALOG_VALUE_FIELDS.every((f) => t.checked.includes(f))
  && e.paperSizes.every((p) => t.checkedPaperSizes.includes(p));

/**
 * Alle Funde in einem Katalog; leer = gueltig. Die einzige Stelle, an der die Regeln stehen. Der Test ruft sie fuer den
 * ausgelieferten Katalog und die Prueffaelle; ein Fund macht ihn rot, statt zur Laufzeit still zu wirken.
 */
export function printerCatalogProblems(catalog: readonly PrinterCatalogEntry[]): PrinterCatalogProblem[] {
  const probleme: PrinterCatalogProblem[] = [];
  const vorsilben = herstellerVorsilben(catalog);
  const ids = new Set<string>();
  /** Name -> Index des Eintrags, der ihn zuerst fuehrt. */
  const namen = new Map<string, number>();
  catalog.forEach((e, index) => {
    const melde = (reason: PrinterCatalogProblemReason): void => { probleme.push({ id: e.id, reason }); };
    if (ids.has(e.id)) melde('duplicate_id');
    ids.add(e.id);
    if (e.matchNames.length === 0) melde('match_names_missing');
    for (const name of e.matchNames) {
      if (normiert(name, vorsilben) !== name) melde('match_name_not_normalized');
      const erster = namen.get(name);
      if (erster === undefined) namen.set(name, index);
      else if (erster !== index) melde('match_name_ambiguous');
    }
    // Der eigene Modellname muss den Eintrag finden; sonst passen Anzeige und Erkennung nicht zusammen (Tippfehler).
    const eigenerName = normiert(e.model, vorsilben);
    if (eigenerName === null || !e.matchNames.includes(eigenerName)) melde('model_not_matched');
    // Eine feste Reihenfolge ohne Doppel haelt Vertrag und Vergleich eindeutig.
    if (e.paperSizes.join() !== PAPER_SIZE.filter((p) => e.paperSizes.includes(p)).join()) melde('paper_sizes_invalid');
    if (!e.paperSizes.includes(e.values.paperSize)) melde('paper_size_not_listed');
    // Eine Breite, deren Layout mehr Zeichen setzt, als der Drucker hat, bricht jede Zeile um (TM-T88: 48 auf 42).
    if (e.paperSizes.some((p) => CHARS_PER_PAPER_SIZE[p] > e.nativeCharsPerLine)) melde('paper_size_too_wide');
    // Die Typen schliessen beides schon aus; die Pruefung gilt Daten, die als JSON kommen (Prueffaelle des Vertrags).
    if (!(PRINTER_CATALOG_CUTS as readonly string[]).includes(e.values.cut)) melde('cut_not_allowed');
    if (!(PRINTER_CATALOG_QR_MODES as readonly string[]).includes(e.values.qrMode)) melde('qr_mode_not_allowed');
    if (CHARS_PER_PAPER_SIZE[e.values.paperSize] !== e.values.charsPerLine) melde('chars_per_line_mismatch');
    const test = e.approval.deviceTest;
    if (e.approval.approved && test === null) melde('device_test_missing');
    if (test !== null && !vollstaendig(test, e)) melde('device_test_incomplete');
  });
  return probleme;
}
