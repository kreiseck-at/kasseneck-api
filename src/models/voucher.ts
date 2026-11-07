import { VoucherAction, VoucherType } from '../enums/index.js';
import { VoucherCode } from '@kreiseck/validator';
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
  /**
   * Code eines eigenen Gutscheins (Einloesung, Auszahlung). Am gelesenen Eintrag die Maske. Ein Wunsch der
   * Altform mit frei getipptem Code ist veraltet ([LegacyValueVoucherWish]).
   */
  code?: string;
  /**
   * Fremdgutschein (Server 2026-11): `external` = Gutschein eines anderen Systems (Warenwirtschaft, Webshop) mit
   * seiner Nummer in [number]. Kein Dokument bei Kasseneck, kein Saldo, keine Pruefung: Art, Satz und Betrag sagt
   * der Betrieb. Fehlt bei eigenen Gutscheinen.
   */
  source?: VoucherSource | string;
  /**
   * Nummer des Fremdgutscheins (nur mit `source: 'external'`): nach [normalizeExternalVoucherNumber] 1 bis 40
   * Zeichen aus `A–Z a–z 0–9 - _ . /`; ein eigener Gutscheincode ist keine Fremdnummer. Steht voll am Bon.
   */
  number?: string;
  action: VoucherAction | string;
  /**
   * Art des Gutscheins. Beim Verkauf ueber eine Sorte die Art der Sorte
   * (`PosVoucherType.kind`): der Server prueft sie gegen die Sorte und lehnt
   * eine andere ab (`voucher_invalid`). Am Draht darf sie dort fehlen (die Art
   * kommt dann aus der Sorte); ein so gelesener Wunsch geht ohne `type` hinaus.
   */
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
  /**
   * Neue Form, Wertgutschein verkaufen: die Gutschein-Sorte
   * (`PosVoucherType.id` aus `getKasseSettings`). Pflicht fuer jeden Verkauf
   * eines Mehrzweck- oder Einzweckgutscheins (Server: `voucher_type_required`),
   * an jeder anderen Aktion oder Art verboten. Am gelesenen Eintrag die Sorte
   * des Verkaufs (fehlt ohne Sorte).
   */
  typeId?: string;
  // Nur gelesen (setzt der Server, ein Wunsch traegt sie nie):
  /** Name der Sorte beim Verkauf (eingefroren). */
  typeName?: string;
  /** Auszahlung des verkauften Gutscheins (`allowed`/`never`, eingefroren). */
  payout?: string;
  voucherType?: string;
  voucherId?: string;
  /** Letzte vier Zeichen des Codes; der Klartext steht nie am Beleg. */
  codeSuffix?: string;
  vatRateBp?: number;
  article?: VoucherArticle;
  balanceAfterCents?: number;
  remainingQuantityAfter?: number;
  /**
   * Rueckgabe als Gutschein: der Eintrag am Storno-Beleg ist die Ausgabe eines neuen Mehrzweck-
   * Gutscheins statt einer Rueckzahlung (`action: redeem`). Am Bon Zahlweg statt Einloesung.
   */
  fromReturn?: boolean;
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
  /** Verkauf ueber eine Sorte: ihre Kennung und ihr Name; sonst fehlen die Felder. */
  typeId?: string;
  typeName?: string;
  /** Rueckgabe als Gutschein (`cancelReceipt` mit `refundAs: 'voucher'`): `true`; fehlt beim Verkauf. */
  fromReturn?: true;
  validity?: {
    pattern: string;
    /** Sorte „N Jahre“: die Zahl N (Muster `1+3` fuer jedes N, die Daten gelten); fehlt sonst. */
    redeemableYears?: number;
    redeemableUntil: string | null;
    refundableUntil: string | null;
    validUntil: string | null;
  };
}

/**
 * Gutschein aus einer Rueckgabe in der Antwort von `cancelReceipt` (`data.issuedVouchers[]`). Beim ersten
 * Mal wie [IssuedVoucher] mit Klartext-Code; bei einer Wiederholung mit demselben `idempotencyKey` ohne
 * `code`, dafuer `reprintRequired: true` (der Zettel kommt dann ueber den Nachdruck).
 */
export type ReturnIssuedVoucher = Omit<IssuedVoucher, 'code' | 'type' | 'index'> & {
  code?: string;
  type?: string;
  index?: number;
  reprintRequired?: true;
};

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
  source?: string;
  number?: string;
  action: string;
  type: string;
  value?: number | null;
  valueCents?: number | null;
  amountCents?: number;
  articleId?: string;
  quantity?: number;
  positions?: number[];
  reason?: string;
  typeId?: string;
  typeName?: string;
  payout?: string;
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

/**
 * Wunsch der Altform: Wertgutschein mit frei getipptem Code (`{ action, type: 'value', code, valueCents }`).
 * Nur als Typ fuer Aufrufer, die ihn noch senden; ein gelesener Beleg ist davon nicht betroffen.
 *
 * @deprecated Server 2026-11: der Weg bleibt gueltig, die Antwort traegt `deprecation`
 * ([ReceiptWithCompany.deprecation]). Der Code wird nicht geprueft, steuerlich ist das ein fremder
 * Mehrzweckgutschein. Einen Gutschein eines anderen Systems als Fremdgutschein senden: `{ source: 'external',
 * action, type: 'multi_purpose', number, amountCents }`; eigene Gutscheine ueber eine Sorte (`typeId`)
 * verkaufen und mit ihrem Code einloesen.
 */
export type LegacyValueVoucherWish = Voucher & { type: 'value'; code: string };

/** Arten der neuen Gutscheinform (die Altwerte sind `value` und `promo`). */
export const NEUE_GUTSCHEINARTEN: readonly string[] = [
  VoucherType.multi_purpose,
  VoucherType.single_purpose,
  VoucherType.service,
  VoucherType.promotion,
];

/** Herkunft eines Gutscheins: `external` = Fremdgutschein (Katalog `GUTSCHEIN_QUELLE`). */
export type VoucherSource = 'external';
export const VOUCHER_SOURCES: readonly VoucherSource[] = Object.freeze(['external'] as const);

/** Fremdgutschein (`source: 'external'`)? Zwilling von `gutschein-beleg.istFremd`. */
export function isExternalVoucher(voucher: Pick<Voucher, 'source'>): boolean {
  return voucher.source === 'external';
}

/**
 * Verkauf ueber eine Sorte ohne Art (`typeId` ohne `type`): die Art kommt aus
 * der Sorte. Zwilling von `gutschein-beleg.istSortenVerkauf`.
 */
function istSortenVerkaufOhneArt(voucher: Pick<Voucher, 'type' | 'action' | 'typeId'>): boolean {
  return voucher.action === VoucherAction.sell && voucher.type == null && voucher.typeId != null;
}

/** Gehoert der Gutschein zur neuen Form (Art, Aktion `payout` oder Verkauf ueber eine Sorte ohne Art)? */
export function isNewFormVoucher(voucher: Pick<Voucher, 'type' | 'action' | 'typeId'> & Pick<Voucher, 'source'>): boolean {
  return NEUE_GUTSCHEINARTEN.includes(voucher.type) || voucher.action === VoucherAction.payout || istSortenVerkaufOhneArt(voucher)
    || isExternalVoucher(voucher);
}

/**
 * Wert-Verkauf: ein Mehrzweck- oder Einzweckgutschein wird verkauft (mit Art
 * oder nur ueber die Sorte). Paketintern: Zahlbetrag und Pruefung vor dem
 * Senden entscheiden daran, ob eine Sorte noetig ist.
 */
export function istWertVerkauf(voucher: Pick<Voucher, 'type' | 'action' | 'typeId'> & Pick<Voucher, 'source'>): boolean {
  return !isExternalVoucher(voucher) && voucher.action === VoucherAction.sell
    && (voucher.type === VoucherType.multi_purpose || voucher.type === VoucherType.single_purpose || istSortenVerkaufOhneArt(voucher));
}

/**
 * Felder, die nur der Server setzt; an einem Wunsch sind sie `voucher_invalid`.
 * Sortenname und Auszahlung friert der Server beim Verkauf ein (Stufe 4b).
 */
export const GUTSCHEIN_SERVERFELDER = ['voucherId', 'codeSuffix', 'zeroRateBucket', 'voucherType', 'typeName', 'payout', 'fromReturn'] as const;

/** Welche Serverfelder tragt der Gutschein (leere Liste = keines)? */
export function voucherServerFields(voucher: Voucher): string[] {
  return GUTSCHEIN_SERVERFELDER.filter((feld) => (voucher as unknown as Record<string, unknown>)[feld] != null);
}

const NEUE_FELDER = [
  'source', 'number', 'amountCents', 'articleId', 'quantity', 'positions', 'reason', 'typeId', 'typeName', 'payout', 'voucherType', 'voucherId', 'codeSuffix',
  'vatRateBp', 'article', 'balanceAfterCents', 'remainingQuantityAfter', 'taxedWith', 'exempt', 'zeroRateBucket', 'fromReturn',
] as const;

export function toVoucherPayload(voucher: Voucher): VoucherPayload {
  const action = requireEnumKey(VoucherAction, voucher.action, 'Gutschein-Aktion');
  // Verkauf ueber eine Sorte ohne Art: `type` bleibt weg wie im Wunsch (die Art kommt aus der Sorte).
  const ohneArt = istSortenVerkaufOhneArt(voucher);
  const type = ohneArt ? undefined : requireEnumKey(VoucherType, voucher.type, 'Gutscheinart');
  // Felder der neuen Form gehen roh hinaus, soweit gesetzt (auch an einem
  // gelesenen Altbeleg: dort fehlen sie, die Nutzlast bleibt byte-gleich).
  const roh = voucher as unknown as Record<string, unknown>;
  const neu: Record<string, unknown> = {};
  for (const feld of NEUE_FELDER) if (roh[feld] != null) neu[feld] = roh[feld];
  return {
    action,
    ...(ohneArt ? {} : { type }),
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
  if (isExternalVoucher(voucher)) return externalVoucherIsValid(voucher);
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
  // Ein Verkaufswunsch ueber eine Sorte darf ohne Art sein: dann bleibt `type` weg (nicht `undefined`).
  const ohneArt = payload.type == null && payload.action === VoucherAction.sell && payload.typeId != null;
  return {
    name: payload.name ?? undefined,
    code: payload.code ?? undefined,
    action: readEnumKey(VoucherAction, payload.action),
    ...(ohneArt ? {} : { type: readEnumKey(VoucherType, payload.type as string) }),
    valueCents,
    ...lesenNeu(payload),
  } as Voucher;
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
 * Form einer Sorten-Kennung am Wunsch (gutschein-core.ID_MUSTER ohne den
 * Ausschluss): eine reservierte `__…__` ist der Form nach gueltig, der Server
 * kennt sie nur nicht (`voucher_type_not_found`), ebenso der Zahlbetrag.
 */
const SORTE_ID_FORM = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Wunsch der neuen Form sendbar? Bildet die Regeln des Servers ab: Serverfelder
 * nie, Betrag/Menge ganz und positiv, Code bei Einloesung und Auszahlung,
 * Auszahlung nur Mehrzweck/Einzweck mit Grund (1 bis 200 Zeichen), Aktion nur
 * einloesbar, Leistung braucht Artikel und Menge (Verkauf) bzw. Positionen
 * (Einloesung), ein Wertgutschein wird nur ueber eine Sorte verkauft
 * (`typeId`). Felder, die zu einer anderen Aktion/Art gehoeren, sind
 * ebenfalls nicht erlaubt (der Server wiese sie ab).
 */
function newFormVoucherIsValid(v: Voucher): boolean {
  return wunschFormGueltig(v, true);
}

/**
 * Die Form eines Wunschs der neuen Form. `sorteNoetig: false` laesst einen
 * Wert-Verkauf ohne `typeId` zu: so rechnet der Zahlbetrag den Verkauf eines
 * Aufrufers bis 1.16 mit der alten Gutschein-Einstellung weiter (der Server ab
 * Stufe 4b antwortet darauf `voucher_type_required`). Paketintern.
 */
export function wunschFormGueltig(v: Voucher, sorteNoetig: boolean): boolean {
  if (isExternalVoucher(v)) return externalVoucherIsValid(v);
  if (voucherServerFields(v).length > 0) return false;
  const r = v as unknown as Record<string, unknown>;
  for (const feld of ['article', 'balanceAfterCents', 'remainingQuantityAfter', 'exempt']) {
    if (r[feld] != null) return false;
  }
  // Felder nur des Fremdgutscheins (gutschein-beleg.NUR_BEI_FREMD): der Server weist sie an einem eigenen Wunsch
  // schon gesendet ab, auch als `null` (`voucher_invalid`); eine andere Herkunft als `external` gibt es nicht.
  for (const feld of ['number', 'taxedWith', 'vatRateBp', 'source']) {
    if (r[feld] !== undefined) return false;
  }
  if (v.valueCents != null) return false;
  // Die Sorte gehoert nur an einen Wert-Verkauf (Server: sorteId sonst voucher_invalid).
  if (istWertVerkauf(v)) {
    if (v.typeId == null ? sorteNoetig : (typeof v.typeId !== 'string' || !SORTE_ID_FORM.test(v.typeId))) return false;
    return v.articleId == null && v.quantity == null && v.positions == null && v.reason == null && istCent(v.amountCents);
  }
  if (v.typeId != null) return false;
  const allein = v.type === VoucherType.multi_purpose || v.type === VoucherType.single_purpose;
  if (v.action === VoucherAction.payout) {
    return allein && hatText(v.code) && istCent(v.amountCents) && hatText(v.reason) && v.reason!.trim().length <= MAX_GRUND
      && v.articleId == null && v.quantity == null && v.positions == null;
  }
  if (v.reason != null) return false;
  if (allein) {
    if (v.articleId != null || v.quantity != null || v.positions != null) return false;
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

// ---- Fremdgutscheine (Server 2026-11) -------------------------------------------

/**
 * Rand einer Fremdnummer (Zwilling von `gutschein-core.FREMD_RAND`): ASCII-Leerraum und die Unicode-Leerzeichen,
 * die beim Kopieren aus Fremdsystemen mitkommen. Bewusst ohne U+0085 (NEL): ein Steuerzeichen, das nie still
 * verschwindet, sondern die Nummer ungueltig macht.
 */
const FREMD_RAND = '\\t\\n\\v\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF';
const FREMD_RAND_MUSTER = new RegExp(`^[${FREMD_RAND}]+|[${FREMD_RAND}]+$`, 'g');
const FREMD_NUMMER_MUSTER = /^[A-Za-z0-9\-_./]{1,40}$/;

/** Hoechstlaenge der Nummer eines Fremdgutscheins (nach dem Abschneiden des Rands). */
export const EXTERNAL_VOUCHER_NUMBER_MAX = 40;
/** Hoechstlaenge von `taxedWith` (Vermerk, mit welchem Beleg im fremden System der Einzweckgutschein versteuert ist). */
export const EXTERNAL_VOUCHER_TAXED_WITH_MAX = 40;
/**
 * Saetze, mit denen ein fremder Einzweckgutschein verkauft sein kann (Basispunkte): die Saetze der Kasse
 * (20, 10, 13, 19, 4,9 %) und 0 = befreit verkauft (Kleinunternehmer).
 */
export const EXTERNAL_VOUCHER_VAT_RATES_BP: readonly number[] = Object.freeze([2000, 1000, 1300, 1900, 490, 0]);

/**
 * Nummer eines Fremdgutscheins in der Form, mit der der Server sie speichert und druckt
 * (`gutschein-core.normiereFremdnummer`): Rand weg, **keine** Unicode-Normalisierung, Gross-/Kleinschreibung
 * bleibt; dann 1 bis 40 Zeichen aus `A–Z a–z 0–9 - _ . /`. Sonst `null` (`external_voucher_number_invalid`).
 * Einen eigenen Gutscheincode erkennt erst [checkExternalVoucherNumber].
 */
export function normalizeExternalVoucherNumber(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const n = text.replace(FREMD_RAND_MUSTER, '');
  return FREMD_NUMMER_MUSTER.test(n) ? n : null;
}

/** Ergebnis von [checkExternalVoucherNumber]: die Nummer wie gespeichert, oder der Fehlercode des Servers. */
export type ExternalVoucherNumberCheck =
  | { ok: true; number: string }
  | { ok: false; code: 'external_voucher_number_is_own_code' | 'external_voucher_number_invalid' };

/**
 * Prueft eine Fremdnummer in der Reihenfolge des Servers (`gutschein-beleg.pruefeFremd`): zuerst, ob sie ein
 * gueltiger eigener Gutscheincode ist (12 Zeichen mit Pruefzeichen, in jeder Schreibweise der Kasse, auch mit `.`, `_`
 * oder `/` als Trenner) – dann
 * `external_voucher_number_is_own_code`, der Gutschein gehoert als eigener eingeloest –, danach die Form.
 */
export function checkExternalVoucherNumber(text: unknown): ExternalVoucherNumberCheck {
  // `.`, `_` und `/` zwischen den Gruppen liest die Pruefung wie `-` (Zwilling von `gutschein-core.istEigenerCode`):
  // `7148.FGQA.935K` ist der eigene Code. Die Nummer selbst bleibt, wie sie kam.
  if (typeof text === 'string' && VoucherCode.validate(text.replace(/[._/]/g, '-')).ok) return { ok: false, code: 'external_voucher_number_is_own_code' };
  const number = normalizeExternalVoucherNumber(text);
  return number === null ? { ok: false, code: 'external_voucher_number_invalid' } : { ok: true, number };
}

/** Steuer- und Formatzeichen (`gutschein-core.STEUERZEICHEN`): nie in `taxedWith`. */
const STEUERZEICHEN = /[\p{Cc}\p{Cf}]/u;

/**
 * Ist der Fremdgutschein sendbar? Die Form wie `gutschein-beleg.pruefeFremd` (ohne die Freigabe des Kontos, die
 * kennt nur der Server bzw. `PosVoucherSettings.externalVouchers`): Aktion `sell`/`redeem`/`payout`, Art
 * `multi_purpose`/`single_purpose`, gueltige Nummer (kein eigener Code), Betrag 1 bis 1.000.000 Cent; Einzweck mit
 * einem Satz aus [EXTERNAL_VOUCHER_VAT_RATES_BP], Mehrzweck ohne; `taxedWith` nur bei Einzweck-Einloesung bzw.
 * -Auszahlung (1 bis 40 Zeichen ohne Steuerzeichen); Auszahlung mit Grund (1 bis 200 Zeichen). Felder eigener
 * Gutscheine (Code, Sorte, Artikel, Menge, Positionen) und Serverfelder nie.
 */
export function externalVoucherIsValid(voucher: Voucher): boolean {
  const v = voucher;
  if (!isExternalVoucher(v)) return false;
  if (voucherServerFields(v).length > 0) return false;
  const r = v as unknown as Record<string, unknown>;
  // gutschein-beleg.NICHT_BEI_FREMD (gesendet heisst voucher_invalid, auch als null).
  for (const feld of ['code', 'typeId', 'articleId', 'article', 'quantity', 'positions']) {
    if (r[feld] !== undefined) return false;
  }
  for (const feld of ['balanceAfterCents', 'remainingQuantityAfter', 'exempt']) {
    if (r[feld] != null) return false;
  }
  if (v.valueCents != null) return false;
  if (v.action !== VoucherAction.sell && v.action !== VoucherAction.redeem && v.action !== VoucherAction.payout) return false;
  if (v.type !== VoucherType.multi_purpose && v.type !== VoucherType.single_purpose) return false;
  if (!checkExternalVoucherNumber(v.number).ok) return false;
  if (!istCent(v.amountCents)) return false;
  if (v.type === VoucherType.single_purpose) {
    if (!(typeof v.vatRateBp === 'number' && EXTERNAL_VOUCHER_VAT_RATES_BP.includes(v.vatRateBp))) return false;
  } else if (v.vatRateBp != null) {
    return false;
  }
  if (v.taxedWith != null) {
    if (v.type !== VoucherType.single_purpose || v.action === VoucherAction.sell) return false;
    const t = typeof v.taxedWith === 'string' ? v.taxedWith.trim() : '';
    if (t.length < 1 || t.length > EXTERNAL_VOUCHER_TAXED_WITH_MAX || STEUERZEICHEN.test(t)) return false;
  }
  if (v.action === VoucherAction.payout) {
    const g = typeof v.reason === 'string' ? v.reason.trim() : '';
    if (g.length < 1 || g.length > MAX_GRUND) return false;
  }
  return true;
}
