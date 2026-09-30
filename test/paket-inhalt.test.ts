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
  'receipts': 'Golden-Eingaben: Dart (Pruefsumme, Storno-Probe); kasseneck-web apps/admin/src/features/labor/fixtures.ts + druck.test.ts, apps/app/src/components/beleg-detail.test.tsx, apps/app/src/lib/beleg-kopf.test.ts, apps/kasse/src/test/golden-belege.test.tsx',
  'expected': 'Golden-Ausgaben (Zeilen, Raster, Blatt): Dart-Zwilling; kasseneck-web apps/admin/src/features/labor/druck.test.ts + labor-core.test.ts, apps/app/src/components/beleg-render.test.tsx, apps/app/src/lib/beleg-kopf.test.ts',
  'manifest.json': 'Pruefsummen der Goldens: Dart-Zwilling; kasseneck-web apps/admin/src/features/labor/fixtures.ts, apps/kasse/src/test/golden-belege.test.tsx',
  'code-table-preview.json': 'Vorschau je Code-Tabelle (codeTablePreviewText): Dart-Zwilling kasseneck_api (Zeichensatz-Test)',
  'code-table-receipts.json': 'Bons je Code-Tabelle (Faelle; Bytes unter expected/code-table-receipt.*.hex): Dart-Zwilling kasseneck_api (Zeichensatz-Test)',
  'code-tables.json': 'Katalog der Code-Tabellen (ESC t, Bytes je Zeichen): Dart-Zwilling kasseneck_api (Zeichensatz-Test)',
  'hobex-hps-codes.json': 'Terminal-Codes: Dart-Zwilling (hobex_hps_codes_vertrag_test)',
  'pos-message-cases.json': 'Fehlereinordnung der Kasse: Kassen-App (kasseneck-apps tool/vertrag.sh); kasseneck-web apps/kasse/src/test/meldung-faelle.test.ts',
  'pos-settings-defaults.json': 'Standardwerte der Kasseneinstellungen: Dart-Zwilling; Kassen-App (kasseneck-apps tool/vertrag.sh)',
  'pos-texts.json': 'Textkatalog der Kasse: Kassen-App (kasseneck-apps tool/vertrag.sh; apps/kasse/tool/texte_erzeugen.dart erzeugt daraus die Konstanten)',
  'surface.json': 'Aufrufe, Wege und Enums: Dart-Zwilling (zwillinge.yaml); kasseneck-web scripts/vertrag.sh + scripts/check-rewrites.mjs (Routen je Aufruf)',
  'item-from-euro.json': 'Prueffaelle itemFromEuro: Dart-Zwilling, Panel',
  'invoice-api-examples': 'Rechnungs-API-Beispiele: Dart-Zwilling',
  'invoice-api.schema.json': 'Anfrage-Schema der Rechnungs-API: Dart-Zwilling',
  'invoice-calc.json': 'Prueffaelle Rechenkern (Hand): Server, Dart, Panel',
  'invoice-calc-random.json': 'Prueffaelle Rechenkern (Python-Referenz): Server, Dart, Panel',
  'invoice-totals.json': 'Prueffaelle Rechnungssummen: Dart-Zwilling; kasseneck-web apps/app/src/lib/invoice-summen.test.ts',
  'invoice-texts.json': 'Textkatalog der Rechnung: Dart (das Backend liest noch die 0.x-Datei)',
  'stored': 'gespeicherte (innere) Form der Kasseneinstellungen: Dart 10 (4c zieht fixtures/stored/)',
  'renames-1.0.json': 'Umstiegstabelle 0.x -> 1.0 (Pfade, Textschluessel, Platzhalter, Strukturschluessel): Dart 10, Web-Kasse',
  'v3': 'Vertrags-Export /v3 des Backends: Dart 10 prueft Modelle und Zahlbetrag daran',
  'receipt-due-generated.json': '1206 vom Backend-Code gerechnete Zahlbetrag-Faelle: Dart 10 receiptDueCents (gleiche Gleitkomma-Reihenfolge wie npm, 20 Exportfaelle reichen dafuer nicht)',
  'receipt-due-errors.json': 'nicht rechenbare Zahlbetrag-Eingaben (ReceiptDueError, code receipt_due_unavailable, reason je Fall): Dart-Zwilling receiptDueCents; kasseneck-web apps/kasse (Absage vor dem Terminal)',
};

test('Paket: jeder Eintrag unter fixtures/ hat einen Abnehmer ausserhalb des Pakets', () => {
  assert.deepEqual(readdirSync(join(wurzel, 'fixtures')).sort(), Object.keys(ABNEHMER).sort(),
    'neuer oder entfernter Eintrag unter fixtures/: Abnehmer nennen oder nach test/fixtures/ legen');
});
