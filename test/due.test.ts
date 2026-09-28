import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { receiptDueCents, receiptDueBreakdown, type ReceiptDueOptions } from '../src/receipt/due.js';
import * as wurzel from '../src/index.js';
import { fromReceiptItemPayload, fromVoucherPayload, type ReceiptItem, type Voucher, type VoucherPayload } from '../src/models/index.js';
import { VatRate } from '../src/enums/index.js';

/*
 * Zahlbetrag als Zwilling des Backends (Nachtrag §8): jeder Fall aus
 * `fixtures/v3/zahlbetrag-faelle.json` muss auf den Cent stimmen. Die Datei
 * kommt aus dem echten Kern (beleg-toepfe + zahlungen-core + tip-core) und
 * ist bei `verifiedBy: createReceipt|cancelReceipt` gegen den echten Handler
 * geprueft; hier wird nichts nachgerechnet, nur verglichen.
 */

interface Fall {
  name: string;
  verifiedBy: string;
  input: {
    receiptType: string;
    items: Array<Record<string, unknown>>;
    vouchers: Array<Record<string, unknown>>;
    tip?: { cents: number; receivedImmediately?: boolean; owner?: boolean };
  };
  expected: {
    dueCents: number;
    counterDeltaCents: number;
    valueVoucherFlowCents: number;
    bucketsCents: Record<string, number> | null;
  };
  serverItems?: Array<Record<string, unknown>>;
}

const datei = fileURLToPath(new URL('../../fixtures/v3/zahlbetrag-faelle.json', import.meta.url));
const FAELLE = (JSON.parse(readFileSync(datei, 'utf8')) as { cases: Fall[] }).cases;

/** Positionen/Gutscheine der Datei in die Modelle, die ein Aufrufer an sellReceipt gibt. */
const positionen = (roh: Array<Record<string, unknown>>): ReceiptItem[] => roh.map((p) => fromReceiptItemPayload(p));
const gutscheine = (roh: Array<Record<string, unknown>>): Voucher[] => roh.map((v) => fromVoucherPayload(v as unknown as VoucherPayload));
/** Der Vertrag rechnet Personal-Trinkgeld ohne Empfaenger, Inhaber-Trinkgeld mit einem Inhaber als Empfaenger. */
const trinkgeld = (tip: Fall['input']['tip']): ReceiptDueOptions =>
  tip == null ? {} : { tip: tip.cents, tipRecipient: tip.owner === true ? 'owner' : 'staff' };

test('Zahlbetrag-Faelle: die Datei deckt alle Arten ab (sonst prueft der Zwilling zu wenig)', () => {
  const namen = FAELLE.map((f) => f.name);
  assert.ok(FAELLE.length >= 20, `nur ${FAELLE.length} Faelle`);
  for (const muster of [/^promo_/, /^value_voucher_/, /^tip_staff/, /^tip_owner/, /^cancellation_/, /float/, /decimal/, /^zero/]) {
    assert.ok(namen.some((n) => muster.test(n)), `kein Fall zu ${muster}`);
  }
});

for (const fall of FAELLE) {
  test(`receiptDueBreakdown: ${fall.name} stimmt exakt (${fall.verifiedBy})`, () => {
    const ergebnis = receiptDueBreakdown(
      positionen(fall.input.items),
      gutscheine(fall.input.vouchers),
      fall.input.receiptType,
      trinkgeld(fall.input.tip),
    );
    assert.deepEqual(ergebnis, fall.expected);
    assert.equal(
      receiptDueCents(positionen(fall.input.items), gutscheine(fall.input.vouchers), fall.input.receiptType, trinkgeld(fall.input.tip)),
      fall.expected.dueCents,
    );
  });
}

test('Trinkgeld als fertige Position (so steht es im Beleg und im Storno) ergibt denselben Betrag wie der Parameter tip', () => {
  const mitPositionen = FAELLE.filter((f) => f.serverItems != null);
  assert.ok(mitPositionen.length >= 3);
  for (const fall of mitPositionen) {
    const alle = [...positionen(fall.input.items), ...positionen(fall.serverItems!)];
    assert.equal(receiptDueCents(alle, gutscheine(fall.input.vouchers), fall.input.receiptType), fall.expected.dueCents, fall.name);
  }
});

test('Trinkgeld als Zahl bei Personal-Anmeldung', () => {
  const fall = FAELLE.find((f) => f.name === 'tip_staff')!;
  assert.equal(receiptDueCents(positionen(fall.input.items), [], 'standard', { tip: 160, tipRecipient: 'staff' }), fall.expected.dueCents);
});

test('Inhaber-Trinkgeld ist Umsatz und wird rabattiert, Personal-Trinkgeld nie', () => {
  // Rabatt groesser als die Ware: beim Personal bleibt das Trinkgeld voll,
  // beim Inhaber verschwindet es im Rabatt (Deckel = Ware + Inhaber-Trinkgeld).
  const ware = [{ name: 'Semmel', quantity: 1, priceCents: 100, vat: VatRate.vat10 }];
  const rabatt: Voucher[] = [{ action: 'redeem', type: 'promo', valueCents: 500, code: 'R' }];
  assert.equal(receiptDueCents(ware, rabatt, 'standard', { tip: 50, tipRecipient: 'staff' }), 50);
  assert.equal(receiptDueCents(ware, rabatt, 'standard', { tip: 50, tipRecipient: 'owner' }), 0);
  assert.equal(receiptDueCents(ware, rabatt, 'standard', { tip: { cents: 50, recipients: [{ cents: 50, owner: true }] } }), 0);
});

test('Ergebnis ist immer ein ganzer Cent-Betrag, die Eingaben bleiben unveraendert', () => {
  for (const fall of FAELLE) {
    const items = positionen(fall.input.items);
    const vouchers = gutscheine(fall.input.vouchers);
    const vorher = JSON.stringify([items, vouchers]);
    const e = receiptDueBreakdown(items, vouchers, fall.input.receiptType, trinkgeld(fall.input.tip));
    for (const wert of [e.dueCents, e.counterDeltaCents, e.valueVoucherFlowCents, ...Object.values(e.bucketsCents ?? {})]) {
      assert.ok(Number.isSafeInteger(wert), `${fall.name}: ${wert}`);
    }
    assert.equal(JSON.stringify([items, vouchers]), vorher, `${fall.name}: Eingabe veraendert`);
  }
});

test('Kein Gleitkomma-Fehler: 3 x 0,10 + 7 x 0,70 ergibt 5,20, nicht 5,19', () => {
  const items = [
    { name: 'A', quantity: 3, priceCents: 10, vat: VatRate.vat20 },
    { name: 'B', quantity: 7, priceCents: 70, vat: VatRate.vat10 },
  ];
  assert.equal(receiptDueCents(items, [], 'standard'), 520);
});

test('Belegtyp als Enum-Eintrag wie als Text; Null- und Startbeleg sind 0', () => {
  const items = [{ name: 'A', quantity: 2, priceCents: 320, vat: VatRate.vat20 }];
  assert.equal(receiptDueCents(items, [], wurzel.ReceiptType.standard), 640);
  assert.equal(receiptDueCents([], [], 'start'), 0);
  assert.equal(receiptDueCents([], [], wurzel.ReceiptType.zero), 0);
});

test('Unbrauchbare Eingaben werfen statt still falsch zu rechnen', () => {
  const gut = { name: 'A', quantity: 1, priceCents: 100, vat: VatRate.vat20 };
  assert.throws(() => receiptDueCents([{ ...gut, priceCents: 1.5 }], [], 'standard'), RangeError);
  assert.throws(() => receiptDueCents([{ ...gut, quantity: Number.NaN }], [], 'standard'), RangeError);
  assert.throws(() => receiptDueCents([gut], [{ action: 'redeem', type: 'value', valueCents: 0.5 }], 'standard'), RangeError);
  assert.throws(() => receiptDueCents([gut], [], 'rechnung'), RangeError);
  assert.throws(() => receiptDueCents([gut], [], 'zero', { tip: 100, tipRecipient: 'staff' }), RangeError);
  // Trinkgeld ohne Ware hat keine Basis (Backend: FEHLER_KEINE_WARE).
  assert.throws(() => receiptDueCents([], [], 'standard', { tip: 100, tipRecipient: 'owner' }), RangeError);
  // Wer das Trinkgeld bekommt, entscheidet der Server am angemeldeten Benutzer: ohne Angabe kein Raten.
  assert.throws(() => receiptDueCents([gut], [], 'standard', { tip: 100 }), /tipRecipient/);
  assert.throws(() => receiptDueCents([gut], [], 'standard', { payments: [{ method: 'cash', tipCents: 10 }] }), /tipRecipient/);
  // tip und payments[].tipCents zugleich weist der Server ab (tip_conflict).
  assert.throws(() => receiptDueCents([gut], [], 'standard', { tip: 10, tipRecipient: 'staff', payments: [{ method: 'cash', tipCents: 10 }] }), /tip_conflict/);
});

test('Paketwurzel und ./receipt exportieren den Zwilling', async () => {
  assert.equal(wurzel.receiptDueCents, receiptDueCents);
  assert.equal(wurzel.receiptDueBreakdown, receiptDueBreakdown);
  const beleg = await import('../src/receipt/index.js');
  assert.equal(beleg.receiptDueCents, receiptDueCents);
});

// --- Generierte Faelle (echter Backend-Code, scripts/v3-zahlbetrag-generieren.mjs) --------

interface GenFall {
  name: string;
  input: {
    receiptType: string;
    items: Array<{ name: string; quantity: number; priceCents: number; vatRate: number; kind?: 'tip'; owner?: boolean }>;
    vouchers: Array<{ action: string; type: string; valueCents: number }>;
    tip?: ReceiptDueOptions['tip'];
    payments?: ReceiptDueOptions['payments'];
    tipRecipient?: ReceiptDueOptions['tipRecipient'];
  };
  expected: Fall['expected'] | { error: string };
}
const generiert = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/receipt-due-generated.json', import.meta.url)), 'utf8')) as { cases: GenFall[] };

function genRechnen(f: GenFall) {
  const items: ReceiptItem[] = f.input.items.map((p) => ({
    name: p.name, quantity: p.quantity, priceCents: p.priceCents, vat: p.vatRate,
    ...(p.kind === 'tip' ? { kind: 'tip' as const, recipient: p.owner ? { registerUserId: 'ru', name: 'I', owner: true } : null } : {}),
  }));
  return receiptDueBreakdown(items, f.input.vouchers, f.input.receiptType, { tip: f.input.tip, payments: f.input.payments, tipRecipient: f.input.tipRecipient });
}

test('Generierte Faelle: mindestens 1000, mit Bruchmengen, Gutscheinen, Trinkgeld und tipCents', () => {
  const c = generiert.cases;
  assert.ok(c.length >= 1000, `nur ${c.length}`);
  assert.ok(c.filter((f) => f.input.items.some((p) => !Number.isInteger(p.quantity))).length >= 300);
  assert.ok(c.some((f) => f.input.vouchers.some((v) => v.type === 'promo')));
  assert.ok(c.some((f) => f.input.vouchers.some((v) => v.type === 'value')));
  assert.ok(c.some((f) => f.input.tipRecipient === 'owner' && f.input.tip != null));
  assert.ok(c.some((f) => f.input.tipRecipient === 'staff' && f.input.tip != null));
  assert.ok(c.some((f) => f.input.payments?.some((z) => z.tipCents != null)));
  assert.ok(c.some((f) => f.input.receiptType === 'cancellation' && f.input.items.some((p) => p.kind === 'tip')));
});

test('Generierte Faelle: jeder stimmt exakt mit dem Backend ueberein', () => {
  const abweichend: string[] = [];
  for (const f of generiert.cases) {
    if ('error' in f.expected) {
      if (!(() => { try { genRechnen(f); return false; } catch { return true; } })()) abweichend.push(`${f.name}: Fehler erwartet`);
      continue;
    }
    let ist: unknown;
    try {
      ist = genRechnen(f);
    } catch (e) {
      ist = String(e);
    }
    try {
      assert.deepEqual(ist, f.expected);
    } catch {
      abweichend.push(`${f.name}: ${JSON.stringify(ist)} statt ${JSON.stringify(f.expected)}`);
    }
  }
  assert.deepEqual(abweichend.slice(0, 5), [], `${abweichend.length} Abweichungen`);
});

test('Review-Faelle: 0,5 x 29 ct ist 14, der Mischfall ist 464, die Inhaber-Aufteilung 48/96', () => {
  const nach = (name: string) => genRechnen(generiert.cases.find((f) => f.name === name)!);
  assert.equal(nach('half_cent_single').dueCents, 14);
  assert.equal(nach('half_cent_promo_value_staff_tip').dueCents, 464);
  assert.deepEqual([nach('half_cent_owner_split').bucketsCents?.amountRateStandard, nach('half_cent_owner_split').bucketsCents?.amountRateReduced1], [48, 96]);
  assert.equal(nach('owner_login_promo_exceeds').dueCents, 0);
});
