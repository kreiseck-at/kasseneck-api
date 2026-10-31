import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECEIPT_EMAIL_ERROR_MESSAGES, LABELS, ERROR_RULES, MESSAGES, CANCELLATION_PAYMENT_ERROR_MESSAGES, receiptEmailErrorMessage, messageText, labelText, type MessageKey, type LabelKey } from '../src/pos/texte.js';
import { RECEIPT_EMAIL_SEND_ERROR_CODES } from '../src/models/index.js';
import { INVOICE_TEXTS, invoiceText, type InvoiceTextKey } from '../src/invoice/texte.js';

/*
 * Zwilling der Umbenennung 0.x -> 1.0: die Tabelle `fixtures/renames-1.0.json`
 * (erzeugt von scripts/umbenennung-1.0.mjs) gegen den eingefrorenen 0.x-Stand
 * in `test/fixtures/vor-1.0/`.
 *
 * - jeder alte Katalogschluessel steht genau einmal in der Tabelle, die neuen
 *   sind eindeutig und englisch geschrieben;
 * - Platzhalter: die Zuordnung ist eins zu eins, und jeder Text jedes
 *   Katalogs ergibt, alt und neu mit denselben Werten gefuellt, Zeichen fuer
 *   Zeichen denselben Satz;
 * - Strukturschluessel nach Abschnitt `structure`, Dateipfade nach `files`;
 * - was auf einen Schluessel zeigt (Fehlerregeln, Code-Zuordnungen), zeigt
 *   auf den umbenannten.
 *
 * Die Texte bleiben deutsch: sie sind fuer Kassiere und Rechnungsempfaenger in
 * Oesterreich geschrieben.
 */

type Json = Record<string, any>;
const wurzel = fileURLToPath(new URL('../../', import.meta.url));
const lies = (pfad: string): Json => JSON.parse(readFileSync(join(wurzel, pfad), 'utf8')) as Json;

const TABELLE = lies('fixtures/renames-1.0.json');
const ALT_KASSE = lies('test/fixtures/vor-1.0/kasse-texte.json');
const ALT_RECHNUNG = lies('test/fixtures/vor-1.0/rechnung-texte.json');
const ALT_FAELLE = lies('test/fixtures/vor-1.0/kasse-meldungen-faelle.json');
const NEU_KASSE = lies('fixtures/pos-texts.json');
const NEU_RECHNUNG = lies('fixtures/invoice-texts.json');
const NEU_FAELLE = lies('fixtures/pos-message-cases.json');
const VOKABULAR = lies('fixtures/v3/v3-vokabular.json');
const STRUKTUR = TABELLE.structure as Record<string, Record<string, Record<string, string>>>;
const K = STRUKTUR['pos-texts.json']!;
const WERTE = TABELLE.values as Record<string, Record<string, Record<string, string>>>;
const ART = WERTE['pos-texts.json']!['errorRules[].kind']!;

/**
 * Nach dem Umstieg dazugekommen (1.0.0-rc.5, Befunde aus dem Web-Umstieg):
 * ohne 0.x-Vorgaenger, darum in keiner Umbenennung. Alles andere bleibt der
 * 0.x-Stand, nur umbenannt.
 */
const NACH_1_0 = {
  messages: ['network.outcome_unknown', 'server.connection_disturbed', 'server.response_unreadable', 'codetable.question', 'codetable.instruction', 'codetable.question_hint', 'codetable.instruction_none', 'cancellation.input_rejected',
    'stocktake.none_open', 'stocktake.scan_or_search', 'stocktake.counted', 'stocktake.blind_hint', 'stocktake.recount_hint', 'stocktake.unknown_code',
    'stocktake.quantity_invalid', 'stocktake.serials_capture', 'stocktake.serials_mismatch', 'stocktake.reason_missing', 'stocktake.outcome_unknown',
    // Schicht und Kassenstand (1.9.0)
    'shift.required', 'shift.required_other', 'shift.recount', 'shift.comment_required', 'shift.closed', 'shift.long_open', 'shift.already_open',
    'shift.already_closed', 'shift.recount_exhausted', 'shift.outcome_unknown', 'cash_movement.exceeds_balance', 'cash_movement.note_required', 'cash_movement.booked',
    'cash_movement.type_invalid', 'cash_movement.same_drawer', 'tip_payout.exceeds_claim', 'denominations.invalid', 'amount.invalid', 'drawer.not_found',
    'drawer.inactive', 'tip_payout.recipient_required', 'shift.pending_hint', 'shift.mode_off', 'tip.kept_setting_hint',
    // Storno mit oder ohne Trinkgeld (1.11.0)
    'cancellation.tip_refund_missing', 'cancellation.tip_source_missing', 'cancellation.tip_refunded_with_voucher',
    // Kassenstand und Trinkgeld-Liste an der Kasse (1.11.0)
    'tip_payout.none_open',
    // Wechselgeld je Kassenlade und Entnehmen/Einlegen beim Abschluss (1.11.0)
    'shift.change_float_missing', 'logout.cart_cleared',
    // Gutscheine an der Kasse (1.12.0)
    'voucher_error.not_found', 'voucher_error.invalid', 'voucher_error.invalid_code', 'voucher_error.expired', 'voucher_error.used_up', 'voucher_error.blocked', 'voucher_error.cancelled', 'voucher_error.insufficient_balance', 'voucher_error.exceeds_total', 'voucher_error.balance_changed', 'voucher_error.rate_mismatch', 'voucher_error.item_mismatch', 'voucher_error.already_used', 'voucher_error.partial_cancel', 'voucher_error.settings_missing', 'voucher_error.too_many_checks', 'voucher_error.sale_off',
    // Gutscheine an der Kasse, Stufe 3 (1.13.0)
    'voucher.reentry_needed', 'voucher.reentry_mismatch', 'voucher.not_this_voucher', 'voucher.reentry_no_permission', 'voucher.already_covered', 'voucher.payout_reason_too_long', 'voucher.payout_reason_missing', 'voucher.payout_check_first', 'voucher.sale_max_amount', 'voucher.sale_not_at_terminal', 'voucher.no_redeem_with_sale', 'voucher.code_not_on_receipt', 'cancellation.voucher_sale_cancelled', 'cancellation.promo_valid_again',
    // Gutschein-Sorten (1.17.0)
    'voucher_error.type_required', 'voucher_error.type_not_found', 'voucher_error.amount_mismatch', 'voucher_error.service_not_allowed', 'voucher_error.payout_not_allowed',
    'voucher.type_changed',
    // Prüfung (DEP) an der Kasse (1.21.0)
    'dep.manager_only', 'dep.offline', 'dep.creating', 'dep.running', 'dep.failed', 'dep.too_many_exports', 'dep.period_invalid',
    'dep.usb_hint', 'dep.saved', 'dep.save_failed', 'dep.zip_fallback', 'dep.code_once', 'dep.revoked',
    // Reiter „Prüfung“: Kasseninfo für den Prüfer (1.23.0)
    'inspection.how_it_works_text', 'inspection.print_question', 'inspection.load_failed'],
  labels: ['register.device_unnamed', 'login.locked_seconds', 'split.remaining_with_rounding', 'codetable.title', 'codetable.reference', 'codetable.replacement_note', 'codetable.missing', 'codetable.print_again', 'codetable.not_checked', 'codetable.check', 'codetable.current', 'codetable.instruction_title', 'codetable.preview_title', 'codetable.apply', 'codetable.other_row',
    'stock.all_articles', 'stock.location', 'stock.default_location', 'stock.resolved', 'stock.where_to', 'stock.available',
    'stock.return_restock', 'stock.return_defective', 'stock.return_disposed',
    'stocktake.title', 'stocktake.quantity', 'stocktake.defective', 'stocktake.count_zero', 'stocktake.next', 'stocktake.void', 'stocktake.reason',
    'stocktake.progress', 'stocktake.serial_numbers', 'stocktake.recount', 'stocktake.resend', 'stocktake.my_counts', 'stocktake.sent',
    'stocktake.unconfirmed', 'stocktake.voided',
    // Schicht und Kassenstand (1.9.0)
    'shift.open_title', 'shift.take_over', 'shift.count', 'shift.by_denomination', 'shift.close_title', 'shift.cash_title',
    'shift.x_report', 'shift.pay_out_tips', 'drawer.reason_title', 'drawer.reason_change', 'drawer.reason_check',
    'drawer.reason_misoperation', 'drawer.reason_other', 'cash_movement.type_change_in', 'cash_movement.type_cash_drop', 'cash_movement.type_owner_deposit', 'cash_movement.type_owner_withdrawal',
    'cash_movement.type_tip_payout', 'cash_movement.type_other_in', 'cash_movement.type_other_out', 'cash_movement.type_transfer_out', 'cash_movement.type_transfer_in', 'cash_movement.type_expense',
    'cash_movement.type_count_difference', 'cash_movement.type_handover_difference', 'shift_receipt.title_close', 'shift_receipt.title_interim', 'shift_receipt.title_movement', 'shift_receipt.cashregister',
    'shift_receipt.drawer', 'shift_receipt.shift', 'shift_receipt.number', 'shift_receipt.opened', 'shift_receipt.closed', 'shift_receipt.by',
    'shift_receipt.opening_float', 'shift_receipt.opening_float_taken_over', 'shift_receipt.cash_sales', 'shift_receipt.cash_cancellations', 'shift_receipt.movements', 'shift_receipt.expected',
    'shift_receipt.counted', 'shift_receipt.difference', 'shift_receipt.comment', 'shift_receipt.non_cash', 'shift_receipt.receipts', 'shift_receipt.cancellations',
    'shift_receipt.openings_without_sale', 'shift_receipt.tips', 'shift_receipt.tip_earned', 'shift_receipt.tip_retained', 'shift_receipt.tip_paid_out', 'shift_receipt.tip_open', 'shift_receipt.movement_number',
    'shift_receipt.type', 'shift_receipt.amount', 'shift_receipt.location', 'shift_receipt.location_bank', 'shift_receipt.location_safe', 'shift_receipt.recipient',
    'shift_receipt.target_drawer', 'shift_receipt.note', 'shift_receipt.operator', 'shift_receipt.time',
    'cash_movement.pay_in', 'cash_movement.pay_out', 'cash_movement.print', 'drawer.recent_openings', 'drawer.reason_sale', 'drawer.reason_cash_movement', 'drawer.reason_shift_open', 'drawer.reason_shift_close', 'shift.resend', 'shift.next', 'shift.print_close', 'shift.print_again', 'shift.back_to_register', 'shift.later', 'time.yesterday',
    // Bar-Trinkgeld „gleich behalten“ (1.11.0)
    'checkout.tip_kept', 'tip.kept_setting',
    // Storno mit oder ohne Trinkgeld (1.11.0)
    'cancellation.tip_refund_question', 'cancellation.tip_refund_yes', 'cancellation.tip_refund_no', 'cancellation.tip_source_question',
    'cancellation.tip_source_drawer', 'cancellation.tip_source_employee', 'cancellation.tip_stays', 'shift_receipt.tip_refunded_by_employee', 'shift_receipt.tip_carried_over',
    // Kassenstand und Trinkgeld-Liste an der Kasse (1.11.0)
    'shift.drawer_should_have', 'shift.drawer_named', 'shift.running_since', 'shift.since', 'shift.collected_outside_drawer', 'shift.non_cash_short',
    'shift.voucher_redeemed', 'shift.all_payments', 'shift.receipt_count_one', 'shift.receipt_count_other', 'shift.openings_without_sale_count',
    'cash_movement.pay_in_short', 'cash_movement.pay_out_short', 'drawer.recent_openings_full',
    'duration.days_one', 'duration.days_other', 'duration.hours', 'duration.minutes',
    'tip_payout.open_amount', 'tip_payout.done', 'tip_payout.for_all', 'tip_payout.nothing', 'tip_payout.all_open',
    'tip_payout.title', 'tip_payout.persons_one', 'tip_payout.persons_other', 'tip_payout.pay_amount', 'tip_payout.pay_out',
    // Druckwarnung an der Kasse (1.11.0)
    'printer.warn_unreachable', 'printer.warn_none', 'printer.check', 'printer.set_up',
    // Wechselgeld je Kassenlade und Entnehmen/Einlegen beim Abschluss (1.11.0)
    'shift_receipt.taken_out', 'shift_receipt.put_in', 'shift_receipt.left_in_drawer',
    'drawer.change_float', 'drawer.change_float_hint', 'drawer.change_float_empty_hint', 'shift.step_take_out', 'shift.left_in_drawer',
    'shift.change_float_next_shift', 'shift.take_out', 'shift.put_in', 'shift.take_out_at_most', 'shift.put_in_hint', 'shift.after_count_tap_hint',
    'shift.take_out_amount', 'shift.put_in_amount', 'shift.continue_without_take_out', 'shift.print_envelope_receipt', 'shift.toggle_take_out_put_in',
    'shift.put_in_change_float', 'shift.taken_over_from_shift', 'shift.counted', 'shift.back', 'shift.done', 'shift.edit_amount',
    'shift.pay_ins', 'shift.pay_outs', 'cash_movement.pay_in_amount', 'cash_movement.pay_out_amount',
    // Gutscheine an der Kasse (1.12.0)
    'voucher.button', 'voucher.redeem', 'voucher.sell', 'voucher.payout', 'voucher.code', 'voucher.scan', 'voucher.check', 'voucher.amount', 'voucher.balance', 'voucher.remaining_quantity', 'voucher.reason', 'voucher.multi_purpose', 'voucher.single_purpose', 'voucher.service', 'voucher.promotion', 'voucher.payment_line', 'voucher.covers_items', 'voucher.code_shown_once', 'voucher.not_in_split', 'voucher.payout_not_possible', 'voucher.add_article', 'voucher.payout_confirm', 'cancellation.voucher_back',
    // Gutscheine an der Kasse, Stufe 3 (1.13.0)
    'voucher.apply', 'voucher.redeemable_until', 'voucher.remove_line', 'voucher.reenter_code', 'voucher.refundable_until', 'voucher.code_done', 'voucher.article', 'voucher.add',
    // Kassen-Navigation, Beleg-Fertig-Seite, Mengen, Gutschein-Auszahlung (1.14.0)
    'drawer.reason_voucher_payout', 'quantity.at_most', 'quantity.at_least', 'receipts.number_hint', 'receipts.clear_number', 'receipts.open', 'receipt.creating',
    'receipt_done.sale_title', 'receipt_done.paid_by_voucher', 'receipt_done.payout_title', 'receipt_done.paid_out', 'voucher.code_mask', 'cart.close',
    'nav.register', 'nav.receipts', 'nav.vouchers', 'nav.open_drawer', 'nav.stocktake', 'nav.settings', 'nav.settings_locked', 'nav.logout', 'nav.logging_out',
    'nav.fullscreen', 'nav.fullscreen_exit',
    // Ausgaben eines Belegs am Belegdetail (1.14.0)
    'receipt.outputs_title', 'receipt.outputs_count', 'receipt.output_print', 'receipt.output_reprint', 'receipt.output_email',
    'receipt.output_link_shared', 'receipt.output_pdf_shared', 'receipt.output_opened', 'receipt.output_failed',
    // Gutschein-Sorten als Kacheln im Reiter „Gutscheine“ (1.17.0)
    'voucher.tab', 'voucher.enter_amount', 'voucher.service_tile', 'voucher.kind_multi_short', 'voucher.kind_single_short',
    // Prüfung (DEP) an der Kasse (1.21.0)
    'nav.dep', 'dep.title', 'dep.period', 'dep.period_all', 'dep.period_year', 'dep.period_quarter', 'dep.period_custom', 'dep.from', 'dep.to',
    'dep.create', 'dep.receipts', 'dep.save_usb', 'dep.handover_link', 'dep.code', 'dep.valid_until', 'dep.revoke', 'dep.checksum', 'dep.new_export',
    // Reiter „Prüfung“ mit Kasseninfo, Nullbeleg und DEP (1.23.0)
    'nav.inspection', 'inspection.part_inspector', 'inspection.part_zero_receipt', 'inspection.part_dep', 'inspection.title',
    'inspection.product_cloud', 'inspection.manufacturer', 'inspection.vat_id', 'inspection.cashregister_id', 'inspection.signature',
    'inspection.unit', 'inspection.unit_a_trust', 'inspection.unit_test_card', 'inspection.hosting', 'inspection.hosting_server',
    'inspection.certificate', 'inspection.serial_hex', 'inspection.serial_decimal', 'inspection.serial_decimal_only', 'inspection.holder',
    'inspection.issuer', 'inspection.valid', 'inspection.valid_range', 'inspection.valid_from', 'inspection.valid_to', 'inspection.check',
    'inspection.check_holder', 'inspection.status', 'inspection.status_active', 'inspection.status_outage', 'inspection.status_outage_since',
    'inspection.dep', 'inspection.dep_online', 'inspection.closings', 'inspection.closings_monthly_first', 'inspection.closings_monthly_day',
    'inspection.closings_annual_december', 'inspection.contact', 'inspection.how_it_works', 'inspection.printed_at', 'inspection.print',
    'inspection.print_yes', 'inspection.print_no', 'zero_receipt.create', 'zero_receipt.created'],
  // Faelle mit `code` oder `outcome` (seit Version 2 der Datei): die Verfeinerungen.
  caseVersion: 2,
  // Dateischluessel von pos-texts.json: die Verfeinerungen neben errorRules,
  // seit 1.3.0 die Beschriftung je Rueckgabe-Wahl.
  fileKeys: ['errorCodeRules', 'errorOutcomeRules', 'callsWithEffect', 'voucherErrors', 'returnDispositionLabels'],
};
const ohne = (o: Record<string, unknown>, weg: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !weg.includes(k)));
const VERHALTEN = WERTE['pos-texts.json']!['errorRules[].behavior']!;
const PLATZ = TABELLE.placeholders as Record<string, string>;
const MELDUNGEN = TABELLE.texts.pos.messages as Record<string, string>;
const BESCHRIFTUNGEN = TABELLE.texts.pos.labels as Record<string, string>;
const RECHNUNG = TABELLE.texts.invoice as Record<string, string>;

/** Schluessel eines Objekts nach `zuordnung` umbenennen, Reihenfolge und Werte bleiben; unbekannt bricht ab. */
function umbenannt(objekt: Json, zuordnung: Record<string, string>): Json {
  return Object.fromEntries(Object.entries(objekt).map(([k, v]) => {
    assert.ok(k in zuordnung, `Strukturschluessel ${k} fehlt in der Tabelle`);
    return [zuordnung[k], v];
  }));
}

/** Eine Schreibweise fuer beide Kataloge: klein mit Unterstrich, Laendercodes (`country.AT`) ausgenommen. */
const TEIL = '(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|[A-Z]{2})';
const SCHREIBWEISE = new RegExp(`^[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:\\.${TEIL})+$`);
const UMLAUT = /[äöüÄÖÜß]/;

function tabellePruefen(name: string, tabelle: Record<string, string>, alteSchluessel: string[]): void {
  assert.deepEqual(Object.keys(tabelle), alteSchluessel, `${name}: Tabelle deckt nicht genau die alten Schluessel`);
  const neu = Object.values(tabelle);
  assert.equal(new Set(neu).size, neu.length, `${name}: ein neuer Schluessel ist doppelt vergeben`);
  for (const schluessel of neu) {
    assert.match(schluessel, SCHREIBWEISE, `${name}: ${schluessel}`);
    assert.ok(!UMLAUT.test(schluessel), `${name}: ${schluessel}`);
  }
}

// ---- Platzhalter -------------------------------------------------------------

const namenIn = (text: string): string[] => [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!);
/** Derselbe Probewert fuer einen Platzhalter, alt wie neu: eindeutig je alter Name. */
const probe = (alterName: string): string => `<${Object.keys(PLATZ).indexOf(alterName)}:${alterName}>`;
const alteWerte = (text: string): Record<string, string> => Object.fromEntries(namenIn(text).map((n) => [n, probe(n)]));
const neueWerte = (alterText: string): Record<string, string> => Object.fromEntries(namenIn(alterText).map((n) => [PLATZ[n]!, probe(n)]));
/** Einen Text mit Werten fuellen, wie es beide Linien tun; ein fehlender Wert bricht ab. */
function fuelle(text: string, werte: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z]+)\}/g, (_v, n: string) => {
    assert.ok(n in werte, `Wert fuer {${n}} fehlt`);
    return werte[n]!;
  });
}

test('Umbenennung: Tabelle deckt jeden alten Schluessel genau einmal, die neuen sind eindeutig', () => {
  tabellePruefen('Kasse/Meldungen', MELDUNGEN, Object.keys(ALT_KASSE.meldungen));
  tabellePruefen('Kasse/Beschriftungen', BESCHRIFTUNGEN, Object.keys(ALT_KASSE.beschriftungen));
  tabellePruefen('Rechnung', RECHNUNG, Object.keys(ALT_RECHNUNG.texte.de));
  // Meldungen und Beschriftungen teilten sich keinen Schluessel; das bleibt so.
  const meldungen = new Set(Object.values(MELDUNGEN));
  for (const s of Object.values(BESCHRIFTUNGEN)) assert.ok(!meldungen.has(s), s);
});

test('Umbenennung: das Beispiel aus dem Nachtrag', () => {
  assert.equal(MELDUNGEN['storno.ergebnis_unklar'], 'cancellation.outcome_unknown');
  assert.equal(RECHNUNG['steuer.igLieferung.titel'], 'tax.intra_community_supply.title');
  assert.equal(PLATZ['betrag'], 'amount');
  assert.equal(PLATZ['grund'], 'reason');
});

test('Platzhalter: die Zuordnung ist eins zu eins und deckt genau die alten Namen', () => {
  const alt = new Set<string>([
    ...[...Object.values(ALT_KASSE.meldungen as Record<string, Json>), ...Object.values(ALT_KASSE.beschriftungen as Record<string, Json>)].flatMap((e) => namenIn(e.text)),
    ...Object.values(ALT_RECHNUNG.texte as Record<string, Record<string, string>>).flatMap((t) => Object.values(t).flatMap((x) => namenIn(x))),
  ]);
  assert.deepEqual(Object.keys(PLATZ).sort(), [...alt].sort());
  const neu = Object.values(PLATZ);
  assert.equal(new Set(neu).size, neu.length, 'zwei alte Platzhalter auf demselben neuen');
  for (const n of neu) assert.ok(!UMLAUT.test(n) && /^[a-z][A-Za-z]*$/.test(n), n);
  // Kein umbenannter Platzhalter traegt den Namen eines anderen alten: ein halb umgestellter Text bliebe sonst unerkannt.
  for (const [a, n] of Object.entries(PLATZ)) if (a !== n) assert.ok(!(n in PLATZ), `${a} -> ${n} ist selbst ein alter Name`);
});

/** Jeder Kassentext alt und neu, mit denselben Werten gefuellt: Zeichen fuer Zeichen gleich. */
function kasseGerendert(name: string, alt: Json, tabelle: Record<string, string>, neuDatei: Json, neuText: (s: string, w: Record<string, string>) => string): number {
  let n = 0;
  for (const [alterSchluessel, eintrag] of Object.entries(alt as Record<string, Json>)) {
    const neuerSchluessel = tabelle[alterSchluessel]!;
    const soll = fuelle(eintrag.text, alteWerte(eintrag.text));
    assert.equal(neuText(neuerSchluessel, neueWerte(eintrag.text)), soll, `${name} (Quelle): ${alterSchluessel} -> ${neuerSchluessel}`);
    const ausDatei = neuDatei[neuerSchluessel] as Json;
    assert.equal(fuelle(ausDatei.text, neueWerte(eintrag.text)), soll, `${name} (Datei): ${neuerSchluessel}`);
    // Die Liste der Platzhalter ist die alte, eins zu eins umbenannt; `only` bleibt.
    assert.deepEqual(ausDatei.placeholders, eintrag.platzhalter?.map((p: string) => PLATZ[p]), `${name}: ${neuerSchluessel} placeholders`);
    assert.deepEqual(ausDatei.only, eintrag.nur, `${name}: ${neuerSchluessel} only`);
    assert.deepEqual(Object.keys(ausDatei), Object.keys(eintrag).map((k) => K['entry']![k]), `${name}: ${neuerSchluessel} Struktur`);
    n += 1;
  }
  return n;
}

test('Platzhalter: jeder Kassentext ergibt alt und neu gefuellt denselben Satz (Datei und Quelle)', () => {
  assert.deepEqual(Object.keys(NEU_KASSE).filter((k) => !NACH_1_0.fileKeys.includes(k)), Object.keys(ALT_KASSE).map((s) => K['file']![s]), 'Kasse: Dateischluessel nicht wie in der Tabelle');
  assert.deepEqual(Object.keys(NEU_KASSE).filter((k) => NACH_1_0.fileKeys.includes(k)), NACH_1_0.fileKeys);
  const m = kasseGerendert('Meldungen', ALT_KASSE.meldungen, MELDUNGEN, NEU_KASSE.messages, (s, w) => messageText(s as MessageKey, w));
  const l = kasseGerendert('Beschriftungen', ALT_KASSE.beschriftungen, BESCHRIFTUNGEN, NEU_KASSE.labels, (s, w) => labelText(s as LabelKey, w));
  assert.deepEqual(Object.keys(ohne(NEU_KASSE.messages, NACH_1_0.messages)), Object.keys(ALT_KASSE.meldungen).map((s) => MELDUNGEN[s]));
  assert.deepEqual(Object.keys(ohne(NEU_KASSE.labels, NACH_1_0.labels)), Object.keys(ALT_KASSE.beschriftungen).map((s) => BESCHRIFTUNGEN[s]));
  assert.deepEqual(Object.keys(MESSAGES), Object.keys(NEU_KASSE.messages));
  assert.deepEqual(Object.keys(LABELS), Object.keys(NEU_KASSE.labels));
  // Was nach 1.0 dazukam, steht wirklich im Katalog und traegt keinen alten Namen.
  for (const k of NACH_1_0.messages) assert.ok(k in MESSAGES && !Object.values(MELDUNGEN).includes(k), k);
  for (const k of NACH_1_0.labels) assert.ok(k in LABELS && !Object.values(BESCHRIFTUNGEN).includes(k), k);
  assert.equal(m + l + NACH_1_0.messages.length + NACH_1_0.labels.length, Object.keys(MESSAGES).length + Object.keys(LABELS).length);
});

test('Platzhalter: jeder Rechnungstext ergibt alt und neu gefuellt denselben Satz, in jeder Sprache', () => {
  assert.deepEqual(Object.keys(NEU_RECHNUNG), Object.keys(ALT_RECHNUNG).map((s) => STRUKTUR['invoice-texts.json']!['file']![s]));
  assert.deepEqual(NEU_RECHNUNG.languages, ALT_RECHNUNG.sprachen);
  assert.deepEqual(NEU_RECHNUNG.units, ALT_RECHNUNG.einheiten);
  for (const sprache of ALT_RECHNUNG.sprachen as ('de' | 'en')[]) {
    assert.deepEqual(Object.keys(NEU_RECHNUNG.texts[sprache]), Object.keys(ALT_RECHNUNG.texte[sprache]).map((s) => RECHNUNG[s]));
    for (const [alterSchluessel, text] of Object.entries(ALT_RECHNUNG.texte[sprache] as Record<string, string>)) {
      const neu = RECHNUNG[alterSchluessel]!;
      const soll = fuelle(text, alteWerte(text));
      assert.equal(invoiceText(sprache, neu as InvoiceTextKey, neueWerte(text)), soll, `${sprache}: ${alterSchluessel} -> ${neu}`);
      assert.equal(fuelle(NEU_RECHNUNG.texts[sprache][neu], neueWerte(text)), soll, `${sprache} (Datei): ${neu}`);
    }
    assert.deepEqual(Object.keys(INVOICE_TEXTS[sprache]), Object.keys(NEU_RECHNUNG.texts[sprache]));
  }
});

test('Platzhalter: die Probe faellt auf (ein Zeichen anders, Platzhalter vertauscht, alter Name stehen geblieben)', () => {
  const alt = 'Die Karte ist bereits mit {betrag} belastet (Kennung {kennung}).';
  const soll = fuelle(alt, alteWerte(alt));
  assert.equal(fuelle('Die Karte ist bereits mit {amount} belastet (Kennung {reference}).', neueWerte(alt)), soll);
  assert.notEqual(fuelle('Die Karte ist bereits mit {amount} belastet (Kennung {reference})!', neueWerte(alt)), soll);
  assert.notEqual(fuelle('Die Karte ist bereits mit {reference} belastet (Kennung {amount}).', neueWerte(alt)), soll);
  assert.throws(() => fuelle('Die Karte ist bereits mit {betrag} belastet (Kennung {reference}).', neueWerte(alt)), /betrag/);
});

test('Umbenennung: pos-message-cases.json ist der 0.x-Stand, nur umbenannt', () => {
  const F = STRUKTUR['pos-message-cases.json']!;
  const art = ART;
  const soll = umbenannt({ ...ALT_FAELLE, faelle: (ALT_FAELLE.faelle as Json[]).map((fall) => {
    const neu = umbenannt(fall, F['case']!);
    neu.error = umbenannt({ ...fall.fehler, art: art[fall.fehler.art] }, F['error']!);
    if (typeof fall.erwartet === 'object') neu.expected = umbenannt({ ...fall.erwartet, schluessel: MELDUNGEN[fall.erwartet.schluessel] }, F['expected']!);
    // Der Name beginnt mit der Art: auch dort der neue Wert.
    neu.name = String(fall.name).replace(/^[a-z]+(?=:)/, (a: string) => art[a] ?? a);
    return neu;
  }) }, F['file']!);
  // Seit Version 2 tragen Faelle der Art api einen `code`; die ohne Code sind der 0.x-Stand.
  assert.equal(NEU_FAELLE.version, NACH_1_0.caseVersion);
  const alteFaelle = (NEU_FAELLE.cases as Json[]).filter((f) => f.error.code === undefined && f.error.outcome === undefined);
  assert.deepEqual({ ...NEU_FAELLE, version: soll.version, cases: alteFaelle }, soll);
  assert.ok((NEU_FAELLE.cases as Json[]).every((f) => f.error.code === undefined || f.error.kind === 'api'));
  assert.ok((NEU_FAELLE.cases as Json[]).every((f) => f.error.outcome === undefined || ['timeout', 'network'].includes(f.error.kind)));
});

test('Umbenennung: Fehlerregeln und Code-Zuordnungen zeigen auf die neuen Schluessel', () => {
  // ERROR_RULES ist der 0.x-Stand, nur umbenannt; die Verfeinerungen nach 1.0 stehen eigens.
  assert.deepEqual(
    ERROR_RULES,
    (ALT_KASSE.fehlerregeln as Json[]).map((r) => umbenannt({
      ...r,
      art: ART[r.art],
      ...('verhalten' in r ? { verhalten: VERHALTEN[r.verhalten] } : {}),
      ...('schluessel' in r ? { schluessel: MELDUNGEN[r.schluessel] } : {}),
    }, K['errorRule']!)),
  );
  assert.deepEqual(CANCELLATION_PAYMENT_ERROR_MESSAGES, Object.fromEntries(
    Object.entries(ALT_KASSE.stornoZahlungFehler as Record<string, string>).map(([code, s]) => [code, MELDUNGEN[s]]),
  ));
  // Die Belegmail-Codes kommen unter /v3 englisch (Uebersetzung laut Vokabular).
  const uebersetzt = VOKABULAR.errorCodes.translation as Record<string, string>;
  assert.deepEqual(RECEIPT_EMAIL_ERROR_MESSAGES, Object.fromEntries(
    Object.entries(ALT_KASSE.belegMailFehler as Record<string, string>).map(([code, s]) => [uebersetzt[code], MELDUNGEN[s]]),
  ));
  assert.deepEqual(NEU_KASSE.errorRules, ERROR_RULES);
  assert.deepEqual(NEU_KASSE.receiptEmailErrors, RECEIPT_EMAIL_ERROR_MESSAGES);
  assert.deepEqual(NEU_KASSE.cancellationPaymentErrors, CANCELLATION_PAYMENT_ERROR_MESSAGES);
});

test('Belegmail: RECEIPT_EMAIL_ERROR_MESSAGES kennt genau die Codes aus errorCodes.receiptEmail (und RECEIPT_EMAIL_SEND_ERROR_CODES)', () => {
  // Kommt ein Code dazu, faellt er hier auf, statt am Tresen still den
  // allgemeinen Satz zu zeigen.
  const codes = VOKABULAR.errorCodes.receiptEmail as string[];
  assert.deepEqual(Object.keys(RECEIPT_EMAIL_ERROR_MESSAGES).sort(), [...codes].sort());
  assert.deepEqual([...RECEIPT_EMAIL_SEND_ERROR_CODES].sort(), [...codes].sort());
  for (const code of codes) assert.equal(receiptEmailErrorMessage(code), RECEIPT_EMAIL_ERROR_MESSAGES[code as keyof typeof RECEIPT_EMAIL_ERROR_MESSAGES], code);
});

// ---- Dateien und Pruefgeruest ------------------------------------------------

function alleDateien(): string[] {
  const aus: string[] = [];
  const basis = join(wurzel, 'fixtures');
  const gehe = (pfad: string): void => {
    for (const name of readdirSync(pfad).sort()) {
      const voll = join(pfad, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else aus.push(relative(basis, voll).split('\\').join('/'));
    }
  };
  gehe(basis);
  return aus;
}

/** Eingefrorener Bestand der 0.x-Linie (0.31.0): Dateien und Schluessel je JSON-Datei. */
const BESTAND = lies('test/fixtures/vor-1.0/fixtures-0.x.json') as { version: string; dateien: string[]; schluesselMengen: string[][]; schluesselJeDatei: Record<string, number> };
const FILES = TABELLE.files as Record<string, string>;
/** Dateien, die erst mit 1.0 kamen (kein 0.x-Vorgaenger). Der v3-Export des Backends kommt dazu, ohne Eintrag hier. */
/** Bons je Code-Tabelle (1.1.0): die Faelle und je Fall und Tabelle eine Hex-Datei. */
const BONS_JE_TABELLE = JSON.parse(readFileSync(join(wurzel, 'fixtures', 'code-table-receipts.json'), 'utf8')) as { tables: string[]; cases: Array<{ name: string }> };
/** Belegduplikat (1.14.0): die Faelle und je Druckfall eine Hex-Datei. */
const DUPLIKAT_FAELLE = JSON.parse(readFileSync(join(wurzel, 'fixtures', 'duplicate-cases.json'), 'utf8')) as { cases: Array<{ name: string; print: boolean }> };
const NEU_SEIT_1_0 = ['cancellation-tip-cases.json', 'code-table-preview.json', 'code-table-receipts.json', ...BONS_JE_TABELLE.cases.flatMap((c) => BONS_JE_TABELLE.tables.map((t) => `expected/code-table-receipt.${c.name}.${t}.hex`)), 'code-tables.json', 'expected/code-table-test-sheet.lines.json', 'expected/code-table-test-sheet.mm58.hex', 'expected/code-table-test-sheet.mm80.hex', 'invoice-api-examples/cancel-error-return-disposition.json', 'invoice-api-examples/credit-error-reservation.json', 'invoice-api-examples/credit-error-return-disposition.json', 'invoice-api-examples/credit-return-disposition.json', 'invoice-api-examples/issue-error-reservation-article.json', 'invoice-api-examples/issue-error-return-disposition.json', 'invoice-api-examples/issue-error-stock-id.json', 'invoice-api-examples/issue-error-vat-id-risk.json', 'invoice-api-examples/issue-reservation.json', 'invoice-api-examples/issue-stock.json', 'invoice-api-examples/issue-vat-id-risk.json', 'receipt-due-errors.json', 'receipt-due-generated.json', 'receipt-due-voucher-generated.json', 'renames-1.0.json', 'stocktake-quantity-cases.json', 'stored/pos-settings-defaults.json',
  // Schicht und Kassenstand (1.9.0): Prueffaelle, Bons und ihre Goldens.
  'shift-cases.json', 'shift-receipts.json',
  ...['shift-close', 'shift-close-blind', 'shift-interim', 'cash-movement', 'shift-close-take-out', 'shift-close-put-in'].flatMap((n) => [`expected/${n}.lines.json`, `expected/${n}.grid32.txt`, `expected/${n}.grid48.txt`]),
  // Gutscheine der neuen Form (1.12.0): Golden-Belege mit Zeilen, Raster und Blatt.
  ...['voucher-cancellation', 'voucher-multi-purpose-redeem', 'voucher-multi-purpose-sale', 'voucher-payout', 'voucher-service-redeem', 'voucher-single-purpose-redeem', 'voucher-single-purpose-redeem-exempt', 'voucher-single-purpose-sale']
    .flatMap((n) => [`receipts/${n}.json`, `expected/${n}.lines.json`, `expected/${n}.grid32.txt`, `expected/${n}.grid48.txt`, `expected/${n}.sheet32.json`, `expected/${n}.sheet48.json`]),
  // Nacherfassung (30.10.2026): Golden-Belege mit Block „NACHERFASSUNG“ (manual-receipt-*).
  ...['manual-receipt-range-device-failure-count', 'manual-receipt-range-device-failure-no-count', 'manual-receipt-range-network-outage-count', 'manual-receipt-range-network-outage-no-count', 'manual-receipt-range-other-count', 'manual-receipt-range-other-no-count', 'manual-receipt-range-power-outage-count', 'manual-receipt-range-power-outage-no-count', 'manual-receipt-range-system-outage-count', 'manual-receipt-range-system-outage-no-count', 'manual-receipt-single-device-failure-no-time', 'manual-receipt-single-device-failure-time', 'manual-receipt-single-network-outage-no-time', 'manual-receipt-single-network-outage-time', 'manual-receipt-single-other-no-time', 'manual-receipt-single-other-time', 'manual-receipt-single-outside-premises-no-time', 'manual-receipt-single-outside-premises-time', 'manual-receipt-single-power-outage-no-time', 'manual-receipt-single-power-outage-time', 'manual-receipt-single-small-business', 'manual-receipt-single-system-outage-no-time', 'manual-receipt-single-system-outage-time']
    .flatMap((n) => [`receipts/${n}.json`, `expected/${n}.lines.json`, `expected/${n}.grid32.txt`, `expected/${n}.grid48.txt`, `expected/${n}.sheet32.json`, `expected/${n}.sheet48.json`]),
  // Nullbeleg nach Signaturausfall mit Beginn und Ende (30.10.2026).
  ...['zero-outage-end-period']
    .flatMap((n) => [`receipts/${n}.json`, `expected/${n}.lines.json`, `expected/${n}.grid32.txt`, `expected/${n}.grid48.txt`, `expected/${n}.sheet32.json`, `expected/${n}.sheet48.json`]),
  // Belegduplikat (1.14.0): Prueffaelle und Bytes der Nachdrucke.
  'duplicate-cases.json', ...DUPLIKAT_FAELLE.cases.filter((c) => c.print).map((c) => `expected/duplicate.${c.name}.hex`),
  // Beleg-Ausgaben (1.14.0): gemeinsame Prueffaelle mit dem Dart-Zwilling.
  'receipt-outputs-cases.json',
  // Prüfung (DEP) an der Kasse (1.21.0): Ordner auf dem USB-Stick, gleich im Dart-Zwilling.
  'dep-folder-cases.json',
  // Kasseninfo für die Prüfung (1.23.0): Zeilen für Bildschirm und Druck, gleich im Dart-Zwilling.
  'inspection-info-cases.json'];

const glob = (muster: string): RegExp => new RegExp(`^${muster.replace(/[.$]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
const gruppen = (neu: string, abschnitt: Record<string, unknown>): string[] => Object.keys(abschnitt).filter((m) => glob(m).test(neu));
function schluessel(o: unknown, s = new Set<string>()): Set<string> {
  if (Array.isArray(o)) o.forEach((x) => schluessel(x, s));
  else if (o !== null && typeof o === 'object') for (const [k, v] of Object.entries(o)) { s.add(k); schluessel(v, s); }
  return s;
}

/** Was die Tabelle fuer eine Datei in 1.0 als alten Namen nennt. */
function gedeckt(neu: string): Set<string> {
  const aus = new Set<string>([
    ...gruppen(neu, STRUKTUR).flatMap((g) => Object.values(STRUKTUR[g]!).flatMap((m) => Object.keys(m))),
    ...gruppen(neu, TABELLE.removed).flatMap((g) => Object.keys(TABELLE.removed[g])),
    ...(TABELLE.shapes as Array<{ file: string; before: string }>).filter((f) => glob(f.file).test(neu)).map((f) => f.before.split(' ')[0]!),
  ]);
  if (neu === 'pos-texts.json') for (const k of [...Object.keys(MELDUNGEN), ...Object.keys(BESCHRIFTUNGEN)]) aus.add(k);
  if (neu === 'invoice-texts.json') for (const k of Object.keys(RECHNUNG)) aus.add(k);
  // Im Manifest sind die Schluessel die Namen der Golden-Belege (files: belege/<alt>.json).
  if (neu === 'manifest.json') for (const f of Object.keys(FILES)) if (f.startsWith('belege/')) aus.add(f.slice('belege/'.length, -'.json'.length));
  return aus;
}

/** Jeder Schluessel einer 0.x-Datei, den die 1.0-Datei nicht mehr traegt und die Tabelle nicht nennt. */
function ungenannt(bestand: typeof BESTAND, files: Record<string, string>, lese: (neu: string) => unknown): string[] {
  const aus: string[] = [];
  for (const [alt, idx] of Object.entries(bestand.schluesselJeDatei)) {
    const neu = files[alt]!;
    const heute = schluessel(lese(neu));
    const bekannt = gedeckt(neu);
    for (const k of bestand.schluesselMengen[idx]!) if (!heute.has(k) && !bekannt.has(k)) aus.push(`${alt} -> ${neu}: ${k}`);
  }
  return aus;
}

test('Dateien: jede Datei der 0.x-Linie hat genau einen neuen Pfad, der existiert', () => {
  assert.equal(BESTAND.version, '0.31.0');
  assert.deepEqual(Object.keys(FILES), BESTAND.dateien);
  assert.equal(new Set(Object.values(FILES)).size, Object.values(FILES).length, 'zwei alte Dateien auf demselben neuen Pfad');
  for (const neu of Object.values(FILES)) assert.ok(existsSync(join(wurzel, 'fixtures', neu)), neu);
  assert.equal(FILES['belege/storno-voll.json'], 'receipts/cancellation-full.json');
  assert.equal(FILES['erwartet/storno-voll.blatt48.json'], 'expected/cancellation-full.sheet48.json');
  assert.equal(FILES['rechnung-summen.json'], 'invoice-totals.json');
});

test('Dateien: jede Datei heute kommt aus der 0.x-Linie, ist neu seit 1.0 oder liegt im Backend-Export (v3/)', () => {
  const ziele = new Set(Object.values(FILES));
  const fremd = alleDateien().filter((d) => !ziele.has(d) && !NEU_SEIT_1_0.includes(d) && !d.startsWith('v3/'));
  assert.deepEqual(fremd, [], 'neue Datei unter fixtures/: umbenannt -> files, neu -> NEU_SEIT_1_0');
  for (const d of NEU_SEIT_1_0) assert.ok(existsSync(join(wurzel, 'fixtures', d)), `tote Zeile in NEU_SEIT_1_0: ${d}`);
});

test('Tabelle: jeder Schluessel der 0.x-Linie, den es in 1.0 nicht mehr gibt, steht in der Tabelle', () => {
  assert.deepEqual(ungenannt(BESTAND, FILES, (neu) => lies(`fixtures/${neu}`)), []);
});

test('Tabelle: jeder alte Name in structure kam in 0.x auch vor (keine erfundene Umbenennung)', () => {
  const je: Record<string, Set<string>> = {};
  for (const [alt, idx] of Object.entries(BESTAND.schluesselJeDatei)) {
    for (const g of gruppen(FILES[alt]!, STRUKTUR)) for (const k of BESTAND.schluesselMengen[idx]!) (je[g] ??= new Set()).add(k);
  }
  const erfunden: string[] = [];
  for (const [g, ebenen] of Object.entries(STRUKTUR)) {
    for (const [ebene, m] of Object.entries(ebenen)) for (const alt of Object.keys(m)) if (!je[g]?.has(alt)) erfunden.push(`${g}/${ebene}: ${alt}`);
  }
  assert.deepEqual(erfunden, []);
});

test('Tabelle: die Pruefung faellt auf einen ungenannten Schluessel (Rot-Probe)', () => {
  const idx = BESTAND.schluesselMengen.length;
  const probe = { ...BESTAND, schluesselMengen: [...BESTAND.schluesselMengen, ['zeitraumNeu', 'version']], schluesselJeDatei: { 'hobex-hps-codes.json': idx } };
  assert.deepEqual(ungenannt(probe, FILES, (neu) => lies(`fixtures/${neu}`)), ['hobex-hps-codes.json -> hobex-hps-codes.json: zeitraumNeu']);
  // Ein Schluessel, den structure nennt, ist gedeckt.
  const gedeckte = { ...probe, schluesselMengen: [...BESTAND.schluesselMengen, ['gemessenAn']] };
  assert.deepEqual(ungenannt(gedeckte, FILES, (neu) => lies(`fixtures/${neu}`)), []);
});

test('Dateien: die Zuordnung bricht bei unbekanntem Pfad oder Schluessel laut ab (Rot-Probe)', async () => {
  const erzeuger = (await import(new URL('../../scripts/umbenennung-1.0.mjs', import.meta.url).href)) as {
    neuerPfad: (p: string) => string;
    umbenannt: (w: unknown, datei: string) => unknown;
  };
  assert.equal(erzeuger.neuerPfad('belege/verkauf-bar.json'), 'receipts/sale-cash.json');
  assert.throws(() => erzeuger.neuerPfad('belege/unbekannt.json'), /unbekannt/);
  assert.throws(() => erzeuger.neuerPfad('erwartet/verkauf-bar.fremd.txt'), /Endung/);
  assert.throws(() => erzeuger.neuerPfad('neu.json'), /keiner Liste/);
  assert.deepEqual(erzeuger.umbenannt({ beschreibung: 'x', regel: { zeile: 'l' }, faelle: [] }, 'rechnung-summen.json'), { description: 'x', rule: { line: 'l' }, cases: [] });
  assert.throws(() => erzeuger.umbenannt({ beschreibung: 'x', fremd: 1 }, 'rechnung-summen.json'), /fremd/);
  assert.throws(() => erzeuger.umbenannt({ faelle: [{ name: 'a', neuesFeld: 1 }] }, 'rechnung-summen.json'), /neuesFeld/);
  assert.throws(() => erzeuger.umbenannt({ unbekannt: { a: 1 } }, 'hobex-hps-codes.json'), /unbekannt/);
});

test('Umbenennung: der Erzeuger gibt die eingecheckte Tabelle byte-gleich wieder (nie von Hand pflegen)', async () => {
  const erzeuger = (await import(new URL('../../scripts/umbenennung-1.0.mjs', import.meta.url).href)) as { umbenennungsDatei: () => string };
  const eingecheckt = readFileSync(join(wurzel, 'fixtures/renames-1.0.json'), 'utf8');
  assert.equal(erzeuger.umbenennungsDatei(), eingecheckt, 'fixtures/renames-1.0.json weicht vom Erzeuger ab: npm run fixtures:umbenennung');
});
