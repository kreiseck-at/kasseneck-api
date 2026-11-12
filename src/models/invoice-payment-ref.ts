/**
 * Zahlung auf Rechnung (`invoicePayments` am Beleg, Backend `rechnungszahlung`):
 * Ein Zahlungsbeleg nimmt in der Kasse Geld fuer eine oder mehrere Rechnungen
 * entgegen (bar oder mit Karte vor Ort) bzw. gibt es zu einer Gutschrift
 * zurueck. Seine Positionen tragen `kind: 'invoice_payment'` und zaehlen im
 * RKSV-Feld „Null“; die Umsatzsteuer steht auf der Rechnung, nicht am Beleg.
 *
 * Je Rechnung ein Bezug, in der Reihenfolge der Positionen (eine Zeile je
 * Rechnung). Der Bezug ist nicht signiert (wie `cancellationOf`), die
 * Rechnungsnummer steht zusaetzlich im Text der Position.
 *
 * Nur der Server legt solche Belege an; dieses Paket liest sie nur.
 */
export interface InvoicePaymentRef {
  invoiceId: string;
  /** Nummer der Rechnung bzw. Gutschrift aus ihrem Rechnungskreis (`2026-0042`). */
  invoiceNumber: string;
  /** Kennung des Zahlungseintrags an der Rechnung. */
  paymentId: string;
  customerId: string | null;
  /** Betrag dieser Zeile in Cent; bei einer Rueckzahlung zu einer Gutschrift negativ. */
  amountCents: number;
  /** Teilzahlung: weniger als der Rechnungsbetrag. */
  partial: boolean;
  /** Zahlungstag `YYYY-MM-DD` (Wiener Tag), `null` wenn unbekannt. */
  paidOn: string | null;
  /**
   * Steuerhinweis unter der Position: `incl_vat` (die Rechnung weist Umsatzsteuer aus), `zero_percent`
   * (steuerfrei oder nicht steuerbar) oder `see_invoice` (Reverse Charge). Fehlt er, steht kein Hinweis.
   */
  taxNote?: InvoicePaymentTaxNote;
}

/** Werte von [InvoicePaymentRef.taxNote] (gespeichert `inkl_ust` | `null_prozent` | `siehe_rechnung`). */
export type InvoicePaymentTaxNote = 'incl_vat' | 'zero_percent' | 'see_invoice';

const STEUERHINWEISE: readonly string[] = ['incl_vat', 'zero_percent', 'see_invoice'];

const istText = (w: unknown): w is string => typeof w === 'string' && w !== '';

/**
 * Liest `invoicePayments` vom Draht. Ein Eintrag ohne Rechnungs-ID, Nummer,
 * Zahlungs-ID oder ganzzahligen Betrag faellt weg (lesen tolerant, der Beleg
 * bleibt anzeigbar); ohne brauchbaren Eintrag gibt es keinen Bezug
 * (`undefined`). Ein unbekannter oder fehlender `taxNote` ergibt keinen
 * Hinweis: ein Beleg behauptet nie eine Steuer, die er nicht kennt.
 */
export function readInvoicePaymentRefs(roh: unknown): InvoicePaymentRef[] | undefined {
  if (!Array.isArray(roh)) return undefined;
  const raus: InvoicePaymentRef[] = [];
  for (const e of roh) {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    if (!istText(o['invoiceId']) || !istText(o['invoiceNumber']) || !istText(o['paymentId'])) continue;
    if (!Number.isSafeInteger(o['amountCents'])) continue;
    const hinweis = o['taxNote'];
    raus.push({
      invoiceId: o['invoiceId'],
      invoiceNumber: o['invoiceNumber'],
      paymentId: o['paymentId'],
      customerId: istText(o['customerId']) ? o['customerId'] : null,
      amountCents: o['amountCents'] as number,
      partial: o['partial'] === true,
      paidOn: istText(o['paidOn']) ? o['paidOn'] : null,
      ...(typeof hinweis === 'string' && STEUERHINWEISE.includes(hinweis) ? { taxNote: hinweis as InvoicePaymentTaxNote } : {}),
    });
  }
  return raus.length > 0 ? raus : undefined;
}
