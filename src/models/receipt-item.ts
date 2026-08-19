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
 * `quantity` ist beim **Schreiben** eine ganze Menge; TypeScript kennt keinen
 * Ganzzahltyp, deshalb prueft der Schreibpfad sie zur Laufzeit (siehe
 * [receiptItemIsValid] und [toReceiptItemPayload]). Beim **Lesen** steht hier,
 * was in der Nutzlast stand — auch eine gebrochene Menge aus fremder Hand:
 * lesen tolerant, schreiben streng. `receiptItemTotalCents` liefert dann
 * folgerichtig einen gebrochenen Cent-Betrag; das ist die Wahrheit des
 * Belegs, nicht ein Fehler dieses Pakets.
 */
export interface ReceiptItem {
  name: string;
  /** Ganze Menge, > 0 zum Senden (siehe Klassenkommentar). */
  quantity: number;
  vat: VatRate | number;
  priceCents: number;
  /**
   * Trinkgeld-Position (vom Backend aus dem Parameter `tip` erzeugt, siehe
   * [ReceiptCommonOptions.tip]). Mitarbeiter-Trinkgeld ist Durchlaeufer
   * (0 %, kein Umsatz), Inhaber-Trinkgeld (`recipient.owner`) Umsatz. Ein
   * Client schreibt das Feld nur beim Storno einer gelesenen Position mit.
   */
  kind?: 'tip';
  /** Empfaenger der Trinkgeld-Position; `null` = nicht zugeordnet. */
  recipient?: TipRecipient | null;
  /** Zahlart der Trinkgeld-Position (kann von der des Belegs abweichen). */
  paymentMethod?: string;
}

/** Empfaenger einer Trinkgeld-Position (Kassen-Benutzer, Snapshot des Namens). */
export interface TipRecipient {
  registerUserId: string;
  name: string;
  /** true: Inhaber — das Trinkgeld ist Umsatz mit USt. */
  owner?: boolean;
}

/** Trinkgeld-Position? Die eine Erkennungsstelle — niemand prueft `kind` selbst. */
export function isTipItem(item: ReceiptItem | ReceiptItemPayloadRead): boolean {
  return item != null && (item as { kind?: unknown }).kind === 'tip';
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
  /** Nur bei Trinkgeld-Positionen (Storno-Spiegelung), siehe [ReceiptItem.kind]. */
  kind?: 'tip';
  recipient?: TipRecipient | null;
  paymentMethod?: string;
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
  /** Trinkgeld-Position (Backend), siehe [ReceiptItem.kind]. */
  kind?: string | null;
  recipient?: TipRecipient | null;
  paymentMethod?: string | null;
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
  const nutzlast: ReceiptItemPayload = {
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.priceCents,
    vatRate: vat.rate,
  };
  // Trinkgeld-Kennzeichnung reist mit — sonst wuerde ein Storno dieser
  // Position am Backend als Warenzeile ankommen und aus den Trinkgeld-
  // Aggregaten nicht wieder herausgerechnet.
  if (item.kind === 'tip') {
    nutzlast.kind = 'tip';
    nutzlast.recipient = item.recipient ?? null;
    if (item.paymentMethod != null) nutzlast.paymentMethod = item.paymentMethod;
  }
  return nutzlast;
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
    // Die Menge kommt herein, wie sie in der Nutzlast steht — auch eine
    // gebrochene. Sie abzuschneiden (das Dart-Vorbild tut es mit `toInt()`)
    // waere hier falsch: dort erzwingt es das `int`-Modell der Sprache, hier
    // gaebe es lautlos einen anderen Betrag als den signierten. Am HTTP-API
    // haengt auch fremde Software, und das Backend prueft bei den Positionen
    // allein `unitPriceCents` auf Ganzzahligkeit — ein solcher Beleg ist also
    // ausstellbar. Er muss sich dann anzeigen und drucken lassen, wie er
    // signiert wurde. Streng ist stattdessen der Schreibpfad (siehe
    // [pruefeMenge]): aus diesem Paket geht keine gebrochene Menge hinaus.
    quantity: menge ?? 0,
    // Fehlt der Steuersatz voellig, gibt es keinen rohen Wert zum Erhalten;
    // dann gilt wie im Dart-Vorbild 0 % (das Backend prueft `vat` als Pflicht,
    // der Fall entsteht also nur bei einer kaputten Nutzlast).
    vat: satz != null ? readVatRateByRate(satz) : VatRate.vat0,
    priceCents: cents != null ? Math.round(cents) : euro != null ? Math.round(euro * 100) : 0,
    // Trinkgeld-Felder nur, wenn es wirklich eine Tip-Position ist: eine
    // Warenzeile bleibt so schlank wie bisher (Golden-Belege, deepEqual).
    ...(payload.kind === 'tip'
      ? {
          kind: 'tip' as const,
          recipient: payload.recipient ?? null,
          ...(payload.paymentMethod != null ? { paymentMethod: payload.paymentMethod } : {}),
        }
      : {}),
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

/**
 * Zeilensumme in Cent. Bei einer selbst erzeugten Position ist sie exakt:
 * ganze Menge mal ganze Cent. Bei einem fremd erzeugten Beleg mit gebrochener
 * Menge ist sie folgerichtig gebrochen — das ist der signierte Betrag, und ihn
 * zu runden hiesse, einen anderen zu drucken.
 */
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
 * mitsigniert. Der gedruckte Beleg wiese dann einen anderen Betrag aus als der
 * signierte, und ein Storno darauf traegt eine Menge, die es nie gab. Deshalb
 * faellt die Menge hier, vor dem Senden, und nicht spaeter still.
 *
 * Der Lesepfad tut das ausdruecklich **nicht** (siehe
 * [fromReceiptItemPayload]): ein fremd erzeugter Beleg muss sich anzeigen
 * lassen, wie er signiert wurde.
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
