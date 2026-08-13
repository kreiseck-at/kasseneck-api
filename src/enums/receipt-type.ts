/**
 * Belegtyp — Zwilling von `ReceiptType` in kasseneck_api/lib/enums/receipt_type.dart.
 *
 * needsItems: Positionen sind fuer diesen Typ Pflicht.
 * isZero: RKSV-Nullbeleg (Start-/Monats-/Jahresbeleg-Signaturkette-Marker).
 * allowsVouchers: Gutscheine duerfen auf Belegen dieses Typs erscheinen.
 */
export const ReceiptType = {
  start: { value: 'start', needsItems: false, isZero: true, allowsVouchers: false },
  standard: { value: 'standard', needsItems: true, isZero: false, allowsVouchers: true },
  zero: { value: 'zero', needsItems: false, isZero: true, allowsVouchers: false },
  cancellation: { value: 'cancellation', needsItems: true, isZero: false, allowsVouchers: true },
  training: { value: 'training', needsItems: true, isZero: false, allowsVouchers: true },
} as const;

export type ReceiptTypeKey = keyof typeof ReceiptType;
export type ReceiptType = (typeof ReceiptType)[ReceiptTypeKey];
