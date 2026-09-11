import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  QR_AUSNAHME_PUNKTE,
  QR_DRUCK_PUNKTE,
  QR_HOECHST_PUNKTE,
  QR_MINDEST_PUNKTE,
  QR_MODUL_DECKEL,
  QR_RUHEZONE_MODULE,
  qrGroesseBerechnen,
  qrGroesseFuer,
  qrModulAnzahl,
  type QrModulGroesse,
} from '../src/printing/index.js';

/**
 * Die Rechenregel — dieselbe Tabelle wie im Flutter-Zwilling
 * (`test/printing/qr_groesse_test.dart`). Beide Pakete pinnen die gleichen
 * Modulzahlen und die gleichen Ergebnisse; nur der Deckel von `auto` folgt dem
 * jeweiligen Bestandswert (hier 4, dort 6) und ist darum getrennt gepinnt.
 */

// ------------------------------------------------------------- Modulanzahl

test('Modulanzahl: die gemeinsamen Golden-Werte bei Fehlerkorrektur M', () => {
  const rksv =
    '_R1-AT1_KASSENECK1_AT0-KASSENECK1-10420_2026-08-13T10:15:30_12,90_0,00_0,00_0,00_0,00_' +
    'PL5nQ2V0b3JRRA==_6F0404F0_Ky9lbXBmYW5nZXJzY2hsdXNzZWw=_' +
    'bGV0enRlci1TaWduYXR1cndlcnQtUktTVi1CZWxlZy1EZW1vLTAx';
  assert.equal(rksv.length, 193);
  assert.deepEqual(
    [
      qrModulAnzahl('TESTQRDATA'),
      qrModulAnzahl(rksv),
      qrModulAnzahl('X'.repeat(400)),
      qrModulAnzahl('X'.repeat(600)),
      qrModulAnzahl('X'.repeat(1000)),
    ],
    [21, 57, 77, 93, 121],
  );
});

test('Modulanzahl: waechst in Vierersprungen und ueberspringt keine Version', () => {
  let vorher = 0;
  for (let n = 1; n <= 2331; n += 7) {
    const module = qrModulAnzahl('X'.repeat(n));
    assert.ok(module >= vorher, `bei ${n} Zeichen faellt die Modulanzahl`);
    assert.equal((module - 21) % 4, 0, `bei ${n} Zeichen: ${module} ist keine gueltige Groesse`);
    vorher = module;
  }
  assert.equal(qrModulAnzahl('X'.repeat(2331)), 177);
});

test('Modulanzahl: zaehlt Byte, nicht Zeichen — ein Umlaut kostet zwei', () => {
  // 14 Byte passen in Version 1, 15 nicht mehr.
  assert.equal(qrModulAnzahl('X'.repeat(14)), 21);
  assert.equal(qrModulAnzahl('X'.repeat(15)), 25);
  assert.equal(qrModulAnzahl(`${'X'.repeat(13)}ä`), 25);
});

test('Modulanzahl: zu lange Nutzlast wird gemeldet, nicht stillschweigend gekuerzt', () => {
  assert.throws(() => qrModulAnzahl('X'.repeat(2332)), /zu lang/);
});

// ------------------------------------------------------------------- Regel

test('Regel: die gemeinsame Ergebnis-Tabelle', () => {
  const faelle: ReadonlyArray<[number, number, QrModulGroesse, number | null, number]> = [
    // Module, Papier, Deckel, erwartete Punkte, erwartete Breite
    [21, 384, 'mittel', 6, 174],
    [21, 576, 'mittel', 6, 174],
    [21, 384, 'gross', 8, 232],
    [21, 384, 'klein', 4, 116],
    [57, 576, 'mittel', 6, 390],
    [57, 384, 'mittel', 5, 325],
    [57, 384, 'gross', 5, 325],
    [77, 384, 'mittel', 4, 340],
    [93, 384, 'mittel', 3, 303],
    [121, 384, 'mittel', null, 0],
  ];
  for (const [moduleAnzahl, papierbreitePunkte, groesse, punkte, breite] of faelle) {
    const mass = qrGroesseBerechnen({ papierbreitePunkte, moduleAnzahl, groesse });
    assert.deepEqual(
      [mass.punkte, mass.breitePunkte, mass.passt],
      [punkte, breite, punkte !== null],
      `${moduleAnzahl} Module auf ${papierbreitePunkte} Punkten (${groesse})`,
    );
  }
});

test('Regel: das Symbol samt Ruhezone bleibt immer auf dem Papier', () => {
  for (const papier of [384, 576]) {
    for (let module = 21; module <= 177; module += 4) {
      for (const groesse of ['auto', 'klein', 'mittel', 'gross'] as const) {
        const mass = qrGroesseBerechnen({ papierbreitePunkte: papier, moduleAnzahl: module, groesse });
        if (!mass.passt) continue;
        assert.ok(
          mass.breitePunkte <= papier,
          `${module} Module, ${groesse}: ${mass.breitePunkte} > ${papier}`,
        );
        assert.equal(mass.breitePunkte, (module + 2 * QR_RUHEZONE_MODULE) * (mass.punkte as number));
        assert.ok((mass.punkte as number) <= QR_HOECHST_PUNKTE);
      }
    }
  }
});

test('Regel: der Deckel hebt nie an, er begrenzt nur', () => {
  // 57 Module auf 58 mm: rechnerisch 5, kein Deckel macht daraus mehr.
  for (const groesse of ['auto', 'klein', 'mittel', 'gross'] as const) {
    const mass = qrGroesseBerechnen({ papierbreitePunkte: 384, moduleAnzahl: 57, groesse });
    assert.ok((mass.punkte as number) <= 5);
  }
  // Umgekehrt: wo viel Platz ist, entscheidet allein der Deckel.
  for (const groesse of ['auto', 'klein', 'mittel', 'gross'] as const) {
    const mass = qrGroesseBerechnen({ papierbreitePunkte: 576, moduleAnzahl: 21, groesse });
    assert.equal(mass.punkte, QR_MODUL_DECKEL[groesse]);
  }
});

test('Regel: auto deckelt beim Bestandswert dieses Pakets (4), nicht beim Flutter-Wert (6)', () => {
  assert.equal(QR_MODUL_DECKEL.auto, 4);
  assert.deepEqual(QR_MODUL_DECKEL, { auto: 4, klein: 4, mittel: 6, gross: 8 });
  assert.equal(qrGroesseBerechnen({ papierbreitePunkte: 576, moduleAnzahl: 21 }).punkte, 4);
});

test('Regel: unter der Mindestgroesse wird gedruckt, aber gemeldet', () => {
  const knapp = qrGroesseBerechnen({ papierbreitePunkte: 384, moduleAnzahl: 93, groesse: 'mittel' });
  assert.deepEqual(
    [knapp.punkte, knapp.unterMindestmass, knapp.passt],
    [QR_AUSNAHME_PUNKTE, true, true],
  );
  const gerade = qrGroesseBerechnen({ papierbreitePunkte: 384, moduleAnzahl: 77, groesse: 'mittel' });
  assert.deepEqual([gerade.punkte, gerade.unterMindestmass], [QR_MINDEST_PUNKTE, false]);
});

test('Regel: sinnlose Eingaben werfen, statt still "passt nicht" zu sagen', () => {
  assert.throws(() => qrGroesseBerechnen({ papierbreitePunkte: 0, moduleAnzahl: 21 }), /papierbreite/i);
  assert.throws(() => qrGroesseBerechnen({ papierbreitePunkte: -1, moduleAnzahl: 21 }), /papierbreite/i);
  assert.throws(() => qrGroesseBerechnen({ papierbreitePunkte: 384, moduleAnzahl: 0 }), /moduleAnzahl/);
  assert.throws(
    () => qrGroesseBerechnen({ papierbreitePunkte: 384, moduleAnzahl: 21, groesse: 'riesig' as QrModulGroesse }),
    /Unbekannte QR-Modulgroesse/,
  );
});

// ---------------------------------------------------------------- Nutzlast

test('qrGroesseFuer: rechnet die Module selbst und reicht die Regel durch', () => {
  assert.deepEqual(
    qrGroesseFuer({ nutzlast: 'X'.repeat(600), papierbreitePunkte: 384, groesse: 'mittel' }),
    { punkte: 3, module: 93, breitePunkte: 303, unterMindestmass: true, passt: true },
  );
  assert.deepEqual(
    qrGroesseFuer({ nutzlast: 'X'.repeat(1000), papierbreitePunkte: 384 }),
    { punkte: null, module: 121, breitePunkte: 0, unterMindestmass: false, passt: false },
  );
});

test('qrGroesseFuer: leere Nutzlast passt nicht, wirft aber nicht', () => {
  assert.deepEqual(qrGroesseFuer({ nutzlast: '', papierbreitePunkte: 384 }), {
    punkte: null, module: 0, breitePunkte: 0, unterMindestmass: false, passt: false,
  });
});

test('Druckpunkte: 58 mm = 384, 80 mm = 576 — nicht die Spaltenbreite 372/558', () => {
  assert.deepEqual(QR_DRUCK_PUNKTE, { mm58: 384, mm80: 576 });
});
