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

interface Zeile {
  index: number;
  rateBp: number;
  /** Zeilenbetrag als Zaehler ueber E, im Preismodus der Rechnung. */
  L: bigint;
  netCents: number;
  grossCents: number;
}

/**
 * Verteilt die Zeilenbetraege eines Satzes so, dass sie genau die Satzsumme
 * ergeben. Startwert ist die kaufmaennisch gerundete Zeile; der Rest geht
 * einzeln an die Zeilen, bei denen das Runden am meisten weggenommen (bzw.
 * zugegeben) hat. Verglichen wird auf dem Bruch, nie in Gleitkomma; bei
 * Gleichstand bekommt die fruehere Zeile den Cent. Eine Zeile ueber 0 bekommt
 * nie einen Cent — sonst stuende auf dem Blatt ein Betrag, den die Position
 * nicht hat.
 */
function verteile(
  gruppe: readonly Zeile[],
  feld: 'netCents' | 'grossCents',
  faktor: bigint,
  nenner: bigint,
  ziel: bigint,
): void {
  const werte = gruppe.map((z) => {
    const zaehler = z.L * faktor;
    return { z, zaehler, wert: rund(zaehler, nenner) };
  });
  let rest = ziel - werte.reduce((s, w) => s + w.wert, 0n);
  if (rest !== 0n) {
    const schritt = rest > 0n ? 1n : -1n;
    const kandidaten = werte
      .filter((w) => w.zaehler !== 0n)
      .sort((a, b) => {
        const da = (a.zaehler - a.wert * nenner) * schritt;
        const db = (b.zaehler - b.wert * nenner) * schritt;
        if (da !== db) return db > da ? 1 : -1;
        return a.z.index - b.z.index;
      });
    for (let k = 0; rest !== 0n && kandidaten.length > 0; k = (k + 1) % kandidaten.length) {
      kandidaten[k]!.wert += schritt;
      rest -= schritt;
    }
  }
  for (const w of werte) w.z[feld] = Number(w.wert);
}

export function rechnungRechnen(
  positionen: readonly RechenPosition[],
  optionen: RechenOptionen,
): RechenErgebnis {
  const steuerfrei = STEUERFREIE_FAELLE.includes(optionen.taxScheme ?? 'normal');
  const bruttoPreise = optionen.priceMode === 'gross' && !steuerfrei;

  const grenze = BigInt(BETRAG_GRENZE_CENTS) * E;
  const zeilen: Zeile[] = positionen.map((p, index) => {
    const preis = BigInt(ganzzahl(p.unitPriceMicros, 'unitPriceMicros', index));
    const menge = BigInt(ganzzahl(p.quantityMilli, 'quantityMilli', index));
    const rabatt = BigInt(ganzzahl(p.discountBp ?? 0, 'discountBp', index));
    const satz = ganzzahl(p.vatRateBp ?? 0, 'vatRateBp', index);
    const L = preis * menge * (10_000n - rabatt) * 1_000_000n;
    if ((L < 0n ? -L : L) > grenze) {
      throw new RechenFehler(
        'amount_too_large',
        `items[${index}] uebersteigt ${BETRAG_GRENZE_CENTS} Cent`,
        'unitPriceMicros',
        index,
      );
    }
    return { index, rateBp: steuerfrei ? 0 : satz, L, netCents: 0, grossCents: 0 };
  });

  const jeSatz = new Map<number, Zeile[]>();
  for (const z of zeilen) {
    const gruppe = jeSatz.get(z.rateBp);
    if (gruppe) gruppe.push(z);
    else jeSatz.set(z.rateBp, [z]);
  }

  const byRate: SatzSumme[] = [];
  for (const [rateBp, gruppe] of jeSatz) {
    const r = BigInt(rateBp);
    const S = gruppe.reduce((s, z) => s + z.L, 0n);
    let netCents: bigint;
    let vatCents: bigint;
    let grossCents: bigint;
    if (bruttoPreise) {
      grossCents = rund(S, E);
      netCents = rund(grossCents * 10_000n, 10_000n + r);
      vatCents = grossCents - netCents;
    } else {
      netCents = rund(S, E);
      vatCents = rund(S * r, E * 10_000n);
      grossCents = netCents + vatCents;
    }
    if (bruttoPreise) {
      verteile(gruppe, 'netCents', 10_000n, E * (10_000n + r), netCents);
      verteile(gruppe, 'grossCents', 1n, E, grossCents);
    } else {
      verteile(gruppe, 'netCents', 1n, E, netCents);
      verteile(gruppe, 'grossCents', 10_000n + r, E * 10_000n, grossCents);
    }
    byRate.push({
      rateBp,
      netCents: Number(netCents),
      vatCents: Number(vatCents),
      grossCents: Number(grossCents),
    });
  }
  byRate.sort((a, b) => b.rateBp - a.rateBp);

  const summe = (feld: 'netCents' | 'vatCents' | 'grossCents'): number =>
    byRate.reduce((s, r) => s + r[feld], 0);

  const ergebnis: RechenErgebnis = {
    netCents: summe('netCents'),
    vatCents: summe('vatCents'),
    grossCents: summe('grossCents'),
    byRate,
    lines: zeilen.map((z) => ({ netCents: z.netCents, grossCents: z.grossCents, rateBp: z.rateBp })),
  };
  for (const feld of ['netCents', 'vatCents', 'grossCents'] as const) {
    if (Math.abs(ergebnis[feld]) > BETRAG_GRENZE_CENTS) {
      throw new RechenFehler('amount_too_large', `Die Rechnung uebersteigt ${BETRAG_GRENZE_CENTS} Cent (${feld})`);
    }
  }
  return ergebnis;
}

export type UmwandlungsGrund = 'kein_zahlwert' | 'nachkommastellen' | 'ausserhalb';

export type Umwandlung =
  | { ok: true; position: RechenPosition & Record<string, unknown> }
  | { ok: false; feld: 'unitPrice' | 'quantity' | 'vatRate' | 'discountPct'; grund: UmwandlungsGrund };

/**
 * Wandelt eine Zahl ueber ihren kuerzesten Dezimaltext in eine Ganzzahl mit
 * `stellen` Nachkommastellen. Kein Gleitkomma-Rechnen: `0.1 * 1000` ist
 * 100.00000000000001, `String(0.1)` dagegen genau "0.1". Mehr Stellen als
 * erlaubt ergeben `null` — auch Gleitkomma-Rauschen wie 0.30000000000000004,
 * das mit 17 Stellen dasteht.
 */
function ganzAusDezimaltext(wert: number, stellen: number): number | null {
  if (typeof wert !== 'number' || !Number.isFinite(wert)) return null;
  const treffer = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(wert));
  if (!treffer) return null;
  const [, vorzeichen = '', ganzTeil = '0', bruchTeil = '', hoch = '0'] = treffer;
  const verschiebung = Number(hoch);
  let ziffern = `${ganzTeil}${bruchTeil}`;
  let nachkomma = bruchTeil.length - verschiebung;
  if (nachkomma < 0) {
    ziffern += '0'.repeat(-nachkomma);
    nachkomma = 0;
  }
  if (nachkomma > stellen) {
    // Nur echte Nullen am Ende duerfen wegfallen (1.20 bei 1 Stelle).
    const zuviel = nachkomma - stellen;
    if (!/^0+$/.test(ziffern.slice(-zuviel))) return null;
    ziffern = ziffern.slice(0, -zuviel);
    nachkomma = stellen;
  }
  const skaliert = `${ziffern}${'0'.repeat(stellen - nachkomma)}`;
  const zahl = Number(`${vorzeichen}${skaliert}`);
  return Number.isSafeInteger(zahl) ? zahl : null;
}

const EURO_FELDER = ['unitPrice', 'quantity', 'vatRate', 'discountPct'] as const;

/**
 * Euro-Position → Ganzzahl-Form, verlustfrei oder mit Grund abgelehnt. Die
 * EINE Stelle, die das tut: Panel (beim Lesen), SEPA-Lauf, Umrechnungsskript
 * und das Festschreiben benutzen alle diese Funktion, damit niemand eine
 * zweite Auslegung baut.
 *
 * Eine Position, die schon `unitPriceMicros` traegt, kommt unveraendert
 * zurueck — die Funktion ist die Formweiche, nicht eine blinde Umrechnung.
 *
 * Fehlende Menge und fehlender Satz gelten als 0, weil der Server bisher so
 * abgerechnet hat. Ein fehlender Preis dagegen ist NIE 0: sonst wuerde eine
 * Position, der nur der Preis fehlt, still zur 0-€-Zeile.
 */
export function positionAusEuro(item: Record<string, unknown>): Umwandlung {
  if (typeof item.unitPriceMicros === 'number') {
    return { ok: true, position: item as unknown as RechenPosition & Record<string, unknown> };
  }

  const roh = item.unitPrice;
  if (typeof roh !== 'number' || !Number.isFinite(roh)) {
    return { ok: false, feld: 'unitPrice', grund: 'kein_zahlwert' };
  }
  const micros = ganzAusDezimaltext(Math.abs(roh), 6);
  if (micros === null) return { ok: false, feld: 'unitPrice', grund: 'nachkommastellen' };
  if (micros > GRENZEN.unitPriceMicros[1]) return { ok: false, feld: 'unitPrice', grund: 'ausserhalb' };

  const zahl = (feld: 'quantity' | 'vatRate' | 'discountPct', stellen: number, max: number):
    | { ok: true; wert: number }
    | { ok: false; grund: UmwandlungsGrund } => {
    const w = item[feld];
    if (w === undefined || w === null) return { ok: true, wert: 0 };
    if (typeof w !== 'number' || !Number.isFinite(w)) return { ok: false, grund: 'kein_zahlwert' };
    const ganz = ganzAusDezimaltext(w, stellen);
    if (ganz === null) return { ok: false, grund: 'nachkommastellen' };
    if (ganz < (feld === 'quantity' ? -max : 0) || ganz > max) return { ok: false, grund: 'ausserhalb' };
    return { ok: true, wert: ganz };
  };

  const menge = zahl('quantity', 3, GRENZEN.quantityMilli[1]);
  if (!menge.ok) return { ok: false, feld: 'quantity', grund: menge.grund };
  const satz = zahl('vatRate', 2, 10_000);
  if (!satz.ok) return { ok: false, feld: 'vatRate', grund: satz.grund };
  const rabatt = zahl('discountPct', 2, 10_000);
  if (!rabatt.ok) return { ok: false, feld: 'discountPct', grund: rabatt.grund };

  const rest: Record<string, unknown> = { ...item };
  for (const feld of EURO_FELDER) delete rest[feld];

  return {
    ok: true,
    position: {
      ...rest,
      unitPriceMicros: micros,
      quantityMilli: roh < 0 ? -menge.wert : menge.wert,
      discountBp: rabatt.wert,
      vatRateBp: satz.wert,
    },
  };
}
