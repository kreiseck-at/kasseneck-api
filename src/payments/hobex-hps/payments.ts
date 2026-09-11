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
  hpsCodeInfo,
  hpsCodeReason,
  isApproved,
  isCanceled,
  isConclusive,
  isConclusiveAsStatus,
  isHostUncertain,
  isNoStatement,
  isNotAbortable,
  isTechnicalError,
  isUnknownCode,
  NOT_ABORTABLE_CODE,
  NOT_FOUND_CODE,
  TECHNICAL_ERROR_CODE,
  TRANSACTION_CANCELED_CODE,
  type HpsCodeReason,
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
 *
 * ## Stoerung beim Host: die Klaerung darf nichts schliessen (11.09.2026)
 *
 * Die Antwortcodeliste von hobex benennt Codes, bei denen der Host beteiligt
 * war und das Terminal NICHT selbst storniert (`effect: 'hostUncertain'`,
 * etwa `100007`). Fuer sie gilt zweierlei:
 *
 * 1. Die Zwei-9027-Regel ([ausGeschlossenerAntwort]) greift nicht. Sie
 *    schliesst aus "das Terminal hat geantwortet und nichts gespeichert" auf
 *    "nichts belastet" -- das stimmt fuer einen Vorgang, der am Terminal
 *    endete, aber nicht fuer einen, dessen Ausgang beim Host liegt. Dasselbe
 *    gilt sinngemaess fuer [cancel]: ein unveraendertes `'0'` auf die
 *    Originalzahlung beweist dann nicht, dass die Aufhebung beim Host nicht
 *    ankam.
 * 2. Die Klaerung wartet trotzdem nicht das ganze Budget ab. Sagt die
 *    Statusabfrage zweimal in Folge nichts Neues (`9027` oder erneut ein
 *    solcher Code), endet sie sofort als `unresolved` -- das Terminal wird es
 *    auch in 90 Sekunden nicht wissen. Meldet sie dagegen `'0'`, ist die
 *    Zahlung genehmigt, ganz normal.
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
    return { outcome: 'declined', transactionId: id, reason: 'terminalBusy', steps: [...steps] };
  }

  /**
   * Benennt einen Code mit `effect: 'hostUncertain'` fuer den Nachweis: was
   * das Terminal meldet, mit Code und hobex-Titel. Die Folgerung setzt der
   * Aufrufer dazu.
   */
  function stoerung(res: HpsTransactionResponse): string {
    const info = hpsCodeInfo(res.responseCode)!;
    const was = info.reason === 'internalError'
      ? 'interner Fehler des Terminals'
      : 'Stoerung zwischen Terminal und hobex-Host, das Terminal storniert nicht selbst';
    return `Terminal meldet ${was} (${info.code} "${info.title}")`;
  }

  /**
   * Der Grund eines offenen Ausgangs. [antwort] ist die Antwort auf die
   * ERZEUGENDE Anfrage (oder die zuerst gemeldete Stoerung), [letzte] die
   * zuletzt gelesene Statusabfrage. Eine Stoerung beim Host geht vor; sonst
   * erklaert der Code der erzeugenden Anfrage mehr als ein `9027` danach.
   */
  function offenerGrund(
    antwort: HpsTransactionResponse | undefined,
    letzte: HpsTransactionResponse | undefined,
  ): HpsCodeReason | undefined {
    if (antwort && isHostUncertain(antwort)) return hpsCodeReason(antwort.responseCode);
    if (letzte && isHostUncertain(letzte)) return hpsCodeReason(letzte.responseCode);
    if (antwort?.responseCode !== undefined) return hpsCodeReason(antwort.responseCode);
    return hpsCodeReason(letzte?.responseCode);
  }

  /** Verlaufseintrag fuer eine direkte Antwort, die den Ausgang NICHT festschreibt. */
  function offeneAntwort(res: HpsTransactionResponse): string {
    if (res.responseCode === undefined) {
      return 'Antwort ohne Ergebniscode -- Ausgang wird geklaert';
    }
    if (isTechnicalError(res)) {
      return `Antwort mit technischem Fehler (${TECHNICAL_ERROR_CODE}) -- keine Aussage ueber den Vorgang, Ausgang wird geklaert`;
    }
    if (isHostUncertain(res)) {
      return `${stoerung(res)} -- ob belastet wurde, weiss das Terminal nicht, Ausgang wird geklaert`;
    }
    if (res.responseCode === NOT_FOUND_CODE) {
      return `Terminal kennt den Vorgang nicht (${res.responseCode} "Not Found") -- keine Aussage, Ausgang wird geklaert`;
    }
    if (isUnknownCode(res)) {
      return `Terminal nennt einen unbekannten Code (${res.responseCode})${klartext(res)} -- Ausgang wird geklaert`;
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
    if (isHostUncertain(status)) {
      return `Status: ${stoerung(status)} -- keine Aussage`;
    }
    // Bewusst NICHT "keine Auskunft": das Wort steht fuer das gemessene 9027,
    // und Aufrufer lesen es als solches (sastre, OpenCardPaymentService).
    if (status.responseCode === NOT_FOUND_CODE) {
      return `Status: Vorgang nicht gefunden (${status.responseCode}) -- keine Aussage`;
    }
    const info = hpsCodeInfo(status.responseCode);
    if (info?.rejectsRequest) {
      return `Status: Abfrage abgewiesen (${info.code} "${info.title}") -- keine Aussage ueber den Vorgang`;
    }
    if (info?.conclusive && !isApproved(status)) {
      // Nur erreichbar nach einer Stoerung beim Host, siehe [resolve].
      return `Status: abgelehnt (${info.code} "${info.title}") -- nach der Stoerung beim hobex-Host entscheidet nur eine Genehmigung`;
    }
    if (isUnknownCode(status)) {
      return `Status: unbekannter Code (${status.responseCode})${klartext(status)} -- keine Aussage`;
    }
    return null;
  }

  /**
   * Der Klartext des Terminals zu einem UNBEKANNTEN Code, als Zusatz fuer den
   * Nachweis -- oder leer, wenn keiner mitkam. Nur hier, nicht bei den
   * gemessenen Codes: deren Bedeutung ist benannt. Bei einem unbekannten Code
   * ist er dagegen das Einzige, was ein Mensch lesen kann -- "PIN falsch"
   * neben `55` haette am 02.09.2026 gereicht, um nicht "bezahlt" zu buchen.
   */
  function klartext(res: HpsTransactionResponse): string {
    const text = res.responseText?.trim();
    return text ? ` "${text}"` : '';
  }

  /**
   * Ordnet eine Terminal-Antwort ein. `null`, wenn sie nichts entscheidet.
   *
   * [aufhebung]: die Antwort gehoert zu [cancel]. Ein `'0'` heisst dort
   * "aufgehoben", und der Grund ist `'canceled'` statt `'approved'`.
   */
  function fromResponse(
    res: HpsTransactionResponse,
    id: string,
    steps: string[],
    aufhebung = false,
  ): HpsPaymentResult | null {
    if (!isConclusive(res)) return null;
    const approved = res.responseCode === '0';
    steps.push(
      approved
        ? 'Terminal: genehmigt'
        : `Terminal: abgelehnt (${res.responseCode} "${hpsCodeInfo(res.responseCode)!.title}")`,
    );
    emit('resolved', steps[steps.length - 1]!, id);
    return {
      outcome: approved ? 'approved' : 'declined',
      transactionId: id,
      response: res,
      reason: approved && aufhebung ? 'canceled' : hpsCodeReason(res.responseCode),
      steps: [...steps],
    };
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
    return fromResponse(res, id, steps, true);
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
      return { outcome: 'approved', transactionId: id, response: status, reason: 'canceled', steps: [...steps] };
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

  /**
   * [letzteAntwort] ist die letzte Antwort, die das Terminal in dieser
   * Klaerung gab -- als `lastResponse` fuer Anzeige und Katalog,
   * ausdruecklich NICHT als `response`. [grund] siehe [offenerGrund].
   */
  function open(
    id: string,
    steps: string[],
    letzteAntwort?: HpsTransactionResponse,
    grund?: HpsCodeReason,
  ): HpsPaymentResult {
    emit('resolved', steps[steps.length - 1]!, id);
    return {
      outcome: 'unresolved',
      transactionId: id,
      ...(letzteAntwort ? { lastResponse: letzteAntwort } : {}),
      ...(grund ? { reason: grund } : {}),
      steps: [...steps],
    };
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
    return { outcome: 'declined', transactionId: id, response: res, reason: 'aborted', steps: [...steps] };
  }

  /**
   * Klaert einen offenen Ausgang: erst abbrechen, dann abfragen -- bis das
   * Terminal etwas sagt oder das Budget aufgebraucht ist.
   *
   * [antwort] ist die Antwort auf die ERZEUGENDE Anfrage, sofern eine kam.
   * Traegt sie einen Ergebniscode, dessen Bedeutung wir nur nicht kennen, ist
   * der Vorgang am Geraet abgeschlossen -- und erst dadurch bekommt
   * `9027` beim Pollen einen Aussagewert, den es sonst nicht hat. Siehe
   * [ausGeschlossenerAntwort]. Meldet sie eine Stoerung beim Host
   * ([isHostUncertain]), bekommt `9027` diesen Aussagewert gerade NICHT --
   * siehe Klassendoku, "Stoerung beim Host".
   */
  async function resolve(
    id: string,
    steps: string[],
    antwort?: HpsTransactionResponse,
  ): Promise<HpsPaymentResult> {
    emit('resolving', 'Ausgang offen, Klaerung laeuft', id);

    const start = now();
    const elapsedMs = () => now() - start;
    const antwortMitCode = antwort?.responseCode !== undefined;
    // Einmal gemeldet, bleibt die Stoerung stehen -- auch wenn erst die
    // Statusabfrage sie nennt und danach 9027 kommt.
    let stoerungsAntwort = antwort && isHostUncertain(antwort) ? antwort : undefined;
    let letzteAntwort = antwort;

    if (stoerungsAntwort === undefined) {
      const aborted = await tryAbort(id, steps, elapsedMs);
      if (aborted) return aborted;
    } else {
      // Der Vorgang ist am Terminal schon beendet -- mit einer Stoerung beim
      // Host. Ein quittierter Abbruch bewiese nur, dass am Terminal nichts mehr
      // laeuft, nicht, dass der Host nichts belastet hat.
      steps.push('Kein Abbruchversuch -- das Terminal hat den Vorgang mit einer Stoerung beim hobex-Host beendet');
    }

    let wait = 0;
    let transportFailures = 0;
    let ohneAuskunft = 0;
    // Beantwortete Statusabfragen in Folge, die zu einem Vorgang mit
    // Host-Stoerung nichts Neues sagen.
    let stoerungOhneNeues = 0;

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
        letzteAntwort = status;
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

      if (isHostUncertain(status)) stoerungsAntwort ??= status;
      const hostUngewiss = stoerungsAntwort !== undefined;

      // Auf die Statusabfrage entscheidet nur ein Code, der den gesuchten
      // Vorgang beschreibt -- nicht einer, der diese Abfrage abweist
      // ([isConclusiveAsStatus]). Nach einer Stoerung beim Host entscheidet nur
      // noch eine Genehmigung: jede andere Aussage des Terminals betrifft seinen
      // Speicher, nicht den des Hosts.
      if (hostUngewiss ? isApproved(status) : isConclusiveAsStatus(status)) {
        const settled = fromResponse(status, id, steps);
        if (settled) return settled;
      }

      if (isNoStatement(status)) {
        ohneAuskunft += 1;
        if (!hostUngewiss) {
          const geklaert = ausGeschlossenerAntwort(id, steps, status, antwortMitCode ? antwort : undefined, ohneAuskunft);
          if (geklaert) return geklaert;
        }
      } else {
        ohneAuskunft = 0;
      }

      // Nach einer Stoerung ist jede Antwort ausser '0' (die oben schon
      // entschieden hat) "nichts Neues".
      stoerungOhneNeues = hostUngewiss ? stoerungOhneNeues + 1 : 0;

      steps.push(statusOhneErgebnis(status) ?? 'Status: noch kein Ergebniscode');

      if (stoerungOhneNeues >= 2) {
        // Siehe Klassendoku, "Stoerung beim Host": das Terminal weiss es
        // nicht, und es wird es auch nicht wissen, wenn wir weiterfragen.
        steps.push(
          'Statusabfrage zweimal ohne Neues nach einer Stoerung beim hobex-Host -- '
            + 'das Terminal kann nicht sagen, ob belastet wurde, Ausgang bleibt offen',
        );
        return open(id, steps, letzteAntwort, offenerGrund(stoerungsAntwort ?? antwort, letzteAntwort));
      }
      wait = nextWait(wait);
    }

    steps.push('Ausgang bleibt offen');
    return open(id, steps, letzteAntwort, offenerGrund(stoerungsAntwort ?? antwort, letzteAntwort));
  }

  /**
   * Liest `9027` beim Pollen als "nicht genehmigt" -- aber NUR, wenn das
   * Terminal die erzeugende Anfrage bereits mit einem Ergebniscode beantwortet
   * hat, und erst ab der ZWEITEN Abfrage in Folge.
   *
   * **Warum das ueberhaupt geht.** [NO_STATEMENT_CODE] ist sonst eine reine
   * Nicht-Aussage: dieselbe `9027` steht fuer einen laufenden, einen
   * abgebrochenen und einen nie gesehenen Vorgang. Hat das Terminal aber eine
   * Antwort MIT Code geliefert, faellt "laeuft noch" weg -- der Vorgang ist
   * dort beendet -- und "nie gesehen" ebenso, denn zu genau dieser Kennung
   * wurde uns gerade geantwortet. Uebrig bleibt "beendet und nicht genehmigt".
   *
   * **Gegenprobe** (28.08.2026, TID 3600335, jeweils nach abgeschlossenem
   * Vorgang): genehmigt (Beleg 408811) -> Statusabfrage `0`, dreimal
   * wiederholt; abgelehnt mit `100003` -> `9027`, zweimal; abgelehnt mit
   * `9003` -> `9027`. Eine genehmigte Zahlung antwortet also nicht `9027`.
   *
   * **Warum erst ab der zweiten Abfrage.** Die erste laeuft unmittelbar nach
   * der Antwort -- das Fenster, in dem der Datensatz am Terminal noch nicht
   * stehen koennte. Waere er es nicht und wir lesen `9027` als "abgelehnt",
   * entstuende die Doppelbelastung vom 24.08.2026 an einer neuen Stelle.
   * Dieselbe Absicherung traegt bereits [fromCancelStatus].
   *
   * [antwort] ist die Antwort MIT Code auf die erzeugende Anfrage -- oder
   * `undefined`, wenn keine kam; dann greift die Regel nicht. Ihr Code ergibt
   * den `reason`: er erklaert den Ausgang, das `9027` danach nicht. Der
   * Aufrufer ruft diese Regel NICHT fuer eine Stoerung beim Host.
   *
   * `undefined` heisst: nicht entschieden, weiter pollen.
   */
  function ausGeschlossenerAntwort(
    id: string,
    steps: string[],
    status: HpsTransactionResponse,
    antwort: HpsTransactionResponse | undefined,
    ohneAuskunft: number,
  ): HpsPaymentResult | undefined {
    if (!antwort) return undefined;
    if (ohneAuskunft < 2) return undefined;

    steps.push(
      `Statusabfrage zweimal ohne Auskunft (${status.responseCode}), obwohl das `
        + 'Terminal den Vorgang bereits beantwortet hatte -- er ist beendet und '
        + 'nicht genehmigt, es ist nichts belastet',
    );
    emit('resolved', steps[steps.length - 1]!, id);
    return {
      outcome: 'declined',
      transactionId: id,
      response: status,
      reason: hpsCodeReason(antwort.responseCode),
      steps: [...steps],
    };
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
   *
   * [antwort] ist die direkte Antwort auf den Aufhebungs-Request, sofern eine
   * kam. Meldete sie eine Stoerung beim Host, entscheidet ein unveraendertes
   * `'0'` nichts -- siehe Klassendoku, "Stoerung beim Host".
   */
  async function resolveCancel(
    id: string,
    steps: string[],
    antwort?: HpsTransactionResponse,
  ): Promise<HpsPaymentResult> {
    emit('resolving', 'Ausgang offen, Klaerung laeuft', id);

    const start = now();
    const elapsedMs = () => now() - start;
    const hostUngewiss = antwort !== undefined && isHostUncertain(antwort);
    let letzteAntwort = antwort;

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
        letzteAntwort = status;
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

      if (hostUngewiss && isApproved(status) && answeredQueries >= 2) {
        // Siehe Klassendoku, "Stoerung beim Host": das unveraenderte '0'
        // spiegelt nur den Speicher des Terminals. "Hat nicht gegriffen"
        // fuehrte nach dem Tagesabschluss zu einer Rueckerstattung, die der
        // Kunde doppelt bekaeme, falls der Host die Aufhebung doch verbucht hat.
        steps.push(
          'Terminal: Originalzahlung steht unveraendert (0), aber die Aufhebung endete mit einer '
            + 'Stoerung beim hobex-Host -- ob sie dort gewirkt hat, kann das Terminal nicht sagen, '
            + 'Ausgang bleibt offen',
        );
        return open(id, steps, letzteAntwort, offenerGrund(antwort, letzteAntwort));
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
    return open(id, steps, letzteAntwort, offenerGrund(antwort, letzteAntwort));
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

    return resolve(id, steps, res);
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
    return resolve(id, steps, res);
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

    return resolveCancel(id, steps, res);
  }

  return { pay, refund, cancel };
}
