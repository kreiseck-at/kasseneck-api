import { VoucherAction, VoucherType } from '../enums/index.js';
import { requireEnumKey } from './enum-payload.js';

/**
 * Gutschein — Zwilling von `KeckVoucher` in
 * kasseneck_api/lib/models/keck_voucher.dart.
 *
 * `valueCents` ist der Gutscheinwert in **Cent** (exakte Integer-Arithmetik).
 */
export interface Voucher {
  name?: string;
  code?: string;
  action: VoucherAction;
  type: VoucherType;
  valueCents?: number;
}

/**
 * Nutzlast: traegt **beide** Felder, `value` (Euro) und `valueCents` (Cent).
 * Das Backend erwartet das Euro-Feld weiterhin (Altkompatibilitaet) — die
 * Umwandlung passiert nur hier, an dieser einen Stelle.
 */
export interface VoucherPayload {
  name: string | null;
  code: string | null;
  action: string;
  type: string;
  value: number | null;
  valueCents: number | null;
}

export function toVoucherPayload(voucher: Voucher): VoucherPayload {
  return {
    name: voucher.name ?? null,
    code: voucher.code ?? null,
    action: voucher.action,
    type: voucher.type,
    // Euro-Feld nur fuer Altbestand-Konsumenten des Backends — siehe Kommentar oben.
    value: voucher.valueCents == null ? null : voucher.valueCents / 100,
    valueCents: voucher.valueCents ?? null,
  };
}

export function fromVoucherPayload(payload: VoucherPayload): Voucher {
  const valueCents =
    payload.valueCents != null
      ? payload.valueCents
      : payload.value != null
        ? Math.round(payload.value * 100)
        : undefined;
  return {
    name: payload.name ?? undefined,
    code: payload.code ?? undefined,
    action: requireEnumKey(VoucherAction, payload.action, 'Gutschein-Aktion'),
    type: requireEnumKey(VoucherType, payload.type, 'Gutscheinart'),
    valueCents,
  };
}
