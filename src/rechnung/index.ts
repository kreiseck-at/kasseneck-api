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

export { createRechnungApi, type RechnungApi, type RechnungApiOptions } from './api.js';

export { rechnungKeyAuth, type RechnungKeyAuthOptions } from './auth.js';

export {
  istRechnungFehler,
  rechnungFehlerCode,
  rechnungFeldFehler,
  type RechnungFeldFehler,
} from './fehler.js';

export {
  cancelInvoice,
  createCreditNote,
  createCustomer,
  getCustomer,
  getInvoice,
  getInvoicePdf,
  getInvoiceSetupStatus,
  getInvoiceXml,
  issueInvoice,
  listBrands,
  listInvoices,
  previewInvoice,
  recordInvoicePayment,
  searchCustomers,
  updateCustomer,
} from './endpunkte.js';

export type {
  Brand,
  CancelInvoiceRequest,
  CancelResult,
  CreditNoteRequest,
  CreditNoteResult,
  Customer,
  CustomerInput,
  CustomerPage,
  CustomerSearch,
  EInvoiceStatus,
  Invoice,
  InvoiceDetail,
  InvoiceItem,
  InvoiceItemInput,
  InvoiceListQuery,
  InvoicePage,
  InvoiceRecipient,
  InvoiceSetupGap,
  InvoiceSetupStatus,
  InvoiceTotals,
  InvoiceNotice,
  InvoicePayment,
  InvoicePreview,
  InvoiceRateTotals,
  IssueInvoiceRequest,
  IssueResult,
  PaymentInput,
  PreviewResult,
  RecordPaymentRequest,
  RecordPaymentResult,
} from './typen.js';

export { RECHNUNG_TEXTE, rechnungText, type RechnungTextSchluessel } from './texte.js';

export { rechnungSummen, STEUERFREIE_FAELLE, type SummenPosition } from './summen.js';

export {
  anteiligerPreis,
  BETRAG_GRENZE_CENTS,
  positionAusEuro,
  preisText,
  RechenFehler,
  rechnungRechnen,
  rund,
  satzSchluessel,
  satzText,
  type RechenErgebnis,
  type RechenFehlerCode,
  type RechenOptionen,
  type RechenPosition,
  type SatzSumme,
  type Umwandlung,
  type UmwandlungsGrund,
  type ZeilenBetrag,
} from './rechnen.js';

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
  INVOICE_LANGUAGES,
  INVOICE_PAYMENT_METHODS,
  ITEM_KINDS,
  REVERSE_CHARGE_REASONS,
  INVOICE_NOTICE_CODES,
  INVOICE_UNITS,
  RECHNUNG_EINHEITEN_CODES,
  INVOICE_SETUP_REQUIREMENTS,
  KUNDE_FELDER,
  POSITION_FELDER,
  POSITION_PREIS_GENAU_EINS,
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
  type InvoiceLanguage,
  type InvoicePaymentMethod,
  type ItemKind,
  type ReverseChargeReason,
  type InvoiceNoticeCode,
  type InvoiceUnit,
  type InvoiceSetupRequirement,
  type Format,
  type Feld,
} from './vertrag.js';
