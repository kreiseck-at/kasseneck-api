// Golden-Belege: erwartete Zeilen aus den Fixture-Eingaben erzeugen.
// Aufruf: `npm run fixtures:erneuern` -- bewusst, nie automatisch: die
// erwarteten Zeilen sind die Zusage an alle Verbraucher (keck, Web, Flutter).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fromReceiptCompanyPayload, fromReceiptPayload } from '../dist/esm/models/index.js';
import { CURRENT_LAYOUT_RULESET, buildReceiptLayout, renderReceiptGrid, gridToText, receiptSheet, logoDimensions, rasterizeLogo } from '../dist/esm/receipt/index.js';
import { cashMovementLayout, shiftReceiptLayout } from '../dist/esm/pos/index.js';

/**
 * Bons der Schicht (Z-Bon, X-Bon, Kassenbewegung): Name -> Fall im Vertrag
 * (fixtures/v3/antworten/kasse.json, `endpunkt/fall`). Die Eingabe ist die
 * Antwort des Servers selbst (`data.receipt`), damit Layout und Vertrag nicht
 * auseinanderlaufen.
 */
export const SCHICHT_BONS = {
  'shift-close': 'closeMyShift/success_manager',
  'shift-close-blind': 'closeMyShift/success_cashier_blind',
  'shift-interim': 'getMyShiftReport/success_manager',
  'cash-movement': 'recordMyCashMovement/success_manager_cash_drop',
};

export function schichtBonLayout(quelle) {
  const [endpunkt, name] = quelle.split('/');
  const kasse = JSON.parse(readFileSync(new URL('../fixtures/v3/antworten/kasse.json', import.meta.url), 'utf8'));
  const fall = kasse.endpoints[endpunkt].cases.find((c) => c.case === name);
  if (!fall) throw new Error(`kasse.json: kein Fall ${quelle}`);
  const bon = fall.response.data.receipt;
  return bon.kind === 'cash_movement' ? cashMovementLayout(bon) : shiftReceiptLayout(bon);
}

export function ladeFixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/receipts/${name}.json`, import.meta.url), 'utf8'));
}
export function zeilenFuer(fixture) {
  // Die Eingaben sprechen das englische Modell von 1.0 (Firma mit
  // vatId/taxNumber, Storno-Grund als Code, Layout-Optionen englisch).
  // Modell-Payloads: das Fixture traegt Firmenfelder im Modellformat (companyName ...),
  // der Beleg im Payload-Format (Strings fuer customerDetails/legalMessage werden akzeptiert).
  const receipt = fromReceiptPayload({ ...fixture.receipt, customerDetails: fixture.receipt.customerDetails.join('\n'), legalMessage: fixture.receipt.legalMessage.join('\n') });
  return buildReceiptLayout(receipt, fixture.company, fixture.options ?? {});
}
export function fixtureNamen() {
  return readdirSync(new URL('../fixtures/receipts/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const manifest = {};
  for (const name of fixtureNamen()) {
    const layout = zeilenFuer(ladeFixture(name));
    const text = JSON.stringify(layout, null, 2) + '\n';
    writeFileSync(new URL(`../fixtures/expected/${name}.lines.json`, import.meta.url), text);
    // Zeichenraster als Klartext (32 = 58 mm, 48 = 80 mm): lesbar, diff-bar, die Zusage fuer Bildschirm/Druck/PDF.
    const grid = {};
    for (const zeichen of [32, 48]) {
      const raster = gridToText(renderReceiptGrid(layout, { charsPerLine: zeichen }));
      writeFileSync(new URL(`../fixtures/expected/${name}.grid${zeichen}.txt`, import.meta.url), raster);
      grid[`grid${zeichen}`] = createHash('sha256').update(raster).digest('hex');
    }
    // Blatt mit Probe-Logo und Marke: die Zusage an jeden Zeichner (Reihenfolge, Logo-Mass, QR-Anteil).
    for (const zeichen of [32, 48]) {
      const blatt = JSON.stringify(receiptSheet(layout, { charsPerLine: zeichen, logo: { size: 'M', pixelWidth: 300, pixelHeight: 120 }, brandMark: true }), null, 2) + '\n';
      writeFileSync(new URL(`../fixtures/expected/${name}.sheet${zeichen}.json`, import.meta.url), blatt);
      grid[`sheet${zeichen}`] = createHash('sha256').update(blatt).digest('hex');
    }
    manifest[name] = { input: createHash('sha256').update(readFileSync(new URL(`../fixtures/receipts/${name}.json`, import.meta.url))).digest('hex'), expected: createHash('sha256').update(text).digest('hex'), ...grid };
  }
  // Logo-Proben: dieselben Formeln wie im Golden-Test und im Dart-Zwilling.
  // Farbe: g = floor(x * 255 / (b - 1)), R = g, G = (g * 3) % 256, B = 255 - g.
  const verlauf = (b, h, deckung) => {
    const rgba = new Uint8Array(b * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
      const i = (y * b + x) * 4; const g = Math.floor((x * 255) / (b - 1));
      rgba[i] = g; rgba[i + 1] = (g * 3) % 256; rgba[i + 2] = 255 - g; rgba[i + 3] = deckung(y);
    }
    return rgba;
  };
  const rasterText = (b, h, deckung) => {
    const bild = rasterizeLogo(verlauf(b, h, deckung), b, h, logoDimensions({ size: 'S', pixelWidth: b, pixelHeight: h }, 32), 32);
    const zeilen = [];
    for (let y = 0; y < bild.height; y++) zeilen.push(Array.from(bild.dots.slice(y * bild.width, (y + 1) * bild.width)).join(''));
    return zeilen.join('\n') + '\n';
  };
  // 300x100: oben 10 Zeilen durchsichtig, dann 20 Zeilen Teiltransparenz, darunter deckend (breitenbegrenzt).
  const breit = rasterText(300, 100, (y) => (y < 10 ? 0 : y < 30 ? Math.floor(((y - 10) * 255) / 19) : 255));
  // 100x400: ueberall deckend (hoehenbegrenzt).
  const hoch = rasterText(100, 400, () => 255);
  writeFileSync(new URL('../fixtures/expected/logo-sample.raster32.txt', import.meta.url), breit);
  writeFileSync(new URL('../fixtures/expected/logo-sample-tall.raster32.txt', import.meta.url), hoch);
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  writeFileSync(new URL('../fixtures/manifest.json', import.meta.url), JSON.stringify({ ruleset: CURRENT_LAYOUT_RULESET, receipts: manifest, logoSample: { raster32: sha(breit), tall32: sha(hoch) } }, null, 2) + '\n');
  // Bons der Schicht: Zeilen und Raster, Quellen und Pruefsummen in fixtures/shift-receipts.json.
  const schicht = {};
  for (const [name, quelle] of Object.entries(SCHICHT_BONS)) {
    const layout = schichtBonLayout(quelle);
    const text = JSON.stringify(layout, null, 2) + '\n';
    writeFileSync(new URL(`../fixtures/expected/${name}.lines.json`, import.meta.url), text);
    const eintrag = { source: quelle, expected: sha(text) };
    for (const zeichen of [32, 48]) {
      const raster = gridToText(renderReceiptGrid(layout, { charsPerLine: zeichen }));
      writeFileSync(new URL(`../fixtures/expected/${name}.grid${zeichen}.txt`, import.meta.url), raster);
      eintrag[`grid${zeichen}`] = sha(raster);
    }
    schicht[name] = eintrag;
  }
  writeFileSync(new URL('../fixtures/shift-receipts.json', import.meta.url), JSON.stringify({
    _note: 'Shift receipts (Z, X, cash movement) as line model: name -> contract case in fixtures/v3/antworten/kasse.json (endpoint/case, input = data.receipt), SHA-256 of fixtures/expected/<name>.lines.json and of the 32/48 character grids. Generated by scripts/belege-fixtures.mjs (npm run fixtures:erneuern), never edit by hand.',
    receipts: schicht,
  }, null, 2) + '\n');
  console.log(`${Object.keys(manifest).length} Golden-Belege erneuert, ${Object.keys(schicht).length} Bons der Schicht`);
}
