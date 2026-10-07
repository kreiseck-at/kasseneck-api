/**
 * Die Modelle der Lager-API, so wie sie am Draht `/v3` stehen.
 *
 * **Ganzzahlen mit fester Skala:** Mengen in Tausendstel der Basiseinheit
 * (`1000` = 1 Stueck, `250` = 0,250 kg), Geld in Cent, Einkaufspreise in
 * Mikro-Euro (`1_000_000` = 1 €). Nichts davon wird geteilt oder gerundet;
 * eine Bruchzahl in einer Antwort ist ein Antwortfehler
 * (`KasseneckValidationError`, `scope: 'response'`), nie ein Ersatzwert.
 *
 * Zeitpunkte sind ISO 8601 in UTC (`2026-10-06T08:15:00.000Z`), Tage (Wiener
 * Tag) `YYYY-MM-DD`.
 */

import type {
  InventoryWarningCode,
  InventoryWebhookEventType,
  LandedCostAllocation,
  LandedCostType,
  LocationType,
  ReservationStatus,
  StockChangeCause,
  StockCondition,
  StockKind,
  StockLossReason,
  StockMovementSource,
  StockMovementType,
  WebhookDeliveryStatus,
  WithdrawalType,
} from './vertrag.js';

// ---- Artikel ------------------------------------------------------------------

/**
 * Ein Artikel, wie `getArticle`, `listArticles`, `lookupArticleByCode` und die
 * Ereignisse `article.*` ihn senden.
 *
 * Optionale Felder fehlen ganz, wenn der Server sie nicht sendet:
 * `purchasePriceMicros` nur mit dem Recht `costs` (Konto-Schalter
 * `lagerApi.kosten`, sonst fehlt das Feld, nicht `null`), `externalIds`,
 * `metadata`, `variantGroupId` und `variantAttributes` nur, wenn der Artikel
 * sie traegt (eine Variante, siehe [VariantGroup]).
 */
export interface Article {
  id: string;
  name: string | null;
  /** Beschreibung (bis 2000 Zeichen); `null` = keine. Seit 1.5.0. */
  description: string | null;
  unitPriceCents: number | null;
  /** USt-Satz in Prozent, z. B. `20`, `10`, `4.9`. */
  vatRate: number | null;
  unit: string | null;
  number: string | null;
  ean: string | null;
  internalCode: string | null;
  groupId: string | null;
  revenueGroupId: string | null;
  stockTracked: boolean;
  /**
   * `quantity` (Menge) oder `serial` (Einzelstueck); `null`, wenn der Server
   * das Feld nicht sendet (vor Stufe 5b). Ein Wert, den diese Paketversion
   * nicht kennt, bleibt als Text stehen. Seit 1.5.0.
   */
  stockKind: StockKind | (string & {}) | null;
  /** Standorte, an denen der Artikel gefuehrt wird; leer = nur der Standard-Standort. */
  stockLocationIds: string[];
  /**
   * **Altfeld.** Mindestbestand des Artikels in Tausendstel; `null` = keiner.
   * Er loest nichts aus: Warnungen, `belowMinimum` und `stock.below_minimum`
   * richten sich nach [minStockByLocation].
   */
  minStock: number | null;
  /**
   * Mindestbestand je Standort in Tausendstel (`{ haupt: 20000 }`), die
   * Schwelle fuer `below_minimum`, gemessen am verfuegbaren Bestand
   * (`onHand − reserved`). Leer = keiner. Seit 1.5.0.
   */
  minStockByLocation: Record<string, number>;
  active: boolean;
  externalIds?: Record<string, string>;
  metadata?: Record<string, string>;
  /** Nur an einer Variante: die Variantengruppe. Gesetzt nur ueber `createVariantGroup`/`addVariant`, nie umgehaengt. */
  variantGroupId?: string;
  /**
   * Nur an einer Variante: je Merkmal der Gruppe genau ein Wert
   * (`{ farbe: 'rot', groesse: 'S' }`). Die Schluessel kommen nach Codepunkt
   * sortiert, nicht in der Merkmalsreihenfolge der Gruppe; die steht in
   * [VariantGroup.attributes].
   */
  variantAttributes?: Record<string, string>;
  createdAt: string | null;
  updatedAt: string | null;
  /**
   * Einkaufspreis je Basiseinheit in Mikro-Euro (Wiederbeschaffungs- vor
   * letztem vor Standard-Einkaufspreis); `null` = keiner hinterlegt. Fehlt
   * ganz ohne das Recht `costs`.
   */
  purchasePriceMicros?: number | null;
}

export interface ArticleListQuery {
  /**
   * Nur Artikel, die seitdem geaendert wurden (inklusive). Die Liste ist nach
   * `updatedAt` aufsteigend sortiert: wer sich das `updatedAt` des letzten
   * Treffers merkt und damit wieder fragt, verliert nichts.
   */
  updatedSince?: string | Date;
  groupId?: string;
  /**
   * Nur die Varianten dieser Gruppe (Backend ab Stufe 5c), wie ohne Filter
   * nach `updatedAt` aufsteigend; mit `updatedSince` der Abgleich
   * einer Gruppe. Die Artikel einer neuen Gruppe liest man so, die Antwort von
   * `createVariantGroup` traegt nur ihre Kennungen.
   */
  variantGroupId?: string;
  active?: boolean;
  stockTracked?: boolean;
  /** 1–200, Vorgabe des Servers 50. */
  limit?: number;
  /** `nextCursor` der vorigen Seite. */
  cursor?: string;
}

export interface ArticlePage {
  articles: Article[];
  /** `null` = letzte Seite. */
  nextCursor: string | null;
}

/** Ein Artikel per Code (`number`, `ean`, `internalCode`) oder per eigener Kennung. */
export type ArticleLookup = string | { code: string } | { externalSystem: string; externalId: string };

// ---- Standorte ------------------------------------------------------------------

export interface LocationAddress {
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
}

export interface Location {
  id: string;
  name: string;
  /** `null`: ein Typ, den diese Paketversion nicht kennt. */
  type: LocationType | null;
  address: LocationAddress | null;
  /** Kennzeichen, nur bei `vehicle`. */
  licensePlate: string | null;
  /** `false` = aufgeloest. */
  active: boolean;
  /** `true` = Hauptstandort, den der Server ohne eigenes Dokument ergaenzt. */
  virtual: boolean;
}

// ---- Bestand ------------------------------------------------------------------

/** Bestand eines Artikels an einem Standort, Mengen in Tausendstel. */
export interface StockLevel {
  articleId: string;
  locationId: string;
  /** Verkaufbare Menge am Standort. */
  onHand: number;
  /** Reserviert (Checkout im Shop). */
  reserved: number;
  /** `onHand - reserved`, vom Server gerechnet; darf negativ sein (die Kasse verkauft trotzdem). */
  available: number;
  defective: number;
  /**
   * Steigt bei jedem Schreiben dieses Bestands um 1. Einen gespeicherten Stand
   * nur ueberschreiben, wenn `sequence` groesser ist: so richten doppelte oder
   * verspaetete Ereignisse nichts an.
   */
  sequence: number;
  updatedAt: string | null;
}

/** Lagerwert eines Artikels, nur mit dem Recht `costs`. */
export interface StockValue {
  articleId: string;
  stockValueCents: number;
  /** Durchschnittlicher Einstandspreis je Basiseinheit in Mikro-Euro; `null` bei Menge 0. */
  averageCostMicros: number | null;
}

export interface StockResult {
  stock: StockLevel[];
  /** `null` ohne das Recht `costs` (der Server laesst das Feld weg), sonst die Werte. */
  values: StockValue[] | null;
}

export interface StockListQuery {
  locationId?: string;
  articleId?: string;
  /**
   * `true`: nur Zeilen, deren verfuegbarer Bestand (`available = onHand − reserved`)
   * unter dem Mindestbestand ihres Standorts liegt (dieselbe Regel wie
   * `stock.below_minimum`; `minStock` des Artikels zaehlt nicht).
   */
  belowMinimum?: boolean;
  /** Nur Zeilen, die sich seitdem geaendert haben (inklusive), nach `updatedAt` aufsteigend. */
  changedSince?: string | Date;
  limit?: number;
  cursor?: string;
}

export interface StockPage extends StockResult {
  nextCursor: string | null;
}

// ---- Bewegungen ------------------------------------------------------------------

export interface StockMovementLot {
  lotId: string | null;
  quantity: number;
  expiresOn: string | null;
  batch: string | null;
  serialNumber: string | null;
  receivedAt: string | null;
  /** Nur mit dem Recht `costs`. */
  valueCents?: number | null;
}

export interface StockMovementSourceRef {
  type: StockMovementSource | (string & {}) | null;
  /** Kennung des Belegs, der Rechnung o. Ae. */
  id: string | null;
  /** Kasse, an der verkauft wurde. */
  register: string | null;
  /** Position im Beleg bzw. in der Rechnung. */
  position: number | null;
}

/** Eine Zeile des Lagerprotokolls; neueste zuerst. */
export interface StockMovement {
  id: string;
  type: StockMovementType | (string & {}) | null;
  articleId: string | null;
  locationId: string | null;
  condition: StockCondition | (string & {}) | null;
  /** Mengenaenderung in Tausendstel (Abgang negativ); bei `reservation` immer 0. */
  quantityDelta: number;
  /**
   * Aenderung von `reserved` in Tausendstel: positiv beim Reservieren, negativ
   * bei Freigabe, Ablauf und Einloesen; 0 bei allen anderen Bewegungen. Seit 1.5.0.
   */
  reservedDelta: number;
  /**
   * Bestand am Standort nach der Bewegung. `reserved` steht nur an
   * Reservierungsbewegungen, sonst `null` (nicht erfasst, nicht „0“).
   */
  stockAfter: { sellable: number; defective: number; reserved: number | null } | null;
  operationId: string | null;
  source: StockMovementSourceRef | null;
  /** Wiener Tag `YYYY-MM-DD`. */
  viennaDay: string | null;
  time: string | null;
  lots: StockMovementLot[];
  /** Nur mit dem Recht `costs`. */
  valueDeltaCents?: number | null;
  /** Nur mit dem Recht `costs`. */
  consumedValueCents?: number | null;
}

export interface StockMovementQuery {
  /** Nur nach `articleId` **oder** `locationId` filtern, nicht beides. */
  articleId?: string;
  locationId?: string;
  from?: string | Date;
  to?: string | Date;
  type?: StockMovementType;
  source?: StockMovementSource;
  limit?: number;
  cursor?: string;
}

export interface StockMovementPage {
  movements: StockMovement[];
  nextCursor: string | null;
}

// ---- Webhooks ------------------------------------------------------------------

export interface InventoryWebhook {
  id: string;
  url: string;
  events: (InventoryWebhookEventType | (string & {}))[];
  active: boolean;
  description: string | null;
  createdAt: string | null;
  /** Die letzte Zustellung; `null`, solange keine versucht wurde. */
  lastDelivery: {
    at: string | null;
    status: WebhookDeliveryStatus | (string & {}) | null;
    statusCode: number | null;
  } | null;
  /** Fehlversuche in Folge (wie bei Partner-Webhooks); steigt der Wert, stimmt beim Empfaenger etwas nicht. */
  consecutiveFailures: number;
}

export interface CreateInventoryWebhookOptions {
  /** Vollstaendige `https://`-Adresse, hoechstens 500 Zeichen. */
  url: string;
  /** Mindestens eines. */
  events: (InventoryWebhookEventType | (string & {}))[];
  /** Hoechstens 120 Zeichen. */
  description?: string;
}

export interface InventoryWebhookPatch {
  url?: string;
  events?: (InventoryWebhookEventType | (string & {}))[];
  active?: boolean;
  /** `null` loescht die Beschreibung. */
  description?: string | null;
}

export interface InventoryWebhookWithSecret {
  webhook: InventoryWebhook;
  /**
   * Das Secret fuer [verifyInventoryWebhookSignature]. **Es kommt genau einmal**, bei
   * `createWebhook` bzw. `rotateWebhookSecret`; danach gibt der Server es nie
   * wieder aus. Nach einem Wechsel gilt sofort nur das neue.
   */
  secret: string;
}

export interface InventoryWebhookList {
  webhooks: InventoryWebhook[];
  /** Die Ereignisse, die dieses Konto abonnieren kann. */
  events: string[];
}

export interface InventoryWebhookTestDelivery {
  /** Kennung der Zustellung (Kopfzeile `X-Kasseneck-Delivery`), wie bei Partner-Webhooks. */
  deliveryId: string;
  webhookId: string;
  status: WebhookDeliveryStatus | (string & {}) | null;
  statusCode: number | null;
}

export interface InventoryWebhookTestResult {
  eventId: string;
  event: string;
  deliveries: InventoryWebhookTestDelivery[];
}

export interface InventoryWebhookDelivery {
  /** Kennung der Zustellung (Kopfzeile `X-Kasseneck-Delivery`), wie bei Partner-Webhooks. */
  deliveryId: string;
  webhookId: string | null;
  event: string | null;
  eventId: string | null;
  /** `dropped`: der Webhook wurde vor der Faelligkeit deaktiviert oder geloescht. */
  status: WebhookDeliveryStatus | (string & {}) | null;
  attempts: number;
  statusCode: number | null;
  /** Auszug der Antwort des Empfaengers, hoechstens 500 Zeichen. */
  response: string | null;
  error: string | null;
  createdAt: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  test: boolean;
}

// ---- Ereignisse ------------------------------------------------------------------

/** Nutzlast von `stock.changed`: der aktuelle Stand, nicht die Aenderung. */
export interface StockChangedEventData extends StockLevel {
  cause: StockChangeCause | (string & {});
  /** Die Bewegung, aus der `cause` stammt; `null` bei `other` ohne Bewegung. */
  movementId: string | null;
}

/** Nutzlast von `stock.below_minimum`: nur beim Unterschreiten, nicht bei jedem weiteren Sinken. */
export interface StockBelowMinimumEventData {
  articleId: string;
  locationId: string;
  /** Verfuegbarer Bestand (`onHand − reserved`); eine Reservierung allein kann ausloesen. */
  available: number;
  /**
   * Der Mindestbestand des Standorts in Tausendstel (`minStockByLocation`) –
   * die unterschrittene Schwelle, gemessen an `available`. Der `minStock` des
   * Artikels allein loest nie aus.
   */
  minStock: number;
}

export interface InventoryWebhookEnvelope<T extends InventoryWebhookEventType, D> {
  /** `evt_…`: darauf entdoppeln. */
  id: string;
  type: T;
  /** Millisekunden seit 1970 (UTC). */
  createdAt: number;
  /** Das Konto, dessen Lager das Ereignis betrifft. */
  accountId: string;
  /**
   * `true` nur bei einer Probe aus `sendWebhookTest` (erfundene Nutzlast).
   * An den Anfang jedes Handlers: `if (event.test) return;`
   */
  test: boolean;
  data: D;
}

export type InventoryWebhookEvent =
  | InventoryWebhookEnvelope<'stock.changed', StockChangedEventData>
  | InventoryWebhookEnvelope<'stock.below_minimum', StockBelowMinimumEventData>
  | InventoryWebhookEnvelope<'article.created', Article>
  | InventoryWebhookEnvelope<'article.updated', Article>
  | InventoryWebhookEnvelope<'article.deactivated', Article>
  | InventoryWebhookEnvelope<'reservation.expired', Reservation>
  | InventoryWebhookEnvelope<'reservation.released', Reservation>
  | InventoryWebhookEnvelope<'reservation.redeemed', Reservation>
  | InventoryWebhookEnvelope<'variant_group.created', VariantGroup>
  | InventoryWebhookEnvelope<'variant_group.updated', VariantGroup>;

// ---- Schreiben (Backend Stufe 5b, seit 1.5.0) ---------------------------------
//
// Jede schreibende Anfrage traegt `idempotencyKey` (1–120 Zeichen, Pflicht):
// dieselbe Anfrage mit demselben Schluessel wirkt genau einmal, eine
// Wiederholung liefert die gespeicherte Antwort von damals. Derselbe Schluessel
// mit anderem Inhalt ergibt `idempotency_conflict`. Nach einem Zeitlimit also
// mit **demselben** Schluessel wiederholen, nie mit einem neuen.
//
// Schreiben braucht den Konto-Schalter „Lager-API schreiben“ (sonst
// `inventory_api_not_enabled`); in der Test-Umgebung (`kr_test_…`) ist er immer an.

/**
 * Die Felder eines Artikels beim Anlegen. Bei der Anlage heisst `null` „nicht
 * angegeben“ (ausser bei `name`, der Pflicht ist).
 */
export interface ArticleInput {
  /** 1–200 Zeichen, getrimmt gespeichert. */
  name: string;
  /** Bis 2000 Zeichen. */
  description?: string | null;
  unitPriceCents?: number | null;
  /** USt-Satz in Prozent (`20`, `13`, `10`, `4.9`, `0`, `19`). */
  vatRate?: number | null;
  /** 1–20 Zeichen; ohne Angabe die Vorgabe des Kontos. */
  unit?: string | null;
  /** Artikelnummer, 1–64 Zeichen. */
  number?: string | null;
  /**
   * GTIN/EAN mit gueltiger Pruefziffer: der Artikel wird ein Fremdartikel mit
   * diesem Code. Ohne `ean` vergibt der Server einen eigenen Code nach den
   * Einstellungen des Kontos (`internalCode`). Ein Code, der schon einem
   * anderen Artikel gehoert, ergibt `code_taken`.
   */
  ean?: string | null;
  /** Artikelgruppe; unbekannt = `group_not_found`. */
  groupId?: string | null;
  /** Erloesgruppe; unbekannt = `revenue_group_not_found`. */
  revenueGroupId?: string | null;
  stockTracked?: boolean | null;
  /** Hoechstens 50 Standorte; unbekannt = `location_not_found`. */
  stockLocationIds?: string[] | null;
  /** **Altfeld** ohne Wirkung auf Meldungen; Tausendstel in ganzen Einheiten (Vielfaches von 1000). */
  minStock?: number | null;
  /** Mindestbestand je Standort in Tausendstel, hoechstens 50 Standorte. */
  minStockByLocation?: Record<string, number | null> | null;
  stockKind?: StockKind | null;
  /**
   * Standard-Einkaufspreis je Basiseinheit in Mikro-Euro. Nur mit dem
   * Konto-Recht `costs`, sonst `inventory_api_not_enabled` mit
   * `errors: [{ field: 'purchasePriceMicros' }]`.
   */
  purchasePriceMicros?: number | null;
  /**
   * Eigene Kennungen je System (`{ shop: '1001' }`): hoechstens 10 Systeme
   * `^[a-z0-9_]{1,32}$`, Werte 1–128 Zeichen, je System und Wert eindeutig im
   * Konto (`external_id_taken`). Damit findet `lookupArticleByCode` den Artikel.
   */
  externalIds?: Record<string, string> | null;
  /** Freie Merkmale, nie ausgewertet: hoechstens 20 Schluessel `^[a-zA-Z0-9_]{1,40}$`, Werte bis 500 Zeichen, zusammen 4 KB. */
  metadata?: Record<string, string> | null;
}

export interface CreateArticleRequest extends ArticleInput {
  idempotencyKey: string;
}

/**
 * Eine Aenderung: nur die genannten Felder, mindestens eines. `null` leert ein
 * optionales Feld (`description`, `unitPriceCents`, `vatRate`, `number`,
 * `groupId`, `revenueGroupId`, `minStock`, `stockLocationIds`, `externalIds`,
 * `metadata`, `minStockByLocation`, `purchasePriceMicros`). `name`, `unit`,
 * `ean`, `stockTracked` und `stockKind` lassen sich nicht leeren.
 *
 * `externalIds` und `metadata` werden ganz ersetzt, `minStockByLocation` je
 * Standort zusammengefuehrt (`{ haupt: null }` nimmt nur diesen Standort weg).
 * Die EAN laesst sich nur bei Fremdartikeln wechseln; `stockKind` nach der
 * ersten Bewegung nicht mehr (`stock_kind_locked`). Ein stillgelegter Artikel
 * ergibt `article_inactive`.
 */
export interface UpdateArticleRequest {
  idempotencyKey: string;
  articleId: string;
  name?: string;
  description?: string | null;
  unitPriceCents?: number | null;
  vatRate?: number | null;
  unit?: string;
  number?: string | null;
  ean?: string;
  groupId?: string | null;
  revenueGroupId?: string | null;
  stockTracked?: boolean;
  stockLocationIds?: string[] | null;
  minStock?: number | null;
  minStockByLocation?: Record<string, number | null> | null;
  stockKind?: StockKind;
  purchasePriceMicros?: number | null;
  externalIds?: Record<string, string> | null;
  metadata?: Record<string, string> | null;
}

/**
 * Stilllegen: `active: false`; Code und eigene Kennungen werden frei. Schon
 * stillgelegt = dieselbe Antwort, nichts geschrieben. Den Bestand behaelt der
 * Artikel, gebucht werden darf weiter.
 */
export interface DeactivateArticleRequest {
  idempotencyKey: string;
  articleId: string;
}

// ---- Buchen ------------------------------------------------------------------

/** Ein Hinweis einer Buchung: sie hat gewirkt, es gibt nur etwas zu wissen. */
export interface InventoryWarning {
  code: InventoryWarningCode | (string & {});
  articleId: string | null;
  locationId: string | null;
  /** Fuer Menschen, deutsch; nie darauf verzweigen. */
  message: string;
}

/**
 * Antwort jeder Buchung (`receiveGoods`, `transferStock`, `recordStockLoss`,
 * `changeStockCondition`, `reverseStockMovement`). Werte traegt sie nie. Eine
 * Wiederholung mit demselben `idempotencyKey` liefert genau diese Antwort
 * noch einmal (ohne Kennzeichen, die beiden sind gleich).
 */
export interface StockOperation {
  /** Kennung des Vorgangs; `reverseStockMovement` nimmt ihn zurueck. */
  operationId: string;
  movementIds: string[];
  lotIds: string[];
  warnings: InventoryWarning[];
}

/** Eine Position eines Wareneingangs. */
export interface GoodsReceiptItem {
  articleId: string;
  /** Tausendstel, groesser als 0. */
  quantity: number;
  /** Gesamtpreis der Position in Cent. Entweder dieser oder `unitPriceMicros`; ohne beide der Einkaufspreis des Artikels. */
  totalCents?: number;
  /** Einzelpreis je Basiseinheit in Mikro-Euro. */
  unitPriceMicros?: number;
  /** Nebenkosten dieser Position in Cent; gilt nur bei `allocation: 'manual'`. */
  landedCostCents?: number;
  /** Ablaufdatum `YYYY-MM-DD`. */
  expiresOn?: string;
  /** Charge, 1–64 Zeichen. */
  batch?: string;
  /** Seriennummern (Einzelstuecke), hoechstens 80, je 1–128 Zeichen. */
  serialNumbers?: string[];
}

export interface LandedCost {
  type: LandedCostType;
  /** Betrag in Cent; `discount` und `cash_discount` mindern den Wert. */
  amountCents: number;
}

/**
 * Wareneingang. Preise und Nebenkosten darf jeder Schreibende senden (so
 * bekommt der Bestand seinen Wert); zurueck kommen Werte nur mit dem Recht
 * `costs` und nur in der Vorschau ([previewGoodsReceipt]).
 */
export interface ReceiveGoodsRequest {
  idempotencyKey: string;
  /** Hoechstens 80 Positionen (`too_many_positions`). */
  items: GoodsReceiptItem[];
  /** Ohne Angabe der Standard-Standort des Kontos. */
  locationId?: string;
  /** Hoechstens 20. */
  landedCosts?: LandedCost[];
  allocation?: LandedCostAllocation;
  supplier?: { name: string; address?: string };
  /** Lieferschein o. Ae., 1–80 Zeichen. */
  reference?: string;
  /** 1–500 Zeichen. */
  note?: string;
}

/**
 * Vorschau eines Wareneingangs (`dryRun: true`): schreibt nichts, der
 * Schluessel ist freigestellt (wenn da, wird nur seine Form geprueft), das
 * Schreibrecht braucht sie trotzdem. Den Standort prueft erst die Buchung.
 */
export type GoodsReceiptPreviewRequest = Omit<ReceiveGoodsRequest, 'idempotencyKey'> & { idempotencyKey?: string };

/**
 * Eine Zeile der Vorschau. Die vier Werte (`baseCents`, `landedCostCents`,
 * `valueCents`, `unitCostMicros`) kommen nur mit dem Recht `costs` und fehlen
 * sonst ganz.
 */
export interface GoodsReceiptPreviewLine {
  articleId: string;
  quantity: number;
  expiresOn: string | null;
  batch: string | null;
  serialNumbers: string[];
  /** `true`: der Preis kam aus dem Artikel, nicht aus der Anfrage. */
  priceFromArticle: boolean;
  baseCents?: number | null;
  landedCostCents?: number | null;
  valueCents?: number | null;
  unitCostMicros?: number | null;
}

export interface GoodsReceiptPreview {
  preview: GoodsReceiptPreviewLine[];
}

/** Eine Position von Umbuchung, Abgang oder Zustandswechsel. */
export interface StockItem {
  articleId: string;
  /** Tausendstel, groesser als 0. */
  quantity: number;
  /** Bei Einzelstuecken das Stueck. */
  serialNumber?: string;
}

/** Umbuchung zwischen zwei Standorten. Ueberzieht nie (`exceeds_stock`). */
export interface TransferStockRequest {
  idempotencyKey: string;
  fromLocationId: string;
  toLocationId: string;
  items: StockItem[];
  note?: string;
}

/**
 * Abgang (Bruch, Schwund, Entnahme …). Ueberzieht nie (`exceeds_stock`).
 * `reason: 'other'` braucht `note` (`note_required`), `reason: 'withdrawal'`
 * braucht `withdrawalType` (`withdrawal_type_required`).
 */
export interface RecordStockLossRequest {
  idempotencyKey: string;
  reason: StockLossReason;
  withdrawalType?: WithdrawalType;
  /** Aus welchem Zustand; Vorgabe `sellable`. */
  condition?: StockCondition;
  locationId?: string;
  items: StockItem[];
  note?: string;
}

/** Ware zwischen verkaufbar und defekt umbuchen. Ueberzieht nie (`exceeds_stock`). */
export interface ChangeStockConditionRequest {
  idempotencyKey: string;
  from: StockCondition;
  to: StockCondition;
  locationId?: string;
  items: StockItem[];
  note?: string;
}

/**
 * Gegenbuchung: nimmt einen ganzen Vorgang zurueck. Verkaeufe und
 * Reservierungen gehen so nicht (`reversal_not_supported`), ein zweites Mal
 * auch nicht (`already_reversed`).
 */
export interface ReverseStockMovementRequest {
  idempotencyKey: string;
  operationId: string;
  /** Pflicht, bis 500 Zeichen; leer = `reason_required`. */
  reason: string;
}

// ---- Reservierung ---------------------------------------------------------------

/**
 * Eine Position einer Reservierung, Mengen in Tausendstel. Offen ist
 * `quantity − redeemed − released`.
 */
export interface ReservationItem {
  articleId: string;
  locationId: string;
  quantity: number;
  redeemed: number;
  released: number;
}

/**
 * Eine Reservierung, wie `getReservation`, jede schreibende Reservierungs-
 * Antwort und die Ereignisse `reservation.*` sie senden.
 */
export interface Reservation {
  id: string;
  /** `null`: ein Stand, den diese Paketversion nicht kennt, oder keiner. */
  status: ReservationStatus | (string & {}) | null;
  /** Eigene Referenz (Bestellnummer), `null` = keine. */
  reference: string | null;
  items: ReservationItem[];
  /** Ablauf, ISO 8601 UTC. */
  expiresAt: string | null;
  createdAt: string | null;
}

export interface ReservationItemInput {
  articleId: string;
  /** Tausendstel, groesser als 0. */
  quantity: number;
  /** Ohne Angabe der Standard-Standort des Kontos. */
  locationId?: string;
}

/**
 * Reservieren (Checkout): ganz oder gar nicht. Fehlt verfuegbarer Bestand an
 * einer Position, entsteht nichts und der Fehler `insufficient_available`
 * nennt die fehlenden Positionen ([inventoryShortfalls]). Nur
 * bestandsgefuehrte Artikel. Gleiche Artikel am gleichen Standort werden
 * zusammengezaehlt.
 */
export interface CreateReservationRequest {
  idempotencyKey: string;
  /** 1–50 Positionen. */
  items: ReservationItemInput[];
  /** 1–128 Zeichen; `listReservations({ reference })` findet sie damit. */
  reference?: string | null;
  /** 5 … 43 200 Minuten; ohne Angabe die Vorgabe des Kontos (7 Tage). */
  expiresInMinutes?: number | null;
}

/** Verlaengern: neuer Ablauf = jetzt + Minuten. Nur eine aktive, noch nicht faellige Reservierung (`reservation_not_active`). */
export interface ExtendReservationRequest {
  idempotencyKey: string;
  reservationId: string;
  /** 5 … 43 200 Minuten. */
  expiresInMinutes: number;
}

export interface ReleaseReservationItem {
  articleId: string;
  locationId?: string;
  /** Ohne Angabe der ganze offene Rest der Position. */
  quantity?: number;
}

/** Freigeben: ohne `items` alles, sonst je Position (ganz oder teilweise). */
export interface ReleaseReservationRequest {
  idempotencyKey: string;
  reservationId: string;
  /** Nicht leer; ganz weglassen, um alles freizugeben. */
  items?: ReleaseReservationItem[];
}

export interface ReservationListQuery {
  status?: ReservationStatus;
  /** Genau diese Referenz. */
  reference?: string;
  /** 1–200, Vorgabe des Servers 50. */
  limit?: number;
  cursor?: string;
}

/** Neueste zuerst (`createdAt` absteigend). */
export interface ReservationPage {
  reservations: Reservation[];
  nextCursor: string | null;
}

/** Eine Position, fuer die beim Reservieren der verfuegbare Bestand nicht reicht (`insufficient_available`). */
export interface InventoryShortfall {
  articleId: string;
  locationId: string;
  /** Angefragt, Tausendstel. */
  requested: number;
  /** Verfuegbar (`onHand − reserved`), Tausendstel; darf negativ sein. */
  available: number;
}

// ---- Varianten (Backend Stufe 5c, seit 1.6.0) -----------------------------------
//
// Eine Variante ist ein gewoehnlicher Artikel mit `variantGroupId` und
// `variantAttributes`: eigene Kennung, eigener Code, eigener Bestand, eigene
// Kachel an der Kasse. Die Gruppe haelt nur, was alle teilen (Name, Merkmale
// mit ihren Werten, Vorgaben fuer neue Varianten) und die Liste ihrer aktiven
// Varianten. Jede Kombination gibt es je Gruppe hoechstens einmal.

/** Ein Merkmal einer Variantengruppe mit seinen Werten, in der Reihenfolge der Gruppe. */
export interface VariantAttribute {
  /** `^[a-z0-9_]{1,32}$`, eindeutig in der Gruppe; Schluessel in `variantAttributes`. */
  key: string;
  /** Beschriftung, 1–40 Zeichen, z. B. „Größe“. */
  label: string;
  /**
   * 1–30 Werte zu je 1–30 Zeichen, eindeutig ohne Gross/Klein, getrimmt und in
   * Unicode-NFC gespeichert. Werte kommen nur dazu (`addAttributeValues`), nie weg.
   */
  values: string[];
}

/**
 * Vorgaben einer Gruppe: sie fuellen bei der **Anlage** einer Variante die
 * Felder, die die Variante nicht selbst nennt. Ein spaeteres Aendern der
 * Vorgaben aendert keine bestehende Variante (dafuer `updateArticle`).
 * Ein Feld ohne Vorgabe fehlt.
 */
export interface VariantGroupDefaults {
  unitPriceCents?: number;
  vatRate?: number;
  unit?: string;
  groupId?: string;
  /** Ohne Vorgabe gilt wie bei `createArticle` `false` (dann nicht reservierbar). */
  stockTracked?: boolean;
}

/** Eine Variante in der Liste ihrer Gruppe. */
export interface VariantGroupMember {
  articleId: string;
  /** Je Merkmal ein Wert, Schluessel nach Codepunkt sortiert. */
  variantAttributes: Record<string, string>;
}

/**
 * Eine Variantengruppe, wie `getVariantGroup`, `listVariantGroups`, die
 * schreibenden Gruppenaufrufe und die Ereignisse `variant_group.*` sie senden.
 */
export interface VariantGroup {
  id: string;
  /** 1–100 Zeichen; Standardname einer Variante: „<Gruppe> <Wert1> <Wert2>“. */
  name: string | null;
  /** 1–3 Merkmale in der Reihenfolge der Gruppe (sie bestimmt den Standardnamen). */
  attributes: VariantAttribute[];
  defaults: VariantGroupDefaults;
  /** `false` = stillgelegt: alle Varianten stillgelegt, kein `addVariant`, endgueltig. */
  active: boolean;
  /**
   * Die aktiven Varianten einer aktiven Gruppe; eine einzeln stillgelegte
   * Variante faellt heraus (ihre Kombination ist dann wieder frei). Beim
   * Stilllegen der Gruppe wird die Liste eingefroren. Die Artikel selbst
   * liest `listArticles({ variantGroupId })`.
   */
  variants: VariantGroupMember[];
  createdAt: string | null;
  updatedAt: string | null;
}

/** Vorgaben in einer Anfrage. Bei der Anlage heisst `null` „nicht angegeben“, bei einer Aenderung „leeren“. */
export interface VariantGroupDefaultsInput {
  unitPriceCents?: number | null;
  vatRate?: number | null;
  unit?: string | null;
  /** Artikelgruppe; unbekannt = `group_not_found` (bei einer Variante mit `field: 'defaults.groupId'`). */
  groupId?: string | null;
  stockTracked?: boolean | null;
}

/**
 * Eine neue Variante: ihre Merkmalswerte und die Felder eines Artikels wie bei
 * `createArticle`. Was fehlt (oder `null` ist), fuellen die Vorgaben der
 * Gruppe; ohne `name` heisst sie „<Gruppe> <Wert1> <Wert2>“ in
 * Merkmalsreihenfolge. Mit `ean` wird sie ein Fremdartikel, sonst vergibt der
 * Server den naechsten eigenen Code.
 */
export interface VariantInput extends Omit<ArticleInput, 'name'> {
  /**
   * Jedes Merkmal der Gruppe genau einmal, Wert exakt aus der Werteliste
   * (Gross/Klein und Leerraum werden nicht angeglichen), sonst
   * `invalid_variant_attributes` mit `field`.
   */
  variantAttributes: Record<string, string>;
  /** 1–200 Zeichen; ohne Angabe der Standardname. */
  name?: string | null;
}

/**
 * Legt eine Variantengruppe an, mit `createMatrix: true` samt allen
 * Kombinationen (hoechstens 100) oder mit den genannten `variants[]`
 * (hoechstens 100), nie beides. Ohne beides entsteht die Gruppe ohne Variante.
 * Die Antwort traegt die Gruppe mit `variants[]` (Kennungen und Merkmale),
 * nicht die Artikel.
 */
export interface CreateVariantGroupRequest {
  idempotencyKey: string;
  /** 1–100 Zeichen. */
  name: string;
  /** 1–3 Merkmale; ihre Reihenfolge bestimmt Standardnamen und Matrix (das erste laeuft aussen). */
  attributes: VariantAttribute[];
  defaults?: VariantGroupDefaultsInput | null;
  /** `true`: alle Kombinationen der Werte als Varianten. Schliesst `variants` aus. */
  createMatrix?: boolean;
  variants?: VariantInput[];
}

/**
 * Aendert eine aktive Gruppe: nur die genannten Felder, mindestens eines.
 * `defaults` ist ein Teil-Update (`null` je Feld leert es, `defaults: null`
 * alle). `addAttributeValues` haengt Werte an bestehende Merkmale an und
 * uebergeht still, was es schon gibt (auch in anderer Gross-/Kleinschreibung):
 * der Shop darf immer alle seine Werte senden. Werte entfernen und Merkmale
 * ergaenzen gibt es nicht.
 *
 * `active: false` legt die Gruppe und alle ihre Varianten still, steht allein
 * und ist endgueltig (`true` gibt es nicht). Eine stillgelegte Gruppe ergibt
 * bei jeder anderen Aenderung `variant_group_inactive`.
 */
export interface UpdateVariantGroupRequest {
  idempotencyKey: string;
  variantGroupId: string;
  name?: string;
  defaults?: VariantGroupDefaultsInput | null;
  /** `{ groesse: ['XL'] }`: hoechstens 30 Werte je Merkmal danach. */
  addAttributeValues?: Record<string, string[]>;
  active?: false;
}

/** Legt eine Variante in einer aktiven Gruppe an. Antwort: der Artikel wie `createArticle`. */
export interface AddVariantRequest extends VariantInput {
  idempotencyKey: string;
  variantGroupId: string;
}

export interface VariantGroupListQuery {
  active?: boolean;
  /**
   * Nur Gruppen, die seitdem geaendert wurden (inklusive). Die Liste ist nach
   * `updatedAt` aufsteigend sortiert, gleiche Zeit nach Kennung.
   */
  updatedSince?: string | Date;
  /** 1–200, Vorgabe des Servers 50. */
  limit?: number;
  cursor?: string;
}

export interface VariantGroupPage {
  variantGroups: VariantGroup[];
  /** `null` = letzte Seite. */
  nextCursor: string | null;
}
