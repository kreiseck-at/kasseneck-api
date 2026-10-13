import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POS_BUSINESS_DEFAULTS,
  POS_BUSINESS_OPTIONAL_FIELDS,
  mergePosSettings,
  posTipKeptByDefault,
  setMyPosSettings,
  labelText,
  messageText,
  type PosBusinessSettings,
} from '../src/pos/index.js';
import { sellReceipt, type TipOptions } from '../src/client/receipts.js';
import { fromReceiptItemPayload, toReceiptItemPayload } from '../src/models/index.js';
import { createTransport, apiKeyAuth, type FetchLike, type HttpResponseLike } from '../src/client/index.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import { VatRate } from '../src/enums/index.js';

/*
 * Bar-Trinkgeld „gleich behalten“ (Backend: Schichten-Spec, Nachtrag 4): die
 * Mitarbeiterin steckt das Bar-Trinkgeld beim Verkauf gleich ein. Am Draht
 * `tip.keptByEmployee` (nur `true` geht hinaus) und `items[].keptByEmployee`
 * an der Trinkgeld-Position; die Einstellung des Betriebs
 * `business.tipKeptByDefault` ist optional wie `device.drawerId` (der Server
 * sendet sie nur, wenn sie gespeichert ist; fehlt sie, gilt aus).
 */

type Aufruf = { url: string; params: Record<string, unknown> };
function weg(antwort: unknown = { status: 'success', message: '', data: { receipt: { receiptId: 'R-1', items: [] } } }) {
  const aufrufe: Aufruf[] = [];
  const holen: FetchLike = async (url, init) => {
    aufrufe.push({ url, params: (JSON.parse(init.body) as { params: Record<string, unknown> }).params });
    const rumpf = JSON.stringify(antwort);
    const r: HttpResponseLike = {
      status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : n.toLowerCase() === 'kasseneck-api-version' ? 'v3' : null) },
      text: async () => rumpf,
      arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
    };
    return r;
  };
  return { rufen: createTransport({ auth: apiKeyAuth({ apiKey: 'kr_test_X', cashregisterToken: 'cb_test_Y' }), fetch: holen }), aufrufe };
}
const KAFFEE = { name: 'Kaffee', quantity: 1, vat: VatRate.vat20, priceCents: 2000 };
const BAR = [{ method: 'cash' as const, amountCents: 2200 }];

test('sellReceipt: keptByEmployee true geht hinaus, false und ohne nicht', async () => {
  for (const [tip, erwartet] of [
    [{ cents: 200, keptByEmployee: true }, { cents: 200, keptByEmployee: true }],
    [{ cents: 200, keptByEmployee: false }, { cents: 200 }],
    [{ cents: 200 }, { cents: 200 }],
  ] as [TipOptions, Record<string, unknown>][]) {
    const { rufen, aufrufe } = weg();
    await sellReceipt(rufen, { payments: BAR, items: [KAFFEE], tip }).catch(() => undefined);
    assert.deepEqual(aufrufe[0]!.params['tip'], erwartet);
  }
});

test('sellReceipt: keptByEmployee kein Wahrheitswert wirft vor dem Senden', async () => {
  const { rufen, aufrufe } = weg();
  await assert.rejects(
    sellReceipt(rufen, { payments: BAR, items: [KAFFEE], tip: { cents: 200, keptByEmployee: 'ja' as unknown as boolean } }),
    (e) => isKasseneckValidationError(e) && /keptByEmployee/.test((e as Error).message),
  );
  assert.equal(aufrufe.length, 0);
});

test('Trinkgeld-Position: keptByEmployee wird gelesen und beim Storno-Spiegeln wieder geschrieben', () => {
  const p = fromReceiptItemPayload({ kind: 'tip', name: 'Trinkgeld Personal', quantity: 1, unitPriceCents: 200, vatRate: 0, paymentMethod: 'cash', recipient: { registerUserId: 'ru1', name: 'Livia Lindmayr' }, receivedImmediately: true, keptByEmployee: true });
  assert.equal(p.keptByEmployee, true);
  assert.equal(toReceiptItemPayload(p).keptByEmployee, true);
  const ohne = fromReceiptItemPayload({ kind: 'tip', name: 'Trinkgeld Personal', quantity: 1, unitPriceCents: 200, vatRate: 0, receivedImmediately: true });
  assert.equal('keptByEmployee' in ohne, false);
  assert.equal('keptByEmployee' in toReceiptItemPayload(ohne), false);
  // Eine Warenzeile traegt das Merkmal nie.
  assert.equal('keptByEmployee' in fromReceiptItemPayload({ name: 'Kaffee', quantity: 1, unitPriceCents: 200, vatRate: 20, keptByEmployee: true }), false);
});

test('Einstellung tipKeptByDefault: optional, Standard aus, nur ein Wahrheitswert wird gemischt', () => {
  assert.deepEqual([...POS_BUSINESS_OPTIONAL_FIELDS], ['tipKeptByDefault']);
  assert.equal('tipKeptByDefault' in POS_BUSINESS_DEFAULTS, false);
  assert.equal(posTipKeptByDefault(POS_BUSINESS_DEFAULTS), false);
  const an = mergePosSettings(POS_BUSINESS_DEFAULTS, { tipKeptByDefault: true });
  assert.equal(an.tipKeptByDefault, true);
  assert.equal(posTipKeptByDefault(an), true);
  assert.equal(mergePosSettings(POS_BUSINESS_DEFAULTS, { tipKeptByDefault: false }).tipKeptByDefault, false);
  assert.equal('tipKeptByDefault' in mergePosSettings(POS_BUSINESS_DEFAULTS, { tipKeptByDefault: 'ja' } as unknown as Partial<PosBusinessSettings>), false);
});

test('setMyPosSettings: tipKeptByDefault geht als Wahrheitswert hinaus, alles andere wirft vor dem Senden', async () => {
  const antwort = { status: 'success', message: '', data: { business: { ...POS_BUSINESS_DEFAULTS, tipKeptByDefault: true } } };
  const { rufen, aufrufe } = weg(antwort);
  const stand = await setMyPosSettings(rufen, { tipKeptByDefault: true });
  assert.deepEqual(aufrufe[0]!.params['business'], { tipKeptByDefault: true });
  assert.equal(stand.tipKeptByDefault, true);
  const zwei = weg(antwort);
  await assert.rejects(setMyPosSettings(zwei.rufen, { tipKeptByDefault: 'ja' } as unknown as Partial<PosBusinessSettings>), (e) => isKasseneckValidationError(e));
  assert.equal(zwei.aufrufe.length, 0);
});

test('Texte: Schalter und Einstellung (Beschriftung + Hinweis)', () => {
  assert.equal(labelText('checkout.tip_kept'), 'gleich behalten');
  assert.equal(labelText('tip.kept_setting'), 'Bar-Trinkgeld behält der Mitarbeiter gleich');
  assert.match(messageText('tip.kept_setting_hint'), /Kassenstand/);
});
