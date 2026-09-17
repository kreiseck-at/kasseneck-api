/**
 * Der Rechenkern der Rechnung — exakt, in ganzen Zahlen.
 *
 * Eine Zeile ist ein Bruch: Preis (µ€) × Menge (Tausendstel) × Rabattanteil
 * (Hundertstel-Prozent). Multipliziert man die Skalen, ist die kleinste Einheit
 * 10⁻¹⁷ Cent — das passt in keine Gleitkommazahl und in keine 53-Bit-Ganzzahl,
 * also rechnet der Kern mit BigInt. Gerundet wird genau EINMAL je USt-Satz, auf
 * dem Bruch, kaufmaennisch (halbe Einheit vom Nullpunkt weg).
 *
 * Warum das so streng ist: Vier Umsetzungen (Server, dieses Paket, Dart, Panel)
 * mussten bisher dieselbe Reihenfolge von Gleitkomma-Schritten nachbauen, damit
 * Grenzfaelle gleich runden. Mit Ganzzahlen gibt es keine Reihenfolge mehr, an
 * der etwas auseinanderlaufen koennte.
 *
 * Dieser Unterpfad ist rein: kein Transport, kein api_key, keine Abhaengigkeit
 * ausser Typen. Er wird im Browser gebuendelt (Panel) und im Server geladen.
 *
 * Spec: docs/specs/2026-09-17-rechnung-ganzzahlen-design.md § 5.
 */

import type { PriceMode, TaxScheme } from './vertrag.js';

/** Skala des Zeilenbruchs: 10⁻¹⁷ Cent. */
const E = 10n ** 17n;

/** Hoechster Betrag je Zeile und je Rechnung: 999.999.999,99 €. */
export const BETRAG_GRENZE_CENTS = 99_999_999_999;

/** Steuerfaelle, in denen die Rechnung keine Steuer ausweist: jede Zeile zaehlt zu 0 %. */
export const STEUERFREIE_FAELLE: readonly TaxScheme[] = Object.freeze([
  'smallBusiness',
  'reverseCharge',
  'igLieferung',
  'exportThirdCountry',
  'domesticReverseCharge',
  'outsideScope',
]);

/** Eine Position in gespeicherter Form — alle Werte ganzzahlig. */
export interface RechenPosition {
  /** Einzelpreis in Millionstel Euro, 0 … 10¹². */
  unitPriceMicros: number;
  /** Menge in Tausendstel; negativ = Abzugszeile, 0 = Textzeile. */
  quantityMilli: number;
  /** Rabatt in Hundertstel-Prozent, 0 … 10000 (ohne Angabe 0). */
  discountBp?: number;
  /** USt-Satz in Hundertstel-Prozent, 0 … 10000 (ohne Angabe 0). */
  vatRateBp?: number;
}

export interface RechenOptionen {
  priceMode: PriceMode;
  /** Ohne Angabe `normal`. */
  taxScheme?: TaxScheme;
}

export interface SatzSumme {
  rateBp: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface ZeilenBetrag {
  netCents: number;
  grossCents: number;
  /** Der Satz, mit dem die Zeile gerechnet wurde (bei steuerfreiem Fall 0). */
  rateBp: number;
}

export interface RechenErgebnis {
  netCents: number;
  vatCents: number;
  grossCents: number;
  /** Absteigend nach `rateBp`. */
  byRate: SatzSumme[];
  /** Je Position, in der Reihenfolge der Eingabe. */
  lines: ZeilenBetrag[];
}

export type RechenFehlerCode = 'amount_too_large' | 'kein_ganzzahlwert' | 'ausserhalb';

/** Fehler des Kerns — mit Code, Feld und Index, damit die API daraus einen Feldfehler machen kann. */
export class RechenFehler extends Error {
  readonly code: RechenFehlerCode;
  readonly feld?: string;
  readonly index?: number;

  constructor(code: RechenFehlerCode, nachricht: string, feld?: string, index?: number) {
    super(nachricht);
    this.name = 'RechenFehler';
    this.code = code;
    this.feld = feld;
    this.index = index;
  }
}

/**
 * `a / b` kaufmaennisch gerundet, halbe Einheit vom Nullpunkt weg; `b` > 0.
 *
 * Ohne Gleitkomma: `(2·|a| + b) / (2·b)` ist genau dann eins groesser, wenn der
 * Rest mindestens die halbe Einheit betraegt.
 */
export function rund(a: bigint, b: bigint): bigint {
  const negativ = a < 0n;
  const betrag = negativ ? -a : a;
  const ganz = (2n * betrag + b) / (2n * b);
  return negativ ? -ganz : ganz;
}

const GRENZEN = {
  unitPriceMicros: [0, 1_000_000_000_000],
  quantityMilli: [-1_000_000_000_000, 1_000_000_000_000],
  discountBp: [0, 10_000],
  vatRateBp: [0, 10_000],
} as const;

type GrenzFeld = keyof typeof GRENZEN;

function ganzzahl(wert: unknown, feld: GrenzFeld, index: number): number {
  if (typeof wert !== 'number' || !Number.isInteger(wert)) {
    throw new RechenFehler('kein_ganzzahlwert', `items[${index}].${feld} muss eine ganze Zahl sein`, feld, index);
  }
  const [min, max] = GRENZEN[feld];
  if (wert < min || wert > max) {
    throw new RechenFehler('ausserhalb', `items[${index}].${feld} liegt ausserhalb von ${min} … ${max}`, feld, index);
  }
  return wert;
}

export function rechnungRechnen(
  positionen: readonly RechenPosition[],
  optionen: RechenOptionen,
): RechenErgebnis {
  const steuerfrei = STEUERFREIE_FAELLE.includes(optionen.taxScheme ?? 'normal');
  for (const [index, p] of positionen.entries()) {
    ganzzahl(p.unitPriceMicros, 'unitPriceMicros', index);
    ganzzahl(p.quantityMilli, 'quantityMilli', index);
    ganzzahl(p.discountBp ?? 0, 'discountBp', index);
    ganzzahl(p.vatRateBp ?? 0, 'vatRateBp', index);
  }
  void steuerfrei;
  void E;
  return { netCents: 0, vatCents: 0, grossCents: 0, byRate: [], lines: [] };
}
