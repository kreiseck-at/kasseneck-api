/**
 * Leser der Lager-Antworten: aus dem Draht `/v3` werden die Modelle in
 * `typen.ts`. Paketintern, nicht Teil der Oberflaeche.
 *
 * Regel wie beim Lager an der Kasse (`pos/lager.ts`): eine Menge, ein Betrag
 * oder eine Folgenummer ist eine Ganzzahl, sonst endet der Aufruf mit
 * `KasseneckValidationError` (`scope: 'response'`). Ein Ersatzwert wie `0`
 * waere eine falsche Aussage („kein Bestand“ statt „Antwort kaputt“). Texte
 * sind nachsichtiger: ein fehlender oder fremder Wert wird `null`.
 *
 * Optionale Felder (Einkaufswerte, `externalIds` …) erscheinen im Modell nur,
 * wenn der Server sie sendet: „fehlt“ heisst dort „kein Recht“, nicht „leer“.
 */

import { KasseneckValidationError } from '../client/errors.js';
import { LOCATION_TYPES, type LocationType } from './vertrag.js';
import type {
  Article,
  InventoryWebhook,
  InventoryWebhookDelivery,
  InventoryWebhookTestDelivery,
  Location,
  StockBelowMinimumEventData,
  StockChangedEventData,
  StockLevel,
  StockMovement,
  StockMovementLot,
  StockValue,
} from './typen.js';

type Roh = Record<string, unknown>;

/** Ein Leser bekommt den Vorgang (fuer die Meldung) und den Pfad im Rumpf. */
export interface Ort {
  name: string;
  pfad: string;
}

const hat = (o: Roh, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export function antwortfehler(name: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, grund, 'response');
}

export function objekt(w: unknown): Roh | null {
  return w !== null && typeof w === 'object' && !Array.isArray(w) ? (w as Roh) : null;
}

/** Ein Eintrag, der ein Objekt sein muss. */
function eintrag(ort: Ort, w: unknown): Roh {
  const o = objekt(w);
  if (!o) throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad} ist kein Objekt)`);
  return o;
}

const text = (w: unknown): string | null => (typeof w === 'string' ? w : null);

/** Eine Kennung, die da sein muss; ohne sie ist der Eintrag nicht zuzuordnen. */
function kennung(ort: Ort, feld: string, w: unknown): string {
  if (typeof w !== 'string' || w === '') {
    throw antwortfehler(ort.name, `Antwort enthaelt keine Kennung (data.${ort.pfad}.${feld} fehlt)`);
  }
  return w;
}

/** Eine Ganzzahl, die da sein muss. */
function ganzzahl(ort: Ort, feld: string, w: unknown): number {
  if (typeof w !== 'number' || !Number.isSafeInteger(w)) {
    throw antwortfehler(ort.name, `Antwort enthaelt keine ganze Zahl (data.${ort.pfad}.${feld})`);
  }
  return w;
}

/** Eine Ganzzahl oder `null`; fehlt der Wert, gilt `null`. */
function ganzzahlOderNull(ort: Ort, feld: string, w: unknown): number | null {
  if (w === undefined || w === null) return null;
  return ganzzahl(ort, feld, w);
}

/** Eine Textabbildung (`externalIds`, `metadata`, `variantAttributes`): nur Texteintraege. */
function textAbbildung(w: unknown): Record<string, string> | undefined {
  const o = objekt(w);
  if (!o) return undefined;
  const raus: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === 'string') raus[k] = v;
  return raus;
}

// ---- Artikel ------------------------------------------------------------------

export function artikel(ort: Ort, w: unknown): Article {
  const a = eintrag(ort, w);
  let standorte: string[] = [];
  if (a.stockLocationIds !== undefined && a.stockLocationIds !== null) {
    if (!Array.isArray(a.stockLocationIds) || !a.stockLocationIds.every((s) => typeof s === 'string')) {
      throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}.stockLocationIds ist keine Liste von Kennungen)`);
    }
    standorte = [...(a.stockLocationIds as string[])];
  }
  const vatRate = a.vatRate;
  if (vatRate !== undefined && vatRate !== null && (typeof vatRate !== 'number' || !Number.isFinite(vatRate))) {
    throw antwortfehler(ort.name, `Antwort enthaelt keinen USt-Satz (data.${ort.pfad}.vatRate)`);
  }
  const raus: Article = {
    id: kennung(ort, 'id', a.id),
    name: text(a.name),
    unitPriceCents: ganzzahlOderNull(ort, 'unitPriceCents', a.unitPriceCents),
    vatRate: typeof vatRate === 'number' ? vatRate : null,
    unit: text(a.unit),
    number: text(a.number),
    ean: text(a.ean),
    internalCode: text(a.internalCode),
    groupId: text(a.groupId),
    revenueGroupId: text(a.revenueGroupId),
    stockTracked: a.stockTracked === true,
    stockLocationIds: standorte,
    minStock: ganzzahlOderNull(ort, 'minStock', a.minStock),
    active: a.active !== false,
    createdAt: text(a.createdAt),
    updatedAt: text(a.updatedAt),
  };
  for (const feld of ['externalIds', 'metadata', 'variantAttributes'] as const) {
    const abb = textAbbildung(a[feld]);
    if (abb) raus[feld] = abb;
  }
  if (typeof a.variantGroupId === 'string') raus.variantGroupId = a.variantGroupId;
  // Nur mit dem Recht `costs`; ohne fehlt das Feld ganz.
  if (hat(a, 'purchasePriceMicros')) raus.purchasePriceMicros = ganzzahlOderNull(ort, 'purchasePriceMicros', a.purchasePriceMicros);
  return raus;
}

// ---- Standorte ------------------------------------------------------------------

const TYPEN: ReadonlySet<string> = new Set(LOCATION_TYPES);
const textOderNull = (w: unknown): string | null => (typeof w === 'string' && w !== '' ? w : null);

export function standort(ort: Ort, w: unknown): Location {
  const s = eintrag(ort, w);
  const a = objekt(s.address);
  const teile = a ? { street: textOderNull(a.street), zip: textOderNull(a.zip), city: textOderNull(a.city), country: textOderNull(a.country) } : null;
  return {
    id: kennung(ort, 'id', s.id),
    name: typeof s.name === 'string' ? s.name : '',
    type: typeof s.type === 'string' && TYPEN.has(s.type) ? (s.type as LocationType) : null,
    // Eine Adresse ohne einen einzigen Teil ist keine Adresse.
    address: teile && Object.values(teile).some((t) => t !== null) ? teile : null,
    licensePlate: textOderNull(s.licensePlate),
    active: s.active !== false,
    virtual: s.virtual === true,
  };
}

// ---- Bestand ------------------------------------------------------------------

export function bestand(ort: Ort, w: unknown): StockLevel {
  const b = eintrag(ort, w);
  return {
    articleId: kennung(ort, 'articleId', b.articleId),
    locationId: kennung(ort, 'locationId', b.locationId),
    onHand: ganzzahl(ort, 'onHand', b.onHand),
    reserved: ganzzahl(ort, 'reserved', b.reserved),
    available: ganzzahl(ort, 'available', b.available),
    defective: ganzzahl(ort, 'defective', b.defective),
    sequence: ganzzahl(ort, 'sequence', b.sequence),
    updatedAt: text(b.updatedAt),
  };
}

export function wert(ort: Ort, w: unknown): StockValue {
  const v = eintrag(ort, w);
  return {
    articleId: kennung(ort, 'articleId', v.articleId),
    stockValueCents: ganzzahl(ort, 'stockValueCents', v.stockValueCents),
    averageCostMicros: ganzzahlOderNull(ort, 'averageCostMicros', v.averageCostMicros),
  };
}

// ---- Bewegungen ------------------------------------------------------------------

function los(ort: Ort, w: unknown): StockMovementLot {
  const l = eintrag(ort, w);
  const raus: StockMovementLot = {
    lotId: text(l.lotId),
    quantity: ganzzahl(ort, 'quantity', l.quantity),
    expiresOn: text(l.expiresOn),
    batch: text(l.batch),
    serialNumber: text(l.serialNumber),
    receivedAt: text(l.receivedAt),
  };
  if (hat(l, 'valueCents')) raus.valueCents = ganzzahlOderNull(ort, 'valueCents', l.valueCents);
  return raus;
}

export function bewegung(ort: Ort, w: unknown): StockMovement {
  const b = eintrag(ort, w);
  const nachher = objekt(b.stockAfter);
  const quelle = objekt(b.source);
  const lose = b.lots === undefined || b.lots === null ? [] : b.lots;
  if (!Array.isArray(lose)) throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}.lots ist keine Liste)`);
  const nachherOrt = { name: ort.name, pfad: `${ort.pfad}.stockAfter` };
  const raus: StockMovement = {
    id: kennung(ort, 'id', b.id),
    type: text(b.type),
    articleId: text(b.articleId),
    locationId: text(b.locationId),
    condition: text(b.condition),
    quantityDelta: ganzzahl(ort, 'quantityDelta', b.quantityDelta),
    stockAfter: nachher
      ? { sellable: ganzzahl(nachherOrt, 'sellable', nachher.sellable), defective: ganzzahl(nachherOrt, 'defective', nachher.defective) }
      : null,
    operationId: text(b.operationId),
    source: quelle
      ? {
        type: text(quelle.type),
        id: text(quelle.id),
        register: text(quelle.register),
        position: typeof quelle.position === 'number' && Number.isSafeInteger(quelle.position) ? quelle.position : null,
      }
      : null,
    viennaDay: text(b.viennaDay),
    time: text(b.time),
    lots: lose.map((l, i) => los({ name: ort.name, pfad: `${ort.pfad}.lots[${i}]` }, l)),
  };
  if (hat(b, 'valueDeltaCents')) raus.valueDeltaCents = ganzzahlOderNull(ort, 'valueDeltaCents', b.valueDeltaCents);
  if (hat(b, 'consumedValueCents')) raus.consumedValueCents = ganzzahlOderNull(ort, 'consumedValueCents', b.consumedValueCents);
  return raus;
}

// ---- Webhooks ------------------------------------------------------------------

const zahlOderNull = (w: unknown): number | null => (typeof w === 'number' && Number.isFinite(w) ? w : null);

export function webhook(ort: Ort, w: unknown): InventoryWebhook {
  const h = eintrag(ort, w);
  const z = objekt(h.lastDelivery);
  return {
    id: kennung(ort, 'id', h.id),
    url: typeof h.url === 'string' ? h.url : '',
    events: Array.isArray(h.events) ? h.events.filter((e): e is string => typeof e === 'string') : [],
    active: h.active !== false,
    description: text(h.description),
    createdAt: text(h.createdAt),
    lastDelivery: z ? { at: text(z.at), status: text(z.status), statusCode: zahlOderNull(z.statusCode) } : null,
    consecutiveFailures: typeof h.consecutiveFailures === 'number' && Number.isSafeInteger(h.consecutiveFailures) ? h.consecutiveFailures : 0,
  };
}

export function zustellung(ort: Ort, w: unknown): InventoryWebhookDelivery {
  const z = eintrag(ort, w);
  return {
    deliveryId: kennung(ort, 'deliveryId', z.deliveryId),
    webhookId: text(z.webhookId),
    event: text(z.event),
    eventId: text(z.eventId),
    status: text(z.status),
    attempts: typeof z.attempts === 'number' && Number.isSafeInteger(z.attempts) ? z.attempts : 0,
    statusCode: zahlOderNull(z.statusCode),
    response: text(z.response),
    error: text(z.error),
    createdAt: text(z.createdAt),
    lastAttemptAt: text(z.lastAttemptAt),
    nextAttemptAt: text(z.nextAttemptAt),
    test: z.test === true,
  };
}

export function probeZustellung(ort: Ort, w: unknown, webhookId: string): InventoryWebhookTestDelivery {
  const z = eintrag(ort, w);
  return {
    deliveryId: kennung(ort, 'deliveryId', z.deliveryId),
    webhookId: typeof z.webhookId === 'string' && z.webhookId ? z.webhookId : webhookId,
    status: text(z.status),
    statusCode: zahlOderNull(z.statusCode),
  };
}

// ---- Ereignisse ------------------------------------------------------------------

export function bestandGeaendert(ort: Ort, w: unknown): StockChangedEventData {
  const d = eintrag(ort, w);
  const ursache = d.cause;
  if (typeof ursache !== 'string' || ursache === '') throw antwortfehler(ort.name, `Ereignis ohne Ursache (${ort.pfad}.cause)`);
  return { ...bestand(ort, d), cause: ursache, movementId: textOderNull(d.movementId) };
}

export function unterMindestbestand(ort: Ort, w: unknown): StockBelowMinimumEventData {
  const d = eintrag(ort, w);
  return {
    articleId: kennung(ort, 'articleId', d.articleId),
    locationId: kennung(ort, 'locationId', d.locationId),
    available: ganzzahl(ort, 'available', d.available),
    minStock: ganzzahl(ort, 'minStock', d.minStock),
  };
}

// ---- Listen ------------------------------------------------------------------

/** Eine zugesagte Liste `data.<feld>`, Eintrag fuer Eintrag gelesen. */
export function liste<T>(name: string, daten: unknown, feld: string, lesen: (ort: Ort, e: unknown) => T): T[] {
  const roh = objekt(daten)?.[feld];
  if (!Array.isArray(roh)) {
    const grund = roh === undefined || roh === null
      ? `Antwort enthaelt keine Liste (data.${feld} fehlt)`
      : `Antwort ist unbrauchbar (data.${feld} ist keine Liste)`;
    throw antwortfehler(name, grund);
  }
  return roh.map((e, i) => lesen({ name, pfad: `${feld}[${i}]` }, e));
}

/** Der Cursor der naechsten Seite; `null` am Ende. Etwas anderes als Text oder `null` ist kaputt. */
export function naechsterCursor(name: string, daten: unknown): string | null {
  const c = objekt(daten)?.nextCursor;
  if (c === undefined || c === null) return null;
  if (typeof c !== 'string' || c === '') throw antwortfehler(name, 'Antwort ist unbrauchbar (data.nextCursor)');
  return c;
}
