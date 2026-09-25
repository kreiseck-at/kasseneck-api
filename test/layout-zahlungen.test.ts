import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromReceiptPayload, type ReceiptPaymentPayload } from '../src/models/index.js';
import { buildReceiptLayout, renderReceiptGrid, gridAlsText, type ReceiptLayout } from '../src/receipt/index.js';

/**
 * Aufschluesselung mehrerer Zahlungen im Beleg-Layout (`payments`). Die
 * Goldens in fixtures/belege/split-* und storno-split-* halten die Ausgabe
 * fest; hier stehen die Grenzfaelle, fuer die kein eigenes Golden lohnt.
 */

// test-dist liegt eine Ebene tiefer (test-dist/test/...): die Fixtures liegen im Repo-Wurzelverzeichnis.
const wurzel = new URL('../../fixtures/', import.meta.url);

interface Fixture { company: Parameters<typeof buildReceiptLayout>[1]; receipt: Record<string, unknown> & { customerDetails: string[]; legalMessage: string[] }; options?: Parameters<typeof buildReceiptLayout>[2] }
const lade = (name: string): Fixture => JSON.parse(readFileSync(new URL(`belege/${name}.json`, wurzel), 'utf8')) as Fixture;

function layoutMit(name: string, aenderung: Record<string, unknown>): ReceiptLayout {
  const f = lade(name);
  const receipt = { ...f.receipt, ...aenderung };
  for (const [k, v] of Object.entries(aenderung)) if (v === undefined) delete receipt[k];
  return buildReceiptLayout(
    fromReceiptPayload({ ...receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never),
    f.company,
    f.options ?? {},
  );
}

const raster = (layout: ReceiptLayout, zeichen: 32 | 48): string[] => gridAlsText(renderReceiptGrid(layout, { zeichen })).split('\n');
const ueberschriften = (layout: ReceiptLayout): string[] =>
  layout.lines.filter((z) => z.kind === 'text' && z.bold && z.align === 'center').map((z) => (z as { text: string }).text);

test('Leere Zahlungsliste: der alte Weg ueber paymentMethod und die Kartenfelder', () => {
  const ohne = layoutMit('karte-sumup', {});
  const leer = layoutMit('karte-sumup', { payments: [] });
  assert.deepEqual(leer, ohne);
});

test('Mit mehreren Zahlungen zaehlen die alten Kartenfelder nicht mehr', () => {
  const payments: ReceiptPaymentPayload[] = [{ id: 'p1', method: 'cash', amountCents: 6000 }, { id: 'p2', method: 'cash', amountCents: 6000 }];
  const l = layoutMit('karte-sumup', { paymentMethod: 'cash', payments });
  assert.deepEqual(ueberschriften(l).filter((t) => /Beleg$/.test(t)), []);
  assert.ok(raster(l, 32).includes('1. Barzahlung            60,00 €'));
});

test('Rueckgeld ohne changeCents: gegeben minus Betrag', () => {
  const payments: ReceiptPaymentPayload[] = [
    { id: 'p1', method: 'creditCard', amountCents: 2000, provider: 'custom' },
    { id: 'p2', method: 'boltCash', amountCents: 2545, tenderedCents: 3000 },
  ];
  const zeilen = raster(layoutMit('split-karte-karte-bar', { payments }), 32);
  const i = zeilen.indexOf('2. Bolt Cash             25,45 €');
  assert.ok(i > 0, zeilen.join('\n'));
  assert.equal(zeilen[i + 1], '  Gegeben:               30,00 €');
  assert.equal(zeilen[i + 2], '  Rückgeld:               4,55 €');
});

test('Ohne gegebenen Betrag keine Gegeben-/Rueckgeld-Zeilen; Karten bekommen sie nie', () => {
  const payments: ReceiptPaymentPayload[] = [
    { id: 'p1', method: 'creditCard', amountCents: 2000, provider: 'custom', tenderedCents: 5000 },
    { id: 'p2', method: 'cash', amountCents: 2545 },
  ];
  const zeilen = raster(layoutMit('split-karte-karte-bar', { payments }), 32);
  const text = zeilen.join('\n');
  assert.ok(!text.includes('Gegeben:'));
  assert.ok(!text.includes('Rückgeld:'));
  // Kein Anbieter mehr in der Liste, auch nicht bei custom; custom hat keinen Block.
  assert.ok(zeilen.includes('1. Kartenzahlung         20,00 €'), text);
  assert.ok(zeilen.includes('2. Barzahlung            25,45 €'), text);
  assert.ok(!text.includes('Sonstige'));
});

test('58 mm: Betraege bis 9999,99 (auch negativ) stehen ungebrochen in der Zeile ihrer Zahlung', () => {
  for (const cents of [999999, -999999]) {
    const payments: ReceiptPaymentPayload[] = [
      { id: 'p1', method: 'creditCard', amountCents: cents, provider: 'gpTomIos' },
      { id: 'p2', method: 'uberCard', amountCents: cents, provider: 'hobexCloudApi' },
    ];
    const zeilen = raster(layoutMit('split-langer-betrag', { payments }), 32);
    const betrag = cents > 0 ? '9999,99 €' : '-9999,99 €';
    assert.ok(zeilen.some((z) => z.startsWith('1. Kartenzahlung') && z.endsWith(betrag)), zeilen.join('\n'));
    assert.ok(zeilen.some((z) => z.startsWith('2. Uber Card') && z.endsWith(betrag)), zeilen.join('\n'));
  }
});

test('Trinkgeld je Zahlung: eingerueckt direkt unter der Zahlung, vor Gegeben/Rueckgeld', () => {
  const payments: ReceiptPaymentPayload[] = [
    { id: 'p1', method: 'creditCard', amountCents: 2000, tipCents: 150, provider: 'custom' },
    { id: 'p2', method: 'cash', amountCents: 2545, tipCents: 45, tenderedCents: 3000 },
  ];
  const zeilen = raster(layoutMit('split-karte-karte-bar', { payments }), 32);
  const i = zeilen.indexOf('1. Kartenzahlung         20,00 €');
  assert.deepEqual(zeilen.slice(i, i + 6), [
    '1. Kartenzahlung         20,00 €',
    '  davon Trinkgeld         1,50 €',
    '2. Barzahlung            25,45 €',
    '  davon Trinkgeld         0,45 €',
    '  Gegeben:               30,00 €',
    '  Rückgeld:               4,55 €',
  ]);
});

test('Trinkgeld bei genau einer Zahlung: unter „Zahlungsart:", ohne Nummern', () => {
  const payments: ReceiptPaymentPayload[] = [{ id: 'p1', method: 'cash', amountCents: 4545, tipCents: 200, tenderedCents: 5000 }];
  const zeilen = raster(layoutMit('split-karte-karte-bar', { paymentMethod: 'cash', payments }), 32);
  const i = zeilen.indexOf('Zahlungsart:          Barzahlung');
  assert.ok(i > 0, zeilen.join('\n'));
  assert.deepEqual(zeilen.slice(i + 1, i + 4), [
    '  davon Trinkgeld         2,00 €',
    '  Gegeben:               50,00 €',
    '  Rückgeld:               4,55 €',
  ]);
  // tipCents 0 oder fehlend: keine Zeile.
  const ohne = raster(layoutMit('split-karte-karte-bar', { paymentMethod: 'cash', payments: [{ ...payments[0], tipCents: 0 }] }), 32);
  assert.ok(!ohne.join('\n').includes('davon Trinkgeld'));
});

test('Kartenbloecke: bei mehreren Zahlungen steht die Nummer aus der Liste davor, bei einer nicht', () => {
  const nummerUndKopf = (l: ReceiptLayout): string[] => {
    const aus: string[] = [];
    l.lines.forEach((z, i) => {
      if (z.kind === 'text' && z.bold && /Beleg$|Stripe/.test(z.text)) {
        const davor = l.lines[i - 1]!;
        aus.push(`${davor.kind === 'text' && !davor.bold && davor.align === 'center' ? davor.text : '-'} | ${z.text}`);
      }
    });
    return aus;
  };
  assert.deepEqual(nummerUndKopf(layoutMit('split-karte-karte-bar', {})), ['1. Kartenzahlung | Sumup Beleg', '2. Kartenzahlung | GP Tom Beleg']);
  const eine: ReceiptPaymentPayload[] = [{ id: 'p1', method: 'creditCard', amountCents: 4545, provider: 'sumup', providerData: { cardType: 'VISA' } }];
  const l = layoutMit('split-karte-karte-bar', { paymentMethod: 'creditCard', payments: eine });
  const kopf = l.lines.findIndex((z) => z.kind === 'text' && z.text === 'Sumup Beleg');
  assert.deepEqual(l.lines[kopf - 1], { kind: 'space', lines: 1 });
});

test('Zahlart-Label: unbekannte Zahlart als Rohwert, Stripe-Block mit Nummer und Kennung', () => {
  const payments: ReceiptPaymentPayload[] = [
    { id: 'p1', method: 'neueZahlart', amountCents: 2545 },
    { id: 'p2', method: 'online', amountCents: 2000, provider: 'stripe', providerPaymentId: 'pi_1', providerData: { paymentMethodType: 'eps', epsBank: 'bank_austria' } },
  ];
  const l = layoutMit('split-karte-karte-bar', { payments });
  const zeilen = raster(l, 48);
  assert.ok(zeilen.includes('1. neueZahlart                           25,45 €'), zeilen.join('\n'));
  assert.ok(zeilen.includes('2. Onlinezahlung                         20,00 €'), zeilen.join('\n'));
  assert.deepEqual(ueberschriften(l).filter((t) => /Beleg$|Stripe/.test(t)), ['Online-Zahlung (Stripe)']);
  assert.ok(zeilen.some((z) => z.trim() === '2. Onlinezahlung'));
  assert.ok(zeilen.some((z) => z.trim() === 'Referenz: pi_1'));
});

test('Kartenbloecke in Zahlungsreihenfolge; ohne Terminaldaten oder mit unbekanntem Anbieter weder Block noch Nummer', () => {
  const payments: ReceiptPaymentPayload[] = [
    { id: 'p1', method: 'creditCard', amountCents: 1000, provider: 'myposPro', providerData: { TID: 'M1', date_time: '260925101530', pan: '****4720' } },
    { id: 'p2', method: 'creditCard', amountCents: 1000, provider: 'sumup' },
    { id: 'p3', method: 'creditCard', amountCents: 1000, provider: 'neuerAnbieter', providerData: { x: 1 } },
    { id: 'p4', method: 'creditCard', amountCents: 1545, provider: 'hobexHps', providerData: { tid: 'H1', no: '7' } },
  ];
  const l = layoutMit('split-karte-karte-bar', { payments });
  assert.deepEqual(ueberschriften(l).filter((t) => /Beleg$/.test(t)), ['MyPos Beleg', 'Hobex Beleg']);
  const nummern = l.lines.filter((z) => z.kind === 'text' && !z.bold && z.align === 'center' && /^\d+\. /.test(z.text)).map((z) => (z as { text: string }).text);
  assert.deepEqual(nummern, ['1. Kartenzahlung', '4. Kartenzahlung']);
});

test('Eine Zahlung ohne providerData neben den Altfeldern: der bisherige Kartenblock, wie ohne Liste', () => {
  const alt = layoutMit('karte-sumup', {});
  for (const zahlung of [
    { id: 'p1', method: 'creditCard', amountCents: 12000, provider: 'sumup', providerPaymentId: 'TEZBA9K7QK' },
    { id: 'p1', method: 'creditCard', amountCents: 12000 },
  ] as ReceiptPaymentPayload[]) {
    assert.deepEqual(layoutMit('karte-sumup', { payments: [zahlung] }), alt, JSON.stringify(zahlung));
  }
  // Traegt die Zahlung eigene Terminaldaten, gelten diese, nicht die Altfelder.
  const eigene = layoutMit('karte-sumup', { payments: [{ id: 'p1', method: 'creditCard', amountCents: 12000, provider: 'gpTomAndroid', providerData: { batchNumber: 1 } }] });
  assert.deepEqual(ueberschriften(eigene).filter((t) => /Beleg$/.test(t)), ['GP Tom Beleg']);
  // Zwei Zahlungen ohne Daten: kein Rueckfall, die Altfelder zaehlen nicht.
  const zwei = layoutMit('karte-sumup', { payments: [{ id: 'p1', method: 'creditCard', amountCents: 6000, provider: 'sumup' }, { id: 'p2', method: 'cash', amountCents: 6000 }] });
  assert.deepEqual(ueberschriften(zwei).filter((t) => /Beleg$/.test(t)), []);
});
