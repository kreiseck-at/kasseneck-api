// Quelltext-Waechter fuer die Zwillinge in src/stored: der SHA-256 jeder
// nachgebauten Backend-Stelle und jeder Datei des Zwillings, festgehalten in
// test/fixtures/stored-zwillinge.json.
//
// test/stored-zwillinge.test.ts prueft zweierlei:
//   - immer: die Dateien in src/stored haben den festgehaltenen Stand. Wer den
//     Zwilling aendert, muss ihn gegen das Backend neu belegen.
//   - mit KASSENECK_BACKEND: die Backend-Stellen haben den festgehaltenen
//     Stand. Aendert sich eine, ist der Zwilling zu pruefen.
//
// Neu festhalten, erst NACHDEM der Backend-Vergleich gruen ist:
//   KASSENECK_BACKEND=../kasseneck npm test            (stored-backend.test.ts laeuft)
//   KASSENECK_BACKEND=../kasseneck node scripts/stored-zwillinge.mjs
// KASSENECK_BACKEND ist ein Backend-Checkout (Repo kasseneck) auf dem Stand
// von origin/main, in functions und functions-kasse mit `npm ci`.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Die nachgebauten Stellen: Datei im Backend und Anfang der Stelle (null = ganze Datei). */
export const BACKEND_STELLEN = [
  ['functions-kasse/kasse-settings-core.js', null],
  ['functions-kasse/kasse-settings-v3.js', 'function nurGueltig('],
  ['functions-kasse/article-groups-core.js', 'function kachelAttribute('],
  ['functions-kasse/article-endpoints.js', 'const listMyArticles = '],
  ['functions/beleg-kopf-core.js', null],
  ['functions/beleg-kopf.js', 'async function versionFuerBeleg('],
  ['functions/beleg-layout.js', null],
  ['functions/beleg-pruefangaben.js', null],
  ['functions/gemeinsam/storno-core.js', 'function ohneInterneStornoFelder('],
  ['functions/gemeinsam/storno-core.js', 'const INTERNE_BELEG_FELDER = '],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function schluessel('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function anPfad('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function werteAbbilden('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function bezugOhneMarke('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function ohneStornoMarke('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function huelleOhneStornoMarke('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function rueckgabeUmbenennen('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function zeilenMitRueckgabe('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function belegRueckgabeNachAussen('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'const belegJeKanal = '],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function nurBekannte('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function artikelNachAussen('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function antwortNachAussen('],
  ['functions/index.js', 'async function belegKopfVersionOderKonto('],
  ['functions/index.js', 'async function belegAntwort('],
];

/** Die Dateien des Zwillings (vokabular.ts ist erzeugt und eigens gegen den Vertrag geprueft). */
export const ZWILLING_DATEIEN = ['src/stored/draht.ts', 'src/stored/einstellungen.ts', 'src/stored/index.ts'];

const sha = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Die Stelle ab `marke` bis zur ersten folgenden Zeile, die mit derselben
 * Einrueckung wie die Zeile der Marke mit `}` beginnt (Ende des Blocks).
 */
export function stelle(text, marke) {
  if (marke === null) return text;
  const start = text.indexOf(marke);
  if (start < 0 || text.indexOf(marke, start + 1) >= 0) throw new Error(`Marke nicht genau einmal gefunden: ${marke}`);
  const zeilenAnfang = text.lastIndexOf('\n', start) + 1;
  const einzug = text.slice(zeilenAnfang, start);
  if (einzug.trim() !== '') throw new Error(`Marke steht nicht am Zeilenanfang: ${marke}`);
  const zeilen = text.slice(zeilenAnfang).split('\n');
  for (let i = 1; i < zeilen.length; i += 1) {
    const z = zeilen[i];
    if (z.startsWith(`${einzug}}`) && !z.startsWith(`${einzug} `)) return zeilen.slice(0, i + 1).join('\n');
  }
  throw new Error(`Ende der Stelle nicht gefunden: ${marke}`);
}

export function backendStand(backend) {
  return BACKEND_STELLEN.map(([datei, marke]) => ({
    datei, marke, sha256: sha(stelle(readFileSync(resolve(backend, datei), 'utf8'), marke)),
  }));
}

export function zwillingStand(wurzel) {
  return Object.fromEntries(ZWILLING_DATEIEN.map((d) => [d, sha(readFileSync(resolve(wurzel, d), 'utf8'))]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const backend = process.env.KASSENECK_BACKEND;
  if (!backend) {
    console.error('KASSENECK_BACKEND fehlt: Pfad zum Backend-Checkout (Repo kasseneck)');
    process.exit(1);
  }
  const wurzel = fileURLToPath(new URL('..', import.meta.url));
  const stand = { backend: backendStand(resolve(backend)), zwilling: zwillingStand(wurzel) };
  writeFileSync(resolve(wurzel, 'test/fixtures/stored-zwillinge.json'), `${JSON.stringify(stand, null, 2)}\n`);
  console.log(`test/fixtures/stored-zwillinge.json: ${stand.backend.length} Backend-Stellen, ${ZWILLING_DATEIEN.length} Zwillingsdateien`);
}
