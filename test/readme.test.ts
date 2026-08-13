import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as wurzel from '../src/index.js';
import * as receipt from '../src/receipt/index.js';
import * as printing from '../src/printing/index.js';
import * as payments from '../src/payments/index.js';
import * as register from '../src/register/index.js';

/**
 * Das README ist die einzige Erklaerung, die ein Verbraucher vor 69
 * Wurzel-Exporten und fuenf Unterpfaden bekommt. Ein README, das Namen nennt,
 * die es nicht mehr gibt, ist schlimmer als keines — deshalb pruefen diese
 * Tests seine mechanisch pruefbaren Aussagen gegen die Oberflaeche selbst.
 *
 * Was sie **nicht** koennen: den Inhalt beurteilen. Sie fangen das Verrotten,
 * nicht das Falschsein.
 */

const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
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
};

test('README: jeder importierte Name in den Beispielen gibt es wirklich', () => {
  const importe = [...README.matchAll(/import \{([^}]+)\} from '([^']+)'/g)];
  assert.ok(importe.length >= 3, 'im README stehen keine Beispiel-Importe mehr');
  for (const treffer of importe) {
    const modul = MODULE[treffer[2] ?? ''];
    assert.ok(modul, `README importiert aus einem unbekannten Modul: ${treffer[2]}`);
    for (const roh of (treffer[1] ?? '').split(',')) {
      const name = roh.trim();
      if (!name) continue;
      assert.ok(name in modul, `README nennt "${name}" aus ${treffer[2]} — den Export gibt es nicht`);
    }
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
  // Und umgekehrt: kein erfundener Unterpfad in der Tabelle.
  for (const treffer of README.matchAll(/\| `…(\/[a-z]+)` \|/g)) {
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
