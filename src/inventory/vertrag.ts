/**
 * Der Vertrag der Lager-API (Backend Stufe 5a) als Daten: Endpunkte,
 * Wertkataloge, Ereignisse und Fehlercodes, englisch wie am Draht `/v3`.
 *
 * Quelle ist der Vertrags-Export des Backends (`fixtures/v3/v3-vokabular.json`):
 * `endpoints.public`, die Kataloge `STANDORT_TYP`, `BEWEGUNG_ART`,
 * `BEWEGUNG_QUELLE`, `LAGER_ZUSTAND`, `LAGER_URSACHE`, `ZUSTELLUNG` und
 * `events`. `test/inventory.test.ts` haelt jede Liste deckungsgleich mit
 * dieser Datei; nichts hier wird geraten.
 */

/** Die 14 Endpunkte, in der Reihenfolge von `endpoints.public`. */
export const INVENTORY_ENDPOINTS = [
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
] as const;
export type InventoryEndpoint = (typeof INVENTORY_ENDPOINTS)[number];

/** Art eines Standorts (Katalog `STANDORT_TYP`). */
export const LOCATION_TYPES = ['warehouse', 'store', 'vehicle', 'other'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

/**
 * Art einer Lagerbewegung (Katalog `BEWEGUNG_ART`); zugleich der Filter `type`.
 * `goods_receipt` ist der Wareneingang, `takeover` der uebernommene Anfangsbestand
 * (auch per Import). `receipt` gibt es hier nicht: das ist der Kassenbeleg (Quelle).
 */
export const STOCK_MOVEMENT_TYPES = [
  'sale',
  'goods_receipt',
  'loss',
  'return',
  'transfer_out',
  'transfer_in',
  'condition_out',
  'condition_in',
  'stocktake',
  'adjustment',
  'takeover',
  'reversal',
  'revaluation',
  'method_change',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/**
 * Woher eine Bewegung kommt (Katalog `BEWEGUNG_QUELLE`); zugleich der Filter
 * `source`. `receipt` ist der Kassenbeleg wie ueberall in der API (der
 * Wareneingang ist die Bewegungsart `goods_receipt`).
 */
export const STOCK_MOVEMENT_SOURCES = [
  'receipt',
  'invoice',
  'cancellation',
  'credit_note',
  'panel',
  'register',
  'api',
  'stocktake',
  'system',
] as const;
export type StockMovementSource = (typeof STOCK_MOVEMENT_SOURCES)[number];

/** Zustand der Ware an einer Bewegung (Katalog `LAGER_ZUSTAND`). */
export const STOCK_CONDITIONS = ['sellable', 'defective'] as const;
export type StockCondition = (typeof STOCK_CONDITIONS)[number];

/**
 * Ursache eines `stock.changed` (Katalog `LAGER_URSACHE`), abgeleitet aus der
 * juengsten Bewegung mit Mengenwirkung. `other`: keine Regel passt oder es
 * gibt keine Bewegung (dann ist `movementId` `null`).
 */
export const STOCK_CHANGE_CAUSES = [
  'sale',
  'invoice',
  'credit_note',
  'cancellation',
  'goods_receipt',
  'transfer',
  'loss',
  'condition',
  'reversal',
  'reservation',
  'stocktake',
  'takeover',
  'other',
] as const;
export type StockChangeCause = (typeof STOCK_CHANGE_CAUSES)[number];

/** Stand einer Zustellung (Katalog `ZUSTELLUNG`, derselbe wie bei Partner-Webhooks). */
export const WEBHOOK_DELIVERY_STATUSES = ['delivered', 'pending', 'failed', 'dropped'] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/**
 * Die Ereignisse, die ein Konto-Webhook abonnieren kann (Stufe 5a). Spaetere
 * Stufen ergaenzen `reservation.*` und `variant_group.*`.
 */
export const INVENTORY_WEBHOOK_EVENTS = [
  'stock.changed',
  'stock.below_minimum',
  'article.created',
  'article.updated',
  'article.deactivated',
] as const;
export type InventoryWebhookEventType = (typeof INVENTORY_WEBHOOK_EVENTS)[number];

/**
 * Die Felder der Huelle jeder Zustellung, in der Reihenfolge am Draht. Statt
 * `partnerId` (Partner-Webhooks) traegt sie `accountId`; `test` steht nur auf
 * Probesendungen.
 */
export const INVENTORY_WEBHOOK_ENVELOPE_FIELDS = ['id', 'type', 'createdAt', 'accountId', 'test', 'data'] as const;

/** Hoechstzahl der Webhooks je Konto (`webhook_limit`, wie bei Partner-Webhooks). */
export const INVENTORY_WEBHOOK_LIMIT = 5;

/** Groesstes `limit` einer Liste; ohne Angabe liefert der Server 50. */
export const INVENTORY_LIST_LIMIT_MAX = 200;

/**
 * Die Codes, die die Lager-Endpunkte selbst senden. `validation` traegt
 * `errors: [{ field, message }]`, `rate_limited` traegt `retryAfterSec`
 * (dazu die Kopfzeile `Retry-After`) – auch bei `sendWebhookTest` nach 20
 * Probesendungen je Wiener Kalendertag (dann bis Mitternacht in Wien).
 */
export const INVENTORY_ERROR_CODES = [
  'validation',
  'invalid_cursor',
  'article_not_found',
  'webhook_not_found',
  'webhook_limit',
  'invalid_webhook_url',
  'event_not_subscribed',
  'webhook_inactive',
  'inventory_api_not_enabled',
  'module_inactive',
  'rate_limited',
  'server_error',
] as const;
export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODES)[number];

/**
 * Codes, die Anmeldung und Rand auf jedem Lager-Aufruf erzeugen koennen,
 * soweit sie nicht schon in [INVENTORY_ERROR_CODES] stehen: `errorCodes.auth`
 * ohne die des Partner-Zugangs und `errorCodes.edge` (sortiert), zuletzt
 * `route_missing` (Code des Pakets). Dieselbe Ableitung wie bei der
 * Rechnungs-API.
 */
export const INVENTORY_REQUEST_ERROR_CODES = [
  'account_not_found',
  'admin_required',
  'api_not_approved',
  'cashregister_not_assigned',
  'cashregister_not_found',
  'cashregister_token_invalid',
  'cashregister_token_missing',
  'dialect_mismatch',
  'internal_translation_error',
  'live_not_enabled',
  'method_not_allowed',
  'mfa_required',
  'not_found',
  'register_user_no_business',
  'register_user_not_allowed',
  'register_user_not_found',
  'response_translation_failed',
  'session_expired',
  'session_other_cashregister',
  'unauthorized',
  'user_disabled',
  'user_verification_failed',
  'route_missing',
] as const;
export type InventoryRequestErrorCode = (typeof INVENTORY_REQUEST_ERROR_CODES)[number];
