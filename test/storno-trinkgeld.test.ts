import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  asksTipRefundSource,
  cancellationCashRefundCents,
  cancellationItemsForTip,
  CANCELLATION_ERROR_CODES,
  fromReceiptPayload,
  isTipRefundSource,
  openStaffTipCents,
  TIP_REFUND_SOURCES,
  type CancellationItem,
  type Receipt,
  type ReceiptPayloadRead,
  type ReceiptPaymentInput,
} from '../src/models/index.js';
import { cancelReceipt } from '../src/client/receipts.js';
import { labelText, messageText } from '../src/pos/index.js';

/*
 * Storno mit oder ohne Trinkgeld (Schichten-Spec, Nachtrag 5, R56–R58): die Regeln der beiden
 * Fragen gegen die gemeinsamen Faelle (fixtures/cancellation-tip-cases.json), die der Dart-Zwilling
 * ebenso abspielt, und die Parameter refundTip/tipRefundSource an cancelReceipt.
 */

type Faelle = {
  receipts: Record<string, Record<string, unknown>>;
  openStaffTipCents: Array<{ receipt: string; expected: number }>;
  cancellationItemsForTip: Array<{ receipt: string; items: CancellationItem[] | null; refundTip: boolean; expected: CancellationItem[] | null }>;
  asksTipRefundSource: Array<{ receipt: string; cashRefundCents: number; expected: boolean }>;
  cancellationCashRefundCents: Array<{ receipt: string; payments: ReceiptPaymentInput[] | null; dueCents: number; expected: number }>;
};
const FAELLE = JSON.parse(readFileSync(new URL('../../fixtures/cancellation-tip-cases.json', import.meta.url), 'utf8')) as Faelle;

// Pflichtfelder eines gelesenen Belegs; die Faelle tragen nur, was die Regeln lesen.
const BASIS = {
  qr: 'QR', sig: 'SIG', certificateSerialNumber: 'C', signaturePreviousReceipt: 'P', turnoverCounterAES256ICM: 'T',
  timeStamp: '2026-10-14T10:00:00', cashregisterId: 'kasse-1', receiptType: 'standard', receiptId: 'kasse-1-ID-12',
  fullReceiptId: 'F', creditCardProvider: null, cardPaymentId: null, cardPaymentData: null, customerDetails: '',
  legalMessage: '', signatureSuccess: true, customProjectId: null,
};
function beleg(name: string): Receipt {
  const roh = FAELLE.receipts[name];
  assert.ok(roh, `Beleg ${name} fehlt in den Faellen`);
  return fromReceiptPayload({ ...BASIS, ...roh } as unknown as ReceiptPayloadRead);
}
const JETZT = 1_800_000_000_000;

test('openStaffTipCents: die gemeinsamen Faelle', () => {
  assert.ok(FAELLE.openStaffTipCents.length >= 6);
  for (const f of FAELLE.openStaffTipCents) assert.equal(openStaffTipCents(beleg(f.receipt), JETZT), f.expected, f.receipt);
});

test('cancellationItemsForTip: die gemeinsamen Faelle', () => {
  assert.ok(FAELLE.cancellationItemsForTip.length >= 10);
  for (const f of FAELLE.cancellationItemsForTip) {
    const raus = cancellationItemsForTip(beleg(f.receipt), f.items ?? undefined, f.refundTip, JETZT);
    assert.deepEqual(raus ?? null, f.expected, `${f.receipt} ${JSON.stringify(f.items)} ${f.refundTip}`);
  }
});

test('asksTipRefundSource: die gemeinsamen Faelle', () => {
  assert.ok(FAELLE.asksTipRefundSource.length >= 8);
  for (const f of FAELLE.asksTipRefundSource) assert.equal(asksTipRefundSource(beleg(f.receipt), f.cashRefundCents, JETZT), f.expected, `${f.receipt} ${f.cashRefundCents}`);
});

test('cancellationCashRefundCents: die gemeinsamen Faelle', () => {
  assert.ok(FAELLE.cancellationCashRefundCents.length >= 6);
  for (const f of FAELLE.cancellationCashRefundCents) {
    assert.equal(cancellationCashRefundCents(beleg(f.receipt), f.payments ?? undefined, f.dueCents), f.expected, `${f.receipt} ${JSON.stringify(f.payments)}`);
  }
});

test('Quellen und Fehlercodes wie unter /v3', () => {
  assert.deepEqual([...TIP_REFUND_SOURCES], ['drawer', 'employee']);
  assert.equal(isTipRefundSource('employee'), true);
  assert.equal(isTipRefundSource('mitarbeiter'), false);
  const codes = [...CANCELLATION_ERROR_CODES];
  const ab = codes.indexOf('invalid_return_disposition');
  assert.deepEqual(codes.slice(ab + 1, ab + 4), ['tip_refund_conflict', 'invalid_tip_refund_source', 'tip_refund_source_requires_cash']);
});

test('Texte der beiden Fragen und der Hinweis zur Einstellung', () => {
  assert.equal(labelText('cancellation.tip_refund_question'), 'Trinkgeld auch zurückgeben?');
  assert.equal(labelText('cancellation.tip_refund_yes'), 'Ja');
  assert.equal(labelText('cancellation.tip_refund_no'), 'Nein');
  assert.equal(labelText('cancellation.tip_source_question'), 'Woher kommt das Trinkgeld zurück?');
  assert.equal(labelText('cancellation.tip_source_drawer'), 'Aus der Lade');
  assert.equal(labelText('cancellation.tip_source_employee'), 'Gibt die Mitarbeiterin direkt');
  assert.equal(messageText('cancellation.tip_refund_missing'), 'Bitte wählen: Trinkgeld auch zurückgeben?');
  assert.equal(messageText('cancellation.tip_source_missing'), 'Bitte wählen: Woher kommt das Trinkgeld zurück?');
  assert.match(messageText('tip.kept_setting_hint'), /zählt nicht ins Soll der Lade/);
});

// --- cancelReceipt: refundTip und tipRefundSource ----------------------------------------------

function transport(): { rufen: (name: string, params: Record<string, unknown>) => Promise<unknown>; gesendet: Array<Record<string, unknown>> } {
  const gesendet: Array<Record<string, unknown>> = [];
  const antwort = {
    receipt: { ...BASIS, receiptType: 'cancellation', receiptId: 'kasse-1-ID-13', paymentMethod: 'cash', items: [{ name: 'Kaffee', quantity: 2, unitPriceCents: -280, vatRate: 20 }] },
    cancellationOf: { receiptId: 'kasse-1-ID-12', fullReceiptId: 'F' },
    remaining: [0, 0, 1],
  };
  return { gesendet, rufen: async (_name, params) => { gesendet.push(params); return antwort; } };
}
const STORNO = { cashregisterId: 'kasse-1', originalReceiptId: 'kasse-1-ID-12', reason: 'customer_cancelled' as const };

test('cancelReceipt: refundTip und tipRefundSource gehen hinaus, ohne beides bleibt die Nutzlast gleich', async () => {
  const t = transport();
  await cancelReceipt(t.rufen as never, { ...STORNO, refundTip: true, tipRefundSource: 'employee' });
  await cancelReceipt(t.rufen as never, { ...STORNO, refundTip: false, items: [{ index: 0, quantity: 2 }] });
  await cancelReceipt(t.rufen as never, { ...STORNO });
  assert.deepEqual(t.gesendet[0], { ...STORNO, refundTip: true, tipRefundSource: 'employee' });
  assert.deepEqual(t.gesendet[1], { ...STORNO, items: [{ index: 0, quantity: 2 }], refundTip: false });
  assert.deepEqual(t.gesendet[2], { ...STORNO });
});

test('cancelReceipt: falsche Wahl wirft vor dem Senden', async () => {
  const t = transport();
  await assert.rejects(cancelReceipt(t.rufen as never, { ...STORNO, tipRefundSource: 'mitarbeiter' as never }), /tipRefundSource/);
  await assert.rejects(cancelReceipt(t.rufen as never, { ...STORNO, refundTip: 'ja' as never }), /refundTip/);
  await assert.rejects(cancelReceipt(t.rufen as never, { ...STORNO, refundTip: false, tipRefundSource: 'drawer' }), /tipRefundSource/);
  assert.equal(t.gesendet.length, 0);
});
