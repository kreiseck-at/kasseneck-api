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
  isApproved,
  isCanceled,
  isConclusive,
  isNoStatement,
  isNotAbortable,
  isTechnicalError,
  isUnknownCode,
  NOT_ABORTABLE_CODE,
  TECHNICAL_ERROR_CODE,
  TRANSACTION_CANCELED_CODE,
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
 * [pay], [refund] und [cancel] -- seit `kasseneck-connect` Commit `1c8a003`
 * traegt Connect auch die beiden letzteren, siehe `connect-client.ts`.
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
 *
 * ## [refund] bekommt EXAKT denselben Klaerweg wie [pay]
 *
 * Abbruch eingeschlossen -- und das ist GEMESSEN, nicht analog geschlossen.
 * Am 26.08.2026 nachgemessen: `abort` auf eine LAUFENDE Gutschrift antwortet
 * ebenfalls mit `responseCode '0'`, und die Gutschrift endet daraufhin mit
 * `100002` "Aborted". Der Abbruch ist dort also derselbe Diskriminator wie bei
 * einer Zahlung. Die Kennung ist bei [refund] die des NEUEN Vorgangs (der
 * Gutschrift selbst), eine Statusabfrage darauf liefert also genau deren
 * Ausgang -- deshalb reicht dieselbe [resolve]-Funktion unveraendert. Ohne den
 * Abbruch haette die Klaerung einer Gutschrift gar keinen Diskriminator mehr
 * und endete fast immer bei `unresolved`, weil die Statusabfrage auch hier
 * `9027` antwortet.
 *
 * ## [cancel] ist die Ausnahme, in beiden Richtungen
 *
 * Die uebergebene Kennung ist die der URSPRUENGLICHEN Zahlung, nicht die eines
 * neuen Vorgangs -- und `'0'` bedeutet dort NICHT "genehmigt". Am 26. und
 * 28.08.2026 gemessen (Statusabfrage auf die Original-Kennung, NACHDEM eine
 * genehmigte Zahlung per Void aufgehoben wurde):
 *
 * | Antwort der Statusabfrage auf die Originalkennung | Bedeutung |
 * |---|---|
 * | `9011` "Transaction Canceled" | die Aufhebung hat GEWIRKT -> `approved` |
 * | `'0'` | die Originalzahlung steht UNVERAENDERT -> die Aufhebung hat NICHT gegriffen -> `declined` |
 * | `9027` und alles andere | weiter klaeren, am Ende `unresolved` |
 *
 * Zwei Sicherungen dagegen, `'0'` faelschlich fuer "nicht gegriffen" zu halten
 * und damit den Kunden nach dem Tagesabschluss ueber eine Rueckerstattung ein
 * zweites Mal zu bezahlen (siehe [fromCancelStatus]):
 *
 * 1. **`'0'` entscheidet erst ab der ZWEITEN beantworteten Statusabfrage.**
 *    Die erste laeuft unmittelbar nachdem der Aufhebungs-Aufruf abgerissen
 *    ist -- genau das Fenster, in dem die Aufhebung noch unterwegs sein kann.
 *    Reicht das Budget nur fuer eine Abfrage, endet die Klaerung bei
 *    `unresolved`.
 * 2. **`9011` auf dem DIREKTEN Antwortweg von `cancel`** wird NICHT als
 *    `declined` gelesen -- was es dort genau heisst, ist ungemessen (siehe
 *    [fromCancelResponse]). Der Zustand der Originalzahlung wird abgefragt
 *    statt geraten.
 *
 * Kein [tryAbort]-Versuch bei [cancel]: die Originalzahlung ist laengst
 * abgeschlossen und antwortet gemessen mit `100010` -- ein Abbruch darauf
 * waere sinnlos.
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

export interface HpsRefundOptions {
  /** Zu erstattender Betrag in **Cent**. */
  amountCents: number;
  /** Kennung der erstatteten Zahlung -- Connect verlangt sie zwingend. */
  originalTransactionId: string;
  reference?: string;
  currency?: string;
  language?: string;
  /**
   * Kennung der Gutschrift SELBST; wird ohne Angabe erzeugt und im Ergebnis
   * zurueckgegeben. Vorgeben, um eine abgebrochene Gutschrift gezielt
   * weiterzuverfolgen -- wie bei [HpsPaymentOptions.transactionId].
   */
  transactionId?: string;
}

export interface HpsCancelOptions {
  /** Kennung der URSPRUENGLICHEN Zahlung -- keine neue, MUSS feststehen. */
  transactionId: string;
  /** Pflicht: ein Void ohne Betrag weist das Terminal mit `400 Missing amount` ab. */
  amountCents: number;
  currency?: string;
  language?: string;
}

export interface HpsPayments {
  pay(options: HpsPaymentOptions): Promise<HpsPaymentResult>;
  /** Gutschrift, geklaert wie [pay] -- siehe Klassendoku oben. */
  refund(options: HpsRefundOptions): Promise<HpsPaymentResult>;
  /** Aufhebung (Storno/Void) einer bestehenden Zahlung -- eigener Klaerweg, siehe Klassendoku oben. */
  cancel(options: HpsCancelOptions): Promise<HpsPaymentResult>;
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

  /**
   * Ordnet die DIREKTE Antwort auf einen Aufhebungs-Request ein. Fast dasselbe
   * wie [fromResponse] -- diese Antwort betrifft die Aufhebung selbst und
   * traegt deren eigenen `responseCode`. Mit genau einer Ausnahme:
   * [TRANSACTION_CANCELED_CODE] (`9011`).
   *
   * Ueber [fromResponse] wuerde `9011` zu `declined` -- also "die Aufhebung
   * hat nicht gegriffen, es ist weiterhin belastet". Das waere die teure
   * Richtung: es meldet "belastet" fuer einen Vorgang, der aufgehoben ist, und
   * laedt zu einer Rueckerstattung ein, die der Kunde ein zweites Mal bekaeme.
   * Es widerspraeche ausserdem [fromCancelStatus], die aus demselben Code das
   * Gegenteil ableitet.
   *
   * Was `9011` auf dem DIREKTEN Weg genau heisst, ist UNGEMESSEN -- am
   * naechstliegenden "der Vorgang ist (bereits) aufgehoben", aber das ist eine
   * Lesart, keine Messung. Deshalb weder Erfolg noch Ablehnung hier, sondern
   * NICHT SCHLUESSIG: die Klaerung fragt den Zustand der Originalzahlung ab
   * und entscheidet ihn dort mit dem gemessenen Diskriminator, statt zu raten.
   */
  function fromCancelResponse(res: HpsTransactionResponse, id: string, steps: string[]): HpsPaymentResult | null {
    if (isCanceled(res)) {
      steps.push(
        `Aufhebung mit ${TRANSACTION_CANCELED_CODE} beantwortet -- mehrdeutig, der Zustand der Originalzahlung wird abgefragt`,
      );
      return null;
    }
    return fromResponse(res, id, steps);
  }

  /**
   * Ordnet die Statusabfrage einer OFFENEN AUFHEBUNG ein. `null`, wenn sie
   * nichts entscheidet.
   *
   * Die Abfrage laeuft auf die Kennung der ORIGINALZAHLUNG. Ihr
   * `responseCode` beschreibt deshalb den Zustand DIESER Zahlung, nicht den
   * Ausgang der Aufhebung -- er wird hier UEBERSETZT, nicht wie bei
   * [fromResponse] gelesen. Am 26./28.08.2026 gemessen, nachdem eine
   * genehmigte Zahlung per Void aufgehoben wurde:
   *
   * - `9011` "Transaction Canceled" -> die Aufhebung hat gewirkt -> `approved`.
   * - `'0'` -> die Originalzahlung steht unveraendert -> die Aufhebung hat
   *   NICHT gewirkt -> `declined`. Keine schlechte Nachricht ueber die
   *   Zahlung, sondern ueber die Aufhebung: es ist weiterhin belastet, und
   *   die Aufhebung muss wiederholt werden. ABER erst ab der ZWEITEN
   *   beantworteten Abfrage, siehe [firstQuery].
   * - `9027` und jeder andere oder fehlende Code -> keine Auskunft, weiter
   *   klaeren; am Ende `unresolved`, niemals ein geratenes Ergebnis.
   *
   * ## Warum `'0'` eine Karenz braucht
   *
   * Die Klaerung startet unmittelbar, nachdem der Void-Request abgerissen
   * ist, und ihre erste Abfrage laeuft ohne Pause. Anders als bei [pay] liegt
   * kein Abbruch-Roundtrip dazwischen, der Zeit verstreichen liesse. Genau in
   * diesem Fenster kann der Void beim Terminal noch unterwegs sein und die
   * Abfrage trotzdem schon `'0'` melden.
   *
   * Ein voreiliges "hat nicht gegriffen" ist NICHT harmlos: nach dem
   * Tagesabschluss ist die Folgehandlung eine RUECKERSTATTUNG -- und dann
   * bekommt der Kunde sein Geld zweimal. Deshalb entscheidet `'0'` erst ab der
   * zweiten beantworteten Abfrage. Ein tatsaechlich nicht gelandeter Void
   * antwortet eine Sekunde spaeter wieder `'0'`; der Preis ist diese eine
   * Sekunde. Reicht das Budget nur fuer eine einzige Abfrage, endet die
   * Klaerung bei `unresolved` -- wir sagen dann, dass wir es nicht wissen,
   * statt es zu raten.
   *
   * [state] `=== 'VOID'` gilt zusaetzlich als Beleg, aber niemals als
   * notwendige Bedingung -- auf der gemessenen Firmware ist `state` in jeder
   * bisher gesehenen Antwort `undefined`. Bleibt nur mitgelesen, weil ein
   * ausdrueckliches `'VOID'` -- wo eine Firmware es denn liefert -- eine
   * unmissverstaendliche positive Aussage ist, die kein falsches `approved`
   * erzeugen kann.
   *
   * [firstQuery] ist `true`, wenn dies die erste BEANTWORTETE Statusabfrage
   * dieser Klaerung ist. Gescheiterte Abfragen zaehlen nicht mit: sie lassen
   * zwar Zeit verstreichen, liefern aber keine Auskunft, an der sich ein
   * `'0'` bestaetigen liesse.
   */
  function fromCancelStatus(
    status: HpsTransactionResponse,
    id: string,
    steps: string[],
    firstQuery: boolean,
  ): HpsPaymentResult | null {
    const voided = isCanceled(status) || status.state?.trim().toUpperCase() === 'VOID';
    if (voided) {
      steps.push(`Terminal: Aufhebung bestaetigt (${status.responseCode ?? status.state})`);
      emit('resolved', steps[steps.length - 1]!, id);
      return { outcome: 'approved', transactionId: id, response: status, steps: [...steps] };
    }

    if (isApproved(status)) {
      if (firstQuery) {
        steps.push(
          'Terminal: Originalzahlung noch unveraendert (0) -- die Aufhebung koennte noch unterwegs sein, wird erneut abgefragt',
        );
        return null;
      }
      steps.push('Terminal: Originalzahlung steht unveraendert (0) -- die Aufhebung hat nicht gegriffen');
      emit('resolved', steps[steps.length - 1]!, id);
      return { outcome: 'declined', transactionId: id, response: status, steps: [...steps] };
    }

    return null;
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

  /**
   * Klaert eine offene Aufhebung -- eigene Fassung statt [resolve], weil die
   * Kennung hier die der URSPRUENGLICHEN Zahlung ist.
   *
   * Zwei Unterschiede zu [resolve]:
   *
   * 1. Die Antwort der Statusabfrage wird ueber [fromCancelStatus]
   *    eingeordnet, NICHT ueber [fromResponse] -- der `responseCode` der
   *    Originalkennung bedeutet hier etwas anderes als bei [pay]/[refund].
   * 2. KEIN [tryAbort]-Versuch. Der Abbruch greift nur, solange ein Vorgang
   *    noch abbrechbar ist; die Originalzahlung, deren Kennung hier vorliegt,
   *    ist laengst abgeschlossen und antwortet gemessen mit `100010`. Ein
   *    Abbruchversuch darauf waere sinnlos und koennte hoechstens fehlleiten.
   *
   * Budget, Backoff und Transportfehler-Deckelung sind unveraendert aus
   * [resolve] uebernommen.
   */
  async function resolveCancel(id: string, steps: string[]): Promise<HpsPaymentResult> {
    emit('resolving', 'Ausgang offen, Klaerung laeuft', id);

    const start = now();
    const elapsedMs = () => now() - start;

    let wait = 0;
    let transportFailures = 0;
    // Zaehlt nur BEANTWORTETE Statusabfragen -- Grundlage der Karenz fuer den
    // `'0'`-Fall, siehe [fromCancelStatus].
    let answeredQueries = 0;

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
        answeredQueries += 1;
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

      const settled = fromCancelStatus(status, id, steps, answeredQueries === 1);
      if (settled) return settled;

      // Der `'0'`-Karenzfall hat seinen eigenen, aussagekraeftigeren Eintrag
      // schon in [fromCancelStatus] gesetzt.
      if (!isApproved(status)) {
        steps.push(statusOhneErgebnis(status) ?? 'Status: Aufhebung noch nicht bestaetigt');
      }
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

  /**
   * Gutschrift mit geklaertem Ausgang -- EXAKT derselbe Klaerweg wie [pay]
   * (Abbruch eingeschlossen), siehe Klassendoku oben. [transactionId] ist die
   * Kennung des NEUEN Vorgangs (der Gutschrift selbst), nicht die der
   * Zahlung, auf die sie sich ueber [HpsRefundOptions.originalTransactionId]
   * referenziert.
   */
  async function refund(refundOptions: HpsRefundOptions): Promise<HpsPaymentResult> {
    const id = refundOptions.transactionId ?? newHpsTransactionId();
    const steps: string[] = [];

    // Das try liegt bewusst ENG um den Netzweg -- siehe Begruendung in [pay].
    let res: HpsTransactionResponse | undefined;
    try {
      res = await client.refund({
        ...target,
        transactionId: id,
        originalTransactionId: refundOptions.originalTransactionId,
        amountCents: refundOptions.amountCents,
        reference: refundOptions.reference,
        currency: refundOptions.currency,
        language: refundOptions.language,
      });
    } catch (e) {
      if (e instanceof HpsPreflightError) {
        throw e;
      }
      const busy = fromTerminalBusy(e, id, steps);
      if (busy) return busy;
      steps.push(`Gutschrift abgebrochen: ${describe(e)}`);
      noteUnexpected(e, id);
    }

    if (res) {
      const settled = fromResponse(res, id, steps);
      if (settled) return settled;
      steps.push(offeneAntwort(res));
    }

    // Dieselbe Klaerfunktion wie [pay]: die Kennung ist die des NEUEN
    // Vorgangs, eine Statusabfrage darauf liefert also genau dessen Ausgang,
    // und der Abbruch ist derselbe Diskriminator wie bei einer Zahlung.
    return resolve(id, steps);
  }

  /**
   * Aufhebung (Storno/Void) einer bestehenden Zahlung mit geklaertem Ausgang.
   *
   * [transactionId] ist die vom TERMINAL vergebene Kennung der
   * URSPRUENGLICHEN Zahlung -- nicht die eines neuen Vorgangs. Der direkte
   * Antwortweg wird trotzdem ueber [fromCancelResponse] eingeordnet: die
   * Direktantwort auf einen Aufhebungs-Request traegt einen eigenen
   * `responseCode` fuer die Aufhebung selbst. Erst wenn dieser direkte Weg
   * abbricht und nachgefragt werden muss, aendert sich die Frage -- siehe
   * [resolveCancel].
   */
  async function cancel(cancelOptions: HpsCancelOptions): Promise<HpsPaymentResult> {
    const id = cancelOptions.transactionId;
    const steps: string[] = [];

    let res: HpsTransactionResponse | undefined;
    try {
      res = await client.cancel({
        ...target,
        transactionId: id,
        amountCents: cancelOptions.amountCents,
        currency: cancelOptions.currency,
        language: cancelOptions.language,
      });
    } catch (e) {
      if (e instanceof HpsPreflightError) {
        throw e;
      }
      const busy = fromTerminalBusy(e, id, steps);
      if (busy) return busy;
      steps.push(`Aufhebung abgebrochen: ${describe(e)}`);
      noteUnexpected(e, id);
    }

    if (res) {
      const settled = fromCancelResponse(res, id, steps);
      if (settled) return settled;
      // Kein Sammel-Eintrag fuer 9011: [fromCancelResponse] hat dafuer
      // bereits den zutreffenden Eintrag gesetzt.
      if (!isCanceled(res)) steps.push(offeneAntwort(res));
    }

    return resolveCancel(id, steps);
  }

  return { pay, refund, cancel };
}
