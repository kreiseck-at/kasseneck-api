import { CreditCardProvider } from '../enums/index.js';

/**
 * Hobex-Kartenzahlungsbeleg — Zwilling von `HobexReceipt` in
 * kasseneck_api/lib/models/hobex_receipt.dart.
 *
 * `amount`/`tip` kommen vom Hobex-Terminal als Euro-Gleitkommazahl ueber die
 * Leitung (Terminal-API, nicht das Kasseneck-Backend) — das Nutzlast-Format
 * bleibt deshalb bewusst Euro (siehe [toHobexReceiptPayload]/
 * [fromHobexReceiptPayload]), intern wird ab hier exakt in Cent gefuehrt.
 *
 * Nur der Cloud-API-Pfad (`fromJson` im Dart-Vorbild) ist Teil dieses Pakets;
 * das lokale HPS-Terminal (`fromHps`, TCP-Anbindung an ein physisches Geraet)
 * ist wie SumUp/myPOS eine Android/Desktop-Geraete-Anbindung, die ein
 * Browser-/Node-Paket nicht bedienen kann.
 */
export interface HobexReceipt {
  transactionId: string;
  tid: string;
  receipt: string;
  approvalCode: string;
  reference?: string;
  /** Normalisiert wie im Dart-Vorbild: `"YYYY-MM-DD HH:mm:ss"` (Bruchteil und `T` entfernt). */
  transactionDate: string;
  cardNumber: string;
  cardExpiry: string;
  brand: string;
  cardIssuer: string;
  responseCode: string;
  transactionType: string;
  currency: string;
  amountCents: number;
  tipCents: number;
  cvm: string;
  creditCardProvider: CreditCardProvider;
}

export interface HobexReceiptPayload {
  transactionId: string;
  tid: string;
  receipt: string;
  approvalCode: string;
  reference: string | null | undefined;
  transactionDate: string;
  cardNumber: string;
  cardExpiry: string;
  brand: string;
  cardIssuer: string;
  responseCode: string;
  transactionType: string;
  currency: string;
  amount: number;
  tip: number;
  cvm: string | number;
}

export function toHobexReceiptPayload(beleg: HobexReceipt): HobexReceiptPayload {
  return {
    transactionId: beleg.transactionId,
    tid: beleg.tid,
    receipt: beleg.receipt,
    approvalCode: beleg.approvalCode,
    reference: beleg.reference ?? null,
    transactionDate: beleg.transactionDate,
    cardNumber: beleg.cardNumber,
    cardExpiry: beleg.cardExpiry,
    brand: beleg.brand,
    cardIssuer: beleg.cardIssuer,
    responseCode: beleg.responseCode,
    transactionType: beleg.transactionType,
    currency: beleg.currency,
    // Euro-Umwandlung nur hier, an der Terminal-API-Grenze — siehe Kommentar oben.
    amount: beleg.amountCents / 100,
    tip: beleg.tipCents / 100,
    cvm: beleg.cvm,
  };
}

export function fromHobexReceiptPayload(payload: HobexReceiptPayload): HobexReceipt {
  return {
    transactionId: payload.transactionId,
    tid: payload.tid,
    receipt: payload.receipt,
    approvalCode: payload.approvalCode,
    reference: payload.reference ?? undefined,
    // Kappt Bruchteilssekunden/Offset und ersetzt "T" durch ein Leerzeichen,
    // exakt wie im Dart-Vorbild (transactionDate.split('.')[0].replaceAll('T', ' ')).
    transactionDate: payload.transactionDate.split('.')[0]!.split('T').join(' '),
    cardNumber: payload.cardNumber,
    cardExpiry: payload.cardExpiry,
    brand: payload.brand,
    cardIssuer: payload.cardIssuer,
    responseCode: payload.responseCode,
    transactionType: payload.transactionType,
    currency: payload.currency,
    amountCents: Math.round((payload.amount ?? 0) * 100),
    tipCents: Math.round((payload.tip ?? 0) * 100),
    cvm: String(payload.cvm),
    // Die Cloud-API-Nutzlast traegt keinen eigenen Provider-Schluessel — der
    // Provider ergibt sich aus dem Transportweg (Cloud vs. HPS), nicht aus
    // dem JSON. Das Dart-Vorbild setzt ihn in `fromJson` deshalb ebenfalls
    // nicht, sondern belaesst den Konstruktor-Default.
    creditCardProvider: CreditCardProvider.hobexCloudApi,
  };
}

/**
 * Wandelt den Beleg in die `cardPaymentData`-Map, die auf dem Kasseneck-Beleg
 * landet (siehe [Receipt.cardPaymentData]). Bei HPS-Zahlungen kommen weitere
 * Felder dazu, die nur das lokale Terminal liefert.
 */
export function hobexReceiptToCardPaymentData(beleg: HobexReceipt): Record<string, string> {
  const data: Record<string, string> = {
    transactionId: beleg.transactionId,
    date: beleg.transactionDate,
    tid: beleg.tid,
    no: beleg.receipt,
    type: beleg.transactionType,
    cardBrand: beleg.brand,
    cardNumber: beleg.cardNumber,
    responseCode: beleg.responseCode,
    cvm: beleg.cvm,
  };
  if (beleg.creditCardProvider === CreditCardProvider.hobexHps) {
    data.approvalCode = beleg.approvalCode;
    data.cardExpiry = beleg.cardExpiry;
    data.cardIssuer = beleg.cardIssuer;
    data.amount = (beleg.amountCents / 100).toFixed(2);
    data.currency = beleg.currency;
  }
  return data;
}

/** Kartenzahlung erfordert eine Unterschrift (CVM-Code `"1"`). */
export function hobexReceiptNeedsSignature(beleg: HobexReceipt): boolean {
  return beleg.cvm === '1';
}
