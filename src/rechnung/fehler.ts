/**
 * Fehler der Rechnungs-API auswerten — am Code, nie am Text.
 *
 * Es zaehlen nur Codes aus dem Vertrag ([INVOICE_ERROR_CODES]). Ein fremder
 * Code (z. B. aus einer vorgeschalteten Schicht) ist fuer diese Helfer kein
 * Rechnungs-Fehler: wer darauf verzweigt, soll es bewusst ueber
 * `KasseneckApiError.code` tun.
 */

import { KasseneckApiError } from '../client/errors.js';
import { INVOICE_ERROR_CODES, type InvoiceErrorCode } from './vertrag.js';

const BEKANNT: ReadonlySet<string> = new Set(INVOICE_ERROR_CODES);

/** Der Fehlercode eines geworfenen Fehlers — `undefined`, wenn es keiner der Rechnungs-API ist. */
export function rechnungFehlerCode(error: unknown): InvoiceErrorCode | undefined {
  if (!(error instanceof KasseneckApiError)) return undefined;
  const code = error.code;
  return code !== undefined && BEKANNT.has(code) ? (code as InvoiceErrorCode) : undefined;
}

/** Kurzform fuer `catch (e) { if (istRechnungFehler(e, 'customer_exists')) … }`. */
export function istRechnungFehler(error: unknown, code: InvoiceErrorCode): boolean {
  return rechnungFehlerCode(error) === code;
}

/** Ein Feldfehler aus `data.errors[]` einer `validation`-Antwort. */
export interface RechnungFeldFehler {
  /** Feldpfad in der gesendeten Anfrage, z. B. `items[2].vatRate` oder `customer.vatId`. */
  field: string;
  message: string;
}

/** Die Feldfehler einer `validation`-Antwort; leer, wenn es keine sind. */
export function rechnungFeldFehler(error: unknown): RechnungFeldFehler[] {
  if (!(error instanceof KasseneckApiError)) return [];
  const roh = error.details['errors'];
  if (!Array.isArray(roh)) return [];
  const raus: RechnungFeldFehler[] = [];
  for (const eintrag of roh) {
    if (eintrag === null || typeof eintrag !== 'object') continue;
    const { field, message } = eintrag as { field?: unknown; message?: unknown };
    if (typeof field === 'string' && typeof message === 'string') raus.push({ field, message });
  }
  return raus;
}
