import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PACKAGE_VERSION } from '../src/version.js';

/*
 * Jede Vertragsdatei, die eine Paketversion nennt, nennt die aus package.json.
 * Die Dateien werden von `npm run fixtures:*` erzeugt; wer die Version hebt
 * und einen Erzeuger vergisst, liefert einen Vertrag mit fremder Version aus
 * (so trug fixtures/surface.json im Arbeitsstand `1.0.0-rc.1`, waehrend rc.4
 * veroeffentlicht war). Die Abnehmer (kasseneck-web scripts/vertrag.sh,
 * Dart-Zwilling) lesen die Version und vergleichen damit ihren Stand.
 */
const wurzel = new URL('../../', import.meta.url);
const paket = JSON.parse(readFileSync(new URL('package.json', wurzel), 'utf8')) as { version: string };
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/** Die Dateien, die eine Paketversion tragen muessen, mit dem Feld. */
const PFLICHT: Record<string, string> = {
  'surface.json': 'version',
  'pos-texts.json': 'version',
  'invoice-texts.json': 'version',
  'hobex-hps-codes.json': 'version',
  'invoice-api.schema.json': 'package',
};

test('Version: jede Vertragsdatei unter fixtures/ nennt die Version aus package.json', () => {
  const abweichend: string[] = [];
  const mitVersion = new Set<string>();
  for (const name of readdirSync(new URL('fixtures/', wurzel)).filter((n) => n.endsWith('.json'))) {
    const inhalt = JSON.parse(readFileSync(new URL(`fixtures/${name}`, wurzel), 'utf8')) as Record<string, unknown>;
    for (const feld of ['version', 'package']) {
      const wert = inhalt[feld];
      if (typeof wert !== 'string' || !SEMVER.test(wert)) continue;
      mitVersion.add(name);
      if (wert !== paket.version) abweichend.push(`${name} ${feld}: ${wert}`);
    }
  }
  assert.deepEqual(abweichend, [], `Version ${paket.version}: npm run fixtures:oberflaeche, fixtures:texte, fixtures:rechnungstexte, fixtures:hobex-hps-codes, fixtures:rechnung ausfuehren`);
  // Leer gegen leer waere gruen, ohne etwas zu pruefen.
  assert.deepEqual([...mitVersion].sort(), Object.keys(PFLICHT).sort());
  for (const [name, feld] of Object.entries(PFLICHT)) {
    const inhalt = JSON.parse(readFileSync(new URL(`fixtures/${name}`, wurzel), 'utf8')) as Record<string, unknown>;
    assert.equal(inhalt[feld], paket.version, `${name} ${feld}`);
  }
});

test('Version: PACKAGE_VERSION, package-lock.json und der CHANGELOG ziehen mit', () => {
  assert.equal(PACKAGE_VERSION, paket.version);
  const sperre = JSON.parse(readFileSync(new URL('package-lock.json', wurzel), 'utf8')) as { version: string; packages: Record<string, { version?: string }> };
  assert.equal(sperre.version, paket.version);
  assert.equal(sperre.packages['']?.version, paket.version);
  const changelog = readFileSync(new URL('CHANGELOG.md', wurzel), 'utf8');
  assert.ok(changelog.includes(paket.version), `CHANGELOG.md nennt ${paket.version} nicht`);
});
