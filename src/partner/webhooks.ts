/**
 * Webhooks: Endpunkte verwalten und eingehende Zustellungen auswerten.
 *
 * Die Signaturpruefung liegt daneben in `webhook-signatur.ts` — sie braucht
 * weder Transport noch Schluessel und laeuft in jedem Empfaenger, auch in
 * einem, der sonst nichts von diesem Paket benutzt.
 */

import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import {
  verifyWebhookSignature,
  type VerifyWebhookOptions,
  type WebhookVerifyReason,
} from './webhook-signatur.js';

// ---------------------------------------------------------------------------
// Ereignisse
// ---------------------------------------------------------------------------

/**
 * Alle Ereignisse, die ein Webhook abonnieren **und proben** kann. Ein
 * Endpunkt bekommt ausschliesslich die, die in seiner `events`-Liste stehen.
 *
 * **Noch nicht in der Liste:** `customer.avv_accepted` und
 * `customer.terms_accepted`. Das Backend bietet sie inzwischen zum Abonnieren
 * an; die Liste wird mit dem Dart-Zwilling gemeinsam erweitert, weil beide
 * gegeneinander geprueft werden. Abonnieren geht trotzdem schon (`events`
 * nimmt jeden Namen), die Nutzlast beschreibt [ContractAcceptedEventData].
 */
export const PARTNER_WEBHOOK_EVENTS = [
  'customer.created',
  'customer.updated',
  'customer.status_changed',
  'customer.fon_verified',
  'customer.live_enabled',
  'signature.requested',
  'signature.ready',
  'signature.failed',
  'cashregister.created',
  'cashregister.live',
  'cashregister.failed',
  'app.version.accepted',
  'app.version.rejected',
  'webhook.test',
] as const;

export type PartnerWebhookEventType = typeof PARTNER_WEBHOOK_EVENTS[number];

export function istPartnerWebhookEvent(wert: unknown): wert is PartnerWebhookEventType {
  return typeof wert === 'string' && (PARTNER_WEBHOOK_EVENTS as readonly string[]).includes(wert);
}

/**
 * Die Felder des Umschlags, so wie er auf der Leitung liegt.
 *
 * Als Liste, damit der Zwilling sie nachhaelt: `test` kam spaeter dazu, und
 * genau ein solches Feld verschwindet sonst auf einer Seite, ohne dass etwas
 * rot wird.
 */
export const WEBHOOK_UMSCHLAG_FELDER = ['id', 'type', 'createdAt', 'partnerId', 'test', 'data'] as const;

/**
 * Die Huelle jeder Zustellung. `type` bleibt bewusst offen fuer unbekannte
 * Werte (`(string & {})`): ein spaeter ergaenztes Ereignis soll einen
 * Empfaenger nicht zum Absturz bringen, sondern in seinem `default`-Zweig
 * landen.
 */
export interface PartnerWebhookEvent<T = Record<string, unknown>> {
  /** `evt_…` — die Kennung, auf die **entdoppelt** wird. */
  id: string;
  type: PartnerWebhookEventType | (string & {});
  createdAt: number;
  partnerId: string;
  /**
   * **Probe oder Ernstfall.** Eine mit [sendPartnerWebhookTest] ausgeloeste
   * Zustellung traegt `test: true` im Umschlag; ein echtes Ereignis fuehrt das
   * Feld gar nicht, hier steht dann `false`.
   *
   * Diese Zeile gehoert an den Anfang jedes Handlers:
   *
   * ```ts
   * if (ereignis.test) return;
   * ```
   *
   * Ohne sie haelt jemand eine Probe fuer echt und schreibt seinem Kunden, die
   * Kasse sei fertig. Eine Probe traegt eine erkennbar erfundene Nutzlast — nur
   * sieht man das erst, wenn man hinsieht.
   */
  test: boolean;
  data: T;
}

/**
 * Die Sprache der Nutzlast eines Webhooks. Ein unter `/v1` angelegter Webhook
 * spricht `v1` (deutsche Werte), ein unter `/v3` angelegter `v3`. Umstellen
 * geht nur vorwaerts, mit `updatePartnerWebhook(id, { apiVersion: 'v3' })`;
 * zurueck auf `v1` gibt es absichtlich nicht.
 *
 * Die Sprache der **Antworten** folgt dagegen dem Pfad: dieser Client ruft
 * `/v3` und bekommt englische Antworten, gleich welche `apiVersion` ein
 * Webhook hat.
 */
export type WebhookApiVersion = 'v1' | 'v3';

/** Art des Vertrags in `customer.avv_accepted` / `customer.terms_accepted`. */
export type ContractKind = 'avv' | 'terms';

/**
 * Wo der Betrieb bestaetigt hat. Unter `v1` hiessen die ersten fuenf
 * `einrichten`, `prozess`, `partner_vollmacht`, `admin_papier`,
 * `papier_upload`; `app` und `portal` sind in beiden Sprachen gleich.
 */
export type ContractSource =
  | 'setup_link'
  | 'process_link'
  | 'partner_power_of_attorney'
  | 'admin_paper'
  | 'paper_upload'
  | 'app'
  | 'portal'
  | (string & {});

/**
 * Nutzlast von `customer.avv_accepted` und `customer.terms_accepted` in der
 * Sprache `v3`. Ein Webhook mit `apiVersion: 'v1'` schickt hier weiter
 * `kind: 'nutzung'` und die deutschen Quellen.
 */
export interface ContractAcceptedEventData {
  customerId: string;
  companyName: string;
  kind: ContractKind;
  version: string;
  confirmedAt: number;
  source: ContractSource;
}

// ---------------------------------------------------------------------------
// Eingehende Zustellung auswerten
// ---------------------------------------------------------------------------

export type WebhookEventResult =
  | { ok: true; event: PartnerWebhookEvent; timestampSec: number }
  | { ok: false; reason: WebhookVerifyReason | 'body-not-json' | 'body-not-event' };

/**
 * Prueft die Signatur **und** liest das Ereignis — in dieser Reihenfolge. Wer
 * zuerst parst und dann prueft, hat den fremden Rumpf schon durch seinen Code
 * laufen lassen.
 *
 * **Entdoppeln nicht vergessen:** dieselbe Zustellung kann mehrfach ankommen
 * (Wiederholung nach einer Antwort, die unterwegs verloren ging). Massgeblich
 * ist `event.id`, nicht der Kopf `X-Kasseneck-Delivery` — der ist bei
 * Wiederholungen derselbe, aber er beantwortet die Frage "habe ich dieses
 * Ereignis schon verarbeitet?" nur fuer genau diesen Endpunkt.
 *
 * Antworte innerhalb von 10 Sekunden mit 2xx und erledige die Arbeit danach.
 * Eine ausbleibende Antwort wird bis zu fuenfmal wiederholt (1 min, 5 min,
 * 30 min, 2 h, 12 h) und gilt dann als fehlgeschlagen.
 */
export async function parseWebhookEvent(optionen: VerifyWebhookOptions): Promise<WebhookEventResult> {
  const geprueft = await verifyWebhookSignature(optionen);
  if (!geprueft.ok) return { ok: false, reason: geprueft.reason };

  const text = typeof optionen.body === 'string' ? optionen.body : new TextDecoder('utf-8').decode(optionen.body);
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'body-not-json' };
  }
  if (roh === null || typeof roh !== 'object' || Array.isArray(roh)) return { ok: false, reason: 'body-not-event' };
  const e = roh as Record<string, unknown>;
  if (typeof e['id'] !== 'string' || typeof e['type'] !== 'string') return { ok: false, reason: 'body-not-event' };
  return {
    ok: true,
    timestampSec: geprueft.timestampSec,
    event: {
      id: e['id'],
      type: e['type'],
      createdAt: typeof e['createdAt'] === 'number' ? e['createdAt'] : 0,
      partnerId: typeof e['partnerId'] === 'string' ? e['partnerId'] : '',
      // Nur ein ausdrueckliches `true` ist eine Probe. Alles andere — auch ein
      // fehlendes Feld — ist der Ernstfall; im Zweifel lieber einmal zu viel
      // gearbeitet als eine echte Kasse fuer eine Probe gehalten.
      test: e['test'] === true,
      data:
        e['data'] !== null && typeof e['data'] === 'object' && !Array.isArray(e['data'])
          ? (e['data'] as Record<string, unknown>)
          : {},
    },
  };
}

// ---------------------------------------------------------------------------
// Endpunkte verwalten
// ---------------------------------------------------------------------------

/** Stand einer Zustellung; `/v1` sagte `offen`, `zugestellt`, `fehlgeschlagen`, `verworfen`. */
export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dropped';

export interface PartnerWebhook {
  webhookId: string;
  /** Sprache der Nutzlast; fehlt sie in der Antwort, ist es ein Bestands-Webhook und damit `v1`. */
  apiVersion: WebhookApiVersion | (string & {});
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
  createdAt: number | null;
  /** Die letzte Zustellung; `null`, solange keine versucht wurde. */
  lastDelivery: {
    at: number | null;
    status: WebhookDeliveryStatus | (string & {});
    statusCode: number | null;
  } | null;
  /** Fehlversuche in Folge — steigt der Wert, stimmt beim Empfaenger etwas nicht. */
  consecutiveFailures: number;
}

export interface CreateWebhookOptions {
  /** Vollstaendige `https://`-Adresse. */
  url: string;
  /** Mindestens eines; unbekannte Namen lehnt das Backend ab. */
  events: (PartnerWebhookEventType | (string & {}))[];
  /** Hoechstens 120 Zeichen. */
  description?: string;
  active?: boolean;
}

export interface CreateWebhookResult {
  webhook: PartnerWebhook;
  /**
   * Das Secret fuer die Signaturpruefung. **Es kommt genau einmal** — beim
   * Anlegen. Danach gibt das Backend es nie wieder aus; wer es verliert, legt
   * einen neuen Endpunkt an.
   *
   * Bewusst ein `string` und kein [KasseneckSecret]: es gehoert dem Partner
   * selbst und nicht einem fremden Betrieb, und es muss unveraendert in die
   * eigene Konfiguration wandern. Verschluesselt speichern gilt trotzdem.
   */
  secret: string;
}

export interface WebhookPatch {
  url?: string;
  events?: (PartnerWebhookEventType | (string & {}))[];
  description?: string;
  active?: boolean;
  /**
   * Stellt die Nutzlast auf Englisch um. Nur `'v3'` ist moeglich: zurueck auf
   * `v1` geht nicht, damit ein Partner nicht versehentlich wieder deutsche
   * Nutzlasten bekommt.
   */
  apiVersion?: 'v3';
}

export interface DeleteWebhookResult {
  webhookId: string;
  /** Unter `/v1` hiess das Feld `geloescht`. */
  deleted: boolean;
}

export interface WebhookListe {
  webhooks: PartnerWebhook[];
  /** Der Katalog: Ereignisname und deutscher Text, so wie das Panel ihn zeigt. */
  events: { key: string; text: string }[];
}

export interface WebhookZustellung {
  deliveryId: string;
  webhookId: string;
  event: string;
  eventId: string;
  /** `dropped`: der Webhook wurde vor der Faelligkeit deaktiviert oder geloescht. */
  status: WebhookDeliveryStatus | (string & {});
  attempts: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number | null;
  statusCode: number | null;
  /** Auszug der Antwort des Empfaengers, hoechstens 500 Zeichen. */
  response: string | null;
  createdAt: number | null;
}

function objekt(wert: unknown): Record<string, unknown> {
  return wert !== null && typeof wert === 'object' && !Array.isArray(wert) ? (wert as Record<string, unknown>) : {};
}

function letzteZustellung(wert: unknown): PartnerWebhook['lastDelivery'] {
  if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) return null;
  const z = wert as Record<string, unknown>;
  return {
    at: typeof z['at'] === 'number' ? z['at'] : null,
    status: typeof z['status'] === 'string' ? z['status'] : '',
    statusCode: typeof z['statusCode'] === 'number' ? z['statusCode'] : null,
  };
}

function webhook(eintrag: unknown): PartnerWebhook {
  const w = objekt(eintrag);
  return {
    webhookId: typeof w['webhookId'] === 'string' ? w['webhookId'] : '',
    // Fehlt das Feld, ist es ein Bestands-Webhook: der spricht v1. Kein
    // `v3` aus Kulanz, sonst verzweigt ein Empfaenger auf englische Werte,
    // die nie kommen.
    apiVersion: typeof w['apiVersion'] === 'string' && w['apiVersion'] ? w['apiVersion'] : 'v1',
    url: typeof w['url'] === 'string' ? w['url'] : '',
    events: Array.isArray(w['events']) ? w['events'].filter((e): e is string => typeof e === 'string') : [],
    active: w['active'] !== false,
    description: typeof w['description'] === 'string' ? w['description'] : null,
    createdAt: typeof w['createdAt'] === 'number' ? w['createdAt'] : null,
    lastDelivery: letzteZustellung(w['lastDelivery']),
    consecutiveFailures: typeof w['consecutiveFailures'] === 'number' ? w['consecutiveFailures'] : 0,
  };
}

/**
 * Legt einen Webhook-Endpunkt an. Hoechstens [WEBHOOK_LIMIT] je Partner
 * (`webhook_limit`).
 *
 * **Das Secret in der Antwort ist der einzige Weg dazu.** Es sofort dorthin
 * schreiben, wo der Empfaenger es liest — nicht in ein Protokoll.
 */
export async function createPartnerWebhook(
  rufen: InternerTransport,
  optionen: CreateWebhookOptions,
): Promise<CreateWebhookResult> {
  const url = typeof optionen?.url === 'string' ? optionen.url.trim() : '';
  if (!url) throw new KasseneckValidationError('createPartnerWebhook', 'url fehlt', 'request');
  if (!Array.isArray(optionen.events) || optionen.events.length === 0) {
    throw new KasseneckValidationError('createPartnerWebhook', 'events ist leer — ein Endpunkt ohne Ereignis bekaeme nie etwas', 'request');
  }
  const daten = objekt(
    await rufen<unknown>('createPartnerWebhook', {
      url,
      events: optionen.events,
      description: optionen.description,
      active: optionen.active,
    }),
  );
  const secret = daten['secret'];
  if (typeof secret !== 'string' || !secret) {
    throw new KasseneckValidationError(
      'createPartnerWebhook',
      'Antwort enthaelt kein secret — ohne es laesst sich keine Zustellung pruefen',
      'response',
    );
  }
  return { webhook: webhook(daten['webhook']), secret };
}

/**
 * Ein neues Secret fuer denselben Endpunkt.
 *
 * Der Webhook behaelt seine `webhookId` und seine Ereignisse — nur das
 * Geheimnis wechselt. Wer den Endpunkt stattdessen loescht und neu anlegt,
 * verliert seine Zustellungshistorie und muss die Ereignisse neu ankreuzen.
 *
 * Das alte Secret gilt ab der Antwort NICHT mehr: die naechste Zustellung ist
 * schon mit dem neuen signiert. Erst speichern, dann weiterarbeiten.
 */
export async function rotatePartnerWebhookSecret(
  rufen: InternerTransport,
  webhookId: string,
): Promise<CreateWebhookResult> {
  const id = typeof webhookId === 'string' ? webhookId.trim() : '';
  if (!id) throw new KasseneckValidationError('rotatePartnerWebhookSecret', 'webhookId fehlt', 'request');
  const daten = objekt(await rufen<unknown>('rotatePartnerWebhookSecret', { webhookId: id }));
  const secret = daten['secret'];
  if (typeof secret !== 'string' || !secret) {
    throw new KasseneckValidationError(
      'rotatePartnerWebhookSecret',
      'Antwort enthaelt kein secret — dann waere der Wechsel nicht nachvollziehbar',
      'response',
    );
  }
  return { webhook: webhook(daten['webhook']), secret };
}

/** Die Webhook-Endpunkte dieses Partners samt Ereignis-Katalog. */
export async function listPartnerWebhooks(rufen: InternerTransport): Promise<WebhookListe> {
  const daten = objekt(await rufen<unknown>('listPartnerWebhooks'));
  return {
    webhooks: (Array.isArray(daten['webhooks']) ? daten['webhooks'] : []).map(webhook),
    events: (Array.isArray(daten['events']) ? daten['events'] : []).map((e) => ({
      key: typeof objekt(e)['key'] === 'string' ? (objekt(e)['key'] as string) : '',
      text: typeof objekt(e)['text'] === 'string' ? (objekt(e)['text'] as string) : '',
    })),
  };
}

/**
 * Aendert einen Endpunkt. Nur die genannten Felder — ein leeres `patch` lehnt
 * das Backend ab (`validation`, Feld `patch`), statt stillschweigend nichts zu
 * tun.
 */
export async function updatePartnerWebhook(
  rufen: InternerTransport,
  webhookId: string,
  patch: WebhookPatch,
): Promise<PartnerWebhook> {
  const id = typeof webhookId === 'string' ? webhookId.trim() : '';
  if (!id) throw new KasseneckValidationError('updatePartnerWebhook', 'webhookId fehlt', 'request');
  if (patch === null || typeof patch !== 'object' || Object.keys(patch).length === 0) {
    throw new KasseneckValidationError('updatePartnerWebhook', 'patch nennt keine Aenderung', 'request');
  }
  const daten = objekt(await rufen<unknown>('updatePartnerWebhook', { webhookId: id, patch }));
  return webhook(daten['webhook']);
}

/**
 * Loescht einen Endpunkt. Danach kommt dort nichts mehr an; offene
 * Zustellungen werden verworfen (`dropped`).
 */
export async function deletePartnerWebhook(
  rufen: InternerTransport,
  webhookId: string,
): Promise<DeleteWebhookResult> {
  const id = typeof webhookId === 'string' ? webhookId.trim() : '';
  if (!id) throw new KasseneckValidationError('deletePartnerWebhook', 'webhookId fehlt', 'request');
  const daten = objekt(await rufen<unknown>('deletePartnerWebhook', { webhookId: id }));
  return {
    webhookId: typeof daten['webhookId'] === 'string' ? daten['webhookId'] : id,
    deleted: daten['deleted'] === true,
  };
}

/** Eine Zustellung der Probe, so wie `sendPartnerWebhookTest` sie meldet. */
export interface WebhookTestZustellung {
  deliveryId: string;
  webhookId: string;
  status: WebhookDeliveryStatus | (string & {});
  statusCode: number | null;
}

export interface WebhookTestResult {
  eventId: string;
  /** Welches Ereignis geprobt wurde — ohne Angabe `webhook.test`. */
  event: string;
  deliveries: WebhookTestZustellung[];
}

/**
 * Schickt eine Probe an genau diesen Endpunkt.
 *
 * Ohne `event` kommt `webhook.test` — der Nachweis, dass die Leitung steht und
 * die eigene Signaturpruefung gegen echte Bytes laeuft. **Mit `event` kommt
 * genau das Ereignis, das der Empfaenger behandeln soll**, mit einer
 * glaubwuerdigen Nutzlast: wer auf `signature.ready` hin seinen Kunden
 * benachrichtigt, probt das einmal, statt auf eine echte Karte zu warten. Eine
 * Leitungsprobe beweist nichts ueber die Behandlung des Ernstfalls.
 *
 * Der Endpunkt muss das Ereignis abonnieren (`event_not_subscribed`) und aktiv
 * sein (`webhook_inactive`); ein unbekannter Name ist ein `validation`-Fehler
 * auf dem Feld `event`.
 *
 * **Jede Probe traegt `test: true` im Umschlag** ([PartnerWebhookEvent.test]).
 *
 * Der Backend-Endpunkt heisst `sendPartnerWebhookTest`; dieser Client behaelt
 * den Namen bei, damit ein Leser der Doku und ein Leser des Codes dasselbe
 * suchen.
 */
export async function sendPartnerWebhookTest(
  rufen: InternerTransport,
  webhookId: string,
  event?: PartnerWebhookEventType | (string & {}),
): Promise<WebhookTestResult> {
  const id = typeof webhookId === 'string' ? webhookId.trim() : '';
  if (!id) throw new KasseneckValidationError('sendPartnerWebhookTest', 'webhookId fehlt', 'request');
  const ereignis = typeof event === 'string' ? event.trim() : '';
  const daten = objekt(
    await rufen<unknown>('sendPartnerWebhookTest', { webhookId: id, event: ereignis || undefined }),
  );
  return {
    eventId: typeof daten['eventId'] === 'string' ? daten['eventId'] : '',
    event: typeof daten['event'] === 'string' ? daten['event'] : ereignis || 'webhook.test',
    deliveries: (Array.isArray(daten['deliveries']) ? daten['deliveries'] : []).map((eintrag) => {
      const z = objekt(eintrag);
      return {
        deliveryId: typeof z['deliveryId'] === 'string' ? z['deliveryId'] : '',
        webhookId: typeof z['webhookId'] === 'string' ? z['webhookId'] : id,
        status: typeof z['status'] === 'string' ? z['status'] : '',
        statusCode: typeof z['statusCode'] === 'number' ? z['statusCode'] : null,
      };
    }),
  };
}

/**
 * Die letzten Zustellversuche — mit `webhookId` fuer einen Endpunkt, ohne ihn
 * fuer alle. Die Stelle, an der sich „mein Server bekommt nichts" klaeren
 * laesst, ohne bei Kasseneck nachzufragen.
 */
export async function listPartnerWebhookDeliveries(
  rufen: InternerTransport,
  optionen: { webhookId?: string; limit?: number } = {},
): Promise<WebhookZustellung[]> {
  if (optionen.limit !== undefined && (!Number.isInteger(optionen.limit) || optionen.limit < 1 || optionen.limit > 200)) {
    throw new KasseneckValidationError('listPartnerWebhookDeliveries', 'limit muss zwischen 1 und 200 liegen', 'request');
  }
  const daten = objekt(
    await rufen<unknown>('listPartnerWebhookDeliveries', { webhookId: optionen.webhookId, limit: optionen.limit }),
  );
  return (Array.isArray(daten['deliveries']) ? daten['deliveries'] : []).map((eintrag) => {
    const z = objekt(eintrag);
    const zahl = (wert: unknown) => (typeof wert === 'number' && Number.isFinite(wert) ? wert : null);
    const txt = (wert: unknown) => (typeof wert === 'string' ? wert : null);
    return {
      deliveryId: txt(z['deliveryId']) ?? '',
      webhookId: txt(z['webhookId']) ?? '',
      event: txt(z['event']) ?? '',
      eventId: txt(z['eventId']) ?? '',
      status: txt(z['status']) ?? '',
      attempts: zahl(z['attempts']) ?? 0,
      lastAttemptAt: zahl(z['lastAttemptAt']),
      nextAttemptAt: zahl(z['nextAttemptAt']),
      statusCode: zahl(z['statusCode']),
      response: txt(z['response']),
      createdAt: zahl(z['createdAt']),
    };
  });
}
