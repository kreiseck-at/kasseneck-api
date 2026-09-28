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
  'activateCashregister',
  'cancelInvoice',
  'cancelReceipt',
  'createCreditNote',
  'createCustomer',
  'createCustomerCashregister',
  'createPartnerCustomer',
  'checkPartnerCustomerEmail',
  'createPartnerWebhook',
  'createPaymentLinkStripe',
  'createPrintJob',
  'createReceipt',
  'deletePartnerWebhook',
  'downloadDailyReport',
  'downloadReport',
  'endRegisterSession',
  'financeWebService',
  'generateFullReceiptId',
  'getCustomer',
  'getCustomerCredentials',
  'getCustomerSignatureStatus',
  'getFirstReceiptDate',
  'getInvoice',
  'getInvoicePdf',
  'getInvoiceSetupStatus',
  'getInvoiceXml',
  'getKasseSettings',
  'getPartnerCustomer',
  'getPartnerInfo',
  'getPrintJob',
  'getReceipt',
  'getReportV2',
  'hobexPayApi',
  'hobexRefundApi',
  'issueInvoice',
  'listCustomerCashregisters',
  'listInvoices',
  'listBrands',
  'listMyArticleGroups',
  'listMyArticles',
  'listMyCashregisters',
  'listMyPrinters',
  'listMyReceipts',
  'listMyTipRecipients',
  'listPartnerCustomers',
  'listPartnerWebhookDeliveries',
  'listPartnerWebhooks',
  'listRegisterUsersForDevice',
  'listRegisterSessionsForDevice',
  'pairRegisterDevice',
  'recordInvoicePayment',
  'registerPinLogin',
  'registerUserLogin',
  'renewRegisterSession',
  'reportCustomerContract',
  'requestCustomerSignature',
  'searchCustomers',
  'sendPartnerCustomerFonLink',
  'sendPartnerWebhookTest',
  'sendReceiptEmail',
  'setMyKasseSettings',
  'setMyRegisterDeviceSettings',
  'stripeCaptureIntent',
  'unpairRegisterDevice',
  'rotatePartnerWebhookSecret',
  'updateCustomer',
  'updatePartnerWebhook',
] as const;

export type Aufruf = typeof AUFRUFE[number];

/**
 * Die oeffentlichen Endpunkte unter `/v3` (`https://api.kasseneck.at/v3/<name>`),
 * mit ihrem **aeusseren** Namen und in der Reihenfolge des Backend-Vertrags
 * (`fixtures/v3/v3-vokabular.json`, `endpoints.public`, umbenannt nach
 * `names`). Ein Test haelt beide Listen deckungsgleich.
 */
export const PUBLIC_CALLS = [
  'createReceipt',
  'getReceipt',
  'cancelReceipt',
  'sendReceiptEmail',
  'generateFullReceiptId',
  'downloadReceipt',
  'getFirstReceiptDate',
  'getReportV2',
  'downloadReport',
  'downloadDailyReport',
  'createPaymentLinkStripe',
  'stripeCaptureIntent',
  'hobexPayApi',
  'hobexRefundApi',
  'hobexGetStatus',
  'financeWebService',
  'listMyTipRecipients',
  'getPartnerInfo',
  'createPartnerCustomer',
  'checkPartnerCustomerEmail',
  'listPartnerCustomers',
  'getPartnerCustomer',
  'sendPartnerCustomerFonLink',
  'createPartnerWebhook',
  'updatePartnerWebhook',
  'deletePartnerWebhook',
  'listPartnerWebhooks',
  'sendPartnerWebhookTest',
  'rotatePartnerWebhookSecret',
  'listPartnerWebhookDeliveries',
  'requestCustomerSignature',
  'getCustomerSignatureStatus',
  'createCustomerCashregister',
  'activateCashregister',
  'listCustomerCashregisters',
  'getCustomerCredentials',
  'reportCustomerContract',
  'createCustomer',
  'getCustomer',
  'updateCustomer',
  'searchCustomers',
  'issueInvoice',
  'cancelInvoice',
  'createCreditNote',
  'getInvoice',
  'listInvoices',
  'getInvoicePdf',
  'getInvoiceXml',
  'getInvoiceSetupStatus',
  'listBrands',
  'recordInvoicePayment',
] as const;

/**
 * Die Endpunkte des Kassenwegs (`https://kasse.kasseneck.at/api/v3/<name>`,
 * Web-Kasse: gleicher Ursprung `/api/v3`), in der Reihenfolge von
 * `endpoints.register`. Sechs davon sind zugleich oeffentlich; die Kasse ruft
 * sie trotzdem ueber diesen Weg (ein Dialekt je Client, Nachtrag §5.2).
 */
export const POS_CALLS = [
  'pairRegisterDevice',
  'listRegisterUsersForDevice',
  'listRegisterSessionsForDevice',
  'registerUserLogin',
  'registerPinLogin',
  'renewRegisterSession',
  'endRegisterSession',
  'unpairRegisterDevice',
  'listMyCashregisters',
  'listMyReceipts',
  'getReceipt',
  'createReceipt',
  'generateFullReceiptId',
  'cancelReceipt',
  'sendReceiptEmail',
  'listMyArticleGroups',
  'listMyArticles',
  'getKasseSettings',
  'setMyKasseSettings',
  'setMyKasseLogo',
  'setMyRegisterDeviceSettings',
  'listMyPrinters',
  'createPrintJob',
  'getPrintJob',
  'listMyTipRecipients',
] as const;

export type PublicCall = typeof PUBLIC_CALLS[number];
export type PosCall = typeof POS_CALLS[number];

const OEFFENTLICH: ReadonlySet<string> = new Set(PUBLIC_CALLS);
const KASSENWEG: ReadonlySet<string> = new Set(POS_CALLS);
const NUR_KASSE: ReadonlySet<string> = new Set(POS_CALLS.filter((name) => !OEFFENTLICH.has(name)));

/** Einer der 25 Aufrufe des Kassenwegs. */
export function isPosCall(name: string): boolean {
  return KASSENWEG.has(name);
}

/**
 * Nur ueber den Kassenweg erreichbar (19 Namen): unter `api.kasseneck.at/v3`
 * gibt es sie nicht. Der Transport schickt sie darum ohne eigene Basis an
 * [KASSE_BASE_URL] statt an die oeffentliche Basis.
 */
export function isPosOnlyCall(name: string): boolean {
  return NUR_KASSE.has(name);
}

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
