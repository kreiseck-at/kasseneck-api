/**
 * Der Vertrag der Lager-API (Backend Stufe 5a lesen, 5b schreiben und
 * reservieren, 5c Varianten, Lager-Kern Stufe 3 Inventur) als Daten:
 * Endpunkte, Wertkataloge, Ereignisse, Fehler- und Hinweiscodes, englisch wie
 * am Draht `/v3`.
 *
 * Quelle ist der Vertrags-Export des Backends (`fixtures/v3/v3-vokabular.json`):
 * `endpoints.public`, die Kataloge `STANDORT_TYP`, `BEWEGUNG_ART`,
 * `BEWEGUNG_QUELLE`, `LAGER_ZUSTAND`, `LAGER_URSACHE`, `ZUSTELLUNG`,
 * `LAGER_ABGANG_GRUND`, `LAGER_ENTNAHME_ART`, `LAGER_NEBENKOSTEN_ART`,
 * `LAGER_VERTEILUNG`, `RESERVIERUNG_STATUS`, die Inventur-Kataloge `INVENTUR_*`,
 * dazu `events`, `errorCodes.inventory`
 * und `warningCodes.inventory`. `test/inventory.test.ts` haelt jede Liste
 * deckungsgleich mit dieser Datei; nichts hier wird geraten.
 */

/** Die 44 Endpunkte (14 aus 5a, 13 aus 5b, 5 aus 5c, 12 der Inventur), in der Reihenfolge von `endpoints.public`. */
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
  'createVariantGroup',
  'updateVariantGroup',
  'getVariantGroup',
  'listVariantGroups',
  'addVariant',
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
 * `variant_group.created` und `variant_group.updated` (seit 1.6.0) tragen die
 * Variantengruppe wie `getVariantGroup`; `updated` kommt nur bei einer aussen
 * sichtbaren Aenderung (neuer Wert, neue oder stillgelegte Variante, Name,
 * Vorgaben, Stilllegen der Gruppe).
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
  'variant_group.created',
  'variant_group.updated',
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
 *
 * Seit 1.6.0 dahinter die Codes der Variantengruppen: `variant_group_not_found`
 * (unbekannte Kennung), `variant_already_exists` (die Kombination gibt es in der
 * Gruppe schon, dann mit `articleId` der bestehenden Variante, oder sie steht
 * zweimal in `variants[]`; jeweils mit `field`),
 * `invalid_variant_attributes` (ein Merkmal fehlt, ist unbekannt oder sein Wert
 * steht nicht in der Werteliste; `field` und `errors[]`),
 * `variant_group_inactive` (stillgelegte Gruppe: kein `addVariant`, keine
 * Aenderung ausser erneutem Stilllegen) und `variant_limit` (mehr als
 * [VARIANT_GROUP_ACTIVE_MAX] aktive Varianten je Gruppe). Wiederverwendet:
 * `too_many_positions` traegt bei Varianten `field` (`variants`,
 * `createMatrix` bzw. `externalIds` bei `addVariant`): die Anfrage braeuchte
 * mehr Schreibvorgaenge, als in einen Vorgang passen; geschrieben wurde nichts.
 *
 * Seit 1.8.0 dahinter die Codes der Inventur: `stocktake_not_found`,
 * `stocktake_not_open` (Zaehlen oder Stornieren ausserhalb der Zaehlung bzw.
 * an einer Position, die nicht zum Nachzaehlen frei ist), `stocktake_closed`
 * (abgeschlossen oder abgebrochen: nichts mehr schreibbar),
 * `stocktake_not_in_review` (Nachzaehlen und Abschluss nur in `review`),
 * `stocktake_closing` (der Abschluss bucht gerade), `stocktake_location_busy`
 * (am Standort laeuft schon eine Inventur; `data.stocktakeId` nennt sie),
 * `stocktake_review_running` (die Pruefung rechnet noch), `stocktake_recount_open`
 * (Abschluss, solange Positionen zum Nachzaehlen offen sind: erst nachzaehlen,
 * dann erneut pruefen), `article_not_in_scope`, `article_not_tracked`,
 * `count_not_found`, `count_already_voided`, `serial_already_counted` (dieselbe
 * Seriennummer zweimal in einer Runde), `too_many_counts` (mehr als
 * [STOCKTAKE_COUNTS_PER_ITEM_MAX] Zaehlungen je Position und Runde) und
 * `stocktake_not_closed` (das Protokoll gibt es erst nach dem Abschluss, auch
 * nicht fuer eine abgebrochene Inventur).
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
  'variant_group_not_found',
  'variant_already_exists',
  'invalid_variant_attributes',
  'variant_group_inactive',
  'variant_limit',
  'stocktake_not_found',
  'stocktake_not_open',
  'stocktake_closed',
  'stocktake_not_in_review',
  'stocktake_closing',
  'stocktake_location_busy',
  'stocktake_review_running',
  'stocktake_recount_open',
  'article_not_in_scope',
  'article_not_tracked',
  'count_not_found',
  'count_already_voided',
  'serial_already_counted',
  'too_many_counts',
  'stocktake_not_closed',
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
  'app_check_invalid',
  'app_check_missing',
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
 *
 * Seit 1.8.0 die Hinweise der Inventur, je mit der Zahl der Positionen
 * (`items`): `defect_capped` (eine Fehlmenge im Zustand `defective` reichte
 * ueber den Defektbestand, der Rest blieb ungebucht), `uncounted_items` (nicht
 * gezaehlt und darum nicht gebucht), `not_booked` (nicht oder nicht ganz
 * gebucht, Grund an der Position, `notBooked`) und `recount_uncounted`
 * (Positionen zum Nachzaehlen blieben ungezaehlt; die Antwort von
 * `closeStocktake` traegt ihn).
 */
export const INVENTORY_WARNING_CODES = [
  'insufficient_stock',
  'below_minimum',
  'return_exceeds_sale',
  'reservation_exceeded',
  'defect_capped',
  'uncounted_items',
  'not_booked',
  'recount_uncounted',
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

// ---- Varianten (Backend Stufe 5c, seit 1.6.0) -----------------------------------

/**
 * Grenzen einer Variantengruppe, wie das Backend sie prueft. Das Paket prueft
 * sie **nicht** vor dem Senden: der Server darf sie anheben, ohne dass eine
 * aeltere Paketversion dann faelschlich abweist. Wer darueber liegt, bekommt
 * `validation` (Merkmale, Werte, Matrix, `variants[]`) bzw. `variant_limit`.
 *
 * - [VARIANT_ATTRIBUTES_MAX] Merkmale je Gruppe (Schluessel `^[a-z0-9_]{1,32}$`,
 *   eindeutig; `__…__` ist reserviert),
 * - [VARIANT_VALUES_MAX] Werte je Merkmal (je 1–30 Zeichen, eindeutig ohne
 *   Gross/Klein),
 * - [VARIANT_MATRIX_MAX] Kombinationen bei `createMatrix: true` und hoechstens
 *   so viele Eintraege in `variants[]` je Anfrage,
 * - [VARIANT_GROUP_ACTIVE_MAX] aktive Varianten je Gruppe.
 */
export const VARIANT_ATTRIBUTES_MAX = 3;
export const VARIANT_VALUES_MAX = 30;
export const VARIANT_MATRIX_MAX = 100;
export const VARIANT_GROUP_ACTIVE_MAX = 250;

// ---- Inventur (Lager-Kern Stufe 3, seit 1.8.0) ----------------------------------

/**
 * Stand einer Inventur (Katalog `INVENTUR_STATUS`). Gezaehlt wird in
 * `counting`; `review` rechnet Soll und Differenz (erst ab hier sichtbar,
 * blind); `closing` bucht den Abschluss in Teilen; `closed` und `cancelled`
 * sind endgueltig. `creating` steht nur, solange eine grosse Anlage ihre
 * Positionen schreibt.
 */
export const STOCKTAKE_STATUSES = ['creating', 'counting', 'review', 'closing', 'closed', 'cancelled'] as const;
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

/**
 * Art einer Inventur (Katalog `INVENTUR_ART`): `key_date` zu einem Stichtag
 * (`keyDate`), `perpetual` (permanente Inventur, ohne Stichtag).
 */
export const STOCKTAKE_TYPES = ['key_date', 'perpetual'] as const;
export type StocktakeType = (typeof STOCKTAKE_TYPES)[number];

/** Umfang einer Inventur (Katalog `INVENTUR_UMFANG`): alle bestandsgefuehrten Artikel des Standorts, Artikelgruppen oder genannte Artikel. */
export const STOCKTAKE_SCOPE_TYPES = ['all', 'groups', 'articles'] as const;
export type StocktakeScopeType = (typeof STOCKTAKE_SCOPE_TYPES)[number];

/**
 * Warum eine Position in der Pruefung „pruefen“ traegt (Katalog
 * `INVENTUR_PRUEFGRUND`): Bewegung zwischen der ersten und letzten Zaehlung,
 * Zaehlung mehr als 10 Tage vom Stichtag, Seriennummern weichen ab, nicht gezaehlt.
 */
export const STOCKTAKE_CHECK_REASONS = ['movements_between_counts', 'far_from_key_date', 'serial_mismatch', 'not_counted'] as const;
export type StocktakeCheckReason = (typeof STOCKTAKE_CHECK_REASONS)[number];

/**
 * Warum eine Position nicht oder nicht ganz gebucht wurde (`notBooked.code`,
 * Katalog `INVENTUR_NICHT_GEBUCHT`). Dazu kommen Codes, die schon englisch
 * sind (`serial_not_in_stock`, `serial_already_exists`, `article_not_found`);
 * das Modell laesst darum jeden Text stehen.
 */
export const STOCKTAKE_NOT_BOOKED_REASONS = ['serial_mismatch', 'recount_open', 'defect_capped'] as const;
export type StocktakeNotBookedReason = (typeof STOCKTAKE_NOT_BOOKED_REASONS)[number];

/** Woher eine Zaehlung bzw. Inventur kam (Katalog `INVENTUR_QUELLE`). */
export const STOCKTAKE_SOURCES = ['register', 'panel', 'api'] as const;
export type StocktakeSource = (typeof STOCKTAKE_SOURCES)[number];

/** Wer handelte (Katalog `INVENTUR_AKTEUR`): Inhaber, Kasseneck-Admin, Kassen-Benutzer, API-Schluessel. */
export const STOCKTAKE_ACTOR_TYPES = ['owner', 'admin', 'register_user', 'api'] as const;
export type StocktakeActorType = (typeof STOCKTAKE_ACTOR_TYPES)[number];

/**
 * Zu welchem Zeitpunkt das Inventar im Protokoll steht (Katalog
 * `INVENTUR_INVENTAR_ZUM`): `key_date` (auf das Ende des Stichtags
 * fortgeschrieben, Abschluss nach dem Stichtag) oder `count_date` (Menge zur
 * Aufnahme: permanente Inventur oder Abschluss vor dem Stichtag).
 */
export const STOCKTAKE_INVENTORY_AS_OF = ['key_date', 'count_date'] as const;
export type StocktakeInventoryAsOf = (typeof STOCKTAKE_INVENTORY_AS_OF)[number];

/**
 * Grenzen einer Inventur, wie das Backend sie prueft. Wie bei den Varianten
 * prueft das Paket sie **nicht** vor dem Senden:
 *
 * - [STOCKTAKE_ITEMS_MAX] Positionen je Inventur (`too_many_positions`;
 *   groessere Bestaende in mehreren Inventuren nacheinander),
 * - [STOCKTAKE_RECOUNT_ITEMS_MAX] Positionen je `recountStocktake`,
 * - [STOCKTAKE_COUNTS_PER_ITEM_MAX] Zaehlungen je Position und Runde
 *   (`too_many_counts`), hoechstens so viele Seriennummern je Zaehlung.
 */
export const STOCKTAKE_ITEMS_MAX = 5000;
export const STOCKTAKE_RECOUNT_ITEMS_MAX = 200;
export const STOCKTAKE_COUNTS_PER_ITEM_MAX = 200;
