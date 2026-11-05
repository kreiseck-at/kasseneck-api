import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADD_ONS_MAX, addOnsFor, addOnsOfItem, addOnRemap, addOnDisplayOrder, addOnReferencesValid, isSelectableAddOn, orderAddOnLines,
  fromPosArticlePayload, fromArticleGroupPayload, type PosArticlePayload, type ArticleGroupPayload,
} from '../src/pos/index.js';
import { fromReceiptItemPayload, toReceiptItemPayload } from '../src/models/receipt-item.js';

type Pos = { addOnOf?: number | null; kind?: string };
interface Faelle {
  articles: Record<string, PosArticlePayload>;
  groups: Record<string, ArticleGroupPayload>;
  selectable: { article: string; reason: string | null }[];
  effective: { name: string; article: string; group: string | null; addOns: string[] }[];
  saveTooMany: { max: number };
  references: { name: string; items: Pos[]; valid: boolean }[];
  cancellation: { name: string; items: Pos[]; index: number; addOns: number[] }[];
  remap: { name: string; items: Pos[]; quantities: number[]; addOnOf: (number | null)[] }[];
  displayOrder: { name: string; items: Pos[]; order: number[] }[];
  receiptOrder: { name: string; lines: { id: string; addOnOf?: string }[]; order: string[]; addOnOf: (number | null)[] }[];
}
const faelle = JSON.parse(readFileSync(new URL('../../fixtures/add-on-cases.json', import.meta.url), 'utf8')) as Faelle;
const artikel = new Map(Object.values(faelle.articles).map((a) => [a.id as string, fromPosArticlePayload(a)]));
const gruppe = (id: string | null) => (id ? fromArticleGroupPayload(faelle.groups[id]!) : null);

test('Pruefaelle: waehlbar als Zusatz', () => {
  for (const f of faelle.selectable) assert.equal(isSelectableAddOn(artikel.get(f.article)!), f.reason, f.article);
});

test('Pruefaelle: wirksame Liste', () => {
  for (const f of faelle.effective) assert.deepEqual(addOnsFor(artikel.get(f.article)!, gruppe(f.group), artikel), f.addOns, f.name);
  // Auch mit einem Objekt statt Map.
  const obj = Object.fromEntries(artikel);
  for (const f of faelle.effective) assert.deepEqual(addOnsFor(artikel.get(f.article)!, gruppe(f.group), obj), f.addOns, f.name);
});

test('Pruefaelle: hoechstens 30 (wie der Server)', () => assert.equal(ADD_ONS_MAX, faelle.saveTooMany.max));

test('Pruefaelle: Verweise der Belegpositionen', () => {
  for (const f of faelle.references) assert.equal(addOnReferencesValid(f.items), f.valid, f.name);
});

test('Pruefaelle: Storno-Vormerkung und -Umrechnung', () => {
  for (const f of faelle.cancellation) assert.deepEqual(addOnsOfItem(f.items, f.index), f.addOns, f.name);
  for (const f of faelle.remap) assert.deepEqual(addOnRemap(f.items, f.quantities), f.addOnOf, f.name);
});

test('Pruefaelle: Bon-Reihenfolge', () => {
  for (const f of faelle.displayOrder) assert.deepEqual(addOnDisplayOrder(f.items), f.order, f.name);
});

test('Pruefaelle: Warenkorb -> Belegpositionen', () => {
  for (const f of faelle.receiptOrder) {
    const r = orderAddOnLines(f.lines);
    assert.deepEqual(r.map((x) => x.line.id), f.order, f.name);
    assert.deepEqual(r.map((x) => x.addOnOf), f.addOnOf, f.name);
  }
});

test('Leser: addOns an Artikel und Gruppe (fehlt = null, nur Texte)', () => {
  assert.equal(fromPosArticlePayload({ id: 'a' }).addOns, null);
  assert.deepEqual(fromPosArticlePayload({ id: 'a', addOns: [] }).addOns, []);
  assert.deepEqual(fromPosArticlePayload({ id: 'a', addOns: ['b', 7, '', 'c'] }).addOns, ['b', 'c']);
  assert.equal(fromPosArticlePayload({ id: 'a', addOns: 'b' }).addOns, null);
  assert.equal(fromArticleGroupPayload({ id: 'g' }).addOns, null);
  assert.deepEqual(fromArticleGroupPayload({ id: 'g', addOns: ['b'] }).addOns, ['b']);
});

test('Belegposition: addOnOf lesen und schreiben, nur als ganze Zahl >= 0', () => {
  assert.equal(fromReceiptItemPayload({ name: 'x', quantity: 1, unitPriceCents: 100, vatRate: 20, addOnOf: 0 }).addOnOf, 0);
  for (const w of [null, -1, 0.5]) {
    assert.equal('addOnOf' in fromReceiptItemPayload({ name: 'x', quantity: 1, unitPriceCents: 100, vatRate: 20, addOnOf: w }), false, String(w));
  }
  const p = fromReceiptItemPayload({ name: 'x', quantity: 1, unitPriceCents: 100, vatRate: 20, addOnOf: 2 });
  assert.equal(toReceiptItemPayload(p).addOnOf, 2);
  assert.equal('addOnOf' in toReceiptItemPayload(fromReceiptItemPayload({ name: 'x', quantity: 1, unitPriceCents: 100, vatRate: 20 })), false);
});
