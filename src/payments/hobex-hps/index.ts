/**
 * Hobex-**HPS**-Kartenzahlung ueber **Kasseneck Connect** — den lokalen
 * Geraete-Agenten, der ueber HTTP erreichbar ist und mit dem physischen
 * Terminal spricht. Siehe `payments.ts` fuer den Klaerweg (Doku dort ist der
 * Maszstab) und `connect-client.ts` fuer die Abgrenzung zum Dart-Zwilling
 * `HpsClient` (der das Terminal DIREKT anspricht, ohne Connect).
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
