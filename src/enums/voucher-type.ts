/**
 * Gutscheinart — Zwilling von `VoucherType` in kasseneck_api/lib/enums/voucher_type.dart.
 */
export const VoucherType = {
  /** Altform: Wertgutschein (Wert im Cent, Code frei). */
  value: 'value',
  /** Altform: Rabatt-/Promotionsgutschein. */
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
