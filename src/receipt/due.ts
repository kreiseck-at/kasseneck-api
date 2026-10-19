import { ReceiptType, type ReceiptTypeKey, KeckPaymentMethod, VoucherAction, VoucherType } from '../enums/index.js';
import type { ReceiptItem } from '../models/receipt-item.js';
import type { Voucher } from '../models/voucher.js';
import type { PosVoucherSettings, VoucherCheck } from '../pos/gutschein.js';
import { toViennaWallClock } from '../vienna-time.js';
import {
  centSumme,
  istDeckbar,
  planeGutscheine,
  topfFuerSatz,
  type Gutschein,
  type Innen,
  type VoucherDueArticle,
  type VoucherDueInfo,
} from './gutschein-plan.js';

export { VOUCHER_ZERO_RATE_BUCKET_FROM, type VoucherDueArticle, type VoucherDueInfo } from './gutschein-plan.js';

/**
 * Zahlbetrag eines Belegs in ganzen Cent: Zwilling von `createReceipt` im
 * Backend (Nachtrag §8), also `beleg-toepfe.belegToepfe(...).zaehlerDeltaCents`
 * plus `zahlungen-core.wertgutscheinFlussCents`, mit den Trinkgeld-Positionen,
 * die `tip-core.buildTipItems` aus `tip` bzw. aus `payments[].tipCents` baut.
 *
 * `createReceipt` hat keinen Probelauf. Unter `/v3` ist `payments[]` Pflicht,
 * und die Summe der Zahlungen muss genau diesen Betrag treffen; wer die
 * Zahlungen baut (Kartenterminal, Rueckgeld), rechnet ihn hier vorher aus.
 * Trifft die Summe nicht, antwortet der Server mit `payments_sum_mismatch` und
 * `expectedCents`, ohne eine Belegnummer zu verbrauchen; das Paket wiederholt
 * nie selbst.
 *
 * **Bewusst dieselbe Rechnung wie der Server, nicht die exakte.** Das Backend
 * rechnet die RKSV-Toepfe in Euro-Gleitkomma (Einzelpreis `Math.round(cents)/100`,
 * je Topf `priceOne * amount` in Positionsreihenfolge, Trinkgeld-Positionen
 * hinten angehaengt, gerundet mit `Math.round(euro * 100)`, Rabatt-Deckel in
 * Euro). Diese Reihenfolge ist signiert und aendert sich nicht; ein exakter
 * Zwilling wiche bei Bruchmengen auf halbem Cent ab (0,5 x 29 ct: Server 14,
 * exakt 15). Darum steht hier dieselbe Arithmetik, Schritt fuer Schritt.
 * Eingaben und Ergebnis sind ganze Cent; die Gleitkommazahlen leben nur
 * innerhalb dieser Rechnung. Geprueft gegen die 20 Vertragsfaelle aus
 * `fixtures/v3/zahlbetrag-faelle.json` und gegen mehr als 1000 mit dem echten
 * Backend-Code erzeugte Faelle (`fixtures/receipt-due-generated.json`).
 *
 * **Trinkgeld-Empfaenger:** Ohne `recipients` bucht der Server das Trinkgeld
 * auf den angemeldeten Kassen-Benutzer, und dessen Inhaber-Kennzeichen
 * entscheidet: Inhaber-Trinkgeld ist Umsatz (anteilig auf die Saetze der Ware,
 * mitrabattiert), Personal-Trinkgeld ein durchlaufender Posten (nie
 * rabattiert). Das weiss nur die Kasse; darum ist `tipRecipient` Pflicht,
 * sobald Trinkgeld ohne `recipients` vorkommt. Ohne angemeldeten Benutzer
 * (Geraete-Schluessel) gilt `'staff'`.
 *
 * **Gutscheine der neuen Form** (Mehrzweck, Einzweck, Leistung, Aktion,
 * Auszahlung): der Server macht daraus Positionen und Eintraege
 * (`gutschein-beleg.plane`, Zwilling in `gutschein-plan.ts`). Was er dafuer
 * aus seinen Daten liest, gibt die Kasse mit: je Einloesung/Auszahlung die
 * Pruefung aus `checkVoucher` (`voucherInfo`, ueber den Code zugeordnet), fuer
 * einen Einzweck-Verkauf die Gutschein-Einstellung der Kasse
 * (`voucherSettings`, Satz), fuer einen Leistungsgutschein-Verkauf den Artikel
 * (`voucherArticles`, Preis und Satz) und `smallBusiness` fuer ein
 * Kleinunternehmer-Konto. Was fehlt oder was der Server abwiese, wirft
 * `invalid_voucher` mit dem erwarteten Server-Code in `voucherErrorCode`.
 * Ein Beleg nur aus Auszahlungen hat einen negativen Zahlbetrag (genau eine
 * Barzahlung ueber diesen Betrag).
 *
 * **Nicht rechenbar:** jede unbrauchbare Eingabe wirft [ReceiptDueError]
 * (`code: 'receipt_due_unavailable'`, `reason` im Einzelnen), nie still eine
 * falsche Zahl. Dann ist nichts gesendet.
 */

/** Wer das Trinkgeld ohne `recipients` bekommt (Kennzeichen des angemeldeten Kassen-Benutzers). */
export type ReceiptDueTipRecipient = 'owner' | 'staff';

/** Trinkgeld wie `tip` an `sellReceipt`: Betrag, optional mit Empfaengern samt Inhaber-Kennzeichen. */
export type ReceiptDueTip = number | { cents: number; recipients?: ReadonlyArray<{ cents: number; owner: boolean }> };

export interface ReceiptDueOptions {
  /** Trinkgeld als Parameter `tip`; nie zugleich mit `payments[].tipCents` (`tip_conflict`). */
  tip?: ReceiptDueTip;
  /**
   * Die Zahlungen, soweit sie Trinkgeld tragen (`tipCents`). Der Server bucht
   * je Zahlart genau so, als waere `tip: { cents: Summe, paymentMethod }`
   * geschickt worden. Andere Felder zaehlen hier nicht.
   */
  payments?: ReadonlyArray<{ method: KeckPaymentMethod | string; tipCents?: number }>;
  /** Pflicht, sobald Trinkgeld ohne `recipients` vorkommt (siehe Modulkommentar). */
  tipRecipient?: ReceiptDueTipRecipient;
  /** Je Einloesung bzw. Auszahlung der neuen Form die Pruefung aus `checkVoucher`, ueber den Code zugeordnet. */
  voucherInfo?: readonly VoucherDueInfo[];
  /**
   * Gutschein-Einstellung der Kasse (`getKasseSettings`, Block `vouchers`):
   * Pflicht fuer den Verkauf eines Einzweckgutscheins (sein Satz). Ist sie
   * gesetzt, muss die verkaufte Art zu ihr passen.
   */
  voucherSettings?: PosVoucherSettings;
  /** Artikel fuer den Verkauf von Dienstleistungsgutscheinen (Preis und Satz, wie im Artikelstamm). */
  voucherArticles?: readonly VoucherDueArticle[];
  /**
   * Das Konto ist Kleinunternehmer (Konto-Fakten): Einzweck/Leistung werden zu
   * 0 % verkauft, eine Einzweck-Einloesung verteilt sich anteilig auf alle
   * Saetze des Korbs. Ein befreit verkaufter Gutschein, den ein inzwischen
   * steuerpflichtiges Konto einloest, ist in der Pruefung nicht erkennbar; er
   * rechnet hier im Satz 0 (Zahlbetrag gleich, Toepfe anders verteilt).
   */
  smallBusiness?: boolean;
  /**
   * Stichtag des 0-%-Topfs fuer Mehrzweck-Verkaeufe (`YYYY-MM-DD`). Vorgabe
   * [VOUCHER_ZERO_RATE_BUCKET_FROM], wie im Backend. Nur angeben, wenn der
   * Server ihn nachweislich anders fuehrt (Test-Umgebung).
   */
  zeroRateBucketFrom?: string;
  /** Wiener Tag des Belegs (`YYYY-MM-DD`); Vorgabe: heute in Wien. */
  today?: string;
}

/** Die sechs RKSV-Toepfe in Cent, Namen wie am Beleg des Backends. */
export interface ReceiptDueBuckets {
  amountRateStandard: number;
  amountRateReduced1: number;
  amountRateReduced2: number;
  amountRateZero: number;
  amountRateSpecial: number;
  amountRatOthers: number;
}

export interface ReceiptDueBreakdown {
  /** Was die Zahlungen zusammen ergeben muessen. */
  dueCents: number;
  /** Delta des Umsatzzaehlers (Summe der Toepfe). */
  counterDeltaCents: number;
  /** Anteil der Wertgutscheine am Zahlbetrag. */
  valueVoucherFlowCents: number;
  /** Toepfe je auf Cent gerundet; `null` bei Start- und Nullbeleg. */
  bucketsCents: ReceiptDueBuckets | null;
}

/**
 * Warum sich der Zahlbetrag nicht rechnen laesst. Fest wie ein Backend-Code;
 * dieselbe Liste im Dart-Zwilling und in `fixtures/receipt-due-errors.json`.
 */
export const RECEIPT_DUE_ERROR_REASONS = Object.freeze([
  'unknown_receipt_type',
  'tip_not_allowed',
  'invalid_item',
  'invalid_voucher',
  'invalid_tip',
  'unknown_payment_method',
  'tip_conflict',
  'tip_recipient_missing',
  'tip_without_goods',
] as const);
export type ReceiptDueErrorReason = (typeof RECEIPT_DUE_ERROR_REASONS)[number];

/**
 * Der Zahlbetrag laesst sich aus dieser Eingabe nicht rechnen, etwa
 * Trinkgeld mit Betrag ohne Ware (`reason: 'tip_without_goods'`).
 *
 * Eindeutig **nicht gesendet**: die Rechnung laeuft ganz im Paket, vor jedem
 * Aufruf. `outcome` ist darum immer `'rejected'`; nichts ist geschehen, keine
 * Belegnummer verbraucht, keine Karte belastet. Die Kasse sagt das dem
 * Kassier, bevor sie ein Terminal anspricht. Entscheiden am `code` bzw.
 * `reason`, nie an `message` (die ist fuers Protokoll).
 *
 * Bis 1.0.0-rc.4 warf die Rechnung hier einen `RangeError` ohne Code.
 */
export class ReceiptDueError extends Error {
  readonly name = 'ReceiptDueError';
  /** Stabiler Code fuer jede Ursache. */
  readonly code = 'receipt_due_unavailable' as const;
  /** Die Ursache im Einzelnen. */
  readonly reason: ReceiptDueErrorReason;
  /** Immer `'rejected'`: es ging nichts hinaus. */
  readonly outcome = 'rejected' as const;
  /**
   * Nur bei `invalid_voucher`: der Gutschein-Code, mit dem der Server
   * denselben Beleg abwiese (`voucher_rate_mismatch`, `voucher_exceeds_total`,
   * `voucher_not_found` …), fuer die Meldung an der Kasse.
   */
  readonly voucherErrorCode?: string;

  constructor(reason: ReceiptDueErrorReason, message: string, voucherErrorCode?: string) {
    super(`Zahlbetrag: ${message}`);
    this.reason = reason;
    if (voucherErrorCode !== undefined) this.voucherErrorCode = voucherErrorCode;
  }
}

export function isReceiptDueError(error: unknown): error is ReceiptDueError {
  return error instanceof ReceiptDueError;
}

type BelegArt = ReceiptType | ReceiptTypeKey | string;

const UMSATZ = new Set(['standard', 'cancellation', 'training']);
const TRINKGELD_ERLAUBT = new Set(['standard', 'training']);
const ZAHLARTEN = new Set(['cash', 'creditCard', 'online', 'uberApp', 'uberCard', 'uberCash', 'boltApp', 'boltCard', 'boltCash']);

/** Zahlbetrag in Cent, siehe Modulkommentar. */
export function receiptDueCents(items: readonly ReceiptItem[], vouchers: readonly Voucher[], receiptType: BelegArt, options: ReceiptDueOptions = {}): number {
  return receiptDueBreakdown(items, vouchers, receiptType, options).dueCents;
}

/** Wie [receiptDueCents], dazu Zaehler-Delta, Wertgutschein-Anteil und Toepfe. */
export function receiptDueBreakdown(
  items: readonly ReceiptItem[],
  vouchers: readonly Voucher[],
  receiptType: BelegArt,
  options: ReceiptDueOptions = {},
): ReceiptDueBreakdown {
  return rechne(items, vouchers, receiptType, options).ergebnis;
}

interface Rechnung {
  ergebnis: ReceiptDueBreakdown;
  /** Ware und Trinkgeld in innerer Form (ohne Gutscheinzeilen). */
  kunde: Innen[];
  /** Summe der Einloese-Minuszeilen je Topf. */
  minusJeTopf: Map<string, number>;
}

function rechne(items: readonly ReceiptItem[], vouchers: readonly Voucher[], receiptType: BelegArt, options: ReceiptDueOptions): Rechnung {
  const art = belegArt(receiptType);
  const trinkgelder = trinkgeldAuftraege(options);
  if (trinkgelder.length > 0 && !TRINKGELD_ERLAUBT.has(art)) {
    throw new ReceiptDueError('tip_not_allowed', `Trinkgeld gibt es nur bei standard und training, nicht bei "${art}".`);
  }
  if (!UMSATZ.has(art)) {
    return { ergebnis: { dueCents: 0, counterDeltaCents: 0, valueVoucherFlowCents: 0, bucketsCents: null }, kunde: [], minusJeTopf: new Map() };
  }

  const positionen = items.map(innen);
  // index.js createReceipt: erst `tip`, dann je Zahlart aus payments[].tipCents;
  // jede Runde haengt ihre Positionen hinten an (die Basis bleibt die Ware).
  for (const auftrag of trinkgelder) positionen.push(...trinkgeldPositionen(auftrag, positionen, options.tipRecipient));

  // Danach der Gutschein-Plan (gutschein-beleg.plane): seine Positionen stehen hinter Ware und Trinkgeld.
  const plan = planeGutscheine(positionen, vouchers, art, {
    voucherInfo: options.voucherInfo,
    voucherSettings: options.voucherSettings,
    voucherArticles: options.voucherArticles,
    smallBusiness: options.smallBusiness,
    zeroRateBucketFrom: options.zeroRateBucketFrom,
    today: options.today ?? wienerTag(),
  });
  if ('fehler' in plan) throw new ReceiptDueError('invalid_voucher', plan.text, plan.fehler);
  const kunde = positionen.slice();
  positionen.push(...plan.zusatz);
  // gutschein-beleg.zahlbetrag: nur Wert und Rabatt, ohne Mehrzweck-Verkaeufe im 0-%-Topf.
  const gutscheine = plan.gutscheine.filter((g) => !(g.action === VoucherAction.sell && g.imNullTopf === true));

  const t = belegToepfe(positionen, gutscheine);
  const fluss = wertgutscheinFlussCents(gutscheine, art);
  const dueCents = t.zaehlerDeltaCents + fluss;
  // Ohne Auszahlungen darf der Zahlbetrag nicht negativ werden (Einloesung hoeher als die Summe).
  if (plan.mitPlan && dueCents + plan.auszahlungCents < 0) {
    throw new ReceiptDueError('invalid_voucher', 'die Gutscheine uebersteigen die Summe des Belegs.', 'voucher_exceeds_total');
  }
  return {
    ergebnis: {
      dueCents,
      counterDeltaCents: t.zaehlerDeltaCents,
      valueVoucherFlowCents: fluss,
      bucketsCents: {
        amountRateStandard: euroToCent(t.amountRateStandard),
        amountRateReduced1: euroToCent(t.amountRateReduced1),
        amountRateReduced2: euroToCent(t.amountRateReduced2),
        amountRateZero: euroToCent(t.amountRateZero),
        amountRateSpecial: euroToCent(t.amountRateSpecial),
        amountRatOthers: euroToCent(t.amountRatOthers),
      },
    },
    kunde,
    minusJeTopf: plan.minusJeTopf,
  };
}

/** Schon gewaehlte Gutscheine und Optionen des Belegs, vor dem Gutschein, der vorbelegt wird. */
export interface VoucherRedeemContext {
  vouchers?: readonly Voucher[];
  options?: ReceiptDueOptions;
}

/**
 * Hoechstbetrag zum Vorbelegen einer Einloesung an der Kasse, in Cent, nie
 * negativ. Mehrzweck: hoechstens Saldo und offener Betrag. Einzweck:
 * hoechstens Saldo, offener Betrag und die deckbaren Positionen im Topf seines
 * Satzes (ohne Trinkgeld und Gutscheinzeilen, abzueglich schon gewaehlter
 * Einloesungen dort; als Kleinunternehmer alle Saetze). Leistung (wird ueber
 * Positionen eingeloest), Aktion (Rabatt rechnet der Server) und jeder nicht
 * aktive Gutschein: 0. Mehr nimmt der Server nicht an
 * (`voucher_exceeds_total`, `voucher_rate_mismatch`).
 */
export function voucherRedeemMaxCents(items: readonly ReceiptItem[], voucher: VoucherCheck, before: VoucherRedeemContext = {}): number {
  if (voucher.status !== 'active') return 0;
  if (voucher.type !== 'multi_purpose' && voucher.type !== 'single_purpose') return 0;
  const saldo = Number.isInteger(voucher.balanceCents) ? (voucher.balanceCents as number) : 0;
  const options = before.options ?? {};
  const r = rechne(items, before.vouchers ?? [], 'standard', options);
  let hoechstens = Math.min(saldo, r.ergebnis.dueCents);
  if (voucher.type === 'single_purpose') {
    const deckbar = r.kunde.filter(istDeckbar);
    if (options.smallBusiness === true) {
      const schon = [...r.minusJeTopf.values()].reduce((s, c) => s + c, 0);
      hoechstens = Math.min(hoechstens, centSumme(deckbar) - schon);
    } else {
      if (!Number.isInteger(voucher.vatRateBp)) return 0;
      const topf = topfFuerSatz((voucher.vatRateBp as number) / 100);
      const basis = centSumme(deckbar.filter((it) => topfFuerSatz(it.vat) === topf));
      hoechstens = Math.min(hoechstens, basis - (r.minusJeTopf.get(topf) ?? 0));
    }
  }
  return Math.max(0, hoechstens);
}

/** Heute in Wien als `YYYY-MM-DD`. */
function wienerTag(): string {
  const w = toViennaWallClock(new Date());
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

function belegArt(wert: BelegArt): string {
  const text = typeof wert === 'object' && wert !== null ? wert.value : wert;
  if (typeof text !== 'string' || !Object.prototype.hasOwnProperty.call(ReceiptType, text)) {
    throw new ReceiptDueError('unknown_receipt_type', `unbekannter Belegtyp "${String(text)}".`);
  }
  return text;
}

/** `beleg-toepfe.euroToCent`; `+ 0` macht aus einem negativen Null ein Null. */
function euroToCent(euro: number): number {
  return Math.round(euro * 100) + 0;
}

/** Position in die innere Form: Einzelpreis `Math.round(cents) / 100` wie `interneForm`. */
function innen(item: ReceiptItem, i: number): Innen {
  const satz = typeof item.vat === 'number' ? item.vat : item.vat?.rate;
  if (typeof satz !== 'number' || !Number.isFinite(satz)) throw new ReceiptDueError('invalid_item', `Position ${i + 1} ohne Steuersatz.`);
  if (!Number.isSafeInteger(item.priceCents)) throw new ReceiptDueError('invalid_item', `Position ${i + 1} hat keinen ganzen Cent-Preis.`);
  if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)) throw new ReceiptDueError('invalid_item', `Position ${i + 1} hat keine gueltige Menge.`);
  const tip = item.kind === 'tip' ? (item.recipient?.owner === true ? 'owner' : 'staff') : null;
  return {
    amount: item.quantity,
    priceOne: Math.round(item.priceCents) / 100,
    vat: satz,
    tip,
    ...(item.kind !== undefined ? { kind: item.kind } : {}),
    ...(item.articleId != null ? { articleId: item.articleId } : {}),
  };
}

interface Auftrag {
  empfaenger: Array<{ cents: number; owner: boolean | null }>;
}

/** Trinkgeld-Auftraege in der Reihenfolge des Servers: `tip`, dann je Zahlart die Summe der `tipCents`. */
function trinkgeldAuftraege(options: ReceiptDueOptions): Auftrag[] {
  const raus: Auftrag[] = [];
  const tipCents = (options.payments ?? []).some((z) => z != null && z.tipCents !== undefined);
  if (options.tip != null && tipCents) {
    throw new ReceiptDueError('tip_conflict', 'tip und payments[].tipCents gehen nicht zugleich (tip_conflict).');
  }
  if (options.tip != null) {
    const tip = options.tip;
    const cents = typeof tip === 'number' ? tip : tip.cents;
    pruefeCent(cents, 'Trinkgeld');
    const recipients = typeof tip === 'number' ? undefined : tip.recipients;
    if (recipients != null) {
      if (recipients.length === 0) throw new ReceiptDueError('invalid_tip', 'recipients darf nicht leer sein.');
      for (const r of recipients) {
        pruefeCent(r.cents, 'Trinkgeld-Anteil');
        if (typeof r.owner !== 'boolean') throw new ReceiptDueError('invalid_tip', 'recipients[].owner muss true oder false sein.');
      }
      if (recipients.reduce((s, r) => s + r.cents, 0) !== cents) {
        throw new ReceiptDueError('invalid_tip', 'die Anteile des Trinkgelds ergeben nicht den Betrag.');
      }
      raus.push({ empfaenger: recipients.map((r) => ({ cents: r.cents, owner: r.owner })) });
    } else {
      raus.push({ empfaenger: [{ cents, owner: null }] });
    }
  }
  // zahlungen-core.tipsJeZahlart: Summe je bekannter Zahlart, Reihenfolge des ersten Auftretens.
  const je = new Map<string, number>();
  for (const z of options.payments ?? []) {
    if (z == null || z.tipCents === undefined) continue;
    pruefeCent(z.tipCents, 'tipCents');
    const methode = typeof z.method === 'object' && z.method !== null ? z.method.value : z.method;
    if (typeof methode !== 'string' || !ZAHLARTEN.has(methode)) throw new ReceiptDueError('unknown_payment_method', `unbekannte Zahlart "${String(methode)}".`);
    je.set(methode, (je.get(methode) ?? 0) + z.tipCents);
  }
  for (const cents of je.values()) raus.push({ empfaenger: [{ cents, owner: null }] });
  return raus;
}

function pruefeCent(wert: unknown, was: string): void {
  if (typeof wert !== 'number' || !Number.isInteger(wert) || wert <= 0) {
    throw new ReceiptDueError('invalid_tip', `${was} muss eine ganze Zahl in Cent > 0 sein.`);
  }
}

/** `tip-core.buildTipItems`: Personal in den Null-%-Satz, Inhaber anteilig auf die Saetze der Ware. */
function trinkgeldPositionen(auftrag: Auftrag, positionen: readonly Innen[], standard: ReceiptDueTipRecipient | undefined): Innen[] {
  const basis = warenCentsJeSatz(positionen);
  const summe = Object.values(basis).reduce((s, c) => s + c, 0);
  if (summe <= 0) throw new ReceiptDueError('tip_without_goods', 'Trinkgeld braucht mindestens eine Position mit Betrag.');
  const raus: Innen[] = [];
  for (const e of auftrag.empfaenger) {
    let owner = e.owner;
    if (owner == null) {
      if (standard !== 'owner' && standard !== 'staff') {
        throw new ReceiptDueError('tip_recipient_missing', "tipRecipient fehlt ('owner' oder 'staff', wie der angemeldete Kassen-Benutzer).");
      }
      owner = standard === 'owner';
    }
    if (!owner) {
      raus.push({ amount: 1, priceOne: e.cents / 100, vat: 0, tip: 'staff' });
      continue;
    }
    const teile = splitOwnerTip(e.cents, basis);
    if (teile.length === 0) throw new ReceiptDueError('tip_without_goods', 'Inhaber-Trinkgeld braucht mindestens eine Position mit Betrag.');
    for (const teil of teile) {
      if (teil.cents !== 0) raus.push({ amount: 1, priceOne: teil.cents / 100, vat: teil.vat, tip: 'owner' });
    }
  }
  return raus;
}

/** `tip-core.warenCentsJeSatz`: Summe je Satz in Euro, dann einmal runden. */
function warenCentsJeSatz(positionen: readonly Innen[]): Record<string, number> {
  const roh: Record<string, number> = {};
  for (const p of positionen) {
    if (p.tip != null) continue;
    roh[p.vat] = (roh[p.vat] ?? 0) + p.amount * p.priceOne;
  }
  const raus: Record<string, number> = {};
  for (const [satz, wert] of Object.entries(roh)) raus[satz] = Math.round(wert * 100);
  return raus;
}

/** `tip-core.splitOwnerTip`. */
function splitOwnerTip(cents: number, jeSatz: Record<string, number>): Array<{ vat: number; cents: number }> {
  const saetze = Object.entries(jeSatz)
    .map(([vat, c]) => ({ vat: Number(vat), basis: c }))
    .filter((s) => Number.isFinite(s.vat) && s.basis > 0)
    .sort((a, b) => b.vat - a.vat);
  const basis = saetze.reduce((s, x) => s + x.basis, 0);
  if (basis <= 0) return [];
  let vergeben = 0;
  const verteilt = saetze.map((s) => {
    const exakt = (cents * s.basis) / basis;
    const anteil = Math.floor(exakt);
    vergeben += anteil;
    return { vat: s.vat, cents: anteil, frac: exakt - anteil };
  });
  const rest = cents - vergeben;
  if (rest > 0) {
    let bester = verteilt[0]!;
    for (const e of verteilt) if (e.frac > bester.frac || (e.frac === bester.frac && e.vat > bester.vat)) bester = e;
    bester.cents += rest;
  }
  return verteilt.map(({ vat, cents: c }) => ({ vat, cents: c }));
}

type TopfName = ReturnType<typeof topfFuerSatz>;
const FUENF = ['amountRateStandard', 'amountRateReduced1', 'amountRateReduced2', 'amountRateZero', 'amountRateSpecial'] as const;

/** `beleg-toepfe.belegToepfe`, Schritt fuer Schritt. */
function belegToepfe(positionen: readonly Innen[], gutscheine: readonly Gutschein[]): Record<TopfName, number> & { zaehlerDeltaCents: number } {
  const t: Record<TopfName, number> = { amountRateStandard: 0, amountRateReduced1: 0, amountRateReduced2: 0, amountRateZero: 0, amountRateSpecial: 0, amountRatOthers: 0 };
  let personal = 0;
  for (const p of positionen) {
    if (p.tip === 'staff') personal += p.amount * p.priceOne;
    else t[topfFuerSatz(p.vat)] += p.priceOne * p.amount;
  }
  const gesamt = t.amountRateStandard + t.amountRateReduced1 + t.amountRateReduced2 + t.amountRateZero + t.amountRateSpecial;

  if (gutscheine.length > 0) {
    let rabatt = 0;
    for (const v of gutscheine) if (v.action === VoucherAction.redeem && v.type === VoucherType.promo) rabatt += v.value;
    const nutzbarCents = euroToCent(rabatt > gesamt ? gesamt : rabatt);
    const cents = FUENF.map((n) => euroToCent(t[n]));
    const basis = cents.reduce((s, c) => s + c, 0);
    const anteil = cents.map(() => 0);
    if (basis > 0 && nutzbarCents > 0) {
      cents.forEach((c, i) => {
        anteil[i] = Math.floor((nutzbarCents * c) / basis);
      });
      const rest = nutzbarCents - anteil.reduce((s, a) => s + a, 0);
      if (rest > 0) {
        // Groesster Topf; stabile Sortierung, bei Gleichstand der erste.
        let groesster = 0;
        for (let i = 1; i < cents.length; i++) if (cents[i]! > cents[groesster]!) groesster = i;
        if (cents[groesster]! > 0) anteil[groesster] = anteil[groesster]! + rest;
      }
    }
    FUENF.forEach((n, i) => {
      t[n] = (cents[i]! - anteil[i]!) / 100;
    });
  }
  t.amountRateZero += personal;
  const zaehlerDeltaCents =
    euroToCent(t.amountRateStandard) + euroToCent(t.amountRateReduced1) + euroToCent(t.amountRateReduced2) +
    euroToCent(t.amountRateZero) + euroToCent(t.amountRateSpecial) + euroToCent(t.amountRatOthers);
  return { ...t, zaehlerDeltaCents };
}

/**
 * `zahlungen-core.wertgutscheinFlussCents`: Eintraege im 0-%-Topf
 * (`imNullTopf`) stehen schon als Position; eine Auszahlung ohne
 * Topf-Position mindert den Zahlbetrag.
 */
function wertgutscheinFlussCents(gutscheine: readonly Gutschein[], art: string): number {
  const vz = art === 'cancellation' ? -1 : 1;
  let cents = 0;
  for (const v of gutscheine) {
    if (v.type !== VoucherType.value || v.imNullTopf === true || !Number.isFinite(v.value)) continue;
    const c = euroToCent(v.value);
    if (v.action === VoucherAction.sell) cents += c;
    else if (v.action === VoucherAction.redeem || v.action === VoucherAction.payout) cents -= c;
  }
  return vz * cents + 0;
}
