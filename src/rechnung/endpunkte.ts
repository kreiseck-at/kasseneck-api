/**
 * Die Aufrufe der Rechnungs-API — Kunden, Rechnungen, Gutschriften, Dateien.
 *
 * Jede Funktion nimmt den Transport als ersten Parameter und ist einzeln
 * importierbar; die Fassade [createRechnungApi] bindet ihn nur einmal.
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

import type { InternerBinaerTransport, InternerTransport, Aufruf } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import type { EInvoiceFormat } from './vertrag.js';
import type {
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
  InvoicePage,
  InvoiceSetupGap,
  InvoiceSetupStatus,
  IssueInvoiceRequest,
  IssueResult,
} from './typen.js';

function objekt(wert: unknown): Record<string, unknown> {
  return wert !== null && typeof wert === 'object' && !Array.isArray(wert)
    ? (wert as Record<string, unknown>)
    : {};
}

/** Ein zugesagtes Objektfeld der Antwort — oder ein Antwortfehler. */
function pflichtObjekt<T>(aufruf: Aufruf, daten: unknown, feld: string): T {
  const wert = objekt(daten)[feld];
  if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) {
    throw new KasseneckValidationError(aufruf, `Antwort ohne ${feld}`, 'response');
  }
  return wert as T;
}

/** Eine zugesagte Liste samt Cursor — oder ein Antwortfehler. */
function seite<T>(aufruf: Aufruf, daten: unknown, feld: string): { eintraege: T[]; nextCursor: string | null } {
  const o = objekt(daten);
  if (!Array.isArray(o[feld])) {
    throw new KasseneckValidationError(aufruf, `Antwort ohne ${feld}`, 'response');
  }
  return { eintraege: o[feld] as T[], nextCursor: typeof o['nextCursor'] === 'string' ? o['nextCursor'] : null };
}

const zahl = (wert: unknown): number => (typeof wert === 'number' && Number.isFinite(wert) ? wert : 0);

/** Anfrageobjekt als Nutzlast — flache Kopie, damit der Aufrufer sein Objekt behaelt. */
const nutzlast = (anfrage: object): Record<string, unknown> => ({ ...(anfrage as Record<string, unknown>) });

// ---- Kunden -----------------------------------------------------------------

export async function createCustomer(
  rufen: InternerTransport,
  customer: CustomerInput,
  optionen: { idempotencyKey?: string } = {},
): Promise<Customer> {
  const params: Record<string, unknown> = { customer };
  if (optionen.idempotencyKey) params['idempotencyKey'] = optionen.idempotencyKey;
  const daten = await rufen('createCustomer', params);
  return pflichtObjekt<Customer>('createCustomer', daten, 'customer');
}

export async function getCustomer(
  rufen: InternerTransport,
  kennung: { customerId: string } | { externalId: string },
): Promise<Customer> {
  const daten = await rufen('getCustomer', nutzlast(kennung));
  return pflichtObjekt<Customer>('getCustomer', daten, 'customer');
}

export async function updateCustomer(
  rufen: InternerTransport,
  customerId: string,
  patch: Partial<CustomerInput>,
): Promise<Customer> {
  const daten = await rufen('updateCustomer', { customerId, customer: patch });
  return pflichtObjekt<Customer>('updateCustomer', daten, 'customer');
}

export async function searchCustomers(rufen: InternerTransport, suche: CustomerSearch): Promise<CustomerPage> {
  const daten = await rufen('searchCustomers', nutzlast(suche));
  const { eintraege, nextCursor } = seite<Customer>('searchCustomers', daten, 'customers');
  return { customers: eintraege, nextCursor };
}

// ---- Rechnungen -------------------------------------------------------------

export async function issueInvoice(rufen: InternerTransport, anfrage: IssueInvoiceRequest): Promise<IssueResult> {
  const daten = await rufen('issueInvoice', nutzlast(anfrage));
  return {
    invoice: pflichtObjekt<Invoice>('issueInvoice', daten, 'invoice'),
    replayed: objekt(daten)['replayed'] === true,
  };
}

export async function cancelInvoice(rufen: InternerTransport, anfrage: CancelInvoiceRequest): Promise<CancelResult> {
  const daten = await rufen('cancelInvoice', nutzlast(anfrage));
  return {
    creditNote: pflichtObjekt<Invoice>('cancelInvoice', daten, 'creditNote'),
    original: pflichtObjekt<{ id: string; status: string }>('cancelInvoice', daten, 'original'),
    originalPaidCents: zahl(objekt(daten)['originalPaidCents']),
    replayed: objekt(daten)['replayed'] === true,
  };
}

export async function createCreditNote(rufen: InternerTransport, anfrage: CreditNoteRequest): Promise<CreditNoteResult> {
  const daten = await rufen('createCreditNote', nutzlast(anfrage));
  return {
    creditNote: pflichtObjekt<Invoice>('createCreditNote', daten, 'creditNote'),
    remainingCents: zahl(objekt(daten)['remainingCents']),
    replayed: objekt(daten)['replayed'] === true,
  };
}

export async function getInvoice(
  rufen: InternerTransport,
  kennung: { invoiceId: string } | { number: string },
): Promise<InvoiceDetail> {
  const daten = await rufen('getInvoice', nutzlast(kennung));
  return pflichtObjekt<InvoiceDetail>('getInvoice', daten, 'invoice');
}

export async function listInvoices(rufen: InternerTransport, abfrage: InvoiceListQuery = {}): Promise<InvoicePage> {
  const daten = await rufen('listInvoices', nutzlast(abfrage));
  const { eintraege, nextCursor } = seite<Invoice>('listInvoices', daten, 'invoices');
  return { invoices: eintraege, nextCursor };
}

// ---- Freigabe und Einrichtung ---------------------------------------------------

/**
 * Darf dieses Konto ueber die API ausstellen, und was fehlt noch? Laeuft auch
 * ohne Freigabe und vor der Live-Freischaltung — genau dann braucht man die
 * Antwort. Vor dem ersten `issueInvoice` aufrufen und `missing` anzeigen.
 */
export async function getInvoiceSetupStatus(rufen: InternerTransport): Promise<InvoiceSetupStatus> {
  const daten = objekt(await rufen('getInvoiceSetupStatus', {}));
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

/** Das PDF der Rechnung (bei Gutschriften: der Gutschrift), mit eingebetteter Factur-X-Datei. */
export function getInvoicePdf(rufenBinaer: InternerBinaerTransport, invoiceId: string): Promise<Uint8Array> {
  return rufenBinaer('getInvoicePdf', { invoiceId });
}

/**
 * Die E-Rechnung als XML-Text. Sie kommt im gewohnten Umschlag (`data.xml`)
 * und nicht als rohe Datei: so bleibt ein fachlicher Fehler
 * (`einvoice_incomplete` mit `missing[]`) ein gewoehnlicher Fehler.
 */
export async function getInvoiceXml(
  rufen: InternerTransport,
  invoiceId: string,
  format: EInvoiceFormat = 'ubl',
): Promise<string> {
  const daten = await rufen('getInvoiceXml', { invoiceId, format });
  const xml = objekt(daten)['xml'];
  if (typeof xml !== 'string' || !xml) {
    throw new KasseneckValidationError('getInvoiceXml', 'Antwort ohne xml', 'response');
  }
  return xml;
}
