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
const VOUCHER_VALIDITY_PATTERNS = ['unlimited', '1+3', 'custom'] as const;

/** Gueltigkeit eines Gutscheins; Daten als `YYYY-MM-DD` (Wiener Tag). Was der Server nicht nennt, fehlt. */
export interface VoucherValidity {
  pattern: 'unlimited' | '1+3' | 'custom';
  redeemableUntil?: string;
  refundableUntil?: string;
  validUntil?: string;
}

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
}

/** Gutschein-Einstellungen der Kasse (Block `vouchers` aus `getKasseSettings`). */
export interface PosVoucherSettings {
  sale: boolean;
  valueVoucherType: 'multi_purpose' | 'single_purpose' | null;
  vatRateBp: number | null;
}

/** Ohne Block `vouchers` (alter Server, Konto ohne Schalter): Verkaufen ist aus. */
export const VOUCHER_SETTINGS_DEFAULTS: Readonly<PosVoucherSettings> = Object.freeze({
  sale: false, valueVoucherType: null, vatRateBp: null,
});

/**
 * Block `vouchers` einer Einstellungs-Antwort, geschlossen im Zweifel: ist
 * irgendein Feld unstimmig, gilt der ganze Block als nicht gelesen und
 * Verkaufen bleibt aus (kein Wurf, sonst ginge das Laden aller Einstellungen
 * verloren). Stimmig heisst: `sale` ein Wahrheitswert, die Art
 * `multi_purpose`/`single_purpose`/`null`, der Satz eine ganze Zahl >= 0 oder
 * `null`; Mehrzweck traegt keinen Satz, Einzweck braucht einen, und ein
 * eingeschalteter Verkauf braucht eine Art. Ein ausgeschalteter Verkauf darf
 * eine Art behalten.
 */
export function posVoucherSettingsFromWire(block: unknown): PosVoucherSettings {
  const zu = (): PosVoucherSettings => ({ ...VOUCHER_SETTINGS_DEFAULTS });
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
  return { sale, valueVoucherType: art, vatRateBp: satz };
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
