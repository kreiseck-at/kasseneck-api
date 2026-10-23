import { VoucherAction, VoucherType } from '../enums/index.js';
import { euroToCents } from '../money.js';
import { readEnumKey, requireEnumKey } from './enum-payload.js';

/**
 * Gutschein — Zwilling von `KeckVoucher` in
 * kasseneck_api/lib/models/keck_voucher.dart.
 *
 * `valueCents` ist der Gutscheinwert in **Cent** (exakte Integer-Arithmetik).
 *
 * `action`/`type` sind schon im Dart-Vorbild reine Strings (keine
 * Zusatzfelder) — beim Lesen bleibt ein unbekannter Wert deshalb ebenfalls
 * einfach der rohe Nutzlast-String (siehe [readEnumKey]); ob er zu den
 * bekannten Werten gehoert, entscheidet sich erst beim Schreiben.
 */
export interface Voucher {
  name?: string;
  code?: string;
  action: VoucherAction | string;
  type: VoucherType | string;
  valueCents?: number;
  /** Neue Form: Betrag in Cent (Verkauf, Einloesung, Auszahlung). */
  amountCents?: number;
  /** Neue Form, Leistungsgutschein: verkaufter Artikel. */
  articleId?: string;
  /** Neue Form, Leistungsgutschein: Menge (Verkauf) bzw. eingeloeste Menge. */
  quantity?: number;
  /** Neue Form, Leistungsgutschein einloesen: Indizes der Belegpositionen. */
  positions?: number[];
  /** Neue Form, Auszahlung: Grund, 1 bis 200 Zeichen. */
  reason?: string;
  // Nur gelesen (setzt der Server, ein Wunsch traegt sie nie):
  voucherType?: string;
  voucherId?: string;
  /** Letzte vier Zeichen des Codes; der Klartext steht nie am Beleg. */
  codeSuffix?: string;
  vatRateBp?: number;
  article?: VoucherArticle;
  balanceAfterCents?: number;
  remainingQuantityAfter?: number;
  taxedWith?: string;
  exempt?: boolean;
  zeroRateBucket?: boolean;
}

/**
 * Ein ausgestellter Gutschein in der Antwort von `createReceipt` unter `/v3`
 * (`data.issuedVouchers[]`): der Klartext-Code erscheint hier einmalig fuer das Etikett.
 */
export interface IssuedVoucher {
  id: string;
  /** Klartext-Code; nie in Logs oder Fehlertexte schreiben. */
  code: string;
  type: string;
  index: number;
  codeSuffix: string;
  faceValueCents?: number;
  quantity?: number;
  /** Nur bei Leistungsgutscheinen: Name des verkauften Artikels; sonst fehlt das Feld. */
  articleName?: string;
  validity?: {
    pattern: string;
    redeemableUntil: string | null;
    refundableUntil: string | null;
    validUntil: string | null;
  };
}

/** Artikel eines Leistungsgutscheins, wie der Server ihn am Beleg festhaelt. */
export interface VoucherArticle {
  id: string;
  name: string;
  vatRateBp: number;
  priceCents: number;
}

/**
 * Nutzlast eines Gutscheins. Altform: nur `valueCents` (ganze Cent); `value`
 * (Euro) kommt nur beim Lesen vor: der Server legt es in seinen Antworten
 * daneben, gelesen wird es nur, wenn `valueCents` fehlt. Neue Form: roh mit
 * `amountCents` und den weiteren Feldern; gesetzte Feldern gehen hinaus,
 * fehlende fehlen (kein `valueCents: null` an der neuen Form).
 * `name` und `code` gehen nur hinaus, wenn sie gesetzt sind.
 */
export interface VoucherPayload {
  name?: string | null;
  code?: string | null;
  action: string;
  type: string;
  value?: number | null;
  valueCents?: number | null;
  amountCents?: number;
  articleId?: string;
  quantity?: number;
  positions?: number[];
  reason?: string;
  voucherType?: string;
  voucherId?: string;
  codeSuffix?: string;
  vatRateBp?: number;
  article?: VoucherArticle;
  balanceAfterCents?: number;
  remainingQuantityAfter?: number;
  taxedWith?: string;
  exempt?: boolean;
  zeroRateBucket?: boolean;
}

/** Arten der neuen Gutscheinform (die Altwerte sind `value` und `promo`). */
export const NEUE_GUTSCHEINARTEN: readonly string[] = [
  VoucherType.multi_purpose,
  VoucherType.single_purpose,
  VoucherType.service,
  VoucherType.promotion,
];

/** Gehoert der Gutschein zur neuen Form (Art oder Aktion `payout`)? */
export function isNewFormVoucher(voucher: Pick<Voucher, 'type' | 'action'>): boolean {
  return NEUE_GUTSCHEINARTEN.includes(voucher.type) || voucher.action === VoucherAction.payout;
}

/** Felder, die nur der Server setzt; an einem Wunsch sind sie `voucher_invalid`. */
export const GUTSCHEIN_SERVERFELDER = ['voucherId', 'codeSuffix', 'zeroRateBucket', 'voucherType'] as const;

/** Welche Serverfelder tragt der Gutschein (leere Liste = keines)? */
export function voucherServerFields(voucher: Voucher): string[] {
  return GUTSCHEIN_SERVERFELDER.filter((feld) => (voucher as unknown as Record<string, unknown>)[feld] != null);
}

const NEUE_FELDER = [
  'amountCents', 'articleId', 'quantity', 'positions', 'reason', 'voucherType', 'voucherId', 'codeSuffix',
  'vatRateBp', 'article', 'balanceAfterCents', 'remainingQuantityAfter', 'taxedWith', 'exempt', 'zeroRateBucket',
] as const;

export function toVoucherPayload(voucher: Voucher): VoucherPayload {
  const action = requireEnumKey(VoucherAction, voucher.action, 'Gutschein-Aktion');
  const type = requireEnumKey(VoucherType, voucher.type, 'Gutscheinart');
  // Felder der neuen Form gehen roh hinaus, soweit gesetzt (auch an einem
  // gelesenen Altbeleg: dort fehlen sie, die Nutzlast bleibt byte-gleich).
  const roh = voucher as unknown as Record<string, unknown>;
  const neu: Record<string, unknown> = {};
  for (const feld of NEUE_FELDER) if (roh[feld] != null) neu[feld] = roh[feld];
  return {
    action,
    type,
    // Die neue Form kennt kein `valueCents`; nur ein gelesener Eintrag (die
    // Auszahlung steht beim Server als Wert mit Cent) traegt es weiter.
    ...(isNewFormVoucher(voucher) && voucher.valueCents == null ? {} : { valueCents: voucher.valueCents ?? null }),
    ...(voucher.code != null ? { code: voucher.code } : {}),
    ...(voucher.name != null ? { name: voucher.name } : {}),
    ...neu,
  } as VoucherPayload;
}

/**
 * Ist der Gutschein an das Backend sendbar? Zwilling von `KeckVoucher.isValid`
 * im Flutter-Vorbild: Wert- und Aktionsgutscheine brauchen einen Wert,
 * Aktionsgutscheine duerfen nur eingeloest (nicht verkauft) werden, und ein
 * gesetzter Wert muss positiv sein.
 */
export function voucherIsValid(voucher: Voucher): boolean {
  if (isNewFormVoucher(voucher)) return newFormVoucherIsValid(voucher);
  if (voucher.type === VoucherType.value && voucher.valueCents == null) {
    return false;
  }
  if (voucher.type === VoucherType.promo && voucher.action !== VoucherAction.redeem) {
    return false;
  }
  if (voucher.type === VoucherType.promo && voucher.valueCents == null) {
    return false;
  }
  // `!Number.isFinite` VOR den Vergleich, nicht dahinter: `NaN <= 0` und
  // `Infinity <= 0` sind beide `false`, ein Vergleich mit einem
  // nicht-endlichen Wert ist also IMMER falsch und liesse ihn hier
  // durchrutschen. Gemessen (28.08.2026): ein Gutschein mit `valueCents: NaN`
  // (aus einem kaputten `value` in der Nutzlast, siehe [fromVoucherPayload])
  // oder `valueCents: Infinity` galt bis zu dieser Fassung als GUELTIG und
  // waere still in die Belegsummen gewandert. Diese Pruefung greift
  // unabhaengig davon, ob `valueCents` ueber [fromVoucherPayload] oder direkt
  // gesetzt wurde -- die gehaertete Umrechnung dort allein reicht nicht.
  if (voucher.valueCents != null && (!Number.isFinite(voucher.valueCents) || voucher.valueCents <= 0)) {
    return false;
  }
  return true;
}

export function fromVoucherPayload(payload: VoucherPayload): Voucher {
  // Euro->Cent ueber die eine gehaertete Stelle im Paket ([euroToCents],
  // money.ts) statt einer eigenen `Math.round(payload.value * 100)` --
  // [euroToCents] prueft `Number.isFinite` und liefert fuer einen
  // nicht-numerischen oder nicht-endlichen Wert `0` statt eines lautlosen
  // `NaN`. Siehe auch [voucherIsValid]: `0` faellt dort ueber die
  // "<= 0"-Pruefung, ein `NaN` waere durchgerutscht.
  const valueCents =
    payload.valueCents != null
      ? payload.valueCents
      : payload.value != null
        ? euroToCents(payload.value)
        : undefined;
  return {
    name: payload.name ?? undefined,
    code: payload.code ?? undefined,
    action: readEnumKey(VoucherAction, payload.action),
    type: readEnumKey(VoucherType, payload.type),
    valueCents,
    ...lesenNeu(payload),
  };
}

/** Felder der neuen Form beim Lesen: nur was dasteht (Altbelege bleiben schlank). */
function lesenNeu(payload: VoucherPayload): Partial<Voucher> {
  const roh = payload as unknown as Record<string, unknown>;
  const neu: Record<string, unknown> = {};
  for (const feld of NEUE_FELDER) if (roh[feld] != null) neu[feld] = roh[feld];
  return neu as Partial<Voucher>;
}

/** Grenzen wie der Server (gutschein-beleg): Betrag 1 bis 1.000.000 Cent, Menge 1 bis 100. */
const MAX_BETRAG_CENTS = 1_000_000;
const MAX_STUECK = 100;
const MAX_GRUND = 200;
const istCent = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_BETRAG_CENTS;
const istMenge = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_STUECK;
const hatText = (t: unknown): boolean => typeof t === 'string' && t.trim().length > 0;

/**
 * Wunsch der neuen Form sendbar? Bildet die Regeln des Servers ab: Serverfelder
 * nie, Betrag/Menge ganz und positiv, Code bei Einloesung und Auszahlung,
 * Auszahlung nur Mehrzweck/Einzweck mit Grund (1 bis 200 Zeichen), Aktion nur
 * einloesbar, Leistung braucht Artikel und Menge (Verkauf) bzw. Positionen
 * (Einloesung). Felder, die zu einer anderen Aktion/Art gehoeren, sind
 * ebenfalls nicht erlaubt (der Server wiese sie ab).
 */
function newFormVoucherIsValid(v: Voucher): boolean {
  if (voucherServerFields(v).length > 0) return false;
  const r = v as unknown as Record<string, unknown>;
  for (const feld of ['vatRateBp', 'article', 'balanceAfterCents', 'remainingQuantityAfter', 'taxedWith', 'exempt']) {
    if (r[feld] != null) return false;
  }
  if (v.valueCents != null) return false;
  const allein = v.type === VoucherType.multi_purpose || v.type === VoucherType.single_purpose;
  if (v.action === VoucherAction.payout) {
    return allein && hatText(v.code) && istCent(v.amountCents) && hatText(v.reason) && v.reason!.trim().length <= MAX_GRUND
      && v.articleId == null && v.quantity == null && v.positions == null;
  }
  if (v.reason != null) return false;
  if (allein) {
    if (v.articleId != null || v.quantity != null || v.positions != null) return false;
    if (v.action === VoucherAction.sell) return istCent(v.amountCents);
    if (v.action === VoucherAction.redeem) return hatText(v.code) && istCent(v.amountCents);
    return false;
  }
  if (v.type === VoucherType.service) {
    if (v.amountCents != null) return false;
    if (v.action === VoucherAction.sell) {
      return hatText(v.articleId) && istMenge(v.quantity) && v.positions == null;
    }
    if (v.action === VoucherAction.redeem) {
      return hatText(v.code) && Array.isArray(v.positions) && v.positions.length > 0
        && v.positions.every((i) => Number.isInteger(i) && i >= 0) && new Set(v.positions).size === v.positions.length && v.articleId == null && v.quantity == null;
    }
    return false;
  }
  if (v.type === VoucherType.promotion) {
    return v.action === VoucherAction.redeem && hatText(v.code)
      && v.amountCents == null && v.articleId == null && v.quantity == null && v.positions == null;
  }
  // Altart mit neuer Aktion (payout + value/promo): nicht sendbar.
  return false;
}
