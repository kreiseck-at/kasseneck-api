/**
 * Nacherfassung eines Handbelegs (`manualReceipt` am Beleg, Backend
 * `handbeleg`): Nach einem Ausfall der Kasse oder einer Leistung ausser Haus
 * wird der handschriftliche Beleg (Paragon) in der Kasse nacherfasst. Der
 * Beleg traegt dann Nummer, Datum und Grund des Handbelegs; sein eigener
 * Zeitstempel bleibt der Zeitpunkt der Nacherfassung (kein Rueckdatieren).
 *
 * Rechtsgrundlage: § 17 Abs 5 RKSV, Erlass 2019 Abschnitt 3.6.1 (Ausfall,
 * Tagessammelbeleg erlaubt) und 6.7 (ausser Haus, jeder Beleg einzeln).
 * Geprueft wird am Server; dieses Paket liest nur und reicht die Eingabe weiter.
 */

/** Gruende einer Nacherfassung: fuenf Ausfall-Gruende und die Leistung ausser Haus. */
export const MANUAL_RECEIPT_REASONS = [
  'network_outage', 'power_outage', 'device_failure', 'system_outage', 'other', 'outside_premises',
] as const;
export type ManualReceiptReason = (typeof MANUAL_RECEIPT_REASONS)[number];

export interface ManualReceipt {
  /** Nummer des Handbelegs (eigene Nummernreihe des Paragons, nie die Kassennummer). */
  number: string;
  /** Letzte Nummer: macht den Beleg zum Tagessammelbeleg (nur nach einem Ausfall). */
  numberTo?: string;
  /** Zahl der Handbelege im Tagessammelbeleg. */
  count?: number;
  /** Tag des Handbelegs, `YYYY-MM-DD` (Wiener Tag). */
  date: string;
  /** Uhrzeit des Handbelegs, `HH:MM`. */
  time?: string;
  /** Grund; ein Wert, den dieses Paket nicht kennt, bleibt als roher Text lesbar. */
  reason: ManualReceiptReason | string;
  /** Eigener Text, nur beim Grund `other`. */
  note?: string;
}

const istText = (w: unknown): w is string => typeof w === 'string' && w !== '';

/**
 * Liest `manualReceipt` vom Draht. Ohne Nummer, Datum oder Grund gibt es
 * keinen Handbeleg (`undefined`); ein einzelnes Zusatzfeld in falscher Form
 * faellt weg, statt den Beleg scheitern zu lassen.
 */
export function readManualReceipt(roh: unknown): ManualReceipt | undefined {
  if (roh === null || typeof roh !== 'object' || Array.isArray(roh)) return undefined;
  const o = roh as Record<string, unknown>;
  if (!istText(o['number']) || !istText(o['date']) || !istText(o['reason'])) return undefined;
  return {
    number: o['number'],
    ...(istText(o['numberTo']) ? { numberTo: o['numberTo'] } : {}),
    ...(typeof o['count'] === 'number' && Number.isInteger(o['count']) ? { count: o['count'] } : {}),
    date: o['date'],
    ...(istText(o['time']) ? { time: o['time'] } : {}),
    reason: o['reason'],
    ...(istText(o['note']) ? { note: o['note'] } : {}),
  };
}

/**
 * Fehlercodes von `createReceipt` zur Nacherfassung (Vertrag `errorCodes.manualReceipt`).
 * `manual_receipt_duplicate` traegt in `details.receiptId` den Beleg, der den Handbeleg
 * schon nacherfasst hat: nicht erneut senden, sondern diesen Beleg nehmen.
 */
export const MANUAL_RECEIPT_ERROR_CODES = Object.freeze([
  'invalid_manual_receipt',
  'manual_receipt_not_allowed',
  'manual_receipt_date_in_future',
  'manual_receipt_range_not_allowed',
  'manual_receipt_duplicate',
] as const);
export type ManualReceiptErrorCode = (typeof MANUAL_RECEIPT_ERROR_CODES)[number];

export function isManualReceiptErrorCode(value: unknown): value is ManualReceiptErrorCode {
  return typeof value === 'string' && (MANUAL_RECEIPT_ERROR_CODES as readonly string[]).includes(value);
}
