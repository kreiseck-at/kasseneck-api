import { KasseneckApiError } from '../client/errors.js';
import { bekannterCode, feldfehlerVon } from '../client/fehlercodes.js';
import type { Receipt } from './receipt.js';
import type { ReceiptPaymentInput } from './receipt-payment.js';
import { isTipItem, type ReceiptItem } from './receipt-item.js';

/**
 * Storno-Metadaten — Zwilling von `functions/storno-core.js`.
 *
 * Ein Storno ist ein eigener, signierter Beleg vom Typ `cancellation` mit
 * negativen Betraegen. Was NICHT signiert ist und hier als Metadaten laeuft:
 * der Bezug zum Original (`cancellationOf`, `cancellationReason` am
 * Storno-Beleg) und die Liste der Stornos am Original (`cancellations`), aus
 * der sich die Restmengen ergeben.
 */

/**
 * Grund-Katalog: Codes wie unter `/v3` (Katalog `STORNO_GRUND` des
 * Backends), Anzeigetext fuer Bon und Bedienung. Der Anzeigetext bleibt
 * deutsch, er steht so am Beleg.
 */
export const CANCELLATION_REASONS = Object.freeze({
  input_error: 'Fehleingabe',
  customer_cancelled: 'Kunde hat storniert',
  wrong_payment_method: 'Falsche Zahlart',
  duplicate: 'Doppelt erfasst',
  other: 'Sonstiges',
} as const);

export type CancellationReason = keyof typeof CANCELLATION_REASONS;

export function isCancellationReason(value: unknown): value is CancellationReason {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CANCELLATION_REASONS, value);
}

/**
 * Rueckgabe-Wahl beim Storno und bei der Gutschrift (Lager-Kern Stufe 2,
 * Katalog `RUECKGABE` des Backends): `restock` zurueck ins Lager (Vorgabe des
 * Servers), `defective` als defekt ins Lager, `disposed` entsorgt. Wirkt nur
 * an Positionen mit `articleId`; alle anderen bucht der Server nie und meldet
 * dafuer auch keinen Fehler.
 */
export const RETURN_DISPOSITIONS = Object.freeze(['restock', 'defective', 'disposed'] as const);

export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];

export function isReturnDisposition(value: unknown): value is ReturnDisposition {
  return typeof value === 'string' && (RETURN_DISPOSITIONS as readonly string[]).includes(value);
}

/**
 * Stabile Fehlercodes von `cancelReceipt` unter `/v3` (Vokabular
 * `errorCodes.cancellation`, gleiche Reihenfolge). Das Backend legt sie bei
 * jedem fachlichen Fehler als `code` neben die Meldung; das Paket reicht sie
 * als [KasseneckApiError.code] durch. **Entscheide am Code, nie am Text:**
 * die deutsche Meldung darf sich aendern, der Code nicht.
 *
 * Formfehler an `payments` selbst melden die Codes aus
 * [PAYMENT_ERROR_CODES]. `cancellation_outcome_unknown` heisst: der Storno
 * ist moeglicherweise gebucht (`outcome: 'unknown'`). Nie wiederholen,
 * sondern das Original nachlesen (`getReceipt`, `cancellations[]`).
 *
 * Dahinter (ab 1.0) die Codes, die Anmeldung und Rand auf diesem Endpunkt
 * erzeugen koennen: `errorCodes.auth` ohne die sieben des Partner-Zugangs und
 * `errorCodes.edge` (`not_found`, `dialect_mismatch`, `response_translation_failed`
 * ...), zuletzt die Codes des Pakets (`route_missing`, `response_unreadable`).
 * Die Zahlungscodes (`payment_method_not_supported` ...) stehen in
 * [PAYMENT_ERROR_CODES]. Ein Code ausserhalb bleibt ueber
 * `KasseneckApiError.code` lesbar.
 */
export const CANCELLATION_ERROR_CODES = Object.freeze([
  'receipt_not_found',                      // Original fehlt oder gehoert nicht zu dieser Kasse
  'receipt_type_not_cancellable',           // Original ist selbst Storno-, Null- oder Startbeleg
  'training_receipt',                       // Trainingsbelege werden nicht storniert
  'already_cancelled',                      // keine Restmenge mehr
  'invalid_line',                           // Index unbekannt oder doppelt
  'quantity_exceeds_remaining',             // Menge nicht ganzzahlig >= 1 oder groesser als der Rest
  'unknown_reason',                         // reason fehlt oder nicht im Katalog
  'note_too_long',                          // note laenger als 200 Zeichen
  'invalid_items',                          // items ist keine Liste
  'cashregister_not_assigned',              // Kassen-Benutzer darf diese Kasse nicht
  'not_permitted',                          // Kassen-Benutzer ohne Storno-Recht
  'own_receipts_only',                      // Recht "eigene", fremder Beleg
  'cashregister_incomplete',                // api_key/token fehlen am Konto bzw. an der Kasse
  'cancellation_failed',                    // der Storno-Beleg selbst wurde abgelehnt (z. B. Signatur)
  'cancellation_payments_required',         // Teilstorno eines Belegs mit mehreren Zahlungen ohne payments
  'cancellation_refund_exceeds_payment',    // Rueckzahlungen auf eine Zahlung uebersteigen deren Rest
  'cancellation_refund_reference_required', // Karten-Rueckzahlung ohne refundOf einer Kartenzahlung
  'cancellation_refund_reference_unknown',  // refundOf nennt keine Zahlung des Originals
  'cancellation_outcome_unknown',           // Ausgang unklar: nachlesen, nie wiederholen
  'invalid_return_disposition',             // Rueckgabe-Wahl nicht restock, defective oder disposed (Lager)
  // Trinkgeld beim Storno (refundTip/tipRefundSource, Schichten-Spec Nachtrag 5)
  'tip_refund_conflict',                    // Wahl passt nicht zum Storno (Trinkgeld trotz Nein, Quelle ohne Trinkgeld)
  'invalid_tip_refund_source',              // tipRefundSource nicht drawer oder employee
  'tip_refund_source_requires_cash',        // eine Quelle nur, wenn das Bargeld des Stornos das Trinkgeld deckt
  // Anmeldung und Rand (errorCodes.auth ohne Partner-Zugang, errorCodes.edge)
  'account_not_found',
  'action_confirmation_required',
  'admin_required',
  'api_not_approved',
  'app_check_invalid',
  'app_check_missing',
  'cashregister_not_found',
  'cashregister_token_invalid',
  'cashregister_token_missing',
  'dialect_mismatch',
  'internal_translation_error',
  'live_not_enabled',
  'method_not_allowed',
  'mfa_required',
  'not_found',
  'password_change_required',
  'register_user_no_business',
  'register_user_not_allowed',
  'register_user_not_found',
  'response_translation_failed',
  'second_factor_required',
  'session_expired',
  'session_other_cashregister',
  'unauthorized',
  'user_disabled',
  'user_verification_failed',
  'validation',
  // Codes des Pakets (CLIENT_ERROR_CODES)
  'route_missing',
  'response_unreadable',
] as const);

export type CancellationErrorCode = (typeof CANCELLATION_ERROR_CODES)[number];

export function isCancellationErrorCode(value: unknown): value is CancellationErrorCode {
  return typeof value === 'string' && (CANCELLATION_ERROR_CODES as readonly string[]).includes(value);
}

const CANCELLATION_BEKANNT: ReadonlySet<string> = new Set(CANCELLATION_ERROR_CODES);

/** Der Code eines geworfenen Fehlers, wenn er in [CANCELLATION_ERROR_CODES] steht; sonst `undefined`. */
export function cancellationErrorCode(error: unknown): CancellationErrorCode | undefined {
  return bekannterCode<CancellationErrorCode>(error, CANCELLATION_BEKANNT);
}

/**
 * Kurzform fuer `catch (e) { if (isCancellationError(e, 'already_cancelled')) … }`.
 * Ohne `code`: traegt der Fehler ueberhaupt einen Code aus [CANCELLATION_ERROR_CODES]?
 */
export function isCancellationError(error: unknown, code?: CancellationErrorCode): error is KasseneckApiError {
  const gefunden = cancellationErrorCode(error);
  return gefunden !== undefined && (code === undefined || gefunden === code);
}

/** Stornostand eines Belegs in der Belegliste (Katalog `STORNO_STAND`). */
export const CANCELLATION_STATUSES = Object.freeze(['none', 'partial', 'full'] as const);

export type CancellationStatus = (typeof CANCELLATION_STATUSES)[number];

/** Bezug eines Storno-Belegs auf sein Original. */
export interface CancellationOf {
  receiptId: string;
  fullReceiptId: string | null;
  /**
   * Zeitstempel des Originals (Server-Format, Wiener Wanduhr) — das Layout
   * nennt ihn im Kopfblock des Storno-Bons („vom 11.08.2026, 09:02 Uhr").
   * Fehlt bei Altbelegen; dann bleibt die Zeile weg.
   */
  timeStamp?: string;
}

/** Eine stornierte Position: Index im Original und Menge, an Artikelzeilen die Rueckgabe-Wahl. */
export interface CancellationItem {
  index: number;
  quantity: number;
  /** Wohin die Ware dieser Position geht; fehlt = Vorgabe des Aufrufs bzw. `restock`. */
  returnDisposition?: ReturnDisposition;
}

/**
 * Eintrag in `cancellations[]` am Original. `pending` = Reservierung, die
 * das Backend vor der Buchung setzt und danach ersetzt; sie zaehlt fuer die
 * Restmengen nur, solange sie frisch ist (siehe [remainingQuantities]).
 */
export interface Cancellation {
  receiptId?: string;
  pending?: boolean;
  at: number;
  by: string | null;
  note: string | null;
  items: CancellationItem[];
  /**
   * Rabattgutschein-Ausgleich, den DIESER Storno gewaehrt hat — Cent je
   * Steuertopf des Backends (`amountRateStandard`, `amountRateReduced1`, …).
   * Ein Rabattgutschein ist am Original schon in den Umsatz eingerechnet;
   * jeder Storno nimmt ihn anteilig der stornierten Menge zurueck (bei 3 Stueck
   * a 10 EUR mit 6 EUR Rabatt: 2,00 je Stueck). Fehlt das Feld, hat der Eintrag
   * nichts gewaehrt (Altbestand vor dieser Regel) — der naechste Storno holt nach.
   */
  promoAdjustmentCents?: Record<string, number>;
  /**
   * Rueckzahlung je Zahlung, die DIESER Storno-Eintrag auf eine Zahlung des
   * Originals verbucht hat (`refundOf`) -- Zahlungs-ID auf positive Cent,
   * Zwilling von `functions/gemeinsam/storno-core.js` `refundedByPayment`.
   * Ueber alle Eintraege darf je Zahlung nie mehr zurueck, als bezahlt wurde
   * (siehe dort `restJeZahlung`). Ein Eintrag ohne das Feld (vor dieser Regel
   * oder ohne Zahlungsmodell gebucht) zaehlt dabei 0 je Zahlung. Auch am
   * `pending`-Eintrag vorhanden, sobald reserviert wird.
   */
  refundedByPayment?: Record<string, number>;
}

/** Ab wann eine liegengebliebene Reservierung nicht mehr zaehlt (wie im Backend). */
export const CANCELLATION_RESERVATION_MS = 120_000;

/**
 * Restmenge je Position eines Belegs — Belegmenge minus alles, was storniert
 * oder frisch reserviert ist; nie unter null. Fuer den Storno-Dialog der Kasse
 * (Reste anzeigen, bevor der Server gefragt wird). Die Wahrheit hat der Server.
 */
export function remainingQuantities(receipt: Receipt, nowMs: number = Date.now()): number[] {
  const rest = receipt.items.map((item) => item.quantity);
  for (const eintrag of receipt.cancellations ?? []) {
    if (eintrag.pending === true && eintrag.at < nowMs - CANCELLATION_RESERVATION_MS) continue;
    for (const pos of eintrag.items) {
      if (Number.isInteger(pos.index) && pos.index >= 0 && pos.index < rest.length) {
        rest[pos.index] = Math.max(0, (rest[pos.index] ?? 0) - pos.quantity);
      }
    }
  }
  return rest;
}

/** Ein Feldfehler aus `data.errors[]` einer `validation`-Antwort von `cancelReceipt`. */
export interface CancellationFieldError {
  field: string;
  message: string;
}

/** Die Feldfehler einer `validation`-Antwort; leer, wenn es keine sind. */
export function cancellationFieldErrors(error: unknown): CancellationFieldError[] {
  return feldfehlerVon(error);
}

// --- Trinkgeld beim Storno (Schichten-Spec, Nachtrag 5, R56–R58) --------------------------------
//
// Enthaelt ein Beleg noch nicht storniertes Mitarbeiter-Trinkgeld, fragt die Kasse „Trinkgeld auch
// zurueckgeben?“ (`refundTip`) und bei Barrueckgabe „Woher kommt das Trinkgeld zurueck?“
// (`tipRefundSource`). Die Regeln stehen hier, damit Web-Kasse und Kassen-App dasselbe fragen;
// Zwilling von functions/gemeinsam/storno-core.js (wunschMitTrinkgeld, trinkgeldQuelleAnwenden).
// Faelle mit dem Dart-Zwilling: fixtures/cancellation-tip-cases.json.

/**
 * Woher das Trinkgeld beim Storno zurueckkommt: `drawer` – die Lade zahlt es aus („offen“ sinkt,
 * kann negativ werden); `employee` – die Mitarbeiterin gibt es selbst („verdient“ und „schon
 * genommen“ sinken, die Lade bleibt unberuehrt). Nur bei Barrueckgabe.
 */
export const TIP_REFUND_SOURCES = Object.freeze(['drawer', 'employee'] as const);

export type TipRefundSource = (typeof TIP_REFUND_SOURCES)[number];

export function isTipRefundSource(value: unknown): value is TipRefundSource {
  return typeof value === 'string' && (TIP_REFUND_SOURCES as readonly string[]).includes(value);
}

/** Barzahlarten -- Zwilling von `BAR_ZAHLARTEN` (functions/gemeinsam/tip-core.js). */
const BAR_ZAHLARTEN: readonly string[] = ['cash', 'uberCash', 'boltCash'];

/** Zahlart als Nutzlast-Schluessel (Enum-Objekt oder Text). */
function zahlartWert(m: unknown): string {
  if (m !== null && typeof m === 'object' && typeof (m as { value?: unknown }).value === 'string') return (m as { value: string }).value;
  return typeof m === 'string' ? m : '';
}

const istMitarbeiterTrinkgeld = (item: ReceiptItem): boolean => isTipItem(item) && item.recipient?.owner !== true;

/**
 * Hatte die Mitarbeiterin dieses Trinkgeld schon in der Hand (sofort erhalten, mit Empfaenger)?
 * Ohne Merkmal (Altbestand) gilt wie im Backend: bar = erhalten, sonst nicht.
 */
function hatteSie(item: ReceiptItem, receipt: Receipt): boolean {
  if (!item.recipient?.registerUserId) return false;
  if (typeof item.receivedImmediately === 'boolean') return item.receivedImmediately;
  return BAR_ZAHLARTEN.includes(zahlartWert(item.paymentMethod ?? receipt.paymentMethod));
}

/** Indizes des noch nicht stornierten Mitarbeiter-Trinkgelds mit ihrem Rest. */
function offenesTrinkgeld(receipt: Receipt, nowMs: number): Array<{ index: number; quantity: number }> {
  const rest = remainingQuantities(receipt, nowMs);
  return receipt.items
    .map((item, index) => ({ item, index, quantity: rest[index] ?? 0 }))
    .filter(({ item, quantity }) => quantity > 0 && istMitarbeiterTrinkgeld(item))
    .map(({ index, quantity }) => ({ index, quantity }));
}

/**
 * Noch nicht storniertes Mitarbeiter-Trinkgeld in Cent. Groesser 0 heisst: das Storno fragt
 * „Trinkgeld auch zurueckgeben?“ (auch beim Teilstorno). Inhaber-Trinkgeld ist Umsatz und folgt
 * der Ware -- dafuer gibt es keine Frage.
 */
export function openStaffTipCents(receipt: Receipt, nowMs: number = Date.now()): number {
  return offenesTrinkgeld(receipt, nowMs).reduce((s, { index, quantity }) => s + quantity * (receipt.items[index]?.priceCents ?? 0), 0);
}

/**
 * Die Positionen, die nach der Antwort auf „Trinkgeld auch zurueckgeben?“ hinausgehen -- dieselbe
 * Regel wie im Backend. `items` fehlt = ganzer Beleg.
 * - Ja: zum Teilstorno kommt das offene Trinkgeld dazu; der ganze Beleg bleibt `undefined`.
 * - Nein: ohne das Mitarbeiter-Trinkgeld; der ganze Beleg wird zur Liste aller Restmengen ausser dem
 *   Trinkgeld (leer = nichts mehr zu stornieren). Ein Beleg ohne Mitarbeiter-Trinkgeld bleibt, wie er ist.
 */
export function cancellationItemsForTip(
  receipt: Receipt,
  items: readonly CancellationItem[] | undefined,
  refundTip: boolean,
  nowMs: number = Date.now(),
): CancellationItem[] | undefined {
  const trinkgeld = new Set(receipt.items.map((item, i) => (istMitarbeiterTrinkgeld(item) ? i : -1)).filter((i) => i >= 0));
  if (trinkgeld.size === 0) return items === undefined ? undefined : [...items];
  if (refundTip) {
    if (items === undefined) return undefined;
    const genannt = new Set(items.map((x) => x.index));
    return [...items, ...offenesTrinkgeld(receipt, nowMs).filter((x) => !genannt.has(x.index))];
  }
  if (items !== undefined) return items.filter((x) => !trinkgeld.has(x.index));
  const rest = remainingQuantities(receipt, nowMs);
  return rest.map((quantity, index) => ({ index, quantity })).filter((x) => x.quantity > 0 && !trinkgeld.has(x.index));
}

/**
 * Was dieses Storno bar zurueckgibt (positiv, Cent): mit Rueckzahlungen deren Barteil; ohne
 * (der Server spiegelt die eine Zahlung des Originals) alles, wenn das Original bar bezahlt war.
 * Bei mehreren Zahlungen ohne Angabe 0 -- dort schickt die Kasse die Rueckzahlungen immer mit.
 */
export function cancellationCashRefundCents(
  receipt: Receipt,
  payments: readonly ReceiptPaymentInput[] | undefined,
  dueCents: number,
): number {
  if (payments !== undefined) {
    return payments.reduce((s, z) => (zahlartWert(z.method) === 'cash' ? s - z.amountCents : s), 0);
  }
  const zahlungen = receipt.payments ?? [];
  if (zahlungen.length > 1) return 0;
  const methode = zahlungen.length === 1 ? zahlartWert(zahlungen[0]!.method) : zahlartWert(receipt.paymentMethod);
  return methode === 'cash' ? dueCents : 0;
}

/**
 * Fragt das Storno nach „Ja“ auch „Woher kommt das Trinkgeld zurueck?“ – nur, wenn das Bargeld des
 * Stornos (`cashRefundCents`, siehe [cancellationCashRefundCents]) das offene Mitarbeiter-Trinkgeld
 * deckt und die Mitarbeiterin wenigstens eines davon schon hatte. Bei Kartenrueckgabe geht es auf
 * die Karte zurueck; ueber Lohn behaltenes Trinkgeld kommt immer aus der Lade.
 */
export function asksTipRefundSource(receipt: Receipt, cashRefundCents: number, nowMs: number = Date.now()): boolean {
  const offen = offenesTrinkgeld(receipt, nowMs);
  if (offen.length === 0) return false;
  if (!offen.some(({ index }) => hatteSie(receipt.items[index]!, receipt))) return false;
  return cashRefundCents >= openStaffTipCents(receipt, nowMs);
}
