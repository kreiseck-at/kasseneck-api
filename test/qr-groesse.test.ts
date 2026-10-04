import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  QR_EXCEPTION_MODULE_DOTS,
  QR_PRINT_WIDTH_DOTS,
  QR_MAX_MODULE_DOTS,
  QR_MIN_MODULE_DOTS,
  QR_MODULE_SIZE_CAP,
  QR_QUIET_ZONE_MODULES,
  computeQrSizing,
  qrSizingFor,
  qrModuleCount,
  qrFitsInVersion,
  type QrModuleSize,
} from '../src/printing/index.js';

/**
 * Die Rechenregel — dieselbe Tabelle wie im Flutter-Zwilling
 * (`test/printing/qr_groesse_test.dart`). Beide Pakete pinnen die gleichen
 * Modulzahlen und die gleichen Ergebnisse -- seit 0.14.0 auch denselben Deckel
 * von `auto` (6; bis 0.13 hier 4, dort 6).
 */

// ------------------------------------------------------------- Modulanzahl

test('Modulanzahl: die gemeinsamen Golden-Werte bei Fehlerkorrektur M', () => {
  const rksv =
    '_R1-AT1_KASSENECK1_AT0-KASSENECK1-10420_2026-08-13T10:15:30_12,90_0,00_0,00_0,00_0,00_' +
    'PL5nQ2V0b3JRRA==_5A1C3E07_Ky9lbXBmYW5nZXJzY2hsdXNzZWw=_' +
    'bGV0enRlci1TaWduYXR1cndlcnQtUktTVi1CZWxlZy1EZW1vLTAx';
  assert.equal(rksv.length, 193);
  assert.deepEqual(
    [
      qrModuleCount('TESTQRDATA'),
      qrModuleCount(rksv),
      qrModuleCount('X'.repeat(400)),
      qrModuleCount('X'.repeat(600)),
      qrModuleCount('X'.repeat(1000)),
    ],
    [21, 57, 77, 93, 121],
  );
});

test('Modulanzahl: waechst in Vierersprungen und ueberspringt keine Version', () => {
  let vorher = 0;
  for (let n = 1; n <= 2331; n += 7) {
    const module = qrModuleCount('X'.repeat(n));
    assert.ok(module >= vorher, `bei ${n} Zeichen faellt die Modulanzahl`);
    assert.equal((module - 21) % 4, 0, `bei ${n} Zeichen: ${module} ist keine gueltige Groesse`);
    vorher = module;
  }
  assert.equal(qrModuleCount('X'.repeat(2331)), 177);
});

test('Modulanzahl: zaehlt Byte, nicht Zeichen — ein Umlaut kostet zwei', () => {
  // 14 Byte passen in Version 1, 15 nicht mehr.
  assert.equal(qrModuleCount('X'.repeat(14)), 21);
  assert.equal(qrModuleCount('X'.repeat(15)), 25);
  assert.equal(qrModuleCount(`${'X'.repeat(13)}ä`), 25);
});

test('Modulanzahl: zu lange Nutzlast wird gemeldet, nicht stillschweigend gekuerzt', () => {
  assert.throws(() => qrModuleCount('X'.repeat(2332)), /zu lang/);
});

test('qrFitsInVersion: dieselbe Grenze wie qrModuleCount, aber ohne zu werfen', () => {
  assert.equal(qrFitsInVersion('X'.repeat(2331)), true);
  assert.equal(qrFitsInVersion('X'.repeat(2332)), false);
  assert.equal(qrFitsInVersion(''), true);
  // Ein Umlaut zaehlt zwei Byte -- an der Grenze entscheidet das, nicht die Zeichenzahl.
  assert.equal(qrFitsInVersion(`${'X'.repeat(2330)}ä`), false);
});

// ------------------------------------------------------------------- Regel

test('Regel: die gemeinsame Ergebnis-Tabelle', () => {
  const faelle: ReadonlyArray<[number, number, QrModuleSize, number | null, number]> = [
    // Module, Papier, Deckel, erwartete Punkte, erwartete Breite
    [21, 384, 'medium', 6, 174],
    [21, 576, 'medium', 6, 174],
    [21, 384, 'large', 8, 232],
    [21, 384, 'small', 4, 116],
    [57, 576, 'medium', 6, 390],
    [57, 384, 'medium', 5, 325],
    [57, 384, 'large', 5, 325],
    [77, 384, 'medium', 4, 340],
    [93, 384, 'medium', 3, 303],
    [121, 384, 'medium', null, 0],
  ];
  for (const [moduleAnzahl, papierbreitePunkte, groesse, punkte, breite] of faelle) {
    const mass = computeQrSizing({ paperWidthDots: papierbreitePunkte, moduleCount: moduleAnzahl, moduleSize: groesse });
    assert.deepEqual(
      [mass.moduleDots, mass.widthDots, mass.fits],
      [punkte, breite, punkte !== null],
      `${moduleAnzahl} Module auf ${papierbreitePunkte} Punkten (${groesse})`,
    );
  }
});

test('Regel: das Symbol samt Ruhezone bleibt immer auf dem Papier', () => {
  for (const papier of [384, 576]) {
    for (let module = 21; module <= 177; module += 4) {
      for (const groesse of ['auto', 'small', 'medium', 'large'] as const) {
        const mass = computeQrSizing({ paperWidthDots: papier, moduleCount: module, moduleSize: groesse });
        if (!mass.fits) continue;
        assert.ok(
          mass.widthDots <= papier,
          `${module} Module, ${groesse}: ${mass.widthDots} > ${papier}`,
        );
        assert.equal(mass.widthDots, (module + 2 * QR_QUIET_ZONE_MODULES) * (mass.moduleDots as number));
        assert.ok((mass.moduleDots as number) <= QR_MAX_MODULE_DOTS);
      }
    }
  }
});

test('Regel: der Deckel hebt nie an, er begrenzt nur', () => {
  // 57 Module auf 58 mm: rechnerisch 5, kein Deckel macht daraus mehr.
  for (const groesse of ['auto', 'small', 'medium', 'large'] as const) {
    const mass = computeQrSizing({ paperWidthDots: 384, moduleCount: 57, moduleSize: groesse });
    assert.ok((mass.moduleDots as number) <= 5);
  }
  // Umgekehrt: wo viel Platz ist, entscheidet allein der Deckel.
  for (const groesse of ['auto', 'small', 'medium', 'large'] as const) {
    const mass = computeQrSizing({ paperWidthDots: 576, moduleCount: 21, moduleSize: groesse });
    assert.equal(mass.moduleDots, QR_MODULE_SIZE_CAP[groesse]);
  }
});

// Ruling 11: `auto` heisst in npm und Dart dasselbe -- hoechstens 6 Punkte je
// Modul. Bis 0.13 pinnte dieser Test hier den abweichenden Wert 4.
test('Regel: auto deckelt wie im Dart-Zwilling bei 6; small bleibt 4', () => {
  assert.equal(QR_MODULE_SIZE_CAP.auto, 6);
  assert.deepEqual(QR_MODULE_SIZE_CAP, { auto: 6, small: 4, medium: 6, large: 8 });
  assert.equal(computeQrSizing({ paperWidthDots: 576, moduleCount: 21 }).moduleDots, 6);
});

test('Regel: unter der Mindestgroesse wird gedruckt, aber gemeldet', () => {
  const knapp = computeQrSizing({ paperWidthDots: 384, moduleCount: 93, moduleSize: 'medium' });
  assert.deepEqual(
    [knapp.moduleDots, knapp.belowMinimum, knapp.fits],
    [QR_EXCEPTION_MODULE_DOTS, true, true],
  );
  const gerade = computeQrSizing({ paperWidthDots: 384, moduleCount: 77, moduleSize: 'medium' });
  assert.deepEqual([gerade.moduleDots, gerade.belowMinimum], [QR_MIN_MODULE_DOTS, false]);
});

test('Regel: sinnlose Eingaben werfen, statt still "passt nicht" zu sagen', () => {
  assert.throws(() => computeQrSizing({ paperWidthDots: 0, moduleCount: 21 }), /papierbreite/i);
  assert.throws(() => computeQrSizing({ paperWidthDots: -1, moduleCount: 21 }), /papierbreite/i);
  assert.throws(() => computeQrSizing({ paperWidthDots: 384, moduleCount: 0 }), /moduleAnzahl/);
  assert.throws(
    () => computeQrSizing({ paperWidthDots: 384, moduleCount: 21, moduleSize: 'riesig' as QrModuleSize }),
    /Unbekannte QR-Modulgroesse/,
  );
});

// ---------------------------------------------------------------- Nutzlast

test('qrSizingFor: rechnet die Module selbst und reicht die Regel durch', () => {
  assert.deepEqual(
    qrSizingFor({ payload: 'X'.repeat(600), paperWidthDots: 384, moduleSize: 'medium' }),
    { moduleDots: 3, modules: 93, widthDots: 303, belowMinimum: true, fits: true },
  );
  assert.deepEqual(
    qrSizingFor({ payload: 'X'.repeat(1000), paperWidthDots: 384 }),
    { moduleDots: null, modules: 121, widthDots: 0, belowMinimum: false, fits: false },
  );
});

test('qrSizingFor: leere Nutzlast passt nicht, wirft aber nicht', () => {
  assert.deepEqual(qrSizingFor({ payload: '', paperWidthDots: 384 }), {
    moduleDots: null, modules: 0, widthDots: 0, belowMinimum: false, fits: false,
  });
});

test('Druckpunkte: 58 mm = 384, 80 mm = 576 — nicht die Spaltenbreite 372/558', () => {
  assert.deepEqual(QR_PRINT_WIDTH_DOTS, { mm58: 384, mm80: 576 });
});
