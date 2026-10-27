import { VoucherCode } from '@kreiseck/validator';
import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckApiError, KasseneckValidationError } from '../client/errors.js';

/**
 * Gutschein pruefen und Etikett nachdrucken an der Kasse (Backend
 * gutschein-endpoints). Beide Aufrufe gibt es nur ueber den Kassenweg
 * `/api/v3`.
 *
 * Der Klartext-Code lebt nur im Speicher des Aufrufs: er wird weder
 * protokolliert noch in einer Fehlermeldung genannt. Die Kasse bekommt nach
 * dem Pruefen nur die letzten vier Zeichen (`codeSuffix`) zurueck.
 */

export type VoucherKind = 'multi_purpose' | 'single_purpose' | 'service' | 'promotion';
export type VoucherStatus = 'active' | 'used_up' | 'expired' | 'paid_out' | 'cancelled' | 'blocked';

export const VOUCHER_KINDS: readonly VoucherKind[] = Object.freeze(['multi_purpose', 'single_purpose', 'service', 'promotion'] as const);
export const VOUCHER_STATUSES: readonly VoucherStatus[] = Object.freeze(['active', 'used_up', 'expired', 'paid_out', 'cancelled', 'blocked'] as const);
// Nur die Muster, die der Server an Gutscheinen nach aussen gibt: eine Sorte mit
// „N Jahre“ geht als `1+3` bzw. `custom` mit `redeemableYears` hinaus (Nachtrag E1),
// damit Kassen mit 1.14 beim Einloesen nicht an einem neuen Muster scheitern.
const VOUCHER_VALIDITY_PATTERNS = ['unlimited', '1+3', 'custom'] as const;

/** Gueltigkeit eines Gutscheins; Daten als `YYYY-MM-DD` (Wiener Tag). Was der Server nicht nennt, fehlt. */
export interface VoucherValidity {
  pattern: 'unlimited' | '1+3' | 'custom';
  /**
   * Gutschein einer Sorte „N Jahre einloesbar, danach 3 Jahre Rueckzahlung“:
   * die Zahl N (1 bis 30). Fehlt bei Gutscheinen ohne Sorte und bei
   * unbefristeten. Die Daten stehen trotzdem in `redeemableUntil`/`refundableUntil`.
   */
  redeemableYears?: number;
  redeemableUntil?: string;
  refundableUntil?: string;
  validUntil?: string;
}

/** Auszahlung eines Gutscheins bzw. einer Sorte: erlaubt oder nie (nur bei unbefristeter Gueltigkeit). */
export type VoucherPayout = 'allowed' | 'never';
/** Art einer Gutschein-Sorte: nur Wertgutscheine (Leistung und Aktion sind keine Sorte). */
export type VoucherTypeKind = 'multi_purpose' | 'single_purpose';

export const VOUCHER_PAYOUTS: readonly VoucherPayout[] = Object.freeze(['allowed', 'never'] as const);
export const VOUCHER_TYPE_KINDS: readonly VoucherTypeKind[] = Object.freeze(['multi_purpose', 'single_purpose'] as const);
/** Betrag einer Sorte: frei an der Kasse eingegeben oder fest. */
export const VOUCHER_AMOUNT_MODES: readonly ('free' | 'fixed')[] = Object.freeze(['free', 'fixed'] as const);
/** Gueltigkeit einer Sorte: unbefristet oder N Jahre (das Muster der Sorte, nicht das eines Gutscheins). */
export const VOUCHER_TYPE_VALIDITY_PATTERNS: readonly ('unlimited' | 'years')[] = Object.freeze(['unlimited', 'years'] as const);

/** Der Artikel eines Dienstleistungsgutscheins. */
export interface VoucherArticle {
  id: string;
  name: string;
  vatRateBp: number;
  priceCents: number;
}

/**
 * Stand eines Gutscheins nach dem Code-Eingeben. Felder, die zur Art nicht
 * passen oder die der Server nicht sendet, fehlen im Modell (nie `null`).
 */
export interface VoucherCheck {
  type: VoucherKind;
  status: VoucherStatus;
  /** Die letzten vier Zeichen des Codes, fuer Anzeige und Beleg. */
  codeSuffix: string;
  balanceCents?: number;
  faceValueCents?: number;
  quantity?: number;
  remainingQuantity?: number;
  vatRateBp?: number;
  article?: VoucherArticle;
  discountCents?: number;
  discountPercentBp?: number;
  validity?: VoucherValidity;
  /**
   * Befreit verkauft (Kleinunternehmer beim Verkauf, Satz 0): eine Einloesung
   * verteilt sich anteilig auf alle Saetze des Korbs, auch in einem
   * inzwischen steuerpflichtigen Konto. Fehlt bei aelteren Servern.
   */
  exempt?: boolean;
  /** Name der Sorte, mit der der Gutschein verkauft wurde (beim Verkauf eingefroren); fehlt ohne Sorte. */
  typeName?: string;
  /**
   * Auszahlung dieses Gutscheins (beim Verkauf eingefroren); fehlt ohne
   * Sorte. Bei `never` lehnt der Server jede Auszahlung ab
   * (`voucher_payout_not_allowed`); Einloesen geht unveraendert.
   */
  payout?: VoucherPayout;
}

/**
 * Etikett-Vorlage in der `/v3`-Form (Groesse, Layout, Drehung, Felder,
 * Freitext). Das Paket zeichnet keine Etiketten: es reicht die Vorlage als
 * Kopie durch, gezeichnet wird in der Kasse (druck-kit, Kassen-App). Weitere
 * Schluessel eines neueren Servers bleiben erhalten.
 */
export interface VoucherLabelTemplate {
  /** Etikettgroesse `BxH` in mm, z. B. `40x30`. */
  size: string;
  layout: string;
  /** 0 oder 90 (Grad); fehlt = 0. */
  rotation?: number;
  fields?: Record<string, boolean>;
  freeText?: string[];
  [key: string]: unknown;
}

/**
 * Gutschein-Sorte (Gutscheine Stufe 4b): eine Kachel im Reiter „Gutscheine“.
 * Die Kasse bekommt nur verkaufbare Sorten (aktiv und gueltig), in
 * Kachelfolge. Verkauft wird ein Wertgutschein nur ueber eine Sorte:
 * `{ action: 'sell', type: kind, typeId: id, amountCents }` (bei `fixed` genau
 * `amount.cents`); Art, Satz, Gueltigkeit und Auszahlung nimmt der Server aus
 * der Sorte und friert sie am Gutschein ein.
 */
export interface PosVoucherType {
  id: string;
  name: string;
  kind: VoucherTypeKind;
  /** Satz in Basispunkten, nur bei Einzweck (> 0); Mehrzweck `null`. */
  vatRateBp: number | null;
  /** Betrag: frei (Zahlenfeld) oder fest (sofort in den Korb), Cent ganzzahlig. */
  amount: { mode: 'free' } | { mode: 'fixed'; cents: number };
  /** Unbefristet oder N Jahre einloesbar, danach 3 Jahre Rueckzahlung (N 1 bis 30). */
  validity: { pattern: 'unlimited' } | { pattern: 'years'; years: number };
  payout: VoucherPayout;
  /** Wirksame Vorlage der Sorte (eigene, sonst die Standardvorlage); `null`, wenn die Antwort keine brauchbare traegt. */
  label: VoucherLabelTemplate | null;
  order: number;
  active: boolean;
  /** Verkaufte Gutscheine dieser Sorte (nur zur Anzeige). */
  soldCount: number;
}

/**
 * Gutschein-Einstellungen der Kasse (Block `vouchers` aus `getKasseSettings`).
 *
 * Seit Gutscheine Stufe 4b verkauft eine Kasse ueber Sorten: Reiter und
 * Kacheln zeigt sie mit `typeSale` (und dem Recht `voucherSell`), je Sorte aus
 * `types` und die feste Kachel „Leistungsgutschein“ mit `serviceArticles`.
 * `sale`, `valueVoucherType` und `vatRateBp` gelten nur Kassen vor 1.15; der
 * Server schickt `sale` immer als `false`.
 *
 * Die vier neuen Felder sind optional, damit bestehende Literale von
 * Verbrauchern weiter uebersetzen; der Leser ([posVoucherSettingsFromWire])
 * setzt sie immer.
 */
export interface PosVoucherSettings {
  sale: boolean;
  valueVoucherType: 'multi_purpose' | 'single_purpose' | null;
  vatRateBp: number | null;
  /** Gutscheine verkaufen (Reiter „Gutscheine“): Schalter des Servers und mindestens eine Sorte oder ein Leistungsartikel. */
  typeSale?: boolean;
  /** Verkaufbare Sorten in Kachelfolge. */
  types?: PosVoucherType[];
  /** Es gibt aktive Artikel, die als Leistungsgutschein freigegeben sind (`PosArticle.serviceVoucher`). */
  serviceArticles?: boolean;
  /** Standardvorlage des Etiketts (Leistungsgutschein, Notausgang); `null` ohne brauchbare Vorlage. */
  labelDefault?: VoucherLabelTemplate | null;
}

/** Ohne Block `vouchers` (alter Server, Konto ohne Schalter): Verkaufen ist aus. */
export const VOUCHER_SETTINGS_DEFAULTS: Readonly<PosVoucherSettings> = Object.freeze({
  sale: false, valueVoucherType: null, vatRateBp: null,
  typeSale: false, types: Object.freeze([]) as unknown as PosVoucherType[], serviceArticles: false, labelDefault: null,
});

/**
 * Block `vouchers` einer Einstellungs-Antwort, geschlossen im Zweifel: ist
 * irgendein Feld unstimmig, gilt der ganze Block als nicht gelesen und
 * Verkaufen bleibt aus (kein Wurf, sonst ginge das Laden aller Einstellungen
 * verloren). Stimmig heisst: `sale` ein Wahrheitswert, die Art
 * `multi_purpose`/`single_purpose`/`null`, der Satz eine ganze Zahl >= 0 oder
 * `null`; Mehrzweck traegt keinen Satz, Einzweck braucht einen, und ein
 * eingeschalteter Verkauf braucht eine Art. Ein ausgeschalteter Verkauf darf
 * eine Art behalten. `typeSale` und `serviceArticles` sind Wahrheitswerte,
 * `types` eine Liste (fehlen sie, antwortet ein aelterer Server: aus, leer).
 *
 * Sorten (Gutscheine Stufe 4b) liest der Leser einzeln: eine unstimmige Sorte
 * faellt weg ([sorteVomDraht]), die anderen bleiben; ist danach weder eine
 * Sorte noch ein Leistungsartikel da, ist `typeSale` aus (kein leerer Reiter).
 * Eine unbrauchbare Etikett-Vorlage schliesst nichts: sie wird `null`, die
 * Kasse druckt dann ihren Standard (ein Verkauf scheitert nie an der Vorlage).
 * Das alte Feld `label` (Kassen vor 1.15, Ruling R3) liest das Paket nicht.
 */
export function posVoucherSettingsFromWire(block: unknown): PosVoucherSettings {
  const zu = (): PosVoucherSettings => ({ ...VOUCHER_SETTINGS_DEFAULTS, types: [] });
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return zu();
  const b = block as Record<string, unknown>;
  const sale = b['sale'];
  const art = b['valueVoucherType'] ?? null;
  const satz = b['vatRateBp'] ?? null;
  if (typeof sale !== 'boolean') return zu();
  if (art !== null && art !== 'multi_purpose' && art !== 'single_purpose') return zu();
  if (satz !== null && !(typeof satz === 'number' && Number.isInteger(satz) && satz >= 0)) return zu();
  if (sale && art === null) return zu();
  if (art === 'single_purpose' && satz === null) return zu();
  if (art === 'multi_purpose' && satz !== null) return zu();
  const sortenVerkauf = b['typeSale'] ?? false;
  const rohSorten = b['types'] ?? [];
  const leistung = b['serviceArticles'] ?? false;
  if (typeof sortenVerkauf !== 'boolean' || typeof leistung !== 'boolean' || !Array.isArray(rohSorten)) return zu();
  const types: PosVoucherType[] = [];
  const gesehen = new Set<string>();
  for (const roh of rohSorten) {
    const t = sorteVomDraht(roh);
    if (t === null || gesehen.has(t.id)) continue;
    gesehen.add(t.id);
    types.push(t);
  }
  return {
    sale, valueVoucherType: art, vatRateBp: satz,
    typeSale: sortenVerkauf && (types.length > 0 || leistung),
    types,
    serviceArticles: leistung,
    labelDefault: vorlageVomDraht(b['labelDefault']),
  };
}

/** Kennung wie am Server (gutschein-core.ID_MUSTER): reservierte `__…__` gibt es nie als Sorte. */
const SORTE_ID = /^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/;
/** Grenzen des Servers (gutschein-core.pruefeSorte): Fixbetrag 1,00 bis 10.000,00 €, Gueltigkeit 1 bis 30 Jahre. */
const MIN_FIX_CENTS = 100;
const MAX_BETRAG_CENTS = 1_000_000;
const MAX_JAHRE = 30;

const istObjekt = (w: unknown): w is Record<string, unknown> => w !== null && typeof w === 'object' && !Array.isArray(w);
const ganzeZahl = (w: unknown, min: number, max = Number.MAX_SAFE_INTEGER): w is number =>
  typeof w === 'number' && Number.isSafeInteger(w) && w >= min && w <= max;

/** Etikett-Vorlage als Kopie, wenn sie Groesse und Layout als Text traegt; sonst `null`. */
function vorlageVomDraht(w: unknown): VoucherLabelTemplate | null {
  if (!istObjekt(w) || typeof w['size'] !== 'string' || typeof w['layout'] !== 'string') return null;
  return JSON.parse(JSON.stringify(w)) as VoucherLabelTemplate;
}

/**
 * Eine Sorte aus `vouchers.types[]`, oder `null`, wenn sie nicht so ist, wie
 * der Server eine verkaufbare Sorte liefert (dann bietet die Kasse sie nicht
 * an): Kennung, Name, Art mit passendem Satz, Betrag, Gueltigkeit, Auszahlung
 * (`never` nur unbefristet) und aktiv. Fehlende Reihenfolge oder Verkaufszahl
 * gelten als 0; eine unbrauchbare Vorlage wird `null`.
 */
function sorteVomDraht(w: unknown): PosVoucherType | null {
  if (!istObjekt(w)) return null;
  const { id, name, kind, amount, validity, payout } = w;
  const satz = w['vatRateBp'] ?? null;
  const reihenfolge = w['order'] ?? 0;
  const verkauft = w['soldCount'] ?? 0;
  if (typeof id !== 'string' || !SORTE_ID.test(id)) return null;
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (kind !== 'multi_purpose' && kind !== 'single_purpose') return null;
  if (kind === 'single_purpose' ? !ganzeZahl(satz, 1) : satz !== null) return null;
  if (!istObjekt(amount) || !istObjekt(validity)) return null;
  let betrag: PosVoucherType['amount'];
  if (amount['mode'] === 'free') betrag = { mode: 'free' };
  else if (amount['mode'] === 'fixed' && ganzeZahl(amount['cents'], MIN_FIX_CENTS, MAX_BETRAG_CENTS)) betrag = { mode: 'fixed', cents: amount['cents'] };
  else return null;
  let gueltig: PosVoucherType['validity'];
  if (validity['pattern'] === 'unlimited') gueltig = { pattern: 'unlimited' };
  else if (validity['pattern'] === 'years' && ganzeZahl(validity['years'], 1, MAX_JAHRE)) gueltig = { pattern: 'years', years: validity['years'] };
  else return null;
  if (payout !== 'allowed' && payout !== 'never') return null;
  if (payout === 'never' && gueltig.pattern !== 'unlimited') return null;
  if (!ganzeZahl(reihenfolge, Number.MIN_SAFE_INTEGER) || !ganzeZahl(verkauft, 0)) return null;
  if (w['active'] !== true) return null;
  return {
    id, name, kind, vatRateBp: satz as number | null, amount: betrag, validity: gueltig, payout,
    label: vorlageVomDraht(w['label']), order: reihenfolge, active: true, soldCount: verkauft,
  };
}

type Roh = Record<string, unknown>;

function fehler(name: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, `Antwort: ${grund}`, 'response');
}

function objekt(name: string, pfad: string, w: unknown): Roh {
  if (w === null || typeof w !== 'object' || Array.isArray(w)) throw fehler(name, `${pfad} ist kein Objekt`);
  return w as Roh;
}

const fehlt = (w: unknown): boolean => w === undefined || w === null;

function ganzzahlWennDa(name: string, pfad: string, ziel: Roh, o: Roh, feld: string): void {
  const w = o[feld];
  if (fehlt(w)) return;
  if (typeof w !== 'number' || !Number.isSafeInteger(w)) throw fehler(name, `${pfad}.${feld} ist keine ganze Zahl`);
  ziel[feld] = w;
}

function textPflicht(name: string, pfad: string, o: Roh, feld: string): string {
  const w = o[feld];
  if (typeof w !== 'string' || w === '') throw fehler(name, `${pfad}.${feld} fehlt`);
  return w;
}

function wahl<T extends string>(name: string, pfad: string, o: Roh, feld: string, erlaubt: readonly T[]): T {
  const w = o[feld];
  if (typeof w !== 'string' || !(erlaubt as readonly string[]).includes(w)) throw fehler(name, `${pfad}.${feld} ist unbekannt`);
  return w as T;
}

function gueltigkeit(name: string, w: unknown): VoucherValidity {
  const o = objekt(name, 'validity', w);
  const raus: VoucherValidity = { pattern: wahl(name, 'validity', o, 'pattern', VOUCHER_VALIDITY_PATTERNS) };
  if (!fehlt(o.redeemableYears)) {
    const jahre = o.redeemableYears;
    if (typeof jahre !== 'number' || !Number.isSafeInteger(jahre) || jahre < 1) throw fehler(name, 'validity.redeemableYears ist keine Zahl von Jahren');
    raus.redeemableYears = jahre;
  }
  for (const feld of ['redeemableUntil', 'refundableUntil', 'validUntil'] as const) {
    const t = o[feld];
    if (fehlt(t)) continue;
    if (typeof t !== 'string' || t === '') throw fehler(name, `validity.${feld} ist kein Datum`);
    raus[feld] = t;
  }
  return raus;
}

function artikel(name: string, w: unknown): VoucherArticle {
  const o = objekt(name, 'article', w);
  const raus: Roh = { id: textPflicht(name, 'article', o, 'id'), name: textPflicht(name, 'article', o, 'name') };
  for (const feld of ['vatRateBp', 'priceCents']) {
    const z = o[feld];
    if (typeof z !== 'number' || !Number.isSafeInteger(z)) throw fehler(name, `article.${feld} ist keine ganze Zahl`);
    raus[feld] = z;
  }
  return raus as unknown as VoucherArticle;
}

function leseCheck(name: string, w: unknown): VoucherCheck {
  const o = objekt(name, 'data', w);
  const raus: Roh = {
    type: wahl(name, 'data', o, 'type', VOUCHER_KINDS),
    status: wahl(name, 'data', o, 'status', VOUCHER_STATUSES),
    codeSuffix: textPflicht(name, 'data', o, 'codeSuffix'),
  };
  for (const feld of ['balanceCents', 'faceValueCents', 'quantity', 'remainingQuantity', 'vatRateBp', 'discountCents', 'discountPercentBp']) {
    ganzzahlWennDa(name, 'data', raus, o, feld);
  }
  if (!fehlt(o.article)) raus.article = artikel(name, o.article);
  if (!fehlt(o.validity)) raus.validity = gueltigkeit(name, o.validity);
  if (!fehlt(o.exempt)) {
    if (typeof o.exempt !== 'boolean') throw fehler(name, 'data.exempt ist kein Wahrheitswert');
    raus.exempt = o.exempt;
  }
  if (!fehlt(o.typeName)) {
    if (typeof o.typeName !== 'string' || o.typeName === '') throw fehler(name, 'data.typeName ist kein Text');
    raus.typeName = o.typeName;
  }
  // Geschlossen im Zweifel, ohne Wurf: ein unbekannter Wert (neuerer Server)
  // gilt als `never`. Einloesen haengt nicht daran und darf nicht an einem
  // neuen Wert scheitern (die Lehre aus dem Gueltigkeitsmuster, Nachtrag E1).
  if (!fehlt(o.payout)) raus.payout = o.payout === 'allowed' ? 'allowed' : 'never';
  return raus as unknown as VoucherCheck;
}

/**
 * Gutschein am Code pruefen (Gutschein-Recht `voucherRedeem`). Der Code wird
 * tolerant eingelesen (Gross/klein, Bindestriche, `O`/`0`, `I`/`L`/`1`) und
 * vor dem Senden auf sein Pruefzeichen geprueft: ein Tippfehler geht nie ueber
 * das Netz, sondern endet mit `KasseneckValidationError`. Fachliche Fehler
 * kommen als `KasseneckApiError` mit dem Code des Servers
 * (`voucher_not_found`, `too_many_voucher_checks`, `not_permitted` …).
 */
export async function checkVoucher(transport: InternerTransport, code: string): Promise<VoucherCheck> {
  const name = 'checkVoucher';
  const geprueft = typeof code === 'string' ? VoucherCode.validate(code) : null;
  // Der Code steht bewusst nicht in der Meldung.
  if (!geprueft || !geprueft.ok) throw new KasseneckValidationError(name, 'code ist kein gueltiger Gutscheincode', 'request');
  // Der Code reist im Rumpf: als Geheimnis nennen, damit er in keinem Fehler (Servertext, Ursache) auftaucht.
  const geheim = [geprueft.normalized, VoucherCode.format(geprueft.normalized)];
  let antwort: unknown;
  try {
    antwort = await transport(name, { code: geprueft.normalized }, undefined, geheim);
  } catch (fehler) {
    // Der Transport siebt nur Ursachen; ein Servertext, der den Code wiederholt, wird hier geschwaerzt.
    if (fehler instanceof KasseneckApiError && geheim.some((g) => fehler.serverMessage.includes(g))) {
      const text = geheim.reduce((t, g) => t.split(g).join('****'), fehler.serverMessage);
      throw new KasseneckApiError(name, text, fehler.details, fehler.code);
    }
    throw fehler;
  }
  return leseCheck(name, antwort);
}

/**
 * Etikett eines Gutscheins noch einmal drucken (Gutschein-Recht
 * `voucherManage`). Antwort ist der Klartext-Code zum Drucken; er gehoert
 * nur in den Speicher bis zum Druck. Aufrufer duerfen ihn nicht protokollieren,
 * speichern oder in Meldungen nennen; Lesefehler dieser Antwort nennen ihn nie.
 */
export async function reprintVoucherLabel(transport: InternerTransport, id: string): Promise<{ code: string }> {
  const name = 'reprintVoucherLabel';
  if (typeof id !== 'string' || id.trim() === '') throw new KasseneckValidationError(name, 'id fehlt', 'request');
  const o = objekt(name, 'data', await transport(name, { id }));
  return { code: textPflicht(name, 'data', o, 'code') };
}
