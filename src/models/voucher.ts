import { VoucherAction, VoucherType } from '../enums/index.js';
import { readEnumKey, requireEnumKey } from './enum-payload.js';

/**
 * Gutschein — Zwilling von `KeckVoucher` in
 * kasseneck_api/lib/models/keck_voucher.dart.
 *
 * `valueCents` ist der Gutscheinwert in **Cent** (exakte Integer-Arithmetik).
 *
 * `action`/`type` sind schon im Dart-Vorbild reine Strings (keine
 * Zusatzfelder) — beim Lesen bleibt ein unbekannter Wert deshalb ebenfalls
 * einfach der rohe Nutzlast-String (siehe [readEnumKey]); ob er zu den
 * bekannten Werten gehoert, entscheidet sich erst beim Schreiben.
 */
export interface Voucher {
  name?: string;
  code?: string;
  action: VoucherAction | string;
  type: VoucherType | string;
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
    // Schreibpfad bleibt streng: action/type sehen fuer bekannte und
    // unbekannte Werte gleich aus (reine Strings) — erst der Lookup hier
    // entscheidet, ob geschrieben werden darf.
    action: requireEnumKey(VoucherAction, voucher.action, 'Gutschein-Aktion'),
    type: requireEnumKey(VoucherType, voucher.type, 'Gutscheinart'),
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
    action: readEnumKey(VoucherAction, payload.action),
    type: readEnumKey(VoucherType, payload.type),
    valueCents,
  };
}
