import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

import { createPartnerApi } from '../src/partner/api.js';
import { partnerKeyAuth, partnerKeyEnv } from '../src/partner/auth.js';
import { PARTNER_ABLAUF, naechsterSchritt } from '../src/partner/ablauf.js';
import {
  AVV_MODI,
  PARTNER_FEHLER_CODES,
  istPartnerFehler,
  partnerFehlerCode,
  partnerFehlerRat,
  partnerFeldFehler,
  partnerWartezeitSek,
  vertragOffenRat,
} from '../src/partner/fehler.js';
import { AUFRUFE } from '../src/client/aufrufe.js';
import {
  KasseneckApiError,
  KasseneckAuthError,
  KasseneckValidationError,
} from '../src/client/errors.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';

const PARTNER_KEY = 'pk_live_GEHEIMERPARTNERSCHLUESSEL42';

interface Aufzeichnung {
  url: string;
  init: HttpRequestInit;
}

/** Antwort im Sinn von `HttpResponseLike` — Attrappe, kein echtes fetch. */
function antwort(rumpf: unknown): HttpResponseLike {
  const text = typeof rumpf === 'string' ? rumpf : JSON.stringify(rumpf);
  return {
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  };
}

/** Ein Client, der genau die uebergebenen Antworten der Reihe nach liefert. */
function stelle(...antworten: unknown[]) {
  const gesehen: Aufzeichnung[] = [];
  let i = 0;
  const fetchLike: FetchLike = async (url, init) => {
    gesehen.push({ url, init });
    const naechste = antworten[Math.min(i, antworten.length - 1)];
    i += 1;
    return antwort(naechste);
  };
  const api = createPartnerApi({ partnerKey: PARTNER_KEY, fetch: fetchLike, avvModus: 'vollmacht' });
  return { api, gesehen };
}

const erfolg = (data: unknown) => ({ status: 'success', message: 'ok', data });
const fehler = (message: string, data: unknown) => ({ status: 'error', message, data });

function rumpfVon(a: Aufzeichnung): { params: Record<string, unknown> } {
  return JSON.parse(a.init.body) as { params: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Anmeldung
// ---------------------------------------------------------------------------

test('Partner: der Schluessel geht als Bearer raus, ohne Kassen-Token', async () => {
  const { api, gesehen } = stelle(erfolg({ partner: { id: 'ptn_1', name: 'Muster GmbH', status: 'aktiv' }, env: 'live' }));
  await api.getPartnerInfo();
  const a = gesehen[0]!;
  assert.equal(a.url, 'https://api.kasseneck.at/v1/getPartnerInfo');
  assert.equal(a.init.method, 'POST');
  assert.equal(a.init.headers['Authorization'], `Bearer ${PARTNER_KEY}`);
  // Ein Partner arbeitet nie an einer Kasse — die Kopfzeile hat hier nichts verloren.
  assert.equal(a.init.headers['cashregister-token'], undefined);
  assert.deepEqual(rumpfVon(a), { params: {} });
});

test('Partner: ein Betriebsschluessel wird vor dem Senden abgelehnt', () => {
  // kr_live_… ist ein tadelloser Schluessel — nur fuer einen anderen Weg. Ohne
  // diese Pruefung kaeme ein nichtssagendes "ungueltiger Schluessel" vom Server.
  assert.throws(() => partnerKeyAuth({ partnerKey: 'kr_live_ABCDEFGHIJKLMNOPQ' }), KasseneckAuthError);
  assert.throws(() => partnerKeyAuth({ partnerKey: '' }), KasseneckAuthError);
  assert.throws(() => partnerKeyAuth({ partnerKey: 'pk_live_kurz' }), KasseneckAuthError);
  assert.doesNotThrow(() => partnerKeyAuth({ partnerKey: PARTNER_KEY }));
});

test('Partner: kein Fehler nennt den Schluessel', () => {
  try {
    partnerKeyAuth({ partnerKey: 'kr_live_GEHEIMERKUNDENSCHLUESSEL' });
    assert.fail('haette werfen muessen');
  } catch (e) {
    const ausgabe = `${(e as Error).message} ${inspect(e, { depth: null })}`;
    assert.ok(!ausgabe.includes('GEHEIMERKUNDENSCHLUESSEL'), ausgabe);
  }
});

test('Partner: die Umgebung steht im Schluessel und ist ohne Netz ablesbar', () => {
  assert.equal(partnerKeyEnv('pk_test_ABCDEFGHIJKLMNOPQ'), 'test');
  assert.equal(partnerKeyEnv(PARTNER_KEY), 'live');
  assert.equal(partnerKeyEnv('kr_live_ABCDEFGHIJKLMNOPQ'), null);
});

// ---------------------------------------------------------------------------
// Betriebe
// ---------------------------------------------------------------------------

const BETRIEB = {
  company_name: 'Baeckerei Jobst e.U.',
  rechtsform: 'eu',
  email: 'chef@jobst.at',
  address: { street: 'Hauptstrasse', number: '12a', zip: '5020', city: 'Salzburg' },
  bundesland: 'salzburg',
  tax_details: { taxnr: '12-345/6789', is_small_business: false },
  contacts: [{ name: 'Anna Jobst', email: 'anna@jobst.at' }],
} as const;

test('Partner: createPartnerCustomer sendet appId, betrieb und den Idempotenzschluessel', async () => {
  const { api, gesehen } = stelle(
    erfolg({
      customerId: 'cust_1',
      status: 'angelegt',
      env: 'live',
      firma: 'Baeckerei Jobst e.U.',
      appId: 'app_1',
      zugang: { eingeladen: true, sentTo: 'c***@jobst.at' },
      naechsteSchritte: ['FinanzOnline-Link senden'],
    }),
  );
  const r = await api.createPartnerCustomer({
    appId: 'app_1',
    betrieb: BETRIEB as never,
    idempotencyKey: 'eigene-kundennummer-4711',
  });
  assert.deepEqual(rumpfVon(gesehen[0]!).params, {
    appId: 'app_1',
    betrieb: BETRIEB,
    idempotencyKey: 'eigene-kundennummer-4711',
  });
  assert.equal(r.customerId, 'cust_1');
  assert.equal(r.zugang.eingeladen, true);
  assert.equal(r.wiederholt, false);
});

test('Partner: eine wiederholte Anlage meldet sich als solche', async () => {
  const { api } = stelle(erfolg({ customerId: 'cust_1', wiederholt: true, zugang: {} }));
  const r = await api.createPartnerCustomer({ appId: 'app_1', betrieb: BETRIEB as never, idempotencyKey: 'x' });
  assert.equal(r.wiederholt, true);
});

test('Partner: fehlende Pflichtangaben gehen gar nicht erst raus', async () => {
  const { api, gesehen } = stelle(erfolg({}));
  await assert.rejects(
    () => api.createPartnerCustomer({ appId: '', betrieb: BETRIEB as never }),
    (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'request',
  );
  await assert.rejects(() => api.getPartnerCustomer('  '), KasseneckValidationError);
  await assert.rejects(() => api.activateCashregister('cust_1', ''), KasseneckValidationError);
  assert.equal(gesehen.length, 0, 'es wurde trotzdem gesendet');
});

test('Partner: listPartnerCustomers seitenweise, mit Grenzen fuer limit', async () => {
  const { api, gesehen } = stelle(
    erfolg({
      kunden: [{ customerId: 'cust_1', firma: 'A', status: 'live', appId: 'app_1', env: 'live', createdAt: 5 }],
      cursor: 'weiter',
      gesamt: 12,
    }),
  );
  const r = await api.listPartnerCustomers({ status: 'live', limit: 50, cursor: 'a' });
  assert.deepEqual(rumpfVon(gesehen[0]!).params, { status: 'live', limit: 50, cursor: 'a' });
  assert.equal(r.cursor, 'weiter');
  assert.equal(r.gesamt, 12);
  assert.equal(r.kunden[0]?.customerId, 'cust_1');
  await assert.rejects(() => api.listPartnerCustomers({ limit: 0 }), KasseneckValidationError);
  await assert.rejects(() => api.listPartnerCustomers({ limit: 201 }), KasseneckValidationError);
});

test('Partner: getPartnerCustomer liest die Huelle "kunde" und faellt nicht ueber null-Felder', async () => {
  const { api } = stelle(
    erfolg({
      kunde: {
        customerId: 'cust_1',
        firma: 'A',
        status: 'signatur_bereit',
        env: 'test',
        liveEnabled: false,
        appId: null,
        angelegtVia: 'api',
        betrieb: { company_name: 'A' },
        fon: { eingerichtet: true, verifiedAt: 99 },
        zugang: null,
      },
    }),
  );
  const k = await api.getPartnerCustomer('cust_1');
  assert.equal(k.status, 'signatur_bereit');
  assert.equal(k.fon.eingerichtet, true);
  assert.equal(k.zugang, null);
  assert.equal(k.appId, null);
});

test('Partner: eine Antwort ohne die zugesagte Huelle wirft, statt spaeter zu ueberraschen', async () => {
  const { api } = stelle(erfolg({ irgendwas: 1 }));
  await assert.rejects(
    () => api.getPartnerCustomer('cust_1'),
    (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response',
  );
});

test('Partner: sendPartnerCustomerFonLink gibt den Empfaenger maskiert zurueck', async () => {
  const { api } = stelle(erfolg({ customerId: 'cust_1', sentTo: 'c***@jobst.at', expiresAt: 123 }));
  const r = await api.sendPartnerCustomerFonLink('cust_1');
  assert.equal(r.sentTo, 'c***@jobst.at');
  assert.equal(r.expiresAt, 123);
});

// ---------------------------------------------------------------------------
// Signatur und Kassen
// ---------------------------------------------------------------------------

test('Partner: requestCustomerSignature liefert den Antrag; ein zweiter Ruf den laufenden', async () => {
  const { api, gesehen } = stelle(
    erfolg({
      antrag: { requestId: 'req_1', status: 'beantragt', statusText: 'Beantragt', art: 'signaturkarte', historie: [] },
      wiederholt: true,
      hinweis: 'Es lief bereits ein Antrag.',
    }),
  );
  const r = await api.requestCustomerSignature('cust_1');
  assert.deepEqual(rumpfVon(gesehen[0]!).params, { customerId: 'cust_1' });
  assert.equal(r.antrag.requestId, 'req_1');
  assert.equal(r.wiederholt, true);
  assert.equal(r.hinweis, 'Es lief bereits ein Antrag.');
});

test('Partner: getCustomerSignatureStatus trennt "bereit" von "registriert"', async () => {
  const { api } = stelle(
    erfolg({
      signatur: { bereit: false, signatureId: null, vdaId: null },
      antraege: [{ requestId: 'req_1', status: 'registriert', statusText: 'Bei FinanzOnline registriert', historie: [] }],
      fon: { vorhanden: true, geprueftAt: 7 },
    }),
  );
  const s = await api.getCustomerSignatureStatus('cust_1');
  assert.equal(s.signatur.bereit, false);
  assert.equal(s.antraege[0]?.status, 'registriert');
  assert.equal(s.fon.vorhanden, true);
});

test('Partner: createCustomerCashregister darf vor der Signatur laufen und sagt, warum nichts geschah', async () => {
  const { api, gesehen } = stelle(
    erfolg({
      kasse: {
        cashregisterId: 'kasse_1',
        name: 'Theke',
        status: 'entwurf',
        statusText: 'Entwurf',
        automatisch: true,
        schritt: 'signatur',
        schrittText: 'Signaturkarte zuweisen',
        erledigt: [],
        schritte: [{ key: 'signatur', text: 'Signaturkarte zuweisen' }],
        versuche: 0,
      },
      inbetriebnahme: { gestartet: false, ok: null, schritt: null, grund: 'signature_not_ready' },
    }),
  );
  const r = await api.createCustomerCashregister({ customerId: 'cust_1', name: 'Theke' });
  assert.deepEqual(rumpfVon(gesehen[0]!).params, { customerId: 'cust_1', name: 'Theke' });
  assert.equal(r.kasse.status, 'entwurf');
  assert.equal(r.kasse.automatisch, true);
  assert.equal(r.inbetriebnahme.grund, 'signature_not_ready');
  assert.equal(r.inbetriebnahme.ok, null, 'ok:null heisst "nicht gelaufen" und darf nicht zu false werden');
});

test('Partner: ein zu langer Kassenname geht nicht raus', async () => {
  const { api, gesehen } = stelle(erfolg({}));
  await assert.rejects(
    () => api.createCustomerCashregister({ customerId: 'cust_1', name: 'x'.repeat(61) }),
    KasseneckValidationError,
  );
  assert.equal(gesehen.length, 0);
});

test('Partner: activateCashregister meldet eine bereits laufende Kasse als unveraendert', async () => {
  const { api, gesehen } = stelle(
    erfolg({ kasse: { cashregisterId: 'kasse_1', status: 'live', statusText: 'In Betrieb', schritt: null }, unveraendert: true }),
  );
  const r = await api.activateCashregister('cust_1', 'kasse_1');
  assert.deepEqual(rumpfVon(gesehen[0]!).params, { customerId: 'cust_1', cashregisterId: 'kasse_1' });
  assert.equal(r.unveraendert, true);
  assert.equal(r.kasse.schritt, null);
});

test('Partner: listCustomerCashregisters bringt nie Token', async () => {
  const { api } = stelle(
    erfolg({ customerId: 'cust_1', kassen: [{ cashregisterId: 'kasse_1', status: 'live' }], signaturBereit: true }),
  );
  const r = await api.listCustomerCashregisters('cust_1');
  assert.equal(r.signaturBereit, true);
  assert.equal('cashregisterToken' in (r.kassen[0] as object), false);
});

// ---------------------------------------------------------------------------
// Vertrag
// ---------------------------------------------------------------------------

test('Partner: reportCustomerVertrag uebersetzt customerId auf das Feld kundeId', async () => {
  const { api, gesehen } = stelle(erfolg({ vertragId: 'v_1', bestaetigtAt: 5, art: 'avv', version: '2026-08' }));
  const r = await api.reportCustomerVertrag({
    customerId: 'cust_1',
    art: 'avv',
    version: '2026-08',
    textHash: 'abc',
    name: 'Anna Jobst',
    funktion: 'Inhaberin',
    akzeptiertAt: 42,
  });
  // Der Endpunkt heisst das Feld kundeId; der Client nennt es ueberall
  // customerId. Zwei Namen fuer dieselbe Kennung waeren eine Fehlerquelle.
  assert.deepEqual(rumpfVon(gesehen[0]!).params, {
    kundeId: 'cust_1',
    art: 'avv',
    version: '2026-08',
    textHash: 'abc',
    name: 'Anna Jobst',
    funktion: 'Inhaberin',
    akzeptiertAt: 42,
  });
  assert.equal(r.vertragId, 'v_1');
});

test('Partner: in Vollmacht laesst sich nur der AVV melden — der Client sendet nichts anderes', async () => {
  const { api, gesehen } = stelle(erfolg({}));
  await assert.rejects(
    () =>
      api.reportCustomerVertrag({
        customerId: 'cust_1',
        art: 'nutzung' as never,
        version: '1',
        textHash: 'a',
        name: 'A',
        funktion: 'B',
      }),
    KasseneckValidationError,
  );
  assert.equal(gesehen.length, 0);
});

// ---------------------------------------------------------------------------
// Webhook-Verwaltung
// ---------------------------------------------------------------------------

test('Partner: createPartnerWebhook liefert das Secret — und wirft, wenn es fehlt', async () => {
  const { api, gesehen } = stelle(
    erfolg({
      webhook: { webhookId: 'wh_1', url: 'https://api.firma.at/hook', events: ['signature.ready'], aktiv: true },
      secret: 'whsec_1',
    }),
  );
  const r = await api.createPartnerWebhook({ url: 'https://api.firma.at/hook', events: ['signature.ready'] });
  assert.deepEqual(rumpfVon(gesehen[0]!).params, { url: 'https://api.firma.at/hook', events: ['signature.ready'] });
  assert.equal(r.secret, 'whsec_1');
  assert.equal(r.webhook.aktiv, true);

  const ohne = stelle(erfolg({ webhook: { webhookId: 'wh_1' } }));
  await assert.rejects(
    () => ohne.api.createPartnerWebhook({ url: 'https://api.firma.at/hook', events: ['webhook.test'] }),
    (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response',
  );
});

test('Partner: ein Webhook ohne Ereignis geht nicht raus', async () => {
  const { api, gesehen } = stelle(erfolg({}));
  await assert.rejects(
    () => api.createPartnerWebhook({ url: 'https://api.firma.at/hook', events: [] }),
    KasseneckValidationError,
  );
  assert.equal(gesehen.length, 0);
});

test('Partner: listPartnerWebhooks bringt den Ereignis-Katalog mit', async () => {
  const { api } = stelle(
    erfolg({ webhooks: [{ webhookId: 'wh_1', aktiv: false }], ereignisse: [{ key: 'webhook.test', text: 'Testereignis' }] }),
  );
  const r = await api.listPartnerWebhooks();
  assert.equal(r.webhooks[0]?.aktiv, false);
  assert.equal(r.ereignisse[0]?.key, 'webhook.test');
});

test('Partner: updatePartnerWebhook verlangt eine Aenderung, deletePartnerWebhook eine Kennung', async () => {
  const { api, gesehen } = stelle(erfolg({ webhook: { webhookId: 'wh_1', aktiv: false } }), erfolg({ webhookId: 'wh_1', geloescht: true }));
  const w = await api.updatePartnerWebhook('wh_1', { aktiv: false });
  assert.deepEqual(rumpfVon(gesehen[0]!).params, { webhookId: 'wh_1', patch: { aktiv: false } });
  assert.equal(w.aktiv, false);
  assert.equal(await api.deletePartnerWebhook('wh_1'), 'wh_1');
  await assert.rejects(() => api.updatePartnerWebhook('wh_1', {}), KasseneckValidationError);
  await assert.rejects(() => api.deletePartnerWebhook(''), KasseneckValidationError);
});

test('Partner: sendPartnerWebhookTest und listPartnerWebhookDeliveries', async () => {
  const { api, gesehen } = stelle(
    erfolg({ eventId: 'evt_1', zustellungen: [{ deliveryId: 'dlv_1' }] }),
    erfolg({
      zustellungen: [
        {
          deliveryId: 'dlv_1',
          webhookId: 'wh_1',
          event: 'webhook.test',
          eventId: 'evt_1',
          status: 'fehlgeschlagen',
          versuche: 6,
          statusCode: 500,
          antwort: 'boom',
        },
      ],
    }),
  );
  const t = await api.sendPartnerWebhookTest('wh_1');
  assert.equal(t.eventId, 'evt_1');
  const z = await api.listPartnerWebhookDeliveries({ webhookId: 'wh_1', limit: 10 });
  assert.deepEqual(rumpfVon(gesehen[1]!).params, { webhookId: 'wh_1', limit: 10 });
  assert.equal(z[0]?.status, 'fehlgeschlagen');
  assert.equal(z[0]?.statusCode, 500);
  await assert.rejects(() => api.listPartnerWebhookDeliveries({ limit: 999 }), KasseneckValidationError);
});

// ---------------------------------------------------------------------------
// Fehlercodes
// ---------------------------------------------------------------------------

test('Partner: jeder Fehlercode kommt maschinenlesbar an und traegt einen Handlungssatz', async () => {
  for (const code of PARTNER_FEHLER_CODES) {
    const { api } = stelle(fehler('Etwas ging schief.', { code }));
    try {
      await api.getPartnerInfo();
      assert.fail(`${code}: haette werfen muessen`);
    } catch (e) {
      assert.ok(e instanceof KasseneckApiError, `${code}: falsche Fehlerart`);
      assert.equal(partnerFehlerCode(e), code);
      assert.equal(istPartnerFehler(e, code), true);
      const rat = partnerFehlerRat(code, 'vollmacht');
      assert.ok(rat && rat.length > 20, `${code}: kein brauchbarer Handlungssatz`);
    }
  }
});

test('Partner: die Beilagen eines Fehlers kommen mit — schritt, rc, retryAfterSec, errors', async () => {
  const { api } = stelle(
    fehler('Die Inbetriebnahme ist haengen geblieben.', {
      code: 'activation_failed',
      schritt: 'uebermitteln',
      rc: 'B13',
      kasse: { cashregisterId: 'kasse_1', status: 'fehlgeschlagen' },
    }),
  );
  try {
    await api.activateCashregister('cust_1', 'kasse_1');
    assert.fail('haette werfen muessen');
  } catch (e) {
    const f = e as KasseneckApiError;
    assert.equal(f.code, 'activation_failed');
    assert.equal(f.details['schritt'], 'uebermitteln');
    assert.equal(f.details['rc'], 'B13');
    // Auch die verschachtelte Beilage ueberlebt das Sieb — sie sagt dem
    // Aufrufer, wo genau die Kette steht.
    assert.equal((f.details['kasse'] as Record<string, unknown>)['status'], 'fehlgeschlagen');
    assert.equal(f.serverMessage, 'Die Inbetriebnahme ist haengen geblieben.');
  }
});

test('Partner: validation liefert Feld und Grund, rate_limited die Wartezeit', async () => {
  const v = stelle(
    fehler('Bitte Eingaben pruefen.', {
      code: 'validation',
      errors: [{ field: 'tax_details.taxnr', message: 'Pruefziffer stimmt nicht.' }],
    }),
  );
  try {
    await v.api.createPartnerCustomer({ appId: 'app_1', betrieb: BETRIEB as never });
    assert.fail('haette werfen muessen');
  } catch (e) {
    assert.deepEqual(partnerFeldFehler(e), [{ field: 'tax_details.taxnr', message: 'Pruefziffer stimmt nicht.' }]);
  }

  const r = stelle(fehler('Zu viele Aufrufe.', { code: 'rate_limited', retryAfterSec: 42 }));
  try {
    await r.api.getPartnerInfo();
    assert.fail('haette werfen muessen');
  } catch (e) {
    assert.equal(partnerWartezeitSek(e), 42);
  }
});

test('Partner: ein Fehler ohne Code bleibt ohne Code — kein geratener Wert', async () => {
  const { api } = stelle(fehler('Betrieb nicht gefunden.', {}));
  try {
    await api.getPartnerCustomer('cust_fremd');
    assert.fail('haette werfen muessen');
  } catch (e) {
    assert.equal((e as KasseneckApiError).code, undefined);
    assert.equal(partnerFehlerCode(e), undefined);
    assert.deepEqual(partnerFeldFehler(e), []);
    assert.equal(partnerWartezeitSek(e), undefined);
  }
});

test('Partner: kein gesendetes Geheimnis kommt ueber die Fehler-Beilage zurueck', async () => {
  // Ein feindlicher oder verwirrter Proxy koennte den Bearer zurueckspiegeln.
  // Das Sieb wirft jeden Wert weg, der mit einem gesendeten Geheimnis
  // ueberlappt — dieselbe Zusage wie bei causeDigest.
  const { api } = stelle(fehler('Fehler.', { code: 'not_found', echo: PARTNER_KEY, teil: PARTNER_KEY.slice(0, 20) }));
  try {
    await api.getPartnerInfo();
    assert.fail('haette werfen muessen');
  } catch (e) {
    const f = e as KasseneckApiError;
    assert.equal(f.details['echo'], undefined);
    assert.equal(f.details['teil'], undefined);
    const ausgabe = `${f.message} ${JSON.stringify(f.details)} ${inspect(f, { depth: null })}`;
    assert.ok(!ausgabe.includes(PARTNER_KEY), ausgabe);
  }
});

// ---------------------------------------------------------------------------
// Vertragsweg und Ablauf
// ---------------------------------------------------------------------------

test('Partner: vertrag_offen nennt den Weg, der fuer dieses Konto gilt', async () => {
  for (const modus of AVV_MODI) {
    const rat = vertragOffenRat(modus);
    assert.ok(rat.includes(modus), `der Rat fuer "${modus}" nennt den Weg nicht: ${rat}`);
    assert.ok(rat.includes('Auftragsverarbeitungsvertrag'), rat);
  }
  // Die Wege unterscheiden sich wirklich — sonst waere die Fallunterscheidung
  // Zierde.
  const saetze = new Set(AVV_MODI.map((m) => vertragOffenRat(m)));
  assert.equal(saetze.size, AVV_MODI.length);

  const { api } = stelle(fehler('Der Betrieb hat den Vertrag noch nicht bestaetigt.', { code: 'vertrag_offen' }));
  try {
    await api.activateCashregister('cust_1', 'kasse_1');
    assert.fail('haette werfen muessen');
  } catch (e) {
    assert.equal(istPartnerFehler(e, 'vertrag_offen'), true);
    // Die Fassade wurde mit avvModus:'vollmacht' gebaut.
    assert.ok(api.vertragOffenRat().includes('vollmacht'));
    assert.equal(api.fehlerRat('vertrag_offen'), api.vertragOffenRat());
    assert.equal(api.avvModus, 'vollmacht');
  }
});

test('Partner: der Ablauf steht als Daten da und ist in sich schluessig', () => {
  const keys = PARTNER_ABLAUF.map((s) => s.key);
  assert.deepEqual(keys, ['betrieb', 'fon', 'avv', 'signatur', 'kasse', 'zugangsdaten', 'belege']);
  // Jeder Aufruf der Kette ist einer, den dieses Paket wirklich kennt — ein
  // Schritt, der auf einen erfundenen Endpunkt zeigt, waere schlimmer als
  // keiner.
  for (const schritt of PARTNER_ABLAUF) {
    if (schritt.aufruf === null) continue;
    assert.ok((AUFRUFE as readonly string[]).includes(schritt.aufruf), `unbekannter Aufruf: ${schritt.aufruf}`);
  }
  assert.equal(naechsterSchritt('angelegt')?.key, 'fon');
  assert.equal(naechsterSchritt('signatur_bereit')?.key, 'kasse');
  assert.equal(naechsterSchritt('live')?.key, 'zugangsdaten');
  assert.equal(naechsterSchritt('gesperrt'), null);
  assert.equal(naechsterSchritt('etwas_neues'), null);
});

test('Partner: alle Aufrufe der Partner-API stehen im Vertrag', () => {
  // Der Vertrag mit dem Flutter-Zwilling und den Hosting-Weiterleitungen liest
  // genau diese Liste. Ein Aufruf, der hier fehlt, hat in Produktion keine
  // Adresse — und faellt als "HTML statt JSON" auf, nicht als 404.
  for (const name of [
    'getPartnerInfo',
    'createPartnerCustomer',
    'listPartnerCustomers',
    'getPartnerCustomer',
    'sendPartnerCustomerFonLink',
    'requestCustomerSignature',
    'getCustomerSignatureStatus',
    'createCustomerCashregister',
    'activateCashregister',
    'listCustomerCashregisters',
    'getCustomerCredentials',
    'reportCustomerVertrag',
    'createPartnerWebhook',
    'listPartnerWebhooks',
    'updatePartnerWebhook',
    'deletePartnerWebhook',
    'sendPartnerWebhookTest',
    'listPartnerWebhookDeliveries',
  ]) {
    assert.ok((AUFRUFE as readonly string[]).includes(name), `${name} fehlt in AUFRUFE`);
  }
});
