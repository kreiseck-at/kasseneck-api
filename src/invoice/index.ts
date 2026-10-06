/**
 * `@kreiseck/kasseneck-api/invoice` – Rechnungen (§ 11 UStG, keine Belege)
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

export { createInvoiceApi, type InvoiceApi, type InvoiceApiOptions } from './api.js';

export { invoiceKeyAuth, type InvoiceKeyAuthOptions } from './auth.js';

export {
  isInvoiceError,
  isInvoiceErrorCode,
  invoiceErrorCode,
  invoiceFieldErrors,
  type InvoiceApiErrorCode,
  type InvoiceFieldError,
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
  CreditNoteItemInput,
  CreditNoteRequest,
  CreditNoteResult,
  Customer,
  CustomerInput,
  CustomerPage,
  CustomerSearch,
  EInvoiceStatus,
  Invoice,
  InvoiceDetail,
  InvoiceDetailPayment,
  InvoiceItem,
  InvoiceItemInput,
  IssueInvoiceItemInput,
  InvoiceListQuery,
  InvoicePage,
  InvoiceRecipient,
  InvoiceSetupGap,
  InvoiceSetupStatus,
  InvoiceTotals,
  InvoiceXml,
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

export { INVOICE_TEXTS, invoiceText, type InvoiceTextKey } from './texte.js';

export { computeInvoiceTotals, ZERO_RATED_TAX_SCHEMES, type TotalsItem } from './summen.js';

export {
  proratedPriceMicros,
  MAX_AMOUNT_CENTS,
  itemFromEuro,
  formatUnitPrice,
  CalcError,
  calculateInvoice,
  roundDiv,
  vatRateMapKey,
  formatVatRate,
  type CalcResult,
  type CalcErrorCode,
  type CalcOptions,
  type CalcItem,
  type RateTotal,
  type ItemConversion,
  type ConversionReason,
  type LineAmount,
} from './calc.js';

export {
  INVOICE_CONTRACT_VERSION,
  INVOICE_ENDPOINTS,
  INVOICE_ERROR_CODES,
  INVOICE_REQUEST_ERROR_CODES,
  CREDIT_NOTE_REASONS,
  TAX_SCHEMES,
  PRICE_MODES,
  VAT_RATES,
  CUSTOMER_TYPES,
  INVOICE_LIST_STATUS,
  DOC_TYPES,
  EINVOICE_FORMATS,
  EINVOICE_MISSING_CODES,
  WRITE_OFF_REASON_CODES,
  INVOICE_LANGUAGES,
  INVOICE_PAYMENT_METHODS,
  ITEM_KINDS,
  REVERSE_CHARGE_REASONS,
  INVOICE_NOTICE_CODES,
  INVOICE_UNITS,
  INVOICE_UNIT_CODES,
  INVOICE_SETUP_REQUIREMENTS,
  CUSTOMER_FIELDS,
  ITEM_FIELDS,
  INVOICE_ITEM_FIELDS,
  CREDIT_NOTE_ITEM_FIELDS,
  RETURN_DISPOSITIONS,
  ITEM_PRICE_EXACTLY_ONE,
  INVOICE_REQUESTS,
  INVOICE_EXACTLY_ONE,
  INVOICE_AT_LEAST_ONE,
  type InvoiceEndpoint,
  type InvoiceErrorCode,
  type InvoiceRequestErrorCode,
  type CreditNoteReason,
  type ReturnDisposition,
  type TaxScheme,
  type PriceMode,
  type VatRatePercent,
  type CustomerType,
  type InvoiceListStatus,
  type DocType,
  type EInvoiceFormat,
  type EInvoiceMissingCode,
  type WriteOffReasonCode,
  type InvoiceLanguage,
  type InvoicePaymentMethod,
  type ItemKind,
  type ReverseChargeReason,
  type InvoiceNoticeCode,
  type InvoiceUnit,
  type InvoiceSetupRequirement,
  type FieldFormat,
  type Field,
} from './vertrag.js';
