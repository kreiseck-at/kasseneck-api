import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';

/**
 * Artikelgruppen (Kategorien der Kachel-Kasse) und Artikel in der Form, die
 * die Kacheln brauchen, Backend: `article-endpoints.js`
 * (`listMyArticleGroups`, `listMyArticles` mit `groupId`/`tile`).
 */

export interface ArticleGroup {
  id: string;
  name: string;
  /** #RRGGBB */
  color: string;
  /** Kategorie-Symbol (Emoji, hoechstens zwei Zeichen) oder null. */
  symbol: string | null;
  sort: number;
  vatRate: number | null;
}

export interface ArticleGroupPayload {
  id?: string | null; name?: string | null; color?: string | null; symbol?: string | null;
  sort?: number | null; vatRate?: number | null;
}

export function fromArticleGroupPayload(p: ArticleGroupPayload): ArticleGroup {
  return {
    id: p.id ?? '',
    name: p.name ?? '',
    color: p.color ?? '#6B7280',
    symbol: p.symbol ?? null,
    sort: typeof p.sort === 'number' ? p.sort : 0,
    vatRate: typeof p.vatRate === 'number' ? p.vatRate : null,
  };
}

/**
 * Mengenregel eines Artikels (Draht `quantityRule`): `piece` = ganze Stueck
 * (1, 2, 3 ...), `decimal` = Kommamenge in der Einheit (0,250 kg, 1,5 m).
 * Beleg und DEP bleiben ganzzahlig: eine Kommamenge wird an der Kasse als EINE
 * Position mit ausgerechnetem Betrag gebucht, die Bezeichnung traegt die Menge
 * („Wurst 0,250 kg“). Siehe [quantityRuleForUnit] fuer die Vorgabe je Einheit.
 */
export const QUANTITY_RULES = ['piece', 'decimal'] as const;
export type QuantityRule = typeof QUANTITY_RULES[number];

export interface QuantityDefaults {
  rule: QuantityRule;
  /** Kasse fragt beim Antippen nach der Menge (Wurst nach Gewicht: ja; Semmel: nein). */
  ask: boolean;
  /** Nachkommastellen bei `decimal`. */
  decimals: number;
}

/** Einheiten, die nach Menge verkauft werden (Kommazahl, Kasse fragt). */
const DEZIMAL_EINHEITEN: Readonly<Record<string, number>> = {
  kg: 3, g: 0, l: 2, ml: 0, m: 2, lfm: 2, km: 1, 'm²': 2, m2: 2, 'm³': 3, m3: 3, std: 2, h: 2, min: 0, t: 3,
};

/** Vorgabe je Einheit: was der Betrieb bei einem neuen Artikel bekommt und aendern darf. */
export function quantityRuleForUnit(unit: string | null | undefined): QuantityDefaults {
  const u = (unit ?? '').trim().toLowerCase();
  if (u in DEZIMAL_EINHEITEN) {
    const stellen = DEZIMAL_EINHEITEN[u]!;
    return stellen === 0
      ? { rule: 'piece', ask: true, decimals: 0 }   // g, ml, min: ganze Zahl, aber die Menge wird gefragt
      : { rule: 'decimal', ask: true, decimals: stellen };
  }
  return { rule: 'piece', ask: false, decimals: 0 };
}

/** Wirksame Regel eines Artikels: gespeicherte Angabe schlaegt die Vorgabe der Einheit. */
export function quantityDefaults(a: Pick<PosArticle, 'unit' | 'quantityRule' | 'askQuantity'>): QuantityDefaults {
  const v = quantityRuleForUnit(a.unit);
  return {
    rule: a.quantityRule ?? v.rule,
    ask: a.askQuantity ?? v.ask,
    decimals: (a.quantityRule ?? v.rule) === 'decimal' ? Math.max(1, v.decimals || 2) : 0,
  };
}

/** Artikel, wie ihn die Kasse fuer Kacheln und Belegpositionen braucht. */
export interface PosArticle {
  id: string;
  name: string;
  unitPriceCents: number | null;
  vatRate: number | null;
  unit: string;
  groupId: string | null;
  /** Erloesgruppe (Buchhaltung); null = keine. */
  revenueGroupId: string | null;
  /** Kachel sichtbar (Draht `tile.visible`, fehlt = sichtbar). */
  visible: boolean;
  /** Reihenfolge der Kachel (Draht `tile.sort`). */
  sort: number;
  active: boolean;
  /** Gespeicherte Mengenregel; null = Vorgabe der Einheit. */
  quantityRule: QuantityRule | null;
  /** Gespeichert: Kasse fragt nach der Menge; null = Vorgabe der Einheit. */
  askQuantity: boolean | null;
  /** Hoechstmenge je Beleg (bei kg/l/m auch Kommazahl); null = keine Grenze. */
  maxQuantity: number | null;
}

/** Deckelt eine gewuenschte Menge an der Hoechstmenge des Artikels (null = keine Grenze). */
export function allowedQuantity(a: Pick<PosArticle, 'maxQuantity'>, wanted: number): number {
  return a.maxQuantity != null && a.maxQuantity > 0 ? Math.min(wanted, a.maxQuantity) : wanted;
}

/** Ein Artikel am Draht `/api/v3` (`listMyArticles`), soweit dieses Paket ihn liest. */
export interface PosArticlePayload {
  id?: string | null; name?: string | null; unitPriceCents?: number | null; vatRate?: number | null; unit?: string | null;
  groupId?: string | null; revenueGroupId?: string | null;
  tile?: { visible?: boolean | null; sort?: number | null } | null; active?: boolean | null;
  quantityRule?: string | null; askQuantity?: boolean | null; maxQuantity?: number | null;
}

export function fromPosArticlePayload(p: PosArticlePayload): PosArticle {
  return {
    id: p.id ?? '',
    name: p.name ?? '',
    unitPriceCents: typeof p.unitPriceCents === 'number' ? p.unitPriceCents : null,
    vatRate: typeof p.vatRate === 'number' ? p.vatRate : null,
    unit: p.unit ?? '',
    groupId: p.groupId ?? null,
    revenueGroupId: typeof p.revenueGroupId === 'string' && p.revenueGroupId ? p.revenueGroupId : null,
    visible: p.tile?.visible !== false,
    sort: typeof p.tile?.sort === 'number' ? p.tile.sort : 0,
    active: p.active !== false,
    quantityRule: p.quantityRule === 'piece' || p.quantityRule === 'decimal' ? p.quantityRule : null,
    askQuantity: typeof p.askQuantity === 'boolean' ? p.askQuantity : null,
    maxQuantity: typeof p.maxQuantity === 'number' && Number.isFinite(p.maxQuantity) && p.maxQuantity > 0 ? p.maxQuantity : null,
  };
}

/**
 * Die Liste `data.<feld>` einer Antwort, jedes Element durch `lesen` (mit
 * seinem Index fuer Fehlermeldungen). Paketintern: auch `lager.ts` liest so.
 */
export function liste<T>(daten: unknown, feld: string, name: string, lesen: (e: unknown, index: number) => T): T[] {
  const roh = (daten as Record<string, unknown> | null | undefined)?.[feld];
  if (!Array.isArray(roh)) {
    throw new KasseneckValidationError(name, `Antwort enthaelt keine Liste (data.${feld} fehlt)`, 'response');
  }
  return roh.map((e, i) => lesen(typeof e === 'object' && e !== null ? e : {}, i));
}

export async function listMyArticleGroups(transport: InternerTransport): Promise<ArticleGroup[]> {
  const daten = await transport<{ groups?: unknown }>('listMyArticleGroups');
  return liste(daten, 'groups', 'listMyArticleGroups', (e) => fromArticleGroupPayload(e as ArticleGroupPayload));
}

export async function listMyArticles(transport: InternerTransport): Promise<PosArticle[]> {
  const daten = await transport<{ articles?: unknown }>('listMyArticles');
  return liste(daten, 'articles', 'listMyArticles', (e) => fromPosArticlePayload(e as PosArticlePayload));
}
