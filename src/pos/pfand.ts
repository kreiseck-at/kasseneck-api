/**
 * Pfand & Leergut an der Kasse: Pfandarten und Einstellungen aus
 * `getKasseSettings` (Block `deposit`), Pfandliste am Artikel und an der
 * Gruppe (`deposits`) und die Pfand-Angaben des Kassenobjekts aus
 * `listRegisterUsersForDevice`. Alles nur Lesen und Schreiben der Formen; die
 * Rechnung (Betrag, Staffel nach Tag) kommt in einem eigenen Modul.
 */

import { Gtin } from '@kreiseck/validator';
import type { ReceiptItem } from '../models/receipt-item.js';
import { readVatRateByRate } from '../models/enum-payload.js';

/** Art einer Pfandart: Einweg oder Mehrweg. */
export const DEPOSIT_KINDS = ['single_use', 'reusable'] as const;
export type DepositKind = typeof DEPOSIT_KINDS[number];

/** Gebindetyp einer Pfandart (frei, nur zur Anzeige). */
export const DEPOSIT_TYPES = ['bottle', 'crate', 'keg', 'cup', 'glass', 'other'] as const;
export type DepositContainerType = typeof DEPOSIT_TYPES[number];

/** Wer nimmt Leergut an der Kasse zurueck: diese Kasse, eine gemeinsame Stelle oder niemand. */
export const DEPOSIT_RETURN_MODES = ['here', 'shared', 'none'] as const;
export type DepositReturnMode = typeof DEPOSIT_RETURN_MODES[number];

/** Vorbelegung, ob Getraenke vor Ort getrunken oder mitgenommen werden. */
export const DEPOSIT_ON_PREMISES_DEFAULTS = ['on_premises', 'takeaway', 'ask'] as const;
export type DepositOnPremisesDefault = typeof DEPOSIT_ON_PREMISES_DEFAULTS[number];

/** Ein Pfandbetrag ab einem Tag (`from`, Wiener Tag `YYYY-MM-DD`), in Cent je Stueck. */
export interface DepositAmount {
  from: string;
  cents: number;
}

/** Eine Pfandart des Betriebs. */
export interface DepositType {
  id: string;
  kind: DepositKind;
  name: string;
  type: DepositContainerType | null;
  /** Betraege nach Gueltigkeit, wie vom Server geliefert (aufsteigend nach `from`). */
  amounts: DepositAmount[];
  /** Steuersatz in Prozent, mit dem Mehrweg-Leergut zurueckgenommen wird (Rueckgabesatz), oder null (noch nie ausgegeben). */
  returnRate: number | null;
  /** Die Pfandart steht an mindestens einem Artikel oder Beleg. */
  used: boolean;
  active: boolean;
}

/** Block `deposit` aus `getKasseSettings`; fehlt bei ausgeschaltetem Pfand. */
export interface DepositSettings {
  singleUse: boolean;
  reusable: boolean;
  depositTypes: DepositType[];
}

/** Eine Pfandangabe an Artikel oder Gruppe (`deposits[]`). */
export interface DepositEntry {
  depositTypeId: string;
  quantity: number;
  gtin?: string;
  ownFilling?: boolean;
}

/** Gemeinsame Rueckgabestelle (Kassen-Pfandangaben). */
export interface DepositSharedReturnPoint {
  name: string;
  address: string;
}

/** Pfand-Angaben des Kassenobjekts aus `listRegisterUsersForDevice`; fehlt bei ausgeschaltetem Pfand. */
export interface CashRegisterDeposit {
  returns: DepositReturnMode;
  onPremisesDefault: DepositOnPremisesDefault;
  usualQuantity: number;
  sharedReturnPoint: DepositSharedReturnPoint | null;
}

type Objekt = Record<string, unknown>;
const istObjekt = (w: unknown): w is Objekt => w !== null && typeof w === 'object' && !Array.isArray(w);
const istGanz = (w: unknown, min: number): w is number => Number.isInteger(w) && (w as number) >= min;

function aus<T extends string>(liste: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (liste as readonly string[]).includes(value) ? (value as T) : null;
}

function betrag(value: unknown): DepositAmount | null {
  if (!istObjekt(value) || typeof value['from'] !== 'string' || !istGanz(value['cents'], 0)) return null;
  return { from: value['from'], cents: value['cents'] };
}

function pfandart(value: unknown): DepositType | null {
  if (!istObjekt(value) || typeof value['id'] !== 'string' || value['id'] === '') return null;
  const kind = aus(DEPOSIT_KINDS, value['kind']);
  if (kind == null) return null;
  const rate = value['returnRate'];
  return {
    id: value['id'],
    kind,
    name: typeof value['name'] === 'string' ? value['name'] : '',
    type: aus(DEPOSIT_TYPES, value['type']),
    amounts: Array.isArray(value['amounts']) ? value['amounts'].map(betrag).filter((b): b is DepositAmount => b != null) : [],
    returnRate: typeof rate === 'number' && Number.isFinite(rate) ? rate : null,
    used: value['used'] === true,
    active: value['active'] !== false,
  };
}

/**
 * Den Block `deposit` einer Antwort lesen. Kein Objekt (Pfand aus, alter
 * Server) -> `undefined`: das Feld fehlt dann am Modell, es wird nichts erfunden.
 * Eine Pfandart in unbekannter Form faellt weg.
 */
export function posDepositSettingsFromWire(value: unknown): DepositSettings | undefined {
  if (!istObjekt(value)) return undefined;
  return {
    singleUse: value['singleUse'] === true,
    reusable: value['reusable'] === true,
    depositTypes: Array.isArray(value['depositTypes']) ? value['depositTypes'].map(pfandart).filter((a): a is DepositType => a != null) : [],
  };
}

/** Die Pfandliste eines Artikels oder einer Gruppe; keine Liste -> `null`, unlesbare Eintraege fallen weg. */
export function depositEntriesFromWire(value: unknown): DepositEntry[] | null {
  if (!Array.isArray(value)) return null;
  const raus: DepositEntry[] = [];
  for (const e of value) {
    if (!istObjekt(e) || typeof e['depositTypeId'] !== 'string' || e['depositTypeId'] === '' || !istGanz(e['quantity'], 1)) continue;
    raus.push({
      depositTypeId: e['depositTypeId'],
      quantity: e['quantity'],
      ...(typeof e['gtin'] === 'string' && e['gtin'] !== '' ? { gtin: e['gtin'] } : {}),
      ...(typeof e['ownFilling'] === 'boolean' ? { ownFilling: e['ownFilling'] } : {}),
    });
  }
  return raus;
}

/** Die Pfand-Angaben eines Kassenobjekts; fehlt der Block oder ist er unbrauchbar -> `undefined`. */
export function cashRegisterDepositFromWire(value: unknown): CashRegisterDeposit | undefined {
  if (!istObjekt(value)) return undefined;
  const returns = aus(DEPOSIT_RETURN_MODES, value['returns']);
  const onPremisesDefault = aus(DEPOSIT_ON_PREMISES_DEFAULTS, value['onPremisesDefault']);
  if (returns == null || onPremisesDefault == null) return undefined;
  const stelle = value['sharedReturnPoint'];
  return {
    returns,
    onPremisesDefault,
    usualQuantity: istGanz(value['usualQuantity'], 1) ? value['usualQuantity'] : 1,
    sharedReturnPoint: istObjekt(stelle) && typeof stelle['name'] === 'string'
      ? { name: stelle['name'], address: typeof stelle['address'] === 'string' ? stelle['address'] : '' }
      : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Vorschau-Rechnung: dieselben Pfand- und Leergutzeilen wie der Server (`createReceipt`), damit der Korb sie vor
// dem Buchen zeigt. Vertrag sind die Pruefaelle `fixtures/deposit-cases.json` (Backend `pfand-faelle.json`).
// ---------------------------------------------------------------------------------------------------------------

/** EWP-GTIN der Einweg-Pfandzeile (gesetzlich festgelegt). */
const EWP_GTIN = '9010945000011';

/** Pfandangaben, wirksam fuer einen Artikel: Artikel vor Gruppe, `[]` = kein Pfand, `null`/fehlend = wie die Gruppe. */
export function depositsFor(
  article: { deposits?: DepositEntry[] | null; externalVoucher?: unknown } | null | undefined,
  group: { deposits?: DepositEntry[] | null } | null | undefined,
): DepositEntry[] {
  if (article == null) return [];
  if (article.externalVoucher != null) return []; // fremde Gutscheine tragen nie Pfand, auch nicht von der Gruppe
  if (Array.isArray(article.deposits)) return article.deposits;
  if (group != null && Array.isArray(group.deposits)) return group.deposits;
  return [];
}

/** Pfandbetrag in Cent am Wiener Tag `day` (`YYYY-MM-DD`): letzter Eintrag mit `from <= day`, sonst `null`. */
export function depositAmountOn(type: Pick<DepositType, 'amounts'>, day: string): number | null {
  let cents: number | null = null;
  for (const e of type.amounts) {
    if (e.from <= day) cents = e.cents; else break;
  }
  return cents;
}

const tagFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Wiener Kalendertag `YYYY-MM-DD` zum Zeitpunkt `nowMs` (nie der UTC-Tag). */
export function viennaDay(nowMs: number): string {
  const teile: Record<string, string> = {};
  for (const t of tagFormat.formatToParts(new Date(nowMs))) teile[t.type] = t.value;
  return `${teile['year']}-${teile['month']}-${teile['day']}`;
}

/** Eine Position des Korbs in der Leitungsform (`amount`/`quantity`, `vat`/`vatRate`, `addOnOf` ...). */
export type DepositPreviewItem = object | null;
/** Eine Pfand- oder Leergutzeile in der Leitungsform, wie der Server sie baut. */
export type DepositPreviewLine = Record<string, unknown>;

/** Fehlercodes der Vorschau (die /v3-Codes von `createReceipt`). */
export type DepositPreviewErrorCode =
  | 'invalid_deposit' | 'deposit_set_by_server' | 'deposit_type_not_found' | 'invalid_deposit_quantity'
  | 'deposit_return_not_offered' | 'deposit_type_not_issued' | 'not_permitted';

/** Eingabe der Vorschau (ohne die Positionen): was der Server aus Konto, Kasse und Beleg wuesste. */
export interface DepositPreviewInput {
  /** Pfand zu Artikeln selbst ableiten (`autoDeposits`). */
  auto: boolean;
  articles: ReadonlyMap<string, DepositPreviewArticle> | Readonly<Record<string, DepositPreviewArticle>>;
  groups: ReadonlyMap<string, { deposits?: DepositEntry[] | null }> | Readonly<Record<string, { deposits?: DepositEntry[] | null }>>;
  depositTypes: ReadonlyMap<string, DepositType> | Readonly<Record<string, DepositType>>;
  /** Wiener Tag des Belegs. */
  day: string;
  /** Vor Ort getrunken: Einweg entfaellt. */
  onPremises: boolean;
  /** Pfand-Angaben der Kasse (nur `returns` zaehlt); ohne Angabe nimmt die Kasse kein Leergut zurueck. */
  cashRegister?: Pick<CashRegisterDeposit, 'returns'> | null;
  smallBusiness: boolean;
  /** Der Benutzer darf Leergut zuruecknehmen (`depositReturnOf`). */
  mayReturn: boolean;
}

/** Artikel, soweit die Vorschau ihn liest. */
export interface DepositPreviewArticle {
  id?: string;
  groupId?: string | null;
  deposits?: DepositEntry[] | null;
  externalVoucher?: unknown;
}

export type DepositPreviewResult<T> = { ok: true; items: T[] } | { ok: false; code: DepositPreviewErrorCode };

type Obj = Record<string, unknown>;
const istObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const ganz = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const nachId = <T>(karte: ReadonlyMap<string, T> | Readonly<Record<string, T>>, id: string): T | undefined => {
  if (karte instanceof Map) return karte.get(id);
  return Object.prototype.hasOwnProperty.call(karte, id) ? (karte as Readonly<Record<string, T>>)[id] : undefined;
};
const fehler = (code: DepositPreviewErrorCode): { ok: false; code: DepositPreviewErrorCode } => ({ ok: false, code });

const OHNE_PFAND = ['tip', 'discount', 'voucher', 'voucher_float', 'deposit', 'deposit_return'];
const istHaupt = (it: unknown): it is Obj => istObj(it) && !OHNE_PFAND.includes(it['kind'] as string);
const mengeVon = (it: Obj): unknown => (it['amount'] !== undefined && it['amount'] !== null ? it['amount'] : it['quantity']);
const satzVon = (it: Obj): unknown => (it['vat'] !== undefined && it['vat'] !== null ? it['vat'] : it['vatRate']);
const hatVerweis = (it: Obj): boolean => it['addOnOf'] !== undefined && it['addOnOf'] !== null;

const aktiv = (arten: DepositPreviewInput['depositTypes'], id: unknown): DepositType | null => {
  const a = typeof id === 'string' ? nachId(arten, id) : undefined;
  return a && a.active !== false ? a : null;
};

function zeile(kind: 'deposit' | 'deposit_return', art: DepositType, name: string, quantity: number, cents: number, vatRate: number): DepositPreviewLine {
  return {
    kind, name, quantity, amount: quantity,
    unitPriceCents: cents, priceOneCents: cents, priceOne: cents / 100, vatRate, vat: vatRate,
    depositTypeId: art.id, depositKind: art.kind,
  };
}

function pfandPreis(art: DepositType, haupt: Obj, day: string, smallBusiness: boolean): { cents: number; vatRate: number } | null {
  const cents = depositAmountOn(art, day);
  if (cents === null) return null;
  if (art.kind === 'single_use') return { cents, vatRate: 0 };
  if (smallBusiness) return { cents, vatRate: 0 };
  const satz = satzVon(haupt);
  return typeof satz === 'number' && Number.isFinite(satz) ? { cents, vatRate: satz } : null;
}

function abgeleitet(it: unknown, input: DepositPreviewInput): DepositEntry[] {
  if (!input.auto || !istHaupt(it) || typeof it['articleId'] !== 'string' || it['articleId'] === '') return [];
  const a = nachId(input.articles, it['articleId']);
  if (!a) return [];
  const g = a.groupId ? nachId(input.groups, a.groupId) : null;
  return depositsFor(a, g);
}

function gtinOk(v: unknown): v is string {
  return typeof v === 'string' && Gtin.isValid(v);
}

function leergut(it: Obj, input: Pick<DepositPreviewInput, 'depositTypes' | 'day' | 'smallBusiness' | 'cashRegister' | 'mayReturn'>): { ok: true; line: DepositPreviewLine } | { ok: false; code: DepositPreviewErrorCode } {
  if (!input.cashRegister || input.cashRegister.returns !== 'here') return fehler('deposit_return_not_offered');
  if (input.mayReturn === false) return fehler('not_permitted');
  const art = aktiv(input.depositTypes, it['depositTypeId']);
  if (!art) return fehler('deposit_type_not_found');
  if (art.kind === 'reusable' && art.used !== true) return fehler('deposit_type_not_issued');
  const quantity = it['quantity'];
  if (!ganz(quantity, 1, 1000)) return fehler('invalid_deposit');
  let codes: Record<string, number> | undefined;
  if (it['codes'] !== undefined && it['codes'] !== null) {
    if (!istObj(it['codes'])) return fehler('invalid_deposit');
    const schluessel = Object.keys(it['codes']);
    if (schluessel.length > 50) return fehler('invalid_deposit');
    let summe = 0;
    for (const k of schluessel) {
      const n = it['codes'][k];
      if (!gtinOk(k) || !ganz(n, 1, 1000)) return fehler('invalid_deposit');
      summe += n;
    }
    if (summe !== quantity) return fehler('invalid_deposit');
    codes = { ...(it['codes'] as Record<string, number>) };
  }
  const cents = depositAmountOn(art, input.day);
  if (cents === null) return fehler('invalid_deposit');
  // Mehrweg-Leergut rechnet mit dem Rueckgabesatz der Pfandart (`returnRate` = Steuersatz), bei Kleinunternehmern 0.
  let vatRate = 0;
  if (art.kind === 'reusable' && !input.smallBusiness) {
    if (art.returnRate === null || !Number.isFinite(art.returnRate)) return fehler('invalid_deposit');
    vatRate = art.returnRate;
  }
  const z = zeile('deposit_return', art, 'Leergut ' + art.name.replace(/^Pfand /, ''), quantity, -cents, vatRate);
  if (art.kind === 'single_use') z['ean'] = EWP_GTIN;
  if (codes) z['codes'] = codes;
  return { ok: true, line: z };
}

/**
 * Pfand- und Leergutzeilen eines Belegs wie der Server: leitet Pfand zu Artikeln ab (`auto`), prueft ausdrueckliche
 * `deposit`-Zeilen und `deposit_return`-Zeilen und rechnet `addOnOf` und `depositFor` auf die neuen Positionen um.
 * Ohne Pfand-/Leergutzeile und ohne Ableitung kommen die Positionen unveraendert zurueck. Die Fehlercodes sind die
 * von `createReceipt`.
 */
export function withDepositLines<T extends DepositPreviewItem>(items: readonly T[], input: DepositPreviewInput): DepositPreviewResult<T | DepositPreviewLine> {
  const liste = Array.isArray(items) ? items : [];
  const dahinter = new Map<number, DepositPreviewLine[]>();
  const ersetzt = new Map<number, DepositPreviewLine>();
  const hinzu = (i: number, z: DepositPreviewLine): void => { dahinter.set(i, [...(dahinter.get(i) ?? []), z]); };

  for (let i = 0; i < liste.length; i += 1) {
    const it = liste[i];
    if (!istObj(it)) continue;
    if (it['kind'] === 'deposit_return') {
      const r = leergut(it, input);
      if (!r.ok) return r;
      ersetzt.set(i, r.line);
      continue;
    }
    if (it['kind'] === 'deposit') {
      const verweis = it['depositFor'];
      const haupt = Number.isInteger(verweis) ? liste[verweis as number] : null;
      if (!istHaupt(haupt)) return fehler('invalid_deposit');
      if (abgeleitet(haupt, input).length > 0) return fehler('deposit_set_by_server');
      const art = aktiv(input.depositTypes, it['depositTypeId']);
      if (!art) return fehler('deposit_type_not_found');
      const menge = mengeVon(haupt);
      if (!Number.isInteger(menge) || menge === 0) return fehler('invalid_deposit_quantity');
      const quantity = it['quantity'] === undefined || it['quantity'] === null ? menge : it['quantity'];
      if (!Number.isInteger(quantity) || (quantity as number) % (menge as number) !== 0 || (quantity as number) / (menge as number) < 1) return fehler('invalid_deposit_quantity');
      const preis = pfandPreis(art, haupt, input.day, input.smallBusiness);
      if (!preis) return fehler('invalid_deposit');
      const hatGtin = it['gtin'] !== undefined && it['gtin'] !== null;
      if (hatGtin && !gtinOk(it['gtin'])) return fehler('invalid_deposit');
      if (it['ownFilling'] !== undefined && it['ownFilling'] !== null && typeof it['ownFilling'] !== 'boolean') return fehler('invalid_deposit');
      if (it['ownFilling'] === true && !hatGtin) return fehler('invalid_deposit');
      const q = quantity as number;
      const z = zeile('deposit', art, art.name, q, preis.cents, preis.vatRate);
      z['depositFor'] = verweis;
      z['perUnit'] = q / (menge as number);
      if (art.kind === 'single_use') z['ean'] = EWP_GTIN;
      if (hatGtin) z['gtin'] = it['gtin'];
      if (it['ownFilling'] === true) z['ownFilling'] = true;
      ersetzt.set(i, z);
      continue;
    }
    const eintraege = abgeleitet(it, input);
    if (!eintraege.length) continue;
    const menge = mengeVon(it);
    const gelten: { e: DepositEntry; art: DepositType }[] = [];
    for (const e of eintraege) {
      const art = aktiv(input.depositTypes, e.depositTypeId);
      if (!art) return fehler('deposit_type_not_found');
      if (art.kind === 'single_use' && input.onPremises === true) continue;
      gelten.push({ e, art });
    }
    if (!gelten.length) continue;
    if (!Number.isInteger(menge)) return fehler('invalid_deposit_quantity');
    if (menge === 0) continue;
    for (const { e, art } of gelten) {
      const preis = pfandPreis(art, it, input.day, input.smallBusiness);
      if (!preis) return fehler('invalid_deposit');
      const z = zeile('deposit', art, art.name, e.quantity * (menge as number), preis.cents, preis.vatRate);
      z['depositFor'] = i;
      z['perUnit'] = e.quantity;
      if (art.kind === 'single_use') z['ean'] = EWP_GTIN;
      if (e.gtin) z['gtin'] = e.gtin;
      if (e.ownFilling === true) z['ownFilling'] = true;
      hinzu(i, z);
    }
  }

  if (!ersetzt.size && !dahinter.size) return { ok: true, items: [...liste] };

  const neu: number[] = [];
  let verschiebung = 0;
  liste.forEach((_, i) => { neu.push(i + verschiebung); verschiebung += dahinter.get(i)?.length ?? 0; });
  const umgerechnet = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? neu[v] : undefined);

  const raus: (T | DepositPreviewLine)[] = [];
  liste.forEach((it, i) => {
    if (!istObj(it)) { raus.push(it); return; }
    let z: Obj = ersetzt.get(i) ?? it;
    if (z['kind'] === 'deposit' && umgerechnet(z['depositFor']) !== undefined) z = { ...z, depositFor: umgerechnet(z['depositFor']) };
    else if (hatVerweis(z) && umgerechnet(z['addOnOf']) !== undefined) z = { ...z, addOnOf: umgerechnet(z['addOnOf']) };
    raus.push(z);
    for (const d of dahinter.get(i) ?? []) raus.push({ ...d, depositFor: neu[i] });
  });
  return { ok: true, items: raus };
}

/**
 * Die Leergutzeile zu `quantity` Stueck einer Pfandart, wie `withDepositLines` sie fuer eine
 * `deposit_return`-Eingabe baut (fuer die Korb-Vorschau). Wirft, wenn sich keine Zeile ergibt
 * (unbekannte Pfandart, Menge ausserhalb 1 bis 1000, Mehrweg ohne Rueckgabesatz, ungueltige Codes);
 * ob die Kasse Leergut annimmt, prueft der Aufrufer.
 */
export function depositReturnLine(
  type: DepositType,
  quantity: number,
  options: { day: string; smallBusiness: boolean; codes?: Record<string, number> },
): ReceiptItem {
  const r = leergut(
    { kind: 'deposit_return', depositTypeId: type.id, quantity, ...(options.codes ? { codes: options.codes } : {}) },
    { depositTypes: { [type.id]: type }, day: options.day, smallBusiness: options.smallBusiness, cashRegister: { returns: 'here' }, mayReturn: true },
  );
  if (!r.ok) throw new Error(`Leergutzeile nicht moeglich: ${r.code}`);
  const l = r.line;
  const item: ReceiptItem = {
    name: l['name'] as string,
    quantity: l['quantity'] as number,
    vat: readVatRateByRate(l['vatRate'] as number),
    priceCents: l['unitPriceCents'] as number,
    kind: 'deposit_return',
    depositTypeId: l['depositTypeId'] as string,
    depositKind: type.kind,
  };
  if (typeof l['ean'] === 'string') item.ean = l['ean'];
  if (l['codes'] !== undefined) item.codes = l['codes'] as Record<string, number>;
  return item;
}
