import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rechnungRechnen } from '../src/rechnung/rechnen.js';
import { rechnungSummen, type SummenPosition } from '../src/rechnung/summen.js';
import type { PriceMode } from '../src/rechnung/vertrag.js';
import { zufall } from './zufall.js';

/**
 * Zwei Arten von Feldern je Satz, mit unterschiedlicher Fehlerschranke:
 *
 * - "einmal gerundet": im Netto-Modus Netto und USt (je direkt aus der ungerundeten
 *   Zeilensumme gerundet), im Brutto-Modus Brutto (direkt aus der ungerundeten
 *   Zeilensumme). Hoechstens 1 Cent Abstand zum alten, Gleitkomma-basierten Weg --
 *   und nur an Halbcent-Grenzen.
 * - "abgeleitet": im Netto-Modus Brutto (= Netto + USt, die Summe zweier getrennt
 *   gerundeter Werte), im Brutto-Modus Netto und USt (aus dem bereits gerundeten
 *   Brutto abgeleitet). Runden beide Bestandteile in dieselbe Richtung falsch,
 *   addiert sich der Fehler -- hoechstens 2 Cent Abstand.
 *
 * Beleg fuer den Unterschied (Netto-Modus): 975,00 EUR x 237,8 abzueglich 45,5 %
 * Rabatt zu 20 % ergibt exakt 12.636.097,5 Cent Netto UND 2.527.219,5 Cent USt --
 * beide Werte liegen exakt auf der Halbcent-Grenze. Der alte Weg rundet beide
 * Gleitkomma-Werte wegen des Darstellungsfehlers nach unten (12636097 / 2527219),
 * der Kern rechnet exakt und rundet beide korrekt auf (12636098 / 2527220) -- je
 * 1 Cent Abstand bei Netto und USt, aber 2 Cent bei der abgeleiteten Bruttosumme
 * (12636097+2527219=15163316 alt gegen 12636098+2527220=15163318 neu).
 */
function feldKlassen(modus: PriceMode): { einmal: readonly string[]; abgeleitet: readonly string[] } {
  return modus === 'net'
    ? { einmal: ['netCents', 'vatCents'], abgeleitet: ['grossCents'] }
    : { einmal: ['grossCents'], abgeleitet: ['netCents', 'vatCents'] };
}

/**
 * Zufallsposition mit Mengen und Rabatten aus kleinen Nennern (Viertelschritte,
 * 2,5-%-Schritte). Das trifft Halbcent-Grenzen viel oefter als beliebige
 * Tausendstel/Zehntausendstel -- ein paar tausend Laeufe reichen so fuer
 * verlaessliche Treffer, ohne die Suite (3 Zeitzonen-Durchlaeufe) zu bremsen.
 */
function zufallsPosition(r: () => number, saetze: readonly number[]): SummenPosition & { vatRate: number } {
  return {
    unitPriceCents: 1 + Math.floor(r() * 500_000),
    quantity: (Math.round(r() * 16) * 250) / 1000, // Viertelschritte 0,00 .. 4,00
    vatRate: saetze[Math.floor(r() * saetze.length)]!,
    discountPct: (Math.round(r() * 20) * 250) / 100, // 2,5-%-Schritte 0 .. 50 %
  };
}

test('Kern gegen rechnungSummen: je Satz hoechstens 1 (direkt) bzw. 2 Cent (abgeleitet) Abstand', () => {
  const saetze = [0, 10, 13, 20];
  const startwerte = [20_260_919, 300, 7];
  for (const startwert of startwerte) {
    const r = zufall(startwert);
    let abweichungen = 0;
    for (let lauf = 0; lauf < 4000; lauf++) {
      const anzahl = 1 + Math.floor(r() * 4);
      const api = Array.from({ length: anzahl }, () => zufallsPosition(r, saetze));
      const modus: PriceMode = r() < 0.5 ? 'net' : 'gross';
      const alt = rechnungSummen(api, modus);
      const neu = rechnungRechnen(
        api.map((p) => ({
          unitPriceMicros: p.unitPriceCents * 10_000,
          quantityMilli: Math.round(p.quantity * 1000),
          discountBp: Math.round((p.discountPct ?? 0) * 100),
          vatRateBp: p.vatRate * 100,
        })),
        { priceMode: modus },
      );
      const { einmal, abgeleitet } = feldKlassen(modus);
      const neuJeSatz = new Map(neu.byRate.map((s) => [s.rateBp, s]));
      for (const altSatz of alt.byRate) {
        const rateBp = Math.round(altSatz.rate * 100);
        const neuSatz = neuJeSatz.get(rateBp);
        assert.ok(neuSatz, `Satz ${altSatz.rate}% fehlt im Kern-Ergebnis, Startwert ${startwert} Lauf ${lauf}`);
        for (const feld of einmal) {
          const abstand = Math.abs(
            (altSatz as unknown as Record<string, number>)[feld]! - (neuSatz as unknown as Record<string, number>)[feld]!,
          );
          if (abstand > 0) abweichungen++;
          assert.ok(
            abstand <= 1,
            `${feld} (einmal gerundet): ${altSatz.rate}% ${JSON.stringify(altSatz)} gegen ${JSON.stringify(neuSatz)}, Startwert ${startwert} Lauf ${lauf}`,
          );
        }
        for (const feld of abgeleitet) {
          const abstand = Math.abs(
            (altSatz as unknown as Record<string, number>)[feld]! - (neuSatz as unknown as Record<string, number>)[feld]!,
          );
          if (abstand > 0) abweichungen++;
          assert.ok(
            abstand <= 2,
            `${feld} (abgeleitet): ${altSatz.rate}% ${JSON.stringify(altSatz)} gegen ${JSON.stringify(neuSatz)}, Startwert ${startwert} Lauf ${lauf}`,
          );
        }
      }
      // Ueber mehrere Saetze summiert darf die Gesamtsumme je Satz bis zu 2 Cent
      // abweichen -- die Einzelfehler je Satz addieren sich im schlechtesten Fall.
      const grenzeGesamt = 2 * alt.byRate.length;
      for (const feld of ['netCents', 'vatCents', 'grossCents'] as const) {
        const abstand = Math.abs(alt[feld] - neu[feld]);
        assert.ok(
          abstand <= grenzeGesamt,
          `Gesamt-${feld}: ${alt[feld]} gegen ${neu[feld]} (Grenze ${grenzeGesamt}), Startwert ${startwert} Lauf ${lauf}`,
        );
      }
    }
    // Ohne Abweichungen waere der Test fuer diesen Startwert wertlos.
    assert.ok(abweichungen > 0, `Startwert ${startwert}: keine einzige Abweichung gefunden -- Generator zu grob?`);
  }
});

test('Kern gegen rechnungSummen: bekannte Faelle an der Halbcent-Grenze', () => {
  const faelle: Array<{
    position: { unitPriceCents: number; quantity: number; vatRate: number; discountPct?: number };
    modus: PriceMode;
    erwartet: { netCents: number; vatCents: number; grossCents: number };
  }> = [
    {
      position: { unitPriceCents: 2135, quantity: 1, vatRate: 10 },
      modus: 'net',
      erwartet: { netCents: 0, vatCents: 1, grossCents: 1 },
    },
    {
      position: { unitPriceCents: 55_017, quantity: 1.5, vatRate: 13 },
      modus: 'net',
      erwartet: { netCents: 1, vatCents: 0, grossCents: 1 },
    },
    {
      position: { unitPriceCents: 6630, quantity: 35.05, vatRate: 20 },
      modus: 'net',
      erwartet: { netCents: 1, vatCents: 0, grossCents: 1 },
    },
    // Beleg fuer den 2-Cent-Fall bei der abgeleiteten Bruttosumme: siehe Kommentar oben.
    {
      position: { unitPriceCents: 97_500, quantity: 237.8, vatRate: 20, discountPct: 45.5 },
      modus: 'net',
      erwartet: { netCents: 1, vatCents: 1, grossCents: 2 },
    },
  ];
  for (const { position, modus, erwartet } of faelle) {
    const alt = rechnungSummen([position], modus);
    const neu = rechnungRechnen(
      [
        {
          unitPriceMicros: position.unitPriceCents * 10_000,
          quantityMilli: Math.round(position.quantity * 1000),
          discountBp: Math.round((position.discountPct ?? 0) * 100),
          vatRateBp: position.vatRate * 100,
        },
      ],
      { priceMode: modus },
    );
    for (const feld of ['netCents', 'vatCents', 'grossCents'] as const) {
      assert.equal(neu[feld], alt[feld] + erwartet[feld], `${JSON.stringify(position)} ${feld}`);
    }
  }
});
