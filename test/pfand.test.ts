import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fromReceiptItemPayload, toReceiptItemPayload, isDepositItem, isDepositReturnItem, isTipItem, type ReceiptItem,
} from '../src/models/index.js';
import { createReceiptParams } from '../src/client/receipts.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import { fromStoredReceipt } from '../src/stored/index.js';
import { fromPosArticlePayload, fromArticleGroupPayload } from '../src/pos/artikel.js';
import { posSettingsFromWire } from '../src/pos/client.js';
import { sanitizePosSettings } from '../src/pos/settings.js';
import { depositReturnOf, REGISTER_PERMS } from '../src/register/pairing.js';
import { VatRate } from '../src/enums/index.js';

/*
 * Pfand & Leergut im Paket: Belegzeilen (Lesen, Schreiben, gespeicherte Form), Wunsch an createReceipt,
 * Artikel und Gruppe, Einstellungen, Rechte. Die Namen kommen aus dem Vertrag (/v3), die gespeicherte Form
 * aus src/stored/vokabular.ts (deutsch innen).
 */

const PFAND_ZEILE = {
  name: 'Pfand Mehrweg', quantity: 2, unitPriceCents: 50, vatRate: 20, kind: 'deposit',
  depositTypeId: 'kiste', depositFor: 0, depositKind: 'reusable', perUnit: 50, gtin: '9012345000011', ownFilling: false,
} as const;

test('Pfandzeile vom Server uebersteht Lesen und Schreiben unveraendert', () => {
  const gelesen = fromReceiptItemPayload(PFAND_ZEILE);
  assert.equal(gelesen.kind, 'deposit');
  assert.equal(gelesen.depositTypeId, 'kiste');
  assert.equal(gelesen.depositFor, 0);
  assert.equal(gelesen.depositKind, 'reusable');
  assert.equal(gelesen.perUnit, 50);
  assert.equal(gelesen.gtin, '9012345000011');
  assert.equal(gelesen.ownFilling, false);
  assert.equal(isDepositItem(gelesen), true);
  assert.equal(isDepositReturnItem(gelesen), false);
  assert.deepEqual(toReceiptItemPayload(gelesen), PFAND_ZEILE);
});

test('Leergutzeile (deposit_return) mit Codes uebersteht Lesen und Schreiben; unbrauchbare Codes fallen weg', () => {
  const zeile = { name: 'Leergut', quantity: 3, unitPriceCents: -25, vatRate: 20, kind: 'deposit_return', depositTypeId: 'einweg', depositKind: 'single_use', perUnit: 25, codes: { '9012345000011': 2, '9012345000028': 1 } } as const;
  const gelesen = fromReceiptItemPayload(zeile);
  assert.equal(isDepositReturnItem(gelesen), true);
  assert.deepEqual(gelesen.codes, { '9012345000011': 2, '9012345000028': 1 });
  assert.deepEqual(toReceiptItemPayload(gelesen), zeile);
  const kaputt = fromReceiptItemPayload({ ...zeile, codes: { a: 0, b: 1.5, '': 2 } as unknown as Record<string, number> });
  assert.equal('codes' in kaputt, false);
});

test('eine Warenzeile und ein Trinkgeld bleiben ohne Pfandfelder', () => {
  const ware = fromReceiptItemPayload({ name: 'Bier', quantity: 1, unitPriceCents: 400, vatRate: 20 });
  assert.deepEqual(Object.keys(ware).sort(), ['name', 'priceCents', 'quantity', 'vat']);
  assert.equal(isDepositItem(ware), false);
  assert.equal(isTipItem(fromReceiptItemPayload({ name: 'TG', quantity: 1, unitPriceCents: 100, vatRate: 0, kind: 'tip' })), true);
  // Ein unbekanntes kind faellt weiter weg.
  assert.equal('kind' in fromReceiptItemPayload({ name: 'x', quantity: 1, unitPriceCents: 1, vatRate: 20, kind: 'unbekannt' }), false);
});

test('gespeicherter (roher /api-)Beleg mit pfandartId liest sich wie der /v3-Beleg', () => {
  const roh = (items: unknown[]) => ({
    receiptId: 'KASSE1-ID-9', cashregisterId: 'KASSE1', timeStamp: '2026-11-08T10:15:30', receiptType: 'standard',
    items, vouchers: [], paymentMethod: 'cash', payments: [], qr: 'QR', sig: 'SIG', customerDetails: [], legalMessage: [],
  });
  const beleg = fromStoredReceipt(roh([
    { name: 'Bier', amount: 2, priceOneCents: 400, vat: 20 },
    { name: 'Pfand Mehrweg', amount: 2, priceOneCents: 50, vat: 20, kind: 'pfand', pfandartId: 'kiste', pfandZu: 0, pfandArt: 'mehrweg', jeStueck: 50, eigen: false, gtin: '9012345000011' },
    { name: 'Leergut', amount: 1, priceOneCents: -25, vat: 20, kind: 'pfand_rueckgabe', pfandartId: 'einweg', pfandArt: 'einweg', jeStueck: 25, codes: { '9012345000011': 1 } },
  ]));
  const [, pfand, leergut] = beleg.items;
  assert.deepEqual(pfand, fromReceiptItemPayload({ ...PFAND_ZEILE, gtin: '9012345000011' }));
  assert.equal(isDepositItem(pfand!), true);
  assert.equal(isDepositReturnItem(leergut!), true);
  assert.equal(leergut!.depositKind, 'single_use');
  assert.deepEqual(leergut!.codes, { '9012345000011': 1 });
});

test('createReceiptParams: deposit mit articleId wird abgewiesen, deposit ohne articleId und deposit_return gehen durch', () => {
  const basis = { receiptType: 'standard' as const, payments: [] };
  const zeile = (extra: Partial<ReceiptItem>): ReceiptItem => ({ name: 'Pfand', quantity: 1, vat: VatRate.vat20, priceCents: 50, ...extra });
  assert.throws(
    () => createReceiptParams({ ...basis, items: [zeile({ kind: 'deposit', articleId: 'a1', depositTypeId: 'kiste' })] }),
    (e) => isKasseneckValidationError(e) && /invalid_deposit/.test(e.message),
  );
  const ok = createReceiptParams({
    ...basis,
    items: [zeile({ kind: 'deposit', depositTypeId: 'kiste', depositFor: 0 }), zeile({ kind: 'deposit_return', priceCents: -50, depositTypeId: 'kiste' })],
    autoDeposits: false,
    onPremises: true,
  });
  const items = ok['items'] as Array<Record<string, unknown>>;
  assert.equal(items[0]!['kind'], 'deposit');
  assert.equal(items[1]!['kind'], 'deposit_return');
  assert.equal(ok['autoDeposits'], false);
  assert.equal(ok['onPremises'], true);
  // Ohne Angabe gehen die Felder nicht hinaus.
  const ohne = createReceiptParams({ ...basis, items: [zeile({})] });
  assert.equal('autoDeposits' in ohne, false);
  assert.equal('onPremises' in ohne, false);
  assert.throws(() => createReceiptParams({ ...basis, items: [zeile({})], autoDeposits: 'ja' as unknown as boolean }), isKasseneckValidationError);
});

test('Artikel und Gruppe lesen die Pfandliste; ohne Angabe null', () => {
  const eintraege = [{ depositTypeId: 'kiste', quantity: 1, ownFilling: false }, { depositTypeId: 'einweg', quantity: 2, gtin: '9012345000011' }];
  assert.deepEqual(fromPosArticlePayload({ id: 'a', deposits: eintraege }).deposits, eintraege);
  assert.equal(fromPosArticlePayload({ id: 'a' }).deposits, null);
  assert.deepEqual(fromPosArticlePayload({ id: 'a', deposits: [] }).deposits, []);
  assert.deepEqual(fromArticleGroupPayload({ id: 'g', deposits: eintraege }).deposits, eintraege);
  assert.equal(fromArticleGroupPayload({ id: 'g' }).deposits, null);
  // Ein Eintrag in unbekannter Form faellt weg.
  assert.deepEqual(fromPosArticlePayload({ id: 'a', deposits: [{ depositTypeId: '', quantity: 1 }, { depositTypeId: 'x', quantity: 0 }, eintraege[0]] }).deposits, [eintraege[0]]);
});

const PFAND_BLOCK = {
  singleUse: true, reusable: true,
  depositTypes: [
    { id: 'einweg', kind: 'single_use', name: 'Einweg', type: 'bottle', amounts: [{ from: '2025-01-01', cents: 25 }], returnRate: null, used: true, active: true },
    { id: 'kiste', kind: 'reusable', name: 'Kiste', type: 'crate', amounts: [{ from: '2025-01-01', cents: 300 }, { from: '2026-11-07', cents: 350 }], returnRate: 95, used: false, active: false },
    { id: 'kaputt', kind: 'unbekannt', name: 'x', amounts: [] },
  ],
};

test('Einstellungen: ohne Block fehlt deposit, mit Block wird er gelesen', () => {
  const ohne = posSettingsFromWire({ business: {}, device: {} });
  assert.equal('deposit' in ohne, false);
  assert.equal('deposit' in sanitizePosSettings({ business: {}, device: {} }), false);
  const mit = posSettingsFromWire({ business: {}, device: {}, deposit: PFAND_BLOCK });
  assert.equal(mit.deposit?.singleUse, true);
  assert.equal(mit.deposit?.reusable, true);
  // Die Art in unbekannter Form faellt weg.
  assert.deepEqual(mit.deposit?.depositTypes.map((a) => a.id), ['einweg', 'kiste']);
  assert.deepEqual(mit.deposit?.depositTypes[1], { id: 'kiste', kind: 'reusable', name: 'Kiste', type: 'crate', amounts: PFAND_BLOCK.depositTypes[1]!['amounts'], returnRate: 95, used: false, active: false });
  assert.equal(mit.deposit?.depositTypes[0]?.returnRate, null);
  assert.deepEqual(sanitizePosSettings({ deposit: PFAND_BLOCK }).deposit, mit.deposit);
});

test('Rechte: depositReturn steht in REGISTER_PERMS; fehlend = erteilt, nur ausdruecklich false sperrt', () => {
  assert.ok((REGISTER_PERMS as readonly string[]).includes('depositReturn'));
  assert.equal(depositReturnOf({}), true);
  assert.equal(depositReturnOf({ depositReturn: true }), true);
  assert.equal(depositReturnOf({ depositReturn: false }), false);
  assert.equal(depositReturnOf(null), false);
  assert.equal(depositReturnOf(undefined), false);
});
