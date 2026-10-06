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
  InventoryWebhookEventType,
  LocationType,
  StockChangeCause,
  StockCondition,
  StockMovementSource,
  StockMovementType,
  WebhookDeliveryStatus,
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
 * sie traegt.
 */
export interface Article {
  id: string;
  name: string | null;
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
  /** Standorte, an denen der Artikel gefuehrt wird; leer = nur der Standard-Standort. */
  stockLocationIds: string[];
  /** Mindestbestand in Tausendstel; `null` = keiner. */
  minStock: number | null;
  active: boolean;
  externalIds?: Record<string, string>;
  metadata?: Record<string, string>;
  variantGroupId?: string;
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
  /** Mengenaenderung in Tausendstel (Abgang negativ). */
  quantityDelta: number;
  /** Bestand am Standort nach der Bewegung. */
  stockAfter: { sellable: number; defective: number } | null;
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
  /** Fehlversuche in Folge; steigt der Wert, stimmt beim Empfaenger etwas nicht. */
  failuresInRow: number;
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
  id: string;
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
  id: string;
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
  available: number;
  /** Die verwendete Schwelle (je Standort, sonst die des Artikels), in Tausendstel. */
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
  | InventoryWebhookEnvelope<'article.deactivated', Article>;
