/**
 * Antwort des hobex-HPS-Terminals auf eine Zahlung oder eine Statusabfrage,
 * durchgereicht von **Kasseneck Connect** (`POST /v1/terminal/payment`,
 * `/status`, `/abort` — Feld `hps` im Erfolgsrumpf). Connect ordnet nichts
 * ein, es reicht den Terminal-Rumpf roh durch — die Einordnung passiert hier.
 *
 * **Zwilling:** `kasseneck_api/lib/src/hobex_hps/transaction_response.dart`.
 * Beide Seiten pinnen dieselbe Codetabelle, siehe `HPS_MEASURED_CODES` unten
 * und `fixtures/hobex-hps-codes.json`.
 *
 * **`responseCode !== '0'` ist NICHT die Pruefung auf eine Ablehnung.** Genau
 * diese Lesart hat am 24.08.2026 zur doppelten Belastung gefuehrt:
 * [NO_STATEMENT_CODE] (`9027`) ist ein Code ungleich `'0'` und sagt trotzdem
 * nichts aus — er steht am gemessenen Terminal gleichermassen fuer "laeuft
 * gerade", "abgebrochen" und "nie gesehen". Wer ihn als Ablehnung liest,
 * meldet fuer einen LAUFENDEN Vorgang "nichts belastet, Wiederholung
 * gefahrlos".
 *
 * [isConclusive] ist die einzige Stelle, an der ein Code zu einem Ausgang
 * wird — und sie ist eine ECHTE Positivliste: nur ein Code, dessen Bedeutung
 * GEMESSEN und in [HPS_MEASURED_CODES] benannt ist, zaehlt. Jeder andere —
 * auch ein neuer, heute noch unbekannter Code — ist eine Wissensluecke, siehe
 * [isUnknownCode]. Am 27.08.2026 hat der Dart-Zwilling gemessen, warum die
 * Gegenrichtung ("jeder Code ausser 9027 ist schluessig") gefaehrlich ist: ein
 * bis dahin unbenannter Code ([TECHNICAL_ERROR_CODE], `9900`) war darueber
 * schluessig und haette eine Zahlung, unter der tatsaechlich Geld geflossen
 * sein kann, als `declined` gemeldet.
 */

/** Ein Ergebniscode, dessen Bedeutung GEMESSEN und hier benannt ist. */
export interface HpsMeasuredCode {
  /** Der Ergebniscode, wie ihn das Terminal im Feld `responseCode` sendet. */
  readonly code: string;
  /** Bedeutung, wie gemessen — deutsch, ohne Umlaute (siehe Vorbild). */
  readonly meaning: string;
  /**
   * `true`: der Code schreibt einen Ausgang fest (Teil der Positivliste,
   * siehe [isConclusive]). `false`: gemessen und benannt, aber ausdruecklich
   * KEINE Aussage ueber den Vorgang (9027, 9900).
   */
  readonly conclusive: boolean;
}

/**
 * Die gemessene Codetabelle — Vertrag mit dem Dart-Zwilling, siehe
 * `fixtures/hobex-hps-codes.json`. Gemessen an einem hobex-HPS (TID 3600335,
 * HPS 1.10.0, Firmware 7.3.6, 26.–28.08.2026).
 *
 * Reihenfolge ist die im Messprotokoll (`doc/kartenzahlung.md` im
 * Dart-Zwilling) — numerisch aufsteigend zu sortieren wuerde beim Diff
 * gegen die Vertragsdatei nichts gewinnen und macht Aenderungen schwerer
 * nachzuverfolgen.
 */
export const HPS_MEASURED_CODES: readonly HpsMeasuredCode[] = [
  { code: '0', meaning: 'genehmigt', conclusive: true },
  {
    code: '9002',
    meaning: 'ungueltiger Vorgang -- das Terminal hat den Vorgang selbst als '
      + 'unzulaessig verworfen, bevor irgendetwas in Bewegung kam',
    conclusive: true,
  },
  {
    code: '9011',
    meaning: "aufgehoben (\"Transaction Canceled\") -- der Vorgang unter dieser Kennung wurde storniert",
    conclusive: true,
  },
  {
    code: '9027',
    meaning: 'keine Aussage -- steht gleichermassen fuer "nie gesehen", '
      + '"laeuft gerade", "Karte nicht aufgelegt" und "abgebrochen"',
    conclusive: false,
  },
  {
    code: '9900',
    meaning: '"Technical Error Database" -- gemessen im Zusammenhang mit '
      + 'einer nicht rein numerischen Kennung; keine Aussage ueber den Vorgang selbst',
    conclusive: false,
  },
  { code: '100002', meaning: 'abgebrochen ("Aborted")', conclusive: true },
  { code: '100003', meaning: 'Karte nicht aufgelegt ("Card not present")', conclusive: true },
  { code: '100010', meaning: 'nicht mehr abbrechbar -- der Vorgang ist bereits abgeschlossen', conclusive: true },
] as const;

/** `responseCode` einer genehmigten Zahlung. */
export const APPROVED_CODE = '0';
/** Siehe [HPS_MEASURED_CODES]: ungueltiger Vorgang, nichts passiert. */
export const INVALID_TRANSACTION_CODE = '9002';
/** Siehe [HPS_MEASURED_CODES]: aufgehoben. */
export const TRANSACTION_CANCELED_CODE = '9011';
/** Siehe [HPS_MEASURED_CODES]: keine Aussage. */
export const NO_STATEMENT_CODE = '9027';
/** Siehe [HPS_MEASURED_CODES]: Kennung nicht numerisch, keine Aussage. */
export const TECHNICAL_ERROR_CODE = '9900';
/** Siehe [HPS_MEASURED_CODES]: abgebrochen. */
export const ABORTED_CODE = '100002';
/** Siehe [HPS_MEASURED_CODES]: Karte nicht aufgelegt. */
export const CARD_NOT_PRESENT_CODE = '100003';
/** Siehe [HPS_MEASURED_CODES]: nicht mehr abbrechbar. */
export const NOT_ABORTABLE_CODE = '100010';

/**
 * HTTP `409` ("Terminal is busy"): das Terminal serialisiert und weist eine
 * zweite Anfrage ab, waehrend eine erste noch laeuft. Am 27.08.2026 gemessen:
 * kommt nach 87 Millisekunden, der abgewiesene Vorgang hinterlaesst KEINE
 * Spur (die Statusabfrage auf seine Kennung liefert weiterhin
 * [NO_STATEMENT_CODE]).
 *
 * Bewusst KEIN Eintrag in [HPS_MEASURED_CODES]: es ist ein HTTP-Status, kein
 * `responseCode` — er entsteht, bevor ueberhaupt ein Antwortrumpf gelesen
 * wird. Siehe `errors.ts` (`HpsConnectTerminalError.isTerminalBusy`) fuer die
 * getrennte Auswertung.
 */
export const TERMINAL_BUSY_HTTP_STATUS = 409;

const KNOWN_OUTCOME_CODES: ReadonlySet<string> = new Set(
  HPS_MEASURED_CODES.filter((c) => c.conclusive).map((c) => c.code),
);

/** Antwort des Terminals — Zahlung, Statusabfrage oder Abbruch. */
export interface HpsTransactionResponse {
  /** Kennung dieser Transaktion, wie vom Terminal bestaetigt bzw. echoed. */
  readonly transactionId: string | undefined;
  /** Kennung der Original-Transaktion (Gutschrift, Aufhebung). */
  readonly originalTransactionId: string | undefined;
  readonly tid: string | undefined;
  readonly receipt: string | undefined;
  readonly approvalCode: string | undefined;
  readonly reference: string | undefined;
  readonly transactionDate: string | undefined;
  readonly cardNumber: string | undefined;
  readonly cardExpiry: string | undefined;
  readonly brand: string | undefined;
  readonly cardIssuer: string | undefined;
  readonly transactionType: string | undefined;
  readonly currency: string | undefined;
  readonly amount: number | undefined;
  readonly tip: number | undefined;
  /**
   * Ergebniscode. `undefined` (nur bei einer Statusabfrage moeglich) heisst
   * "laeuft noch" — siehe [isInProgress]. Auf dieser Firmware ungemessen,
   * bleibt aber ebenso eine Nicht-Aussage wie [NO_STATEMENT_CODE].
   *
   * Ein leerer String aus dem Rumpf wird beim Einlesen zu `undefined`
   * normalisiert (siehe [parseHpsTransactionResponse]): er traegt keine
   * Aussage, und `!== '0'` wuerde ihn sonst faelschlich als Ablehnung lesen.
   */
  readonly responseCode: string | undefined;
  readonly responseText: string | undefined;
  /** Nur Statusabfrage (v2). Auf der gemessenen Firmware durchgehend `undefined`. */
  readonly state: string | undefined;
  /** Der roh decodierte Rumpf, fuer Felder ohne eigenes Modell. */
  readonly raw: Record<string, unknown>;
}

/**
 * Liest eine Terminal-Antwort aus dem `hps`-Feld der Connect-Huelle.
 *
 * Wirft, wenn [raw] keine brauchbare Form hat (kein Objekt) — das ist ein
 * Formfehler der Antwort, kein Ausgang der Zahlung, und wird vom Aufrufer
 * (`payments.ts`) genauso behandelt wie jeder andere unerwartete Fehler: die
 * Klaerung laeuft konservativ weiter, statt ihn stillschweigend als
 * "laeuft noch" zu deuten.
 */
export function parseHpsTransactionResponse(raw: unknown): HpsTransactionResponse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Terminal-Antwort ist kein JSON-Objekt');
  }
  const r = raw as Record<string, unknown>;
  return {
    transactionId: asString(r['transactionId']),
    originalTransactionId: asString(r['originalTransactionId']),
    tid: asString(r['tid']),
    receipt: asString(r['receipt']),
    approvalCode: asString(r['approvalCode']),
    reference: asString(r['reference']),
    transactionDate: asString(r['transactionDate']),
    cardNumber: asString(r['cardNumber']),
    cardExpiry: asString(r['cardExpiry']),
    brand: asString(r['brand']),
    cardIssuer: asString(r['cardIssuer']),
    transactionType: asString(r['transactionType']),
    currency: asString(r['currency']),
    amount: asNumber(r['amount']),
    tip: asNumber(r['tip']),
    // responseCode kommt teils als Zahl, teils als Zeichenkette — siehe
    // Zwilling. Ein leerer String traegt keine Aussage und wird wie ein
    // fehlendes Feld behandelt.
    responseCode: nonEmpty(stringify(r['responseCode'])),
    responseText: asString(r['responseText']),
    state: asString(r['state']),
    raw: r,
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function stringify(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

function nonEmpty(v: string | undefined): string | undefined {
  return v === undefined || v === '' ? undefined : v;
}

/** `true`, wenn der Vorgang genehmigt ist. */
export function isApproved(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return res.responseCode === APPROVED_CODE;
}

/** `true`, wenn eine Statusabfrage meldet, der Vorgang laeuft noch (kein Code). */
export function isInProgress(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return res.responseCode === undefined;
}

/** `true`, wenn ein Abbruch daran scheiterte, dass der Vorgang nicht mehr abbrechbar war. */
export function isNotAbortable(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return res.responseCode === NOT_ABORTABLE_CODE;
}

/** `true`, wenn das Terminal zu dieser Kennung keine Auskunft gibt (9027). */
export function isNoStatement(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return res.responseCode === NO_STATEMENT_CODE;
}

/** `true`, wenn das Terminal einen technischen Fehler meldet (9900). */
export function isTechnicalError(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return res.responseCode === TECHNICAL_ERROR_CODE;
}

/**
 * `true`, wenn der Vorgang unter dieser Kennung aufgehoben wurde (9011).
 *
 * Vorsicht bei der Verwendung: fuer die DIREKTE Antwort auf eine Aufhebung
 * bedeutet dieser Code etwas anderes als bei einer Statusabfrage auf die
 * Originalzahlung -- siehe `payments.ts`, `fromCancelResponse` vs.
 * `fromCancelStatus`.
 */
export function isCanceled(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return res.responseCode === TRANSACTION_CANCELED_CODE;
}

/**
 * `true`, wenn diese Antwort ueberhaupt eine Aussage ueber den Ausgang
 * traegt — ein Ergebniscode, der in [HPS_MEASURED_CODES] als `conclusive`
 * gefuehrt wird. Die einzige Stelle, an der ein Code zu einem Ausgang wird.
 */
export function isConclusive(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return res.responseCode !== undefined && KNOWN_OUTCOME_CODES.has(res.responseCode);
}

/**
 * `true`, wenn ein Ergebniscode VORHANDEN ist, aber weder schluessig noch
 * eine der beiden gemessenen Wissensluecken ([isNoStatement],
 * [isTechnicalError]) — ein Code, den dieses Modell schlicht nicht kennt.
 */
export function isUnknownCode(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return res.responseCode !== undefined && !isConclusive(res) && !isNoStatement(res) && !isTechnicalError(res);
}
