import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { fromReceiptPayload, type Receipt } from '../src/models/index.js';
import { buildReceiptLayout, receiptNotes, type BuildReceiptLayoutOptions, type ReceiptNote } from '../src/receipt/index.js';
import { isKasseneckValidationError } from '../src/client/errors.js';

/*
 * Vermerke eines Belegs als strukturierte Form (Kassenteil auf der Rechnung,
 * Zahlungsbestaetigung): dieselben Bausteine wie der Bon, nur ohne Zeilenmodell.
 * Reihenfolge fest: Testkasse, Testsignatur, Training, Storno, Nacherfassung,
 * Signaturausfall.
 */

const wurzel = new URL('../../fixtures/', import.meta.url);

interface Fixture {
  company: Parameters<typeof buildReceiptLayout>[1];
  receipt: Record<string, unknown> & { customerDetails: string[]; legalMessage: string[] };
  options?: BuildReceiptLayoutOptions;
}

const lade = (name: string): Fixture => JSON.parse(readFileSync(new URL(`receipts/${name}.json`, wurzel), 'utf8')) as Fixture;
const belegVon = (f: Fixture): Receipt =>
  fromReceiptPayload({ ...f.receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never);
const beleg = (name: string): Receipt => belegVon(lade(name));
const arten = (vermerke: ReceiptNote[]): string[] => vermerke.map((v) => v.kind);

test('Signaturausfall: genau der Vermerk „Sicherheitseinrichtung ausgefallen“ ohne Zeilen', () => {
  assert.deepEqual(receiptNotes(beleg('signature-outage-sale'), {}), [
    { kind: 'signature_outage', title: 'Sicherheitseinrichtung ausgefallen', lines: [] },
  ]);
});

test('Storno: Titel STORNOBELEG, darunter der Bezug, das Datum des Originals und der Grund', () => {
  const vermerke = receiptNotes(beleg('cancellation-full'), {});
  assert.equal(vermerke[0]!.kind, 'cancellation');
  assert.equal(vermerke[0]!.title, 'STORNOBELEG');
  assert.ok(vermerke[0]!.lines[0]!.startsWith('Stornobuchung zu Beleg'), vermerke[0]!.lines[0]);
  assert.deepEqual(vermerke[0]!.lines, ['Stornobuchung zu Beleg AT0-KASSE1-42', 'vom 11.08.2026, 09:02 Uhr', 'Grund: Kunde hat storniert']);
});

test('Testkasse und Training: Reihenfolge Testkasse vor Training', () => {
  const vermerke = receiptNotes(beleg('training'), { testCashregister: true });
  assert.deepEqual(arten(vermerke), ['test_cashregister', 'training']);
  assert.equal(vermerke[1]!.title, 'TRAININGSBELEG');
  assert.ok(vermerke[1]!.lines[0]!.startsWith('Trainingsbuchung'), vermerke[1]!.lines[0]);
});

test('Normalbeleg: keine Vermerke', () => {
  assert.deepEqual(receiptNotes(beleg('sale-cash'), {}), []);
  // Ohne Optionen dasselbe.
  assert.deepEqual(receiptNotes(beleg('sale-cash')), []);
});

test('alle Vermerke zugleich stehen in der festen Reihenfolge', () => {
  const f = lade('cancellation-full');
  const r = belegVon({
    ...f,
    receipt: {
      ...f.receipt,
      sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.U2ljaGVyaGVpdHNlaW5yaWNodHVuZyBhdXNnZWZhbGxlbg',
      manualReceipt: { number: '233', date: '2026-08-12', time: '16:48', reason: 'power_outage' },
    },
  });
  const vermerke = receiptNotes(r, { testCashregister: true, testSignature: true });
  assert.deepEqual(arten(vermerke), ['test_cashregister', 'test_signature', 'cancellation', 'manual_receipt', 'signature_outage']);
  const training = receiptNotes(beleg('training'), { testSignature: true });
  assert.deepEqual(arten(training), ['test_signature', 'training']);
});

test('Nacherfassung: Titel NACHERFASSUNG, Anlass, Grund, Nummer und Tag des Handbelegs (ohne USt-Hinweis, der haengt an der Firma)', () => {
  const vermerke = receiptNotes(beleg('manual-receipt-single-power-outage-time'), {});
  assert.deepEqual(vermerke, [{
    kind: 'manual_receipt',
    title: 'NACHERFASSUNG',
    lines: ['nach Ausfall der Kasse', 'Grund: Strom', 'Handbeleg Nr. 233', 'vom 03.11.2026, 16:48 Uhr'],
  }]);
  const sammel = receiptNotes(beleg('manual-receipt-range-power-outage-count'), {});
  assert.deepEqual(sammel[0]!.lines.slice(2), ['Tagessammelbeleg', 'Handbelege Nr. 201 bis 248', '48 Belege vom 03.11.2026']);
});

test('Zahlungsbeleg nacherfasst: der Vermerk wie jeder, am Bon kein „USt: Duplikat …“ (die Steuer steht auf der Rechnung)', () => {
  const f = lade('invoice-payment-manual-receipt');
  const vermerke = receiptNotes(belegVon(f), {});
  assert.deepEqual(vermerke, [{
    kind: 'manual_receipt',
    title: 'NACHERFASSUNG',
    lines: ['nach Ausfall der Kasse', 'Grund: Strom', 'Handbeleg Nr. 0815', 'vom 10.11.2026, 16:30 Uhr'],
  }]);
  const texte = (name: string): string[] => {
    const g = lade(name);
    return buildReceiptLayout(belegVon(g), g.company, g.options ?? {}).lines.flatMap((z) => (z.kind === 'text' ? [z.text] : []));
  };
  assert.ok(!texte('invoice-payment-manual-receipt').some((t) => t.startsWith('USt: Duplikat')));
  // Gegenprobe: derselbe Bausatz am Warenbeleg traegt den Hinweis.
  assert.ok(texte('manual-receipt-single-power-outage-time').includes('USt: Duplikat des Handbelegs'));
});

test('Testkasse und Testsignatur: Titel wie die Warnrahmen am Bon, ohne Zeilen', () => {
  const vermerke = receiptNotes(beleg('sale-cash'), { testCashregister: true, testSignature: true });
  assert.deepEqual(vermerke, [
    { kind: 'test_cashregister', title: 'TESTKASSE — kein gültiger Beleg', lines: [] },
    { kind: 'test_signature', title: 'TESTSIGNATUR — kein gültiger Beleg', lines: [] },
  ]);
});

test('Optionen: eine unbekannte oder alte deutsche Option wird abgewiesen (sonst fehlte der Testkasse-Vermerk still)', () => {
  const r = beleg('sale-cash');
  assert.throws(() => receiptNotes(r, { testKasse: true } as never), (e: unknown) => isKasseneckValidationError(e) && /testCashregister/.test((e as Error).message));
  assert.throws(() => receiptNotes(r, { duplikat: true } as never), (e: unknown) => isKasseneckValidationError(e) && /duplikat/.test((e as Error).message));
});

/**
 * Eine Quelle fuer die Regeln: was `receiptNotes` sagt, steht am Bon genau so
 * (Titel als Banner bzw. Zeile, jede Zeile als Textzeile). Fuer jeden Golden-Beleg.
 */
test('Bon und Vermerke sagen dasselbe: jeder Vermerk steht mit Titel und Zeilen im Layout jedes Golden-Belegs', () => {
  const namen = readdirSync(new URL('receipts/', wurzel)).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));
  let mitVermerk = 0;
  for (const name of namen) {
    const f = lade(name);
    const r = belegVon(f);
    const optionen = { testCashregister: f.options?.testCashregister, testSignature: f.options?.testSignature };
    const layout = buildReceiptLayout(r, f.company, f.options ?? {});
    const texte = layout.lines.flatMap((z) => (z.kind === 'text' || z.kind === 'banner' ? [z.text] : []));
    for (const v of receiptNotes(r, optionen)) {
      // Nullbelege setzt der Bon reduziert, ohne Nacherfassung.
      if (v.kind === 'manual_receipt' && /^zero/.test(name)) continue;
      assert.ok(texte.includes(v.title), `${name}: Titel „${v.title}“ fehlt am Bon`);
      for (const zeile of v.lines) assert.ok(texte.includes(zeile), `${name}: Zeile „${zeile}“ fehlt am Bon`);
      mitVermerk += 1;
    }
  }
  assert.ok(mitVermerk >= 20, `nur ${mitVermerk} Vermerke geprueft`);
});
