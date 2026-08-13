import { VatRate } from '../enums/index.js';

/**
 * Loest einen Enum-Eintrag anhand seines Nutzlast-Schluessels auf (z. B.
 * `receiptType: 'standard'` — bei den mit `defineEnum()` gebauten Enums ist
 * der Objekt-Schluessel selbst die Nutzlast).
 *
 * Nur fuer den **Schreibpfad**: bevor dieses Paket selbst einen Wert nach
 * aussen traegt, muss er bekannt sein — ein unbekannter Schluessel wirft.
 * Fuer den Lesepfad (Daten, die vom Backend hereinkommen) siehe
 * [readEnumKey]: dort darf ein einzelner unbekannter Wert nicht die ganze
 * Belegliste zum Absturz bringen.
 */
export function requireEnumKey<T extends Record<string, unknown>>(enumObj: T, key: string, label: string): T[keyof T] {
  if (!Object.prototype.hasOwnProperty.call(enumObj, key)) {
    throw new Error(`${label}: unbekannter Schluessel "${key}" in der Nutzlast`);
  }
  return enumObj[key as keyof T];
}

/**
 * Lesepfad-Pendant zu [requireEnumKey]: ein unbekannter Schluessel (z. B. ein
 * neuer Belegtyp oder eine neue Zahlungsart, die dieses Paket noch nicht
 * kennt) wirft nicht und wird auch nicht still zu `undefined` — der rohe
 * Nutzlast-Schluessel bleibt als String erhalten. Ein Aufrufer, der eine
 * Belegliste anzeigt, kann so alle Positionen weiterlesen; nur die unbekannte
 * bleibt (erkennbar) unaufgeloest.
 */
export function readEnumKey<T extends Record<string, unknown>>(enumObj: T, key: string): T[keyof T] | string {
  return Object.prototype.hasOwnProperty.call(enumObj, key) ? enumObj[key as keyof T] : key;
}

function findVatRate(rate: number): VatRate | undefined {
  return (Object.values(VatRate) as VatRate[]).find((v) => v.rate === rate);
}

/** Schreibpfad: loest einen Steuersatz anhand seines `rate`-Werts auf, wirft bei unbekanntem Satz. */
export function requireVatRateByRate(rate: number): VatRate {
  const eintrag = findVatRate(rate);
  if (!eintrag) {
    throw new Error(`Steuersatz: unbekannter Satz "${rate}" in der Nutzlast`);
  }
  return eintrag;
}

/** Lesepfad: unbekannter Satz bleibt als roher `rate`-Wert erhalten statt zu werfen oder `undefined` zu werden. */
export function readVatRateByRate(rate: number): VatRate | number {
  return findVatRate(rate) ?? rate;
}
