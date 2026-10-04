import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECEIPT_EMAIL_ERROR_MESSAGES, LABELS, ERROR_RULES, ERROR_CODE_RULES, ERROR_OUTCOME_RULES, CALLS_WITH_EFFECT, MESSAGES, CANCELLATION_PAYMENT_ERROR_MESSAGES, findErrorRule, receiptEmailErrorMessage, cancellationPaymentErrorMessage, labelText, messageText, messageAppliesTo, RETURN_DISPOSITION_LABELS } from '../src/pos/texte.js';
import type { MessageKey, LabelKey } from '../src/pos/texte.js';
import { CANCELLATION_ERROR_CODES, RETURN_DISPOSITIONS } from '../src/models/cancellation.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLIENT_ERROR_CODES, KasseneckApiError } from '../src/client/errors.js';
import { PAYMENT_ERROR_CODES } from '../src/models/payment-errors.js';

const SCHLUESSEL_MUSTER = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

test('jeder Schluessel hat die Form bereich.name', () => {
  for (const schluessel of Object.keys(MESSAGES)) {
    assert.match(schluessel, SCHLUESSEL_MUSTER, schluessel);
  }
});

test('ein Text ist ein Satz: beginnt gross, endet mit Satzzeichen, kein Rand-Leerraum', () => {
  // `{` bzw. `}` sind am Rand erlaubt: ein Platzhalter kann den Satz eroeffnen
  // oder beschliessen — der eingesetzte Wert traegt dann seine eigene Grossschreibung/Interpunktion.
  for (const [schluessel, eintrag] of Object.entries(MESSAGES)) {
    assert.equal(eintrag.text, eintrag.text.trim(), schluessel);
    assert.match(eintrag.text, /^[A-ZÄÖÜ„{]/, schluessel);
    assert.match(eintrag.text, /[.!?…“)}]$/, schluessel);
  }
});

test('Platzhalter im Text und in der Liste sind dieselben', () => {
  for (const [schluessel, eintrag] of Object.entries(MESSAGES)) {
    const imText = [...new Set([...eintrag.text.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]))].sort();
    const erklaert = [...(eintrag.placeholders ?? [])].sort();
    assert.deepEqual(imText, erklaert, schluessel);
  }
});

test('only kennt nur web und app', () => {
  for (const [schluessel, eintrag] of Object.entries(MESSAGES)) {
    for (const seite of eintrag.only ?? []) {
      assert.ok(seite === 'web' || seite === 'app', `${schluessel}: ${seite}`);
    }
  }
});

test('messageText() ersetzt Platzhalter und laesst den Rest stehen', () => {
  assert.equal(
    messageText('server.unexpected', { status: 404 }),
    'Der Server hat unerwartet geantwortet (HTTP 404). Bitte den Support verständigen.',
  );
  assert.equal(messageText('network.timeout'), MESSAGES['network.timeout'].text);
});

test('messageText() wirft bei fehlendem Platzhalter statt {status} stehen zu lassen', () => {
  assert.throws(() => messageText('server.unexpected'), /status/);
});

test('messageAppliesTo folgt only', () => {
  assert.equal(messageAppliesTo('device.browser_storage', 'web'), true);
  assert.equal(messageAppliesTo('device.browser_storage', 'app'), false);
  assert.equal(messageAppliesTo('network.timeout', 'app'), true);
});

test('die Fehlerregeln enden mit other und nennen nur bekannte Schluessel', () => {
  assert.equal(ERROR_RULES.at(-1)?.kind, 'other');
  for (const regel of [...ERROR_RULES, ...ERROR_CODE_RULES, ...ERROR_OUTCOME_RULES]) {
    if ('key' in regel) assert.ok(regel.key in MESSAGES, regel.key);
  }
  // Genau eine Regel je Art: die Verfeinerungen stehen in eigenen Listen.
  assert.deepEqual(ERROR_RULES.map((r) => r.kind), ['api', 'plain_text', 'timeout', 'network', 'unexpected', 'other']);
  assert.deepEqual(ERROR_RULES.filter((r) => 'behavior' in r).map((r) => 'behavior' in r && r.behavior), ['server_text', 'own_text', 'fallback']);
  const arten = new Set<string>(ERROR_RULES.map((r) => r.kind));
  for (const r of [...ERROR_CODE_RULES, ...ERROR_OUTCOME_RULES]) assert.ok(arten.has(r.kind), r.kind);
});

test('ERROR_RULES ist der Stand von rc.4: wer nur nach kind sucht, zeigt denselben Satz wie vorher', () => {
  // Gepinnt, woertlich wie in 1.0.0-rc.4 (fixtures/pos-texts.json errorRules).
  assert.deepEqual(ERROR_RULES, [
    { kind: 'api', behavior: 'server_text' },
    { kind: 'plain_text', behavior: 'own_text' },
    { kind: 'timeout', key: 'network.timeout' },
    { kind: 'network', key: 'network.no_connection' },
    { kind: 'unexpected', key: 'server.unexpected' },
    { kind: 'other', behavior: 'fallback' },
  ]);
  // Ein Leser alter Art (ERROR_RULES.find nach kind) bekommt fuer einen
  // Backend-Fehler weiter den Satz des Backends, nie einen Rand-Satz.
  assert.deepEqual(ERROR_RULES.find((r) => r.kind === 'api'), { kind: 'api', behavior: 'server_text' });
  assert.equal(messageText('network.timeout'), 'Der Server antwortet nicht. Bitte die Internetverbindung prüfen und erneut versuchen.');
  assert.equal(messageText('network.no_connection'), 'Keine Verbindung zum Server. Bitte die Internetverbindung prüfen und erneut versuchen.');
});

test('kein Satz steht zweimal im Katalog', () => {
  const gesehen = new Map<string, string>();
  for (const [schluessel, eintrag] of Object.entries(MESSAGES)) {
    const schon = gesehen.get(eintrag.text);
    assert.equal(schon, undefined, `${schluessel} sagt dasselbe wie ${schon}`);
    gesehen.set(eintrag.text, schluessel);
  }
});

// --- GP Tom ----------------------------------------------------------------
// GP Tom laeuft als eigene App auf demselben Geraet; im Browser gibt es sie
// nicht. Ein `gptom.`-Satz ohne `nur: ['app']` waere ein Satz, den die
// Browser-Kasse nie zeigen kann.
test('jeder gptom-Satz gilt nur in der App', () => {
  const gptom = Object.keys(MESSAGES).filter((s) => s.startsWith('gptom.'));
  assert.ok(gptom.length > 0);
  for (const schluessel of gptom) {
    assert.deepEqual(MESSAGES[schluessel as MessageKey].only, ['app'], schluessel);
  }
});

test('die vier Ausgaenge einer GP-Tom-Zahlung haben ihren Satz', () => {
  // gescheitert (Terminal lehnt ab), gescheitert (App liess sich nicht oeffnen),
  // unklar (Frist abgelaufen) — geglueckt und abgebrochen sagen nichts Rotes.
  assert.equal(MESSAGES['gptom.declined'].text, 'Das Terminal hat die Zahlung abgelehnt.');
  assert.equal(MESSAGES['gptom.declined_with_code'].text, 'Das Terminal hat die Zahlung abgelehnt ({code}).');
  assert.deepEqual(MESSAGES['gptom.declined_with_code'].placeholders, ['code']);
  assert.match(MESSAGES['gptom.not_opened'].text, /^GP Tom ließ sich nicht öffnen/);
  assert.equal(MESSAGES['gptom.timeout'].placeholders, undefined);
  assert.deepEqual(MESSAGES['gptom.timeout_with_id'].placeholders, ['reference']);
});

test('ein unklarer Ausgang warnt vor dem zweiten Kassieren, statt nur zu melden', () => {
  for (const schluessel of ['card_payment.unknown', 'card_payment.unknown_with_id', 'gptom.timeout', 'gptom.timeout_with_id'] as const) {
    const text = MESSAGES[schluessel].text;
    assert.match(text, /kann belastet sein/, schluessel);
    assert.match(text, /Terminal-Beleg/, schluessel);
  }
});

// --- Die Kennung ueberlebt den Abriss --------------------------------------
// Die Kennung ist der einzige Anker, um die Zahlung am Terminal-Beleg
// wiederzufinden. Jede Fassung `…_with_id` ist die Fassung ohne sie plus
// dem Anker — sonst sagen beide Fassungen unterschiedliche Dinge, je nachdem
// ob das Terminal gerade eine Kennung hergab.
test('jede _with_id-Fassung ist ihre Grundfassung plus die Kennung', () => {
  const mitKennung = Object.keys(MESSAGES).filter((s) => s.endsWith('_with_id'));
  assert.ok(mitKennung.length >= 2);
  for (const schluessel of mitKennung) {
    const grund = schluessel.slice(0, -'_with_id'.length);
    assert.ok(grund in MESSAGES, `${schluessel} ohne Grundfassung ${grund}`);
    const eintrag = MESSAGES[schluessel as MessageKey];
    assert.deepEqual(eintrag.placeholders, ['reference'], schluessel);
    assert.ok(eintrag.text.startsWith(MESSAGES[grund as MessageKey].text), schluessel);
    assert.deepEqual(eintrag.only, MESSAGES[grund as MessageKey].only, schluessel);
  }
});

// --- Karte gebucht, Beleg fehlt --------------------------------------------
// Der teuerste Fehler am Tresen ist die zweite Belastung. Beide Saetze muessen
// den Betrag UND die Kennung nennen und duerfen nicht zum Wiederholen raten.
test('die Saetze zur schon gebuchten Karte nennen Betrag und Kennung', () => {
  for (const schluessel of ['card_payment.card_charged_receipt_open', 'card_payment.card_charged_cart_changed'] as const) {
    assert.deepEqual([...(MESSAGES[schluessel].placeholders ?? [])].sort(), ['amount', 'reference'], schluessel);
    assert.equal(MESSAGES[schluessel].only, undefined, schluessel);
  }
  assert.equal(
    messageText('card_payment.card_charged_receipt_open', { amount: '12,90 €', reference: 'A-4711' }),
    'Die Karte ist bereits mit 12,90 € belastet (Kennung A-4711) – der Beleg dazu fehlt noch. Bitte jetzt den Beleg erstellen und nicht erneut kassieren.',
  );
  assert.match(MESSAGES['card_payment.card_charged_cart_changed'].text, /verwerfen/);
});

test('der Warteschirm und das Terminal-Protokoll sprechen auf beiden Seiten', () => {
  for (const schluessel of ['card_payment.waiting_for_terminal', 'log.empty', 'log.copied'] as const) {
    assert.equal(MESSAGES[schluessel].only, undefined, schluessel);
    assert.equal(MESSAGES[schluessel].placeholders, undefined, schluessel);
  }
});

// --- Beleg weitergeben -----------------------------------------------------
// Link kopieren, teilen und senden fuehren zu derselben Belegseite. Der Weg
// dorthin unterscheidet sich je Huelle (Web-Share, Teilen-Blatt des Systems),
// das Wort nicht — ein `nur` waere hier eine Kasse, die etwas anderes sagt.
const belegWeitergeben = Object.keys(MESSAGES).filter((s) => s.startsWith('receipt.mail_') || s.startsWith('receipt.share_') || s === 'receipt.link_copied' || s === 'receipt.not_shareable' || s === 'receipt.test_hint_share');

test('kein Satz zum Weitergeben eines Belegs ist an eine Seite gebunden', () => {
  assert.ok(belegWeitergeben.length >= 9);
  for (const schluessel of belegWeitergeben) {
    assert.equal(MESSAGES[schluessel as MessageKey].only, undefined, schluessel);
  }
});

test('der Teilen-Text traegt den Link und nennt Betrieb, Nummer und Betrag', () => {
  const eintrag = MESSAGES['receipt.share_text'];
  assert.deepEqual([...(eintrag.placeholders ?? [])].sort(), ['amount', 'business', 'link', 'number']);
  // Ohne Link ist der geteilte Text wertlos, und ein Link mitten im Satz wird
  // von manchen Huellen mitsamt dem Folgetext verlinkt oder abgeschnitten.
  assert.ok(eintrag.text.endsWith('{link}'), 'der Link steht nicht am Schluss');
  assert.equal(
    messageText('receipt.share_text', { number: 'AT-1-2026-17', business: 'Bäckerei Kornblum', amount: '4,20 €', link: 'https://beleg.kasseneck.at/abc' }),
    'Beleg AT-1-2026-17 von Bäckerei Kornblum über 4,20 €: https://beleg.kasseneck.at/abc',
  );
});

// --- Beleg per E-Mail: der Code entscheidet, nicht der Satz -----------------
// Jeder Ausgang des Sendens verlangt vom Kassier etwas anderes: Adresse
// verbessern, spaeter noch einmal, noch einmal senden, Beleg suchen. Genau
// deshalb haengt jeder Fehlersatz an einem `code` — abgeleitet geprueft, damit
// ein neuer Satz ohne Code (oder ein Code ohne Satz) auffaellt.
test('jeder Fehlersatz zum Senden haengt an genau einem Backend-Code', () => {
  const fehlersaetze = Object.keys(MESSAGES)
    .filter((s) => s.startsWith('receipt.mail_') && MESSAGES[s as MessageKey].placeholders === undefined);
  const zugeordnet = Object.values(RECEIPT_EMAIL_ERROR_MESSAGES);
  assert.deepEqual([...zugeordnet].sort(), fehlersaetze.sort());
  assert.equal(new Set(zugeordnet).size, zugeordnet.length, 'zwei Codes zeigen auf denselben Satz');
});

test('der einzige receipt.mail-Satz mit Platzhalter ist der ueber das Gelingen', () => {
  const mitPlatzhalter = Object.keys(MESSAGES)
    .filter((s) => s.startsWith('receipt.mail_') && MESSAGES[s as MessageKey].placeholders !== undefined);
  assert.deepEqual(mitPlatzhalter, ['receipt.mail_sent']);
  assert.deepEqual(MESSAGES['receipt.mail_sent'].placeholders, ['recipient']);
});

test('die Codes sind Kleinschrift mit Unterstrich, wie sie das Backend schickt', () => {
  for (const code of Object.keys(RECEIPT_EMAIL_ERROR_MESSAGES)) assert.match(code, /^[a-z][a-z0-9_]*$/, code);
});

test('receiptEmailErrorMessage faengt jeden unbekannten Code mit dem allgemeinen Satz auf', () => {
  for (const [code, schluessel] of Object.entries(RECEIPT_EMAIL_ERROR_MESSAGES)) {
    assert.equal(receiptEmailErrorMessage(code), schluessel, code);
  }
  for (const unbekannt of ['gibt_es_nicht', '', undefined, null]) {
    assert.equal(receiptEmailErrorMessage(unbekannt), 'receipt.mail_failed', String(unbekannt));
  }
});

// --- Drucker-Wizard --------------------------------------------------------
// Der Wizard ist in beiden Kassen derselbe Ablauf mit denselben Worten. Ein
// `nur` an einem seiner Saetze hiesse: an einer Stelle steht in der App etwas
// anderes als im Browser — genau das soll er verhindern.
test('jeder Satz des Drucker-Wizards gilt auf beiden Seiten', () => {
  const wizard = Object.keys(MESSAGES).filter((s) => s.startsWith('print.wizard_'));
  assert.ok(wizard.length >= 7);
  for (const schluessel of wizard) {
    assert.equal(MESSAGES[schluessel as MessageKey].only, undefined, schluessel);
  }
});

test('der Wizard fragt, bevor er speichert, und sagt beim Abbruch, dass nichts blieb', () => {
  // Reihenfolge des Ablaufs: verbinden -> Testdruck -> QR-Probe -> speichern.
  assert.deepEqual(MESSAGES['print.wizard_connect'].placeholders, ['name']);
  assert.deepEqual(MESSAGES['print.wizard_saved'].placeholders, ['name']);
  for (const frage of ['print.wizard_test_print_question', 'print.wizard_qr_question'] as const) {
    assert.ok(MESSAGES[frage].text.endsWith('?'), frage);
  }
  assert.match(MESSAGES['print.wizard_cancelled'].text, /Nichts gespeichert/);
  // Kein Modus druckt einen lesbaren QR-Code: der Hinweis muss sagen, wo der
  // QR-Code dann herkommt — sonst fehlt er dem Kunden am Beleg (RKSV).
  assert.match(MESSAGES['print.wizard_qr_none_hint'].text, /Bildschirm/);
});

// --- Halbgeviertstrich ----------------------------------------------------
// Sichtbare Texte tragen nur den Halbgeviertstrich; der Geviertstrich gilt
// als Maschinenzeichen. Seit 0.31.0 fuer den ganzen Katalog, auch die
// aelteren Saetze (nur das Zeichen, nicht der Wortlaut).
test('kein Geviertstrich in einer Meldung oder Beschriftung', () => {
  const alle = [...Object.values(MESSAGES), ...Object.values(LABELS)].map((m) => m.text);
  assert.ok(alle.length >= 200);
  for (const text of alle) assert.ok(!text.includes('\u2014'), text);
});

test('ein Gedankenstrich steht mit Leerraum auf beiden Seiten', () => {
  for (const { text } of [...Object.values(MESSAGES), ...Object.values(LABELS)]) {
    for (const m of text.matchAll(/\u2013/g)) {
      const i = m.index!;
      assert.equal(text[i - 1], ' ', text);
      assert.equal(text[i + 1], ' ', text);
    }
  }
});

// --- Getrennt zahlen -------------------------------------------------------
test('Getrennt zahlen: jeder Satz zur belasteten Karte nennt den Betrag und raet nicht zum Kassieren', () => {
  for (const s of ['split.card_reverse_failed', 'split.card_reverse_unknown'] as const) {
    assert.deepEqual([...(MESSAGES[s].placeholders ?? [])].sort(), ['amount', 'reference'], s);
    assert.match(MESSAGES[s].text, /Terminal-Beleg/, s);
    assert.doesNotMatch(MESSAGES[s].text, /kassieren/, s);
  }
  for (const s of ['split.external_reverse', 'split.return_cash', 'split.session_open'] as const) {
    assert.deepEqual(MESSAGES[s].placeholders, ['amount'], s);
  }
  for (const s of Object.keys(MESSAGES).filter((k) => k.startsWith('split.'))) {
    assert.equal(MESSAGES[s as MessageKey].only, undefined, `${s}: gilt auf beiden Seiten`);
  }
});

test('Storno mit mehreren Zahlungen: jeder Code ist ein echter Backend-Code und hat einen eigenen Satz', () => {
  const bekannt = new Set<string>([...CANCELLATION_ERROR_CODES, ...PAYMENT_ERROR_CODES]);
  for (const [code, schluessel] of Object.entries(CANCELLATION_PAYMENT_ERROR_MESSAGES)) {
    assert.ok(bekannt.has(code), code);
    assert.ok(schluessel in MESSAGES, schluessel);
  }
  const saetze = Object.values(CANCELLATION_PAYMENT_ERROR_MESSAGES);
  assert.equal(new Set(saetze).size, saetze.length, 'zwei Codes zeigen auf denselben Satz');
  for (const code of ['cancellation_payments_required', 'cancellation_refund_exceeds_payment', 'cancellation_refund_reference_required', 'cancellation_refund_reference_unknown', 'payments_sum_mismatch', 'cancellation_outcome_unknown']) {
    assert.ok(code in CANCELLATION_PAYMENT_ERROR_MESSAGES, code);
  }
});

test('Beschriftungen: Schluessel bereich.name, kein Rand-Leerraum, Platzhalter exakt, keine Saetze aus dem Meldungskatalog', () => {
  const saetze = new Set(Object.values(MESSAGES).map((m) => m.text));
  for (const [schluessel, eintrag] of Object.entries(LABELS)) {
    assert.match(schluessel, SCHLUESSEL_MUSTER, schluessel);
    assert.ok(eintrag.text.length > 0, schluessel);
    assert.equal(eintrag.text, eintrag.text.trim(), schluessel);
    const imText = [...new Set([...eintrag.text.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]))].sort();
    assert.deepEqual(imText, [...(eintrag.placeholders ?? [])].sort(), schluessel);
    assert.ok(!saetze.has(eintrag.text), `${schluessel} steht schon als Meldung`);
    for (const seite of eintrag.only ?? []) assert.ok(seite === 'web' || seite === 'app', schluessel);
  }
});

test('Beschriftungen folgen dem Bon und ersetzen Platzhalter', () => {
  assert.equal(labelText('split.payment', { n: 3 }), 'Zahlung 3');
  assert.equal(labelText('split.divide', { n: 3 }), '÷ 3');
  assert.equal(labelText('split.of_which_tip', { amount: '2,00 €' }), 'davon Trinkgeld 2,00 €');
  assert.equal(labelText('payment_method.card'), 'Kartenzahlung');
  assert.equal(labelText('payment_method.cash'), 'Barzahlung');
  assert.equal(labelText('payment_method.multiple'), 'Mehrere');
  assert.equal(labelText('split.button'), 'Getrennt');
  assert.equal(labelText('split.setting'), 'Getrennt zahlen');
  assert.throws(() => labelText('split.payment'), /\{n\}/);
});

test('Getrennt zahlen, Aufteilung: Weiter-Knopf nennt den Betrag, Tabs und Stueck-Zeilen ersetzen ihre Platzhalter', () => {
  assert.equal(labelText('split.continue', { amount: '67,00 €' }), 'Weiter · 67,00 € getrennt');
  assert.equal(labelText('split.tab_items'), 'Nach Positionen');
  assert.equal(labelText('split.tab_amount'), 'Betrag');
  assert.equal(labelText('split.pieces_open', { n: 2 }), '2 offen');
  assert.equal(labelText('split.pieces_selected', { n: 2, open: 4 }), '2 von 4');
  assert.throws(() => labelText('split.pieces_selected', { n: 2 }), /\{open\}/);
  assert.equal(labelText('split.open_items'), 'Offene Positionen');
  assert.equal(labelText('split.nothing_selected'), 'Noch nichts angetippt');
  assert.equal(labelText('split.all_paid'), 'Alles bezahlt');
  // Bezahlte Stueck stehen nicht mehr da (die Kachel verschwindet) -- der Satz entfaellt.
  assert.equal('getrennt.stueck_bezahlt' in LABELS, false);
  assert.equal(labelText('split.one_more', { name: 'Bier' }), 'Bier: ein Stück mehr');
  assert.equal(labelText('split.one_less', { name: 'Bier' }), 'Bier: ein Stück weniger');
  assert.equal(labelText('split.tendered_change', { tendered: '50,00 €', change: '23,23 €' }), 'Gegeben 50,00 € · Rückgeld 23,23 €');
  assert.equal(labelText('split.payment_method'), 'Zahlart');
  assert.equal(labelText('split.method_cash'), 'Bar');
  assert.equal(labelText('split.method_card'), 'Karte');
  assert.equal(labelText('split.add_payment', { amount: '12,40 €' }), 'Zahlung hinzufügen · 12,40 €');
  assert.throws(() => labelText('split.add_payment'), /\{amount\}/);
  // Ohne „Gegeben" bei Rueckgeld-Rechner: derselbe Grund wie beim Abschluss, ohne Platzhalter.
  assert.match(MESSAGES['split.tendered_missing'].text, /Rückgeld-Rechner/);
  assert.equal(MESSAGES['split.tendered_missing'].placeholders, undefined);
  for (const weg of ['getrennt.bar_kassieren', 'getrennt.karte_kassieren', 'getrennt.kassieren']) {
    assert.equal(weg in LABELS, false, weg);
  }
  // Die Sperre nennt den Grund: Betraege lassen sich keinen Stuecken zuordnen.
  assert.match(MESSAGES['split.items_locked'].text, /Betrag/);
  assert.equal(MESSAGES['split.items_locked'].placeholders, undefined);
  assert.equal(MESSAGES['split.select_items'].placeholders, undefined);
});

test('cancellationPaymentErrorMessage faengt jeden unbekannten Code mit dem allgemeinen Storno-Satz auf', () => {
  for (const [code, schluessel] of Object.entries(CANCELLATION_PAYMENT_ERROR_MESSAGES)) {
    assert.equal(cancellationPaymentErrorMessage(code), schluessel, code);
  }
  for (const unbekannt of ['GIBT_ES_NICHT', 'STORNO_OUTCOME_UNKNOWN', '', undefined, null]) {
    assert.equal(cancellationPaymentErrorMessage(unbekannt), 'cancellation.failed', String(unbekannt));
  }
});

test('ein offener Storno-Ausgang warnt vor dem zweiten Stornieren', () => {
  assert.equal(cancellationPaymentErrorMessage('cancellation_outcome_unknown'), 'cancellation.outcome_unknown');
  const text = MESSAGES['cancellation.outcome_unknown'].text;
  assert.match(text, /nicht erneut stornieren/);
  assert.match(text, /Belegliste/);
  // Die Zuordnung prueft exakt wie isCancellationErrorCode: der alte Name
  // von /v1 kommt unter /v3 nicht mehr an.
  assert.equal(cancellationPaymentErrorMessage('STORNO_OUTCOME_UNKNOWN'), 'cancellation.failed');
});

test('Storno getrennt bezahlter Belege: Karten gehen erst nach dem gebuchten Storno von Hand zurueck', () => {
  const liste = MESSAGES['cancellation.refund_cards'];
  // Der Satz steht ueber einer Liste mit Betrag je Karte -- er selbst bleibt
  // ohne Platzhalter und passt fuer eine wie fuer mehrere Karten.
  assert.equal(liste.placeholders, undefined);
  assert.equal(liste.only, undefined);
  assert.match(liste.text, /gebucht/);
  assert.match(liste.text, /Terminal gutschreiben/);
  assert.match(liste.text, /abhaken/);
  // Die automatische Gutschrift kommt erst mit Server-Unterstuetzung; bis
  // dahin fuehrt der Katalog keinen Satz dafuer.
  for (const alt of ['storno.gutschrift_laeuft', 'storno.gutschrift_fehlgeschlagen', 'storno.gutschrift_unklar',
    'storno.gutgeschrieben_nicht_gebucht', 'storno.gutschrift_pruefen', 'storno.extern_gutschreiben']) {
    assert.ok(!(alt in MESSAGES), alt);
  }
  for (const alt of ['storno.am_terminal_gutgeschrieben', 'storno.nicht_gutgeschrieben']) {
    assert.ok(!(alt in LABELS), alt);
  }
});

test('ein offener Storno-Ausgang mit Karten haelt die Gutschrift zurueck, bis das Storno in der Belegliste steht', () => {
  const eintrag = MESSAGES['cancellation.outcome_unknown_cards'];
  assert.equal(eintrag.placeholders, undefined);
  assert.equal(eintrag.only, undefined);
  assert.match(eintrag.text, /nicht erneut stornieren/);
  assert.match(eintrag.text, /noch keine Karte gutschreiben/);
  assert.match(eintrag.text, /Belegliste/);
  assert.match(eintrag.text, /am Terminal gutschreiben/);
  // Der Code selbst zeigt weiter auf den allgemeinen Satz; welchen die Kasse
  // zeigt, entscheidet sie am gesendeten Vorschlag.
  assert.equal(cancellationPaymentErrorMessage('cancellation_outcome_unknown'), 'cancellation.outcome_unknown');
  assert.ok(eintrag.text.startsWith('Unklar, ob das Storno entstanden ist – es kann bereits signiert sein.'));
  assert.ok(MESSAGES['cancellation.outcome_unknown'].text.startsWith('Unklar, ob das Storno entstanden ist – es kann bereits signiert sein.'));
});

test('Getrennt zahlen: erneutes Zurueckbuchen heisst in beiden Kassen gleich', () => {
  assert.equal(labelText('split.reverse_again'), 'Erneut zurückbuchen');
});

test('Storno: nicht abgehakte Karten fragen vor dem Schliessen einmal nach', () => {
  const eintrag = MESSAGES['cancellation.cards_not_checked'];
  assert.equal(eintrag.placeholders, undefined);
  assert.equal(eintrag.only, undefined);
  assert.match(eintrag.text, /am Terminal gutschreiben/);
  assert.match(eintrag.text, /noch einmal drücken/);
  assert.ok(!eintrag.text.includes('\u2014'));
});

// --- Oberflaechen-Vertrag: Texte, die bisher nur in der Browser-Kasse standen --
// Beide Kassen zeigen dieselben Woerter; wortgleich mit dem bisherigen Stand
// der Browser-Kasse, nur der Geviertstrich ist ein Halbgeviertstrich.
test('Kassieren, Sitzung und Abmelden: die Saetze beider Kassen', () => {
  assert.equal(messageText('checkout.nothing_entered'), 'Noch nichts erfasst – bitte zuerst eine Position aufnehmen.');
  assert.equal(messageText('checkout.tendered_missing'), 'Erst eintippen, was der Gast gibt – der Rückgeld-Rechner ist an.');
  assert.equal(messageText('checkout.tendered_too_little'), 'Gegeben ist weniger als der Betrag.');
  assert.equal(messageText('checkout.locked', { reason: 'Die Kasse ist außer Betrieb.' }), 'Kassieren gesperrt: Die Kasse ist außer Betrieb.');
  assert.throws(() => messageText('checkout.locked'), /\{reason\}/);
  assert.equal(messageText('tip.over_half'), 'Über 50 % Trinkgeld – wirklich? Steuerfrei ist nur ortsübliches Trinkgeld.');
  assert.equal(messageText('session.logging_out', { seconds: 30 }), 'Kasse meldet in 30 s ab – Bildschirm berühren, um weiterzuarbeiten.');
  assert.equal(messageText('logout.press_again'), 'Noch einmal drücken beendet die Schicht an dieser Kasse.');
  assert.equal(messageText('card_payment.terminal_cancelling'), 'Das Terminal bricht gleich von selbst ab …');
  assert.equal(messageText('connect.unpair_question'), 'Diesen Browser wirklich von Connect trennen? Der Bondruck geht dann nicht mehr.');
  assert.deepEqual(MESSAGES['connect.unpair_question'].only, ['web']);
  for (const s of ['checkout.nothing_entered', 'checkout.tendered_missing', 'checkout.tendered_too_little', 'checkout.locked', 'tip.over_half', 'session.logging_out', 'logout.press_again', 'card_payment.terminal_cancelling'] as const) {
    assert.equal(MESSAGES[s].only, undefined, `${s}: gilt auf beiden Seiten`);
  }
});

test('Beschriftungen beider Kassen: Kassieren, Warte-Karte, Kopplung, Abmelden, Storno', () => {
  assert.equal(labelText('checkout.tip'), 'Trinkgeld');
  assert.equal(labelText('checkout.no_tip'), 'kein');
  assert.equal(labelText('checkout.custom_amount'), 'Eigener Betrag');
  assert.equal(labelText('checkout.exact'), 'passend');
  assert.equal(labelText('checkout.clear_tendered'), 'Gegeben löschen');
  assert.equal(labelText('checkout.still_missing'), 'Es fehlen noch');
  assert.equal(labelText('checkout.change'), 'Rückgeld');
  assert.equal(labelText('card_payment.amount_on_terminal'), 'Betrag steht am Terminal');
  assert.equal(labelText('card_payment.present_card', { time: '1:05' }), 'Karte vorhalten oder stecken · noch 1:05');
  assert.equal(labelText('pairing.pair_again'), 'Neu koppeln');
  assert.equal(labelText('logout.question'), 'Wirklich abmelden?');
  assert.equal(labelText('logout.keep_working'), 'Weiter arbeiten');
  assert.equal(labelText('device.unpair'), 'Gerät entkoppeln');
  assert.equal(labelText('connect.unpair_confirm'), 'Entkoppeln bestätigen');
  assert.deepEqual(LABELS['connect.unpair_confirm'].only, ['web']);
  assert.equal(labelText('cancellation.title', { receipt: 'K1-42' }), 'Storno zu K1-42');
  assert.throws(() => labelText('cancellation.title'), /\{receipt\}/);
});

test('das X an einer Meldung nennt die Meldung, die es ausblendet', () => {
  assert.equal(labelText('message.dismiss', { message: 'Der Warenkorb ist gesperrt …' }), 'Meldung ausblenden: Der Warenkorb ist gesperrt …');
  assert.equal(labelText('message.dismiss_warning', { message: 'Unklar, ob …' }), 'Verstanden – Warnung ausblenden: Unklar, ob …');
  assert.throws(() => labelText('message.dismiss'), /\{message\}/);
  assert.throws(() => labelText('message.dismiss_warning'), /\{message\}/);
});

test('Rand-Codes zeigen dem Kassier einen Menschentext, nie den technischen Satz', () => {
  const rand = ['route_missing', 'dialect_mismatch', 'not_found', 'internal_translation_error', 'response_translation_failed', 'response_unreadable'];
  for (const code of rand) {
    const regel = findErrorRule('api', { code });
    assert.ok('key' in regel, code);
    const text = messageText(regel.key);
    assert.match(text, /Kassenserver/, code);
    assert.doesNotMatch(text, /v3|HTML|Route|Kennzeichen|translation|unreadable/i, code);
  }
  // Am Server geschah nichts: neuer Versuch erlaubt.
  for (const code of ['route_missing', 'not_found', 'internal_translation_error']) {
    assert.equal(findErrorRule('api', { code }), ERROR_CODE_RULES.find((r) => r.key === 'server.connection_disturbed'), code);
  }
  // Jeder andere Code und ein Fehler ohne Code: der Satz des Backends, auch bei unklarem Ausgang.
  for (const code of ['session_expired', 'validation', 'receipt_outcome_unknown', undefined, null]) {
    assert.deepEqual(findErrorRule('api', { code }), { kind: 'api', behavior: 'server_text' }, String(code));
    assert.deepEqual(findErrorRule('api', { code, outcome: 'unknown' }), { kind: 'api', behavior: 'server_text' }, String(code));
  }
  // Ein Code an einer anderen Art aendert nichts.
  assert.deepEqual(findErrorRule('network', { code: 'route_missing' }), { kind: 'network', key: 'network.no_connection' });
  // Ausgang: nur timeout und network kennen eine Ausgangs-Regel.
  assert.deepEqual(findErrorRule('timeout', { outcome: 'unknown' }), { kind: 'timeout', outcome: 'unknown', key: 'network.outcome_unknown' });
  assert.deepEqual(findErrorRule('timeout', { outcome: 'rejected' }), { kind: 'timeout', key: 'network.timeout' });
  assert.deepEqual(findErrorRule('network'), { kind: 'network', key: 'network.no_connection' });
});

/** Woran ein Satz eine Seite, einen Browser oder die App meint (Muster aus dem Review, M2). */
const NENNT_EINE_SEITE = /seite|browser|\bapp\b|neu laden|tab\b|fenster/i;

test('die gemeinsamen Regeln passen fuer beide Kassen: kein Satz nennt eine Seite, jeder gilt auf beiden Seiten', () => {
  for (const regel of [...ERROR_RULES, ...ERROR_CODE_RULES, ...ERROR_OUTCOME_RULES]) {
    if (!('key' in regel)) continue;
    assert.doesNotMatch(MESSAGES[regel.key].text, NENNT_EINE_SEITE, regel.key);
    assert.equal(MESSAGES[regel.key].only, undefined, regel.key);
  }
  // Das Muster faengt, was es fangen soll (auch klein und zusammengesetzt).
  for (const probe of ['Bitte die Webseite neu laden.', 'Im BROWSER.', 'Die App neu starten.', 'Den Tab schliessen.', 'Fenster neu öffnen.']) {
    assert.match(probe, NENNT_EINE_SEITE, probe);
  }
});

/** Woran ein Satz das Wiederholen empfiehlt (Muster aus dem Review, M2). */
const RAET_ZUM_WIEDERHOLEN = /erneut|nochmal|noch einmal|wiederhol|neu senden/i;

test('Ausgang unklar: kein Code, der auf irgendeinem Aufruf mit Wirkung unklar ist, bekommt einen eigenen Satz, der zum Wiederholen raet', () => {
  for (const probe of ['Bitte erneut senden.', 'Nochmal versuchen.', 'Noch einmal drücken.', 'Bitte wiederholen.', 'Neu senden.']) {
    assert.match(probe, RAET_ZUM_WIEDERHOLEN, probe);
  }
  // Alle Codes, die ein KasseneckApiError tragen kann: der Vertrag (errorCodes.all)
  // und die des Pakets. Ob unklar, entscheidet der Fehler selbst (outcome), je
  // Aufruf: auf den Geldwegen ist jeder Code ausserhalb der Abgelehnt-Liste unklar.
  const vokabular = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/v3/v3-vokabular.json', import.meta.url)), 'utf8')) as { errorCodes: { all: string[] } };
  const codes = [...new Set([...vokabular.errorCodes.all, ...CLIENT_ERROR_CODES, 'dialect_mismatch'])];
  const unklarAuf = (call: string, code: string) => new KasseneckApiError(call, 'x', {}, code).outcome === 'unknown';
  assert.ok(CALLS_WITH_EFFECT.includes('hobexPayApi') && CALLS_WITH_EFFECT.includes('createReceipt'));
  let geprueft = 0;
  for (const code of codes) {
    const aufrufe = CALLS_WITH_EFFECT.filter((c) => unklarAuf(c, code));
    if (aufrufe.length === 0) continue;
    const regel = findErrorRule('api', { code, outcome: 'unknown' });
    // Entweder der Satz des Backends (vom Server, nicht aus diesem Katalog) oder ein eigener ohne Rat zum Wiederholen.
    if ('key' in regel) {
      assert.doesNotMatch(messageText(regel.key), RAET_ZUM_WIEDERHOLEN, `${code} (${aufrufe.join(', ')}) -> ${regel.key}`);
      geprueft++;
    } else {
      assert.equal(regel.kind === 'api' && 'behavior' in regel && regel.behavior, 'server_text', code);
    }
  }
  assert.ok(geprueft >= 3, `nur ${geprueft} eigene Saetze geprueft`);
  // Jede Code-Regel mit Rat zum Wiederholen gilt nur fuer Codes, die auf KEINEM Aufruf mit Wirkung unklar sind.
  for (const regel of ERROR_CODE_RULES) {
    if (!RAET_ZUM_WIEDERHOLEN.test(messageText(regel.key))) continue;
    for (const code of regel.codes) {
      assert.deepEqual(CALLS_WITH_EFFECT.filter((c) => unklarAuf(c, code)), [], `${code} ist unklar, ${regel.key} raet aber zum Wiederholen`);
    }
  }
  // Auf createReceipt tragen nur diese beiden unklaren Codes den Satz des
  // Backends (der Vorgang hat seinen eigenen Katalogsatz); jeder weitere
  // unklare Code braucht eine Regel.
  const ohneEigenenSatz = codes.filter((c) => unklarAuf('createReceipt', c) && !('key' in findErrorRule('api', { code: c, outcome: 'unknown' })));
  assert.deepEqual(ohneEigenenSatz.sort(), ['cancellation_outcome_unknown', 'receipt_outcome_unknown']);
  // Der Satz fuer den sicheren Fall raet dagegen ausdruecklich zum neuen Versuch.
  assert.match(messageText('server.connection_disturbed'), RAET_ZUM_WIEDERHOLEN);
});

test('Frist und Netzfehler: unklarer Ausgang raet nie zum Wiederholen, sonst der Satz von rc.4', () => {
  for (const kind of ['timeout', 'network'] as const) {
    const unklar = findErrorRule(kind, { outcome: 'unknown' });
    assert.ok('key' in unklar);
    assert.doesNotMatch(messageText(unklar.key), RAET_ZUM_WIEDERHOLEN, kind);
    assert.doesNotMatch(messageText(unklar.key), NENNT_EINE_SEITE, kind);
    for (const outcome of ['rejected', undefined, null] as const) {
      assert.deepEqual(findErrorRule(kind, { outcome }), ERROR_RULES.find((r) => r.kind === kind), `${kind} ${String(outcome)}`);
    }
  }
});

test('neue Beschriftungen: Geraet ohne Namen, Restzeit der PIN-Sperre, letzte Runde mit Rundung', () => {
  assert.equal(labelText('register.device_unnamed'), 'Kasse');
  assert.equal(labelText('login.locked_seconds', { seconds: 27 }), 'Noch 27 s gesperrt');
  assert.equal(labelText('split.remaining_with_rounding', { amount: '19,99 €', cents: '−1' }), 'Rest inkl. Rundung 19,99 € (−1 ct)');
  assert.throws(() => labelText('login.locked_seconds'), /\{seconds\}/);
  assert.throws(() => labelText('split.remaining_with_rounding', { amount: '1,00 €' }), /\{cents\}/);
});

// --- Lager an der Kasse (1.3.0) ----------------------------------------------
// Bisher stand das lokal in der Web-Kasse; Web- und Flutter-Kasse sagen
// dasselbe Wort, darum im gemeinsamen Katalog.
test('Lager: Beschriftungen exakt, ohne Geviertstrich', () => {
  const soll: Record<string, string> = {
    'stock.all_articles': 'Alle Artikel',
    'stock.location': 'Lager-Standort',
    'stock.default_location': 'Standard-Standort',
    'stock.resolved': 'aufgelöst',
    'stock.where_to': 'Wohin mit der Ware?',
    'stock.available': 'verfügbar',
    'stock.return_restock': 'Zurück ins Lager',
    'stock.return_defective': 'Defekt',
    'stock.return_disposed': 'Entsorgt',
  };
  for (const [schluessel, text] of Object.entries(soll)) {
    assert.ok(schluessel in LABELS, schluessel);
    assert.equal(labelText(schluessel as LabelKey), text, schluessel);
    assert.equal(LABELS[schluessel as LabelKey].placeholders, undefined, schluessel);
    assert.equal(LABELS[schluessel as LabelKey].only, undefined, `${schluessel}: gilt auf beiden Seiten`);
    assert.ok(!text.includes('\u2014'), schluessel);
  }
  // Genau diese: wer ein stock.*-Wort ergaenzt, ergaenzt es auch hier.
  assert.deepEqual(Object.keys(LABELS).filter((s) => s.startsWith('stock.')).sort(), Object.keys(soll).sort());
});

test('Lager: jede Rueckgabe-Wahl hat ihre Beschriftung', () => {
  assert.deepEqual(Object.keys(RETURN_DISPOSITION_LABELS), [...RETURN_DISPOSITIONS]);
  assert.deepEqual(RETURN_DISPOSITION_LABELS, {
    restock: 'stock.return_restock',
    defective: 'stock.return_defective',
    disposed: 'stock.return_disposed',
  });
  for (const schluessel of Object.values(RETURN_DISPOSITION_LABELS)) assert.ok(schluessel in LABELS, schluessel);
  assert.equal(labelText(RETURN_DISPOSITION_LABELS.restock), 'Zurück ins Lager');
});

test('Storno: abgelehnte Eingabe – Wortlaut exakt, Halbgeviertstrich mit Leerraum', () => {
  const eintrag = MESSAGES['cancellation.input_rejected'];
  assert.equal(eintrag.text, 'Die Eingabe wurde abgelehnt – bitte das Storno neu beginnen.');
  assert.equal(messageText('cancellation.input_rejected'), eintrag.text);
  assert.ok(eintrag.text.includes(' \u2013 '));
  assert.ok(!eintrag.text.includes('\u2014'));
  assert.equal(eintrag.placeholders, undefined);
  assert.equal(eintrag.only, undefined);
});
