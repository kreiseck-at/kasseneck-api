import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  depositAmountOn, depositReturnLine, depositsFor, viennaDay, withDepositLines,
  type DepositEntry, type DepositPreviewInput, type DepositType,
} from '../src/pos/index.js';
import { VatRate } from '../src/enums/index.js';

interface Fall {
  name: string;
  input: DepositPreviewInput & { items: object[] };
  expected: { items: Record<string, unknown>[] } | { code: string };
}
const datei = JSON.parse(readFileSync(new URL('../../fixtures/deposit-cases.json', import.meta.url), 'utf8')) as { cases: Fall[] };

test('Pruefaelle: Vorschau liefert genau die Zeilen bzw. den Code des Servers', () => {
  assert.equal(datei.cases.length, 32);
  for (const f of datei.cases) {
    const { items, ...rest } = f.input;
    const r = withDepositLines(items, rest);
    if ('code' in f.expected) assert.deepEqual(r, { ok: false, code: f.expected.code }, f.name);
    else assert.deepStrictEqual(r, { ok: true, items: f.expected.items }, f.name);
  }
});

test('Pruefaelle: Eingabe wird nicht veraendert, Karten und Objekte gleichwertig', () => {
  for (const f of datei.cases) {
    const vorher = JSON.stringify(f.input);
    const { items, ...rest } = f.input;
    const mitKarten = { ...rest, articles: new Map(Object.entries(rest.articles)), depositTypes: new Map(Object.entries(rest.depositTypes)), groups: new Map(Object.entries(rest.groups)) };
    assert.deepStrictEqual(withDepositLines(items, mitKarten), withDepositLines(items, rest), f.name);
    assert.equal(JSON.stringify(f.input), vorher, f.name);
  }
});

test('Leergutzeile: dieselbe wie in der Vorschau, als ReceiptItem', () => {
  const faelle = datei.cases.filter((f) => f.input.items.some((i) => (i as { kind?: string } | null)?.kind === 'deposit_return') && 'items' in f.expected);
  assert.ok(faelle.length >= 4);
  for (const f of faelle) {
    for (const it of f.input.items.filter(Boolean) as { kind?: string; depositTypeId: string; quantity: number; codes?: Record<string, number> }[]) {
      if (it.kind !== 'deposit_return') continue;
      const art = f.input.depositTypes instanceof Map ? f.input.depositTypes.get(it.depositTypeId)! : (f.input.depositTypes as Record<string, DepositType>)[it.depositTypeId]!;
      const z = depositReturnLine(art, it.quantity, { day: f.input.day, smallBusiness: f.input.smallBusiness, codes: it.codes });
      const soll = (f.expected as { items: Record<string, unknown>[] }).items.find((e) => e['kind'] === 'deposit_return' && e['depositTypeId'] === it.depositTypeId)!;
      assert.equal(z.priceCents, soll['unitPriceCents'], f.name);
      assert.equal(z.quantity, soll['quantity'], f.name);
      assert.equal(z.name, soll['name'], f.name);
      assert.equal(typeof z.vat === 'number' ? z.vat : (z.vat as VatRate).rate, soll['vat'], f.name);
      assert.equal(z.ean, soll['ean'], f.name);
      assert.deepEqual(z.codes, soll['codes'], f.name);
      assert.equal(z.kind, 'deposit_return');
    }
  }
});

test('Leergutzeile: unmoegliche Eingabe wirft', () => {
  const art: DepositType = { id: 'x', kind: 'single_use', name: 'Pfand X', type: null, amounts: [{ from: '2025-01-01', cents: 25 }], returnRate: null, used: true, active: true };
  assert.throws(() => depositReturnLine(art, 0, { day: '2026-11-07', smallBusiness: false }));
  assert.throws(() => depositReturnLine(art, 2, { day: '2024-12-31', smallBusiness: false }));
});

test('depositsFor: Artikel vor Gruppe, leer = kein Pfand, null = Gruppe, Fremdgutschein nie', () => {
  const g: DepositEntry[] = [{ depositTypeId: 'g', quantity: 1 }];
  const a: DepositEntry[] = [{ depositTypeId: 'a', quantity: 2 }];
  assert.deepEqual(depositsFor({ deposits: a }, { deposits: g }), a);
  assert.deepEqual(depositsFor({ deposits: [] }, { deposits: g }), []);
  assert.deepEqual(depositsFor({ deposits: null }, { deposits: g }), g);
  assert.deepEqual(depositsFor({}, { deposits: g }), g);
  assert.deepEqual(depositsFor({}, null), []);
  assert.deepEqual(depositsFor(null, { deposits: g }), []);
  assert.deepEqual(depositsFor({ deposits: a, externalVoucher: 'multi_purpose' }, { deposits: g }), []);
  assert.deepEqual(depositsFor({ deposits: null, externalVoucher: 'single_purpose' }, { deposits: g }), []);
});

test('depositAmountOn: letzter Eintrag mit from <= Tag, sonst null', () => {
  const t = { amounts: [{ from: '2025-01-01', cents: 25 }, { from: '2026-07-01', cents: 30 }] };
  assert.equal(depositAmountOn(t, '2024-12-31'), null);
  assert.equal(depositAmountOn(t, '2025-01-01'), 25);
  assert.equal(depositAmountOn(t, '2026-06-30'), 25);
  assert.equal(depositAmountOn(t, '2026-07-01'), 30);
  assert.equal(depositAmountOn({ amounts: [] }, '2026-07-01'), null);
});

test('viennaDay: Wiener Tag, nicht der UTC-Tag (Sommer- und Winterzeit)', () => {
  // Sommerzeit (UTC+2): 22:00 UTC ist schon 00:00 am Folgetag.
  assert.equal(viennaDay(Date.UTC(2026, 6, 14, 21, 59, 59)), '2026-07-14');
  assert.equal(viennaDay(Date.UTC(2026, 6, 14, 22, 0, 0)), '2026-07-15');
  // Winterzeit (UTC+1): 23:00 UTC ist 00:00 am Folgetag.
  assert.equal(viennaDay(Date.UTC(2026, 10, 7, 22, 59, 59)), '2026-11-07');
  assert.equal(viennaDay(Date.UTC(2026, 10, 7, 23, 0, 0)), '2026-11-08');
  // Jahreswechsel und Umstellungstage.
  assert.equal(viennaDay(Date.UTC(2026, 11, 31, 23, 0, 0)), '2027-01-01');
  assert.equal(viennaDay(Date.UTC(2026, 2, 29, 0, 30, 0)), '2026-03-29');
  assert.equal(viennaDay(Date.UTC(2026, 9, 24, 22, 0, 0)), '2026-10-25');
});
