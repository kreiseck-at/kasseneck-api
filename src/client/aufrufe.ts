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
import type { FileOrData, FileOrDataCallOptions, PdfOrData, TransportBodyFields, TransportCallOptions } from './transport.js';

export const ALL_CALLS = [
  'activateCashregister',
  'cancelInvoice',
  'cancelReceipt',
  'createCreditNote',
  'createCustomer',
  'createCustomerCashregister',
  'createDepExport',
  'createDepHandoverLink',
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
  'getCashregisterReport',
  'getCustomer',
  'getCustomerCredentials',
  'getCustomerSignatureStatus',
  'getDepExport',
  'getDepExportFile',
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
  'listReceipts',
  'listRegisterUsersForDevice',
  'listRegisterSessionsForDevice',
  'pairRegisterDevice',
  'recordInvoicePayment',
  'registerPinLogin',
  'registerUserLogin',
  'renewRegisterSession',
  'reportCustomerContract',
  'requestCustomerSignature',
  'revokeDepHandoverLink',
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
  // Lager-API Varianten (Stufe 5c, ./inventory)
  'createVariantGroup',
  'updateVariantGroup',
  'getVariantGroup',
  'listVariantGroups',
  'addVariant',
  // Lager-API Inventur (Lager-Kern Stufe 3, ./inventory)
  'createStocktake',
  'listStocktakes',
  'getStocktake',
  'listStocktakeItems',
  'recordStocktakeCount',
  'voidStocktakeCount',
  'listStocktakeCounts',
  'reviewStocktake',
  'recountStocktake',
  'closeStocktake',
  'cancelStocktake',
  'getStocktakePdf',
  // Signaturkarte bestellen und Bestellung lesen
  'orderSignatureCard',
  'getSignatureCardOrder',
  // Inventur zaehlen an der Kasse (Lager-Kern Stufe 3, ./pos)
  'listMyStocktakes',
  'listMyStocktakeItems',
  'listMyStocktakeCounts',
  'recordMyStocktakeCount',
  'voidMyStocktakeCount',
  // Gutschein pruefen und Etikett nachdrucken (./pos)
  'checkVoucher',
  'reprintVoucherLabel',
  // Schicht, Kassenstand und Lade-Protokoll an der Kasse (./pos)
  'getMyDrawerState',
  'openMyShift',
  'recordMyCashMovement',
  'logMyDrawerOpenings',
  'getMyShiftReport',
  'closeMyShift',
  // Ausgaben eines Belegs (Drucke, Teilen) melden: nur ueber den Kassenweg.
  'logReceiptOutputs',
  // Kasseninfo fuer die Pruefung (Kassennachschau, Stufe 2b, ./pos): nur ueber den Kassenweg.
  'getRegisterInspectionInfo',
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
  'getCashregisterReport',
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
  // Lager-API Varianten (Backend Stufe 5c), umhuellt in `./inventory`.
  'createVariantGroup',
  'updateVariantGroup',
  'getVariantGroup',
  'listVariantGroups',
  'addVariant',
  // Lager-API Inventur (Lager-Kern Stufe 3), umhuellt in `./inventory`.
  'createStocktake',
  'listStocktakes',
  'getStocktake',
  'listStocktakeItems',
  'recordStocktakeCount',
  'voidStocktakeCount',
  'listStocktakeCounts',
  'reviewStocktake',
  'recountStocktake',
  'closeStocktake',
  'cancelStocktake',
  'getStocktakePdf',
  'orderSignatureCard',
  'getSignatureCardOrder',
  // Belege einer Kasse auflisten, nur unter /v3 (Nachfolger von getReportV2 fuer Listen).
  'listReceipts',
  // DEP-Export fuer die Kassennachschau (Kassen-Token), nur unter /v3.
  'createDepExport',
  'getDepExport',
  'getDepExportFile',
  'createDepHandoverLink',
  'revokeDepHandoverLink',
] as const;

/**
 * Die Endpunkte des Kassenwegs (`https://kasse.kasseneck.at/api/v3/<name>`,
 * Web-Kasse: gleicher Ursprung `/api/v3`), in der Reihenfolge von
 * `endpoints.register`. Elf davon sind zugleich oeffentlich (sechs Beleg-Aufrufe und
 * die fuenf DEP-Aufrufe); die Kasse ruft sie trotzdem ueber diesen Weg (ein Dialekt
 * je Client, Nachtrag §5.2).
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
  // Inventur zaehlen (Lager-Kern Stufe 3): nur ueber den Kassenweg.
  'listMyStocktakes',
  'listMyStocktakeItems',
  'listMyStocktakeCounts',
  'recordMyStocktakeCount',
  'voidMyStocktakeCount',
  // Gutschein pruefen und Etikett nachdrucken: nur ueber den Kassenweg.
  'checkVoucher',
  'reprintVoucherLabel',
  // Schicht, Kassenstand und Lade-Protokoll: nur ueber den Kassenweg.
  'getMyDrawerState',
  'openMyShift',
  'recordMyCashMovement',
  'logMyDrawerOpenings',
  'getMyShiftReport',
  'closeMyShift',
  // Ausgaben eines Belegs melden: nur ueber den Kassenweg.
  'logReceiptOutputs',
  // DEP fuer die Kassennachschau (Stufe 2): zugleich oeffentlich; an der Kasse nur fuer den Chef (manager_only).
  'createDepExport',
  'getDepExport',
  'getDepExportFile',
  'createDepHandoverLink',
  'revokeDepHandoverLink',
  // Kasseninfo fuer die Pruefung (Stufe 2b): nur ueber den Kassenweg, jeder Kassen-Benutzer.
  'getRegisterInspectionInfo',
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
  'addVariant',
  'cancelInvoice',
  'cancelReceipt',
  'cancelStocktake',
  'changeStockCondition',
  'closeMyShift',
  'closeStocktake',
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
  'createStocktake',
  'createVariantGroup',
  'createWebhook',
  'deactivateArticle',
  'deletePartnerWebhook',
  'deleteWebhook',
  'extendReservation',
  'financeWebService',
  'hobexPayApi',
  'hobexRefundApi',
  'issueInvoice',
  'logMyDrawerOpenings',
  'logReceiptOutputs',
  'openMyShift',
  'orderSignatureCard',
  'pairRegisterDevice',
  'receiveGoods',
  'recordInvoicePayment',
  'recordMyCashMovement',
  'recordMyStocktakeCount',
  'recordStockLoss',
  'recordStocktakeCount',
  'recountStocktake',
  'releaseReservation',
  'reportCustomerContract',
  'requestCustomerSignature',
  'reverseStockMovement',
  'reviewStocktake',
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
  'updateVariantGroup',
  'updateWebhook',
  'voidMyStocktakeCount',
  'voidStocktakeCount',
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
 * `hasEffect: false` beim Aufruf, das nur zusammen mit `dryRun: true` gilt
 * (siehe `TransportCallOptions`).
 *
 * Paketintern; nicht Teil der Paketoberflaeche.
 */
export const CALLS_WITHOUT_EFFECT: Readonly<Record<string, CallWithoutEffectReason>> = Object.freeze({
  checkPartnerCustomerEmail: 'read',
  checkVoucher: 'read',
  downloadDailyReport: 'read',
  downloadReceipt: 'read',
  downloadReport: 'read',
  createPaymentLinkStripe: 'repeatable',
  endRegisterSession: 'repeatable',
  generateFullReceiptId: 'read',
  getCashregisterReport: 'read',
  getArticle: 'read',
  getCustomer: 'read',
  getCustomerCredentials: 'read',
  getCustomerSignatureStatus: 'read',
  // DEP-Export: ein verlorener Ausgang ist harmlos wiederholbar. createDepExport ist mit requestId idempotent, ohne nur
  // doppelt (Grenze 20 je Tag, keine Buchung). createDepHandoverLink erzeugt bei Wiederholung einen zweiten Link (der
  // alte steht in getDepExport().handoverLinks und ist widerrufbar; Preis hoechstens too_many_links). revokeDepHandoverLink
  // ist idempotent.
  createDepExport: 'repeatable',
  createDepHandoverLink: 'repeatable',
  revokeDepHandoverLink: 'repeatable',
  getDepExport: 'read',
  getDepExportFile: 'read',
  getFirstReceiptDate: 'read',
  getInvoice: 'read',
  getInvoiceItem: 'read',
  getInvoicePdf: 'read',
  getInvoiceSetupStatus: 'read',
  getInvoiceXml: 'read',
  getKasseSettings: 'read',
  getMyDrawerState: 'read',
  getMyShiftReport: 'read',
  getPartnerBilling: 'read',
  getPartnerBillingMonth: 'read',
  getPartnerCustomer: 'read',
  getPartnerInfo: 'read',
  getPrintJob: 'read',
  getReceipt: 'read',
  getRegisterInspectionInfo: 'read',
  getReportV2: 'read',
  getReservation: 'read',
  getStock: 'read',
  getStocktake: 'read',
  getSignatureCardOrder: 'read',
  getStocktakePdf: 'read',
  getVariantGroup: 'read',
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
  listMyStocktakeCounts: 'read',
  listMyStocktakeItems: 'read',
  listMyStocktakes: 'read',
  listMyTipRecipients: 'read',
  listPartnerCustomers: 'read',
  listPartnerWebhookDeliveries: 'read',
  listPartnerWebhooks: 'read',
  listReceipts: 'read',
  listRegisterSessionsForDevice: 'read',
  listRegisterUsersForDevice: 'read',
  listReservations: 'read',
  listStock: 'read',
  listStockMovements: 'read',
  listStocktakeCounts: 'read',
  listStocktakeItems: 'read',
  listStocktakes: 'read',
  listVariantGroups: 'read',
  listWebhookDeliveries: 'read',
  listWebhooks: 'read',
  lookupArticleByCode: 'read',
  registerPinLogin: 'repeatable',
  registerUserLogin: 'repeatable',
  renewRegisterSession: 'repeatable',
  reprintVoucherLabel: 'repeatable',
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

/** Einer der 48 Aufrufe des Kassenwegs. */
export function isPosCall(name: string): boolean {
  return KASSENWEG.has(name);
}

/**
 * Nur ueber den Kassenweg erreichbar (37 Namen): unter `api.kasseneck.at/v3`
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

/** Wie `createPdfOrDataTransport` (transport.ts), nur mit bekanntem Aufrufnamen. */
export type InternerPdfOderDatenTransport = (
  functionName: ApiCall,
  params?: Record<string, unknown>,
) => Promise<PdfOrData>;

/** Wie `createFileOrDataTransport` (transport.ts), nur mit bekanntem Aufrufnamen. */
export type InternerDateiOderDatenTransport = (
  functionName: ApiCall,
  params?: Record<string, unknown>,
  options?: FileOrDataCallOptions,
) => Promise<FileOrData>;
