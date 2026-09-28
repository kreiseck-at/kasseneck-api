/**
 * Fehler der Rechnungs-API auswerten: am Code, nie am Text.
 *
 * Es zaehlen die Codes des Vertrags ([INVOICE_ERROR_CODES]) und die, die
 * Anmeldung und Rand auf jedem Rechnungsaufruf erzeugen koennen
 * ([INVOICE_REQUEST_ERROR_CODES], z. B. `dialect_mismatch`, `not_found`,
 * `route_missing`). Ein fremder Code ist fuer diese Helfer kein
 * Rechnungs-Fehler: wer darauf verzweigt, soll es bewusst ueber
 * `KasseneckApiError.code` tun.
 */

import type { KasseneckApiError } from '../client/errors.js';
import { bekannterCode, feldfehlerVon } from '../client/fehlercodes.js';
import {
  INVOICE_ERROR_CODES,
  INVOICE_REQUEST_ERROR_CODES,
  type InvoiceErrorCode,
  type InvoiceRequestErrorCode,
} from './vertrag.js';

/** Ein Code, den ein Rechnungsaufruf liefern kann. */
export type InvoiceApiErrorCode = InvoiceErrorCode | InvoiceRequestErrorCode;

const BEKANNT: ReadonlySet<string> = new Set<string>([...INVOICE_ERROR_CODES, ...INVOICE_REQUEST_ERROR_CODES]);

/** `true` fuer einen Code aus [INVOICE_ERROR_CODES] oder [INVOICE_REQUEST_ERROR_CODES]. */
export function isInvoiceErrorCode(value: unknown): value is InvoiceApiErrorCode {
  return typeof value === 'string' && BEKANNT.has(value);
}

/** Der Fehlercode eines geworfenen Fehlers; `undefined`, wenn es keiner der Rechnungs-API ist. */
export function invoiceErrorCode(error: unknown): InvoiceApiErrorCode | undefined {
  return bekannterCode<InvoiceApiErrorCode>(error, BEKANNT);
}

/**
 * Kurzform fuer `catch (e) { if (isInvoiceError(e, 'customer_exists')) … }`.
 * Ohne `code`: ist es ueberhaupt ein Fehler der Rechnungs-API?
 */
export function isInvoiceError(error: unknown, code?: InvoiceApiErrorCode): error is KasseneckApiError {
  const gefunden = invoiceErrorCode(error);
  return gefunden !== undefined && (code === undefined || gefunden === code);
}

/** Ein Feldfehler aus `data.errors[]` einer `validation`-Antwort. */
export interface InvoiceFieldError {
  /** Feldpfad in der gesendeten Anfrage, z. B. `items[2].vatRate` oder `customer.vatId`. */
  field: string;
  message: string;
}

/** Die Feldfehler einer `validation`-Antwort; leer, wenn es keine sind. */
export function invoiceFieldErrors(error: unknown): InvoiceFieldError[] {
  return feldfehlerVon(error);
}
