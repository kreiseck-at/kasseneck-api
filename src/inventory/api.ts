/**
 * Fassade ueber den Aufrufen der Lager-API (lesen, Webhooks, schreiben,
 * reservieren, Varianten): Schluessel einmal binden, dann rufen. Wie [createInvoiceApi] bewusst keine Klasse; die Aufrufe sind freie
 * Funktionen (endpunkte.ts) und bleiben einzeln importierbar.
 */

import type { InternerTransport } from '../client/aufrufe.js';
import { createTransport, type FetchLike } from '../client/transport.js';
import { inventoryKeyAuth } from './auth.js';
import {
  createWebhook,
  deleteWebhook,
  getArticle,
  getStock,
  iterateArticles,
  iterateStock,
  iterateStockMovements,
  listArticles,
  listLocations,
  listStock,
  listStockMovements,
  listWebhookDeliveries,
  listWebhooks,
  lookupArticleByCode,
  rotateWebhookSecret,
  sendWebhookTest,
  updateWebhook,
} from './endpunkte.js';
import {
  changeStockCondition,
  createArticle,
  createReservation,
  deactivateArticle,
  extendReservation,
  getReservation,
  iterateReservations,
  listReservations,
  previewGoodsReceipt,
  receiveGoods,
  recordStockLoss,
  releaseReservation,
  reverseStockMovement,
  transferStock,
  updateArticle,
} from './schreiben.js';
import {
  addVariant,
  createVariantGroup,
  getVariantGroup,
  iterateVariantGroups,
  listVariantGroups,
  updateVariantGroup,
} from './varianten.js';
import type {
  AddVariantRequest,
  CreateVariantGroupRequest,
  UpdateVariantGroupRequest,
  VariantGroup,
  VariantGroupListQuery,
  VariantGroupPage,
  Article,
  ChangeStockConditionRequest,
  CreateArticleRequest,
  CreateReservationRequest,
  DeactivateArticleRequest,
  ExtendReservationRequest,
  GoodsReceiptPreview,
  GoodsReceiptPreviewRequest,
  ReceiveGoodsRequest,
  RecordStockLossRequest,
  ReleaseReservationRequest,
  Reservation,
  ReservationListQuery,
  ReservationPage,
  ReverseStockMovementRequest,
  StockOperation,
  TransferStockRequest,
  UpdateArticleRequest,
  ArticleListQuery,
  ArticleLookup,
  ArticlePage,
  CreateInventoryWebhookOptions,
  InventoryWebhook,
  InventoryWebhookDelivery,
  InventoryWebhookList,
  InventoryWebhookPatch,
  InventoryWebhookTestResult,
  InventoryWebhookWithSecret,
  Location,
  StockLevel,
  StockListQuery,
  StockMovement,
  StockMovementPage,
  StockMovementQuery,
  StockPage,
  StockResult,
} from './typen.js';
import type { InventoryWebhookEventType } from './vertrag.js';

export interface InventoryClientOptions {
  /** `api_key` des Kontos (`kr_live_…` / `kr_test_…`). Gehoert auf einen Server. */
  apiKey: string;
  /** Abweichende Basis-URL (eigener Proxy); muss auf `/v3` enden. Vorgabe `https://api.kasseneck.at/v3`. */
  baseUrl?: string;
  /** Zeitlimit je Aufruf in Millisekunden. */
  timeoutMs?: number;
  /** Eigene `fetch`-Umsetzung (Tests, Proxys). */
  fetch?: FetchLike;
}

export interface InventoryClient {
  // Artikel
  getArticle(articleId: string): Promise<Article>;
  listArticles(query?: ArticleListQuery): Promise<ArticlePage>;
  /** Alle Artikel der Abfrage ueber `nextCursor`: `for await (const a of client.iterateArticles())`. */
  iterateArticles(query?: ArticleListQuery): AsyncGenerator<Article, void, undefined>;
  lookupArticleByCode(lookup: ArticleLookup): Promise<Article>;

  // Standorte und Bestand
  listLocations(): Promise<Location[]>;
  getStock(articleId: string): Promise<StockResult>;
  listStock(query?: StockListQuery): Promise<StockPage>;
  iterateStock(query?: StockListQuery): AsyncGenerator<StockLevel, void, undefined>;
  listStockMovements(query?: StockMovementQuery): Promise<StockMovementPage>;
  iterateStockMovements(query?: StockMovementQuery): AsyncGenerator<StockMovement, void, undefined>;

  // Webhooks
  createWebhook(options: CreateInventoryWebhookOptions): Promise<InventoryWebhookWithSecret>;
  updateWebhook(webhookId: string, patch: InventoryWebhookPatch): Promise<InventoryWebhook>;
  deleteWebhook(webhookId: string): Promise<{ webhookId: string; deleted: boolean }>;
  listWebhooks(): Promise<InventoryWebhookList>;
  sendWebhookTest(webhookId: string, event: InventoryWebhookEventType | (string & {})): Promise<InventoryWebhookTestResult>;
  rotateWebhookSecret(webhookId: string): Promise<InventoryWebhookWithSecret>;
  listWebhookDeliveries(options?: { webhookId?: string; limit?: number }): Promise<InventoryWebhookDelivery[]>;

  // Schreiben (Stufe 5b): jeder Aufruf mit `idempotencyKey`, Konto-Schalter „Lager-API schreiben“.
  createArticle(request: CreateArticleRequest): Promise<Article>;
  updateArticle(request: UpdateArticleRequest): Promise<Article>;
  deactivateArticle(request: DeactivateArticleRequest): Promise<Article>;
  receiveGoods(request: ReceiveGoodsRequest): Promise<StockOperation>;
  /** `receiveGoods` mit `dryRun: true`: rechnet, schreibt nichts, Schluessel freigestellt. */
  previewGoodsReceipt(request: GoodsReceiptPreviewRequest): Promise<GoodsReceiptPreview>;
  transferStock(request: TransferStockRequest): Promise<StockOperation>;
  recordStockLoss(request: RecordStockLossRequest): Promise<StockOperation>;
  changeStockCondition(request: ChangeStockConditionRequest): Promise<StockOperation>;
  reverseStockMovement(request: ReverseStockMovementRequest): Promise<StockOperation>;

  // Reservierung (Stufe 5b): eingeloest ueber `issueInvoice` mit `items[].reservationId`.
  createReservation(request: CreateReservationRequest): Promise<Reservation>;
  extendReservation(request: ExtendReservationRequest): Promise<Reservation>;
  releaseReservation(request: ReleaseReservationRequest): Promise<Reservation>;
  getReservation(reservationId: string): Promise<Reservation>;
  listReservations(query?: ReservationListQuery): Promise<ReservationPage>;
  iterateReservations(query?: ReservationListQuery): AsyncGenerator<Reservation, void, undefined>;

  // Varianten (Stufe 5c, seit 1.6.0): eine Variante ist ein Artikel mit
  // `variantGroupId`; die schreibenden Aufrufe mit `idempotencyKey` und dem
  // Konto-Schalter „Lager-API schreiben“, wie oben.
  createVariantGroup(request: CreateVariantGroupRequest): Promise<VariantGroup>;
  /** Name, Vorgaben, neue Werte; oder `active: false` (Gruppe und alle Varianten stilllegen, endgueltig). */
  updateVariantGroup(request: UpdateVariantGroupRequest): Promise<VariantGroup>;
  /** Eine Variante mehr; Antwort: der Artikel wie `createArticle`. */
  addVariant(request: AddVariantRequest): Promise<Article>;
  getVariantGroup(variantGroupId: string): Promise<VariantGroup>;
  listVariantGroups(query?: VariantGroupListQuery): Promise<VariantGroupPage>;
  iterateVariantGroups(query?: VariantGroupListQuery): AsyncGenerator<VariantGroup, void, undefined>;
}

export function createInventoryClient(options: InventoryClientOptions): InventoryClient {
  const rufen = createTransport({
    auth: inventoryKeyAuth({ apiKey: options.apiKey }),
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
    fetch: options.fetch,
  }) as InternerTransport;

  return {
    getArticle: (id) => getArticle(rufen, id),
    listArticles: (q) => listArticles(rufen, q),
    iterateArticles: (q) => iterateArticles(rufen, q),
    lookupArticleByCode: (l) => lookupArticleByCode(rufen, l),

    listLocations: () => listLocations(rufen),
    getStock: (id) => getStock(rufen, id),
    listStock: (q) => listStock(rufen, q),
    iterateStock: (q) => iterateStock(rufen, q),
    listStockMovements: (q) => listStockMovements(rufen, q),
    iterateStockMovements: (q) => iterateStockMovements(rufen, q),

    createWebhook: (o) => createWebhook(rufen, o),
    updateWebhook: (id, patch) => updateWebhook(rufen, id, patch),
    deleteWebhook: (id) => deleteWebhook(rufen, id),
    listWebhooks: () => listWebhooks(rufen),
    sendWebhookTest: (id, event) => sendWebhookTest(rufen, id, event),
    rotateWebhookSecret: (id) => rotateWebhookSecret(rufen, id),
    listWebhookDeliveries: (o) => listWebhookDeliveries(rufen, o),

    createArticle: (r) => createArticle(rufen, r),
    updateArticle: (r) => updateArticle(rufen, r),
    deactivateArticle: (r) => deactivateArticle(rufen, r),
    receiveGoods: (r) => receiveGoods(rufen, r),
    previewGoodsReceipt: (r) => previewGoodsReceipt(rufen, r),
    transferStock: (r) => transferStock(rufen, r),
    recordStockLoss: (r) => recordStockLoss(rufen, r),
    changeStockCondition: (r) => changeStockCondition(rufen, r),
    reverseStockMovement: (r) => reverseStockMovement(rufen, r),

    createReservation: (r) => createReservation(rufen, r),
    extendReservation: (r) => extendReservation(rufen, r),
    releaseReservation: (r) => releaseReservation(rufen, r),
    getReservation: (id) => getReservation(rufen, id),
    listReservations: (q) => listReservations(rufen, q),
    iterateReservations: (q) => iterateReservations(rufen, q),

    createVariantGroup: (r) => createVariantGroup(rufen, r),
    updateVariantGroup: (r) => updateVariantGroup(rufen, r),
    addVariant: (r) => addVariant(rufen, r),
    getVariantGroup: (id) => getVariantGroup(rufen, id),
    listVariantGroups: (q) => listVariantGroups(rufen, q),
    iterateVariantGroups: (q) => iterateVariantGroups(rufen, q),
  };
}
