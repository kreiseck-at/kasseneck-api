import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  POS_BUSINESS_DEFAULTS,
  POS_BUSINESS_OPTIONAL_IDS,
  mergePosSettings,
  posSettingsFromWire,
  setMyPosSettings,
} from '../src/pos/index.js';
import { MESSAGES as POS_MESSAGES } from '../src/pos/texte.js';
import { createTransport, apiKeyAuth, KasseneckValidationError, type FetchLike, type HttpResponseLike } from '../src/client/index.js';
import { fromReceiptPayload } from '../src/models/index.js';
import { buildReceiptLayout, type ReceiptLayout } from '../src/receipt/index.js';

/**
 * SumUp in der Kassen-App (Spec 2026-11-14-sumup-kasse): Haendlernummer als optionale Betriebs-Einstellung,
 * Kartenterminal-Block mit dem Affiliate Key, Saetze `sumup.*` nur fuer die App, Betrag im SumUp-Block in Euro.
 */

function transportMit(daten: unknown) {
  const aufrufe: { body: string }[] = [];
  const holen: FetchLike = async (_url, init) => {
    aufrufe.push(init as { body: string });
    const rumpf = JSON.stringify({ status: 'success', message: '', data: daten });
    const antwort: HttpResponseLike = {
      status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : n.toLowerCase() === 'kasseneck-api-version' ? 'v3' : null) },
      text: async () => rumpf,
      json: async () => JSON.parse(rumpf),
      arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
    } as HttpResponseLike;
    return antwort;
  };
  return { rufen: createTransport({ auth: apiKeyAuth({ apiKey: 'kr_test_x', cashregisterToken: 'cb_test_x' }), fetch: holen }), aufrufe };
}

test('sumupMerchantCode ist optional: kein Standardwert, nur eine gueltige Nummer kommt durch', () => {
  assert.deepEqual([...POS_BUSINESS_OPTIONAL_IDS], ['sumupMerchantCode']);
  assert.equal('sumupMerchantCode' in POS_BUSINESS_DEFAULTS, false);
  assert.equal(mergePosSettings(POS_BUSINESS_DEFAULTS, { sumupMerchantCode: 'MCAB12CD' } as never).sumupMerchantCode, 'MCAB12CD');
  assert.equal('sumupMerchantCode' in mergePosSettings(POS_BUSINESS_DEFAULTS, {}), false);
  for (const falsch of ['x', 'MC-1234', 42, null]) {
    assert.equal('sumupMerchantCode' in mergePosSettings(POS_BUSINESS_DEFAULTS, { sumupMerchantCode: falsch } as never), false, String(falsch));
  }
});

test('setMyPosSettings: sumupMerchantCode als Nummer oder null, sonst Abweisung vor dem Senden', async () => {
  const a = transportMit({ business: { sumupMerchantCode: 'MCAB12CD' } });
  const r = await setMyPosSettings(a.rufen, { sumupMerchantCode: 'MCAB12CD' });
  assert.equal(r.sumupMerchantCode, 'MCAB12CD');
  const b = transportMit({ business: {} });
  await setMyPosSettings(b.rufen, { sumupMerchantCode: null } as never);
  assert.deepEqual(JSON.parse(b.aufrufe[0]!.body).params, { business: { sumupMerchantCode: null } });
  const c = transportMit({ business: {} });
  await assert.rejects(() => setMyPosSettings(c.rufen, { sumupMerchantCode: 'MC-1' }), KasseneckValidationError);
  assert.equal(c.aufrufe.length, 0);
});

test('Kartenterminal-Block: affiliateKey wird gelesen, ohne Block fehlt das Feld', () => {
  const mit = posSettingsFromWire({ business: { cardProvider: 'sumup' }, cardTerminal: { sumup: { affiliateKey: 'sup_afk_ABC123' } } });
  assert.deepEqual(mit.cardTerminal, { sumup: { affiliateKey: 'sup_afk_ABC123' } });
  assert.equal(mit.business.cardProvider, 'sumup');
  assert.equal('cardTerminal' in posSettingsFromWire({ business: {} }), false);
  for (const kaputt of [null, 'x', { sumup: null }, { sumup: { affiliateKey: 42 } }, { sumup: { affiliateKey: '' } }]) {
    assert.equal('cardTerminal' in posSettingsFromWire({ cardTerminal: kaputt }), false, JSON.stringify(kaputt));
  }
});

test('Saetze sumup.* gibt es nur in der App', () => {
  const sumup = Object.entries(POS_MESSAGES).filter(([k]) => k.startsWith('sumup.'));
  assert.deepEqual(sumup.map(([k]) => k).sort(), [
    'sumup.amount_mismatch', 'sumup.below_minimum', 'sumup.bind_question', 'sumup.check_in_app', 'sumup.code_optional_label',
    'sumup.declined', 'sumup.ios_external', 'sumup.key_missing', 'sumup.login_failed', 'sumup.not_logged_in',
    'sumup.other_account', 'sumup.refund_hint', 'sumup.status_logged_in', 'sumup.status_logged_out', 'sumup.unbind_question',
    'sumup.wrong_currency',
  ]);
  for (const [k, m] of sumup) assert.deepEqual((m as { only?: string[] }).only, ['app'], k);
});

// --- Betrag im SumUp-Block: Euro, nie Cent ---------------------------------------
const wurzel = new URL('../../fixtures/', import.meta.url);
interface Fixture { company: Parameters<typeof buildReceiptLayout>[1]; receipt: Record<string, unknown> & { customerDetails: string[]; legalMessage: string[] }; options?: Parameters<typeof buildReceiptLayout>[2] }
function sumupMitBetrag(amount: unknown): ReceiptLayout {
  const f = JSON.parse(readFileSync(new URL('receipts/card-sumup.json', wurzel), 'utf8')) as Fixture;
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
test('SumUp-Betrag: 25 → 25,00, 14.09 → 14,09, "25.00" → 25,00, fehlt oder unlesbar → Strich', () => {
  assert.equal(gesamtbetrag(sumupMitBetrag(25)), '25,00 EUR');
  assert.equal(gesamtbetrag(sumupMitBetrag(14.09)), '14,09 EUR');
  assert.equal(gesamtbetrag(sumupMitBetrag('25.00')), '25,00 EUR');
  assert.equal(gesamtbetrag(sumupMitBetrag(undefined)), '- EUR');
  assert.equal(gesamtbetrag(sumupMitBetrag('abc')), '- EUR');
});
