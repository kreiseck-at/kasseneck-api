import { VoucherCode } from '@kreiseck/validator';
import type { Voucher } from '../models/voucher.js';
import { isNewFormVoucher, istWertVerkauf, voucherIsValid, voucherServerFields, wunschFormGueltig } from '../models/voucher.js';
import type { PosVoucherSettings, PosVoucherType, VoucherArticle, VoucherCheck } from '../pos/gutschein.js';

/**
 * Gutscheine der neuen Form im Zahlbetrag: Zwilling von
 * `gutschein-beleg.plane` im Backend, soweit er den Zahlbetrag bestimmt.
 *
 * Der Server macht aus den Wuenschen zusaetzliche Positionen (`kind`
 * `voucher` bzw. `voucher_float`, hinten an Ware und Trinkgeld angehaengt, in
 * der Reihenfolge der Wuensche) und Eintraege in Belegform; nur Eintraege der
 * Art Wert (`value`) und Rabatt (`promo`) gehen danach in die Toepfe und in
 * den Wertgutschein-Fluss (`gutschein-beleg.zahlbetrag`). Genau das steht
 * hier, mit derselben Euro-Arithmetik:
 *
 * - Mehrzweck einloesen: Eintrag `value`, mindert den Zahlbetrag als Fluss.
 * - Mehrzweck verkaufen: Eintrag `value` (+Fluss); ab dem Stichtag des
 *   0-%-Topfs stattdessen Position im 0-%-Satz ohne Fluss.
 * - Mehrzweck auszahlen: immer Position im 0-%-Satz (minus), kein Fluss;
 *   nie bei einem Gutschein mit Auszahlung `never`.
 * - Einzweck: Position im Satz (Verkauf aus der Sorte, Einloesung und
 *   Auszahlung aus der Pruefung des Gutscheins); als Kleinunternehmer
 *   eingeloest anteilig auf alle Saetze des Korbs.
 * - Wertgutschein verkaufen (Stufe 4b): nur ueber eine Sorte (`typeId`); Art
 *   und Satz kommen aus der Sorte, ein Fixbetrag muss stimmen. Ohne Sorte
 *   rechnet nur noch ein Aufrufer mit einer alten Gutschein-Einstellung mit
 *   Art (`voucherSettings.valueVoucherType`) wie bisher; sonst und beim
 *   Server immer `voucher_type_required`.
 * - Leistung verkaufen: Stueck mal Artikelpreis im Artikelsatz; einloesen: je
 *   Satz eine Minuszeile ueber die gewaehlten Positionen.
 * - Aktion: Rabatt wie `promo`, Betrag aus der Pruefung, hoechstens die Summe.
 *
 * Kein Fehler wird still geschluckt: was der Server mit einem Gutschein-Code
 * abwiese, liefert `fehler` mit genau diesem Code (`voucher_*`). Der
 * Klartext-Code steht nie in einem Text.
 */

/** Position in der inneren Form des Backends (`beleg-toepfe.interneForm`). */
export interface Innen {
  amount: number;
  priceOne: number;
  vat: number;
  tip: 'staff' | 'owner' | null;
  /** `kind` der Position (Trinkgeld, Rabatt, Gutscheinzeile); Ware hat keines. */
  kind?: string;
  articleId?: string;
}

/** Gutschein-Eintrag in Belegform, soweit Toepfe und Fluss ihn lesen. */
export interface Gutschein {
  action: string;
  type: string;
  value: number;
  /** Betrag steht schon als Position im 0-%-Topf: kein Fluss mehr. */
  imNullTopf?: boolean;
}

/** Je Einloesung bzw. Auszahlung die gepruefte Sicht des Gutscheins (aus `checkVoucher`), zugeordnet ueber den Code. */
export interface VoucherDueInfo {
  /** Der Code, wie er gesendet wird (tolerant: Gross/klein, Bindestriche, `O`/`0`, `I`/`L`/`1`). */
  code: string;
  check: VoucherCheck;
}

/**
 * Artikel fuer den Verkauf eines Dienstleistungsgutscheins: Preis und Satz wie
 * im Artikelstamm. `serviceVoucher` (`PosArticle.serviceVoucher`): bei `false`
 * verkauft der Server ihn nicht (`voucher_service_not_allowed`); ohne Angabe
 * rechnet der Zahlbetrag wie bisher.
 */
export type VoucherDueArticle = Pick<VoucherArticle, 'id' | 'priceCents' | 'vatRateBp'> & { serviceVoucher?: boolean };

/** Gutschein-Sorte fuer den Verkauf: Kennung, Art, Satz und Betrag wie in `getKasseSettings` (`vouchers.types[]`). */
export type VoucherDueType = Pick<PosVoucherType, 'id' | 'kind' | 'vatRateBp' | 'amount'>;

/**
 * Stichtag des 0-%-Topfs fuer Mehrzweck-Verkaeufe (Backend
 * `gutschein-core.NULLTOPF_AB`). Solange er in der Zukunft liegt, zaehlt ein
 * Mehrzweck-Verkauf als Fluss; ab dem Tag als Position im 0-%-Satz. Der
 * Zahlbetrag bleibt gleich, Toepfe und Fluss verschieben sich.
 */
export const VOUCHER_ZERO_RATE_BUCKET_FROM = '2099-12-31';

export interface PlanOptionen {
  voucherInfo?: readonly VoucherDueInfo[];
  voucherSettings?: PosVoucherSettings;
  voucherTypes?: readonly VoucherDueType[];
  voucherArticles?: readonly VoucherDueArticle[];
  smallBusiness?: boolean;
  zeroRateBucketFrom?: string;
  /** Wiener Tag `YYYY-MM-DD`; der Aufrufer setzt den heutigen, wenn er fehlt. */
  today: string;
}

export interface Plan {
  /** Positionen, die der Server hinten anhaengt. */
  zusatz: Innen[];
  /** Eintraege, die Toepfe und Fluss lesen (`gutschein-beleg.zahlbetrag`). */
  gutscheine: Gutschein[];
  /** Summe der Auszahlungen in Cent. */
  auszahlungCents: number;
  /** Mindestens ein Wunsch der neuen Form: der Server rechnet mit `plane`. */
  mitPlan: boolean;
  /** Summe der Einloese-Minuszeilen je Topf (Deckung, Vorbelegung). */
  minusJeTopf: Map<string, number>;
}

export interface PlanFehler {
  fehler: string;
  text: string;
}

const KINDS = ['voucher', 'voucher_float'];
const ARTEN = ['multi_purpose', 'single_purpose', 'service', 'promotion'];

type TopfName = 'amountRateStandard' | 'amountRateReduced1' | 'amountRateReduced2' | 'amountRateZero' | 'amountRateSpecial' | 'amountRatOthers';

/** `vat-buckets.bucketFuerSatz`. */
export function topfFuerSatz(vat: number): TopfName {
  switch (vat) {
    case 20: return 'amountRateStandard';
    case 10: return 'amountRateReduced1';
    case 13: return 'amountRateReduced2';
    case 0: return 'amountRateZero';
    case 19: return 'amountRateSpecial';
    case 4.9: return 'amountRateSpecial';
    default: return 'amountRatOthers';
  }
}

const TOPF_REIHENFOLGE: readonly TopfName[] = ['amountRateStandard', 'amountRateReduced1', 'amountRateReduced2', 'amountRateZero', 'amountRateSpecial', 'amountRatOthers'];

function istGutscheinZeile(p: { kind?: string }): boolean {
  return p.kind !== undefined && KINDS.includes(p.kind);
}
/** Position, die ein Gutschein decken darf: weder Trinkgeld noch Gutscheinzeile. */
export function istDeckbar(p: Innen): boolean {
  return p.tip == null && p.kind !== 'tip' && !istGutscheinZeile(p);
}
/** Summe der Trinkgeldzeilen (Personal und Inhaber) in Cent, wie `centSumme(kunde.filter(istTip))` im Backend. */
export function trinkgeldCents(kunde: readonly Innen[]): number {
  return centSumme(kunde.filter((p) => p.tip != null || p.kind === 'tip'));
}
/** Wie beleg-toepfe: Euro in Positionsreihenfolge aufsummieren, erst die Summe auf Cent runden. */
export function centSumme(liste: readonly Innen[]): number {
  return Math.round(liste.reduce((s, it) => s + it.priceOne * it.amount, 0) * 100);
}
/** `gutschein-core.satzBpAusVat`. */
function satzBp(vat: number): number {
  return Math.round(Number(vat) * 100);
}
function position(satzBpWert: number, cents: number, kind: 'voucher' | 'voucher_float'): Innen {
  return { amount: 1, priceOne: cents / 100, vat: satzBpWert / 100, tip: null, kind };
}

/** Reservierte Kennung (`__…__`): gibt es am Server nie als Sorte (gutschein-core.RESERVIERTE_ID). */
const RESERVIERTE_ID = /^__.*__$/;

/**
 * Die Sorte zum Wunsch, wie der Server sie verkaufen wuerde, oder null
 * (unbekannt): Mehrzweck ohne Satz, Einzweck mit Satz > 0, Betrag frei oder
 * fest von 1,00 bis 10.000,00 €. Eine unstimmige Sorte verkauft der Server
 * nicht (`gutschein-beleg.sorteFuerVerkauf` ueber `gutschein-core.pruefeSorte`).
 */
function sorteZumWunsch(typen: readonly VoucherDueType[] | undefined, typeId: string): VoucherDueType | null {
  const t = (typen ?? []).find((x) => x.id === typeId);
  if (t == null) return null;
  const satzOk = t.kind === 'multi_purpose' ? t.vatRateBp == null : t.kind === 'single_purpose' && Number.isInteger(t.vatRateBp) && (t.vatRateBp as number) > 0;
  const betragOk = t.amount?.mode === 'free'
    || (t.amount?.mode === 'fixed' && Number.isInteger(t.amount.cents) && t.amount.cents >= 100 && t.amount.cents <= 1_000_000);
  return satzOk && betragOk ? t : null;
}

/** Code in Normalform (tolerant eingelesen, Pruefzeichen stimmt) oder null. */
function normalerCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const v = VoucherCode.validate(code);
  return v.ok ? v.normalized : null;
}

/** Ist der Eintrag ein Wunsch der neuen Form (nicht vom Server gelesen)? */
function istWunsch(v: Voucher): boolean {
  return isNewFormVoucher(v) && voucherServerFields(v).length === 0;
}

/** Ein gelesener Eintrag (Serverfelder gesetzt): nur Wert und Rabatt tragen Geld ausserhalb der Positionen. */
function istGelesen(v: Voucher): boolean {
  return voucherServerFields(v).length > 0;
}

const STATUS_FEHLER: Record<string, string> = {
  used_up: 'voucher_used_up', paid_out: 'voucher_used_up', cancelled: 'voucher_cancelled', blocked: 'voucher_blocked', expired: 'voucher_expired',
};

/** Die Saetze, auf die `kuTeile` verteilt: je Satz `centSumme` der deckbaren Positionen, nur positive. */
export function kuSaetze(kunde: readonly Innen[]): Array<{ satzBp: number; basis: number }> {
  const jeSatz = new Map<number, Innen[]>();
  for (const it of kunde) {
    if (!istDeckbar(it)) continue;
    const s = satzBp(it.vat);
    if (!jeSatz.has(s)) jeSatz.set(s, []);
    jeSatz.get(s)!.push(it);
  }
  return [...jeSatz].map(([s, liste]) => ({ satzBp: s, basis: centSumme(liste) })).filter((x) => x.basis > 0);
}

/** `gutschein-core.kuTeile`: anteilig zur Positionssumme je Satz, groesster Rest, Topf-Reihenfolge bei Gleichstand. */
function kuTeile(kunde: readonly Innen[], betragCents: number): Array<{ satzBp: number; cents: number }> | null {
  const jeSatz = new Map<number, Innen[]>();
  for (const it of kunde) {
    if (!istDeckbar(it)) continue;
    const s = satzBp(it.vat);
    if (!jeSatz.has(s)) jeSatz.set(s, []);
    jeSatz.get(s)!.push(it);
  }
  const rang = (s: number) => TOPF_REIHENFOLGE.indexOf(topfFuerSatz(s / 100));
  const saetze = [...jeSatz]
    .map(([s, liste]) => ({ satzBp: s, basis: centSumme(liste), cents: 0, rest: 0 }))
    .filter((s) => s.basis > 0)
    .sort((a, b) => (rang(a.satzBp) - rang(b.satzBp)) || (b.satzBp - a.satzBp));
  const summe = saetze.reduce((s, x) => s + x.basis, 0);
  if (summe <= 0 || betragCents > summe) return null;
  for (const s of saetze) {
    s.cents = Math.floor((betragCents * s.basis) / summe);
    s.rest = (betragCents * s.basis) % summe;
  }
  let offen = betragCents - saetze.reduce((s, x) => s + x.cents, 0);
  const nachRest = saetze.map((s, i) => ({ s, i })).sort((a, b) => (b.s.rest - a.s.rest) || (a.i - b.i));
  for (let k = 0; offen > 0; k++, offen--) nachRest[k]!.s.cents += 1;
  return saetze.filter((s) => s.cents > 0).map((s) => ({ satzBp: s.satzBp, cents: s.cents }));
}

/**
 * Wuensche und gelesene Eintraege in Positionen und Belegeintraege, wie
 * `plane` sie baut. `kunde` sind Ware und Trinkgeld in innerer Form.
 */
export function planeGutscheine(kunde: readonly Innen[], vouchers: readonly Voucher[], art: string, o: PlanOptionen): Plan | PlanFehler {
  const nein = (fehler: string, text: string): PlanFehler => ({ fehler, text });
  const storno = art === 'cancellation';
  const wuensche = vouchers.filter(istWunsch);
  const zusatz: Innen[] = [];
  const gutscheine: Gutschein[] = [];

  // Wert und Rabatt der Altform bzw. gelesener Belege: Euro aus ganzen Cent.
  const altEintrag = (v: Voucher, i: number): Gutschein | PlanFehler => {
    if (!Number.isSafeInteger(v.valueCents)) return nein('voucher_invalid', `Gutschein ${i + 1} hat keinen ganzen Cent-Wert.`);
    return { action: String(v.action), type: String(v.type), value: Math.round(v.valueCents as number) / 100, ...(v.zeroRateBucket === true ? { imNullTopf: true } : {}) };
  };

  if (wuensche.length === 0) {
    const nulltopf = !storno && o.today >= (o.zeroRateBucketFrom ?? VOUCHER_ZERO_RATE_BUCKET_FROM);
    // `gutschein-transaktion.brauchtPlan`: ab dem Stichtag laeuft plane auch fuer einen Altform-Verkauf.
    const mitPlan = nulltopf && vouchers.some((v) => !istGelesen(v) && v.action === 'sell' && v.type === 'value');
    if (mitPlan && kunde.some(istGutscheinZeile)) return nein('voucher_invalid', 'Gutschein-Positionen setzt nur der Server.');
    for (const [i, v] of vouchers.entries()) {
      // Gelesene Eintraege der neuen Form ohne Wert/Rabatt: ihr Geld steht in den Positionen.
      if (istGelesen(v) && v.type !== 'value' && v.type !== 'promo') continue;
      const g = altEintrag(v, i);
      if ('fehler' in g) return g;
      // Altform-Verkauf ab dem Stichtag: Betrag in den 0-%-Topf.
      if (nulltopf && !istGelesen(v) && g.action === 'sell' && g.type === 'value') {
        zusatz.push(position(0, Math.round(v.valueCents as number), 'voucher_float'));
        g.imNullTopf = true;
      }
      gutscheine.push(g);
    }
    return { zusatz, gutscheine, auszahlungCents: 0, mitPlan, minusJeTopf: new Map() };
  }

  // Ab hier: mindestens ein Wunsch der neuen Form (createReceipt fuehrt `plane` aus).
  if (storno) return nein('voucher_invalid', 'Gutscheine der neuen Form gibt es am Storno nur gespiegelt vom Server.');
  if (art === 'training') return nein('voucher_invalid', 'Gutscheine der neuen Form gibt es nicht auf Schulungsbelegen.');
  if (kunde.some(istGutscheinZeile)) return nein('voucher_invalid', 'Gutschein-Positionen setzt nur der Server.');
  for (const [i, v] of vouchers.entries()) {
    if (istGelesen(v)) return nein('voucher_invalid', `Gutschein ${i + 1}: Serverfelder an einem Wunsch.`);
    if (!isNewFormVoucher(v)) continue;
    if (istWertVerkauf(v) && v.typeId == null) {
      // Wie gutschein-beleg.pruefeWuensche: ein Wert-Verkauf ohne Sorte ist voucher_type_required.
      // Nur eine alte Gutschein-Einstellung MIT Art (Aufrufer von 1.14) rechnet wie bisher; ein Server ab
      // Stufe 4b schickt `valueVoucherType` immer null, dort hilft kein Neuladen – die Sorte fehlt.
      if (o.voucherSettings?.valueVoucherType == null) return nein('voucher_type_required', `Gutschein ${i + 1}: die Gutschein-Sorte fehlt (typeId).`);
      if (!wunschFormGueltig(v, false)) return nein('voucher_invalid', `Gutschein ${i + 1} ist unvollstaendig.`);
      continue;
    }
    // Eine reservierte Kennung weist der Server vor jeder anderen Pruefung als unbekannt ab.
    if (istWertVerkauf(v) && typeof v.typeId === 'string' && RESERVIERTE_ID.test(v.typeId)) {
      return nein('voucher_type_not_found', `Gutschein ${i + 1}: diese Gutschein-Sorte gibt es nicht.`);
    }
    if (!voucherIsValid(v)) return nein('voucher_invalid', `Gutschein ${i + 1} ist unvollstaendig.`);
  }
  // Kein Gutschein mit Gutschein bezahlen, sobald einer der beiden die neue Form hat.
  const handel = vouchers.filter((v) => v.action === 'sell' || v.action === 'redeem');
  if (handel.some((v) => v.action === 'sell') && handel.some((v) => v.action === 'redeem') && handel.some(isNewFormVoucher)) return nein('voucher_invalid', 'Gutscheine verkaufen und einloesen gehen nicht am selben Beleg.');
  if (wuensche.some((v) => v.type === 'promotion') && vouchers.length > 1) return nein('voucher_invalid', 'Ein Aktionsgutschein steht allein am Beleg.');
  if (wuensche.some((v) => v.action === 'payout') && vouchers.some((v) => !isNewFormVoucher(v) && v.type === 'promo')) {
    return nein('voucher_invalid', 'Rabatt und Auszahlung gehen nicht am selben Beleg.');
  }
  const codes = wuensche.filter((v) => v.action !== 'sell').map((v) => normalerCode(v.code));
  if (codes.some((c) => c == null)) return nein('voucher_invalid', 'Ein Gutscheincode ist ungueltig.');
  if (new Set(codes).size !== codes.length) return nein('voucher_invalid', 'Derselbe Gutschein steht zweimal am Beleg.');

  const ku = o.smallBusiness === true;
  const nulltopf = o.today >= (o.zeroRateBucketFrom ?? VOUCHER_ZERO_RATE_BUCKET_FROM);
  const minusJeTopf = new Map<TopfName, number>();
  const minus = (s: number, c: number) => {
    const topf = topfFuerSatz(s / 100);
    minusJeTopf.set(topf, (minusJeTopf.get(topf) ?? 0) + c);
  };
  const belegt = new Set<number>();
  let auszahlungCents = 0;
  const einstellung = (gewollt: 'multi_purpose' | 'single_purpose'): PlanFehler | null => {
    const e = o.voucherSettings;
    // Der Server verkauft nur mit bestaetigter Einstellung (`voucher_settings_missing`), auch Mehrzweck.
    if (e == null || e.valueVoucherType == null) {
      return nein('voucher_settings_missing', 'Die Gutschein-Einstellung der Kasse fehlt (voucherSettings).');
    }
    return e.valueVoucherType === gewollt ? null : nein('voucher_invalid', 'Die Gutschein-Einstellung der Kasse verkauft eine andere Art.');
  };
  const pruefung = (v: Voucher, i: number): VoucherCheck | PlanFehler => {
    const code = normalerCode(v.code);
    const info = (o.voucherInfo ?? []).find((x) => normalerCode(x.code) === code);
    if (info == null) return nein('voucher_not_found', `Gutschein ${i + 1}: keine Pruefung zum Code (checkVoucher).`);
    if (info.check.type !== v.type) return nein('voucher_invalid', `Gutschein ${i + 1}: die Art passt nicht zur Pruefung.`);
    return info.check;
  };
  const saldo = (check: VoucherCheck, c: number, i: number): PlanFehler | null =>
    Number.isInteger(check.balanceCents) && c <= (check.balanceCents as number)
      ? null
      : nein('voucher_insufficient_balance', `Gutschein ${i + 1}: der Betrag uebersteigt den Saldo.`);

  for (const [i, v] of vouchers.entries()) {
    if (!isNewFormVoucher(v)) {
      const g = altEintrag(v, i);
      if ('fehler' in g) return g;
      if (nulltopf && g.action === 'sell' && g.type === 'value') {
        zusatz.push(position(0, Math.round(v.valueCents as number), 'voucher_float'));
        g.imNullTopf = true;
      }
      gutscheine.push(g);
      continue;
    }
    if (istWertVerkauf(v) && v.typeId != null) {
      // Verkauf ueber eine Sorte (gutschein-beleg.plane): unbekannt, andere Art, falscher Fixbetrag.
      const sorte = sorteZumWunsch(o.voucherTypes, v.typeId);
      if (sorte == null) return nein('voucher_type_not_found', `Gutschein ${i + 1}: die Gutschein-Sorte fehlt (voucherTypes).`);
      if (v.type != null && v.type !== sorte.kind) return nein('voucher_invalid', `Gutschein ${i + 1}: die Art passt nicht zur Gutschein-Sorte.`);
      if (sorte.amount.mode === 'fixed' && v.amountCents !== sorte.amount.cents) {
        return nein('voucher_amount_mismatch', `Gutschein ${i + 1}: der Betrag passt nicht zum Fixbetrag der Gutschein-Sorte.`);
      }
      const c = v.amountCents as number;
      if (sorte.kind === 'multi_purpose') {
        if (nulltopf) {
          zusatz.push(position(0, c, 'voucher_float'));
          gutscheine.push({ action: 'sell', type: 'value', value: c / 100, imNullTopf: true });
        } else {
          gutscheine.push({ action: 'sell', type: 'value', value: c / 100 });
        }
      } else {
        // Kleinunternehmer: befreit verkauft, der Satz der Sorte legt nur fest, wofuer der Gutschein gilt.
        zusatz.push(position(ku ? 0 : (sorte.vatRateBp as number), c, 'voucher'));
      }
      continue;
    }
    if (!ARTEN.includes(String(v.type))) return nein('voucher_invalid', `Gutschein ${i + 1}: unbekannte Art.`);

    if (v.action === 'sell') {
      if (v.type === 'multi_purpose') {
        const f = einstellung('multi_purpose');
        if (f) return f;
        const c = v.amountCents as number;
        if (nulltopf) {
          zusatz.push(position(0, c, 'voucher_float'));
          gutscheine.push({ action: 'sell', type: 'value', value: c / 100, imNullTopf: true });
        } else {
          gutscheine.push({ action: 'sell', type: 'value', value: c / 100 });
        }
      } else if (v.type === 'single_purpose') {
        const f = einstellung('single_purpose');
        if (f) return f;
        const satz = ku ? 0 : o.voucherSettings!.vatRateBp;
        if (!Number.isInteger(satz) || (satz as number) < 0) return nein('voucher_settings_missing', 'Der Satz des Einzweckgutscheins fehlt (Gutschein-Einstellung der Kasse).');
        zusatz.push(position(satz as number, v.amountCents as number, 'voucher'));
      } else {
        const a = (o.voucherArticles ?? []).find((x) => x.id === v.articleId);
        if (a == null) return nein('voucher_item_mismatch', `Gutschein ${i + 1}: der Artikel fehlt (voucherArticles).`);
        if (a.serviceVoucher === false) return nein('voucher_service_not_allowed', `Gutschein ${i + 1}: der Artikel ist nicht als Leistungsgutschein freigegeben.`);
        if (!Number.isInteger(a.priceCents) || a.priceCents <= 0 || !Number.isInteger(a.vatRateBp) || a.vatRateBp < 0) {
          return nein('voucher_invalid', `Gutschein ${i + 1}: Artikel ohne Preis oder Satz.`);
        }
        const c = (v.quantity as number) * a.priceCents;
        if (c > 1_000_000) return nein('voucher_invalid', `Gutschein ${i + 1}: Betrag zu hoch.`);
        zusatz.push(position(ku ? 0 : a.vatRateBp, c, 'voucher'));
      }
      continue;
    }

    const check = pruefung(v, i);
    if ('fehler' in check) return check;

    if (v.action === 'payout') {
      // `gutschein-core.darfAuszahlen`: Auszahlung nicht gesperrt, aktiv oder abgelaufen bis zum Ende der Rueckzahlbarkeit.
      if (check.payout === 'never') return nein('voucher_payout_not_allowed', `Gutschein ${i + 1}: dieser Gutschein wird nie ausgezahlt.`);
      if (!((check.balanceCents ?? 0) > 0)) return nein('voucher_used_up', `Gutschein ${i + 1}: kein Saldo.`);
      if (check.status === 'expired') {
        const bis = check.validity?.refundableUntil;
        if (bis && o.today > bis) return nein('voucher_expired', `Gutschein ${i + 1}: nicht mehr rueckzahlbar.`);
      } else if (check.status !== 'active') {
        return nein(STATUS_FEHLER[check.status] ?? 'voucher_invalid', `Gutschein ${i + 1}: Status ${check.status}.`);
      }
      const c = v.amountCents as number;
      const f = saldo(check, c, i);
      if (f) return f;
      if (v.type === 'multi_purpose') {
        zusatz.push(position(0, -c, 'voucher_float'));
        gutscheine.push({ action: 'payout', type: 'value', value: c / 100, imNullTopf: true });
      } else {
        if (!Number.isInteger(check.vatRateBp)) return nein('voucher_invalid', `Gutschein ${i + 1}: Satz fehlt in der Pruefung.`);
        zusatz.push(position(check.vatRateBp as number, -c, 'voucher'));
      }
      auszahlungCents += c;
      continue;
    }

    if (check.status !== 'active') return nein(STATUS_FEHLER[check.status] ?? 'voucher_invalid', `Gutschein ${i + 1}: Status ${check.status}.`);

    if (v.type === 'multi_purpose' || v.type === 'single_purpose') {
      const c = v.amountCents as number;
      const f = saldo(check, c, i);
      if (f) return f;
      if (v.type === 'multi_purpose') {
        gutscheine.push({ action: 'redeem', type: 'value', value: c / 100 });
      } else if (check.exempt === true || ku) {
        // Befreit verkauft (`kuEingefroren`) oder Kleinunternehmer-Konto: der gedeckte Teil
        // verlaesst anteilig alle Toepfe des Korbs.
        const teile = kuTeile(kunde, c);
        if (!teile) return nein('voucher_rate_mismatch', `Gutschein ${i + 1}: der Korb deckt den Betrag nicht.`);
        for (const t of teile) {
          zusatz.push(position(t.satzBp, -t.cents, 'voucher'));
          minus(t.satzBp, t.cents);
        }
      } else {
        if (!Number.isInteger(check.vatRateBp)) return nein('voucher_invalid', `Gutschein ${i + 1}: Satz fehlt in der Pruefung.`);
        zusatz.push(position(check.vatRateBp as number, -c, 'voucher'));
        minus(check.vatRateBp as number, c);
      }
    } else if (v.type === 'service') {
      const artikelId = check.article?.id;
      let stueck = 0;
      const jeSatz = new Map<number, Innen[]>();
      for (const k of v.positions ?? []) {
        const it = kunde[k];
        if (it == null || it.kind !== undefined || it.tip != null || !artikelId || it.articleId !== artikelId
          || !Number.isInteger(it.amount) || it.amount < 1 || belegt.has(k)) {
          return nein('voucher_item_mismatch', `Gutschein ${i + 1}: Position ${k + 1} passt nicht zum Leistungsgutschein.`);
        }
        belegt.add(k);
        stueck += it.amount;
        const s = satzBp(it.vat);
        if (!jeSatz.has(s)) jeSatz.set(s, []);
        jeSatz.get(s)!.push(it);
      }
      if (!Number.isInteger(check.remainingQuantity) || stueck > (check.remainingQuantity as number)) {
        return nein('voucher_insufficient_balance', `Gutschein ${i + 1}: nicht genug offene Stueck.`);
      }
      for (const [s, liste] of jeSatz) {
        const c = centSumme(liste);
        zusatz.push(position(s, -c, 'voucher'));
        minus(s, c);
      }
    } else {
      // Aktion: Rabatt ueber die Altmechanik promo.
      const basis = centSumme(kunde.filter(istDeckbar));
      const roh = Number.isInteger(check.discountCents) && (check.discountCents as number) > 0
        ? (check.discountCents as number)
        : Math.floor((basis * (Number(check.discountPercentBp) || 0)) / 10000);
      const rabatt = Math.min(roh, basis);
      if (!(rabatt > 0)) return nein('voucher_invalid', `Gutschein ${i + 1}: kein Rabatt auf diesen Korb.`);
      gutscheine.push({ action: 'redeem', type: 'promo', value: rabatt / 100 });
    }
  }

  // Einloese-Minuszeilen eines Topfs uebersteigen nie die deckbaren Positionen dieses Topfs.
  for (const [topf, c] of minusJeTopf) {
    const basis = centSumme(kunde.filter((it) => istDeckbar(it) && topfFuerSatz(it.vat) === topf));
    if (c > basis) return nein('voucher_rate_mismatch', 'Ein Gutschein deckt mehr als die Positionen seines Steuersatzes.');
  }
  return { zusatz, gutscheine, auszahlungCents, mitPlan: true, minusJeTopf };
}
