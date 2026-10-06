/**
 * Fassade ueber den Aufrufen der Lager-API: Schluessel einmal binden, dann
 * rufen. Wie [createInvoiceApi] bewusst keine Klasse; die Aufrufe sind freie
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
import type {
  Article,
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
  };
}
