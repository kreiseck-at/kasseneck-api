import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ReceiptLayout } from '../src/receipt/layout.js';
import { EposConnectionError, eposDirectPrint, eposDirectStatus, eposParseResponse, eposPrintXml, eposServiceUrl, eposSoapEnvelope, eposXmlEscape, ZEICHEN_JE_PAPIER } from '../src/receipt/index.js';

/**
 * ePOS-Print XML (Epson TM, Server Direct Print / ePOS-Print): aus dem
 * Zeichenraster -- jede Rasterzeile eine <text>-Zeile, Aufdrucke doppelt
 * hoch/invers, QR als <symbol>, Schnitt. Kein eigenes Setzen: was das Raster
 * zeigt, druckt der Epson Zeile fuer Zeile.
 */
const QR = '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-13T00:30:00_5,00_2,70_0,00_0,00_0,00_UMSATZ_VORGAENGER_6F0404F0_SIGNATUR';
const LAYOUT: ReceiptLayout = { paperSize: 'mm80', regelwerk: 2, lines: [
  { kind: 'banner', text: 'TESTSIGNATUR — kein gültiger Beleg', ton: 'warnung' },
  { kind: 'text', text: 'Bäckerei <Muster> & Söhne', align: 'center', bold: true },
  { kind: 'columns', columns: [{ text: 'Gesamt:', width: 6, align: 'left' }, { text: '5,96 €', width: 6, align: 'right' }] },
  { kind: 'rule', char: '-' },
  { kind: 'space', lines: 2 },
  { kind: 'qr', data: QR },
] };

test('eposPrintXml: Namensraum, lang de, eine <text> je Rasterzeile mit exakt N Zeichen, Sonderzeichen escaped, QR-Symbol, Schnitt', () => {
  const xml = eposPrintXml(LAYOUT);
  assert.ok(xml.startsWith('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">'));
  assert.ok(xml.includes('<text lang="de"/>'));
  // Firmenzeile: escaped, zentriert aufgefuellt auf 48 Zeichen, fett
  const firma = /<text em="true">([^<]*)&#10;<\/text>/.exec(xml);
  assert.ok(firma, xml);
  assert.equal(firma![1]!.length, 48 + ('&lt;'.length - 1) + ('&gt;'.length - 1) + ('&amp;'.length - 1));
  assert.ok(firma![1]!.includes('Bäckerei &lt;Muster&gt; &amp; Söhne'));
  // Warnrahmen: doppelt hoch + invers, wortweise auf 48 -> eine Zeile
  assert.ok(/<text width="1" height="2" reverse="true" em="true"> *TESTSIGNATUR — kein gültiger Beleg *&#10;<\/text>/.test(xml), xml);
  // Gesamt-Zeile: 48 Zeichen, Preis am Ende
  assert.ok(/<text>Gesamt: +5,96 €&#10;<\/text>/.test(xml), xml);
  // Linie, Leerraum, QR, Schnitt
  assert.ok(xml.includes(`<text>${'-'.repeat(48)}&#10;</text>`));
  assert.ok((xml.match(/<feed line="1"\/>/g) ?? []).length >= 2);
  assert.ok(xml.includes(`<symbol type="qrcode_model_2" level="level_m" width="6" height="0" size="0">${QR}</symbol>`));
  assert.ok(/<cut type="feed"\/>\s*<\/epos-print>\s*$/.test(xml));
  // 58 mm: 32 Zeichen
  const xml58 = eposPrintXml({ ...LAYOUT, paperSize: 'mm58' });
  assert.ok(xml58.includes(`<text>${'-'.repeat(ZEICHEN_JE_PAPIER.mm58)}&#10;</text>`));
});

test('eposXmlEscape und Zeilen ohne Text; jede Textzeile hat einen Zeilenumbruch (Epson druckt sonst nicht um)', () => {
  assert.equal(eposXmlEscape('a<b>&"\''), 'a&lt;b&gt;&amp;&quot;&apos;');
  const xml = eposPrintXml({ paperSize: 'mm58', regelwerk: 2, lines: [{ kind: 'text', text: 'Zeile', align: 'left', bold: false }] });
  assert.ok(/<text>Zeile {27}&#10;<\/text>/.test(xml), xml);
});

// ---------------------------------------------------------- ePOS direkt per IP

test('ePOS direkt: Service-URL, SOAP-Huelle, Antwort lesen', () => {
  // Nachgemessen am TM-T20 (ePOS-Print 5.0): POST https://<ip>/cgi-bin/epos/service.cgi?devid=..&timeout=..;
  // Antwort <response success="true" code="" status="..."/>, dazu CORS- und Private-Network-Header.
  assert.equal(eposServiceUrl('192.168.0.136'), 'https://192.168.0.136/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000');
  assert.equal(eposServiceUrl(' 192.168.0.136 ', 'theke 1', 5000), 'https://192.168.0.136/cgi-bin/epos/service.cgi?devid=theke%201&timeout=5000');
  assert.throws(() => eposServiceUrl(''), /IP/);
  assert.throws(() => eposServiceUrl('192.168.0.136/x'), /IP/);
  const huelle = eposSoapEnvelope('<epos-print xmlns="x"/>');
  assert.equal(huelle, '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><epos-print xmlns="x"/></s:Body></s:Envelope>');
  assert.deepEqual(eposParseResponse('<?xml version="1.0"?><s:Envelope><s:Body><response success="true" code="" status="251658262" battery="0" xmlns="n"></response></s:Body></s:Envelope>'), { success: true, code: '', status: '251658262' });
  assert.deepEqual(eposParseResponse('<response success="false" code="EPTR_COVER_OPEN" status="1"/>'), { success: false, code: 'EPTR_COVER_OPEN', status: '1' });
  assert.deepEqual(eposParseResponse('kaputt'), { success: false, code: 'keine_antwort', status: '' });
});

test('ePOS direkt: drucken und Status ueber fetch; Netzfehler wird verstaendlich', async () => {
  const aufrufe: { url: string; init: RequestInit }[] = [];
  const fetchOk = (async (url: string, init: RequestInit) => { aufrufe.push({ url, init }); return { ok: true, status: 200, text: async () => '<response success="true" code="" status="1"/>' }; }) as unknown as typeof fetch;
  const r = await eposDirectPrint(LAYOUT, { ip: '192.168.0.136', papier: 'mm58' }, fetchOk);
  assert.deepEqual(r, { success: true, code: '', status: '1' });
  assert.equal(aufrufe[0]!.url, 'https://192.168.0.136/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000');
  assert.equal(aufrufe[0]!.init.method, 'POST');
  assert.equal((aufrufe[0]!.init.headers as Record<string, string>)['SOAPAction'], '""');
  const body = String(aufrufe[0]!.init.body);
  assert.ok(body.startsWith('<?xml version="1.0" encoding="utf-8"?><s:Envelope'));
  assert.ok(body.includes('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">'));
  // 58 mm: dieselben Bytes wie das 32-Zeichen-Raster, nicht das 48er des Layouts
  assert.ok(body.includes(eposPrintXml({ ...LAYOUT, paperSize: 'mm58' }, { zeichen: 32 })));
  assert.ok(!body.includes(eposPrintXml(LAYOUT, { zeichen: 48 })));
  // Statusabfrage: leeres Dokument, druckt nichts
  const s = await eposDirectStatus({ ip: '192.168.0.136', devid: 'p1' }, fetchOk);
  assert.deepEqual(s, { success: true, code: '', status: '1' });
  assert.ok(String(aufrufe[1]!.init.body).includes('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"/>'));
  assert.ok(aufrufe[1]!.url.includes('devid=p1'));
  // Netzfehler (Zertifikat nicht akzeptiert / nicht erreichbar)
  const fetchNetz = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
  await assert.rejects(eposDirectPrint(LAYOUT, { ip: '192.168.0.136' }, fetchNetz), /https:\/\/192\.168\.0\.136/);
  const fetch500 = (async () => ({ ok: false, status: 500, text: async () => '' })) as unknown as typeof fetch;
  await assert.rejects(eposDirectPrint(LAYOUT, { ip: '192.168.0.136' }, fetch500), /HTTP 500/);
});

/**
 * Der eigentliche Befund (28.08.2026): `eposDirectSend` rief `fetch` bislang
 * OHNE `signal` -- der `timeout=`-Parameter in der URL ist ein Hinweis FUER
 * DEN DRUCKER, keine Frist fuer den Aufrufer. Ein Drucker, der die Verbindung
 * annimmt und nie antwortet, liess den Aufruf frueher NIE zurueckkehren.
 *
 * Diese Attrappe stellt genau das nach: eine `fetchFn`, die niemals aufloest
 * (kein Zeitablauf, kein Reject) -- ohne eine echte Frist im Code liefe dieser
 * Test bis zum Timeout des Testlaufers durch, nicht weil er bestanden ist.
 */
test('ePOS direkt: ein haengender Drucker haelt den Aufruf nicht unbegrenzt fest -- die Frist deckt den ganzen Aufruf', async () => {
  const haengt = (async () => new Promise<Response>(() => { /* loest nie auf */ })) as unknown as typeof fetch;
  const start = Date.now();
  await assert.rejects(
    eposDirectPrint(LAYOUT, { ip: '192.168.0.136', timeoutMs: 30 }, haengt),
    (e: unknown) => {
      assert.ok(e instanceof EposConnectionError, `falsche Fehlerart: ${String(e)}`);
      assert.equal(e.timedOut, true, 'ein haengender Drucker ist ein Zeitablauf, keine Ablehnung');
      assert.match(e.message, /Zeitlimit/);
      return true;
    },
  );
  // Grosszuegige Toleranz (kein exaktes Timing pruefen) -- entscheidend ist
  // NUR, dass der Aufruf ueberhaupt zurueckkehrt, deutlich unter der alten
  // "fuer immer"-Grenze.
  assert.ok(Date.now() - start < 2000, 'der Aufruf haette laengst zurueckkehren muessen');
});

test('ePOS direkt: eine haengende Antwort (Kopf da, Rumpf offen) faellt unter dieselbe Frist', async () => {
  const kopfOhneRumpf = (async () => ({
    ok: true,
    status: 200,
    text: () => new Promise<string>(() => { /* loest nie auf */ }),
  })) as unknown as typeof fetch;
  const start = Date.now();
  await assert.rejects(
    eposDirectPrint(LAYOUT, { ip: '192.168.0.136', timeoutMs: 30 }, kopfOhneRumpf),
    (e: unknown) => e instanceof EposConnectionError && e.timedOut === true,
  );
  assert.ok(Date.now() - start < 2000);
});

test('ePOS direkt: eine sofort abgelehnte Verbindung ist KEIN Zeitablauf', async () => {
  const fetchNetz = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
  await assert.rejects(
    eposDirectPrint(LAYOUT, { ip: '192.168.0.136' }, fetchNetz),
    (e: unknown) => e instanceof EposConnectionError && e.timedOut === false,
  );
});

test('ePOS direkt: die Frist geht als AbortSignal an fetch mit', async () => {
  let gesehenesSignal: AbortSignal | undefined;
  const fetchOk = (async (_url: string, init: RequestInit) => {
    gesehenesSignal = init.signal as AbortSignal;
    return { ok: true, status: 200, text: async () => '<response success="true" code="" status="1"/>' };
  }) as unknown as typeof fetch;
  await eposDirectPrint(LAYOUT, { ip: '192.168.0.136' }, fetchOk);
  assert.ok(gesehenesSignal instanceof AbortSignal);
  assert.equal(gesehenesSignal!.aborted, false);
});
