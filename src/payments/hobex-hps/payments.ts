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
  APPROVED_CODE,
  HPS_CODES,
  hpsCodeInfo,
  hpsCodeReason,
  isApproved,
  isCanceled,
  isConclusive,
  isConclusiveAsStatus,
  isHostUncertain,
  isHostUncertainReason,
  isNoStatement,
  isNotAbortable,
  isTechnicalError,
  isUnknownCode,
  needsReversal,
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
 * des Terminals ungleich `'0'` ([isConclusive]) auf die Zahlung oder in der
 * Statusabfrage, der Zwei-9027-Regel nach einer Antwort MIT Code
 * ([ausGeschlossenerAntwort]), einem `9011` (aufgehoben) in der Statusabfrage
 * nach einem nachgeschickten Storno, oder dem gemessenen "Terminal
 * beschaeftigt"-Fall (HTTP 409 auf die ERZEUGENDE Anfrage, siehe
 * `errors.ts`, `HpsConnectTerminalError.isTerminalBusy`). Ein
 * Transportfehler, ein Zeitablauf, eine Wissensluecke, ein quittierter
 * Abbruch und ein quittiertes Storno fuehren NIE dorthin: keines davon ist
 * eine Aussage darueber, dass nichts belastet wurde. Genau diese
 * Verwechslung hat am 24.08.2026 eine echte Belastung als unbelastet
 * ausgewiesen und den Kunden ein zweites Mal belastet.
 *
 * ## Der Klaerweg
 *
 * Bleibt die Antwort auf eine Zahlung aus, oder sagt sie nichts:
 *
 * 1. [HpsConnectClient.abort] einmalig versuchen. Die Absicht: ein
 *    Kartenfluss, der noch auf die Karte wartet, soll enden, damit nach der
 *    Klaerung keine spaet aufgelegte Karte mehr belastet wird. Eine Garantie
 *    ist das nicht -- ob der Abbruch greift, sagt seine Quittung nicht.
 * 2. Die Antwort auf den Abbruch entscheidet NICHTS, auch `'0'` nicht (siehe
 *    "Ein quittierter Abbruch ist keine Aussage"). Sie steht nur im Nachweis.
 * 3. Dann die Statusabfrage pollen: `'0'` -> `approved`, mit der Antwort des
 *    Status als Beleg; ein schluessiger Code (etwa `9011` aufgehoben) ->
 *    `declined`; `9027` ist KEIN Ergebnis, sondern ein Grund weiterzumachen
 *    -- ausser nach einer Antwort MIT Code auf die Zahlung, siehe
 *    [ausGeschlossenerAntwort].
 * 4. Budget erschoepft -> `unresolved`.
 *
 * Der Abbruchversuch ist auf einen Bruchteil des Klaerbudgets gedeckelt
 * ([ABORT_BUDGET_DIVISOR]), sonst friesst ein haengender Abbruch die ganze
 * Klaerung.
 *
 * Die Kennung ist in JEDEM Ergebnis gesetzt, auch bei `'unresolved'`.
 *
 * ## Ein quittierter Abbruch ist keine Aussage (10.11.2026)
 *
 * Bis 1.35.0 hiess `'0'` auf den Abbruch "der Vorgang war noch abbrechbar,
 * es ist nichts belastet" -- geschlossen aus einer Messung vom 26.08.2026, bei
 * der der Abbruch WAEHREND des Wartens auf die Karte kam und die Zahlung
 * danach mit `100002` "Aborted" endete. Am 10.11.2026 widerlegt (TID 3600335,
 * HPS 1.14.4, Firmware 7.3.6, Testsystem): Abbruch vier Sekunden nach dem
 * Start einer Zahlung ueber 0,01 EUR, nach 0,18 s quittiert mit `'0'`
 * "Authorized" -- und die laufende Zahlung endete trotzdem GENEHMIGT
 * (kontaktlos), die Statusabfrage danach ebenso. `'0'`
 * heisst also nur, dass das Terminal die Abbruch-Anfrage angenommen hat,
 * nicht, dass die Zahlung abgebrochen ist. Als `declined` gelesen, haette die
 * Kasse "nichts belastet, noch einmal versuchen" gemeldet: der Weg zur
 * Doppelbelastung vom 24.08.2026.
 *
 * Auch ein `9027` kurz nach einem angenommenen Abbruch ist keine Aussage:
 * solange eine Zahlung laeuft, antwortet die Statusabfrage `9027` (gemessen
 * 26.08.2026), und dass sie nach einem angenommenen Abbruch weiterlaufen kann,
 * zeigt die Messung oben. Wie lange danach noch eine Genehmigung kommen kann,
 * ist ungemessen. Ohne Antwort mit Code auf die Zahlung endet ein Abbruch mit
 * anhaltendem `9027` deshalb bei `unresolved`, nicht bei `declined`.
 *
 * Bricht die KASSE eine laufende Zahlung ab (eigener Aufruf von
 * [HpsConnectClient.abort], waehrend [pay] noch auf die Antwort wartet),
 * entscheidet die Antwort auf die Zahlung selbst -- `approved`, wenn sie
 * genehmigt meldet, `declined` mit `100002`. [pay] liest die Quittung dieses
 * fremden Abbruchs nicht.
 *
 * ## [refund] bekommt EXAKT denselben Klaerweg wie [pay]
 *
 * Abbruch eingeschlossen. Die Kennung ist bei [refund] die des NEUEN Vorgangs
 * (der Gutschrift selbst), eine Statusabfrage darauf liefert also genau deren
 * Ausgang -- deshalb reicht dieselbe [resolve]-Funktion unveraendert. Am
 * 26.08.2026 gemessen: `abort` auf eine LAUFENDE Gutschrift antwortet
 * ebenfalls mit `responseCode '0'`, und die Gutschrift endete daraufhin mit
 * `100002` "Aborted". Wie bei der Zahlung beweist die Quittung allein nichts:
 * eine Gutschrift, die nach dem angenommenen Abbruch doch durchgeht, als
 * `declined` zu melden, laedt zu einer zweiten Gutschrift ein. Bleibt die
 * Statusabfrage danach bei `9027`, endet die Klaerung bei `unresolved`.
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
 *
 * ## Storno nach ausbleibender Host-Antwort (16.09.2026)
 *
 * Fuer einen Teil dieser Codes -- der Host hat nicht oder nicht brauchbar
 * geantwortet, etwa `9908` -- gibt hobex vor, ein Storno nachzuschicken
 * (`sendReversal`). [pay] tut das genau einmal, mit der Kennung der Zahlung
 * und dem Betrag, den das Terminal belastet: Betrag UND Trinkgeld (wie die
 * Rueckbuchung der Web-Kasse). Danach laeuft immer die Statusabfrage:
 *
 * - `9011` (aufgehoben) -> `declined`, die einzige Stelle, an der nach einem
 *   Storno ein Ausgang feststeht: mit `'voidedAfterHostFault'`, wenn das
 *   Storno gewirkt haben kann, sonst mit `'canceled'` -- dann hat etwas
 *   anderes die Zahlung aufgehoben.
 * - Ist das Storno nicht sicher abgewiesen ([StornoAusgang]: quittiert mit
 *   `'0'`, abgerissen, ohne Code, mit einem unbekannten oder einem
 *   Storniert-Code wie `8009`), ist auch `'0'` in der Statusabfrage keine
 *   Aussage: das Storno kann noch unterwegs sein, oder es hat nicht
 *   gegriffen. Sie zaehlt dann wie `9027` als "nichts Neues", und nach zwei
 *   solchen Antworten endet die Klaerung als `unresolved`.
 * - Nur wenn das Storno nach einer ausdruecklichen Positivliste NICHT
 *   ausgefuehrt wurde (nicht gesendet, nicht angenommen, abgewiesen -- siehe
 *   [stornoAbgewiesen]), ist `'0'` in der Statusabfrage `approved`. Gemessen
 *   ist davon nur `9002` auf eine unbekannte Kennung (27.08.2026); die
 *   uebrigen Eintraege stuetzen sich auf die Codeliste von hobex und TECS.
 *
 * Die Quittung `'0'` auf das Storno allein beweist nichts -- dieselbe Lehre
 * wie beim Abbruch (10.11.2026). Am Geraet ungemessen sind das Storno nach
 * einer Host-Stoerung und der Stornobetrag mit Trinkgeld, siehe
 * Dart-Zwilling. [refund] schickt kein Storno nach (TECS: `9031`), [cancel]
 * ist selbst eines.
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

export interface HpsClarifyOptions {
  /** Kennung der Zahlung aus [HpsPayments.pay] -- keine Gutschrift, keine Aufhebung. */
  transactionId: string;
  /**
   * Was ueber die bisherige Klaerung dieser Zahlung feststeht. Davon haengt
   * ab, was eine Antwort des Terminals jetzt noch beweist, siehe
   * [HpsPayments.clarifyPayment]:
   *
   * - das `unresolved`-Ergebnis von [HpsPayments.pay] (es zaehlen `reason` und
   *   `clarified`). NIE das Ergebnis einer Nachfrage: dessen `reason` stammt
   *   aus der Nachfrage, nicht aus der Zahlung, und wuerde eine unbekannte
   *   Vorgeschichte reinwaschen -- ein mit `clarified` markiertes Ergebnis
   *   zaehlt deshalb wie `null`;
   * - `'beforeResolve'`: die Zahlung wurde gestartet, ihre Klaerung hat aber
   *   nie begonnen -- etwa weil die Seite waehrend des Kartenflows abriss. Es
   *   wurde dann sicher kein Storno nachgeschickt. Nur angeben, wenn das
   *   Beobachter-Ereignis `resolving` nachweislich nie kam (es wird vor dem
   *   ersten Abbruch- oder Storno-Aufruf gemeldet); im Zweifel `null`;
   * - `null`: nicht bekannt (etwa ein Eintrag aus einer aelteren Fassung, oder
   *   die Seite riss waehrend der Klaerung ab).
   */
  previous: Pick<HpsPaymentResult, 'reason' | 'clarified'> | 'beforeResolve' | null;
}

export interface HpsPayments {
  pay(options: HpsPaymentOptions): Promise<HpsPaymentResult>;
  /** Gutschrift, geklaert wie [pay] -- siehe Klassendoku oben. */
  refund(options: HpsRefundOptions): Promise<HpsPaymentResult>;
  /** Aufhebung (Storno/Void) einer bestehenden Zahlung -- eigener Klaerweg, siehe Klassendoku oben. */
  cancel(options: HpsCancelOptions): Promise<HpsPaymentResult>;
  /**
   * Fragt den Ausgang einer Zahlung SPAETER noch einmal ab -- etwa wenn der
   * Kassier eine unklare Karte klaert. Liest nur: kein Abbruch, kein Storno,
   * kein neuer Vorgang. Das Ergebnis hat dieselbe Form wie das von [pay].
   *
   * Entschieden wird nur, was nach [HpsClarifyOptions.previous] feststeht
   * ([nachfrageRegel]):
   *
   * | bisher | `'0'` | `9011` | andere Ablehnung |
   * |---|---|---|---|
   * | `'beforeResolve'`, oder offen ohne Stoerung beim Host | `approved` | `declined` | `declined` |
   * | Stoerung beim Host, Storno sicher versucht (`hostFault`, `hostTimeout`) | offen | `declined` | offen |
   * | andere Stoerung beim Host | offen | offen | offen |
   * | `null` oder Ergebnis einer Nachfrage (`clarified`) | offen | offen | offen |
   *
   * Nach einer Stoerung beim Host kann die Klaerung von [pay] ein Storno
   * nachgeschickt haben -- auch wenn der erste Code keines verlangte, denn
   * ein spaeterer Status kann es noch ausloesen. Ein `'0'` beweist dann
   * nichts (siehe Klassendoku, "Storno nach ausbleibender Host-Antwort").
   * `9011` (aufgehoben) heisst nur dann sicher "nichts belastet", wenn ein
   * Storno sicher versucht wurde -- wie in der Klaerung von [pay]. `9027`
   * bleibt hier immer ohne Aussage: die Zwei-9027-Regel braucht die Antwort
   * auf die Zahlung selbst. Meldet der Status selbst eine Stoerung beim
   * Host, entscheidet danach nur noch `'0'`.
   *
   * Sagt der Status zweimal in Folge nichts, endet die Nachfrage sofort als
   * `unresolved` -- die Zahlung ist laengst beendet, das Terminal wird es
   * auch spaeter nicht wissen. Budget: ein Sechstel von
   * [HpsPaymentsOptions.resolveBudgetMs] (Vorgabe 15 s).
   */
  clarifyPayment(options: HpsClarifyOptions): Promise<HpsPaymentResult>;
}

/** Teiler, mit dem das Abbruchbudget aus [HpsPaymentsOptions.resolveBudgetMs] entsteht. */
const ABORT_BUDGET_DIVISOR = 6;

/** Teiler fuer das Budget von [HpsPayments.clarifyPayment]: bei der Vorgabe 15 s. */
const CLARIFY_BUDGET_DIVISOR = 6;

/** Welche Antworten eine spaete Nachfrage entscheiden duerfen, siehe [HpsPayments.clarifyPayment]. */
interface NachfrageRegel {
  /** `'0'` heisst belastet. */
  readonly genehmigt: boolean;
  /** `9011` heisst nichts belastet. */
  readonly aufgehoben: boolean;
  /** Jeder andere schluessige Code ungleich `'0'` heisst nichts belastet. */
  readonly abgelehnt: boolean;
}

/**
 * `true`, wenn die Klaerung von [HpsPayments.pay] bei diesem Grund sicher ein
 * Storno versucht hat: der Grund kommt von der ersten Stoerung beim Host
 * ([offenerGrund]), und JEDER Code mit diesem Grund verlangt ein Storno. Aus
 * der Tabelle gerechnet, damit ein neuer Code ohne Storno die Regel nicht
 * still bricht.
 */
function stornoSicherVersucht(reason: HpsCodeReason): boolean {
  const codes = HPS_CODES.filter((c) => c.reason === reason);
  return codes.length > 0 && codes.every((c) => c.sendReversal);
}

/** Siehe Tabelle an [HpsPayments.clarifyPayment]. */
function nachfrageRegel(previous: HpsClarifyOptions['previous']): NachfrageRegel {
  if (previous === null || (previous !== 'beforeResolve' && previous.clarified === true)) {
    return { genehmigt: false, aufgehoben: false, abgelehnt: false };
  }
  if (previous === 'beforeResolve') return { genehmigt: true, aufgehoben: true, abgelehnt: true };
  const reason = previous.reason;
  if (reason !== undefined && isHostUncertainReason(reason)) {
    return { genehmigt: false, aufgehoben: stornoSicherVersucht(reason), abgelehnt: false };
  }
  return { genehmigt: true, aufgehoben: true, abgelehnt: true };
}

/**
 * Teiler fuer das Budget des nachgeschickten Stornos: ein Drittel, bei der
 * Vorgabe 30 s. Ein Storno geht ueber den Host und darf Sekunden brauchen.
 */
const REVERSAL_BUDGET_DIVISOR = 3;

/**
 * Was ein nachgeschicktes Storno bewirkt haben kann, siehe Klassendoku,
 * "Storno nach ausbleibender Host-Antwort":
 * - `nichtGesendet`: keines gesendet (Gutschrift ohne Betrag) oder von
 *   Connect vor jedem Terminal-Kontakt abgewiesen ([HpsPreflightError]).
 * - `abgewiesen`: das Terminal hat es nachweislich nicht ausgefuehrt
 *   (HTTP 409 oder ein Code aus [stornoAbgewiesen]).
 * - `kannGewirkt`: alles andere -- auch die Quittung `'0'`.
 */
type StornoAusgang = 'nichtGesendet' | 'abgewiesen' | 'kannGewirkt';

/**
 * Gruende, die ein Storno als NICHT ausgefuehrt ausweisen -- Teil der
 * Positivliste in [stornoAbgewiesen], jeder Eintrag einzeln begruendet:
 * - `cancelDenied` (`9023` "Cancel Denied, TX already cleared", `9222`
 *   "Offline Tx Cancellation Denied"): TECS lehnt genau diese Aufhebung ab.
 * - `amountInvalid` (`9003`, `100019` gemessen an Zahlungen, `9012`, `9026`,
 *   `13`, `64`, `87`, `3031` dokumentiert): der Vorgang ueber diesen Betrag
 *   wird abgewiesen und nicht ausgefuehrt.
 */
const STORNO_ABGEWIESEN_GRUENDE: ReadonlySet<HpsCodeReason> = new Set<HpsCodeReason>(['cancelDenied', 'amountInvalid']);

/**
 * `true` nur, wenn die Antwort auf das Storno nach einer AUSDRUECKLICHEN
 * Positivliste sagt, dass es nicht ausgefuehrt wurde:
 *
 * - jeder schluessige Code mit `rejectsRequest` -- die Anfrage selbst wurde
 *   abgewiesen (Form, TID, Vorgangstyp, Geraetezustand, `100998`/`8014`
 *   "beschaeftigt"), bevor etwas geschah. Gemessen ist davon `9002` "Invalid
 *   Transaction" auf eine unbekannte Kennung (27.08.2026); die uebrigen stehen
 *   so in der Codeliste von hobex bzw. TECS.
 * - jeder Code mit einem Grund aus [STORNO_ABGEWIESEN_GRUENDE].
 *
 * Alles andere kann gewirkt haben, ausdruecklich auch ein Code, der selbst
 * "storniert" oder "aufgehoben" heisst (`8009` "Technical cancellation",
 * `100029`, `3053`-`3063` "Reversed internally", `9032` "reversed
 * automatically", `9011`), ein Abbruch-Code (`100002`, `17`, `8004`), eine
 * Host-Ablehnung (etwa `05`) und jeder unbekannte Code.
 */
function stornoAbgewiesen(res: HpsTransactionResponse): boolean {
  const info = hpsCodeInfo(res.responseCode);
  if (info === undefined || !info.conclusive || info.code === APPROVED_CODE) return false;
  return info.rejectsRequest || STORNO_ABGEWIESEN_GRUENDE.has(info.reason);
}

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
  const reversalBudgetMs = Math.trunc(resolveBudgetMs / REVERSAL_BUDGET_DIVISOR);
  const clarifyBudgetMs = Math.trunc(resolveBudgetMs / CLARIFY_BUDGET_DIVISOR);

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
      : info.reason === 'approvedWithCondition'
        ? 'Genehmigung mit Vorbehalt'
        : info.reason === 'hostTimeout'
          ? 'keine rechtzeitige Antwort des hobex-Hosts, das Terminal storniert nicht selbst'
          : 'Stoerung zwischen Terminal und hobex-Host, das Terminal storniert nicht selbst';
    return `Terminal meldet ${was} (${res.responseCode} "${info.title}")`;
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
   * Schickt den Abbruch GENAU EINMAL und haelt im Nachweis fest, was das
   * Terminal darauf sagt. Entscheidet NIE ueber den Ausgang -- auch nicht mit
   * `'0'`, siehe Klassendoku, "Ein quittierter Abbruch ist keine Aussage". Der
   * Aufrufer fragt danach immer den Status ab.
   */
  async function tryAbort(id: string, steps: string[], elapsedMs: () => number): Promise<void> {
    let res: HpsTransactionResponse;
    try {
      res = await withinBudget(elapsedMs, () => client.abort({ ...target, transactionId: id }), abortBudgetMs);
    } catch (e) {
      // Siehe Dart-Zwilling: ein 404 hat zwei Lesarten, und wir kennen die
      // richtige nicht. Der Nachweistext benennt beide und behauptet keine.
      steps.push(
        e instanceof HpsConnectTerminalError && e.isNotFound
          ? 'Abbruch nicht bestaetigt (HTTP 404) -- das Terminal kennt entweder diesen Vorgang nicht '
            + 'oder den Abbruch-Endpunkt nicht; beides sagt nichts ueber die Zahlung, Ausgang wird abgefragt'
          : `Abbruch nicht bestaetigt (${describe(e)}) -- ob er wirkte, ist offen, Ausgang wird abgefragt`,
      );
      noteUnexpected(e, id);
      return;
    }
    steps.push(abbruchQuittung(res));
  }

  /** Nachweistext zur Antwort auf den Abbruch -- keiner davon schliesst auf den Ausgang. */
  function abbruchQuittung(res: HpsTransactionResponse): string {
    if (res.responseCode === undefined) {
      return 'Abbruch ohne Ergebniscode quittiert -- das beweist nichts, Ausgang wird abgefragt';
    }
    if (isApproved(res)) {
      return `Abbruch angenommen (${APPROVED_CODE}) -- das sagt nicht, ob belastet wurde (am 10.11.2026 `
        + 'endete eine Zahlung nach angenommenem Abbruch genehmigt), Ausgang wird abgefragt';
    }
    if (isNotAbortable(res)) {
      return `Abbruch abgelehnt (${NOT_ABORTABLE_CODE}) -- der Vorgang ist nicht mehr abbrechbar, Ausgang wird abgefragt`;
    }
    return `Abbruch abgelehnt (${res.responseCode}) -- Grund unbekannt, Ausgang wird abgefragt`;
  }

  /**
   * Schickt zu einer Zahlung, deren Host-Antwort ausblieb ([anlass] traegt
   * `sendReversal`), GENAU EINMAL ein Storno ueber [amountCents] nach
   * (Betrag samt Trinkgeld) und haelt im Nachweis fest, was das Terminal
   * darauf sagt. Entscheidet NIE ueber den Ausgang, siehe Klassendoku,
   * "Storno nach ausbleibender Host-Antwort".
   *
   * Liefert, was das Storno bewirkt haben kann ([StornoAusgang]).
   * `nichtGesendet` bei einem [HpsPreflightError]: Connect hat es vor jedem
   * Terminal-Kontakt abgewiesen, beweisbar ist nichts hinausgegangen (siehe
   * `errors.ts`). `abgewiesen` bei HTTP 409: das Terminal nimmt waehrend
   * eines anderen Vorgangs keine Anfrage an (gemessen, ohne Spur; dieselbe
   * Lesart wie fuer die erzeugende Anfrage in [fromTerminalBusy]).
   */
  async function sendReversal(
    id: string,
    steps: string[],
    elapsedMs: () => number,
    amountCents: number | undefined,
    anlass: HpsTransactionResponse,
  ): Promise<StornoAusgang> {
    if (amountCents === undefined) {
      steps.push('Kein Storno nachgeschickt -- die Aufhebung einer Gutschrift laesst TECS nicht zu');
      return 'nichtGesendet';
    }
    emit('resolving', `Storno wird nachgeschickt (${anlass.responseCode})`, id);
    let res: HpsTransactionResponse;
    try {
      res = await withinBudget(
        elapsedMs,
        () => client.cancel({ ...target, transactionId: id, amountCents }),
        reversalBudgetMs,
      );
    } catch (e) {
      if (e instanceof HpsPreflightError) {
        steps.push(
          `Storno nicht gesendet (${describe(e)}) -- Kasseneck Connect hat es vor dem Terminal abgewiesen, `
            + 'es kann nicht gewirkt haben, Ausgang wird abgefragt',
        );
        return 'nichtGesendet';
      }
      if (e instanceof HpsConnectTerminalError && e.isTerminalBusy) {
        steps.push(
          'Storno nicht angenommen (HTTP 409) -- das Terminal war beschaeftigt, es kann nicht gewirkt haben, '
            + 'Ausgang wird abgefragt',
        );
        return 'abgewiesen';
      }
      steps.push(
        `Storno nachgeschickt, aber nicht bestaetigt (${describe(e)}) -- ob es wirkte, ist offen, Ausgang wird abgefragt`,
      );
      noteUnexpected(e, id);
      return 'kannGewirkt';
    }
    if (isApproved(res)) {
      steps.push(
        `Storno nachgeschickt und quittiert (${APPROVED_CODE}) -- das allein beweist nicht, dass die Zahlung `
          + 'aufgehoben ist, Ausgang wird abgefragt',
      );
      return 'kannGewirkt';
    }
    const titel = hpsCodeInfo(res.responseCode)?.title;
    const code = `${res.responseCode ?? 'ohne Ergebniscode'}${titel === undefined ? '' : ` "${titel}"`}`;
    if (stornoAbgewiesen(res)) {
      steps.push(`Storno abgewiesen (${code}) -- es wurde nicht ausgefuehrt, Ausgang wird abgefragt`);
      return 'abgewiesen';
    }
    steps.push(`Storno nachgeschickt, nicht bestaetigt (${code}) -- ob es wirkte, ist offen, Ausgang wird abgefragt`);
    return 'kannGewirkt';
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
   *
   * [stornoCents] ist, was ein nachgeschicktes Storno aufheben muss: Betrag
   * samt Trinkgeld der Zahlung. Nur [pay] setzt ihn; ohne ihn wird kein
   * Storno gesendet.
   */
  async function resolve(
    id: string,
    steps: string[],
    antwort?: HpsTransactionResponse,
    stornoCents?: number,
  ): Promise<HpsPaymentResult> {
    emit('resolving', 'Ausgang offen, Klaerung laeuft', id);

    const start = now();
    const elapsedMs = () => now() - start;
    const antwortMitCode = antwort?.responseCode !== undefined;
    // Einmal gemeldet, bleibt die Stoerung stehen -- auch wenn erst die
    // Statusabfrage sie nennt und danach 9027 kommt.
    let stoerungsAntwort = antwort && isHostUncertain(antwort) ? antwort : undefined;
    let letzteAntwort = antwort;
    // Das Storno wird hoechstens einmal erwogen; versucht wird es nur mit
    // Betrag, also nur fuer eine Zahlung.
    let stornoErwogen = false;
    let stornoVersucht = false;
    // Was das Storno bewirkt haben kann; `kannGewirkt` nimmt auch einer
    // Genehmigung in der Statusabfrage die Aussage.
    let storno: StornoAusgang | undefined;

    if (stoerungsAntwort === undefined) {
      // Entscheidet nichts, beendet nur einen noch wartenden Kartenfluss.
      await tryAbort(id, steps, elapsedMs);
    } else {
      // Der Vorgang ist am Terminal schon beendet -- mit einer Stoerung beim
      // Host. Es gibt nichts mehr abzubrechen, und eine Quittung saehe
      // ohnehin nur das Terminal, nicht den Host.
      steps.push('Kein Abbruchversuch -- das Terminal hat den Vorgang mit einer Stoerung beim hobex-Host beendet');
      if (needsReversal(stoerungsAntwort)) {
        stornoErwogen = true;
        stornoVersucht = stornoCents !== undefined;
        storno = await sendReversal(id, steps, elapsedMs, stornoCents, stoerungsAntwort);
      }
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

      if (stornoVersucht && isCanceled(status)) {
        // Aufgehoben ist aufgehoben. Wer es war, behauptet der Nachweis nur so
        // weit, wie es feststeht: hat das Storno nachweislich nicht gewirkt,
        // war es ein anderer Vorgang, und der Grund ist `canceled`.
        const durchsStorno = storno === 'kannGewirkt';
        steps.push(
          durchsStorno
            ? `Status: Zahlung aufgehoben (${TRANSACTION_CANCELED_CODE}) nach dem nachgeschickten Storno -- `
              + 'es ist nichts belastet'
            : `Status: Zahlung aufgehoben (${TRANSACTION_CANCELED_CODE}), obwohl das nachgeschickte Storno nicht `
              + 'ausgefuehrt wurde -- es ist nichts belastet',
        );
        emit('resolved', steps[steps.length - 1]!, id);
        return {
          outcome: 'declined',
          transactionId: id,
          response: status,
          reason: durchsStorno ? 'voidedAfterHostFault' : 'canceled',
          steps: [...steps],
        };
      }

      if (!stornoErwogen && needsReversal(status)) {
        // Die Zahlung selbst kam ohne Antwort zurueck, erst die Statusabfrage
        // nennt die ausgebliebene Host-Antwort -- dasselbe Storno wie oben.
        steps.push(statusOhneErgebnis(status)!);
        stornoErwogen = true;
        stornoVersucht = stornoCents !== undefined;
        storno = await sendReversal(id, steps, elapsedMs, stornoCents, status);
        wait = nextWait(wait);
        continue;
      }

      // Nach einem Storno, das gewirkt haben kann, sagt auch '0' nichts: das
      // Storno kann noch unterwegs sein oder nicht gegriffen haben. Es zaehlt
      // unten als "nichts Neues" -- siehe Klassendoku, "Storno nach
      // ausbleibender Host-Antwort".
      const genehmigtTrotzStorno = storno === 'kannGewirkt' && isApproved(status);

      // Auf die Statusabfrage entscheidet nur ein Code, der den gesuchten
      // Vorgang beschreibt -- nicht einer, der diese Abfrage abweist
      // ([isConclusiveAsStatus]). Nach einer Stoerung beim Host entscheidet nur
      // noch eine Genehmigung: jede andere Aussage des Terminals betrifft seinen
      // Speicher, nicht den des Hosts.
      if (!genehmigtTrotzStorno && (hostUngewiss ? isApproved(status) : isConclusiveAsStatus(status))) {
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
      // entschieden hat) "nichts Neues" -- nach einem Storno auch '0'.
      stoerungOhneNeues = hostUngewiss ? stoerungOhneNeues + 1 : 0;

      steps.push(
        genehmigtTrotzStorno
          ? `Status: Zahlung steht unveraendert (${APPROVED_CODE}) -- das nachgeschickte Storno kann noch `
            + 'unterwegs sein oder nicht gegriffen haben, keine Aussage'
          : statusOhneErgebnis(status) ?? 'Status: noch kein Ergebniscode',
      );

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
   * Vorgang): genehmigt -> Statusabfrage `0`, dreimal
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

    // Ein Storno hebt auf, was das Terminal belastet hat: Betrag UND Trinkgeld.
    return resolve(id, steps, res, paymentOptions.amountCents + (paymentOptions.tipCents ?? 0));
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
    // Vorgangs, eine Statusabfrage darauf liefert also genau dessen Ausgang.
    // Der Abbruch entscheidet hier so wenig wie bei einer Zahlung, und ohne
    // Betrag schickt die Klaerung kein Storno nach.
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

  /**
   * Spaete Nachfrage zu einer Zahlung, siehe [HpsPayments.clarifyPayment].
   * Liest nur den Status -- nie ein Abbruch, nie ein Storno. Wirft wie [pay]
   * nur [HpsPreflightError]: Connect hat die Abfrage abgewiesen, bevor sie
   * das Terminal erreichte (etwa `terminal_unreachable`).
   */
  async function clarifyPayment(clarifyOptions: HpsClarifyOptions): Promise<HpsPaymentResult> {
    const id = clarifyOptions.transactionId;
    const previous = clarifyOptions.previous;
    const regel = nachfrageRegel(previous);
    // Ein Nachfrage-Ergebnis als Vorgeschichte zaehlt wie "nicht bekannt" --
    // auch sein `reason` (siehe [HpsPaymentResult.clarified]).
    const vorgeschichteBekannt = previous !== null && (previous === 'beforeResolve' || previous.clarified !== true);
    const vorherGrund = vorgeschichteBekannt && typeof previous === 'object' ? previous.reason : undefined;
    const vorherGestoert = vorherGrund !== undefined && isHostUncertainReason(vorherGrund);
    const steps: string[] = [nachfrageAnfang(previous, regel)];
    emit('resolving', steps[0]!, id);

    const start = now();
    const elapsedMs = () => now() - start;
    let wait = 0;
    let transportFailures = 0;
    let ohneAussage = 0;
    // Die erste Stoerung beim Host, die der Status in DIESER Nachfrage meldet.
    let stoerung: HpsTransactionResponse | undefined;
    let letzteAntwort: HpsTransactionResponse | undefined;

    const offen = (): HpsPaymentResult => ({
      ...open(id, steps, letzteAntwort, vorherGrund ?? offenerGrund(stoerung, letzteAntwort)),
      clarified: true,
    });

    /** Warum eine Antwort, die sonst entschiede, hier nichts sagt. */
    const vorbehalt = (): string => {
      if (!vorgeschichteBekannt) return 'der bisherige Klaerweg ist nicht bekannt, ein Storno kann nachgeschickt sein';
      if (vorherGestoert) return `nach der Stoerung beim hobex-Host (${vorherGrund}) kann ein Storno nachgeschickt sein`;
      return 'das Terminal meldet eine Stoerung beim hobex-Host';
    };

    while (elapsedMs() < clarifyBudgetMs) {
      if (wait > 0) {
        await sleep(Math.min(wait, clarifyBudgetMs - elapsedMs()));
        if (elapsedMs() >= clarifyBudgetMs) break;
      }

      let status: HpsTransactionResponse;
      try {
        status = await withinBudget(
          elapsedMs,
          () => client.status({ ...target, transactionId: id }),
          clarifyBudgetMs - elapsedMs(),
        );
        transportFailures = 0;
        letzteAntwort = status;
      } catch (e) {
        if (e instanceof HpsPreflightError) throw e;
        transportFailures += 1;
        steps.push(`Statusabfrage gescheitert (${transportFailures}): ${describe(e)}`);
        noteUnexpected(e, id);
        if (transportFailures >= maxTransportFailures) {
          steps.push('Terminal antwortet nicht -- Ausgang bleibt offen');
          return offen();
        }
        wait = nextWait(wait);
        continue;
      }

      if (isHostUncertain(status)) stoerung ??= status;
      // Wie in [resolve]: nach einer Stoerung beim Host -- vorher oder jetzt
      // gemeldet -- entscheidet hoechstens noch die Genehmigung.
      const gestoert = vorherGestoert || stoerung !== undefined;

      if (isApproved(status)) {
        if (regel.genehmigt) {
          const settled = fromResponse(status, id, steps);
          if (settled) return { ...settled, clarified: true };
        }
        steps.push(`Status: genehmigt (${APPROVED_CODE}) -- ${vorbehalt()}, keine Aussage`);
      } else if (isCanceled(status) && regel.aufgehoben && (vorherGestoert || stoerung === undefined)) {
        steps.push(`Status: Zahlung aufgehoben (${TRANSACTION_CANCELED_CODE}) -- es ist nichts belastet`);
        emit('resolved', steps[steps.length - 1]!, id);
        return { outcome: 'declined', transactionId: id, response: status, reason: 'canceled', clarified: true, steps: [...steps] };
      } else if (regel.abgelehnt && !gestoert && isConclusiveAsStatus(status)) {
        const settled = fromResponse(status, id, steps);
        if (settled) return { ...settled, clarified: true };
      } else if (isConclusiveAsStatus(status)) {
        const info = hpsCodeInfo(status.responseCode)!;
        const was = isCanceled(status) ? 'aufgehoben' : 'abgelehnt';
        steps.push(`Status: ${was} (${info.code} "${info.title}") -- ${vorbehalt()}, keine Aussage`);
      } else {
        steps.push(statusOhneErgebnis(status) ?? 'Status: noch kein Ergebniscode');
      }

      ohneAussage += 1;
      if (ohneAussage >= 2) {
        steps.push('Statusabfrage zweimal ohne Aussage -- das Terminal kann es nicht sagen, Ausgang bleibt offen');
        return offen();
      }
      wait = nextWait(wait);
    }

    steps.push('Ausgang bleibt offen');
    return offen();
  }

  return { pay, refund, cancel, clarifyPayment };
}

/** Erster Eintrag im Nachweis einer spaeten Nachfrage: was sie entscheiden darf. */
function nachfrageAnfang(previous: HpsClarifyOptions['previous'], regel: NachfrageRegel): string {
  const anfang = 'Spaete Nachfrage beim Terminal -- nur lesend, ohne Abbruch und ohne Storno';
  if (previous === null) return `${anfang}; der bisherige Klaerweg ist nicht bekannt, keine Antwort entscheidet`;
  if (previous !== 'beforeResolve' && previous.clarified === true) {
    return `${anfang}; als Vorgeschichte kam das Ergebnis einer frueheren Nachfrage, nicht das der Zahlung -- `
      + 'der Klaerweg der Zahlung bleibt unbekannt, keine Antwort entscheidet';
  }
  if (previous === 'beforeResolve') {
    return `${anfang}; die Klaerung der Zahlung hatte nicht begonnen, es wurde kein Storno nachgeschickt`;
  }
  if (previous.reason !== undefined && isHostUncertainReason(previous.reason)) {
    return regel.aufgehoben
      ? `${anfang}; nach der Stoerung beim hobex-Host (${previous.reason}) wurde ein Storno versucht, `
        + `entscheidet nur "aufgehoben" (${TRANSACTION_CANCELED_CODE})`
      : `${anfang}; nach der Stoerung beim hobex-Host (${previous.reason}) entscheidet keine Antwort`;
  }
  return `${anfang}; die Klaerung der Zahlung endete offen ohne Stoerung beim hobex-Host`;
}
