// Golden-Belege: erwartete Zeilen aus den Fixture-Eingaben erzeugen.
// Aufruf: `npm run fixtures:erneuern` -- bewusst, nie automatisch: die
// erwarteten Zeilen sind die Zusage an alle Verbraucher (keck, Web, Flutter).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fromReceiptCompanyPayload, fromReceiptPayload } from '../dist/esm/models/index.js';
import { buildReceiptLayout } from '../dist/esm/receipt/index.js';

export function ladeFixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/belege/${name}.json`, import.meta.url), 'utf8'));
}
export function zeilenFuer(fixture) {
  // Modell-Payloads: das Fixture traegt Firmenfelder im Modellformat (companyName ...),
  // der Beleg im Payload-Format (Strings fuer customerDetails/legalMessage werden akzeptiert).
  const receipt = fromReceiptPayload({ ...fixture.receipt, customerDetails: fixture.receipt.customerDetails.join('\n'), legalMessage: fixture.receipt.legalMessage.join('\n') });
  return buildReceiptLayout(receipt, fixture.company, fixture.options ?? {});
}
export function fixtureNamen() {
  return readdirSync(new URL('../fixtures/belege/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const manifest = {};
  for (const name of fixtureNamen()) {
    const layout = zeilenFuer(ladeFixture(name));
    const text = JSON.stringify(layout, null, 2) + '\n';
    writeFileSync(new URL(`../fixtures/erwartet/${name}.lines.json`, import.meta.url), text);
    manifest[name] = { eingabe: createHash('sha256').update(readFileSync(new URL(`../fixtures/belege/${name}.json`, import.meta.url))).digest('hex'), erwartet: createHash('sha256').update(text).digest('hex') };
  }
  writeFileSync(new URL('../fixtures/manifest.json', import.meta.url), JSON.stringify({ regelwerk: 1, belege: manifest }, null, 2) + '\n');
  console.log(`${Object.keys(manifest).length} Golden-Belege erneuert`);
}
