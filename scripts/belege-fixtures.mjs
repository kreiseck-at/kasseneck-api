// Golden-Belege: erwartete Zeilen aus den Fixture-Eingaben erzeugen.
// Aufruf: `npm run fixtures:erneuern` -- bewusst, nie automatisch: die
// erwarteten Zeilen sind die Zusage an alle Verbraucher (keck, Web, Flutter).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fromReceiptCompanyPayload, fromReceiptPayload } from '../dist/esm/models/index.js';
import { AKTUELLES_REGELWERK, buildReceiptLayout, renderReceiptGrid, gridAlsText, belegBlatt, logoMass, logoRaster } from '../dist/esm/receipt/index.js';

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
    // Zeichenraster als Klartext (32 = 58 mm, 48 = 80 mm): lesbar, diff-bar, die Zusage fuer Bildschirm/Druck/PDF.
    const grid = {};
    for (const zeichen of [32, 48]) {
      const raster = gridAlsText(renderReceiptGrid(layout, { zeichen }));
      writeFileSync(new URL(`../fixtures/erwartet/${name}.grid${zeichen}.txt`, import.meta.url), raster);
      grid[`grid${zeichen}`] = createHash('sha256').update(raster).digest('hex');
    }
    // Blatt mit Probe-Logo und Marke: die Zusage an jeden Zeichner (Reihenfolge, Logo-Mass, QR-Anteil).
    for (const zeichen of [32, 48]) {
      const blatt = JSON.stringify(belegBlatt(layout, { zeichen, logo: { stufe: 'M', pxBreite: 300, pxHoehe: 120 }, marke: true }), null, 2) + '\n';
      writeFileSync(new URL(`../fixtures/erwartet/${name}.blatt${zeichen}.json`, import.meta.url), blatt);
      grid[`blatt${zeichen}`] = createHash('sha256').update(blatt).digest('hex');
    }
    manifest[name] = { eingabe: createHash('sha256').update(readFileSync(new URL(`../fixtures/belege/${name}.json`, import.meta.url))).digest('hex'), erwartet: createHash('sha256').update(text).digest('hex'), ...grid };
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
    const bild = logoRaster(verlauf(b, h, deckung), b, h, logoMass({ stufe: 'S', pxBreite: b, pxHoehe: h }, 32), 32);
    const zeilen = [];
    for (let y = 0; y < bild.hoehe; y++) zeilen.push(Array.from(bild.punkte.slice(y * bild.breite, (y + 1) * bild.breite)).join(''));
    return zeilen.join('\n') + '\n';
  };
  // 300x100: oben 10 Zeilen durchsichtig, dann 20 Zeilen Teiltransparenz, darunter deckend (breitenbegrenzt).
  const breit = rasterText(300, 100, (y) => (y < 10 ? 0 : y < 30 ? Math.floor(((y - 10) * 255) / 19) : 255));
  // 100x400: ueberall deckend (hoehenbegrenzt).
  const hoch = rasterText(100, 400, () => 255);
  writeFileSync(new URL('../fixtures/erwartet/logo-probe.raster32.txt', import.meta.url), breit);
  writeFileSync(new URL('../fixtures/erwartet/logo-probe-hoch.raster32.txt', import.meta.url), hoch);
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  writeFileSync(new URL('../fixtures/manifest.json', import.meta.url), JSON.stringify({ regelwerk: AKTUELLES_REGELWERK, belege: manifest, logoProbe: { raster32: sha(breit), hoch32: sha(hoch) } }, null, 2) + '\n');
  console.log(`${Object.keys(manifest).length} Golden-Belege erneuert`);
}
