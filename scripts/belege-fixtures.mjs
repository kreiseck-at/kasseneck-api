// Golden-Belege: erwartete Zeilen aus den Fixture-Eingaben erzeugen.
// Aufruf: `npm run fixtures:erneuern` -- bewusst, nie automatisch: die
// erwarteten Zeilen sind die Zusage an alle Verbraucher (keck, Web, Flutter).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fromReceiptCompanyPayload, fromReceiptPayload } from '../dist/esm/models/index.js';
import { CURRENT_LAYOUT_RULESET, buildReceiptLayout, renderReceiptGrid, gridToText, receiptSheet, logoDimensions, rasterizeLogo } from '../dist/esm/receipt/index.js';

export function ladeFixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/belege/${name}.json`, import.meta.url), 'utf8'));
}
// Bis Aufgabe 10 die Eingaben auf /v3 umstellt: Firma mit uid/taxnr und
// deutscher Storno-Grund und deutsche Layout-Optionen auf das englische
// Modell (wie test/belege-fixture.ts).
const GRUND = { fehleingabe: 'input_error', kunde_storniert: 'customer_cancelled', falsche_zahlart: 'wrong_payment_method', doppelt_erfasst: 'duplicate', sonstiges: 'other' };
function aufV3(fixture) {
  const { uid, taxnr, ...firma } = fixture.company;
  const company = { ...firma, ...(uid !== undefined ? { vatId: uid } : {}), ...(taxnr !== undefined ? { taxNumber: taxnr } : {}) };
  const grund = fixture.receipt.cancellationReason;
  const receipt = typeof grund === 'string' && grund in GRUND ? { ...fixture.receipt, cancellationReason: GRUND[grund] } : fixture.receipt;
  return { ...fixture, company, receipt, ...(fixture.options !== undefined ? { options: optionenAufV3(fixture.options) } : {}) };
}
function optionenAufV3(o) {
  const aus = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'testKasse') aus.testCashregister = v;
    else if (k === 'testSignatur') aus.testSignature = v;
    else if (k === 'regelwerk') aus.ruleset = v;
    else if (k === 'pruefangaben') aus.registrationInfo = v == null ? v : { cardRegisteredAt: v.karteRegistriertAm, cashregisterRegisteredAt: v.kasseRegistriertAm };
    else aus[k] = v;
  }
  return aus;
}

export function zeilenFuer(roh) {
  const fixture = aufV3(roh);
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
      const raster = gridToText(renderReceiptGrid(layout, { charsPerLine: zeichen }));
      writeFileSync(new URL(`../fixtures/erwartet/${name}.grid${zeichen}.txt`, import.meta.url), raster);
      grid[`grid${zeichen}`] = createHash('sha256').update(raster).digest('hex');
    }
    // Blatt mit Probe-Logo und Marke: die Zusage an jeden Zeichner (Reihenfolge, Logo-Mass, QR-Anteil).
    for (const zeichen of [32, 48]) {
      const blatt = JSON.stringify(receiptSheet(layout, { charsPerLine: zeichen, logo: { size: 'M', pixelWidth: 300, pixelHeight: 120 }, brandMark: true }), null, 2) + '\n';
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
    const bild = rasterizeLogo(verlauf(b, h, deckung), b, h, logoDimensions({ size: 'S', pixelWidth: b, pixelHeight: h }, 32), 32);
    const zeilen = [];
    for (let y = 0; y < bild.height; y++) zeilen.push(Array.from(bild.dots.slice(y * bild.width, (y + 1) * bild.width)).join(''));
    return zeilen.join('\n') + '\n';
  };
  // 300x100: oben 10 Zeilen durchsichtig, dann 20 Zeilen Teiltransparenz, darunter deckend (breitenbegrenzt).
  const breit = rasterText(300, 100, (y) => (y < 10 ? 0 : y < 30 ? Math.floor(((y - 10) * 255) / 19) : 255));
  // 100x400: ueberall deckend (hoehenbegrenzt).
  const hoch = rasterText(100, 400, () => 255);
  writeFileSync(new URL('../fixtures/erwartet/logo-probe.raster32.txt', import.meta.url), breit);
  writeFileSync(new URL('../fixtures/erwartet/logo-probe-hoch.raster32.txt', import.meta.url), hoch);
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  writeFileSync(new URL('../fixtures/manifest.json', import.meta.url), JSON.stringify({ regelwerk: CURRENT_LAYOUT_RULESET, belege: manifest, logoProbe: { raster32: sha(breit), hoch32: sha(hoch) } }, null, 2) + '\n');
  console.log(`${Object.keys(manifest).length} Golden-Belege erneuert`);
}
