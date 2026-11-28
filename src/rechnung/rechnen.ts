/**
 * Der Rechenkern der Rechnung — exakt, in ganzen Zahlen.
 *
 * Eine Zeile ist ein Bruch: Preis (µ€) × Menge (Tausendstel) × Rabattanteil
 * (Hundertstel-Prozent). Multipliziert man die Skalen, ist die kleinste Einheit
 * 10⁻¹⁷ Cent — das passt in keine Gleitkommazahl und in keine 53-Bit-Ganzzahl,
 * also rechnet der Kern mit BigInt. Gerundet wird genau EINMAL je (Land, Satz,
 * Befreiung), auf dem Bruch, kaufmaennisch (halbe Einheit vom Nullpunkt weg).
 *
 * Warum das so streng ist: Vier Umsetzungen (Server, dieses Paket, Dart, Panel)
 * mussten bisher dieselbe Reihenfolge von Gleitkomma-Schritten nachbauen, damit
 * Grenzfaelle gleich runden. Mit Ganzzahlen gibt es keine Reihenfolge mehr, an
 * der etwas auseinanderlaufen koennte.
 *
 * Gruppiert und gerundet wird je (Land, Satz, Befreiung): eine deutsche Zeile
 * zu 19 % und eine oesterreichische zu 10 % sind zwei Gruppen, ebenso AT 0 %
 * neben DE 0 % Kleinunternehmer. Ohne Land gilt AT; eine Rechnung nur mit AT
 * rechnet und antwortet genau wie vor dem Umbau (Spec
 * 2026-11-27-ust-ausland-design.md § 7.2).
 *
 * Dieser Unterpfad ist rein: kein Transport, kein Zugangsschluessel, keine
 * Abhaengigkeit ausser Typen. Er wird im Browser gebuendelt (Panel) und im
 * Server geladen.
 *
 * Spec: docs/specs/2026-09-17-rechnung-ganzzahlen-design.md § 5.
 */

import type { PriceMode, TaxScheme } from './vertrag.js';

/** Skala des Zeilenbruchs: 10⁻¹⁷ Cent. */
const E = 10n ** 17n;

/** Hoechster Betrag je Zeile und je Rechnung: 999.999.999,99 €. */
export const BETRAG_GRENZE_CENTS = 99_999_999_999;

/**
 * Steuerfaelle, in denen die Rechnung keine oesterreichische Steuer ausweist:
 * jede AT-Zeile zaehlt zu 0 %. Eine Zeile mit fremder Steuer (`steuerLand`
 * nicht AT) behaelt ihren Satz.
 */
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
  /**
   * Land, dessen Umsatzsteuer die Zeile traegt (ISO-Code, zwei Grossbuchstaben).
   * Ohne Angabe `AT` -- so wie der Altbestand gespeichert ist. Ob Land und Satz
   * zusammenpassen, prueft der Server, nicht der Kern.
   */
  steuerLand?: string | null;
  /**
   * Befreiung im Land der Zeile (z. B. `small_business`), sonst keine. Nur bei
   * einem fremden Land wirksam; oesterreichische Befreiungen laufen ueber den
   * Steuerfall der Rechnung.
   */
  befreiung?: string | null;
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
  /** Nur bei einem anderen Land als AT. */
  land?: string;
  /** Nur bei einem anderen Land als AT und einer Befreiung. */
  befreiung?: string;
}

export interface ZeilenBetrag {
  netCents: number;
  grossCents: number;
  /** Der Satz, mit dem die Zeile gerechnet wurde (bei steuerfreiem Fall 0). */
  rateBp: number;
  /** Nur bei einem anderen Land als AT. */
  land?: string;
  /** Nur bei einem anderen Land als AT und einer Befreiung. */
  befreiung?: string;
}

export interface RechenErgebnis {
  netCents: number;
  vatCents: number;
  grossCents: number;
  /**
   * Je (Land, Satz, Befreiung): zuerst AT absteigend nach `rateBp`, danach die
   * anderen Laender nach Code, je Land absteigend nach `rateBp`, ohne Befreiung
   * vor der Befreiung.
   */
  byRate: SatzSumme[];
  /** Je Position, in der Reihenfolge der Eingabe. */
  lines: ZeilenBetrag[];
}

export type RechenFehlerCode = 'amount_too_large' | 'kein_ganzzahlwert' | 'ausserhalb' | 'ungueltig';

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

/** Land ohne Angabe. */
const INLAND = 'AT';

/** Land der Zeile; `null`/fehlend ist AT, alles andere muss ein ISO-Code sein. */
function landDerZeile(wert: unknown, index: number): string {
  if (wert === undefined || wert === null) return INLAND;
  if (typeof wert !== 'string' || !/^[A-Z]{2}$/.test(wert)) {
    throw new RechenFehler('ungueltig', `items[${index}].steuerLand muss ein Laendercode aus zwei Grossbuchstaben sein`, 'steuerLand', index);
  }
  return wert;
}

/** Befreiung der Zeile; `null`/fehlend ist keine, sonst ein nicht leerer Text. */
function befreiungDerZeile(wert: unknown, index: number): string | null {
  if (wert === undefined || wert === null) return null;
  if (typeof wert !== 'string' || wert.length === 0) {
    throw new RechenFehler('ungueltig', `items[${index}].befreiung muss ein nicht leerer Text sein`, 'befreiung', index);
  }
  return wert;
}

/**
 * Reihenfolge der Gruppen: AT zuerst und dort wie bisher nur nach Satz
 * absteigend, danach die anderen Laender nach Code, je Land nach Satz
 * absteigend, bei gleichem Satz die Zeile ohne Befreiung vorn.
 */
function gruppenFolge(a: Gruppe, b: Gruppe): number {
  if (a.land !== b.land) {
    if (a.land === INLAND) return -1;
    if (b.land === INLAND) return 1;
    return a.land < b.land ? -1 : 1;
  }
  if (a.rateBp !== b.rateBp) return b.rateBp - a.rateBp;
  if (a.befreiung === b.befreiung) return 0;
  if (a.befreiung === null) return -1;
  if (b.befreiung === null) return 1;
  return a.befreiung < b.befreiung ? -1 : 1;
}

interface Gruppe {
  land: string;
  rateBp: number;
  befreiung: string | null;
  zeilen: Zeile[];
  summe?: SatzSumme;
}

interface Zeile {
  index: number;
  rateBp: number;
  land: string;
  /** Bei AT immer `null`: dort gruppiert der Kern wie bisher nur nach Satz. */
  befreiung: string | null;
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

/** `land`/`befreiung` fuer Ausgabe -- bei AT nichts, damit AT-Rechnungen byte-gleich bleiben. */
function herkunft(g: { land: string; befreiung: string | null }): { land?: string; befreiung?: string } {
  if (g.land === INLAND) return {};
  return g.befreiung === null ? { land: g.land } : { land: g.land, befreiung: g.befreiung };
}

export function rechnungRechnen(
  positionen: readonly RechenPosition[],
  optionen: RechenOptionen,
): RechenErgebnis {
  // Der steuerfreie Fall der Rechnung ist ein oesterreichischer: er stellt die
  // AT-Zeilen auf 0 %, eine Zeile mit fremder Steuer behaelt ihren Satz.
  const steuerfrei = STEUERFREIE_FAELLE.includes(optionen.taxScheme ?? 'normal');
  const brutto = optionen.priceMode === 'gross';

  const grenze = BigInt(BETRAG_GRENZE_CENTS) * E;
  const zeilen: Zeile[] = positionen.map((p, index) => {
    const preis = BigInt(ganzzahl(p.unitPriceMicros, 'unitPriceMicros', index));
    const menge = BigInt(ganzzahl(p.quantityMilli, 'quantityMilli', index));
    const rabatt = BigInt(ganzzahl(p.discountBp ?? 0, 'discountBp', index));
    const satz = ganzzahl(p.vatRateBp ?? 0, 'vatRateBp', index);
    const land = landDerZeile(p.steuerLand, index);
    const befreiung = befreiungDerZeile(p.befreiung, index);
    const L = preis * menge * (10_000n - rabatt) * 1_000_000n;
    if ((L < 0n ? -L : L) > grenze) {
      throw new RechenFehler(
        'amount_too_large',
        `items[${index}] uebersteigt ${BETRAG_GRENZE_CENTS} Cent`,
        'unitPriceMicros',
        index,
      );
    }
    const inland = land === INLAND;
    return {
      index,
      rateBp: steuerfrei && inland ? 0 : satz,
      land,
      befreiung: inland ? null : befreiung,
      L,
      netCents: 0,
      grossCents: 0,
    };
  });

  // Land und Befreiung sind vorab geprueft (Code ohne „|“ bzw. letzte Stelle),
  // der Schluessel ist darum eindeutig.
  const gruppen = new Map<string, Gruppe>();
  for (const z of zeilen) {
    const schluessel = `${z.land}|${z.rateBp}|${z.befreiung ?? ''}`;
    const gruppe = gruppen.get(schluessel);
    if (gruppe) gruppe.zeilen.push(z);
    else gruppen.set(schluessel, { land: z.land, rateBp: z.rateBp, befreiung: z.befreiung, zeilen: [z] });
  }

  for (const eintrag of gruppen.values()) {
    const { rateBp, zeilen: gruppe } = eintrag;
    // Eine Gruppe zu 0 % rechnet brutto wie netto; bisher galt dort der
    // Netto-Weg, und dabei bleibt es fuer die AT-Zeilen im steuerfreien Fall.
    const bruttoPreise = brutto && !(steuerfrei && eintrag.land === INLAND);
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
    eintrag.summe = {
      rateBp,
      netCents: Number(netCents),
      vatCents: Number(vatCents),
      grossCents: Number(grossCents),
      ...herkunft(eintrag),
    };
  }
  const byRate: SatzSumme[] = [...gruppen.values()].sort(gruppenFolge).map((g) => g.summe!);

  const summe = (feld: 'netCents' | 'vatCents' | 'grossCents'): number =>
    byRate.reduce((s, r) => s + r[feld], 0);

  const ergebnis: RechenErgebnis = {
    netCents: summe('netCents'),
    vatCents: summe('vatCents'),
    grossCents: summe('grossCents'),
    byRate,
    lines: zeilen.map((z) => ({ netCents: z.netCents, grossCents: z.grossCents, rateBp: z.rateBp, ...herkunft(z) })),
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

/**
 * Anteiliger Preis fuer einen Teilzeitraum (erste Rechnung eines Abos).
 * War der Ursprungspreis centgenau, bleibt auch der Anteil centgenau — sonst
 * stuende auf der ersten Rechnung ein Preis mit sechs Stellen, wo bisher zwei
 * standen.
 */
export function anteiligerPreis(unitPriceMicros: number, monate: number, intervall: number): number {
  const micros = BigInt(unitPriceMicros);
  const anteil = rund(micros * BigInt(monate), BigInt(intervall));
  if (unitPriceMicros % 10_000 !== 0) return Number(anteil);
  return Number(rund(anteil, 10_000n) * 10_000n);
}

/**
 * Schluessel eines USt-Satzes in den gespeicherten Maps (`creditedCents.byRate`,
 * `invoice_stats.vatByRate`): der Prozenttext mit Punkt, genau wie
 * `String(satz)` ihn bisher gebildet hat. NICHT fuer die Anzeige — dafuer gibt
 * es `satzText`.
 */
export function satzSchluessel(rateBp: number): string {
  return String(rateBp / 100);
}

/** Ein USt-Satz fuer die Anzeige: oesterreichisch mit Komma, ohne nachlaufende Nullen. */
export function satzText(rateBp: number): string {
  return satzSchluessel(rateBp).replace('.', ',');
}

/**
 * Ein Einzelpreis fuer die Anzeige: mindestens zwei, hoechstens sechs
 * Nachkommastellen, Tausenderpunkt, Komma als Trennzeichen — in jeder Sprache
 * oesterreichisch, wie die Betraege auf dem Blatt.
 */
export function preisText(unitPriceMicros: number): string {
  const negativ = unitPriceMicros < 0;
  const betrag = Math.abs(unitPriceMicros);
  const ganz = Math.trunc(betrag / 1_000_000);
  let bruch = String(betrag % 1_000_000).padStart(6, '0');
  while (bruch.length > 2 && bruch.endsWith('0')) bruch = bruch.slice(0, -1);
  const mitPunkten = String(ganz).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativ ? '-' : ''}${mitPunkten},${bruch}`;
}
