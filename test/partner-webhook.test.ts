import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  verifyWebhookSignature,
  parseSignatureHeader,
  WEBHOOK_TOLERANCE_SEC,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_PLAN_SEC,
} from '../src/partner/webhook-signatur.js';
import {
  parseWebhookEvent,
  PARTNER_WEBHOOK_EVENTS,
  WEBHOOK_UMSCHLAG_FELDER,
} from '../src/partner/webhooks.js';

/**
 * Die Signaturpruefung ist die eine Stelle, an der ein Fehler NICHT auffaellt:
 * eine zu lasche Pruefung laesst jeden durch und meldet nie etwas. Deshalb
 * pruefen diese Tests nicht nur den guten Fall, sondern jede einzelne Huerde
 * einzeln — und zwar so, dass ihr Wegfall rot wird:
 *
 *   Zeitfenster weg      -> "abgelaufener Zeitstempel" und "Zeitstempel aus der Zukunft"
 *   Rumpf-Bindung weg    -> "verfaelschter Rumpf"
 *   Secret-Bindung weg   -> "fremdes Secret"
 *   Kopf-Pruefung weg    -> "fehlender Kopf", "Kopf ohne v1", "Kopf ohne t"
 *   Laengenpruefung weg  -> "abgeschnittene Signatur" (crypto.timingSafeEqual wuerfe sonst)
 *   catch-als-Ja         -> "eine Ausnahme im Inneren ist eine Ablehnung"
 */

const SECRET = 'whsec_TESTGEHEIMNIS_0123456789';
const RUMPF = JSON.stringify({
  id: 'evt_1',
  type: 'signature.ready',
  createdAt: 1_756_000_000_000,
  partnerId: 'ptn_1',
  data: { customerId: 'cust_1', firma: 'Baeckerei Jobst', requestId: 'req_1' },
});
const JETZT = 1_756_000_000;

/** Wie das Backend signiert (webhook-core.js): HMAC-SHA256 ueber `${t}.${body}`. */
function kopf(t: number, body = RUMPF, secret = SECRET): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

test('Webhook: gueltige Signatur wird angenommen — als Text und als Bytes', async () => {
  const alsText = await verifyWebhookSignature({
    secret: SECRET,
    signatureHeader: kopf(JETZT),
    body: RUMPF,
    nowSec: JETZT,
  });
  assert.deepEqual(alsText, { ok: true, timestampSec: JETZT });

  // Der Empfaenger bekommt in aller Regel Bytes (express.raw) — beides muss
  // zum selben Ergebnis fuehren, sonst haengt die Pruefung an der Kodierung.
  const alsBytes = await verifyWebhookSignature({
    secret: SECRET,
    signatureHeader: kopf(JETZT),
    body: new TextEncoder().encode(RUMPF),
    nowSec: JETZT,
  });
  assert.equal(alsBytes.ok, true);
});

test('Webhook: verfaelschter Rumpf wird abgelehnt', async () => {
  const verfaelscht = RUMPF.replace('cust_1', 'cust_2');
  const r = await verifyWebhookSignature({
    secret: SECRET,
    signatureHeader: kopf(JETZT),
    body: verfaelscht,
    nowSec: JETZT,
  });
  assert.deepEqual(r, { ok: false, reason: 'signature-mismatch' });
});

test('Webhook: ein neu zusammengesetzter Rumpf faellt durch — signiert sind die rohen Bytes', async () => {
  // Der haeufigste Integrationsfehler: JSON.parse, dann JSON.stringify. Die
  // Daten sind dieselben, die Bytes nicht.
  const neuGebaut = JSON.stringify(JSON.parse(RUMPF), null, 2);
  const r = await verifyWebhookSignature({
    secret: SECRET,
    signatureHeader: kopf(JETZT),
    body: neuGebaut,
    nowSec: JETZT,
  });
  assert.equal(r.ok, false);
});

test('Webhook: verfaelschte Signatur wird abgelehnt', async () => {
  const echt = kopf(JETZT);
  // Ein einziges Hex-Zeichen kippen — Laenge und Form bleiben gueltig.
  const letzte = echt.slice(-1);
  const gekippt = echt.slice(0, -1) + (letzte === '0' ? '1' : '0');
  const r = await verifyWebhookSignature({ secret: SECRET, signatureHeader: gekippt, body: RUMPF, nowSec: JETZT });
  assert.deepEqual(r, { ok: false, reason: 'signature-mismatch' });
});

test('Webhook: abgelaufener Zeitstempel wird abgelehnt', async () => {
  const alt = JETZT - WEBHOOK_TOLERANCE_SEC - 1;
  const r = await verifyWebhookSignature({ secret: SECRET, signatureHeader: kopf(alt), body: RUMPF, nowSec: JETZT });
  assert.deepEqual(r, { ok: false, reason: 'timestamp-outside-window' });

  // Genau am Rand gilt sie noch — sonst waere die Grenze eine andere als die
  // zugesagte.
  const rand = await verifyWebhookSignature({
    secret: SECRET,
    signatureHeader: kopf(JETZT - WEBHOOK_TOLERANCE_SEC),
    body: RUMPF,
    nowSec: JETZT,
  });
  assert.equal(rand.ok, true);
});

test('Webhook: Zeitstempel aus der Zukunft wird ebenso abgelehnt', async () => {
  // Sonst hilft eine vorgehende Uhr auf der Gegenseite dem Angreifer.
  const r = await verifyWebhookSignature({
    secret: SECRET,
    signatureHeader: kopf(JETZT + WEBHOOK_TOLERANCE_SEC + 1),
    body: RUMPF,
    nowSec: JETZT,
  });
  assert.deepEqual(r, { ok: false, reason: 'timestamp-outside-window' });
});

test('Webhook: fehlender oder leerer Kopf wird abgelehnt', async () => {
  for (const kein of [undefined, null, '', '   ']) {
    const r = await verifyWebhookSignature({
      secret: SECRET,
      signatureHeader: kein as string | null | undefined,
      body: RUMPF,
      nowSec: JETZT,
    });
    assert.deepEqual(r, { ok: false, reason: 'header-missing' }, `Kopf ${JSON.stringify(kein)}`);
  }
});

test('Webhook: unbrauchbarer Kopf wird abgelehnt, nicht geraten', async () => {
  const kaputt = [
    'v1=abcdef',                       // ohne t
    't=1756000000',                    // ohne v1
    't=heute,v1=abcdef',               // t ist keine Zahl
    't=1e9,v1=abcdef',                 // Exponentialschreibweise waere Number() recht
    't= 1756000000 ,v1=abcdef',        // Leerraum innerhalb des Wertes
    'irgendwas',
  ];
  for (const k of kaputt) {
    const r = await verifyWebhookSignature({ secret: SECRET, signatureHeader: k, body: RUMPF, nowSec: JETZT });
    assert.deepEqual(r, { ok: false, reason: 'header-malformed' }, `Kopf "${k}"`);
  }
});

test('Webhook: fremdes Secret wird abgelehnt', async () => {
  const r = await verifyWebhookSignature({
    secret: 'whsec_EINANDERES',
    signatureHeader: kopf(JETZT),
    body: RUMPF,
    nowSec: JETZT,
  });
  assert.deepEqual(r, { ok: false, reason: 'signature-mismatch' });
});

test('Webhook: fehlendes Secret wird abgelehnt — nicht stillschweigend uebergangen', async () => {
  for (const kein of ['', [], ['']]) {
    const r = await verifyWebhookSignature({
      secret: kein as string | string[],
      signatureHeader: kopf(JETZT),
      body: RUMPF,
      nowSec: JETZT,
    });
    assert.deepEqual(r, { ok: false, reason: 'secret-missing' });
  }
});

test('Webhook: mehrere Secrets erlauben den Schluesselwechsel ohne Zustellungsluecke', async () => {
  const r = await verifyWebhookSignature({
    secret: ['whsec_NEU', SECRET],
    signatureHeader: kopf(JETZT),
    body: RUMPF,
    nowSec: JETZT,
  });
  assert.equal(r.ok, true);
});

test('Webhook: mehrere v1-Anteile — einer muss passen', async () => {
  const echt = kopf(JETZT).split('v1=')[1];
  const r = await verifyWebhookSignature({
    secret: SECRET,
    signatureHeader: `t=${JETZT},v1=${'0'.repeat(64)},v1=${echt}`,
    body: RUMPF,
    nowSec: JETZT,
  });
  assert.equal(r.ok, true);
});

test('Webhook: abgeschnittene und nicht-hexadezimale Signatur werden abgelehnt, nicht geworfen', async () => {
  // Ohne Laengenpruefung wuerfe ein `timingSafeEqual`; ohne Hex-Pruefung
  // entstuenden stille Nullbytes. Beides muss ein sauberes Nein sein.
  const echt = kopf(JETZT).split('v1=')[1] ?? '';
  const faelle = [echt.slice(0, 10), echt + 'ff', 'zzzz', ''];
  for (const v1 of faelle) {
    const r = await verifyWebhookSignature({
      secret: SECRET,
      signatureHeader: `t=${JETZT},v1=${v1}`,
      body: RUMPF,
      nowSec: JETZT,
    });
    assert.equal(r.ok, false, `v1="${v1}" wurde angenommen`);
  }
});

test('Webhook: fehlender Rumpf wird abgelehnt', async () => {
  const r = await verifyWebhookSignature({
    secret: SECRET,
    signatureHeader: kopf(JETZT),
    body: undefined as unknown as string,
    nowSec: JETZT,
  });
  assert.deepEqual(r, { ok: false, reason: 'body-missing' });
});

test('Webhook: eine Ausnahme im Inneren ist eine Ablehnung, nie ein Ja', async () => {
  // Punkt 4 der Zusage. Ein Rumpf, der weder Text noch Bytes ist, laesst das
  // Zusammensetzen der signierten Nachricht werfen — das Ergebnis muss ein
  // sauberes Nein sein und darf nicht am catch vorbei zum Ja werden.
  const r = await verifyWebhookSignature({
    secret: SECRET,
    signatureHeader: kopf(JETZT),
    body: 12345 as unknown as string,
    nowSec: JETZT,
  });
  assert.deepEqual(r, { ok: false, reason: 'signature-mismatch' });

  const s = await parseWebhookEvent({
    secret: SECRET,
    signatureHeader: kopf(JETZT),
    body: { nicht: 'bytes' } as unknown as string,
    nowSec: JETZT,
  });
  assert.equal(s.ok, false);
});

test('Webhook: parseSignatureHeader liest t und alle v1-Anteile', () => {
  assert.deepEqual(parseSignatureHeader('t=17,v1=aa,v1=bb'), { t: 17, v1: ['aa', 'bb'] });
  assert.equal(parseSignatureHeader('t=17'), null);
  assert.equal(parseSignatureHeader('v1=aa'), null);
});

test('Webhook: parseWebhookEvent prueft ERST die Signatur und liest dann', async () => {
  const gut = await parseWebhookEvent({
    secret: SECRET,
    signatureHeader: kopf(JETZT),
    body: RUMPF,
    nowSec: JETZT,
  });
  assert.equal(gut.ok, true);
  if (gut.ok) {
    assert.equal(gut.event.id, 'evt_1');
    assert.equal(gut.event.type, 'signature.ready');
    assert.equal(gut.event.partnerId, 'ptn_1');
    assert.equal((gut.event.data as { customerId?: string }).customerId, 'cust_1');
    // Ein echtes Ereignis fuehrt das Feld `test` nicht — hier steht `false`.
    assert.equal(gut.event.test, false);
  }

  // Ein Rumpf, der gar kein JSON ist, kommt gar nicht erst zum Lesen: die
  // Signatur passt schon nicht.
  const schlecht = await parseWebhookEvent({
    secret: SECRET,
    signatureHeader: kopf(JETZT),
    body: 'kein json',
    nowSec: JETZT,
  });
  assert.deepEqual(schlecht, { ok: false, reason: 'signature-mismatch' });
});

test('Webhook: richtig signiertes, aber unbrauchbares JSON wird als solches gemeldet', async () => {
  const nurText = '"hallo"';
  const a = await parseWebhookEvent({
    secret: SECRET,
    signatureHeader: kopf(JETZT, nurText),
    body: nurText,
    nowSec: JETZT,
  });
  assert.deepEqual(a, { ok: false, reason: 'body-not-event' });

  const kaputt = '{';
  const b = await parseWebhookEvent({
    secret: SECRET,
    signatureHeader: kopf(JETZT, kaputt),
    body: kaputt,
    nowSec: JETZT,
  });
  assert.deepEqual(b, { ok: false, reason: 'body-not-json' });
});

test('Webhook: unbekannter Ereignistyp kommt durch statt zu scheitern', async () => {
  // Eine spaeter ergaenzte Ereignisart darf einen laufenden Empfaenger nicht
  // anhalten — sie landet in seinem default-Zweig.
  const rumpf = JSON.stringify({ id: 'evt_9', type: 'kasse.neu_erfunden', createdAt: 1, partnerId: 'p', data: {} });
  const r = await parseWebhookEvent({
    secret: SECRET,
    signatureHeader: kopf(JETZT, rumpf),
    body: rumpf,
    nowSec: JETZT,
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.event.type, 'kasse.neu_erfunden');
});

/**
 * Die Marke, an der eine Probe von einem echten Ereignis zu unterscheiden ist.
 *
 * Rot-Probe: `test: e['test'] === true` in webhooks.ts durch `test: false`
 * ersetzen — dann faellt genau dieser Test („eine Probe traegt test:true"),
 * und der Handler eines Partners haette `if (ereignis.test) return;`
 * geschrieben, ohne dass es je greift.
 */
test('Webhook: eine Probe traegt test:true, ein echtes Ereignis das Feld gar nicht', async () => {
  const probe = JSON.stringify({
    id: 'evt_probe',
    type: 'cashregister.live',
    createdAt: 1,
    partnerId: 'ptn_1',
    test: true,
    data: { customerId: 'ptest_beispiel00000000', cashregisterId: 'KECK-1' },
  });
  const p = await parseWebhookEvent({
    secret: SECRET,
    signatureHeader: kopf(JETZT, probe),
    body: probe,
    nowSec: JETZT,
  });
  assert.equal(p.ok, true);
  if (p.ok) assert.equal(p.event.test, true, 'ohne diese Marke haelt jemand eine Probe fuer echt');

  // Nur ein ausdrueckliches `true` zaehlt. Alles andere ist der Ernstfall —
  // sonst verschluckte ein `test: "false"` aus einer fremden Quelle eine
  // echte Kasse.
  for (const wert of ['true', 1, {}, null]) {
    const rumpf = JSON.stringify({ id: 'e', type: 'cashregister.live', createdAt: 1, partnerId: 'p', test: wert, data: {} });
    const r = await parseWebhookEvent({
      secret: SECRET,
      signatureHeader: kopf(JETZT, rumpf),
      body: rumpf,
      nowSec: JETZT,
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.event.test, false, `test:${JSON.stringify(wert)} ist keine Probe`);
  }
});

test('Webhook: der Umschlag fuehrt genau die Felder des Backends', () => {
  // webhook-core.payload() baut ihn in dieser Reihenfolge; `test` steht nur
  // auf Proben darin.
  assert.deepEqual([...WEBHOOK_UMSCHLAG_FELDER], ['id', 'type', 'createdAt', 'partnerId', 'test', 'data']);
});

test('Webhook: der Ereignis-Katalog stimmt mit dem Backend ueberein', () => {
  // Diese Liste ist eine Zusage an den Aufrufer (Typvervollstaendigung beim
  // Abonnieren). Sie steht so in partner-core.js WEBHOOK_EVENTS_OFFEN —
  // OHNE die internen Ereignisse: was ein Partner nicht abonnieren kann, darf
  // hier nicht als abonnierbar erscheinen.
  assert.deepEqual([...PARTNER_WEBHOOK_EVENTS], [
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
  ]);
  assert.equal(
    PARTNER_WEBHOOK_EVENTS.includes('customer.avv_accepted' as never),
    false,
    'customer.avv_accepted ist intern — weder abonnierbar noch probbar',
  );
});

test('Webhook: Wiederholungsplan und Toleranz stimmen mit dem Versand ueberein', () => {
  assert.deepEqual([...WEBHOOK_RETRY_PLAN_SEC], [60, 300, 1800, 7200, 43200]);
  assert.equal(WEBHOOK_MAX_ATTEMPTS, 6);
  assert.equal(WEBHOOK_TOLERANCE_SEC, 300);
});
