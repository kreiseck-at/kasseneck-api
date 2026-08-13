import { test } from 'node:test';
import assert from 'node:assert/strict';
import abzug from './fixtures/dart-enums.json' with { type: 'json' };
import {
  ReceiptType,
  VatRate,
  KeckPaymentMethod,
  CreditCardProvider,
  VoucherType,
  VoucherAction,
  StripeLinkMode,
} from '../src/enums/index.js';

// Gleichheits-Waechter: vergleicht die TypeScript-Enums gegen den eingecheckten
// Abzug der Dart-Enums (test/fixtures/dart-enums.json). Driften die beiden
// Pakete auseinander, muss dieser Test fallen — in beide Richtungen: kein
// Schluessel fehlt, keiner ist zu viel.

test('Belegtyp deckt sich mit dem Flutter-Paket', () => {
  assert.deepEqual(Object.keys(ReceiptType).sort(), Object.keys(abzug.ReceiptType).sort());
  for (const [k, v] of Object.entries(abzug.ReceiptType)) {
    const eintrag = ReceiptType[k as keyof typeof ReceiptType];
    assert.equal(eintrag.value, k, `Belegtyp ${k}: value weicht vom Schluessel ab — das ist die Nutzlast ans Backend`);
    assert.deepEqual(
      { needsItems: eintrag.needsItems, isZero: eintrag.isZero, allowsVouchers: eintrag.allowsVouchers },
      v,
      `Belegtyp ${k} weicht ab`,
    );
  }
});

test('Steuersaetze decken sich mit dem Flutter-Paket', () => {
  assert.deepEqual(Object.keys(VatRate).sort(), Object.keys(abzug.VatRate).sort());
  for (const [k, v] of Object.entries(abzug.VatRate)) {
    const eintrag = VatRate[k as keyof typeof VatRate];
    assert.equal(eintrag.value, k, `Steuersatz ${k}: value weicht vom Schluessel ab — das ist die Nutzlast ans Backend`);
    assert.deepEqual(
      { rate: eintrag.rate, category: eintrag.category },
      v,
      `Steuersatz ${k} weicht ab — die Kategorie haengt an der Signatur`,
    );
  }
});

test('Zahlungsarten decken sich mit dem Flutter-Paket', () => {
  assert.deepEqual(Object.keys(KeckPaymentMethod).sort(), Object.keys(abzug.KeckPaymentMethod).sort());
  for (const [k, v] of Object.entries(abzug.KeckPaymentMethod)) {
    const eintrag = KeckPaymentMethod[k as keyof typeof KeckPaymentMethod];
    assert.equal(eintrag.value, k, `Zahlungsart ${k}: value weicht vom Schluessel ab — das ist die Nutzlast ans Backend`);
    assert.deepEqual(
      { needsCreditCard: eintrag.needsCreditCard, label: eintrag.label },
      v,
      `Zahlungsart ${k} weicht ab`,
    );
  }
});

test('Kartenanbieter decken sich mit dem Flutter-Paket', () => {
  assert.deepEqual(Object.keys(CreditCardProvider).sort(), [...abzug.CreditCardProvider].sort());
  for (const k of abzug.CreditCardProvider) {
    assert.equal(CreditCardProvider[k as keyof typeof CreditCardProvider], k, `Kartenanbieter ${k} weicht ab`);
  }
});

test('Gutscheinarten decken sich mit dem Flutter-Paket', () => {
  assert.deepEqual(Object.keys(VoucherType).sort(), [...abzug.VoucherType].sort());
  for (const k of abzug.VoucherType) {
    assert.equal(VoucherType[k as keyof typeof VoucherType], k, `Gutscheinart ${k} weicht ab`);
  }
});

test('Gutschein-Aktionen decken sich mit dem Flutter-Paket', () => {
  assert.deepEqual(Object.keys(VoucherAction).sort(), [...abzug.VoucherAction].sort());
  for (const k of abzug.VoucherAction) {
    assert.equal(VoucherAction[k as keyof typeof VoucherAction], k, `Gutschein-Aktion ${k} weicht ab`);
  }
});

test('Stripe-Link-Modi decken sich mit dem Flutter-Paket', () => {
  assert.deepEqual(Object.keys(StripeLinkMode).sort(), [...abzug.StripeLinkMode].sort());
  for (const k of abzug.StripeLinkMode) {
    // Der Wert IST die Nutzlast: das Vorbild sendet `mode.name`, das Backend
    // prueft auf 'payment' bzw. 'authorization'.
    assert.equal(StripeLinkMode[k as keyof typeof StripeLinkMode], k, `Stripe-Link-Modus ${k} weicht ab`);
  }
});
