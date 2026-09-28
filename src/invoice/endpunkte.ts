/**
 * Die Aufrufe der Rechnungs-API — Kunden, Rechnungen, Gutschriften, Dateien.
 *
 * Jede Funktion nimmt den Transport als ersten Parameter und ist einzeln
 * importierbar; die Fassade [createInvoiceApi] bindet ihn nur einmal.
 *
 * **Geprueft wird hier nichts Fachliches.** Die Anfrage geht unveraendert an
 * das Backend, das sie gegen denselben Vertrag prueft (`vertrag.ts`) und einen
 * Formfehler als `validation` mit `errors[]` zurueckgibt — zwei Pruefungen
 * hiessen zwei Wahrheiten, von denen eine veraltet.
 *
 * **Nicht automatisch wiederholen.** Wer nach einem Zeitlimit erneut
 * ausstellt, tut das mit **demselben** `idempotencyKey`: dann kommt die schon
 * ausgestellte Rechnung zurueck (`replayed: true`) statt einer zweiten.
 *
 * Nach dem Senden wird nichts hart gecastet: fehlt ein zugesagtes Feld, wirft
 * der Aufruf `KasseneckValidationError` mit `scope:'response'`.
 */

import type { InternerBinaerTransport, InternerTransport, ApiCall } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import { EINVOICE_FORMATS, type EInvoiceFormat, type InvoiceLanguage } from './vertrag.js';
import type {
  Brand,
  CancelInvoiceRequest,
  CancelResult,
  CreditNoteRequest,
  CreditNoteResult,
  Customer,
  CustomerInput,
  CustomerPage,
  CustomerSearch,
  Invoice,
  InvoiceDetail,
  InvoiceListQuery,
  InvoiceNotice,
  InvoicePage,
  InvoicePayment,
  InvoicePreview,
  InvoiceSetupGap,
  InvoiceSetupStatus,
  InvoiceXml,
  IssueInvoiceRequest,
  IssueResult,
  PreviewResult,
  RecordPaymentRequest,
  RecordPaymentResult,
} from './typen.js';

function objekt(wert: unknown): Record<string, unknown> {
  return wert !== null && typeof wert === 'object' && !Array.isArray(wert)
    ? (wert as Record<string, unknown>)
    : {};
}

/** Ein zugesagtes Objektfeld der Antwort — oder ein Antwortfehler. */
function pflichtObjekt<T>(aufruf: ApiCall, daten: unknown, feld: string): T {
  const wert = objekt(daten)[feld];
  if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) {
    throw new KasseneckValidationError(aufruf, `Antwort ohne ${feld}`, 'response');
  }
  return wert as T;
}

/** Eine zugesagte Liste samt Cursor — oder ein Antwortfehler. */
function seite<T>(aufruf: ApiCall, daten: unknown, feld: string): { eintraege: T[]; nextCursor: string | null } {
  const o = objekt(daten);
  if (!Array.isArray(o[feld])) {
    throw new KasseneckValidationError(aufruf, `Antwort ohne ${feld}`, 'response');
  }
  return { eintraege: o[feld] as T[], nextCursor: typeof o['nextCursor'] === 'string' ? o['nextCursor'] : null };
}

const zahl = (wert: unknown): number => (typeof wert === 'number' && Number.isFinite(wert) ? wert : 0);

/**
 * Die Hinweise einer Antwort (`data.notice`) — immer eine Liste, `undefined`
 * ohne Hinweis. Ein einzelnes Objekt (Server vor der Vereinheitlichung) wird
 * zur Liste.
 *
 * Ein unbrauchbarer Eintrag wird uebergangen, nicht geworfen: der Aufruf hat
 * schon gewirkt (die Rechnung ist ausgestellt, die Zahlung gebucht). Ein
 * Fehler an dieser Stelle liesse den Aufrufer glauben, es sei nichts
 * entstanden — und eine Wiederholung liefert die Hinweise nicht noch einmal.
 */
function hinweise(daten: unknown): InvoiceNotice[] | undefined {
  const roh = objekt(daten)['notice'];
  if (roh === undefined || roh === null) return undefined;
  const liste = (Array.isArray(roh) ? roh : [roh]).filter(
    (h) => typeof objekt(h)['code'] === 'string' && typeof objekt(h)['message'] === 'string',
  );
  return liste.length ? (liste as InvoiceNotice[]) : undefined;
}

/**
 * Eine Kennung muss ein Objekt sein (`{ invoiceId }`, `{ customerId }` …). Ein
 * blosser Text wuerde sonst Zeichen fuer Zeichen zu Feldern `0`, `1`, …
 * zerlegt, und der Server koennte nur „Bitte Eingaben pruefen" antworten.
 */
function kennungVerlangen(aufruf: ApiCall, kennung: unknown, felder: string): void {
  if (kennung === null || typeof kennung !== 'object' || Array.isArray(kennung)) {
    throw new KasseneckValidationError(aufruf, `Kennung als Objekt erwartet: ${felder}`, 'request');
  }
}

/** Anfrageobjekt als Nutzlast — flache Kopie, damit der Aufrufer sein Objekt behaelt. */
const nutzlast = (anfrage: object): Record<string, unknown> => ({ ...(anfrage as Record<string, unknown>) });

// ---- Kunden -----------------------------------------------------------------

export async function createCustomer(
  transport: InternerTransport,
  customer: CustomerInput,
  options: { idempotencyKey?: string } = {},
): Promise<Customer> {
  const params: Record<string, unknown> = { customer };
  if (options.idempotencyKey) params['idempotencyKey'] = options.idempotencyKey;
  const daten = await transport('createCustomer', params);
  return pflichtObjekt<Customer>('createCustomer', daten, 'customer');
}

export async function getCustomer(
  transport: InternerTransport,
  ref: { customerId: string } | { externalId: string },
): Promise<Customer> {
  kennungVerlangen('getCustomer', ref, '{ customerId } oder { externalId }');
  const daten = await transport('getCustomer', nutzlast(ref));
  return pflichtObjekt<Customer>('getCustomer', daten, 'customer');
}

export async function updateCustomer(
  transport: InternerTransport,
  customerId: string,
  patch: Partial<CustomerInput>,
): Promise<Customer> {
  const daten = await transport('updateCustomer', { customerId, customer: patch });
  return pflichtObjekt<Customer>('updateCustomer', daten, 'customer');
}

export async function searchCustomers(transport: InternerTransport, search: CustomerSearch): Promise<CustomerPage> {
  const daten = await transport('searchCustomers', nutzlast(search));
  const { eintraege, nextCursor } = seite<Customer>('searchCustomers', daten, 'customers');
  return { customers: eintraege, nextCursor };
}

// ---- Rechnungen -------------------------------------------------------------

export async function issueInvoice(transport: InternerTransport, request: IssueInvoiceRequest): Promise<IssueResult> {
  const daten = await transport('issueInvoice', nutzlast(request));
  const ergebnis: IssueResult = {
    invoice: pflichtObjekt<Invoice>('issueInvoice', daten, 'invoice'),
    replayed: objekt(daten)['replayed'] === true,
  };
  const notice = hinweise(daten);
  if (notice) ergebnis.notice = notice;
  return ergebnis;
}

/**
 * Probelauf von `issueInvoice`: dieselbe Anfrage wird geprueft und gerechnet
 * wie beim Ausstellen, aber nichts festgeschrieben. Die Antwort nennt Summen,
 * Steuerfall, Sprache, Marke und die Hinweise — oder scheitert mit demselben
 * Fehlercode, mit dem das Ausstellen scheitern wuerde.
 *
 * Der `idempotencyKey` wird nicht verbraucht: dieselbe Anfrage laesst sich
 * danach unveraendert ausstellen. Verbindlich ist das Ausstellen — zwischen
 * Probelauf und Ausstellen kann sich der Kunde oder das Konto aendern.
 */
export async function previewInvoice(transport: InternerTransport, request: IssueInvoiceRequest): Promise<PreviewResult> {
  const daten = await transport('issueInvoice', { ...nutzlast(request), dryRun: true });
  const ergebnis: PreviewResult = { preview: pflichtObjekt<InvoicePreview>('issueInvoice', daten, 'preview') };
  const notice = hinweise(daten);
  if (notice) ergebnis.notice = notice;
  return ergebnis;
}

export async function cancelInvoice(transport: InternerTransport, request: CancelInvoiceRequest): Promise<CancelResult> {
  const daten = await transport('cancelInvoice', nutzlast(request));
  return {
    creditNote: pflichtObjekt<Invoice>('cancelInvoice', daten, 'creditNote'),
    original: pflichtObjekt<{ id: string; status: string }>('cancelInvoice', daten, 'original'),
    originalPaidCents: zahl(objekt(daten)['originalPaidCents']),
    replayed: objekt(daten)['replayed'] === true,
  };
}

export async function createCreditNote(transport: InternerTransport, request: CreditNoteRequest): Promise<CreditNoteResult> {
  const daten = await transport('createCreditNote', nutzlast(request));
  return {
    creditNote: pflichtObjekt<Invoice>('createCreditNote', daten, 'creditNote'),
    remainingCents: zahl(objekt(daten)['remainingCents']),
    replayed: objekt(daten)['replayed'] === true,
  };
}

export async function getInvoice(
  transport: InternerTransport,
  ref: { invoiceId: string } | { number: string },
): Promise<InvoiceDetail> {
  kennungVerlangen('getInvoice', ref, '{ invoiceId } oder { number }');
  const daten = await transport('getInvoice', nutzlast(ref));
  return pflichtObjekt<InvoiceDetail>('getInvoice', daten, 'invoice');
}

export async function listInvoices(transport: InternerTransport, query: InvoiceListQuery = {}): Promise<InvoicePage> {
  const daten = await transport('listInvoices', nutzlast(query));
  const { eintraege, nextCursor } = seite<Invoice>('listInvoices', daten, 'invoices');
  return { invoices: eintraege, nextCursor };
}

// ---- Freigabe und Einrichtung ---------------------------------------------------

/**
 * Darf dieses Konto ueber die API ausstellen, und was fehlt noch? Laeuft auch
 * ohne Freigabe und vor der Live-Freischaltung — genau dann braucht man die
 * Antwort. Vor dem ersten `issueInvoice` aufrufen und `missing` anzeigen.
 */
export async function getInvoiceSetupStatus(transport: InternerTransport): Promise<InvoiceSetupStatus> {
  const daten = objekt(await transport('getInvoiceSetupStatus', {}));
  if (typeof daten['ready'] !== 'boolean' || !Array.isArray(daten['missing'])) {
    throw new KasseneckValidationError('getInvoiceSetupStatus', 'Antwort ohne ready/missing', 'response');
  }
  return {
    ready: daten['ready'],
    environment: daten['environment'] === 'test' ? 'test' : 'live',
    missing: daten['missing'] as InvoiceSetupGap[],
  };
}

// ---- Dateien ----------------------------------------------------------------

/**
 * Das PDF der Rechnung (bei Gutschriften: der Gutschrift), mit eingebetteter
 * Factur-X-Datei. Mit `language` in der anderen Sprache als der Rechnung kommt
 * eine **Uebersetzungskopie**: dieselbe Nummer, auf jeder Seite als Uebersetzung
 * gekennzeichnet, ohne eingebettete E-Rechnung — keine eigene Rechnung.
 */
export function getInvoicePdf(
  binaryTransport: InternerBinaerTransport,
  invoiceId: string,
  options: { language?: InvoiceLanguage } = {},
): Promise<Uint8Array> {
  const params: Record<string, unknown> = { invoiceId };
  if (options.language) params['language'] = options.language;
  return binaryTransport('getInvoicePdf', params);
}

/**
 * Eine Zahlung nachtragen, die nach dem Ausstellen eingetroffen ist
 * (Ueberweisung, Teilzahlung). Der `idempotencyKey` ist Pflicht: ohne ihn
 * bucht ein Wiederholungslauf nach einem Zeitlimit eine zweite Zahlung.
 *
 * Bei `method: 'cash'` wird die Zahlung gebucht und die Antwort traegt
 * zusaetzlich `notice` — eine Barzahlung ist ein Barumsatz und braucht einen
 * Beleg (§ 132a BAO), den dieser Vermerk nicht ersetzt.
 */
export async function recordInvoicePayment(
  transport: InternerTransport,
  request: RecordPaymentRequest,
): Promise<RecordPaymentResult> {
  const daten = await transport('recordInvoicePayment', nutzlast(request));
  const roh = objekt(daten);
  const ergebnis: RecordPaymentResult = {
    invoice: pflichtObjekt<Invoice>('recordInvoicePayment', daten, 'invoice'),
    payment: pflichtObjekt<InvoicePayment>('recordInvoicePayment', daten, 'payment'),
    replayed: roh['replayed'] === true,
  };
  const notice = hinweise(daten);
  if (notice) ergebnis.notice = notice;
  return ergebnis;
}

/** Die Marken des Kontos — die Kennung geht als `brandId` in `issueInvoice`. */
export async function listBrands(transport: InternerTransport): Promise<Brand[]> {
  const brands = objekt(await transport('listBrands', {}))['brands'];
  if (!Array.isArray(brands)) throw new KasseneckValidationError('listBrands', 'Antwort ohne brands', 'response');
  return brands as Brand[];
}

/**
 * Die E-Rechnung samt Format und Dateiname, genau wie der Server sie schickt.
 * Sie kommt im gewohnten Umschlag (`data.xml`) und nicht als rohe Datei: so
 * bleibt ein fachlicher Fehler (`einvoice_incomplete` mit `missing[]`) ein
 * gewoehnlicher Fehler. Den Dateinamen nicht selbst bauen, sondern
 * `filename` nehmen (`invoice-<Nummer>.xml`).
 */
export async function getInvoiceXml(
  transport: InternerTransport,
  invoiceId: string,
  format: EInvoiceFormat = 'ubl',
): Promise<InvoiceXml> {
  const daten = objekt(await transport('getInvoiceXml', { invoiceId, format }));
  const { xml, filename } = daten;
  const gesendet = daten['format'];
  if (typeof xml !== 'string' || !xml) {
    throw new KasseneckValidationError('getInvoiceXml', 'Antwort ohne xml', 'response');
  }
  if (typeof gesendet !== 'string' || !(EINVOICE_FORMATS as readonly string[]).includes(gesendet)) {
    throw new KasseneckValidationError('getInvoiceXml', 'Antwort ohne gueltiges format', 'response');
  }
  if (typeof filename !== 'string' || !filename) {
    throw new KasseneckValidationError('getInvoiceXml', 'Antwort ohne filename', 'response');
  }
  return { xml, format: gesendet as EInvoiceFormat, filename };
}
