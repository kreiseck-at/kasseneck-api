import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { fromReceiptPayload } from '../src/models/index.js';
import { buildReceiptLayout, type BuildReceiptLayoutOptions, type ReceiptLayout } from '../src/receipt/index.js';
import { belegFixtureAufV3 } from './belege-fixture.js';
import { druckAusgaben, sha } from './druck-ausgaben.js';

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
