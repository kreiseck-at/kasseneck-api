/**
 * Gutscheinart — Zwilling von `VoucherType` in kasseneck_api/lib/enums/voucher_type.dart.
 */
export const VoucherType = {
  value: 'value',
  promo: 'promo',
} as const;

export type VoucherTypeKey = keyof typeof VoucherType;
export type VoucherType = (typeof VoucherType)[VoucherTypeKey];
