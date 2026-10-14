import type { ApiCall, InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import { anfrage, schluessel } from '../inventory/schreiben.js';
import { abschluss, bericht, gebucht, geoeffnet, gemeldet, ladeStand, type Ort } from './schicht-lesen.js';
import { labelText } from './texte.js';
import {
  CASH_LOCATIONS,
  EUR_DENOMINATIONS,
  type CashLocation,
  type CashMovementResult,
  type CloseShiftResult,
  type Denominations,
  type DrawerOpeningsResult,
  type DrawerState,
  type ManualMovementType,
  type OpeningReason,
  type OpenShiftResult,
  type ShiftReport,
  type ShiftTipTotals,
} from './schicht-typen.js';

/**
 * Schicht, Kassenstand und Lade-Protokoll an der Kasse (Backend
 * schicht-endpoints.js). Alle sechs Aufrufe gibt es nur ueber den Kassenweg
 * `/api/v3`; sie laufen mit dem Kassen-Benutzer-Weg (`registerUserAuth`).
 *
 * Rechte am Server: `shift` (Schicht oeffnen und schliessen, Bericht),
 * `cashMove` (Ein- und Auszahlungen), `cashView` (Soll, Ist und Differenz
 * sehen; ohne dieses Recht wird blind gezaehlt), `drawer` (Lade von Hand
 * oeffnen). [getMyDrawerState] braucht kein Recht und nennt alle vier.
 *
 * **Schreiben mit Idempotenzschluessel:** [openMyShift],
 * [recordMyCashMovement] und [closeMyShift] verlangen `idempotencyKey`, jeder
 * Eintrag von [logMyDrawerOpenings] ebenso. Bei unklarem Ausgang
 * (`outcome: 'unknown'`) denselben Vorgang mit **demselben** Schluessel noch
 * einmal senden; er wirkt genau einmal. Ein neuer Schluessel ([newIdempotencyKey])
 * gehoert nur zu einem neuen Vorgang.
 *
 * **Vor dem Senden geprueft wird nur, was ohne Netz sicher falsch ist:**
 * fehlende Kennungen, ein fehlender Schluessel, Betraege, die keine Ganzzahl
 * sind, eine leere Liste. Alles Fachliche (Katalog, Pflichtangaben je Art,
 * Kassenstand, Anspruch) prueft der Server und meldet es mit seinem Code.
 */

export interface GetMyDrawerStateOptions {
  /** Ohne Angabe gilt die Hauptlade der Kasse (`cashregisterId`, beim Kassen-Benutzer-Weg die Kasse der Anmeldung). */
  drawerId?: string;
  cashregisterId?: string;
}

export interface OpenMyShiftOptions {
  /** Bei „Erneut senden“ derselbe Schluessel wie beim ersten Versuch. */
  idempotencyKey: string;
  drawerId: string;
  /**
   * Gezaehltes Startgeld in Cent (`0` erlaubt). Genau eines von
   * `openingFloatCents` und `takeOver: true`.
   */
  openingFloatCents?: number;
  /** Stueckelung zum gezaehlten Startgeld; die Summe muss stimmen ([sumDenominations]). */
  denominations?: Denominations | null;
  /** Den Bestand der Vorschicht ungezaehlt uebernehmen („Bestand übernehmen“). */
  takeOver?: boolean;
}

export interface RecordMyCashMovementOptions {
  idempotencyKey: string;
  drawerId: string;
  type: ManualMovementType;
  /** Positiv; das Vorzeichen setzt der Server nach der Art. */
  amountCents: number;
  /** Freiwillig bei `change_in` und `cash_drop` (woher bzw. wohin); ohne Angabe bleibt der Ort leer. */
  location?: CashLocation;
  /** Grund; Pflicht bei `other_in` und `other_out`, hoechstens 200 Zeichen. */
  note?: string;
  /** Kassen-Benutzer, Pflicht bei `tip_payout`. */
  recipientId?: string;
  /** Ziel-Lade, Pflicht bei `transfer_out`. */
  targetDrawerId?: string;
}

/** Eine Oeffnung der Lade, wie die Kasse sie puffert und meldet. */
export interface DrawerOpeningEntry {
  /** Je Eintrag ein eigener Schluessel: ein zweites Melden zaehlt nicht doppelt. */
  idempotencyKey: string;
  reason: OpeningReason;
  /** Ging der Impuls an die Lade durch? Fehlgeschlagene werden mit `false` gemeldet. */
  ok: boolean;
  /** Zeit am Geraet: Millisekunden seit 1970 oder ISO 8601. */
  deviceTime: number | string;
  /** Text, Pflicht bei `other`. */
  note?: string;
  /** Beleg bei `sale`. */
  receiptId?: string;
  /** Fehlertext eines fehlgeschlagenen Impulses. */
  error?: string;
  /** Lade der Oeffnung (gepuffert); muss `drawerId` der Anfrage sein, sonst `validation`. */
  drawerId?: string;
  /**
   * Wer die Lade oeffnete (gepuffert: der damals angemeldete Mitarbeiter). Der
   * Server nimmt ihn nur, wenn er zum Betrieb gehoert und der Kasse zugewiesen
   * ist, den Namen aus dem Konto; sonst gilt der sendende Benutzer.
   */
  operator?: { registerUserId: string; name?: string | null };
}

export interface LogMyDrawerOpeningsOptions {
  drawerId: string;
  /** 1–50 Eintraege; offline gepufferte Oeffnungen werden spaeter nachgesendet. */
  entries: DrawerOpeningEntry[];
}

export interface GetMyShiftReportOptions {
  shiftId: string;
}

/** Trinkgeld-Auszahlung beim Abschluss: hoechstens der offene Anspruch (`DrawerState.tipClaims`). */
export interface TipPayout {
  registerUserId: string;
  cents: number;
}

export interface CloseMyShiftOptions {
  idempotencyKey: string;
  shiftId: string;
  /** Gezaehltes Bargeld in Cent (`0` erlaubt). */
  countedCents: number;
  denominations?: Denominations | null;
  /** Wird angenommen, wirkt aber nicht: den Versuch zaehlt der Server (hoechstens zwei). */
  attempt?: number;
  /** Begruendung; Pflicht, wenn die Abweichung die Schwelle uebersteigt (`comment_required`). */
  comment?: string;
  tipPayouts?: TipPayout[];
}

type Params = Record<string, unknown>;

const antwort = (name: string): Ort => ({ name, pfad: '', scope: 'response' });

function anfragefehler(name: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, grund, 'request');
}

/** Eine Kennung, die gesendet werden muss. */
function kennung(name: string, p: Params, feld: string): void {
  const w = p[feld];
  if (typeof w !== 'string' || w.trim() === '') throw anfragefehler(name, `${feld} fehlt`);
}

/** Ein Betrag in Cent: ganze Zahl, sonst wirft der Aufruf vor dem Senden. */
function cent(name: string, feld: string, w: unknown): void {
  if (typeof w !== 'number' || !Number.isSafeInteger(w)) throw anfragefehler(name, `${feld} muss eine ganze Zahl (Cent) sein`);
}

function stueckelungPruefen(name: string, p: Params): void {
  const w = p.denominations;
  if (w === undefined || w === null) return;
  if (typeof w !== 'object' || Array.isArray(w)) throw anfragefehler(name, 'denominations muss eine Karte Wert -> Anzahl sein');
  for (const [k, anzahl] of Object.entries(w as Params)) cent(name, `denominations.${k}`, anzahl);
}

async function rufe<T>(transport: InternerTransport, name: ApiCall, p: Params, lese: (ort: Ort, w: unknown) => T): Promise<T> {
  return lese(antwort(name), await transport(name, p));
}

/** Stand der Lade: Rechte, offene Schicht, Trinkgeld-Ansprueche und (mit `cashView`) Soll und letzte Oeffnungen. */
export async function getMyDrawerState(transport: InternerTransport, options: GetMyDrawerStateOptions = {}): Promise<DrawerState> {
  const name = 'getMyDrawerState';
  const p = anfrage(name, options);
  if (p.drawerId === '') delete p.drawerId;
  return rufe(transport, name, p, ladeStand);
}

/** Schicht oeffnen: gezaehltes Startgeld oder den Bestand uebernehmen (Recht `shift`). */
export async function openMyShift(transport: InternerTransport, options: OpenMyShiftOptions): Promise<OpenShiftResult> {
  const name = 'openMyShift';
  const p = anfrage(name, options);
  kennung(name, p, 'drawerId');
  schluessel(name, p, { pflicht: true });
  if (p.openingFloatCents !== undefined) cent(name, 'openingFloatCents', p.openingFloatCents);
  stueckelungPruefen(name, p);
  return rufe(transport, name, p, geoeffnet);
}

/** Ein- oder Auszahlung buchen (Recht `cashMove`); Antwort mit den Bon-Daten „Kassenbewegung“. */
export async function recordMyCashMovement(transport: InternerTransport, options: RecordMyCashMovementOptions): Promise<CashMovementResult> {
  const name = 'recordMyCashMovement';
  const p = anfrage(name, options);
  kennung(name, p, 'drawerId');
  schluessel(name, p, { pflicht: true });
  cent(name, 'amountCents', p.amountCents);
  // Nur pruefen, wenn gesetzt: Bank/Tresor fragt die Kasse nicht mehr ab.
  if (p.location !== undefined && !(CASH_LOCATIONS as readonly unknown[]).includes(p.location)) {
    throw anfragefehler(name, `location muss ${CASH_LOCATIONS.join(' oder ')} sein`);
  }
  return rufe(transport, name, p, gebucht);
}

/** Oeffnungen der Lade melden (auch nachgesendet); doppelt gemeldete zaehlen einmal. */
export async function logMyDrawerOpenings(transport: InternerTransport, options: LogMyDrawerOpeningsOptions): Promise<DrawerOpeningsResult> {
  const name = 'logMyDrawerOpenings';
  const p = anfrage(name, options);
  kennung(name, p, 'drawerId');
  const eintraege = p.entries;
  if (!Array.isArray(eintraege) || eintraege.length === 0) throw anfragefehler(name, 'entries muss 1–50 Eintraege haben');
  eintraege.forEach((e, i) => {
    const k = e !== null && typeof e === 'object' ? (e as Params).idempotencyKey : undefined;
    if (typeof k !== 'string' || k.trim() === '') throw anfragefehler(name, `entries[${i}].idempotencyKey fehlt`);
  });
  return rufe(transport, name, p, gemeldet);
}

/** Bericht der Schicht: Schicht, Bewegungen und Bon-Daten (X-Bon, bei geschlossener Schicht der Z-Bon). */
export async function getMyShiftReport(transport: InternerTransport, options: GetMyShiftReportOptions): Promise<ShiftReport> {
  const name = 'getMyShiftReport';
  const p = anfrage(name, options);
  kennung(name, p, 'shiftId');
  return rufe(transport, name, p, bericht);
}

/**
 * Schicht schliessen (Recht `shift`). `status: 'recount'` heisst: bitte noch
 * einmal zaehlen und erneut senden (kein Fehler); nach dem zweiten Zaehlen
 * schliesst der Server, bei grosser Abweichung nur mit `comment`.
 */
export async function closeMyShift(transport: InternerTransport, options: CloseMyShiftOptions): Promise<CloseShiftResult> {
  const name = 'closeMyShift';
  const p = anfrage(name, options);
  kennung(name, p, 'shiftId');
  schluessel(name, p, { pflicht: true });
  cent(name, 'countedCents', p.countedCents);
  stueckelungPruefen(name, p);
  if (p.tipPayouts !== undefined && p.tipPayouts !== null) {
    if (!Array.isArray(p.tipPayouts)) throw anfragefehler(name, 'tipPayouts muss eine Liste sein');
    p.tipPayouts.forEach((a, i) => cent(name, `tipPayouts[${i}].cents`, a !== null && typeof a === 'object' ? (a as Params).cents : undefined));
  }
  return rufe(transport, name, p, abschluss);
}

// ---- Helfer der Kasse ---------------------------------------------------------

const ANZAHL_MAX = 100000;
const WERTE: ReadonlySet<string> = new Set(EUR_DENOMINATIONS.map(String));

/**
 * Summe einer Stueckelung in Cent, oder `null`, wenn sie keine ist: ein
 * Schluessel, der kein Euro-Wert ist ([EUR_DENOMINATIONS], genau so
 * geschrieben, `"500"`, nicht `"0500"`), eine Anzahl, die keine ganze Zahl
 * von 0 bis 100 000 ist. Dieselbe Regel wie am Server
 * (`invalid_denominations`). Gemeinsame Faelle mit dem Dart-Zwilling:
 * `fixtures/shift-cases.json`.
 */
export function sumDenominations(denominations: Readonly<Record<string | number, number>>): number | null {
  if (denominations === null || typeof denominations !== 'object' || Array.isArray(denominations)) return null;
  let summe = 0;
  for (const [wert, anzahl] of Object.entries(denominations)) {
    if (!WERTE.has(wert)) return null;
    if (typeof anzahl !== 'number' || !Number.isSafeInteger(anzahl) || anzahl < 0 || anzahl > ANZAHL_MAX) return null;
    summe += Number(wert) * anzahl;
  }
  return summe;
}

/**
 * Ein eingetippter Betrag in Cent, **ohne Gleitkomma**: `'12,5'` → `1250`,
 * `'0'` → `0` (anders als beim Kassieren ist 0 hier gueltig: eine leere Lade,
 * kein Startgeld). Dezimaltrenner Komma oder Punkt mit einer oder zwei
 * Nachkommastellen; `null` fuer leer, Vorzeichen, Tausendertrenner
 * (`'1.000'`, `'1 000'`), drei Nachkommastellen, Euro-Zeichen und alles
 * ueber einer sicheren Ganzzahl. Gemeinsame Faelle mit dem Dart-Zwilling:
 * `fixtures/shift-cases.json`.
 */
export function parseCentsAllowZero(text: string): number | null {
  if (typeof text !== 'string') return null;
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const cents = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

/**
 * Ein frischer Idempotenzschluessel fuer einen neuen Vorgang: `kasse-` und
 * 32 Hex-Zeichen aus dem sicheren Zufall (`crypto.getRandomValues`), dieselbe
 * Form wie beim Zaehlen der Inventur in der Kassen-App. Fuer „Erneut senden“
 * nie einen neuen ziehen, sondern den alten behalten.
 */
export function newIdempotencyKey(): string {
  const zufall = globalThis.crypto;
  if (!zufall || typeof zufall.getRandomValues !== 'function') {
    throw new KasseneckValidationError('newIdempotencyKey', 'kein sicherer Zufall vorhanden (crypto.getRandomValues)', 'request');
  }
  const bytes = zufall.getRandomValues(new Uint8Array(16));
  return `kasse-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Zeilen des Trinkgelds eines Mitarbeiters (siehe [shiftTipLines]). */
export type ShiftTipLineKey = 'shift_receipt.tip_earned' | 'shift_receipt.tip_retained' | 'shift_receipt.tip_paid_out'
  | 'shift_receipt.tip_refunded_by_employee' | 'shift_receipt.tip_open';

export interface ShiftTipLine {
  key: ShiftTipLineKey;
  /** Das Wort aus dem Katalog ([labelText]). */
  text: string;
  cents: number;
}

/**
 * Was vom Trinkgeld eines Mitarbeiters dasteht – auf dem Bon, im Kassenstand
 * und beim Abschluss gleich (Rulings R50/R51): „verdient“ (sofort + über
 * Lohn) immer, „über Lohn“, „schon genommen“, „selbst zurückgegeben“ (R62)
 * und „offen“ nur, wenn nicht 0.
 * Ist alles 0, gibt es keine Zeile, und der Mitarbeiter entfaellt ganz. Ohne
 * `openCents` (Laufstand) zaehlt offen als 0. Gemeinsame Faelle mit dem
 * Dart-Zwilling: `fixtures/shift-cases.json`.
 */
export function shiftTipLines(
  tip: Omit<ShiftTipTotals, 'refundedByEmployeeCents'> & { refundedByEmployeeCents?: number; openCents?: number },
): ShiftTipLine[] {
  const verdient = tip.receivedImmediatelyCents + tip.retainedCents;
  const zeilen: Array<[ShiftTipLineKey, number]> = [
    ['shift_receipt.tip_retained', tip.retainedCents],
    ['shift_receipt.tip_paid_out', tip.paidOutCents],
    ['shift_receipt.tip_refunded_by_employee', tip.refundedByEmployeeCents ?? 0],
    ['shift_receipt.tip_open', tip.openCents ?? 0],
  ];
  const rest = zeilen.filter(([, cents]) => cents !== 0);
  if (verdient === 0 && rest.length === 0) return [];
  return [['shift_receipt.tip_earned', verdient] as [ShiftTipLineKey, number], ...rest].map(([key, cents]) => ({ key, text: labelText(key), cents }));
}
