import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getRegisterInspectionInfo, inspectionInfoLines, inspectionInfoRows, labelText, messageText, LABELS, MESSAGES,
  type InspectionInfoRow, type RegisterInspectionInfo,
} from '../src/pos/index.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import type { InternerTransport } from '../src/client/aufrufe.js';

/*
 * Kasseninfo fuer die Pruefung (Kassennachschau, Stufe 2b): Prueffaelle
 * (`fixtures/inspection-info-cases.json`, auch im Dart-Zwilling), der vom User
 * freigegebene Wortlaut und die Regeln des Ausdrucks.
 */

interface Fall {
  name: string;
  info: Record<string, unknown>;
  width: number;
  printedAt: string;
  rows: InspectionInfoRow[];
  lines: string[];
}
const wurzel = fileURLToPath(new URL('../../', import.meta.url));
const { cases } = JSON.parse(readFileSync(join(wurzel, 'fixtures', 'inspection-info-cases.json'), 'utf8')) as { cases: Fall[] };

/** Ein Transport, der genau eine Antwort liefert und die Aufrufe mitschreibt. */
function antwortet(daten: unknown): { rufen: InternerTransport; namen: string[] } {
  const namen: string[] = [];
  const rufen = (async (name: string) => {
    namen.push(name);
    return daten;
  }) as InternerTransport;
  return { rufen, namen };
}
const gelesen = (info: unknown): Promise<RegisterInspectionInfo> => getRegisterInspectionInfo(antwortet(info).rufen);
const GEDRUCKT = new Date('2026-10-29T13:05:00.000Z');

test('Prueffaelle: Zeilen fuer Bildschirm und Druck (gleich im Dart-Zwilling)', async () => {
  assert.ok(cases.length >= 14);
  const breiten = new Set(cases.map((f) => f.width));
  for (const b of [32, 42, 48]) assert.ok(breiten.has(b), `Breite ${b} fehlt in den Faellen`);
  for (const f of cases) {
    const info = await gelesen(f.info);
    assert.deepEqual(inspectionInfoRows(info), f.rows, f.name);
    assert.deepEqual(inspectionInfoLines(info, { width: f.width, printedAt: new Date(f.printedAt) }), f.lines, f.name);
  }
});

// Der freigegebene Text (Spec dep-nachschau, Stufe 2b), Werte erfunden.
const FREIGEGEBEN_ZEILEN = [
  'Kasseneck – cloudbasierte Registrierkasse',
  'Hersteller   Post Now e.U., UID ATU76279224',
  'Kassen-ID    KECK-1',
  '',
  'SIGNATUR',
  'Einheit      Signaturkarte von A-Trust',
  'Betrieb      im Signier-Server von Kasseneck',
  'Zertifikat   Seriennr. 11c6c7cd (hex)',
  '             298239949 (dezimal)',
  'Inhaber      UID ATU12345675',
  'Aussteller   A-Trust Registrierkasse.CA',
  'Gültig       05.10.2026 – 05.10.2031',
  'Abgleich     Inhaber mit A-Trust geprüft',
  'Status       in Betrieb',
  '',
  'DEP          online gespeichert, jederzeit',
  '             exportierbar (USB-Stick, Link)',
  'Abschlüsse   Monatsbeleg automatisch am',
  '             Monatsersten um 00:05, der',
  '             Dezember-Beleg ist der Jahresbeleg',
  'Kontakt      hello@kasseneck.at',
];
const FREIGEGEBEN_ABSATZ = [
  'So arbeitet die Kasse:',
  'Erfasst wird in der Kassen-App oder in der',
  'Web-Kasse, gespeichert wird online. Jeder',
  'Beleg wird beim Erstellen signiert. Den',
  'Beleg gibt es gedruckt, per Mail oder als',
  'QR-Code.',
];
const fall = (name: string): Fall => {
  const f = cases.find((c) => c.name.startsWith(name));
  assert.ok(f, name);
  return f;
};

test('freigegebener Wortlaut: Zeilen mit Bezeichnung wie freigegeben bei 48 Zeichen, der Absatz bei 42', async () => {
  // Der freigegebene Text ist von Hand gesetzt: seine Zeilen mit Bezeichnung
  // brauchen bis zu 47 Zeichen (48er-Bon), sein Absatz ist auf 42 umbrochen.
  // Der Formatierer bricht jede Breite gleich um und ueberschreitet sie nie.
  const info = await gelesen(fall('echte Karte von A-Trust, Breite 42').info);
  const z48 = inspectionInfoLines(info, { width: 48, printedAt: GEDRUCKT });
  assert.deepEqual(z48.slice(0, 2), ['KASSENINFO FÜR DIE PRÜFUNG', '']);
  assert.deepEqual(z48.slice(2, 2 + FREIGEGEBEN_ZEILEN.length), FREIGEGEBEN_ZEILEN);
  assert.equal(z48.at(-1), 'Gedruckt 29.10.2026, 14:05');

  const z42 = inspectionInfoLines(info, { width: 42, printedAt: GEDRUCKT });
  const absatz = z42.indexOf('So arbeitet die Kasse:');
  assert.deepEqual(z42.slice(absatz, absatz + FREIGEGEBEN_ABSATZ.length), FREIGEGEBEN_ABSATZ);
  assert.deepEqual(z42.slice(-2), ['', 'Gedruckt 29.10.2026, 14:05']);
  // Bei 42 Zeichen brechen vier Werte einmal mehr um, alles andere steht wie freigegeben.
  assert.deepEqual(z42.slice(3, 5), ['Hersteller   Post Now e.U.,', '             UID ATU76279224']);
  assert.deepEqual(z42.slice(9, 11), ['Betrieb      im Signier-Server von', '             Kasseneck']);
});

test('keine Zeile ist breiter als der Bon, von 24 bis 64 Zeichen, und nie ein geschuetztes Leerzeichen', async () => {
  for (const f of cases) {
    const info = await gelesen(f.info);
    for (let breite = 24; breite <= 64; breite++) {
      for (const zeile of inspectionInfoLines(info, { width: breite, printedAt: GEDRUCKT })) {
        assert.ok(zeile.length <= breite, `${f.name}, ${breite}: ${JSON.stringify(zeile)}`);
        assert.ok(!zeile.includes('\u00a0'), `${f.name}, ${breite}: ${JSON.stringify(zeile)}`);
        assert.equal(zeile, zeile.trimEnd(), `${f.name}, ${breite}: Leerraum am Ende`);
      }
    }
    for (const z of inspectionInfoRows(info)) for (const w of z.value) assert.ok(!w.includes('\u00a0'), `${f.name}: ${w}`);
  }
});

test('Ueberschriften in Grossschrift ohne ß: Web und Dart schreiben sie gleich gross', () => {
  for (const k of ['inspection.title', 'inspection.signature'] as const) {
    assert.ok(!labelText(k).includes('ß'), k);
  }
});

test('Zeilen: fehlt ein Wert, fehlt die Zeile; nie „unbekannt“', async () => {
  const leer = inspectionInfoRows(await gelesen({ signature: null }));
  // Nur die feste Zeile zum DEP bleibt.
  assert.deepEqual(leer, [{ key: 'dep', section: 'operation', label: 'DEP', value: ['online gespeichert, jederzeit exportierbar (USB-Stick, Link)'] }]);
  for (const f of cases) {
    for (const z of f.rows) {
      for (const w of z.value) assert.doesNotMatch(w, /unbekannt|undefined|null|NaN/i, `${f.name}: ${w}`);
      assert.ok(z.value.length > 0, `${f.name}: ${z.key} ohne Wert`);
    }
  }
  // Ein leerer Ausdruck ohne Angaben: Ueberschrift, DEP, Absatz, Druckzeit.
  const zeilen = inspectionInfoLines(await gelesen({}), { width: 42, printedAt: GEDRUCKT });
  assert.deepEqual(zeilen.slice(0, 5), ['KASSENINFO FÜR DIE PRÜFUNG', '', 'DEP          online gespeichert, jederzeit', '             exportierbar (USB-Stick,', '             Link)']);
});

test('Signatur: Testkarte schlaegt den Anbieter, unbekannter Anbieter ohne Einheit und Betrieb', async () => {
  const zeilen = async (signature: unknown) => inspectionInfoRows(await gelesen({ signature })).filter((z) => z.section === 'signature');
  const test1 = await zeilen({ provider: 'a_trust', serialHex: 'ab', testCard: true, status: 'active' });
  assert.deepEqual(test1.map((z) => [z.key, z.value]), [['unit', ['Testkarte']], ['certificate', ['Seriennr. ab (hex)']], ['status', ['in Betrieb']]]);
  const fremd = await zeilen({ provider: 'anderer', serialHex: 'ab', testCard: false, status: 'active' });
  assert.deepEqual(fremd.map((z) => z.key), ['certificate', 'status']);
  const atrust = await zeilen({ provider: 'a_trust', testCard: false });
  assert.deepEqual(atrust.map((z) => [z.key, z.value]), [['unit', ['Signaturkarte von A-Trust']], ['hosting', ['im Signier-Server von Kasseneck']]]);
  // holderChecked nur bei true, ein unlesbarer Zeitpunkt laesst nur seine Angabe weg.
  const geprueft = await zeilen({ holderChecked: false, validFrom: 'gestern', validTo: '2031-10-05T08:00:00.000Z', testCard: false, status: 'outage', outageSince: 'kaputt' });
  assert.deepEqual(geprueft.map((z) => [z.key, z.value]), [['valid', ['bis 05.10.2031']], ['status', ['ausgefallen']]]);
});

test('Abschluesse: Monatserster, anderer Tag, ohne Uhrzeit keine Zeile', async () => {
  const satz = async (closings: unknown) => inspectionInfoRows(await gelesen({ signature: null, closings })).find((z) => z.key === 'closings')?.value;
  assert.deepEqual(await satz({ monthlyDay: 1, monthlyTime: '00:05', annualIsDecember: true }),
    ['Monatsbeleg automatisch am Monatsersten um 00:05, der Dezember-Beleg ist der Jahresbeleg']);
  assert.deepEqual(await satz({ monthlyDay: 28, monthlyTime: '23:30', annualIsDecember: false }), ['Monatsbeleg automatisch am 28. jedes Monats um 23:30']);
  assert.equal(await satz({ monthlyDay: 1 }), undefined);
  assert.equal(await satz({ monthlyTime: '00:05' }), undefined);
  assert.equal(await satz({ monthlyDay: 0, monthlyTime: '00:05' }), undefined);
  assert.equal(await satz({ monthlyDay: 1.5, monthlyTime: '00:05' }), undefined);
});

test('inspectionInfoLines: Breite und Druckzeit werden vor dem Rechnen geprueft', async () => {
  const info = await gelesen(fall('echte Karte von A-Trust, Breite 42').info);
  for (const width of [23, 0, -1, 42.5, Number.NaN, '42' as unknown as number]) {
    assert.throws(() => inspectionInfoLines(info, { width, printedAt: GEDRUCKT }),
      (e: unknown) => isKasseneckValidationError(e) && e.scope === 'request' && e.functionName === 'inspectionInfoLines', String(width));
  }
  for (const printedAt of [new Date('kaputt'), '2026-10-29' as unknown as Date]) {
    assert.throws(() => inspectionInfoLines(info, { width: 42, printedAt }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'request');
  }
  // Datum und Uhrzeit bleiben auch auf dem schmalsten Bon zusammen.
  assert.deepEqual(inspectionInfoLines(info, { width: 24, printedAt: GEDRUCKT }).slice(-2), ['Gedruckt', '29.10.2026, 14:05']);
});

test('getRegisterInspectionInfo: ruft den Kassenweg-Namen, liest nur die Positivliste', async () => {
  const { rufen, namen } = antwortet({
    cashregisterId: 'KECK-1',
    product: { name: 'Kasseneck', cloudBased: true, intern: 'x' },
    manufacturer: { name: 'Post Now e.U.', vatId: 'ATU76279224' },
    signature: {
      provider: 'a_trust', serialHex: 'ab', serialDecimal: '171', testCard: false, status: 'active',
      // Was nie hinausgehen darf, liest das Paket auch nicht.
      der: 'MIIB', csn: '1234', pin: '123456', aesKey: 'k',
    },
    closings: { monthlyDay: 1, monthlyTime: '00:05', timeZone: 'Europe/Vienna', annualIsDecember: true },
    contactEmail: 'hello@kasseneck.at',
    apiKey: 'kr_live_x',
  });
  const info = await getRegisterInspectionInfo(rufen);
  assert.deepEqual(namen, ['getRegisterInspectionInfo']);
  assert.deepEqual(info, {
    cashregisterId: 'KECK-1',
    product: { name: 'Kasseneck', cloudBased: true },
    manufacturer: { name: 'Post Now e.U.', vatId: 'ATU76279224' },
    signature: { provider: 'a_trust', serialHex: 'ab', serialDecimal: '171', testCard: false, status: 'active' },
    closings: { monthlyDay: 1, monthlyTime: '00:05', timeZone: 'Europe/Vienna', annualIsDecember: true },
    contactEmail: 'hello@kasseneck.at',
  });
});

test('getRegisterInspectionInfo: falsche Typen fallen weg, unbekannter Stand fehlt, Antwort ohne Objekt ist ein Antwortfehler', async () => {
  const info = await gelesen({
    cashregisterId: 7,
    product: 'Kasseneck',
    manufacturer: { name: '', vatId: null },
    signature: { serialHex: 12, testCard: 'ja', status: 'recovering', holderChecked: 'true' },
    closings: { monthlyDay: '1', monthlyTime: 5, annualIsDecember: 1 },
    contactEmail: '',
  });
  assert.deepEqual(info, { manufacturer: {}, signature: { testCard: false }, closings: {} });
  assert.deepEqual(await gelesen({ signature: 'keine' }), { signature: null });
  for (const daten of [null, 'x', [], 3]) {
    await assert.rejects(() => gelesen(daten), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response', JSON.stringify(daten));
  }
});

test('Woerter des Reiters „Prüfung“ mit genau diesem Text', () => {
  const beschriftungen: Record<string, string> = {
    'nav.inspection': 'Prüfung',
    'inspection.part_inspector': 'Für den Prüfer',
    'inspection.part_zero_receipt': 'Nullbeleg',
    'inspection.part_dep': 'DEP',
    'inspection.title': 'Kasseninfo für die Prüfung',
    'inspection.print': 'Kasseninfo drucken',
    'inspection.print_yes': 'Drucken',
    'inspection.print_no': 'Nein',
    'zero_receipt.create': 'Nullbeleg erstellen',
    'zero_receipt.created': 'Nullbeleg {number} erstellt, {time}',
  };
  for (const [k, text] of Object.entries(beschriftungen)) assert.equal((LABELS as Record<string, { text: string }>)[k]?.text, text, k);
  assert.equal(labelText('zero_receipt.created', { number: 'KECK-1-17', time: '14:05' }), 'Nullbeleg KECK-1-17 erstellt, 14:05');
  assert.equal(messageText('inspection.print_question'), 'Kasseninfo für den Prüfer auch drucken?');
  assert.equal(MESSAGES['inspection.how_it_works_text'].text,
    'Erfasst wird in der Kassen-App oder in der Web-Kasse, gespeichert wird online. Jeder Beleg wird beim Erstellen signiert. Den Beleg gibt es gedruckt, per Mail oder als QR-Code.');
  // Ohne Rechtssprache an der Kasse (E2b-5): keine Frist, keine Behörde.
  assert.equal(messageText('dep.manager_only'), 'Den Export macht der Chef.');
  assert.equal(messageText('dep.offline'), 'Ohne Internet geht der Export nicht.');
  for (const k of Object.keys(MESSAGES).filter((k) => k.startsWith('dep.') || k.startsWith('inspection.'))) {
    assert.doesNotMatch(MESSAGES[k as keyof typeof MESSAGES].text, /Behörde|Werktag|§/, k);
  }
  // nav.dep bleibt fuer aeltere Kassen bestehen.
  assert.equal(LABELS['nav.dep'].text, 'Prüfung (DEP)');
});
