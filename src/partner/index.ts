/**
 * `@kreiseck/kasseneck-api/partner` — alles, was ein Partner-Softwarehaus
 * ueber die Kasseneck-Schnittstelle tut.
 *
 * Ein eigener Unterpfad und nicht die Wurzel, aus zwei Gruenden: der
 * Partner-Schluessel gehoert auf einen **Server** (er kann Betriebe anlegen und
 * deren Geheimnisse holen), und die Kassen-Seite des Pakets soll ihn nicht
 * versehentlich in ein Browser-Buendel ziehen.
 *
 * Die Beschreibung der Endpunkte steht **nicht** hier, sondern in der Referenz
 * des Backends (`docs/api/partner.md`, kompakt `docs/api/partner.llms.txt`).
 * Was hier steht, ist die Benutzung dieses Clients.
 *
 * Reihenfolge der Kette: [PARTNER_FLOW].
 *
 * **Seit 0.28.0 spricht dieser Teil die englische `/v3`** ([PARTNER_BASE_URL]),
 * seit 1.0 heissen auch seine Exporte englisch; die Tabelle alt/neu steht im
 * CHANGELOG. Die Aliase aus 0.28 (`Rechtsform`, `Bundesland`, `KontaktRolle`)
 * sind entfernt.
 */

export { createPartnerApi, PARTNER_BASE_URL, type PartnerApi, type PartnerApiOptions } from './api.js';

export { partnerKeyAuth, partnerKeyEnv, type PartnerKeyAuthOptions } from './auth.js';

export {
  PARTNER_FLOW,
  nextFlowStep,
  type FlowStep,
} from './ablauf.js';

export {
  PARTNER_ERROR_CODES,
  PARTNER_PORTAL_ERROR_CODES,
  PARTNER_REQUEST_ERROR_CODES,
  isPartnerErrorCode,
  isPartnerPortalErrorCode,
  isPartnerError,
  partnerErrorCode,
  partnerErrorAdvice,
  partnerFieldErrors,
  partnerRetryAfterSec,
  type PartnerCode,
  type PartnerErrorCode,
  type PartnerPortalErrorCode,
  type PartnerRequestErrorCode,
  type PartnerFieldError,
} from './fehler.js';

export {
  BUSINESS_FIELDS,
  unknownBusinessFields,
  type BusinessField,
} from './betrieb.js';

export { KasseneckSecret, SECRET_MASK } from './secret.js';

export {
  getPartnerInfo,
  createPartnerCustomer,
  listPartnerCustomers,
  checkPartnerCustomerEmail,
  getPartnerCustomer,
  sendPartnerCustomerFonLink,
  requestCustomerSignature,
  getCustomerSignatureStatus,
  createCustomerCashregister,
  activateCashregister,
  listCustomerCashregisters,
  getCustomerCredentials,
  reportCustomerContract,
} from './endpunkte.js';

export {
  createPartnerWebhook,
  listPartnerWebhooks,
  rotatePartnerWebhookSecret,
  updatePartnerWebhook,
  deletePartnerWebhook,
  sendPartnerWebhookTest,
  listPartnerWebhookDeliveries,
  parseWebhookEvent,
  isPartnerWebhookEvent,
  PARTNER_WEBHOOK_EVENTS,
  WEBHOOK_ENVELOPE_FIELDS,
  WEBHOOK_DELIVERY_STATUSES,
  type PartnerWebhookEvent,
  type PartnerWebhookEventType,
  type PartnerWebhook,
  type CreateWebhookOptions,
  type CreateWebhookResult,
  type DeleteWebhookResult,
  type WebhookApiVersion,
  type WebhookDeliveryStatus,
  type WebhookTestDelivery,
  type ContractAcceptedEventData,
  type SignatureFailedEventData,
  type CashregisterFailedEventData,
  type WebhookPatch,
  type WebhookList,
  type WebhookDelivery,
  type WebhookTestResult,
  type WebhookEventResult,
} from './webhooks.js';

export {
  verifyWebhookSignature,
  parseSignatureHeader,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_TOLERANCE_SEC,
  WEBHOOK_RETRY_PLAN_SEC,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_TIMEOUT_MS,
  WEBHOOK_LIMIT,
  type VerifyWebhookOptions,
  type WebhookVerifyResult,
  type WebhookVerifyReason,
} from './webhook-signatur.js';

export {
  PARTNER_ENVS,
  LEGAL_FORMS,
  AUSTRIAN_STATES,
  CONTACT_ROLES,
  AVV_MODES,
  FEE_INTERVALS,
  CONTRACT_KINDS,
  CONTRACT_SOURCES,
  SIGNATURE_HISTORY_REASONS,
  SIGNATURE_ERROR_CODES,
} from './typen.js';

export type {
  PartnerEnv,
  PartnerScope,
  PartnerApp,
  PartnerInfo,
  LegalForm,
  AustrianState,
  ContactRole,
  AvvMode,
  FeeInterval,
  PartnerFee,
  SignatureHistoryReason,
  SignatureErrorCode,
  RequestSignatureOptions,
  CustomerSignature,
  ContractKind,
  ContractSource,
  ReportCustomerContractOptions,
  ReportCustomerContractResult,
  BusinessAddress,
  BusinessTaxDetails,
  BusinessContact,
  BusinessTaxAdvisor,
  Business,
  CreateCustomerOptions,
  CreateCustomerResult,
  PartnerCustomerStatus,
  PartnerCustomerSummary,
  AvvStatus,
  ContractStatus,
  PartnerCustomerFonStatus,
  ListCustomersOptions,
  PartnerCustomerList,
  PartnerCustomer,
  FonLinkResult,
  SignatureRequestStatus,
  SignatureHistoryEntry,
  SignatureRequest,
  RequestSignatureResult,
  CustomerSignatureStatus,
  CashregisterActivationStep,
  CustomerCashregisterStatus,
  CustomerCashregister,
  CreateCashregisterOptions,
  CreateCashregisterResult,
  ActivateCashregisterResult,
  CustomerCashregisterList,
  CustomerCashregisterCredential,
  CustomerCredentials,
} from './typen.js';

/** `credentials:read` — nicht im Standardsatz, siehe typen.ts. */
export { SCOPE_CREDENTIALS } from './typen.js';
