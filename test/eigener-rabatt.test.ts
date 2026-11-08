import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POS_BUSINESS_DEFAULTS,
  POS_BUSINESS_OPTIONAL_FIELDS,
  mergePosSettings,
  posCustomDiscountAllowed,
  setMyPosSettings,
  type PosBusinessSettings,
} from '../src/pos/index.js';
import { createTransport, apiKeyAuth, type FetchLike, type HttpResponseLike } from '../src/client/index.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import { fromStoredPosSettings, invalidStoredPosSettings } from '../src/stored/index.js';

/*
 * Eigener Rabatt an der Kasse (`business.customDiscountAllowed`, gespeichert `rabattFrei`): `true` = die Kasse
 * bietet neben den Rabatt-Chips das freie Feld (Betrag oder Prozent) an, `false` = nur die Chips. Optional wie
 * `tipKeptByDefault`: der Server sendet das Feld nur, wenn es gespeichert ist; fehlt es, gilt `true`.
 */

type Aufruf = { url: string; params: Record<string, unknown> };
function weg(antwort: unknown) {
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

test('customDiscountAllowed: optional, nicht im Standard, fehlt = erlaubt', () => {
  assert.ok((POS_BUSINESS_OPTIONAL_FIELDS as readonly string[]).includes('customDiscountAllowed'));
  assert.equal('customDiscountAllowed' in POS_BUSINESS_DEFAULTS, false);
  assert.equal(posCustomDiscountAllowed(POS_BUSINESS_DEFAULTS), true);
  assert.equal(posCustomDiscountAllowed(null), true);
  assert.equal(posCustomDiscountAllowed(undefined), true);
  assert.equal(posCustomDiscountAllowed({}), true);
  assert.equal(posCustomDiscountAllowed({ customDiscountAllowed: true }), true);
  assert.equal(posCustomDiscountAllowed({ customDiscountAllowed: false }), false);
});

test('mergePosSettings: nur ein Wahrheitswert wird uebernommen', () => {
  const aus = mergePosSettings(POS_BUSINESS_DEFAULTS, { customDiscountAllowed: false });
  assert.equal(aus.customDiscountAllowed, false);
  assert.equal(posCustomDiscountAllowed(aus), false);
  assert.equal(mergePosSettings(POS_BUSINESS_DEFAULTS, { customDiscountAllowed: true }).customDiscountAllowed, true);
  const kaputt = mergePosSettings(POS_BUSINESS_DEFAULTS, { customDiscountAllowed: 'nein' } as unknown as Partial<PosBusinessSettings>);
  assert.equal('customDiscountAllowed' in kaputt, false);
  assert.equal(posCustomDiscountAllowed(kaputt), true);
  assert.equal('customDiscountAllowed' in mergePosSettings(POS_BUSINESS_DEFAULTS, {}), false);
});

test('setMyPosSettings: customDiscountAllowed geht als Wahrheitswert hinaus, alles andere wirft vor dem Senden', async () => {
  const antwort = { status: 'success', message: '', data: { business: { ...POS_BUSINESS_DEFAULTS, customDiscountAllowed: false } } };
  const { rufen, aufrufe } = weg(antwort);
  const stand = await setMyPosSettings(rufen, { customDiscountAllowed: false });
  assert.deepEqual(aufrufe[0]!.params['business'], { customDiscountAllowed: false });
  assert.equal(stand.customDiscountAllowed, false);
  assert.equal(posCustomDiscountAllowed(stand), false);
  const zwei = weg(antwort);
  await assert.rejects(setMyPosSettings(zwei.rufen, { customDiscountAllowed: 'nein' } as unknown as Partial<PosBusinessSettings>), (e) => isKasseneckValidationError(e));
  assert.equal(zwei.aufrufe.length, 0);
});

test('./stored: rabattFrei wird als customDiscountAllowed gelesen, ohne gueltigen Wert fehlt das Feld still', () => {
  assert.equal(fromStoredPosSettings({ betrieb: { rabattFrei: false } }).business.customDiscountAllowed, false);
  assert.equal(fromStoredPosSettings({ betrieb: { rabattFrei: true } }).business.customDiscountAllowed, true);
  for (const betrieb of [{}, { rabattFrei: 'nein' }, { rabattFrei: 0 }, { rabattFrei: null }]) {
    const b = fromStoredPosSettings({ betrieb }).business;
    assert.equal('customDiscountAllowed' in b, false);
    assert.equal('rabattFrei' in b, false);
    assert.equal(posCustomDiscountAllowed(b), true);
    assert.deepEqual(invalidStoredPosSettings({ betrieb }), []);
  }
});
