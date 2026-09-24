/**
 * Fassade ueber den Partner-Aufrufen: Schluessel einmal binden, dann rufen.
 *
 * Wie [createKasseneckApi] bewusst **keine** Klasse — die Aufrufe sind freie
 * Funktionen und bleiben einzeln importierbar.
 */

import { createTransport, type FetchLike } from '../client/transport.js';
import type { InternerTransport } from '../client/aufrufe.js';
import { partnerKeyAuth } from './auth.js';
import { partnerFehlerRat } from './fehler.js';
import {
  activateCashregister,
  createCustomerCashregister,
  createPartnerCustomer,
  getCustomerCredentials,
  getCustomerSignatureStatus,
  getPartnerCustomer,
  getPartnerInfo,
  checkPartnerCustomerEmail,
  listCustomerCashregisters,
  listPartnerCustomers,
  requestCustomerSignature,
  sendPartnerCustomerFonLink,
} from './endpunkte.js';
import {
  createPartnerWebhook,
  deletePartnerWebhook,
  listPartnerWebhookDeliveries,
  listPartnerWebhooks,
  rotatePartnerWebhookSecret,
  sendPartnerWebhookTest,
  updatePartnerWebhook,
  type CreateWebhookOptions,
  type CreateWebhookResult,
  type DeleteWebhookResult,
  type PartnerWebhook,
  type WebhookListe,
  type PartnerWebhookEventType,
  type WebhookPatch,
  type WebhookTestResult,
  type WebhookZustellung,
} from './webhooks.js';
import type {
  ActivateCashregisterResult,
  CreateCashregisterOptions,
  CreateCashregisterResult,
  CreateCustomerOptions,
  CreateCustomerResult,
  CustomerCredentials,
  FonLinkResult,
  KassenListe,
  Kunde,
  KundenListe,
  ListCustomersOptions,
  PartnerInfo,
  RequestSignatureOptions,
  RequestSignatureResult,
  SignaturStand,
} from './typen.js';

/**
 * Die Basis-URL der Partner-API: `/v3`, die englische Fassung.
 *
 * Nur der Partner-Teil spricht `/v3`. Belege, Rechnungen, Kasse und Zahlungen
 * laufen weiter ueber [DEFAULT_BASE_URL] (`/v1`), bis es fuer sie eine `/v3`
 * gibt. Die Partner-Endpunkte unter `/v1` antworten weiter, deutsch und
 * abgekuendigt (Kopfzeilen `Deprecation`/`Sunset`); dieser Client spricht sie
 * nicht mehr.
 */
export const PARTNER_BASE_URL = 'https://api.kasseneck.at/v3';

export interface PartnerApiOptions {
  /** Partner-Schluessel `pk_test_…` / `pk_live_…`. Gehoert auf einen Server. */
  partnerKey: string;
  /**
   * Abweichende Basis-URL; Vorgabe [PARTNER_BASE_URL]
   * (`https://api.kasseneck.at/v3`). Die Antworten werden in der Form der
   * `/v3` gelesen: eine `/v1`-Adresse hier liefert deutsche Werte, die diese
   * Typen nicht beschreiben.
   */
  baseUrl?: string;
  /** Zeitlimit je Aufruf in Millisekunden. */
  timeoutMs?: number;
  /** Eigene `fetch`-Umsetzung (Tests, Proxys). */
  fetch?: FetchLike;
}

export interface PartnerApi {
  // Partner
  getPartnerInfo(): Promise<PartnerInfo>;

  // Betriebe
  createPartnerCustomer(optionen: CreateCustomerOptions): Promise<CreateCustomerResult>;
  listPartnerCustomers(optionen?: ListCustomersOptions): Promise<KundenListe>;
  getPartnerCustomer(customerId: string): Promise<Kunde>;
  sendPartnerCustomerFonLink(customerId: string): Promise<FonLinkResult>;

  // Signatur
  requestCustomerSignature(customerId: string, optionen?: RequestSignatureOptions): Promise<RequestSignatureResult>;
  getCustomerSignatureStatus(customerId: string): Promise<SignaturStand>;

  // Kassen
  createCustomerCashregister(optionen: CreateCashregisterOptions): Promise<CreateCashregisterResult>;
  activateCashregister(customerId: string, cashregisterId: string): Promise<ActivateCashregisterResult>;
  listCustomerCashregisters(customerId: string): Promise<KassenListe>;
  /** Geheimnisse des Betriebs — siehe `getCustomerCredentials` in endpunkte.ts. */
  getCustomerCredentials(customerId: string): Promise<CustomerCredentials>;
  /**
   * Ist diese Adresse als Kasseneck-Zugang noch frei? Nur noetig, wenn der
   * Betrieb einen eigenen Login bekommen soll — sonst faellt `email_taken`
   * erst nach dem ganzen Formular auf.
   */
  checkPartnerCustomerEmail(email: string): Promise<boolean>;

  // Webhooks
  createPartnerWebhook(optionen: CreateWebhookOptions): Promise<CreateWebhookResult>;
  listPartnerWebhooks(): Promise<WebhookListe>;
  updatePartnerWebhook(webhookId: string, patch: WebhookPatch): Promise<PartnerWebhook>;
  deletePartnerWebhook(webhookId: string): Promise<DeleteWebhookResult>;
  /**
   * Neues Secret fuer denselben Endpunkt — dieselbe `webhookId`, dieselben
   * Ereignisse. Das alte gilt ab der Antwort nicht mehr.
   */
  rotatePartnerWebhookSecret(webhookId: string): Promise<CreateWebhookResult>;
  /**
   * Eine Probe an einen Endpunkt — ohne `event` die Leitungsprobe
   * `webhook.test`, mit `event` genau der Fall, den der Empfaenger behandeln
   * soll. Jede Probe traegt `test: true` im Umschlag.
   */
  sendPartnerWebhookTest(
    webhookId: string,
    event?: PartnerWebhookEventType | (string & {}),
  ): Promise<WebhookTestResult>;
  listPartnerWebhookDeliveries(optionen?: { webhookId?: string; limit?: number }): Promise<WebhookZustellung[]>;

  /**
   * Der Handlungssatz zu einem beliebigen Fehlercode der Partner-API. Gehoert
   * in die eigene Fehlermeldung, damit ein Anwender nicht in der Doku
   * nachschlagen muss.
   */
  fehlerRat(code: string): string | undefined;
}

export function createPartnerApi(optionen: PartnerApiOptions): PartnerApi {
  const rufen = createTransport({
    auth: partnerKeyAuth({ partnerKey: optionen.partnerKey }),
    baseUrl: optionen.baseUrl ?? PARTNER_BASE_URL,
    timeoutMs: optionen.timeoutMs,
    fetch: optionen.fetch,
  }) as InternerTransport;

  return {
    getPartnerInfo: () => getPartnerInfo(rufen),

    createPartnerCustomer: (o) => createPartnerCustomer(rufen, o),
    listPartnerCustomers: (o) => listPartnerCustomers(rufen, o),
    getPartnerCustomer: (id) => getPartnerCustomer(rufen, id),
    sendPartnerCustomerFonLink: (id) => sendPartnerCustomerFonLink(rufen, id),

    requestCustomerSignature: (id, o) => requestCustomerSignature(rufen, id, o),
    getCustomerSignatureStatus: (id) => getCustomerSignatureStatus(rufen, id),

    createCustomerCashregister: (o) => createCustomerCashregister(rufen, o),
    activateCashregister: (kunde, kasse) => activateCashregister(rufen, kunde, kasse),
    listCustomerCashregisters: (id) => listCustomerCashregisters(rufen, id),
    getCustomerCredentials: (id) => getCustomerCredentials(rufen, id),
    checkPartnerCustomerEmail: (email) => checkPartnerCustomerEmail(rufen, email),

    createPartnerWebhook: (o) => createPartnerWebhook(rufen, o),
    listPartnerWebhooks: () => listPartnerWebhooks(rufen),
    updatePartnerWebhook: (id, patch) => updatePartnerWebhook(rufen, id, patch),
    deletePartnerWebhook: (id) => deletePartnerWebhook(rufen, id),
    rotatePartnerWebhookSecret: (id) => rotatePartnerWebhookSecret(rufen, id),
    sendPartnerWebhookTest: (id, event) => sendPartnerWebhookTest(rufen, id, event),
    listPartnerWebhookDeliveries: (o) => listPartnerWebhookDeliveries(rufen, o),

    fehlerRat: (code) => partnerFehlerRat(code),
  };
}
