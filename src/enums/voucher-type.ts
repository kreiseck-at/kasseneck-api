/**
 * Gutscheinart — Zwilling von `VoucherType` in kasseneck_api/lib/enums/voucher_type.dart.
 */
export const VoucherType = {
  /** Altform: Wertgutschein (Wert im Cent, Code frei). */
  value: 'value',
  /** Altform: Rabatt-/Aktionsgutschein. */
  promo: 'promo',
  /** Neue Form: Mehrzweckgutschein (Zahlungsmittel, Steuer erst bei der Einloesung). Intern `mehrzweck`. */
  multi_purpose: 'multi_purpose',
  /** Neue Form: Einzweckgutschein (Steuer schon beim Verkauf, ein Satz). Intern `einzweck`. */
  single_purpose: 'single_purpose',
  /** Neue Form: Leistungsgutschein (Artikel mal Menge). Intern `leistung`. */
  service: 'service',
  /** Neue Form: Aktionsgutschein (Rabatt laut Aktion, nur einloesbar). Intern `aktion`. */
  promotion: 'promotion',
} as const;

export type VoucherTypeKey = keyof typeof VoucherType;
export type VoucherType = (typeof VoucherType)[VoucherTypeKey];
