#!/usr/bin/env node
/**
 * Prueft das **veroeffentlichte** Paket aus Verbrauchersicht: baut den Tarball
 * (`npm pack`), installiert ihn in zwei frische Wegwerf-Projekte — eines
 * CommonJS, eines ESM — und laesst `tsc` ueber einen Verbraucher laufen, der
 * jeden Unterpfad importiert.
 *
 * Warum das eine eigene Pruefung braucht: Der Doppelbau ESM+CJS scheitert
 * nicht an der Laufzeit, sondern an der **Typaufloesung**. Zeigt die
 * `types`-Bedingung eines Unterpfads auf die ESM-Deklarationen, haelt
 * TypeScript sie wegen `"type": "module"` in der Wurzel-package.json fuer
 * ESM — ein CJS-Verbraucher mit `module: Node16` bekommt dann an jedem Import
 * TS1479, waehrend `require` zur Laufzeit tadellos laeuft. Weder der Bau noch
 * die Testsuite dieses Repos sehen das: beide laufen gegen die Quellen.
 *
 * Bewusst **nicht** Teil von `npm run build`: die Pruefung packt, installiert
 * und uebersetzt zweimal und braucht dafuer ein Vielfaches der Bauzeit. Der
 * schnelle, statische Teil (zeigt `require` in den CJS-Bau, `import` in den
 * ESM-Bau, und liegen die Dateien?) steht in check-build-exports.mjs und
 * laeuft bei jedem Bau mit.
 *
 * Aufruf: `npm run check:consumer`; das Skript baut vorher selbst, damit der
 * Tarball nicht aus einem alten `dist/` entsteht.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const wurzel = process.cwd();
const arbeit = mkdtempSync(join(tmpdir(), 'kasseneck-api-verbraucher-'));

/** Der Verbraucher fasst jeden Unterpfad an — ein Import allein beweist wenig. */
const VERBRAUCHER = `import { createKasseneckApi, apiKeyAuth, VatRate, KeckPaymentMethod } from '@kreiseck/kasseneck-api';
import { buildReceiptLayout, formatCents } from '@kreiseck/kasseneck-api/receipt';
import { createEscPosDocument, escPosText } from '@kreiseck/kasseneck-api/printing';
import type { HobexPayOptions } from '@kreiseck/kasseneck-api/payments';
import { ReceiptLayoutView } from '@kreiseck/kasseneck-api/react';

export const api = createKasseneckApi({
  auth: apiKeyAuth({ apiKey: 'kr_test_x', cashregisterToken: 'cb_test_y' }),
});
export const satz: number = VatRate.vat20.rate;
export const zahlungsart: string = KeckPaymentMethod.cash.value;
export const text: string = formatCents(1234);
export const layout = buildReceiptLayout;
export const doc = createEscPosDocument;
export const schreiben = escPosText;
export type Zahlung = HobexPayOptions;
export const ansicht = ReceiptLayoutView;
`;

function lauf(befehl, argumente, verzeichnis) {
  return execFileSync(befehl, argumente, { cwd: verzeichnis, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tarballBauen() {
  lauf('npm', ['run', 'build'], wurzel);
  lauf('npm', ['pack', '--pack-destination', arbeit], wurzel);
  const datei = readdirSync(arbeit).find((name) => name.endsWith('.tgz'));
  if (!datei) {
    throw new Error('npm pack hat keinen Tarball erzeugt');
  }
  return resolve(arbeit, datei);
}

/**
 * Legt ein Wegwerf-Projekt an und uebersetzt den Verbraucher darin.
 * `modul` entscheidet ueber die Modulart des Verbrauchers: 'commonjs' laesst
 * die `type`-Angabe weg (Node-Vorgabe), 'module' setzt sie.
 */
function verbraucherPruefen(name, modul, tarball) {
  const verzeichnis = join(arbeit, name);
  mkdirSync(join(verzeichnis, 'src'), { recursive: true });
  writeFileSync(
    join(verzeichnis, 'package.json'),
    JSON.stringify({ name: `verbraucher-${name}`, version: '1.0.0', private: true, ...(modul === 'module' ? { type: 'module' } : {}) }, null, 2),
  );
  writeFileSync(
    join(verzeichnis, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          // Node16 ist die Einstellung, unter der TypeScript die
          // exports-Bedingungen ueberhaupt erst auswertet.
          module: 'Node16',
          moduleResolution: 'Node16',
          target: 'ES2022',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          jsx: 'react-jsx',
          types: [],
        },
        include: ['src'],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(verzeichnis, 'src', 'index.ts'), VERBRAUCHER);

  lauf('npm', ['install', '--no-audit', '--no-fund', '--silent', tarball, `typescript@${typescriptVersion()}`, '@types/react', 'react'], verzeichnis);
  try {
    lauf(join(verzeichnis, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], verzeichnis);
  } catch (fehler) {
    const ausgabe = `${fehler.stdout ?? ''}${fehler.stderr ?? ''}`.trim();
    return { name, modul, ok: false, ausgabe };
  }
  return { name, modul, ok: true, ausgabe: '' };
}

/**
 * Dieselbe TypeScript-Spanne wie im Repo — unveraendert, nicht auf die
 * Untergrenze zurechtgeschnitten: `^5.4.0` gaebe als `5.4.0` einen
 * ETARGET-Fehler, die Reihe faengt bei 5.4.2 an.
 */
function typescriptVersion() {
  const paket = JSON.parse(lauf('node', ['-p', 'JSON.stringify(require("./package.json"))'], wurzel));
  return paket.devDependencies?.typescript ?? 'latest';
}

let fehlgeschlagen = false;
try {
  const tarball = tarballBauen();
  for (const ergebnis of [verbraucherPruefen('cjs', 'commonjs', tarball), verbraucherPruefen('esm', 'module', tarball)]) {
    if (ergebnis.ok) {
      process.stdout.write(`Verbraucher ${ergebnis.name} (${ergebnis.modul}, module: Node16): tsc gruen\n`);
    } else {
      fehlgeschlagen = true;
      process.stderr.write(`Verbraucher ${ergebnis.name} (${ergebnis.modul}, module: Node16) uebersetzt NICHT:\n${ergebnis.ausgabe}\n`);
    }
  }
} finally {
  rmSync(arbeit, { recursive: true, force: true });
}

process.exit(fehlgeschlagen ? 1 : 0);
