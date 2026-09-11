/**
 * Beleg per E-Mail — Zwilling von `functions/beleg-mail-core.js`.
 *
 * Hier steht nur der Fehlercode-Katalog: der Aufruf selbst ist
 * [sendReceiptEmail] (client/receipts.ts), und was verschickt wird, ist ein
 * **Link auf die oeffentliche Belegseite** — der Beleg selbst bleibt
 * unberuehrt (BAO §131/RKSV), das Versandprotokoll fuehrt das Backend in einer
 * Unter-Sammlung neben ihm.
 */

/**
 * Stabile Fehlercodes von `sendReceiptEmail` — Zwilling von
 * `beleg-mail-core.js` FEHLERCODES. Das Backend legt sie bei jedem fachlichen
 * Fehler als `code` neben die Meldung; das Paket reicht sie als
 * [KasseneckApiError.code] durch. **Entscheide am Code, nie am Text** — die
 * deutsche Meldung darf sich aendern, der Code nicht.
 *
 * Nur Auth-/Parameterfehler (Sitzung abgelaufen, Pflichtfeld fehlt) kommen
 * ohne Code; dort bleibt `code` undefined.
 */
export const RECEIPT_EMAIL_ERROR_CODES = [
  'adresse_ungueltig',        // Empfaengeradresse unbrauchbar (Pruefung im Backend)
  'beleg_nicht_gefunden',     // Beleg gibt es nicht ODER er gehoert einer anderen Kasse
  'zu_oft',                   // Schleuse: 5 Mails je Beleg (24 h), 30 je Kasse und Stunde
  'versand_fehlgeschlagen',   // die Mail selbst ging nicht hinaus
] as const;

export type ReceiptEmailErrorCode = (typeof RECEIPT_EMAIL_ERROR_CODES)[number];

export function isReceiptEmailErrorCode(value: unknown): value is ReceiptEmailErrorCode {
  return typeof value === 'string' && (RECEIPT_EMAIL_ERROR_CODES as readonly string[]).includes(value);
}
