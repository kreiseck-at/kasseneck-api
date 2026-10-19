import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkVoucher, reprintVoucherLabel } from '../src/pos/index.js';
import { createTransport, POS_BASE_URL, type FetchLike, type HttpRequestInit, type HttpResponseLike } from '../src/client/transport.js';
import { registerUserAuth } from '../src/client/auth.js';
import { isKasseneckValidationError, KasseneckApiError } from '../src/client/errors.js';

/*
 * Gutschein pruefen und Etikett nachdrucken am Kassenweg `/api/v3` gegen den
 * Vertrags-Export (fixtures/v3/antworten/kasse.json).
 */

type Json = Record<string, any>;
interface Fall { case: string; params: Json; httpStatus: number; headers: Record<string, string>; response: Json }

const KASSE = (JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/v3/antworten/kasse.json', import.meta.url)), 'utf8')) as Json).endpoints as Record<string, { cases: Fall[] }>;
const fall = (e: string, name: string): Fall => {
  const f = KASSE[e]!.cases.find((c) => c.case === name);
  if (!f) throw new Error(`kasse.json: kein Fall ${e}/${name}`);
  return f;
};

function antwortAus(f: Fall): HttpResponseLike {
  const rumpf = JSON.stringify(f.response);
  const kopf: Record<string, string> = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(f.headers)) kopf[k.toLowerCase()] = v;
  return { status: f.httpStatus, headers: { get: (n: string) => kopf[n.toLowerCase()] ?? null }, text: async () => rumpf, arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer as ArrayBuffer };
}

function kasse(f: Fall, gesendet: Json[]) {
  const holen: FetchLike = async (url: string, init: HttpRequestInit) => {
    gesendet.push({ url, params: (JSON.parse(init.body) as { params: Json }).params });
    return antwortAus(f);
  };
  return createTransport({ auth: registerUserAuth({ getIdToken: () => 'eyJ-ID', getSessionId: () => 'sess-1', cashregisterId: 'KASSE1' }), fetch: holen, timeoutMs: 50 });
}

test('checkVoucher: sendet den normalisierten Code, liest das Modell ohne null-Felder', async () => {
  const f = fall('checkVoucher', 'success_cashier');
  const gesendet: Json[] = [];
  const v = await checkVoucher(kasse(f, gesendet), 'b1kk-5eq5-7dhp');
  assert.equal(gesendet[0]!.url, `${POS_BASE_URL}/checkVoucher`);
  assert.match(gesendet[0]!.params.code, /^[0-9A-Z]{12}$/);
  assert.ok(!gesendet[0]!.params.code.includes('-'));
  assert.deepEqual(v, { type: 'multi_purpose', status: 'active', balanceCents: 3200, faceValueCents: 5000, validity: { pattern: '1+3', redeemableUntil: '2027-09-20', refundableUntil: '2030-09-20' }, codeSuffix: '7DHP' });
});

test('checkVoucher: Dienstleistungsgutschein mit Artikel und Stueckzahl', async () => {
  const v = await checkVoucher(kasse(fall('checkVoucher', 'success_service'), []), 'B1KK5EQ57DJG');
  assert.equal(v.type, 'service');
  assert.equal(v.quantity, 3);
  assert.equal(v.remainingQuantity, 2);
  assert.deepEqual(v.article, { id: 'art_mani', name: 'Manikuere', vatRateBp: 2000, priceCents: 3500 });
  assert.deepEqual(v.validity, { pattern: 'unlimited' });
});

test('checkVoucher: Fehler tragen ihren Code; unbekannter Code oder Tippfehler schon lokal', async () => {
  // `voucher_invalid_code` kommt vom Server nur, wenn eine andere Pruefung als das Pruefzeichen greift; hier lokal.
  for (const [name, code] of [['unknown', 'voucher_not_found']] as const) {
    const f = fall('checkVoucher', name);
    await assert.rejects(checkVoucher(kasse(f, []), String(f.params.code)), (e: unknown) => e instanceof KasseneckApiError && e.code === code);
  }
  const ungueltig = fall('checkVoucher', 'check_digit_wrong');
  assert.equal(ungueltig.response.code, 'voucher_invalid_code');
  const gesendet: Json[] = [];
  await assert.rejects(checkVoucher(kasse(fall('checkVoucher', 'success_cashier'), gesendet), 'B1KK5EQ57DH0'), (e: unknown) => isKasseneckValidationError(e));
  assert.equal(gesendet.length, 0, 'ein falsches Pruefzeichen geht nie ueber das Netz');
});

test('checkVoucher: unbekannte Art oder Status in der Antwort ist ein Lesefehler', async () => {
  const f = structuredClone(fall('checkVoucher', 'success_cashier'));
  f.response.data.status = 'frozen';
  await assert.rejects(checkVoucher(kasse(f, []), 'B1KK5EQ57DHP'), (e: unknown) => isKasseneckValidationError(e));
  const g = structuredClone(fall('checkVoucher', 'success_cashier'));
  g.response.data.balanceCents = 3.5;
  await assert.rejects(checkVoucher(kasse(g, []), 'B1KK5EQ57DHP'), (e: unknown) => isKasseneckValidationError(e));
});

test('reprintVoucherLabel: sendet die Id und liefert den Klartext-Code', async () => {
  const f = fall('reprintVoucherLabel', 'success_manager');
  const gesendet: Json[] = [];
  const r = await reprintVoucherLabel(kasse(f, gesendet), 'gmz1');
  assert.equal(gesendet[0]!.url, `${POS_BASE_URL}/reprintVoucherLabel`);
  assert.equal(gesendet[0]!.params.id, 'gmz1');
  assert.deepEqual(r, { code: 'B1KK-5EQ5-7DHP' });
  await assert.rejects(reprintVoucherLabel(kasse(f, []), ''), (e: unknown) => isKasseneckValidationError(e));
});

test('reprintVoucherLabel: fehlendes Recht und unbekannter Gutschein am Code', async () => {
  for (const [name, code] of [['cashier_without_permission', 'not_permitted'], ['unknown', 'voucher_not_found'], ['cancelled', 'voucher_cancelled']] as const) {
    const f = fall('reprintVoucherLabel', name);
    await assert.rejects(reprintVoucherLabel(kasse(f, []), String(f.params.id)), (e: unknown) => e instanceof KasseneckApiError && e.code === code);
  }
});
