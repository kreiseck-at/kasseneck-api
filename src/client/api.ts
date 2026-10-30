import type { Cashregister, HobexReceipt, Receipt, ReportMonth, StripeUrlSession } from '../models/index.js';
import {
  createStripeLink,
  stripeCaptureIntent,
  type CreateStripeLinkOptions,
  type StripeCaptureResult,
} from '../payments/stripe.js';
import { hobexPay, hobexRefund, type HobexPayOptions, type HobexRefundOptions } from '../payments/hobex.js';
import { createTransport, createBinaryTransport, createFileOrDataTransport, type FetchLike, type TransportOptions } from './transport.js';
import { downloadDailyReport, downloadMonthlyReport, getCashregisterReport, getReportV2, type CashregisterReportPeriod, type ReportV2, type ReportV2Options } from './reports.js';
import { getCashboxStatus, getSignatureStatus, type CashboxStatus, type SignatureStatus } from './status.js';
import {
  createDepExport,
  createDepHandoverLink,
  getDepExport,
  getDepExportFile,
  revokeDepHandoverLink,
  waitForDepExport,
  type CreateDepExportOptions,
  type CreateDepExportResult,
  type DepExport,
  type DepExportFile,
  type DepHandoverLink,
  type GetDepExportFileOptions,
  type RevokedDepHandoverLink,
  type WaitForDepExportOptions,
} from './dep-export.js';
import { listAllReceipts, listReceipts, type ListedReceipt, type ListReceiptsOptions, type ListReceiptsPage, type ListReceiptsView } from './list-receipts.js';
import {
  sellReceipt,
  sellReceiptWithCompany,
  cancelReceipt,
  zeroReceipt,
  getReceipt,
  getReceiptWithCompany,
  generateFullReceiptId,
  getFirstReceiptDate,
  listMyReceipts,
  sendReceiptEmail,
  type SendReceiptEmailOptions,
  type SendReceiptEmailResult,
  logReceiptOutputs,
  type LogReceiptOutputsOptions,
  type LogReceiptOutputsResult,
  type ListMyReceiptsOptions,
  type ReceiptList,
  type ReceiptWithCompany,
  type SellReceiptOptions,
  type CancelReceiptOptions,
  type CancelReceiptResult,
} from './receipts.js';
import { listMyCashregisters } from './cashregisters.js';
import { renewRegisterSession, endRegisterSession } from '../register/session.js';

/**
 * Schlichte Factory ueber den Endpunkt-Funktionen: bindet einen Transport
 * einmal und liefert die Aufrufe ohne den wiederkehrenden ersten Parameter.
 * Bewusst **keine** Klasse und keine Vererbung — die Aufrufe sind freie
 * Funktionen (siehe receipts.ts) und bleiben einzeln importierbar; wer sie
 * lieber einzeln nimmt, verliert nichts.
 *
 * Hier stehen **alle** Endpunkt-Aufrufe des Pakets: Belege, Berichte, Status,
 * Zahlungen und die beiden Sitzungs-Aufrufe der Browser-Kasse. Was kein
 * Endpunkt-Aufruf ist (Druck, Beleg-Darstellung), gehoert nicht hierher. Der
 * Grund fuer die Vollstaendigkeit ist der Zweck der Fassade: ein **einziger**
 * Konstruktionsweg je Anmeldung. Fehlte eine Endpunkt-Familie, muesste ein
 * Aufrufer fuer sie zusaetzlich [createTransport] mit denselben Optionen bauen
 * und haette zwei Wege fuer dieselbe Anmeldung nebeneinander.
 *
 * **Eine Ausnahme, und sie folgt aus genau diesem Grund:** Kopplung,
 * Benutzerliste des Geraets und PIN-Anmeldung (`@kreiseck/kasseneck-api/register`)
 * stehen **nicht** hier. Diese Fassade wird mit einer Anmeldung gebaut, jene
 * drei laufen aber, **bevor** es eine gibt. Stuenden sie darin, sagte die
 * Fassade eine Anmeldung zu, die fuer sie nicht gilt: ein Aufrufer riefe
 * `pairRegisterDevice` an einer mit `apiKeyAuth` gebauten Fassade und glaubte,
 * der Schluessel haette dabei etwas zu sagen. Sie bringen ihre
 * Verbindungsangaben stattdessen selbst mit.
 */
export interface KasseneckApi {
  /** Normalbeleg (Verkauf). */
  sellReceipt(options: SellReceiptOptions): Promise<Receipt>;
  /** Normalbeleg samt Firmen-/Druckdaten fuer den Belegdruck. */
  sellReceiptWithCompany(options: SellReceiptOptions): Promise<ReceiptWithCompany>;
  /** Storno eines bestehenden Belegs — voll oder in Teilen, ueber den Storno-Endpunkt. */
  cancelReceipt(options: CancelReceiptOptions): Promise<CancelReceiptResult>;
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
  /** Beleg als Link auf die oeffentliche Belegseite per E-Mail schicken. */
  sendReceiptEmail(options: SendReceiptEmailOptions): Promise<SendReceiptEmailResult>;
  /** Drucke und Teilen eines Belegs an das Protokoll „Ausgaben“ melden (nur Kassenweg). */
  logReceiptOutputs(options: LogReceiptOutputsOptions): Promise<LogReceiptOutputsResult>;
  /** Belegliste einer Kasse samt Kennzahlen (nur mit ID-Token, siehe receipts.ts). */
  listMyReceipts(options: ListMyReceiptsOptions): Promise<ReceiptList>;
  /** Kassen des angemeldeten Benutzers (nur mit ID-Token, siehe cashregisters.ts). */
  listMyCashregisters(): Promise<Cashregister[]>;
  /** Rohdaten eines Zeitraums: Belege und Firmendaten (`getReportV2`). */
  getReportV2(options: ReportV2Options): Promise<ReportV2>;
  /** Eine Seite Belege eines Tages oder Zeitraums (`listReceipts`, hoechstens 31 Tage, blaetterbar). */
  listReceipts<V extends ListReceiptsView = 'summary'>(options: ListReceiptsOptions<V>): Promise<ListReceiptsPage<V>>;
  /** Alle Belege eines Tages oder Zeitraums, Seite fuer Seite geholt (hoechstens 100 Seiten). */
  listAllReceipts<V extends ListReceiptsView = 'summary'>(options: ListReceiptsOptions<V>): AsyncGenerator<ListedReceipt<V>, void, undefined>;
  /** DEP-Export fuer die Kassennachschau einstellen (`createDepExport`, nur /v3); antwortet sofort, der Export laeuft im Hintergrund. */
  createDepExport(options?: CreateDepExportOptions): Promise<CreateDepExportResult>;
  /** Zustand, Kennzahlen, Befund und Pruefer-Links eines Exports (`getDepExport`). */
  getDepExport(options: { exportId: string }): Promise<DepExport>;
  /** Wartet, bis der Export fertig ist (Abfrage 2 s, x1,5, hoechstens 15 s; Vorgabe 10 Minuten). */
  waitForDepExport(options: WaitForDepExportOptions): Promise<DepExport>;
  /** Eine Datei des Exports (dep, protocol, items, zip) laden und gegen die SHA-256-Summe pruefen. */
  getDepExportFile(options: GetDepExportFileOptions): Promise<DepExportFile>;
  /** Pruefer-Link (Adresse und 6-stelliger Code, 14 Tage) zu einem fertigen Export. */
  createDepHandoverLink(options: { exportId: string }): Promise<DepHandoverLink>;
  /** Pruefer-Link der eigenen Kasse widerrufen. */
  revokeDepHandoverLink(options: { linkId: string }): Promise<RevokedDepHandoverLink>;
  /** Kassenbericht als PDF (v2): abgeschlossener Monat, Tag oder Zeitraum (Endpunkt `getCashregisterReport`). */
  getCashregisterReport(options: CashregisterReportPeriod): Promise<Uint8Array>;
  /** @deprecated Since 1.10.0: use getCashregisterReport. Tagesbericht als PDF (Kalendertag nach Wiener Zeit). */
  downloadDailyReport(date: Date): Promise<Uint8Array>;
  /** @deprecated Since 1.10.0: use getCashregisterReport. Monatsbericht als PDF (Endpunkt `downloadReport`). */
  downloadMonthlyReport(reportMonth: ReportMonth): Promise<Uint8Array>;
  /** Betriebsstatus der Kasse bei FinanzOnline. */
  getCashboxStatus(): Promise<CashboxStatus>;
  /** Status der Signatureinheit bei FinanzOnline. */
  getSignatureStatus(certificateSerialHex: string): Promise<SignatureStatus>;
  /** Stripe-Zahlungslink erzeugen (Endpunkt `createPaymentLinkStripe`). */
  createStripeLink(options: CreateStripeLinkOptions): Promise<StripeUrlSession>;
  /** Reservierte Stripe-Zahlung einziehen. */
  stripeCaptureIntent(stripeSessionId: string): Promise<StripeCaptureResult>;
  /** Karte ueber die Hobex-Cloud belasten. */
  hobexPay(options: HobexPayOptions): Promise<HobexReceipt>;
  /** Hobex-Cloud-Zahlung erstatten (ohne Rueckgabewert, siehe payments/hobex.ts). */
  hobexRefund(options: HobexRefundOptions): Promise<void>;
  /** Kassen-Sitzung verlaengern; liefert den neuen Ablauf (nur Kassen-Benutzer). */
  renewRegisterSession(): Promise<number>;
  /** Kassen-Sitzung beenden und den Lizenzplatz freigeben (nur Kassen-Benutzer). */
  endRegisterSession(): Promise<void>;
}

export function createKasseneckApi(options: TransportOptions): KasseneckApi {
  const rufen = createTransport(options);
  // Zweiter Einstiegspunkt fuer die PDF-Downloads; dieselben Optionen,
  // dieselbe Anmeldung — nur die Antwort wird als Bytes gelesen.
  const rufenBinaer = createBinaryTransport(options);
  // Fuer Dateien beliebiger Art (DEP-Export): Datei oder Lese-Link.
  const rufenDatei = createFileOrDataTransport(options);
  // Das globale fetch erst beim Folgen eines Lese-Links holen: ohne Link braucht es niemand.
  const holen: FetchLike = (url, init) => {
    if (options.fetch) return options.fetch(url, init);
    const umgebung = globalThis as { fetch?: FetchLike };
    if (typeof umgebung.fetch !== 'function') throw new Error('getDepExportFile: kein globales fetch vorhanden');
    return umgebung.fetch(url, init);
  };
  return {
    sellReceipt: (o) => sellReceipt(rufen, o),
    sellReceiptWithCompany: (o) => sellReceiptWithCompany(rufen, o),
    cancelReceipt: (o) => cancelReceipt(rufen, o),
    zeroReceipt: () => zeroReceipt(rufen),
    getReceipt: (receiptId) => getReceipt(rufen, receiptId),
    getReceiptWithCompany: (receiptId) => getReceiptWithCompany(rufen, receiptId),
    generateFullReceiptId: (receiptId) => generateFullReceiptId(rufen, receiptId),
    getFirstReceiptDate: () => getFirstReceiptDate(rufen),
    listMyReceipts: (o) => listMyReceipts(rufen, o),
    sendReceiptEmail: (o) => sendReceiptEmail(rufen, o),
    logReceiptOutputs: (o) => logReceiptOutputs(rufen, o),
    listMyCashregisters: () => listMyCashregisters(rufen),
    getReportV2: (o) => getReportV2(rufen, o),
    listReceipts: (o) => listReceipts(rufen, o),
    listAllReceipts: (o) => listAllReceipts(rufen, o),
    createDepExport: (o) => createDepExport(rufen, o),
    getDepExport: (o) => getDepExport(rufen, o),
    waitForDepExport: (o) => waitForDepExport(rufen, o),
    getDepExportFile: (o) => getDepExportFile(rufenDatei, holen, o),
    createDepHandoverLink: (o) => createDepHandoverLink(rufen, o),
    revokeDepHandoverLink: (o) => revokeDepHandoverLink(rufen, o),
    getCashregisterReport: (options) => getCashregisterReport(rufenBinaer, options),
    downloadDailyReport: (date) => downloadDailyReport(rufenBinaer, date),
    downloadMonthlyReport: (reportMonth) => downloadMonthlyReport(rufenBinaer, reportMonth),
    getCashboxStatus: () => getCashboxStatus(rufen),
    getSignatureStatus: (certificateSerialHex) => getSignatureStatus(rufen, certificateSerialHex),
    createStripeLink: (o) => createStripeLink(rufen, o),
    stripeCaptureIntent: (stripeSessionId) => stripeCaptureIntent(rufen, stripeSessionId),
    hobexPay: (o) => hobexPay(rufen, o),
    hobexRefund: (o) => hobexRefund(rufen, o),
    renewRegisterSession: () => renewRegisterSession(rufen),
    endRegisterSession: () => endRegisterSession(rufen),
  };
}
