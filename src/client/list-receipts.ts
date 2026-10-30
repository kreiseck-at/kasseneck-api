import { KeckPaymentMethod, ReceiptType } from '../enums/index.js';
import {
  type CancellationReason,
  type CancellationStatus,
  CANCELLATION_STATUSES,
  type Receipt,
  type ReceiptCompany,
  type ReceiptCompanyPayload,
  type ReceiptPayloadRead,
  type ReceiptPayment,
  type ReceiptPaymentPayload,
  type ZeroKind,
  fromReceiptCompanyPayload,
  fromReceiptPayload,
  fromReceiptPaymentPayload,
} from '../models/index.js';
import type { ReportV2Metadata } from './reports.js';
import type { ReceiptWithCompany } from './receipts.js';
import type { SheetLogoSize } from '../receipt/blatt.js';
import { readEnumKey } from '../models/enum-payload.js';
import { KasseneckValidationError } from './errors.js';
import type { InternerTransport } from './aufrufe.js';

/**
 * Belege einer Kasse auflisten (`listReceipts`, nur unter `/v3`): ein Tag oder
 * ein Zeitraum von hoechstens 31 Kalendertagen, Seite fuer Seite ueber einen
 * undurchsichtigen Cursor. Nachfolger von `getReportV2` fuer Listen;
 * `getReportV2` bleibt fuer Berichte.
 *
 * **Anmeldung wie `getReportV2`:** API-Schluessel plus `cashregister-token`
 * (`apiKeyAuth`); die Kasse kommt aus dem Token, nie aus einem Parameter.
 * Kassen-Bediener (Geraet + PIN) weist der Server ab; die Kasse hat dafuer
 * `listMyReceipts` am Kassenweg. Dieses Paket bildet das nicht nach, wer darf,
 * entscheidet allein das Backend.
 *
 * Zeiten sind die **Wiener Wanduhr** als Text, wie `timeStamp` am Beleg; der
 * Server vergleicht sie als Text. Ein Tag ist ein Kalendertag, auch an den
 * Tagen der Zeitumstellung, und die Grenze von 31 Tagen zaehlt Kalendertage,
 * nicht 31 x 24 Stunden. Die Pruefung hier rechnet darum ohne Zeitzone, genau
 * wie der Server (`beleg-liste-core.js`).
 */

/** Ansicht einer Seite: `summary` eine schlanke Zeile je Beleg, `full` das gespeicherte Belegdokument. */
export const LIST_RECEIPTS_VIEWS = Object.freeze(['summary', 'full'] as const);
export type ListReceiptsView = (typeof LIST_RECEIPTS_VIEWS)[number];

/** Reihenfolge: `desc` neueste zuerst (Vorgabe des Servers), `asc` aelteste zuerst. */
export const LIST_RECEIPTS_ORDERS = Object.freeze(['desc', 'asc'] as const);
export type ListReceiptsOrder = (typeof LIST_RECEIPTS_ORDERS)[number];

/** Groesste Seite, die der Server liefert (`limit`); ohne Angabe nimmt er 100. */
export const LIST_RECEIPTS_LIMIT_MAX = 500;

/** Laengster Zeitraum in Kalendertagen (`to` hoechstens `from` + 31 Tage). */
export const LIST_RECEIPTS_DAYS_MAX = 31;

/**
 * So viele Seiten holt [listAllReceipts] hoechstens, dann bricht er mit
 * Fehler ab. Schutz gegen einen Cursor, der nie endet; mit der Seitengroesse
 * des Helfers (500) sind das 50.000 Belege, mehr als jede Kasse in 31 Tagen
 * ausstellt.
 */
export const LIST_ALL_RECEIPTS_MAX_PAGES = 100;

/**
 * Fehlercodes von `listReceipts` (`code` des [KasseneckApiError]), dazu die
 * gemeinsamen Codes von Anmeldung und Rand (Kassen-Token, Live-Gate,
 * API-Freigabe). Ein Code ausserhalb bleibt ueber `KasseneckApiError.code`
 * lesbar. Die Regeln der ersten sieben prueft dieses Paket schon vor dem
 * Senden (ausser `invalid_cursor`: ob ein Cursor zur Abfrage passt, weiss nur
 * der Server).
 */
export const LIST_RECEIPTS_ERROR_CODES = Object.freeze([
  'invalid_date', // kein Datum JJJJ-MM-TT bzw. Zeitpunkt JJJJ-MM-TTThh:mm:ss, oder unmoeglich (2026-02-30)
  'invalid_range', // nicht genau eine Form (date ODER from + to), oder to nicht nach from
  'range_too_long', // mehr als 31 Kalendertage
  'invalid_limit', // keine ganze Zahl von 1 bis 500 (der Server kappt nie still)
  'invalid_order', // weder desc noch asc
  'invalid_view', // weder summary noch full
  'invalid_cursor', // veraendert, fremde Kasse, oder Zeitfenster/order/view anders als auf Seite 1
  'server_error',
] as const);
export type ListReceiptsErrorCode = (typeof LIST_RECEIPTS_ERROR_CODES)[number];

/**
 * Eingabe von [listReceipts]. Genau eine Form des Zeitfensters: `date` ODER
 * `from` + `to`.
 *
 * - `date`: ein Wiener Tag, `YYYY-MM-DD` (00:00:00 bis zum Beginn des
 *   Folgetags). Nur mit `date` traegt die erste Seite `daySummary`.
 * - `from` (einschliesslich) und `to` (ausschliesslich): `YYYY-MM-DD` oder
 *   `YYYY-MM-DDTHH:mm:ss`, Wiener Wanduhr ohne Zone. Ein reines Datum heisst
 *   Beginn dieses Tages; `to` liegt hoechstens 31 Kalendertage nach `from`.
 *
 * Mit `cursor` (dem `nextCursor` der Vorseite) muessen Zeitfenster, `order`
 * und `view` gleich bleiben wie auf Seite 1, sonst antwortet der Server
 * `invalid_cursor`; `limit` darf sich aendern.
 */
export type ListReceiptsOptions<V extends ListReceiptsView = ListReceiptsView> = ListReceiptsWindow & {
  /** Seitengroesse, ganze Zahl 1-500; ohne Angabe 100. */
  limit?: number;
  /** Ohne Angabe `desc` (neueste zuerst). */
  order?: ListReceiptsOrder;
  /** Ohne Angabe `summary`. */
  view?: V;
  /** `nextCursor` der vorigen Seite. */
  cursor?: string;
};

/** Zeitfenster von [ListReceiptsOptions]: ein Tag oder ein Zeitraum. */
export type ListReceiptsWindow =
  | { date: string; from?: undefined; to?: undefined }
  | { from: string; to: string; date?: undefined };

/** Brutto je RKSV-Satzgruppe in Cent (`amountRateStandard` bis `amountRateSpecial` am Beleg). */
export interface ListReceiptsGrossByRate {
  standard: number;
  reduced1: number;
  reduced2: number;
  zero: number;
  special: number;
}

/**
 * Zeile eines Belegs in [listReceipts] mit `view: 'summary'`. Betraege in
 * ganzen Cent. Kein Layout, kein Kopf, keine Positionen und keine
 * Pruefangaben: fuer die Detailansicht `getReceipt`, fuer die PDF
 * `downloadReceipt` mit `fullReceiptId`.
 *
 * Nicht zu verwechseln mit [ReceiptSummary] von `listMyReceipts` (Kassenweg,
 * andere Felder, Betrag dort aus Euro gerechnet).
 *
 * `receiptType` und `paymentMethod` sind wie ueberall beim Lesen der bekannte
 * Enum-Eintrag oder der rohe Schluessel; ein Wert, den dieses Paket nicht
 * kennt, laesst die Liste nicht scheitern.
 */
export interface ListReceiptsSummary {
  receiptId: string | null;
  /** Fortlaufender Belegzaehler der Kasse; `null` bei Alt-Belegen. */
  counter: number | null;
  receiptType: ReceiptType | string | null;
  /** Nur am Nullbeleg: Anlass (`manual`, wenn der Beleg keinen nennt); sonst `null`. */
  zeroKind: ZeroKind | string | null;
  /** Roher Belegzeitstempel (Wiener Wanduhr); Deutung ueber `parseServerTimeStamp`. */
  timeStamp: string | null;
  /** Summe von `grossByRateCents`; negativ am Storno-Beleg. */
  totalCents: number;
  grossByRateCents: ListReceiptsGrossByRate;
  /** `mixed` bei mehreren Zahlungen (die stehen dann in `payments`). */
  paymentMethod: KeckPaymentMethod | string | null;
  /** Nur wenn der Beleg eine Zahlungsliste traegt; ohne Anbieterdaten. */
  payments?: ReceiptPayment[];
  /** Nur wenn der Beleg Trinkgeld traegt. */
  tipCents?: number;
  /** Bediener (nur der Name), oder `null`. */
  operator: { name: string } | null;
  /** Nur am Storno-Beleg: das Original. */
  cancellationOf: { receiptId: string | null; timeStamp: string | null } | null;
  cancellationReason: CancellationReason | string | null;
  /**
   * Storno-Stand: `none`, `partial` oder `full` (nur an Normalbelegen anders
   * als `none`). Ein Wert, den dieses Paket nicht kennt, kommt als
   * `'unknown'` an, nie still als `none`: dann keinen Storno anbieten, bis
   * der Beleg einzeln gelesen ist.
   */
  cancellationStatus: CancellationStatus | 'unknown';
  /** Mit funktionierender Signatureinheit ausgestellt (`signatureSuccess !== false`). */
  signatureOk: boolean;
  /** Eigene Referenz des Aufrufers am Beleg, oder `null`. */
  customProjectId: string | null;
  /** Schluessel fuer `downloadReceipt` und den Beleg-Link, oder `null`. */
  fullReceiptId: string | null;
}

/**
 * Ein Beleg der vollen Ansicht: das Belegdokument wie bei `getReceipt`, dazu was `getReceipt` in der Huelle
 * traegt, ausser `outputs` und dem Zeilenmodell `layout` (die gibt es nur einzeln ueber `getReceipt`).
 * `headerVersionId` ist die Kopf-Version, die fuer diesen Beleg gilt (auch bei Altbelegen ohne gespeicherte
 * Kennung); ihr Kopf steht in [ListReceiptsPage.headers]. Anbieterdaten der Zahlungen bekommt nur der Betrieb
 * selbst (API-Schluessel oder Kassen-Anmeldung), nie ein Partner-Zugang.
 * Druck- und Anzeigedaten wie bei `getReceiptWithCompany`: [listedReceiptWithCompany].
 */
export interface ListedFullReceipt extends Receipt {
  /** Produktionskonto mit Test-Signatureinheit (Aufdruck TESTSIGNATUR); fehlt bei einem Backend vor dem 30.10.2026. */
  testSignature?: boolean;
}

/** Ein Eintrag in [ListReceiptsPage.headers]: Kopf und Fuss einer Kopf-Version (Felder wie die Huelle von `getReceipt`). */
export interface ListReceiptsHeader {
  /** `null` nur, wenn das Konto noch keine Kopf-Version hat (dann der heutige Stand). */
  headerVersionId: string | null;
  company: ReceiptCompany;
}

/** Ein Beleg der Liste je Ansicht: `full` das Belegdokument wie bei `getReceipt`, sonst die Zeile. */
export type ListedReceipt<V extends ListReceiptsView = 'summary'> = V extends 'full' ? ListedFullReceipt : ListReceiptsSummary;

/**
 * Tagessumme aus der Tagesstatistik der Kasse, nur bei `date` und nur auf
 * der ersten Seite. **Nicht die Summe der Liste:** `receiptCount` zaehlt jeden
 * Beleg des Tages (auch Null-, Start- und Trainingsbelege), `revenueCents`
 * nur Normal- und Storno-Belege, ohne Mitarbeiter-Trinkgeld und nach
 * Aktionsrabatt. Wer die Liste summieren will, summiert die Liste.
 */
export interface ListReceiptsDaySummary {
  date: string;
  receiptCount: number;
  revenueCents: number;
  /** Je Steuersatz (Basispunkte, 2000 = 20 %), hoechster zuerst; Saetze ohne Umsatz fehlen. */
  revenueByRate: Array<{ rateBp: number; grossCents: number }>;
}

/** Eine Seite von [listReceipts]. */
export interface ListReceiptsPage<V extends ListReceiptsView = 'summary'> {
  receipts: Array<ListedReceipt<V>>;
  /** Es gibt weitere Belege: mit `cursor: nextCursor` weiterlesen. */
  hasMore: boolean;
  /** `null`, wenn `hasMore` false ist. */
  nextCursor: string | null;
  /**
   * Nur bei `date` auf der ersten Seite (ohne `cursor`); `null`, wenn es fuer
   * den Tag keine Statistik gibt. Auf allen anderen Seiten fehlt das Feld.
   */
  daySummary?: ListReceiptsDaySummary | null;
  /**
   * Nur bei `view: 'full'`: Firmendaten fuer den Belegkopf (Nachdruck), dieselben Felder wie
   * `getReportV2().metadata`. Bei der Kurzansicht fehlt das Feld.
   */
  metadata?: V extends 'full' ? ReportV2Metadata : never;
  /**
   * Nur bei `view: 'full'`: die Kopf-Versionen der Belege dieser Seite, je Version einmal, aelteste zuerst.
   * Fuer den Druck gilt der Eintrag mit der `headerVersionId` des Belegs, nicht `metadata` (heutiger Stand).
   * Fehlt bei einem Backend vor dem 30.10.2026.
   */
  headers?: V extends 'full' ? ListReceiptsHeader[] : never;
  /** Nur bei `view: 'full'`: Belege einer Testumgebung (Aufdruck TESTKASSE), wie `getReceipt`. */
  testCashregister?: V extends 'full' ? boolean : never;
  /** Nur bei `view: 'full'`: Groesse des Firmenlogos (`logo_scale`), wie `getReceipt`. */
  logoScale?: V extends 'full' ? SheetLogoSize : never;
}

const TAG = /^(\d{4})-(\d{2})-(\d{2})$/;
const ZEIT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/** Kalendertag als UTC-Mitternacht (nur zum Rechnen mit Tagen; auch fuer Jahre unter 100). */
function utcTag(jahr: number, monat: number, tag: number): Date {
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(jahr, monat - 1, tag);
  return d;
}

/** Ein echtes Kalenderdatum (2026-02-30 nicht)? */
function kalendertag(jahr: number, monat: number, tag: number): boolean {
  const d = utcTag(jahr, monat, tag);
  return d.getUTCFullYear() === jahr && d.getUTCMonth() === monat - 1 && d.getUTCDate() === tag;
}

const zwei = (n: number) => String(n).padStart(2, '0');

/** Wanduhr-Text `YYYY-MM-DDTHH:mm:ss` aus einem Tag oder Zeitpunkt; sonst `null`. */
function wanduhr(wert: unknown): string | null {
  if (typeof wert !== 'string') return null;
  const t = TAG.exec(wert);
  if (t) return kalendertag(+t[1]!, +t[2]!, +t[3]!) ? `${wert}T00:00:00` : null;
  const z = ZEIT.exec(wert);
  if (z && kalendertag(+z[1]!, +z[2]!, +z[3]!) && +z[4]! <= 23 && +z[5]! <= 59 && +z[6]! <= 59) return wert;
  return null;
}

/** Wanduhr-Text plus ganze Kalendertage, Uhrzeit bleibt (ohne Zeitzone gerechnet). */
function plusTage(zeit: string, tage: number): string {
  const [datum, uhr] = zeit.split('T') as [string, string];
  const [j, m, t] = datum.split('-').map(Number) as [number, number, number];
  const d = utcTag(j, m, t + tage);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}T${uhr}`;
}

const gesetzt = (v: unknown) => v !== undefined && v !== null;

/** Fehler in der Eingabe des Aufrufers: es geht keine Anfrage raus. */
function eingabefehler(grund: string): KasseneckValidationError {
  return new KasseneckValidationError('listReceipts', grund, 'request');
}

/** Antwort meldet Erfolg, traegt aber nicht, was der Aufruf zusagt. */
function antwortfehler(grund: string): KasseneckValidationError {
  return new KasseneckValidationError('listReceipts', grund, 'response');
}

/**
 * Prueft die Eingabe nach den Regeln des Servers und gibt die Parameter
 * zurueck, die hinausgehen (nur gesetzte Felder, Werte unveraendert, damit
 * Folgeseiten dasselbe Fenster senden).
 */
function parameter(options: ListReceiptsOptions): Record<string, unknown> {
  if (options == null || typeof options !== 'object') throw eingabefehler('Optionen fehlen (date oder from und to)');
  const o = options as { date?: unknown; from?: unknown; to?: unknown; limit?: unknown; order?: unknown; view?: unknown; cursor?: unknown };
  const raus: Record<string, unknown> = {};
  if (gesetzt(o.date)) {
    if (gesetzt(o.from) || gesetzt(o.to)) throw eingabefehler('entweder date oder from und to angeben, nicht beides');
    if (typeof o.date !== 'string' || !TAG.test(o.date) || wanduhr(o.date) === null) {
      throw eingabefehler(`date muss ein Datum YYYY-MM-DD sein, war "${String(o.date)}"`);
    }
    raus['date'] = o.date;
  } else {
    if (!gesetzt(o.from) || !gesetzt(o.to)) throw eingabefehler('Zeitraum fehlt: date oder from und to angeben');
    const von = wanduhr(o.from);
    if (von === null) throw eingabefehler(`from muss YYYY-MM-DD oder YYYY-MM-DDTHH:mm:ss sein, war "${String(o.from)}"`);
    const bis = wanduhr(o.to);
    if (bis === null) throw eingabefehler(`to muss YYYY-MM-DD oder YYYY-MM-DDTHH:mm:ss sein, war "${String(o.to)}"`);
    if (bis <= von) throw eingabefehler('to muss nach from liegen (to ist ausschliesslich)');
    if (bis > plusTage(von, LIST_RECEIPTS_DAYS_MAX)) {
      throw eingabefehler(`Zeitraum hoechstens ${LIST_RECEIPTS_DAYS_MAX} Kalendertage (to hoechstens from + ${LIST_RECEIPTS_DAYS_MAX} Tage)`);
    }
    raus['from'] = o.from;
    raus['to'] = o.to;
  }
  if (gesetzt(o.limit)) {
    if (!Number.isInteger(o.limit) || (o.limit as number) < 1 || (o.limit as number) > LIST_RECEIPTS_LIMIT_MAX) {
      throw eingabefehler(`limit muss eine ganze Zahl von 1 bis ${LIST_RECEIPTS_LIMIT_MAX} sein, war "${String(o.limit)}"`);
    }
    raus['limit'] = o.limit;
  }
  if (gesetzt(o.order)) {
    if (!(LIST_RECEIPTS_ORDERS as readonly unknown[]).includes(o.order)) throw eingabefehler(`order muss desc oder asc sein, war "${String(o.order)}"`);
    raus['order'] = o.order;
  }
  if (gesetzt(o.view)) {
    if (!(LIST_RECEIPTS_VIEWS as readonly unknown[]).includes(o.view)) throw eingabefehler(`view muss summary oder full sein, war "${String(o.view)}"`);
    raus['view'] = o.view;
  }
  if (gesetzt(o.cursor)) {
    if (typeof o.cursor !== 'string' || o.cursor === '') throw eingabefehler('cursor muss der nextCursor der vorigen Seite sein (nicht leerer Text)');
    raus['cursor'] = o.cursor;
  }
  return raus;
}

const istObjekt = (w: unknown): w is Record<string, unknown> => w != null && typeof w === 'object' && !Array.isArray(w);
const text = (w: unknown): string | null => (typeof w === 'string' ? w : null);
// Ganze Cent; ein einzelner unbrauchbarer Betrag laesst die Liste nicht scheitern.
const cent = (w: unknown): number => (typeof w === 'number' && Number.isInteger(w) ? w : 0);

function istStornoStand(w: unknown): w is CancellationStatus {
  return typeof w === 'string' && (CANCELLATION_STATUSES as readonly string[]).includes(w);
}

/** Zeile `view: summary` vom Draht. */
export function fromListReceiptsSummaryPayload(payload: Record<string, unknown>): ListReceiptsSummary {
  const brutto = istObjekt(payload['grossByRateCents']) ? payload['grossByRateCents'] : {};
  const bediener = payload['operator'];
  const bezug = payload['cancellationOf'];
  return {
    receiptId: text(payload['receiptId']),
    counter: typeof payload['counter'] === 'number' ? payload['counter'] : null,
    receiptType: typeof payload['receiptType'] === 'string' ? readEnumKey(ReceiptType, payload['receiptType']) : null,
    zeroKind: text(payload['zeroKind']),
    timeStamp: text(payload['timeStamp']),
    totalCents: cent(payload['totalCents']),
    grossByRateCents: {
      standard: cent(brutto['standard']),
      reduced1: cent(brutto['reduced1']),
      reduced2: cent(brutto['reduced2']),
      zero: cent(brutto['zero']),
      special: cent(brutto['special']),
    },
    paymentMethod: typeof payload['paymentMethod'] === 'string' ? readEnumKey(KeckPaymentMethod, payload['paymentMethod']) : null,
    ...(Array.isArray(payload['payments'])
      ? { payments: payload['payments'].filter(istObjekt).map((z) => fromReceiptPaymentPayload(z as unknown as ReceiptPaymentPayload)) }
      : {}),
    ...(typeof payload['tipCents'] === 'number' ? { tipCents: payload['tipCents'] } : {}),
    operator: istObjekt(bediener) ? { name: typeof bediener['name'] === 'string' ? bediener['name'] : '' } : null,
    cancellationOf: istObjekt(bezug) ? { receiptId: text(bezug['receiptId']), timeStamp: text(bezug['timeStamp']) } : null,
    cancellationReason: text(payload['cancellationReason']),
    cancellationStatus: istStornoStand(payload['cancellationStatus']) ? payload['cancellationStatus'] : 'unknown',
    signatureOk: payload['signatureOk'] !== false,
    customProjectId: text(payload['customProjectId']),
    fullReceiptId: text(payload['fullReceiptId']),
  };
}

function tagessumme(roh: unknown): ListReceiptsDaySummary | null {
  if (roh === null) return null;
  if (!istObjekt(roh)) throw antwortfehler('daySummary ist weder ein Objekt noch null');
  const saetze = Array.isArray(roh['revenueByRate']) ? roh['revenueByRate'] : [];
  return {
    date: typeof roh['date'] === 'string' ? roh['date'] : '',
    receiptCount: cent(roh['receiptCount']),
    revenueCents: cent(roh['revenueCents']),
    revenueByRate: saetze.filter(istObjekt).map((z) => ({ rateBp: cent(z['rateBp']), grossCents: cent(z['grossCents']) })),
  };
}

/** `metadata` der vollen Ansicht wie bei getReportV2: Firmendaten plus Bezeichnung der Kasse. */
function kopfdaten(roh: unknown): ReportV2Metadata {
  if (!istObjekt(roh)) throw antwortfehler('metadata ist kein Objekt');
  const label = (roh as { label?: unknown }).label;
  return { ...fromReceiptCompanyPayload(roh as unknown as ReceiptCompanyPayload), label: typeof label === 'string' ? label : '' };
}

const LOGO_STUFEN: readonly string[] = ['S', 'M', 'L', 'XL'];

/** Ein Beleg der vollen Ansicht vom Draht: das Belegdokument und die Zusaetze, die `getReceipt` in der Huelle traegt. */
function vollerBeleg(roh: Record<string, unknown>): ListedFullReceipt {
  const beleg: ListedFullReceipt = fromReceiptPayload(roh as unknown as ReceiptPayloadRead);
  if (typeof roh['testSignature'] === 'boolean') beleg.testSignature = roh['testSignature'];
  return beleg;
}

/** `headers` der vollen Ansicht: je Kopf-Version Kennung und Kopf. */
function koepfe(roh: unknown): ListReceiptsHeader[] {
  if (!Array.isArray(roh) || roh.some((h) => !istObjekt(h))) throw antwortfehler('headers ist keine Liste von Kopf-Versionen');
  return (roh as Record<string, unknown>[]).map((h) => ({
    headerVersionId: typeof h['headerVersionId'] === 'string' && h['headerVersionId'] !== '' ? h['headerVersionId'] : null,
    company: fromReceiptCompanyPayload(h as unknown as ReceiptCompanyPayload),
  }));
}

/**
 * Ein Beleg der vollen Ansicht mit den Druck- und Anzeigedaten seiner Seite, in derselben Form wie
 * `getReceiptWithCompany` (ohne `outputs`): der Kopf der Version des Belegs aus `headers` (Nullbelege ohne
 * Logo, wie beim Server), Testkennzeichen, Logo-Stufe. `layout` ist immer `null` -- die Liste traegt kein
 * Zeilenmodell; [receiptLayoutFromResult] baut es dann mit denselben Angaben, oder `getReceiptWithCompany`
 * holt das des Servers. Von einem Backend vor dem 30.10.2026 (ohne `headers`) kommt der Kopf aus
 * `metadata`, dem heutigen Stand.
 */
export function listedReceiptWithCompany(page: ListReceiptsPage<'full'>, receipt: ListedFullReceipt): ReceiptWithCompany {
  const kennung = receipt.headerVersionId ?? null;
  const eintrag = page.headers?.find((h) => h.headerVersionId === kennung);
  let company: ReceiptCompany;
  if (eintrag) company = { ...eintrag.company };
  else if (page.metadata) {
    const { label: _label, ...kopf } = page.metadata;
    company = kopf;
  } else company = fromReceiptCompanyPayload({} as ReceiptCompanyPayload);
  const art = typeof receipt.receiptType === 'object' ? (receipt.receiptType as { value: string }).value : receipt.receiptType;
  if (art === ReceiptType.zero.value) delete company.logoUrl;
  return {
    receipt,
    company,
    testCashregister: page.testCashregister === true,
    testSignature: receipt.testSignature === true,
    headerVersionId: kennung,
    layout: null,
    registrationInfo: receipt.registrationInfo ?? null,
    logoScale: page.logoScale ?? 'M',
  };
}

/**
 * Eine Seite Belege der angemeldeten Kasse (`listReceipts`). Die Eingabe wird
 * vor dem Senden nach den Regeln des Servers geprueft (genau eine Form des
 * Zeitfensters, Datumsformat, hoechstens 31 Kalendertage, `limit` 1-500,
 * `order`, `view`); ein Verstoss wirft [KasseneckValidationError] mit
 * `scope: 'request'`, ohne dass etwas hinausgeht.
 *
 * Mit `view: 'full'` sind die Belege das gespeicherte Belegdokument mit den
 * Angaben, die `getReceipt` liefert ([ListedFullReceipt]; Kopf je Version in
 * `headers`, ohne Zeilenmodell), sonst [ListReceiptsSummary].
 * Alle Seiten auf einmal: [listAllReceipts].
 */
export async function listReceipts<V extends ListReceiptsView = 'summary'>(
  transport: InternerTransport,
  options: ListReceiptsOptions<V>,
): Promise<ListReceiptsPage<V>> {
  const params = parameter(options);
  const voll = params['view'] === 'full';
  const daten = await transport<Record<string, unknown> | null>('listReceipts', params);
  if (!istObjekt(daten)) throw antwortfehler('Antwort enthaelt keine Daten (data fehlt)');
  const liste = daten['receipts'];
  if (!Array.isArray(liste) || liste.some((b) => !istObjekt(b))) {
    throw antwortfehler('Antwort enthaelt keine Belegliste (data.receipts fehlt)');
  }
  if (typeof daten['hasMore'] !== 'boolean') throw antwortfehler('Antwort ohne hasMore');
  const weiter = daten['nextCursor'];
  // Ein `hasMore` ohne Cursor liesse den Aufrufer ratlos (oder einen Blaetterer im Kreis laufen).
  if (daten['hasMore'] ? typeof weiter !== 'string' || weiter === '' : weiter !== null) {
    throw antwortfehler('nextCursor passt nicht zu hasMore (Text bei hasMore, sonst null)');
  }
  const receipts = (voll
    ? liste.map((b) => vollerBeleg(b as Record<string, unknown>))
    : liste.map((b) => fromListReceiptsSummaryPayload(b as Record<string, unknown>))) as Array<ListedReceipt<V>>;
  const stufe = daten['logo_scale'];
  return {
    receipts,
    hasMore: daten['hasMore'],
    nextCursor: daten['hasMore'] ? (weiter as string) : null,
    ...('daySummary' in daten ? { daySummary: tagessumme(daten['daySummary']) } : {}),
    ...(voll && 'metadata' in daten ? { metadata: kopfdaten(daten['metadata']) as ListReceiptsPage<V>['metadata'] } : {}),
    ...(voll && 'headers' in daten ? { headers: koepfe(daten['headers']) as ListReceiptsPage<V>['headers'] } : {}),
    ...(voll && 'testCashregister' in daten ? { testCashregister: (daten['testCashregister'] === true) as ListReceiptsPage<V>['testCashregister'] } : {}),
    ...(voll && 'logo_scale' in daten
      ? { logoScale: (typeof stufe === 'string' && LOGO_STUFEN.includes(stufe) ? stufe : 'M') as ListReceiptsPage<V>['logoScale'] }
      : {}),
  };
}

/**
 * Alle Belege eines Tages oder Zeitraums, Seite fuer Seite: holt mit
 * [listReceipts] die erste Seite, dann mit `cursor: nextCursor` und
 * demselben Zeitfenster, `order` und `view` jede weitere, und liefert jeden
 * Beleg einzeln, in der Reihenfolge des Servers. Jeder Beleg des Fensters
 * kommt genau einmal.
 *
 * Ohne `limit` holt der Helfer Seiten zu 500 (weniger Aufrufe als die
 * Vorgabe 100 des Servers). Mit `cursor` setzt er an dieser Stelle fort.
 *
 * Ein Fehler auf irgendeiner Seite bricht ab (der Fehler kommt im
 * `for await` an); die bis dahin gelieferten Belege bleiben gueltig. Nach
 * [LIST_ALL_RECEIPTS_MAX_PAGES] Seiten, oder wenn der Server denselben
 * Cursor zweimal nennt, bricht er mit [KasseneckValidationError]
 * (`scope: 'response'`) ab, statt endlos zu laufen.
 *
 * `daySummary` liefert der Helfer nicht; wer sie braucht, ruft die erste
 * Seite mit [listReceipts].
 */
export async function* listAllReceipts<V extends ListReceiptsView = 'summary'>(
  transport: InternerTransport,
  options: ListReceiptsOptions<V>,
): AsyncGenerator<ListedReceipt<V>, void, undefined> {
  // Frueh pruefen: ein Eingabefehler kommt beim ersten Schritt an, vor jedem Aufruf.
  parameter(options);
  const grund = { ...options, limit: options.limit ?? LIST_RECEIPTS_LIMIT_MAX } as ListReceiptsOptions<V>;
  let cursor = options.cursor;
  const gesehen = new Set<string>();
  for (let seite = 1; seite <= LIST_ALL_RECEIPTS_MAX_PAGES; seite++) {
    const page: ListReceiptsPage<V> = await listReceipts(transport, { ...grund, cursor });
    yield* page.receipts;
    if (!page.hasMore) return;
    const weiter = page.nextCursor as string;
    if (gesehen.has(weiter) || weiter === cursor) throw antwortfehler('Server nennt denselben Cursor erneut; Abbruch statt Endlosschleife');
    gesehen.add(weiter);
    cursor = weiter;
  }
  throw antwortfehler(`mehr als ${LIST_ALL_RECEIPTS_MAX_PAGES} Seiten; Zeitfenster kleiner waehlen`);
}
