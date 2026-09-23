import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as wurzel from '../src/index.js';
import * as receipt from '../src/receipt/index.js';
import * as printing from '../src/printing/index.js';
import * as payments from '../src/payments/index.js';
import * as register from '../src/register/index.js';
import * as partner from '../src/partner/index.js';
import * as rechnung from '../src/rechnung/index.js';
import * as rechnungRechnen from '../src/rechnung/rechnen.js';
import * as react from '../src/react/index.js';
import * as kasse from '../src/kasse/index.js';

/**
 * Das README ist die einzige Erklaerung, die ein Verbraucher vor 69
 * Wurzel-Exporten und sechs Unterpfaden bekommt. Ein README, das Namen nennt,
 * die es nicht mehr gibt, ist schlimmer als keines — deshalb pruefen diese
 * Tests seine mechanisch pruefbaren Aussagen gegen die Oberflaeche selbst.
 *
 * Was sie **nicht** koennen: den Inhalt beurteilen. Sie fangen das Verrotten,
 * nicht das Falschsein.
 */

const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
/** Die kurze deutsche Einstiegsseite; reist nicht im Tarball mit, wird aber genauso geprueft. */
const README_DE = readFileSync(new URL('../../README.de.md', import.meta.url), 'utf8');
const PAKET = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  name: string;
  files: string[];
  exports: Record<string, unknown>;
  engines: { node: string };
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  scripts: Record<string, string>;
};

/** Die Module hinter den Unterpfaden, so wie das README sie benennt. */
const MODULE: Record<string, Record<string, unknown>> = {
  '@kreiseck/kasseneck-api': wurzel,
  '@kreiseck/kasseneck-api/receipt': receipt,
  '@kreiseck/kasseneck-api/printing': printing,
  '@kreiseck/kasseneck-api/payments': payments,
  '@kreiseck/kasseneck-api/register': register,
  '@kreiseck/kasseneck-api/partner': partner,
  '@kreiseck/kasseneck-api/rechnung': rechnung,
  '@kreiseck/kasseneck-api/rechnung/rechnen': rechnungRechnen,
  '@kreiseck/kasseneck-api/react': react,
  '@kreiseck/kasseneck-api/kasse': kasse,
};

function pruefeImporte(text: string, datei: string, mindestens: number): void {
  const importe = [...text.matchAll(/import \{([^}]+)\} from '([^']+)'/g)];
  assert.ok(importe.length >= mindestens, `in ${datei} stehen keine Beispiel-Importe mehr`);
  for (const treffer of importe) {
    const modul = MODULE[treffer[2] ?? ''];
    assert.ok(modul, `${datei} importiert aus einem unbekannten Modul: ${treffer[2]}`);
    for (const roh of (treffer[1] ?? '').split(',')) {
      const name = roh.trim();
      if (!name) continue;
      assert.ok(name in modul, `${datei} nennt "${name}" aus ${treffer[2]} — den Export gibt es nicht`);
    }
  }
}

test('README: jeder importierte Name in den Beispielen gibt es wirklich', () => {
  pruefeImporte(README, 'README.md', 3);
});

test('README.de.md: jeder importierte Name im Beispiel gibt es wirklich', () => {
  pruefeImporte(README_DE, 'README.de.md', 2);
});

test('README und README.de.md verweisen aufeinander (absolute Adressen, npm zeigt relative schlecht an)', () => {
  assert.ok(
    README.includes('https://github.com/kreiseck-at/kasseneck-api/blob/main/README.de.md'),
    'README.md verlinkt die deutsche Seite nicht',
  );
  assert.ok(
    README_DE.includes('https://github.com/kreiseck-at/kasseneck-api/blob/main/README.md'),
    'README.de.md verlinkt das vollstaendige README nicht',
  );
});

test('README: kein Geviertstrich im Text', () => {
  for (const [datei, text] of [['README.md', README], ['README.de.md', README_DE]] as const) {
    const zeile = text.split('\n').findIndex((z) => z.includes('\u2014'));
    assert.equal(zeile, -1, `${datei} Zeile ${zeile + 1} enthaelt einen Geviertstrich`);
  }
});

test('README: das Glossar fuehrt die vereinbarten Begriffe (wortgleich mit dem Dart-Zwilling)', () => {
  const glossar = README.slice(README.indexOf('## Glossary'));
  assert.ok(README.includes('## Glossary'), 'README hat keinen Abschnitt Glossary');
  for (const [deutsch, englisch] of [
    ['Beleg', 'receipt'],
    ['Startbeleg', 'start receipt'],
    ['Nullbeleg', 'zero receipt'],
    ['Monatsbeleg', 'monthly receipt'],
    ['Jahresbeleg', 'annual receipt'],
    ['Schlussbeleg', 'final receipt'],
    ['Storno', 'cancellation'],
    ['Signaturerstellungseinheit', 'signature creation unit'],
    ['DEP (Datenerfassungsprotokoll)', 'data capture log (DEP)'],
    ['Kassennachschau', 'cash register audit'],
    ['Belegerteilungspflicht', 'obligation to issue receipts'],
    ['Registrierkasse', 'fiscal cash register'],
    ['Umsatzzähler', 'turnover counter'],
    ['Außerbetriebnahme', 'decommissioning'],
    ['Ausfall der Signatureinheit', 'signature unit failure'],
    ['Rechnung', 'invoice'],
    ['USt', 'VAT'],
  ]) {
    assert.ok(glossar.includes(`| ${deutsch} | ${englisch} |`), `Glossar: "${deutsch}" -> "${englisch}" fehlt`);
  }
});

test('README: die genannten Endpunkte und Waechter gibt es', () => {
  for (const name of [
    'listMyCashregisters',
    'listMyReceipts',
    'getFirstReceiptDate',
    'isKasseneckApiError',
    'parseServerTimeStamp',
  ]) {
    assert.ok(README.includes(name), `${name} sollte im README vorkommen`);
    assert.ok(name in wurzel, `README nennt ${name}, die Wurzel exportiert es nicht`);
  }
  // Die Fassade traegt die im Schnellstart benutzte Variante.
  assert.ok(README.includes('sellReceiptWithCompany'));
});

test('README: die Unterpfad-Tabelle nennt genau die deklarierten Unterpfade', () => {
  const deklariert = Object.keys(PAKET.exports)
    .filter((eintrag) => eintrag !== '.')
    .map((eintrag) => eintrag.slice(1)); // './receipt' -> '/receipt'
  for (const unterpfad of deklariert) {
    assert.ok(README.includes(`\`…${unterpfad}\``), `README beschreibt den Unterpfad ${unterpfad} nicht`);
  }
  // Und umgekehrt: kein erfundener Unterpfad in der Tabelle — ein- UND
  // zweiteilig (z. B. `/rechnung/rechnen`).
  for (const treffer of README.matchAll(/\| `…((?:\/[a-z]+)+)` \|/g)) {
    assert.ok(deklariert.includes(treffer[1] ?? ''), `README beschreibt einen Unterpfad, den es nicht gibt: ${treffer[1]}`);
  }
});

test('README: die genannten Befehle stehen in den scripts', () => {
  for (const treffer of README.matchAll(/^npm run ([a-z:]+)/gm)) {
    const name = treffer[1] ?? '';
    assert.ok(name in PAKET.scripts, `README nennt "npm run ${name}", das Skript gibt es nicht`);
  }
});

test('README: die Zusagen zu Abhaengigkeiten und Node-Version stimmen', () => {
  assert.equal(PAKET.dependencies, undefined, 'README sagt "keine Laufzeitabhaengigkeiten" zu');
  assert.ok(PAKET.peerDependencies?.['react'], 'README nennt React als optionale Peer-Abhaengigkeit');
  assert.ok(README.includes('20.18'), 'README nennt die Node-Untergrenze nicht');
  assert.ok(PAKET.engines.node.includes('20.18'), 'engines.node und README sind auseinander');
});

test('README liegt im Tarball', () => {
  // Ohne `files`-Eintrag steht das README zwar im Repo, aber nicht im Paket —
  // und npm zeigt dann eine leere Beschreibungsseite.
  assert.ok(
    PAKET.files.some((eintrag) => eintrag === 'README.md'),
    'README.md fehlt in files',
  );
});

test('README: der erste Absatz nennt die Suchbegriffe, unter denen das Paket gefunden werden soll', () => {
  const start = README.indexOf('**Kasseneck** is');
  assert.ok(start >= 0, 'der Einleitungsabsatz fehlt');
  const absatz = README.slice(start, README.indexOf('\n\n', start));
  for (const begriff of ['Austria', 'RKSV', 'fiscal cash register', 'Registrierkasse', 'receipt signing', 'TypeScript']) {
    assert.ok(absatz.includes(begriff), `der erste Absatz nennt "${begriff}" nicht`);
  }
});
