import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KASSE_BETRIEB_STANDARD,
  KASSE_GERAET_STANDARD,
  mergeKasseSettings,
  verteileRabatt,
  fromArticleGroupPayload,
  fromKasseArtikelPayload,
  mengeErlaubt,
  getKasseSettings,
  setMyKasseSettings,
  setMyRegisterDeviceSettings,
  listMyArticleGroups,
  listMyArticles,
  mengenregelFuerEinheit,
  mengenVorgabe,
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
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
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
test('Standardwerte: klar, Korb rechts, Trinkgeld aus, QR-Beleg -- wie im Backend', () => {
  assert.equal(KASSE_BETRIEB_STANDARD.stil, 'klar');
  assert.equal(KASSE_BETRIEB_STANDARD.trinkgeld, false);
  assert.equal(KASSE_BETRIEB_STANDARD.belegAusgabe, 'qr');
  assert.deepEqual(KASSE_BETRIEB_STANDARD.saetze, { 20: true, 13: true, 10: true, 4.9: true, 0: true, 19: false });
  assert.equal(KASSE_GERAET_STANDARD.layout, 'rechts');
  assert.equal(KASSE_GERAET_STANDARD.druckerPort, 9100);
  assert.equal(KASSE_GERAET_STANDARD.touch, false); // Standard: Tastatur, kein Ziffernfeld
  // Schluesselmengen sind getrennt
  const b = Object.keys(KASSE_BETRIEB_STANDARD), g = Object.keys(KASSE_GERAET_STANDARD);
  assert.deepEqual(b.filter((x) => g.includes(x)), []);
});

test('mergeKasseSettings: gespeichertes ueberlagert, Landkarten je Schluessel, Unbekanntes bleibt draussen', () => {
  const r = mergeKasseSettings(KASSE_BETRIEB_STANDARD, { stil: 'warm', saetze: { 19: true }, foo: 1 } as never);
  assert.equal(r.stil, 'warm');
  assert.deepEqual(r.saetze, { 20: true, 13: true, 10: true, 4.9: true, 0: true, 19: true });
  assert.equal((r as unknown as Record<string, unknown>)['foo'], undefined);
  assert.deepEqual(mergeKasseSettings(KASSE_GERAET_STANDARD, null), KASSE_GERAET_STANDARD);
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
test('fromArticleGroupPayload / fromKasseArtikelPayload lesen die Backend-Form', () => {
  const g = fromArticleGroupPayload({ id: 'g1', name: 'Gebäck', color: '#D97706', symbol: '🥐', sort: 1, vatRate: 10 });
  assert.deepEqual(g, { id: 'g1', name: 'Gebäck', color: '#D97706', symbol: '🥐', sort: 1, vatRate: 10 });
  const a = fromKasseArtikelPayload({ id: 'a1', name: 'Semmel', unitPriceCents: 79, vatRate: 10, unit: 'Stk', groupId: 'g1', kasse: { sichtbar: true, sort: 2 }, active: true });
  assert.deepEqual(a, { id: 'a1', name: 'Semmel', unitPriceCents: 79, vatRate: 10, unit: 'Stk', groupId: 'g1', sichtbar: true, sort: 2, active: true, mengenregel: null, mengeFragen: null, maxMenge: null });
  // Hoechstmenge je Beleg: nur positive ganze Zahlen zaehlen, sonst keine Grenze
  assert.equal(fromKasseArtikelPayload({ id: 'a2', name: 'Torte', maxMenge: 3 }).maxMenge, 3);
  assert.equal(fromKasseArtikelPayload({ id: 'a3', name: 'X', maxMenge: 0 }).maxMenge, null);
  assert.equal(fromKasseArtikelPayload({ id: 'a4', name: 'X', maxMenge: 2.5 }).maxMenge, null);
  assert.equal(mengeErlaubt({ maxMenge: 3 }, 2), 2);
  assert.equal(mengeErlaubt({ maxMenge: 3 }, 5), 3);
  assert.equal(mengeErlaubt({ maxMenge: null }, 500), 500);
  assert.equal(mengeErlaubt({ maxMenge: 3 }, 0), 0);
  // Altbestand ohne Kachel-Felder
  const alt = fromKasseArtikelPayload({ id: 'a2', name: 'Alt', unitPriceCents: 100, vatRate: 20 });
  assert.equal(alt.groupId, null);
  assert.equal(alt.sichtbar, true);
  assert.equal(alt.unit, '');
});

test('listMyArticleGroups und listMyArticles rufen die Endpunkte und lesen die Listen', async () => {
  const g = transportMit({ groups: [{ id: 'g1', name: 'Gebäck', color: '#D97706', symbol: null, sort: 0, vatRate: null }] });
  const gruppen = await listMyArticleGroups(g.rufen);
  assert.equal(gesendet(g.aufrufe).fn, 'listMyArticleGroups');
  assert.equal(gruppen[0]!.symbol, null);
  const a = transportMit({ articles: [{ id: 'a1', name: 'Semmel', unitPriceCents: 79, vatRate: 10, groupId: null, kasse: { sichtbar: false, sort: 0 } }] });
  const artikel = await listMyArticles(a.rufen);
  assert.equal(gesendet(a.aufrufe).fn, 'listMyArticles');
  assert.equal(artikel[0]!.sichtbar, false);
  const kaputt = transportMit({ nix: true });
  await assert.rejects(() => listMyArticleGroups(kaputt.rufen), /groups/);
});

// --- Einstellungen: Client -----------------------------------------------------
test('getKasseSettings mischt die Antwort mit den Standardwerten', async () => {
  const { rufen, aufrufe } = transportMit({ betrieb: { stil: 'nacht' }, geraet: { layout: 'links' } });
  const s = await getKasseSettings(rufen, { deviceId: 'dev1' });
  assert.deepEqual(gesendet(aufrufe).params, { deviceId: 'dev1' });
  assert.equal(s.betrieb.stil, 'nacht');
  assert.equal(s.betrieb.freiErlaubt, true);
  assert.equal(s.geraet.layout, 'links');
  assert.equal(s.geraet.druckerPort, 9100);
});

test('setMyKasseSettings / setMyRegisterDeviceSettings senden nur den Block und lesen den Stand zurueck', async () => {
  const b = transportMit({ betrieb: { stil: 'warm' } });
  const rb = await setMyKasseSettings(b.rufen, { stil: 'warm' });
  assert.deepEqual(gesendet(b.aufrufe).params, { betrieb: { stil: 'warm' } });
  assert.equal(rb.stil, 'warm');
  const g = transportMit({ geraet: { layout: 'vollbild' } });
  const rg = await setMyRegisterDeviceSettings(g.rufen, 'dev1', { layout: 'vollbild' });
  assert.deepEqual(gesendet(g.aufrufe).params, { deviceId: 'dev1', geraet: { layout: 'vollbild' } });
  assert.equal(rg.layout, 'vollbild');
  await assert.rejects(() => setMyKasseSettings(b.rufen, {} as never), /Einstellungen/);
});

// --- Belegliste: Zeitfenster + neue Felder ---------------------------------------
test('listMyReceipts schickt from/to und liest Positionen, Bediener und Storno-Stand', async () => {
  const { rufen, aufrufe } = transportMit({
    receipts: [{ receiptId: 'K-ID-9', receiptType: 'standard', timeStamp: '2026-08-16T09:00:00', total: 4.56, paymentMethod: 'cash',
      items: [{ name: 'Semmel', quantity: 2 }], operator: { uid: 'anna', name: 'Anna' }, cancellationOf: null, cancellationReason: null, stornoStand: 'teil' }],
    stats: { today: { revenue_cents: 0, count: 0 }, trend_percent: null, days: [] },
  });
  const l = await listMyReceipts(rufen, { cashregisterId: 'K', from: '2026-08-16', to: '2026-08-16' });
  const { params } = gesendet(aufrufe);
  assert.equal(params['from'], '2026-08-16');
  assert.equal(params['to'], '2026-08-16');
  const b = l.receipts[0]!;
  assert.deepEqual(b.items, [{ name: 'Semmel', quantity: 2 }]);
  assert.deepEqual(b.operator, { uid: 'anna', name: 'Anna' });
  assert.equal(b.stornoStand, 'teil');
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
  assert.equal(s.stornoStand, 'offen');
});

test('Mengenregel: Vorgabe je Einheit (Stk ganz ohne Fragen; kg/l/m dezimal mit Fragen; g/ml ganz mit Fragen), gespeicherte Angabe schlaegt', () => {
  assert.deepEqual(mengenregelFuerEinheit('Stk'), { regel: 'stueck', fragen: false, stellen: 0 });
  assert.deepEqual(mengenregelFuerEinheit('kg'), { regel: 'dezimal', fragen: true, stellen: 3 });
  assert.deepEqual(mengenregelFuerEinheit('l'), { regel: 'dezimal', fragen: true, stellen: 2 });
  assert.deepEqual(mengenregelFuerEinheit('g'), { regel: 'stueck', fragen: true, stellen: 0 });
  assert.deepEqual(mengenregelFuerEinheit(''), { regel: 'stueck', fragen: false, stellen: 0 });
  const wurst = fromKasseArtikelPayload({ id: 'w', name: 'Wurst', unitPriceCents: 1990, vatRate: 10, unit: 'kg' });
  assert.deepEqual(mengenVorgabe(wurst), { regel: 'dezimal', fragen: true, stellen: 3 });
  const stueckwurst = fromKasseArtikelPayload({ id: 'w', name: 'Wurst', unitPriceCents: 1990, vatRate: 10, unit: 'kg', mengenregel: 'stueck', mengeFragen: false });
  assert.deepEqual(mengenVorgabe(stueckwurst), { regel: 'stueck', fragen: false, stellen: 0 });
  // Rot-Probe: Unsinn im Payload faellt auf null zurueck
  assert.equal(fromKasseArtikelPayload({ id: 'x', name: 'x', mengenregel: 'halb' }).mengenregel, null);
});
