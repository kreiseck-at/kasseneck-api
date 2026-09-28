import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Was im Tarball landet — und vor allem, was nicht.
 *
 * Anlass: im Flutter-Zwilling reiste eine gitignorierte Datei mit echten
 * Zugangsdaten in einer Veroeffentlichung mit, weil die Ignorierliste fuers
 * Veroeffentlichen eine andere ist als die fuer git. Dieses Paket hat die
 * Schwaeche nicht — es fuehrt in `package.json` eine **Positivliste**
 * (`files`), keine Ignorierliste. Genau das halten diese Tests fest: die
 * Positivliste bleibt eine, und der einzige Eintrag, der ein ganzes
 * Verzeichnis unbesehen mitnimmt (`fixtures`), traegt nichts Oertliches.
 */

const wurzel = fileURLToPath(new URL('../../', import.meta.url));
const PAKET = JSON.parse(readFileSync(join(wurzel, 'package.json'), 'utf8')) as {
  files: string[];
};

/** Namen, die nie in ein veroeffentlichtes Paket gehoeren. */
const VERDAECHTIG = /(^|[.\-/])(env|local|secret|secrets|credentials|private)([.\-]|$)|\.(key|pem|p12|pfx|tgz)$/i;

test('Paket: die Dateiliste ist eine Positivliste, keine Ignorierliste', () => {
  assert.ok(Array.isArray(PAKET.files) && PAKET.files.length > 0, 'files fehlt');
  assert.deepEqual(
    [...PAKET.files].sort(),
    ['CHANGELOG.md', 'NOTICE', 'README.md', 'dist', 'fixtures'],
    'die Positivliste hat sich geaendert — jeder neue Eintrag nimmt ein ganzes Verzeichnis unbesehen mit',
  );
  assert.equal(
    existsSync(join(wurzel, '.npmignore')),
    false,
    'eine .npmignore neben der Positivliste ist eine zweite, leiser wirkende Wahrheit',
  );
});

test('Paket: im mitgelieferten fixtures/ liegt nichts Oertliches', () => {
  const gefunden: string[] = [];
  const gehe = (pfad: string, rel: string): void => {
    for (const eintrag of readdirSync(pfad)) {
      const voll = join(pfad, eintrag);
      const name = rel ? `${rel}/${eintrag}` : eintrag;
      if (statSync(voll).isDirectory()) gehe(voll, name);
      else if (VERDAECHTIG.test(eintrag)) gefunden.push(name);
    }
  };
  gehe(join(wurzel, 'fixtures'), '');
  assert.deepEqual(gefunden, [], `oertliche Datei in fixtures/: ${gefunden.join(', ')}`);
});

/**
 * Jeder Eintrag unter `fixtures/` reist im Tarball mit (`files: fixtures`)
 * und hat darum einen Abnehmer ausserhalb dieses Pakets. Der Dart-Zwilling
 * zieht das ganze Verzeichnis aus dem Tarball und vergleicht es byteweise
 * (kasseneck_api `tool/zwillinge.sh pruefen`). Wer hier etwas ablegt, das nur
 * die eigenen Tests brauchen, legt es unter `test/fixtures/` ab.
 */
const ABNEHMER: Record<string, string> = {
  'belege': 'Golden-Eingaben: Dart (Pruefsumme, Storno-Probe), keck, Web',
  'erwartet': 'Golden-Ausgaben (Zeilen, Raster, Blatt): Dart-Zwilling, keck, Web',
  'manifest.json': 'Pruefsummen der Goldens: Dart-Zwilling',
  'hobex-hps-codes.json': 'Terminal-Codes: Dart-Zwilling (hobex_hps_codes_vertrag_test)',
  'kasse-meldungen-faelle.json': 'Fehlereinordnung der Kasse: Kassen-App (Dart)',
  'kasse-settings-standard.json': 'Standardwerte der Kasseneinstellungen: Dart-Zwilling',
  'kasse-texte.json': 'Textkatalog der Kasse: Kassen-App (Dart) erzeugt daraus ihre Konstanten',
  'oberflaeche.json': 'Aufrufe, Wege und Enums: Dart-Zwilling (zwillinge.yaml)',
  'position-aus-euro.json': 'Prueffaelle positionFromEuro: Dart-Zwilling, Panel',
  'rechnung-api-beispiele': 'Rechnungs-API-Beispiele: Dart-Zwilling',
  'rechnung-api.schema.json': 'Anfrage-Schema der Rechnungs-API: Dart-Zwilling',
  'rechnung-rechnen.json': 'Prueffaelle Rechenkern (Hand): Server, Dart, Panel',
  'rechnung-rechnen-zufall.json': 'Prueffaelle Rechenkern (Python-Referenz): Server, Dart, Panel',
  'rechnung-summen.json': 'Prueffaelle Rechnungssummen: Dart-Zwilling',
  'rechnung-texte.json': 'Textkatalog der Rechnung: Backend (0.x-Linie), Dart',
  'stored': 'gespeicherte (innere) Form der Kasseneinstellungen: Dart 10 (4c zieht fixtures/stored/)',
  'texte-umbenennung.json': 'Umstiegstabelle 0.x -> 1.0 der Texte und Strukturschluessel: Dart 10, Web-Kasse',
  'v3': 'Vertrags-Export /v3 des Backends: Dart 10 prueft Modelle und Zahlbetrag daran',
  'v3-zahlbetrag-generiert.json': '1206 vom Backend-Code gerechnete Zahlbetrag-Faelle: Dart 10 receiptDueCents (gleiche Gleitkomma-Reihenfolge wie npm, 20 Exportfaelle reichen dafuer nicht)',
};

test('Paket: jeder Eintrag unter fixtures/ hat einen Abnehmer ausserhalb des Pakets', () => {
  assert.deepEqual(readdirSync(join(wurzel, 'fixtures')).sort(), Object.keys(ABNEHMER).sort(),
    'neuer oder entfernter Eintrag unter fixtures/: Abnehmer nennen oder nach test/fixtures/ legen');
});
