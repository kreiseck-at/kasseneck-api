import type { KasseneckTransport } from '../client/transport.js';
import { KasseneckValidationError } from '../client/errors.js';

/**
 * Artikelgruppen (Kategorien der Kachel-Kasse) und Artikel in der Form, die
 * die Kacheln brauchen — Backend: `article-endpoints.js`
 * (`listMyArticleGroups`, `listMyArticles` mit `groupId`/`kasse`).
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

/** Artikel, wie ihn die Kasse fuer Kacheln und Belegpositionen braucht. */
export interface KasseArtikel {
  id: string;
  name: string;
  unitPriceCents: number | null;
  vatRate: number | null;
  unit: string;
  groupId: string | null;
  sichtbar: boolean;
  sort: number;
  active: boolean;
}

export interface KasseArtikelPayload {
  id?: string | null; name?: string | null; unitPriceCents?: number | null; vatRate?: number | null; unit?: string | null;
  groupId?: string | null; kasse?: { sichtbar?: boolean | null; sort?: number | null } | null; active?: boolean | null;
}

export function fromKasseArtikelPayload(p: KasseArtikelPayload): KasseArtikel {
  return {
    id: p.id ?? '',
    name: p.name ?? '',
    unitPriceCents: typeof p.unitPriceCents === 'number' ? p.unitPriceCents : null,
    vatRate: typeof p.vatRate === 'number' ? p.vatRate : null,
    unit: p.unit ?? '',
    groupId: p.groupId ?? null,
    sichtbar: p.kasse?.sichtbar !== false,
    sort: typeof p.kasse?.sort === 'number' ? p.kasse.sort : 0,
    active: p.active !== false,
  };
}

function liste<T>(daten: unknown, feld: string, name: string, lesen: (e: unknown) => T): T[] {
  const roh = (daten as Record<string, unknown> | null | undefined)?.[feld];
  if (!Array.isArray(roh)) {
    throw new KasseneckValidationError(name, `Antwort enthaelt keine Liste (data.${feld} fehlt)`, 'response');
  }
  return roh.map((e) => lesen(typeof e === 'object' && e !== null ? e : {}));
}

export async function listMyArticleGroups(rufen: KasseneckTransport): Promise<ArticleGroup[]> {
  const daten = await rufen<{ groups?: unknown }>('listMyArticleGroups');
  return liste(daten, 'groups', 'listMyArticleGroups', (e) => fromArticleGroupPayload(e as ArticleGroupPayload));
}

export async function listMyArticles(rufen: KasseneckTransport): Promise<KasseArtikel[]> {
  const daten = await rufen<{ articles?: unknown }>('listMyArticles');
  return liste(daten, 'articles', 'listMyArticles', (e) => fromKasseArtikelPayload(e as KasseArtikelPayload));
}
