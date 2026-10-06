import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import antworten from './fixtures/partner-v3-antworten.json' with { type: 'json' };
import * as partner from '../src/partner/index.js';
import type * as P from '../src/partner/index.js';
import { ALL_CALLS } from '../src/client/aufrufe.js';
import { INVENTORY_WEBHOOK_EVENTS } from '../src/inventory/index.js';
import { KasseneckApiError, KasseneckValidationError } from '../src/client/errors.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';

/*
 * Der Partner-Teil in 1.0: englische Namen, die Aliase aus 0.28 sind weg,
 * `reportCustomerContract` ist da. Gegen den Vertrags-Export des Backends
 * (`fixtures/v3/v3-vokabular.json`) geprueft, soweit er den Partner-Teil
 * beschreibt (Kataloge, errorCodes.partner, events, schemas, names); die
 * Antwortfaelle kommen weiter aus `test/fixtures/partner-v3-antworten.json`
 * (`scripts/partner-v3-antworten.cjs`), weil der Export noch keine fuehrt.
 */

const vokabular = JSON.parse(
  readFileSync(new URL('../../fixtures/v3/v3-vokabular.json', import.meta.url), 'utf8'),
) as {
  names: Record<string, string>;
  catalogs: Record<string, Record<string, string>>;
  errorCodes: { partner: string[]; auth: string[]; translation: Record<string, string>; all: string[] };
  events: Record<string, unknown>;
  schemas: Record<string, { params?: Record<string, string> }>;
  endpoints: { public: string[] };
};

const A = antworten as unknown as Record<string, unknown>;
const PARTNER_KEY = 'pk_live_GEHEIMERPARTNERSCHLUESSEL42';
const werte = (katalog: string) => Object.values(vokabular.catalogs[katalog]!);

function antwort(rumpf: unknown): HttpResponseLike {
  const text = JSON.stringify(rumpf);
  return {
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : name.toLowerCase() === 'kasseneck-api-version' ? 'v3' : null) },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  };
}

function stelle(rumpf?: unknown) {
  const gesehen: { url: string; init: HttpRequestInit }[] = [];
  const fetchLike: FetchLike = async (url, init) => {
    gesehen.push({ url, init });
    const name = url.slice(url.lastIndexOf('/') + 1);
    return antwort(rumpf ?? A[name] ?? { status: 'success', message: '', data: {} });
  };
  return { api: partner.createPartnerApi({ partnerKey: PARTNER_KEY, fetch: fetchLike }), gesehen };
}

const params = (a: { init: HttpRequestInit }) => (JSON.parse(a.init.body) as { params: Record<string, unknown> }).params;

// ---------------------------------------------------------------------------
// Namen
// ---------------------------------------------------------------------------

/**
 * Alt (0.x) -> neu (1.0), Werte-Exporte von `@kreiseck/kasseneck-api/partner`.
 * Dieselbe Tabelle steht im CHANGELOG. Rot-Probe: einen alten Namen wieder
 * exportieren, dann faellt der Test mit genau diesem Namen.
 */
const UMBENANNT: Record<string, string> = {
  PARTNER_ABLAUF: 'PARTNER_FLOW',
  naechsterSchritt: 'nextFlowStep',
  PARTNER_FEHLER_CODES: 'PARTNER_ERROR_CODES',
  PARTNER_PORTAL_FEHLER_CODES: 'PARTNER_PORTAL_ERROR_CODES',
  istPartnerFehlerCode: 'isPartnerErrorCode',
  istPartnerPortalFehlerCode: 'isPartnerPortalErrorCode',
  istPartnerFehler: 'isPartnerError',
  partnerFehlerCode: 'partnerErrorCode',
  partnerFehlerRat: 'partnerErrorAdvice',
  partnerFeldFehler: 'partnerFieldErrors',
  partnerWartezeitSek: 'partnerRetryAfterSec',
  BETRIEB_FELDER: 'BUSINESS_FIELDS',
  unbekannteBetriebsfelder: 'unknownBusinessFields',
  SECRET_MASKE: 'SECRET_MASK',
  istPartnerWebhookEvent: 'isPartnerWebhookEvent',
  WEBHOOK_UMSCHLAG_FELDER: 'WEBHOOK_ENVELOPE_FIELDS',
};

test('1.0: die Partner-Exporte heissen englisch, die alten Namen sind weg', () => {
  const da = partner as unknown as Record<string, unknown>;
  for (const [alt, neu] of Object.entries(UMBENANNT)) {
    assert.equal(alt in da, false, `${alt} wird noch exportiert`);
    assert.ok(neu in da, `${neu} fehlt`);
  }
  // Kein Export mit einem deutschen Wortteil: die Liste der Verdaechtigen
  // ist bewusst grob, ein Treffer ist eine Frage, keine Regel.
  const deutsch = /(Fehler|Betrieb|Kunde|Kasse(?!neck)|Signatur(?!e)|Ablauf|Schritt|Liste|Zustellung|Umschlag|Maske|Stand|Rat$|^ist[A-Z])/;
  assert.deepEqual(Object.keys(da).filter((n) => deutsch.test(n)), []);
  // Die Fassade: errorAdvice statt fehlerRat.
  const { api } = stelle();
  assert.equal('fehlerRat' in api, false);
  assert.equal(typeof api.errorAdvice, 'function');
  assert.equal(typeof api.reportCustomerContract, 'function');
});

/*
 * Die Typ-Exporte. Jede Zeile mit @ts-expect-error ist ein Name, den es nicht
 * mehr gibt: exportiert ihn jemand wieder, ist die Erwartung unbenutzt und
 * `tsc` bricht ab (Rot-Probe).
 */
// @ts-expect-error seit 1.0 entfernt, heisst LegalForm
type _Weg1 = P.Rechtsform;
// @ts-expect-error seit 1.0 entfernt, heisst AustrianState
type _Weg2 = P.Bundesland;
// @ts-expect-error seit 1.0 entfernt, heisst ContactRole
type _Weg3 = P.KontaktRolle;
// @ts-expect-error heisst Business
type _Weg4 = P.Betrieb;
// @ts-expect-error heisst PartnerCustomer
type _Weg5 = P.Kunde;
// @ts-expect-error heisst CustomerCashregister
type _Weg6 = P.Kasse;
// @ts-expect-error heisst CustomerSignatureStatus
type _Weg7 = P.SignaturStand;
// @ts-expect-error heisst SignatureRequest
type _Weg8 = P.SignaturAntrag;
// @ts-expect-error heisst WebhookDelivery
type _Weg9 = P.WebhookZustellung;
// @ts-expect-error heisst PartnerErrorCode
type _Weg10 = P.PartnerFehlerCode;
// @ts-expect-error heisst FlowStep
type _Weg11 = P.AblaufSchritt;

// Die neuen Namen muessen sich benutzen lassen.
type _Da = [
  P.Business, P.BusinessAddress, P.BusinessTaxDetails, P.BusinessContact, P.BusinessTaxAdvisor, P.BusinessField,
  P.PartnerCustomer, P.PartnerCustomerSummary, P.PartnerCustomerList, P.PartnerCustomerStatus, P.PartnerCustomerFonStatus,
  P.AvvStatus, P.ContractStatus,
  P.SignatureRequest, P.SignatureRequestStatus, P.SignatureHistoryEntry, P.CustomerSignatureStatus,
  P.CustomerCashregister, P.CustomerCashregisterList, P.CustomerCashregisterStatus, P.CashregisterActivationStep,
  P.WebhookDelivery, P.WebhookList, P.WebhookTestDelivery,
  P.PartnerErrorCode, P.PartnerPortalErrorCode, P.PartnerRequestErrorCode, P.PartnerFieldError, P.FlowStep,
  P.ReportCustomerContractOptions, P.ReportCustomerContractResult,
  P.SignatureFailedEventData, P.CashregisterFailedEventData, P.ContractAcceptedEventData,
];

// ---------------------------------------------------------------------------
// Fehlercodes gegen den Vertrag
// ---------------------------------------------------------------------------

test('1.0: PARTNER_ERROR_CODES ist errorCodes.partner des Vertrags, Code fuer Code und in der Reihenfolge', () => {
  assert.deepEqual([...partner.PARTNER_ERROR_CODES], vokabular.errorCodes.partner);
});

test('1.0: die Anmelde- und Anfragecodes der Partner-Doku stehen im Vertrag und tragen einen Satz', () => {
  // Anmeldung und Anfrage, dahinter der Rand (errorCodes.edge ohne die, die
  // der Katalog schon fuehrt) und route_missing, den das Paket vergibt.
  const anmeldung = ['method_not_allowed', 'unauthorized', 'partner_locked', 'scope_missing'];
  const rand = ((vokabular.errorCodes as unknown as { edge: string[] }).edge).filter((c) => !vokabular.errorCodes.partner.includes(c));
  assert.deepEqual([...partner.PARTNER_REQUEST_ERROR_CODES], [...anmeldung, ...rand, 'route_missing']);
  for (const code of partner.PARTNER_REQUEST_ERROR_CODES) {
    if (anmeldung.includes(code)) assert.ok(vokabular.errorCodes.auth.includes(code), `${code} fehlt in errorCodes.auth`);
    assert.ok(partner.partnerErrorAdvice(code).length > 20, code);
    assert.equal(vokabular.errorCodes.partner.includes(code), false, `${code} steht schon im Katalog`);
    // Die Erkenner nehmen Katalog und Anfragecodes gleich.
    assert.equal(partner.isPartnerErrorCode(code), true, code);
  }
  const e = new KasseneckApiError('getPartnerInfo', 'x', {}, 'dialect_mismatch');
  assert.ok(partner.isPartnerError(e));
  assert.ok(partner.isPartnerError(e, 'dialect_mismatch'));
  assert.equal(partner.isPartnerError(new KasseneckApiError('getPartnerInfo', 'x', {}, 'brand_new_code_2027')), false);
});

/**
 * Rot-Probe: in fehler.ts den Rueckfall streichen (`return RAT[code]`), dann
 * kommt fuer einen neuen Code `undefined` zurueck und dieser Test faellt.
 */
test('1.0: ein unbekannter Code bekommt einen Rueckfall, nie einen Wurf', () => {
  const rueckfall = partner.partnerErrorAdvice('brand_new_code_2027');
  assert.equal(typeof rueckfall, 'string');
  assert.ok(rueckfall.length > 20);
  assert.match(rueckfall, /message/);
  // Derselbe Rueckfall fuer jeden unbekannten Code, und kein Satz eines
  // bekannten Codes.
  assert.equal(partner.partnerErrorAdvice('noch_einer'), rueckfall);
  for (const code of partner.PARTNER_ERROR_CODES) assert.notEqual(partner.partnerErrorAdvice(code), rueckfall, code);
  // Auch Unsinn wirft nicht.
  for (const unsinn of [undefined, null, 42, {}, '', 'toString', '__proto__', 'constructor']) {
    assert.doesNotThrow(() => partner.partnerErrorAdvice(unsinn as unknown as string));
    assert.equal(partner.partnerErrorAdvice(unsinn as unknown as string), rueckfall, String(unsinn));
    assert.equal(partner.isPartnerErrorCode(unsinn), false);
    assert.equal(partner.isPartnerPortalErrorCode(unsinn), false);
  }
  assert.equal(partner.isPartnerErrorCode('brand_new_code_2027'), false);
  // Die Fassade sagt dasselbe.
  assert.equal(stelle().api.errorAdvice('brand_new_code_2027'), rueckfall);
});

test('1.0: isPartnerError erkennt auch einen Code, den dieses Paket nicht kennt', async () => {
  const { api } = stelle({ status: 'error', message: 'Neu.', data: { code: 'brand_new_code_2027' } });
  const e = await api.getPartnerInfo().catch((f: unknown) => f);
  assert.ok(e instanceof KasseneckApiError);
  assert.equal(partner.partnerErrorCode(e), 'brand_new_code_2027');
  assert.equal(partner.isPartnerError(e, 'brand_new_code_2027'), true);
  assert.equal(partner.isPartnerError(e, 'validation'), false);
});

// ---------------------------------------------------------------------------
// Kataloge gegen den Vertrag
// ---------------------------------------------------------------------------

/** Liste des Pakets = Zielwerte des Katalogs (Menge, beide Richtungen). */
const GLEICH: [string, readonly string[], string][] = [
  ['LEGAL_FORMS', partner.LEGAL_FORMS, 'RECHTSFORM'],
  ['AUSTRIAN_STATES', partner.AUSTRIAN_STATES, 'BUNDESLAND'],
  ['CONTACT_ROLES', partner.CONTACT_ROLES, 'ROLLE'],
  ['AVV_MODES', partner.AVV_MODES, 'AVV_MODUS'],
  ['FEE_INTERVALS', partner.FEE_INTERVALS, 'RHYTHMUS'],
  ['CONTRACT_KINDS', partner.CONTRACT_KINDS, 'VERTRAG_ART'],
  ['WEBHOOK_DELIVERY_STATUSES', partner.WEBHOOK_DELIVERY_STATUSES, 'ZUSTELLUNG'],
];

test('1.0: die Wertlisten des Partner-Teils sind die Kataloge des Vertrags', () => {
  for (const [name, liste, katalog] of GLEICH) {
    assert.deepEqual([...liste].sort(), [...werte(katalog)].sort(), `${name} weicht von ${katalog} ab`);
  }
  // Offene Listen: der Katalog uebersetzt nur, was deutsch war; `app`,
  // `portal`, `api` … gehen unveraendert durch. Jeder Zielwert muss drinstehen.
  for (const w of werte('QUELLE')) assert.ok((partner.CONTRACT_SOURCES as readonly string[]).includes(w), `CONTRACT_SOURCES: ${w}`);
  for (const w of werte('GRUND_V3')) assert.ok((partner.SIGNATURE_HISTORY_REASONS as readonly string[]).includes(w), `SIGNATURE_HISTORY_REASONS: ${w}`);
  // Kein deutscher Quellwert in einer offenen Liste.
  for (const q of Object.keys(vokabular.catalogs['QUELLE']!)) assert.ok(!(partner.CONTRACT_SOURCES as readonly string[]).includes(q), q);
  for (const q of Object.keys(vokabular.catalogs['GRUND_V3']!)) assert.ok(!(partner.SIGNATURE_HISTORY_REASONS as readonly string[]).includes(q), q);
  // Die Codes am Signaturantrag sind Uebersetzungen aus errorCodes.translation.
  const uebersetzt = Object.values(vokabular.errorCodes.translation);
  for (const c of partner.SIGNATURE_ERROR_CODES) assert.ok(uebersetzt.includes(c), c);
});

test('1.0: PARTNER_WEBHOOK_EVENTS ist der Katalog des Backends, samt Vertragsereignissen', () => {
  const katalog = ((A['listPartnerWebhooks'] as { data: { events: { key: string }[] } }).data.events).map((e) => e.key);
  assert.deepEqual([...partner.PARTNER_WEBHOOK_EVENTS], katalog);
  // Die Konto-Ereignisse der Lager-API (stock.*, article.*) stehen im selben
  // Vertragsabschnitt, gehoeren aber zu `./inventory`, nicht zum Partner.
  for (const ereignis of Object.keys(vokabular.events)) {
    if ((INVENTORY_WEBHOOK_EVENTS as readonly string[]).includes(ereignis)) {
      assert.equal(partner.isPartnerWebhookEvent(ereignis), false, `${ereignis} ist ein Konto-Ereignis`);
      continue;
    }
    assert.ok(partner.isPartnerWebhookEvent(ereignis), `${ereignis} (events im Vertrag) fehlt`);
  }
});

test('1.0: die Nutzlasten der uebersetzten Ereignisse passen auf ihre Typen', () => {
  const e = A['ereignisse'] as Record<string, Record<string, unknown>>;
  const vertrag: P.ContractAcceptedEventData = e['customer.avv_accepted'] as unknown as P.ContractAcceptedEventData;
  assert.ok((partner.CONTRACT_KINDS as readonly string[]).includes(vertrag.kind));
  assert.equal(vertrag.source, 'partner_power_of_attorney');
  assert.equal((e['customer.terms_accepted'] as unknown as P.ContractAcceptedEventData).kind, 'terms');

  const sig = e['signature.failed'] as unknown as P.SignatureFailedEventData;
  assert.deepEqual(Object.keys(sig).sort(), ['code', 'companyName', 'customerId', 'message', 'rc', 'requestId']);
  // Live immer signature_failed (signatur-endpoints feuert nur so); die
  // Ursache steht am Antrag, nicht im Ereignis.
  assert.equal(sig.code, 'signature_failed');
  assert.ok(partner.isPartnerErrorCode(sig.code));

  const kasse = e['cashregister.failed'] as unknown as P.CashregisterFailedEventData;
  assert.deepEqual(Object.keys(kasse).sort(), ['cashregisterId', 'code', 'companyName', 'customerId', 'env', 'message', 'rc', 'step']);
  // Nur signature_not_ready, fon_missing oder activation_failed; fehlende
  // Vertraege feuern kein cashregister.failed.
  assert.ok(['signature_not_ready', 'fon_missing', 'activation_failed'].includes(kasse.code), kasse.code);
  assert.ok(partner.isPartnerErrorCode(kasse.code));
});

// ---------------------------------------------------------------------------
// reportCustomerContract
// ---------------------------------------------------------------------------

const MELDUNG: P.ReportCustomerContractOptions = {
  customerId: 'cust_1',
  kind: 'avv',
  version: '1.0',
  textHash: 'a'.repeat(64),
  name: 'Anna Kornblum',
  signerRole: 'Geschaeftsfuehrerin',
  acceptedAt: 1788052010642,
};

test('1.0: reportCustomerContract steht im Vertrag unter seinem aeusseren Namen', () => {
  assert.equal(vokabular.names['reportCustomerContract'], 'reportCustomerVertrag');
  assert.ok(vokabular.endpoints.public.includes('reportCustomerVertrag'));
  assert.ok((ALL_CALLS as readonly string[]).includes('reportCustomerContract'));
  assert.equal((ALL_CALLS as readonly string[]).includes('reportCustomerVertrag'), false);
});

/**
 * Rot-Probe: in endpunkte.ts `signerRole` als `funktion` senden, dann steht
 * der Parameter nicht mehr in der Liste, die der Rand kennt.
 */
test('1.0: reportCustomerContract sendet genau die Parameter, die der /v3-Rand uebersetzt', async () => {
  const { api, gesehen } = stelle();
  const r = await api.reportCustomerContract(MELDUNG);
  assert.equal(gesehen[0]!.url, 'https://api.kasseneck.at/v3/reportCustomerContract');
  const gesendet = params(gesehen[0]!);
  assert.deepEqual(gesendet, { ...MELDUNG });
  // Umbenannt werden genau die Namen aus schemas.reportCustomerVertrag.params;
  // was der Rand daraus machte (Fixture), fuehrt keinen unbekannten Rest.
  const umbenannt = vokabular.schemas['reportCustomerVertrag']!.params!;
  const innen = A['reportCustomerContractParams'] as Record<string, unknown>;
  assert.equal('__v3unbekannt' in innen, false);
  for (const [aussen, wert] of Object.entries(gesendet)) {
    assert.equal(innen[umbenannt[aussen] ?? aussen], wert, aussen);
  }
  assert.deepEqual(r, { contractId: 'kunde_u_1_avv_1-0', confirmedAt: 1788052010642, kind: 'avv', version: '1.0' });
});

test('1.0: reportCustomerContract ohne acceptedAt laesst das Feld weg', async () => {
  const { api, gesehen } = stelle();
  const { acceptedAt: _weg, ...ohne } = MELDUNG;
  await api.reportCustomerContract(ohne);
  const gesendet = params(gesehen[0]!);
  assert.equal('acceptedAt' in gesendet, false);
  assert.deepEqual(gesendet, ohne);
});

test('1.0: reportCustomerContract prueft vorab nur, was ohne Server feststeht', async () => {
  const { api, gesehen } = stelle();
  const faelle: [string, Partial<P.ReportCustomerContractOptions>][] = [
    ['customerId', { customerId: ' ' }],
    ['kind', { kind: '' as never }],
    ['version', { version: '' }],
    ['textHash', { textHash: '' }],
    ['name', { name: '' }],
    ['signerRole', { signerRole: '' }],
    ['acceptedAt', { acceptedAt: Number.NaN }],
  ];
  for (const [feld, abweichung] of faelle) {
    await assert.rejects(api.reportCustomerContract({ ...MELDUNG, ...abweichung }), (e: unknown) => {
      assert.ok(e instanceof KasseneckValidationError, feld);
      assert.match((e as Error).message, new RegExp(feld));
      return true;
    });
  }
  assert.equal(gesehen.length, 0, 'nichts ging raus');
  // `terms` geht raus: dass der Vollmachtsweg nur `avv` nimmt, sagt der
  // Server (kind_not_allowed), nicht dieser Client.
  await api.reportCustomerContract({ ...MELDUNG, kind: 'terms' });
  assert.equal(params(gesehen[0]!)['kind'], 'terms');
});

test('1.0: reportCustomerContract ohne contractId in der Antwort wirft', async () => {
  const { api } = stelle({ status: 'success', message: '', data: { confirmedAt: 1 } });
  await assert.rejects(api.reportCustomerContract(MELDUNG), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response');
});

test('1.0: die Fehler von reportCustomerContract kommen englisch, mit ihren Beilagen', async () => {
  const f = A['reportCustomerContractFehler'] as Record<string, unknown>;

  const schon = await stelle(f['already_accepted']).api.reportCustomerContract(MELDUNG).catch((e: unknown) => e);
  assert.equal(partner.partnerErrorCode(schon), 'already_accepted');
  assert.equal((schon as KasseneckApiError).details['contractId'], 'kunde_u_1_avv_1-0');

  const art = await stelle(f['kind_not_allowed']).api.reportCustomerContract({ ...MELDUNG, kind: 'terms' }).catch((e: unknown) => e);
  assert.ok(partner.isPartnerError(art, 'kind_not_allowed'));

  const text = await stelle(f['text_changed']).api.reportCustomerContract(MELDUNG).catch((e: unknown) => e);
  assert.ok(partner.isPartnerError(text, 'text_changed'));
  assert.equal((text as KasseneckApiError).details['textHash'], 'b'.repeat(64));

  const pruefung = await stelle(f['validation']).api.reportCustomerContract(MELDUNG).catch((e: unknown) => e);
  assert.deepEqual(partner.partnerFieldErrors(pruefung).map((x) => x.field), ['kind', 'signerRole', 'acceptedAt']);
});

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

test('1.0: PARTNER_FLOW fuehrt englische Schluessel und Felder', () => {
  assert.deepEqual(partner.PARTNER_FLOW.map((s) => s.key), ['business', 'fon', 'signature', 'cashregister', 'credentials', 'receipts']);
  for (const schritt of partner.PARTNER_FLOW) {
    assert.deepEqual(Object.keys(schritt).sort(), ['call', 'key', 'missingCode', 'text', 'waitsFor']);
    if (schritt.missingCode) assert.ok(partner.isPartnerErrorCode(schritt.missingCode), schritt.missingCode);
    if (schritt.waitsFor) assert.ok(partner.isPartnerWebhookEvent(schritt.waitsFor), schritt.waitsFor);
  }
  assert.equal(partner.nextFlowStep('live')?.key, 'credentials');
  assert.equal(partner.nextFlowStep('blocked'), null);
});
