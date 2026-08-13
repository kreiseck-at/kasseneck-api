#!/usr/bin/env node
/**
 * Prueft nach dem Bau, dass jeder in `package.json` unter `exports` genannte
 * Pfad wirklich entstanden ist.
 *
 * Grund: die Eintraege sind Zeichenketten. Wer `outDir` umstellt oder eine
 * Datei verschiebt, merkt davon nichts — der Bau laeuft durch, die Tests
 * laufen gegen die Quellen, und erst beim Verbraucher bricht
 * `require('@kreiseck/kasseneck-api/printing')`.
 *
 * Laeuft im aktuellen Arbeitsverzeichnis; Fehler gehen nach stderr, der
 * Rueckgabewert ist dann 1.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wurzel = process.cwd();
const paket = JSON.parse(readFileSync(resolve(wurzel, 'package.json'), 'utf8'));

const fehlend = [];
let geprueft = 0;

for (const [eintrag, ziele] of Object.entries(paket.exports ?? {})) {
  const pfade = typeof ziele === 'string' ? { default: ziele } : ziele;
  for (const [bedingung, pfad] of Object.entries(pfade)) {
    if (typeof pfad !== 'string') continue;
    geprueft += 1;
    if (!existsSync(resolve(wurzel, pfad))) {
      fehlend.push(`${eintrag} (${bedingung}) -> ${pfad}`);
    }
  }
}

if (fehlend.length > 0) {
  process.stderr.write(
    `exports zeigt auf Pfade, die der Bau nicht erzeugt hat:\n  ${fehlend.join('\n  ')}\n`,
  );
  process.exit(1);
}

process.stdout.write(`exports: ${geprueft} Bau-Pfade vorhanden\n`);
