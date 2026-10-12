import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cashMovementLayout, shiftReceiptLayout, labelText, type CashMovementReceipt, type ShiftSummaryReceipt } from '../src/pos/index.js';
import { formatCents, gridToText, renderReceiptGrid, type ReceiptLayout } from '../src/receipt/index.js';
import { isKasseneckValidationError } from '../src/client/errors.js';

/*
 * Bons der Schicht (Z-Bon, X-Bon, Kassenbewegung) als Zeilenmodell. Die
 * Eingaben stammen aus dem Vertrag (fixtures/v3/antworten/kasse.json), damit
 * Layout und Vertrag nicht auseinanderlaufen; die erwarteten Zeilen und
 * Raster stehen in fixtures/expected/shift-*.{lines.json,grid32.txt,grid48.txt}
 * (npm run fixtures:erneuern), ihre Quellen und Pruefsummen in
 * fixtures/shift-receipts.json. Der Dart-Zwilling spielt dieselben ab.
 */

type Json = Record<string, any>;
const wurzel = new URL('../../fixtures/', import.meta.url);
const lies = (pfad: string): string => readFileSync(new URL(pfad, wurzel), 'utf8');
const KASSE = JSON.parse(lies('v3/antworten/kasse.json')).endpoints as Record<string, { cases: Array<{ case: string; response: Json }> }>;
const MANIFEST = JSON.parse(lies('shift-receipts.json')) as {
  _note: string;
  receipts: Record<string, { source: string; expected: string; grid32: string; grid48: string }>;
};

function quelle(pfad: string): Json {
  const [endpunkt, name] = pfad.split('/') as [string, string];
  const f = KASSE[endpunkt]!.cases.find((c) => c.case === name);
  assert.ok(f, pfad);
  return f.response.data.receipt as Json;
}

function layoutFuer(bon: Json): ReceiptLayout {
  return bon.kind === 'cash_movement' ? cashMovementLayout(bon as CashMovementReceipt) : shiftReceiptLayout(bon as ShiftSummaryReceipt);
}

const raster = (layout: ReceiptLayout, zeichen: number): string => gridToText(renderReceiptGrid(layout, { charsPerLine: zeichen }));
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

test('Goldens: die vier Bons aus dem Vertrag ergeben Zeilen und Raster wie aufgenommen', () => {
  assert.deepEqual(Object.keys(MANIFEST.receipts).sort(), ['cash-movement', 'shift-close', 'shift-close-blind', 'shift-interim']);
  assert.deepEqual(MANIFEST.receipts['shift-close']!.source, 'closeMyShift/success_manager');
  assert.deepEqual(MANIFEST.receipts['shift-close-blind']!.source, 'closeMyShift/success_cashier_blind');
  for (const [name, eintrag] of Object.entries(MANIFEST.receipts)) {
    const layout = layoutFuer(quelle(eintrag.source));
    const zeilen = JSON.stringify(layout, null, 2) + '\n';
    assert.equal(zeilen, lies(`expected/${name}.lines.json`), `${name}.lines.json (npm run fixtures:erneuern)`);
    assert.equal(sha(zeilen), eintrag.expected, name);
    for (const zeichen of [32, 48] as const) {
      const text = raster(layout, zeichen);
      assert.equal(text, lies(`expected/${name}.grid${zeichen}.txt`), `${name}.grid${zeichen}.txt`);
      assert.equal(sha(text), eintrag[`grid${zeichen}`], `${name} grid${zeichen}`);
    }
  }
});

test('Titel nach Art, Fuss immer „Kein Registrierkassenbeleg“', () => {
  const titel = (bon: Json) => layoutFuer(bon).lines.find((z) => z.kind === 'banner');
  assert.deepEqual(titel(quelle('closeMyShift/success_manager')), { kind: 'banner', text: 'Schichtabschluss', tone: 'receipt_type' });
  assert.deepEqual(titel(quelle('getMyShiftReport/success_manager')), { kind: 'banner', text: 'Zwischenbericht', tone: 'receipt_type' });
  assert.deepEqual(titel(quelle('recordMyCashMovement/success_manager_cash_drop')), { kind: 'banner', text: 'Kassenbewegung', tone: 'receipt_type' });
  for (const pfad of ['closeMyShift/success_manager', 'getMyShiftReport/success_cashier', 'recordMyCashMovement/success_owner_without_shift']) {
    const zeilen = layoutFuer(quelle(pfad)).lines;
    const letzte = zeilen.at(-1)!;
    assert.deepEqual(letzte, { kind: 'text', text: labelText('shift.not_a_receipt'), align: 'center', bold: true }, pfad);
  }
});

test('Blind: weder Soll noch Ist noch Differenz noch Barumsatz, und nie 0,00 an ihrer Stelle', () => {
  for (const pfad of ['closeMyShift/success_cashier_blind', 'getMyShiftReport/success_cashier', 'getMyShiftReport/success_cashier_closed']) {
    const bon = quelle(pfad);
    assert.equal(bon.blind, true, pfad);
    for (const zeichen of [32, 48]) {
      const text = raster(layoutFuer(bon), zeichen);
      for (const wort of ['Soll', 'Differenz', 'Bar aus Verkäufen', 'Bar aus Storno']) assert.ok(!text.includes(wort), `${pfad}: ${wort}`);
      assert.doesNotMatch(text, /^Ist\b/m, `${pfad}: Ist`);
    }
  }
  // Startgeld uebernommen und blind: auch kein Startgeld-Betrag.
  const ohneStart = raster(layoutFuer(quelle('closeMyShift/success_cashier_blind')), 48);
  assert.match(ohneStart, /Startgeld übernommen/);
  assert.doesNotMatch(ohneStart, /Startgeld .*\d,\d\d/);
  // Was blind bleibt: Belege, Unbar, Bewegungen, Trinkgeld.
  assert.match(ohneStart, /Belege +3/);
  assert.match(ohneStart, /Kartenzahlung +32,00/);
});

test('Mit Recht: Soll, Ist und Differenz mit formatCents, die Stueckelung je Schein', () => {
  const bon = quelle('closeMyShift/success_manager');
  const text = raster(layoutFuer(bon), 48);
  assert.match(text, new RegExp(`Soll +${formatCents(bon.expectedCents)}`));
  assert.match(text, new RegExp(`^Ist +${formatCents(bon.countedCents)}`, 'm'));
  assert.match(text, new RegExp(`Differenz +${formatCents(bon.differenceCents)}`));
  assert.match(text, /1 x 200,00 +200,00/);
  assert.match(text, /2 x 20,00 +40,00/);
  // Bewegungen mit Nummer und Art, Trinkgeld je Mitarbeiter.
  assert.match(text, /Nr\. 4 Trinkgeld-Auszahlung +-4,00/);
  assert.match(text, /Ben Kellner/);
  // Der X-Bon hat noch kein Ist und keine Differenz, aber das Soll.
  const x = raster(layoutFuer(quelle('getMyShiftReport/success_manager')), 48);
  assert.match(x, /Soll +294,00/);
  assert.doesNotMatch(x, /^Ist\b|Differenz|Geschlossen/m);
});

test('Kassenbewegung: Nummer, Art, Betrag, Ort, Grund, Bediener; Leeres faellt weg', () => {
  const abschoepfung = raster(layoutFuer(quelle('recordMyCashMovement/success_manager_cash_drop')), 48);
  assert.match(abschoepfung, /Abschöpfung/);
  assert.match(abschoepfung, /Betrag +-200,00/);
  assert.match(abschoepfung, /Ort +Tresor/);
  assert.match(abschoepfung, /Grund +Abend/);
  assert.match(abschoepfung, /Bediener +Anna Chef/);
  const umbuchung = raster(layoutFuer(quelle('recordMyCashMovement/success_manager_transfer')), 48);
  assert.match(umbuchung, /Ziel-Lade +Bar/);
  const inhaber = raster(layoutFuer(quelle('recordMyCashMovement/success_owner_without_shift')), 48);
  assert.doesNotMatch(inhaber, /Bediener|Ort|Grund|Schicht/);
});

test('Falsche Art oder kaputter Bon: Fehler statt eines halben Bons', () => {
  const z = quelle('closeMyShift/success_manager');
  const b = quelle('recordMyCashMovement/success_manager_cash_drop');
  assert.throws(() => cashMovementLayout(z as never), (e) => isKasseneckValidationError(e));
  assert.throws(() => shiftReceiptLayout(b as never), (e) => isKasseneckValidationError(e));
  assert.throws(() => shiftReceiptLayout({ ...z, receiptCount: '3' } as never), (e) => isKasseneckValidationError(e));
  assert.throws(() => shiftReceiptLayout(z as never, { paperSize: 'mm70' as never }), (e) => isKasseneckValidationError(e));
  assert.equal(shiftReceiptLayout(z as never, { paperSize: 'mm80' }).paperSize, 'mm80');
  assert.equal(shiftReceiptLayout(z as never).paperSize, 'mm58');
});
