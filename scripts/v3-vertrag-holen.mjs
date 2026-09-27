// Holt den Vertrags-Export `/v3` aus dem Backend nach `fixtures/v3/`.
//
// Quelle der Wahrheit fuer die 1.x-Linie ist `functions/vertrag/v3/` im
// Backend-Repo: jede Datei dort entsteht aus den echten Handlern hinter dem
// echten Rand (siehe dortiges README). Dieses Paket rechnet und prueft gegen
// eine **byte-gleiche** Kopie; nichts davon wird hier gepflegt oder geglaettet.
// Ob die Kopie zu ihrem eigenen Fingerabdruck (`_quelle`) passt, prueft
// `test/v3-vertrag.test.ts`.
//
// Aufruf (bewusst, nie automatisch):
//   KASSENECK_BACKEND=../kasseneck node scripts/v3-vertrag-holen.mjs
// Ohne Angabe gilt `../kasseneck` (relativ zur Paketwurzel).
//
// Das Ziel wird vorher geleert: eine Datei, die das Backend nicht mehr
// exportiert, darf hier nicht als Vertrag liegen bleiben.
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(wurzel, process.env.KASSENECK_BACKEND ?? '../kasseneck');
const quelle = join(backend, 'functions', 'vertrag', 'v3');
const ziel = join(wurzel, 'fixtures', 'v3');

if (!existsSync(join(quelle, 'v3-vokabular.json'))) {
  console.error(`Kein Vertrags-Export unter ${quelle} (KASSENECK_BACKEND pruefen).`);
  process.exit(1);
}

rmSync(ziel, { recursive: true, force: true });
cpSync(quelle, ziel, { recursive: true });

/** Alle Dateien unter `verzeichnis`, relativ und sortiert. */
function dateien(verzeichnis) {
  const liste = [];
  const gehe = (pfad) => {
    for (const name of readdirSync(pfad).sort()) {
      const voll = join(pfad, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else liste.push(relative(ziel, voll));
    }
  };
  gehe(verzeichnis);
  return liste;
}

const kopiert = dateien(ziel);
console.log(`v3-Vertrag geholt aus ${quelle}: ${kopiert.length} Dateien`);
for (const datei of kopiert) console.log(`  ${datei}`);
