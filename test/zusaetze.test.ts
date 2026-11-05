import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fromReceiptItemPayload, toReceiptItemPayload } from '../src/models/receipt-item.js';

test('Belegposition: zusatzZu (innen) lesen und schreiben, nur als ganze Zahl >= 0', () => {
  const p = (extra: Record<string, unknown>) => ({ name: 'x', quantity: 1, unitPriceCents: 100, vatRate: 20, ...extra });
  assert.equal(fromReceiptItemPayload(p({ zusatzZu: 0 })).addOnOf, 0);
  for (const w of [null, -1, 0.5, '0']) assert.equal('addOnOf' in fromReceiptItemPayload(p({ zusatzZu: w })), false, String(w));
  assert.equal(toReceiptItemPayload(fromReceiptItemPayload(p({ zusatzZu: 2 }))).zusatzZu, 2);
  assert.equal('zusatzZu' in toReceiptItemPayload(fromReceiptItemPayload(p({}))), false);
});
