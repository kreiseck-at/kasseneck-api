/**
 * `@kreiseck/kasseneck-api/rechnung` — Rechnungen (§ 11 UStG, keine Belege)
 * und Kunden ueber die Rechnungs-API.
 *
 * Ein eigener Unterpfad wie `partner`: der `api_key` eines Kontos, mit dem
 * Rechnungen ausgestellt werden, gehoert auf einen **Server** und soll nicht
 * versehentlich in ein Browser-Buendel der Kasse wandern.
 *
 * Die Beschreibung der Endpunkte steht in der Referenz des Backends
 * (`docs/api/rechnungen.md`). Was hier steht, ist der Vertrag als Daten und die
 * Benutzung des Clients.
 */

export {
  RECHNUNG_VERTRAG_VERSION,
  RECHNUNG_AUFRUFE,
  INVOICE_ERROR_CODES,
  CREDIT_NOTE_REASONS,
  TAX_SCHEMES,
  PRICE_MODES,
  VAT_RATES,
  CUSTOMER_TYPES,
  INVOICE_LIST_STATUS,
  DOC_TYPES,
  EINVOICE_FORMATS,
  KUNDE_FELDER,
  POSITION_FELDER,
  RECHNUNG_ANFRAGEN,
  RECHNUNG_GENAU_EINS,
  RECHNUNG_MINDESTENS_EINS,
  type RechnungAufruf,
  type InvoiceErrorCode,
  type CreditNoteReason,
  type TaxScheme,
  type PriceMode,
  type VatRatePercent,
  type CustomerType,
  type InvoiceListStatus,
  type DocType,
  type EInvoiceFormat,
  type Format,
  type Feld,
} from './vertrag.js';
