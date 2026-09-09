import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BELEG_MAIL_FEHLER, FEHLERREGELN, MELDUNGEN, belegMailFehler, meldung, meldungGiltFuer } from '../src/kasse/texte.js';
import type { MeldungsSchluessel } from '../src/kasse/texte.js';

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
    'Die Karte ist bereits mit 12,90 € belastet (Kennung A-4711) — der Beleg dazu fehlt noch. Bitte jetzt den Beleg erstellen und nicht erneut kassieren.',
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
