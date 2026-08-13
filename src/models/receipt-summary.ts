import { KeckPaymentMethod, ReceiptType } from '../enums/index.js';
import { euroToCents } from '../money.js';
import { readEnumKey } from './enum-payload.js';

/**
 * Belegzeile einer Liste — die Form, die `listMyReceipts` liefert
 * (`projectReceiptForCustomer` in functions/index.js).
 *
 * **Das ist kein [Receipt].** Die Liste traegt bewusst nur, was eine Uebersicht
 * braucht: keine Positionen, keine Gutscheine, keine Signatur, keinen QR-Code.
 * Wer einen Beleg nachdrucken oder stornieren will, holt ihn ueber
 * `getReceipt`/`getReceiptWithCompany` einzeln — dort steht der vollstaendige,
 * signierte Beleg.
 *
 * `total` kommt vom Backend in **Euro** (auf zwei Stellen gerundet, `round2`).
 * Dieses Paket rechnet ausnahmslos in ganzen Cent, deshalb wird der Betrag
 * genau hier, an der Antwortgrenze, einmal umgerechnet — wie beim
 * Hobex-Beleg.
 *
 * `receiptType` und `paymentMethod` sind wie ueberall beim Lesen entweder der
 * bekannte Enum-Eintrag oder der rohe Nutzlast-Schluessel (siehe
 * enum-payload.ts): eine Liste darf nicht daran scheitern, dass ein einzelner
 * Beleg eine Zahlungsart traegt, die dieses Paket noch nicht kennt.
 */
export interface ReceiptSummary {
  receiptId: string;
  /** Fortlaufender Belegzaehler der Kasse; fehlt bei Alt-Belegen. */
  counter?: number;
  receiptType: ReceiptType | string;
  /** Roher Belegzeitstempel; Deutung ueber `parseServerTimeStamp`. */
  timeStamp: string;
  /** Belegsumme in ganzen Cent. */
  totalCents: number;
  paymentMethod: KeckPaymentMethod | string;
  /** `'success'`/`'failed'` der FinanzOnline-Uebermittlung, sofern bekannt. */
  transmissionStatus?: string;
  /** Zeitstempel der Uebermittlung, roh wie vom Finanzamt geliefert. */
  transmissionTime?: string;
  /**
   * Wurde der Beleg mit funktionierender Signatureinheit ausgestellt? Das
   * Backend meldet hier `signatureSuccess !== false`, also `true`, solange
   * nichts Gegenteiliges vermerkt ist.
   */
  signatureOk: boolean;
}

export interface ReceiptSummaryPayload {
  receiptId?: string | null;
  counter?: number | null;
  receiptType?: string | null;
  timeStamp?: string | null;
  /** Belegsumme in **Euro** (siehe Klassenkommentar). */
  total?: number | null;
  paymentMethod?: string | null;
  transmission_status?: string | null;
  ts_transmission?: string | null;
  signature_ok?: boolean | null;
}

export function fromReceiptSummaryPayload(payload: ReceiptSummaryPayload): ReceiptSummary {
  return {
    receiptId: payload.receiptId ?? '',
    ...(typeof payload.counter === 'number' ? { counter: payload.counter } : {}),
    receiptType: readEnumKey(ReceiptType, payload.receiptType ?? ''),
    timeStamp: payload.timeStamp ?? '',
    totalCents: euroToCents(payload.total),
    paymentMethod: readEnumKey(KeckPaymentMethod, payload.paymentMethod ?? ''),
    ...(payload.transmission_status ? { transmissionStatus: payload.transmission_status } : {}),
    ...(payload.ts_transmission ? { transmissionTime: payload.ts_transmission } : {}),
    // Nur ein ausdrueckliches `false` heisst "ausgefallen" — genau wie im
    // Backend, das hier `signatureSuccess !== false` sendet.
    signatureOk: payload.signature_ok !== false,
  };
}
