import type { ArticleGroup, PosArticle } from './artikel.js';

/**
 * Zusatz-Kacheln (1.27.0): Tippt man eine Hauptleistung an, oeffnet die Kasse
 * ein Fenster mit ihren Zusaetzen. Die Liste steht an der Gruppe, je Artikel
 * abweichend (`addOns`: null = wie die Gruppe, [] = keine, sonst eigene Liste).
 * Jeder Zusatz wird eine eigene Belegposition mit `addOnOf` = Index der
 * Hauptposition. Die Regeln rechnen Backend (`gemeinsam/zusatz-core.js`), npm
 * und Dart gleich; der Vertrag sind die Pruefaelle `fixtures/add-on-cases.json`.
 */

/** Hoechstens so viele Zusaetze je Liste (der Server weist mehr ab). */
export const ADD_ONS_MAX = 30;

/** Warum ein Artikel kein Zusatz sein kann (Panel zeigt den Grund an). */
export const ADD_ON_BLOCK_REASONS = ['inactive', 'own_list', 'asks_price', 'reference', 'asks_quantity', 'no_price', 'service_voucher', 'external_voucher'] as const;
export type AddOnBlockReason = typeof ADD_ON_BLOCK_REASONS[number];

type ZusatzArtikel = Pick<PosArticle, 'id' | 'active' | 'unitPriceCents'> & Partial<Pick<PosArticle, 'addOns' | 'askPrice' | 'reference' | 'askQuantity' | 'serviceVoucher' | 'externalVoucher'>>;
type ArtikelNachId<T> = ReadonlyMap<string, T> | Readonly<Record<string, T>>;

const eigeneListe = (a: { addOns?: string[] | null }): boolean => Array.isArray(a.addOns) && a.addOns.length > 0;

/**
 * Taugt der Artikel als Zusatz? `null` = ja. Im Fenster wird ohne Abfrage
 * gebucht: Betrag, Referenz oder Menge fragen geht nicht, ein Preis muss
 * feststehen (0 erlaubt), ein Leistungsgutschein oder fremder Gutschein liefe am Gutschein-Weg vorbei,
 * und ein Artikel mit eigener Liste oeffnete selbst ein Fenster (eine Ebene).
 */
export function isSelectableAddOn(a: ZusatzArtikel): AddOnBlockReason | null {
  if (a.active === false) return 'inactive';
  if (eigeneListe(a)) return 'own_list';
  if (a.askPrice === true) return 'asks_price';
  if (a.reference != null) return 'reference';
  if (a.askQuantity === true) return 'asks_quantity';
  if (typeof a.unitPriceCents !== 'number' || !Number.isInteger(a.unitPriceCents) || a.unitPriceCents < 0) return 'no_price';
  if (a.serviceVoucher === true) return 'service_voucher';
  if (a.externalVoucher != null) return 'external_voucher';
  return null;
}

function nachId<T>(karte: ArtikelNachId<T>, id: string): T | undefined {
  if (karte instanceof Map) return karte.get(id);
  return Object.prototype.hasOwnProperty.call(karte, id) ? (karte as Record<string, T>)[id] : undefined;
}

/**
 * Wirksame Zusatzliste eines Artikels: eigene Liste (auch leer) vor der der
 * Gruppe; still heraus fallen der Artikel selbst, Unbekanntes, Dubletten und
 * alles, was nicht als Zusatz taugt. Leer = kein Fenster.
 */
export function addOnsFor<T extends ZusatzArtikel>(
  article: ZusatzArtikel,
  group: Pick<ArticleGroup, 'addOns'> | null | undefined,
  articleById: ArtikelNachId<T>,
): string[] {
  const liste = Array.isArray(article.addOns) ? article.addOns : (group && Array.isArray(group.addOns) ? group.addOns : []);
  const raus: string[] = [];
  for (const id of liste) {
    if (typeof id !== 'string' || id === article.id || raus.includes(id)) continue;
    const z = nachId(articleById, id);
    if (!z || isSelectableAddOn(z) !== null) continue;
    raus.push(id);
  }
  return raus;
}

type MitVerweis = { addOnOf?: number | null };
const hatVerweis = (it: MitVerweis | null | undefined): boolean => it != null && typeof it === 'object' && Object.prototype.hasOwnProperty.call(it, 'addOnOf') && it.addOnOf !== undefined;

// Positionsarten, die nie Zusatz oder Hauptposition sind (Trinkgeld, Rabatt, Gutschein).
const OHNE_ZUSATZ: ReadonlySet<string> = new Set(['tip', 'discount', 'voucher', 'voucher_float']);

/**
 * Halten die Verweise den Server-Regeln stand? Ganze Zahl, zeigt nach vorne
 * auf eine Warenposition, die selbst kein Zusatz ist (sonst antwortet
 * createReceipt mit `invalid_add_on_reference`).
 */
export function addOnReferencesValid(items: readonly (MitVerweis & { kind?: string | null })[]): boolean {
  return items.every((it, i) => {
    if (!hatVerweis(it)) return true;
    const z = it.addOnOf;
    if (typeof z !== 'number' || !Number.isInteger(z) || z < 0 || z >= i) return false;
    const ziel = items[z];
    if (OHNE_ZUSATZ.has(it.kind ?? '') || OHNE_ZUSATZ.has(ziel?.kind ?? '')) return false;
    return !hatVerweis(ziel);
  });
}

/** Indizes der Zusaetze einer Hauptposition (Storno: mit vormerken, abwaehlbar). */
export function addOnsOfItem(items: readonly MitVerweis[], index: number): number[] {
  const raus: number[] = [];
  items.forEach((it, i) => { if (hatVerweis(it) && it.addOnOf === index) raus.push(i); });
  return raus;
}

/**
 * Storno: Verweis je Storno-Position (in der Reihenfolge der stornierten
 * Positionen, Menge > 0). Ein Zusatz behaelt ihn nur, wenn seine Hauptposition
 * mit storniert wird, umgerechnet auf den neuen Index; sonst `null`.
 */
export function addOnRemap(items: readonly MitVerweis[], quantities: readonly number[]): (number | null)[] {
  const neu = new Map<number, number>();
  const raus: (number | null)[] = [];
  items.forEach((it, i) => {
    if (!((quantities[i] ?? 0) > 0)) return;
    neu.set(i, raus.length);
    raus.push(hatVerweis(it) && neu.has(it.addOnOf as number) ? neu.get(it.addOnOf as number)! : null);
  });
  return raus;
}

/** Ist Position `i` ein gueltiger Zusatz (Verweis nach vorne auf eine Hauptposition)? Paketintern (Layout). */
export function istGueltigerZusatz(items: readonly MitVerweis[], i: number): boolean {
  const it = items[i];
  return it != null && hatVerweis(it) && Number.isInteger(it.addOnOf)
    && (it.addOnOf as number) >= 0 && (it.addOnOf as number) < i && !hatVerweis(items[it.addOnOf as number]);
}

/**
 * Bon-Reihenfolge: jede Hauptposition, direkt gefolgt von ihren Zusaetzen
 * (stabil). Positionen mit ungueltigem Verweis bleiben an ihrem Platz.
 */
export function addOnDisplayOrder(items: readonly MitVerweis[]): number[] {
  const gueltig = (_it: MitVerweis, i: number): boolean => istGueltigerZusatz(items, i);
  const raus: number[] = [];
  items.forEach((it, i) => {
    if (gueltig(it, i)) return;
    raus.push(i);
    items.forEach((z, j) => { if (j > i && gueltig(z, j) && z.addOnOf === i) raus.push(j); });
  });
  return raus;
}

/**
 * Warenkorb -> Belegpositionen: Zeilen tragen die Zeilen-Id ihrer Hauptzeile
 * (`addOnOf`). Sortiert jeden Zusatz hinter seine Hauptzeile (stabil) und
 * rechnet den Verweis in den Index um. Fehlt die Hauptzeile (geloescht oder
 * vorher herausgefiltert, etwa ein Gutschein-Verkauf), bleibt die Zeile ohne
 * Verweis an ihrem Platz.
 */
export function orderAddOnLines<T extends { id: string; addOnOf?: string | null }>(lines: readonly T[]): { line: T; addOnOf: number | null }[] {
  const ids = new Set(lines.map((l) => l.id));
  const istZusatz = (l: T): boolean => typeof l.addOnOf === 'string' && l.addOnOf !== l.id && ids.has(l.addOnOf)
    && !lines.some((h) => h.id === l.addOnOf && typeof h.addOnOf === 'string' && ids.has(h.addOnOf));
  const raus: { line: T; addOnOf: number | null }[] = [];
  for (const l of lines) {
    if (istZusatz(l)) continue;
    const index = raus.length;
    raus.push({ line: l, addOnOf: null });
    for (const z of lines) if (istZusatz(z) && z.addOnOf === l.id) raus.push({ line: z, addOnOf: index });
  }
  return raus;
}
