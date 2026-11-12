import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';

import { CreditCardProvider } from '../src/enums/index.js';
import { fromReceiptPayload } from '../src/models/index.js';
import { buildReceiptLayout, escPosLayoutBytes, receiptSheet, logoDimensions, logoRasterSize, rasterizeLogo, SMALL_BUSINESS_NOTICE, type BuildReceiptLayoutOptions, type LayoutLine, type ReceiptLayout } from '../src/receipt/index.js';
import { ReceiptLayoutView } from '../src/react/index.js';

/**
 * Golden-Belege: `fixtures/receipts/*.json` sind die Eingaben, `fixtures/expected/
 * *.lines.json` die zugesagte Zeilenausgabe -- fuer keck (PDF/Beleg-Link), die
 * Browser-Kasse und das Flutter-Paket dieselben Dateien. Aendert sich das
 * Layout absichtlich, werden sie mit `npm run fixtures:erneuern` neu erzeugt
 * und der Diff im Review gelesen. Alles andere ist ein Fehler.
 */
// test-dist liegt eine Ebene tiefer (test-dist/test/...): die Fixtures liegen im Repo-Wurzelverzeichnis.
const wurzel = new URL('../../fixtures/', import.meta.url);
const namen = readdirSync(new URL('receipts/', wurzel)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

interface Fixture { company: Parameters<typeof buildReceiptLayout>[1]; receipt: Record<string, unknown> & { customerDetails: string[]; legalMessage: string[] }; options?: BuildReceiptLayoutOptions }
const lade = (name: string): Fixture => JSON.parse(readFileSync(new URL(`receipts/${name}.json`, wurzel), 'utf8')) as Fixture;
const erwartet = (name: string): ReceiptLayout => JSON.parse(readFileSync(new URL(`expected/${name}.lines.json`, wurzel), 'utf8')) as ReceiptLayout;
const layoutVon = (f: Fixture): ReceiptLayout =>
  buildReceiptLayout(fromReceiptPayload({ ...f.receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never), f.company, f.options ?? {});

test('Golden-Belege: alle Faelle aus der Spec liegen vor', () => {
  assert.deepEqual(namen, ['add-ons', 'cancellation-discount', 'cancellation-full', 'cancellation-partial', 'cancellation-split-full', 'cancellation-split-partial', 'card-custom', 'card-gptom', 'card-gptom-ios', 'card-hobex-cloud', 'card-hobex-hps', 'card-mypos', 'card-stripe', 'card-stripe-eps', 'card-sumup', 'deposit', 'deposit-return', 'discount-lines', 'discount-owner-tip', 'discount-simple', 'discount-tip', 'discount-value-voucher', 'invoice-payment-cancellation', 'invoice-payment-manual-receipt', 'invoice-payment-normal', 'invoice-payment-outage', 'invoice-payment-partial', 'invoice-payment-refund', 'invoice-payment-see-invoice', 'invoice-payment-training', 'invoice-payment-without-vat', 'invoice-payment-zero-percent', 'long-item-name', 'manual-receipt-range-device-failure-count', 'manual-receipt-range-device-failure-no-count', 'manual-receipt-range-network-outage-count', 'manual-receipt-range-network-outage-no-count', 'manual-receipt-range-other-count', 'manual-receipt-range-other-no-count', 'manual-receipt-range-power-outage-count', 'manual-receipt-range-power-outage-no-count', 'manual-receipt-range-system-outage-count', 'manual-receipt-range-system-outage-no-count', 'manual-receipt-single-device-failure-no-time', 'manual-receipt-single-device-failure-time', 'manual-receipt-single-network-outage-no-time', 'manual-receipt-single-network-outage-time', 'manual-receipt-single-other-no-time', 'manual-receipt-single-other-time', 'manual-receipt-single-outside-premises-no-time', 'manual-receipt-single-outside-premises-time', 'manual-receipt-single-power-outage-no-time', 'manual-receipt-single-power-outage-time', 'manual-receipt-single-small-business', 'manual-receipt-single-system-outage-no-time', 'manual-receipt-single-system-outage-time', 'sale-card', 'sale-cash', 'sale-small-business', 'signature-outage-sale', 'split-card-card-cash', 'split-cash-change', 'split-long-amount', 'split-one-card-tip', 'split-table-round-tip', 'split-tip-card', 'split-two-cards-same-provider', 'test-cashregister-sale', 'test-signature-sale', 'training', 'voucher-cancellation', 'voucher-external-redeem', 'voucher-external-sale', 'voucher-multi-purpose-redeem', 'voucher-multi-purpose-sale', 'voucher-payout', 'voucher-return', 'voucher-return-tip', 'voucher-service-redeem', 'voucher-single-purpose-redeem', 'voucher-single-purpose-redeem-exempt', 'voucher-single-purpose-sale', 'zero-annual', 'zero-final', 'zero-manual', 'zero-monthly', 'zero-outage-end', 'zero-outage-end-period', 'zero-start']);
});

/**
 * JEDER Kartenanbieter hat einen Golden-Beleg.
 *
 * Das ist die Pruefung, die es nie gab -- und deren Fehlen vier
 * Kartenzahlungsbloecke aus dem Belegdokument verschwinden liess, ohne dass
 * irgendetwas rot wurde: keiner der 22 Goldenen trug ueberhaupt eine
 * Kartenzahlung. Der Bon aus der App zeigte Marke, Ziffern und Referenz, das
 * PDF desselben Belegs nur "Kartenzahlung".
 *
 * Die Liste kommt aus dem Enum, nicht aus einer Handliste: wer einen Anbieter
 * aufnimmt, wird hier rot, bis er einen Golden-Beleg dazulegt. Und ein
 * Anbieter, der bewusst keinen Block bekommt, braucht trotzdem einen Golden --
 * dann eben einen, der die Abwesenheit festhaelt (`card-custom`).
 */
test('Kartenanbieter: jeder Wert des Enums hat einen Golden-Beleg', () => {
  const belegt = new Set<string>();
  for (const name of namen) {
    const p = lade(name).receipt.creditCardProvider;
    if (typeof p === 'string') belegt.add(p);
  }
  const fehlend = Object.values(CreditCardProvider).filter((p) => !belegt.has(p));
  assert.deepEqual(fehlend, [], `ohne Golden-Beleg: ${fehlend.join(', ')}`);
});

/**
 * Und der Block ist auch wirklich DA. Ein Golden-Beleg allein beweist nur,
 * dass die Datei existiert; diese Pruefung liest die Zeilen und verlangt fuer
 * jeden Anbieter mit Terminaldaten eine fette Ueberschrift, die ihn nennt.
 */
test('Kartenanbieter: wer Terminaldaten mitbringt, bekommt einen Block', () => {
  const ohneBlock: string[] = [];
  for (const name of namen) {
    const f = lade(name);
    if (f.receipt.cardPaymentData == null) continue;
    const ueberschrift = erwartet(name).lines.some(
      (z) => z.kind === 'text' && z.bold && z.align === 'center' && /Beleg$|Stripe/.test(z.text),
    );
    if (!ueberschrift) ohneBlock.push(name);
  }
  assert.deepEqual(ohneBlock, []);
});

/**
 * Mit Zahlungsliste: JEDE Zahlung mit Terminaldaten bekommt ihren eigenen
 * Block -- zwei Karten desselben Anbieters ergeben zwei Ueberschriften, keine
 * wird verschluckt. Gezaehlt wird gegen die Zahl der Zahlungen, nicht gegen
 * die Zahl der Anbieter.
 */
test('Kartenanbieter: mit Zahlungsliste hat jede Zahlung mit Terminaldaten einen eigenen Block', () => {
  let geprueft = 0;
  for (const name of namen) {
    const zahlungen = lade(name).receipt.payments as { provider?: string; providerData?: unknown }[] | undefined;
    if (zahlungen == null) continue;
    const mitDaten = zahlungen.filter((z) => z.provider != null && z.provider !== 'custom' && z.providerData != null).length;
    const bloecke = erwartet(name).lines.filter(
      (z) => z.kind === 'text' && z.bold && z.align === 'center' && /Beleg$|Stripe/.test(z.text),
    ).length;
    assert.equal(bloecke, mitDaten, `${name}: ${bloecke} Kartenbloecke fuer ${mitDaten} Zahlungen mit Terminaldaten`);
    geprueft += 1;
  }
  assert.ok(geprueft >= 9, `nur ${geprueft} Belege mit Zahlungsliste geprueft`);
});

for (const name of namen) {
  test(`Golden-Beleg ${name}: Layout ist Zeile fuer Zeile die zugesagte Ausgabe`, () => {
    assert.deepEqual(layoutVon(lade(name)), erwartet(name));
  });
}

test('Golden-Belege: Manifest traegt die Pruefsummen von Eingabe, Erwartung, Raster und Blatt (Drift in fremden Repos erkennbar)', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', wurzel), 'utf8')) as { ruleset: number; receipts: Record<string, Record<string, string>>; logoSample: { raster32: string; tall32: string } };
  assert.equal(manifest.ruleset, 2);
  const hash = (pfad: string): string => createHash('sha256').update(readFileSync(new URL(pfad, wurzel))).digest('hex');
  for (const name of namen) {
    assert.deepEqual(manifest.receipts[name], {
      input: hash(`receipts/${name}.json`),
      expected: hash(`expected/${name}.lines.json`),
      grid32: hash(`expected/${name}.grid32.txt`),
      grid48: hash(`expected/${name}.grid48.txt`),
      sheet32: hash(`expected/${name}.sheet32.json`),
      sheet48: hash(`expected/${name}.sheet48.json`),
    }, `Manifest fuer ${name} veraltet -- npm run fixtures:erneuern`);
  }
  assert.equal(manifest.logoSample.raster32, hash('expected/logo-sample.raster32.txt'));
  assert.equal(manifest.logoSample.tall32, hash('expected/logo-sample-tall.raster32.txt'));
});

const PROBE_LOGO = { size: 'M', pixelWidth: 300, pixelHeight: 120 } as const;

for (const name of namen) {
  test(`Golden-Blatt ${name}: Blatt mit Probe-Logo und Marke ist die zugesagte Folge (32 und 48 Zeichen)`, () => {
    for (const zeichen of [32, 48] as const) {
      const soll = JSON.parse(readFileSync(new URL(`expected/${name}.sheet${zeichen}.json`, wurzel), 'utf8')) as unknown;
      assert.deepEqual(JSON.parse(JSON.stringify(receiptSheet(erwartet(name), { charsPerLine: zeichen, logo: PROBE_LOGO, brandMark: true }))), soll);
    }
  });
}

/**
 * Dieselbe Formel steht im Dart-Zwilling (und in `scripts/belege-fixtures.mjs`).
 *
 * Farbe je Pixel: `g = floor(x * 255 / (b - 1))`, R = `g`, G = `(g * 3) % 256`,
 * B = `255 - g` -- ein waagrechter Verlauf, dessen Kanaele verschieden laufen.
 *
 * - Probe `logo-sample.raster32.txt`: 300x100, Stufe S, 32 Zeichen (breitenbegrenzt).
 *   Deckung je Zeile: `y < 10` -> 0; `10 <= y < 30` -> `floor((y - 10) * 255 / 19)`;
 *   `y >= 30` -> 255. Belegt Durchsichtiges UND Teiltransparenz.
 * - Probe `logo-sample-tall.raster32.txt`: 100x400, Stufe S, 32 Zeichen, ueberall
 *   deckend (255) -- der hoehenbegrenzte Zweig von `logoDimensions`.
 */
function verlauf(b: number, h: number, deckung: (y: number) => number): Uint8Array {
  const rgba = new Uint8Array(b * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
    const i = (y * b + x) * 4; const g = Math.floor((x * 255) / (b - 1));
    rgba[i] = g; rgba[i + 1] = (g * 3) % 256; rgba[i + 2] = 255 - g; rgba[i + 3] = deckung(y);
  }
  return rgba;
}

function rasterText(b: number, h: number, deckung: (y: number) => number): string {
  const bild = rasterizeLogo(verlauf(b, h, deckung), b, h, logoDimensions({ size: 'S', pixelWidth: b, pixelHeight: h }, 32), 32);
  const zeilen: string[] = [];
  for (let y = 0; y < bild.height; y++) zeilen.push(Array.from(bild.dots.slice(y * bild.width, (y + 1) * bild.width)).join(''));
  return zeilen.join('\n') + '\n';
}

test('Golden: Logo-Probe (300x100, Stufe S, 32 Zeichen, Teiltransparenz) rastert Punkt fuer Punkt wie zugesagt', () => {
  const text = rasterText(300, 100, (y) => (y < 10 ? 0 : y < 30 ? Math.floor(((y - 10) * 255) / 19) : 255));
  assert.equal(text, readFileSync(new URL('expected/logo-sample.raster32.txt', wurzel), 'utf8'));
});

test('Golden: Logo-Probe hoch (100x400, Stufe S, 32 Zeichen, hoehenbegrenzt) rastert Punkt fuer Punkt wie zugesagt', () => {
  const mass = logoDimensions({ size: 'S', pixelWidth: 100, pixelHeight: 400 }, 32);
  // Hoehenbegrenzt: 5 Zeilen = 120 Punkte fuer 400 Pixel, also Faktor 0,3 -> 30x120.
  assert.deepEqual(logoRasterSize(mass, 32), { width: 30, height: 120 });
  const text = rasterText(100, 400, () => 255);
  assert.equal(text, readFileSync(new URL('expected/logo-sample-tall.raster32.txt', wurzel), 'utf8'));
});

test('Golden-Belege: ESC/POS und React sind deterministisch und tragen den Belegart-Aufdruck', () => {
  for (const name of ['cancellation-full', 'training', 'zero-monthly', 'test-cashregister-sale']) {
    const layout = erwartet(name);
    const a = escPosLayoutBytes(layout), b = escPosLayoutBytes(layout);
    assert.deepEqual(a, b);
    const html = renderToStaticMarkup(<ReceiptLayoutView layout={layout} />);
    const bannerTexte = layout.lines.filter((z) => z.kind === 'banner').map((z) => (z as { text: string }).text);
    for (const t of bannerTexte) {
      assert.ok(html.includes(t.replace('—', '—')), `${name}: React zeigt „${t}“ nicht`);
      // im Bytestrom steht der Text (Gedankenstrich ersetzt) mit doppelter Hoehe
      const bytes = Buffer.from(a).toString('latin1');
      assert.ok(bytes.includes(t.split(' — ')[0]!), `${name}: ESC/POS druckt „${t}“ nicht`);
    }
  }
});

test('Rot-Probe: ein Stornobeleg OHNE Aufdruck ist kein gueltiges Golden -- der Vergleich schlaegt an', () => {
  const l = layoutVon(lade('cancellation-full'));
  const ohne: ReceiptLayout = { ...l, lines: l.lines.filter((z) => z.kind !== 'banner') };
  assert.notDeepEqual(ohne, erwartet('cancellation-full'));
});

// --- Zahlung auf Rechnung (Positionsart `invoice_payment`, Spec 2026-11-11 Abschnitt 6 und 7.1) ----------------

/**
 * Der Zahlungsbeleg zaehlt im RKSV-Feld „Null“, ist aber kein steuerfreier Umsatz: die Umsatzsteuer
 * steht auf der Rechnung. Darum steht an seinen Positionen nie „0 %“ und kein Satzkennzeichen, und er
 * kommt nicht in die Steuertabelle. „inkl. USt“ steht genau dann, wenn die Rechnung Umsatzsteuer ausweist.
 */
const RZ = namen.filter((n) => n.startsWith('invoice-payment-'));
const texteVon = (zeilen: LayoutLine[]): string[] => zeilen.flatMap((z) => {
  if (z.kind === 'text' || z.kind === 'banner') return [z.text];
  if (z.kind === 'columns') return z.columns.map((c) => c.text);
  return [];
});
interface Bezug { invoiceNumber: string; taxNote?: string }
const bezuege = (name: string): Bezug[] => (lade(name).receipt.invoicePayments as Bezug[] | undefined) ?? [];

test('Zahlung auf Rechnung: die Faelle aus der Spec liegen als Golden vor', () => {
  assert.deepEqual(RZ, ['invoice-payment-cancellation', 'invoice-payment-manual-receipt', 'invoice-payment-normal', 'invoice-payment-outage',
    'invoice-payment-partial', 'invoice-payment-refund', 'invoice-payment-see-invoice', 'invoice-payment-training', 'invoice-payment-without-vat', 'invoice-payment-zero-percent']);
  for (const name of RZ) {
    const items = lade(name).receipt.items as Array<{ kind?: string }>;
    assert.ok(items.length > 0 && items.every((it) => it.kind === 'invoice_payment'), name);
    assert.ok(bezuege(name).length > 0, `${name}: ohne invoicePayments`);
  }
});

test('Zahlung auf Rechnung: „0 %“ nur bei zero_percent, kein Satzkennzeichen an der Position und keine Steuertabelle', () => {
  for (const name of RZ) {
    const l = erwartet(name);
    const texte = texteVon(l.lines);
    const nullProzent = bezuege(name).filter((b) => b.taxNote === 'zero_percent').length;
    assert.equal(texte.filter((t) => /0 ?%/.test(t)).length, nullProzent, `${name}: „0 %“ am Bon`);
    assert.ok(!texte.some((t) => /0 ?%/.test(t) && t.trim() !== '0 % USt'), `${name}: „0 %“ an falscher Stelle`);
    assert.ok(!texte.some((t) => /MwSt/.test(t)), `${name}: Steuertabelle am Bon`);
    for (const it of lade(name).receipt.items as Array<{ name: string }>) {
      const zeile = l.lines.find((z): z is Extract<LayoutLine, { kind: 'columns' }> => z.kind === 'columns' && z.columns[0]!.text === it.name);
      assert.ok(zeile, `${name}: Zeile „${it.name}“ fehlt`);
      // Betrag ohne Kategorie-Buchstaben; die zwei Fuellzeichen halten die Betragsspalte buendig.
      assert.match(zeile.columns[1]!.text, /^-?\d+,\d{2} {2}$/, `${name}: ${zeile.columns[1]!.text}`);
    }
  }
});

const HINWEIS_TEXT: Record<string, string> = { incl_vat: 'inkl. USt', zero_percent: '0 % USt', see_invoice: 'Steuerangaben siehe Rechnung' };

test('Zahlung auf Rechnung: der Steuerhinweis folgt dem Wert taxNote, deutsch am Bon (alle drei Werte kommen vor)', () => {
  const gesehen = new Set<string>();
  for (const name of RZ) {
    const texte = texteVon(erwartet(name).lines).map((t) => t.trim());
    for (const [wert, text] of Object.entries(HINWEIS_TEXT)) {
      const soll = bezuege(name).filter((b) => b.taxNote === wert).length;
      assert.equal(texte.filter((t) => t === text).length, soll, `${name}: ${text}`);
      if (soll > 0) gesehen.add(wert);
    }
  }
  assert.deepEqual([...gesehen].sort(), ['incl_vat', 'see_invoice', 'zero_percent']);
});

test('Zahlung auf Rechnung beim Kleinunternehmer: „0 % USt“, kein „inkl. USt“ und kein Kleinunternehmer-Hinweis', () => {
  const texte = texteVon(erwartet('invoice-payment-without-vat').lines);
  assert.ok(lade('invoice-payment-without-vat').company.isSmallBusiness);
  assert.ok(!texte.includes(SMALL_BUSINESS_NOTICE));
  assert.ok(!texte.some((t) => t.trim() === 'inkl. USt'), texte.join(' | '));
  assert.equal(texte.filter((t) => t.trim() === '0 % USt').length, 1);
});

test('Zahlung auf Rechnung: mehrere Rechnungen, jeder Steuerhinweis steht unter seiner Position', () => {
  const f = lade('invoice-payment-normal');
  const items = [
    { name: 'Zahlung auf Rechnung 2026-0042', quantity: 1, unitPriceCents: 156960, vatRate: 0, kind: 'invoice_payment' },
    { name: 'Zahlung auf Rechnung 2026-0050', quantity: 1, unitPriceCents: 8500, vatRate: 0, kind: 'invoice_payment' },
  ];
  const invoicePayments = [
    { ...bezuege('invoice-payment-normal')[0]!, taxNote: 'see_invoice' },
    { invoiceId: 'inv_4Ab1', invoiceNumber: '2026-0050', paymentId: 'pay_8', customerId: null, amountCents: 8500, partial: false, paidOn: '2026-11-11', taxNote: 'incl_vat' },
  ];
  const l = layoutVon({ ...f, receipt: { ...f.receipt, items, invoicePayments, payments: [{ id: 'p1', method: 'cash', amountCents: 165460 }] } });
  const texte = texteVon(l.lines);
  const erste = texte.indexOf('Zahlung auf Rechnung 2026-0042');
  const zweite = texte.indexOf('Zahlung auf Rechnung 2026-0050');
  assert.ok(erste >= 0 && zweite > erste);
  assert.equal(texte.filter((t) => t.trim() === 'inkl. USt').length, 1);
  assert.equal(texte[erste + 2]?.trim(), 'Steuerangaben siehe Rechnung', texte.slice(erste).join(' | '));
  assert.equal(texte[zweite + 2]?.trim(), 'inkl. USt', texte.slice(zweite).join(' | '));
  // Ohne Bezug (fremder Beleg, Altbestand) nie „inkl. USt“: der Beleg behauptet keine Steuer, die er nicht kennt.
  const ohneBezug = layoutVon({ ...f, receipt: { ...f.receipt, invoicePayments: undefined } });
  assert.ok(!texteVon(ohneBezug.lines).some((t) => Object.values(HINWEIS_TEXT).includes(t.trim())));
  // Unbekannter Wert vom Draht (neuere Server) ergibt keinen Hinweis; die Zeile selbst bleibt.
  const fremd = layoutVon({ ...f, receipt: { ...f.receipt, invoicePayments: [{ ...bezuege('invoice-payment-normal')[0]!, taxNote: 'irgendwas' }] } });
  assert.ok(!texteVon(fremd.lines).some((t) => Object.values(HINWEIS_TEXT).includes(t.trim())));
});

test('Rot-Probe: dieselbe Zeile ohne Positionsart steht als „D 0%“ in der Steuertabelle, die Pruefung oben schluege an', () => {
  const f = lade('invoice-payment-normal');
  const items = (f.receipt.items as Array<Record<string, unknown>>).map(({ kind: _kind, ...rest }) => rest);
  const texte = texteVon(layoutVon({ ...f, receipt: { ...f.receipt, items } }).lines);
  assert.ok(texte.some((t) => /0%/.test(t)), texte.join(' | '));
});
