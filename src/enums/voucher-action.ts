/**
 * Gutschein-Aktion — Zwilling von `VoucherAction` in
 * kasseneck_api/lib/enums/voucher_action.dart.
 */
export const VoucherAction = {
  sell: 'sell',
  redeem: 'redeem',
} as const;

export type VoucherActionKey = keyof typeof VoucherAction;
export type VoucherAction = (typeof VoucherAction)[VoucherActionKey];
