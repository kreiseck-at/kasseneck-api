/**
 * Gutscheinart — Zwilling von `VoucherType` in kasseneck_api/lib/enums/voucher_type.dart.
 */
export const VoucherType = {
  /**
   * Altform: Wertgutschein (Wert im Cent, Code frei). Gelesene Belege tragen `value` weiter fuer jeden
   * Mehrzweck-Eintrag (eigen und fremd); dort ist der Wert gueltig.
   *
   * @deprecated Als Wunsch an `createReceipt` mit frei getipptem `code` (Server 2026-11: Antwort mit
   * `deprecation`): der Code wird nicht geprueft, steuerlich ist das ein fremder Mehrzweckgutschein. Einen
   * Gutschein eines anderen Systems als Fremdgutschein senden: `{ source: 'external', action, type:
   * 'multi_purpose', number, amountCents }`; eigene Gutscheine ueber eine Sorte (`typeId`) verkaufen und mit
   * ihrem Code einloesen.
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
