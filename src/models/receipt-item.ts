import { VatRate } from '../enums/index.js';
import { readVatRateByRate, requireVatRateByRate } from './enum-payload.js';

/**
 * Belegposition — Zwilling von `KasseneckItem` in
 * kasseneck_api/lib/models/kasseneck_item.dart.
 *
 * `priceCents` ist der Einzelpreis in **Cent** (exakte Integer-Arithmetik,
 * keine Gleitkomma-Rundungsfehler). Eine Euro-Variante gibt es hier bewusst
 * nicht — anders als beim Gutschein oder Hobex-Beleg sendet die Nutzlast
 * (v2-Format) den Preis bereits als ganze Cent.
 *
 * `vat` ist beim Lesen entweder der bekannte Steuersatz (Objekt) oder — falls
 * die Nutzlast einen Satz traegt, den dieses Paket noch nicht kennt — der
 * rohe `rate`-Wert als Zahl (siehe [readVatRateByRate]). Ein Aufrufer erkennt
 * den unbekannten Fall am `typeof`: ein Objekt ist bekannt, eine Zahl nicht.
 */
export interface ReceiptItem {
  name: string;
  quantity: number;
  vat: VatRate | number;
  priceCents: number;
}

/** Nutzlast-Form (v2): `{ name, quantity, unitPriceCents, vatRate }`. */
export interface ReceiptItemPayload {
  name: string;
  quantity: number;
  unitPriceCents: number;
  vatRate: number;
}

export function toReceiptItemPayload(item: ReceiptItem): ReceiptItemPayload {
  // Schreibpfad bleibt streng: ein unaufgeloester (unbekannter) Steuersatz
  // darf nicht unbesehen wieder hinausgehen.
  const vat = typeof item.vat === 'number' ? requireVatRateByRate(item.vat) : item.vat;
  return {
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.priceCents,
    vatRate: vat.rate,
  };
}

export function fromReceiptItemPayload(payload: ReceiptItemPayload): ReceiptItem {
  return {
    name: payload.name,
    quantity: payload.quantity,
    vat: readVatRateByRate(payload.vatRate),
    priceCents: payload.unitPriceCents,
  };
}

/** Zeilensumme in Cent (exakt, ohne Gleitkomma). */
export function receiptItemTotalCents(item: ReceiptItem): number {
  return item.priceCents * item.quantity;
}
