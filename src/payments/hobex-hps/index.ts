/**
 * Hobex-**HPS**-Kartenzahlung ueber **Kasseneck Connect** — den lokalen
 * Geraete-Agenten, der ueber HTTP erreichbar ist und mit dem physischen
 * Terminal spricht. Siehe `payments.ts` fuer den Klaerweg (Doku dort ist der
 * Maszstab) und `connect-client.ts` fuer die Abgrenzung zum Dart-Zwilling
 * `HpsClient` (der das Terminal DIREKT anspricht, ohne Connect).
 *
 * `pay`/`refund`/`cancel` — seit `kasseneck-connect` Commit `1c8a003` traegt
 * Connect auch Gutschrift und Aufhebung, die Luecke aus einer frueheren
 * Fassung dieses Moduls ist geschlossen.
 *
 * **Verbleibt: keine Adress-/Port-Ermittlung fuer Connect.** Der Agent kann
 * auf `127.0.0.1:27182` bis `27189` laufen (belegter Port faellt auf den
 * naechsten zurueck, siehe `kasseneck-connect`s README). Dieses Modul nimmt
 * eine FESTE `baseUrl` entgegen (`HpsConnectClientOptions.baseUrl`, Vorgabe
 * `27182`) und probiert die Portreihe nicht selbst durch — das Aufloesen der
 * tatsaechlichen Adresse (z. B. ueber `GET /v1/status` je Port) bleibt Sache
 * des Aufrufers.
 */

export {
  type HpsConnectCancelOptions,
  type HpsConnectClient,
  type HpsConnectClientOptions,
  type HpsConnectFetch,
  type HpsConnectFetchResponse,
  type HpsConnectPaymentOptions,
  type HpsConnectRefundOptions,
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
  type HpsCancelOptions,
  type HpsPaymentOptions,
  type HpsPayments,
  type HpsPaymentsOptions,
  type HpsRefundOptions,
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
  INVALID_AMOUNT_CODE,
  AMOUNT_OUT_OF_RANGE_CODE,
  INVALID_TID_CODE,
  NO_STATEMENT_CODE,
  NOT_FOUND_HTTP_STATUS,
  TECHNICAL_ERROR_CODE,
  TERMINAL_BUSY_HTTP_STATUS,
  TRANSACTION_CANCELED_CODE,
  isApproved,
  isCanceled,
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

export { hobexReceiptFromHps } from './receipt.js';
