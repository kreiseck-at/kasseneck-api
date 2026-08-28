/**
 * Hobex-**HPS**-Kartenzahlung ueber **Kasseneck Connect** — den lokalen
 * Geraete-Agenten, der ueber HTTP erreichbar ist und mit dem physischen
 * Terminal spricht. Siehe `payments.ts` fuer den Klaerweg (Doku dort ist der
 * Maszstab) und `connect-client.ts` fuer die Abgrenzung zum Dart-Zwilling
 * `HpsClient` (der das Terminal DIREKT anspricht, ohne Connect).
 *
 * **Zwei benannte Luecken, keine Versehen:**
 *
 * 1. **Nur `pay()` — kein `refund`/`cancel`.** Kasseneck Connect exponiert
 *    (Stand dieses Moduls) keinen Gutschrift- oder Storno-Endpunkt fuers
 *    HPS-Terminal; `POST /v1/terminal/payment` loest am Terminal fest einen
 *    Verkauf aus. Wer am HPS-Terminal eine Gutschrift oder ein Storno
 *    braucht, braucht dafuer heute die Flutter-App `kasseneck_api`
 *    (`HpsClient.refund`/`HpsPayments.cancel`, direkter Terminal-Kontakt).
 *    Diese Luecke schliesst sich erst, wenn Connect selbst die Endpunkte
 *    bekommt — nicht durch etwas, das dieses Paket allein tun koennte.
 * 2. **Keine Adress-/Port-Ermittlung fuer Connect.** Der Agent kann auf
 *    `127.0.0.1:27182` bis `27189` laufen (belegter Port faellt auf den
 *    naechsten zurueck, siehe `kasseneck-connect`s README). Dieses Modul
 *    nimmt eine FESTE `baseUrl` entgegen (`HpsConnectClientOptions.baseUrl`,
 *    Vorgabe `27182`) und probiert die Portreihe nicht selbst durch — das
 *    Aufloesen der tatsaechlichen Adresse (z. B. ueber `GET /v1/status` je
 *    Port) bleibt Sache des Aufrufers.
 */

export {
  type HpsConnectClient,
  type HpsConnectClientOptions,
  type HpsConnectFetch,
  type HpsConnectFetchResponse,
  type HpsConnectPaymentOptions,
  type HpsConnectTarget,
  type HpsConnectTransactionOptions,
  createHpsConnectClient,
} from './connect-client.js';

export {
  HpsClarifyTimeoutError,
  HpsConnectException,
  HpsConnectTerminalError,
  HpsConnectTransportError,
  HpsPreflightError,
  HpsTransactionIdError,
  PREFLIGHT_CONNECT_CODES,
} from './errors.js';

export {
  type HpsPaymentEvent,
  type HpsPaymentEventKind,
  type HpsPaymentObserver,
} from './events.js';

export {
  type CardPaymentOutcome,
  type HpsPaymentResult,
  mayRetrySafely,
} from './outcome.js';

export {
  type HpsPaymentOptions,
  type HpsPayments,
  type HpsPaymentsOptions,
  createHpsPayments,
} from './payments.js';

export {
  MAX_TRANSACTION_ID_LENGTH,
  createHpsTransactionIdGenerator,
  isValidHpsTransactionId,
  newHpsTransactionId,
  type HpsTransactionIdGeneratorOptions,
} from './transaction-id.js';

export {
  ABORTED_CODE,
  APPROVED_CODE,
  CARD_NOT_PRESENT_CODE,
  HPS_MEASURED_CODES,
  INVALID_TRANSACTION_CODE,
  NOT_ABORTABLE_CODE,
  NO_STATEMENT_CODE,
  TECHNICAL_ERROR_CODE,
  TERMINAL_BUSY_HTTP_STATUS,
  TRANSACTION_CANCELED_CODE,
  isApproved,
  isConclusive,
  isInProgress,
  isNoStatement,
  isNotAbortable,
  isTechnicalError,
  isUnknownCode,
  parseHpsTransactionResponse,
  type HpsMeasuredCode,
  type HpsTransactionResponse,
} from './transaction-response.js';
