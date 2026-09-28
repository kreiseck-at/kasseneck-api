import { CreditCardProvider } from '../enums/index.js';
import { centsToEuro, euroToCents } from '../money.js';

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

export function toHobexReceiptPayload(receipt: HobexReceipt): HobexReceiptPayload {
  return {
    transactionId: receipt.transactionId,
    tid: receipt.tid,
    receipt: receipt.receipt,
    approvalCode: receipt.approvalCode,
    reference: receipt.reference ?? null,
    transactionDate: receipt.transactionDate,
    cardNumber: receipt.cardNumber,
    cardExpiry: receipt.cardExpiry,
    brand: receipt.brand,
    cardIssuer: receipt.cardIssuer,
    responseCode: receipt.responseCode,
    transactionType: receipt.transactionType,
    currency: receipt.currency,
    // Euro-Umwandlung nur hier, an der Terminal-API-Grenze — siehe Kommentar oben.
    amount: centsToEuro(receipt.amountCents),
    tip: centsToEuro(receipt.tipCents),
    cvm: receipt.cvm,
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
    // Euro->Cent ueber die eine gehaertete Stelle im Paket ([euroToCents],
    // money.ts) statt einer eigenen `Math.round(x * 100)` -- die Hobex-Antwort
    // ist eine fremde Antwort und wird hier nur auf transactionId/
    // transactionDate geprueft (siehe payments/hobex.ts, belegAusNutzlast);
    // amount/tip bleiben ungeprueft. Ein nicht-numerischer oder
    // nicht-endlicher Wert ergab bis zu dieser Fassung `NaN` -- lautlos, ohne
    // dass irgendwo geworfen wurde. [euroToCents] liefert dafuer `0`.
    amountCents: euroToCents(payload.amount),
    tipCents: euroToCents(payload.tip),
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
export function hobexReceiptToCardPaymentData(receipt: HobexReceipt): Record<string, string> {
  const data: Record<string, string> = {
    transactionId: receipt.transactionId,
    date: receipt.transactionDate,
    tid: receipt.tid,
    no: receipt.receipt,
    type: receipt.transactionType,
    cardBrand: receipt.brand,
    cardNumber: receipt.cardNumber,
    responseCode: receipt.responseCode,
    cvm: receipt.cvm,
  };
  if (receipt.creditCardProvider === CreditCardProvider.hobexHps) {
    data.approvalCode = receipt.approvalCode;
    data.cardExpiry = receipt.cardExpiry;
    data.cardIssuer = receipt.cardIssuer;
    data.amount = centsToEuro(receipt.amountCents).toFixed(2);
    data.currency = receipt.currency;
  }
  return data;
}

/** Kartenzahlung erfordert eine Unterschrift (CVM-Code `"1"`). */
export function hobexReceiptNeedsSignature(receipt: HobexReceipt): boolean {
  return receipt.cvm === '1';
}
