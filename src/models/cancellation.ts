import type { Receipt } from './receipt.js';

/**
 * Storno-Metadaten — Zwilling von `functions/storno-core.js`.
 *
 * Ein Storno ist ein eigener, signierter Beleg vom Typ `cancellation` mit
 * negativen Betraegen. Was NICHT signiert ist und hier als Metadaten laeuft:
 * der Bezug zum Original (`cancellationOf`, `cancellationReason` am
 * Storno-Beleg) und die Liste der Stornos am Original (`cancellations`), aus
 * der sich die Restmengen ergeben.
 */

/** Grund-Katalog: Codes wie im Backend, Anzeigetext fuer Bon und Bedienung. */
export const CANCELLATION_REASONS = Object.freeze({
  fehleingabe: 'Fehleingabe',
  kunde_storniert: 'Kunde hat storniert',
  falsche_zahlart: 'Falsche Zahlart',
  doppelt_erfasst: 'Doppelt erfasst',
  sonstiges: 'Sonstiges',
} as const);

export type CancellationReason = keyof typeof CANCELLATION_REASONS;

export function isCancellationReason(value: unknown): value is CancellationReason {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CANCELLATION_REASONS, value);
}

/**
 * Stabile Fehlercodes von `cancelReceipt` — Zwilling von
 * `functions/storno-core.js` STORNO_FEHLERCODES. Das Backend legt sie bei
 * jedem fachlichen Fehler als `code` neben die Meldung; das Paket reicht sie
 * als [KasseneckApiError.code] durch. **Entscheide am Code, nie am Text** —
 * die deutsche Meldung darf sich aendern, der Code nicht.
 *
 * Nur Auth-/Parameterfehler (Sitzung abgelaufen, Pflichtfeld fehlt) kommen
 * ohne Code; dort bleibt `code` undefined.
 */
export const CANCELLATION_ERROR_CODES = [
  'beleg_nicht_gefunden',        // Original fehlt oder gehoert nicht zu dieser Kasse
  'belegart_nicht_stornierbar',  // Original ist selbst Storno-, Null- oder Startbeleg
  'trainingsbeleg',              // Trainingsbelege werden nicht storniert
  'bereits_storniert',           // keine Restmenge mehr (auch beim positionslosen Beleg)
  'position_ungueltig',          // Index unbekannt oder doppelt
  'menge_ueber_rest',            // Menge nicht ganzzahlig >= 1 oder groesser als der Rest
  'grund_unbekannt',             // reason fehlt oder nicht im Katalog
  'anmerkung_zu_lang',           // note laenger als 200 Zeichen
  'items_ungueltig',             // items ist keine Liste
  'kasse_nicht_zugewiesen',      // Register-Benutzer darf diese Kasse nicht
  'keine_berechtigung',          // Register-Benutzer ohne Storno-Recht
  'nur_eigene_belege',           // Recht "eigene", fremder Beleg
  'kasse_unvollstaendig',        // api_key/token fehlen am Konto bzw. an der Kasse
  'storno_fehlgeschlagen',       // der Storno-Beleg selbst wurde abgelehnt (z. B. Signatur)
] as const;

export type CancellationErrorCode = (typeof CANCELLATION_ERROR_CODES)[number];

export function isCancellationErrorCode(value: unknown): value is CancellationErrorCode {
  return typeof value === 'string' && (CANCELLATION_ERROR_CODES as readonly string[]).includes(value);
}

/** Bezug eines Storno-Belegs auf sein Original. */
export interface CancellationOf {
  receiptId: string;
  fullReceiptId: string | null;
}

/** Eine stornierte Position: Index im Original und Menge. */
export interface CancellationItem {
  index: number;
  quantity: number;
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
