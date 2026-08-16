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
