/**
 * Der Weg vom Vertragsabschluss bis zum ersten Beleg — als Daten, nicht als
 * Fliesstext.
 *
 * **Warum das im Paket steht und nicht nur in der Doku:** die Kette hat eine
 * harte Reihenfolge, und jeder Schritt scheitert mit einem eigenen Code, wenn
 * ein vorheriger fehlt (`fon_missing`, `signature_missing`,
 * `signature_not_ready`).
 * Wer die Reihenfolge nur aus einer Fehlermeldung lernt, lernt sie einmal je
 * Fehler. Hier steht sie vorher — abfragbar, ausgebbar, und in
 * [naechsterSchritt] auch beantwortbar.
 *
 * **Ohne Vertragsschritt.** Auftragsverarbeitungsvertraege wirken in diesem
 * Weg nicht mehr (Stand 2026-08-31): kein Aufruf meldet einen, keine Kasse
 * bleibt deswegen stehen.
 *
 * Zwei Dinge laufen bewusst **parallel**: der Signaturantrag und das Anlegen
 * der Kasse. Eine mit `automatisch:true` angelegte Kasse wartet, bis die
 * Signatur bereit ist, und geht dann von selbst live. Der Kundenstatus nennt
 * darum immer nur den **weitesten erreichten** Meilenstein, nicht die einzige
 * laufende Arbeit.
 */

import type { KundenStatus } from './typen.js';

/** Ein Schritt der Kette. */
export interface AblaufSchritt {
  key: string;
  /** Was in diesem Schritt passiert. */
  text: string;
  /** Der Aufruf, der ihn ausloest — `null`, wenn hier nur gewartet wird. */
  aufruf: string | null;
  /** Das Ereignis, das seinen Abschluss meldet — `null`, wenn es sofort feststeht. */
  wartetAuf: string | null;
  /** Der Fehlercode, mit dem ein spaeterer Aufruf sich beschwert, wenn dieser Schritt fehlt. */
  fehltCode: string | null;
}

/**
 * Die Kette in ihrer Reihenfolge. Sie beschreibt den **Live-Weg**; mit einem
 * `pk_test_`-Schluessel entfallen die FinanzOnline-Schritte, und die Signatur
 * ist sofort bereit (AT100-Testkarte — die damit erzeugten Belege sind keine
 * gueltigen RKSV-Belege).
 */
export const PARTNER_ABLAUF: readonly AblaufSchritt[] = [
  {
    key: 'betrieb',
    text: 'Betrieb anlegen (idempotencyKey = eigene Kundennummer).',
    aufruf: 'createPartnerCustomer',
    wartetAuf: 'customer.created',
    fehltCode: null,
  },
  {
    key: 'fon',
    text: 'FinanzOnline einrichten: Link an den Betrieb, der Betrieb traegt seinen Zugang ein.',
    aufruf: 'sendPartnerCustomerFonLink',
    wartetAuf: 'customer.fon_verified',
    fehltCode: 'fon_missing',
  },
  {
    key: 'signatur',
    text: 'Signatureinheit beantragen. Kasseneck weist eine Karte zu und meldet sie bei FinanzOnline an.',
    aufruf: 'requestCustomerSignature',
    wartetAuf: 'signature.ready',
    fehltCode: 'signature_missing',
  },
  {
    key: 'kasse',
    text:
      'Kasse anlegen. Mit automatisch:true (Vorgabe) geht sie von selbst live, sobald die Signatur bereit ist — ' +
      'sie darf deshalb schon vorher angelegt werden.',
    aufruf: 'createCustomerCashregister',
    wartetAuf: 'cashregister.live',
    fehltCode: 'cashregister_not_found',
  },
  {
    key: 'zugangsdaten',
    text: 'Zugangsdaten des Betriebs holen (Scope credentials:read). Geheimnisse — nur verschluesselt speichern.',
    aufruf: 'getCustomerCredentials',
    wartetAuf: null,
    fehltCode: null,
  },
  {
    key: 'belege',
    text: 'Belege signieren: Bearer = apiKey des Betriebs, Kopfzeile cashregister-token = Token der Kasse.',
    aufruf: 'createReceipt',
    wartetAuf: null,
    fehltCode: null,
  },
] as const;

/**
 * Welcher Meilenstein einem Kundenstatus entspricht. Die Zuordnung ist
 * absichtlich grob: der Status nennt den weitesten erreichten Punkt, nicht die
 * laufende Arbeit — fuer den genauen Verlauf sind die Ereignisse `signature.*`
 * und `cashregister.*` da.
 */
const STATUS_SCHRITT: Record<string, string> = {
  angelegt: 'fon',
  fon_eingerichtet: 'signatur',
  signatur_beantragt: 'signatur',
  signatur_bereit: 'kasse',
  kasse_angelegt: 'kasse',
  live: 'zugangsdaten',
};

/**
 * Der Schritt, an dem ein Betrieb mit diesem Status steht — `null` fuer
 * `gesperrt` und fuer jeden Status, den dieses Paket nicht kennt.
 */
export function naechsterSchritt(status: KundenStatus): AblaufSchritt | null {
  const key = STATUS_SCHRITT[status];
  return key ? PARTNER_ABLAUF.find((s) => s.key === key) ?? null : null;
}
