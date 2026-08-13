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
  createTransport,
} from './transport.js';

export {
  KasseneckApiError,
  KasseneckAuthError,
  KasseneckHttpError,
  KasseneckNetworkError,
  type KasseneckError,
  type HttpFailureReason,
  type CauseDigest,
  isKasseneckApiError,
  isKasseneckAuthError,
  isKasseneckHttpError,
  isKasseneckNetworkError,
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

export { type KasseneckApi, createKasseneckApi } from './api.js';
