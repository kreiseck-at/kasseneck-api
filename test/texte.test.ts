import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BELEG_MAIL_FEHLER, BESCHRIFTUNGEN, FEHLERREGELN, MELDUNGEN, STORNO_ZAHLUNG_FEHLER, belegMailFehler, stornoZahlungFehler, beschriftung, meldung, meldungGiltFuer } from '../src/kasse/texte.js';
import type { MeldungsSchluessel } from '../src/kasse/texte.js';
import { CANCELLATION_ERROR_CODES } from '../src/models/cancellation.js';
import { PAYMENT_ERROR_CODES } from '../src/models/payment-errors.js';

const SCHLUESSEL_MUSTER = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

test('jeder Schluessel hat die Form bereich.name', () => {
  for (const schluessel of Object.keys(MELDUNGEN)) {
    assert.match(schluessel, SCHLUESSEL_MUSTER, schluessel);
  }
});

test('ein Text ist ein Satz: beginnt gross, endet mit Satzzeichen, kein Rand-Leerraum', () => {
  // `{` bzw. `}` sind am Rand erlaubt: ein Platzhalter kann den Satz eroeffnen
  // oder beschliessen — der eingesetzte Wert traegt dann seine eigene Grossschreibung/Interpunktion.
  for (const [schluessel, eintrag] of Object.entries(MELDUNGEN)) {
    assert.equal(eintrag.text, eintrag.text.trim(), schluessel);
    assert.match(eintrag.text, /^[A-ZÄÖÜ„{]/, schluessel);
    assert.match(eintrag.text, /[.!?…“)}]$/, schluessel);
  }
});

test('Platzhalter im Text und in der Liste sind dieselben', () => {
  for (const [schluessel, eintrag] of Object.entries(MELDUNGEN)) {
    const imText = [...new Set([...eintrag.text.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]))].sort();
    const erklaert = [...(eintrag.platzhalter ?? [])].sort();
    assert.deepEqual(imText, erklaert, schluessel);
  }
});

test('nur kennt nur web und app', () => {
  for (const [schluessel, eintrag] of Object.entries(MELDUNGEN)) {
    for (const seite of eintrag.nur ?? []) {
      assert.ok(seite === 'web' || seite === 'app', `${schluessel}: ${seite}`);
    }
  }
});

test('meldung() ersetzt Platzhalter und laesst den Rest stehen', () => {
  assert.equal(
    meldung('server.unerwartet', { status: 404 }),
    'Der Server hat unerwartet geantwortet (HTTP 404). Bitte den Support verständigen.',
  );
  assert.equal(meldung('netz.zeitablauf'), MELDUNGEN['netz.zeitablauf'].text);
});

test('meldung() wirft bei fehlendem Platzhalter statt {status} stehen zu lassen', () => {
  assert.throws(() => meldung('server.unerwartet'), /status/);
});

test('meldungGiltFuer folgt nur', () => {
  assert.equal(meldungGiltFuer('geraet.browser_speicher', 'web'), true);
  assert.equal(meldungGiltFuer('geraet.browser_speicher', 'app'), false);
  assert.equal(meldungGiltFuer('netz.zeitablauf', 'app'), true);
});

test('die Fehlerregeln enden mit sonst und nennen nur bekannte Schluessel', () => {
  assert.equal(FEHLERREGELN.at(-1)?.art, 'sonst');
  for (const regel of FEHLERREGELN) {
    if ('schluessel' in regel) assert.ok(regel.schluessel in MELDUNGEN, regel.schluessel);
  }
  assert.deepEqual(FEHLERREGELN.map((r) => r.art), ['api', 'klartext', 'zeitablauf', 'netz', 'unerwartet', 'sonst']);
});

test('kein Satz steht zweimal im Katalog', () => {
  const gesehen = new Map<string, string>();
  for (const [schluessel, eintrag] of Object.entries(MELDUNGEN)) {
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
  const gptom = Object.keys(MELDUNGEN).filter((s) => s.startsWith('gptom.'));
  assert.ok(gptom.length > 0);
  for (const schluessel of gptom) {
    assert.deepEqual(MELDUNGEN[schluessel as MeldungsSchluessel].nur, ['app'], schluessel);
  }
});

test('die vier Ausgaenge einer GP-Tom-Zahlung haben ihren Satz', () => {
  // gescheitert (Terminal lehnt ab), gescheitert (App liess sich nicht oeffnen),
  // unklar (Frist abgelaufen) — geglueckt und abgebrochen sagen nichts Rotes.
  assert.equal(MELDUNGEN['gptom.abgelehnt'].text, 'Das Terminal hat die Zahlung abgelehnt.');
  assert.equal(MELDUNGEN['gptom.abgelehnt_mit_code'].text, 'Das Terminal hat die Zahlung abgelehnt ({code}).');
  assert.deepEqual(MELDUNGEN['gptom.abgelehnt_mit_code'].platzhalter, ['code']);
  assert.match(MELDUNGEN['gptom.nicht_geoeffnet'].text, /^GP Tom ließ sich nicht öffnen/);
  assert.equal(MELDUNGEN['gptom.zeit_abgelaufen'].platzhalter, undefined);
  assert.deepEqual(MELDUNGEN['gptom.zeit_abgelaufen_mit_kennung'].platzhalter, ['kennung']);
});

test('ein unklarer Ausgang warnt vor dem zweiten Kassieren, statt nur zu melden', () => {
  for (const schluessel of ['kartenzahlung.unklar', 'kartenzahlung.unklar_mit_kennung', 'gptom.zeit_abgelaufen', 'gptom.zeit_abgelaufen_mit_kennung'] as const) {
    const text = MELDUNGEN[schluessel].text;
    assert.match(text, /kann belastet sein/, schluessel);
    assert.match(text, /Terminal-Beleg/, schluessel);
  }
});

// --- Die Kennung ueberlebt den Abriss --------------------------------------
// Die Kennung ist der einzige Anker, um die Zahlung am Terminal-Beleg
// wiederzufinden. Jede Fassung `…_mit_kennung` ist die Fassung ohne sie plus
// dem Anker — sonst sagen beide Fassungen unterschiedliche Dinge, je nachdem
// ob das Terminal gerade eine Kennung hergab.
test('jede _mit_kennung-Fassung ist ihre Grundfassung plus die Kennung', () => {
  const mitKennung = Object.keys(MELDUNGEN).filter((s) => s.endsWith('_mit_kennung'));
  assert.ok(mitKennung.length >= 2);
  for (const schluessel of mitKennung) {
    const grund = schluessel.slice(0, -'_mit_kennung'.length);
    assert.ok(grund in MELDUNGEN, `${schluessel} ohne Grundfassung ${grund}`);
    const eintrag = MELDUNGEN[schluessel as MeldungsSchluessel];
    assert.deepEqual(eintrag.platzhalter, ['kennung'], schluessel);
    assert.ok(eintrag.text.startsWith(MELDUNGEN[grund as MeldungsSchluessel].text), schluessel);
    assert.deepEqual(eintrag.nur, MELDUNGEN[grund as MeldungsSchluessel].nur, schluessel);
  }
});

// --- Karte gebucht, Beleg fehlt --------------------------------------------
// Der teuerste Fehler am Tresen ist die zweite Belastung. Beide Saetze muessen
// den Betrag UND die Kennung nennen und duerfen nicht zum Wiederholen raten.
test('die Saetze zur schon gebuchten Karte nennen Betrag und Kennung', () => {
  for (const schluessel of ['kartenzahlung.karte_gebucht_beleg_offen', 'kartenzahlung.karte_gebucht_korb_geaendert'] as const) {
    assert.deepEqual([...(MELDUNGEN[schluessel].platzhalter ?? [])].sort(), ['betrag', 'kennung'], schluessel);
    assert.equal(MELDUNGEN[schluessel].nur, undefined, schluessel);
  }
  assert.equal(
    meldung('kartenzahlung.karte_gebucht_beleg_offen', { betrag: '12,90 €', kennung: 'A-4711' }),
    'Die Karte ist bereits mit 12,90 € belastet (Kennung A-4711) – der Beleg dazu fehlt noch. Bitte jetzt den Beleg erstellen und nicht erneut kassieren.',
  );
  assert.match(MELDUNGEN['kartenzahlung.karte_gebucht_korb_geaendert'].text, /verwerfen/);
});

test('der Warteschirm und das Terminal-Protokoll sprechen auf beiden Seiten', () => {
  for (const schluessel of ['kartenzahlung.wartet_auf_terminal', 'protokoll.leer', 'protokoll.kopiert'] as const) {
    assert.equal(MELDUNGEN[schluessel].nur, undefined, schluessel);
    assert.equal(MELDUNGEN[schluessel].platzhalter, undefined, schluessel);
  }
});

// --- Beleg weitergeben -----------------------------------------------------
// Link kopieren, teilen und senden fuehren zu derselben Belegseite. Der Weg
// dorthin unterscheidet sich je Huelle (Web-Share, Teilen-Blatt des Systems),
// das Wort nicht — ein `nur` waere hier eine Kasse, die etwas anderes sagt.
const belegWeitergeben = Object.keys(MELDUNGEN).filter((s) => s.startsWith('beleg.mail_') || s.startsWith('beleg.teilen_') || s === 'beleg.link_kopiert' || s === 'beleg.nicht_teilbar' || s === 'beleg.test_hinweis_teilen');

test('kein Satz zum Weitergeben eines Belegs ist an eine Seite gebunden', () => {
  assert.ok(belegWeitergeben.length >= 9);
  for (const schluessel of belegWeitergeben) {
    assert.equal(MELDUNGEN[schluessel as MeldungsSchluessel].nur, undefined, schluessel);
  }
});

test('der Teilen-Text traegt den Link und nennt Betrieb, Nummer und Betrag', () => {
  const eintrag = MELDUNGEN['beleg.teilen_text'];
  assert.deepEqual([...(eintrag.platzhalter ?? [])].sort(), ['betrag', 'betrieb', 'link', 'nummer']);
  // Ohne Link ist der geteilte Text wertlos, und ein Link mitten im Satz wird
  // von manchen Huellen mitsamt dem Folgetext verlinkt oder abgeschnitten.
  assert.ok(eintrag.text.endsWith('{link}'), 'der Link steht nicht am Schluss');
  assert.equal(
    meldung('beleg.teilen_text', { nummer: 'AT-1-2026-17', betrieb: 'Bäckerei Jobst', betrag: '4,20 €', link: 'https://beleg.kasseneck.at/abc' }),
    'Beleg AT-1-2026-17 von Bäckerei Jobst über 4,20 €: https://beleg.kasseneck.at/abc',
  );
});

// --- Beleg per E-Mail: der Code entscheidet, nicht der Satz -----------------
// Jeder Ausgang des Sendens verlangt vom Kassier etwas anderes: Adresse
// verbessern, spaeter noch einmal, noch einmal senden, Beleg suchen. Genau
// deshalb haengt jeder Fehlersatz an einem `code` — abgeleitet geprueft, damit
// ein neuer Satz ohne Code (oder ein Code ohne Satz) auffaellt.
test('jeder Fehlersatz zum Senden haengt an genau einem Backend-Code', () => {
  const fehlersaetze = Object.keys(MELDUNGEN)
    .filter((s) => s.startsWith('beleg.mail_') && MELDUNGEN[s as MeldungsSchluessel].platzhalter === undefined);
  const zugeordnet = Object.values(BELEG_MAIL_FEHLER);
  assert.deepEqual([...zugeordnet].sort(), fehlersaetze.sort());
  assert.equal(new Set(zugeordnet).size, zugeordnet.length, 'zwei Codes zeigen auf denselben Satz');
});

test('der einzige beleg.mail-Satz mit Platzhalter ist der ueber das Gelingen', () => {
  const mitPlatzhalter = Object.keys(MELDUNGEN)
    .filter((s) => s.startsWith('beleg.mail_') && MELDUNGEN[s as MeldungsSchluessel].platzhalter !== undefined);
  assert.deepEqual(mitPlatzhalter, ['beleg.mail_gesendet']);
  assert.deepEqual(MELDUNGEN['beleg.mail_gesendet'].platzhalter, ['an']);
});

test('die Codes sind Kleinschrift mit Unterstrich, wie sie das Backend schickt', () => {
  for (const code of Object.keys(BELEG_MAIL_FEHLER)) assert.match(code, /^[a-z][a-z0-9_]*$/, code);
});

test('belegMailFehler faengt jeden unbekannten Code mit dem allgemeinen Satz auf', () => {
  for (const [code, schluessel] of Object.entries(BELEG_MAIL_FEHLER)) {
    assert.equal(belegMailFehler(code), schluessel, code);
  }
  for (const unbekannt of ['gibt_es_nicht', '', undefined, null]) {
    assert.equal(belegMailFehler(unbekannt), 'beleg.mail_fehlgeschlagen', String(unbekannt));
  }
});

// --- Drucker-Wizard --------------------------------------------------------
// Der Wizard ist in beiden Kassen derselbe Ablauf mit denselben Worten. Ein
// `nur` an einem seiner Saetze hiesse: an einer Stelle steht in der App etwas
// anderes als im Browser — genau das soll er verhindern.
test('jeder Satz des Drucker-Wizards gilt auf beiden Seiten', () => {
  const wizard = Object.keys(MELDUNGEN).filter((s) => s.startsWith('druck.wizard_'));
  assert.ok(wizard.length >= 7);
  for (const schluessel of wizard) {
    assert.equal(MELDUNGEN[schluessel as MeldungsSchluessel].nur, undefined, schluessel);
  }
});

test('der Wizard fragt, bevor er speichert, und sagt beim Abbruch, dass nichts blieb', () => {
  // Reihenfolge des Ablaufs: verbinden -> Testdruck -> QR-Probe -> speichern.
  assert.deepEqual(MELDUNGEN['druck.wizard_verbinden'].platzhalter, ['name']);
  assert.deepEqual(MELDUNGEN['druck.wizard_gespeichert'].platzhalter, ['name']);
  for (const frage of ['druck.wizard_testdruck_frage', 'druck.wizard_qr_frage'] as const) {
    assert.ok(MELDUNGEN[frage].text.endsWith('?'), frage);
  }
  assert.match(MELDUNGEN['druck.wizard_abgebrochen'].text, /Nichts gespeichert/);
  // Kein Modus druckt einen lesbaren QR-Code: der Hinweis muss sagen, wo der
  // QR-Code dann herkommt — sonst fehlt er dem Kunden am Beleg (RKSV).
  assert.match(MELDUNGEN['druck.wizard_qr_keiner_hinweis'].text, /Bildschirm/);
});

// --- Halbgeviertstrich ----------------------------------------------------
// Sichtbare Texte tragen nur den Halbgeviertstrich; der Geviertstrich gilt
// als Maschinenzeichen. Seit 0.31.0 fuer den ganzen Katalog, auch die
// aelteren Saetze (nur das Zeichen, nicht der Wortlaut).
test('kein Geviertstrich in einer Meldung oder Beschriftung', () => {
  const alle = [...Object.values(MELDUNGEN), ...Object.values(BESCHRIFTUNGEN)].map((m) => m.text);
  assert.ok(alle.length >= 200);
  for (const text of alle) assert.ok(!text.includes('\u2014'), text);
});

test('ein Gedankenstrich steht mit Leerraum auf beiden Seiten', () => {
  for (const { text } of [...Object.values(MELDUNGEN), ...Object.values(BESCHRIFTUNGEN)]) {
    for (const m of text.matchAll(/\u2013/g)) {
      const i = m.index!;
      assert.equal(text[i - 1], ' ', text);
      assert.equal(text[i + 1], ' ', text);
    }
  }
});

// --- Getrennt zahlen -------------------------------------------------------
test('Getrennt zahlen: jeder Satz zur belasteten Karte nennt den Betrag und raet nicht zum Kassieren', () => {
  for (const s of ['getrennt.karte_zurueckbuchen_fehlgeschlagen', 'getrennt.karte_zurueckbuchen_unklar'] as const) {
    assert.deepEqual([...(MELDUNGEN[s].platzhalter ?? [])].sort(), ['betrag', 'kennung'], s);
    assert.match(MELDUNGEN[s].text, /Terminal-Beleg/, s);
    assert.doesNotMatch(MELDUNGEN[s].text, /kassieren/, s);
  }
  for (const s of ['getrennt.extern_zurueckbuchen', 'getrennt.bar_zurueckgeben', 'getrennt.sitzung_offen'] as const) {
    assert.deepEqual(MELDUNGEN[s].platzhalter, ['betrag'], s);
  }
  for (const s of Object.keys(MELDUNGEN).filter((k) => k.startsWith('getrennt.'))) {
    assert.equal(MELDUNGEN[s as MeldungsSchluessel].nur, undefined, `${s}: gilt auf beiden Seiten`);
  }
});

test('Storno mit mehreren Zahlungen: jeder Code ist ein echter Backend-Code und hat einen eigenen Satz', () => {
  const bekannt = new Set<string>([...CANCELLATION_ERROR_CODES, ...PAYMENT_ERROR_CODES]);
  for (const [code, schluessel] of Object.entries(STORNO_ZAHLUNG_FEHLER)) {
    assert.ok(bekannt.has(code), code);
    assert.ok(schluessel in MELDUNGEN, schluessel);
  }
  const saetze = Object.values(STORNO_ZAHLUNG_FEHLER);
  assert.equal(new Set(saetze).size, saetze.length, 'zwei Codes zeigen auf denselben Satz');
  for (const code of ['cancellation_payments_required', 'cancellation_refund_exceeds_payment', 'cancellation_refund_reference_required', 'cancellation_refund_reference_unknown', 'payments_sum_mismatch', 'cancellation_outcome_unknown']) {
    assert.ok(code in STORNO_ZAHLUNG_FEHLER, code);
  }
});

test('Beschriftungen: Schluessel bereich.name, kein Rand-Leerraum, Platzhalter exakt, keine Saetze aus dem Meldungskatalog', () => {
  const saetze = new Set(Object.values(MELDUNGEN).map((m) => m.text));
  for (const [schluessel, eintrag] of Object.entries(BESCHRIFTUNGEN)) {
    assert.match(schluessel, SCHLUESSEL_MUSTER, schluessel);
    assert.ok(eintrag.text.length > 0, schluessel);
    assert.equal(eintrag.text, eintrag.text.trim(), schluessel);
    const imText = [...new Set([...eintrag.text.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]))].sort();
    assert.deepEqual(imText, [...(eintrag.platzhalter ?? [])].sort(), schluessel);
    assert.ok(!saetze.has(eintrag.text), `${schluessel} steht schon als Meldung`);
    for (const seite of eintrag.nur ?? []) assert.ok(seite === 'web' || seite === 'app', schluessel);
  }
});

test('Beschriftungen folgen dem Bon und ersetzen Platzhalter', () => {
  assert.equal(beschriftung('getrennt.zahlung', { n: 3 }), 'Zahlung 3');
  assert.equal(beschriftung('getrennt.teilen', { n: 3 }), '÷ 3');
  assert.equal(beschriftung('getrennt.davon_trinkgeld', { betrag: '2,00 €' }), 'davon Trinkgeld 2,00 €');
  assert.equal(beschriftung('zahlart.kartenzahlung'), 'Kartenzahlung');
  assert.equal(beschriftung('zahlart.barzahlung'), 'Barzahlung');
  assert.equal(beschriftung('zahlart.mehrere'), 'Mehrere');
  assert.equal(beschriftung('getrennt.knopf'), 'Getrennt');
  assert.equal(beschriftung('getrennt.einstellung'), 'Getrennt zahlen');
  assert.throws(() => beschriftung('getrennt.zahlung'), /\{n\}/);
});

test('Getrennt zahlen, Aufteilung: Weiter-Knopf nennt den Betrag, Tabs und Stueck-Zeilen ersetzen ihre Platzhalter', () => {
  assert.equal(beschriftung('getrennt.weiter', { betrag: '67,00 €' }), 'Weiter · 67,00 € getrennt');
  assert.equal(beschriftung('getrennt.tab_positionen'), 'Nach Positionen');
  assert.equal(beschriftung('getrennt.tab_betrag'), 'Betrag');
  assert.equal(beschriftung('getrennt.stueck_offen', { n: 2 }), '2 offen');
  assert.equal(beschriftung('getrennt.stueck_gewaehlt', { n: 2, offen: 4 }), '2 von 4');
  assert.throws(() => beschriftung('getrennt.stueck_gewaehlt', { n: 2 }), /\{offen\}/);
  assert.equal(beschriftung('getrennt.offene_positionen'), 'Offene Positionen');
  assert.equal(beschriftung('getrennt.nichts_gewaehlt'), 'Noch nichts angetippt');
  assert.equal(beschriftung('getrennt.alles_bezahlt'), 'Alles bezahlt');
  // Bezahlte Stueck stehen nicht mehr da (die Kachel verschwindet) -- der Satz entfaellt.
  assert.equal('getrennt.stueck_bezahlt' in BESCHRIFTUNGEN, false);
  assert.equal(beschriftung('getrennt.stueck_mehr', { name: 'Bier' }), 'Bier: ein Stück mehr');
  assert.equal(beschriftung('getrennt.stueck_weniger', { name: 'Bier' }), 'Bier: ein Stück weniger');
  assert.equal(beschriftung('getrennt.gegeben_rueckgeld', { gegeben: '50,00 €', rueckgeld: '23,23 €' }), 'Gegeben 50,00 € · Rückgeld 23,23 €');
  assert.equal(beschriftung('getrennt.zahlart'), 'Zahlart');
  assert.equal(beschriftung('getrennt.art_bar'), 'Bar');
  assert.equal(beschriftung('getrennt.art_karte'), 'Karte');
  assert.equal(beschriftung('getrennt.zahlung_hinzufuegen', { betrag: '12,40 €' }), 'Zahlung hinzufügen · 12,40 €');
  assert.throws(() => beschriftung('getrennt.zahlung_hinzufuegen'), /\{betrag\}/);
  // Ohne „Gegeben" bei Rueckgeld-Rechner: derselbe Grund wie beim Abschluss, ohne Platzhalter.
  assert.match(MELDUNGEN['getrennt.gegeben_fehlt'].text, /Rückgeld-Rechner/);
  assert.equal(MELDUNGEN['getrennt.gegeben_fehlt'].platzhalter, undefined);
  for (const weg of ['getrennt.bar_kassieren', 'getrennt.karte_kassieren', 'getrennt.kassieren']) {
    assert.equal(weg in BESCHRIFTUNGEN, false, weg);
  }
  // Die Sperre nennt den Grund: Betraege lassen sich keinen Stuecken zuordnen.
  assert.match(MELDUNGEN['getrennt.positionen_gesperrt'].text, /Betrag/);
  assert.equal(MELDUNGEN['getrennt.positionen_gesperrt'].platzhalter, undefined);
  assert.equal(MELDUNGEN['getrennt.positionen_waehlen'].platzhalter, undefined);
});

test('stornoZahlungFehler faengt jeden unbekannten Code mit dem allgemeinen Storno-Satz auf', () => {
  for (const [code, schluessel] of Object.entries(STORNO_ZAHLUNG_FEHLER)) {
    assert.equal(stornoZahlungFehler(code), schluessel, code);
  }
  for (const unbekannt of ['GIBT_ES_NICHT', 'STORNO_OUTCOME_UNKNOWN', '', undefined, null]) {
    assert.equal(stornoZahlungFehler(unbekannt), 'storno.fehlgeschlagen', String(unbekannt));
  }
});

test('ein offener Storno-Ausgang warnt vor dem zweiten Stornieren', () => {
  assert.equal(stornoZahlungFehler('cancellation_outcome_unknown'), 'storno.ergebnis_unklar');
  const text = MELDUNGEN['storno.ergebnis_unklar'].text;
  assert.match(text, /nicht erneut stornieren/);
  assert.match(text, /Belegliste/);
  // Die Zuordnung prueft exakt wie isCancellationErrorCode: der alte Name
  // von /v1 kommt unter /v3 nicht mehr an.
  assert.equal(stornoZahlungFehler('STORNO_OUTCOME_UNKNOWN'), 'storno.fehlgeschlagen');
});

test('Storno getrennt bezahlter Belege: Karten gehen erst nach dem gebuchten Storno von Hand zurueck', () => {
  const liste = MELDUNGEN['storno.karten_gutschreiben'];
  // Der Satz steht ueber einer Liste mit Betrag je Karte -- er selbst bleibt
  // ohne Platzhalter und passt fuer eine wie fuer mehrere Karten.
  assert.equal(liste.platzhalter, undefined);
  assert.equal(liste.nur, undefined);
  assert.match(liste.text, /gebucht/);
  assert.match(liste.text, /Terminal gutschreiben/);
  assert.match(liste.text, /abhaken/);
  // Die automatische Gutschrift kommt erst mit Server-Unterstuetzung; bis
  // dahin fuehrt der Katalog keinen Satz dafuer.
  for (const alt of ['storno.gutschrift_laeuft', 'storno.gutschrift_fehlgeschlagen', 'storno.gutschrift_unklar',
    'storno.gutgeschrieben_nicht_gebucht', 'storno.gutschrift_pruefen', 'storno.extern_gutschreiben']) {
    assert.ok(!(alt in MELDUNGEN), alt);
  }
  for (const alt of ['storno.am_terminal_gutgeschrieben', 'storno.nicht_gutgeschrieben']) {
    assert.ok(!(alt in BESCHRIFTUNGEN), alt);
  }
});

test('ein offener Storno-Ausgang mit Karten haelt die Gutschrift zurueck, bis das Storno in der Belegliste steht', () => {
  const eintrag = MELDUNGEN['storno.ergebnis_unklar_karten'];
  assert.equal(eintrag.platzhalter, undefined);
  assert.equal(eintrag.nur, undefined);
  assert.match(eintrag.text, /nicht erneut stornieren/);
  assert.match(eintrag.text, /noch keine Karte gutschreiben/);
  assert.match(eintrag.text, /Belegliste/);
  assert.match(eintrag.text, /am Terminal gutschreiben/);
  // Der Code selbst zeigt weiter auf den allgemeinen Satz; welchen die Kasse
  // zeigt, entscheidet sie am gesendeten Vorschlag.
  assert.equal(stornoZahlungFehler('cancellation_outcome_unknown'), 'storno.ergebnis_unklar');
  assert.ok(eintrag.text.startsWith('Unklar, ob das Storno entstanden ist – es kann bereits signiert sein.'));
  assert.ok(MELDUNGEN['storno.ergebnis_unklar'].text.startsWith('Unklar, ob das Storno entstanden ist – es kann bereits signiert sein.'));
});

test('Getrennt zahlen: erneutes Zurueckbuchen heisst in beiden Kassen gleich', () => {
  assert.equal(beschriftung('getrennt.erneut_zurueckbuchen'), 'Erneut zurückbuchen');
});

test('Storno: nicht abgehakte Karten fragen vor dem Schliessen einmal nach', () => {
  const eintrag = MELDUNGEN['storno.karten_nicht_abgehakt'];
  assert.equal(eintrag.platzhalter, undefined);
  assert.equal(eintrag.nur, undefined);
  assert.match(eintrag.text, /am Terminal gutschreiben/);
  assert.match(eintrag.text, /noch einmal drücken/);
  assert.ok(!eintrag.text.includes('\u2014'));
});

// --- Oberflaechen-Vertrag: Texte, die bisher nur in der Browser-Kasse standen --
// Beide Kassen zeigen dieselben Woerter; wortgleich mit dem bisherigen Stand
// der Browser-Kasse, nur der Geviertstrich ist ein Halbgeviertstrich.
test('Kassieren, Sitzung und Abmelden: die Saetze beider Kassen', () => {
  assert.equal(meldung('kassieren.nichts_erfasst'), 'Noch nichts erfasst – bitte zuerst eine Position aufnehmen.');
  assert.equal(meldung('kassieren.gegeben_fehlt'), 'Erst eintippen, was der Gast gibt – der Rückgeld-Rechner ist an.');
  assert.equal(meldung('kassieren.gegeben_zu_wenig'), 'Gegeben ist weniger als der Betrag.');
  assert.equal(meldung('kassieren.gesperrt', { grund: 'Die Kasse ist außer Betrieb.' }), 'Kassieren gesperrt: Die Kasse ist außer Betrieb.');
  assert.throws(() => meldung('kassieren.gesperrt'), /\{grund\}/);
  assert.equal(meldung('trinkgeld.ueber_haelfte'), 'Über 50 % Trinkgeld – wirklich? Steuerfrei ist nur ortsübliches Trinkgeld.');
  assert.equal(meldung('sitzung.meldet_ab', { sekunden: 30 }), 'Kasse meldet in 30 s ab – Bildschirm berühren, um weiterzuarbeiten.');
  assert.equal(meldung('abmelden.noch_einmal'), 'Noch einmal drücken beendet die Schicht an dieser Kasse.');
  assert.equal(meldung('kartenzahlung.terminal_bricht_ab'), 'Das Terminal bricht gleich von selbst ab …');
  assert.equal(meldung('connect.entkoppeln_frage'), 'Diesen Browser wirklich von Connect trennen? Der Bondruck geht dann nicht mehr.');
  assert.deepEqual(MELDUNGEN['connect.entkoppeln_frage'].nur, ['web']);
  for (const s of ['kassieren.nichts_erfasst', 'kassieren.gegeben_fehlt', 'kassieren.gegeben_zu_wenig', 'kassieren.gesperrt', 'trinkgeld.ueber_haelfte', 'sitzung.meldet_ab', 'abmelden.noch_einmal', 'kartenzahlung.terminal_bricht_ab'] as const) {
    assert.equal(MELDUNGEN[s].nur, undefined, `${s}: gilt auf beiden Seiten`);
  }
});

test('Beschriftungen beider Kassen: Kassieren, Warte-Karte, Kopplung, Abmelden, Storno', () => {
  assert.equal(beschriftung('kassieren.trinkgeld'), 'Trinkgeld');
  assert.equal(beschriftung('kassieren.kein'), 'kein');
  assert.equal(beschriftung('kassieren.eigener_betrag'), 'Eigener Betrag');
  assert.equal(beschriftung('kassieren.passend'), 'passend');
  assert.equal(beschriftung('kassieren.gegeben_loeschen'), 'Gegeben löschen');
  assert.equal(beschriftung('kassieren.es_fehlen_noch'), 'Es fehlen noch');
  assert.equal(beschriftung('kassieren.rueckgeld'), 'Rückgeld');
  assert.equal(beschriftung('kartenzahlung.betrag_am_terminal'), 'Betrag steht am Terminal');
  assert.equal(beschriftung('kartenzahlung.karte_vorhalten', { zeit: '1:05' }), 'Karte vorhalten oder stecken · noch 1:05');
  assert.equal(beschriftung('kopplung.neu_koppeln'), 'Neu koppeln');
  assert.equal(beschriftung('abmelden.frage'), 'Wirklich abmelden?');
  assert.equal(beschriftung('abmelden.weiter_arbeiten'), 'Weiter arbeiten');
  assert.equal(beschriftung('geraet.entkoppeln'), 'Gerät entkoppeln');
  assert.equal(beschriftung('connect.entkoppeln_bestaetigen'), 'Entkoppeln bestätigen');
  assert.deepEqual(BESCHRIFTUNGEN['connect.entkoppeln_bestaetigen'].nur, ['web']);
  assert.equal(beschriftung('storno.titel', { beleg: 'K1-42' }), 'Storno zu K1-42');
  assert.throws(() => beschriftung('storno.titel'), /\{beleg\}/);
});

test('das X an einer Meldung nennt die Meldung, die es ausblendet', () => {
  assert.equal(beschriftung('meldung.ausblenden', { meldung: 'Der Warenkorb ist gesperrt …' }), 'Meldung ausblenden: Der Warenkorb ist gesperrt …');
  assert.equal(beschriftung('meldung.warnung_ausblenden', { meldung: 'Unklar, ob …' }), 'Verstanden – Warnung ausblenden: Unklar, ob …');
  assert.throws(() => beschriftung('meldung.ausblenden'), /\{meldung\}/);
  assert.throws(() => beschriftung('meldung.warnung_ausblenden'), /\{meldung\}/);
});
