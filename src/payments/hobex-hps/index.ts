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
  isHostUncertainResult,
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
  APP_SELECT_FAILED_CODE,
  APPROVED_CODE,
  BAD_REQUEST_CODE,
  CARD_DECLINED_CODE,
  CARD_INFO_NOT_ENTERED_CODE,
  CARD_NOT_PRESENT_CODE,
  CARD_NOT_SUPPORTED_CODE,
  CARD_READ_FAILED_CODE,
  CHIP_DATA_MISMATCH_CODE,
  COMPLETION_FAILED_CODE,
  DIAGNOSIS_FAILED_CODE,
  HOST_COMMUNICATION_FAILED_CODE,
  HOST_STEP_FAILED_CODE,
  HOST_TIMEOUT_REVERSED_CODE,
  HPS_CODES,
  HPS_MEASURED_CODES,
  HPS_REASON_HINTS,
  INTERNAL_ERROR_CODE,
  INVALID_MESSAGE_TYPE_CODE,
  INVALID_TID_DOCUMENTED_CODE,
  INVALID_TX_TYPE_CODE,
  MAX_RETRIES_EXCEEDED_CODE,
  NOT_FOUND_CODE,
  PASSWORD_NOT_ENTERED_CODE,
  REFUND_DISABLED_CODE,
  REFUND_PASSWORD_INVALID_CODE,
  SCEP_ENROLLMENT_FAILED_CODE,
  TERMINAL_BLOCKED_CODE,
  TERMINAL_BUSY_CODE,
  TIP_SELECTION_FAILED_CODE,
  UNSUPPORTED_USER_DATA_CODE,
  hpsCodeInfo,
  hpsCodeReason,
  isHostUncertain,
  isHostUncertainReason,
  INVALID_TRANSACTION_CODE,
  NOT_ABORTABLE_CODE,
  INVALID_AMOUNT_CODE,
  AMOUNT_OUT_OF_RANGE_CODE,
  INVALID_TID_CODE,
  WRONG_PIN_CODE,
  NO_STATEMENT_CODE,
  TECHNICAL_ERROR_CODE,
  NOT_FOUND_HTTP_STATUS,
  TERMINAL_BUSY_HTTP_STATUS,
  TRANSACTION_CANCELED_CODE,
  isApproved,
  isCanceled,
  isConclusive,
  isConclusiveAsStatus,
  isInProgress,
  isNoStatement,
  isNotAbortable,
  isTechnicalError,
  isUnknownCode,
  parseHpsTransactionResponse,
  type HpsCode,
  type HpsCodeEffect,
  type HpsCodeReason,
  type HpsCodeSource,
  type HpsMeasuredCode,
  type HpsTransactionResponse,
} from './transaction-response.js';

export { hobexReceiptFromHps } from './receipt.js';
