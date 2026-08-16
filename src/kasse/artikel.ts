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

/**
 * Mengenregel eines Artikels: `stueck` = ganze Stueck (1, 2, 3 ...),
 * `dezimal` = Kommamenge in der Einheit (0,250 kg, 1,5 m). Beleg und DEP
 * bleiben ganzzahlig: eine Kommamenge wird an der Kasse als EINE Position mit
 * ausgerechnetem Betrag gebucht, die Bezeichnung traegt die Menge
 * („Wurst 0,250 kg“). Siehe [mengenregelFuerEinheit] fuer die Vorgabe je Einheit.
 */
export type Mengenregel = 'stueck' | 'dezimal';

export interface MengenVorgabe {
  regel: Mengenregel;
  /** Kasse fragt beim Antippen nach der Menge (Wurst nach Gewicht: ja; Semmel: nein). */
  fragen: boolean;
  /** Nachkommastellen bei `dezimal`. */
  stellen: number;
}

/** Einheiten, die nach Menge verkauft werden (Kommazahl, Kasse fragt). */
const DEZIMAL_EINHEITEN: Readonly<Record<string, number>> = {
  kg: 3, g: 0, l: 2, ml: 0, m: 2, lfm: 2, km: 1, 'm²': 2, m2: 2, 'm³': 3, m3: 3, std: 2, h: 2, min: 0, t: 3,
};

/** Vorgabe je Einheit -- was der Betrieb bei einem neuen Artikel bekommt und aendern darf. */
export function mengenregelFuerEinheit(unit: string | null | undefined): MengenVorgabe {
  const u = (unit ?? '').trim().toLowerCase();
  if (u in DEZIMAL_EINHEITEN) {
    const stellen = DEZIMAL_EINHEITEN[u]!;
    return stellen === 0
      ? { regel: 'stueck', fragen: true, stellen: 0 }   // g, ml, min: ganze Zahl, aber die Menge wird gefragt
      : { regel: 'dezimal', fragen: true, stellen };
  }
  return { regel: 'stueck', fragen: false, stellen: 0 };
}

/** Wirksame Regel eines Artikels: gespeicherte Angabe schlaegt die Vorgabe der Einheit. */
export function mengenVorgabe(a: Pick<KasseArtikel, 'unit' | 'mengenregel' | 'mengeFragen'>): MengenVorgabe {
  const v = mengenregelFuerEinheit(a.unit);
  return {
    regel: a.mengenregel ?? v.regel,
    fragen: a.mengeFragen ?? v.fragen,
    stellen: (a.mengenregel ?? v.regel) === 'dezimal' ? Math.max(1, v.stellen || 2) : 0,
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
  /** Gespeicherte Mengenregel; null = Vorgabe der Einheit. */
  mengenregel: Mengenregel | null;
  /** Gespeichert: Kasse fragt nach der Menge; null = Vorgabe der Einheit. */
  mengeFragen: boolean | null;
  /** Hoechstmenge je Beleg; null = keine Grenze. */
  maxMenge: number | null;
}

/** Deckelt eine gewuenschte Menge an der Hoechstmenge des Artikels (null = keine Grenze). */
export function mengeErlaubt(a: Pick<KasseArtikel, 'maxMenge'>, gewuenscht: number): number {
  return a.maxMenge != null && a.maxMenge > 0 ? Math.min(gewuenscht, a.maxMenge) : gewuenscht;
}

export interface KasseArtikelPayload {
  id?: string | null; name?: string | null; unitPriceCents?: number | null; vatRate?: number | null; unit?: string | null;
  groupId?: string | null; kasse?: { sichtbar?: boolean | null; sort?: number | null } | null; active?: boolean | null;
  mengenregel?: string | null; mengeFragen?: boolean | null; maxMenge?: number | null;
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
    mengenregel: p.mengenregel === 'stueck' || p.mengenregel === 'dezimal' ? p.mengenregel : null,
    mengeFragen: typeof p.mengeFragen === 'boolean' ? p.mengeFragen : null,
    maxMenge: Number.isInteger(p.maxMenge) && (p.maxMenge as number) > 0 ? (p.maxMenge as number) : null,
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
