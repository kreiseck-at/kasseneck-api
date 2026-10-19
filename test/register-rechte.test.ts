import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REGISTER_PERMS, voucherPermsOf, type RegisterUserPerms } from '../src/register/pairing.js';
import { posSettingsFromWire } from '../src/pos/client.js';
import { VOUCHER_SETTINGS_DEFAULTS, posVoucherSettingsFromWire } from '../src/pos/gutschein.js';
import { POS_BUSINESS_DEFAULTS, POS_DEVICE_DEFAULTS } from '../src/pos/settings.js';
import { readFileSync } from 'node:fs';

type Json = Record<string, any>;
const KASSE: Json = JSON.parse(readFileSync(new URL('../../fixtures/v3/antworten/kasse.json', import.meta.url), 'utf8'));

test('Gutschein-Rechte stehen in der Liste der Rechte', () => {
  for (const r of ['voucherSell', 'voucherRedeem', 'voucherManage']) assert.ok((REGISTER_PERMS as readonly string[]).includes(r), r);
});

test('voucherPermsOf: fehlende Schluessel gelten wie beim Kassier', () => {
  const kassier = { voucherSell: true, voucherRedeem: true, voucherManage: false };
  assert.deepEqual(voucherPermsOf({}), kassier);
  assert.deepEqual(voucherPermsOf(null), kassier);
  assert.deepEqual(voucherPermsOf(undefined), kassier);
  assert.deepEqual(voucherPermsOf({ voucherManage: true }), { ...kassier, voucherManage: true });
});

test('voucherPermsOf: ein ausdrueckliches false sperrt, kein Nicht-Boolean erteilt', () => {
  assert.deepEqual(voucherPermsOf({ voucherSell: false, voucherRedeem: false, voucherManage: false }), {
    voucherSell: false, voucherRedeem: false, voucherManage: false,
  });
  assert.equal(voucherPermsOf({ voucherManage: 'yes' } as never).voucherManage, false);
});

test('voucherPermsOf: liest die Rechte der Anmeldung im Vertrag', () => {
  const faelle: Json[] = [];
  const walk = (o: any): void => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      if (typeof o.voucherSell === 'boolean') faelle.push(o);
      Object.values(o).forEach(walk);
    }
  };
  walk(KASSE);
  assert.ok(faelle.length > 0);
  for (const p of faelle) {
    assert.deepEqual(voucherPermsOf(p as Partial<RegisterUserPerms>), { voucherSell: p.voucherSell, voucherRedeem: p.voucherRedeem, voucherManage: p.voucherManage });
  }
});

test('Einstellungen: der Block vouchers aus dem Vertrag wird gelesen', () => {
  const faelle: Json[] = KASSE.endpoints.getKasseSettings.cases.filter((f: Json) => f.response?.data?.vouchers);
  assert.ok(faelle.length > 0);
  for (const f of faelle) {
    const s = posSettingsFromWire(f.response.data);
    assert.deepEqual(s.vouchers, f.response.data.vouchers);
  }
});

test('Einstellungen: fehlt der Block, ist Verkaufen aus', () => {
  const aus = { sale: false, valueVoucherType: null, vatRateBp: null };
  assert.deepEqual(VOUCHER_SETTINGS_DEFAULTS, aus);
  assert.deepEqual(posSettingsFromWire({ business: {}, device: {} }).vouchers, aus);
  assert.deepEqual(posSettingsFromWire(null).vouchers, aus);
  assert.deepEqual(posVoucherSettingsFromWire({ sale: 'ja' }), aus);
});

test('Einstellungen: Verkauf mit Einzweck und Satz', () => {
  assert.deepEqual(posVoucherSettingsFromWire({ sale: true, valueVoucherType: 'single_purpose', vatRateBp: 1000 }), {
    sale: true, valueVoucherType: 'single_purpose', vatRateBp: 1000,
  });
  assert.deepEqual(posVoucherSettingsFromWire({ sale: true, valueVoucherType: 'multi_purpose', vatRateBp: null }).valueVoucherType, 'multi_purpose');
  // unbekannte Art / kein ganzer Satz: nicht erhoben
  assert.deepEqual(posVoucherSettingsFromWire({ sale: true, valueVoucherType: 'xyz', vatRateBp: 10.5 }), { sale: true, valueVoucherType: null, vatRateBp: null });
});

test('Einstellungen: business und device bleiben unberuehrt', () => {
  const s = posSettingsFromWire({ business: {}, device: {} });
  assert.deepEqual(s.business, POS_BUSINESS_DEFAULTS);
  assert.deepEqual(s.device, POS_DEVICE_DEFAULTS);
});
