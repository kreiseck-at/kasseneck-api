// Erzeugt test/fixtures/partner-v3-antworten.json: echte Sichten des Backends
// (partner-core.js, signatur-core.js), durch den /v3-Rand gereicht
// (functions/gemeinsam/api-vokabular-v3.js). So beschreiben die Fixtures, was
// der Server unter /v3 wirklich schickt, und nicht, was jemand dafuer haelt.
//
// Aufruf (braucht einen Backend-Checkout mit installierten node_modules):
//   KASSENECK_BACKEND=../kasseneck node scripts/partner-v3-antworten.cjs > test/fixtures/partner-v3-antworten.json
const B = process.env.KASSENECK_BACKEND;
if (!B) {
  process.stderr.write('KASSENECK_BACKEND fehlt: Pfad zum Backend-Checkout (Repo kasseneck).\n');
  process.exit(1);
}
const vok3 = require(`${B}/functions/gemeinsam/api-vokabular-v3.js`);
const pc = require(`${B}/functions-partner/partner-core.js`);
const sc = require(`${B}/functions/signatur-core.js`);
const ok = (data) => ({ status: 'success', message: '', data });
const aus = (name, data) => vok3.antwortNachAussen(name, ok(data));

const T = 1788052010642;
const konto = {
  company_name: 'Baeckerei Jobst e.U.', rechtsform: 'einzel', email: 'office@jobst.at', env: 'live', liveEnabled: true,
  bundesland: 'wien', address: { street: 'Hauptstrasse', number: '12a', zip: '1010', city: 'Wien' },
  tax_details: { taxnr: '12-345/6789', uid: 'ATU12345675', is_small_business: false },
  contacts: [{ name: 'Anna Jobst', email: 'anna@jobst.at', roles: ['geschaeftsfuehrung', 'kasse'] }],
  onboarding: { status: 'signatur_bereit', statusAt: T },
  partner: { appId: 'a_1', angelegtAt: T - 1000, angelegtVia: 'api' },
  avv: { version: '1.0', bestaetigtAt: T },
};
const avvKontext = { modus: 'vollmacht', pflichtVersion: '1.0', nutzungVersion: '1.0' };
const idx = { firma: konto.company_name, status: 'signatur_bereit', appId: 'a_1', env: 'live', createdAt: T - 1000, avv: konto.avv };

const antrag = {
  status: 'bereit', art: 'signaturkarte', vdaId: 'AT1', signatureId: 'sig_1', angefordertVon: { via: 'api' }, createdAt: T, updatedAt: T + 5,
  historie: [
    { von: null, nach: 'beantragt', at: T, grund: 'api' },
    { von: 'beantragt', nach: 'zugeteilt', at: T + 1, grund: 'karte_eingetragen' },
    { von: 'zugeteilt', nach: 'registriert', at: T + 2, grund: 'fon' },
    { von: 'registriert', nach: 'bereit', at: T + 3, grund: null },
  ],
};
const webhookDoc = { url: 'https://api.example.at/kasseneck', events: ['cashregister.live'], aktiv: true, beschreibung: null, createdAt: T, letzteZustellung: { at: T + 9, status: 'verworfen', statusCode: null }, fehlerInFolge: 0 };
const webhookV3 = { ...webhookDoc, apiVersion: 'v3', letzteZustellung: { at: T + 9, status: 'zugestellt', statusCode: 200 } };

const raus = {
  _quelle: 'scripts/partner-v3-antworten.cjs: echte Sichten des Backends (partner-core.js, signatur-core.js) durch den /v3-Rand (api-vokabular-v3.js), Stand keck#470. Nicht von Hand pflegen.',
  createPartnerCustomer: aus('createPartnerCustomer', {
    customerId: 'cust_1', status: 'created', env: 'live', companyName: konto.company_name, appId: 'a_1',
    access: { invited: false, sentTo: null }, nextSteps: ['FinanzOnline-Zugang einrichten lassen.'],
    entgelt: { cents: 1500, rhythmus: 'monat', test: false },
  }),
  getPartnerCustomer: aus('getPartnerCustomer', { customer: pc.betriebView('cust_1', konto, avvKontext) }),
  listPartnerCustomers: aus('listPartnerCustomers', { customers: [pc.kundenZeile('cust_1', idx, avvKontext, konto)], cursor: null, total: 1 }),
  requestCustomerSignature: aus('requestCustomerSignature', {
    request: sc.antragView('req_1', antrag), replayed: true, entgelt: { cents: 4900, rhythmus: 'einmal', test: false },
  }),
  getCustomerSignatureStatus: aus('getCustomerSignatureStatus', {
    customerId: 'cust_1',
    signature: { ready: true, signatureId: 'sig_1', vdaId: 'AT1' },
    signatures: [sc.signaturView({ signaturId: 'req_1', status: 'bereit', art: 'signaturkarte', vdaId: 'AT1', requestId: 'req_1', signatureId: 'sig_1', createdAt: T, updatedAt: T + 5 })],
    requests: [sc.antragView('req_1', antrag)],
    fon: { present: true, verifiedAt: T },
  }),
  createPartnerWebhook: aus('createPartnerWebhook', { webhook: pc.webhookView('wh_1', { ...webhookDoc, apiVersion: 'v3', letzteZustellung: null }, true), secret: 'whsec_neu' }),
  listPartnerWebhooks: aus('listPartnerWebhooks', { webhooks: [pc.webhookView('wh_alt', webhookDoc, true), pc.webhookView('wh_1', webhookV3, true)], events: pc.WEBHOOK_EVENTS_OFFEN }),
  updatePartnerWebhook: aus('updatePartnerWebhook', { webhook: pc.webhookView('wh_alt', { ...webhookDoc, apiVersion: 'v3' }, true) }),
  deletePartnerWebhook: aus('deletePartnerWebhook', { webhookId: 'wh_1', geloescht: true }),
  sendPartnerWebhookTest: aus('sendPartnerWebhookTest', { eventId: 'evt_1', event: 'signature.ready', deliveries: [{ deliveryId: 'dlv_1', webhookId: 'wh_1', status: 'pending', statusCode: null }] }),
  listPartnerWebhookDeliveries: aus('listPartnerWebhookDeliveries', {
    deliveries: [
      pc.deliveryView('dlv_2', { webhookId: 'wh_1', type: 'customer.created', eventId: 'evt_2', status: 'verworfen', versuche: 1, letzterVersuchAt: T + 20, naechsterVersuchAt: null, statusCode: null, antwort: null, createdAt: T + 10 }),
      pc.deliveryView('dlv_1', { webhookId: 'wh_1', type: 'signature.ready', eventId: 'evt_1', status: 'zugestellt', versuche: 2, letzterVersuchAt: T + 8, naechsterVersuchAt: null, statusCode: 200, antwort: 'ok', createdAt: T }),
    ],
  }),
  ereignisse: {
    'customer.terms_accepted': vok3.ereignisNachAussen('customer.terms_accepted', { customerId: 'cust_1', companyName: konto.company_name, kind: 'nutzung', version: '1.0', confirmedAt: T, source: 'einrichten' }),
    'customer.avv_accepted': vok3.ereignisNachAussen('customer.avv_accepted', { customerId: 'cust_1', companyName: konto.company_name, kind: 'avv', version: '1.0', confirmedAt: T, source: 'partner_vollmacht' }),
  },
};
process.stdout.write(JSON.stringify(raus, null, 2) + '\n');
