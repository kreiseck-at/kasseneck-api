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
  KasseneckHttpError,
  KasseneckNetworkError,
  type KasseneckError,
  isKasseneckApiError,
  isKasseneckHttpError,
  isKasseneckNetworkError,
} from './errors.js';
