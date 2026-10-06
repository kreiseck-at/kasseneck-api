/**
 * Die Aufrufe der Lager-API: Artikel, Standorte, Bestand und Bewegungen
 * lesen, Konto-Webhooks verwalten (Backend Stufe 5a). Die schreibenden
 * Aufrufe (Stufe 5b) stehen in `schreiben.ts` und teilen die Helfer hier.
 *
 * Jede Funktion nimmt den Transport als ersten Parameter und ist einzeln
 * importierbar; die Fassade [createInventoryClient] bindet ihn nur einmal.
 *
 * **Geprueft wird hier nur, was ohne Netz sicher falsch ist** (leere Kennung,
 * `limit` ausserhalb 1–200, eine Aenderung ohne Feld). Alles Fachliche prueft
 * der Server und meldet es als `validation` mit `errors[]`; zwei Pruefungen
 * hiessen zwei Wahrheiten.
 *
 * Lesen hat keine Wirkung: nach einem Zeitlimit darf derselbe Aufruf
 * wiederholt werden. Bei `rate_limited` vorher `retryAfterSec` warten
 * ([inventoryRetryAfterSec]).
 */

import type { ApiCall, InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import {
  antwortfehler,
  artikel,
  bestand,
  bewegung,
  liste,
  naechsterCursor,
  objekt,
  probeZustellung,
  standort,
  webhook,
  wert,
  zustellung,
} from './lesen.js';
import { INVENTORY_LIST_LIMIT_MAX } from './vertrag.js';
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

type Params = Record<string, unknown>;

export function anfragefehler(name: ApiCall, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, grund, 'request');
}

/** Eine Kennung, die gesendet werden muss: Text mit mindestens einem Zeichen ausser Leerraum. */
export function kennung(name: ApiCall, feld: string, wert: unknown): string {
  if (typeof wert !== 'string' || wert.trim() === '') throw anfragefehler(name, `${feld} fehlt`);
  return wert;
}

/** Felder, die einen Zeitpunkt tragen: ein `Date` geht als ISO 8601 UTC hinaus. */
const ZEITFELDER: ReadonlySet<string> = new Set(['updatedSince', 'changedSince', 'from', 'to']);

/**
 * Die Abfrage einer Liste als Parameter. Unbekannte Felder gehen unveraendert
 * hinaus (der Server weist sie mit `validation` ab), `undefined` faellt weg.
 */
export function abfrage(name: ApiCall, query: object | undefined): Params {
  if (query === undefined || query === null) return {};
  if (typeof query !== 'object' || Array.isArray(query)) throw anfragefehler(name, 'Abfrage muss ein Objekt sein');
  const raus: Params = {};
  for (const [feld, w] of Object.entries(query as Params)) {
    if (w === undefined) continue;
    if (ZEITFELDER.has(feld) && w instanceof Date) {
      if (Number.isNaN(w.getTime())) throw anfragefehler(name, `${feld} ist kein gueltiger Zeitpunkt`);
      raus[feld] = w.toISOString();
      continue;
    }
    raus[feld] = w;
  }
  if (raus.limit !== undefined) {
    const limit = raus.limit;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > INVENTORY_LIST_LIMIT_MAX) {
      throw anfragefehler(name, `limit muss eine ganze Zahl von 1 bis ${INVENTORY_LIST_LIMIT_MAX} sein`);
    }
  }
  if (raus.cursor !== undefined) kennung(name, 'cursor', raus.cursor);
  return raus;
}

/**
 * Blaettert ueber alle Seiten, Eintrag fuer Eintrag. Derselbe Cursor zweimal
 * waere eine Endlosschleife: dann endet die Schleife mit einem Antwortfehler.
 */
export async function* seitenweise<T>(
  name: ApiCall,
  start: string | undefined,
  seite: (cursor: string | undefined) => Promise<{ eintraege: T[]; nextCursor: string | null }>,
): AsyncGenerator<T, void, undefined> {
  const gesehen = new Set<string>();
  // Auch der Startcursor zaehlt: nennt die erste Antwort ihn wieder, waere es dieselbe Seite.
  if (start) gesehen.add(start);
  let cursor = start;
  for (;;) {
    const { eintraege, nextCursor } = await seite(cursor);
    yield* eintraege;
    if (nextCursor === null) return;
    if (gesehen.has(nextCursor)) throw antwortfehler(name, 'Antwort nennt denselben nextCursor zweimal');
    gesehen.add(nextCursor);
    cursor = nextCursor;
  }
}

// ---- Artikel ------------------------------------------------------------------

export async function getArticle(transport: InternerTransport, articleId: string): Promise<Article> {
  const name = 'getArticle';
  const daten = await transport(name, { articleId: kennung(name, 'articleId', articleId) });
  return artikel({ name, pfad: 'article' }, objekt(daten)?.article);
}

export async function listArticles(transport: InternerTransport, query?: ArticleListQuery): Promise<ArticlePage> {
  const name = 'listArticles';
  const daten = await transport(name, abfrage(name, query));
  return { articles: liste(name, daten, 'articles', artikel), nextCursor: naechsterCursor(name, daten) };
}

/** Alle Artikel der Abfrage, Seite fuer Seite ueber `nextCursor`. */
export function iterateArticles(transport: InternerTransport, query?: ArticleListQuery): AsyncGenerator<Article, void, undefined> {
  const { cursor, ...rest } = query ?? {};
  return seitenweise('listArticles', cursor, async (c) => {
    const s = await listArticles(transport, { ...rest, cursor: c });
    return { eintraege: s.articles, nextCursor: s.nextCursor };
  });
}

/**
 * Ein aktiver Artikel per Code (`number`, `ean` oder `internalCode`) oder per
 * eigener Kennung aus `externalIds` (`{ externalSystem: 'shop', externalId: '4711' }`).
 * Ein stillgelegter Artikel gilt als nicht gefunden (`article_not_found`).
 */
export async function lookupArticleByCode(transport: InternerTransport, lookup: ArticleLookup): Promise<Article> {
  const name = 'lookupArticleByCode';
  let params: Params;
  if (typeof lookup === 'string') {
    params = { code: kennung(name, 'code', lookup) };
  } else if (lookup !== null && typeof lookup === 'object' && !Array.isArray(lookup)) {
    const l = lookup as Params;
    const extern = l.externalSystem !== undefined || l.externalId !== undefined;
    if (l.code !== undefined && extern) throw anfragefehler(name, 'entweder code oder externalSystem mit externalId');
    params = extern
      ? { externalSystem: kennung(name, 'externalSystem', l.externalSystem), externalId: kennung(name, 'externalId', l.externalId) }
      : { code: kennung(name, 'code', l.code) };
  } else {
    throw anfragefehler(name, 'Code als Text oder { code } bzw. { externalSystem, externalId } erwartet');
  }
  const daten = await transport(name, params);
  return artikel({ name, pfad: 'article' }, objekt(daten)?.article);
}

// ---- Standorte und Bestand -----------------------------------------------------------

/** Alle Standorte des Kontos, samt aufgeloesten (`active: false`) und dem Hauptstandort. */
export async function listLocations(transport: InternerTransport): Promise<Location[]> {
  const name = 'listLocations';
  return liste(name, await transport(name, {}), 'locations', standort);
}

/** Die Werte (`values`): fehlt das Feld, fehlt das Recht `costs` -> `null`, nie `[]`. */
function werte(name: ApiCall, daten: unknown): StockResult['values'] {
  const roh = objekt(daten)?.values;
  if (roh === undefined || roh === null) return null;
  return liste(name, daten, 'values', wert);
}

/** Bestand eines Artikels je Standort. */
export async function getStock(transport: InternerTransport, articleId: string): Promise<StockResult> {
  const name = 'getStock';
  const daten = await transport(name, { articleId: kennung(name, 'articleId', articleId) });
  return { stock: liste(name, daten, 'stock', bestand), values: werte(name, daten) };
}

export async function listStock(transport: InternerTransport, query?: StockListQuery): Promise<StockPage> {
  const name = 'listStock';
  const daten = await transport(name, abfrage(name, query));
  return { stock: liste(name, daten, 'stock', bestand), values: werte(name, daten), nextCursor: naechsterCursor(name, daten) };
}

/**
 * Alle Bestandszeilen der Abfrage, Seite fuer Seite. Die Werte (`values`)
 * stehen je Seite in [listStock]; der Iterator liefert nur die Zeilen.
 */
export function iterateStock(transport: InternerTransport, query?: StockListQuery): AsyncGenerator<StockLevel, void, undefined> {
  const { cursor, ...rest } = query ?? {};
  return seitenweise('listStock', cursor, async (c) => {
    const s = await listStock(transport, { ...rest, cursor: c });
    return { eintraege: s.stock, nextCursor: s.nextCursor };
  });
}

/** Das Lagerprotokoll, neueste zuerst. */
export async function listStockMovements(transport: InternerTransport, query?: StockMovementQuery): Promise<StockMovementPage> {
  const name = 'listStockMovements';
  const daten = await transport(name, abfrage(name, query));
  return { movements: liste(name, daten, 'movements', bewegung), nextCursor: naechsterCursor(name, daten) };
}

export function iterateStockMovements(
  transport: InternerTransport,
  query?: StockMovementQuery,
): AsyncGenerator<StockMovement, void, undefined> {
  const { cursor, ...rest } = query ?? {};
  return seitenweise('listStockMovements', cursor, async (c) => {
    const s = await listStockMovements(transport, { ...rest, cursor: c });
    return { eintraege: s.movements, nextCursor: s.nextCursor };
  });
}

// ---- Webhooks ------------------------------------------------------------------

function mitSecret(name: ApiCall, daten: unknown): InventoryWebhookWithSecret {
  const o = objekt(daten);
  const secret = o?.secret;
  if (typeof secret !== 'string' || secret === '') {
    throw antwortfehler(name, 'Antwort enthaelt kein secret; ohne es laesst sich keine Zustellung pruefen');
  }
  return { webhook: webhook({ name, pfad: 'webhook' }, o?.webhook), secret };
}

/**
 * Legt einen Webhook an (hoechstens 5 je Konto, `webhook_limit`).
 * **Das Secret in der Antwort kommt nur dieses eine Mal**; sofort dorthin
 * schreiben, wo der Empfaenger es liest, nicht in ein Protokoll.
 */
export async function createWebhook(
  transport: InternerTransport,
  options: CreateInventoryWebhookOptions,
): Promise<InventoryWebhookWithSecret> {
  const name = 'createWebhook';
  const url = kennung(name, 'url', options?.url);
  if (!Array.isArray(options.events) || options.events.length === 0) {
    throw anfragefehler(name, 'events ist leer; ein Webhook ohne Ereignis bekaeme nie etwas');
  }
  const params: Params = { url, events: options.events };
  if (options.description !== undefined) params.description = options.description;
  return mitSecret(name, await transport(name, params));
}

/** Aendert nur die genannten Felder; `description: null` loescht die Beschreibung. */
export async function updateWebhook(
  transport: InternerTransport,
  webhookId: string,
  patch: InventoryWebhookPatch,
): Promise<InventoryWebhook> {
  const name = 'updateWebhook';
  const id = kennung(name, 'webhookId', webhookId);
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw anfragefehler(name, 'patch muss ein Objekt sein');
  const params: Params = { webhookId: id };
  for (const [feld, w] of Object.entries(patch)) if (w !== undefined) params[feld] = w;
  if (Object.keys(params).length === 1) throw anfragefehler(name, 'patch nennt keine Aenderung');
  const daten = await transport(name, params);
  return webhook({ name, pfad: 'webhook' }, objekt(daten)?.webhook);
}

export async function deleteWebhook(transport: InternerTransport, webhookId: string): Promise<{ webhookId: string; deleted: boolean }> {
  const name = 'deleteWebhook';
  const id = kennung(name, 'webhookId', webhookId);
  const o = objekt(await transport(name, { webhookId: id }));
  return { webhookId: typeof o?.webhookId === 'string' && o.webhookId ? o.webhookId : id, deleted: o?.deleted === true };
}

/** Die Webhooks des Kontos und die Ereignisse, die es abonnieren kann. */
export async function listWebhooks(transport: InternerTransport): Promise<InventoryWebhookList> {
  const name = 'listWebhooks';
  const daten = await transport(name, {});
  const ereignisse = objekt(daten)?.events;
  return {
    webhooks: liste(name, daten, 'webhooks', webhook),
    events: Array.isArray(ereignisse) ? ereignisse.filter((e): e is string => typeof e === 'string') : [],
  };
}

/**
 * Ein neues Secret fuer denselben Webhook. Ab der Antwort gilt nur noch das
 * neue (keine Uebergangsfrist): erst speichern, dann weiterarbeiten.
 */
export async function rotateWebhookSecret(transport: InternerTransport, webhookId: string): Promise<InventoryWebhookWithSecret> {
  const name = 'rotateWebhookSecret';
  return mitSecret(name, await transport(name, { webhookId: kennung(name, 'webhookId', webhookId) }));
}

/**
 * Eine Probe genau dieses Ereignisses an genau diesen Webhook, mit erfundener
 * Nutzlast und `test: true` in der Huelle. Der Webhook muss das Ereignis
 * abonnieren (`event_not_subscribed`) und aktiv sein (`webhook_inactive`).
 */
export async function sendWebhookTest(transport: InternerTransport, webhookId: string, event: string): Promise<InventoryWebhookTestResult> {
  const name = 'sendWebhookTest';
  const id = kennung(name, 'webhookId', webhookId);
  const ereignis = kennung(name, 'event', event);
  const daten = await transport(name, { webhookId: id, event: ereignis });
  const o = objekt(daten);
  return {
    eventId: typeof o?.eventId === 'string' ? o.eventId : '',
    event: typeof o?.event === 'string' ? o.event : ereignis,
    deliveries: liste(name, daten, 'deliveries', (ort, e) => probeZustellung(ort, e, id)),
  };
}

/** Die letzten Zustellungen, neueste zuerst; mit `webhookId` nur die eines Webhooks. */
export async function listWebhookDeliveries(
  transport: InternerTransport,
  options: { webhookId?: string; limit?: number } = {},
): Promise<InventoryWebhookDelivery[]> {
  const name = 'listWebhookDeliveries';
  const params: Params = {};
  if (options.webhookId !== undefined) params.webhookId = kennung(name, 'webhookId', options.webhookId);
  if (options.limit !== undefined) Object.assign(params, abfrage(name, { limit: options.limit }));
  return liste(name, await transport(name, params), 'deliveries', zustellung);
}
