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
  type TransportBodyFields,
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
  type ReceiptWithCompany,
  sellReceipt,
  sellReceiptWithCompany,
  cancelReceipt,
  type CancelReceiptResult,
  createCancelReceipt,
  zeroReceipt,
  getReceipt,
  getReceiptWithCompany,
  generateFullReceiptId,
  getFirstReceiptDate,
  listMyReceipts,
  type ListMyReceiptsOptions,
  type ReceiptList,
  type ReceiptListStats,
  checkVoucherCombinationError,
} from './receipts.js';

export { listMyCashregisters } from './cashregisters.js';

export { downloadDailyReport, downloadMonthlyReport } from './reports.js';

export {
  type CashboxStatus,
  type SignatureStatus,
  getCashboxStatus,
  getSignatureStatus,
} from './status.js';

export { type KasseneckApi, createKasseneckApi } from './api.js';
