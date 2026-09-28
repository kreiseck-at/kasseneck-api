import type { InternerTransport } from '../client/aufrufe.js';
import type { ReceiptLayout } from '../receipt/layout.js';
import { rasterZeilenBase64 } from '../printing/index.js';
import type { DruckLogo } from '../receipt/layout-escpos.js';

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
export type PrintJobStatus = typeof PRINT_JOB_STATUSES[number];

/** Wer den Job anlegt (Katalog `DRUCK_QUELLE`): die Kasse oder das Panel. */
export const PRINT_JOB_SOURCES = ['pos', 'panel'] as const;
export type PrintJobSource = typeof PRINT_JOB_SOURCES[number];

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
 * Stand eines Jobs aus der Antwort. Ein Wert ausserhalb des Katalogs laesst
 * das Backend unter `/v3` gar nicht hinaus; kommt trotzdem keiner, gilt
 * `pending` (der Job wird weiter abgefragt, nie als gedruckt gewertet).
 */
function status(v: unknown): PrintJobStatus {
  return typeof v === 'string' && STATUS.has(v) ? (v as PrintJobStatus) : 'pending';
}

export async function listMyPrinters(rufen: InternerTransport): Promise<NetworkPrinter[]> {
  const daten = await rufen<{ printers?: unknown[] }>('listMyPrinters', {});
  return (Array.isArray(daten?.printers) ? daten.printers : []).map((r) => {
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
  /** Firmenlogo als fertiges Rasterbild (`logoRaster`); der Server dekodiert keine Bilder. */
  logo?: DruckLogo | null;
  /** Das Kasseneck-Logo am Ende (Konto-Flag `kreiseck_logo`). */
  brand?: boolean;
}

export async function createPrintJob(rufen: InternerTransport, o: CreatePrintJobOptions): Promise<PrintJob> {
  const params: Record<string, unknown> = { printerId: o.printerId, layout: o.layout };
  if (o.receiptId) params.receiptId = o.receiptId;
  if (o.title) params.title = o.title;
  if (o.source) params.source = o.source;
  if (o.logo) {
    params.logo = {
      scale: o.logo.stufe, pxWidth: o.logo.pxBreite, pxHeight: o.logo.pxHoehe,
      width: o.logo.raster.breite, height: o.logo.raster.hoehe, rows: rasterZeilenBase64(o.logo.raster),
    };
  }
  if (o.brand === true) params.brand = true;
  const daten = await rufen<{ jobId?: unknown; status?: unknown }>('createPrintJob', params);
  return { jobId: String(daten?.jobId ?? ''), status: status(daten?.status), result: null };
}

export async function getPrintJob(rufen: InternerTransport, o: { printerId: string; jobId: string }): Promise<PrintJob> {
  const d = await rufen<Record<string, unknown>>('getPrintJob', { printerId: o.printerId, jobId: o.jobId });
  const e = d?.result && typeof d.result === 'object' ? (d.result as Record<string, unknown>) : null;
  return {
    jobId: String(d?.jobId ?? o.jobId), status: status(d?.status),
    createdAt: zahl(d?.createdAt), sentAt: zahl(d?.sentAt),
    result: e ? { success: e.success === true, code: text(e.code), status: text(e.status), at: zahl(e.at) ?? undefined } : null,
  };
}
