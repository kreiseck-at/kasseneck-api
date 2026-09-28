import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { fromReceiptPayload } from '../src/models/index.js';
import { buildReceiptLayout, type BuildReceiptLayoutOptions, type ReceiptLayout } from '../src/receipt/index.js';
import { belegFixtureAufV3 } from './belege-fixture.js';
import { blattWieAufgenommen, druckAusgaben, sha } from './druck-ausgaben.js';

/**
 * Druck-Goldens: was am Papier und am Schirm landet, Byte fuer Byte.
 *
 * `test/fixtures/druck-goldens.json` haelt je Golden-Beleg und je Server-Layout
 * aus `fixtures/v3/antworten` den SHA-256 jeder Ausgabe (ESC/POS in fuenf
 * Varianten je Papier, ePOS-XML, Zeichenraster, Blatt, HTML von Blatt- und
 * Zeilenansicht). Aufgenommen am Stand 4d71203, BEVOR die Layout-Schluessel
 * englisch wurden. Im Feld drucken Bondrucker genau diese Belege; die
 * RKSV-Zeilen (Signatur, QR, „Sicherheitseinrichtung ausgefallen“) duerfen
 * sich durch eine Umbenennung nicht um ein Byte verschieben.
 *
 * Aendert sich eine Ausgabe absichtlich, ist das eine eigene Entscheidung mit
 * eigenem Commit, nie ein Beifang.
 */
const goldens = JSON.parse(readFileSync(new URL('../../test/fixtures/druck-goldens.json', import.meta.url), 'utf8')) as {
  belege: Record<string, Record<string, string>>;
  server: Record<string, Record<string, string>>;
  ruleset1: Record<string, Record<string, string>>;
};
const wurzel = new URL('../../fixtures/', import.meta.url);

interface Fixture { company: Parameters<typeof buildReceiptLayout>[1]; receipt: Record<string, unknown> & { customerDetails: string[]; legalMessage: string[] }; options?: BuildReceiptLayoutOptions }

function vergleiche(name: string, layout: ReceiptLayout, soll: Record<string, string> | undefined): void {
  assert.ok(soll, `${name}: kein Golden aufgenommen`);
  const ist = Object.fromEntries(Object.entries(druckAusgaben(layout)).map(([k, v]) => [k, sha(v)]));
  assert.deepEqual(Object.keys(ist).sort(), Object.keys(soll).sort(), `${name}: andere Varianten`);
  const anders = Object.keys(soll).filter((k) => ist[k] !== soll[k]);
  assert.deepEqual(anders, [], `${name}: Ausgabe weicht ab`);
}

const namen = readdirSync(new URL('belege/', wurzel)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

test('Druck-Goldens: jeder Golden-Beleg ist aufgenommen, keiner zu viel', () => {
  assert.deepEqual(Object.keys(goldens.belege).sort(), namen);
});

for (const name of namen) {
  test(`Druck-Golden ${name}: ESC/POS, ePOS, Blatt und HTML byte-gleich`, () => {
    const f = belegFixtureAufV3(JSON.parse(readFileSync(new URL(`belege/${name}.json`, wurzel), 'utf8')) as Fixture);
    const receipt = fromReceiptPayload({ ...f.receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never);
    vergleiche(name, buildReceiptLayout(receipt, f.company, f.options ?? {}), goldens.belege[name]);
  });
}

// Server-Layouts (`data.layout`) aus dem Vertrag. Am Basisstand kannte das
// Paket nur die deutsche Form; aufgenommen wurde darum dieselbe Zeilenfolge
// mit `regelwerk`/`ton` (belegart/warnung). Seit der Umstellung wird die
// Antwort unveraendert gezeichnet und muss dieselben Bytes ergeben.
let serverFaelle = 0;
for (const datei of ['belege', 'kasse-belege']) {
  const d = JSON.parse(readFileSync(new URL(`v3/antworten/${datei}.json`, wurzel), 'utf8')) as { cases: { name: string; response?: { data?: { layout?: ReceiptLayout } } }[] };
  for (const c of d.cases) {
    const layout = c.response?.data?.layout;
    if (!layout) continue;
    serverFaelle += 1;
    test(`Druck-Golden Server-Layout ${datei}/${c.name}: gezeichnet wie aufgenommen`, () => {
      vergleiche(`${datei}/${c.name}`, layout, goldens.server[`${datei}/${c.name}`]);
    });
  }
}

test('Druck-Goldens: alle Server-Layouts aus dem Vertrag sind aufgenommen', () => {
  assert.equal(serverFaelle, Object.keys(goldens.server).length);
  assert.ok(serverFaelle >= 20);
});

// Regelwerk 1 (Altbelege; der Nullbeleg traegt „Betrag: 0,00 €“ statt der
// Prüfangaben). Aufgenommen am Stand 4d71203 mit der Option `regelwerk: 1`;
// hier geht dieselbe 0.x-Option durch den Lader und wird zu `ruleset: 1`.
for (const name of Object.keys(goldens.ruleset1)) {
  test(`Druck-Golden Regelwerk 1 ${name}: byte-gleich`, () => {
    const roh = JSON.parse(readFileSync(new URL(`belege/${name}.json`, wurzel), 'utf8')) as Fixture;
    const f = belegFixtureAufV3({ ...roh, options: { ...(roh.options ?? {}), regelwerk: 1 } as BuildReceiptLayoutOptions });
    const receipt = fromReceiptPayload({ ...f.receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never);
    const layout = buildReceiptLayout(receipt, f.company, f.options ?? {});
    assert.equal(layout.ruleset, 1);
    vergleiche(`Regelwerk 1 ${name}`, layout, goldens.ruleset1[name]);
  });
}

test('Druck-Goldens Regelwerk 1: Nullbelege und Vollbelege dabei', () => {
  const namen1 = Object.keys(goldens.ruleset1);
  assert.ok(namen1.filter((n) => n.startsWith('null-')).length >= 3);
  assert.ok(namen1.includes('verkauf-bar') && namen1.includes('signaturausfall-verkauf'));
});

test('Druck-Goldens: die Blatt-Abbildung wirft bei unbekanntem Feld oder unbekannter Art', () => {
  const blatt = { charsPerLine: 32, blocks: [{ kind: 'logo', widthFraction: 0.5, heightLines: 3 }] };
  assert.deepEqual(blattWieAufgenommen(blatt as never), { zeichen: 32, bloecke: [{ art: 'logo', breiteAnteil: 0.5, hoeheZeilen: 3 }] });
  assert.throws(() => blattWieAufgenommen({ ...blatt, neu: 1 } as never), /unbekanntes Feld blatt\.neu/);
  assert.throws(() => blattWieAufgenommen({ charsPerLine: 32, blocks: [{ kind: 'logo', widthFraction: 0.5, heightLines: 3, size: 'M' }] } as never), /block\.size/);
  assert.throws(() => blattWieAufgenommen({ charsPerLine: 32, blocks: [{ kind: 'bild' }] } as never), /kind\.bild/);
});
