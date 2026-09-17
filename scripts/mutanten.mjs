#!/usr/bin/env node
/**
 * Mutanten: feste, plausible Fehler im Rechenkern. Jeder MUSS mindestens einen
 * Test rot machen — sonst prueft die Suite an dieser Stelle nichts.
 *
 * Laeuft von Hand vor jeder Veroeffentlichung; das Ergebnis gehoert in den PR.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const DATEI = 'src/rechnung/rechnen.ts';
const SICHERUNG = 'src/rechnung/rechnen.ts.original';

// Ein frueherer Lauf kann mitten in einer Mutante abgebrochen worden sein (z. B.
// getoetet) — dann liegt noch eine Sicherung da und der Kern selbst ist mutiert.
// In dem Fall zuerst aus der Sicherung wiederherstellen, statt die mutierte
// Fassung als neue "Sicherung" zu uebernehmen, sonst bliebe der Kern dauerhaft
// mutiert.
if (existsSync(SICHERUNG)) {
  console.error('Sicherung von einem abgebrochenen Lauf gefunden — stelle Kern wieder her.');
  copyFileSync(SICHERUNG, DATEI);
  rmSync(SICHERUNG);
}

const MUTANTEN = [
  ['Rundung halb-gerade', 'const ganz = (2n * betrag + b) / (2n * b);', 'const ganz = (2n * betrag + b - 1n) / (2n * b);'],
  ['je Zeile statt je Satz runden', 'const S = gruppe.reduce((s, z) => s + z.L, 0n);', 'const S = gruppe.reduce((s, z) => s + rund(z.L, E) * E, 0n);'],
  ['Brutto-Formel wie Weg 1', 'netCents = rund(grossCents * 10_000n, 10_000n + r);', 'netCents = rund(S * 10_000n, E * (10_000n + r));'],
  ['Rabatt per Ganzzahldivision auf den Einzelpreis', 'const L = preis * menge * (10_000n - rabatt) * 1_000_000n;', 'const L = (preis * (10_000n - rabatt) / 10_000n) * menge * 10_000n * 1_000_000n;'],
  ['byRate aufsteigend', 'byRate.sort((a, b) => b.rateBp - a.rateBp);', 'byRate.sort((a, b) => a.rateBp - b.rateBp);'],
  ['Gleichstand an die spaetere Zeile', 'return a.z.index - b.z.index;', 'return b.z.index - a.z.index;'],
  ['Nullzeile bekommt Cent', '.filter((w) => w.zaehler !== 0n)', '.filter(() => true)'],
  ['Satzschluessel mit Komma', "return String(rateBp / 100);", "return String(rateBp / 100).replace('.', ',');"],
  ['Grenze zu hoch', 'export const BETRAG_GRENZE_CENTS = 99_999_999_999;', 'export const BETRAG_GRENZE_CENTS = 999_999_999_999;'],
];

copyFileSync(DATEI, SICHERUNG);
const original = readFileSync(DATEI, 'utf8');
const ueberlebt = [];
try {
  for (const [name, suchen, ersetzen] of MUTANTEN) {
    if (!original.includes(suchen)) {
      console.error(`Mutante "${name}": Fundstelle fehlt — Skript nachziehen`);
      ueberlebt.push(name);
      continue;
    }
    writeFileSync(DATEI, original.replace(suchen, ersetzen));
    try {
      execSync('npx tsc -p tsconfig.test.json && node --test "test-dist/test/*.test.js"', { stdio: 'pipe' });
      console.error(`ueberlebt: ${name}`);
      ueberlebt.push(name);
    } catch {
      console.log(`erkannt:   ${name}`);
    }
  }
} finally {
  copyFileSync(SICHERUNG, DATEI);
  rmSync(SICHERUNG);
}
process.exit(ueberlebt.length ? 1 : 0);
