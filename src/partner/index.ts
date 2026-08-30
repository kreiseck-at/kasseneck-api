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
 * Reihenfolge der Kette: [PARTNER_ABLAUF].
 */

export { createPartnerApi, type PartnerApi, type PartnerApiOptions } from './api.js';

export { partnerKeyAuth, partnerKeyEnv, type PartnerKeyAuthOptions } from './auth.js';

export {
  PARTNER_ABLAUF,
  naechsterSchritt,
  type AblaufSchritt,
} from './ablauf.js';

export {
  AVV_MODI,
  AVV_MODUS_STANDARD,
  istAvvModus,
  PARTNER_FEHLER_CODES,
  istPartnerFehlerCode,
  istPartnerFehler,
  partnerFehlerCode,
  partnerFehlerRat,
  partnerFeldFehler,
  partnerWartezeitSek,
  vertragOffenRat,
  type AvvModus,
  type PartnerFehlerCode,
  type PartnerFeldFehler,
} from './fehler.js';

export { KasseneckSecret, SECRET_MASKE } from './secret.js';

export {
  getPartnerInfo,
  createPartnerCustomer,
  listPartnerCustomers,
  getPartnerCustomer,
  sendPartnerCustomerFonLink,
  requestCustomerSignature,
  getCustomerSignatureStatus,
  createCustomerCashregister,
  activateCashregister,
  listCustomerCashregisters,
  getCustomerCredentials,
  reportCustomerVertrag,
} from './endpunkte.js';

export {
  createPartnerWebhook,
  listPartnerWebhooks,
  updatePartnerWebhook,
  deletePartnerWebhook,
  sendPartnerWebhookTest,
  listPartnerWebhookDeliveries,
  parseWebhookEvent,
  istPartnerWebhookEvent,
  PARTNER_WEBHOOK_EVENTS,
  type PartnerWebhookEvent,
  type PartnerWebhookEventType,
  type PartnerWebhook,
  type CreateWebhookOptions,
  type CreateWebhookResult,
  type WebhookPatch,
  type WebhookListe,
  type WebhookZustellung,
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

export type {
  PartnerEnv,
  PartnerScope,
  PartnerApp,
  PartnerInfo,
  Rechtsform,
  Bundesland,
  KontaktRolle,
  BetriebAdresse,
  BetriebSteuer,
  BetriebKontakt,
  BetriebSteuerberater,
  Betrieb,
  CreateCustomerOptions,
  CreateCustomerResult,
  KundenStatus,
  KundenZeile,
  ListCustomersOptions,
  KundenListe,
  Kunde,
  FonLinkResult,
  SignaturAntragStatus,
  SignaturHistorieEintrag,
  SignaturAntrag,
  RequestSignatureResult,
  SignaturStand,
  KassenSchritt,
  KassenStatus,
  Kasse,
  CreateCashregisterOptions,
  CreateCashregisterResult,
  ActivateCashregisterResult,
  KassenListe,
  CustomerCashregisterCredential,
  CustomerCredentials,
  ReportVertragOptions,
  ReportVertragResult,
} from './typen.js';

/** `credentials:read` — nicht im Standardsatz, siehe typen.ts. */
export { SCOPE_CREDENTIALS } from './typen.js';
