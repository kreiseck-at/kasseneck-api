import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { KeckPaymentMethod, ReceiptType, VatRate } from '../src/enums/index.js';
import type { Receipt, ReceiptCompany } from '../src/models/index.js';
import { buildReceiptLayout } from '../src/receipt/index.js';
import { ReceiptLayoutView } from '../src/react/index.js';

/**
 * Der React-Adapter zeichnet das Layout-Modell. Er ist ein eigener
 * Einstiegspunkt (`@kreiseck/kasseneck-api/react`) und React ist eine
 * **Peer**-Abhaengigkeit: wer den Kern benutzt, soll React weder installieren
 * noch laden muessen. Genau das haelt der letzte Test dieser Datei fest — mit
 * einer Gegenprobe, die beweist, dass die Falle ueberhaupt zuschnappen kann.
 */

const QR_INHALT = '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-13T00:30:00_5,00_2,70_0,00_0,00_0,00_U_V_6F0404F0_S';

const FIRMA: ReceiptCompany = {
  companyName: 'Café Kreiseck',
  street: 'Hauptstraße 5',
  zip: '1010',
  city: 'Wien',
  phone: '+43 1 1234567',
  uid: 'ATU12345678',
  taxnr: '12-345/6789',
  isSmallBusiness: false,
  footer1: 'Vielen Dank für Ihren Einkauf',
  footer2: 'www.kreiseck.com',
  thanksMessage: [],
  showKreiseckLogo: false,
};

const BELEG: Receipt = {
  receiptId: 'AT0-KASSE1-42',
  cashregisterId: 'KASSE1',
  timeStamp: '2026-08-13T00:30:00',
  items: [
    { name: 'Espresso', quantity: 2, vat: VatRate.vat20, priceCents: 250 },
    { name: 'Semmel', quantity: 3, vat: VatRate.vat10, priceCents: 90 },
  ],
  vouchers: [],
  paymentMethod: KeckPaymentMethod.cash,
  turnoverCounterAES256ICM: 'U',
  signaturePreviousReceipt: 'V',
  certificateSerialNumber: '6F0404F0',
  receiptType: ReceiptType.standard,
  sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.SIGNATURWERT',
  qr: QR_INHALT,
  fullReceiptId: 'VOLLBELEGNUMMER',
  customerDetails: [],
  legalMessage: [],
};

function markup(): string {
  return renderToStaticMarkup(<ReceiptLayoutView layout={buildReceiptLayout(BELEG, FIRMA)} />);
}

// ------------------------------------------------------------- Darstellung

test('React: aus dem Layout-Modell entsteht Text mit allen Pflichtangaben', () => {
  const html = markup();
  assert.match(html, /Café Kreiseck/);
  assert.match(html, /1010 Wien/);
  assert.match(html, /AT0-KASSE1-42/);
  assert.match(html, /13\.08\.2026 00:30:00/);
  assert.match(html, /2 {2}x Espresso je\u00a02,50/);
  assert.match(html, /Gesamt:/);
  assert.match(html, /7,70 €/);
  assert.match(html, /A 20%/);
});

test('React: die QR-Zeile traegt den RKSV-Code als Datenfeld', () => {
  assert.ok(markup().includes(`data-qr="${QR_INHALT}"`), 'QR-Inhalt fehlt in der Ausgabe');
});

test('React: ein eigener QR-Zeichner ersetzt die Vorgabe', () => {
  const html = renderToStaticMarkup(
    <ReceiptLayoutView
      layout={buildReceiptLayout(BELEG, FIRMA)}
      renderQr={(daten) => <span className="eigener-qr">{daten.length}</span>}
    />,
  );
  assert.match(html, /<span class="eigener-qr">\d+<\/span>/);
  assert.ok(!html.includes('data-qr='), 'die Vorgabe darf nicht zusaetzlich erscheinen');
});

test('React: Ausrichtung und Betonung des Modells stehen in der Ausgabe', () => {
  const html = markup();
  // Der Firmenname ist zentriert und fett.
  assert.match(html, /text-align:center[^"]*font-weight:bold|font-weight:bold[^"]*text-align:center/);
});

test('React: das Euro-Zeichen bleibt auf dem Bildschirm ein Euro-Zeichen', () => {
  // Die ESC/POS-Ausgabe ersetzt es durch "EUR"; auf dem Schirm waere das falsch.
  const html = markup();
  assert.match(html, /7,70 €/);
  assert.ok(!html.includes('7,70 EUR'));
});

// ------------------------------------------------------- Peer-Abhaengigkeit

test('package.json: React ist Peer-Abhaengigkeit, keine Abhaengigkeit', () => {
  const paket = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(paket.dependencies?.['react'], undefined, 'react darf keine Abhaengigkeit sein');
  assert.ok(paket.peerDependencies?.['react'], 'react fehlt in peerDependencies');
  assert.ok(paket.devDependencies?.['react'], 'react fehlt in devDependencies (Tests brauchen es)');
});

test('package.json: die neuen Unterpfade ./receipt und ./react sind deklariert', () => {
  const paket = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    exports: Record<string, Record<string, Record<string, string>>>;
  };
  // Die types-Angabe steht in JEDEM Zweig, nicht daneben: eine gemeinsame gilt
  // fuer beide Aufloesungen, und ein CommonJS-Verbraucher mit module: Node16
  // bekaeme dann an jedem Import TS1479 (siehe scripts/check-build-exports.mjs).
  assert.deepEqual(paket.exports['./receipt'], {
    import: { types: './dist/esm/receipt/index.d.ts', default: './dist/esm/receipt/index.js' },
    require: { types: './dist/cjs/receipt/index.d.ts', default: './dist/cjs/receipt/index.js' },
  });
  assert.deepEqual(paket.exports['./react'], {
    import: { types: './dist/esm/react/index.d.ts', default: './dist/esm/react/index.js' },
    require: { types: './dist/cjs/react/index.d.ts', default: './dist/cjs/react/index.js' },
  });
});

/**
 * Legt eine Kopie des uebersetzten Pakets in einem eigenen Verzeichnis an, in
 * dem `react` durch eine Attrappe ersetzt ist, die beim Laden wirft. Damit
 * laesst sich pruefen, ob ein Einstiegspunkt React anfasst — und nicht nur, ob
 * er es zufaellig nicht braucht.
 */
function paketMitReactFalle(): string {
  const wurzel = mkdtempSync(join(tmpdir(), 'keck-react-'));
  cpSync(fileURLToPath(new URL('../src/', import.meta.url)), join(wurzel, 'src'), { recursive: true });
  // Ohne diese Datei laege der Modultyp bei CommonJS und schon der Import der
  // uebersetzten ESM-Dateien schluege fehl — der Test wuerde dann aus dem
  // falschen Grund rot.
  writeFileSync(join(wurzel, 'package.json'), JSON.stringify({ type: 'module' }));

  const reactVerzeichnis = join(wurzel, 'node_modules', 'react');
  mkdirSync(reactVerzeichnis, { recursive: true });
  writeFileSync(
    join(reactVerzeichnis, 'package.json'),
    JSON.stringify({
      name: 'react',
      version: '0.0.0',
      type: 'module',
      main: './index.js',
      exports: { '.': './index.js', './jsx-runtime': './jsx-runtime.js' },
    }),
  );
  // Die Attrappe muss dieselben Namen ausfuehren wie das Original: ein
  // fehlender Export scheiterte schon beim Verknuepfen — also bevor der
  // Rumpf laeuft — und der Test pruefte dann die falsche Ursache.
  const falle = [
    'export const Fragment = Symbol("Fragment");',
    'export const jsx = () => {};',
    'export const jsxs = () => {};',
    'export const jsxDEV = () => {};',
    'export const createElement = () => {};',
    'export const useState = () => {};',
    'export default {};',
    "throw new Error('REACT-WURDE-GELADEN');",
    '',
  ].join('\n');
  writeFileSync(join(reactVerzeichnis, 'index.js'), falle);
  writeFileSync(join(reactVerzeichnis, 'jsx-runtime.js'), falle);
  return wurzel;
}

function ladeInKindprozess(datei: string): { status: number | null; stderr: string } {
  const ergebnis = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(datei).href)});`],
    { encoding: 'utf8' },
  );
  return { status: ergebnis.status, stderr: ergebnis.stderr ?? '' };
}

test('Kern: ein Import des Pakets laedt React nicht', () => {
  const wurzel = paketMitReactFalle();
  try {
    // Gegenprobe zuerst: der Adapter MUSS in die Falle laufen. Ohne sie wuesste
    // niemand, ob die Attrappe ueberhaupt erreichbar ist — ein Test, der nur
    // "kein Fehler" prueft, waere sonst wertlos.
    const adapter = ladeInKindprozess(join(wurzel, 'src', 'react', 'index.js'));
    assert.notEqual(adapter.status, 0, 'die React-Attrappe wurde vom Adapter gar nicht erreicht');
    assert.match(adapter.stderr, /REACT-WURDE-GELADEN/);

    for (const einstieg of ['index.js', join('receipt', 'index.js'), join('printing', 'index.js')]) {
      const kern = ladeInKindprozess(join(wurzel, 'src', einstieg));
      assert.equal(kern.status, 0, `${einstieg} hat React geladen:\n${kern.stderr}`);
    }
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test('qrVerdeckt: der QR ist zunaechst weichgezeichnet hinter einem Knopf, die Nutzlast bleibt als data-qr', () => {
  const layout = buildReceiptLayout(BELEG, FIRMA, { paperSize: 'mm80' });
  const html = renderToStaticMarkup(<ReceiptLayoutView layout={layout} qrVerdeckt renderQr={(d) => <i data-qr-bild={d} />} />);
  assert.match(html, /keck-receipt-qr-toggle/);
  assert.match(html, /aria-pressed="false"/);
  // blur(3px): unscannbar, aber als QR erkennbar; der Hinweis ist ein
  // Tipp-Finger, der Text bleibt als aria-label fuer Hilfsmittel.
  assert.match(html, /blur\(3px\)/);
  assert.match(html, /aria-label="Antippen zum Anzeigen"/);
  // Einfarbiges Strich-Icon statt Emoji — Emojis rendern je Plattform anders.
  assert.match(html, /keck-receipt-qr-toggle-finger/);
  assert.doesNotMatch(html, /👆/);
  assert.match(html, new RegExp(`data-qr="${QR_INHALT.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}"`));
  // Rot-Probe: ohne qrVerdeckt kein Knopf, kein Weichzeichner
  const offen = renderToStaticMarkup(<ReceiptLayoutView layout={layout} renderQr={(d) => <i data-qr-bild={d} />} />);
  assert.doesNotMatch(offen, /keck-receipt-qr-toggle|blur\(/);
});
