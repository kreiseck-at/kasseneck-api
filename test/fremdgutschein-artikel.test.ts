import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARTICLE_EXTERNAL_VOUCHER_TYPES, ARTICLE_EXTERNAL_VOUCHER_INVALID, EXTERNAL_VOUCHER_ARTICLE_REASONS, EXTERNAL_VOUCHERS,
  ARTICLE_EXTERNAL_VOUCHER_VAT_RATES, checkExternalVoucherValue, checkExternalVoucherArticle, externalVoucherTileBlock, isArticleExternalVoucher,
  fromPosArticlePayload, isSelectableAddOn,
  EXTERNAL_VOUCHER_TILE_MESSAGES, EXTERNAL_VOUCHER_ARTICLE_MESSAGES, externalVoucherArticleErrorMessage,
  EXTERNAL_VOUCHERS_LABELS, EXTERNAL_VOUCHER_KIND_LABELS, labelText, messageText,
  type ExternalVoucherArticleInput,
} from '../src/pos/index.js';
import { EXTERNAL_VOUCHER_VAT_RATES_BP } from '../src/models/voucher.js';
import { fromStoredArticle } from '../src/stored/index.js';
import { KATALOGE } from '../src/stored/vokabular.js';

interface Faelle {
  values: { name: string; value: unknown; ok: boolean; code?: string; reason?: string }[];
  articles: { name: string; article: ExternalVoucherArticleInput; ok: boolean; code?: string; reason?: string }[];
}
const faelle = JSON.parse(readFileSync(new URL('../../fixtures/external-voucher-article-cases.json', import.meta.url), 'utf8')) as Faelle;

test('Pruefaelle: Wert beim Speichern (gleich dem Backend)', () => {
  assert.ok(faelle.values.length > 0);
  for (const f of faelle.values) {
    const grund = checkExternalVoucherValue(f.value);
    assert.equal(grund, f.ok ? null : f.reason, f.name);
    if (!f.ok) assert.equal(f.code, ARTICLE_EXTERNAL_VOUCHER_INVALID, f.name);
  }
});

test('Pruefaelle: Regeln am Artikel (gleich dem Backend)', () => {
  assert.ok(faelle.articles.length > 0);
  for (const f of faelle.articles) {
    assert.equal(checkExternalVoucherArticle(f.article), f.ok ? null : f.reason, f.name);
    if (!f.ok) assert.equal(f.code, ARTICLE_EXTERNAL_VOUCHER_INVALID, f.name);
  }
  // Jeder Grund kommt in den Pruefaellen vor, und jeder Grund der Faelle ist bekannt.
  const gruende = new Set([...faelle.values, ...faelle.articles].filter((f) => !f.ok).map((f) => f.reason));
  assert.deepEqual([...gruende].sort(), [...EXTERNAL_VOUCHER_ARTICLE_REASONS].sort());
});

test('Saetze des Einzweckgutscheins: dieselben wie beim Fremdgutschein am Beleg', () => {
  assert.deepEqual([...ARTICLE_EXTERNAL_VOUCHER_VAT_RATES].map((p) => Math.round(p * 100)).sort(), [...EXTERNAL_VOUCHER_VAT_RATES_BP].sort());
  assert.equal(checkExternalVoucherArticle({ externalVoucher: 'single_purpose', unitPriceCents: 2500, vatRate: 4.9 }), null);
  assert.equal(checkExternalVoucherArticle({ externalVoucher: 'single_purpose', unitPriceCents: 2500, vatRate: 12.5 }), 'invalid_rate');
  assert.equal(checkExternalVoucherArticle({ externalVoucher: 'multi_purpose', unitPriceCents: 2500, vatRate: 12.5 }), null);
});

test('Arten: dieselben wie der Vertrag (ARTIKEL_FREMDGUTSCHEIN)', () => {
  assert.deepEqual([...ARTICLE_EXTERNAL_VOUCHER_TYPES], Object.values(KATALOGE.ARTIKEL_FREMDGUTSCHEIN!));
  assert.equal(isArticleExternalVoucher('multi_purpose'), true);
  assert.equal(isArticleExternalVoucher('mehrzweck'), false);
});

test('Leser: externalVoucher immer gesetzt, Unbekanntes wird null', () => {
  assert.equal(fromPosArticlePayload({ id: 'a' }).externalVoucher, null);
  assert.equal(fromPosArticlePayload({ id: 'a', externalVoucher: 'multi_purpose' }).externalVoucher, 'multi_purpose');
  assert.equal(fromPosArticlePayload({ id: 'a', externalVoucher: 'single_purpose' }).externalVoucher, 'single_purpose');
  for (const w of ['value', 'einzweck', '', 1, true, null]) {
    assert.equal(fromPosArticlePayload({ id: 'a', externalVoucher: w }).externalVoucher, null, String(w));
  }
});

test('Gespeicherte Form: fremdgutschein -> externalVoucher, unbekannter Wert faellt weg', () => {
  assert.equal(fromStoredArticle('fg', { name: 'Gutschein Bäckerei Kornblum', unitPriceCents: 2500, active: true, fremdgutschein: 'mehrzweck' }).externalVoucher, 'multi_purpose');
  assert.equal(fromStoredArticle('fg', { name: 'Gutschein', unitPriceCents: 2500, vatRate: 20, active: true, fremdgutschein: 'einzweck' }).externalVoucher, 'single_purpose');
  assert.equal(fromStoredArticle('fg', { name: 'Gutschein', unitPriceCents: 2500, active: true, fremdgutschein: 'leistung' }).externalVoucher, null);
  assert.equal(fromStoredArticle('a', { name: 'Semmel', unitPriceCents: 79, active: true }).externalVoucher, null);
});

test('Zusatz: ein fremder Gutschein taugt nicht als Zusatz', () => {
  const a = fromPosArticlePayload({ id: 'fg', name: 'Gutschein', unitPriceCents: 2500, active: true, externalVoucher: 'multi_purpose' });
  assert.equal(isSelectableAddOn(a), 'external_voucher');
});

test('Kachel: gesperrt nach Freigabe und Art', () => {
  const wert = { externalVoucher: 'multi_purpose' as const };
  const leistung = { externalVoucher: 'single_purpose' as const };
  const normal = { externalVoucher: null };
  const erwartet: Record<string, [string | null, string | null, string | null]> = {
    off: ['not_enabled', 'not_enabled', null],
    multi_purpose: [null, 'type_not_enabled', null],
    all: [null, null, null],
  };
  for (const stufe of EXTERNAL_VOUCHERS) {
    assert.deepEqual([wert, leistung, normal].map((a) => externalVoucherTileBlock(a, stufe)), erwartet[stufe], stufe);
  }
  // Ohne Angabe (aeltere Kasse, Einstellungen noch nicht geladen): zu.
  assert.equal(externalVoucherTileBlock(wert, undefined), 'not_enabled');
  assert.equal(externalVoucherTileBlock(wert, null), 'not_enabled');
  assert.equal(externalVoucherTileBlock({}, undefined), null);
});

test('Texte: Saetze und Beschriftungen der Fremdgutscheine', () => {
  assert.equal(messageText(EXTERNAL_VOUCHER_TILE_MESSAGES.not_enabled), 'Fremde Gutscheine sind aus. Bitte im Panel freischalten.');
  assert.equal(messageText(EXTERNAL_VOUCHER_TILE_MESSAGES.type_not_enabled), 'Fremde Leistungsgutscheine sind aus. Bitte im Panel freischalten.');
  assert.equal(messageText('cancellation.external_voucher_check'), 'Vorher im eigenen Gutscheinsystem prüfen, ob er schon benutzt wurde.');
  assert.equal(labelText('external_voucher.line_name', { number: 'W-77' }), 'Gutschein Nr. W-77');
  assert.deepEqual(EXTERNAL_VOUCHERS.map((s) => labelText(EXTERNAL_VOUCHERS_LABELS[s])), ['Aus', 'Nur Wertgutscheine', 'Wert- und Leistungsgutscheine']);
  assert.deepEqual(ARTICLE_EXTERNAL_VOUCHER_TYPES.map((t) => labelText(EXTERNAL_VOUCHER_KIND_LABELS[t])), ['Wertgutschein', 'Leistungsgutschein']);
  assert.deepEqual(Object.keys(EXTERNAL_VOUCHER_ARTICLE_MESSAGES).sort(), [...EXTERNAL_VOUCHER_ARTICLE_REASONS].sort());
});

test('Absage beim Speichern: Satz je Grund, nur fuer den eigenen Code', () => {
  assert.equal(externalVoucherArticleErrorMessage(ARTICLE_EXTERNAL_VOUCHER_INVALID, 'rate_required'), 'external_voucher_article.rate_required');
  assert.equal(externalVoucherArticleErrorMessage(ARTICLE_EXTERNAL_VOUCHER_INVALID, 'price_required'), 'external_voucher_article.price_required');
  assert.equal(externalVoucherArticleErrorMessage(ARTICLE_EXTERNAL_VOUCHER_INVALID, 'invalid_type'), 'external_voucher_article.invalid');
  assert.equal(externalVoucherArticleErrorMessage(ARTICLE_EXTERNAL_VOUCHER_INVALID, 'neuer_grund'), 'external_voucher_article.invalid');
  assert.equal(externalVoucherArticleErrorMessage(ARTICLE_EXTERNAL_VOUCHER_INVALID, 'toString'), 'external_voucher_article.invalid');
  assert.equal(externalVoucherArticleErrorMessage(ARTICLE_EXTERNAL_VOUCHER_INVALID), 'external_voucher_article.invalid');
  assert.equal(externalVoucherArticleErrorMessage('validation', 'rate_required'), undefined);
  assert.equal(externalVoucherArticleErrorMessage(null), undefined);
});
