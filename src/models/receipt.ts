import { ReceiptType, KeckPaymentMethod, CreditCardProvider, VoucherAction, VoucherType } from '../enums/index.js';
import { readEnumKey, requireEnumKey } from './enum-payload.js';
import {
  type ReceiptItem,
  type ReceiptItemPayload,
  type ReceiptItemPayloadRead,
  toReceiptItemPayload,
  fromReceiptItemPayload,
  receiptItemTotalCents,
} from './receipt-item.js';
import { type Voucher, type VoucherPayload, toVoucherPayload, fromVoucherPayload } from './voucher.js';
import type { Cancellation, CancellationOf, CancellationReason } from './cancellation.js';
import { istZeroKind, type ZeroKind } from './receipt-summary.js';
import { type ReceiptPayment, type ReceiptPaymentPayload, fromReceiptPaymentPayload, toReceiptPaymentPayload } from './receipt-payment.js';

/**
 * Beleg — Zwilling der Beleg-Nutzlast von `KasseneckReceipt` in
 * kasseneck_api/lib/models/kasseneck_receipt.dart (nur der signatur-/
 * positionsrelevante Teil, den `toReceiptJson()`/die `receipt`-Map von
 * `fromJson()` traegt — nicht die Firmen-/Druckdaten wie Firma, Adresse oder
 * Fusszeilen: die betreffen ausschliesslich das Beleg-Rendering und gehoeren
 * nicht zum RKSV-Kernbeleg. Sie stehen als eigenes Modell daneben, siehe
 * `ReceiptCompany` in ./receipt-company.ts).
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
  /**
   * Summe aller Trinkgeld-Positionen in Cent (Storno negativ) — abgeleitetes
   * Lesefeld des Backends, nur vorhanden, wenn der Beleg Trinkgeld traegt.
   */
  tipCents?: number;
  /** Nur am Storno-Beleg: das stornierte Original. */
  cancellationOf?: CancellationOf;
  /** Nur am Storno-Beleg: Grund-Code aus [CANCELLATION_REASONS]. */
  cancellationReason?: CancellationReason | string;
  /** Nur am Original: alle (Teil-)Stornos, Quelle der Restmengen. */
  cancellations?: Cancellation[];
  /** Nur an Nullbelegen: Anlass (monthly, annual, annual_replacement, outage_end, final, manual). */
  zeroKind?: ZeroKind;
  /**
   * Zahlungsliste (mehrere Zahlungen je Beleg), nur vorhanden, wenn der Beleg
   * sie traegt. Altbelege haben keine; dort gelten `paymentMethod` und die
   * Kartenfelder. Siehe [ReceiptPayment].
   */
  payments?: ReceiptPayment[];
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
  /** Nur bei Belegen mit Trinkgeld (siehe [Receipt.tipCents]). */
  tipCents?: number | null;
  /** Nur bei Belegen mit Zahlungsliste (siehe [Receipt.payments]). */
  payments?: ReceiptPaymentPayload[] | null;
}

/**
 * Nutzlast-Form, die dieses Paket **liest**. Unterscheidet sich von
 * [ReceiptPayload] bei den Positionen: ein gespeicherter Beleg traegt sie in
 * der v1-Form, die das Backend ablegt (siehe [ReceiptItemPayloadRead]).
 * Nullbelege haben ueberhaupt keine Positionen.
 */
export interface ReceiptPayloadRead extends Omit<ReceiptPayload, 'items' | 'vouchers'> {
  items?: ReceiptItemPayloadRead[] | null;
  vouchers?: VoucherPayload[] | null;
  cancellationOf?: CancellationOf | null;
  cancellationReason?: string | null;
  zeroKind?: string | null;
  cancellations?: Cancellation[] | null;
}

/**
 * Schreibt die Nutzlast in der **neuen** Form — sie **normalisiert, statt zu
 * spiegeln**: ein Beleg, der in der v1-Positionsform gelesen wurde, geht hier
 * in der v2-Form wieder hinaus (wie im Flutter-Vorbild, dessen `toJson` v2
 * schreibt und dessen `fromJson` beide Formen liest). Nutzlast rein -> Beleg
 * -> Nutzlast raus ist deshalb kein Rundtrip, wenn die Eingabe v1 war.
 *
 * Fuer dieses Paket ohne Folgen: Belege gehen ausschliesslich ueber
 * `createReceipt` an den Server, das seine Nutzlast selbst baut.
 */
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
    ...(receipt.tipCents != null ? { tipCents: receipt.tipCents } : {}),
    ...(receipt.payments != null ? { payments: receipt.payments.map(toReceiptPaymentPayload) } : {}),
  };
}

// Nullbelege haben keine Positionen -> items kann fehlen/null sein (siehe Dart-Vorbild).
const leereZeile = (text: string | null | undefined): string[] => (text ? text.split('\n') : []);

export function fromReceiptPayload(payload: ReceiptPayloadRead): Receipt {
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
    ...(typeof payload.tipCents === 'number' ? { tipCents: payload.tipCents } : {}),
    ...(payload.cancellationOf ? { cancellationOf: {
      receiptId: payload.cancellationOf.receiptId,
      fullReceiptId: payload.cancellationOf.fullReceiptId ?? null,
      ...(typeof payload.cancellationOf.timeStamp === 'string' && payload.cancellationOf.timeStamp ? { timeStamp: payload.cancellationOf.timeStamp } : {}),
    } } : {}),
    ...(payload.cancellationReason ? { cancellationReason: payload.cancellationReason } : {}),
    ...(istZeroKind(payload.zeroKind) ? { zeroKind: payload.zeroKind } : {}),
    ...(payload.cancellations ? { cancellations: payload.cancellations.map(leseStorno) } : {}),
    ...(Array.isArray(payload.payments) ? { payments: payload.payments.map(fromReceiptPaymentPayload) } : {}),
  };
}

function leseStorno(eintrag: Cancellation): Cancellation {
  return {
    ...(eintrag.receiptId !== undefined ? { receiptId: eintrag.receiptId } : {}),
    ...(eintrag.pending === true ? { pending: true } : {}),
    at: Number(eintrag.at ?? 0),
    by: eintrag.by ?? null,
    note: eintrag.note ?? null,
    items: (eintrag.items ?? []).map((p) => ({ index: Number(p.index), quantity: Number(p.quantity) })),
    ...(eintrag.promoAdjustmentCents && typeof eintrag.promoAdjustmentCents === 'object'
      ? { promoAdjustmentCents: Object.fromEntries(Object.entries(eintrag.promoAdjustmentCents).map(([k, v]) => [k, Number(v)])) }
      : {}),
    ...(eintrag.refundedByPayment && typeof eintrag.refundedByPayment === 'object' && !Array.isArray(eintrag.refundedByPayment)
      ? { refundedByPayment: gueltigeRueckzahlungen(eintrag.refundedByPayment) }
      : {}),
  };
}

// Nur ganzzahlige, nicht-negative Cent-Betraege je Zahlungs-ID; ein Eintrag,
// der das nicht erfuellt (negativ, Kommazahl, kein Zahlenwert), faellt weg --
// die uebrigen bleiben. Zwilling der Backend-Erzeugung (storno-core.js
// pruefeRueckzahlungen), die selbst nur so etwas ablegt.
function gueltigeRueckzahlungen(rueckzahlungen: Record<string, unknown>): Record<string, number> {
  const raus: Record<string, number> = {};
  for (const [id, wert] of Object.entries(rueckzahlungen)) {
    const cents = Number(wert);
    if (Number.isInteger(cents) && cents >= 0) raus[id] = cents;
  }
  return raus;
}

/**
 * Vorzeichen der Wertgutscheine am Beleg: am Storno-Beleg -1, sonst 1.
 *
 * Das Backend spiegelt Wertgutscheine beim Vollstorno mit UNVERAENDERTER
 * `action` und positivem Wert (storno-core.stornoVouchers); der Fluss dreht
 * sich am Storno um (zahlungen-core.wertgutscheinFlussCents, hier
 * `receiptDueCents`): ein verkaufter Gutschein wird zurueckgezahlt, ein
 * eingeloester mindert die Rueckzahlung.
 */
export function receiptValueVoucherSign(receipt: Receipt): 1 | -1 {
  const typ = typeof receipt.receiptType === 'object' ? receipt.receiptType.value : receipt.receiptType;
  return typ === ReceiptType.cancellation.value ? -1 : 1;
}

/**
 * Zwischensumme in **Cent** — Positionen plus verkaufte Wertgutscheine minus
 * eingeloeste Aktionsgutscheine. Wertgutschein-Einloesungen wirken erst auf
 * [receiptSumCents], nicht hier (siehe Dart-Vorbild `subSumCents`/`sumCents`).
 * Am Storno-Beleg zaehlen Wertgutscheine mit umgekehrtem Vorzeichen
 * ([receiptValueVoucherSign]), und ein gespiegelter Aktionsgutschein
 * mindert nichts: den Rabatt nimmt der Server dort ueber Ausgleichspositionen
 * (`kind: 'discount'`) zurueck, und belegToepfe verteilt einen Promo-Eintrag
 * nur auf eine positive Topfsumme, die ein Storno nie hat.
 *
 * Gutscheine der neuen Form (Spec 2026-10-14): ihr Betrag steht als Position
 * (`kind: 'voucher'` bei Einzweck/Leistung, `'voucher_float'` im 0-%-Topf) und
 * zaehlt hier schon mit den Positionen. Ein Eintrag mit `zeroRateBucket`
 * (intern `imNullTopf`, Mehrzweck-Verkauf ab dem Stichtag, Auszahlung) zaehlt
 * darum nicht noch einmal -- sonst stuende der Betrag doppelt am Bon
 * (Vorfall 16.10.2026: Verkauf ueber 30 € mit „Gesamt 60,00“). Eintraege der
 * Arten `single_purpose`/`service` tragen keinen Fluss (wie
 * gutschein-beleg.zahlbetrag, das nur `value`/`promo` an den Fluss gibt).
 */
export function receiptSubSumCents(receipt: Receipt): number {
  const vz = receiptValueVoucherSign(receipt);
  let cents = receipt.items.reduce((acc, item) => acc + receiptItemTotalCents(item), 0);
  for (const voucher of receipt.vouchers) {
    if (voucher.zeroRateBucket === true) continue;
    if (vz === 1 && voucher.action === VoucherAction.redeem && voucher.type === VoucherType.promo) {
      cents -= voucher.valueCents ?? 0;
    }
    if (voucher.action === VoucherAction.sell && voucher.type === VoucherType.value) {
      cents += vz * (voucher.valueCents ?? 0);
    }
  }
  return cents;
}

/**
 * Gesamtsumme in **Cent** — Zwischensumme minus eingeloeste Wertgutscheine
 * (am Storno-Beleg plus, siehe [receiptValueVoucherSign]). Zwilling von
 * zahlungen-core.wertgutscheinFlussCents: eine Auszahlung (`payout`) eines
 * Wertgutscheins ohne `zeroRateBucket` mindert wie eine Einloesung; mit
 * `zeroRateBucket` steht sie als Position und zaehlt nur dort.
 */
export function receiptSumCents(receipt: Receipt): number {
  const vz = receiptValueVoucherSign(receipt);
  let cents = receiptSubSumCents(receipt);
  for (const voucher of receipt.vouchers) {
    if (voucher.zeroRateBucket === true || voucher.type !== VoucherType.value) continue;
    if (voucher.action === VoucherAction.redeem || voucher.action === VoucherAction.payout) {
      cents -= vz * (voucher.valueCents ?? 0);
    }
  }
  return cents;
}
