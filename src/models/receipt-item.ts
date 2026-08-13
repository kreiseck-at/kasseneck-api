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
 *
 * `quantity` ist eine **ganze** Menge (im Dart-Vorbild ein `int`). TypeScript
 * kennt keinen Ganzzahltyp, deshalb prueft der Schreibpfad sie zur Laufzeit —
 * siehe [receiptItemIsValid] und [toReceiptItemPayload].
 */
export interface ReceiptItem {
  name: string;
  /** Ganze Menge, > 0 zum Senden (siehe Klassenkommentar). */
  quantity: number;
  vat: VatRate | number;
  priceCents: number;
}

/**
 * Nutzlast-Form, die dieses Paket **schreibt** (v2):
 * `{ name, quantity, unitPriceCents, vatRate }`.
 */
export interface ReceiptItemPayload {
  name: string;
  quantity: number;
  unitPriceCents: number;
  vatRate: number;
}

/**
 * Nutzlast-Form, die dieses Paket **liest** — v2 und v1 nebeneinander, alles
 * optional (Zwilling von `KasseneckItem.fromJson`).
 *
 * Das ist kein Entgegenkommen, sondern der Normalfall: Das Backend bildet die
 * v2-Felder am Eingang auf v1 ab und **speichert v1** (`normalizeMoneyInputs`
 * in functions/index.js — quantity->amount, vatRate->vat,
 * unitPriceCents->priceOneCents, daraus priceOne). Ein gespeicherter Beleg
 * traegt v1 also immer, v2 nur dann, wenn der erzeugende Client sie
 * mitgesendet hat. Wer hier nur v2 liest, bekommt bei Belegen von
 * Alt-Clients `undefined` in Menge, Steuersatz und Preis — ohne Fehler, aber
 * mit `NaN` in jeder Summe und mit einem Beleg, der sich nicht mehr
 * stornieren laesst.
 */
export interface ReceiptItemPayloadRead {
  name?: string | null;
  /** v2: Menge */
  quantity?: number | null;
  /** v2: Einzelpreis in Cent */
  unitPriceCents?: number | null;
  /** v2: Steuersatz */
  vatRate?: number | null;
  /** v1: Menge */
  amount?: number | null;
  /** v1: Einzelpreis in Cent */
  priceOneCents?: number | null;
  /** v1: Einzelpreis in Euro */
  priceOne?: number | null;
  /** v1: Steuersatz */
  vat?: number | null;
}

export function toReceiptItemPayload(item: ReceiptItem): ReceiptItemPayload {
  // Schreibpfad bleibt streng: ein unaufgeloester (unbekannter) Steuersatz
  // darf nicht unbesehen wieder hinausgehen.
  const vat = typeof item.vat === 'number' ? requireVatRateByRate(item.vat) : item.vat;
  pruefeMenge(item.quantity);
  return {
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.priceCents,
    vatRate: vat.rate,
  };
}

/**
 * Liest beide Nutzlast-Formen (siehe [ReceiptItemPayloadRead]). Reihenfolge
 * wie im Dart-Vorbild: v2 vor v1, Cent-Angabe vor Euro-Angabe (exakt vor
 * gerundet); die Euro-Angabe wird genau einmal auf Cent gerundet.
 */
export function fromReceiptItemPayload(payload: ReceiptItemPayloadRead): ReceiptItem {
  const cents = ersteZahl(payload.unitPriceCents, payload.priceOneCents);
  const euro = ersteZahl(payload.priceOne);
  const menge = ersteZahl(payload.quantity, payload.amount);
  const satz = ersteZahl(payload.vatRate, payload.vat);
  return {
    name: payload.name ?? '',
    // Manche Quellen liefern 1.0 statt 1 — auf eine ganze Menge festlegen.
    quantity: menge != null ? Math.trunc(menge) : 0,
    // Fehlt der Steuersatz voellig, gibt es keinen rohen Wert zum Erhalten;
    // dann gilt wie im Dart-Vorbild 0 % (das Backend prueft `vat` als Pflicht,
    // der Fall entsteht also nur bei einer kaputten Nutzlast).
    vat: satz != null ? readVatRateByRate(satz) : VatRate.vat0,
    priceCents: cents != null ? Math.round(cents) : euro != null ? Math.round(euro * 100) : 0,
  };
}

/** Erster brauchbarer Zahlenwert der Reihe; `null`/`undefined`/NaN zaehlen nicht. */
function ersteZahl(...werte: Array<number | null | undefined>): number | undefined {
  for (const wert of werte) {
    if (typeof wert === 'number' && Number.isFinite(wert)) {
      return wert;
    }
  }
  return undefined;
}

/** Zeilensumme in Cent (exakt, ohne Gleitkomma). */
export function receiptItemTotalCents(item: ReceiptItem): number {
  return item.priceCents * item.quantity;
}

/**
 * Ist die Position an das Backend sendbar? Zwilling von `KasseneckItem.isValid`
 * im Flutter-Vorbild: ein Name muss da sein und die Menge positiv **und ganz**.
 * Der Preis darf negativ sein — genau das ist eine Stornoposition.
 *
 * Zur Ganzzahligkeit siehe [pruefeMenge]: im Dart-Vorbild ist `quantity` ein
 * `int`, hier traegt der Typ das nicht, also muss es die Laufzeit tun.
 */
export function receiptItemIsValid(item: ReceiptItem): boolean {
  return item.name.length > 0 && Number.isInteger(item.quantity) && item.quantity > 0;
}

/**
 * Wirft, wenn die Menge keine ganze Zahl ist.
 *
 * Der Grund ist keine Formstrenge, sondern die Belegwahrheit: Das Backend
 * prueft **nur** `unitPriceCents` auf Ganzzahligkeit (`checkItemsIsValid` in
 * functions/index.js), eine gebrochene Menge kaeme also durch und wuerde
 * mitsigniert. Der Lesepfad dieses Pakets schneidet sie danach ab (`Math.trunc`
 * weiter oben, wie im Dart-Vorbild, wo `quantity` ein `int` ist) — der
 * gedruckte Beleg wiese dann einen anderen Betrag aus als der signierte, und
 * ein Storno auf so einem Beleg traegt eine Menge, die es nie gab. Deshalb
 * faellt die Menge hier, vor dem Senden, und nicht spaeter still.
 *
 * `Number.isInteger` faengt Bruchteile, NaN und Unendlich in einem.
 */
function pruefeMenge(quantity: number): void {
  if (!Number.isInteger(quantity)) {
    throw new Error(`Menge: "${quantity}" ist keine ganze Zahl`);
  }
}

/**
 * Stornoposition zu dieser Position — Zwilling von `KasseneckItem.negative`:
 * gleicher Name, gleiche Menge, gleicher Steuersatz, **negierter** Einzelpreis.
 * Die Menge bleibt positiv; das Vorzeichen sitzt ausschliesslich im Preis.
 */
export function negateReceiptItem(item: ReceiptItem): ReceiptItem {
  return { ...item, priceCents: -item.priceCents };
}
