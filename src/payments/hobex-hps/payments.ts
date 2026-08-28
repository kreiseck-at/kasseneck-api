import type { HpsConnectClient, HpsConnectTarget } from './connect-client.js';
import type { HpsPaymentObserver } from './events.js';
import {
  HpsClarifyTimeoutError,
  HpsConnectException,
  HpsConnectTerminalError,
  HpsPreflightError,
} from './errors.js';
import type { HpsPaymentResult } from './outcome.js';
import { newHpsTransactionId } from './transaction-id.js';
import {
  isConclusive,
  isNoStatement,
  isNotAbortable,
  isTechnicalError,
  isUnknownCode,
  NOT_ABORTABLE_CODE,
  TECHNICAL_ERROR_CODE,
  type HpsTransactionResponse,
} from './transaction-response.js';

/**
 * Kartenzahlung ueber **Kasseneck Connect**, deren Ausgang IMMER bekannt ist.
 *
 * Zwilling von `HpsPayments` (`kasseneck_api/lib/src/hobex_hps/hps_payments.dart`)
 * — Logik und Begruendungen sind von dort uebernommen, nicht neu erfunden.
 * Was dort an Flutter/Dart-Spezifischem haengt, gehoert hier nicht hin; siehe
 * `connect-client.ts` fuer den wesentlichen Unterschied (Connect statt
 * direktem Terminal-Kontakt).
 *
 * **Nur [pay] — bewusst kein `refund`/`cancel`.** Siehe `connect-client.ts`:
 * Connect exponiert dafuer (noch) keinen Endpunkt.
 *
 * Regel, von der nicht abgewichen wird: `outcome: 'declined'` entsteht
 * ausschliesslich aus einer POSITIVEN Aussage — einem GEMESSENEN Ergebniscode
 * des Terminals ungleich `'0'` ([isConclusive]), einem nachweislich
 * gelungenen Abbruch, oder dem gemessenen "Terminal beschaeftigt"-Fall
 * (HTTP 409 auf die ERZEUGENDE Anfrage, siehe `errors.ts`,
 * `HpsConnectTerminalError.isTerminalBusy`). Ein Transportfehler, ein
 * Zeitablauf oder eine Wissensluecke fuehren NIE dorthin: keines davon ist
 * eine Aussage darueber, dass nichts belastet wurde. Genau diese
 * Verwechslung hat am 24.08.2026 eine echte Belastung als unbelastet
 * ausgewiesen und den Kunden ein zweites Mal belastet.
 *
 * ## Der Klaerweg, wie er am 26./27.08.2026 am hobex-HPS gemessen wurde
 *
 * Bleibt die Antwort auf eine Zahlung aus:
 *
 * 1. [HpsConnectClient.abort] einmalig versuchen.
 * 2. `responseCode === '0'` -> der Vorgang war noch abbrechbar, also nicht
 *    abgeschlossen -> `declined`, beweisbar.
 * 3. Jeder andere Code (gemessen `100010`) -> der Vorgang ist ueber den
 *    abbrechbaren Punkt hinaus -> JETZT die Statusabfrage pollen, sie liefert
 *    nun eine echte Aussage.
 * 4. Abbruch scheitert am Transport -> pollen wie in 3.
 * 5. Beim Pollen ist `9027` KEIN Ergebnis, sondern ein Grund weiterzumachen.
 *    Budget erschoepft -> `unresolved`.
 *
 * Der Abbruch VOR dem Pollen ist wesentlich: die Statusabfrage meldet
 * "laeuft noch" nie (sie antwortet auf jeden nicht genehmigten Vorgang mit
 * `9027`). Der Abbruchversuch ist auf einen Bruchteil des Klaerbudgets
 * gedeckelt ([ABORT_BUDGET_DIVISOR]), sonst friesst ein haengender Abbruch
 * die ganze Klaerung.
 *
 * Die Kennung ist in JEDEM Ergebnis gesetzt, auch bei `'unresolved'`.
 */

export interface HpsPaymentsOptions {
  /** Wie lange insgesamt geklaert wird, bevor der Ausgang offen bleibt. Vorgabe 90 s. */
  resolveBudgetMs?: number;
  /** Obergrenze fuer den Abstand zwischen zwei Statusabfragen. Vorgabe 10 s. */
  maxBackoffMs?: number;
  /** Nach so vielen Statusabfragen in Folge, die am Transport scheitern, wird abgebrochen. Vorgabe 3. */
  maxTransportFailures?: number;
  /** Pausenquelle — Naht fuer Tests. Vorgabe `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Uhr fuer das Budget in ms — Naht fuer Tests. Vorgabe `Date.now`. */
  now?: () => number;
  observer?: HpsPaymentObserver;
}

export interface HpsPaymentOptions {
  /** Zu belastender Betrag in **Cent** (ohne Trinkgeld). */
  amountCents: number;
  tipCents?: number;
  reference?: string;
  currency?: string;
  language?: string;
  /**
   * Kennung; wird ohne Angabe erzeugt und im Ergebnis zurueckgegeben. Vorgeben,
   * um einen abgebrochenen Vorgang gezielt weiterzuverfolgen.
   */
  transactionId?: string;
}

export interface HpsPayments {
  pay(options: HpsPaymentOptions): Promise<HpsPaymentResult>;
}

/** Teiler, mit dem das Abbruchbudget aus [HpsPaymentsOptions.resolveBudgetMs] entsteht. */
const ABORT_BUDGET_DIVISOR = 6;

export function createHpsPayments(
  client: HpsConnectClient,
  target: HpsConnectTarget,
  options: HpsPaymentsOptions = {},
): HpsPayments {
  const resolveBudgetMs = options.resolveBudgetMs ?? 90_000;
  const maxBackoffMs = options.maxBackoffMs ?? 10_000;
  const maxTransportFailures = options.maxTransportFailures ?? 3;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const observer = options.observer;
  const abortBudgetMs = Math.trunc(resolveBudgetMs / ABORT_BUDGET_DIVISOR);

  function emit(kind: 'resolving' | 'resolved', message: string, transactionId: string): void {
    if (!observer) return;
    try {
      observer({ kind, message, transactionId });
    } catch {
      // bewusst still -- das Protokoll darf den Zahlweg nie mitreissen
    }
  }

  /**
   * Meldet eine Ausnahme, die KEIN erwarteter Connect-Fehler ist -- also
   * einen Fehler im eigenen Auswerten statt einen an Connect oder am
   * Terminal (z. B. eine unlesbare Antwortform).
   */
  function noteUnexpected(error: unknown, transactionId: string): void {
    if (error instanceof HpsConnectException) return;
    if (!observer) return;
    try {
      observer({
        kind: 'unexpectedError',
        message: 'Unerwarteter Fehler beim Auswerten der Terminal-Antwort',
        transactionId,
        error,
      });
    } catch {
      // bewusst still
    }
  }

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * `null`, wenn [error] nicht der gemessene "Terminal beschaeftigt"-Fall ist.
   * Gilt AUSDRUECKLICH nur fuer die ERZEUGENDE Anfrage (siehe `errors.ts`),
   * niemals beim Abbruch oder beim Pollen der Statusabfrage.
   */
  function fromTerminalBusy(error: unknown, id: string, steps: string[]): HpsPaymentResult | null {
    if (!(error instanceof HpsConnectTerminalError) || !error.isTerminalBusy) return null;
    steps.push(
      'Terminal beschaeftigt (HTTP 409) -- die Anfrage wurde nicht angenommen, es ist nichts geschehen',
    );
    emit('resolved', steps[steps.length - 1]!, id);
    return { outcome: 'declined', transactionId: id, steps: [...steps] };
  }

  /** Verlaufseintrag fuer eine direkte Antwort, die den Ausgang NICHT festschreibt. */
  function offeneAntwort(res: HpsTransactionResponse): string {
    if (res.responseCode === undefined) {
      return 'Antwort ohne Ergebniscode -- Ausgang wird geklaert';
    }
    if (isTechnicalError(res)) {
      return `Antwort mit technischem Fehler (${TECHNICAL_ERROR_CODE}) -- keine Aussage ueber den Vorgang, Ausgang wird geklaert`;
    }
    if (isUnknownCode(res)) {
      return `Terminal nennt einen unbekannten Code (${res.responseCode}) -- Ausgang wird geklaert`;
    }
    return `Antwort ohne Aussage (${res.responseCode}) -- Ausgang wird geklaert`;
  }

  /** Dasselbe fuer eine Statusabfrage waehrend der Klaerung, oder `null`. */
  function statusOhneErgebnis(status: HpsTransactionResponse): string | null {
    if (isNoStatement(status)) {
      return `Status: keine Auskunft (${status.responseCode})`;
    }
    if (isTechnicalError(status)) {
      return `Status: technischer Fehler (${TECHNICAL_ERROR_CODE}) -- keine Aussage ueber den Vorgang`;
    }
    if (isUnknownCode(status)) {
      return `Status: unbekannter Code (${status.responseCode}) -- keine Aussage`;
    }
    return null;
  }

  /** Ordnet eine Terminal-Antwort ein. `null`, wenn sie nichts entscheidet. */
  function fromResponse(res: HpsTransactionResponse, id: string, steps: string[]): HpsPaymentResult | null {
    if (!isConclusive(res)) return null;
    const approved = res.responseCode === '0';
    steps.push(approved ? 'Terminal: genehmigt' : `Terminal: abgelehnt (${res.responseCode})`);
    emit('resolved', steps[steps.length - 1]!, id);
    return { outcome: approved ? 'approved' : 'declined', transactionId: id, response: res, steps: [...steps] };
  }

  function open(id: string, steps: string[]): HpsPaymentResult {
    emit('resolved', steps[steps.length - 1]!, id);
    return { outcome: 'unresolved', transactionId: id, steps: [...steps] };
  }

  /**
   * Fuehrt [call] aus, aber hoechstens so lange, wie vom [resolveBudgetMs]
   * uebrig ist -- sonst waere die Klaerung nicht durch das Budget begrenzt,
   * sondern durch das (deutlich groessere) Zeitlimit des Connect-Clients je
   * einzelnem Aufruf. [cap] deckelt zusaetzlich einen einzelnen Schritt
   * (siehe [abortBudgetMs]).
   */
  function withinBudget<T>(elapsedMs: () => number, call: () => Promise<T>, cap?: number): Promise<T> {
    let left = resolveBudgetMs - elapsedMs();
    if (cap !== undefined && cap < left) left = cap;
    if (left <= 0) {
      return Promise.reject(new HpsClarifyTimeoutError(resolveBudgetMs));
    }
    return withTimeout(call(), left);
  }

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new HpsClarifyTimeoutError(ms)), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e: unknown) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  function nextWait(current: number): number {
    if (current === 0) return 1000;
    const doubled = current * 2;
    return doubled > maxBackoffMs ? maxBackoffMs : doubled;
  }

  /**
   * Versucht den Abbruch GENAU EINMAL. Liefert ein Ergebnis nur im einen
   * beweisbaren Fall: Connect quittiert den Abbruch mit `responseCode === '0'`.
   * In jedem anderen Fall `null` -- der Aufrufer pollt dann weiter.
   */
  async function tryAbort(id: string, steps: string[], elapsedMs: () => number): Promise<HpsPaymentResult | null> {
    let res: HpsTransactionResponse;
    try {
      res = await withinBudget(elapsedMs, () => client.abort({ ...target, transactionId: id }), abortBudgetMs);
    } catch (e) {
      steps.push(`Abbruch nicht bestaetigt (${describe(e)}) -- ob er wirkte, ist offen, Ausgang wird abgefragt`);
      noteUnexpected(e, id);
      return null;
    }

    if (res.responseCode === undefined) {
      steps.push('Abbruch ohne Ergebniscode quittiert -- das beweist nichts, Ausgang wird abgefragt');
      return null;
    }
    if (res.responseCode !== '0') {
      steps.push(
        isNotAbortable(res)
          ? `Abbruch abgelehnt (${NOT_ABORTABLE_CODE}) -- der Vorgang ist nicht mehr abbrechbar, Ausgang wird abgefragt`
          : `Abbruch abgelehnt (${res.responseCode}) -- Grund unbekannt, Ausgang wird abgefragt`,
      );
      return null;
    }

    steps.push('Abbruch bestaetigt -- der Vorgang war noch abbrechbar, es ist nichts belastet');
    emit('resolved', steps[steps.length - 1]!, id);
    return { outcome: 'declined', transactionId: id, response: res, steps: [...steps] };
  }

  /** Klaert einen offenen Ausgang: erst abbrechen, dann abfragen -- bis das Terminal etwas sagt oder das Budget aufgebraucht ist. */
  async function resolve(id: string, steps: string[]): Promise<HpsPaymentResult> {
    emit('resolving', 'Ausgang offen, Klaerung laeuft', id);

    const start = now();
    const elapsedMs = () => now() - start;

    const aborted = await tryAbort(id, steps, elapsedMs);
    if (aborted) return aborted;

    let wait = 0;
    let transportFailures = 0;

    while (elapsedMs() < resolveBudgetMs) {
      if (wait > 0) {
        const left = resolveBudgetMs - elapsedMs();
        await sleep(Math.min(wait, left));
        if (elapsedMs() >= resolveBudgetMs) break;
      }

      let status: HpsTransactionResponse;
      try {
        status = await withinBudget(elapsedMs, () => client.status({ ...target, transactionId: id }));
        transportFailures = 0;
      } catch (e) {
        transportFailures += 1;
        steps.push(`Statusabfrage gescheitert (${transportFailures}): ${describe(e)}`);
        noteUnexpected(e, id);
        if (transportFailures >= maxTransportFailures) {
          steps.push('Terminal antwortet nicht -- Ausgang bleibt offen');
          break;
        }
        wait = nextWait(wait);
        continue;
      }

      const settled = fromResponse(status, id, steps);
      if (settled) return settled;

      steps.push(statusOhneErgebnis(status) ?? 'Status: noch kein Ergebniscode');
      wait = nextWait(wait);
    }

    steps.push('Ausgang bleibt offen');
    return open(id, steps);
  }

  async function pay(paymentOptions: HpsPaymentOptions): Promise<HpsPaymentResult> {
    const id = paymentOptions.transactionId ?? newHpsTransactionId();
    const steps: string[] = [];

    // Das try liegt bewusst ENG um den Netzweg: was danach kommt, ist unser
    // eigenes Auswerten und soll nicht stillschweigend als "Terminal hat
    // nicht geantwortet" durchgehen.
    let res: HpsTransactionResponse | undefined;
    try {
      res = await client.payment({
        ...target,
        transactionId: id,
        amountCents: paymentOptions.amountCents,
        tipCents: paymentOptions.tipCents,
        reference: paymentOptions.reference,
        currency: paymentOptions.currency,
        language: paymentOptions.language,
      });
    } catch (e) {
      if (e instanceof HpsPreflightError) {
        // Beweisbar nichts gesendet -- kein Ausgang, sondern ein Aufruffehler.
        // Wird unveraendert weitergeworfen, damit er sichtbar bleibt statt als
        // offener Ausgang zu enden (Zwilling: Dart's `ArgumentError`-Zweig).
        throw e;
      }
      const busy = fromTerminalBusy(e, id, steps);
      if (busy) return busy;
      steps.push(`Zahlung abgebrochen: ${describe(e)}`);
      noteUnexpected(e, id);
    }

    if (res) {
      const settled = fromResponse(res, id, steps);
      if (settled) return settled;
      steps.push(offeneAntwort(res));
    }

    return resolve(id, steps);
  }

  return { pay };
}
