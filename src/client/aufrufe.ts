/**
 * Die Namen der Backend-Functions, die dieses Paket aufruft — als Daten, nicht
 * als Zeichenketten im Code verstreut. Zwei Gruende:
 *
 * 1. Der Vertrag (`fixtures/oberflaeche.json`) gibt die Liste aus, damit die
 *    Zwillinge pruefen koennen, ob sie denselben Aufruf kennen.
 * 2. Die paketinternen Module nehmen [InternerTransport] statt
 *    [KasseneckTransport] entgegen; ein Tippfehler im Aufrufnamen ist damit ein
 *    Compilerfehler statt eines 404 beim Kunden.
 *
 * **Die oeffentliche Schnittstelle bleibt offen.** `KasseneckTransport` nimmt
 * weiterhin jeden `string`: wer einen Aufruf braucht, den dieses Paket nicht
 * umhuellt, muss ihn weiterhin absetzen koennen.
 */
import type { TransportBodyFields } from './transport.js';

export const AUFRUFE = [
  'cancelReceipt',
  'createPaymentLinkStripe',
  'createPrintJob',
  'createReceipt',
  'downloadDailyReport',
  'downloadReport',
  'endRegisterSession',
  'financeWebService',
  'generateFullReceiptId',
  'getFirstReceiptDate',
  'getKasseSettings',
  'getPrintJob',
  'getReceipt',
  'hobexPayApi',
  'hobexRefundApi',
  'listMyArticleGroups',
  'listMyArticles',
  'listMyCashregisters',
  'listMyPrinters',
  'listMyReceipts',
  'listMyTipRecipients',
  'listRegisterUsersForDevice',
  'pairRegisterDevice',
  'registerPinLogin',
  'registerUserLogin',
  'renewRegisterSession',
  'setMyKasseSettings',
  'setMyRegisterDeviceSettings',
  'stripeCaptureIntent',
  'unpairRegisterDevice',
] as const;

export type Aufruf = typeof AUFRUFE[number];

/** Wie [KasseneckTransport], nur mit bekanntem Aufrufnamen. Nicht exportiert nach aussen. */
export type InternerTransport = <T = unknown>(
  functionName: Aufruf,
  params?: Record<string, unknown>,
  extraBodyFields?: TransportBodyFields,
  secretParams?: readonly string[],
) => Promise<T>;

/** Wie [KasseneckBinaryTransport], nur mit bekanntem Aufrufnamen. */
export type InternerBinaerTransport = (
  functionName: Aufruf,
  params?: Record<string, unknown>,
) => Promise<Uint8Array>;
