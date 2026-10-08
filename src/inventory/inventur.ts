/**
 * Inventur der Lager-API (Lager-Kern Stufe 3): anlegen, zaehlen, Zaehlungen
 * stornieren, pruefen, nachzaehlen, abschliessen, abbrechen, Inventurprotokoll
 * holen; dazu die Listen der Inventuren, Positionen und Zaehlungen.
 *
 * Ablauf: `createStocktake` → `recordStocktakeCount` (beliebig oft, auch von
 * mehreren Geraeten; je Position addiert) → `reviewStocktake` (erst jetzt Soll
 * und Differenz) → bei Bedarf `recountStocktake` und erneut `reviewStocktake`
 * → `closeStocktake` → `getStocktakePdf`. Pruefen und Abschliessen rechnet der
 * Server im Hintergrund: die Antwort traegt den Zwischenstand
 * (`review.complete: false` bzw. `status: 'closing'`), `getStocktake` den
 * Fortgang.
 *
 * **Blind:** vor `review` traegt keine Antwort ein Soll; `blind: false` zeigt
 * beim Zaehlen nur den heutigen Buchbestand (`bookStockNow`), nie das Soll
 * zur Referenzzeit.
 *
 * Rechte wie in Stufe 5b: Lesen mit jedem Schluessel, alles Schreibende (auch
 * Zaehlen) mit dem Konto-Schalter „Lager-API schreiben“ (Test-Schluessel
 * immer), sonst `inventory_api_not_enabled`; Werte und das Protokoll mit
 * Werten nur mit `lagerApi.kosten`.
 *
 * **Vor dem Senden geprueft wird nur, was ohne Netz sicher falsch ist:**
 * `idempotencyKey` (Pflicht bei jedem Schreiben, 1–120 Zeichen), fehlende
 * Kennungen (`stocktakeId`, `articleId`, `countId`, `locationId`), `scope`
 * kein Objekt, eine Menge, die keine Ganzzahl ist (Tausendstel), ein leerer
 * Grund, `items` beim Nachzaehlen leer oder ohne `articleId`,
 * `serialNumbers` keine Liste, `uncountedAsZero` kein Wahrheitswert. Alles
 * Fachliche (Umfang, Stichtag, Seriennummern, Zustand) prueft der Server.
 *
 * **Wiederholen** wie bei jedem Schreiben: nach `outcome: 'unknown'` denselben
 * Aufruf mit **demselben** `idempotencyKey`. Eine Zaehlung wirkt dann genau
 * einmal (das Zaehldokument ist selbst der Nachweis); ein neuer Schluessel
 * zaehlte die Ware ein zweites Mal.
 */

import type { ApiCall, InternerPdfOderDatenTransport, InternerTransport } from '../client/aufrufe.js';
import { abfrage, anfragefehler, kennung, seitenweise } from './endpunkte.js';
import {
  antwortfehler,
  inventur,
  inventurPosition,
  inventurWarnungen,
  inventurZaehlung,
  liste,
  naechsterCursor,
  objekt,
  protokollLink,
  zaehlungMitPosition,
} from './lesen.js';
import { anfrage, ganz, schluessel } from './schreiben.js';
import type {
  CancelStocktakeRequest,
  CloseStocktakeRequest,
  CloseStocktakeResult,
  CreateStocktakeRequest,
  RecordStocktakeCountRequest,
  RecountStocktakeRequest,
  ReviewStocktakeRequest,
  Stocktake,
  StocktakeCount,
  StocktakeCountListQuery,
  StocktakeCountPage,
  StocktakeCountResult,
  StocktakeItem,
  StocktakeItemListQuery,
  StocktakeItemPage,
  StocktakeListQuery,
  StocktakePage,
  StocktakePdf,
  VoidStocktakeCountRequest,
} from './typen.js';

type Params = Record<string, unknown>;

const istObjekt = (w: unknown): w is Params => w !== null && typeof w === 'object' && !Array.isArray(w);

const kopfAus = (name: ApiCall, daten: unknown): Stocktake => inventur({ name, pfad: 'stocktake' }, objekt(daten)?.stocktake);

/** Ein Grund (Storno, Nachzaehlen, Abbruch): nicht leer. Die Laenge prueft der Server. */
function grund(name: ApiCall, w: unknown): void {
  if (typeof w !== 'string' || w.trim() === '') throw anfragefehler(name, 'reason fehlt (Grund mit 1 bis 500 Zeichen)');
}

/** Schreibende Anfrage mit `stocktakeId`: Schluessel und Kennung geprueft, flach wie gesendet. */
function schreibend(name: ApiCall, request: unknown): Params {
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  kennung(name, 'stocktakeId', p.stocktakeId);
  return p;
}

/** Eine Liste unter einer Inventur: `stocktakeId` Pflicht, sonst wie jede Abfrage. */
function abfrageMitInventur(name: ApiCall, query: unknown): Params {
  if (!istObjekt(query)) throw anfragefehler(name, 'Abfrage mit stocktakeId erwartet');
  const p = abfrage(name, query);
  kennung(name, 'stocktakeId', p.stocktakeId);
  return p;
}

// ---- Anlegen und Lesen -------------------------------------------------------------

/**
 * Legt eine Inventur an. Je Standort hoechstens eine offene
 * (`stocktake_location_busy`, `data.stocktakeId` nennt sie); Umfang `groups`
 * bzw. `articles` nur mit bestandsgefuehrten Artikeln (`article_not_tracked`).
 * Jede Inventur beginnt in `counting`.
 */
export async function createStocktake(transport: InternerTransport, request: CreateStocktakeRequest): Promise<Stocktake> {
  const name = 'createStocktake';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  kennung(name, 'locationId', p.locationId);
  if (!istObjekt(p.scope)) throw anfragefehler(name, 'scope fehlt oder ist kein Objekt { type, groupIds?, articleIds? }');
  return kopfAus(name, await transport(name, p));
}

/**
 * Inventuren des Kontos. Ohne `updatedSince` zuletzt geaenderte zuerst; mit
 * `updatedSince` aufsteigend nach `updatedAt` und inklusive (Abgleich: das
 * groesste gesehene `updatedAt` als naechstes `updatedSince`). Filter
 * `status` und `locationId`.
 */
export async function listStocktakes(transport: InternerTransport, query?: StocktakeListQuery): Promise<StocktakePage> {
  const name = 'listStocktakes';
  const daten = await transport(name, abfrage(name, query));
  return { stocktakes: liste(name, daten, 'stocktakes', inventur), nextCursor: naechsterCursor(name, daten) };
}

/** Alle Inventuren der Abfrage, Seite fuer Seite, in der Reihenfolge von [listStocktakes]. */
export function iterateStocktakes(transport: InternerTransport, query?: StocktakeListQuery): AsyncGenerator<Stocktake, void, undefined> {
  const { cursor, ...rest } = query ?? {};
  return seitenweise('listStocktakes', cursor, async (c) => {
    const s = await listStocktakes(transport, { ...rest, cursor: c });
    return { eintraege: s.stocktakes, nextCursor: s.nextCursor };
  });
}

/** Eine Inventur samt `progress.counted` (gezaehlte Positionen). */
export async function getStocktake(transport: InternerTransport, stocktakeId: string): Promise<Stocktake> {
  const name = 'getStocktake';
  return kopfAus(name, await transport(name, { stocktakeId: kennung(name, 'stocktakeId', stocktakeId) }));
}

/** Positionen einer Inventur nach Kennung; `openOnly` = ungezaehlt bzw. in `review` zum Nachzaehlen offen. */
export async function listStocktakeItems(transport: InternerTransport, query: StocktakeItemListQuery): Promise<StocktakeItemPage> {
  const name = 'listStocktakeItems';
  const daten = await transport(name, abfrageMitInventur(name, query));
  return { items: liste(name, daten, 'items', inventurPosition), nextCursor: naechsterCursor(name, daten) };
}

export function iterateStocktakeItems(
  transport: InternerTransport,
  query: StocktakeItemListQuery,
): AsyncGenerator<StocktakeItem, void, undefined> {
  const { cursor, ...rest } = query;
  return seitenweise('listStocktakeItems', cursor, async (c) => {
    const s = await listStocktakeItems(transport, { ...rest, cursor: c });
    return { eintraege: s.items, nextCursor: s.nextCursor };
  });
}

/** Zaehlungen einer Inventur, neueste zuerst, auch stornierte; mit `articleId` nur die des Artikels. */
export async function listStocktakeCounts(transport: InternerTransport, query: StocktakeCountListQuery): Promise<StocktakeCountPage> {
  const name = 'listStocktakeCounts';
  const daten = await transport(name, abfrageMitInventur(name, query));
  return { counts: liste(name, daten, 'counts', inventurZaehlung), nextCursor: naechsterCursor(name, daten) };
}

export function iterateStocktakeCounts(
  transport: InternerTransport,
  query: StocktakeCountListQuery,
): AsyncGenerator<StocktakeCount, void, undefined> {
  const { cursor, ...rest } = query;
  return seitenweise('listStocktakeCounts', cursor, async (c) => {
    const s = await listStocktakeCounts(transport, { ...rest, cursor: c });
    return { eintraege: s.counts, nextCursor: s.nextCursor };
  });
}

// ---- Zaehlen und Stornieren ------------------------------------------------------

/** Pruefung einer Zaehlung vor dem Senden, geteilt mit dem Kassenweg. Paketintern. */
export function zaehlungPruefen(name: ApiCall, p: Params): void {
  kennung(name, 'articleId', p.articleId);
  ganz(name, 'quantity', p.quantity, { pflicht: true });
  if (p.serialNumbers !== undefined && p.serialNumbers !== null && !Array.isArray(p.serialNumbers)) {
    throw anfragefehler(name, 'serialNumbers muss eine Liste sein');
  }
}

/** Pruefung eines Stornos vor dem Senden, geteilt mit dem Kassenweg. Paketintern. */
export function stornoPruefen(name: ApiCall, p: Params): void {
  kennung(name, 'countId', p.countId);
  grund(name, p.reason);
}

/**
 * Eine Zaehlung. Antwort: die Zaehlung und ihre Position danach (Summe der
 * Runde in `item.quantity`). Gezaehlt wird in `counting`, in `review` nur an
 * Positionen, die zum Nachzaehlen frei sind (sonst `stocktake_not_open`).
 */
export async function recordStocktakeCount(transport: InternerTransport, request: RecordStocktakeCountRequest): Promise<StocktakeCountResult> {
  const name = 'recordStocktakeCount';
  const p = schreibend(name, request);
  zaehlungPruefen(name, p);
  return zaehlungMitPosition(name, await transport(name, p));
}

/** Storniert eine Zaehlung mit Grund; die Position wird aus den uebrigen Zaehlungen neu summiert. */
export async function voidStocktakeCount(transport: InternerTransport, request: VoidStocktakeCountRequest): Promise<StocktakeCountResult> {
  const name = 'voidStocktakeCount';
  const p = schreibend(name, request);
  stornoPruefen(name, p);
  return zaehlungMitPosition(name, await transport(name, p));
}

// ---- Pruefen bis Abbruch ------------------------------------------------------------

/**
 * Pruefen: `counting` → `review`, in `review` neu rechnen (nach dem
 * Nachzaehlen). Die Antwort kommt sofort mit `review.complete: false`; Soll
 * und Differenz stehen an den Positionen, sobald `complete` `true` ist.
 */
export async function reviewStocktake(transport: InternerTransport, request: ReviewStocktakeRequest): Promise<Stocktake> {
  const name = 'reviewStocktake';
  return kopfAus(name, await transport(name, schreibend(name, request)));
}

/** Nachzaehlen: je genannter Position eine neue Runde; danach zaehlen und erneut [reviewStocktake]. */
export async function recountStocktake(transport: InternerTransport, request: RecountStocktakeRequest): Promise<Stocktake> {
  const name = 'recountStocktake';
  const p = schreibend(name, request);
  if (!Array.isArray(p.items) || p.items.length === 0) throw anfragefehler(name, 'items fehlt oder ist leer');
  p.items.forEach((x, i) => {
    if (!istObjekt(x)) throw anfragefehler(name, `items[${i}] muss ein Objekt sein`);
    kennung(name, `items[${i}].articleId`, x.articleId);
  });
  grund(name, p.reason);
  return kopfAus(name, await transport(name, p));
}

/**
 * Abschliessen (nur aus `review`, sonst `stocktake_not_in_review`; offene
 * Nachzaehlungen ergeben `stocktake_recount_open`). Der Server bucht in
 * Teilen weiter; die Antwort traegt meist `status: 'closing'`. Ein erneuter
 * Aufruf waehrend `closing` stoesst den Abschluss wieder an.
 */
export async function closeStocktake(transport: InternerTransport, request: CloseStocktakeRequest): Promise<CloseStocktakeResult> {
  const name = 'closeStocktake';
  const p = schreibend(name, request);
  if (p.uncountedAsZero !== undefined && typeof p.uncountedAsZero !== 'boolean') {
    throw anfragefehler(name, 'uncountedAsZero muss true oder false sein');
  }
  const daten = await transport(name, p);
  return { stocktake: kopfAus(name, daten), warnings: inventurWarnungen({ name, pfad: 'warnings' }, objekt(daten)?.warnings) };
}

/** Abbrechen mit Grund (aus `counting` oder `review`); der Standort ist danach frei. */
export async function cancelStocktake(transport: InternerTransport, request: CancelStocktakeRequest): Promise<Stocktake> {
  const name = 'cancelStocktake';
  const p = schreibend(name, request);
  grund(name, p.reason);
  return kopfAus(name, await transport(name, p));
}

// ---- Protokoll ------------------------------------------------------------------

/**
 * Das Inventurprotokoll (PDF), erst nach dem Abschluss (`stocktake_not_closed`,
 * auch fuer eine abgebrochene Inventur). Mit `lagerApi.kosten` die Fassung mit
 * Werten, sonst die nur mit Mengen. Bis 9 MiB kommt die Datei selbst
 * (`kind: 'pdf'`), darueber ein signierter Lese-Link fuer 15 Minuten
 * (`kind: 'download'`); die geladene Datei an `download.sha256` pruefen.
 */
export async function getStocktakePdf(transport: InternerPdfOderDatenTransport, stocktakeId: string): Promise<StocktakePdf> {
  const name = 'getStocktakePdf';
  const ergebnis = await transport(name, { stocktakeId: kennung(name, 'stocktakeId', stocktakeId) });
  if ('pdf' in ergebnis) return { kind: 'pdf', pdf: ergebnis.pdf };
  const link = objekt(ergebnis.data)?.download;
  if (link === undefined || link === null) throw antwortfehler(name, 'Antwort ist weder ein PDF noch ein Lese-Link (data.download fehlt)');
  return { kind: 'download', download: protokollLink(name, link) };
}
