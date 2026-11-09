import type { PosExternalVouchers } from './gutschein.js';

/**
 * Artikel als fremder Gutschein (Fremdgutscheine an der Kasse, 1.31.0): der
 * Chef legt einen Artikel als Kachel „fremder Gutschein“ an. Die Kasse fragt
 * beim Antippen die Gutscheinnummer (und ohne Preis den Betrag) ab und sendet
 * statt einer Position einen `vouchers[]`-Eintrag
 * `{ source: 'external', action: 'sell', type: externalVoucher, number, amountCents, vatRateBp? }`.
 *
 * Die Regeln am Artikel rechnet das Backend (`functions-kasse/fremdgutschein-artikel-core.js`)
 * beim Speichern (`createMyArticle`/`updateMyArticle`, Code `article_external_voucher_invalid`
 * mit `data.grund`); der Artikel-Editor des Kundenbereichs prueft vorher gleich. Vertrag sind
 * die Pruefaelle `fixtures/external-voucher-article-cases.json` (byte-gleich mit dem Backend).
 */

/** Art des fremden Gutscheins am Artikel (`/v3` `externalVoucher`, gespeichert `fremdgutschein`). */
export type ArticleExternalVoucher = 'multi_purpose' | 'single_purpose';
export const ARTICLE_EXTERNAL_VOUCHER_TYPES: readonly ArticleExternalVoucher[] = Object.freeze(['multi_purpose', 'single_purpose'] as const);

/** Fehlercode beim Speichern eines Artikels, intern und unter `/v3` gleich. */
export const ARTICLE_EXTERNAL_VOUCHER_INVALID = 'article_external_voucher_invalid';

/** Welche Regel verletzt ist (Antwortfeld `data.grund`), in der Reihenfolge, in der der Server prueft. */
export const EXTERNAL_VOUCHER_ARTICLE_REASONS = Object.freeze([
  'invalid_type', 'service_voucher', 'add_ons', 'stock_tracked', 'reference', 'asks_quantity', 'deposit', 'rate_required', 'invalid_rate', 'price_required',
] as const);
export type ExternalVoucherArticleReason = typeof EXTERNAL_VOUCHER_ARTICLE_REASONS[number];

/**
 * Ein Artikel im Editor (`/v3`-Form), soweit die Regeln ihn lesen. Bewusst
 * `unknown` beim Wert: der Editor prueft auch, was nicht in den Typ passt.
 */
export interface ExternalVoucherArticleInput {
  externalVoucher?: unknown;
  unitPriceCents?: number | null;
  vatRate?: number | null;
  askPrice?: boolean | null;
  serviceVoucher?: boolean | null;
  addOns?: readonly unknown[] | null;
  deposits?: readonly unknown[] | null;
  stockTracked?: boolean | null;
  reference?: unknown;
  askQuantity?: boolean | null;
}

/**
 * Saetze, mit denen ein Einzweckgutschein verkauft werden kann (Prozent wie
 * `PosArticle.vatRate`; 0 = befreit verkauft): die Saetze der Kasse, Backend
 * `article-groups-core.STEUERSAETZE`, dieselben wie [EXTERNAL_VOUCHER_VAT_RATES_BP] / 100.
 */
export const ARTICLE_EXTERNAL_VOUCHER_VAT_RATES: readonly number[] = Object.freeze([20, 13, 10, 4.9, 0, 19]);

/** Ist der Wert eine Art fremder Gutschein? */
export function isArticleExternalVoucher(value: unknown): value is ArticleExternalVoucher {
  return (ARTICLE_EXTERNAL_VOUCHER_TYPES as readonly unknown[]).includes(value);
}

/** Form des Werts beim Speichern: `null` heisst entfernen und ist gueltig. Zwilling von `pruefeWert`. */
export function checkExternalVoucherValue(value: unknown): ExternalVoucherArticleReason | null {
  return value === null || isArticleExternalVoucher(value) ? null : 'invalid_type';
}

/**
 * Regeln am wirksamen Artikelstand (Bestand + Aenderung), Zwilling von
 * `pruefeArtikel`: `null` = passt. Ohne `externalVoucher` gilt keine Regel.
 * Einzweck verlangt einen Satz der Kasse (0 = befreit verkauft), Mehrzweck ignoriert ihn;
 * nie zusammen mit Leistungsgutschein, eigener Zusatzliste, Lagerbestand,
 * Referenz, Mengenabfrage oder Pfand (die Kasse fragt die Nummer selbst und bucht
 * genau einen); ohne `askPrice` braucht er einen Preis ab 1 Cent.
 */
export function checkExternalVoucherArticle(a: ExternalVoucherArticleInput): ExternalVoucherArticleReason | null {
  if (a.externalVoucher == null) return null;
  if (!isArticleExternalVoucher(a.externalVoucher)) return 'invalid_type';
  if (a.serviceVoucher === true) return 'service_voucher';
  if (Array.isArray(a.addOns) && a.addOns.length > 0) return 'add_ons';
  if (a.stockTracked === true) return 'stock_tracked';
  if (a.reference) return 'reference';
  if (a.askQuantity === true) return 'asks_quantity';
  if (Array.isArray(a.deposits) && a.deposits.length > 0) return 'deposit';
  if (a.externalVoucher === 'single_purpose' && !(typeof a.vatRate === 'number' && Number.isFinite(a.vatRate))) return 'rate_required';
  if (a.externalVoucher === 'single_purpose' && !ARTICLE_EXTERNAL_VOUCHER_VAT_RATES.includes(a.vatRate as number)) return 'invalid_rate';
  if (a.askPrice !== true && !(typeof a.unitPriceCents === 'number' && Number.isInteger(a.unitPriceCents) && a.unitPriceCents >= 1)) return 'price_required';
  return null;
}

/** Warum die Kachel eines fremden Gutscheins gesperrt ist. */
export type ExternalVoucherTileBlock = 'not_enabled' | 'type_not_enabled';

/**
 * Darf die Kachel verkaufen? `null` = ja (auch fuer jeden Artikel ohne
 * `externalVoucher`). Gesperrt bei Freigabe `off` (oder ohne Angabe) und bei
 * Einzweck ohne `all` -- dieselbe Regel, mit der der Server den Beleg abweist
 * (`external_voucher_not_enabled`, `external_voucher_type_not_enabled`).
 */
export function externalVoucherTileBlock(
  article: { externalVoucher?: ArticleExternalVoucher | null },
  externalVouchers: PosExternalVouchers | null | undefined,
): ExternalVoucherTileBlock | null {
  if (article.externalVoucher == null) return null;
  if (externalVouchers !== 'multi_purpose' && externalVouchers !== 'all') return 'not_enabled';
  if (article.externalVoucher === 'single_purpose' && externalVouchers !== 'all') return 'type_not_enabled';
  return null;
}
