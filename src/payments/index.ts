/**
 * Unterpfad `@kreiseck/kasseneck-api/payments` — die Zahlungswege, die ein
 * Browser oder ein Node-Prozess wirklich gehen kann: **Stripe-Zahlungslinks**
 * (Fernzahlung per Link/QR-Code) und die **Hobex-Cloud-API** (Kartenzahlung
 * ueber ein bei Hobex registriertes Terminal, gesteuert ueber das Netz).
 *
 * **Was hier bewusst fehlt — und warum es auch nicht nachgeruestet wird:**
 *
 * - **Hobex HPS** spricht **lokal ueber TCP** mit einem angeschlossenen
 *   Terminal (roher Socket auf eine Geraete-IP im selben Netz).
 * - **myPOS** und **SumUp** sind **Android-SDKs**; sie laufen als
 *   Bibliothek in einer Android-App und reden ueber Bluetooth bzw. das
 *   Hersteller-Geraet mit dem Terminal.
 *
 * Ein Browser hat weder rohe TCP-Sockets noch eine Android-Laufzeit. Das ist
 * keine Luecke in diesem Paket und auch nichts, was ein anderer Buendler,
 * ein Polyfill oder eine WebAssembly-Schicht aufloest — es ist eine Grenze der
 * Umgebung. Diese drei Wege gibt es im Flutter-Paket `kasseneck_api`, und dort
 * bleiben sie.
 *
 * **Kassen-Benutzer-Weg (`registerUserAuth`, Browser-Kasse):** **Keiner** der
 * vier Zahlungs-Endpunkte setzt `allowRegisterUser`; sie laufen alle ueber
 * `checkRequest(req, 'user', …)` und damit nur mit `apiKeyAuth`. Dieses Paket
 * bildet das **nicht** nach — wer darf, entscheidet allein das Backend. Der
 * Hinweis steht **hier** und gilt fuer beide Dateien dieses Unterpfads.
 *
 * Welche **anderen** Endpunkte den Weg offen haben, steht bewusst nirgends in
 * diesem Paket: eine abgeschriebene Liste veraltet still, und sie hat hier
 * nichts zu entscheiden.
 */

export { StripeLinkMode, type StripeLinkModeKey } from '../enums/index.js';

export {
  type CreateStripeLinkOptions,
  type StripeCaptureResult,
  createStripeLink,
  stripeCaptureIntent,
} from './stripe.js';

export {
  type HobexPayOptions,
  type HobexRefundOptions,
  type HobexTransactionIdOptions,
  hobexPay,
  hobexRefund,
  newHobexTransactionId,
} from './hobex.js';
