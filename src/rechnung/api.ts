/**
 * Fassade ueber den Aufrufen der Rechnungs-API: Schluessel einmal binden, dann rufen.
 *
 * Wie [createPartnerApi] bewusst **keine** Klasse — die Aufrufe sind freie
 * Funktionen (endpunkte.ts) und bleiben einzeln importierbar.
 */

import { createBinaryTransport, createTransport, type FetchLike } from '../client/transport.js';
import type { InternerBinaerTransport, InternerTransport } from '../client/aufrufe.js';
import { rechnungKeyAuth } from './auth.js';
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
  IssueInvoiceRequest,
  IssueResult,
  RecordPaymentRequest,
  RecordPaymentResult,
} from './typen.js';

export interface RechnungApiOptions {
  /** `api_key` des Kontos (`kr_live_…` / `kr_test_…`). Gehoert auf einen Server. */
  apiKey: string;
  /** Abweichende Basis-URL; Vorgabe `https://api.kasseneck.at/v1`. */
  baseUrl?: string;
  /** Zeitlimit je Aufruf in Millisekunden. */
  timeoutMs?: number;
  /** Eigene `fetch`-Umsetzung (Tests, Proxys). */
  fetch?: FetchLike;
}

export interface RechnungApi {
  // Kunden
  createCustomer(customer: CustomerInput, optionen?: { idempotencyKey?: string }): Promise<Customer>;
  getCustomer(kennung: { customerId: string } | { externalId: string }): Promise<Customer>;
  updateCustomer(customerId: string, patch: Partial<CustomerInput>): Promise<Customer>;
  searchCustomers(suche: CustomerSearch): Promise<CustomerPage>;

  // Rechnungen
  issueInvoice(anfrage: IssueInvoiceRequest): Promise<IssueResult>;
  cancelInvoice(anfrage: CancelInvoiceRequest): Promise<CancelResult>;
  createCreditNote(anfrage: CreditNoteRequest): Promise<CreditNoteResult>;
  getInvoice(kennung: { invoiceId: string } | { number: string }): Promise<InvoiceDetail>;
  listInvoices(abfrage?: InvoiceListQuery): Promise<InvoicePage>;
  /** Eine spaeter eingetroffene Zahlung nachtragen; `idempotencyKey` ist Pflicht. */
  recordInvoicePayment(anfrage: RecordPaymentRequest): Promise<RecordPaymentResult>;

  // Dateien
  /** Mit `language` ungleich der Rechnungssprache: gekennzeichnete Uebersetzungskopie. */
  getInvoicePdf(invoiceId: string, optionen?: { language?: InvoiceLanguage }): Promise<Uint8Array>;
  getInvoiceXml(invoiceId: string, format?: EInvoiceFormat): Promise<string>;

  // Freigabe und Einrichtung
  /** Darf dieses Konto ausstellen, und was fehlt noch? Laeuft auch ohne Freigabe. */
  getInvoiceSetupStatus(): Promise<InvoiceSetupStatus>;

  // Marken
  /** Die Marken des Kontos; `id` geht als `brandId` in `issueInvoice`. */
  listBrands(): Promise<Brand[]>;
}

export function createRechnungApi(optionen: RechnungApiOptions): RechnungApi {
  const transportOptionen = {
    auth: rechnungKeyAuth({ apiKey: optionen.apiKey }),
    baseUrl: optionen.baseUrl,
    timeoutMs: optionen.timeoutMs,
    fetch: optionen.fetch,
  };
  const rufen = createTransport(transportOptionen) as InternerTransport;
  const rufenBinaer = createBinaryTransport(transportOptionen) as InternerBinaerTransport;

  return {
    createCustomer: (customer, o) => createCustomer(rufen, customer, o),
    getCustomer: (kennung) => getCustomer(rufen, kennung),
    updateCustomer: (id, patch) => updateCustomer(rufen, id, patch),
    searchCustomers: (suche) => searchCustomers(rufen, suche),

    issueInvoice: (anfrage) => issueInvoice(rufen, anfrage),
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
