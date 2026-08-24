import type { InternerTransport } from '../client/aufrufe.js';
import type { ReceiptLayout } from '../receipt/layout.js';

/**
 * Netzwerk-Bondrucker ueber Epson "Server Direct Print": das Backend fuehrt
 * je Konto Drucker mit einer geheimen Abhol-URL; die Kasse legt Druckjobs
 * aus einem Zeilenmodell an, der Drucker holt sie selbst ab (alle paar
 * Sekunden) und meldet das Ergebnis. So druckt jeder Browser -- ohne lokale
 * Software. Das ePOS-XML baut das Backend aus dem Zeichenraster (ein Setzweg).
 */
export interface NetzDrucker {
  id: string;
  name: string;
  art: string;
  papier: 'mm58' | 'mm80';
  aktiv: boolean;
  erstellt: number | null;
  /** Letzter Abruf des Druckers (ms); null = noch nie verbunden. */
  zuletztGesehen: number | null;
  zuletztErgebnis: { erfolg: boolean; code: string | null; zeit: number } | null;
  /** Kennung, die der Drucker selbst schickt (Feld ID im Drucker-Menue). */
  druckerKennung: string | null;
  /** Abhol-URL fuer das Drucker-Menue -- nur fuer den Chef/das Konto. */
  sdpUrl?: string;
}

export type DruckJobStatus = 'offen' | 'gesendet' | 'gedruckt' | 'fehler' | 'abgelaufen';

export interface DruckJob {
  jobId: string;
  status: DruckJobStatus;
  erstellt?: number | null;
  gesendetAt?: number | null;
  ergebnis: { erfolg: boolean; code: string | null; status?: string | null; zeit?: number } | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const zahl = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function listMyPrinters(rufen: InternerTransport): Promise<NetzDrucker[]> {
  const daten = await rufen<{ drucker?: unknown[] }>('listMyPrinters', {});
  return (daten?.drucker ?? []).map((r) => {
    const d = (r ?? {}) as Record<string, unknown>;
    const e = d.zuletztErgebnis && typeof d.zuletztErgebnis === 'object' ? (d.zuletztErgebnis as Record<string, unknown>) : null;
    return {
      id: String(d.id ?? ''), name: String(d.name ?? ''), art: String(d.art ?? 'epson-sdp'), papier: d.papier === 'mm58' ? 'mm58' : 'mm80',
      aktiv: d.aktiv !== false, erstellt: zahl(d.erstellt), zuletztGesehen: zahl(d.zuletztGesehen),
      zuletztErgebnis: e ? { erfolg: e.erfolg === true, code: text(e.code), zeit: zahl(e.zeit) ?? 0 } : null,
      druckerKennung: text(d.druckerKennung),
      ...(text(d.sdpUrl) ? { sdpUrl: String(d.sdpUrl) } : {}),
    };
  });
}

export interface CreatePrintJobOptions {
  druckerId: string;
  layout: ReceiptLayout;
  receiptId?: string;
  titel?: string;
  quelle?: string;
}

export async function createPrintJob(rufen: InternerTransport, o: CreatePrintJobOptions): Promise<DruckJob> {
  const params: Record<string, unknown> = { druckerId: o.druckerId, layout: o.layout };
  if (o.receiptId) params.receiptId = o.receiptId;
  if (o.titel) params.titel = o.titel;
  if (o.quelle) params.quelle = o.quelle;
  const daten = await rufen<{ jobId?: unknown; status?: unknown }>('createPrintJob', params);
  return { jobId: String(daten?.jobId ?? ''), status: (text(daten?.status) as DruckJobStatus) ?? 'offen', ergebnis: null };
}

export async function getPrintJob(rufen: InternerTransport, o: { druckerId: string; jobId: string }): Promise<DruckJob> {
  const d = await rufen<Record<string, unknown>>('getPrintJob', { druckerId: o.druckerId, jobId: o.jobId });
  const e = d?.ergebnis && typeof d.ergebnis === 'object' ? (d.ergebnis as Record<string, unknown>) : null;
  return {
    jobId: String(d?.jobId ?? o.jobId), status: (text(d?.status) as DruckJobStatus) ?? 'offen',
    erstellt: zahl(d?.erstellt), gesendetAt: zahl(d?.gesendetAt),
    ergebnis: e ? { erfolg: e.erfolg === true, code: text(e.code), status: text(e.status), zeit: zahl(e.zeit) ?? undefined } : null,
  };
}
