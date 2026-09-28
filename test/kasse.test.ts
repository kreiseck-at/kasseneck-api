import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POS_BUSINESS_DEFAULTS,
  POS_SHORTCUT_DEFAULTS,
  CARD_PROVIDER,
  POS_DEVICE_DEFAULTS,
  mergePosSettings,
  verteileRabatt,
  fromArticleGroupPayload,
  fromPosArticlePayload,
  allowedQuantity,
  getKasseSettings,
  setMyKasseSettings,
  setMyRegisterDeviceSettings,
  listMyArticleGroups,
  listMyArticles,
  quantityRuleForUnit,
  quantityDefaults,
  listMyTipRecipients,
} from '../src/kasse/index.js';
import { fromReceiptSummaryPayload } from '../src/models/index.js';
import { listMyReceipts, createTransport, apiKeyAuth, type KasseneckTransport, type FetchLike, type HttpResponseLike } from '../src/client/index.js';
import { VatRate } from '../src/enums/index.js';
import type { ReceiptItem } from '../src/models/index.js';

// --- Attrappen ---------------------------------------------------------------
type Aufruf = { url: string; init: { body: string } };
function transportMit(daten: unknown): { rufen: KasseneckTransport; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const holen: FetchLike = async (url, init) => {
    aufrufe.push({ url: String(url), init: init as { body: string } });
    const rumpf = JSON.stringify({ status: 'success', message: '', data: daten });
    const antwort: HttpResponseLike = {
      status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : n.toLowerCase() === 'kasseneck-api-version' ? 'v3' : null) },
      text: async () => rumpf,
      arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
    };
    return antwort;
  };
  const rufen = createTransport({ auth: apiKeyAuth({ apiKey: 'kr_test_x', cashregisterToken: 'cb_test_x' }), fetch: holen });
  return { rufen, aufrufe };
}
function gesendet(aufrufe: Aufruf[]): { fn: string; params: Record<string, unknown> } {
  assert.equal(aufrufe.length, 1);
  const a = aufrufe[0]!;
  return { fn: a.url.slice(a.url.lastIndexOf('/') + 1), params: (JSON.parse(a.init.body) as { params: Record<string, unknown> }).params };
}

// --- Einstellungen: Standardwerte + Merge -----------------------------------
test('Standardwerte: klar, Korb rechts, Trinkgeld aus, Beleg fragt -- wie im Backend', () => {
  assert.equal(POS_BUSINESS_DEFAULTS.theme, 'clear');
  assert.equal(POS_BUSINESS_DEFAULTS.tip, false);
  // 'fragen': Fertig-Seite bietet QR und Bon an — Standard seit 0.6.21.
  assert.equal(POS_BUSINESS_DEFAULTS.receiptOutput, 'ask');
  assert.deepEqual(POS_BUSINESS_DEFAULTS.vatRates, { 20: true, 13: true, 10: true, 4.9: true, 0: true, 19: false });
  assert.equal(POS_DEVICE_DEFAULTS.layout, 'right');
  assert.equal(POS_DEVICE_DEFAULTS.printerPort, 9100);
  assert.equal(POS_DEVICE_DEFAULTS.touch, false); // Standard: Tastatur, kein Ziffernfeld
  // Schluesselmengen sind getrennt
  const b = Object.keys(POS_BUSINESS_DEFAULTS), g = Object.keys(POS_DEVICE_DEFAULTS);
  assert.deepEqual(b.filter((x) => g.includes(x)), []);
});

test('mergePosSettings: gespeichertes ueberlagert, Landkarten je Schluessel, Unbekanntes bleibt draussen', () => {
  const r = mergePosSettings(POS_BUSINESS_DEFAULTS, { theme: 'warm', vatRates: { 19: true }, foo: 1 } as never);
  assert.equal(r.theme, 'warm');
  assert.deepEqual(r.vatRates, { 20: true, 13: true, 10: true, 4.9: true, 0: true, 19: true });
  assert.equal((r as unknown as Record<string, unknown>)['foo'], undefined);
  assert.deepEqual(mergePosSettings(POS_DEVICE_DEFAULTS, null), POS_DEVICE_DEFAULTS);
});

// --- Rabattverteilung --------------------------------------------------------
const SEMMEL: ReceiptItem = { name: 'Semmel', quantity: 4, vat: VatRate.vat10, priceCents: 79 };  // 3,16 (10 %)
const KAFFEE: ReceiptItem = { name: 'Kaffee', quantity: 1, vat: VatRate.vat20, priceCents: 280 }; // 2,80 (20 %)

test('verteileRabatt: eine negative Rabattzeile je Steuersatz, anteilig zum Brutto, Summe = Rabatt', () => {
  const zeilen = verteileRabatt([SEMMEL, KAFFEE], 100);
  assert.equal(zeilen.length, 2);
  const summe = zeilen.reduce((s, z) => s + z.priceCents * z.quantity, 0);
  assert.equal(summe, -100);
  // 3,16 : 2,80 -> 53 : 47 Cent (Rest zur groesseren Gruppe)
  const zehn = zeilen.find((z) => z.vat === VatRate.vat10)!, zwanzig = zeilen.find((z) => z.vat === VatRate.vat20)!;
  assert.equal(zehn.priceCents, -53);
  assert.equal(zwanzig.priceCents, -47);
  assert.equal(zehn.name, 'Rabatt');
  assert.equal(zehn.quantity, 1);
});

test('verteileRabatt: nur ein Satz -> eine Zeile; kein Rabatt -> keine Zeile; nie ueber den Umsatz eines Satzes', () => {
  assert.equal(verteileRabatt([SEMMEL], 50).length, 1);
  assert.deepEqual(verteileRabatt([SEMMEL, KAFFEE], 0), []);
  const alles = verteileRabatt([SEMMEL, KAFFEE], 596);
  assert.equal(alles.reduce((s, z) => s + z.priceCents, 0), -596);
  assert.throws(() => verteileRabatt([SEMMEL], 400), /Rabatt/);
  assert.throws(() => verteileRabatt([SEMMEL], -1), /Rabatt/);
});

test('verteileRabatt: Cent-Rest landet bei der groessten Gruppe, jede Zeile <= Umsatz ihres Satzes (Rot-Probe: 1 Cent auf drei Saetze)', () => {
  const drei: ReceiptItem[] = [SEMMEL, KAFFEE, { name: 'Zeitung', quantity: 1, vat: VatRate.vat0, priceCents: 250 }];
  const z = verteileRabatt(drei, 1);
  assert.equal(z.length, 1);
  assert.equal(z[0]!.vat, VatRate.vat10); // groesste Gruppe 3,16
  for (const zeile of verteileRabatt(drei, 845)) {
    const umsatz = drei.filter((p) => p.vat === zeile.vat).reduce((s, p) => s + p.priceCents * p.quantity, 0);
    assert.ok(-zeile.priceCents <= umsatz);
  }
});

// --- Artikelgruppen + Artikel fuer die Kacheln --------------------------------
test('fromArticleGroupPayload / fromPosArticlePayload lesen die Backend-Form', () => {
  const g = fromArticleGroupPayload({ id: 'g1', name: 'Gebäck', color: '#D97706', symbol: '🥐', sort: 1, vatRate: 10 });
  assert.deepEqual(g, { id: 'g1', name: 'Gebäck', color: '#D97706', symbol: '🥐', sort: 1, vatRate: 10 });
  const a = fromPosArticlePayload({ id: 'a1', name: 'Semmel', unitPriceCents: 79, vatRate: 10, unit: 'Stk', groupId: 'g1', tile: { visible: true, sort: 2 }, active: true });
  assert.deepEqual(a, { id: 'a1', name: 'Semmel', unitPriceCents: 79, vatRate: 10, unit: 'Stk', groupId: 'g1', revenueGroupId: null, visible: true, sort: 2, active: true, quantityRule: null, askQuantity: null, maxQuantity: null });
  // Hoechstmenge je Beleg: nur positive ganze Zahlen zaehlen, sonst keine Grenze
  assert.equal(fromPosArticlePayload({ id: 'a2', name: 'Torte', maxQuantity: 3 }).maxQuantity, 3);
  assert.equal(fromPosArticlePayload({ id: 'a3', name: 'X', maxQuantity: 0 }).maxQuantity, null);
  assert.equal(fromPosArticlePayload({ id: 'a4', name: 'X', maxQuantity: 2.5 }).maxQuantity, 2.5); // Kommazahl (2,5 kg)
  assert.equal(fromPosArticlePayload({ id: 'a5', name: 'X', maxQuantity: -1 }).maxQuantity, null);
  assert.equal(allowedQuantity({ maxQuantity: 2.5 }, 3), 2.5);
  assert.equal(allowedQuantity({ maxQuantity: 3 }, 2), 2);
  assert.equal(allowedQuantity({ maxQuantity: 3 }, 5), 3);
  assert.equal(allowedQuantity({ maxQuantity: null }, 500), 500);
  assert.equal(allowedQuantity({ maxQuantity: 3 }, 0), 0);
  // Altbestand ohne Kachel-Felder
  const alt = fromPosArticlePayload({ id: 'a2', name: 'Alt', unitPriceCents: 100, vatRate: 20 });
  assert.equal(alt.groupId, null);
  assert.equal(alt.visible, true);
  assert.equal(alt.unit, '');
});

test('listMyArticleGroups und listMyArticles rufen die Endpunkte und lesen die Listen', async () => {
  const g = transportMit({ groups: [{ id: 'g1', name: 'Gebäck', color: '#D97706', symbol: null, sort: 0, vatRate: null }] });
  const gruppen = await listMyArticleGroups(g.rufen);
  assert.equal(gesendet(g.aufrufe).fn, 'listMyArticleGroups');
  assert.equal(gruppen[0]!.symbol, null);
  const a = transportMit({ articles: [{ id: 'a1', name: 'Semmel', unitPriceCents: 79, vatRate: 10, groupId: null, tile: { visible: false, sort: 0 } }] });
  const artikel = await listMyArticles(a.rufen);
  assert.equal(gesendet(a.aufrufe).fn, 'listMyArticles');
  assert.equal(artikel[0]!.visible, false);
  const kaputt = transportMit({ nix: true });
  await assert.rejects(() => listMyArticleGroups(kaputt.rufen), /groups/);
});

// --- Einstellungen: Client -----------------------------------------------------
test('getKasseSettings mischt die Antwort mit den Standardwerten', async () => {
  const { rufen, aufrufe } = transportMit({ business: { theme: 'night' }, device: { layout: 'left' } });
  const s = await getKasseSettings(rufen, { deviceId: 'dev1' });
  assert.deepEqual(gesendet(aufrufe).params, { deviceId: 'dev1' });
  assert.equal(s.business.theme, 'night');
  assert.equal(s.business.customAmountAllowed, true);
  assert.equal(s.device.layout, 'left');
  assert.equal(s.device.printerPort, 9100);
});

test('setMyKasseSettings / setMyRegisterDeviceSettings senden nur den Block und lesen den Stand zurueck', async () => {
  const b = transportMit({ business: { theme: 'warm' } });
  const rb = await setMyKasseSettings(b.rufen, { theme: 'warm' });
  assert.deepEqual(gesendet(b.aufrufe).params, { business: { theme: 'warm' } });
  assert.equal(rb.theme, 'warm');
  const g = transportMit({ device: { layout: 'fullscreen' } });
  const rg = await setMyRegisterDeviceSettings(g.rufen, 'dev1', { layout: 'fullscreen' });
  assert.deepEqual(gesendet(g.aufrufe).params, { deviceId: 'dev1', device: { layout: 'fullscreen' } });
  assert.equal(rg.layout, 'fullscreen');
  await assert.rejects(() => setMyKasseSettings(b.rufen, {} as never), /Einstellungen/);
});

// --- Belegliste: Zeitfenster + neue Felder ---------------------------------------
test('listMyReceipts schickt from/to und liest Positionen, Bediener und Storno-Stand', async () => {
  const { rufen, aufrufe } = transportMit({
    receipts: [{ receiptId: 'K-ID-9', receiptType: 'standard', timeStamp: '2026-08-16T09:00:00', total: 4.56, paymentMethod: 'cash',
      items: [{ name: 'Semmel', quantity: 2 }], operator: { uid: 'anna', name: 'Anna' }, cancellationOf: null, cancellationReason: null, cancellationStatus: 'partial' }],
    stats: { today: { revenue_cents: 0, count: 0 }, trend_percent: null, days: [] },
  });
  const l = await listMyReceipts(rufen, { cashregisterId: 'K', from: '2026-08-16', to: '2026-08-16' });
  const { params } = gesendet(aufrufe);
  assert.equal(params['from'], '2026-08-16');
  assert.equal(params['to'], '2026-08-16');
  const b = l.receipts[0]!;
  assert.deepEqual(b.items, [{ name: 'Semmel', quantity: 2 }]);
  assert.deepEqual(b.operator, { uid: 'anna', name: 'Anna' });
  assert.equal(b.cancellationStatus, 'partial');
  assert.equal(b.cancellationOf, undefined);
});

test('fromReceiptSummaryPayload liest den Anlass eines Nullbelegs, verwirft Unbekanntes', () => {
  const m = fromReceiptSummaryPayload({ receiptId: 'z', receiptType: 'zero', timeStamp: 't', total: 0, paymentMethod: 'cash', zeroKind: 'monthly' });
  assert.equal(m.zeroKind, 'monthly');
  const u = fromReceiptSummaryPayload({ receiptId: 'z', receiptType: 'zero', timeStamp: 't', total: 0, paymentMethod: 'cash', zeroKind: 'quatsch' });
  assert.equal(u.zeroKind, undefined);
});

test('fromReceiptSummaryPayload ohne die neuen Felder bleibt wie bisher', () => {
  const s = fromReceiptSummaryPayload({ receiptId: 'r', receiptType: 'standard', timeStamp: 't', total: 1, paymentMethod: 'cash' });
  assert.deepEqual(s.items, []);
  assert.equal(s.operator, undefined);
  assert.equal(s.cancellationStatus, undefined);
  // Ein unbekannter oder alter Wert kommt sichtbar an, nie still als 'none'.
  for (const roh of ['voll', 'refunded']) {
    const u = fromReceiptSummaryPayload({ receiptId: 'r', receiptType: 'standard', timeStamp: 't', total: 1, paymentMethod: 'cash', cancellationStatus: roh });
    assert.equal(u.cancellationStatus, 'unknown', roh);
  }
});

test('Mengenregel: Vorgabe je Einheit (Stk ganz ohne Fragen; kg/l/m dezimal mit Fragen; g/ml ganz mit Fragen), gespeicherte Angabe schlaegt', () => {
  assert.deepEqual(quantityRuleForUnit('Stk'), { rule: 'piece', ask: false, decimals: 0 });
  assert.deepEqual(quantityRuleForUnit('kg'), { rule: 'decimal', ask: true, decimals: 3 });
  assert.deepEqual(quantityRuleForUnit('l'), { rule: 'decimal', ask: true, decimals: 2 });
  assert.deepEqual(quantityRuleForUnit('g'), { rule: 'piece', ask: true, decimals: 0 });
  assert.deepEqual(quantityRuleForUnit(''), { rule: 'piece', ask: false, decimals: 0 });
  const wurst = fromPosArticlePayload({ id: 'w', name: 'Wurst', unitPriceCents: 1990, vatRate: 10, unit: 'kg' });
  assert.deepEqual(quantityDefaults(wurst), { rule: 'decimal', ask: true, decimals: 3 });
  const stueckwurst = fromPosArticlePayload({ id: 'w', name: 'Wurst', unitPriceCents: 1990, vatRate: 10, unit: 'kg', quantityRule: 'piece', askQuantity: false });
  assert.deepEqual(quantityDefaults(stueckwurst), { rule: 'piece', ask: false, decimals: 0 });
  // Rot-Probe: Unsinn im Payload faellt auf null zurueck
  assert.equal(fromPosArticlePayload({ id: 'x', name: 'x', quantityRule: 'halb' }).quantityRule, null);
});

test('Kassieren: Vorgabe im Korb-Panel -- die Kacheln bleiben stehen (seit 0.31.0)', () => {
  assert.equal(POS_BUSINESS_DEFAULTS.checkoutMode, 'panel');
  // Ein gespeichertes 'seite' bleibt beim Mischen erhalten.
  assert.equal(mergePosSettings(POS_BUSINESS_DEFAULTS, { checkoutMode: 'page' }).checkoutMode, 'page');
});

test('Kartenanbieter: Vorgabe keiner, Karte aus -- Karte gibt es erst mit Anbieter', () => {
  assert.equal(POS_BUSINESS_DEFAULTS.cardProvider, 'none');
  assert.equal(POS_BUSINESS_DEFAULTS.payCard, false);
  assert.deepEqual([...CARD_PROVIDER], ['none', 'external', 'gptom', 'hobex', 'mypos', 'stripe']);
});

test('Tastenkarte je Geraet: Vorgabe ohne F-Tasten, Merge je Aktion', () => {
  // Mod+F gehoert seit 0.6.24 dem Vollbild, Mod+B seit 0.6.25 den Belegen.
  assert.equal(POS_SHORTCUT_DEFAULTS.customAmount[0], 'Mod+D');
  assert.equal(POS_SHORTCUT_DEFAULTS.fullscreen[0], 'Mod+F');
  assert.equal(POS_SHORTCUT_DEFAULTS.receipts[0], 'Mod+J');
  assert.equal(POS_SHORTCUT_DEFAULTS.cash[0], 'Mod+B');
  assert.ok(!Object.values(POS_SHORTCUT_DEFAULTS).flat().some((t) => /^F\d/.test(t)));
  const g = mergePosSettings(POS_DEVICE_DEFAULTS, { shortcuts: { ...POS_SHORTCUT_DEFAULTS, cash: ['Mod+G'] } });
  assert.deepEqual(g.shortcuts.cash, ['Mod+G']);
  assert.deepEqual(g.shortcuts.card, ['Mod+K']);
});

test('schnellLogin (Vorgabe an) und tgChips (Vorgabe 5/10) stehen im Betriebs-Standard', () => {
  assert.equal(POS_BUSINESS_DEFAULTS.fastLogin, true);
  assert.deepEqual(POS_BUSINESS_DEFAULTS.tipChips, [5, 10]);
  assert.deepEqual(mergePosSettings(POS_BUSINESS_DEFAULTS, { tipChips: [7.5] }).tipChips, [7.5]);
});

// --- Netzwerk-Bondrucker (Server Direct Print) --------------------------------
import { listMyPrinters, createPrintJob, getPrintJob } from '../src/kasse/index.js';
import { POS_DEVICE_DEFAULTS as GERAET_STD } from '../src/kasse/index.js';

test('listMyPrinters/createPrintJob/getPrintJob: Aufrufe und Antworten; Drucker-Einstellungen kennen sdp + druckerId', async () => {
  const l = transportMit({ printers: [{ id: 'd1', name: 'Theke', kind: 'epson-sdp', paperSize: 'mm58', active: true, createdAt: 1, lastSeenAt: 5, lastResult: null, printerSerial: 'TM-m30III' }] });
  const drucker = await listMyPrinters(l.rufen);
  assert.equal(gesendet(l.aufrufe).fn, 'listMyPrinters');
  assert.deepEqual(drucker.map((d) => [d.id, d.name, d.paperSize, d.lastSeenAt]), [['d1', 'Theke', 'mm58', 5]]);
  const c = transportMit({ jobId: 'j1', status: 'pending' });
  const layout = { paperSize: 'mm80' as const, ruleset: 2 as const, lines: [] };
  const job = await createPrintJob(c.rufen, { printerId: 'd1', layout, receiptId: 'K1-ID-1', title: 'Beleg', source: 'pos' });
  assert.equal(job.jobId, 'j1');
  const g = gesendet(c.aufrufe);
  assert.equal(g.fn, 'createPrintJob');
  assert.deepEqual(g.params, { printerId: 'd1', layout, receiptId: 'K1-ID-1', title: 'Beleg', source: 'pos' });
  const s = transportMit({ jobId: 'j1', status: 'printed', createdAt: 1, sentAt: 2, result: { success: true, code: null, status: '0', at: 3 } });
  const st = await getPrintJob(s.rufen, { printerId: 'd1', jobId: 'j1' });
  assert.equal(st.status, 'printed');
  assert.equal(st.result?.success, true);
  // Einstellungen: neue Verbindungsart und Drucker-Kennung
  assert.equal(GERAET_STD.printerId, '');
  // Epson direkt per IP (ePOS): Device-ID des Druckers, Vorgabe local_printer
  assert.equal(GERAET_STD.printerDeviceId, 'local_printer');
  const rd = await getKasseSettings(transportMit({ device: { printerType: 'network', printerIp: '192.168.0.136', printerDeviceId: 'theke' } }).rufen);
  assert.equal(rd.device.printerDeviceId, 'theke');
  assert.equal(rd.device.printerIp, '192.168.0.136');
  const rz = await getKasseSettings(transportMit({ device: { printerType: 'sdp', printerId: 'd1' } }).rufen);
  assert.equal(rz.device.printerType, 'sdp');
  assert.equal(rz.device.printerId, 'd1');
});

/**
 * Der Druckjob traegt Logo und Marke zum Server -- im Format, das
 * `createPrintJob` im Backend prueft (Rasterzeilen als Base64, MSB zuerst).
 * Ohne Angabe bleibt die Nutzlast wie bisher.
 */
test('createPrintJob: Logo als Mass + Base64-Zeilen, Marke nur wenn gesetzt; ohne beides Nutzlast wie bisher', async () => {
  const layout = { paperSize: 'mm80' as const, ruleset: 2 as const, lines: [] };
  const raster = { breite: 10, hoehe: 2, punkte: new Uint8Array(20).fill(1) };

  const mit = transportMit({ jobId: 'j2', status: 'pending' });
  await createPrintJob(mit.rufen, { printerId: 'd1', layout, logo: { stufe: 'S', pxBreite: 40, pxHoehe: 20, raster }, brand: true });
  const g = gesendet(mit.aufrufe);
  assert.equal(g.fn, 'createPrintJob');
  assert.deepEqual(g.params.logo, { scale: 'S', pxWidth: 40, pxHeight: 20, width: 10, height: 2, rows: '/8D/wA==' });
  assert.equal(g.params.brand, true);

  const ohne = transportMit({ jobId: 'j3', status: 'pending' });
  await createPrintJob(ohne.rufen, { printerId: 'd1', layout, logo: null, brand: false });
  assert.deepEqual(Object.keys(gesendet(ohne.aufrufe).params).sort(), ['layout', 'printerId']);
});

test('Kasseneck Connect: connectDruckerId + terminalVia im Geraet-Standard, Merge nimmt sie an, unbekannte Schluessel bleiben draussen', () => {
  assert.equal(POS_DEVICE_DEFAULTS.connectPrinterId, '');
  assert.equal(POS_DEVICE_DEFAULTS.terminalVia, 'direct');
  // Kartenterminal: ohne Zuweisung 'keins', HPS-Port-Vorgabe 8080 (20008 war nie funktionsfaehig).
  assert.equal(POS_DEVICE_DEFAULTS.terminalType, 'none');
  assert.equal(POS_DEVICE_DEFAULTS.terminalTid, '');
  assert.equal(POS_DEVICE_DEFAULTS.terminalPort, 8080);
  const g = mergePosSettings(POS_DEVICE_DEFAULTS, { printerType: 'connect', connectPrinterId: 'p_x', terminalVia: 'connect', terminalType: 'hps', terminalTid: '3600335', unsinn: 'weg' } as never);
  assert.equal(g.printerType, 'connect');
  assert.equal(g.connectPrinterId, 'p_x');
  assert.equal(g.terminalVia, 'connect');
  assert.equal(g.terminalType, 'hps');
  assert.equal(g.terminalTid, '3600335');
  assert.ok(!('unsinn' in g));
});

test('QR-Modus des Bondruckers: unbestimmt als Vorgabe, beide Modi annehmbar, Liste zur Laufzeit', () => {
  // Welchen QR-Befehl ein Thermodrucker versteht, entscheidet das Geraet und
  // nicht der Betrieb: derselbe Bon kommt am einen Drucker sauber heraus und
  // am naechsten als Zeichensalat. Der Wizard laesst beide Modi probedrucken
  // und merkt sich den, der lesbar war.
  //
  // **Die Vorgabe ist 'auto' und nicht einer der beiden Modi.** Eine harte
  // Vorgabe haette den ganzen Altbestand still umgestellt: jedes Geraet, das
  // nie durch den Wizard lief, druckte ploetzlich anders als bisher. 'auto'
  // heisst "hier hat niemand entschieden" — jede Kasse bleibt bei ihrer
  // Praxis, bis ein ausdruecklicher Wert danebensteht.
  assert.equal(POS_DEVICE_DEFAULTS.qrMode, 'auto');
  const e = mergePosSettings(POS_DEVICE_DEFAULTS, { qrMode: 'escpos' });
  assert.equal(e.qrMode, 'escpos');
  const r = mergePosSettings(POS_DEVICE_DEFAULTS, { qrMode: 'raster' });
  assert.equal(r.qrMode, 'raster');
  // Als Laufzeitliste und nicht nur als Typ: der Backend-Validator und das
  // Flutter-Paket pruefen gegen genau diese Werte.
  assert.deepEqual([...QR_MODE], ['auto', 'raster', 'escpos']);
});

test('Golden: die Standardwerte der Kassen-Einstellungen stehen in fixtures/kasse-settings-standard.json', () => {
  // Die Datei ist die Zusage an die Zwillinge (Backend, Flutter-Kasse). Weicht
  // sie ab, ist entweder ein Standardwert geaendert worden, ohne ihn zu
  // veroeffentlichen — oder umgekehrt.
  const datei = JSON.parse(readFileSync(new URL('../../fixtures/kasse-settings-standard.json', import.meta.url), 'utf8'));
  assert.deepEqual(datei, JSON.parse(JSON.stringify({ business: POS_BUSINESS_DEFAULTS, device: POS_DEVICE_DEFAULTS })),
    'fixtures/kasse-settings-standard.json ist veraltet — `npm run fixtures:kasse` ausfuehren');
});

// --- Laufzeitlisten ----------------------------------------------------------
// Die Enums sind Daten, nicht nur Typen: die Zwillinge (Backend-Validator,
// Flutter-Paket) pruefen gegen genau diese Listen.
import {
  PRINTER_TYPE, TERMINAL_VIA, TERMINAL_TYPE, POS_SHORTCUT_ACTIONS, QR_MODE,
} from '../src/kasse/index.js';
import { REGISTER_PERMS } from '../src/register/index.js';

test('Enums gibt es zur Laufzeit — Verbraucher koennen pruefen statt zu raten', () => {
  assert.deepEqual([...PRINTER_TYPE], ['sdp', 'network', 'bluetooth', 'usb', 'connect']);
  assert.deepEqual([...TERMINAL_VIA], ['direct', 'connect']);
  assert.deepEqual([...TERMINAL_TYPE], ['none', 'hps']);
  assert.equal(POS_SHORTCUT_ACTIONS.length, 16);
});

test('GP Tom ist ein Kartenanbieter — sonst verwirft der Backend-Validator die Einstellung', () => {
  assert.ok(CARD_PROVIDER.includes('gptom'));
});

test('druckerName gibt es — der Dart-Zwilling schickt ihn, sonst faellt er still weg', () => {
  assert.equal(POS_DEVICE_DEFAULTS.printerName, '');
});

test('Die Markenfarbe ist Petrol aus der Palette', () => {
  assert.equal(POS_BUSINESS_DEFAULTS.color, '#136B6B');
});

test('Die Rechte-Schluessel stehen als Liste bereit', () => {
  assert.deepEqual([...REGISTER_PERMS], [
    'sell', 'cancel', 'articles', 'layout', 'reports', 'takeover',
    'cancelScope', 'receiptsScope', 'drawer', 'discount', 'tipAssign',
  ]);
});

test('listMyTipRecipients liefert die Empfaenger', async () => {
  const rufe: string[] = [];
  const rufen = (async (name: string) => {
    rufe.push(name);
    return { recipients: [{ registerUserId: 'a', name: 'Anna', owner: true }, { registerUserId: 'b', name: 'Berta', owner: false }] };
  }) as never;
  const leute = await listMyTipRecipients(rufen);
  assert.deepEqual(rufe, ['listMyTipRecipients']);
  assert.deepEqual(leute, [{ registerUserId: 'a', name: 'Anna', owner: true }, { registerUserId: 'b', name: 'Berta', owner: false }]);
});

test('fehlende Liste ist ein Antwortfehler, keine leere Liste', async () => {
  const rufen = (async () => ({})) as never;
  await assert.rejects(() => listMyTipRecipients(rufen), /recipients/);
});

test('owner ist nur bei echtem true wahr', async () => {
  const rufen = (async () => ({ recipients: [{ registerUserId: 'a', name: 'A', owner: 'ja' }] })) as never;
  const [erster] = await listMyTipRecipients(rufen);
  assert.equal(erster!.owner, false);
});

// --- Getrennt zahlen -----------------------------------------------------------
// Standard aus: fuer Betriebe ohne Bedarf aendert sich nichts. Die Tasten-Aktion
// gibt es, aber ohne Vorgabe – eine unerprobte Taste faengt sonst der Browser ab.
test('zahlGetrennt ist aus, die Aktion getrennt hat keine Vorgabe-Taste', () => {
  assert.equal(POS_BUSINESS_DEFAULTS.paySplit, false);
  assert.ok(POS_SHORTCUT_ACTIONS.includes('splitPayment'));
  assert.deepEqual(POS_SHORTCUT_DEFAULTS.splitPayment, []);
  assert.equal(mergePosSettings(POS_BUSINESS_DEFAULTS, { paySplit: true }).paySplit, true);
  const g = mergePosSettings(POS_DEVICE_DEFAULTS, { shortcuts: { ...POS_SHORTCUT_DEFAULTS, splitPayment: ['Mod+I'] } });
  assert.deepEqual(g.shortcuts.splitPayment, ['Mod+I']);
  // Ein Altgeraet ohne die Aktion bekommt sie beim Mischen dazu.
  const { splitPayment: _weg, ...alt } = POS_SHORTCUT_DEFAULTS;
  assert.deepEqual(mergePosSettings(POS_DEVICE_DEFAULTS, { shortcuts: alt as typeof POS_SHORTCUT_DEFAULTS }).shortcuts.splitPayment, []);
});
