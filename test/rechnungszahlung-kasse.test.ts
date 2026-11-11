import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CANCELLATION_ERROR_CODES, isCancellationErrorCode } from '../src/models/index.js';
import { cancellationErrorMessage, findErrorRule, labelText, messageText, shiftReceiptLayout, type ShiftSummaryReceipt } from '../src/pos/index.js';
import { ladeStand } from '../src/pos/schicht-lesen.js';
import type { LayoutLine } from '../src/receipt/index.js';

/*
 * Zahlung auf Rechnung an der Kasse (Spec 2026-11-11, Abschnitt 6): ein Zahlungsbeleg steht in der
 * Belegliste, storniert wird er nur im Kundenbereich bei der Rechnung. Web-Kasse und Kassen-App sagen
 * dasselbe (pos-texts.json, pos-message-cases.json); Schichtabschluss und Kassenstand zeigen die Zeile
 * „Zahlungen auf Rechnungen“.
 */

type Json = Record<string, any>;
const lies = (datei: string): Json => JSON.parse(readFileSync(new URL(`../../fixtures/${datei}`, import.meta.url), 'utf8')) as Json;
const KASSE = lies('v3/antworten/kasse.json').endpoints as Record<string, { cases: Array<{ case: string; response: Json }> }>;
const SATZ = 'Diese Zahlung gehört zu einer Rechnung. Storniere sie im Kundenbereich bei der Rechnung.';

test('Storno eines Zahlungsbelegs: eigener Code, eigener Satz der Kasse', () => {
  assert.ok(CANCELLATION_ERROR_CODES.includes('invoice_payment_not_cancellable'));
  assert.equal(isCancellationErrorCode('invoice_payment_not_cancellable'), true);
  assert.equal(messageText('cancellation.invoice_payment_not_cancellable'), SATZ);
  // Ueber die Fehlerregel (beide Kassen ordnen jeden API-Fehler so ein) und ueber den Storno-Weg.
  const regel = findErrorRule('api', { code: 'invoice_payment_not_cancellable' });
  assert.ok('key' in regel && regel.key === 'cancellation.invoice_payment_not_cancellable', JSON.stringify(regel));
  assert.equal(cancellationErrorMessage('invoice_payment_not_cancellable'), 'cancellation.invoice_payment_not_cancellable');
  // Die uebrigen Storno-Codes bleiben, wo sie waren.
  assert.equal(cancellationErrorMessage('cancellation_outcome_unknown'), 'cancellation.outcome_unknown');
  assert.equal(cancellationErrorMessage('refund_as_voucher_reason'), 'cancellation.voucher_reason');
  assert.equal(cancellationErrorMessage('not_found'), 'cancellation.failed');
  assert.equal(cancellationErrorMessage('irgendwas'), 'cancellation.failed');
});

test('Satz und Fall stehen im Vertrag der Kassen (pos-texts.json, pos-message-cases.json)', () => {
  const vertrag = lies('pos-texts.json');
  assert.equal(vertrag.messages['cancellation.invoice_payment_not_cancellable'].text, SATZ);
  assert.equal(vertrag.labels['shift_receipt.invoice_payments'].text, 'Zahlungen auf Rechnungen');
  assert.ok((vertrag.errorCodeRules as Array<{ codes: string[]; key: string }>).some((r) => r.codes.includes('invoice_payment_not_cancellable') && r.key === 'cancellation.invoice_payment_not_cancellable'));
  const faelle = lies('pos-message-cases.json').cases as Array<{ error: { code?: string }; expected: unknown }>;
  const fall = faelle.find((f) => f.error.code === 'invoice_payment_not_cancellable');
  assert.deepEqual(fall?.expected, { key: 'cancellation.invoice_payment_not_cancellable' });
});

test('Schichtzeile: „Zahlungen auf Rechnungen“', () => {
  assert.equal(labelText('shift_receipt.invoice_payments'), 'Zahlungen auf Rechnungen');
});

const zbon = (): Json => structuredClone(KASSE['closeMyShift']!.cases.find((c) => c.case === 'success_manager')!.response.data.receipt);
const paare = (zeilen: LayoutLine[]): string[][] => zeilen.flatMap((z) => (z.kind === 'columns' ? [z.columns.map((c) => c.text)] : []));

test('Z-Bon: mit Zahlungen auf Rechnungen eine Zeile mit dem Betrag, ohne sie (oder bei 0) keine', () => {
  const bon = zbon();
  bon.invoicePaymentCents = 156960;
  const mit = shiftReceiptLayout(bon as ShiftSummaryReceipt);
  assert.deepEqual(paare(mit.lines).filter(([links]) => links === 'Zahlungen auf Rechnungen'), [['Zahlungen auf Rechnungen', '1569,60']]);
  // Die Zeile steht im Informationsteil (nach der zweiten Trennlinie), nicht im Bargeldblock: das Geld steckt schon im Barumsatz.
  const regeln = mit.lines.flatMap((z, i) => (z.kind === 'rule' ? [i] : []));
  const zeile = mit.lines.findIndex((z) => z.kind === 'columns' && z.columns[0]!.text === 'Zahlungen auf Rechnungen');
  assert.ok(zeile > regeln[1]!, `Zeile ${zeile}, Trennlinien ${regeln.join(',')}`);
  const ohne = shiftReceiptLayout(zbon() as ShiftSummaryReceipt);
  assert.equal(mit.lines.length, ohne.lines.length + 1);
  const null_ = zbon();
  null_.invoicePaymentCents = 0;
  assert.deepEqual(shiftReceiptLayout(null_ as ShiftSummaryReceipt), ohne);
  // Storno ueberwiegt (negativ): die Zeile steht mit Vorzeichen.
  const negativ = zbon();
  negativ.invoicePaymentCents = -4990;
  assert.ok(paare(shiftReceiptLayout(negativ as ShiftSummaryReceipt).lines).some(([l, r]) => l === 'Zahlungen auf Rechnungen' && r === '-49,90'));
  // Kein ganzzahliger Betrag: abgewiesen wie jeder andere Betrag des Bons.
  const kaputt = zbon();
  kaputt.invoicePaymentCents = 1.5;
  assert.throws(() => shiftReceiptLayout(kaputt as ShiftSummaryReceipt));
});

test('Kassenstand: invoicePaymentCents im Laufstand wird gelesen wie gesendet, fehlt sonst', () => {
  const f = KASSE['getMyDrawerState']!.cases.find((c) => c.case === 'success_manager')!;
  const daten = structuredClone(f.response.data);
  const ohne = ladeStand({ pfad: 'data' } as never, structuredClone(daten));
  assert.equal(ohne.shift!.runningTotals!.invoicePaymentCents, undefined);
  daten.shift.runningTotals.invoicePaymentCents = 156960;
  assert.equal(ladeStand({ pfad: 'data' } as never, structuredClone(daten)).shift!.runningTotals!.invoicePaymentCents, 156960);
  daten.shift.runningTotals.invoicePaymentCents = 1.5;
  assert.throws(() => ladeStand({ pfad: 'data' } as never, daten));
});
