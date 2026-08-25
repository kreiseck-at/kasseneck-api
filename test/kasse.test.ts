import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KASSE_BETRIEB_STANDARD,
  KASSE_TASTEN_STANDARD,
  KARTENANBIETER,
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
test('Standardwerte: klar, Korb rechts, Trinkgeld aus, Beleg fragt -- wie im Backend', () => {
  assert.equal(KASSE_BETRIEB_STANDARD.stil, 'klar');
  assert.equal(KASSE_BETRIEB_STANDARD.trinkgeld, false);
  // 'fragen': Fertig-Seite bietet QR und Bon an — Standard seit 0.6.21.
  assert.equal(KASSE_BETRIEB_STANDARD.belegAusgabe, 'fragen');
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
  assert.equal(fromKasseArtikelPayload({ id: 'a4', name: 'X', maxMenge: 2.5 }).maxMenge, 2.5); // Kommazahl (2,5 kg)
  assert.equal(fromKasseArtikelPayload({ id: 'a5', name: 'X', maxMenge: -1 }).maxMenge, null);
  assert.equal(mengeErlaubt({ maxMenge: 2.5 }, 3), 2.5);
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

test('Kartenanbieter: Vorgabe keiner, Karte aus -- Karte gibt es erst mit Anbieter', () => {
  assert.equal(KASSE_BETRIEB_STANDARD.kartenanbieter, 'keiner');
  assert.equal(KASSE_BETRIEB_STANDARD.zahlKarte, false);
  assert.deepEqual([...KARTENANBIETER], ['keiner', 'extern', 'gptom', 'hobex', 'mypos', 'stripe']);
});

test('Tastenkarte je Geraet: Vorgabe ohne F-Tasten, Merge je Aktion', () => {
  // Mod+F gehoert seit 0.6.24 dem Vollbild, Mod+B seit 0.6.25 den Belegen.
  assert.equal(KASSE_TASTEN_STANDARD.frei[0], 'Mod+D');
  assert.equal(KASSE_TASTEN_STANDARD.vollbild[0], 'Mod+F');
  assert.equal(KASSE_TASTEN_STANDARD.belege[0], 'Mod+J');
  assert.equal(KASSE_TASTEN_STANDARD.bar[0], 'Mod+B');
  assert.ok(!Object.values(KASSE_TASTEN_STANDARD).flat().some((t) => /^F\d/.test(t)));
  const g = mergeKasseSettings(KASSE_GERAET_STANDARD, { tasten: { ...KASSE_TASTEN_STANDARD, bar: ['Mod+G'] } });
  assert.deepEqual(g.tasten.bar, ['Mod+G']);
  assert.deepEqual(g.tasten.karte, ['Mod+K']);
});

test('schnellLogin (Vorgabe an) und tgChips (Vorgabe 5/10) stehen im Betriebs-Standard', () => {
  assert.equal(KASSE_BETRIEB_STANDARD.schnellLogin, true);
  assert.deepEqual(KASSE_BETRIEB_STANDARD.tgChips, [5, 10]);
  assert.deepEqual(mergeKasseSettings(KASSE_BETRIEB_STANDARD, { tgChips: [7.5] }).tgChips, [7.5]);
});

// --- Netzwerk-Bondrucker (Server Direct Print) --------------------------------
import { listMyPrinters, createPrintJob, getPrintJob } from '../src/kasse/index.js';
import { KASSE_GERAET_STANDARD as GERAET_STD } from '../src/kasse/index.js';

test('listMyPrinters/createPrintJob/getPrintJob: Aufrufe und Antworten; Drucker-Einstellungen kennen sdp + druckerId', async () => {
  const l = transportMit({ drucker: [{ id: 'd1', name: 'Theke', art: 'epson-sdp', papier: 'mm58', aktiv: true, erstellt: 1, zuletztGesehen: 5, zuletztErgebnis: null, druckerKennung: 'TM-m30III' }] });
  const drucker = await listMyPrinters(l.rufen);
  assert.equal(gesendet(l.aufrufe).fn, 'listMyPrinters');
  assert.deepEqual(drucker.map((d) => [d.id, d.name, d.papier, d.zuletztGesehen]), [['d1', 'Theke', 'mm58', 5]]);
  const c = transportMit({ jobId: 'j1', status: 'offen' });
  const layout = { paperSize: 'mm80' as const, regelwerk: 2 as const, lines: [] };
  const job = await createPrintJob(c.rufen, { druckerId: 'd1', layout, receiptId: 'K1-ID-1', titel: 'Beleg', quelle: 'kasse' });
  assert.equal(job.jobId, 'j1');
  const g = gesendet(c.aufrufe);
  assert.equal(g.fn, 'createPrintJob');
  assert.deepEqual(g.params, { druckerId: 'd1', layout, receiptId: 'K1-ID-1', titel: 'Beleg', quelle: 'kasse' });
  const s = transportMit({ jobId: 'j1', status: 'gedruckt', erstellt: 1, gesendetAt: 2, ergebnis: { erfolg: true, code: null, status: '0', zeit: 3 } });
  const st = await getPrintJob(s.rufen, { druckerId: 'd1', jobId: 'j1' });
  assert.equal(st.status, 'gedruckt');
  assert.equal(st.ergebnis?.erfolg, true);
  // Einstellungen: neue Verbindungsart und Drucker-Kennung
  assert.equal(GERAET_STD.druckerId, '');
  // Epson direkt per IP (ePOS): Device-ID des Druckers, Vorgabe local_printer
  assert.equal(GERAET_STD.druckerDevid, 'local_printer');
  const rd = await getKasseSettings(transportMit({ geraet: { druckerArt: 'netz', druckerIp: '192.168.0.136', druckerDevid: 'theke' } }).rufen);
  assert.equal(rd.geraet.druckerDevid, 'theke');
  assert.equal(rd.geraet.druckerIp, '192.168.0.136');
  const rz = await getKasseSettings(transportMit({ geraet: { druckerArt: 'sdp', druckerId: 'd1' } }).rufen);
  assert.equal(rz.geraet.druckerArt, 'sdp');
  assert.equal(rz.geraet.druckerId, 'd1');
});

test('Kasseneck Connect: connectDruckerId + terminalVia im Geraet-Standard, Merge nimmt sie an, unbekannte Schluessel bleiben draussen', () => {
  assert.equal(KASSE_GERAET_STANDARD.connectDruckerId, '');
  assert.equal(KASSE_GERAET_STANDARD.terminalVia, 'direkt');
  // Kartenterminal: ohne Zuweisung 'keins', HPS-Port-Vorgabe 8080 (20008 war nie funktionsfaehig).
  assert.equal(KASSE_GERAET_STANDARD.terminalArt, 'keins');
  assert.equal(KASSE_GERAET_STANDARD.terminalTid, '');
  assert.equal(KASSE_GERAET_STANDARD.terminalPort, 8080);
  const g = mergeKasseSettings(KASSE_GERAET_STANDARD, { druckerArt: 'connect', connectDruckerId: 'p_x', terminalVia: 'connect', terminalArt: 'hps', terminalTid: '3600335', unsinn: 'weg' } as never);
  assert.equal(g.druckerArt, 'connect');
  assert.equal(g.connectDruckerId, 'p_x');
  assert.equal(g.terminalVia, 'connect');
  assert.equal(g.terminalArt, 'hps');
  assert.equal(g.terminalTid, '3600335');
  assert.ok(!('unsinn' in g));
});

test('Golden: die Standardwerte der Kassen-Einstellungen stehen in fixtures/kasse-settings-standard.json', () => {
  // Die Datei ist die Zusage an die Zwillinge (Backend, Flutter-Kasse). Weicht
  // sie ab, ist entweder ein Standardwert geaendert worden, ohne ihn zu
  // veroeffentlichen — oder umgekehrt.
  const datei = JSON.parse(readFileSync(new URL('../../fixtures/kasse-settings-standard.json', import.meta.url), 'utf8'));
  assert.deepEqual(datei, JSON.parse(JSON.stringify({ betrieb: KASSE_BETRIEB_STANDARD, geraet: KASSE_GERAET_STANDARD })),
    'fixtures/kasse-settings-standard.json ist veraltet — `npm run fixtures:kasse` ausfuehren');
});

// --- Laufzeitlisten ----------------------------------------------------------
// Die Enums sind Daten, nicht nur Typen: die Zwillinge (Backend-Validator,
// Flutter-Paket) pruefen gegen genau diese Listen.
import {
  DRUCKER_ART, TERMINAL_VIA, TERMINAL_ART, TASTEN_AKTIONEN,
} from '../src/kasse/index.js';
import { REGISTER_PERMS } from '../src/register/index.js';

test('Enums gibt es zur Laufzeit — Verbraucher koennen pruefen statt zu raten', () => {
  assert.deepEqual([...DRUCKER_ART], ['sdp', 'netz', 'bt', 'usb', 'connect']);
  assert.deepEqual([...TERMINAL_VIA], ['direkt', 'connect']);
  assert.deepEqual([...TERMINAL_ART], ['keins', 'hps']);
  assert.equal(TASTEN_AKTIONEN.length, 15);
});

test('GP Tom ist ein Kartenanbieter — sonst verwirft der Backend-Validator die Einstellung', () => {
  assert.ok(KARTENANBIETER.includes('gptom'));
});

test('druckerName gibt es — der Dart-Zwilling schickt ihn, sonst faellt er still weg', () => {
  assert.equal(KASSE_GERAET_STANDARD.druckerName, '');
});

test('Die Markenfarbe ist Petrol aus der Palette', () => {
  assert.equal(KASSE_BETRIEB_STANDARD.farbe, '#116B6B');
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
