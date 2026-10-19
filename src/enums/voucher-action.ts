/**
 * Gutschein-Aktion — Zwilling von `VoucherAction` in
 * kasseneck_api/lib/enums/voucher_action.dart.
 */
export const VoucherAction = {
  sell: 'sell',
  redeem: 'redeem',
  /** Neue Form: Restwert auszahlen (Mehrzweck/Einzweck). */
  payout: 'payout',
} as const;

export type VoucherActionKey = keyof typeof VoucherAction;
export type VoucherAction = (typeof VoucherAction)[VoucherActionKey];
