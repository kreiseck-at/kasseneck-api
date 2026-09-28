import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import type { ReceiptLayout } from '../receipt/layout.js';
import { rasterRowsBase64 } from '../printing/index.js';
import type { PrintLogo } from '../receipt/layout-escpos.js';

/**
 * Netzwerk-Bondrucker ueber Epson "Server Direct Print": das Backend fuehrt
 * je Konto Drucker mit einer geheimen Abhol-URL; die Kasse legt Druckjobs
 * aus einem Zeilenmodell an, der Drucker holt sie selbst ab (alle paar
 * Sekunden) und meldet das Ergebnis. So druckt jeder Browser -- ohne lokale
 * Software. Das ePOS-XML baut das Backend aus dem Zeichenraster (ein Setzweg).
 */
export interface NetworkPrinter {
  id: string;
  name: string;
  /** Art des Druckers; heute nur `epson-sdp`. */
  kind: string;
  paperSize: 'mm58' | 'mm80';
  active: boolean;
  createdAt: number | null;
  /** Letzter Abruf des Druckers (ms); null = noch nie verbunden. */
  lastSeenAt: number | null;
  lastResult: { success: boolean; code: string | null; at: number } | null;
  /** Kennung, die der Drucker selbst schickt (Feld ID im Drucker-Menue). */
  printerSerial: string | null;
  /** Abhol-URL fuer das Drucker-Menue, nur fuer den Chef bzw. das Konto. */
  sdpUrl?: string;
}

/** Stand eines Druckjobs (Katalog `DRUCKJOB`). */
export const PRINT_JOB_STATUSES = ['pending', 'sent', 'printed', 'failed', 'expired'] as const;
/**
 * Stand eines Druckjobs; `'unknown'` = der Server nannte einen Stand, den dieses
 * Paket nicht kennt (oder keinen). Er gilt als Ende der Abfrage (siehe
 * [isPrintJobFinished]): nie als gedruckt, aber auch kein Abfragen bis zum
 * Zeitlimit.
 */
export type PrintJobStatus = typeof PRINT_JOB_STATUSES[number] | 'unknown';

/** Endet die Abfrage bei diesem Stand? `printed`, `failed`, `expired` und `unknown`. */
export function isPrintJobFinished(status: PrintJobStatus): boolean {
  return status === 'printed' || status === 'failed' || status === 'expired' || status === 'unknown';
}

/**
 * Bekannte Werte fuer `source` (Katalog `DRUCK_QUELLE`): die Kasse oder das
 * Panel. Der Server nimmt Freitext bis 40 Zeichen an und uebersetzt nur diese
 * beiden.
 */
export const PRINT_JOB_SOURCES = ['pos', 'panel'] as const;
export type PrintJobSource = typeof PRINT_JOB_SOURCES[number] | (string & {});

export interface PrintJob {
  jobId: string;
  status: PrintJobStatus;
  createdAt?: number | null;
  sentAt?: number | null;
  result: { success: boolean; code: string | null; status?: string | null; at?: number } | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const zahl = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const STATUS: ReadonlySet<string> = new Set(PRINT_JOB_STATUSES);

/**
 * Stand eines Jobs aus der Antwort. Ein Wert ausserhalb des Katalogs (ein
 * kuenftiger Endstand wie `cancelled`) oder gar keiner wird `'unknown'`:
 * sichtbar, nie als gedruckt gewertet, und die Abfrage endet.
 */
function status(v: unknown): PrintJobStatus {
  return typeof v === 'string' && STATUS.has(v) ? (v as PrintJobStatus) : 'unknown';
}

/**
 * Die Kennung eines Jobs aus der Antwort. Ohne sie kann niemand den Job
 * abfragen; ein leerer Text waere ein angeblich angelegter Job, und der
 * Kassier druckte ein zweites Mal.
 */
function jobKennung(name: 'createPrintJob' | 'getPrintJob', d: Record<string, unknown> | null | undefined): string {
  const id = d?.jobId;
  if (typeof id !== 'string' || id === '') {
    throw new KasseneckValidationError(name, 'Antwort enthaelt keine Kennung (data.jobId fehlt)', 'response');
  }
  return id;
}

export async function listMyPrinters(transport: InternerTransport): Promise<NetworkPrinter[]> {
  const daten = await transport<{ printers?: unknown[] }>('listMyPrinters', {});
  const liste = daten?.printers;
  if (!Array.isArray(liste)) {
    // Keine Liste ist etwas anderes als eine leere Liste: „noch kein Drucker“
    // darf nicht aussehen wie „Antwort kaputt“.
    throw new KasseneckValidationError('listMyPrinters', 'Antwort enthaelt keine Liste (data.printers fehlt)', 'response');
  }
  return liste.map((r) => {
    const d = (r ?? {}) as Record<string, unknown>;
    const e = d.lastResult && typeof d.lastResult === 'object' ? (d.lastResult as Record<string, unknown>) : null;
    return {
      id: String(d.id ?? ''), name: String(d.name ?? ''), kind: String(d.kind ?? 'epson-sdp'), paperSize: d.paperSize === 'mm58' ? 'mm58' : 'mm80',
      active: d.active !== false, createdAt: zahl(d.createdAt), lastSeenAt: zahl(d.lastSeenAt),
      lastResult: e ? { success: e.success === true, code: text(e.code), at: zahl(e.at) ?? 0 } : null,
      printerSerial: text(d.printerSerial),
      ...(text(d.sdpUrl) ? { sdpUrl: String(d.sdpUrl) } : {}),
    };
  });
}

export interface CreatePrintJobOptions {
  printerId: string;
  layout: ReceiptLayout;
  receiptId?: string;
  title?: string;
  source?: PrintJobSource;
  /** Firmenlogo als fertiges Rasterbild (`rasterizeLogo`); der Server dekodiert keine Bilder. */
  logo?: PrintLogo | null;
  /**
   * Das Kasseneck-Logo am Ende (Konto-Flag `kreiseck_logo`). Heisst wie bei
   * den Druckwegen (`escPosLayoutBytes`, `eposPrintXml`, `receiptSheet`), damit
   * dieselben Optionen ueberall wirken; am Draht heisst der Wert `brand`.
   */
  brandMark?: boolean;
}

export async function createPrintJob(transport: InternerTransport, o: CreatePrintJobOptions): Promise<PrintJob> {
  const params: Record<string, unknown> = { printerId: o.printerId, layout: o.layout };
  if (o.receiptId) params.receiptId = o.receiptId;
  if (o.title) params.title = o.title;
  if (o.source) params.source = o.source;
  if (o.logo) {
    params.logo = {
      scale: o.logo.size, pxWidth: o.logo.pixelWidth, pxHeight: o.logo.pixelHeight,
      width: o.logo.raster.width, height: o.logo.raster.height, rows: rasterRowsBase64(o.logo.raster),
    };
  }
  if (o.brandMark === true) params.brand = true;
  const daten = await transport<{ jobId?: unknown; status?: unknown }>('createPrintJob', params);
  return { jobId: jobKennung('createPrintJob', daten), status: status(daten?.status), result: null };
}

/**
 * Stand eines Druckjobs abfragen. Der Aufrufer fragt, bis [isPrintJobFinished]
 * wahr ist, und begrenzt die Abfrage trotzdem selbst (Anzahl oder Zeit): ein
 * Drucker, der nie abholt, bleibt `pending`.
 */
export async function getPrintJob(transport: InternerTransport, o: { printerId: string; jobId: string }): Promise<PrintJob> {
  const d = await transport<Record<string, unknown>>('getPrintJob', { printerId: o.printerId, jobId: o.jobId });
  const e = d?.result && typeof d.result === 'object' ? (d.result as Record<string, unknown>) : null;
  return {
    jobId: jobKennung('getPrintJob', d), status: status(d?.status),
    createdAt: zahl(d?.createdAt), sentAt: zahl(d?.sentAt),
    result: e ? { success: e.success === true, code: text(e.code), status: text(e.status), at: zahl(e.at) ?? undefined } : null,
  };
}
