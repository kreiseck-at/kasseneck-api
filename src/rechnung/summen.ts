/**
 * Summen einer Rechnung vorab rechnen — genau so, wie der Server sie beim
 * Ausstellen rechnet. Fuer Shops, die kassieren, bevor die Rechnung entsteht,
 * und denselben Betrag brauchen, den die Rechnung spaeter ausweist.
 *
 * Die Regel (je USt-Satz, Betraege in Cent, kaufmaennisch gerundet):
 *
 * | Modus   | Netto                          | USt                        | Brutto             |
 * |---------|--------------------------------|----------------------------|--------------------|
 * | `net`   | round(Σ Zeilen)                | round(Σ Zeilen × Satz/100) | Netto + USt        |
 * | `gross` | round(B × 100 / (100 + Satz))  | B − Netto                  | B = round(Σ Zeilen)|
 *
 * Zeile = Einzelpreis × Menge × (1 − Rabatt/100), ungerundet. Im Brutto-Modus
 * ist das Brutto der vereinbarte Preis und bleibt, wie die Zeilen es ergeben.
 * Bei einem steuerfreien Steuerfall zaehlt jede Zeile zu 0 %.
 *
 * `fixtures/rechnung-summen.json` haelt die Prueffaelle; Backend und
 * Dart-Zwilling pruefen gegen dieselbe Datei. Verbindlich bleibt, was der
 * Server rechnet — mit `previewInvoice` laesst sich das vorab abfragen.
 */

import type { InvoiceRateTotals, InvoiceTotals } from './typen.js';
import type { PriceMode, TaxScheme } from './vertrag.js';

/** Was fuer die Summe zaehlt — `InvoiceItemInput` passt unveraendert. */
export interface SummenPosition {
  quantity: number;
  unitPriceCents: number;
  vatRate: number;
  discountPct?: number;
}

/** Steuerfaelle, in denen die Rechnung keine Steuer ausweist: jede Zeile zaehlt zu 0 %. */
export const STEUERFREIE_FAELLE: readonly TaxScheme[] = Object.freeze([
  'smallBusiness',
  'reverseCharge',
  'igLieferung',
  'exportThirdCountry',
  'domesticReverseCharge',
  'outsideScope',
]);

/** Auf Cent gerundete Euro — dieselbe Rundung wie am Server (halber Cent vom Nullpunkt weg). */
function euroRund(n: number): number {
  return ((n < 0 ? -1 : 1) * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
}

const euroZuCent = (euro: number): number => Math.round(euroRund(euro) * 100) || 0;

/** Ganze Cent kaufmaennisch; ein Gleitkomma-Rest wie x,4999999… zaehlt als halber Cent. */
function centRund(x: number): number {
  const betrag = Math.round(Math.abs(x) * 1e6) / 1e6;
  return (x < 0 ? -1 : 1) * Math.round(betrag) || 0;
}

/**
 * Netto, USt und Brutto einer Rechnung in Cent, je Satz absteigend — dieselbe
 * Form wie `invoice.totals` in den Antworten.
 *
 * `taxScheme` ist der Steuerfall der Rechnung; ohne Angabe `normal`. Leitet der
 * Server einen steuerfreien Fall ab (etwa eine ig. Lieferung), gehoert dieser
 * Fall hierher — sonst rechnet die Funktion Steuer, die die Rechnung nicht
 * ausweist.
 */
export function rechnungSummen(
  items: readonly SummenPosition[],
  priceMode: PriceMode,
  taxScheme: TaxScheme = 'normal',
): InvoiceTotals {
  const steuerfrei = STEUERFREIE_FAELLE.includes(taxScheme);
  const bruttoPreise = priceMode === 'gross' && !steuerfrei;

  // Ungerundete Zeilen je Satz, in Euro wie am Server.
  const jeSatz = new Map<number, number>();
  for (const p of items) {
    const satz = steuerfrei ? 0 : p.vatRate;
    const zeile = (p.unitPriceCents / 100) * p.quantity * (1 - (p.discountPct ?? 0) / 100);
    jeSatz.set(satz, (jeSatz.get(satz) ?? 0) + zeile);
  }

  const byRate: InvoiceRateTotals[] = [];
  for (const [rate, roh] of jeSatz) {
    let netCents: number;
    let vatCents: number;
    if (bruttoPreise) {
      const grossCents = euroZuCent(roh);
      netCents = centRund((grossCents * 100) / (100 + rate));
      vatCents = grossCents - netCents;
    } else {
      netCents = euroZuCent(roh);
      vatCents = euroZuCent((roh * rate) / 100);
    }
    byRate.push({ rate, netCents, vatCents, grossCents: netCents + vatCents });
  }
  byRate.sort((a, b) => b.rate - a.rate);

  const summe = (feld: 'netCents' | 'vatCents' | 'grossCents'): number =>
    byRate.reduce((s, r) => s + r[feld], 0);
  return { netCents: summe('netCents'), vatCents: summe('vatCents'), grossCents: summe('grossCents'), byRate };
}
