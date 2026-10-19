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
  /** Neue Form: Betrag in Cent (Verkauf, Einloesung, Auszahlung). Intern `betragCents`. */
  amountCents?: number;
  /** Neue Form, Leistungsgutschein: verkaufter Artikel. Intern `artikelId`. */
  articleId?: string;
  /** Neue Form, Leistungsgutschein: Menge (Verkauf) bzw. eingeloeste Menge. Intern `stueck`. */
  quantity?: number;
  /** Neue Form, Leistungsgutschein einloesen: Indizes der Belegpositionen. Intern `positionen`. */
  positions?: number[];
  /** Neue Form, Auszahlung: Grund, 1 bis 200 Zeichen. Intern `grund`. */
  reason?: string;
  // Nur gelesen (setzt der Server, ein Wunsch traegt sie nie):
  /** Art des Gutscheins (auch am Mehrzweck mit `type: 'value'`). Intern `art`. */
  voucherType?: string;
  /** Intern `gutscheinId`. */
  voucherId?: string;
  /** Letzte vier Zeichen des Codes; der Klartext steht nie am Beleg. Intern `codeEnde`. */
  codeSuffix?: string;
  /** Intern `satzBp`. */
  vatRateBp?: number;
  /** Intern `artikel`. */
  article?: VoucherArticle;
  /** Intern `saldoNachCents`. */
  balanceAfterCents?: number;
  /** Intern `stueckOffenNach`. */
  remainingQuantityAfter?: number;
  /** Intern `versteuertMit`. */
  taxedWith?: string;
  /** Intern `befreit`. */
  exempt?: boolean;
  /** Betrag steht als Position im 0-%-Topf (Mehrzweck-Verkauf ab dem Stichtag, Auszahlung). Intern `imNullTopf`. */
  zeroRateBucket?: boolean;
}

/**
 * Artikel eines Leistungsgutscheins, wie der Server ihn am Beleg festhaelt
 * (intern `artikel` mit `satzBp`/`preisCents`).
 */
export interface VoucherArticle {
  id?: string;
  name?: string;
  vatRateBp?: number;
  priceCents?: number;
}

/**
 * Nutzlast: traegt **beide** Felder, `value` (Euro) und `valueCents` (Cent).
 * Das Backend erwartet das Euro-Feld weiterhin (Altkompatibilitaet) — die
 * Umwandlung passiert nur hier, an dieser einen Stelle.
 *
 * Neue Gutscheinform (Spec 2026-10-14): diese Linie spricht die interne Form
 * (`/api`, wie Firestore), also deutsche Schluessel und Arten (`betragCents`,
 * `art`, `imNullTopf`, `type: 'einzweck'` ...). Gelesen wird beides, intern
 * und `/v3` (englisch); geschrieben wird intern. Ein Eintrag der neuen Form
 * traegt nur, was gesetzt ist (kein `value: null` an Einzweck/Leistung).
 */
export interface VoucherPayload {
  name?: string | null;
  code?: string | null;
  action: string;
  type: string;
  value?: number | null;
  valueCents?: number | null;
  [feld: string]: unknown;
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

/** Welche Serverfelder traegt der Gutschein (leere Liste = keines)? */
export function voucherServerFields(voucher: Voucher): string[] {
  return GUTSCHEIN_SERVERFELDER.filter((feld) => (voucher as unknown as Record<string, unknown>)[feld] != null);
}

/*
 * Interne Namen (functions/gemeinsam/api-vokabular-v3.js BELEG_GUTSCHEIN,
 * GUTSCHEIN_ART, GUTSCHEIN_ARTIKEL). Modellfeld -> interner Schluessel.
 */
const INTERNE_FELDER = {
  amountCents: 'betragCents',
  articleId: 'artikelId',
  quantity: 'stueck',
  positions: 'positionen',
  reason: 'grund',
  voucherType: 'art',
  voucherId: 'gutscheinId',
  codeSuffix: 'codeEnde',
  vatRateBp: 'satzBp',
  article: 'artikel',
  balanceAfterCents: 'saldoNachCents',
  remainingQuantityAfter: 'stueckOffenNach',
  taxedWith: 'versteuertMit',
  exempt: 'befreit',
  zeroRateBucket: 'imNullTopf',
} as const;
type NeuesFeld = keyof typeof INTERNE_FELDER;
const NEUE_FELDER = Object.keys(INTERNE_FELDER) as NeuesFeld[];

/** Gutscheinart: interner Name -> Modellwert. */
const ART_AUS_INTERN: Readonly<Record<string, string>> = {
  mehrzweck: VoucherType.multi_purpose,
  einzweck: VoucherType.single_purpose,
  leistung: VoucherType.service,
  aktion: VoucherType.promotion,
};
const ART_NACH_INTERN: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(ART_AUS_INTERN).map(([innen, aussen]) => [aussen, innen]));
const artAusIntern = (wert: unknown): unknown => (typeof wert === 'string' && Object.prototype.hasOwnProperty.call(ART_AUS_INTERN, wert) ? ART_AUS_INTERN[wert] : wert);
const artNachIntern = (wert: unknown): unknown => (typeof wert === 'string' && Object.prototype.hasOwnProperty.call(ART_NACH_INTERN, wert) ? ART_NACH_INTERN[wert] : wert);

const istObjekt = (w: unknown): w is Record<string, unknown> => w != null && typeof w === 'object' && !Array.isArray(w);

function artikelAusIntern(w: unknown): unknown {
  if (!istObjekt(w)) return w;
  const raus: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w)) raus[k === 'satzBp' ? 'vatRateBp' : k === 'preisCents' ? 'priceCents' : k] = v;
  return raus;
}
function artikelNachIntern(w: unknown): unknown {
  if (!istObjekt(w)) return w;
  const raus: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w)) raus[k === 'vatRateBp' ? 'satzBp' : k === 'priceCents' ? 'preisCents' : k] = v;
  return raus;
}

/** Hat der Gutschein irgendein Feld der neuen Form? */
const hatNeueFelder = (voucher: Voucher): boolean =>
  NEUE_FELDER.some((feld) => (voucher as unknown as Record<string, unknown>)[feld] != null);

export function toVoucherPayload(voucher: Voucher): VoucherPayload {
  if (isNewFormVoucher(voucher) || hatNeueFelder(voucher)) return neueFormNachIntern(voucher);
  return {
    name: voucher.name ?? null,
    code: voucher.code ?? null,
    // Schreibpfad bleibt streng: action/type sehen fuer bekannte und
    // unbekannte Werte gleich aus (reine Strings) — erst der Lookup hier
    // entscheidet, ob geschrieben werden darf.
    action: requireEnumKey(VoucherAction, voucher.action, 'Gutschein-Aktion'),
    type: requireEnumKey(VoucherType, voucher.type, 'Gutscheinart'),
    // Euro-Feld nur fuer Altbestand-Konsumenten des Backends — siehe Kommentar oben.
    value: voucher.valueCents == null ? null : voucher.valueCents / 100,
    valueCents: voucher.valueCents ?? null,
  };
}

/**
 * Eintrag der neuen Form in der internen Form: gesetzte Felder gehen hinaus,
 * fehlende fehlen; `value`/`valueCents` nur, wenn ein Wert dasteht (Mehrzweck
 * und Aktion tragen ihn am Beleg, Einzweck/Leistung nie). Gelesen -> geschrieben
 * -> gelesen ergibt denselben Gutschein.
 */
function neueFormNachIntern(voucher: Voucher): VoucherPayload {
  const action = requireEnumKey(VoucherAction, voucher.action, 'Gutschein-Aktion');
  const type = requireEnumKey(VoucherType, voucher.type, 'Gutscheinart');
  const roh = voucher as unknown as Record<string, unknown>;
  const raus: Record<string, unknown> = { action, type: artNachIntern(type) };
  if (voucher.valueCents != null) {
    raus['value'] = voucher.valueCents / 100;
    raus['valueCents'] = voucher.valueCents;
  }
  if (voucher.name != null) raus['name'] = voucher.name;
  if (voucher.code != null) raus['code'] = voucher.code;
  for (const feld of NEUE_FELDER) {
    const wert = roh[feld];
    if (wert == null) continue;
    raus[INTERNE_FELDER[feld]] = feld === 'voucherType' ? artNachIntern(wert) : feld === 'article' ? artikelNachIntern(wert) : wert;
  }
  return raus as VoucherPayload;
}

/**
 * Ist der Gutschein an das Backend sendbar? Zwilling von `KeckVoucher.isValid`
 * im Flutter-Vorbild: Wert- und Promotionsgutscheine brauchen einen Wert,
 * Promotionsgutscheine duerfen nur eingeloest (nicht verkauft) werden, und ein
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
    // Interne Arten der neuen Form (einzweck, leistung ...) lesen sich als Modellwert.
    type: readEnumKey(VoucherType, artAusIntern(payload.type) as string),
    valueCents,
    ...lesenNeu(payload),
  };
}

/**
 * Felder der neuen Form beim Lesen: nur was dasteht (Altbelege bleiben
 * schlank, byte-gleich). Der englische Name (`/v3`) gilt vor dem internen.
 */
function lesenNeu(payload: VoucherPayload): Partial<Voucher> {
  const roh = payload as unknown as Record<string, unknown>;
  const neu: Record<string, unknown> = {};
  for (const feld of NEUE_FELDER) {
    const wert = roh[feld] ?? roh[INTERNE_FELDER[feld]];
    if (wert == null) continue;
    neu[feld] = feld === 'voucherType' ? artAusIntern(wert) : feld === 'article' ? artikelAusIntern(wert) : wert;
  }
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
 * Wunsch der neuen Form sendbar? Bildet die Regeln des Servers ab
 * (gutschein-beleg.pruefeWuensche): Serverfelder nie, Betrag/Menge ganz und
 * positiv, Code bei Einloesung und Auszahlung, Auszahlung nur Mehrzweck/
 * Einzweck mit Grund (1 bis 200 Zeichen), Aktion nur einloesbar, Leistung
 * braucht Artikel und Menge (Verkauf) bzw. Positionen (Einloesung). Felder,
 * die zu einer anderen Aktion/Art gehoeren, sind ebenfalls nicht erlaubt.
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
        && v.positions.every((i) => Number.isInteger(i) && i >= 0) && new Set(v.positions).size === v.positions.length
        && v.articleId == null && v.quantity == null;
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
