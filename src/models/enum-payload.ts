import { VatRate } from '../enums/index.js';

/**
 * Liest einen Enum-Eintrag anhand seines Nutzlast-Schluessels (z. B.
 * `receiptType: 'standard'` oder `paymentMethod: 'cash'` — bei den mit
 * `defineEnum()` gebauten Enums ist der Objekt-Schluessel selbst die Nutzlast).
 *
 * Anders als das Dart-Vorbild (`Enum.values.firstWhere(..., orElse: () =>
 * Default)`) faellt das hier NICHT still auf einen Default-Wert zurueck,
 * sondern wirft. Ein unbekannter Schluessel aus der Nutzlast (z. B. ein
 * Steuersatz oder Belegtyp, den dieses Paket noch nicht kennt) soll auffallen
 * statt eine falsche Kategorie vorzutaeuschen — bei RKSV-relevanten Feldern
 * waere ein stiller Default schlimmer als ein Fehler.
 */
export function requireEnumKey<T extends Record<string, unknown>>(enumObj: T, key: string, label: string): T[keyof T] {
  if (!Object.prototype.hasOwnProperty.call(enumObj, key)) {
    throw new Error(`${label}: unbekannter Schluessel "${key}" in der Nutzlast`);
  }
  return enumObj[key as keyof T];
}

/**
 * Loest einen Steuersatz anhand seines numerischen `rate`-Werts auf (die
 * Nutzlast traegt z. B. `vatRate: 20`, nicht den Enum-Schluessel `vat20`).
 * Wirft bei unbekanntem Satz statt still zu `undefined` zu werden.
 */
export function requireVatRateByRate(rate: number): VatRate {
  const eintrag = (Object.values(VatRate) as VatRate[]).find((v) => v.rate === rate);
  if (!eintrag) {
    throw new Error(`Steuersatz: unbekannter Satz "${rate}" in der Nutzlast`);
  }
  return eintrag;
}
