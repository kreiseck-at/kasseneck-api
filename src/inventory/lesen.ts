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
  GoodsReceiptPreviewLine,
  InventoryShortfall,
  InventoryWarning,
  InventoryWebhook,
  InventoryWebhookDelivery,
  InventoryWebhookTestDelivery,
  Location,
  Reservation,
  ReservationItem,
  StockBelowMinimumEventData,
  StockChangedEventData,
  StockLevel,
  StockMovement,
  StockMovementLot,
  StockOperation,
  StockValue,
  Stocktake,
  StocktakeActor,
  StocktakeCount,
  StocktakeCountResult,
  StocktakeItem,
  StocktakeNotBooked,
  StocktakePdfDownload,
  StocktakeSeal,
  StocktakeWarning,
  VariantAttribute,
  VariantGroup,
  VariantGroupDefaults,
  VariantGroupMember,
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

/**
 * Mengen je Standort (`minStockByLocation`): jeder Wert eine Ganzzahl. Fehlt
 * das Feld (Server vor Stufe 5b), gilt „keiner“ (`{}`).
 */
function mengenJeStandort(ort: Ort, feld: string, w: unknown): Record<string, number> {
  if (w === undefined || w === null) return {};
  const o = objekt(w);
  if (!o) throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}.${feld} ist kein Objekt)`);
  const raus: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) raus[k] = ganzzahl(ort, `${feld}.${k}`, v);
  return raus;
}

/** Eine Liste von Kennungen (`movementIds`, `lotIds`); fehlt sie, ist sie leer. */
function kennungsliste(ort: Ort, feld: string, w: unknown): string[] {
  if (w === undefined || w === null) return [];
  if (!Array.isArray(w) || !w.every((x) => typeof x === 'string')) {
    throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}${ort.pfad ? '.' : ''}${feld} ist keine Liste von Kennungen)`);
  }
  return [...(w as string[])];
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
    description: text(a.description),
    unitPriceCents: ganzzahlOderNull(ort, 'unitPriceCents', a.unitPriceCents),
    vatRate: typeof vatRate === 'number' ? vatRate : null,
    unit: text(a.unit),
    number: text(a.number),
    ean: text(a.ean),
    internalCode: text(a.internalCode),
    groupId: text(a.groupId),
    revenueGroupId: text(a.revenueGroupId),
    stockTracked: a.stockTracked === true,
    stockKind: textOderNull(a.stockKind),
    stockLocationIds: standorte,
    minStock: ganzzahlOderNull(ort, 'minStock', a.minStock),
    minStockByLocation: mengenJeStandort(ort, 'minStockByLocation', a.minStockByLocation),
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
    // Server vor Stufe 5b senden das Feld nicht: dort aenderte keine Bewegung `reserved`.
    reservedDelta: b.reservedDelta === undefined ? 0 : ganzzahl(ort, 'reservedDelta', b.reservedDelta),
    stockAfter: nachher
      ? {
        sellable: ganzzahl(nachherOrt, 'sellable', nachher.sellable),
        defective: ganzzahl(nachherOrt, 'defective', nachher.defective),
        reserved: ganzzahlOderNull(nachherOrt, 'reserved', nachher.reserved),
      }
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

// ---- Schreiben (Stufe 5b) ------------------------------------------------------------

function warnung(ort: Ort, w: unknown): InventoryWarning {
  const h = eintrag(ort, w);
  if (typeof h.code !== 'string' || h.code === '') throw antwortfehler(ort.name, `Hinweis ohne Code (data.${ort.pfad}.code)`);
  return {
    code: h.code,
    articleId: textOderNull(h.articleId),
    locationId: textOderNull(h.locationId),
    message: typeof h.message === 'string' ? h.message : '',
  };
}

/** Antwort einer Buchung; ohne `operationId` ist nicht belegt, dass gebucht wurde. */
export function vorgang(name: string, daten: unknown): StockOperation {
  const d = objekt(daten);
  if (!d) throw antwortfehler(name, 'Antwort ist unbrauchbar (data ist kein Objekt)');
  const ort = { name, pfad: '' };
  if (typeof d.operationId !== 'string' || d.operationId === '') {
    throw antwortfehler(name, 'Antwort enthaelt keine Kennung (data.operationId fehlt)');
  }
  const hinweise = d.warnings === undefined || d.warnings === null ? [] : d.warnings;
  if (!Array.isArray(hinweise)) throw antwortfehler(name, 'Antwort ist unbrauchbar (data.warnings ist keine Liste)');
  return {
    operationId: d.operationId,
    movementIds: kennungsliste(ort, 'movementIds', d.movementIds),
    lotIds: kennungsliste(ort, 'lotIds', d.lotIds),
    warnings: hinweise.map((h, i) => warnung({ name, pfad: `warnings[${i}]` }, h)),
  };
}

/** Eine Zeile der Wareneingangs-Vorschau; Werte nur, wenn der Server sie sendet (Recht `costs`). */
export function vorschauZeile(ort: Ort, w: unknown): GoodsReceiptPreviewLine {
  const z = eintrag(ort, w);
  const serien = z.serialNumbers === undefined || z.serialNumbers === null ? [] : z.serialNumbers;
  if (!Array.isArray(serien) || !serien.every((x) => typeof x === 'string')) {
    throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}.serialNumbers ist keine Liste)`);
  }
  const raus: GoodsReceiptPreviewLine = {
    articleId: kennung(ort, 'articleId', z.articleId),
    quantity: ganzzahl(ort, 'quantity', z.quantity),
    expiresOn: textOderNull(z.expiresOn),
    batch: textOderNull(z.batch),
    serialNumbers: [...(serien as string[])],
    priceFromArticle: z.priceFromArticle === true,
  };
  for (const feld of ['baseCents', 'landedCostCents', 'valueCents', 'unitCostMicros'] as const) {
    if (hat(z, feld)) raus[feld] = ganzzahlOderNull(ort, feld, z[feld]);
  }
  return raus;
}

function reservierungsPosition(ort: Ort, w: unknown): ReservationItem {
  const p = eintrag(ort, w);
  return {
    articleId: kennung(ort, 'articleId', p.articleId),
    locationId: kennung(ort, 'locationId', p.locationId),
    quantity: ganzzahl(ort, 'quantity', p.quantity),
    redeemed: ganzzahl(ort, 'redeemed', p.redeemed),
    released: ganzzahl(ort, 'released', p.released),
  };
}

export function reservierung(ort: Ort, w: unknown): Reservation {
  const r = eintrag(ort, w);
  if (!Array.isArray(r.items)) throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}.items ist keine Liste)`);
  return {
    id: kennung(ort, 'id', r.id),
    status: textOderNull(r.status),
    reference: text(r.reference),
    items: r.items.map((p, i) => reservierungsPosition({ name: ort.name, pfad: `${ort.pfad}.items[${i}]` }, p)),
    expiresAt: text(r.expiresAt),
    createdAt: text(r.createdAt),
  };
}

/** Die fehlenden Positionen aus `insufficient_available` (`data.details[]`); ein kaputter Eintrag faellt weg. */
export function fehlmengen(roh: unknown): InventoryShortfall[] {
  if (!Array.isArray(roh)) return [];
  const raus: InventoryShortfall[] = [];
  for (const e of roh) {
    const o = objekt(e);
    if (!o) continue;
    const { articleId, locationId, requested, available } = o;
    if (typeof articleId !== 'string' || typeof locationId !== 'string') continue;
    if (!Number.isSafeInteger(requested) || !Number.isSafeInteger(available)) continue;
    raus.push({ articleId, locationId, requested: requested as number, available: available as number });
  }
  return raus;
}

// ---- Varianten (Stufe 5c) ------------------------------------------------------------

/** Eine Liste von Texten (Werte eines Merkmals); etwas anderes ist kaputt. */
function textliste(ort: Ort, feld: string, w: unknown): string[] {
  if (!Array.isArray(w) || !w.every((x) => typeof x === 'string')) {
    throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}.${feld} ist keine Liste von Texten)`);
  }
  return [...(w as string[])];
}

function merkmal(ort: Ort, w: unknown): VariantAttribute {
  const m = eintrag(ort, w);
  return { key: kennung(ort, 'key', m.key), label: typeof m.label === 'string' ? m.label : '', values: textliste(ort, 'values', m.values) };
}

/**
 * Vorgaben einer Gruppe: nur die Felder, die der Server sendet. Ein Preis als
 * Bruchzahl ist kaputt (er fuellte sonst jede neue Variante falsch), ein Feld
 * mit fremdem Typ ebenso.
 */
function vorgaben(ort: Ort, w: unknown): VariantGroupDefaults {
  if (w === undefined || w === null) return {};
  const v = objekt(w);
  const vOrt = { name: ort.name, pfad: `${ort.pfad}.defaults` };
  if (!v) throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${vOrt.pfad} ist kein Objekt)`);
  const raus: VariantGroupDefaults = {};
  if (v.unitPriceCents !== undefined && v.unitPriceCents !== null) raus.unitPriceCents = ganzzahl(vOrt, 'unitPriceCents', v.unitPriceCents);
  if (v.vatRate !== undefined && v.vatRate !== null) {
    if (typeof v.vatRate !== 'number' || !Number.isFinite(v.vatRate)) throw antwortfehler(ort.name, `Antwort enthaelt keinen USt-Satz (data.${vOrt.pfad}.vatRate)`);
    raus.vatRate = v.vatRate;
  }
  for (const feld of ['unit', 'groupId'] as const) {
    const t = v[feld];
    if (t === undefined || t === null) continue;
    if (typeof t !== 'string') throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${vOrt.pfad}.${feld} ist kein Text)`);
    raus[feld] = t;
  }
  if (v.stockTracked !== undefined && v.stockTracked !== null) {
    if (typeof v.stockTracked !== 'boolean') throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${vOrt.pfad}.stockTracked ist kein Wahrheitswert)`);
    raus.stockTracked = v.stockTracked;
  }
  return raus;
}

function mitglied(ort: Ort, w: unknown): VariantGroupMember {
  const x = eintrag(ort, w);
  return { articleId: kennung(ort, 'articleId', x.articleId), variantAttributes: textAbbildung(x.variantAttributes) ?? {} };
}

/**
 * Eine Variantengruppe. `attributes` und `variants` sind zugesagte Listen:
 * fehlen sie, ist die Antwort kaputt (eine leere Liste hiesse „keine Merkmale“
 * bzw. „keine Varianten“).
 */
export function variantengruppe(ort: Ort, w: unknown): VariantGroup {
  const g = eintrag(ort, w);
  for (const feld of ['attributes', 'variants'] as const) {
    if (!Array.isArray(g[feld])) throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}.${feld} ist keine Liste)`);
  }
  const unter = (feld: string, i: number): Ort => ({ name: ort.name, pfad: `${ort.pfad}.${feld}[${i}]` });
  return {
    id: kennung(ort, 'id', g.id),
    name: text(g.name),
    attributes: (g.attributes as unknown[]).map((m, i) => merkmal(unter('attributes', i), m)),
    defaults: vorgaben(ort, g.defaults),
    active: g.active !== false,
    variants: (g.variants as unknown[]).map((x, i) => mitglied(unter('variants', i), x)),
    createdAt: text(g.createdAt),
    updatedAt: text(g.updatedAt),
  };
}

// ---- Inventur (Lager-Kern Stufe 3) ---------------------------------------------------

const unter = (ort: Ort, feld: string): Ort => ({ name: ort.name, pfad: ort.pfad ? `${ort.pfad}.${feld}` : feld });

/** Ein Unterobjekt, das `null` sein darf (`review`, `closing` …); etwas anderes als Objekt oder `null` ist kaputt. */
function objektOderNull(ort: Ort, feld: string, w: unknown): Roh | null {
  if (w === undefined || w === null) return null;
  const o = objekt(w);
  if (!o) throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}.${feld} ist kein Objekt)`);
  return o;
}

/** Ein Wahrheitswert, der da sein muss: ein fehlendes „gezaehlt“ ist nicht „ungezaehlt“. */
function wahrheitswert(ort: Ort, feld: string, w: unknown): boolean {
  if (typeof w !== 'boolean') throw antwortfehler(ort.name, `Antwort enthaelt keinen Wahrheitswert (data.${ort.pfad}.${feld})`);
  return w;
}

/** Eine Liste von Texten, die fehlen darf (dann leer); etwas anderes ist kaputt. */
function textlisteOderLeer(ort: Ort, feld: string, w: unknown): string[] {
  if (w === undefined || w === null) return [];
  return textliste(ort, feld, w);
}

function akteur(ort: Ort, w: unknown): StocktakeActor | null {
  const a = objekt(w);
  if (!a) return null;
  return { type: textOderNull(a.type), id: textOderNull(a.id), name: textOderNull(a.name) };
}

function inventurWarnung(ort: Ort, w: unknown): StocktakeWarning {
  const h = eintrag(ort, w);
  if (typeof h.code !== 'string' || h.code === '') throw antwortfehler(ort.name, `Hinweis ohne Code (data.${ort.pfad}.code)`);
  return { code: h.code, items: ganzzahl(ort, 'items', h.items), message: typeof h.message === 'string' ? h.message : null };
}

/** Hinweise einer Inventur; fehlt die Liste, gibt es keine. */
export function inventurWarnungen(ort: Ort, w: unknown): StocktakeWarning[] {
  if (w === undefined || w === null) return [];
  if (!Array.isArray(w)) throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad} ist keine Liste)`);
  return w.map((h, i) => inventurWarnung({ name: ort.name, pfad: `${ort.pfad}[${i}]` }, h));
}

function siegel(ort: Ort, w: unknown): StocktakeSeal {
  const s = eintrag(ort, w);
  const raus: StocktakeSeal = {
    fromDay: textOderNull(s.fromDay),
    toDay: textOderNull(s.toDay),
    daysChecked: ganzzahlOderNull(ort, 'daysChecked', s.daysChecked),
    verified: typeof s.verified === 'boolean' ? s.verified : null,
    firstBreak: textOderNull(s.firstBreak),
    gaps: textlisteOderLeer(ort, 'gaps', s.gaps),
    gapCount: ganzzahlOderNull(ort, 'gapCount', s.gapCount),
  };
  if (typeof s.notChecked === 'string') raus.notChecked = s.notChecked;
  if (hat(s, 'checkedUntil')) raus.checkedUntil = textOderNull(s.checkedUntil);
  return raus;
}

/**
 * Kopf einer Inventur. Was erst nach dem Abschluss kommt (Summen, Hinweise,
 * Siegel, Pruefsumme, Protokoll), steht im Modell nur, wenn der Server es
 * sendet; Werte nur mit dem Kosten-Recht.
 */
export function inventur(ort: Ort, w: unknown): Stocktake {
  const k = eintrag(ort, w);
  const umfang = objektOderNull(ort, 'scope', k.scope);
  const umfangOrt = unter(ort, 'scope');
  const fortschritt = objektOderNull(ort, 'progress', k.progress);
  const fOrt = unter(ort, 'progress');
  const pruefung = objektOderNull(ort, 'review', k.review);
  const pOrt = unter(ort, 'review');
  const abschluss = objektOderNull(ort, 'closing', k.closing);
  const aOrt = unter(ort, 'closing');
  const abbruch = objektOderNull(ort, 'cancellation', k.cancellation);
  const raus: Stocktake = {
    id: kennung(ort, 'id', k.id),
    name: text(k.name),
    locationId: textOderNull(k.locationId),
    scope: umfang
      ? {
        type: textOderNull(umfang.type),
        groupIds: textlisteOderLeer(umfangOrt, 'groupIds', umfang.groupIds),
        articleIds: textlisteOderLeer(umfangOrt, 'articleIds', umfang.articleIds),
      }
      : null,
    type: textOderNull(k.type),
    keyDate: textOderNull(k.keyDate),
    // Blind ist die sichere Vorgabe: nur ein ausdrueckliches false zeigt Bestand.
    blind: k.blind !== false,
    status: textOderNull(k.status),
    progress: fortschritt
      ? {
        items: ganzzahl(fOrt, 'items', fortschritt.items),
        counted: ganzzahlOderNull(fOrt, 'counted', fortschritt.counted),
        recountOpen: fortschritt.recountOpen === true,
      }
      : null,
    createdAt: text(k.createdAt),
    createdBy: akteur(ort, k.createdBy),
    source: textOderNull(k.source),
    updatedAt: text(k.updatedAt),
    review: pruefung
      ? {
        startedAt: text(pruefung.startedAt),
        startedBy: akteur(pOrt, pruefung.startedBy),
        complete: pruefung.complete === true,
        expectedAsOf: text(pruefung.expectedAsOf),
        recountUncounted: ganzzahlOderNull(pOrt, 'recountUncounted', pruefung.recountUncounted),
      }
      : null,
    closing: abschluss
      ? {
        startedAt: text(abschluss.startedAt),
        startedBy: akteur(aOrt, abschluss.startedBy),
        uncountedAsZero: abschluss.uncountedAsZero === true,
        parts: ganzzahlOderNull(aOrt, 'parts', abschluss.parts),
        bookedParts: ganzzahlOderNull(aOrt, 'bookedParts', abschluss.bookedParts),
        completedAt: text(abschluss.completedAt),
      }
      : null,
    cancellation: abbruch
      ? { reason: text(abbruch.reason), cancelledAt: text(abbruch.cancelledAt), cancelledBy: akteur(unter(ort, 'cancellation'), abbruch.cancelledBy) }
      : null,
  };
  const summen = objektOderNull(ort, 'totals', k.totals);
  if (summen) {
    const sOrt = unter(ort, 'totals');
    raus.totals = {
      items: ganzzahl(sOrt, 'items', summen.items),
      counted: ganzzahl(sOrt, 'counted', summen.counted),
      uncounted: ganzzahl(sOrt, 'uncounted', summen.uncounted),
      recounted: ganzzahl(sOrt, 'recounted', summen.recounted),
      withDifference: ganzzahl(sOrt, 'withDifference', summen.withDifference),
      needsCheck: ganzzahl(sOrt, 'needsCheck', summen.needsCheck),
      notBooked: ganzzahl(sOrt, 'notBooked', summen.notBooked),
    };
    for (const feld of ['differenceValueCents', 'inventoryValueCents'] as const) {
      if (hat(summen, feld)) raus.totals[feld] = ganzzahlOderNull(sOrt, feld, summen[feld]);
    }
  }
  if (hat(k, 'warnings')) raus.warnings = inventurWarnungen(unter(ort, 'warnings'), k.warnings);
  if (hat(k, 'seal') && k.seal !== null) raus.seal = siegel(unter(ort, 'seal'), k.seal);
  if (hat(k, 'checksum')) raus.checksum = textOderNull(k.checksum);
  if (hat(k, 'inventoryAsOf')) raus.inventoryAsOf = textOderNull(k.inventoryAsOf);
  const pdf = objektOderNull(ort, 'pdf', k.pdf);
  if (pdf) {
    raus.pdf = { available: pdf.available === true };
    if (typeof pdf.valuesSha256 === 'string') raus.pdf.valuesSha256 = pdf.valuesSha256;
    if (typeof pdf.quantitiesSha256 === 'string') raus.pdf.quantitiesSha256 = pdf.quantitiesSha256;
  }
  return raus;
}

function nichtGebucht(ort: Ort, w: unknown): StocktakeNotBooked {
  const n = eintrag(ort, w);
  if (typeof n.code !== 'string' || n.code === '') throw antwortfehler(ort.name, `Antwort enthaelt keinen Grund (data.${ort.pfad}.code)`);
  const raus: StocktakeNotBooked = { code: n.code, quantity: ganzzahlOderNull(ort, 'quantity', n.quantity) };
  if (n.reasons !== undefined && n.reasons !== null) {
    if (!Array.isArray(n.reasons)) throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}.reasons ist keine Liste)`);
    raus.reasons = n.reasons.map((g, i) => {
      const gOrt = { name: ort.name, pfad: `${ort.pfad}.reasons[${i}]` };
      const r = eintrag(gOrt, g);
      if (typeof r.code !== 'string' || r.code === '') throw antwortfehler(ort.name, `Antwort enthaelt keinen Grund (data.${gOrt.pfad}.code)`);
      return { code: r.code, quantity: ganzzahlOderNull(gOrt, 'quantity', r.quantity) };
    });
  }
  return raus;
}

/**
 * Eine Position. Soll, Differenz und alles aus Pruefung und Abschluss stehen
 * im Modell nur, wenn der Server sie sendet (blind: vor `review` nie).
 */
export function inventurPosition(ort: Ort, w: unknown): StocktakeItem {
  const p = eintrag(ort, w);
  if (!Array.isArray(p.countedBy) && p.countedBy !== undefined && p.countedBy !== null) {
    throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}.countedBy ist keine Liste)`);
  }
  const zaehler = Array.isArray(p.countedBy) ? p.countedBy : [];
  const nachzaehlen = objektOderNull(ort, 'recount', p.recount);
  const nOrt = unter(ort, 'recount');
  const raus: StocktakeItem = {
    articleId: kennung(ort, 'articleId', p.articleId),
    condition: kennung(ort, 'condition', p.condition),
    name: text(p.name),
    number: text(p.number),
    unit: text(p.unit),
    round: ganzzahl(ort, 'round', p.round),
    counted: wahrheitswert(ort, 'counted', p.counted),
    quantity: ganzzahlOderNull(ort, 'quantity', p.quantity),
    counts: ganzzahl(ort, 'counts', p.counts),
    firstCountedAt: text(p.firstCountedAt),
    referenceTime: text(p.referenceTime),
    countedBy: zaehler.map((a) => akteur(ort, a)).filter((a): a is StocktakeActor => a !== null),
    serialNumbers: textlisteOderLeer(ort, 'serialNumbers', p.serialNumbers),
    recountRequested: p.recountRequested === true,
    recount: nachzaehlen
      ? {
        reason: text(nachzaehlen.reason),
        requestedAt: text(nachzaehlen.requestedAt),
        requestedBy: akteur(nOrt, nachzaehlen.requestedBy),
        round: ganzzahlOderNull(nOrt, 'round', nachzaehlen.round),
      }
      : null,
    addedLater: p.addedLater === true,
  };
  // Gezaehlt heisst: es gibt eine Menge. Beides zusammen kaputt waere „0“ oder „nichts“ geraten.
  if (raus.counted && raus.quantity === null) throw antwortfehler(ort.name, `Antwort ist unbrauchbar (data.${ort.pfad}.quantity fehlt bei counted: true)`);
  for (const feld of ['bookStockNow', 'expectedQuantity', 'differenceQuantity', 'differenceValueCents', 'bookedQuantity'] as const) {
    if (hat(p, feld)) raus[feld] = ganzzahlOderNull(ort, feld, p[feld]);
  }
  if (hat(p, 'needsCheck')) raus.needsCheck = p.needsCheck === true;
  if (hat(p, 'checkReasons')) raus.checkReasons = textlisteOderLeer(ort, 'checkReasons', p.checkReasons);
  if (hat(p, 'expectedAsOf')) raus.expectedAsOf = text(p.expectedAsOf);
  if (hat(p, 'missingSerialNumbers')) raus.missingSerialNumbers = textlisteOderLeer(ort, 'missingSerialNumbers', p.missingSerialNumbers);
  if (hat(p, 'extraSerialNumbers')) raus.extraSerialNumbers = textlisteOderLeer(ort, 'extraSerialNumbers', p.extraSerialNumbers);
  if (hat(p, 'notBooked')) raus.notBooked = p.notBooked === null ? null : nichtGebucht(unter(ort, 'notBooked'), p.notBooked);
  if (hat(p, 'inventory')) {
    const inv = objektOderNull(ort, 'inventory', p.inventory);
    if (!inv) {
      raus.inventory = null;
    } else {
      const iOrt = unter(ort, 'inventory');
      raus.inventory = { quantity: ganzzahl(iOrt, 'quantity', inv.quantity), countedOn: textOderNull(inv.countedOn) };
      for (const feld of ['unitValueMicros', 'valueCents'] as const) {
        if (hat(inv, feld)) raus.inventory[feld] = ganzzahlOderNull(iOrt, feld, inv[feld]);
      }
    }
  }
  return raus;
}

/** Eine Zaehlung: Menge, Runde und Kennungen muessen da sein. */
export function inventurZaehlung(ort: Ort, w: unknown): StocktakeCount {
  const z = eintrag(ort, w);
  const storno = objektOderNull(ort, 'voided', z.voided);
  return {
    id: kennung(ort, 'id', z.id),
    articleId: kennung(ort, 'articleId', z.articleId),
    condition: kennung(ort, 'condition', z.condition),
    quantity: ganzzahl(ort, 'quantity', z.quantity),
    serialNumbers: textlisteOderLeer(ort, 'serialNumbers', z.serialNumbers),
    round: ganzzahl(ort, 'round', z.round),
    countedBy: akteur(ort, z.countedBy),
    source: textOderNull(z.source),
    cashregisterId: textOderNull(z.cashregisterId),
    countedAt: text(z.countedAt),
    note: text(z.note),
    voided: storno
      ? { reason: text(storno.reason), voidedAt: text(storno.voidedAt), voidedBy: akteur(unter(ort, 'voided'), storno.voidedBy) }
      : null,
  };
}

/** Antwort von Zaehlen und Stornieren: beide Teile sind zugesagt. */
export function zaehlungMitPosition(name: string, daten: unknown): StocktakeCountResult {
  const d = objekt(daten);
  return { count: inventurZaehlung({ name, pfad: 'count' }, d?.count), item: inventurPosition({ name, pfad: 'item' }, d?.item) };
}

/** Lese-Link auf ein grosses Inventurprotokoll; ohne Adresse, Ablauf, Groesse oder Pruefsumme ist er unbrauchbar. */
export function protokollLink(name: string, w: unknown): StocktakePdfDownload {
  const ort = { name, pfad: 'download' };
  const d = eintrag(ort, w);
  return {
    url: kennung(ort, 'url', d.url),
    expiresAt: kennung(ort, 'expiresAt', d.expiresAt),
    sizeBytes: ganzzahl(ort, 'sizeBytes', d.sizeBytes),
    sha256: kennung(ort, 'sha256', d.sha256),
    fileName: textOderNull(d.fileName),
    contentType: textOderNull(d.contentType),
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
