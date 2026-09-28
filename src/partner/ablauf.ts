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
 * [nextFlowStep] auch beantwortbar.
 *
 * **Kein eigener Vertragsschritt.** AVV und Nutzungsvertrag bestaetigt der
 * Betrieb ueber denselben Einrichtungs-Link wie seinen FinanzOnline-Zugang
 * (Schritt `fon`). Live geht ohne beide keine Kasse live
 * (`contracts_pending`); den Stand zeigen `avv` und `terms` am Betrieb.
 *
 * Zwei Dinge laufen bewusst **parallel**: der Signaturantrag und das Anlegen
 * der Kasse. Eine mit `automatic:true` angelegte Kasse wartet, bis die
 * Signatur bereit ist, und geht dann von selbst live. Der Kundenstatus nennt
 * darum immer nur den **weitesten erreichten** Meilenstein, nicht die einzige
 * laufende Arbeit.
 */

import type { PartnerCustomerStatus } from './typen.js';

/** Ein Schritt der Kette. */
export interface FlowStep {
  key: string;
  /** Was in diesem Schritt passiert. */
  text: string;
  /** Der Aufruf, der ihn ausloest — `null`, wenn hier nur gewartet wird. */
  call: string | null;
  /** Das Ereignis, das seinen Abschluss meldet — `null`, wenn es sofort feststeht. */
  waitsFor: string | null;
  /** Der Fehlercode, mit dem ein spaeterer Aufruf sich beschwert, wenn dieser Schritt fehlt. */
  missingCode: string | null;
}

/**
 * Die Kette in ihrer Reihenfolge. Sie beschreibt den **Live-Weg**; mit einem
 * `pk_test_`-Schluessel entfallen die FinanzOnline-Schritte, und die Signatur
 * ist sofort bereit (AT100-Testkarte — die damit erzeugten Belege sind keine
 * gueltigen RKSV-Belege).
 */
export const PARTNER_FLOW: readonly FlowStep[] = [
  {
    key: 'business',
    text: 'Betrieb anlegen (idempotencyKey = eigene Kundennummer).',
    call: 'createPartnerCustomer',
    waitsFor: 'customer.created',
    missingCode: null,
  },
  {
    key: 'fon',
    text: 'FinanzOnline einrichten: Link an den Betrieb, der Betrieb traegt seinen Zugang ein.',
    call: 'sendPartnerCustomerFonLink',
    waitsFor: 'customer.fon_verified',
    missingCode: 'fon_missing',
  },
  {
    key: 'signature',
    text: 'Signatureinheit beantragen. Kasseneck weist eine Karte zu und meldet sie bei FinanzOnline an.',
    call: 'requestCustomerSignature',
    waitsFor: 'signature.ready',
    missingCode: 'signature_missing',
  },
  {
    key: 'cashregister',
    text:
      'Kasse anlegen. Mit automatic:true (Vorgabe) geht sie von selbst live, sobald die Signatur bereit ist — ' +
      'sie darf deshalb schon vorher angelegt werden.',
    call: 'createCustomerCashregister',
    waitsFor: 'cashregister.live',
    missingCode: 'cashregister_not_found',
  },
  {
    key: 'credentials',
    text: 'Zugangsdaten des Betriebs holen (Scope credentials:read). Geheimnisse — nur verschluesselt speichern.',
    call: 'getCustomerCredentials',
    waitsFor: null,
    missingCode: null,
  },
  {
    key: 'receipts',
    text: 'Belege signieren: Bearer = apiKey des Betriebs, Kopfzeile cashregister-token = Token der Kasse.',
    call: 'createReceipt',
    waitsFor: null,
    missingCode: null,
  },
] as const;

/**
 * Welcher Meilenstein einem Kundenstatus entspricht. Die Zuordnung ist
 * absichtlich grob: der Status nennt den weitesten erreichten Punkt, nicht die
 * laufende Arbeit — fuer den genauen Verlauf sind die Ereignisse `signature.*`
 * und `cashregister.*` da.
 */
const STATUS_SCHRITT: Record<string, string> = {
  created: 'fon',
  fon_configured: 'signature',
  signature_requested: 'signature',
  signature_ready: 'cashregister',
  cashregister_created: 'cashregister',
  live: 'credentials',
};

/**
 * Der Schritt, an dem ein Betrieb mit diesem Status steht — `null` fuer
 * `blocked` und fuer jeden Status, den dieses Paket nicht kennt.
 */
export function nextFlowStep(status: PartnerCustomerStatus): FlowStep | null {
  const key = STATUS_SCHRITT[status];
  return key ? PARTNER_FLOW.find((s) => s.key === key) ?? null : null;
}
