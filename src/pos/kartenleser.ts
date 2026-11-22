import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckApiError, KasseneckValidationError } from '../client/errors.js';

/**
 * Kartenleser (SumUp Solo ueber die Cloud) an der Kasse: das Konto verbinden,
 * Leser koppeln und der Kasse zuweisen, eine Kartenzahlung starten, nachfragen,
 * abbrechen oder aufloesen, eine Rueckerstattung veranlassen. Dreizehn Aufrufe
 * nur ueber den Kassenweg `/api/v3` (registerInternal); Rechte am Server.
 *
 * **Eine Zahlung ist ein Vorgang mit Kennung (`reference`), kein einzelner
 * Aufruf:** die Kasse erzeugt die Kennung selbst, startet die Zahlung und
 * fragt danach mit derselben Kennung nach, bis `isCardReaderFinal` wahr ist.
 * Ein Netzfehler beim Starten oder Nachfragen heisst nie „nicht bezahlt“.
 *
 * **Ganzzahlen:** Betraege sind ganze Cent. Eine Antwort ohne ganze Zahl oder
 * ohne Kennung endet mit `KasseneckValidationError` (`scope: 'response'`),
 * nie mit einem Ersatzwert.
 */

export const CARD_ACCOUNT_STATES = Object.freeze(['none', 'connected', 'expired'] as const);
export type CardAccountState = (typeof CARD_ACCOUNT_STATES)[number];
export const CARD_ACCOUNT_METHODS = Object.freeze(['oauth', 'api_key'] as const);
export type CardAccountMethod = (typeof CARD_ACCOUNT_METHODS)[number];
export const CARD_READER_STATUSES = Object.freeze(['pairing', 'paired', 'expired'] as const);
export type CardReaderStatus = (typeof CARD_READER_STATUSES)[number];
export const CARD_READER_PAYMENT_STATUSES = Object.freeze(
  ['pending', 'successful', 'failed', 'cancelled', 'declined', 'unclear'] as const,
);
export type CardReaderPaymentStatus = (typeof CARD_READER_PAYMENT_STATUSES)[number];
export const CARD_READER_REASONS = Object.freeze([
  'busy', 'offline', 'declined', 'cancelled', 'expired', 'setup', 'amount_mismatch',
  'no_response', 'not_refundable', 'amount_too_high',
] as const);
export type CardReaderReason = (typeof CARD_READER_REASONS)[number];
export const CARD_READER_DECISIONS = Object.freeze(['receipt', 'discard'] as const);
export type CardReaderDecision = (typeof CARD_READER_DECISIONS)[number];
/** Kennung fuer „Leser am Geraet per Bluetooth“ (`setDeviceCardReader`). */
export const CARD_READER_BLUETOOTH = 'bluetooth';
/** Kleinster und groesster Betrag einer Kartenzahlung in Cent (1 € bis 10.000 €). */
export const CARD_READER_MIN_CENTS = 100;
export const CARD_READER_MAX_CENTS = 1_000_000;

export interface CardAccountConnection {
  state: CardAccountState;
  method: CardAccountMethod | null;
  merchantCode: string | null;
  refundsEnabled: boolean;
  connectAvailable: boolean;
}

export interface CardReader {
  readerId: string;
  name: string;
  serial: string | null;
  model: string | null;
  /** `null`: ein Stand, den dieses Paket nicht kennt. */
  status: CardReaderStatus | null;
  /** Nur mit `withStatus`; sonst `null`. */
  online: boolean | null;
  battery: number | null;
  /** `true`: ein anderes Geraet des Betriebs bedient diesen Leser gerade. */
  busy: boolean;
  busyDevice: string | null;
}

export interface CardReaderSetup {
  connection: CardAccountConnection;
  readers: CardReader[];
  /** Kennung des zugewiesenen Lesers, `'bluetooth'` oder `null` (automatisch). */
  deviceReader: string | null;
  canManage: boolean;
}

export interface CardReaderTransaction {
  id: string | null;
  code: string | null;
  cardType: string | null;
  cardLastDigits: string | null;
  entryMode: string | null;
  authCode: string | null;
  amountCents: number | null;
  timeMs: number | null;
}

export interface SumupCloudProviderData {
  channel: 'cloud';
  transactionCode: string | null;
  transactionId: string | null;
  /** Betrag in Euro, wie ihn `createReceipt` erwartet. */
  amount: number;
  currency: string;
  cardType: string | null;
  cardLastDigits: string | null;
  entryMode: string | null;
  authCode: string | null;
  merchantCode: string | null;
  foreignTransactionId: string;
  readerId: string | null;
}

/** Die Zahlung, wie sie in `createReceipt` (`payments[]`) gehoert: 1:1 uebernehmen. */
export interface CardReaderReceiptPayment {
  provider: 'sumup';
  providerPaymentId: string;
  providerData: SumupCloudProviderData;
}

export interface CardReaderPayment {
  reference: string;
  status: CardReaderPaymentStatus;
  reason: CardReaderReason | null;
  amountCents: number;
  readerId: string | null;
  readerName: string | null;
  transaction: CardReaderTransaction | null;
  /** Nur bei `successful`. */
  receiptPayment: CardReaderReceiptPayment | null;
}

export interface CardReaderRefund {
  reference: string;
  paymentReference: string;
  status: CardReaderPaymentStatus;
  reason: CardReaderReason | null;
  amountCents: number;
}

export interface CardReaderDeviceOptions { deviceId: string }
export interface GetCardReaderSetupOptions extends CardReaderDeviceOptions { withStatus?: boolean }
export interface PairCardReaderOptions extends CardReaderDeviceOptions { pairingCode: string; name: string }
export interface RenameCardReaderOptions extends CardReaderDeviceOptions { readerId: string; name: string }
export interface RemoveCardReaderOptions extends CardReaderDeviceOptions { readerId: string }
export interface SetDeviceCardReaderOptions extends CardReaderDeviceOptions {
  /** Kennung eines Solos, `'bluetooth'` oder `null` (automatisch). */
  readerId: string | null;
}
export interface StartCardReaderPaymentOptions extends CardReaderDeviceOptions {
  reference: string;
  amountCents: number;
  /** Ohne Angabe waehlt der Server; bei mehreren Lesern `card_reader_choice_needed` (siehe `cardReaderChoices`). */
  readerId?: string;
}
export interface CardReaderReferenceOptions extends CardReaderDeviceOptions { reference: string }
export interface ResolveCardReaderPaymentOptions extends CardReaderReferenceOptions { decision: CardReaderDecision }
export interface RefundCardReaderPaymentOptions extends CardReaderReferenceOptions {
  paymentReference: string;
  amountCents: number;
}

type Roh = Record<string, unknown>;
const objekt = (w: unknown): Roh | null => (w !== null && typeof w === 'object' && !Array.isArray(w) ? (w as Roh) : null);
const textOderNull = (w: unknown): string | null => (typeof w === 'string' && w !== '' ? w : null);
const zahlOderNull = (w: unknown): number | null => (typeof w === 'number' && Number.isFinite(w) ? w : null);
const ganzOderNull = (w: unknown): number | null => (typeof w === 'number' && Number.isInteger(w) ? w : null);

const KENNUNG = /^[A-Za-z0-9_-]{8,64}$/;

function antwortfehler(name: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, grund, 'response');
}
function anfragefehler(name: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, grund, 'request');
}
function inKatalog<T extends string>(katalog: readonly T[], w: unknown): T | null {
  return typeof w === 'string' && (katalog as readonly string[]).includes(w) ? (w as T) : null;
}

function geraet(name: string, o: unknown): string {
  const id = objekt(o)?.deviceId;
  if (typeof id !== 'string' || id.trim() === '') throw anfragefehler(name, 'deviceId fehlt');
  return id;
}
function kennung(name: string, feld: string, w: unknown): string {
  if (typeof w !== 'string' || !KENNUNG.test(w)) {
    throw anfragefehler(name, `${feld} ist keine Kennung (8 bis 64 Zeichen aus A-Z, a-z, 0-9, _ und -)`);
  }
  return w;
}
function betrag(name: string, w: unknown): number {
  if (typeof w !== 'number' || !Number.isInteger(w) || w < CARD_READER_MIN_CENTS || w > CARD_READER_MAX_CENTS) {
    throw anfragefehler(name, `amountCents ist keine ganze Zahl von ${CARD_READER_MIN_CENTS} bis ${CARD_READER_MAX_CENTS} Cent`);
  }
  return w;
}
/** Erstattung: jede ganze Zahl ab 1 Cent; die Obergrenze (Rest der Zahlung) prueft der Server. */
function erstattungsBetrag(name: string, w: unknown): number {
  if (typeof w !== 'number' || !Number.isInteger(w) || w < 1 || w > CARD_READER_MAX_CENTS) {
    throw anfragefehler(name, `amountCents ist keine ganze Zahl von 1 bis ${CARD_READER_MAX_CENTS} Cent`);
  }
  return w;
}
function leserKennung(name: string, w: unknown): string {
  if (typeof w !== 'string' || w.trim() === '') throw anfragefehler(name, 'readerId ist leer');
  return w;
}

function leser(e: unknown): CardReader | null {
  const r = objekt(e);
  if (!r || typeof r.readerId !== 'string' || r.readerId === '') return null;
  return {
    readerId: r.readerId,
    name: typeof r.name === 'string' ? r.name : '',
    serial: textOderNull(r.serial),
    model: textOderNull(r.model),
    status: inKatalog(CARD_READER_STATUSES, r.status),
    online: typeof r.online === 'boolean' ? r.online : null,
    battery: zahlOderNull(r.battery),
    busy: r.busy === true,
    busyDevice: textOderNull(r.busyDevice),
  };
}
function leserAntwort(name: string, daten: unknown): CardReader {
  const l = leser(daten);
  if (!l) throw antwortfehler(name, 'Antwort enthaelt keinen Leser (data.readerId fehlt)');
  return l;
}

function verbindung(w: unknown): CardAccountConnection {
  const c = objekt(w) ?? {};
  return {
    // Unbekannt gilt als nicht verbunden: die Kasse bietet dann das Verbinden an, nie eine Zahlung.
    state: inKatalog(CARD_ACCOUNT_STATES, c.state) ?? 'none',
    method: inKatalog(CARD_ACCOUNT_METHODS, c.method),
    merchantCode: textOderNull(c.merchantCode),
    refundsEnabled: c.refundsEnabled === true,
    connectAvailable: c.connectAvailable === true,
  };
}

function buchung(w: unknown): CardReaderTransaction | null {
  const t = objekt(w);
  if (!t) return null;
  return {
    id: textOderNull(t.id),
    code: textOderNull(t.code),
    cardType: textOderNull(t.cardType),
    cardLastDigits: textOderNull(t.cardLastDigits),
    entryMode: textOderNull(t.entryMode),
    authCode: textOderNull(t.authCode),
    amountCents: ganzOderNull(t.amountCents),
    timeMs: ganzOderNull(t.timeMs),
  };
}

function belegZahlung(status: CardReaderPaymentStatus, w: unknown): CardReaderReceiptPayment | null {
  if (status !== 'successful') return null;
  const r = objekt(w);
  const daten = objekt(r?.providerData);
  if (!r || !daten || daten.channel !== 'cloud') return null;
  if (typeof r.providerPaymentId !== 'string' || r.providerPaymentId === '') return null;
  // Wie gesendet durchgereicht: die Kasse schreibt es 1:1 in createReceipt.
  return { provider: 'sumup', providerPaymentId: r.providerPaymentId, providerData: daten as unknown as SumupCloudProviderData };
}

function zahlungsstand(w: unknown): CardReaderPaymentStatus {
  // Weiter fragen, nie scheitern lassen: ein neuer Stand des Servers ist kein Absturz und kein „bezahlt“.
  return inKatalog(CARD_READER_PAYMENT_STATUSES, w) ?? 'unclear';
}

function zahlung(name: string, w: unknown): CardReaderPayment {
  const d = objekt(w);
  if (!d || typeof d.reference !== 'string' || d.reference === '') {
    throw antwortfehler(name, 'Antwort enthaelt keine Kennung (data.reference fehlt)');
  }
  if (typeof d.amountCents !== 'number' || !Number.isInteger(d.amountCents)) {
    throw antwortfehler(name, 'Antwort enthaelt keine ganze Zahl (data.amountCents)');
  }
  const status = zahlungsstand(d.status);
  return {
    reference: d.reference,
    status,
    reason: inKatalog(CARD_READER_REASONS, d.reason),
    amountCents: d.amountCents,
    readerId: textOderNull(d.readerId),
    readerName: textOderNull(d.readerName),
    transaction: buchung(d.transaction),
    receiptPayment: belegZahlung(status, d.receiptPayment),
  };
}

function erstattung(name: string, w: unknown): CardReaderRefund {
  const d = objekt(w);
  if (!d || typeof d.reference !== 'string' || d.reference === '') {
    throw antwortfehler(name, 'Antwort enthaelt keine Kennung (data.reference fehlt)');
  }
  if (typeof d.paymentReference !== 'string' || d.paymentReference === '') {
    throw antwortfehler(name, 'Antwort enthaelt keine Zahlung (data.paymentReference fehlt)');
  }
  if (typeof d.amountCents !== 'number' || !Number.isInteger(d.amountCents)) {
    throw antwortfehler(name, 'Antwort enthaelt keine ganze Zahl (data.amountCents)');
  }
  return {
    reference: d.reference,
    paymentReference: d.paymentReference,
    status: zahlungsstand(d.status),
    reason: inKatalog(CARD_READER_REASONS, d.reason),
    amountCents: d.amountCents,
  };
}

/**
 * Konto, Leser und Zuweisung dieses Geraets. `withStatus` fragt bei SumUp
 * nach Netz und Akku (`online`, `battery`) und dauert laenger.
 * Verwalten (`canManage`) darf nur, wer das Recht fuer Kassen-Einstellungen hat.
 */
export async function getCardReaderSetup(transport: InternerTransport, options: GetCardReaderSetupOptions): Promise<CardReaderSetup> {
  const name = 'getCardReaderSetup';
  const params: Roh = { deviceId: geraet(name, options) };
  if (options.withStatus === true) params.withStatus = true;
  const d = objekt(await transport(name, params));
  if (!d) throw antwortfehler(name, 'Antwort ist leer');
  const roh = Array.isArray(d.readers) ? d.readers : [];
  const liste: CardReader[] = [];
  for (const e of roh) {
    const l = leser(e);
    if (l) liste.push(l);
  }
  return {
    connection: verbindung(d.connection),
    readers: liste,
    deviceReader: textOderNull(d.deviceReader),
    canManage: d.canManage === true,
  };
}

/** Adresse, auf der der Chef sein SumUp-Konto freigibt. Fehler `card_account_connect_unavailable`. */
export async function startCardAccountConnection(transport: InternerTransport, options: CardReaderDeviceOptions): Promise<{ authorizeUrl: string }> {
  const name = 'startCardAccountConnection';
  const d = objekt(await transport(name, { deviceId: geraet(name, options) }));
  if (!d || typeof d.authorizeUrl !== 'string' || d.authorizeUrl === '') {
    throw antwortfehler(name, 'Antwort enthaelt keine Adresse (data.authorizeUrl fehlt)');
  }
  return { authorizeUrl: d.authorizeUrl };
}

/** Trennt das Konto. Solange ein Leser belegt ist: `card_reader_busy`. */
export async function disconnectCardAccount(transport: InternerTransport, options: CardReaderDeviceOptions): Promise<void> {
  const name = 'disconnectCardAccount';
  // Die Antwort (`{ disconnected: true }`) wird nicht gelesen: ein Fehler kommt als Wurf.
  await transport(name, { deviceId: geraet(name, options) });
}

/** Koppelt einen Solo mit dem Code aus dessen Anzeige. Code und Name gehen unveraendert hinaus, der Server prueft. */
export async function pairCardReader(transport: InternerTransport, options: PairCardReaderOptions): Promise<CardReader> {
  const name = 'pairCardReader';
  const params = { deviceId: geraet(name, options), pairingCode: options.pairingCode, name: options.name };
  return leserAntwort(name, await transport(name, params));
}

export async function renameCardReader(transport: InternerTransport, options: RenameCardReaderOptions): Promise<CardReader> {
  const name = 'renameCardReader';
  const params = { deviceId: geraet(name, options), readerId: leserKennung(name, options.readerId), name: options.name };
  return leserAntwort(name, await transport(name, params));
}

export async function removeCardReader(transport: InternerTransport, options: RemoveCardReaderOptions): Promise<void> {
  const name = 'removeCardReader';
  const params = { deviceId: geraet(name, options), readerId: leserKennung(name, options.readerId) };
  // Die Antwort (`{ readerId, removed: true }`) wird nicht gelesen.
  await transport(name, params);
}

/**
 * Weist diesem Geraet einen Leser zu: Kennung, `'bluetooth'` oder `null`
 * (automatisch). `readerId` geht immer hinaus, auch als ausdrueckliches
 * `null`: ein fehlendes Feld waere am Server ein Eingabefehler.
 * Antwort ist der zugewiesene Stand (`deviceReader`).
 */
export async function setDeviceCardReader(transport: InternerTransport, options: SetDeviceCardReaderOptions): Promise<string | null> {
  const name = 'setDeviceCardReader';
  const deviceId = geraet(name, options);
  const readerId = options.readerId === null ? null : leserKennung(name, options.readerId);
  const d = objekt(await transport(name, { deviceId, readerId }));
  if (!d) throw antwortfehler(name, 'Antwort ist leer');
  return textOderNull(d.deviceReader);
}

/**
 * Startet eine Kartenzahlung am Leser. `reference` ist die Kennung der Kasse
 * (8 bis 64 Zeichen); wiederholt sie sich fuer dieselbe Zahlung, antwortet der
 * Server mit dem Stand, bei anderem Betrag mit `card_payment_reference_conflict`.
 * Danach mit `getCardReaderPayment` nachfragen.
 */
export async function startCardReaderPayment(transport: InternerTransport, options: StartCardReaderPaymentOptions): Promise<CardReaderPayment> {
  const name = 'startCardReaderPayment';
  const params: Roh = {
    deviceId: geraet(name, options),
    reference: kennung(name, 'reference', options.reference),
    amountCents: betrag(name, options.amountCents),
  };
  if (options.readerId !== undefined) params.readerId = leserKennung(name, options.readerId);
  return zahlung(name, await transport(name, params));
}

export async function getCardReaderPayment(transport: InternerTransport, options: CardReaderReferenceOptions): Promise<CardReaderPayment> {
  const name = 'getCardReaderPayment';
  const params = { deviceId: geraet(name, options), reference: kennung(name, 'reference', options.reference) };
  return zahlung(name, await transport(name, params));
}

export async function cancelCardReaderPayment(transport: InternerTransport, options: CardReaderReferenceOptions): Promise<CardReaderPayment> {
  const name = 'cancelCardReaderPayment';
  const params = { deviceId: geraet(name, options), reference: kennung(name, 'reference', options.reference) };
  return zahlung(name, await transport(name, params));
}

/** Entscheidung bei unklarer Zahlung: `receipt` (gilt als bezahlt) oder `discard` (verwerfen). */
export async function resolveCardReaderPayment(transport: InternerTransport, options: ResolveCardReaderPaymentOptions): Promise<CardReaderPayment> {
  const name = 'resolveCardReaderPayment';
  const deviceId = geraet(name, options);
  const reference = kennung(name, 'reference', options.reference);
  if (!(CARD_READER_DECISIONS as readonly unknown[]).includes(options.decision)) {
    throw anfragefehler(name, 'decision ist weder receipt noch discard');
  }
  return zahlung(name, await transport(name, { deviceId, reference, decision: options.decision }));
}

/** Erstattet einen Teil oder die ganze Kartenzahlung zurueck; `reference` ist die Kennung der Erstattung. */
export async function refundCardReaderPayment(transport: InternerTransport, options: RefundCardReaderPaymentOptions): Promise<CardReaderRefund> {
  const name = 'refundCardReaderPayment';
  const params = {
    deviceId: geraet(name, options),
    reference: kennung(name, 'reference', options.reference),
    paymentReference: kennung(name, 'paymentReference', options.paymentReference),
    amountCents: erstattungsBetrag(name, options.amountCents),
  };
  return erstattung(name, await transport(name, params));
}

export async function getCardReaderRefund(transport: InternerTransport, options: CardReaderReferenceOptions): Promise<CardReaderRefund> {
  const name = 'getCardReaderRefund';
  const params = { deviceId: geraet(name, options), reference: kennung(name, 'reference', options.reference) };
  return erstattung(name, await transport(name, params));
}

/** Endstand: es kommt nichts mehr nach. `pending` und `unclear` gelten nicht als Ende. */
export function isCardReaderFinal(status: CardReaderPaymentStatus): boolean {
  return status === 'successful' || status === 'failed' || status === 'cancelled' || status === 'declined';
}

/** Die Leser zur Auswahl bei `card_reader_choice_needed` (`details.readers`); sonst `[]`. */
export function cardReaderChoices(error: unknown): CardReader[] {
  if (!(error instanceof KasseneckApiError) || error.code !== 'card_reader_choice_needed') return [];
  const roh = error.details['readers'];
  if (!Array.isArray(roh)) return [];
  const raus: CardReader[] = [];
  for (const e of roh) {
    const l = leser(e);
    if (l) raus.push(l);
  }
  return raus;
}

/** Name des Geraets, das den Leser belegt (`details.busyDevice` bei `card_reader_busy`); sonst `null`. */
export function cardReaderBusyDevice(error: unknown): string | null {
  if (!(error instanceof KasseneckApiError) || error.code !== 'card_reader_busy') return null;
  return textOderNull(error.details['busyDevice']);
}

export interface NewCardReaderReferenceOptions {
  /** Zeitpunkt in Millisekunden; Vorgabe ist die Uhr des Geraets (fuer Tests). */
  nowMs?: number;
  /** Zufallsteil; Vorgabe sind sechs Zeichen `[a-z0-9]` aus `crypto.getRandomValues` (fuer Tests). */
  random?: string;
}

const KENNUNG_MAX = 64;

/**
 * Neue Kennung einer Kartenzahlung: `kk-<kasse>-<epochMs>-<zufall>`, hoechstens
 * 64 Zeichen. Von der Kassen-ID bleiben nur `[A-Za-z0-9_-]` (leer: `x`); wird
 * es zu lang, kuerzt die Kassen-ID, nie Zeit oder Zufall.
 */
export function newCardReaderReference(cashregisterId: string, o: NewCardReaderReferenceOptions = {}): string {
  const jetzt = o.nowMs ?? Date.now();
  let zufall = o.random;
  if (zufall === undefined) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
    const zeichen = 'abcdefghijklmnopqrstuvwxyz0123456789';
    zufall = Array.from(bytes, (b) => zeichen[b % zeichen.length]).join('');
  }
  const ende = `-${jetzt}-${zufall}`;
  const platz = Math.max(1, KENNUNG_MAX - 'kk-'.length - ende.length);
  const kasse = cashregisterId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, platz) || 'x';
  return `kk-${kasse}${ende}`;
}

export type CardReaderChoice =
  | { kind: 'reader'; reader: CardReader }
  | { kind: 'choose'; readers: CardReader[] }
  | { kind: 'bluetooth' }
  | { kind: 'none'; why: 'not_connected' | 'expired' | 'no_reader' };

/**
 * Welchen Leser die Kasse nimmt (gleiche Regel in Browser-Kasse und App).
 * Es zaehlen nur gekoppelte Solos (`status === 'paired'`). Reihenfolge: Konto
 * nicht verbunden oder abgelaufen, Bluetooth am Geraet, der zugewiesene
 * gekoppelte Solo, genau ein gekoppelter, mehrere zur Auswahl (besetzte
 * bleiben drin, die Kasse graut sie aus), sonst kein Leser.
 */
export function cardReaderFor(input: CardReaderSetup): CardReaderChoice {
  const stand = input.connection.state;
  if (stand === 'none') return { kind: 'none', why: 'not_connected' };
  if (stand === 'expired') return { kind: 'none', why: 'expired' };
  if (input.deviceReader === CARD_READER_BLUETOOTH) return { kind: 'bluetooth' };
  const gekoppelt = input.readers.filter((l) => l.status === 'paired');
  const zugewiesen = gekoppelt.find((l) => l.readerId === input.deviceReader);
  if (zugewiesen) return { kind: 'reader', reader: zugewiesen };
  if (gekoppelt.length === 1) return { kind: 'reader', reader: gekoppelt[0]! };
  if (gekoppelt.length > 1) return { kind: 'choose', readers: gekoppelt };
  return { kind: 'none', why: 'no_reader' };
}
