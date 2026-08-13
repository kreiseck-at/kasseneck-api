import { VatRate } from '../enums/index.js';
import { requireVatRateByRate } from './enum-payload.js';

/**
 * Belegposition — Zwilling von `KasseneckItem` in
 * kasseneck_api/lib/models/kasseneck_item.dart.
 *
 * `priceCents` ist der Einzelpreis in **Cent** (exakte Integer-Arithmetik,
 * keine Gleitkomma-Rundungsfehler). Eine Euro-Variante gibt es hier bewusst
 * nicht — anders als beim Gutschein oder Hobex-Beleg sendet die Nutzlast
 * (v2-Format) den Preis bereits als ganze Cent.
 */
export interface ReceiptItem {
  name: string;
  quantity: number;
  vat: VatRate;
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
  return {
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.priceCents,
    vatRate: item.vat.rate,
  };
}

export function fromReceiptItemPayload(payload: ReceiptItemPayload): ReceiptItem {
  return {
    name: payload.name,
    quantity: payload.quantity,
    vat: requireVatRateByRate(payload.vatRate),
    priceCents: payload.unitPriceCents,
  };
}

/** Zeilensumme in Cent (exakt, ohne Gleitkomma). */
export function receiptItemTotalCents(item: ReceiptItem): number {
  return item.priceCents * item.quantity;
}
