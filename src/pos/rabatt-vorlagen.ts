import { messageText, labelText, type MessageKey } from './texte.js';
import type { PosBusinessSettings, PosDiscountPreset } from './settings.js';
import { DISCOUNT_PRESET_KIND } from './settings.js';

/*
 * Rabatt-Vorlagen der Kasse (benannte Rabatt-Chips): wirksame Liste, Chip-Text, Spiegelung nach `discountChips`,
 * Pruefung und Bon-Block. Zwilling von functions-kasse/rabatt-vorlagen-core.js; der Vertrag sind die Pruefaelle
 * fixtures/discount-preset-cases.json (byte-gleich mit dem Backend).
 */

/** Fehlercode, den der Server bei einer ungueltigen Vorlage sendet. */
export const INVALID_DISCOUNT_PRESET = 'invalid_discount_preset';
/** Hoechstzahl der Vorlagen. */
export const DISCOUNT_PRESETS_MAX = 5;
/** Laenge des Namens in Zeichen (nach dem Trimmen). */
export const DISCOUNT_PRESET_NAME_MAX = 24;
/** Prozent in Basispunkten: 0,1 % bis 100 % in Schritten von 0,1 %. */
export const DISCOUNT_PRESET_PERCENT_BP = Object.freeze({ min: 10, max: 10000, step: 10 });
/** Betrag in Cent: 0,01 € bis 1.000.000,00 €. */
export const DISCOUNT_PRESET_AMOUNT_CENTS = Object.freeze({ min: 1, max: 100000000 });

/** Wirksame Vorlagen: die gespeicherten (auch leer), sonst die Prozent-Chips als namenlose Prozent-Vorlagen. */
export function posDiscountPresets(
  business: Readonly<Pick<Partial<PosBusinessSettings>, 'discountPresets' | 'discountChips'>> | null | undefined,
): PosDiscountPreset[] {
  const vorlagen = business?.discountPresets;
  if (Array.isArray(vorlagen)) return vorlagen.map((v) => ({ ...v }));
  const raus: PosDiscountPreset[] = [];
  const chips = business?.discountChips;
  for (const p of Array.isArray(chips) ? chips : []) {
    const bp = typeof p === 'number' ? Math.round(p * 100) : NaN;
    if (Number.isFinite(bp) && bp >= DISCOUNT_PRESET_PERCENT_BP.min && bp <= DISCOUNT_PRESET_PERCENT_BP.max) {
      raus.push({ name: '', kind: 'percent', percentBp: bp });
    }
  }
  return raus;
}

/**
 * Die Prozent-Chips, die der Server aus den Vorlagen nach `discountChips` spiegelt (fuer aeltere Kassen):
 * Prozent-Vorlagen in ihrer Reihenfolge, gleiche Werte nur einmal, Betrag-Vorlagen fallen weg.
 */
export function discountChipsFromPresets(presets: readonly PosDiscountPreset[] | null | undefined): number[] {
  const raus: number[] = [];
  for (const v of presets ?? []) {
    if (!v || v.kind !== 'percent' || !Number.isInteger(v.percentBp)) continue;
    const p = (v.percentBp as number) / 100;
    if (!raus.includes(p)) raus.push(p);
  }
  return raus;
}

/** Prozent aus Basispunkten als Text mit Komma, ohne ueberfluessige Stellen: `1000` -> `10`, `1050` -> `10,5`. */
function prozentText(bp: number): string {
  const ganz = Math.trunc(bp / 100);
  const rest = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return rest === '' ? String(ganz) : `${ganz},${rest}`;
}

/** Euro aus Cent mit Tausenderpunkt: `123456` -> `1.234,56 €`. */
function euroText(cents: number): string {
  const ganz = String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${ganz},${String(cents % 100).padStart(2, '0')} €`;
}

/** Text auf dem Chip: `Mitarbeiter-Rabatt 20 %`, `Stammkunde 5,00 €`; ohne Namen nur der Wert (`10 %`). */
export function discountPresetChipText(preset: Readonly<PosDiscountPreset>): string {
  const wert = preset.kind === 'amount' ? euroText(preset.amountCents ?? 0) : `${prozentText(preset.percentBp ?? 0)} %`;
  return preset.name ? `${preset.name} ${wert}` : wert;
}

/** Warum eine Vorlage abgelehnt wird; je Grund ein Satz im Katalog ([DISCOUNT_PRESET_MESSAGES]). */
export type DiscountPresetReason = 'list' | 'entry' | 'name' | 'duplicate' | 'kind' | 'percent' | 'amount' | 'unknown_field';

/** Grund -> Satz (Katalog `discount_preset.*`). */
export const DISCOUNT_PRESET_MESSAGES = {
  list: 'discount_preset.list',
  entry: 'discount_preset.entry',
  name: 'discount_preset.name',
  duplicate: 'discount_preset.duplicate',
  kind: 'discount_preset.kind',
  percent: 'discount_preset.percent',
  amount: 'discount_preset.amount',
  unknown_field: 'discount_preset.unknown_field',
} as const satisfies Record<DiscountPresetReason, MessageKey>;

/** Ein Fehler der Pruefung: `index` die Vorlage (`null` = die Liste), `field` das Feld (`null` = die ganze Vorlage). */
export interface DiscountPresetError {
  index: number | null;
  field: string | null;
  reason: DiscountPresetReason;
  message: string;
}

export type DiscountPresetsCheck =
  | { ok: true; value: PosDiscountPreset[] }
  | { ok: false; code: typeof INVALID_DISCOUNT_PRESET; errors: DiscountPresetError[] };

// Steuer- und Formatzeichen (Zeilenumbruch, Null, Zero-Width, Richtungswechsel): nie in einem Bon-Text.
const STEUERZEICHEN = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const WERTFELD = { percent: 'percentBp', amount: 'amountCents' } as const;

const istObjekt = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);

function fehler(index: number | null, field: string | null, reason: DiscountPresetReason): DiscountPresetError {
  return { index, field, reason, message: messageText(DISCOUNT_PRESET_MESSAGES[reason]) };
}

/**
 * Prueft die Liste der Vorlagen vor dem Schreiben, mit denselben Regeln wie der Server: hoechstens 5, Name 1 bis 24
 * Zeichen nach dem Trimmen ohne Steuerzeichen, eindeutig ohne Ruecksicht auf Gross und Klein, Art `percent`/`amount`
 * mit genau dem passenden Wertfeld (Prozent 0,1 bis 100 in Schritten von 0,1, Betrag 0,01 bis 1.000.000 €).
 * `value` ist die normalisierte Liste (Name getrimmt). Der Server antwortet bei einem Fehler mit
 * [INVALID_DISCOUNT_PRESET].
 */
export function checkDiscountPresets(list: unknown): DiscountPresetsCheck {
  if (!Array.isArray(list) || list.length > DISCOUNT_PRESETS_MAX) {
    return { ok: false, code: INVALID_DISCOUNT_PRESET, errors: [fehler(null, null, 'list')] };
  }
  const errors: DiscountPresetError[] = [];
  const value: PosDiscountPreset[] = [];
  const namen = new Set<string>();
  list.forEach((v, index) => {
    if (!istObjekt(v)) { errors.push(fehler(index, null, 'entry')); return; }
    const vorher = errors.length;
    const name = typeof v.name === 'string' ? v.name.trim() : null;
    if (name === null || name.length < 1 || [...name].length > DISCOUNT_PRESET_NAME_MAX || STEUERZEICHEN.test(name)) errors.push(fehler(index, 'name', 'name'));
    else if (namen.has(name.toLocaleLowerCase('de'))) errors.push(fehler(index, 'name', 'duplicate'));
    else namen.add(name.toLocaleLowerCase('de'));
    const kind = (DISCOUNT_PRESET_KIND as readonly unknown[]).includes(v.kind) ? (v.kind as PosDiscountPreset['kind']) : null;
    if (!kind) errors.push(fehler(index, 'kind', 'kind'));
    for (const k of Object.keys(v)) {
      if (k === 'name' || k === 'kind') continue;
      if (k !== 'percentBp' && k !== 'amountCents') errors.push(fehler(index, k, 'unknown_field'));
      else if (kind && WERTFELD[kind] !== k) errors.push(fehler(index, k, 'unknown_field'));
    }
    if (kind === 'percent') {
      const p = v.percentBp;
      const g = DISCOUNT_PRESET_PERCENT_BP;
      if (!Number.isInteger(p) || (p as number) < g.min || (p as number) > g.max || (p as number) % g.step !== 0) errors.push(fehler(index, 'percentBp', 'percent'));
    }
    if (kind === 'amount') {
      const c = v.amountCents;
      const g = DISCOUNT_PRESET_AMOUNT_CENTS;
      if (!Number.isInteger(c) || (c as number) < g.min || (c as number) > g.max) errors.push(fehler(index, 'amountCents', 'amount'));
    }
    if (errors.length === vorher && kind) {
      value.push({ name: name as string, kind, [WERTFELD[kind]]: v[WERTFELD[kind]] as number });
    }
  });
  return errors.length ? { ok: false, code: INVALID_DISCOUNT_PRESET, errors } : { ok: true, value };
}

/** Eine Zeile des Rabatte-Blocks auf Z- und X-Bon: `label` und der Betrag als Abzug (negativ). */
export interface DiscountBlockLine {
  label: string;
  cents: number;
}

/** Ein Rabatt je Name aus dem Laufstand bzw. den Bon-Daten: `cents` gewaehrt (positiv), `count` Belege. */
export interface DiscountTotal {
  name: string;
  cents: number;
  count: number;
}

/**
 * Zeilen des Rabatte-Blocks auf Z-Bon und Zwischenbericht: je Name `<Name> (n×)` mit dem Abzug, ab zwei Eintraegen
 * zusaetzlich `Rabatte gesamt`. Ein leerer Name heisst „Rabatt“. Ein voll stornierter Name (Betrag 0) entfaellt wie in der Liste des Servers. Ohne Rabatte leer (kein Block).
 */
export function discountBlockLines(discounts: readonly DiscountTotal[] | null | undefined): DiscountBlockLine[] {
  const liste = (discounts ?? []).filter((r) => r && Number.isSafeInteger(r.cents) && Number.isSafeInteger(r.count) && r.cents !== 0);
  const zeilen = liste.map((r) => ({ label: labelText('shift_receipt.discount_line', { name: r.name || labelText('shift_receipt.discount_unnamed'), count: r.count }), cents: -r.cents }));
  if (zeilen.length > 1) zeilen.push({ label: labelText('shift_receipt.discounts_total'), cents: -liste.reduce((x, r) => x + r.cents, 0) });
  return zeilen;
}
