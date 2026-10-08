import type { ApiCall, InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import { stornoPruefen, zaehlungPruefen } from '../inventory/inventur.js';
import { inventur, inventurPosition, inventurZaehlung, liste, naechsterCursor, zaehlungMitPosition } from '../inventory/lesen.js';
import { anfrage, schluessel } from '../inventory/schreiben.js';
import type {
  Stocktake,
  StocktakeCountPage,
  StocktakeCountResult,
  StocktakeItemPage,
} from '../inventory/typen.js';
import type { StockCondition, StocktakeStatus } from '../inventory/vertrag.js';
import { quantityRuleForUnit, type QuantityRule } from './artikel.js';

/**
 * Inventur zaehlen an der Kasse (Lager-Kern Stufe 3, Backend
 * inventur-endpoints.js): offene Inventuren des Standorts, ihre Positionen und
 * Zaehlungen lesen, zaehlen und eine Zaehlung stornieren. Alle fuenf Aufrufe
 * gibt es nur ueber den Kassenweg `/api/v3`.
 *
 * Rechte am Server: `stocktakeCount` (zaehlen, eigene Zaehlungen stornieren,
 * lesen) bzw. `stocktakeClose` (auch fremde Zaehlungen stornieren und ab der
 * Pruefung das Soll sehen). Kassen-Benutzer sehen in [listMyStocktakes] nur
 * Inventuren in `counting` und solche in `review` mit offenem Nachzaehlen.
 * Anlegen, Pruefen und Abschliessen gibt es an der Kasse nicht.
 *
 * Gezaehlt wird nur online: die Serverzeit ist die Referenzzeit. Bei unklarem
 * Ausgang (`outcome: 'unknown'`) dieselbe Zaehlung mit **demselben**
 * `idempotencyKey` erneut senden; sie wirkt genau einmal.
 *
 * Die Modelle sind dieselben wie in `./inventory` (`Stocktake`,
 * `StocktakeItem`, `StocktakeCount`); Mengen in Tausendstel.
 */

export interface ListMyStocktakesOptions {
  /** Nur dieser Standort; `''` gilt wie nicht angegeben. */
  locationId?: string;
  /** Nur dieser Stand. */
  status?: StocktakeStatus;
}

export interface ListMyStocktakeItemsOptions {
  stocktakeId: string;
  /** Nur ungezaehlte Positionen (in der Pruefung: die zum Nachzaehlen). */
  openOnly?: boolean;
  limit?: number;
  cursor?: string;
}

export interface ListMyStocktakeCountsOptions {
  stocktakeId: string;
  articleId?: string;
  /** Nur die eigenen Zaehlungen. */
  ownOnly?: boolean;
  limit?: number;
  cursor?: string;
}

export interface RecordMyStocktakeCountOptions {
  /** Bei „Erneut senden“ derselbe Schluessel wie beim ersten Versuch. */
  idempotencyKey: string;
  stocktakeId: string;
  articleId: string;
  /** Vorgabe `sellable`. */
  condition?: StockCondition;
  /** Tausendstel, aus der Eingabe mit [parseQuantityMilli]; `0` = leer gezaehlt. */
  quantity: number;
  /** Einzelstueck: je Stueck genau eine Seriennummer. */
  serialNumbers?: string[];
  /** Hoechstens 200 Zeichen. */
  note?: string | null;
  /** Ohne Angabe gilt die Kasse der Anmeldung (`registerUserAuth`). */
  cashregisterId?: string;
}

export interface VoidMyStocktakeCountOptions {
  idempotencyKey: string;
  stocktakeId: string;
  countId: string;
  /** 1–500 Zeichen. */
  reason: string;
}

type Params = Record<string, unknown>;

function anfragefehler(name: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, grund, 'request');
}

/** Eine Kennung, die gesendet werden muss. */
function kennung(name: string, feld: string, w: unknown): string {
  if (typeof w !== 'string' || w.trim() === '') throw anfragefehler(name, `${feld} fehlt`);
  return w;
}

/** Die Optionen flach, ohne `undefined`; Pflichtkennung `stocktakeId`. */
function mitInventur(name: ApiCall, options: unknown): Params {
  const p = anfrage(name, options);
  kennung(name, 'stocktakeId', p.stocktakeId);
  return p;
}

/** Offene Inventuren (fuer Kassen-Benutzer nur `counting` und `review` mit offenem Nachzaehlen). */
export async function listMyStocktakes(transport: InternerTransport, options: ListMyStocktakesOptions = {}): Promise<Stocktake[]> {
  const name = 'listMyStocktakes';
  const p = anfrage(name, options);
  if (p.locationId === '') delete p.locationId;
  const daten = await transport(name, p);
  return liste(name, daten, 'stocktakes', inventur);
}

/** Positionen einer Inventur; ab der Pruefung mit Soll nur mit dem Recht `stocktakeClose`. */
export async function listMyStocktakeItems(transport: InternerTransport, options: ListMyStocktakeItemsOptions): Promise<StocktakeItemPage> {
  const name = 'listMyStocktakeItems';
  const daten = await transport(name, mitInventur(name, options));
  return { items: liste(name, daten, 'items', inventurPosition), nextCursor: naechsterCursor(name, daten) };
}

/** Zaehlungen einer Inventur, neueste zuerst; `ownOnly` nur die eigenen. */
export async function listMyStocktakeCounts(transport: InternerTransport, options: ListMyStocktakeCountsOptions): Promise<StocktakeCountPage> {
  const name = 'listMyStocktakeCounts';
  const daten = await transport(name, mitInventur(name, options));
  return { counts: liste(name, daten, 'counts', inventurZaehlung), nextCursor: naechsterCursor(name, daten) };
}

/** Eine Zaehlung; Antwort: die Zaehlung und die Position danach (Ist-Summe, kein Soll). */
export async function recordMyStocktakeCount(transport: InternerTransport, options: RecordMyStocktakeCountOptions): Promise<StocktakeCountResult> {
  const name = 'recordMyStocktakeCount';
  const p = mitInventur(name, options);
  schluessel(name, p, { pflicht: true });
  zaehlungPruefen(name, p);
  if (p.cashregisterId !== undefined) kennung(name, 'cashregisterId', p.cashregisterId);
  return zaehlungMitPosition(name, await transport(name, p));
}

/** Storniert eine Zaehlung mit Grund (fremde nur mit dem Recht `stocktakeClose`). */
export async function voidMyStocktakeCount(transport: InternerTransport, options: VoidMyStocktakeCountOptions): Promise<StocktakeCountResult> {
  const name = 'voidMyStocktakeCount';
  const p = mitInventur(name, options);
  schluessel(name, p, { pflicht: true });
  stornoPruefen(name, p);
  return zaehlungMitPosition(name, await transport(name, p));
}

/** Tausendstel je Einheit: drei Nachkommastellen, wie die Mengen am Draht. */
const STELLEN = 3;

/**
 * Eine eingetippte Menge in Tausendstel der Basiseinheit, **ohne Gleitkomma**:
 * `'12'` → `12000`, `'0,25'` → `250`, `'1.5'` → `1500`.
 *
 * - Dezimaltrenner Komma oder Punkt, hoechstens drei Nachkommastellen; weitere
 *   Nullen am Ende zaehlen nicht (`'1,2340'` → `1234`). `'0'` ist eine gueltige
 *   Menge (leer gezaehlt).
 * - **Punkt mit genau drei Ziffern danach und einem Ganzteil ungleich 0**
 *   (`'1.000'`, `'12.500'`) ist bei jeder Einheit `null`: in oesterreichischer
 *   Schreibweise ist das ein Tausenderpunkt („tausend“), am Ziffernblock ein
 *   Dezimalpunkt („eins“); ein Faktor 1000 buchte der Abschluss als Differenz.
 *   Mit Komma ist es eindeutig (`'1,000'` → `1000`), ebenso `'0.500'`,
 *   `'1.5'`, `'1.25'`.
 * - **Stueckware** nur als ganze Zahl ohne Trenner. Stueckware ist, was
 *   `rule` sagt (die gespeicherte Mengenregel des Artikels,
 *   `PosArticle.quantityRule`, `'piece'` | `'decimal'`), ohne `rule` die
 *   Vorgabe der Einheit (`quantityRuleForUnit`: Stk, g, ml …, auch ohne
 *   Einheit). Einzelstuecke (Seriennummer) sind immer Stueckware: dann
 *   `'piece'` uebergeben.
 *
 * `null` auch fuer: leer, Vorzeichen, Tausenderleerzeichen, Exponent, mehr als
 * drei Nachkommastellen, groesser als eine sichere Ganzzahl. Die Kasse zeigt
 * dann ihren Satz (`stocktake.quantity_invalid`), statt still zu runden.
 * Gemeinsame Prueffaelle mit dem Dart-Zwilling:
 * `fixtures/stocktake-quantity-cases.json`.
 */
export function parseQuantityMilli(text: string, unit?: string | null, rule?: QuantityRule | null): number | null {
  if (typeof text !== 'string') return null;
  const m = /^(\d*)(?:([.,])(\d*))?$/.exec(text.trim());
  if (!m) return null;
  const ganz = m[1] ?? '';
  const trenner = m[2];
  const roh = m[3] ?? '';
  if (ganz === '' && roh === '') return null;
  const stueck = (rule === 'piece' || rule === 'decimal' ? rule : quantityRuleForUnit(unit).rule) === 'piece';
  if (trenner !== undefined && stueck) return null;
  if (trenner === '.' && roh.length === 3 && /[1-9]/.test(ganz)) return null;
  const nachkomma = roh.replace(/0+$/, '');
  if (nachkomma.length > STELLEN) return null;
  const milli = BigInt(ganz === '' ? '0' : ganz) * 1000n + BigInt(nachkomma.padEnd(STELLEN, '0'));
  return milli <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(milli) : null;
}
