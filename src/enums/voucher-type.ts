/**
 * Gutscheinart — Zwilling von `VoucherType` in kasseneck_api/lib/enums/voucher_type.dart.
 */
export const VoucherType = {
  /**
   * Altform: Wertgutschein (Wert im Cent, Code frei). Gelesene Belege tragen `value` fuer jeden
   * Mehrzweck-Eintrag (eigen und fremd); dort ist der Wert gueltig. Als Wunsch mit frei getipptem Code
   * veraltet: siehe [LegacyValueVoucherWish].
   */
  value: 'value',
  /** Altform: Rabatt-/Aktionsgutschein. */
  promo: 'promo',
  /** Neue Form: Mehrzweckgutschein (Zahlungsmittel, Steuer erst bei der Einloesung). */
  multi_purpose: 'multi_purpose',
  /** Neue Form: Einzweckgutschein (Steuer schon beim Verkauf, ein Satz). */
  single_purpose: 'single_purpose',
  /** Neue Form: Leistungsgutschein (Artikel mal Menge). */
  service: 'service',
  /** Neue Form: Aktionsgutschein (Rabatt laut Aktion, nur einloesbar). */
  promotion: 'promotion',
} as const;

export type VoucherTypeKey = keyof typeof VoucherType;
export type VoucherType = (typeof VoucherType)[VoucherTypeKey];
