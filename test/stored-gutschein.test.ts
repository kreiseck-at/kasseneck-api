import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as stored from '../src/stored/index.js';
import { _storedReceiptToWire } from '../src/stored/draht.js';
import { layoutWieServer } from '../src/stored/bon-layout.js';
import { belegMitFirmaAusHuelle } from '../src/client/receipts.js';
import { fromReceiptPayload, toReceiptPayload } from '../src/models/index.js';
import { BASIS, FAELLE_NEU, dokument, fall } from './stored-gutschein-docs.js';

/*
 * Gespeicherte Belege der neuen Gutscheinform: ./stored liest sie wie der
 * Server (belegGutscheineNachAussen am Rand, gutscheineFuerPaket im Layout).
 * Die Belegdokumente entstehen aus den Vertragsbeispielen: Positionen sind
 * schon innere Form, die Eintraege werden in die gespeicherte (deutsche)
 * Form zurueckgefuehrt, so wie plane() sie schreibt.
 */

test('stored: gespeicherte Eintraege der neuen Form ergeben die Drahtform des Vertragsbeispiels', () => {
  for (const name of FAELLE_NEU) {
    const { doc, wire } = dokument(name);
    const draht = _storedReceiptToWire(doc);
    assert.deepEqual(draht.vouchers, wire.vouchers, name);
    const r = stored.fromStoredReceipt(doc);
    const erwartet = fromReceiptPayload(wire);
    assert.deepEqual(r.vouchers, erwartet.vouchers, name);
    assert.deepEqual(r.items, erwartet.items, name);
  }
});

test('stored: der Fund des Pruefers - Einzweck-Einloesung behaelt Id, Endung und Betrag und schreibt sich zurueck', () => {
  const doc = {
    ...BASIS,
    vouchers: [{ action: 'redeem', type: 'einzweck', art: 'einzweck', gutscheinId: 'gez1', codeEnde: '5KN2', betragCents: 300, satzBp: 2000, name: 'Gutschein' }],
  };
  const r = stored.fromStoredReceipt(doc);
  const v = r.vouchers[0]!;
  assert.equal(v.type, 'single_purpose');
  assert.equal(v.voucherType, 'single_purpose');
  assert.equal(v.voucherId, 'gez1');
  assert.equal(v.codeSuffix, '5KN2');
  assert.equal(v.amountCents, 300);
  assert.equal(v.vatRateBp, 2000);
  assert.equal(v.valueCents, undefined);
  assert.doesNotThrow(() => toReceiptPayload(r));
});

test('stored: Altbelege ohne Gutscheine der neuen Form bleiben dasselbe Objekt (keine Umbenennung)', () => {
  const alt = { ...BASIS, vouchers: [{ action: 'redeem', type: 'value', value: 5, valueCents: 500, code: 'WG-1', name: 'Gutschein' }] };
  assert.deepEqual(_storedReceiptToWire(alt).vouchers, alt.vouchers);
});

test('stored: jeder Beleg der neuen Form liest sich, schreibt sich und liest sich gleich', () => {
  for (const name of FAELLE_NEU) {
    const { doc } = dokument(name);
    const r = stored.fromStoredReceipt(doc);
    assert.doesNotThrow(() => toReceiptPayload(r), name);
    const zurueck = fromReceiptPayload(toReceiptPayload(r) as never);
    assert.deepEqual(zurueck.vouchers, r.vouchers, name);
    assert.deepEqual(zurueck.items, r.items, name);
  }
});

// Der Vertrag im Repo kennt den neuen Bon erst mit 0.35.0 (Task 10); Task 11 schaltet diese Faelle wieder scharf.
const VERTRAG_FOLGT = new Set<string>(['redeem_promotion_voucher', 'redeem_multi_purpose_voucher', 'sale_multi_purpose_voucher']);
// Schalter ist allein VERTRAG_FOLGT: Task 11 leert die Menge (und entfernt `skip`), dann gelten diese Vergleiche.
for (const name of VERTRAG_FOLGT) {
  test(`stored: Layout wie der Server: ${name}`, { skip: 'Vertrag folgt mit 0.35.0 (Task 10)' }, () => {
    const data = fall(name).response.data;
    const b = belegMitFirmaAusHuelle(JSON.parse(JSON.stringify(data)), 'createReceipt');
    assert.deepEqual(layoutWieServer(b, data.receipt.layoutRuleset), data.layout, name);
  });
}

test('stored: Layout wie der Server - Einzweck, Leistung und Nulltopf stehen nur als Position am Bon', () => {
  for (const name of FAELLE_NEU) {
    if (VERTRAG_FOLGT.has(name)) continue;
    const data = fall(name).response.data;
    if (data.layout == null) continue;
    const b = belegMitFirmaAusHuelle(JSON.parse(JSON.stringify(data)), 'createReceipt');
    assert.deepEqual(layoutWieServer(b, data.receipt.layoutRuleset), data.layout, name);
  }
});

test('stored: Mehrzweck im Nulltopf (imNullTopf) und Auszahlung fallen aus der Gutscheinliste, der Code wandert an die Position', () => {
  // Verkauf ab Stichtag: Position im 0-%-Topf plus Eintrag mit imNullTopf.
  const kasseBeleg = belegMitFirmaAusHuelle(JSON.parse(JSON.stringify(fall('payout_multi_purpose_voucher').response.data)), 'createReceipt');
  const r = kasseBeleg.receipt;
  assert.equal(r.vouchers[0]!.zeroRateBucket, true);
  const lay = layoutWieServer(kasseBeleg, 2)!;
  const texte = lay.lines.map((z) => ('columns' in z && z.columns ? z.columns.map((c) => c.text).join(' | ') : ('text' in z ? String(z.text) : '')));
  // Die maskierte Code-Endung steht an der Position, und der Betrag steht genau einmal.
  assert.ok(texte.some((t) => t.includes('Auszahlung Gutschein ····-8CN5')), texte.join('\n'));
  assert.equal(texte.filter((t) => t.includes('-30,00 D')).length, 1);
  // Keine zweite Zeile aus der Gutscheinliste.
  assert.equal(texte.filter((t) => t.includes('Gutschein')).length, 1, texte.join('\n'));
});
