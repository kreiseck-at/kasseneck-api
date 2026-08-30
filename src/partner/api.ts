/**
 * Fassade ueber den Partner-Aufrufen: Schluessel einmal binden, dann rufen.
 *
 * Wie [createKasseneckApi] bewusst **keine** Klasse — die Aufrufe sind freie
 * Funktionen und bleiben einzeln importierbar.
 *
 * **Ein Unterschied zur Kassen-Fassade, und er ist Absicht:** hier steht
 * zusaetzlich [PartnerApiOptions.avvModus] — welcher der drei Vertragswege fuer
 * dieses Partner-Konto gilt. `getPartnerInfo` gibt ihn nicht aus; die
 * Betriebsansichten tun es (`kunde.avv.modus`). Dieser Wert ist der Rueckfall
 * fuer den Moment, in dem noch kein Betrieb geladen ist, damit dieser Client
 * bei `vertrag_offen` nicht nur den allgemeinen Fall nennen muss.
 */

import { createTransport, type FetchLike } from '../client/transport.js';
import type { InternerTransport } from '../client/aufrufe.js';
import { partnerKeyAuth } from './auth.js';
import {
  partnerFehlerRat,
  vertragOffenRat,
  vertragOffenRatFuer,
  AVV_MODUS_STANDARD,
  type AvvModus,
} from './fehler.js';
import {
  activateCashregister,
  createCustomerCashregister,
  createPartnerCustomer,
  getCustomerCredentials,
  getCustomerSignatureStatus,
  getPartnerCustomer,
  getPartnerInfo,
  listCustomerCashregisters,
  listPartnerCustomers,
  reportCustomerVertrag,
  requestCustomerSignature,
  sendPartnerCustomerFonLink,
} from './endpunkte.js';
import {
  createPartnerWebhook,
  deletePartnerWebhook,
  listPartnerWebhookDeliveries,
  listPartnerWebhooks,
  sendPartnerWebhookTest,
  updatePartnerWebhook,
  type CreateWebhookOptions,
  type CreateWebhookResult,
  type PartnerWebhook,
  type WebhookListe,
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
  ReportVertragOptions,
  ReportVertragResult,
  RequestSignatureResult,
  SignaturStand,
} from './typen.js';

export interface PartnerApiOptions {
  /** Partner-Schluessel `pk_test_…` / `pk_live_…`. Gehoert auf einen Server. */
  partnerKey: string;
  /** Abweichende Basis-URL; Vorgabe `https://api.kasseneck.at/v1`. */
  baseUrl?: string;
  /** Zeitlimit je Aufruf in Millisekunden. */
  timeoutMs?: number;
  /** Eigene `fetch`-Umsetzung (Tests, Proxys). */
  fetch?: FetchLike;
  /**
   * Der Vertragsweg dieses Partner-Kontos, wie Kasseneck ihn gesetzt hat:
   * `direkt` (Vorgabe), `vollmacht` oder `unterauftrag`. Er steuert nur die
   * Formulierung von [PartnerApi.vertragOffenRat] — nicht das Verhalten des
   * Servers.
   *
   * **Rueckfall, kein Ersatz:** `listPartnerCustomers` und
   * `getPartnerCustomer` fuehren den Weg je Betrieb mit (`kunde.avv.modus`);
   * [PartnerApi.vertragOffenRatFuer] nimmt ihn von dort. Dieser Wert gilt,
   * solange kein Betrieb geladen ist — und wenn eine aeltere Backend-Fassung
   * das Feld nicht schickt.
   */
  avvModus?: AvvModus;
}

export interface PartnerApi {
  /** Der Vertragsweg, mit dem diese Fassade gebaut wurde. */
  readonly avvModus: AvvModus;

  // Partner
  getPartnerInfo(): Promise<PartnerInfo>;

  // Betriebe
  createPartnerCustomer(optionen: CreateCustomerOptions): Promise<CreateCustomerResult>;
  listPartnerCustomers(optionen?: ListCustomersOptions): Promise<KundenListe>;
  getPartnerCustomer(customerId: string): Promise<Kunde>;
  sendPartnerCustomerFonLink(customerId: string): Promise<FonLinkResult>;

  // Vertrag
  reportCustomerVertrag(optionen: ReportVertragOptions): Promise<ReportVertragResult>;

  // Signatur
  requestCustomerSignature(customerId: string, art?: string): Promise<RequestSignatureResult>;
  getCustomerSignatureStatus(customerId: string): Promise<SignaturStand>;

  // Kassen
  createCustomerCashregister(optionen: CreateCashregisterOptions): Promise<CreateCashregisterResult>;
  activateCashregister(customerId: string, cashregisterId: string): Promise<ActivateCashregisterResult>;
  listCustomerCashregisters(customerId: string): Promise<KassenListe>;
  /** Geheimnisse des Betriebs — siehe `getCustomerCredentials` in endpunkte.ts. */
  getCustomerCredentials(customerId: string): Promise<CustomerCredentials>;

  // Webhooks
  createPartnerWebhook(optionen: CreateWebhookOptions): Promise<CreateWebhookResult>;
  listPartnerWebhooks(): Promise<WebhookListe>;
  updatePartnerWebhook(webhookId: string, patch: WebhookPatch): Promise<PartnerWebhook>;
  deletePartnerWebhook(webhookId: string): Promise<string>;
  sendPartnerWebhookTest(webhookId: string): Promise<WebhookTestResult>;
  listPartnerWebhookDeliveries(optionen?: { webhookId?: string; limit?: number }): Promise<WebhookZustellung[]>;

  /**
   * Was bei `vertrag_offen` zu tun ist — formuliert fuer den Vertragsweg
   * dieses Kontos. Gehoert in die eigene Fehlermeldung, damit ein Anwender
   * nicht in der Doku nachschlagen muss.
   */
  vertragOffenRat(): string;
  /**
   * Wie [vertragOffenRat], aber mit dem Weg aus dem Betrieb selbst — die
   * verlaessliche Quelle. `listPartnerCustomers` und `getPartnerCustomer`
   * fuehren ihn je Betrieb mit; ohne ihn gilt der eingestellte [avvModus].
   */
  vertragOffenRatFuer(kunde: { avv?: { modus?: unknown } | null } | null | undefined): string;
  /** Der Handlungssatz zu einem beliebigen Fehlercode der Partner-API. */
  fehlerRat(code: string): string | undefined;
}

export function createPartnerApi(optionen: PartnerApiOptions): PartnerApi {
  const modus: AvvModus = optionen.avvModus ?? AVV_MODUS_STANDARD;
  const rufen = createTransport({
    auth: partnerKeyAuth({ partnerKey: optionen.partnerKey }),
    baseUrl: optionen.baseUrl,
    timeoutMs: optionen.timeoutMs,
    fetch: optionen.fetch,
  }) as InternerTransport;

  return {
    avvModus: modus,

    getPartnerInfo: () => getPartnerInfo(rufen),

    createPartnerCustomer: (o) => createPartnerCustomer(rufen, o),
    listPartnerCustomers: (o) => listPartnerCustomers(rufen, o),
    getPartnerCustomer: (id) => getPartnerCustomer(rufen, id),
    sendPartnerCustomerFonLink: (id) => sendPartnerCustomerFonLink(rufen, id),

    reportCustomerVertrag: (o) => reportCustomerVertrag(rufen, o),

    requestCustomerSignature: (id, art) => requestCustomerSignature(rufen, id, art),
    getCustomerSignatureStatus: (id) => getCustomerSignatureStatus(rufen, id),

    createCustomerCashregister: (o) => createCustomerCashregister(rufen, o),
    activateCashregister: (kunde, kasse) => activateCashregister(rufen, kunde, kasse),
    listCustomerCashregisters: (id) => listCustomerCashregisters(rufen, id),
    getCustomerCredentials: (id) => getCustomerCredentials(rufen, id),

    createPartnerWebhook: (o) => createPartnerWebhook(rufen, o),
    listPartnerWebhooks: () => listPartnerWebhooks(rufen),
    updatePartnerWebhook: (id, patch) => updatePartnerWebhook(rufen, id, patch),
    deletePartnerWebhook: (id) => deletePartnerWebhook(rufen, id),
    sendPartnerWebhookTest: (id) => sendPartnerWebhookTest(rufen, id),
    listPartnerWebhookDeliveries: (o) => listPartnerWebhookDeliveries(rufen, o),

    vertragOffenRat: () => vertragOffenRat(modus),
    vertragOffenRatFuer: (kunde) => vertragOffenRatFuer(kunde?.avv, modus),
    fehlerRat: (code) => partnerFehlerRat(code, modus),
  };
}
