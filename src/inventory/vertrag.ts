/**
 * Der Vertrag der Lager-API (Backend Stufe 5a lesen, 5b schreiben und
 * reservieren) als Daten: Endpunkte, Wertkataloge, Ereignisse, Fehler- und
 * Hinweiscodes, englisch wie am Draht `/v3`.
 *
 * Quelle ist der Vertrags-Export des Backends (`fixtures/v3/v3-vokabular.json`):
 * `endpoints.public`, die Kataloge `STANDORT_TYP`, `BEWEGUNG_ART`,
 * `BEWEGUNG_QUELLE`, `LAGER_ZUSTAND`, `LAGER_URSACHE`, `ZUSTELLUNG`,
 * `LAGER_ABGANG_GRUND`, `LAGER_ENTNAHME_ART`, `LAGER_NEBENKOSTEN_ART`,
 * `LAGER_VERTEILUNG`, `RESERVIERUNG_STATUS`, dazu `events`, `errorCodes.inventory`
 * und `warningCodes.inventory`. `test/inventory.test.ts` haelt jede Liste
 * deckungsgleich mit dieser Datei; nichts hier wird geraten.
 */

/** Die 27 Endpunkte (14 aus 5a, 13 aus 5b), in der Reihenfolge von `endpoints.public`. */
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
export type InventoryEndpoint = (typeof INVENTORY_ENDPOINTS)[number];

/** Art eines Standorts (Katalog `STANDORT_TYP`). */
export const LOCATION_TYPES = ['warehouse', 'store', 'vehicle', 'other'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

/**
 * Art einer Lagerbewegung (Katalog `BEWEGUNG_ART`); zugleich der Filter `type`.
 * `goods_receipt` ist der Wareneingang, `takeover` der uebernommene Anfangsbestand
 * (auch per Import). `receipt` gibt es hier nicht: das ist der Kassenbeleg (Quelle).
 * `reservation` (seit 1.5.0) aendert nur `reserved`: `quantityDelta` ist 0, die
 * Menge steht in `reservedDelta`.
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
  'reservation',
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
 * Die Ereignisse, die ein Konto-Webhook abonnieren kann, in der Reihenfolge von
 * `listWebhooks().events`. `reservation.*` (seit 1.5.0) tragen die Reservierung
 * wie `getReservation`, mit dem Status danach: `reservation.released` und
 * `reservation.redeemed` kommen bei jeder wirksamen Freigabe bzw. Einloesung,
 * auch einer teilweisen (dann bleibt der Status `active`).
 */
export const INVENTORY_WEBHOOK_EVENTS = [
  'stock.changed',
  'stock.below_minimum',
  'article.created',
  'article.updated',
  'article.deactivated',
  'reservation.expired',
  'reservation.released',
  'reservation.redeemed',
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
 * Die Codes, die die Lager-Endpunkte selbst senden (`errorCodes.inventory`;
 * `register_user_not_allowed` steht bei [INVENTORY_REQUEST_ERROR_CODES]).
 * `validation` traegt `errors: [{ field, message }]`, `rate_limited` traegt
 * `retryAfterSec` (dazu die Kopfzeile `Retry-After`) – auch bei
 * `sendWebhookTest` nach 20 Probesendungen je Wiener Kalendertag (dann bis
 * Mitternacht in Wien).
 *
 * Seit 1.5.0 hinten angehaengt, in der Reihenfolge des Vertrags: die Codes
 * der schreibenden Endpunkte. `idempotency_key_required` (Schluessel fehlt),
 * `idempotency_conflict` (derselbe Schluessel mit anderem Inhalt),
 * `exceeds_stock` (Abgang, Umbuchung und Zustandswechsel ueberziehen nie),
 * `insufficient_available` (Reservierung; `data.details[]`, siehe
 * [inventoryShortfalls]), `code_taken` und `external_id_taken` (mit `field` und
 * `articleId` des Artikels, dem der Code gehoert), `stock_kind_locked`,
 * `reservation_not_found`, `reservation_not_active` …
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
  'idempotency_key_required',
  'idempotency_conflict',
  'location_not_found',
  'location_inactive',
  'invalid_location',
  'invalid_locations',
  'invalid_transfer',
  'operation_not_found',
  'already_reversed',
  'reversal_not_possible',
  'reversal_not_supported',
  'exceeds_stock',
  'no_positions',
  'too_many_positions',
  'invalid_step',
  'invalid_quantity',
  'invalid_amount',
  'invalid_price',
  'negative_value',
  'invalid_reason',
  'note_required',
  'withdrawal_type_required',
  'invalid_method',
  'invalid_stock_kind',
  'invalid_minimum',
  'invalid_dimensions',
  'weight_missing',
  'invalid_landed_cost',
  'invalid_distribution',
  'landed_costs_mismatch',
  'return_totals_mismatch',
  'lot_not_found',
  'invalid_serial',
  'serial_required',
  'serial_not_allowed',
  'serial_already_exists',
  'serial_not_in_stock',
  'code_taken',
  'external_id_taken',
  'group_not_found',
  'revenue_group_not_found',
  'stock_kind_locked',
  'article_inactive',
  'invalid_position',
  'invalid_condition',
  'reason_required',
  'insufficient_available',
  'reservation_not_found',
  'reservation_not_active',
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

// ---- Schreiben und Reservierung (Backend Stufe 5b, seit 1.5.0) -----------------

/**
 * Hinweise einer Buchung (`warnings[].code`, `warningCodes.inventory`). Sie sind
 * keine Fehler: die Buchung hat gewirkt. `insufficient_stock` gibt es nur beim
 * Verkauf (Abgang, Umbuchung und Zustandswechsel weisen mit `exceeds_stock` ab),
 * `below_minimum` misst am verfuegbaren Bestand (`onHand − reserved`) gegen den
 * Mindestbestand des Standorts, `reservation_exceeded` meldet eine Rechnung, die
 * mehr verkauft als reserviert war.
 */
export const INVENTORY_WARNING_CODES = [
  'insufficient_stock',
  'below_minimum',
  'return_exceeds_sale',
  'reservation_exceeded',
] as const;
export type InventoryWarningCode = (typeof INVENTORY_WARNING_CODES)[number];

/**
 * Bestandsart eines Artikels (`stockKind`): `quantity` = Menge, `serial` =
 * Einzelstueck mit Seriennummer. Kein Katalog des Vokabulars, der Server
 * uebersetzt das Feld selbst; nach der ersten Bewegung fest (`stock_kind_locked`).
 */
export const STOCK_KINDS = ['quantity', 'serial'] as const;
export type StockKind = (typeof STOCK_KINDS)[number];

/** Grund eines Abgangs (`recordStockLoss.reason`, Katalog `LAGER_ABGANG_GRUND`). `other` braucht `note`. */
export const STOCK_LOSS_REASONS = ['breakage', 'shrinkage', 'theft', 'expired', 'withdrawal', 'disposal', 'other'] as const;
export type StockLossReason = (typeof STOCK_LOSS_REASONS)[number];

/** Art einer Entnahme (`withdrawalType`, Katalog `LAGER_ENTNAHME_ART`); Pflicht bei `reason: 'withdrawal'`, sonst nicht erlaubt. */
export const WITHDRAWAL_TYPES = ['private', 'staff', 'gift', 'sample'] as const;
export type WithdrawalType = (typeof WITHDRAWAL_TYPES)[number];

/** Art von Nebenkosten eines Wareneingangs (`landedCosts[].type`, Katalog `LAGER_NEBENKOSTEN_ART`). */
export const LANDED_COST_TYPES = ['freight', 'customs', 'insurance', 'other', 'discount', 'cash_discount'] as const;
export type LandedCostType = (typeof LANDED_COST_TYPES)[number];

/** Verteilung der Nebenkosten (`allocation`, Katalog `LAGER_VERTEILUNG`); Vorgabe des Servers `value`. */
export const LANDED_COST_ALLOCATIONS = ['value', 'quantity', 'weight', 'manual'] as const;
export type LandedCostAllocation = (typeof LANDED_COST_ALLOCATIONS)[number];

/**
 * Stand einer Reservierung (Katalog `RESERVIERUNG_STATUS`). Nur `active` haelt
 * Ware zurueck; die drei anderen sind endgueltig: `redeemed` (ueber eine
 * Rechnung eingeloest), `released` (freigegeben), `expired` (abgelaufen).
 */
export const RESERVATION_STATUSES = ['active', 'redeemed', 'released', 'expired'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Laengster `idempotencyKey` (Zeichen); laenger weist der Server ab, er schneidet nie ab. */
export const INVENTORY_IDEMPOTENCY_KEY_MAX = 120;

/** Kuerzeste und laengste Haltedauer einer Reservierung in Minuten (`expiresInMinutes`, 30 Tage). */
export const RESERVATION_MINUTES_MIN = 5;
export const RESERVATION_MINUTES_MAX = 43_200;
