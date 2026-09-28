#!/usr/bin/env node
/**
 * Prueft nach dem Bau zweierlei an den `exports` der `package.json`:
 *
 * 1. **Existenz** — jeder genannte Pfad ist wirklich entstanden. Die Eintraege
 *    sind Zeichenketten; wer `outDir` umstellt oder eine Datei verschiebt,
 *    merkt davon nichts: der Bau laeuft durch, die Tests laufen gegen die
 *    Quellen, und erst beim Verbraucher bricht
 *    `require('@kreiseck/kasseneck-api/printing')`.
 *
 * 2. **Zuordnung** — jeder Unterpfad hat `import` **und** `require`, beide mit
 *    eigener `types`-Bedingung, und die zeigt in denselben Bau wie das
 *    `default` daneben (ESM zu ESM, CJS zu CJS). Grund: Eine gemeinsame
 *    `types`-Bedingung vor `import`/`require` gilt fuer beide Aufloesungen.
 *    Zeigt sie auf die ESM-Deklarationen, haelt TypeScript sie wegen
 *    `"type": "module"` in der Wurzel-package.json fuer ESM, und ein
 *    CommonJS-Verbraucher mit `module: Node16` bekommt an jedem Import
 *    TS1479 — obwohl `require` zur Laufzeit tadellos laeuft. Der Fehler sitzt
 *    also allein in der Typaufloesung und ist an keinem Bau- oder Testlauf
 *    dieses Repos zu sehen.
 *
 * Diese Pruefung ist statisch und damit schnell genug fuer jeden Bau. Den
 * Beweis am fertigen Tarball fuehrt `scripts/check-consumer-types.mjs`
 * (`npm run check:consumer`): `npm pack`, zwei Wegwerf-Verbraucher, `tsc`.
 *
 * Laeuft im aktuellen Arbeitsverzeichnis; Fehler gehen nach stderr, der
 * Rueckgabewert ist dann 1.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const wurzel = process.cwd();
const paket = JSON.parse(readFileSync(resolve(wurzel, 'package.json'), 'utf8'));

/** Welcher Bau zu welcher Bedingung gehoert. */
const BAU = { import: 'dist/esm/', require: 'dist/cjs/' };

const fehler = [];
let geprueft = 0;

/** Sammelt jeden Zeichenketten-Pfad, egal wie tief die Bedingungen geschachtelt sind. */
function pfadePruefen(eintrag, ziele, spur) {
  for (const [bedingung, wert] of Object.entries(ziele)) {
    const jetzt = spur ? `${spur}.${bedingung}` : bedingung;
    if (typeof wert === 'string') {
      geprueft += 1;
      if (!existsSync(resolve(wurzel, wert))) {
        fehler.push(`${eintrag} (${jetzt}) -> ${wert} fehlt im Bau`);
      }
    } else if (wert !== null && typeof wert === 'object') {
      pfadePruefen(eintrag, wert, jetzt);
    }
  }
}

for (const [eintrag, ziele] of Object.entries(paket.exports ?? {})) {
  // Muster-Eintraege (`./fixtures/*`) zeigen auf ein Verzeichnis, nicht auf einen Bau.
  if (eintrag.includes('*')) {
    geprueft += 1;
    const verzeichnis = String(typeof ziele === 'string' ? ziele : '').replace(/\*.*$/, '');
    if (!verzeichnis || !existsSync(resolve(wurzel, verzeichnis))) fehler.push(`${eintrag} -> Verzeichnis ${verzeichnis} fehlt`);
    continue;
  }
  if (typeof ziele === 'string') {
    pfadePruefen(eintrag, { default: ziele }, '');
    continue;
  }
  pfadePruefen(eintrag, ziele, '');

  for (const bedingung of Object.keys(BAU)) {
    const zweig = ziele[bedingung];
    if (zweig === null || typeof zweig !== 'object') {
      fehler.push(`${eintrag}: "${bedingung}" muss ein eigener Block mit types und default sein`);
      continue;
    }
    for (const rolle of ['types', 'default']) {
      const pfad = zweig[rolle];
      if (typeof pfad !== 'string') {
        fehler.push(`${eintrag}.${bedingung}: "${rolle}" fehlt`);
      } else if (!pfad.startsWith(`./${BAU[bedingung]}`)) {
        fehler.push(`${eintrag}.${bedingung}.${rolle} zeigt auf ${pfad}, erwartet wird ./${BAU[bedingung]}…`);
      }
    }
  }
  // Eine `types`-Bedingung neben (statt in) import/require gilt fuer beide
  // Aufloesungen — genau der Fall, den Punkt 2 oben beschreibt.
  if (typeof ziele['types'] === 'string') {
    fehler.push(`${eintrag}: "types" steht neben import/require und gilt damit fuer beide — es gehoert in jeden Zweig`);
  }
}

/**
 * Die Pfade koennen alle stimmen und der Bau trotzdem unbenutzbar sein: Was
 * die `.js`-Dateien in `dist/cjs/` ueberhaupt erst zu CommonJS macht, ist die
 * kleine `package.json` mit `{"type":"commonjs"}` daneben — die Wurzel fuehrt
 * `"type": "module"`. Fehlt sie, meldet die Pfadpruefung nichts (genau so
 * gemessen: Rueckgabewert 0), und ein CommonJS-Verbraucher bekommt an jedem
 * Unterpfad denselben TS1479, gegen den die getrennten types-Bedingungen
 * gerade gebaut wurden. Fuer den ESM-Bau gilt dasselbe spiegelbildlich.
 */
function modulTyp(verzeichnis) {
  const eigenes = resolve(wurzel, verzeichnis, 'package.json');
  if (existsSync(eigenes)) {
    return { eigen: true, typ: JSON.parse(readFileSync(eigenes, 'utf8')).type };
  }
  // Ohne eigene package.json gilt die der Wurzel.
  return { eigen: false, typ: paket.type };
}

const benutzteBedingungen = new Set();
for (const ziele of Object.values(paket.exports ?? {})) {
  if (ziele === null || typeof ziele !== 'object') continue;
  for (const bedingung of Object.keys(BAU)) {
    if (ziele[bedingung] !== undefined) {
      benutzteBedingungen.add(bedingung);
    }
  }
}

for (const bedingung of benutzteBedingungen) {
  const verzeichnis = BAU[bedingung].replace(/\/$/, '');
  const erwartet = bedingung === 'require' ? 'commonjs' : 'module';
  const { eigen, typ } = modulTyp(verzeichnis);
  if (typ !== erwartet) {
    const geltend = typ ?? 'commonjs (Vorgabe)';
    fehler.push(
      eigen
        ? `${verzeichnis}/package.json fuehrt "type": "${geltend}", noetig ist "${erwartet}"`
        : `${verzeichnis}/package.json fehlt — noetig ist {"type":"${erwartet}"}, sonst gilt die Wurzel mit "${geltend}"`,
    );
  }
}

/**
 * 1.0 hat die deutschen Unterpfade ohne Alias umbenannt. Ein Eintrag unter
 * altem Namen waere ein zweiter Weg zum selben Modul und liesse Verbraucher
 * stillschweigend beim alten Namen bleiben. Der Wortschatz-Waechter
 * (`test/export-namen.test.ts`) prueft die Namen allgemein; hier steht die
 * Liste der konkret entfernten, damit schon der Bau sie meldet.
 */
const ENTFERNT_IN_1_0 = { './kasse': './pos', './rechnung': './invoice', './rechnung/rechnen': './invoice/calc' };
for (const [alt, neu] of Object.entries(ENTFERNT_IN_1_0)) {
  if (alt in (paket.exports ?? {})) fehler.push(`${alt}: seit 1.0 entfernt, heisst ${neu}`);
}

/**
 * `"sideEffects": false` erlaubt einem Bundler (Vite/Rollup, esbuild,
 * webpack), jedes Modul wegzulassen, dessen Exporte niemand nutzt. Das ist
 * nur richtig, solange kein Modul beim Import etwas ausserhalb seiner selbst
 * veraendert. Geprueft wird der ESM-Bau Anweisung fuer Anweisung auf oberster
 * Ebene: erlaubt sind Importe mit Namen, Exporte, Funktionen, Klassen ohne
 * statische Initialisierung und Konstanten. In deren Initialisierern (ohne
 * Funktionsruempfe) darf nichts zugewiesen, geloescht oder hochgezaehlt
 * werden. Verboten sind nackte Importe (`import './x.js'`), CSS-Importe und
 * jede andere Anweisung. Aufrufe in Initialisierern bleiben erlaubt: es sind
 * modul-lokale Bausteine (`Object.freeze`, `new Set`, Katalog-Helfer); was sie
 * tun, sieht ein Review, nicht diese Pruefung.
 */
if (paket.sideEffects !== false) fehler.push('package.json: "sideEffects": false fehlt');
const seiteneffekte = [];
function lesen(verzeichnis) {
  for (const name of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, name);
    if (statSync(pfad).isDirectory()) lesen(pfad);
    else if (pfad.endsWith('.js')) modulPruefen(pfad);
  }
}
function veraendert(knoten, aus) {
  if (ts.isFunctionLike(knoten) || ts.isClassLike(knoten)) return;
  const op = ts.isBinaryExpression(knoten) ? knoten.operatorToken.kind : undefined;
  if (op !== undefined && op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) aus.push('Zuweisung');
  if (ts.isDeleteExpression(knoten)) aus.push('delete');
  if (ts.isPostfixUnaryExpression(knoten)) aus.push('Zaehler');
  if (ts.isPrefixUnaryExpression(knoten) && (knoten.operator === ts.SyntaxKind.PlusPlusToken || knoten.operator === ts.SyntaxKind.MinusMinusToken)) aus.push('Zaehler');
  ts.forEachChild(knoten, (k) => veraendert(k, aus));
}
function modulPruefen(pfad) {
  const datei = ts.createSourceFile(pfad, readFileSync(pfad, 'utf8'), ts.ScriptTarget.ES2022, true);
  const wo = (st) => `${pfad.slice(wurzel.length + 1)}:${datei.getLineAndCharacterOfPosition(st.getStart()).line + 1}`;
  for (const st of datei.statements) {
    if (ts.isImportDeclaration(st)) {
      const ziel = ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : '';
      if (!st.importClause) seiteneffekte.push(`${wo(st)} nackter Import ${ziel}`);
      if (/\.(css|scss|less)$/i.test(ziel)) seiteneffekte.push(`${wo(st)} CSS-Import ${ziel}`);
      continue;
    }
    if (ts.isExportDeclaration(st) || ts.isFunctionDeclaration(st)) continue;
    if (ts.isClassDeclaration(st)) {
      const statisch = st.members.some((m) => ts.isClassStaticBlockDeclaration(m)
        || (ts.isPropertyDeclaration(m) && m.initializer && m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)));
      if (statisch) seiteneffekte.push(`${wo(st)} Klasse mit statischer Initialisierung`);
      continue;
    }
    if (ts.isVariableStatement(st)) {
      const aus = [];
      for (const d of st.declarationList.declarations) if (d.initializer) veraendert(d.initializer, aus);
      for (const a of new Set(aus)) seiteneffekte.push(`${wo(st)} ${a} beim Import`);
      continue;
    }
    // Direktiven wie 'use client' stehen als Ausdruck da und tun nichts.
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) continue;
    seiteneffekte.push(`${wo(st)} Anweisung auf oberster Ebene`);
  }
}
// Fehlt der Bau ganz, meldet das schon die Pfadpruefung oben.
if (existsSync(resolve(wurzel, BAU.import))) lesen(resolve(wurzel, BAU.import));
for (const s of seiteneffekte) fehler.push(`sideEffects: ${s}`);

if (fehler.length > 0) {
  process.stderr.write(`exports sind nicht in Ordnung:\n  ${fehler.join('\n  ')}\n`);
  process.exit(1);
}

process.stdout.write(
  `exports: ${geprueft} Bau-Pfade vorhanden, Typen je Bedingung im richtigen Bau, Modultyp je Bau gesetzt, ESM-Bau ohne Seiteneffekte beim Import\n`,
);
