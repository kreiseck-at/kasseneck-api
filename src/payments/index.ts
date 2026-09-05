/**
 * Unterpfad `@kreiseck/kasseneck-api/payments` — die Zahlungswege, die ein
 * Browser oder ein Node-Prozess wirklich gehen kann: **Stripe-Zahlungslinks**
 * (Fernzahlung per Link/QR-Code), die **Hobex-Cloud-API** (Kartenzahlung
 * ueber ein bei Hobex registriertes Terminal, gesteuert ueber das Netz) und
 * **Hobex HPS ueber Kasseneck Connect** (`./hobex-hps.js`) — ein physisches
 * Terminal im Kassen-Netz, angesprochen ueber den lokalen Geraete-Agenten.
 *
 * **Was hier bewusst fehlt — und warum es auch nicht nachgeruestet wird:**
 *
 * - **myPOS** und **SumUp** sind **Android-SDKs**; sie laufen als
 *   Bibliothek in einer Android-App und reden ueber Bluetooth bzw. das
 *   Hersteller-Geraet mit dem Terminal. Ein Browser hat keine
 *   Android-Laufzeit — das ist keine Luecke in diesem Paket und auch nichts,
 *   was ein Buendler, ein Polyfill oder WebAssembly aufloest.
 *
 * **Frueherer Stand, ueberholt:** hier stand einmal, Hobex HPS sei mangels
 * roher TCP-Sockets im Browser unerreichbar. Das galt fuer den DIREKTEN
 * Terminal-Kontakt (Zwilling: `HpsClient` in `kasseneck_api`) und gilt dafuer
 * weiterhin — aber **Kasseneck Connect** ist ein lokaler Geraete-Agent, der
 * ueber gewoehnliches HTTP erreichbar ist und **fuer** die Kasse mit dem
 * Terminal spricht. Das ist kein Widerspruch zur Umgebungsgrenze, sondern ein
 * zweiter, seit `hobex-hps.js` genutzter Weg um sie herum.
 *
 * Wer Gutschrift oder Storno am HPS-Terminal braucht, braucht weiterhin die
 * Flutter-App: Connect exponiert dafuer (noch) keinen Endpunkt, siehe
 * `hobex-hps/connect-client.ts`.
 *
 * **Kassen-Benutzer-Weg (`registerUserAuth`, Browser-Kasse):** **Keiner** der
 * vier Cloud-Zahlungs-Endpunkte (Stripe, Hobex-Cloud) setzt `allowRegisterUser`;
 * sie laufen alle ueber `checkRequest(req, 'user', …)` und damit nur mit
 * `apiKeyAuth`. Dieses Paket bildet das **nicht** nach — wer darf, entscheidet
 * allein das Backend. Der Hinweis steht **hier** und gilt fuer die beiden
 * Cloud-Dateien dieses Unterpfads; `hobex-hps.js` spricht kein Kasseneck-Backend
 * und kennt diese Unterscheidung nicht — dort entscheidet allein der
 * Kopplungstoken von Kasseneck Connect.
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

export {
  type CardPaymentOutcome,
  type HpsConnectClient,
  type HpsConnectClientOptions,
  type HpsConnectFetch,
  type HpsConnectFetchResponse,
  type HpsConnectPaymentOptions,
  type HpsConnectTarget,
  type HpsConnectTransactionOptions,
  type HpsMeasuredCode,
  type HpsPaymentEvent,
  type HpsPaymentEventKind,
  type HpsPaymentObserver,
  type HpsPaymentOptions,
  type HpsPayments,
  type HpsPaymentResult,
  type HpsPaymentsOptions,
  type HpsTransactionIdGeneratorOptions,
  type HpsTransactionResponse,
  ABORTED_CODE,
  APPROVED_CODE,
  CARD_NOT_PRESENT_CODE,
  createHpsConnectClient,
  createHpsPayments,
  createHpsTransactionIdGenerator,
  HPS_MEASURED_CODES,
  HpsClarifyTimeoutError,
  HpsConnectException,
  HpsConnectTerminalError,
  HpsConnectTransportError,
  HpsPreflightError,
  HpsTransactionIdError,
  INVALID_TRANSACTION_CODE,
  isApproved,
  isConclusive,
  isInProgress,
  isNoStatement,
  isNotAbortable,
  isTechnicalError,
  isUnknownCode,
  isValidHpsTransactionId,
  mayRetrySafely,
  MAX_TRANSACTION_ID_LENGTH,
  newHpsTransactionId,
  NOT_ABORTABLE_CODE,
  NO_STATEMENT_CODE,
  parseHpsTransactionResponse,
  PREFLIGHT_CONNECT_CODES,
  TECHNICAL_ERROR_CODE,
  TERMINAL_BUSY_HTTP_STATUS,
  TRANSACTION_CANCELED_CODE,
} from './hobex-hps/index.js';
