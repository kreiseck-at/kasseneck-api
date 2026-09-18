import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { positionAusEuro, type Umwandlung } from '../src/rechnung/rechnen.js';

test('Umwandler: der uebliche Fall', () => {
  assert.deepEqual(
    positionAusEuro({ unitPrice: 14.79, quantity: 2.5, vatRate: 20, discountPct: 12.5, description: 'Pflege' }),
    {
      ok: true,
      position: {
        unitPriceMicros: 14_790_000,
        quantityMilli: 2500,
        discountBp: 1250,
        vatRateBp: 2000,
        description: 'Pflege',
      },
    },
  );
});

test('Umwandler: eine Position in Ganzzahl-Form kommt unveraendert zurueck', () => {
  const ganz = { unitPriceMicros: 4, quantityMilli: 1000, vatRateBp: 2000 };
  assert.deepEqual(positionAusEuro({ ...ganz }), { ok: true, position: ganz });
});

test('Umwandler: fehlende Menge und fehlender Satz gelten als 0', () => {
  assert.deepEqual(positionAusEuro({ unitPrice: 5 }), {
    ok: true,
    position: { unitPriceMicros: 5_000_000, quantityMilli: 0, discountBp: 0, vatRateBp: 0 },
  });
});

test('Umwandler: ein fehlender Preis ist nie 0, sondern ein Grund', () => {
  assert.deepEqual(positionAusEuro({ quantity: 1, vatRate: 20 }), {
    ok: false,
    feld: 'unitPrice',
    grund: 'kein_zahlwert',
  });
});

test('Umwandler: ein Minus am Preis wandert an die Menge', () => {
  assert.deepEqual(positionAusEuro({ unitPrice: -10, quantity: 2, vatRate: 20 }), {
    ok: true,
    position: { unitPriceMicros: 10_000_000, quantityMilli: -2000, discountBp: 0, vatRateBp: 2000 },
  });
});

test('Umwandler: zu viele Stellen werden abgelehnt, auch Gleitkomma-Rauschen', () => {
  const faelle: Array<[Record<string, unknown>, string]> = [
    [{ unitPrice: 8.333333333333334 }, 'unitPrice'],
    [{ unitPrice: 0.30000000000000004 }, 'unitPrice'],
    [{ unitPrice: 1, quantity: 1.0001 }, 'quantity'],
    [{ unitPrice: 1, quantity: 1, discountPct: 12.345 }, 'discountPct'],
    [{ unitPrice: 1, quantity: 1, vatRate: 4.955 }, 'vatRate'],
  ];
  for (const [item, feld] of faelle) {
    const e = positionAusEuro(item) as Extract<Umwandlung, { ok: false }>;
    assert.equal(e.ok, false, JSON.stringify(item));
    assert.equal(e.feld, feld);
    assert.equal(e.grund, 'nachkommastellen');
  }
});

test('Umwandler: zwei Nachkommastellen im Satz sind verlustfrei', () => {
  // Der Umwandler prueft Verlustfreiheit, nicht ob es den Satz gibt: 4,95 %
  // sind genau 495 Hundertstel-Prozent (Spec § 5.9: 2 Stellen bei Satz und Rabatt).
  const e = positionAusEuro({ unitPrice: 1, quantity: 1, vatRate: 4.95 });
  assert.equal(e.ok, true);
  if (e.ok) assert.equal(e.position.vatRateBp, 495);
});

test('Umwandler: Text, NaN und unmoegliche Werte', () => {
  assert.equal((positionAusEuro({ unitPrice: '12,00' }) as { grund: string }).grund, 'kein_zahlwert');
  assert.equal((positionAusEuro({ unitPrice: Number.NaN }) as { grund: string }).grund, 'kein_zahlwert');
  assert.equal((positionAusEuro({ unitPrice: 1, quantity: 1, vatRate: 120 }) as { grund: string }).grund, 'ausserhalb');
  assert.equal(
    (positionAusEuro({ unitPrice: 1, quantity: 1, discountPct: -5 }) as { grund: string }).grund,
    'ausserhalb',
  );
});

test('Umwandler: dichte Abtastung — alles Erlaubte geht verlustfrei', () => {
  for (let rabatt = 0; rabatt <= 10_000; rabatt++) {
    const e = positionAusEuro({ unitPrice: 1, quantity: 1, discountPct: rabatt / 100 });
    assert.equal(e.ok, true, `Rabatt ${rabatt / 100}`);
    if (e.ok) assert.equal(e.position.discountBp, rabatt);
  }
  for (let cent = 0; cent <= 100_000; cent += 7) {
    const e = positionAusEuro({ unitPrice: cent / 100, quantity: 1 });
    assert.equal(e.ok, true, `Preis ${cent / 100}`);
    if (e.ok) assert.equal(e.position.unitPriceMicros, cent * 10_000);
  }
  for (let milli = 1; milli <= 1_000_000; milli += 13) {
    const e = positionAusEuro({ unitPrice: 1, quantity: milli / 1000 });
    assert.equal(e.ok, true, `Menge ${milli / 1000}`);
    if (e.ok) assert.equal(e.position.quantityMilli, milli);
  }
});

interface UmwandlungsFall {
  name: string;
  item: Record<string, unknown>;
  erwartet: Umwandlung;
}

const datei = JSON.parse(
  readFileSync(new URL('../../fixtures/position-aus-euro.json', import.meta.url), 'utf8'),
) as { faelle: UmwandlungsFall[] };

test('Umwandler: jeder Fall der Prueffall-Datei trifft', () => {
  assert.ok(datei.faelle.length >= 12);
  for (const f of datei.faelle) assert.deepEqual(positionAusEuro(f.item), f.erwartet, f.name);
});
