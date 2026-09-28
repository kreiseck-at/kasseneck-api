import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deutschIn } from './deutsch.js';
import { CANCELLATION_REASONS } from '../src/models/index.js';

/**
 * Die Fixtures von 1.0 sprechen `/v3`: kein deutsches Wort in den
 * Draht-Fixtures, die innere (gespeicherte) Form nur unter `stored/`.
 *
 * Jede Datei unter `fixtures/` gehoert genau einer Klasse an:
 *   - innen:       liegt in einem Verzeichnis `stored/` (Firestore-Form, deutsch);
 *   - ausgenommen: steht in AUSGENOMMEN, mit Grund;
 *   - Draht:       alles andere. Das ist die Vorgabe: eine neue Datei faellt
 *                  unter den Waechter, bis jemand begruendet, warum nicht.
 *
 * Geprueft werden in Draht-Dateien jeder Schluessel und jeder
 * maschinenlesbare Wert (klein geschrieben, ohne Leerzeichen, etwa
 * `input_error` oder `creditCard`). Menschentext, freie Eingaben, Kennungen
 * und Daten fremder Terminals sind als Wert ausgenommen, nie als Schluessel
 * (AUSNAHMEN_WERT). Die Sperrliste ist die der Exportnamen
 * (`test/deutsch.ts`) plus die Katalogwerte der inneren Form, die es unter
 * `/v1` gab (DEUTSCH_WERTE).
 */

const wurzel = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = join(wurzel, 'fixtures');
type Json = unknown;

/** Datei (relativ zu fixtures/, `**` = alles darunter) -> Grund. */
const AUSGENOMMEN: Record<string, string> = {
  'v3/**': 'Vertrags-Export des Backends, byte-gleich uebernommen (test/v3-vertrag.test.ts: _quelle). Bewacht an der Quelle: functions-kasse/test/unit/fixtures/v3-waechter.js ueber jede Antwort; v3-vokabular.json fuehrt die deutschen Namen der inneren Form als Uebersetzungstabelle',
  'manifest.json': 'Pruefsummen der Golden-Belege: die Schluessel sind die Dateinamen unter fixtures/belege und fixtures/erwartet (Namen der Prueffaelle, kein Draht); ruleset ist englisch (eigener Test unten)',
  'texte-umbenennung.json': 'Umstiegstabelle von 0.x auf 1.0: die alten, deutschen Schluessel sind ihr Inhalt',
  'hobex-hps-codes.json': 'Messdaten des Hobex-Terminals (Codes, TECS-Titel, Messprotokoll); Pruefgeruest fuer den Zwilling, kein Kasseneck-Draht',
  'position-aus-euro.json': 'Prueffaelle des Rechenkerns (Beschreibung, Faelle, Erwartung); Pruefgeruest, kein Draht',
  'rechnung-rechnen.json': 'Prueffaelle des Rechenkerns (von Hand); Pruefgeruest, kein Draht',
  'rechnung-rechnen-zufall.json': 'Prueffaelle des Rechenkerns (scripts/rechnung-referenz.py); Pruefgeruest, kein Draht',
  'rechnung-summen.json': 'Prueffaelle der Rechnungssummen; Pruefgeruest, kein Draht',
};

/**
 * Werte unter diesen Schluesseln werden nicht geprueft (der Schluessel selbst
 * schon). Muster gilt fuer den Schluessel des Werts; ein Wert in einer Liste
 * gehoert zum Schluessel der Liste.
 */
const AUSNAHMEN_WERT: Array<{ schluessel: RegExp; datei?: string; grund: string }> = [
  { schluessel: /^(public|pos)$/, datei: 'oberflaeche.json', grund: 'Namen der Backend-Functions (URL-Pfad) unter /v3 und /api/v3, wie das Backend sie fuehrt (v3-vokabular.json endpoints; getKasseSettings, setMyKasseLogo ...)' },
  { schluessel: /^reason$/, datei: 'rechnung-api-beispiele/credit-fehler-grund.json', grund: 'absichtlich ungueltiger Grund ("storno"): das Beispiel zeigt, dass der Server ihn mit validation abweist' },
  { schluessel: /^(text|message|serverMessage|name|description|title)$/, grund: 'Menschentext (Meldung, Beschreibung, gedruckter Text); maschinenlesbar ist code/kind' },
  { schluessel: /^placeholders$/, grund: 'Platzhalter im deutschen Menschentext ({betrag}); die Texte bleiben byte-gleich' },
  { schluessel: /^(companyName|street|city|zip|phone|footer[1-4]|thanksMessage|legalMessage|customerDetails|unit)$/, grund: 'freie Eingabe des Betriebs' },
  { schluessel: /^(qr|sig|data|signaturePreviousReceipt|turnoverCounterAES256ICM|certificateSerialNumber)$/, grund: 'RKSV-Belegdaten (BMF-Format, Pruefwerte)' },
  { schluessel: /^(id|uid)$|Id$|ID$|Key$|^fullReceiptId$/, grund: 'Kennung (vom Anleger gewaehlt oder erzeugt), kein Wort' },
  { schluessel: /^(providerData|cardPaymentData)$/, grund: 'Rohdaten des Terminals bzw. Anbieters, wie sie von dort kommen' },
];

/** Katalogwerte und Schluesselteile der inneren Form (0.x, /v1), die am Draht nicht mehr vorkommen duerfen. */
const DEUTSCH_WERTE = new Set(`
aktiv an art aus auswahl bar beides betrag betrieb bild breite druck drucker eigen einheit ersatz extern fehleingabe fragen
geraet gesamt immer kasse kassen keiner keins klartext kunde_storniert links mitte nacht netz nie oben papier pruefangaben
rechts regelwerk seite sonst sonstiges stil storniert taxnr testkasse testsignatur unerwartet verhalten vollbild zeitablauf
doppelt erfasst falsche zahlart eigener_text schluessel storno grund
`.split(/\s+/).filter(Boolean));

function deutsch(text: string): string | null {
  // Ganze Werte wie `kunde_storniert` stehen als Ganzes in der Liste.
  if (DEUTSCH_WERTE.has(text)) return `Wort "${text}"`;
  return deutschIn(text, DEUTSCH_WERTE);
}

const MASCHINENWERT = /^[a-z][a-z0-9]*(?:[_.-][a-z0-9]+)*$|^[a-z]+(?:[A-Z][a-z0-9]*)+$/;

const benutzteAusnahmen = new Set<object>();

/** Fundstellen in einem Dokument (Pfad: Schluessel). */
export function deutscheStellen(wert: Json, datei = '', pfad = '', werteFrei = false): string[] {
  const aus: string[] = [];
  if (Array.isArray(wert)) {
    wert.forEach((w) => aus.push(...deutscheStellen(w, datei, `${pfad}[]`, werteFrei)));
    return aus;
  }
  if (wert !== null && typeof wert === 'object') {
    for (const [k, v] of Object.entries(wert)) {
      const hier = pfad ? `${pfad}.${k}` : k;
      // `_hinweis`/`_quelle`: Kopf der erzeugten Dateien, wie im Backend-Export.
      if (k.startsWith('_') && pfad === '') continue;
      if (k === '$schema') continue;
      const grund = deutsch(k);
      if (grund) aus.push(`${hier} (Schluessel: ${grund})`);
      const ausnahme = AUSNAHMEN_WERT.find((a) => a.schluessel.test(k) && (a.datei === undefined || a.datei === datei));
      if (ausnahme) benutzteAusnahmen.add(ausnahme);
      // Darunter bleiben die Schluessel geprueft, nur die Werte sind frei.
      aus.push(...deutscheStellen(v, datei, hier, werteFrei || ausnahme !== undefined));
    }
    return aus;
  }
  if (!werteFrei && typeof wert === 'string' && MASCHINENWERT.test(wert)) {
    const grund = deutsch(wert);
    if (grund) aus.push(`${pfad || '(Wurzel)'} = "${wert}" (${grund})`);
  }
  return aus;
}

function alleDateien(): string[] {
  const aus: string[] = [];
  const gehe = (pfad: string): void => {
    for (const name of readdirSync(pfad).sort()) {
      const voll = join(pfad, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else aus.push(relative(fixtures, voll).split('\\').join('/'));
    }
  };
  gehe(fixtures);
  return aus;
}

function ausnahmeFuer(datei: string): string | null {
  for (const [muster, grund] of Object.entries(AUSGENOMMEN)) {
    if (muster.endsWith('/**') ? datei.startsWith(muster.slice(0, -2)) : datei === muster) return grund;
  }
  return null;
}
const istInnen = (datei: string): boolean => datei.split('/').slice(0, -1).includes('stored');

const DRAHT = alleDateien().filter((d) => !istInnen(d) && ausnahmeFuer(d) === null);
const lies = (datei: string): Json => JSON.parse(readFileSync(join(fixtures, datei), 'utf8'));

test('Fixtures: jede Datei ist Draht, innen (unter stored/) oder begruendet ausgenommen', () => {
  // Ausnahmen, die auf keine Datei mehr passen, sind tot.
  for (const muster of Object.keys(AUSGENOMMEN)) {
    assert.ok(alleDateien().some((d) => ausnahmeFuer(d) === AUSGENOMMEN[muster]), `tote Ausnahme: ${muster}`);
  }
  // Draht ist JSON (die Klartext-Raster unter erwartet/ sind gedruckte Ausgabe, kein Draht).
  const nichtJson = DRAHT.filter((d) => !d.endsWith('.json') && !/^erwartet\/.*\.(txt)$/.test(d));
  assert.deepEqual(nichtJson, [], 'unbekannte Dateiart unter fixtures/');
  assert.ok(DRAHT.length > 200, `zu wenige Draht-Dateien gefunden: ${DRAHT.length}`);
});

test('Fixtures: kein deutsches Wort in den Draht-Fixtures (Schluessel und Maschinenwerte)', () => {
  const treffer: string[] = [];
  for (const datei of DRAHT.filter((d) => d.endsWith('.json'))) {
    for (const t of deutscheStellen(lies(datei), datei)) treffer.push(`${datei}: ${t}`);
  }
  assert.deepEqual(treffer, []);
  // Keine tote Ausnahme: jede greift in mindestens einer Draht-Datei.
  assert.deepEqual(AUSNAHMEN_WERT.filter((a) => !benutzteAusnahmen.has(a)).map((a) => String(a.schluessel)), []);
});

test('Fixtures: der Waechter erkennt die alten Namen (Rot-Probe)', () => {
  assert.notDeepEqual(deutscheStellen({ receipt: { cancellationReason: 'fehleingabe' } }), []);
  assert.notDeepEqual(deutscheStellen({ receipt: { cancellationReason: 'kunde_storniert' } }), []);
  assert.notDeepEqual(deutscheStellen({ company: { taxnr: '' } }), []);
  assert.notDeepEqual(deutscheStellen({ options: { testKasse: true } }), []);
  assert.notDeepEqual(deutscheStellen({ options: { pruefangaben: null } }), []);
  assert.notDeepEqual(deutscheStellen({ meldungen: {} }), []);
  assert.notDeepEqual(deutscheStellen({ errorRules: [{ kind: 'klartext' }] }), []);
  assert.notDeepEqual(deutscheStellen({ errorRules: [{ art: 'api' }] }), []);
  assert.notDeepEqual(deutscheStellen({ x: { platzhalter: ['status'] } }), []);
  assert.notDeepEqual(deutscheStellen({ enums: { layout: ['vollbild'] } }), []);
  // Ausnahmen gelten fuer Werte, nie fuer Schluessel.
  assert.notDeepEqual(deutscheStellen({ text: { beleg: 1 } }), []);
  // Dateigebundene Ausnahmen gelten nur in ihrer Datei.
  assert.notDeepEqual(deutscheStellen({ reason: 'storno' }, 'rechnung-api-beispiele/credit-ok.json'), []);
  assert.deepEqual(deutscheStellen({ reason: 'storno' }, 'rechnung-api-beispiele/credit-fehler-grund.json'), []);
  // Menschentext und Englisch bleiben still.
  assert.deepEqual(deutscheStellen({ text: 'Keine Verbindung', placeholders: ['betrag'], receipt: { cancellationReason: 'input_error', items: [{ name: 'Semmel' }] } }), []);
});

test('Fixtures: Golden-Belege sind englisch und werden ohne Lader gelesen', () => {
  const namen = readdirSync(join(fixtures, 'belege')).filter((f) => f.endsWith('.json'));
  const gruende = new Set<string>(Object.keys(CANCELLATION_REASONS));
  for (const name of namen) {
    const f = lies(`belege/${name}`) as { company: Record<string, unknown>; receipt: Record<string, unknown>; options?: Record<string, unknown> };
    assert.ok(!('uid' in f.company) && !('taxnr' in f.company), `${name}: Firma mit uid/taxnr`);
    const grund = f.receipt['cancellationReason'];
    if (grund !== undefined) assert.ok(gruende.has(String(grund)), `${name}: Storno-Grund ${String(grund)}`);
  }
  assert.equal(existsSync(join(wurzel, 'test', 'belege-fixture.ts')), false, 'der Lader 0.x -> 1.0 gehoert entfernt');
  assert.doesNotMatch(readFileSync(join(wurzel, 'scripts', 'belege-fixtures.mjs'), 'utf8'), /taxnr|fehleingabe|testKasse/);
});

test('Fixtures: das Manifest nennt das Regelwerk englisch (ruleset)', () => {
  const manifest = lies('manifest.json') as Record<string, unknown>;
  assert.deepEqual(Object.keys(manifest), ['ruleset', 'belege', 'logoProbe']);
  assert.equal(typeof manifest['ruleset'], 'number');
});

test('Fixtures: fixtures/v3 ist byte-gleich mit dem Export des Backends (KASSENECK_BACKEND)', (t) => {
  const backend = process.env['KASSENECK_BACKEND'];
  if (!backend) {
    t.skip('KASSENECK_BACKEND fehlt; der Fingerabdruck (_quelle) prueft test/v3-vertrag.test.ts');
    return;
  }
  const quelle = join(backend, 'functions', 'vertrag', 'v3');
  const hier = alleDateien().filter((d) => d.startsWith('v3/')).map((d) => d.slice(3));
  const dort: string[] = [];
  const gehe = (pfad: string): void => {
    for (const name of readdirSync(pfad).sort()) {
      const voll = join(pfad, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else dort.push(relative(quelle, voll).split('\\').join('/'));
    }
  };
  gehe(quelle);
  assert.deepEqual(hier, dort);
  for (const d of hier) assert.ok(readFileSync(join(fixtures, 'v3', d)).equals(readFileSync(join(quelle, d))), `fixtures/v3/${d} weicht vom Backend ab`);
});
