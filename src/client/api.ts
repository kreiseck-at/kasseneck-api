import type { Receipt, ReportMonth } from '../models/index.js';
import { createTransport, createBinaryTransport, type TransportOptions } from './transport.js';
import { downloadDailyReport, downloadMonthlyReport } from './reports.js';
import { getCashboxStatus, getSignatureStatus, type CashboxStatus, type SignatureStatus } from './status.js';
import {
  sellReceipt,
  cancelReceipt,
  createCancelReceipt,
  zeroReceipt,
  getReceipt,
  generateFullReceiptId,
  getFirstReceiptDate,
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
 */
export interface KasseneckApi {
  /** Normalbeleg (Verkauf). */
  sellReceipt(options: SellReceiptOptions): Promise<Receipt>;
  /** Storno eines vorliegenden Belegs (Positionen negiert). */
  cancelReceipt(options: CancelReceiptOptions): Promise<Receipt>;
  /** Storno aus frei uebergebenen Positionen. */
  createCancelReceipt(options: CreateCancelReceiptOptions): Promise<Receipt>;
  /** Nullbeleg (RKSV-Pruefbeleg). */
  zeroReceipt(): Promise<Receipt>;
  /** Einzelnen Beleg holen. */
  getReceipt(receiptId: string): Promise<Receipt>;
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
}

export function createKasseneckApi(options: TransportOptions): KasseneckApi {
  const rufen = createTransport(options);
  // Zweiter Einstiegspunkt fuer die PDF-Downloads; dieselben Optionen,
  // dieselbe Anmeldung — nur die Antwort wird als Bytes gelesen.
  const rufenBinaer = createBinaryTransport(options);
  return {
    sellReceipt: (o) => sellReceipt(rufen, o),
    cancelReceipt: (o) => cancelReceipt(rufen, o),
    createCancelReceipt: (o) => createCancelReceipt(rufen, o),
    zeroReceipt: () => zeroReceipt(rufen),
    getReceipt: (receiptId) => getReceipt(rufen, receiptId),
    generateFullReceiptId: (receiptId) => generateFullReceiptId(rufen, receiptId),
    getFirstReceiptDate: () => getFirstReceiptDate(rufen),
    downloadDailyReport: (date) => downloadDailyReport(rufenBinaer, date),
    downloadMonthlyReport: (reportMonth) => downloadMonthlyReport(rufenBinaer, reportMonth),
    getCashboxStatus: () => getCashboxStatus(rufen),
    getSignatureStatus: (zertifikatNrHex) => getSignatureStatus(rufen, zertifikatNrHex),
  };
}
