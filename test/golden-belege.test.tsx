import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';

import { CreditCardProvider } from '../src/enums/index.js';
import { fromReceiptPayload } from '../src/models/index.js';
import { buildReceiptLayout, escPosLayoutBytes, belegBlatt, logoMass, logoRasterMass, logoRaster, SMALL_BUSINESS_NOTICE, type BuildReceiptLayoutOptions, type LayoutLine, type ReceiptLayout } from '../src/receipt/index.js';
import { ReceiptLayoutView } from '../src/react/index.js';

/**
 * Golden-Belege: `fixtures/belege/*.json` sind die Eingaben, `fixtures/erwartet/
 * *.lines.json` die zugesagte Zeilenausgabe -- fuer keck (PDF/Beleg-Link), die
 * Browser-Kasse und das Flutter-Paket dieselben Dateien. Aendert sich das
 * Layout absichtlich, werden sie mit `npm run fixtures:erneuern` neu erzeugt
 * und der Diff im Review gelesen. Alles andere ist ein Fehler.
 */
// test-dist liegt eine Ebene tiefer (test-dist/test/...): die Fixtures liegen im Repo-Wurzelverzeichnis.
const wurzel = new URL('../../fixtures/', import.meta.url);
const namen = readdirSync(new URL('belege/', wurzel)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

interface Fixture { company: Parameters<typeof buildReceiptLayout>[1]; receipt: Record<string, unknown> & { customerDetails: string[]; legalMessage: string[] }; options?: BuildReceiptLayoutOptions }
const lade = (name: string): Fixture => JSON.parse(readFileSync(new URL(`belege/${name}.json`, wurzel), 'utf8')) as Fixture;
const erwartet = (name: string): ReceiptLayout => JSON.parse(readFileSync(new URL(`erwartet/${name}.lines.json`, wurzel), 'utf8')) as ReceiptLayout;
const layoutVon = (f: Fixture): ReceiptLayout =>
  buildReceiptLayout(fromReceiptPayload({ ...f.receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never), f.company, f.options ?? {});

test('Golden-Belege: alle Faelle aus der Spec liegen vor', () => {
  assert.deepEqual(namen, ['deposit', 'deposit-return', 'gutschein-auszahlung', 'gutschein-einzweck-einloesung', 'gutschein-einzweck-einloesung-befreit', 'gutschein-einzweck-leistung-verkauf', 'gutschein-fremd-einloesung', 'gutschein-fremd-verkauf', 'gutschein-leistung-einloesung', 'gutschein-mehrzweck-einloesung', 'gutschein-mehrzweck-verkauf', 'gutschein-storno-einzweck', 'karte-eigener', 'karte-gptom', 'karte-gptom-ios', 'karte-hobex-cloud', 'karte-hobex-hps', 'karte-mypos', 'karte-stripe', 'karte-stripe-eps', 'karte-sumup', 'langer-artikelname', 'nacherfassung-einzel-ausser-haus-ohne-zeit', 'nacherfassung-einzel-ausser-haus-zeit', 'nacherfassung-einzel-geraet-ohne-zeit', 'nacherfassung-einzel-geraet-zeit', 'nacherfassung-einzel-internet-ohne-zeit', 'nacherfassung-einzel-internet-zeit', 'nacherfassung-einzel-sonstiges-ohne-zeit', 'nacherfassung-einzel-sonstiges-zeit', 'nacherfassung-einzel-stoerung-ohne-zeit', 'nacherfassung-einzel-stoerung-zeit', 'nacherfassung-einzel-strom-ohne-zeit', 'nacherfassung-einzel-strom-zeit', 'nacherfassung-kleinunternehmer', 'nacherfassung-sammel-geraet-anzahl', 'nacherfassung-sammel-geraet-ohne-anzahl', 'nacherfassung-sammel-internet-anzahl', 'nacherfassung-sammel-internet-ohne-anzahl', 'nacherfassung-sammel-sonstiges-anzahl', 'nacherfassung-sammel-sonstiges-ohne-anzahl', 'nacherfassung-sammel-stoerung-anzahl', 'nacherfassung-sammel-stoerung-ohne-anzahl', 'nacherfassung-sammel-strom-anzahl', 'nacherfassung-sammel-strom-ohne-anzahl', 'null-ausfall', 'null-ausfall-zeitraum', 'null-jahr', 'null-monat', 'null-pruef', 'null-schluss', 'null-start', 'rabatt-chef-trinkgeld', 'rabatt-einfach', 'rabatt-trinkgeld', 'rabatt-wertgutschein', 'rabattzeilen', 'rechnungszahlung-ausfall', 'rechnungszahlung-kleinunternehmer', 'rechnungszahlung-nacherfassung', 'rechnungszahlung-normal', 'rechnungszahlung-reverse-charge', 'rechnungszahlung-rueckzahlung', 'rechnungszahlung-steuerfrei', 'rechnungszahlung-storno', 'rechnungszahlung-teilzahlung', 'rechnungszahlung-training', 'signaturausfall-verkauf', 'split-bar-rueckgeld', 'split-eine-karte-trinkgeld', 'split-karte-karte-bar', 'split-langer-betrag', 'split-tischrunde-trinkgeld', 'split-trinkgeld-karte', 'split-zwei-karten-gleicher-anbieter', 'storno-rabatt', 'storno-split-teil', 'storno-split-voll', 'storno-teil', 'storno-voll', 'testkasse-verkauf', 'testsignatur-verkauf', 'training', 'verkauf-bar', 'verkauf-karte', 'verkauf-kleinunternehmer', 'zusaetze']);
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
 * dann eben einen, der die Abwesenheit festhaelt (`karte-eigener`).
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
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', wurzel), 'utf8')) as { regelwerk: number; belege: Record<string, Record<string, string>>; logoProbe: { raster32: string; hoch32: string } };
  assert.equal(manifest.regelwerk, 2);
  const hash = (pfad: string): string => createHash('sha256').update(readFileSync(new URL(pfad, wurzel))).digest('hex');
  for (const name of namen) {
    assert.deepEqual(manifest.belege[name], {
      eingabe: hash(`belege/${name}.json`),
      erwartet: hash(`erwartet/${name}.lines.json`),
      grid32: hash(`erwartet/${name}.grid32.txt`),
      grid48: hash(`erwartet/${name}.grid48.txt`),
      blatt32: hash(`erwartet/${name}.blatt32.json`),
      blatt48: hash(`erwartet/${name}.blatt48.json`),
    }, `Manifest fuer ${name} veraltet -- npm run fixtures:erneuern`);
  }
  assert.equal(manifest.logoProbe.raster32, hash('erwartet/logo-probe.raster32.txt'));
  assert.equal(manifest.logoProbe.hoch32, hash('erwartet/logo-probe-hoch.raster32.txt'));
});

const PROBE_LOGO = { stufe: 'M', pxBreite: 300, pxHoehe: 120 } as const;

for (const name of namen) {
  test(`Golden-Blatt ${name}: Blatt mit Probe-Logo und Marke ist die zugesagte Folge (32 und 48 Zeichen)`, () => {
    for (const zeichen of [32, 48] as const) {
      const soll = JSON.parse(readFileSync(new URL(`erwartet/${name}.blatt${zeichen}.json`, wurzel), 'utf8')) as unknown;
      assert.deepEqual(JSON.parse(JSON.stringify(belegBlatt(erwartet(name), { zeichen, logo: PROBE_LOGO, marke: true }))), soll);
    }
  });
}

/**
 * Dieselbe Formel steht im Dart-Zwilling (und in `scripts/belege-fixtures.mjs`).
 *
 * Farbe je Pixel: `g = floor(x * 255 / (b - 1))`, R = `g`, G = `(g * 3) % 256`,
 * B = `255 - g` -- ein waagrechter Verlauf, dessen Kanaele verschieden laufen.
 *
 * - Probe `logo-probe.raster32.txt`: 300x100, Stufe S, 32 Zeichen (breitenbegrenzt).
 *   Deckung je Zeile: `y < 10` -> 0; `10 <= y < 30` -> `floor((y - 10) * 255 / 19)`;
 *   `y >= 30` -> 255. Belegt Durchsichtiges UND Teiltransparenz.
 * - Probe `logo-probe-hoch.raster32.txt`: 100x400, Stufe S, 32 Zeichen, ueberall
 *   deckend (255) -- der hoehenbegrenzte Zweig von `logoMass`.
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
  const bild = logoRaster(verlauf(b, h, deckung), b, h, logoMass({ stufe: 'S', pxBreite: b, pxHoehe: h }, 32), 32);
  const zeilen: string[] = [];
  for (let y = 0; y < bild.hoehe; y++) zeilen.push(Array.from(bild.punkte.slice(y * bild.breite, (y + 1) * bild.breite)).join(''));
  return zeilen.join('\n') + '\n';
}

test('Golden: Logo-Probe (300x100, Stufe S, 32 Zeichen, Teiltransparenz) rastert Punkt fuer Punkt wie zugesagt', () => {
  const text = rasterText(300, 100, (y) => (y < 10 ? 0 : y < 30 ? Math.floor(((y - 10) * 255) / 19) : 255));
  assert.equal(text, readFileSync(new URL('erwartet/logo-probe.raster32.txt', wurzel), 'utf8'));
});

test('Golden: Logo-Probe hoch (100x400, Stufe S, 32 Zeichen, hoehenbegrenzt) rastert Punkt fuer Punkt wie zugesagt', () => {
  const mass = logoMass({ stufe: 'S', pxBreite: 100, pxHoehe: 400 }, 32);
  // Hoehenbegrenzt: 5 Zeilen = 120 Punkte fuer 400 Pixel, also Faktor 0,3 -> 30x120.
  assert.deepEqual(logoRasterMass(mass, 32), { breite: 30, hoehe: 120 });
  const text = rasterText(100, 400, () => 255);
  assert.equal(text, readFileSync(new URL('erwartet/logo-probe-hoch.raster32.txt', wurzel), 'utf8'));
});

test('Golden-Belege: ESC/POS und React sind deterministisch und tragen den Belegart-Aufdruck', () => {
  for (const name of ['storno-voll', 'training', 'null-monat', 'testkasse-verkauf']) {
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
  const l = layoutVon(lade('storno-voll'));
  const ohne: ReceiptLayout = { ...l, lines: l.lines.filter((z) => z.kind !== 'banner') };
  assert.notDeepEqual(ohne, erwartet('storno-voll'));
});

// --- Zahlung auf Rechnung (Positionsart `invoice_payment`, 0.40.0) -----------------------------------------------

/**
 * Der Zahlungsbeleg zaehlt im RKSV-Feld „Null“, ist aber kein steuerfreier Umsatz: die Umsatzsteuer
 * steht auf der Rechnung. Darum steht an seinen Positionen nie „0 %“ und kein Satzkennzeichen, und er
 * kommt nicht in die Steuertabelle. „inkl. USt“ steht genau dann, wenn die Rechnung Umsatzsteuer ausweist.
 */
const RZ = namen.filter((n) => n.startsWith('rechnungszahlung-'));
const texteVon = (zeilen: LayoutLine[]): string[] => zeilen.flatMap((z) => {
  if (z.kind === 'text' || z.kind === 'banner') return [z.text];
  if (z.kind === 'columns') return z.columns.map((c) => c.text);
  return [];
});
interface Bezug { nummer: string; steuerhinweis?: string }
const bezuege = (name: string): Bezug[] => (lade(name).receipt.rechnungszahlung as Bezug[] | undefined) ?? [];

test('Zahlung auf Rechnung: die Faelle liegen als Golden vor', () => {
  assert.deepEqual(RZ, ['rechnungszahlung-ausfall', 'rechnungszahlung-kleinunternehmer', 'rechnungszahlung-nacherfassung', 'rechnungszahlung-normal',
    'rechnungszahlung-reverse-charge', 'rechnungszahlung-rueckzahlung', 'rechnungszahlung-steuerfrei', 'rechnungszahlung-storno', 'rechnungszahlung-teilzahlung', 'rechnungszahlung-training']);
  for (const name of RZ) {
    const items = lade(name).receipt.items as Array<{ kind?: string }>;
    assert.ok(items.length > 0 && items.every((it) => it.kind === 'invoice_payment'), name);
    assert.ok(bezuege(name).length > 0, `${name}: ohne rechnungszahlung`);
  }
});

test('Zahlung auf Rechnung: „0 %“ nur bei null_prozent, kein Satzkennzeichen an der Position und keine Steuertabelle', () => {
  for (const name of RZ) {
    const l = erwartet(name);
    const texte = texteVon(l.lines);
    const nullProzent = bezuege(name).some((b) => b.steuerhinweis === 'null_prozent');
    assert.equal(texte.some((t) => /0 ?%/.test(t)), nullProzent, `${name}: „0 %“ am Bon`);
    assert.ok(!texte.some((t) => /MwSt/.test(t)), `${name}: Steuertabelle am Bon`);
    for (const it of lade(name).receipt.items as Array<{ name: string }>) {
      const zeile = l.lines.find((z): z is Extract<LayoutLine, { kind: 'columns' }> => z.kind === 'columns' && z.columns[0]!.text === it.name);
      assert.ok(zeile, `${name}: Zeile „${it.name}“ fehlt`);
      // Betrag ohne Kategorie-Buchstaben; die zwei Fuellzeichen halten die Betragsspalte buendig.
      assert.match(zeile.columns[1]!.text, /^-?\d+,\d{2} {2}$/, `${name}: ${zeile.columns[1]!.text}`);
    }
  }
});

test('Zahlung auf Rechnung: der Steuerhinweis folgt dem Wert (inkl_ust, null_prozent, siehe_rechnung)', () => {
  const text = { inkl_ust: 'inkl. USt', null_prozent: '0 % USt', siehe_rechnung: 'Steuerangaben siehe Rechnung' } as const;
  const gesehen = new Set<string>();
  for (const name of RZ) {
    const texte = texteVon(erwartet(name).lines).map((t) => t.trim());
    for (const [wert, wort] of Object.entries(text)) {
      const soll = bezuege(name).filter((b) => b.steuerhinweis === wert).length;
      assert.equal(texte.filter((t) => t === wort).length, soll, `${name}: ${wort}`);
      if (soll > 0) gesehen.add(wert);
    }
  }
  assert.deepEqual([...gesehen].sort(), ['inkl_ust', 'null_prozent', 'siehe_rechnung']);
});

test('Zahlung auf Rechnung beim Kleinunternehmer: „0 % USt“, nie „inkl. USt“ und kein Kleinunternehmer-Hinweis', () => {
  const texte = texteVon(erwartet('rechnungszahlung-kleinunternehmer').lines);
  assert.ok((lade('rechnungszahlung-kleinunternehmer').company as { isSmallBusiness: boolean }).isSmallBusiness);
  assert.ok(!texte.includes(SMALL_BUSINESS_NOTICE));
  assert.ok(!texte.some((t) => t.trim() === 'inkl. USt'), texte.join(' | '));
  assert.equal(texte.filter((t) => t.trim() === '0 % USt').length, 1);
});

test('Zahlung auf Rechnung: mehrere Rechnungen, „inkl. USt“ steht unter der Position, deren Rechnung USt ausweist', () => {
  const f = lade('rechnungszahlung-normal');
  const items = [
    { name: 'Zahlung auf Rechnung 2026-0042', quantity: 1, unitPriceCents: 156960, vatRate: 0, kind: 'invoice_payment' },
    { name: 'Zahlung auf Rechnung 2026-0050', quantity: 1, unitPriceCents: 8500, vatRate: 0, kind: 'invoice_payment' },
  ];
  const rechnungszahlung = [
    { ...bezuege('rechnungszahlung-normal')[0]!, steuerhinweis: 'null_prozent' },
    { invoiceId: 'inv_4Ab1', nummer: '2026-0050', paymentId: 'pay_8', kundeId: null, betragCents: 8500, teil: false, zahlungVom: '2026-11-11', steuerhinweis: 'inkl_ust' },
  ];
  const l = layoutVon({ ...f, receipt: { ...f.receipt, items, rechnungszahlung, payments: [{ id: 'p1', method: 'cash', amountCents: 165460 }] } });
  const texte = texteVon(l.lines);
  const erste = texte.indexOf('Zahlung auf Rechnung 2026-0042');
  const zweite = texte.indexOf('Zahlung auf Rechnung 2026-0050');
  assert.ok(erste >= 0 && zweite > erste);
  assert.equal(texte.filter((t) => t.trim() === 'inkl. USt').length, 1);
  assert.equal(texte[erste + 2]?.trim(), '0 % USt', texte.slice(erste).join(' | '));
  assert.equal(texte[zweite + 2]?.trim(), 'inkl. USt', texte.slice(zweite).join(' | '));
  // Ohne Bezug (fremder Beleg, Altbestand) oder mit unbekanntem Wert kein Hinweis: der Beleg behauptet keine Steuer, die er nicht kennt.
  const ohneBezug = layoutVon({ ...f, receipt: { ...f.receipt, rechnungszahlung: undefined } });
  const unbekannt = layoutVon({ ...f, receipt: { ...f.receipt, rechnungszahlung: [{ ...bezuege('rechnungszahlung-normal')[0]!, steuerhinweis: 'sonstiges' }] } });
  const hinweis = (t: string): boolean => /USt|Steuerangaben/.test(t);
  assert.ok(!texteVon(ohneBezug.lines).some(hinweis));
  assert.ok(!texteVon(unbekannt.lines).some(hinweis));
});

test('Rot-Probe: dieselbe Zeile ohne Positionsart steht als „D 0%“ in der Steuertabelle, die Pruefung oben schluege an', () => {
  const f = lade('rechnungszahlung-normal');
  const items = (f.receipt.items as Array<Record<string, unknown>>).map(({ kind: _kind, ...rest }) => rest);
  const texte = texteVon(layoutVon({ ...f, receipt: { ...f.receipt, items } }).lines);
  assert.ok(texte.some((t) => /0%/.test(t)), texte.join(' | '));
});
