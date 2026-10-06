/**
 * `@kreiseck/kasseneck-api/inventory` – die Lager-API: Artikel, Standorte,
 * Bestand und Lagerprotokoll lesen, Konto-Webhooks verwalten und eingehende
 * Zustellungen pruefen (Backend Stufe 5a).
 *
 * Ein eigener Unterpfad wie `invoice`: der `api_key` eines Kontos gehoert auf
 * einen **Server** (etwa das Backend eines Online-Shops) und soll nicht
 * versehentlich in ein Browser-Buendel wandern.
 *
 * Mengen in Tausendstel der Basiseinheit, Geld in Cent, Einkaufspreise in
 * Mikro-Euro; alles Ganzzahlen.
 */

export { createInventoryClient, type InventoryClient, type InventoryClientOptions } from './api.js';

export { inventoryKeyAuth, type InventoryKeyAuthOptions } from './auth.js';

export {
  isInventoryError,
  isInventoryErrorCode,
  inventoryErrorCode,
  inventoryFieldErrors,
  inventoryRetryAfterSec,
  type InventoryApiErrorCode,
  type InventoryFieldError,
} from './fehler.js';

export {
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

export {
  verifyWebhookSignature,
  parseWebhookEvent,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_TOLERANCE_SEC,
  type VerifyInventoryWebhookOptions,
} from './webhook.js';

export type {
  Article,
  ArticleListQuery,
  ArticleLookup,
  ArticlePage,
  CreateInventoryWebhookOptions,
  InventoryWebhook,
  InventoryWebhookDelivery,
  InventoryWebhookEnvelope,
  InventoryWebhookEvent,
  InventoryWebhookList,
  InventoryWebhookPatch,
  InventoryWebhookTestDelivery,
  InventoryWebhookTestResult,
  InventoryWebhookWithSecret,
  Location,
  LocationAddress,
  StockBelowMinimumEventData,
  StockChangedEventData,
  StockLevel,
  StockListQuery,
  StockMovement,
  StockMovementLot,
  StockMovementPage,
  StockMovementQuery,
  StockMovementSourceRef,
  StockPage,
  StockResult,
  StockValue,
} from './typen.js';

export {
  INVENTORY_ENDPOINTS,
  INVENTORY_ERROR_CODES,
  INVENTORY_REQUEST_ERROR_CODES,
  INVENTORY_WEBHOOK_EVENTS,
  INVENTORY_WEBHOOK_ENVELOPE_FIELDS,
  INVENTORY_WEBHOOK_LIMIT,
  INVENTORY_LIST_LIMIT_MAX,
  LOCATION_TYPES,
  STOCK_MOVEMENT_TYPES,
  STOCK_MOVEMENT_SOURCES,
  STOCK_CONDITIONS,
  STOCK_CHANGE_CAUSES,
  WEBHOOK_DELIVERY_STATUSES,
  type InventoryEndpoint,
  type InventoryErrorCode,
  type InventoryRequestErrorCode,
  type InventoryWebhookEventType,
  type LocationType,
  type StockMovementType,
  type StockMovementSource,
  type StockCondition,
  type StockChangeCause,
  type WebhookDeliveryStatus,
} from './vertrag.js';
