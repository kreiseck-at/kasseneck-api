#!/usr/bin/env node
/**
 * Erzeugt `fixtures/receipt-due-voucher-generated.json`: Rechenfaelle fuer den
 * Zahlbetrag mit Gutscheinen der neuen Form (`receiptDueBreakdown` mit
 * `voucherInfo`, `voucherTypes`, `voucherArticles`, `smallBusiness`,
 * `today`), gerechnet mit dem **echten Backend-Code** in der Reihenfolge von
 * `createReceipt`: `interneForm`, Trinkgeld (`tip-core.buildTipItems`, hinten
 * angehaengt), `gutschein-beleg.plane`, dann `gutschein-beleg.zahlbetrag`
 * (Toepfe ueber die Wert-/Rabatt-Eintraege ohne Mehrzweck-Verkauf im 0-%-Topf).
 *
 * Abgewiesene Faelle tragen den Code von `plane` (`voucher_*`); der Zwilling
 * muss genau diesen Code in `voucherErrorCode` liefern.
 *
 * Wertgutscheine verkauft der Server seit Gutscheine Stufe 4b nur ueber eine
 * Sorte (`sorteId`, aussen `typeId`): die Faelle tragen die Sorte als
 * Dokument (`sorten` fuer `plane`) und so, wie `getKasseSettings` sie der
 * Kasse zeigt (`voucherTypes`). Frei und fix, mit und ohne Art am Wunsch, dazu
 * die Abweisungen unbekannte Sorte, falscher Fixbetrag und andere Art (beide
 * `voucher_amount_mismatch`: die Sorte gilt als geaendert) und Verkauf ohne
 * Sorte; Auszahlungen mit gesperrter Auszahlung (`nie`). Nach den zufaelligen
 * Faellen stehen feste: eine Einloesung, deren Art nicht zur Pruefung passt
 * (`voucher_invalid`).
 *
 * Der Stichtag des 0-%-Topfs wird nicht verstellt: Faelle „nach dem Stichtag“
 * rechnen mit `heute` = 2100-01-04 gegen das echte `NULLTOPF_AB`.
 *
 * Aufruf: `KASSENECK_BACKEND=../kasseneck node scripts/v3-zahlbetrag-gutscheine-generieren.mjs`
 * (Vorgabe `../kasseneck`). Fester Seed: gleiche Bytes je Backend-Stand.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const SEED = 20261027;
const ANZAHL = 480;
const backend = resolve(process.env.KASSENECK_BACKEND ?? '../kasseneck');
const kern = (datei) => resolve(backend, 'functions/gemeinsam', datei);
const require = createRequire(kern('beleg-toepfe.js'));
const belegToepfe = require(kern('beleg-toepfe.js'));
const tipCore = require(kern('tip-core.js'));
const gutscheinBeleg = require(kern('gutschein-beleg.js'));
const QUELLEN = ['beleg-toepfe.js', 'gutschein-beleg.js', 'gutschein-core.js', 'tip-core.js', 'vat-buckets.js', 'zahlungen-core.js'];

function zufall(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = zufall(SEED);
const ganz = (min, max) => min + Math.floor(r() * (max - min + 1));
const eins = (liste) => liste[Math.floor(r() * liste.length)];
const ja = (p) => r() < p;

const SAETZE = [20, 20, 10, 10, 13, 0, 19, 4.9];
const MENGEN = [1, 2, 3, 0.5, 0.25, 0.333, 1.5, 2.75, 0.125, 1.005];
// Gueltige Codes (Pruefzeichen stimmt), erfunden.
const CODES = ['DTD5-9ECF-5KNZ', '5TD5-9ECF-5KN2', 'CKD59ECF5KNN', '1BD59ECF5KNJ', 'DTD1-NKT1-8CN5'];
const ART = { mehrzweck: 'multi_purpose', einzweck: 'single_purpose', leistung: 'service', aktion: 'promotion' };
const VOR = '2026-10-19';
const NACH = '2100-01-04';

const AUSZAHLUNG = { erlaubt: 'allowed', nie: 'never' };

/** Was checkVoucher der Kasse von einem Gutschein-Dokument zeigt. */
function pruefung(g) {
  const p = { type: ART[g.art], status: 'active', codeSuffix: g.codeEnde };
  if (g.auszahlung != null) p.payout = AUSZAHLUNG[g.auszahlung];
  if (g.saldoCents != null) p.balanceCents = g.saldoCents;
  if (g.satzBp != null) p.vatRateBp = g.satzBp;
  if (g.stueckOffen != null) p.remainingQuantity = g.stueckOffen;
  if (g.rabattCents != null) p.discountCents = g.rabattCents;
  if (g.rabattProzentBp != null) p.discountPercentBp = g.rabattProzentBp;
  if (g.artikel) p.article = { id: g.artikel.id, name: g.artikel.name, vatRateBp: g.artikel.satzBp, priceCents: g.artikel.preisCents };
  if (g.kleinunternehmer === true && g.satzBp === 0) p.exempt = true;
  return p;
}

function fall(i) {
  const items = [];
  for (let k = ganz(1, 4); k > 0; k--) {
    const leistung = ja(0.25);
    items.push({ name: 'P', quantity: leistung ? ganz(1, 3) : eins(MENGEN), priceCents: ja(0.3) ? ganz(1, 99) : ganz(1, 5000), vatRate: eins(SAETZE), ...(leistung ? { articleId: 'item_mani' } : {}) });
  }
  if (ja(0.1)) items.push({ name: 'Discount', quantity: 1, priceCents: -ganz(1, 300), vatRate: eins(SAETZE), kind: 'discount' });
  const szenario = eins(['single_purpose', 'single_purpose', 'multi_purpose', 'service', 'promotion_fixed', 'promotion_percent', 'single_and_multi_purpose', 'single_purpose_exempt',
    'sell_multi_purpose', 'sell_single_purpose', 'sell_service', 'payout_multi_purpose', 'payout_single_purpose', 'sell_legacy_value']);
  const smallBusiness = ja(0.15);
  const today = ja(0.3) ? NACH : VOR;
  const gutscheine = {};
  const server = [];
  const wunsch = [];
  const voucherInfo = [];
  const sorten = {};
  let voucherTypes;
  let voucherArticles;
  let n = 0;
  const neu = (art, extra) => {
    const id = `g${n}`;
    const code = CODES[n++];
    gutscheine[id] = { art, status: 'aktiv', codeEnde: code.replace(/-/g, '').slice(-4), kleinunternehmer: false, gueltigkeit: { muster: 'unbefristet' }, ...extra };
    voucherInfo.push({ code, check: pruefung(gutscheine[id]) });
    return { id, code };
  };
  const einloesen = (art, extra = {}) => {
    let betrag = ganz(1, 6000);
    let satzBp = art === 'einzweck' ? (extra.satzBp ?? Math.round(eins(SAETZE) * 100)) : undefined;
    // Meist ein Betrag, den die Positionen tragen koennen: Satz einer Position, hoechstens ihre Summe.
    const ware = items.filter((p) => p.kind == null);
    if (ware.length > 0 && ja(0.7)) {
      const p = eins(ware);
      if (art === 'einzweck' && extra.satzBp == null) satzBp = Math.round(p.vatRate * 100);
      betrag = ganz(1, Math.max(1, Math.round(p.priceCents * p.quantity)));
    }
    const { id, code } = neu(art, { saldoCents: ganz(Math.max(1, betrag - 300), betrag + 3000), ...(satzBp != null ? { satzBp } : {}), ...extra });
    server.push({ type: art, action: 'redeem', code, gutscheinId: id, betragCents: betrag });
    wunsch.push({ type: ART[art], action: 'redeem', code, amountCents: betrag });
  };
  /**
   * Wert-Verkauf ueber eine Sorte: Dokument fuer den Server, Sicht der Kasse
   * (meist bekannt, sonst voucher_type_not_found), Wunsch mit oder ohne Art.
   */
  const verkaufen = (art) => {
    const satzBp = art === 'einzweck' ? Math.round(eins(SAETZE) * 100) : null;
    const fix = ja(0.4);
    const betrag = fix ? { modus: 'fix', cents: ganz(100, 9000) } : { modus: 'frei' };
    // Meist der Fixbetrag, selten ein anderer (voucher_amount_mismatch).
    const c = fix ? (ja(0.75) ? betrag.cents : betrag.cents + ganz(1, 50)) : ganz(1, 9000);
    const id = `vt_${art}_${i}`;
    const daten = {
      name: 'Geschenkgutschein', art, ...(satzBp != null ? { satzBp } : {}), betrag,
      gueltigkeit: ja(0.5) ? { muster: 'unbefristet' } : { muster: 'jahre', jahre: ganz(1, 5) },
      auszahlung: 'erlaubt', reihenfolge: 0, aktiv: true, verkauft: 0,
    };
    if (ja(0.92)) {
      sorten[id] = daten;
      voucherTypes = [...(voucherTypes ?? []), { id, kind: ART[art], vatRateBp: satzBp, amount: fix ? { mode: 'fixed', cents: betrag.cents } : { mode: 'free' } }];
    }
    // Art am Wunsch: oft gleich der Sorte, manchmal weggelassen, selten falsch (voucher_amount_mismatch).
    const wahl = r();
    const typ = wahl < 0.45 ? art : wahl < 0.95 ? null : (art === 'mehrzweck' ? 'einzweck' : 'mehrzweck');
    // Selten ganz ohne Sorte (nur mit Art, sonst waere es kein Wunsch der neuen Form): voucher_type_required.
    const ohneSorte = typ != null && ja(0.05);
    server.push({ action: 'sell', ...(typ != null ? { type: typ } : {}), ...(ohneSorte ? {} : { sorteId: id }), betragCents: c });
    wunsch.push({ action: 'sell', ...(typ != null ? { type: ART[typ] } : {}), ...(ohneSorte ? {} : { typeId: id }), amountCents: c });
  };
  if (szenario === 'single_purpose') einloesen('einzweck');
  if (szenario === 'multi_purpose') einloesen('mehrzweck');
  if (szenario === 'single_and_multi_purpose') { einloesen('einzweck'); einloesen('mehrzweck'); }
  if (szenario === 'single_purpose_exempt') einloesen('einzweck', { satzBp: 0, kleinunternehmer: true });
  if (szenario === 'service') {
    let pos = items.map((_, k) => k).filter((k) => items[k].articleId && ja(0.8));
    if (pos.length === 0) pos = [0];
    const { id, code } = neu('leistung', { stueck: 8, stueckOffen: ganz(1, 8), satzBp: 2000, artikel: { id: 'item_mani', name: 'Manicure', satzBp: 2000, preisCents: 3500 } });
    server.push({ type: 'leistung', action: 'redeem', code, gutscheinId: id, positionen: pos });
    wunsch.push({ type: 'service', action: 'redeem', code, positions: pos });
  }
  if (szenario.startsWith('promotion')) {
    const { id, code } = neu('aktion', szenario === 'promotion_fixed' ? { rabattCents: ganz(1, 9000) } : { rabattProzentBp: ganz(1, 10000) });
    server.push({ type: 'aktion', action: 'redeem', code, gutscheinId: id });
    wunsch.push({ type: 'promotion', action: 'redeem', code });
  }
  if (szenario.startsWith('sell_') || szenario.startsWith('payout_')) items.length = ja(0.5) ? 0 : Math.min(items.length, 1);
  if (szenario === 'sell_multi_purpose') verkaufen('mehrzweck');
  if (szenario === 'sell_single_purpose') verkaufen('einzweck');
  if (szenario === 'sell_service') {
    const preis = ganz(1, 9000);
    const satz = eins(SAETZE);
    const stueck = ganz(1, 5);
    server.push({ type: 'leistung', action: 'sell', artikelId: 'item_pedi', stueck, artikel: { id: 'item_pedi', name: 'Pedicure', vatRate: satz, preisCents: preis } });
    wunsch.push({ type: 'service', action: 'sell', articleId: 'item_pedi', quantity: stueck });
    voucherArticles = [{ id: 'item_pedi', priceCents: preis, vatRateBp: Math.round(satz * 100) }];
  }
  if (szenario === 'sell_legacy_value') {
    const c = ganz(1, 9000);
    server.push({ type: 'value', action: 'sell', value: c / 100, valueCents: c });
    wunsch.push({ type: 'value', action: 'sell', valueCents: c });
  }
  if (szenario.startsWith('payout_')) {
    items.length = 0;
    const art = szenario === 'payout_multi_purpose' ? 'mehrzweck' : 'einzweck';
    const c = ganz(1, 5000);
    // Gutscheine einer Sorte tragen ihre Auszahlung; selten gesperrt (voucher_payout_not_allowed).
    const auszahlung = ja(0.5) ? {} : { auszahlung: ja(0.2) ? 'nie' : 'erlaubt' };
    const { id, code } = neu(art, { saldoCents: c + ganz(0, 100), ...auszahlung, ...(art === 'einzweck' ? { satzBp: Math.round(eins(SAETZE) * 100) } : {}) });
    server.push({ type: art, action: 'payout', code, gutscheinId: id, betragCents: c, grund: 'Goodwill' });
    wunsch.push({ type: ART[art], action: 'payout', code, amountCents: c, reason: 'Goodwill' });
  }
  if (items.length === 0 && !wunsch.some((v) => v.action === 'sell' || v.action === 'payout')) items.push({ name: 'P', quantity: 1, priceCents: ganz(1, 5000), vatRate: 20 });

  const input = { receiptType: 'standard', items, vouchers: wunsch, today };
  if (voucherInfo.length > 0) input.voucherInfo = voucherInfo;
  if (voucherTypes) input.voucherTypes = voucherTypes;
  if (voucherArticles) input.voucherArticles = voucherArticles;
  if (smallBusiness) input.smallBusiness = true;
  if (items.some((p) => p.kind == null) && ja(0.3)) {
    input.tipRecipient = ja(0.5) ? 'owner' : 'staff';
    input.tip = ganz(1, 500);
  }
  return { name: `gen_voucher_${i}_${szenario}`, input, server: { vouchers: server, gutscheine, sorten } };
}

const tief = (x) => JSON.parse(JSON.stringify(x));
const TOEPFE = ['amountRateStandard', 'amountRateReduced1', 'amountRateReduced2', 'amountRateZero', 'amountRateSpecial', 'amountRatOthers'];

/** Wie createReceipt: Positionen, Trinkgeld, plane, zahlbetrag. */
function rechne({ input, server }) {
  const draht = input.items.map((p) => ({
    name: p.name, quantity: p.quantity, unitPriceCents: p.priceCents, vatRate: p.vatRate,
    ...(p.kind ? { kind: p.kind } : {}), ...(p.articleId ? { articleId: p.articleId } : {}),
  }));
  let alle = belegToepfe.interneForm(tief(draht), []).items;
  if (input.tip != null) {
    const empf = [{ registerUserId: 'ru_login', name: 'Login', inhaber: input.tipRecipient === 'owner', cents: input.tip }];
    const gebaut = tipCore.buildTipItems({ tip: { cents: input.tip, paymentMethod: 'cash', recipients: null }, receiptItems: alle, empfaenger: empf });
    if (gebaut.error) return { error: gebaut.error };
    alle = [...alle, ...gebaut.items];
  }
  const plan = gutscheinBeleg.plane({
    items: alle, vouchers: tief(server.vouchers), gutscheine: server.gutscheine, sorten: server.sorten,
    heute: input.today, receiptType: input.receiptType, kleinunternehmer: input.smallBusiness === true,
  });
  if (plan.fehler) return { voucherError: plan.fehler };
  // gutschein-beleg.zahlbetrag, mit den Toepfen fuer den Vergleich.
  const alt = plan.vouchers.filter((v) => v && (v.type === 'value' || v.type === 'promo') && !(v.action === 'sell' && v.imNullTopf === true));
  const t = belegToepfe.belegToepfe(plan.items, alt);
  const due = gutscheinBeleg.zahlbetrag(plan.items, plan.vouchers, input.receiptType);
  return {
    dueCents: due,
    counterDeltaCents: t.zaehlerDeltaCents,
    valueVoucherFlowCents: due - t.zaehlerDeltaCents,
    bucketsCents: Object.fromEntries(TOEPFE.map((b) => [b, Math.round(t[b] * 100)])),
  };
}

/**
 * Feste Faelle nach den zufaelligen (die Folge des Seeds bleibt gleich): eine Einloesung, deren Art nicht zur Pruefung
 * passt, bleibt `voucher_invalid` – nur ein Sorten-Verkauf mit anderer Art ist `voucher_amount_mismatch`.
 */
function feste() {
  const code = CODES[0];
  const codeEnde = code.replace(/-/g, '').slice(-4);
  const items = [{ name: 'P', quantity: 1, priceCents: 2000, vatRate: 20 }];
  const faelle = [
    { wunschArt: 'einzweck', g: { art: 'mehrzweck', saldoCents: 5000 } },
    { wunschArt: 'mehrzweck', g: { art: 'einzweck', satzBp: 2000, saldoCents: 5000 } },
  ];
  return faelle.map(({ wunschArt, g: teil }, k) => {
    const g = { status: 'aktiv', codeEnde, kleinunternehmer: false, gueltigkeit: { muster: 'unbefristet' }, ...teil };
    return {
      name: `gen_voucher_${ANZAHL + k}_redeem_wrong_kind`,
      input: { receiptType: 'standard', items, vouchers: [{ type: ART[wunschArt], action: 'redeem', code, amountCents: 1000 }], today: VOR,
        voucherInfo: [{ code, check: pruefung(g) }] },
      server: { vouchers: [{ type: wunschArt, action: 'redeem', code, gutscheinId: 'g0', betragCents: 1000 }], gutscheine: { g0: g }, sorten: {} },
    };
  });
}

const cases = [...Array.from({ length: ANZAHL }, (_, i) => fall(i)), ...feste()].map((f) => ({ name: f.name, input: f.input, expected: rechne(f) }));
const inhalt = JSON.parse(JSON.stringify({ seed: SEED, cases }, (_k, v) => (Object.is(v, -0) ? 0 : v)));
const quellen = Object.fromEntries(QUELLEN.map((d) => [d, createHash('sha256').update(readFileSync(kern(d))).digest('hex')]));
const note = 'Erzeugt von scripts/v3-zahlbetrag-gutscheine-generieren.mjs mit dem echten Backend-Code. Nicht von Hand pflegen.';
const kopf = JSON.stringify({ _note: note, _source: quellen, seed: inhalt.seed }, null, 2).replace(/\n}$/, '');
const zeilen = inhalt.cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n');
writeFileSync(new URL('../fixtures/receipt-due-voucher-generated.json', import.meta.url), `${kopf},\n  "cases": [\n${zeilen}\n  ]\n}\n`);
const abgewiesen = cases.filter((c) => c.expected.voucherError).length;
console.log(`${cases.length} Faelle geschrieben (${abgewiesen} abgewiesen), Backend ${backend}`);
