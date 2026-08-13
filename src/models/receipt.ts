import { ReceiptType, KeckPaymentMethod, CreditCardProvider, VoucherAction, VoucherType } from '../enums/index.js';
import { readEnumKey, requireEnumKey } from './enum-payload.js';
import {
  type ReceiptItem,
  type ReceiptItemPayload,
  toReceiptItemPayload,
  fromReceiptItemPayload,
  receiptItemTotalCents,
} from './receipt-item.js';
import { type Voucher, type VoucherPayload, toVoucherPayload, fromVoucherPayload } from './voucher.js';

/**
 * Beleg — Zwilling der Beleg-Nutzlast von `KasseneckReceipt` in
 * kasseneck_api/lib/models/kasseneck_receipt.dart (nur der signatur-/
 * positionsrelevante Teil, den `toReceiptJson()`/die `receipt`-Map von
 * `fromJson()` traegt — nicht die Firmen-/Druck-Metadaten wie Firma, Adresse
 * oder Footer-Texte: die betreffen ausschliesslich das Beleg-Rendering und
 * gehoeren nicht zum RKSV-Kernbeleg).
 *
 * `timeStamp` bleibt bewusst der rohe Zeitstempel-String aus der Nutzlast;
 * `parseServerTimeStamp` (`../vienna-time.js`) deutet ihn auf Wunsch in einen
 * echten Zeitpunkt um (uneinheitliches Server-Format, siehe dort).
 *
 * `paymentMethod`/`receiptType`/`creditCardProvider` sind beim Lesen entweder
 * der bekannte Enum-Eintrag oder — bei einem der Nutzlast unbekannten
 * Schluessel — der rohe String (siehe `enum-payload.ts`, `readEnumKey`).
 */
export interface Receipt {
  receiptId: string;
  cashregisterId: string;
  timeStamp: string;
  items: ReceiptItem[];
  vouchers: Voucher[];
  paymentMethod: KeckPaymentMethod | string;
  turnoverCounterAES256ICM: string;
  signaturePreviousReceipt: string;
  certificateSerialNumber: string;
  receiptType: ReceiptType | string;
  sig: string;
  qr: string;
  fullReceiptId: string;
  creditCardProvider?: CreditCardProvider | string;
  cardPaymentId?: string;
  cardPaymentData?: Record<string, unknown>;
  customerDetails: string[];
  legalMessage: string[];
  signatureSuccess?: boolean;
  customProjectId?: string;
}

export interface ReceiptPayload {
  qr: string;
  sig: string;
  certificateSerialNumber: string;
  signaturePreviousReceipt: string;
  turnoverCounterAES256ICM: string;
  paymentMethod: string;
  items: ReceiptItemPayload[];
  vouchers: VoucherPayload[] | null;
  timeStamp: string;
  cashregisterId: string;
  receiptType: string;
  receiptId: string;
  fullReceiptId: string;
  creditCardProvider: string | null;
  cardPaymentId: string | null;
  cardPaymentData: Record<string, unknown> | null;
  customerDetails: string;
  legalMessage: string;
  signatureSuccess: boolean | null;
  customProjectId: string | null;
}

export function toReceiptPayload(receipt: Receipt): ReceiptPayload {
  // Schreibpfad bleibt streng: ReceiptType/KeckPaymentMethod sind bekannt am
  // Objekt-Charakter erkennbar (defineEnum-Eintraege); ein roher String muss
  // erst durch den Lookup, sonst wirft er.
  const paymentMethod = typeof receipt.paymentMethod === 'object' ? receipt.paymentMethod : requireEnumKey(KeckPaymentMethod, receipt.paymentMethod, 'Zahlungsart');
  const receiptType = typeof receipt.receiptType === 'object' ? receipt.receiptType : requireEnumKey(ReceiptType, receipt.receiptType, 'Belegtyp');
  return {
    qr: receipt.qr,
    sig: receipt.sig,
    certificateSerialNumber: receipt.certificateSerialNumber,
    signaturePreviousReceipt: receipt.signaturePreviousReceipt,
    turnoverCounterAES256ICM: receipt.turnoverCounterAES256ICM,
    paymentMethod: paymentMethod.value,
    items: receipt.items.map(toReceiptItemPayload),
    vouchers: receipt.vouchers.map(toVoucherPayload),
    timeStamp: receipt.timeStamp,
    cashregisterId: receipt.cashregisterId,
    receiptType: receiptType.value,
    receiptId: receipt.receiptId,
    fullReceiptId: receipt.fullReceiptId,
    // CreditCardProvider ist ein flacher String-Enum (kein Objekt-Charakter) —
    // der Lookup entscheidet hier ausnahmslos, bekannt oder nicht.
    creditCardProvider: receipt.creditCardProvider != null ? requireEnumKey(CreditCardProvider, receipt.creditCardProvider, 'Kartenanbieter') : null,
    cardPaymentId: receipt.cardPaymentId ?? null,
    cardPaymentData: receipt.cardPaymentData ?? null,
    customerDetails: receipt.customerDetails.join('\n'),
    legalMessage: receipt.legalMessage.join('\n'),
    signatureSuccess: receipt.signatureSuccess ?? null,
    customProjectId: receipt.customProjectId ?? null,
  };
}

// Nullbelege haben keine Positionen -> items kann fehlen/null sein (siehe Dart-Vorbild).
const leereZeile = (text: string | null | undefined): string[] => (text ? text.split('\n') : []);

export function fromReceiptPayload(payload: ReceiptPayload): Receipt {
  return {
    receiptId: payload.receiptId,
    cashregisterId: payload.cashregisterId,
    timeStamp: payload.timeStamp,
    items: (payload.items ?? []).map(fromReceiptItemPayload),
    vouchers: (payload.vouchers ?? []).map(fromVoucherPayload),
    paymentMethod: readEnumKey(KeckPaymentMethod, payload.paymentMethod),
    turnoverCounterAES256ICM: payload.turnoverCounterAES256ICM,
    signaturePreviousReceipt: payload.signaturePreviousReceipt,
    certificateSerialNumber: payload.certificateSerialNumber,
    receiptType: readEnumKey(ReceiptType, payload.receiptType),
    sig: payload.sig,
    qr: payload.qr,
    fullReceiptId: payload.fullReceiptId ?? '',
    creditCardProvider: payload.creditCardProvider != null ? readEnumKey(CreditCardProvider, payload.creditCardProvider) : undefined,
    cardPaymentId: payload.cardPaymentId ?? undefined,
    cardPaymentData: payload.cardPaymentData ?? undefined,
    customerDetails: leereZeile(payload.customerDetails),
    legalMessage: leereZeile(payload.legalMessage),
    signatureSuccess: payload.signatureSuccess ?? undefined,
    customProjectId: payload.customProjectId ?? undefined,
  };
}

/**
 * Zwischensumme in **Cent** — Positionen plus verkaufte Wertgutscheine minus
 * eingeloeste Promotionsgutscheine. Wertgutschein-Einloesungen wirken erst auf
 * [receiptSumCents], nicht hier (siehe Dart-Vorbild `subSumCents`/`sumCents`).
 */
export function receiptSubSumCents(receipt: Receipt): number {
  let cents = receipt.items.reduce((acc, item) => acc + receiptItemTotalCents(item), 0);
  for (const voucher of receipt.vouchers) {
    if (voucher.action === VoucherAction.redeem && voucher.type === VoucherType.promo) {
      cents -= voucher.valueCents ?? 0;
    }
    if (voucher.action === VoucherAction.sell && voucher.type === VoucherType.value) {
      cents += voucher.valueCents ?? 0;
    }
  }
  return cents;
}

/** Gesamtsumme in **Cent** — Zwischensumme minus eingeloeste Wertgutscheine. */
export function receiptSumCents(receipt: Receipt): number {
  let cents = receiptSubSumCents(receipt);
  for (const voucher of receipt.vouchers) {
    if (voucher.action === VoucherAction.redeem && voucher.type === VoucherType.value) {
      cents -= voucher.valueCents ?? 0;
    }
  }
  return cents;
}
