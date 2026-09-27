import { ReceiptType, type ReceiptTypeKey, VoucherAction, VoucherType } from '../enums/index.js';
import type { ReceiptItem } from '../models/receipt-item.js';
import type { Voucher } from '../models/voucher.js';

/**
 * Zahlbetrag eines Belegs in ganzen Cent: Zwilling von
 * `beleg-toepfe.belegToepfe(...).zaehlerDeltaCents` plus
 * `zahlungen-core.wertgutscheinFlussCents` im Backend (Nachtrag §8).
 *
 * `createReceipt` hat keinen Probelauf. Unter `/v3` ist `payments[]` Pflicht,
 * und die Summe der Zahlungen muss genau diesen Betrag treffen; wer die
 * Zahlungen baut (Kartenterminal, Rueckgeld), rechnet ihn hier vorher aus.
 * Das Netz bleibt der Server: trifft die Summe nicht, antwortet er mit
 * `payments_sum_mismatch` und `expectedCents`, ohne eine Belegnummer zu
 * verbrauchen. Dieses Paket wiederholt dann nie selbst.
 *
 * Gerechnet wird wie im Backend:
 * - Positionen je Steuersatz in die RKSV-Toepfe (20, 10, 13, 0, 19 und 4,9 %;
 *   jeder andere Satz in `amountRatOthers`).
 * - Ein Rabattgutschein mindert die Toepfe anteilig (abgerundet je Topf, der
 *   Rest-Cent an den groessten Topf), hoechstens bis zur Summe der Toepfe.
 * - Personal-Trinkgeld ist ein durchlaufender Posten: es kommt erst nach dem
 *   Rabatt in den Null-%-Topf und wird nie rabattiert. Inhaber-Trinkgeld ist
 *   Umsatz: anteilig auf die Saetze der Ware verteilt und mitrabattiert.
 * - Wertgutscheine beruehren die Toepfe nicht, sie sind Zahlungsmittel:
 *   verkauft erhoehen, eingeloest senken sie den Zahlbetrag (am Storno
 *   umgekehrt).
 * - Start- und Nullbeleg haben den Zahlbetrag 0.
 *
 * Geld nur in ganzen Cent. Das Backend rechnet die Toepfe in Euro-Gleitkomma;
 * hier ist jede Zwischensumme exakt (Menge als Dezimalbruch, Summen als
 * BigInt). Bei ganzen Mengen ist das Ergebnis dasselbe; bei Bruchmengen, deren
 * Topf genau auf einem halben Cent endet, kann die Gleitkommarechnung des
 * Servers einen Cent anders runden. Dann greift `payments_sum_mismatch`.
 */

/** Trinkgeld, wie `sellReceipt` es als `tip` schickt: Betrag und, ob der Empfaenger Inhaber ist. */
export interface ReceiptDueTip {
  cents: number;
  /**
   * `true`, wenn das Trinkgeld an den Inhaber geht (Umsatz mit USt). Das
   * weiss nur die Kasse: der Server loest den Empfaenger selbst auf. Ohne
   * Angabe gilt Personal-Trinkgeld.
   */
  owner?: boolean;
  /** Mehrere Empfaenger: je Anteil Betrag und Inhaber-Kennzeichen. Summe = `cents`. */
  recipients?: Array<{ cents: number; owner?: boolean }>;
}

export interface ReceiptDueOptions {
  /** Trinkgeld als Parameter (wie `tip` an `sellReceipt`); eine Zahl gilt als Personal-Trinkgeld. */
  tip?: number | ReceiptDueTip;
}

/** Die sechs RKSV-Toepfe in Cent, Namen wie am Beleg des Backends. */
export interface ReceiptDueBuckets {
  amountRateStandard: number;
  amountRateReduced1: number;
  amountRateReduced2: number;
  amountRateZero: number;
  amountRateSpecial: number;
  amountRatOthers: number;
}

export interface ReceiptDueBreakdown {
  /** Was die Zahlungen zusammen ergeben muessen. */
  dueCents: number;
  /** Delta des Umsatzzaehlers (Summe der Toepfe). */
  counterDeltaCents: number;
  /** Anteil der Wertgutscheine am Zahlbetrag. */
  valueVoucherFlowCents: number;
  /** Toepfe je auf Cent gerundet; `null` bei Start- und Nullbeleg. */
  bucketsCents: ReceiptDueBuckets | null;
}

type BelegArt = ReceiptType | ReceiptTypeKey | string;

const UMSATZ = new Set(['standard', 'cancellation', 'training']);
const TRINKGELD_ERLAUBT = new Set(['standard', 'training']);
const TOEPFE = ['amountRateStandard', 'amountRateReduced1', 'amountRateReduced2', 'amountRateZero', 'amountRateSpecial'] as const;
type Topf = (typeof TOEPFE)[number] | 'amountRatOthers';

/** Zahlbetrag in Cent, siehe Modulkommentar. */
export function receiptDueCents(items: readonly ReceiptItem[], vouchers: readonly Voucher[], receiptType: BelegArt, options: ReceiptDueOptions = {}): number {
  return receiptDueBreakdown(items, vouchers, receiptType, options).dueCents;
}

/** Wie [receiptDueCents], dazu Zaehler-Delta, Wertgutschein-Anteil und Toepfe. */
export function receiptDueBreakdown(
  items: readonly ReceiptItem[],
  vouchers: readonly Voucher[],
  receiptType: BelegArt,
  options: ReceiptDueOptions = {},
): ReceiptDueBreakdown {
  const art = belegArt(receiptType);
  if (options.tip != null && !TRINKGELD_ERLAUBT.has(art)) {
    throw new RangeError(`Zahlbetrag: Trinkgeld gibt es nur bei standard und training, nicht bei "${art}".`);
  }
  if (!UMSATZ.has(art)) {
    return { dueCents: 0, counterDeltaCents: 0, valueVoucherFlowCents: 0, bucketsCents: null };
  }

  // Jede Position als exakter Bruch in Cent: Zaehler / 10^k.
  const zeilen = items.map((item, i) => ({ satz: satzVon(item, i), wert: zeileExakt(item, i), art: trinkgeldArt(item) }));
  for (const trinkgeld of trinkgeldZeilen(options.tip, zeilen)) zeilen.push(trinkgeld);
  const nenner = zeilen.reduce((max, z) => (z.wert.nenner > max ? z.wert.nenner : max), 1n);
  const skaliert = (w: Bruch): bigint => w.zaehler * (nenner / w.nenner);

  // Personal-Trinkgeld heraus; Toepfe nur ueber Ware und Inhaber-Trinkgeld.
  const topf: Record<Topf, bigint> = { amountRateStandard: 0n, amountRateReduced1: 0n, amountRateReduced2: 0n, amountRateZero: 0n, amountRateSpecial: 0n, amountRatOthers: 0n };
  let personal = 0n;
  for (const z of zeilen) {
    if (z.art === 'staff') personal += skaliert(z.wert);
    else topf[topfFuerSatz(z.satz)] += skaliert(z.wert);
  }

  if (vouchers.length > 0) {
    let rabattCents = 0n;
    for (const [i, v] of vouchers.entries()) {
      if (v.action === VoucherAction.redeem && v.type === VoucherType.promo) rabattCents += BigInt(gutscheinCents(v, i));
    }
    const summe = TOEPFE.reduce((s, t) => s + topf[t], 0n);
    const nutzbar = rabattCents * nenner > summe ? runde(summe, nenner) : rabattCents;
    const cents = TOEPFE.map((t) => runde(topf[t], nenner));
    const basis = cents.reduce((s, c) => s + c, 0n);
    const anteil = cents.map(() => 0n);
    if (basis > 0n && nutzbar > 0n) {
      cents.forEach((c, i) => {
        anteil[i] = abrunden(nutzbar * c, basis);
      });
      const rest = nutzbar - anteil.reduce((s, a) => s + a, 0n);
      if (rest > 0n) {
        // Groesster Topf; bei Gleichstand der erste in fester Reihenfolge.
        let groesster = 0;
        for (let i = 1; i < cents.length; i++) if (cents[i]! > cents[groesster]!) groesster = i;
        if (cents[groesster]! > 0n) anteil[groesster] = anteil[groesster]! + rest;
      }
    }
    TOEPFE.forEach((t, i) => {
      topf[t] = (cents[i]! - anteil[i]!) * nenner;
    });
  }
  topf.amountRateZero += personal;

  const bucketsCents = Object.fromEntries(
    (Object.keys(topf) as Topf[]).map((t) => [t, sicher(runde(topf[t], nenner))]),
  ) as unknown as ReceiptDueBuckets;
  const counterDeltaCents = sicher(Object.values(bucketsCents).reduce((s, c) => s + BigInt(c), 0n));
  const valueVoucherFlowCents = wertgutscheinFluss(vouchers, art);
  return { dueCents: sicher(BigInt(counterDeltaCents) + BigInt(valueVoucherFlowCents)), counterDeltaCents, valueVoucherFlowCents, bucketsCents };
}

interface Bruch {
  zaehler: bigint;
  nenner: bigint;
}

interface Zeile {
  satz: number;
  wert: Bruch;
  art: 'staff' | 'owner' | null;
}

function belegArt(wert: BelegArt): string {
  const text = typeof wert === 'object' && wert !== null ? wert.value : wert;
  if (typeof text !== 'string' || !Object.prototype.hasOwnProperty.call(ReceiptType, text)) {
    throw new RangeError(`Zahlbetrag: unbekannter Belegtyp "${String(text)}".`);
  }
  return text;
}

function satzVon(item: ReceiptItem, i: number): number {
  const satz = typeof item.vat === 'number' ? item.vat : item.vat?.rate;
  if (typeof satz !== 'number' || !Number.isFinite(satz)) throw new RangeError(`Zahlbetrag: Position ${i + 1} ohne Steuersatz.`);
  return satz;
}

/** Wie `tip-core.tipKind`: Trinkgeld-Position des Personals oder des Inhabers. */
function trinkgeldArt(item: ReceiptItem): Zeile['art'] {
  if (item.kind !== 'tip') return null;
  return item.recipient?.owner === true ? 'owner' : 'staff';
}

/** Menge x Einzelpreis als exakter Bruch in Cent. */
function zeileExakt(item: ReceiptItem, i: number): Bruch {
  if (!Number.isSafeInteger(item.priceCents)) {
    throw new RangeError(`Zahlbetrag: Position ${i + 1} hat keinen ganzen Cent-Preis.`);
  }
  const menge = dezimal(item.quantity);
  if (menge == null) throw new RangeError(`Zahlbetrag: Position ${i + 1} hat keine gueltige Menge.`);
  return { zaehler: menge.zaehler * BigInt(item.priceCents), nenner: menge.nenner };
}

/** Eine endliche Zahl als Dezimalbruch (aus ihrer kuerzesten Schreibweise, nicht aus der Binaerform). */
function dezimal(zahl: number): Bruch | null {
  if (typeof zahl !== 'number' || !Number.isFinite(zahl)) return null;
  const teile = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(zahl));
  if (teile == null) return null;
  const [, vorzeichen, ganz, bruch = '', hoch = '0'] = teile;
  let ziffern = BigInt(`${ganz}${bruch}`);
  let stellen = bruch.length - Number(hoch);
  if (stellen < 0) {
    ziffern *= 10n ** BigInt(-stellen);
    stellen = 0;
  }
  if (stellen > 30) return null;
  return { zaehler: vorzeichen === '-' ? -ziffern : ziffern, nenner: 10n ** BigInt(stellen) };
}

function gutscheinCents(v: Voucher, i: number): number {
  if (!Number.isSafeInteger(v.valueCents)) throw new RangeError(`Zahlbetrag: Gutschein ${i + 1} hat keinen ganzen Cent-Wert.`);
  return v.valueCents as number;
}

function topfFuerSatz(satz: number): Topf {
  switch (satz) {
    case 20: return 'amountRateStandard';
    case 10: return 'amountRateReduced1';
    case 13: return 'amountRateReduced2';
    case 0: return 'amountRateZero';
    case 19: return 'amountRateSpecial';
    case 4.9: return 'amountRateSpecial';
    default: return 'amountRatOthers';
  }
}

/**
 * Trinkgeld aus dem Parameter als Positionen, wie `tip-core.buildTipItems`:
 * Personal in den Null-%-Topf, Inhaber anteilig auf die Saetze der Ware
 * (abgerundet je Satz, Rest an den Satz mit dem groessten Bruchanteil, bei
 * Gleichstand der hoehere Satz).
 */
function trinkgeldZeilen(tip: ReceiptDueOptions['tip'], zeilen: readonly Zeile[]): Zeile[] {
  if (tip == null) return [];
  const gesamt = typeof tip === 'number' ? tip : tip.cents;
  if (!Number.isSafeInteger(gesamt) || gesamt <= 0) throw new RangeError('Zahlbetrag: Trinkgeld muss eine ganze Zahl in Cent > 0 sein.');
  const anteile = typeof tip === 'number' ? [{ cents: gesamt, owner: false }] : tip.recipients ?? [{ cents: gesamt, owner: tip.owner === true }];
  const summe = anteile.reduce((s, a) => s + a.cents, 0);
  if (anteile.some((a) => !Number.isSafeInteger(a.cents) || a.cents <= 0) || summe !== gesamt) {
    throw new RangeError('Zahlbetrag: die Anteile des Trinkgelds ergeben nicht den Betrag.');
  }
  const basis = warenCentsJeSatz(zeilen);
  if ([...basis.values()].reduce((s, c) => s + c, 0n) <= 0n) {
    throw new RangeError('Zahlbetrag: Trinkgeld braucht mindestens eine Position mit Betrag.');
  }
  const raus: Zeile[] = [];
  for (const anteil of anteile) {
    if (anteil.owner !== true) {
      raus.push({ satz: 0, wert: { zaehler: BigInt(anteil.cents), nenner: 1n }, art: 'staff' });
      continue;
    }
    const teile = inhaberAnteile(BigInt(anteil.cents), basis);
    if (teile.length === 0) throw new RangeError('Zahlbetrag: Inhaber-Trinkgeld braucht mindestens eine Position mit Betrag.');
    for (const teil of teile) if (teil.cents !== 0n) raus.push({ satz: teil.satz, wert: { zaehler: teil.cents, nenner: 1n }, art: 'owner' });
  }
  return raus;
}

/** Warenbasis je Satz in Cent, je Satz einmal gerundet (ohne Trinkgeld-Positionen). */
function warenCentsJeSatz(zeilen: readonly Zeile[]): Map<number, bigint> {
  const roh = new Map<number, Bruch[]>();
  for (const z of zeilen) {
    if (z.art != null) continue;
    roh.set(z.satz, [...(roh.get(z.satz) ?? []), z.wert]);
  }
  const raus = new Map<number, bigint>();
  for (const [satz, werte] of roh) {
    const nenner = werte.reduce((max, w) => (w.nenner > max ? w.nenner : max), 1n);
    raus.set(satz, runde(werte.reduce((s, w) => s + w.zaehler * (nenner / w.nenner), 0n), nenner));
  }
  return raus;
}

function inhaberAnteile(cents: bigint, basis: Map<number, bigint>): Array<{ satz: number; cents: bigint }> {
  const saetze = [...basis.entries()].filter(([, b]) => b > 0n).sort(([a], [b]) => b - a);
  const gesamt = saetze.reduce((s, [, b]) => s + b, 0n);
  if (gesamt <= 0n) return [];
  const teile = saetze.map(([satz, b]) => ({ satz, cents: (cents * b) / gesamt, rest: (cents * b) % gesamt }));
  const offen = cents - teile.reduce((s, t) => s + t.cents, 0n);
  if (offen > 0n) {
    let bester = teile[0]!;
    for (const t of teile) if (t.rest > bester.rest || (t.rest === bester.rest && t.satz > bester.satz)) bester = t;
    bester.cents += offen;
  }
  return teile.map(({ satz, cents: c }) => ({ satz, cents: c }));
}

/** Wie `zahlungen-core.wertgutscheinFlussCents`: verkauft plus, eingeloest minus, am Storno umgekehrt. */
function wertgutscheinFluss(vouchers: readonly Voucher[], art: string): number {
  let cents = 0;
  for (const [i, v] of vouchers.entries()) {
    if (v.type !== VoucherType.value) continue;
    if (v.action === VoucherAction.sell) cents += gutscheinCents(v, i);
    else if (v.action === VoucherAction.redeem) cents -= gutscheinCents(v, i);
  }
  // `0 - 0` statt `-0`: ein negatives Null ist kein Cent-Betrag.
  return art === 'cancellation' ? 0 - cents : cents;
}

/** `Math.round(zaehler / nenner)`: kaufmaennisch, halbe Werte Richtung plus unendlich. */
function runde(zaehler: bigint, nenner: bigint): bigint {
  return abrunden(2n * zaehler + nenner, 2n * nenner);
}

/** Ganzzahlige Division mit Abrunden (auch fuer negative Zaehler). */
function abrunden(zaehler: bigint, nenner: bigint): bigint {
  const q = zaehler / nenner;
  return zaehler % nenner !== 0n && (zaehler < 0n) !== (nenner < 0n) ? q - 1n : q;
}

function sicher(wert: bigint): number {
  const zahl = Number(wert);
  if (!Number.isSafeInteger(zahl)) throw new RangeError('Zahlbetrag: Betrag ausserhalb des sicheren Zahlenbereichs.');
  return zahl;
}
