import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

/*
 * Die Kopie des Backend-Vertrags `/v3` (`fixtures/v3/`, geholt mit
 * `scripts/v3-vertrag-holen.mjs`) muss zu ihrem eigenen Fingerabdruck passen.
 * Die Regel steht im README des Exports (`functions/vertrag/v3/README.md`,
 * Abschnitt `_quelle`):
 *
 * - einfache Dateien: SHA-256 ueber `JSON.stringify(inhalt, null, 2) + "\n"`,
 *   `inhalt` = die Datei ohne `_hinweis` und `_quelle`;
 * - `antworten/kasse.json`, `stored/kasse.json`: je Schreiber (`default`,
 *   `kasse`) SHA-256 ueber `JSON.stringify({ head, endpoints }, null, 2) + "\n"`
 *   mit den in `_quelle.<teil>.head` genannten Kopfeintraegen und den
 *   Endpunkten mit `codebase: <teil>` in Dateireihenfolge.
 *
 * Eine von Hand angefasste oder halb kopierte Datei faellt hier auf.
 */

const ordner = fileURLToPath(new URL('../../fixtures/v3/', import.meta.url));

const ERWARTET = [
  'README.md',
  'antworten/belege.json',
  'antworten/belegmail.json',
  'antworten/kasse-belege.json',
  'antworten/kasse.json',
  'antworten/lager.json',
  'antworten/rechnungen.json',
  'antworten/storno.json',
  'stored/belege.json',
  'stored/kasse.json',
  'stored/rechnungen.json',
  'v3-vokabular.json',
  'zahlbetrag-faelle.json',
];

function alleDateien(): string[] {
  const liste: string[] = [];
  const gehe = (pfad: string) => {
    for (const name of readdirSync(pfad)) {
      const voll = join(pfad, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else liste.push(relative(ordner, voll).split('\\').join('/'));
    }
  };
  gehe(ordner);
  return liste.sort();
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const abdruck = (wert: unknown) => sha256(`${JSON.stringify(wert, null, 2)}\n`);

type Json = Record<string, unknown>;
const lies = (datei: string): Json => JSON.parse(readFileSync(join(ordner, datei), 'utf8')) as Json;

/** Prueft eine Datei gegen `_quelle`; liefert die Zahl der geprueften Teile. */
function pruefeFingerabdruck(datei: string, inhalt: Json): number {
  const quelle = inhalt['_quelle'] as Record<string, unknown> | undefined;
  assert.ok(quelle && typeof quelle === 'object', `${datei}: _quelle fehlt`);
  if (typeof quelle['sha256'] === 'string') {
    const { _hinweis: _h, _quelle: _q, ...rest } = inhalt;
    assert.equal(abdruck(rest), quelle['sha256'], `${datei}: Inhalt passt nicht zu _quelle.sha256`);
    return 1;
  }
  const endpunkte = inhalt['endpoints'] as Record<string, { codebase?: unknown }>;
  assert.ok(endpunkte && typeof endpunkte === 'object' && !Array.isArray(endpunkte), `${datei}: endpoints fehlt`);
  const teile = Object.entries(quelle) as [string, { sha256?: unknown; head?: unknown }][];
  assert.ok(teile.length > 0, `${datei}: _quelle nennt keinen Teil`);
  const koepfe = new Set<string>();
  for (const [teil, angabe] of teile) {
    assert.ok(Array.isArray(angabe.head), `${datei}: _quelle.${teil}.head fehlt`);
    const head: Json = {};
    for (const schluessel of angabe.head as string[]) {
      head[schluessel] = inhalt[schluessel];
      koepfe.add(schluessel);
    }
    const eigene: Json = {};
    for (const [name, eintrag] of Object.entries(endpunkte)) {
      if (eintrag.codebase === teil) eigene[name] = eintrag;
    }
    assert.equal(abdruck({ head, endpoints: eigene }), angabe.sha256, `${datei}: Teil ${teil} passt nicht zu _quelle`);
  }
  // Nichts darf am Fingerabdruck vorbei in der Datei stehen: jeder Endpunkt
  // gehoert einem Teil, jeder Kopfeintrag einem head.
  const bekannt = new Set(teile.map(([teil]) => teil));
  for (const [name, eintrag] of Object.entries(endpunkte)) {
    assert.ok(bekannt.has(String(eintrag.codebase)), `${datei}: Endpunkt ${name} gehoert keinem Teil`);
  }
  for (const schluessel of Object.keys(inhalt)) {
    if (['_hinweis', '_quelle', 'endpoints'].includes(schluessel)) continue;
    assert.ok(koepfe.has(schluessel), `${datei}: Kopfeintrag ${schluessel} steht in keinem head`);
  }
  return teile.length;
}

test('v3-Vertrag: fixtures/v3 fuehrt genau die Dateien des Backend-Exports', () => {
  assert.deepEqual(alleDateien(), ERWARTET, 'fixtures/v3 unvollstaendig: scripts/v3-vertrag-holen.mjs ausfuehren');
});

test('v3-Vertrag: jede JSON-Datei passt zu ihrem eigenen Fingerabdruck (_quelle)', () => {
  let teile = 0;
  for (const datei of ERWARTET.filter((name) => name.endsWith('.json'))) {
    teile += pruefeFingerabdruck(datei, lies(datei));
  }
  // 10 einfache Dateien (mit antworten/lager.json) + je zwei Teile in den beiden kasse.json
  assert.equal(teile, 14);
});

test('v3-Vertrag: ein veraendertes Byte faellt am Fingerabdruck auf (Rot-Probe im Test)', () => {
  const vokabular = lies('v3-vokabular.json');
  const verfaelscht = { ...vokabular, names: { ...(vokabular['names'] as Json), extra: 'x' } };
  assert.throws(() => pruefeFingerabdruck('v3-vokabular.json', verfaelscht), /passt nicht/);

  const kasse = lies('antworten/kasse.json');
  const endpunkte = kasse['endpoints'] as Record<string, Json>;
  const [erster] = Object.keys(endpunkte);
  const kasseVerfaelscht = { ...kasse, endpoints: { ...endpunkte, [erster!]: { ...endpunkte[erster!], extra: 1 } } };
  assert.throws(() => pruefeFingerabdruck('antworten/kasse.json', kasseVerfaelscht), /passt nicht/);

  const kasseKopf = { ...kasse, fremd: 1 };
  assert.throws(() => pruefeFingerabdruck('antworten/kasse.json', kasseKopf), /in keinem head/);
});
