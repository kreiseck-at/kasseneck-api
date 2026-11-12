/**
 * Zahlung auf Rechnung (`rechnungszahlung` am Beleg, innere Form wie das Backend sie
 * ablegt; unter `/v3` heisst das Feld `invoicePayments`): Ein Zahlungsbeleg nimmt in der
 * Kasse Geld fuer eine oder mehrere Rechnungen entgegen (bar oder mit Karte vor Ort) bzw.
 * gibt es zu einer Gutschrift zurueck. Seine Positionen tragen `kind: 'invoice_payment'`
 * und zaehlen im RKSV-Feld „Null“; die Umsatzsteuer steht auf der Rechnung, nicht am Beleg.
 *
 * Je Rechnung ein Bezug, in der Reihenfolge der Positionen (eine Zeile je Rechnung). Der
 * Bezug ist nicht signiert (wie `cancellationOf`), die Rechnungsnummer steht zusaetzlich im
 * Text der Position.
 *
 * Nur der Server legt solche Belege an; dieses Paket liest sie nur.
 */
export interface Rechnungszahlung {
  invoiceId: string;
  /** Nummer der Rechnung bzw. Gutschrift aus ihrem Rechnungskreis (`2026-0042`). */
  nummer: string;
  /** Kennung des Zahlungseintrags an der Rechnung. */
  paymentId: string;
  kundeId: string | null;
  /** Betrag dieser Zeile in Cent; bei einer Rueckzahlung zu einer Gutschrift negativ. */
  betragCents: number;
  /** Teilzahlung: weniger als der Rechnungsbetrag. */
  teil: boolean;
  /** Zahlungstag `YYYY-MM-DD` (Wiener Tag), `null` wenn unbekannt. */
  zahlungVom: string | null;
  /**
   * Steuerhinweis am Beleg: `inkl_ust` (die Rechnung weist Umsatzsteuer aus), `null_prozent`
   * (steuerfrei oder nicht steuerbar, auch Kleinunternehmer) oder `siehe_rechnung` (Reverse
   * Charge). `undefined`: kein Hinweis.
   */
  steuerhinweis?: Steuerhinweis;
}

export type Steuerhinweis = 'inkl_ust' | 'null_prozent' | 'siehe_rechnung';

const STEUERHINWEISE: readonly string[] = ['inkl_ust', 'null_prozent', 'siehe_rechnung'];

const istText = (w: unknown): w is string => typeof w === 'string' && w !== '';

/**
 * Liest `rechnungszahlung`. Ein Eintrag ohne Rechnungs-ID, Nummer, Zahlungs-ID oder
 * ganzzahligen Betrag faellt weg (lesen tolerant, der Beleg bleibt anzeigbar); ohne
 * brauchbaren Eintrag gibt es keinen Bezug (`undefined`). Ein unbekannter oder fehlender
 * `steuerhinweis` ergibt keinen Hinweis: ein Beleg behauptet nie eine Steuer, die er nicht kennt.
 */
export function leseRechnungszahlung(roh: unknown): Rechnungszahlung[] | undefined {
  if (!Array.isArray(roh)) return undefined;
  const raus: Rechnungszahlung[] = [];
  for (const e of roh) {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    if (!istText(o['invoiceId']) || !istText(o['nummer']) || !istText(o['paymentId'])) continue;
    if (!Number.isSafeInteger(o['betragCents'])) continue;
    const hinweis = o['steuerhinweis'];
    raus.push({
      invoiceId: o['invoiceId'],
      nummer: o['nummer'],
      paymentId: o['paymentId'],
      kundeId: istText(o['kundeId']) ? o['kundeId'] : null,
      betragCents: o['betragCents'] as number,
      teil: o['teil'] === true,
      zahlungVom: istText(o['zahlungVom']) ? o['zahlungVom'] : null,
      ...(typeof hinweis === 'string' && STEUERHINWEISE.includes(hinweis) ? { steuerhinweis: hinweis as Steuerhinweis } : {}),
    });
  }
  return raus.length > 0 ? raus : undefined;
}
