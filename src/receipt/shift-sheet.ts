import { KasseneckValidationError } from '../client/errors.js';
import { labelText, LABELS, type LabelKey } from '../pos/texte.js';
import { bewegungsBon, schichtBon } from '../pos/schicht-lesen.js';
import { shiftTipLines } from '../pos/schicht.js';
import type { CashMovementReceipt, Denominations, ShiftSummaryReceipt } from '../pos/schicht-typen.js';
import type { PosPaperSize } from '../printing/escpos.js';
import { parseServerTimeStamp, toViennaWallClock } from '../vienna-time.js';
import { CURRENT_LAYOUT_RULESET, formatCents, type LayoutColumnsLine, type LayoutLine, type LayoutTextLine, type ReceiptLayout } from './layout.js';

/**
 * Bons der Schicht als Zeilenmodell: Z-Bon (`shift_close`), X-Bon
 * (`shift_interim`) und Kassenbewegung (`cash_movement`), aus den Bon-Daten
 * der Antwort (`receipt` von `closeMyShift`, `getMyShiftReport`,
 * `recordMyCashMovement`). Gezeichnet wird wie jeder Beleg: Raster, Blatt,
 * ESC/POS, ePOS.
 *
 * Kein Registrierkassenbeleg: keine Signatur, kein QR, kein DEP. Jeder Bon
 * endet mit „Kein Registrierkassenbeleg“.
 *
 * **Blind** (ohne Recht `cashView`) sind Soll, Ist, Differenz, Barumsatz und
 * die gezaehlte Stueckelung `null`: ihre Zeilen fallen weg, nie steht dort
 * „0,00“ oder ein Strich. Dasselbe gilt fuer jede andere leere Angabe.
 */

export interface ShiftReceiptLayoutOptions {
  /** Papierbreite fuer den Bauplan; Vorgabe `mm58`. Die Druckbreite waehlt der Druckweg. */
  paperSize?: PosPaperSize;
}

const PAPIER: readonly string[] = ['mm58', 'mm80'];

function papier(name: string, options: ShiftReceiptLayoutOptions): PosPaperSize {
  for (const k of Object.keys(options)) {
    if (k !== 'paperSize') throw new KasseneckValidationError(name, `Unbekannte Option "${k}"`, 'request');
  }
  const p = options.paperSize ?? 'mm58';
  if (!PAPIER.includes(p)) throw new KasseneckValidationError(name, 'paperSize: erlaubt sind mm58, mm80', 'request');
  return p;
}

// ---------------------------------------------------------------- Bauteile

function text(t: string, align: LayoutTextLine['align'] = 'left', bold = false): LayoutTextLine {
  return { kind: 'text', text: t, align, bold };
}

/** Zwei Spalten: Name links, Wert rechts. */
function paar(links: string, rechts: string, linksBreite: number): LayoutColumnsLine {
  return {
    kind: 'columns',
    columns: [
      { text: links, width: linksBreite, align: 'left' },
      { text: rechts, width: 12 - linksBreite, align: 'right' },
    ],
  };
}

/** Kopfzeilen (Kasse, Zeiten, Namen): breiter Wert fuer „25.09.2026 17:00“. */
const kopf = (links: string, rechts: string): LayoutColumnsLine => paar(links, rechts, 5);
/** Betragszeilen: breiter Name, schmaler Betrag. */
const betrag = (links: string, cents: number): LayoutColumnsLine => paar(links, formatCents(cents), 8);
const anzahl = (links: string, n: number): LayoutColumnsLine => paar(links, String(n), 8);

const regel = (): LayoutLine => ({ kind: 'rule', char: '-' });

/** Zeit in Wien als `DD.MM.YYYY HH:mm`; unlesbar -> `null` (die Zeile faellt weg, der Bon bleibt). */
function zeit(iso: string | null): string | null {
  if (iso === null) return null;
  try {
    const t = toViennaWallClock(parseServerTimeStamp(iso));
    const zwei = (n: number): string => String(n).padStart(2, '0');
    return `${zwei(t.day)}.${zwei(t.month)}.${t.year} ${zwei(t.hour)}:${zwei(t.minute)}`;
  } catch {
    return null;
  }
}

function beschriftung(schluessel: string, sonst: string): string {
  return Object.prototype.hasOwnProperty.call(LABELS, schluessel) ? labelText(schluessel as LabelKey) : sonst;
}

const artText = (art: string): string => beschriftung(`cash_movement.type_${art}`, art);
const ortText = (ort: string): string => beschriftung(`shift_receipt.location_${ort}`, ort);

/** Zahlart unbar: `card` wie am Beleg „Kartenzahlung“, sonst der Wert, wie er kommt. */
function zahlartText(methode: string): string {
  return methode === 'card' ? labelText('payment_method.card') : methode;
}

/** Je Schein und Muenze eine eingerueckte Zeile, vom groessten Wert abwaerts; Anzahl 0 faellt weg. */
function stueckelungZeilen(karte: Denominations | null): LayoutLine[] {
  if (karte === null) return [];
  return Object.entries(karte)
    .map(([wert, n]) => [Number(wert), n] as const)
    .filter(([wert, n]) => n > 0 && Number.isSafeInteger(wert))
    .sort((a, b) => b[0] - a[0])
    .map(([wert, n]) => betrag(`  ${n} x ${formatCents(wert)}`, wert * n));
}

function wennText(zeilen: LayoutLine[], links: string, wert: string | null): void {
  if (wert !== null && wert !== '') zeilen.push(kopf(links, wert));
}

function kopfblock(zeilen: LayoutLine[], bon: ShiftSummaryReceipt | CashMovementReceipt, titel: LabelKey): void {
  zeilen.push({ kind: 'banner', text: labelText(titel), tone: 'receipt_type' });
  if (bon.business.name) zeilen.push(text(bon.business.name, 'center', true));
  wennText(zeilen, labelText('shift_receipt.cashregister'), bon.cashregister.name);
  wennText(zeilen, labelText('shift_receipt.drawer'), bon.drawer.name);
}

// ------------------------------------------------------------------ Bons

/**
 * Z-Bon bzw. X-Bon der Schicht. Titel nach `kind`: „Schichtabschluss“ oder
 * „Zwischenbericht“. Wirft (`KasseneckValidationError`, `scope: 'request'`),
 * wenn die Bon-Daten keine Z- oder X-Bon-Daten sind.
 */
export function shiftReceiptLayout(receipt: ShiftSummaryReceipt, options: ShiftReceiptLayoutOptions = {}): ReceiptLayout {
  const name = 'shiftReceiptLayout';
  const paperSize = papier(name, options);
  const bon = schichtBon({ name, pfad: 'receipt', scope: 'request' }, receipt);
  const zeilen: LayoutLine[] = [];
  kopfblock(zeilen, bon, bon.kind === 'shift_close' ? 'shift_receipt.title_close' : 'shift_receipt.title_interim');
  zeilen.push(kopf(labelText('shift_receipt.shift'), labelText('shift_receipt.number', { number: bon.shift.number })));
  const von = labelText('shift_receipt.by');
  wennText(zeilen, labelText('shift_receipt.opened'), zeit(bon.shift.openedAt));
  wennText(zeilen, von, bon.shift.openedByName);
  wennText(zeilen, labelText('shift_receipt.closed'), zeit(bon.shift.closedAt));
  wennText(zeilen, von, bon.shift.closedByName);

  // Bargeld: Startgeld, Barumsatz, Bewegungen, Soll, Ist, Differenz.
  zeilen.push(regel());
  const start = labelText(bon.openingFloatTakenOver ? 'shift_receipt.opening_float_taken_over' : 'shift_receipt.opening_float');
  if (bon.openingFloatCents !== null) zeilen.push(betrag(start, bon.openingFloatCents));
  else if (bon.openingFloatTakenOver) zeilen.push(text(start));
  zeilen.push(...stueckelungZeilen(bon.openingDenominations));
  if (bon.cashSalesCents !== null) zeilen.push(betrag(labelText('shift_receipt.cash_sales'), bon.cashSalesCents));
  if (bon.cashCancellationsCents !== null) zeilen.push(betrag(labelText('shift_receipt.cash_cancellations'), bon.cashCancellationsCents));
  if (bon.movements.length > 0) {
    zeilen.push(text(labelText('shift_receipt.movements'), 'left', true));
    for (const m of bon.movements) {
      zeilen.push(betrag(`${labelText('shift_receipt.number', { number: m.number })} ${artText(m.type)}`, m.amountCents));
      if (m.note) zeilen.push(text(`  ${m.note}`));
    }
  }
  if (bon.expectedCents !== null) zeilen.push(betrag(labelText('shift_receipt.expected'), bon.expectedCents));
  if (bon.countedCents !== null) {
    zeilen.push(betrag(labelText('shift_receipt.counted'), bon.countedCents));
    zeilen.push(...stueckelungZeilen(bon.countedDenominations));
  }
  if (bon.differenceCents !== null) zeilen.push(betrag(labelText('shift_receipt.difference'), bon.differenceCents));
  if (bon.comment) zeilen.push(text(`${labelText('shift_receipt.comment')}: ${bon.comment}`));

  // Zur Information: unbar, Zaehler.
  zeilen.push(regel());
  if (bon.nonCashByMethod.length > 0) {
    zeilen.push(text(labelText('shift_receipt.non_cash'), 'left', true));
    for (const u of bon.nonCashByMethod) zeilen.push(betrag(zahlartText(u.method), u.cents));
  }
  zeilen.push(anzahl(labelText('shift_receipt.receipts'), bon.receiptCount));
  zeilen.push(anzahl(labelText('shift_receipt.cancellations'), bon.cancellationCount));
  zeilen.push(anzahl(labelText('shift_receipt.openings_without_sale'), bon.openingsWithoutSale));

  // Trinkgeld je Mitarbeiter (shiftTipLines): verdient immer, ueber Lohn, schon genommen und offen
  // nur ungleich 0; wer ueberall 0 hat, entfaellt, ohne Mitarbeiter auch die Ueberschrift.
  const trinkgeld = bon.tips.map((t) => ({ t, z: shiftTipLines(t) })).filter(({ z }) => z.length > 0);
  if (trinkgeld.length > 0) {
    zeilen.push(regel());
    zeilen.push(text(labelText('shift_receipt.tips'), 'left', true));
    for (const { t, z } of trinkgeld) {
      zeilen.push(text(t.name ?? t.registerUserId));
      for (const zeile of z) zeilen.push(betrag(`  ${zeile.text}`, zeile.cents));
    }
  }
  return { lines: zeilen, paperSize, ruleset: CURRENT_LAYOUT_RULESET };
}

/**
 * Bon einer Kassenbewegung (Einzahlung, Auszahlung, Umbuchung). Wirft
 * (`KasseneckValidationError`, `scope: 'request'`), wenn die Bon-Daten keine
 * Kassenbewegung sind.
 */
export function cashMovementLayout(receipt: CashMovementReceipt, options: ShiftReceiptLayoutOptions = {}): ReceiptLayout {
  const name = 'cashMovementLayout';
  const paperSize = papier(name, options);
  const bon = bewegungsBon({ name, pfad: 'receipt', scope: 'request' }, receipt);
  const m = bon.movement;
  const zeilen: LayoutLine[] = [];
  kopfblock(zeilen, bon, 'shift_receipt.title_movement');
  if (bon.shift !== null) zeilen.push(kopf(labelText('shift_receipt.shift'), labelText('shift_receipt.number', { number: bon.shift.number })));
  zeilen.push(regel());
  zeilen.push(kopf(labelText('shift_receipt.movement_number'), String(m.number)));
  zeilen.push(kopf(labelText('shift_receipt.type'), artText(m.type)));
  zeilen.push(betrag(labelText('shift_receipt.amount'), m.amountCents));
  wennText(zeilen, labelText('shift_receipt.location'), m.location === null ? null : ortText(m.location));
  wennText(zeilen, labelText('shift_receipt.recipient'), m.recipientName);
  wennText(zeilen, labelText('shift_receipt.target_drawer'), m.targetDrawerName);
  wennText(zeilen, labelText('shift_receipt.note'), m.note);
  wennText(zeilen, labelText('shift_receipt.operator'), m.byName);
  wennText(zeilen, labelText('shift_receipt.time'), zeit(m.at));
  return { lines: zeilen, paperSize, ruleset: CURRENT_LAYOUT_RULESET };
}
