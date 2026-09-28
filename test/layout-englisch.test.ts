import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { KeckPaymentMethod, ReceiptType, VatRate } from '../src/enums/index.js';
import type { Receipt, ReceiptCompany } from '../src/models/index.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import * as receipt from '../src/receipt/index.js';
import { buildReceiptLayout, renderReceiptGrid, type BuildReceiptLayoutOptions, type ReceiptLayout } from '../src/receipt/index.js';
import { ReceiptLayoutView } from '../src/react/index.js';

/**
 * Das Layout spricht die Sprache des `/v3`-Drahts: `ruleset`, Banner mit
 * `tone: 'receipt_type' | 'warning'`, Optionen `testCashregister`,
 * `testSignature`, `registrationInfo`. Gedruckt wird unveraendert deutsch
 * (die Bytes haelt `druck-goldens.test.ts` fest).
 */
const FIRMA: ReceiptCompany = {
  companyName: 'Café Kreiseck', street: 'Hauptstraße 5', zip: '1010', city: 'Wien', phone: '+43 1 1234567',
  vatId: 'ATU12345678', taxNumber: '', isSmallBusiness: false,
  footer1: '', footer2: '', thanksMessage: [], showKreiseckLogo: false,
};
const QR = '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-13T00:30:00_5,00_2,70_0,00_0,00_0,00_UMSATZ_VORGAENGER_6F0404F0_SIGNATUR';
const BELEG: Receipt = {
  receiptId: 'AT0-KASSE1-42', cashregisterId: 'KASSE1', timeStamp: '2026-08-13T00:30:00',
  items: [{ name: 'Espresso', quantity: 2, vat: VatRate.vat20, priceCents: 250 }],
  vouchers: [], paymentMethod: KeckPaymentMethod.cash, turnoverCounterAES256ICM: 'UMSATZ', signaturePreviousReceipt: 'VORGAENGER',
  certificateSerialNumber: '6F0404F0', receiptType: ReceiptType.standard, sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.SIGNATURWERT', qr: QR,
  fullReceiptId: 'VOLL', customerDetails: [], legalMessage: [],
};
const NULL0: Receipt = { ...BELEG, receiptType: ReceiptType.zero, items: [], paymentMethod: '', zeroKind: 'monthly', timeStamp: '2026-08-31T23:59:30',
  qr: '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-31T23:59:30_0,00_0,00_0,00_0,00_0,00_UMSATZ_VORGAENGER_6F0404F0_SIGNATUR' };

const banner = (l: ReceiptLayout) => l.lines.filter((z): z is Extract<typeof z, { kind: 'banner' }> => z.kind === 'banner');

test('Layout: ruleset statt regelwerk, aktuelles Regelwerk 2, Option ruleset setzt Altbelege', () => {
  assert.equal(receipt.CURRENT_LAYOUT_RULESET, 2);
  const l = buildReceiptLayout(BELEG, FIRMA);
  assert.equal(l.ruleset, 2);
  assert.equal('regelwerk' in l, false);
  assert.equal(buildReceiptLayout(BELEG, FIRMA, { ruleset: 1 }).ruleset, 1);
  assert.throws(() => buildReceiptLayout(BELEG, FIRMA, { ruleset: 99 as 1 }), (e) => isKasseneckValidationError(e) && /ruleset/.test(e.message));
  assert.deepEqual(Object.keys(l), ['lines', 'paperSize', 'ruleset']);
});

test('Layout: testCashregister und testSignature setzen Warnrahmen mit tone warning', () => {
  const kasse = banner(buildReceiptLayout(BELEG, FIRMA, { testCashregister: true }));
  assert.deepEqual(kasse[0], { kind: 'banner', text: 'TESTKASSE — kein gültiger Beleg', tone: 'warning' });
  assert.equal(kasse.length, 2);
  const sig = banner(buildReceiptLayout(BELEG, FIRMA, { testSignature: true }));
  assert.deepEqual(sig[0], { kind: 'banner', text: 'TESTSIGNATUR — kein gültiger Beleg', tone: 'warning' });
  const storno = banner(buildReceiptLayout({ ...BELEG, receiptType: ReceiptType.training }, FIRMA));
  assert.deepEqual(storno.map((b) => b.tone), ['receipt_type']);
  for (const b of [...kasse, ...sig, ...storno]) assert.equal('ton' in b, false);
});

test('Layout: registrationInfo fuellt den Block „Prüfangaben“ am Nullbeleg', () => {
  const l = buildReceiptLayout(NULL0, FIRMA, { registrationInfo: { cardRegisteredAt: '2024-03-12', cashregisterRegisteredAt: '2024-03-13' } });
  const texte = l.lines.flatMap((z) => (z.kind === 'columns' ? [z.columns.map((c) => c.text).join(' ')] : []));
  assert.ok(texte.includes('Karte registriert: 12.03.2024'), texte.join('\n'));
  assert.ok(texte.includes('Kasse registriert: 13.03.2024'), texte.join('\n'));
  // null wie fehlend: Zeilen entfallen
  const ohne = buildReceiptLayout(NULL0, FIRMA, { registrationInfo: null });
  assert.ok(!JSON.stringify(ohne).includes('registriert'));
});

/**
 * Eine alte deutsche Option (`testKasse`) darf NICHT still verschwinden: der
 * Rahmen „TESTKASSE — kein gültiger Beleg“ fehlte dann auf einem Testbeleg, und
 * der sieht aus wie ein gueltiger. Auch aus JavaScript ohne Typpruefung.
 */
test('Layout: deutsche und unbekannte Optionen werden abgewiesen, nie still ignoriert', () => {
  const alt: [string, string][] = [['testKasse', 'testCashregister'], ['testSignatur', 'testSignature'], ['pruefangaben', 'registrationInfo'], ['regelwerk', 'ruleset']];
  for (const [name, neu] of alt) {
    assert.throws(
      () => buildReceiptLayout(BELEG, FIRMA, { [name]: true } as unknown as BuildReceiptLayoutOptions),
      (e) => isKasseneckValidationError(e) && e.message.includes(name) && e.message.includes(neu),
      name,
    );
  }
  assert.throws(() => buildReceiptLayout(BELEG, FIRMA, { papier: 'mm80' } as unknown as BuildReceiptLayoutOptions), (e) => isKasseneckValidationError(e) && e.message.includes('papier'));
});

test('Zeichenraster: Bannerzeilen tragen tone', () => {
  const g = renderReceiptGrid(buildReceiptLayout(BELEG, FIRMA, { testCashregister: true }), { charsPerLine: 32 });
  const b = g.lines.filter((z) => z.kind === 'banner');
  assert.ok(b.length >= 3);
  for (const z of b) {
    assert.equal(z.tone, 'warning');
    assert.equal('ton' in z, false);
  }
});

test('React: CSS-Klassen der Banner bleiben (belegart/warnung), Warnung ist role=alert', () => {
  const html = renderToStaticMarkup(createElement(ReceiptLayoutView, { layout: buildReceiptLayout({ ...BELEG, receiptType: ReceiptType.training }, FIRMA, { testCashregister: true }) }));
  assert.equal((html.match(/keck-receipt-banner--warnung/g) ?? []).length, 2);
  assert.equal((html.match(/keck-receipt-banner--belegart/g) ?? []).length, 1);
  assert.equal((html.match(/role="alert"/g) ?? []).length, 2);
  assert.ok(!html.includes('--warning') && !html.includes('--receipt_type'));
});

test('Paketoberflaeche: keine deutschen Layout-Namen mehr', () => {
  const namen = Object.keys(receipt);
  for (const alt of ['AKTUELLES_REGELWERK']) assert.equal(namen.includes(alt), false, alt);
  assert.ok(namen.includes('CURRENT_LAYOUT_RULESET'));
});
