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
  InvoiceLanguage,
  InvoiceNoticeCode,
  ItemKind,
  ReverseChargeReason,
  InvoicePaymentMethod,
  InvoiceUnit,
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
  /** Sprache der Rechnungen an diesen Kunden; fehlt = `de`. Behoerden immer `de`. */
  language?: InvoiceLanguage;
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
  language: InvoiceLanguage;
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
  /** Einheit aus `INVOICE_UNITS`; ohne Angabe `piece`. */
  unit?: InvoiceUnit;
  /** Ware oder Leistung; ohne Angabe `goods`. Entscheidet ueber den Steuerfall. */
  kind?: ItemKind;
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
  /** Optional: der Server leitet den Fall ab und prueft eine Angabe dagegen. */
  taxScheme?: TaxScheme;
  /** Pflicht bei `domesticReverseCharge`. */
  reverseChargeReason?: ReverseChargeReason;
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
  /** Sprache dieser Rechnung; sonst die des Kunden, sonst `de`. Eine Rechnung, eine Nummer, eine Sprache. */
  language?: InvoiceLanguage;
  /** Marke (Kennung aus `listBrands`); sonst die Standardmarke. Unbekannt = `brand_not_found`. */
  brandId?: string;
  /**
   * Schon bezahlt (Shop kassiert online, Rechnung folgt). Die Zahlung entsteht
   * in derselben Transaktion wie das Festschreiben: das PDF traegt dann keine
   * Zahlungsinformationen und keinen Giro-QR.
   */
  payment?: PaymentInput;
}

/** Eine Zahlung, wie das Fremdsystem sie meldet. */
export interface PaymentInput {
  method: InvoicePaymentMethod;
  /** Ohne Angabe der volle Bruttobetrag. */
  amountCents?: number;
  /** Ohne Angabe der heutige Wiener Tag; nie in der Zukunft. */
  paidAt?: string;
  /** Zahlungskennung des Fremdsystems — gespeichert, aber nicht gedruckt. */
  reference?: string;
  /**
   * Die Zahlung erfolgte vor Ort beim Unternehmer (Terminal an der Kasse).
   * Dann ist sie ein Barumsatz — auch mit Karte (§ 131b Abs. 1 Z 3 UStG) — und
   * die Antwort traegt den Hinweis `cash_receipt_required`. Zu `transfer`
   * passt das Kennzeichen nicht und wird abgewiesen.
   */
  onSite?: boolean;
}

export interface RecordPaymentRequest extends PaymentInput {
  /** Pflicht: ohne ihn bucht eine Wiederholung eine zweite Zahlung. */
  idempotencyKey: string;
  invoiceId: string;
}

/** Eine gebuchte Zahlung, wie die API sie zurueckgibt. */
export interface InvoicePayment {
  id: string;
  amountCents: number;
  paidAt: string;
  method: InvoicePaymentMethod;
  reference: string | null;
}

/**
 * Ein Hinweis zu einer erfolgreichen Antwort — kein Fehler, sondern etwas,
 * das der Aufrufer wissen sollte (heute nur `cash_receipt_required`).
 */
export interface InvoiceNotice {
  code: InvoiceNoticeCode;
  message: string;
}

export interface RecordPaymentResult {
  invoice: Invoice;
  payment: InvoicePayment;
  replayed: boolean;
  notice?: InvoiceNotice;
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
  /** Beim Festschreiben eingefroren; aeltere Rechnungen `de`. */
  language: InvoiceLanguage;
  /** Die eingefrorene Marke; `id` ist `null` bei der Ersatzmarke ohne eigene Einrichtung. */
  brand: { id: string | null; name: string | null } | null;
  /** Summe der gebuchten Zahlungen. */
  paidCents: number;
  /** Was noch offen ist; `0` heisst bezahlt. */
  openCents: number;
}

/** Eine Marke des Kontos (Logo, Farbe, Absender) — `id` geht als `brandId` in `issueInvoice`. */
export interface Brand {
  id: string;
  name: string;
  isDefault: boolean;
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
  /** Ware oder Leistung — Altbestand ohne Angabe zaehlt als `goods`. */
  kind: ItemKind;
  unitPriceCents: number;
  vatRate: number;
  discountPct: number;
}

export interface InvoiceDetail extends Invoice {
  items: InvoiceItem[];
  customer: InvoiceRecipient | null;
  taxScheme: TaxScheme;
  /** Nur bei `domesticReverseCharge`. */
  reverseChargeReason: ReverseChargeReason | null;
  /** Land, dessen Steuer die Rechnung traegt; Altbestand `AT`. */
  taxCountry: string;
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
  /**
   * Hinweise zu dieser Rechnung — kein Fehler, sondern etwas, das der Aufrufer
   * wissen sollte. Eine **Liste**, weil mehrere zugleich anfallen koennen: eine
   * bar bezahlte ig. Lieferung traegt sowohl `cash_receipt_required` als auch
   * `recapitulative_statement_due`.
   */
  notice?: InvoiceNotice[];
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
