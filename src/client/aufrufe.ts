/**
 * Die Namen der Backend-Functions, die dieses Paket aufruft — als Daten, nicht
 * als Zeichenketten im Code verstreut. Zwei Gruende:
 *
 * 1. Der Vertrag (`fixtures/surface.json`) gibt die Liste aus, damit die
 *    Zwillinge pruefen koennen, ob sie denselben Aufruf kennen.
 * 2. Die paketinternen Module nehmen [InternerTransport] statt
 *    [KasseneckTransport] entgegen; ein Tippfehler im Aufrufnamen ist damit ein
 *    Compilerfehler statt eines 404 beim Kunden.
 *
 * **Die oeffentliche Schnittstelle bleibt offen.** `KasseneckTransport` nimmt
 * weiterhin jeden `string`: wer einen Aufruf braucht, den dieses Paket nicht
 * umhuellt, muss ihn weiterhin absetzen koennen.
 */
import type { TransportBodyFields, TransportCallOptions } from './transport.js';

export const ALL_CALLS = [
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
  'listMyStock',
  'listMyStockLocations',
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
  'setMyCashregisterStockLocation',
  'setMyKasseLogo',
  'setMyKasseSettings',
  'setMyRegisterDeviceSettings',
  'stripeCaptureIntent',
  'unpairRegisterDevice',
  'rotatePartnerWebhookSecret',
  'updateCustomer',
  'updatePartnerWebhook',
  // Lager-API (Stufe 5a, ./inventory)
  'getArticle',
  'listArticles',
  'lookupArticleByCode',
  'listLocations',
  'getStock',
  'listStock',
  'listStockMovements',
  'createWebhook',
  'updateWebhook',
  'deleteWebhook',
  'listWebhooks',
  'sendWebhookTest',
  'rotateWebhookSecret',
  'listWebhookDeliveries',
  // Lager-API schreiben und Reservierung (Stufe 5b, ./inventory)
  'createArticle',
  'updateArticle',
  'deactivateArticle',
  'receiveGoods',
  'transferStock',
  'recordStockLoss',
  'changeStockCondition',
  'reverseStockMovement',
  'createReservation',
  'extendReservation',
  'releaseReservation',
  'getReservation',
  'listReservations',
] as const;

export type ApiCall = typeof ALL_CALLS[number];

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
  'getPartnerBilling',
  'getPartnerBillingMonth',
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
  // Rechnungskorb und SEPA-Mandate (Backend keck#557): nur die Namen, damit
  // die Liste dem Vertrag folgt; umhuellt sind sie in diesem Paket noch nicht
  // (der offene Transport nimmt jeden Namen).
  'createInvoiceItem',
  'updateInvoiceItem',
  'withdrawInvoiceItem',
  'getInvoiceItem',
  'listInvoiceItems',
  'setCustomerMandate',
  'revokeCustomerMandate',
  // Lager-API lesen und Konto-Webhooks (Backend Stufe 5a), umhuellt in `./inventory`.
  'getArticle',
  'listArticles',
  'lookupArticleByCode',
  'listLocations',
  'getStock',
  'listStock',
  'listStockMovements',
  'createWebhook',
  'updateWebhook',
  'deleteWebhook',
  'listWebhooks',
  'sendWebhookTest',
  'rotateWebhookSecret',
  'listWebhookDeliveries',
  // Lager-API schreiben und Reservierung (Backend Stufe 5b), umhuellt in `./inventory`.
  'createArticle',
  'updateArticle',
  'deactivateArticle',
  'receiveGoods',
  'transferStock',
  'recordStockLoss',
  'changeStockCondition',
  'reverseStockMovement',
  'createReservation',
  'extendReservation',
  'releaseReservation',
  'getReservation',
  'listReservations',
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
  // Lager an der Kasse (Lager-Kern Stufe 2): nur ueber den Kassenweg.
  'listMyStockLocations',
  'listMyStock',
  'setMyCashregisterStockLocation',
] as const;

export type PublicCall = typeof PUBLIC_CALLS[number];
export type PosCall = typeof POS_CALLS[number];

/**
 * Die Aufrufe **mit Wirkung**, alphabetisch: sie legen etwas an, aendern oder
 * loeschen es, buchen, signieren, bewegen Geld oder senden etwas hinaus
 * (Mail, Druckjob, Probesendung). Scheitert einer, nachdem die Anfrage
 * unterwegs war (Netzfehler, Zeitlimit, HTTP 5xx, unlesbare Erfolgsantwort,
 * HTML mit Kennzeichen), meldet der Transport `outcome: 'unknown'`: der
 * Vorgang kann ausgefuehrt sein.
 *
 * Bis 1.5.0 galt das nur fuer die sechs signierenden und geldbewegenden
 * Aufrufe; ein Wareneingang oder eine Rechnung nach einem Zeitlimit kam als
 * `'rejected'` an, und wer das glaubte und mit NEUEM Idempotenzschluessel
 * neu sendete, buchte doppelt.
 *
 * Geht als `unknownOutcomeCalls` in den Vertrag (`fixtures/surface.json`);
 * der Dart-Zwilling prueft seine Liste dagegen. Jeder Aufruf aus
 * [ALL_CALLS], [PUBLIC_CALLS] und [POS_CALLS] steht entweder hier oder in
 * [CALLS_WITHOUT_EFFECT] (Waechter `test/ausgang-einordnung.test.ts`).
 */
export const UNKNOWN_OUTCOME_CALLS = [
  'activateCashregister',
  'cancelInvoice',
  'cancelReceipt',
  'changeStockCondition',
  'createArticle',
  'createCreditNote',
  'createCustomer',
  'createCustomerCashregister',
  'createInvoiceItem',
  'createPartnerCustomer',
  'createPartnerWebhook',
  'createPrintJob',
  'createReceipt',
  'createReservation',
  'createWebhook',
  'deactivateArticle',
  'deletePartnerWebhook',
  'deleteWebhook',
  'extendReservation',
  'financeWebService',
  'hobexPayApi',
  'hobexRefundApi',
  'issueInvoice',
  'pairRegisterDevice',
  'receiveGoods',
  'recordInvoicePayment',
  'recordStockLoss',
  'releaseReservation',
  'reportCustomerContract',
  'requestCustomerSignature',
  'reverseStockMovement',
  'revokeCustomerMandate',
  'rotatePartnerWebhookSecret',
  'rotateWebhookSecret',
  'sendPartnerCustomerFonLink',
  'sendPartnerWebhookTest',
  'sendReceiptEmail',
  'sendWebhookTest',
  'setCustomerMandate',
  'setMyCashregisterStockLocation',
  'setMyKasseLogo',
  'setMyKasseSettings',
  'setMyRegisterDeviceSettings',
  'stripeCaptureIntent',
  'transferStock',
  'unpairRegisterDevice',
  'updateArticle',
  'updateCustomer',
  'updateInvoiceItem',
  'updatePartnerWebhook',
  'updateWebhook',
  'withdrawInvoiceItem',
] as const;

/** Warum ein Aufruf keine Wirkung hat, die ein Zeitlimit offen lassen koennte. */
export type CallWithoutEffectReason = 'read' | 'repeatable';

/**
 * Die Aufrufe **ohne Wirkung**, je mit Grund. Bei ihnen bleibt es bei
 * `outcome: 'rejected'`, auch nach Zeitlimit, Netzfehler oder HTTP 5xx; eine
 * Wiederholung bucht nichts doppelt:
 *
 * - `read`: reines Lesen (auch Berichte, Dateien, `generateFullReceiptId`,
 *   das nur einen Link-Schluessel ableitet, und `getCustomerCredentials`,
 *   dessen Abruf das Backend nur mitschreibt).
 * - `repeatable`: legt etwas an, das ohne die verlorene Antwort niemand
 *   erreicht und das von selbst verfaellt, und bucht nichts. Die Sitzung der
 *   Kassen-Anmeldung (anmelden, verlaengern, abmelden: eine Wiederholung legt
 *   hoechstens eine weitere kurzlebige Sitzung an bzw. verlaengert oder
 *   beendet dieselbe noch einmal) und der Stripe-Zahlungslink
 *   (`createPaymentLinkStripe`: den Link kennt nur die Antwort, ein nie
 *   zugestellter Link wird nie bezahlt; Geld bewegt erst die Zahlung bzw.
 *   `stripeCaptureIntent`).
 *
 * Probelaeufe (`previewGoodsReceipt`, `previewInvoice`) teilen den Namen mit
 * dem echten Aufruf und stehen darum nicht hier; die Huellen setzen fuer sie
 * `hasEffect: false` beim Aufruf (siehe `TransportCallOptions`).
 *
 * Paketintern; nicht Teil der Paketoberflaeche.
 */
export const CALLS_WITHOUT_EFFECT: Readonly<Record<string, CallWithoutEffectReason>> = Object.freeze({
  checkPartnerCustomerEmail: 'read',
  downloadDailyReport: 'read',
  downloadReceipt: 'read',
  downloadReport: 'read',
  createPaymentLinkStripe: 'repeatable',
  endRegisterSession: 'repeatable',
  generateFullReceiptId: 'read',
  getArticle: 'read',
  getCustomer: 'read',
  getCustomerCredentials: 'read',
  getCustomerSignatureStatus: 'read',
  getFirstReceiptDate: 'read',
  getInvoice: 'read',
  getInvoiceItem: 'read',
  getInvoicePdf: 'read',
  getInvoiceSetupStatus: 'read',
  getInvoiceXml: 'read',
  getKasseSettings: 'read',
  getPartnerBilling: 'read',
  getPartnerBillingMonth: 'read',
  getPartnerCustomer: 'read',
  getPartnerInfo: 'read',
  getPrintJob: 'read',
  getReceipt: 'read',
  getReportV2: 'read',
  getReservation: 'read',
  getStock: 'read',
  hobexGetStatus: 'read',
  listArticles: 'read',
  listBrands: 'read',
  listCustomerCashregisters: 'read',
  listInvoiceItems: 'read',
  listInvoices: 'read',
  listLocations: 'read',
  listMyArticleGroups: 'read',
  listMyArticles: 'read',
  listMyCashregisters: 'read',
  listMyPrinters: 'read',
  listMyReceipts: 'read',
  listMyStock: 'read',
  listMyStockLocations: 'read',
  listMyTipRecipients: 'read',
  listPartnerCustomers: 'read',
  listPartnerWebhookDeliveries: 'read',
  listPartnerWebhooks: 'read',
  listRegisterSessionsForDevice: 'read',
  listRegisterUsersForDevice: 'read',
  listReservations: 'read',
  listStock: 'read',
  listStockMovements: 'read',
  listWebhookDeliveries: 'read',
  listWebhooks: 'read',
  lookupArticleByCode: 'read',
  registerPinLogin: 'repeatable',
  registerUserLogin: 'repeatable',
  renewRegisterSession: 'repeatable',
  searchCustomers: 'read',
});

const MIT_WIRKUNG: ReadonlySet<string> = new Set(UNKNOWN_OUTCOME_CALLS);

/**
 * Hat dieser Aufruf Wirkung, ist sein Ausgang nach Zeitlimit, Netzfehler,
 * HTTP 5xx oder unlesbarer Erfolgsantwort also unklar? `financeWebService`
 * zaehlt mit jedem Vorgang. Ein Name, den dieses Paket nicht kennt (der
 * offene Transport nimmt jeden), ist `false`; wer so einen Aufruf mit Wirkung
 * absetzt, sagt es mit `hasEffect: true`.
 */
export function isUnknownOutcomeCall(name: string): boolean {
  return MIT_WIRKUNG.has(name);
}

const OEFFENTLICH: ReadonlySet<string> = new Set(PUBLIC_CALLS);
const KASSENWEG: ReadonlySet<string> = new Set(POS_CALLS);
const NUR_KASSE: ReadonlySet<string> = new Set(POS_CALLS.filter((name) => !OEFFENTLICH.has(name)));

/** Einer der 28 Aufrufe des Kassenwegs. */
export function isPosCall(name: string): boolean {
  return KASSENWEG.has(name);
}

/**
 * Nur ueber den Kassenweg erreichbar (22 Namen): unter `api.kasseneck.at/v3`
 * gibt es sie nicht. Der Transport schickt sie darum ohne eigene Basis an
 * [POS_BASE_URL] statt an die oeffentliche Basis.
 */
export function isPosOnlyCall(name: string): boolean {
  return NUR_KASSE.has(name);
}

/** Wie [KasseneckTransport], nur mit bekanntem Aufrufnamen. Nicht exportiert nach aussen. */
export type InternerTransport = <T = unknown>(
  functionName: ApiCall,
  params?: Record<string, unknown>,
  extraBodyFields?: TransportBodyFields,
  secretParams?: readonly string[],
  options?: TransportCallOptions,
) => Promise<T>;

/** Wie [KasseneckBinaryTransport], nur mit bekanntem Aufrufnamen. */
export type InternerBinaerTransport = (
  functionName: ApiCall,
  params?: Record<string, unknown>,
) => Promise<Uint8Array>;
