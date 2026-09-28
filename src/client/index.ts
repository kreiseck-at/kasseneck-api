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
  POS_BASE_URL,
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
  ALL_CALLS,
  type ApiCall,
  PUBLIC_CALLS,
  POS_CALLS,
  type PublicCall,
  type PosCall,
} from './aufrufe.js';

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
  type ErrorOutcome,
  isKasseneckApiError,
  isKasseneckAuthError,
  isKasseneckHttpError,
  isKasseneckNetworkError,
  isKasseneckValidationError,
  isOutcomeUnknown,
} from './errors.js';

export {
  type ReceiptCommonOptions,
  type SellReceiptOptions,
  type TipOptions,
  type TipRecipientShare,
  type CancelReceiptOptions,
  type ReceiptWithCompany,
  sellReceipt,
  sellReceiptWithCompany,
  paymentsExpectedCents,
  cardRefundReference,
  receiptLayoutFromResult,
  cancelReceipt,
  type CancelReceiptResult,
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
  type SendReceiptEmailOptions,
  type SendReceiptEmailResult,
  sendReceiptEmail,
} from './receipts.js';

export { listMyCashregisters } from './cashregisters.js';

export { downloadDailyReport, downloadMonthlyReport, getReportV2, type ReportV2, type ReportV2Metadata, type ReportV2Options } from './reports.js';

export {
  type CashboxStatus,
  type SignatureStatus,
  getCashboxStatus,
  getSignatureStatus,
} from './status.js';

export { type KasseneckApi, createKasseneckApi } from './api.js';
