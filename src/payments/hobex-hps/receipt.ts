import { CreditCardProvider } from '../../enums/index.js';
import type { HobexReceipt } from '../../models/hobex-receipt.js';
import { euroToCents } from '../../money.js';
import type { HpsTransactionResponse } from './transaction-response.js';

/**
 * Macht aus der Terminal-Antwort den Kasseneck-Beleg -- Zwilling von
 * `HobexReceipt.fromHps` (kasseneck_api, `lib/models/hobex_receipt.dart`).
 *
 * Ohne diese Bruecke endet eine gelungene HPS-Zahlung im Nichts: der
 * Buchungsweg erwartet einen Beleg (`cardPaymentData`, siehe
 * [hobexReceiptToCardPaymentData]), und die Antwort des Terminals ist keiner.
 *
 * Drei Eigenheiten, alle am 28.08.2026 am Terminal 3600335 gemessen und
 * nicht aus der Doku uebernommen:
 *
 * 1. **`cvm` kommt als ZAHL** (`3`), nicht als Text. Ungewandelt scheitert
 *    [hobexReceiptNeedsSignature] (`=== '1'`) stumm an einer `1` -- und eine
 *    verlangte Unterschrift bliebe ungefragt. Deshalb ueber [text].
 * 2. **Nicht gefuehrte Felder kommen als `null`** (gemessen: `currency`,
 *    `reference`, `source`, `state`). Sie werden zu LEEREM Text, nie zu
 *    `"null"` -- sonst stuende das Wort auf dem Beleg.
 * 3. `cvm` wird aus [HpsTransactionResponse.raw] gelesen und nicht aus einem
 *    eigenen Feld -- genauso wie im Dart-Vorbild (`res.raw['cvm']`). Der
 *    Rohsatz ist die Quelle, damit hier nichts eigenes danebenlaeuft.
 *
 * Der Betrag geht ueber [euroToCents], die eine gehaertete Stelle des Pakets:
 * die Terminal-Antwort ist eine fremde Antwort, und ein nicht-endlicher Wert
 * ergaebe sonst lautlos `NaN`.
 */
export function hobexReceiptFromHps(res: HpsTransactionResponse): HobexReceipt {
  return {
    transactionId: text(res.transactionId),
    tid: text(res.tid),
    receipt: text(res.receipt),
    approvalCode: text(res.approvalCode),
    reference: res.reference,
    // Bruchteilssekunden samt Zeitzonenversatz kappen und "T" durch ein
    // Leerzeichen ersetzen -- Wort fuer Wort wie im Dart-Vorbild.
    transactionDate: text(res.transactionDate).split('.')[0]!.split('T').join(' '),
    cardNumber: text(res.cardNumber),
    cardExpiry: text(res.cardExpiry),
    brand: text(res.brand),
    cardIssuer: text(res.cardIssuer),
    responseCode: text(res.responseCode),
    transactionType: text(res.transactionType),
    currency: text(res.currency),
    amountCents: euroToCents(res.amount ?? 0),
    tipCents: euroToCents(res.tip ?? 0),
    cvm: text(res.raw.cvm),
    // Der Provider ergibt sich aus dem Weg, nicht aus dem JSON: was hier
    // ankommt, kam ueber HPS. Genau daran haengt, ob
    // [hobexReceiptToCardPaymentData] die HPS-Zusatzfelder mitgibt.
    creditCardProvider: CreditCardProvider.hobexHps,
  };
}

/** `null`/`undefined` werden zu leerem Text, alles andere wortgetreu. */
function text(wert: unknown): string {
  return wert === null || wert === undefined ? '' : String(wert);
}
