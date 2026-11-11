import { VatRate } from '../enums/index.js';
import { readVatRateByRate, requireVatRateByRate } from './enum-payload.js';
import { isReturnDisposition, type ReturnDisposition } from './cancellation.js';

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
   * [ReceiptCommonOptions.tip]) oder Rabatt-Position (`distributeDiscount`).
   * Mitarbeiter-Trinkgeld ist Durchlaeufer (0 %, kein Umsatz),
   * Inhaber-Trinkgeld (`recipient.owner`) Umsatz. Rabatt-Positionen sind
   * negative Entgeltminderungen je Steuersatz; die Kennzeichnung steuert nur
   * die Bon-Darstellung (Summenzeile mit Aufteilung), nie die Beträge.
   * `invoice_payment`: Zahlung auf Rechnung (Zahlungsbeleg, nur vom Server; Bezug in
   * `Receipt.invoicePayments`), siehe [isInvoicePaymentItem].
   */
  kind?: 'tip' | 'discount' | 'voucher' | 'voucher_float' | 'deposit' | 'deposit_return' | 'invoice_payment';
  /** Empfaenger der Trinkgeld-Position; `null` = nicht zugeordnet. */
  recipient?: TipRecipient | null;
  /** Zahlart der Trinkgeld-Position (kann von der des Belegs abweichen). */
  paymentMethod?: string;
  /**
   * Nur Personal-Trinkgeld: hat der Empfaenger das Geld schon (`true`) oder
   * behaelt der Betrieb es und schuldet es (`false`)? Fehlt bei Altbelegen.
   */
  receivedImmediately?: boolean;
  /**
   * Nur Personal-Trinkgeld bar: die Mitarbeiterin hat es beim Verkauf gleich
   * eingesteckt („gleich behalten“). Nur ein Merkmal fuer den Kassenstand;
   * fehlt sonst.
   */
  keptByEmployee?: boolean;
  /**
   * Artikel-Verweis (Artikelstamm) — Grundlage der Erloesgruppen-Zuordnung
   * im Bericht. Optional; Handeingaben haben keinen.
   */
  articleId?: string;
  /** Nur an Storno-Zeilen mit `articleId`: Index der Position im Original. */
  originalIndex?: number;
  /** Nur an Storno-Zeilen mit `articleId`: wohin die Ware ging (Lager-Kern Stufe 2). */
  returnDisposition?: ReturnDisposition;
  /**
   * Zusatz-Kacheln (1.27.0): Index der Hauptposition im selben Beleg; nur an
   * Zusatzpositionen. Der Server prueft: ganze Zahl, zeigt nach vorne auf eine
   * Warenposition, die selbst kein Zusatz ist (`invalid_add_on_reference`).
   */
  addOnOf?: number;
  /**
   * Pfand & Leergut: Pfandart (Kennung aus `getKasseSettings` `deposit.depositTypes[].id`); nur an
   * `deposit`- und `deposit_return`-Zeilen. Der Server setzt Pfandzeilen aus den Artikeln und rechnet
   * den Betrag selbst; bei einer ausdruecklichen Zeile des Aufrufers (ohne `articleId`) prueft er sie.
   */
  depositTypeId?: string;
  /** Index der Warenposition im selben Beleg, zu der die Pfandzeile gehoert (nur `deposit`). */
  depositFor?: number;
  /** Art der Pfandart zum Belegzeitpunkt: Einweg oder Mehrweg. */
  depositKind?: 'single_use' | 'reusable';
  /** Pfand je Stueck in Cent bei einer Pfandzeile; der Zeilenpreis ist Menge mal dieser Betrag. */
  perUnit?: number;
  /** Strichcode des Gebindes (GTIN), falls bekannt. */
  gtin?: string;
  /** Strichcode des Artikels (EAN), falls bekannt. */
  ean?: string;
  /** Das Gebinde wurde im Betrieb selbst befuellt (eigene Abfuellung). */
  ownFilling?: boolean;
  /** Gelernte Leergut-Codes der Zeile (Code -> Menge); nur an `deposit_return`. */
  codes?: Record<string, number>;
}

/** Pfandzeile (Pfand zum Verkauf)? Die eine Erkennungsstelle — niemand prueft `kind` selbst. */
export function isDepositItem(item: ReceiptItem | ReceiptItemPayloadRead): boolean {
  return item != null && (item as { kind?: unknown }).kind === 'deposit';
}

/** Leergutzeile (Ruecknahme, negativer Betrag)? */
export function isDepositReturnItem(item: ReceiptItem | ReceiptItemPayloadRead): boolean {
  return item != null && (item as { kind?: unknown }).kind === 'deposit_return';
}

/**
 * Zahlung auf Rechnung (Zahlungsbeleg)? Die Position zaehlt im RKSV-Feld „Null“, ist aber kein
 * steuerfreier Umsatz: die Umsatzsteuer steht auf der Rechnung. Am Bon steht sie ohne Satzkennzeichen
 * und nicht in der Steuertabelle. Ein Beleg mit einer solchen Position besteht nur aus solchen.
 */
export function isInvoicePaymentItem(item: ReceiptItem | ReceiptItemPayloadRead): boolean {
  return item != null && (item as { kind?: unknown }).kind === 'invoice_payment';
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

/** Rabatt-Position? Die eine Erkennungsstelle — niemand prueft `kind` selbst. */
export function isDiscountItem(item: ReceiptItem | ReceiptItemPayloadRead): boolean {
  return item != null && (item as { kind?: unknown }).kind === 'discount';
}

/**
 * Gutschein-Position (Server, neue Gutscheinform)? `voucher` ist eine
 * Einloesung oder ein Verkauf mit Umsatzsteuer-Wirkung, siehe
 * [isVoucherFloatItem] fuer den durchlaufenden Posten.
 */
export function isVoucherItem(item: ReceiptItem | ReceiptItemPayloadRead): boolean {
  return item != null && (item as { kind?: unknown }).kind === 'voucher';
}

/** Gutschein-Position als durchlaufender Posten (Mehrzweck: Verkauf, Auszahlung)? */
export function isVoucherFloatItem(item: ReceiptItem | ReceiptItemPayloadRead): boolean {
  return item != null && (item as { kind?: unknown }).kind === 'voucher_float';
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
  /** Trinkgeld-/Rabatt-/Gutschein-Kennzeichnung, siehe [ReceiptItem.kind]. */
  kind?: 'tip' | 'discount' | 'voucher' | 'voucher_float' | 'deposit' | 'deposit_return' | 'invoice_payment';
  recipient?: TipRecipient | null;
  paymentMethod?: string;
  receivedImmediately?: boolean;
  /** Trinkgeld-Position, siehe [ReceiptItem.keptByEmployee]; nur `true`. */
  keptByEmployee?: boolean;
  /** Artikel-Verweis, siehe [ReceiptItem.articleId]. */
  articleId?: string;
  /** Hauptposition eines Zusatzes, siehe [ReceiptItem.addOnOf]. */
  addOnOf?: number;
  /** Pfandzeile, siehe [ReceiptItem.depositTypeId] und die folgenden Felder. */
  depositTypeId?: string;
  depositFor?: number;
  depositKind?: 'single_use' | 'reusable';
  perUnit?: number;
  gtin?: string;
  ean?: string;
  ownFilling?: boolean;
  codes?: Record<string, number>;
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
  /** Trinkgeld-Position, siehe [ReceiptItem.receivedImmediately]. */
  receivedImmediately?: boolean | null;
  /** Trinkgeld-Position, siehe [ReceiptItem.keptByEmployee]. */
  keptByEmployee?: boolean | null;
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
  /** Artikel-Verweis, siehe [ReceiptItem.articleId]. */
  articleId?: string | null;
  /** Storno-Zeile mit `articleId`: Index im Original, siehe [ReceiptItem.originalIndex]. */
  originalIndex?: number | null;
  /** Storno-Zeile mit `articleId`: Rueckgabe-Wahl, siehe [ReceiptItem.returnDisposition]. */
  returnDisposition?: string | null;
  /** Hauptposition eines Zusatzes, siehe [ReceiptItem.addOnOf]. */
  addOnOf?: number | null;
  /** Pfandzeile, siehe [ReceiptItem.depositTypeId] und die folgenden Felder. */
  depositTypeId?: string | null;
  depositFor?: number | null;
  depositKind?: string | null;
  perUnit?: number | null;
  gtin?: string | null;
  ean?: string | null;
  ownFilling?: boolean | null;
  codes?: Record<string, number> | null;
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
    if (typeof item.receivedImmediately === 'boolean') nutzlast.receivedImmediately = item.receivedImmediately;
    if (item.keptByEmployee === true) nutzlast.keptByEmployee = true;
  }
  // Rabatt-Kennzeichnung reist mit — sonst kaeme ein Storno dieser Position
  // am Bon wieder als gewoehnliche Warenzeile mit "1 x" an.
  if (item.kind === 'discount') nutzlast.kind = 'discount';
  // Gutschein-Positionen (vom Server) reisen mit: der Cache der Kasse schreibt
  // gelesene Belege wieder, und ein Wunsch an den Server traegt sie nie
  // (createReceipt weist sie als voucher_invalid ab).
  if (item.kind === 'voucher' || item.kind === 'voucher_float') nutzlast.kind = item.kind;
  // Zahlung auf Rechnung (vom Server): reist mit wie die Gutschein-Positionen; ein Wunsch an den Server
  // traegt sie nie (createReceipt weist sie ausser beim Selbstaufruf ab).
  if (item.kind === 'invoice_payment') nutzlast.kind = 'invoice_payment';
  // Pfand & Leergut: Kennzeichen und Felder reisen mit (Cache schreibt gelesene Belege wieder; ein Wunsch an
  // den Server traegt `deposit` nie mit `articleId`, siehe createReceiptParams).
  if (item.kind === 'deposit' || item.kind === 'deposit_return') {
    nutzlast.kind = item.kind;
    if (typeof item.depositTypeId === 'string' && item.depositTypeId !== '') nutzlast.depositTypeId = item.depositTypeId;
    if (istIndex(item.depositFor)) nutzlast.depositFor = item.depositFor;
    if (item.depositKind === 'single_use' || item.depositKind === 'reusable') nutzlast.depositKind = item.depositKind;
    if (typeof item.perUnit === 'number' && Number.isFinite(item.perUnit)) nutzlast.perUnit = item.perUnit;
    if (typeof item.gtin === 'string' && item.gtin !== '') nutzlast.gtin = item.gtin;
    if (typeof item.ean === 'string' && item.ean !== '') nutzlast.ean = item.ean;
    if (typeof item.ownFilling === 'boolean') nutzlast.ownFilling = item.ownFilling;
    const codes = leergutCodes(item.codes);
    if (codes != null) nutzlast.codes = codes;
  }
  // Artikel-Verweis reist mit (Erloesgruppen im Bericht); leere Werte nicht.
  if (item.articleId != null && item.articleId !== '') nutzlast.articleId = item.articleId;
  // Zusatz-Kacheln: Verweis auf die Hauptposition nur, wenn gesetzt.
  if (istIndex(item.addOnOf)) nutzlast.addOnOf = item.addOnOf;
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
          ...(typeof payload.receivedImmediately === 'boolean' ? { receivedImmediately: payload.receivedImmediately } : {}),
          ...(payload.keptByEmployee === true ? { keptByEmployee: true } : {}),
        }
      : payload.kind === 'discount'
        ? { kind: 'discount' as const }
        : payload.kind === 'voucher' || payload.kind === 'voucher_float' || payload.kind === 'invoice_payment'
          ? { kind: payload.kind }
          : payload.kind === 'deposit' || payload.kind === 'deposit_return'
            ? {
                kind: payload.kind,
                ...(typeof payload.depositTypeId === 'string' && payload.depositTypeId !== '' ? { depositTypeId: payload.depositTypeId } : {}),
                ...(istIndex(payload.depositFor) ? { depositFor: payload.depositFor } : {}),
                ...(payload.depositKind === 'single_use' || payload.depositKind === 'reusable' ? { depositKind: payload.depositKind } : {}),
                ...(typeof payload.perUnit === 'number' && Number.isFinite(payload.perUnit) ? { perUnit: payload.perUnit } : {}),
                ...(typeof payload.gtin === 'string' && payload.gtin !== '' ? { gtin: payload.gtin } : {}),
                ...(typeof payload.ean === 'string' && payload.ean !== '' ? { ean: payload.ean } : {}),
                ...(typeof payload.ownFilling === 'boolean' ? { ownFilling: payload.ownFilling } : {}),
                ...(leergutCodes(payload.codes) != null ? { codes: leergutCodes(payload.codes)! } : {}),
              }
            : {}),
    // Artikel-Verweis erhalten (Storno-Spiegelung schreibt ihn wieder mit).
    ...(typeof payload.articleId === 'string' && payload.articleId !== '' ? { articleId: payload.articleId } : {}),
    // Lager: Bezug und Rueckgabe-Wahl einer Storno-Zeile (nur gelesen; ein
    // unbekannter Wert faellt weg wie am Rand des Servers).
    ...(Number.isInteger(payload.originalIndex) && (payload.originalIndex as number) >= 0 ? { originalIndex: payload.originalIndex as number } : {}),
    ...(isReturnDisposition(payload.returnDisposition) ? { returnDisposition: payload.returnDisposition } : {}),
    // Zusatz-Kacheln: Verweis auf die Hauptposition (nur eine ganze Zahl >= 0).
    ...(istIndex(payload.addOnOf) ? { addOnOf: payload.addOnOf } : {}),
  };
}

/** Gelernte Codes (Code -> ganze Menge >= 1); ohne brauchbaren Eintrag `undefined`. */
function leergutCodes(wert: unknown): Record<string, number> | undefined {
  if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) return undefined;
  const raus: Record<string, number> = {};
  for (const [code, menge] of Object.entries(wert as Record<string, unknown>)) {
    if (code !== '' && Number.isInteger(menge) && (menge as number) >= 1) raus[code] = menge as number;
  }
  return Object.keys(raus).length > 0 ? raus : undefined;
}

function istIndex(wert: unknown): wert is number {
  return Number.isInteger(wert) && (wert as number) >= 0;
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
