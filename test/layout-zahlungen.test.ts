import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromReceiptPayload, type ReceiptPaymentPayload } from '../src/models/index.js';
import { buildReceiptLayout, renderReceiptGrid, gridAlsText, type ReceiptLayout } from '../src/receipt/index.js';
import { CARD_PROVIDER_LABEL, cardProviderLabel } from '../src/receipt/layout.js';

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

test('Anbieter-Labels: woertliche Kopie von CARD_PROVIDER_LABEL aus functions/gemeinsam/helper.js', () => {
  // Abgeschrieben aus kasseneck functions/gemeinsam/helper.js (CARD_PROVIDER_LABEL),
  // nicht aus diesem Paket abgeleitet.
  const backend = {
    gpTomAndroid: 'GP Tom',
    gpTomIos: 'GP Tom',
    hobexCloudApi: 'Hobex',
    hobexHps: 'Hobex',
    sumup: 'SumUp',
    myposPro: 'myPOS',
    custom: 'Sonstige',
  };
  assert.deepEqual({ ...CARD_PROVIDER_LABEL }, backend);
  // Unbekannt (auch stripe): der Rohwert, wie cardProviderLabel im Backend.
  assert.equal(cardProviderLabel('stripe'), 'stripe');
  assert.equal(cardProviderLabel('neuerAnbieter'), 'neuerAnbieter');
});

test('Leere Zahlungsliste: der alte Weg ueber paymentMethod und die Kartenfelder', () => {
  const ohne = layoutMit('karte-sumup', {});
  const leer = layoutMit('karte-sumup', { payments: [] });
  assert.deepEqual(leer, ohne);
});

test('Mit Zahlungsliste zaehlen die alten Kartenfelder nicht mehr', () => {
  const payments: ReceiptPaymentPayload[] = [{ id: 'p1', method: 'cash', amountCents: 12000 }];
  const l = layoutMit('karte-sumup', { paymentMethod: 'cash', payments });
  assert.deepEqual(ueberschriften(l).filter((t) => /Beleg$/.test(t)), []);
  assert.ok(raster(l, 32).includes('Zahlungsart:          Barzahlung'));
});

test('Rueckgeld ohne changeCents: gegeben minus Betrag', () => {
  const payments: ReceiptPaymentPayload[] = [
    { id: 'p1', method: 'creditCard', amountCents: 2000, provider: 'custom' },
    { id: 'p2', method: 'boltCash', amountCents: 2545, tenderedCents: 3000 },
  ];
  const zeilen = raster(layoutMit('split-karte-karte-bar', { payments }), 32);
  const i = zeilen.indexOf('Bolt Cash                25,45 €');
  assert.ok(i > 0, zeilen.join('\n'));
  assert.equal(zeilen[i + 1], 'Gegeben:                 30,00 €');
  assert.equal(zeilen[i + 2], 'Rückgeld:                 4,55 €');
});

test('Ohne gegebenen Betrag keine Gegeben-/Rueckgeld-Zeilen; Karten bekommen sie nie', () => {
  const payments: ReceiptPaymentPayload[] = [
    { id: 'p1', method: 'creditCard', amountCents: 2000, provider: 'custom', tenderedCents: 5000 },
    { id: 'p2', method: 'cash', amountCents: 2545 },
  ];
  const text = raster(layoutMit('split-karte-karte-bar', { payments }), 32).join('\n');
  assert.ok(!text.includes('Gegeben:'));
  assert.ok(!text.includes('Rückgeld:'));
  // custom hat keinen Block, bekommt aber sein Label.
  assert.ok(text.includes('Kartenzahlung            20,00 €\n(Sonstige)'), text);
});

test('58 mm: Betraege bis 9999,99 (auch negativ) brechen nie, das lange Label bricht vor der Klammer', () => {
  for (const cents of [999999, -999999]) {
    const payments: ReceiptPaymentPayload[] = [
      { id: 'p1', method: 'creditCard', amountCents: cents, provider: 'gpTomIos' },
      { id: 'p2', method: 'uberCard', amountCents: cents, provider: 'hobexCloudApi' },
    ];
    const zeilen = raster(layoutMit('split-langer-betrag', { payments }), 32);
    const betrag = cents > 0 ? '9999,99 €' : '-9999,99 €';
    const karte = zeilen.findIndex((z) => z.startsWith('Kartenzahlung') && z.endsWith(betrag));
    assert.ok(karte > 0, zeilen.join('\n'));
    assert.equal(zeilen[karte + 1]!.trimEnd(), '(GP Tom)');
    const uber = zeilen.findIndex((z) => z.startsWith('Uber Card (Hobex)') && z.endsWith(betrag));
    assert.ok(uber > 0, zeilen.join('\n'));
  }
});

test('Zahlart-Label: Anbieter nur bei Kartenzahlarten, unbekannte Zahlart als Rohwert', () => {
  const payments: ReceiptPaymentPayload[] = [
    { id: 'p1', method: 'online', amountCents: 2000, provider: 'stripe', providerPaymentId: 'pi_1', providerData: { paymentMethodType: 'eps', epsBank: 'bank_austria' } },
    { id: 'p2', method: 'neueZahlart', amountCents: 2545 },
  ];
  const l = layoutMit('split-karte-karte-bar', { payments });
  const zeilen = raster(l, 48);
  assert.ok(zeilen.includes('Onlinezahlung                            20,00 €'), zeilen.join('\n'));
  assert.ok(zeilen.includes('neueZahlart                              25,45 €'), zeilen.join('\n'));
  // Der Stripe-Block kommt trotzdem, mit der Kennung aus providerPaymentId.
  assert.deepEqual(ueberschriften(l).filter((t) => /Beleg$|Stripe/.test(t)), ['Online-Zahlung (Stripe)']);
  assert.ok(zeilen.some((z) => z.trim() === 'Referenz: pi_1'));
});

test('Kartenbloecke in Zahlungsreihenfolge; ohne Terminaldaten oder mit unbekanntem Anbieter kein Block', () => {
  const payments: ReceiptPaymentPayload[] = [
    { id: 'p1', method: 'creditCard', amountCents: 1000, provider: 'myposPro', providerData: { TID: 'M1', date_time: '260925101530', pan: '****4720' } },
    { id: 'p2', method: 'creditCard', amountCents: 1000, provider: 'sumup' },
    { id: 'p3', method: 'creditCard', amountCents: 1000, provider: 'neuerAnbieter', providerData: { x: 1 } },
    { id: 'p4', method: 'creditCard', amountCents: 1545, provider: 'hobexHps', providerData: { tid: 'H1', no: '7' } },
  ];
  const l = layoutMit('split-karte-karte-bar', { payments });
  assert.deepEqual(ueberschriften(l).filter((t) => /Beleg$/.test(t)), ['MyPos Beleg', 'Hobex Beleg']);
});
