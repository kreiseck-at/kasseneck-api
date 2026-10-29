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
    // Das alte Feld `label` gilt Kassen vor 1.17 (Ruling R3); das Paket liest `labelDefault` und `types[].label`.
    const { label: _alt, ...erwartet } = f.response.data.vouchers;
    assert.deepEqual(s.vouchers, erwartet);
  }
});

/** Neue Felder (Gutscheine Stufe 4b) ohne Angabe: kein Sortenverkauf, keine Sorten, keine Vorlage. */
const OHNE_SORTEN = { typeSale: false, types: [], serviceArticles: false, labelDefault: null };

test('Einstellungen: fehlt der Block, ist Verkaufen aus', () => {
  const aus = { sale: false, valueVoucherType: null, vatRateBp: null, ...OHNE_SORTEN };
  assert.deepEqual(VOUCHER_SETTINGS_DEFAULTS, aus);
  assert.deepEqual(posSettingsFromWire({ business: {}, device: {} }).vouchers, aus);
  assert.deepEqual(posSettingsFromWire(null).vouchers, aus);
  assert.deepEqual(posVoucherSettingsFromWire({ sale: 'ja' }), aus);
});

test('Einstellungen: stimmige Bloecke gehen unveraendert durch', () => {
  const ok = (b: Json) => assert.deepEqual(posVoucherSettingsFromWire(b), { ...b, ...OHNE_SORTEN });
  ok({ sale: true, valueVoucherType: 'single_purpose', vatRateBp: 2000 });
  ok({ sale: true, valueVoucherType: 'multi_purpose', vatRateBp: null });
  // ausgeschaltet, aber Art bleibt bestaetigt
  ok({ sale: false, valueVoucherType: 'single_purpose', vatRateBp: 1000 });
  ok({ sale: false, valueVoucherType: 'multi_purpose', vatRateBp: null });
  ok({ sale: false, valueVoucherType: null, vatRateBp: null });
});

test('Einstellungen: ein unstimmiges Feld schliesst den ganzen Block', () => {
  const zu = { sale: false, valueVoucherType: null, vatRateBp: null, ...OHNE_SORTEN };
  const faelle: Json[] = [
    { sale: 'ja', valueVoucherType: null, vatRateBp: null },
    { sale: undefined, valueVoucherType: 'multi_purpose', vatRateBp: null },
    { sale: true, valueVoucherType: 'xyz', vatRateBp: null },
    { sale: true, valueVoucherType: 5, vatRateBp: null },
    { sale: true, valueVoucherType: 'single_purpose', vatRateBp: 10.5 },
    { sale: true, valueVoucherType: 'single_purpose', vatRateBp: -1 },
    { sale: true, valueVoucherType: 'single_purpose', vatRateBp: '2000' },
    { sale: true, valueVoucherType: null, vatRateBp: null },
    { sale: true, valueVoucherType: 'single_purpose', vatRateBp: null },
    { sale: false, valueVoucherType: 'single_purpose', vatRateBp: null },
    { sale: true, valueVoucherType: 'multi_purpose', vatRateBp: 2000 },
  ];
  for (const f of faelle) assert.deepEqual(posVoucherSettingsFromWire(f), zu, JSON.stringify(f));
  for (const f of [[], 'x', 3, true]) assert.deepEqual(posVoucherSettingsFromWire(f), zu);
});

test('Einstellungen: business und device bleiben unberuehrt', () => {
  const s = posSettingsFromWire({ business: {}, device: {} });
  assert.deepEqual(s.business, POS_BUSINESS_DEFAULTS);
  assert.deepEqual(s.device, POS_DEVICE_DEFAULTS);
});
