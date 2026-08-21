import type { ReceiptItem } from '../models/receipt-item.js';
import { receiptItemTotalCents } from '../models/receipt-item.js';

/**
 * Rabatt als negative Position(en) — eine je Steuersatz, anteilig zum
 * Bruttoumsatz dieses Satzes. So stimmt die MwSt-Tabelle des Belegs immer, das
 * DEP zeigt den Rabatt als Position, und Backend/Signatur bleiben unberuehrt
 * (createReceipt erlaubt negative Positionen).
 *
 * Rundung nach dem groessten Rest (Hare-Niemeyer): die Cent, die beim
 * Abrunden uebrig bleiben, gehen der Reihe nach an die Gruppen mit dem
 * groessten Bruchteil; keine Zeile ist je groesser als der Umsatz ihres Satzes.
 */
export function verteileRabatt(positionen: ReceiptItem[], rabattCents: number, name = 'Rabatt'): ReceiptItem[] {
  if (!Number.isInteger(rabattCents) || rabattCents < 0) {
    throw new Error('Rabatt muss eine ganze Zahl in Cent >= 0 sein');
  }
  if (rabattCents === 0) return [];
  // Umsatz je Steuersatz (nur positive Positionen -- Rabatte/Stornos zaehlen nicht mit)
  const gruppen = new Map<string, { vat: ReceiptItem['vat']; umsatz: number }>();
  for (const p of positionen) {
    const betrag = receiptItemTotalCents(p);
    if (betrag <= 0) continue;
    const key = typeof p.vat === 'object' ? p.vat.value : String(p.vat);
    const g = gruppen.get(key) ?? { vat: p.vat, umsatz: 0 };
    g.umsatz += betrag;
    gruppen.set(key, g);
  }
  const gesamt = [...gruppen.values()].reduce((s, g) => s + g.umsatz, 0);
  if (rabattCents > gesamt) throw new Error('Rabatt uebersteigt den Umsatz');
  const liste = [...gruppen.values()];
  const exakt = liste.map((g) => (rabattCents * g.umsatz) / gesamt);
  const anteile = exakt.map((x) => Math.floor(x));
  let rest = rabattCents - anteile.reduce((s, a) => s + a, 0);
  // Reihenfolge fuer die Restcent: groesster Bruchteil zuerst, bei Gleichstand groesserer Umsatz
  const reihenfolge = liste.map((_, i) => i).sort((a, b) => (exakt[b]! - anteile[b]!) - (exakt[a]! - anteile[a]!) || liste[b]!.umsatz - liste[a]!.umsatz);
  for (let runde = 0; rest > 0 && runde < liste.length + 1; runde++) {
    for (const i of reihenfolge) {
      if (rest === 0) break;
      if (anteile[i]! < liste[i]!.umsatz) { anteile[i]! += 1; rest -= 1; }
    }
  }
  return liste
    .map((g, i) => ({ name, quantity: 1, vat: g.vat, priceCents: -anteile[i]!, kind: 'discount' as const }))
    .filter((z) => z.priceCents < 0);
}
