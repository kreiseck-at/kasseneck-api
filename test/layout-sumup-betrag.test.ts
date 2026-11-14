import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromReceiptPayload } from '../src/models/index.js';
import { buildReceiptLayout, type ReceiptLayout } from '../src/receipt/index.js';

/**
 * Betrag im SumUp-Block: SumUp liefert `amount` in Euro (SDK-Antwort, so am
 * Beleg gespeichert, z. B. 25 oder 14.09). Eine ganze Zahl ist deshalb Euro,
 * nicht Cent – sonst stuende bei 25,00 EUR „0,25 EUR“ auf dem Bon.
 */

const wurzel = new URL('../../fixtures/', import.meta.url);

interface Fixture { company: Parameters<typeof buildReceiptLayout>[1]; receipt: Record<string, unknown> & { customerDetails: string[]; legalMessage: string[] }; options?: Parameters<typeof buildReceiptLayout>[2] }
const lade = (name: string): Fixture => JSON.parse(readFileSync(new URL(`belege/${name}.json`, wurzel), 'utf8')) as Fixture;

function sumupMitBetrag(amount: unknown): ReceiptLayout {
  const f = lade('karte-sumup');
  const karte = { ...(f.receipt.cardPaymentData as Record<string, unknown>) };
  if (amount === undefined) delete karte.amount; else karte.amount = amount;
  const receipt = { ...f.receipt, cardPaymentData: karte };
  return buildReceiptLayout(
    fromReceiptPayload({ ...receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never),
    f.company,
    f.options ?? {},
  );
}

function gesamtbetrag(layout: ReceiptLayout): string {
  for (const z of layout.lines) {
    if (z.kind !== 'columns') continue;
    const [links, rechts] = z.columns;
    if (links && links.text === 'Gesamtbetrag:' && rechts) return rechts.text;
  }
  throw new Error('Zeile Gesamtbetrag fehlt');
}

test('SumUp-Betrag als ganze Zahl ist Euro: 25 → 25,00 EUR', () => {
  assert.equal(gesamtbetrag(sumupMitBetrag(25)), '25,00 EUR');
});

test('SumUp-Betrag mit Nachkommastellen: 14.09 → 14,09 EUR', () => {
  assert.equal(gesamtbetrag(sumupMitBetrag(14.09)), '14,09 EUR');
});

test('SumUp-Betrag als Zeichenkette mit Punkt: "25.00" → 25,00 EUR', () => {
  assert.equal(gesamtbetrag(sumupMitBetrag('25.00')), '25,00 EUR');
});

test('SumUp-Betrag fehlt → Strich', () => {
  assert.equal(gesamtbetrag(sumupMitBetrag(undefined)), '- EUR');
});

test('SumUp-Betrag unlesbar → Strich', () => {
  assert.equal(gesamtbetrag(sumupMitBetrag('abc')), '- EUR');
});
