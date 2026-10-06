/**
 * Eingehende Konto-Webhooks der Lager-API: Signatur pruefen, Ereignis lesen.
 *
 * Dasselbe Verfahren wie bei Partner-Webhooks (Backend
 * `gemeinsam/webhook-core.js`, `signaturKopf`/`pruefeSignatur`): Kopf
 * `X-Kasseneck-Signature: t=<unix-sekunden>,v1=<hex>` mit
 * `v1 = HMAC-SHA256(secret, "<t>.<roher Rumpf>")`, Zeitfenster 300 Sekunden in
 * beide Richtungen, zeitkonstanter Vergleich, mehrere `v1=`-Anteile erlaubt.
 * Die Pruefung selbst liegt in `partner/webhook-signatur.ts` und wird hier nur
 * mit der Form `(secret, kopf, rumpf, optionen)` angeboten.
 *
 * Reihenfolge im Empfaenger: **erst pruefen, dann lesen**, und dabei den
 * **rohen** Rumpf nehmen (in Express `express.raw({ type: '*\/*' })` vor jedem
 * JSON-Parser).
 */

import { KasseneckValidationError } from '../client/errors.js';
import { verifyWebhookSignature as pruefeSignatur } from '../partner/webhook-signatur.js';
import { artikel, bestandGeaendert, objekt, unterMindestbestand } from './lesen.js';
import { INVENTORY_WEBHOOK_EVENTS, type InventoryWebhookEventType } from './vertrag.js';
import type { InventoryWebhookEvent } from './typen.js';

export {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_TOLERANCE_SEC,
} from '../partner/webhook-signatur.js';

export interface VerifyInventoryWebhookOptions {
  /** Erlaubte Abweichung des Zeitstempels in Sekunden, in beide Richtungen; Vorgabe 300. */
  toleranceSec?: number;
  /** Jetzt: ein `Date` oder Millisekunden seit 1970 (wie `Date.now()`). Vorgabe: die Systemuhr. */
  now?: Date | number;
}

/**
 * Prueft die Signatur einer Zustellung. `true` nur, wenn Kopf, Zeitfenster
 * und HMAC stimmen; jede schlechte Eingabe und jede Ausnahme ist `false`,
 * nie ein Wurf.
 *
 * **Asynchron**, weil die Pruefung WebCrypto (`crypto.subtle`) benutzt: das
 * Paket hat keine Laufzeitabhaengigkeit und laeuft auch im Browser.
 *
 * @param secret  das Secret aus `createWebhook`/`rotateWebhookSecret`; eine
 *                Liste erlaubt den Wechsel (es reicht, wenn eines passt)
 * @param header  der Wert von `X-Kasseneck-Signature`, unveraendert
 * @param rawBody der **rohe** Rumpf (Text oder Bytes), nicht `JSON.parse` + `stringify`
 */
export async function verifyWebhookSignature(
  secret: string | readonly string[],
  header: string | null | undefined,
  rawBody: string | Uint8Array,
  options: VerifyInventoryWebhookOptions = {},
): Promise<boolean> {
  try {
    const jetzt = options.now instanceof Date ? options.now.getTime() : options.now;
    const nowSec = typeof jetzt === 'number' && Number.isFinite(jetzt) ? Math.floor(jetzt / 1000) : undefined;
    const r = await pruefeSignatur({
      secret,
      signatureHeader: header,
      body: rawBody,
      ...(nowSec === undefined ? {} : { nowSec }),
      ...(options.toleranceSec === undefined ? {} : { toleranceSec: options.toleranceSec }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const BEKANNT: ReadonlySet<string> = new Set(INVENTORY_WEBHOOK_EVENTS);

function kaputt(grund: string): KasseneckValidationError {
  return new KasseneckValidationError('parseWebhookEvent', grund, 'response');
}

/**
 * Liest eine Zustellung als typisiertes Ereignis. Vorher die Signatur pruefen
 * ([verifyWebhookSignature]).
 *
 * - Ein Ereignis, das diese Paketversion nicht kennt (etwa `reservation.*`
 *   einer spaeteren Stufe), ergibt `null`: mit 2xx antworten und uebergehen.
 * - Ein Rumpf, der keine Huelle ist, oder eine Bruchzahl in einer Menge wirft
 *   `KasseneckValidationError` (`scope: 'response'`).
 *
 * **Entdoppeln** auf `event.id`; **Stand statt Aenderung**: einen gespeicherten
 * Bestand nur ueberschreiben, wenn `data.sequence` groesser ist.
 */
export function parseWebhookEvent(rawBody: string | Uint8Array): InventoryWebhookEvent | null {
  const text = typeof rawBody === 'string' ? rawBody : new TextDecoder('utf-8').decode(rawBody);
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    throw kaputt('Rumpf ist kein JSON');
  }
  const e = objekt(roh);
  if (!e) throw kaputt('Rumpf ist kein Ereignis (kein Objekt)');
  const { id, type, createdAt, accountId, data } = e;
  if (typeof id !== 'string' || id === '' || typeof type !== 'string' || type === '') throw kaputt('Ereignis ohne id oder type');
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) throw kaputt('Ereignis ohne createdAt');
  if (typeof accountId !== 'string' || accountId === '') throw kaputt('Ereignis ohne accountId');
  if (!BEKANNT.has(type)) return null;
  const ort = { name: 'parseWebhookEvent', pfad: 'data' };
  if (!objekt(data)) throw kaputt('Ereignis ohne data');
  // Nur ein ausdrueckliches `true` ist eine Probe; im Zweifel der Ernstfall.
  const huelle = { id, type: type as InventoryWebhookEventType, createdAt, accountId, test: e.test === true };
  switch (huelle.type) {
    case 'stock.changed':
      return { ...huelle, type: huelle.type, data: bestandGeaendert(ort, data) };
    case 'stock.below_minimum':
      return { ...huelle, type: huelle.type, data: unterMindestbestand(ort, data) };
    default:
      return { ...huelle, type: huelle.type, data: artikel(ort, data) };
  }
}
