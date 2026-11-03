import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelText, messageText, cancellationErrorMessage, CANCELLATION_VOUCHER_ERROR_MESSAGES } from '../src/pos/texte.js';
import { CANCELLATION_ERROR_CODES } from '../src/models/index.js';

// Rueckgabe als Gutschein (Server 2026-11): Knopf, Bestaetigung und je Code ein Satz an der Kasse –
// Web-Kasse und App sagen dasselbe (Katalog pos-texts.json).

test('Knopf und Bestaetigung', () => {
  assert.equal(labelText('cancellation.as_voucher'), 'Als Gutschein');
  assert.equal(labelText('cancellation.voucher_confirm', { amount: '24,90 €' }), '24,90 € als Gutschein zurückgeben');
});

test('jeder Rueckgabe-Code hat einen eigenen Satz oder den Satz fuer abgelehnte Eingaben', () => {
  const erwartet: Record<string, string> = {
    refund_as_voucher_not_available: 'Als Gutschein geht hier nicht – bitte wie bezahlt zurückgeben.',
    refund_as_voucher_reason: 'Als Gutschein nur bei „Kunde hat storniert“ oder „Sonstiges“.',
    refund_as_voucher_with_voucher: 'Dieser Beleg hat einen Gutschein – bitte wie bezahlt zurückgeben.',
    refund_as_voucher_no_type: 'Keine Gutschein-Sorte für Rückgaben eingestellt – bitte wie bezahlt zurückgeben.',
    refund_as_voucher_amount: 'Dieser Betrag geht nicht als Gutschein – bitte wie bezahlt zurückgeben.',
    voucher_type_not_found: 'Die Gutschein-Sorte für Rückgaben hat sich geändert – bitte erneut versuchen.',
    voucher_amount_mismatch: 'Die Gutschein-Sorte für Rückgaben hat sich geändert – bitte erneut versuchen.',
  };
  for (const [code, satz] of Object.entries(erwartet)) assert.equal(messageText(cancellationErrorMessage(code)), satz, code);
  for (const code of ['refund_as_invalid', 'refund_as_conflict', 'idempotency_key_required', 'idempotency_conflict']) {
    assert.equal(cancellationErrorMessage(code), 'cancellation.input_rejected', code);
  }
  for (const code of CANCELLATION_ERROR_CODES.filter((c) => c.startsWith('refund_as') || c === 'idempotency_key_required')) {
    assert.ok(code in CANCELLATION_VOUCHER_ERROR_MESSAGES, code);
  }
  // Die uebrigen Storno-Codes gehen weiter den Weg der Zahlungen.
  assert.equal(cancellationErrorMessage('cancellation_outcome_unknown'), 'cancellation.outcome_unknown');
  assert.equal(cancellationErrorMessage('irgendwas'), 'cancellation.failed');
});
