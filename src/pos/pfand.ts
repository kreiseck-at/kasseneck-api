/**
 * Pfand & Leergut an der Kasse: Pfandarten und Einstellungen aus
 * `getKasseSettings` (Block `deposit`), Pfandliste am Artikel und an der
 * Gruppe (`deposits`) und die Pfand-Angaben des Kassenobjekts aus
 * `listRegisterUsersForDevice`. Alles nur Lesen und Schreiben der Formen; die
 * Rechnung (Betrag, Staffel nach Tag) kommt in einem eigenen Modul.
 */

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
  /** Quote der Rueckgabe in Prozent (Schaetzung fuer die Auswertung) oder null. */
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
