/**
 * Fassade ueber den Aufrufen der Rechnungs-API: Schluessel einmal binden, dann rufen.
 *
 * Wie [createPartnerApi] bewusst **keine** Klasse — die Aufrufe sind freie
 * Funktionen (endpunkte.ts) und bleiben einzeln importierbar.
 */

import { createBinaryTransport, createTransport, type FetchLike } from '../client/transport.js';
import type { InternerBinaerTransport, InternerTransport } from '../client/aufrufe.js';
import { invoiceKeyAuth } from './auth.js';
import {
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
  previewInvoice,
  listInvoices,
  recordInvoicePayment,
  searchCustomers,
  updateCustomer,
} from './endpunkte.js';
import type { EInvoiceFormat, InvoiceLanguage } from './vertrag.js';
import type {
  Brand,
  CancelInvoiceRequest,
  CancelResult,
  CreditNoteRequest,
  CreditNoteResult,
  Customer,
  CustomerInput,
  CustomerPage,
  CustomerSearch,
  InvoiceDetail,
  InvoiceListQuery,
  InvoicePage,
  InvoiceSetupStatus,
  InvoiceXml,
  IssueInvoiceRequest,
  IssueResult,
  PreviewResult,
  RecordPaymentRequest,
  RecordPaymentResult,
} from './typen.js';

export interface InvoiceApiOptions {
  /** `api_key` des Kontos (`kr_live_…` / `kr_test_…`). Gehoert auf einen Server. */
  apiKey: string;
  /** Abweichende Basis-URL; Vorgabe `https://api.kasseneck.at/v3`. */
  baseUrl?: string;
  /** Zeitlimit je Aufruf in Millisekunden. */
  timeoutMs?: number;
  /** Eigene `fetch`-Umsetzung (Tests, Proxys). */
  fetch?: FetchLike;
}

export interface InvoiceApi {
  // Kunden
  createCustomer(customer: CustomerInput, options?: { idempotencyKey?: string }): Promise<Customer>;
  getCustomer(ref: { customerId: string } | { externalId: string }): Promise<Customer>;
  updateCustomer(customerId: string, patch: Partial<CustomerInput>): Promise<Customer>;
  searchCustomers(search: CustomerSearch): Promise<CustomerPage>;

  // Rechnungen
  issueInvoice(request: IssueInvoiceRequest): Promise<IssueResult>;
  /** Probelauf: pruefen und rechnen wie `issueInvoice`, ohne auszustellen. */
  previewInvoice(request: IssueInvoiceRequest): Promise<PreviewResult>;
  cancelInvoice(request: CancelInvoiceRequest): Promise<CancelResult>;
  createCreditNote(request: CreditNoteRequest): Promise<CreditNoteResult>;
  getInvoice(ref: { invoiceId: string } | { number: string }): Promise<InvoiceDetail>;
  listInvoices(query?: InvoiceListQuery): Promise<InvoicePage>;
  /** Eine spaeter eingetroffene Zahlung nachtragen; `idempotencyKey` ist Pflicht. */
  recordInvoicePayment(request: RecordPaymentRequest): Promise<RecordPaymentResult>;

  // Dateien
  /** Mit `language` ungleich der Rechnungssprache: gekennzeichnete Uebersetzungskopie. */
  getInvoicePdf(invoiceId: string, options?: { language?: InvoiceLanguage }): Promise<Uint8Array>;
  /** `{ xml, format, filename }` wie gesendet; `filename` ist `invoice-<Nummer>.xml`. */
  getInvoiceXml(invoiceId: string, format?: EInvoiceFormat): Promise<InvoiceXml>;

  // Freigabe und Einrichtung
  /** Darf dieses Konto ausstellen, und was fehlt noch? Laeuft auch ohne Freigabe. */
  getInvoiceSetupStatus(): Promise<InvoiceSetupStatus>;

  // Marken
  /** Die Marken des Kontos; `id` geht als `brandId` in `issueInvoice`. */
  listBrands(): Promise<Brand[]>;
}

export function createInvoiceApi(options: InvoiceApiOptions): InvoiceApi {
  const transportOptionen = {
    auth: invoiceKeyAuth({ apiKey: options.apiKey }),
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
    fetch: options.fetch,
  };
  const rufen = createTransport(transportOptionen) as InternerTransport;
  const rufenBinaer = createBinaryTransport(transportOptionen) as InternerBinaerTransport;

  return {
    createCustomer: (customer, o) => createCustomer(rufen, customer, o),
    getCustomer: (kennung) => getCustomer(rufen, kennung),
    updateCustomer: (id, patch) => updateCustomer(rufen, id, patch),
    searchCustomers: (suche) => searchCustomers(rufen, suche),

    issueInvoice: (anfrage) => issueInvoice(rufen, anfrage),
    previewInvoice: (anfrage) => previewInvoice(rufen, anfrage),
    cancelInvoice: (anfrage) => cancelInvoice(rufen, anfrage),
    createCreditNote: (anfrage) => createCreditNote(rufen, anfrage),
    getInvoice: (kennung) => getInvoice(rufen, kennung),
    listInvoices: (abfrage) => listInvoices(rufen, abfrage),

    getInvoicePdf: (id, o) => getInvoicePdf(rufenBinaer, id, o),
    getInvoiceXml: (id, format) => getInvoiceXml(rufen, id, format),

    getInvoiceSetupStatus: () => getInvoiceSetupStatus(rufen),

    recordInvoicePayment: (anfrage) => recordInvoicePayment(rufen, anfrage),

    listBrands: () => listBrands(rufen),
  };
}
