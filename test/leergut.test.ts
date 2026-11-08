import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { learnReturnCode, listReturnCodes, matchReturnCode, type ReturnCodeInput, type ReturnCodeMatch } from '../src/pos/leergut.js';
import { isKasseneckValidationError } from '../src/client/errors.js';

const datei = JSON.parse(readFileSync(new URL('../../fixtures/return-code-cases.json', import.meta.url), 'utf8')) as {
  cases: Array<{ name: string; input: ReturnCodeInput & { code: string }; expected: ReturnCodeMatch }>;
};

for (const f of datei.cases) {
  test(`Leergut-Scan: ${f.name}`, () => {
    const { code, ...rest } = f.input;
    assert.deepEqual(matchReturnCode(code, rest), f.expected);
  });
}

type Aufruf = { name: string; params: unknown };
const transport = (antwort: unknown, log: Aufruf[] = []) =>
  (async (name: string, params: unknown) => { log.push({ name, params }); return antwort; }) as never;

test('learnReturnCode sendet gtin und depositTypeId an learnMyLeergutCode', async () => {
  const log: Aufruf[] = [];
  const r = await learnReturnCode(transport({ gtin: '9012345001025', depositTypeId: 'flasche' }, log), { gtin: '9012345001025', depositTypeId: 'flasche' });
  assert.deepEqual(r, { gtin: '9012345001025', depositTypeId: 'flasche' });
  assert.deepEqual(log, [{ name: 'learnMyLeergutCode', params: { gtin: '9012345001025', depositTypeId: 'flasche' } }]);
});

test('learnReturnCode prueft die Form vor dem Senden', async () => {
  const log: Aufruf[] = [];
  for (const falsch of [{ gtin: '9012345001024', depositTypeId: 'flasche' }, { gtin: '9012345001025', depositTypeId: '' }, { gtin: '9012345001025', depositTypeId: 'x', extra: 1 }]) {
    await assert.rejects(learnReturnCode(transport({}, log), falsch as never), isKasseneckValidationError);
  }
  assert.equal(log.length, 0);
});

test('listReturnCodes liest codes und ueberspringt Unlesbares', async () => {
  const log: Aufruf[] = [];
  const r = await listReturnCodes(transport({ codes: [{ gtin: '9012345001025', depositTypeId: 'flasche' }, { gtin: 5 }, null] }, log));
  assert.deepEqual(r, [{ gtin: '9012345001025', depositTypeId: 'flasche' }]);
  assert.equal(log[0]!.name, 'listMyLeergutCodes');
  assert.deepEqual(await listReturnCodes(transport({})), []);
});
