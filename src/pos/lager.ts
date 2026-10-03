import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import { liste } from './artikel.js';

/**
 * Lager an der Kasse (Lager-Kern Stufe 2, Backend lager-endpoints.js):
 * Standorte, Bestand und der Standort der Kasse. Alle drei Aufrufe gibt es
 * nur ueber den Kassenweg `/api/v3` (registerInternal); Rechte am Server:
 * `stockView` (lesen), `stockCosts` (Werte), `stockLocation` (Standort setzen).
 *
 * **Ganzzahlen:** Mengen sind Tausendstel der Basiseinheit (`1000` = 1 Stueck,
 * `250` = 0,250 kg), Werte ganze Cent bzw. Mikro-Euro. Nichts wird geteilt,
 * gerundet oder geklemmt -- ein negativer Bestand (mehr verkauft als gebucht)
 * ist eine Aussage des Servers und bleibt negativ. Eine Zahl, die keine
 * Ganzzahl ist, oder eine fehlende Menge wird **nie** zu `0`: der Aufruf
 * endet mit `KasseneckValidationError` (`scope: 'response'`), denn „kein
 * Bestand“ und „Antwort kaputt“ sind verschiedene Aussagen.
 */

/** Standort-Typen (Katalog `STANDORT_TYP`), englisch wie am Draht. */
export const STOCK_LOCATION_TYPES = Object.freeze(['warehouse', 'store', 'vehicle', 'other'] as const);
export type StockLocationType = (typeof STOCK_LOCATION_TYPES)[number];

export interface StockLocationAddress {
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
}

export interface StockLocation {
  id: string;
  name: string;
  /** `null`: ein Typ, den dieses Paket nicht kennt. */
  type: StockLocationType | null;
  /** Fahrzeuge haben keine Adresse. */
  address: StockLocationAddress | null;
  /** Kennzeichen, nur bei `vehicle`. */
  licensePlate: string | null;
  /** `false` = aufgeloest; als Standort der Kasse abgewiesen (`location_inactive`). */
  active: boolean;
  /** `true` = Hauptstandort, den der Server ohne eigenes Dokument ergaenzt. */
  virtual: boolean;
}

/** Bestand eines Artikels an einem Standort, in Tausendstel der Basiseinheit. */
export interface StockLevel {
  articleId: string;
  locationId: string;
  sellable: number;
  defective: number;
  reserved: number;
  /** `sellable - reserved`, vom Server gerechnet. */
  available: number;
}

/** Lagerwert eines Artikels -- nur mit dem Recht `stockCosts`. */
export interface StockValue {
  articleId: string;
  stockValueCents: number;
  /** Durchschnittlicher Einstandspreis je Basiseinheit in Mikro-Euro; `null` bei Menge 0. */
  averageCostMicros: number | null;
}

export interface StockList {
  stock: StockLevel[];
  /**
   * `null`, wenn der Aufrufer das Recht `stockCosts` nicht hat (der Server
   * laesst das Feld weg); `[]`, wenn er es hat und nichts bewertet ist. Eine
   * Oberflaeche zeigt bei `null` keinen Wert, nie „0,00 €“.
   */
  values: StockValue[] | null;
}

export interface ListMyStockOptions {
  /** Nur dieser Standort; `''` gilt wie nicht angegeben. */
  locationId?: string;
  /** Nur dieser Artikel; `''` gilt wie nicht angegeben. */
  articleId?: string;
  /** Nur Zeilen unter dem Mindestbestand. */
  belowMinimum?: boolean;
}

export interface SetMyCashregisterStockLocationOptions {
  /** Standort-Kennung; `null` setzt auf den Standard-Standort des Betriebs zurueck. */
  stockLocationId: string | null;
  /** Ohne Angabe gilt die Kasse der Anmeldung (`registerUserAuth`). */
  cashregisterId?: string;
}

export interface CashregisterStockLocation {
  cashregisterId: string;
  /** `null` = Standard-Standort des Betriebs. */
  stockLocationId: string | null;
}

type Roh = Record<string, unknown>;
const TYPEN: ReadonlySet<string> = new Set(STOCK_LOCATION_TYPES);

function antwortfehler(name: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, grund, 'response');
}

const objekt = (w: unknown): Roh | null => (w !== null && typeof w === 'object' && !Array.isArray(w) ? (w as Roh) : null);
/** Freitext, der fehlen darf (Name, Adressteile, Kennzeichen): leer = `null`. */
const textOderNull = (w: unknown): string | null => (typeof w === 'string' && w !== '' ? w : null);

/**
 * Eine Kennung, die da sein muss: ohne sie ist die Zeile nicht zuzuordnen,
 * und ein leerer Text als `stockLocationId` setzte die Kasse zurueck.
 */
function kennung(name: string, pfad: string, w: unknown): string {
  if (typeof w !== 'string' || w === '') throw antwortfehler(name, `Antwort enthaelt keine Kennung (data.${pfad} fehlt)`);
  return w;
}

/** Eine Zahl des Servers: Ganzzahl oder Antwortfehler, nie ein Ersatzwert. */
function ganzzahl(name: string, pfad: string, w: unknown): number {
  if (typeof w !== 'number' || !Number.isInteger(w)) {
    throw antwortfehler(name, `Antwort enthaelt keine ganze Zahl (data.${pfad})`);
  }
  return w;
}

function standort(name: string, e: unknown, i: number): StockLocation {
  const s = objekt(e) ?? {};
  const pfad = `locations[${i}]`;
  const a = objekt(s.address);
  const teile = a ? { street: textOderNull(a.street), zip: textOderNull(a.zip), city: textOderNull(a.city), country: textOderNull(a.country) } : null;
  // Eine Adresse ohne einen einzigen Teil ist keine Adresse.
  const address = teile && Object.values(teile).some((t) => t !== null) ? teile : null;
  return {
    id: kennung(name, `${pfad}.id`, s.id),
    name: typeof s.name === 'string' ? s.name : '',
    type: typeof s.type === 'string' && TYPEN.has(s.type) ? (s.type as StockLocationType) : null,
    address,
    licensePlate: textOderNull(s.licensePlate),
    active: s.active !== false,
    virtual: s.virtual === true,
  };
}

function bestand(name: string, e: unknown, i: number): StockLevel {
  const b = objekt(e) ?? {};
  const pfad = `stock[${i}]`;
  return {
    articleId: kennung(name, `${pfad}.articleId`, b.articleId),
    locationId: kennung(name, `${pfad}.locationId`, b.locationId),
    sellable: ganzzahl(name, `${pfad}.sellable`, b.sellable),
    defective: ganzzahl(name, `${pfad}.defective`, b.defective),
    reserved: ganzzahl(name, `${pfad}.reserved`, b.reserved),
    available: ganzzahl(name, `${pfad}.available`, b.available),
  };
}

function wert(name: string, e: unknown, i: number): StockValue {
  const w = objekt(e) ?? {};
  const pfad = `values[${i}]`;
  return {
    articleId: kennung(name, `${pfad}.articleId`, w.articleId),
    stockValueCents: ganzzahl(name, `${pfad}.stockValueCents`, w.stockValueCents),
    // Fehlt der Durchschnitt oder ist er null, ist die Menge 0 -- eine
    // vorhandene, aber unbrauchbare Zahl ist dagegen ein Antwortfehler.
    averageCostMicros: w.averageCostMicros === undefined || w.averageCostMicros === null
      ? null
      : ganzzahl(name, `${pfad}.averageCostMicros`, w.averageCostMicros),
  };
}

/** Standorte des Betriebs, samt aufgeloesten (`active: false`) und dem Hauptstandort. */
export async function listMyStockLocations(transport: InternerTransport): Promise<StockLocation[]> {
  const name = 'listMyStockLocations';
  const daten = await transport<{ locations?: unknown }>(name);
  return liste(daten, 'locations', name, (e, i) => standort(name, e, i));
}

/** Bestand je Artikel und Standort; Werte nur mit dem Recht `stockCosts`. */
export async function listMyStock(transport: InternerTransport, options: ListMyStockOptions = {}): Promise<StockList> {
  const name = 'listMyStock';
  if (options === null || typeof options !== 'object') throw new KasseneckValidationError(name, 'options muss ein Objekt sein', 'request');
  const params: Record<string, unknown> = {};
  for (const feld of ['locationId', 'articleId'] as const) {
    const w = options[feld];
    if (w === undefined || w === '') continue;
    if (typeof w !== 'string') throw new KasseneckValidationError(name, `${feld} muss Text sein`, 'request');
    params[feld] = w;
  }
  if (options.belowMinimum !== undefined) {
    if (typeof options.belowMinimum !== 'boolean') throw new KasseneckValidationError(name, 'belowMinimum muss true oder false sein', 'request');
    // false filtert am Server nicht; gesendet wird nur der Filter selbst.
    if (options.belowMinimum) params.belowMinimum = true;
  }
  const daten = await transport<{ stock?: unknown; values?: unknown }>(name, params);
  const stock = liste(daten, 'stock', name, (e, i) => bestand(name, e, i));
  const roh = objekt(daten)?.values;
  // Fehlt `values`, fehlt dem Aufrufer das Recht `stockCosts`: `null`, nie `[]`.
  // Etwas anderes als eine Liste ist dagegen kein „kein Recht“, sondern kaputt.
  if (roh === undefined || roh === null) return { stock, values: null };
  return { stock, values: liste(daten, 'values', name, (e, i) => wert(name, e, i)) };
}

/**
 * Standort der Kasse setzen -- von dort bucht der Server Verkauf und Storno
 * ab. `stockLocationId: null` setzt zurueck (am Draht der leere Text).
 * Fehler am Code: `location_not_found`, `location_inactive`,
 * `cashregister_not_found`, `cashregister_not_assigned`, `not_permitted`,
 * `module_inactive`.
 */
export async function setMyCashregisterStockLocation(
  transport: InternerTransport,
  options: SetMyCashregisterStockLocationOptions,
): Promise<CashregisterStockLocation> {
  const name = 'setMyCashregisterStockLocation';
  const ziel = options?.stockLocationId;
  if (ziel !== null && typeof ziel !== 'string') {
    throw new KasseneckValidationError(name, 'stockLocationId fehlt (Kennung, oder null zum Zuruecksetzen)', 'request');
  }
  const params: Record<string, unknown> = { stockLocationId: ziel === null ? '' : ziel };
  if (options.cashregisterId !== undefined) {
    if (typeof options.cashregisterId !== 'string' || options.cashregisterId.trim() === '') {
      throw new KasseneckValidationError(name, 'cashregisterId ist leer', 'request');
    }
    params.cashregisterId = options.cashregisterId;
  }
  const daten = objekt(await transport(name, params));
  if (!daten || typeof daten.cashregisterId !== 'string' || daten.cashregisterId === '') {
    throw antwortfehler(name, 'Antwort enthaelt keine Kasse (data.cashregisterId fehlt)');
  }
  const stand = daten.stockLocationId;
  if (stand !== null && stand !== undefined && typeof stand !== 'string') {
    throw antwortfehler(name, 'Antwort enthaelt einen unbrauchbaren Standort (data.stockLocationId)');
  }
  return { cashregisterId: daten.cashregisterId, stockLocationId: textOderNull(stand) };
}
