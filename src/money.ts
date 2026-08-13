/**
 * Die Grenze zwischen Euro und Cent — an genau einer Stelle.
 *
 * Dieses Paket rechnet ausnahmslos in ganzen Cent (siehe README). Euro treten
 * nur dort auf, wo eine fremde Schnittstelle sie verlangt oder liefert: die
 * Belegliste des Backends sendet `total`/`umsatz` in Euro, das Hobex-Terminal
 * nimmt `amount`/`tip` in Euro entgegen. Beide Richtungen stehen hier, damit
 * die Umrechnung nicht in jeder Datei erneut auftaucht — und damit die
 * Rundungsregel nur einmal entschieden ist.
 */

/** Cent -> Euro, fuer die Schnittstellen, die Euro verlangen. */
export function centsToEuro(cents: number): number {
  return cents / 100;
}

/**
 * Euro -> ganze Cent, fuer Betraege, die aus einer fremden Antwort kommen.
 *
 * Unbrauchbare Werte (fehlend, `null`, keine Zahl, NaN, Unendlich) ergeben 0:
 * eine Belegliste darf nicht daran scheitern, dass ein einzelner Betrag fehlt.
 *
 * Gerundet wird **von der Null weg**, nicht mit `Math.round` — das schoebe
 * `.5` immer Richtung +unendlich, und dann heben sich ein Beleg und sein
 * Storno im Cent nicht mehr auf (dieselbe Regel wie in receipt/layout.ts).
 */
export function euroToCents(euro: unknown): number {
  if (typeof euro !== 'number' || !Number.isFinite(euro)) {
    return 0;
  }
  const cents = Math.round(Math.abs(euro) * 100);
  return euro < 0 ? -cents : cents;
}
