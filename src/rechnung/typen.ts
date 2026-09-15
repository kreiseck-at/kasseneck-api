/**
 * Typen der Rechnungs-API. Die Anfragen folgen `vertrag.ts` Feld fuer Feld;
 * `test/rechnung-client.test.ts` schickt die Beispiele des Vertrags durch.
 *
 * Betraege sind ueberall ganze Cent. Datumsangaben sind `YYYY-MM-DD` nach
 * Wiener Kalender.
 */

import type {
  CreditNoteReason,
  CustomerType,
  DocType,
  InvoiceSetupRequirement,
  InvoiceListStatus,
  PriceMode,
  TaxScheme,
  VatRatePercent,
} from './vertrag.js';

// ---- Kunden -----------------------------------------------------------------

export interface CustomerInput {
  type: CustomerType;
  name: string;
  legalForm?: string;
  email?: string;
  phone?: string;
  street?: string;
  houseNumber?: string;
  zip?: string;
  city?: string;
  /** ISO-3166-Alpha-2, z. B. `AT`. */
  country: string;
  /** UID-Nummer, z. B. `ATU12345678`. */
  vatId?: string;
  /** Kuerzel fuer die Rechnungsnummer; einmal gesetzt unveraenderlich. */
  shortCode?: string;
  /** Behoerde (B2G) — die E-Rechnung verlangt dann Adresse und `orderReference`. */
  isAuthority?: boolean;
  note?: string;
  /** Kennung im eigenen System; je Konto eindeutig. */
  externalId?: string;
}

export interface Customer {
  id: string;
  type: CustomerType;
  name: string;
  legalForm: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  houseNumber: string | null;
  zip: string | null;
  city: string | null;
  country: string;
  vatId: string | null;
  shortCode: string | null;
  isAuthority: boolean;
  note: string | null;
  externalId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CustomerSearch {
  externalId?: string;
  vatId?: string;
  email?: string;
  /** Namensanfang, Gross-/Kleinschreibung und Akzente egal. */
  name?: string;
  limit?: number;
  cursor?: string;
}

export interface CustomerPage {
  customers: Customer[];
  nextCursor: string | null;
}

// ---- Rechnungen -------------------------------------------------------------

export interface InvoiceItemInput {
  description: string;
  subtitle?: string;
  /** Hoechstens drei Nachkommastellen. */
  quantity: number;
  unit?: string;
  /** Einzelpreis in ganzen Cent, im `priceMode` der Rechnung (netto oder brutto). */
  unitPriceCents: number;
  vatRate: VatRatePercent;
  /** Zeilenrabatt in Prozent, hoechstens zwei Nachkommastellen. */
  discountPct?: number;
}

export interface IssueInvoiceRequest {
  /** Pflicht: dieselbe Anfrage mit demselben Schluessel erzeugt nie eine zweite Rechnung. */
  idempotencyKey: string;
  /** Pflicht ueber 400 € brutto sowie bei Reverse Charge und ig. Lieferung. */
  customerId?: string;
  taxScheme: TaxScheme;
  priceMode: PriceMode;
  /** Leistungsdatum bzw. Beginn des Leistungszeitraums. */
  serviceStart: string;
  serviceEnd?: string;
  paymentTermDays?: number;
  orderReference?: string;
  intro?: string;
  note?: string;
  /** Verwendungszweck fuer die Ueberweisung; leer = Rechnungsnummer. */
  paymentReference?: string;
  girocode?: boolean;
  tracking?: boolean;
  items: InvoiceItemInput[];
  /** Eigene Merkmale (hoechstens 20), nie gedruckt. */
  metadata?: Record<string, string>;
}

export interface CancelInvoiceRequest {
  idempotencyKey: string;
  invoiceId: string;
  reason: CreditNoteReason;
  note?: string;
}

export interface CreditNoteRequest extends CancelInvoiceRequest {
  items: InvoiceItemInput[];
}

export interface InvoiceTotals {
  netCents: number;
  vatCents: number;
  grossCents: number;
  byRate: { rate: number; netCents: number; vatCents: number }[];
}

export interface EInvoiceStatus {
  level: string;
  formats: string[];
  missing: string[];
}

export interface Invoice {
  id: string;
  number: string;
  docType: DocType;
  status: string;
  invoiceDate: string;
  dueDate: string | null;
  customerId: string | null;
  totals: InvoiceTotals;
  einvoice: EInvoiceStatus | null;
  statusUrl: string | null;
  statusPassword: string | null;
  metadata: Record<string, string>;
}

export interface InvoiceRecipient {
  name: string;
  type: CustomerType;
  street: string | null;
  houseNumber: string | null;
  zip: string | null;
  city: string | null;
  country: string;
  vatId: string | null;
  shortCode: string | null;
  email: string | null;
  isAuthority: boolean;
}

/** Eine gespeicherte Position — wie gesendet, fehlende Angaben mit ihrem Standardwert. */
export interface InvoiceItem {
  description: string;
  subtitle: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  vatRate: number;
  discountPct: number;
}

export interface InvoiceDetail extends Invoice {
  items: InvoiceItem[];
  customer: InvoiceRecipient | null;
  taxScheme: TaxScheme;
  priceMode: PriceMode;
  serviceStart: string | null;
  serviceEnd: string | null;
  paymentTermDays: number | null;
  orderReference: string | null;
  payments: { amountCents: number; date: string; method: string }[];
  paidCents: number;
  openCents: number;
  overdue: boolean;
  writtenOff: boolean;
  writeOffReasonCode: string | null;
  related: { invoiceId: string; number: string | null } | null;
  creditNotes: { id: string; number: string; grossCents: number }[];
  source: string | null;
  createdAt: string | null;
  finalizedAt: string | null;
}

export interface InvoiceListQuery {
  from?: string;
  to?: string;
  status?: InvoiceListStatus;
  docType?: DocType;
  customerId?: string;
  limit?: number;
  cursor?: string;
}

export interface InvoicePage {
  invoices: Invoice[];
  nextCursor: string | null;
}

export interface IssueResult {
  invoice: Invoice;
  /** `true`, wenn die Anfrage schon einmal ausgefuehrt wurde und die bestehende Rechnung zurueckkommt. */
  replayed: boolean;
}

export interface CancelResult {
  creditNote: Invoice;
  original: { id: string; status: string };
  /** Bereits auf das Original bezahlt — die Rueckerstattung ist Sache des Betriebs. */
  originalPaidCents: number;
  replayed: boolean;
}

export interface CreditNoteResult {
  creditNote: Invoice;
  /** Brutto, das nach dieser Gutschrift noch gutgeschrieben werden kann. */
  remainingCents: number;
  replayed: boolean;
}

// ---- Freigabe und Einrichtung -----------------------------------------------

/** Ein Punkt, der vor dem Ausstellen noch fehlt. */
export interface InvoiceSetupGap {
  requirement: InvoiceSetupRequirement;
  /** Was fehlt und wo es nachzutragen ist — fuer einen Menschen formuliert. */
  message: string;
}

export interface InvoiceSetupStatus {
  /** `true`: Rechnungen koennen ueber die API ausgestellt werden. */
  ready: boolean;
  /** Umgebung des Schluessels (`kr_live_…` bzw. `kr_test_…`). */
  environment: 'live' | 'test';
  /** Was fehlt, in der Reihenfolge von `INVOICE_SETUP_REQUIREMENTS` — leer, wenn `ready`. */
  missing: InvoiceSetupGap[];
}
