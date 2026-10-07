/**
 * Die schreibenden Aufrufe der Lager-API (Backend Stufe 5b): Artikel anlegen,
 * aendern und stilllegen, Bestand buchen (Wareneingang, Umbuchung, Abgang,
 * Zustand, Gegenbuchung) und reservieren.
 *
 * Wie in `endpunkte.ts` nimmt jede Funktion den Transport als ersten Parameter
 * und ist einzeln importierbar. Die Anfrage geht flach hinaus, genau mit den
 * Feldern, die der Aufrufer nennt (`undefined` faellt weg, `null` bleibt: es
 * leert ein Feld bzw. heisst bei der Anlage „nicht angegeben“).
 *
 * **Vor dem Senden geprueft wird nur, was ohne Netz sicher falsch ist:**
 * - `idempotencyKey` fehlt, ist leer oder laenger als 120 Zeichen. Ohne
 *   Schluessel gaebe es keine sichere Wiederholung, und der Server wiese die
 *   Anfrage ohnehin ab (`idempotency_key_required` bzw. `validation`);
 * - eine Pflichtkennung fehlt oder ist leer;
 * - eine Menge, ein Betrag oder ein Preis ist keine Ganzzahl (Tausendstel,
 *   Cent, Mikro-Euro): `1.5` waere nie „1,5 Stueck“, sondern ein Fehler;
 * - `expiresInMinutes` liegt ausserhalb 5 … 43 200;
 * - eine Aenderung nennt kein Feld, eine Freigabe eine leere Liste.
 * Alles Fachliche (Pruefziffer der EAN, Kataloge, Bestand, Rechte) prueft der
 * Server und meldet es mit seinem Code.
 *
 * **Wiederholen:** nach einem Zeitlimit oder Netzfehler denselben Aufruf mit
 * **demselben** `idempotencyKey` noch einmal senden. Er wirkt genau einmal und
 * liefert die gespeicherte Antwort; ein neuer Schluessel buchte ein zweites Mal.
 * Darum meldet jeder schreibende Aufruf in diesen Faellen (auch HTTP 5xx und
 * unlesbare Antwort) `outcome: 'unknown'`, nie `'rejected'`. Lesen und der
 * Probelauf (`previewGoodsReceipt`) bleiben `'rejected'`.
 */

import type { ApiCall, InternerTransport } from '../client/aufrufe.js';
import { abfrage, anfragefehler, kennung, seitenweise } from './endpunkte.js';
import { artikel, liste, naechsterCursor, objekt, reservierung, vorgang, vorschauZeile } from './lesen.js';
import { INVENTORY_IDEMPOTENCY_KEY_MAX, RESERVATION_MINUTES_MAX, RESERVATION_MINUTES_MIN } from './vertrag.js';
import type {
  Article,
  ChangeStockConditionRequest,
  CreateArticleRequest,
  CreateReservationRequest,
  DeactivateArticleRequest,
  ExtendReservationRequest,
  GoodsReceiptPreview,
  GoodsReceiptPreviewRequest,
  ReceiveGoodsRequest,
  RecordStockLossRequest,
  ReleaseReservationRequest,
  Reservation,
  ReservationListQuery,
  ReservationPage,
  ReverseStockMovementRequest,
  StockOperation,
  TransferStockRequest,
  UpdateArticleRequest,
} from './typen.js';

type Params = Record<string, unknown>;

// ---- Pruefung vor dem Senden ------------------------------------------------------

/** Die Anfrage als flache Kopie ohne `undefined`; der Aufrufer behaelt sein Objekt. Paketintern, auch fuer `varianten.ts`. */
export function anfrage(name: ApiCall, request: unknown): Params {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw anfragefehler(name, 'Anfrage muss ein Objekt sein');
  }
  const raus: Params = {};
  for (const [feld, w] of Object.entries(request as Params)) if (w !== undefined) raus[feld] = w;
  return raus;
}

/**
 * `idempotencyKey`: Text mit 1–120 Zeichen, nicht nur Leerraum. Er wird nie
 * getrimmt oder gekuerzt: ein veraenderter Schluessel waere ein anderer.
 */
export function schluessel(name: ApiCall, p: Params, { pflicht }: { pflicht: boolean }): void {
  const w = p.idempotencyKey;
  if (w === undefined || w === null) {
    if (pflicht) {
      throw anfragefehler(name, 'idempotencyKey fehlt (Pflicht bei jedem Schreiben); bei einer Wiederholung denselben Schluessel senden');
    }
    return;
  }
  if (typeof w !== 'string' || w.trim() === '') throw anfragefehler(name, 'idempotencyKey muss ein nicht leerer Text sein');
  if (w.length > INVENTORY_IDEMPOTENCY_KEY_MAX) {
    throw anfragefehler(name, `idempotencyKey ist laenger als ${INVENTORY_IDEMPOTENCY_KEY_MAX} Zeichen`);
  }
}

/** Eine Ganzzahl (Tausendstel, Cent, Mikro-Euro); fehlt sie, nur wenn sie darf. `null` nur, wo es leert. */
export function ganz(name: ApiCall, feld: string, w: unknown, { pflicht = false, leerbar = false } = {}): void {
  if (w === undefined || (w === null && leerbar)) {
    if (pflicht) throw anfragefehler(name, `${feld} fehlt`);
    return;
  }
  if (typeof w !== 'number' || !Number.isSafeInteger(w)) {
    throw anfragefehler(name, `${feld} muss eine ganze Zahl sein (Mengen in Tausendstel, Geld in Cent, Preise in Mikro-Euro)`);
  }
}

/** Haltedauer einer Reservierung in ganzen Minuten. */
function minuten(name: ApiCall, w: unknown, { pflicht }: { pflicht: boolean }): void {
  if (w === undefined || (w === null && !pflicht)) {
    if (pflicht) throw anfragefehler(name, 'expiresInMinutes fehlt');
    return;
  }
  if (typeof w !== 'number' || !Number.isSafeInteger(w) || w < RESERVATION_MINUTES_MIN || w > RESERVATION_MINUTES_MAX) {
    throw anfragefehler(name, `expiresInMinutes muss eine ganze Zahl von ${RESERVATION_MINUTES_MIN} bis ${RESERVATION_MINUTES_MAX} sein`);
  }
}

/**
 * Positionen: eine Liste (Pflicht, wo der Aufruf sie verlangt), jede ein
 * Objekt mit `articleId` und ganzzahliger `quantity`. `weiter` prueft die
 * uebrigen Zahlenfelder einer Position. Leer und zu lang entscheidet der Server
 * (`no_positions`, `too_many_positions`).
 */
function positionen(
  name: ApiCall,
  w: unknown,
  { pflicht, menge }: { pflicht: boolean; menge: 'pflicht' | 'frei' },
  weiter: (x: Params, f: string) => void = () => {},
): void {
  if (w === undefined) {
    if (pflicht) throw anfragefehler(name, 'items fehlt');
    return;
  }
  if (!Array.isArray(w)) throw anfragefehler(name, 'items muss eine Liste sein');
  w.forEach((x, i) => {
    const f = `items[${i}]`;
    if (x === null || typeof x !== 'object' || Array.isArray(x)) throw anfragefehler(name, `${f} muss ein Objekt sein`);
    const o = x as Params;
    kennung(name, `${f}.articleId`, o.articleId);
    ganz(name, `${f}.quantity`, o.quantity, { pflicht: menge === 'pflicht' });
    weiter(o, f);
  });
}

// ---- Artikel ------------------------------------------------------------------

/**
 * Zahlenfelder eines Artikels; `null` leert sie (bzw. heisst bei der Anlage
 * „nicht angegeben“). `praefix` nennt die Stelle in der Anfrage (`variants[2].`).
 */
export function artikelZahlen(name: ApiCall, p: Params, praefix = ''): void {
  for (const feld of ['unitPriceCents', 'minStock', 'purchasePriceMicros'] as const) ganz(name, `${praefix}${feld}`, p[feld], { leerbar: true });
  const jeStandort = p.minStockByLocation;
  if (jeStandort === undefined || jeStandort === null) return;
  if (typeof jeStandort !== 'object' || Array.isArray(jeStandort)) throw anfragefehler(name, `${praefix}minStockByLocation muss ein Objekt { standort: Tausendstel } sein`);
  for (const [standort, w] of Object.entries(jeStandort as Params)) ganz(name, `${praefix}minStockByLocation.${standort}`, w, { leerbar: true });
}

export const artikelAus = (name: ApiCall, daten: unknown): Article => artikel({ name, pfad: 'article' }, objekt(daten)?.article);

/**
 * Legt einen Artikel an. Mit `ean` ein Fremdartikel mit diesem Code (gueltige
 * Pruefziffer, frei im Konto), sonst vergibt der Server den naechsten eigenen
 * Code. Antwort: der Artikel wie `getArticle`.
 */
export async function createArticle(transport: InternerTransport, request: CreateArticleRequest): Promise<Article> {
  const name = 'createArticle';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  artikelZahlen(name, p);
  return artikelAus(name, await transport(name, p));
}

/** Aendert nur die genannten Felder eines Artikels (siehe [UpdateArticleRequest]). */
export async function updateArticle(transport: InternerTransport, request: UpdateArticleRequest): Promise<Article> {
  const name = 'updateArticle';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  kennung(name, 'articleId', p.articleId);
  if (Object.keys(p).every((k) => k === 'idempotencyKey' || k === 'articleId')) {
    throw anfragefehler(name, 'die Aenderung nennt kein Feld');
  }
  artikelZahlen(name, p);
  return artikelAus(name, await transport(name, p));
}

/** Legt einen Artikel still (`active: false`); Code und eigene Kennungen werden frei. */
export async function deactivateArticle(transport: InternerTransport, request: DeactivateArticleRequest): Promise<Article> {
  const name = 'deactivateArticle';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  kennung(name, 'articleId', p.articleId);
  return artikelAus(name, await transport(name, p));
}

// ---- Buchen ------------------------------------------------------------------

function eingangZahlen(name: ApiCall, p: Params): void {
  positionen(name, p.items, { pflicht: true, menge: 'pflicht' }, (x, f) => {
    for (const feld of ['totalCents', 'unitPriceMicros', 'landedCostCents'] as const) ganz(name, `${f}.${feld}`, x[feld]);
  });
  const nebenkosten = p.landedCosts;
  if (nebenkosten === undefined) return;
  if (!Array.isArray(nebenkosten)) throw anfragefehler(name, 'landedCosts muss eine Liste sein');
  nebenkosten.forEach((n, i) => {
    if (n === null || typeof n !== 'object' || Array.isArray(n)) throw anfragefehler(name, `landedCosts[${i}] muss ein Objekt sein`);
    ganz(name, `landedCosts[${i}].amountCents`, (n as Params).amountCents, { pflicht: true });
  });
}

/**
 * Bucht einen Wareneingang. Ohne `locationId` am Standard-Standort; die
 * Antwort traegt keine Werte, auch mit dem Recht `costs` nicht. Fuer die
 * Vorschau mit Werten: [previewGoodsReceipt].
 */
export async function receiveGoods(transport: InternerTransport, request: ReceiveGoodsRequest): Promise<StockOperation> {
  const name = 'receiveGoods';
  const p = anfrage(name, request);
  if (p.dryRun === true) {
    throw anfragefehler(name, 'dryRun: true bucht nichts und liefert eine Vorschau statt eines Vorgangs; dafuer previewGoodsReceipt aufrufen');
  }
  schluessel(name, p, { pflicht: true });
  eingangZahlen(name, p);
  return vorgang(name, await transport(name, p));
}

/**
 * Vorschau eines Wareneingangs (`receiveGoods` mit `dryRun: true`): prueft
 * Positionen, Artikel, Preise und Nebenkosten und rechnet die Verteilung,
 * schreibt aber nichts. Ein `idempotencyKey` ist freigestellt (`null` wie nicht
 * angegeben, geht nicht hinaus) und wird nicht verbraucht; dieselbe Anfrage
 * laesst sich danach mit ihm buchen. Werte
 * (`baseCents` …) nur mit dem Recht `costs`. Den Standort prueft erst die Buchung.
 */
export async function previewGoodsReceipt(transport: InternerTransport, request: GoodsReceiptPreviewRequest): Promise<GoodsReceiptPreview> {
  const name = 'receiveGoods';
  const p = anfrage(name, request);
  // null heisst hier „kein Schluessel“ und geht wie undefined nicht hinaus.
  if (p.idempotencyKey === null) delete p.idempotencyKey;
  schluessel(name, p, { pflicht: false });
  eingangZahlen(name, p);
  // Ein Probelauf schreibt nichts: nach einem Zeitlimit bleibt er `rejected`,
  // obwohl `receiveGoods` sonst Wirkung hat.
  const daten = await transport(name, { ...p, dryRun: true }, undefined, undefined, { hasEffect: false });
  return { preview: liste(name, daten, 'preview', vorschauZeile) };
}

const stueckPositionen = (name: ApiCall, p: Params): void => positionen(name, p.items, { pflicht: true, menge: 'pflicht' });

/** Bucht Ware von einem Standort an einen anderen; ueberzieht nie (`exceeds_stock`). */
export async function transferStock(transport: InternerTransport, request: TransferStockRequest): Promise<StockOperation> {
  const name = 'transferStock';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  kennung(name, 'fromLocationId', p.fromLocationId);
  kennung(name, 'toLocationId', p.toLocationId);
  stueckPositionen(name, p);
  return vorgang(name, await transport(name, p));
}

/** Bucht einen Abgang (Bruch, Schwund, Diebstahl, Entnahme …); ueberzieht nie (`exceeds_stock`). */
export async function recordStockLoss(transport: InternerTransport, request: RecordStockLossRequest): Promise<StockOperation> {
  const name = 'recordStockLoss';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  stueckPositionen(name, p);
  return vorgang(name, await transport(name, p));
}

/** Bucht Ware zwischen `sellable` und `defective` um; ueberzieht nie (`exceeds_stock`). */
export async function changeStockCondition(transport: InternerTransport, request: ChangeStockConditionRequest): Promise<StockOperation> {
  const name = 'changeStockCondition';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  stueckPositionen(name, p);
  return vorgang(name, await transport(name, p));
}

/** Nimmt einen ganzen Vorgang (`operationId`) mit einer Gegenbuchung zurueck. */
export async function reverseStockMovement(transport: InternerTransport, request: ReverseStockMovementRequest): Promise<StockOperation> {
  const name = 'reverseStockMovement';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  kennung(name, 'operationId', p.operationId);
  return vorgang(name, await transport(name, p));
}

// ---- Reservierung ---------------------------------------------------------------

const reservierungAus = (name: ApiCall, daten: unknown): Reservation =>
  reservierung({ name, pfad: 'reservation' }, objekt(daten)?.reservation);

/**
 * Reserviert Ware (Checkout im Shop): ganz oder gar nicht, gemessen am
 * verfuegbaren Bestand (`onHand − reserved`). Fehlt etwas, entsteht nichts:
 * `insufficient_available`, die fehlenden Positionen in [inventoryShortfalls].
 * Eingeloest wird ueber eine Rechnung (`issueInvoice` mit `items[].reservationId`),
 * sonst laeuft die Reservierung ab und gibt die Ware wieder frei.
 */
export async function createReservation(transport: InternerTransport, request: CreateReservationRequest): Promise<Reservation> {
  const name = 'createReservation';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  positionen(name, p.items, { pflicht: true, menge: 'pflicht' });
  minuten(name, p.expiresInMinutes, { pflicht: false });
  return reservierungAus(name, await transport(name, p));
}

/** Verlaengert eine aktive Reservierung: neuer Ablauf = jetzt + `expiresInMinutes`. */
export async function extendReservation(transport: InternerTransport, request: ExtendReservationRequest): Promise<Reservation> {
  const name = 'extendReservation';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  kennung(name, 'reservationId', p.reservationId);
  minuten(name, p.expiresInMinutes, { pflicht: true });
  return reservierungAus(name, await transport(name, p));
}

/**
 * Gibt reservierte Ware frei: ohne `items` alles, sonst je Position (ohne
 * `quantity` der ganze offene Rest). Die Antwort traegt den Stand danach;
 * `released` wird der Status erst, wenn nichts mehr offen ist.
 */
export async function releaseReservation(transport: InternerTransport, request: ReleaseReservationRequest): Promise<Reservation> {
  const name = 'releaseReservation';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  kennung(name, 'reservationId', p.reservationId);
  if (Array.isArray(p.items) && p.items.length === 0) {
    throw anfragefehler(name, 'items ist leer; um alles freizugeben, items ganz weglassen');
  }
  positionen(name, p.items, { pflicht: false, menge: 'frei' });
  return reservierungAus(name, await transport(name, p));
}

/** Eine Reservierung mit ihrem aktuellen Stand. */
export async function getReservation(transport: InternerTransport, reservationId: string): Promise<Reservation> {
  const name = 'getReservation';
  return reservierungAus(name, await transport(name, { reservationId: kennung(name, 'reservationId', reservationId) }));
}

/** Reservierungen, neueste zuerst; Filter `status` und/oder `reference`. */
export async function listReservations(transport: InternerTransport, query?: ReservationListQuery): Promise<ReservationPage> {
  const name = 'listReservations';
  const daten = await transport(name, abfrage(name, query));
  return { reservations: liste(name, daten, 'reservations', reservierung), nextCursor: naechsterCursor(name, daten) };
}

/** Alle Reservierungen der Abfrage, Seite fuer Seite ueber `nextCursor`. */
export function iterateReservations(
  transport: InternerTransport,
  query?: ReservationListQuery,
): AsyncGenerator<Reservation, void, undefined> {
  const { cursor, ...rest } = query ?? {};
  return seitenweise('listReservations', cursor, async (c) => {
    const s = await listReservations(transport, { ...rest, cursor: c });
    return { eintraege: s.reservations, nextCursor: s.nextCursor };
  });
}
