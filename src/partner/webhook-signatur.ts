/**
 * Pruefung der Signatur eingehender Kasseneck-Webhooks.
 *
 * **Das ist der Teil, den Integratoren am haeufigsten falsch bauen** — und der
 * einzige, bei dem ein Fehler nicht auffaellt: eine zu lasche Pruefung laesst
 * jeden durch, der die Adresse kennt, und meldet dabei nie etwas. Deshalb
 * liegt sie fertig im Paket und nicht als Beispielschnipsel in der Doku.
 *
 * Vier Dinge muessen stimmen, und jedes einzelne fehlt in der Praxis regelmaessig:
 *
 * 1. **Der ROHE Rumpf.** Signiert werden die Bytes, die ankommen — nicht das
 *    Ergebnis von `JSON.parse` und erneutem `JSON.stringify`. Schluesselreihen-
 *    folge, Zahlenschreibweise und Leerraum aendern sich dabei, und die
 *    Signatur passt nicht mehr. In Express heisst das `express.raw({type:'*​/*'})`
 *    **vor** jedem JSON-Parser fuer diesen Pfad.
 * 2. **Das Zeitfenster.** Ohne Pruefung von `t` ist eine einmal mitgeschnittene,
 *    gueltig signierte Zustellung fuer immer wiederverwendbar. 300 Sekunden in
 *    beide Richtungen — auch in die Zukunft, sonst hilft eine falsch gestellte
 *    Uhr auf der Gegenseite dem Angreifer.
 * 3. **Der zeitkonstante Vergleich.** Ein `===` auf Hex-Zeichenketten bricht
 *    beim ersten abweichenden Zeichen ab. Wer messen kann, wie lange die
 *    Ablehnung dauert, raet die Signatur Zeichen fuer Zeichen.
 * 4. **Jede Ausnahme ist eine Ablehnung.** Ein `catch`, das weiterlaufen laesst,
 *    macht aus einem Formfehler ein Ja.
 *
 * Der Kopf lautet `X-Kasseneck-Signature: t=<unix-sekunden>,v1=<hex>` mit
 * `v1 = HMAC-SHA256(secret, "<t>.<roher Rumpf>")`. **Mehrere `v1=`-Anteile sind
 * erlaubt** — so laeuft ein Schluesselwechsel ohne Zustellungsluecke; es reicht,
 * wenn einer passt.
 *
 * Umgesetzt mit WebCrypto (`crypto.subtle`) statt `node:crypto`: dieses Paket
 * haengt an keiner Laufzeit-Abhaengigkeit und wird auch fuer den Browser
 * gebuendelt. Deshalb ist die Pruefung **asynchron**.
 */

/** Der Kopf, in dem die Signatur steht. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Kasseneck-Signature';
/** Der Kopf mit dem Ereignisnamen (dasselbe wie `body.type`). */
export const WEBHOOK_EVENT_HEADER = 'X-Kasseneck-Event';
/** Der Kopf mit der Zustell-Kennung — bei Wiederholungen **dieselbe**. */
export const WEBHOOK_DELIVERY_HEADER = 'X-Kasseneck-Delivery';

/** Erlaubte Abweichung des Zeitstempels, in Sekunden (in beide Richtungen). */
export const WEBHOOK_TOLERANCE_SEC = 300;

/** Wartezeiten zwischen den Zustellversuchen, in Sekunden. */
export const WEBHOOK_RETRY_PLAN_SEC: readonly number[] = [60, 300, 1800, 7200, 43200];
/** Erstversuch plus je eine Wiederholung pro Planeintrag. */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_PLAN_SEC.length + 1;
/** So lange wartet Kasseneck auf eine 2xx-Antwort. */
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** Hoechstzahl der Webhook-Endpunkte je Partner. */
export const WEBHOOK_LIMIT = 10;

/** Warum eine Zustellung abgelehnt wurde. Jeder Grund ist ein Nein. */
export type WebhookVerifyReason =
  | 'secret-missing'
  | 'header-missing'
  | 'header-malformed'
  | 'body-missing'
  | 'timestamp-outside-window'
  | 'signature-mismatch';

export type WebhookVerifyResult =
  | { ok: true; timestampSec: number }
  | { ok: false; reason: WebhookVerifyReason };

export interface VerifyWebhookOptions {
  /**
   * Das Secret aus `createPartnerWebhook` — es verlaesst den Server genau
   * einmal. Eine Liste erlaubt den Schluesselwechsel: es reicht, wenn einer
   * passt.
   */
  secret: string | readonly string[];
  /** Der Wert des Kopfes `X-Kasseneck-Signature`, unveraendert. */
  signatureHeader: string | null | undefined;
  /**
   * Der **rohe** Rumpf — Bytes oder die daraus gelesene Zeichenkette. Nicht
   * das Ergebnis von `JSON.parse`, und nichts, was danach wieder
   * zusammengesetzt wurde.
   */
  body: string | Uint8Array;
  /** Jetzt, in Unix-Sekunden. Vorgabe: die Systemuhr. Fuer Tests setzbar. */
  nowSec?: number;
  /** Abweichender Toleranzrahmen in Sekunden; Vorgabe [WEBHOOK_TOLERANCE_SEC]. */
  toleranceSec?: number;
}

/**
 * Prueft die Signatur einer eingehenden Zustellung.
 *
 * Antwortet **nie** mit einem geworfenen Fehler auf schlechte Eingaben: jede
 * Ausnahme im Inneren wird zur Ablehnung. Ein Aufrufer, der nur `ok` abfragt,
 * kann damit nichts falsch machen.
 */
export async function verifyWebhookSignature(optionen: VerifyWebhookOptions): Promise<WebhookVerifyResult> {
  try {
    const secrets = (Array.isArray(optionen.secret) ? optionen.secret : [optionen.secret]).filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    if (!secrets.length) return { ok: false, reason: 'secret-missing' };

    if (typeof optionen.signatureHeader !== 'string' || !optionen.signatureHeader.trim()) {
      return { ok: false, reason: 'header-missing' };
    }
    const kopf = parseSignatureHeader(optionen.signatureHeader);
    if (kopf === null) return { ok: false, reason: 'header-malformed' };

    if (optionen.body === undefined || optionen.body === null) return { ok: false, reason: 'body-missing' };

    const jetzt = typeof optionen.nowSec === 'number' && Number.isFinite(optionen.nowSec)
      ? optionen.nowSec
      : Math.floor(Date.now() / 1000);
    const toleranz = typeof optionen.toleranceSec === 'number' && Number.isFinite(optionen.toleranceSec)
      ? optionen.toleranceSec
      : WEBHOOK_TOLERANCE_SEC;
    // In BEIDE Richtungen: eine vorgehende Uhr auf der Gegenseite darf ein
    // altes Ereignis nicht wieder gueltig machen.
    if (Math.abs(jetzt - kopf.t) > toleranz) return { ok: false, reason: 'timestamp-outside-window' };

    const nachricht = signierteBytes(kopf.t, optionen.body);
    for (const secret of secrets) {
      const soll = await hmacSha256(secret, nachricht);
      for (const v1 of kopf.v1) {
        const ist = hexZuBytes(v1);
        if (ist !== null && gleichZeitkonstant(ist, soll)) return { ok: true, timestampSec: kopf.t };
      }
    }
    return { ok: false, reason: 'signature-mismatch' };
  } catch {
    // Punkt 4 im Modulkommentar: eine Ausnahme ist eine Ablehnung, nie ein Ja.
    return { ok: false, reason: 'signature-mismatch' };
  }
}

/**
 * Zerlegt den Signaturkopf. `null`, wenn kein brauchbarer Zeitstempel oder gar
 * kein `v1=`-Anteil darin steht.
 */
export function parseSignatureHeader(kopf: string): { t: number; v1: string[] } | null {
  const teile = String(kopf).split(',').map((x) => x.trim());
  const tTeil = teile.find((x) => x.startsWith('t='));
  const v1 = teile.filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  if (!tTeil || !v1.length) return null;
  const roh = tTeil.slice(2);
  // Nur ganze Zahlen: `Number('1e9')` und `Number(' 12 ')` waeren sonst gueltige
  // Zeitstempel, und `parseInt('12abc')` ebenfalls.
  if (!/^\d{1,15}$/.test(roh)) return null;
  return { t: Number(roh), v1 };
}

/** `<t>.<roher Rumpf>` als Bytes — genau das, was das Backend signiert. */
function signierteBytes(t: number, body: string | Uint8Array): Uint8Array {
  const praefix = new TextEncoder().encode(`${t}.`);
  const rumpf = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const zusammen = new Uint8Array(praefix.length + rumpf.length);
  zusammen.set(praefix, 0);
  zusammen.set(rumpf, praefix.length);
  return zusammen;
}

async function hmacSha256(secret: string, nachricht: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'verifyWebhookSignature: kein WebCrypto vorhanden — Node >= 20.18 verwenden (globalThis.crypto.subtle)',
    );
  }
  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatur = await subtle.sign('HMAC', key, nachricht as unknown as ArrayBuffer);
  return new Uint8Array(signatur);
}

/** Hex zu Bytes; `null` bei ungerader Laenge oder Nicht-Hex. */
function hexZuBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * Vergleich ohne frueh Abbrechen. Die Laengenpruefung davor verraet nur die
 * Laenge des Hashs, und die ist bekannt (SHA-256, 32 Bytes); der Inhalt wird
 * immer vollstaendig durchlaufen.
 */
function gleichZeitkonstant(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let unterschied = 0;
  for (let i = 0; i < a.length; i++) unterschied |= (a[i] as number) ^ (b[i] as number);
  return unterschied === 0;
}
