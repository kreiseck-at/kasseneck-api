import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cashMovementLayout, shiftReceiptLayout, type CashMovementReceipt, type ShiftSummaryReceipt } from '../src/pos/index.js';
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
  assert.deepEqual(Object.keys(MANIFEST.receipts).sort(), ['cash-movement', 'shift-close', 'shift-close-blind', 'shift-close-put-in', 'shift-close-take-out', 'shift-interim']);
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

test('Nach der Zaehlung: „Entnommen“ negativ bzw. „Eingelegt“, dann „Bleibt in der Kassenlade“ fett (Wechselgeld, 1.11.0)', () => {
  // Bleibt-Zeile = Ergebnis: fett im Bauplan und im Raster.
  const bleibtZeile = (layout: ReceiptLayout) => layout.lines.find((z) => z.kind === 'columns' && z.columns[0]!.text === 'Bleibt in der Kassenlade');
  const entnahme = quelle('closeMyShift/success_manager_take_out');
  const layout = layoutFuer(entnahme);
  assert.deepEqual(bleibtZeile(layout), {
    kind: 'columns',
    columns: [{ text: 'Bleibt in der Kassenlade', width: 8, align: 'left' }, { text: '150,00', width: 4, align: 'right' }],
    bold: true,
  });
  const text = raster(layout, 48);
  // Direkt unter Differenz (kein Kommentar), vor der Linie zum Unbar-Block.
  assert.match(text, /^Differenz +0,00\nEntnommen +-140,00\nBleibt in der Kassenlade +150,00\n-+$/m);
  const grid = renderReceiptGrid(layout, { charsPerLine: 48 });
  assert.deepEqual(grid.lines.filter((z) => z.bold && z.kind === 'columns').map((z) => z.text.replace(/ +/g, ' ').trim()), ['Bleibt in der Kassenlade 150,00']);
  // Die Entnahme steht nicht unter „Bewegungen“ (eigene Zeilen unter dem Ergebnis).
  assert.doesNotMatch(text, /Abschöpfung/);
  const einlage = raster(layoutFuer(quelle('closeMyShift/success_manager_put_in')), 48);
  assert.match(einlage, /^Eingelegt +10,00\nBleibt in der Kassenlade +300,00$/m);
  assert.doesNotMatch(einlage, /Entnommen/);
  // Blind: „Bleibt“ ist null, die Entnahme bleibt sichtbar.
  const blind = structuredClone(entnahme);
  Object.assign(blind, { blind: true, expectedCents: null, countedCents: null, differenceCents: null, cashSalesCents: null, cashCancellationsCents: null, leftInDrawerCents: null });
  const blindText = raster(layoutFuer(blind), 48);
  assert.match(blindText, /^Entnommen +-140,00$/m);
  assert.doesNotMatch(blindText, /Bleibt/);
  // Ohne afterCount: keine der Zeilen, kein fettes Spaltenpaar (der Bon bleibt wie bisher).
  const ohne = layoutFuer(quelle('closeMyShift/success_manager'));
  assert.ok(ohne.lines.every((z) => z.kind !== 'columns' || z.bold === undefined));
  assert.doesNotMatch(raster(ohne, 48), /Entnommen|Eingelegt|Bleibt/);
  // Eine kuenftige Art druckt keine Betragszeile, „Bleibt“ steht trotzdem.
  const fremd = structuredClone(entnahme);
  fremd.afterCount = { type: 'gibtsnicht', amountCents: 5 };
  const fremdText = raster(layoutFuer(fremd), 48);
  assert.doesNotMatch(fremdText, /Entnommen|Eingelegt/);
  assert.match(fremdText, /^Bleibt in der Kassenlade +150,00$/m);
});

test('Titel nach Art, kein Hinweis „Kein Registrierkassenbeleg“ (Nachtrag 1)', () => {
  const titel = (bon: Json) => layoutFuer(bon).lines.find((z) => z.kind === 'banner');
  assert.deepEqual(titel(quelle('closeMyShift/success_manager')), { kind: 'banner', text: 'Schichtabschluss', tone: 'receipt_type' });
  assert.deepEqual(titel(quelle('getMyShiftReport/success_manager')), { kind: 'banner', text: 'Zwischenbericht', tone: 'receipt_type' });
  assert.deepEqual(titel(quelle('recordMyCashMovement/success_manager_cash_drop')), { kind: 'banner', text: 'Kassenbewegung', tone: 'receipt_type' });
  for (const pfad of ['closeMyShift/success_manager', 'getMyShiftReport/success_cashier', 'recordMyCashMovement/success_owner_without_shift']) {
    const layout = layoutFuer(quelle(pfad));
    for (const zeichen of [32, 48]) assert.doesNotMatch(raster(layout, zeichen), /Registrierkassenbeleg/, pfad);
    assert.notDeepEqual(layout.lines.at(-1), { kind: 'rule', char: '-' }, `${pfad}: keine Linie ohne Fuss`);
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

test('Trinkgeld je Mitarbeiter: verdient immer, ueber Lohn, schon genommen und offen nur ungleich 0 (Nachtrag 3, R51)', () => {
  // Z-Bon: Ben Kellner 4,00 sofort, beim Abschluss ausgezahlt, nichts offen.
  const z = raster(layoutFuer(quelle('closeMyShift/success_manager')), 48);
  // Ab der Ueberschrift „Trinkgeld“ (Zeilen auf die Breite aufgefuellt).
  const block = (text: string) => { const i = text.search(/^Trinkgeld +$/m); return i < 0 ? '' : text.slice(i); };
  assert.match(block(z), /^Ben Kellner +$/m);
  assert.match(block(z), /^ {2}verdient +4,00$/m);
  assert.match(block(z), /^ {2}schon genommen +4,00$/m);
  assert.doesNotMatch(block(z), /über Lohn|offen|sofort|0,00/);
  // X-Bon: noch nichts genommen, 4,00 offen.
  const x = raster(layoutFuer(quelle('getMyShiftReport/success_manager')), 48);
  assert.match(block(x), /^ {2}verdient +4,00$/m);
  assert.match(block(x), /^ {2}offen +4,00$/m);
  assert.doesNotMatch(block(x), /schon genommen|über Lohn|0,00/);
  // Wer ueberall 0 hat, entfaellt ganz -- ohne Mitarbeiter auch keine Ueberschrift.
  const bon = structuredClone(quelle('getMyShiftReport/success_manager'));
  bon.tips = bon.tips.map((t: Json) => ({ ...t, receivedImmediatelyCents: 0, retainedCents: 0, paidOutCents: 0, openCents: 0 }));
  assert.equal(block(raster(layoutFuer(bon), 48)), '');
  assert.doesNotMatch(raster(layoutFuer(bon), 48), /Ben Kellner/);
});

test('Trinkgeld: „aus früheren Schichten“ als erste Zeile, nur wenn nicht 0 (Fix-Runde 2, R64)', () => {
  const bon = structuredClone(quelle('getMyShiftReport/success_manager'));
  bon.tips = bon.tips.map((t: Json) => ({ ...t, carriedOverCents: 600, receivedImmediatelyCents: 900, retainedCents: 0, paidOutCents: 0, refundedByEmployeeCents: 0, openCents: 1500 }));
  const block = (text: string) => { const i = text.search(/^Trinkgeld +$/m); return i < 0 ? '' : text.slice(i); };
  const b = block(raster(layoutFuer(bon), 48));
  assert.match(b, /^Ben Kellner +\n {2}aus früheren Schichten +6,00\n {2}verdient +9,00\n {2}offen +15,00$/m);
});

test('Trinkgeld: ein negatives „offen“ steht mit Minus (Storno aus der Lade nach dem Auszahlen, Nachtrag 5)', () => {
  const bon = structuredClone(quelle('getMyShiftReport/success_manager'));
  bon.tips = bon.tips.map((t: Json) => ({ ...t, receivedImmediatelyCents: 0, retainedCents: 0, paidOutCents: 150, openCents: -150 }));
  const block = (text: string) => { const i = text.search(/^Trinkgeld +$/m); return i < 0 ? '' : text.slice(i); };
  const b = block(raster(layoutFuer(bon), 48));
  assert.match(b, /^ {2}verdient +0,00$/m);
  assert.match(b, /^ {2}schon genommen +1,50$/m);
  assert.match(b, /^ {2}offen +-1,50$/m);
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
  // Bank/Tresor ist freiwillig: ohne Ort keine Zeile „Ort“, die Art heisst „Wechselgeld“.
  const wechselgeld = raster(layoutFuer(quelle('recordMyCashMovement/success_manager_change_in_without_location')), 48);
  assert.match(wechselgeld, /^Art +Wechselgeld$/m);
  assert.match(wechselgeld, /Betrag +30,00/);
  assert.doesNotMatch(wechselgeld, /Ort|Bank|Tresor/);
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
