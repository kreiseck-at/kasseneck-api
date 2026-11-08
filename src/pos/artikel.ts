import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import { fromReferencePayload, type PosReference } from './kachel-referenz.js';
import { depositEntriesFromWire, type DepositEntry } from './pfand.js';
import { isArticleExternalVoucher, type ArticleExternalVoucher } from './fremdgutschein-artikel.js';

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
  /**
   * Zusaetze der Gruppe (Zusatz-Kacheln, 1.27.0): Artikel-Kennungen in der
   * Reihenfolge des Fensters; null = keine. Optional, damit bestehende Literale
   * weiter uebersetzen; der Leser setzt das Feld immer. Wirksam wird die Liste
   * erst ueber [addOnsFor].
   */
  addOns?: string[] | null;
  /**
   * Pfand der Gruppe (Pfand & Leergut): gilt fuer Artikel ohne eigene Liste; null = keines.
   * Optional wie `addOns`, der Leser setzt es immer.
   */
  deposits?: DepositEntry[] | null;
}

export interface ArticleGroupPayload {
  id?: string | null; name?: string | null; color?: string | null; symbol?: string | null;
  sort?: number | null; vatRate?: number | null; addOns?: unknown; deposits?: unknown;
}

/** Zusatzliste am Draht: nur eine Liste von Texten zaehlt, sonst null. Paketintern. */
export function addOnListe(wert: unknown): string[] | null {
  return Array.isArray(wert) ? wert.filter((s): s is string => typeof s === 'string' && s !== '') : null;
}

export function fromArticleGroupPayload(p: ArticleGroupPayload): ArticleGroup {
  return {
    id: p.id ?? '',
    name: p.name ?? '',
    color: p.color ?? '#6B7280',
    symbol: p.symbol ?? null,
    sort: typeof p.sort === 'number' ? p.sort : 0,
    vatRate: typeof p.vatRate === 'number' ? p.vatRate : null,
    addOns: addOnListe(p.addOns),
    deposits: depositEntriesFromWire(p.deposits),
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
  /**
   * Standorte, an denen der Artikel gefuehrt wird (Lager-Kern Stufe 2, innen
   * `standorte`); `null`, wenn der Artikel keine Angabe traegt. Wie die Kasse
   * daraus Kacheln filtert, entscheidet die Oberflaeche. Optional, damit
   * bestehende Literale von Verbrauchern weiter uebersetzen; der Leser
   * (`fromPosArticlePayload`) setzt das Feld immer (`null` oder Liste).
   */
  stockLocationIds?: string[] | null;
  /**
   * Artikelnummer des Betriebs; null = keine. Diese und die drei folgenden
   * Felder (Scanner-Suche, Lager) sind optional wie `stockLocationIds`, der
   * Leser setzt sie immer. Texte kommen unveraendert durch (fuehrende Nullen,
   * Schreibweise); nur ein leerer Text (auch reiner Leerraum) wird `null`.
   */
  number?: string | null;
  /** EAN/GTIN, wie gespeichert; null = keine. */
  ean?: string | null;
  /** Interner Code des Betriebs (eigener Barcode/QR); null = keiner. */
  internalCode?: string | null;
  /**
   * Bestandsgefuehrt (Lager-Modul). `null`, wenn die Antwort keine Angabe
   * traegt (aeltere Backends) -- dann nicht aus anderen Feldern ableiten.
   */
  stockTracked?: boolean | null;
  /**
   * Als Leistungsgutschein verkaufbar (Gutscheine Stufe 4b, Haken im
   * Artikelstamm). Die Kachel „Leistungsgutschein“ bietet nur diese Artikel
   * an; der Server verkauft einen anderen nicht (`voucher_service_not_allowed`).
   * Optional wie `stockLocationIds`, der Leser setzt es immer: nur ein
   * ausdrueckliches `true` gilt.
   */
  serviceVoucher?: boolean;
  /**
   * Kasse fragt beim Antippen den Betrag (Kachel mit Betrag und Referenz,
   * 1.26.0); ein vorhandener Preis ist Vorschlag. Optional wie
   * `serviceVoucher`, der Leser setzt es immer: nur ein ausdrueckliches `true` gilt.
   */
  askPrice?: boolean;
  /** Kasse fragt beim Antippen eine Referenz ab; null = aus. Der Leser setzt es immer. */
  reference?: PosReference | null;
  /**
   * Eigene Zusatzliste (Zusatz-Kacheln, 1.27.0): null = wie die Gruppe, [] =
   * keine, sonst die Liste in der Reihenfolge des Fensters. Der Leser setzt es
   * immer; wirksam wird es ueber [addOnsFor].
   */
  addOns?: string[] | null;
  /**
   * Kachel verkauft einen fremden Gutschein (1.31.0): `multi_purpose` =
   * Wertgutschein, `single_purpose` = Leistungsgutschein mit dem Satz des
   * Artikels; null = normaler Artikel. Die Kasse fragt die Gutscheinnummer ab
   * und sendet einen `vouchers[]`-Eintrag statt einer Position; sperren ueber
   * [externalVoucherTileBlock]. Vor `stockTracked` werten (ein Fremdgutschein
   * fuehrt nie Bestand). Optional wie `addOns`, der Leser setzt es immer; ein
   * unbekannter Wert wird null.
   */
  externalVoucher?: ArticleExternalVoucher | null;
  /**
   * Pfand des Artikels (Pfand & Leergut): `null` = keine eigene Angabe (die Gruppe gilt), `[]` = ausdruecklich
   * ohne Pfand, sonst die Eintraege. Der Server setzt die Pfandzeilen am Beleg daraus (`autoDeposits`). Optional wie
   * `addOns`, der Leser setzt es immer.
   */
  deposits?: DepositEntry[] | null;
}

/**
 * Kann die Kachel gebucht werden? Mit festem Preis immer, ohne Preis nur mit
 * `askPrice` (der Betrag kommt aus dem Eingabeblatt).
 */
export function isBookableArticle(a: Pick<PosArticle, 'unitPriceCents' | 'askPrice'>): boolean {
  return a.askPrice === true || (typeof a.unitPriceCents === 'number' && Number.isInteger(a.unitPriceCents) && a.unitPriceCents >= 0);
}

/** Fragt die Kachel beim Antippen etwas ab (Betrag, Referenz oder Menge)? */
export function tilePrompts(a: Pick<PosArticle, 'askPrice' | 'reference' | 'unit' | 'quantityRule' | 'askQuantity'>): { amount: boolean; reference: boolean; quantity: boolean } {
  return { amount: a.askPrice === true, reference: a.reference != null, quantity: quantityDefaults(a).ask };
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
  stockLocationIds?: string[] | null;
  number?: string | null; ean?: string | null; internalCode?: string | null; stockTracked?: boolean | null;
  serviceVoucher?: boolean | null;
  askPrice?: boolean | null;
  reference?: unknown;
  addOns?: unknown;
  externalVoucher?: unknown;
  deposits?: unknown;
}

/** Ein Text mit Inhalt, unveraendert; leer, nur Leerraum oder kein Text -> null. */
function textOderNull(wert: unknown): string | null {
  return typeof wert === 'string' && wert.trim() !== '' ? wert : null;
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
    stockLocationIds: Array.isArray(p.stockLocationIds)
      ? p.stockLocationIds.filter((s): s is string => typeof s === 'string' && s !== '')
      : null,
    number: textOderNull(p.number),
    ean: textOderNull(p.ean),
    internalCode: textOderNull(p.internalCode),
    stockTracked: typeof p.stockTracked === 'boolean' ? p.stockTracked : null,
    serviceVoucher: p.serviceVoucher === true,
    askPrice: p.askPrice === true,
    reference: fromReferencePayload(p.reference),
    addOns: addOnListe(p.addOns),
    externalVoucher: isArticleExternalVoucher(p.externalVoucher) ? p.externalVoucher : null,
    deposits: depositEntriesFromWire(p.deposits),
  };
}

/**
 * Die Liste `data.<feld>` einer Antwort, jedes Element durch `lesen` (mit
 * seinem Index fuer Fehlermeldungen). Paketintern: auch `lager.ts` liest so.
 */
export function liste<T>(daten: unknown, feld: string, name: string, lesen: (e: unknown, index: number) => T): T[] {
  const roh = (daten as Record<string, unknown> | null | undefined)?.[feld];
  if (!Array.isArray(roh)) {
    const grund = roh === undefined || roh === null
      ? `Antwort enthaelt keine Liste (data.${feld} fehlt)`
      : `Antwort ist unbrauchbar (data.${feld} ist keine Liste)`;
    throw new KasseneckValidationError(name, grund, 'response');
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
