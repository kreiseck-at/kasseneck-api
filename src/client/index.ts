export {
  type AuthCredentials,
  type KasseneckAuth,
  type ApiKeyAuthOptions,
  type RegisterUserAuthOptions,
  apiKeyAuth,
  registerUserAuth,
} from './auth.js';

export {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  type HttpResponseLike,
  type HttpRequestInit,
  type FetchLike,
  type TransportOptions,
  type KasseneckTransport,
  type KasseneckBinaryTransport,
  createTransport,
  createBinaryTransport,
} from './transport.js';

export {
  KasseneckApiError,
  KasseneckAuthError,
  KasseneckHttpError,
  KasseneckNetworkError,
  KasseneckValidationError,
  type ValidationScope,
  type KasseneckError,
  type HttpFailureReason,
  type CauseDigest,
  isKasseneckApiError,
  isKasseneckAuthError,
  isKasseneckHttpError,
  isKasseneckNetworkError,
  isKasseneckValidationError,
} from './errors.js';

export {
  type ReceiptCommonOptions,
  type SellReceiptOptions,
  type CancelReceiptOptions,
  type CreateCancelReceiptOptions,
  sellReceipt,
  cancelReceipt,
  createCancelReceipt,
  zeroReceipt,
  getReceipt,
  generateFullReceiptId,
  getFirstReceiptDate,
  checkVoucherCombinationError,
} from './receipts.js';

export { downloadDailyReport, downloadMonthlyReport } from './reports.js';

export {
  type CashboxStatus,
  type SignatureStatus,
  getCashboxStatus,
  getSignatureStatus,
} from './status.js';

export { type KasseneckApi, createKasseneckApi } from './api.js';
