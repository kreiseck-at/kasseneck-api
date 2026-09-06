import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEHLERREGELN, MELDUNGEN, meldung, meldungGiltFuer } from '../src/kasse/texte.js';

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
