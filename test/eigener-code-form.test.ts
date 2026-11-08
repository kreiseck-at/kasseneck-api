import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoucherCode } from '@kreiseck/validator';

import { ownVoucherCodeShape, OWN_VOUCHER_CODE_SHAPES, checkExternalVoucherNumber } from '../src/index.js';
import { labelText, messageText } from '../src/pos/index.js';

// Ein gueltiger eigener Code (Pruefzeichen V) und derselbe mit falschem Pruefzeichen.
const CODE = '1234-5678-9ABV';
const FALSCH = '1234-5678-9AB0';

test('ownVoucherCodeShape: gueltiger eigener Code in jeder Schreibweise der Kasse', () => {
  assert.equal(VoucherCode.isValid(CODE), true);
  for (const t of [CODE, CODE.toLowerCase(), '1234.5678.9ABV', '1234_5678/9ABV', ` ${CODE} `, ' 123456789ABV　', '1234 5678 9ABV']) {
    assert.equal(ownVoucherCodeShape(t), 'valid', JSON.stringify(t));
  }
});

test('ownVoucherCodeShape: 12 Zeichen des Alphabets mit falschem Pruefzeichen = checksum', () => {
  assert.equal(VoucherCode.isValid(FALSCH), false);
  for (const t of [FALSCH, '123456789AB0', '100000000000', 'ABCD-EFGH-IJKL', 'oooo-llll-iiii']) {
    assert.equal(ownVoucherCodeShape(t), 'checksum', t);
  }
});

test('ownVoucherCodeShape: Muster 4-4-x mit eigenen Bindestrichen, falsche Laenge = length', () => {
  for (const t of ['7148-FGQA-935', '7148-FGQA-935KX', '7148.FGQA.93', 'abcd-efgh-j']) {
    assert.equal(ownVoucherCodeShape(t), 'length', t);
  }
});

test('ownVoucherCodeShape: keine Aehnlichkeit = none', () => {
  // Ohne Bindestriche zaehlt nur die genaue Laenge; Zeichen ausserhalb des Alphabets (U, +) passen nie.
  for (const t of ['W-77', '123456789', '12345678901234', '12345678901U', 'ABCD-EFGH', 'abcd-efgh-ij+k', '7148--FGQA-935', 'UUUU-UUUU-UU', '', '   ']) {
    assert.equal(ownVoucherCodeShape(t), 'none', JSON.stringify(t));
  }
  for (const w of [null, undefined, 123456789012, {}]) assert.equal(ownVoucherCodeShape(w), 'none', String(w));
});

test('ownVoucherCodeShape: valid genau dann, wenn der Server die Nummer als eigenen Code abweist', () => {
  for (const t of [CODE, FALSCH, '7148.FGQA.935K', '7148-FGQA-935', 'W-77', '100000000000']) {
    const c = checkExternalVoucherNumber(t);
    assert.equal(ownVoucherCodeShape(t) === 'valid', !c.ok && c.code === 'external_voucher_number_is_own_code', t);
  }
  assert.deepEqual([...OWN_VOUCHER_CODE_SHAPES], ['valid', 'checksum', 'length', 'none']);
});

test('Texte der Nachfrage', () => {
  assert.equal(messageText('external_voucher.looks_like_own_code'), 'Sieht aus wie ein Kasseneck-Code, ist aber keiner. Als fremden Gutschein verwenden?');
  assert.equal(labelText('external_voucher.use_as_external'), 'Als fremden Gutschein');
});
