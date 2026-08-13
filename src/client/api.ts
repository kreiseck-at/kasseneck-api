import type { HobexReceipt, Receipt, ReportMonth, StripeUrlSession } from '../models/index.js';
import {
  createStripeLink,
  stripeCaptureIntent,
  type CreateStripeLinkOptions,
  type StripeCaptureResult,
} from '../payments/stripe.js';
import { hobexPay, hobexRefund, type HobexPayOptions, type HobexRefundOptions } from '../payments/hobex.js';
import { createTransport, createBinaryTransport, type TransportOptions } from './transport.js';
import { downloadDailyReport, downloadMonthlyReport } from './reports.js';
import { getCashboxStatus, getSignatureStatus, type CashboxStatus, type SignatureStatus } from './status.js';
import {
  sellReceipt,
  sellReceiptWithCompany,
  cancelReceipt,
  createCancelReceipt,
  zeroReceipt,
  getReceipt,
  getReceiptWithCompany,
  generateFullReceiptId,
  getFirstReceiptDate,
  type ReceiptWithCompany,
  type SellReceiptOptions,
  type CancelReceiptOptions,
  type CreateCancelReceiptOptions,
} from './receipts.js';

/**
 * Schlichte Factory ueber den Endpunkt-Funktionen: bindet einen Transport
 * einmal und liefert die Aufrufe ohne den wiederkehrenden ersten Parameter.
 * Bewusst **keine** Klasse und keine Vererbung — die Aufrufe sind freie
 * Funktionen (siehe receipts.ts) und bleiben einzeln importierbar; wer sie
 * lieber einzeln nimmt, verliert nichts.
 *
 * Hier stehen **alle** Endpunkt-Aufrufe des Pakets: Belege, Berichte, Status
 * und Zahlungen. Was kein Endpunkt-Aufruf ist (Druck, Beleg-Darstellung),
 * gehoert nicht hierher. Der Grund fuer die Vollstaendigkeit ist der Zweck der
 * Fassade: ein **einziger** Konstruktionsweg je Anmeldung. Fehlte eine
 * Endpunkt-Familie, muesste ein Aufrufer fuer sie zusaetzlich
 * [createTransport] mit denselben Optionen bauen und haette zwei Wege fuer
 * dieselbe Anmeldung nebeneinander.
 */
export interface KasseneckApi {
  /** Normalbeleg (Verkauf). */
  sellReceipt(options: SellReceiptOptions): Promise<Receipt>;
  /** Normalbeleg samt Firmen-/Druckdaten fuer den Belegdruck. */
  sellReceiptWithCompany(options: SellReceiptOptions): Promise<ReceiptWithCompany>;
  /** Storno eines vorliegenden Belegs (Positionen negiert). */
  cancelReceipt(options: CancelReceiptOptions): Promise<Receipt>;
  /** Storno aus frei uebergebenen Positionen. */
  createCancelReceipt(options: CreateCancelReceiptOptions): Promise<Receipt>;
  /** Nullbeleg (RKSV-Pruefbeleg). */
  zeroReceipt(): Promise<Receipt>;
  /** Einzelnen Beleg holen. */
  getReceipt(receiptId: string): Promise<Receipt>;
  /** Einzelnen Beleg samt Firmen-/Druckdaten holen. */
  getReceiptWithCompany(receiptId: string): Promise<ReceiptWithCompany>;
  /** Verschluesselte Volltext-Belegnummer erzeugen. */
  generateFullReceiptId(receiptId: string): Promise<string>;
  /** Berichtsmonat des ersten Belegs (nicht fuer den Kassen-Benutzer-Weg). */
  getFirstReceiptDate(): Promise<ReportMonth>;
  /** Tagesbericht als PDF (Kalendertag nach Wiener Zeit). */
  downloadDailyReport(date: Date): Promise<Uint8Array>;
  /** Monatsbericht als PDF (Endpunkt `downloadReport`). */
  downloadMonthlyReport(reportMonth: ReportMonth): Promise<Uint8Array>;
  /** Betriebsstatus der Kasse bei FinanzOnline. */
  getCashboxStatus(): Promise<CashboxStatus>;
  /** Status der Signatureinheit bei FinanzOnline. */
  getSignatureStatus(zertifikatNrHex: string): Promise<SignatureStatus>;
  /** Stripe-Zahlungslink erzeugen (Endpunkt `createPaymentLinkStripe`). */
  createStripeLink(options: CreateStripeLinkOptions): Promise<StripeUrlSession>;
  /** Reservierte Stripe-Zahlung einziehen. */
  stripeCaptureIntent(stripeSessionId: string): Promise<StripeCaptureResult>;
  /** Karte ueber die Hobex-Cloud belasten. */
  hobexPay(options: HobexPayOptions): Promise<HobexReceipt>;
  /** Hobex-Cloud-Zahlung erstatten (ohne Rueckgabewert, siehe payments/hobex.ts). */
  hobexRefund(options: HobexRefundOptions): Promise<void>;
}

export function createKasseneckApi(options: TransportOptions): KasseneckApi {
  const rufen = createTransport(options);
  // Zweiter Einstiegspunkt fuer die PDF-Downloads; dieselben Optionen,
  // dieselbe Anmeldung — nur die Antwort wird als Bytes gelesen.
  const rufenBinaer = createBinaryTransport(options);
  return {
    sellReceipt: (o) => sellReceipt(rufen, o),
    sellReceiptWithCompany: (o) => sellReceiptWithCompany(rufen, o),
    cancelReceipt: (o) => cancelReceipt(rufen, o),
    createCancelReceipt: (o) => createCancelReceipt(rufen, o),
    zeroReceipt: () => zeroReceipt(rufen),
    getReceipt: (receiptId) => getReceipt(rufen, receiptId),
    getReceiptWithCompany: (receiptId) => getReceiptWithCompany(rufen, receiptId),
    generateFullReceiptId: (receiptId) => generateFullReceiptId(rufen, receiptId),
    getFirstReceiptDate: () => getFirstReceiptDate(rufen),
    downloadDailyReport: (date) => downloadDailyReport(rufenBinaer, date),
    downloadMonthlyReport: (reportMonth) => downloadMonthlyReport(rufenBinaer, reportMonth),
    getCashboxStatus: () => getCashboxStatus(rufen),
    getSignatureStatus: (zertifikatNrHex) => getSignatureStatus(rufen, zertifikatNrHex),
    createStripeLink: (o) => createStripeLink(rufen, o),
    stripeCaptureIntent: (stripeSessionId) => stripeCaptureIntent(rufen, stripeSessionId),
    hobexPay: (o) => hobexPay(rufen, o),
    hobexRefund: (o) => hobexRefund(rufen, o),
  };
}
