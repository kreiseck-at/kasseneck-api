/**
 * Antwort des hobex-HPS-Terminals auf eine Zahlung oder eine Statusabfrage,
 * durchgereicht von **Kasseneck Connect** (`POST /v1/terminal/payment`,
 * `/status`, `/abort` — Feld `hps` im Erfolgsrumpf). Connect ordnet nichts
 * ein, es reicht den Terminal-Rumpf roh durch — die Einordnung passiert hier.
 *
 * **Zwilling:** `kasseneck_api/lib/src/hobex_hps/transaction_response.dart`.
 * Beide Seiten pinnen dieselbe Codetabelle, siehe `HPS_CODES` unten
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
 * feststeht und in [HPS_CODES] benannt ist, zaehlt. Jeder andere —
 * auch ein neuer, heute noch unbekannter Code — ist eine Wissensluecke, siehe
 * [isUnknownCode]. Am 27.08.2026 hat der Dart-Zwilling gemessen, warum die
 * Gegenrichtung ("jeder Code ausser 9027 ist schluessig") gefaehrlich ist: ein
 * bis dahin unbenannter Code ([TECHNICAL_ERROR_CODE], `9900`) war darueber
 * schluessig und haette eine Zahlung, unter der tatsaechlich Geld geflossen
 * sein kann, als `declined` gemeldet.
 *
 * Seit 16.09.2026 kommt die TECS-Liste dazu (`tecs-codes.ts`): das HPS
 * reicht die Codes der TECS-Plattform durch, auf der hobex autorisiert. Neu
 * sind dabei [HpsCode.sendReversal] (Storno nachschicken, siehe
 * `payments.ts`) und die Schreibweise: TECS fuehrt `0055`, das Terminal
 * sendet `55` -- [normalizeHpsCode] macht beides zu einem Code.
 *
 * **Einen neuen Code aufnehmen:** Eintrag hier oder in `tecs-codes.ts`,
 * derselbe im Dart-Zwilling, `npm run fixtures:hobex-hps-codes`; ein neuer
 * Grund braucht in jeder Kasse eine Uebersetzung.
 */

import { TECS_CODES } from './tecs-codes.js';

/** Wie ein Ergebniscode den Ausgang eines Vorgangs bestimmt. */
export type HpsCodeEffect =
  /** Schreibt den Ausgang fest: `'0'` genehmigt, jeder andere abgelehnt. */
  | 'conclusive'
  /** Gemessen oder dokumentiert, aber KEINE Aussage (9027, 100011, fremde TECS-Produkte). */
  | 'noStatement'
  /**
   * Der Host war beteiligt, das Terminal storniert nicht selbst -- ob belastet
   * wurde, weiss das Terminal nicht. Weiterklaeren, aber ohne dass ein
   * spaeteres `9027` daraus "nichts belastet" machen darf (siehe `payments.ts`).
   */
  | 'hostUncertain';

/** Woher die Bedeutung eines Codes stammt. */
export type HpsCodeSource =
  /** Am Geraet gemessen (`doc/kartenzahlung.md` im Dart-Zwilling). */
  | 'measured'
  /**
   * Von hobex dokumentiert: HPS-Liste (11.09.2026) oder TECS-Liste
   * (16.09.2026, dann ist `tecsTitle` gesetzt).
   */
  | 'documented'
  /** Beides: gemessen und von hobex bestaetigt. */
  | 'measuredAndDocumented';

/**
 * Worauf eine Kasse reagiert -- der Grund hinter einem Ergebniscode. Mehrere
 * Codes teilen sich einen Grund, wenn am Tresen dasselbe zu tun ist
 * (`100004`, `100005`, `100012`: "Karte nicht gelesen, noch einmal"). Der Satz
 * fuer den Bediener steht in [HPS_REASON_HINTS]; eine Kasse mit eigener
 * Uebersetzung schluesselt ueber den Grund selbst.
 */
export type HpsCodeReason =
  | 'approved'
  | 'approvedWithCondition'
  | 'aborted'
  | 'noCard'
  | 'cardReadFailed'
  | 'cardDeclined'
  | 'issuerDeclined'
  | 'cardBlocked'
  | 'cardExpired'
  | 'insufficientFunds'
  | 'wrongPin'
  | 'pinTriesExceeded'
  | 'pinRequired'
  | 'amountInvalid'
  | 'tipNotSelected'
  | 'terminalBusy'
  | 'terminalBlocked'
  | 'terminalSetup'
  | 'acquirerSetup'
  | 'terminalFault'
  | 'requestRejected'
  | 'hostRejected'
  | 'hostUnavailable'
  | 'invalidTransaction'
  | 'refundPassword'
  | 'refundDisabled'
  | 'refundRejected'
  | 'hostTimeoutReversed'
  | 'reversedByHost'
  | 'voidedAfterHostFault'
  | 'hostFault'
  | 'hostTimeout'
  | 'internalError'
  | 'canceled'
  | 'cancelDenied'
  | 'originalDeclined'
  | 'notAbortable'
  | 'noStatement'
  | 'technicalError'
  | 'unknown';

/** Der Satz fuer den Bediener je Grund, deutsch. */
export const HPS_REASON_HINTS: Readonly<Record<HpsCodeReason, string>> = {
  approved:
    'Vom Terminal genehmigt.',
  approvedWithCondition:
    'Das Terminal meldet eine Genehmigung mit Vorbehalt (etwa nur über einen Teilbetrag). Ob und in welcher Höhe belastet wurde, bitte am Terminalbeleg prüfen — nicht erneut kassieren, bevor es geklärt ist.',
  aborted:
    'Der Vorgang wurde abgebrochen. Es wurde kein Geld bewegt.',
  noCard:
    'Es wurde keine Karte vorgehalten. Es wurde kein Geld bewegt — bitte erneut versuchen.',
  cardReadFailed:
    'Die Karte konnte nicht gelesen werden. Es wurde kein Geld bewegt — bitte erneut versuchen, notfalls die Karte stecken statt auflegen.',
  cardDeclined:
    'Die Karte wurde vom Terminal abgelehnt. Es wurde kein Geld bewegt — bitte eine andere Karte oder Zahlungsart verwenden.',
  issuerDeclined:
    'Die Zahlung wurde von der Bank abgelehnt. Es wurde kein Geld bewegt — bitte eine andere Karte oder Zahlungsart verwenden.',
  cardBlocked:
    'Die Karte ist gesperrt. Es wurde kein Geld bewegt — bitte eine andere Karte oder Zahlungsart verwenden.',
  cardExpired:
    'Die Karte ist abgelaufen. Es wurde kein Geld bewegt — bitte eine andere Karte oder Zahlungsart verwenden.',
  insufficientFunds:
    'Das Konto ist nicht gedeckt oder das Kartenlimit ist erreicht. Es wurde kein Geld bewegt — bitte eine andere Karte oder Zahlungsart verwenden.',
  wrongPin:
    'Die PIN war falsch. Es wurde kein Geld bewegt — bitte erneut versuchen.',
  pinTriesExceeded:
    'Die PIN wurde zu oft falsch eingegeben. Es wurde kein Geld bewegt — bitte eine andere Karte oder Zahlungsart verwenden.',
  pinRequired:
    'Die Bank verlangt die PIN. Es wurde kein Geld bewegt — bitte erneut versuchen, die Karte stecken und die PIN eingeben.',
  amountInvalid:
    'Das Terminal nimmt diesen Betrag nicht an. Es wurde kein Geld bewegt.',
  tipNotSelected:
    'Das Trinkgeld wurde nicht rechtzeitig gewählt. Es wurde kein Geld bewegt — bitte erneut versuchen.',
  terminalBusy:
    'Das Terminal ist noch mit einem anderen Vorgang beschäftigt. Es wurde kein Geld bewegt — kurz warten und erneut versuchen.',
  terminalBlocked:
    'Das Terminal ist gesperrt. Es wurde kein Geld bewegt — bitte hobex kontaktieren.',
  terminalSetup:
    'Das Terminal ist nicht richtig eingerichtet. Es wurde kein Geld bewegt — bitte die Terminal-ID in den Einstellungen prüfen, sonst hobex kontaktieren.',
  acquirerSetup:
    'hobex nimmt dieses Terminal oder diesen Händler so nicht an. Es wurde kein Geld bewegt — bitte hobex kontaktieren.',
  terminalFault:
    'Das Terminal meldet eine Störung. Es wurde kein Geld bewegt — bitte das Terminal neu starten und erneut versuchen.',
  requestRejected:
    'Das Terminal hat die Anfrage abgewiesen. Es wurde kein Geld bewegt — tritt das wieder auf, bitte den Support kontaktieren.',
  hostRejected:
    'hobex hat die Zahlung abgewiesen. Es wurde kein Geld bewegt — bitte erneut versuchen; tritt das wieder auf, hobex kontaktieren.',
  hostUnavailable:
    'Die Bank oder hobex ist gerade nicht erreichbar. Es wurde kein Geld bewegt — bitte später erneut versuchen oder eine andere Zahlungsart verwenden.',
  invalidTransaction:
    'Das Terminal kennt die ursprüngliche Zahlung nicht. Es wurde kein Geld bewegt.',
  refundPassword:
    'Das Passwort für die Gutschrift war falsch oder wurde nicht eingegeben. Es wurde nichts ausgezahlt.',
  refundDisabled:
    'Gutschriften sind an diesem Terminal abgeschaltet. Es wurde nichts ausgezahlt — bitte hobex kontaktieren.',
  refundRejected:
    'Die Gutschrift wurde abgewiesen (Betrag zu hoch, bereits erstattet oder zu viele Versuche). Es wurde nichts ausgezahlt.',
  hostTimeoutReversed:
    'hobex hat nicht rechtzeitig geantwortet, das Terminal hat den Vorgang selbst storniert. Es wird kein Geld bewegt — bitte erneut versuchen.',
  reversedByHost:
    'Die Zahlung wurde wegen einer Störung automatisch storniert. Es wurde kein Geld bewegt — bitte erneut versuchen.',
  voidedAfterHostFault:
    'hobex hat nicht sauber geantwortet, die Zahlung wurde deshalb sicherheitshalber storniert. Es wurde kein Geld bewegt — bitte erneut versuchen.',
  hostFault:
    'Die Verbindung zwischen Terminal und hobex ist gestört. Ob die Karte belastet wurde, weiß das Terminal nicht — bitte nicht erneut kassieren, bevor es geklärt ist.',
  hostTimeout:
    'hobex hat nicht rechtzeitig geantwortet. Ob die Karte belastet wurde, weiß das Terminal nicht — bitte nicht erneut kassieren, bevor es geklärt ist.',
  internalError:
    'Das Terminal meldet einen internen Fehler. Ob die Karte belastet wurde, ist unklar — bitte nicht erneut kassieren, bevor es geklärt ist.',
  canceled:
    'Die Zahlung ist aufgehoben.',
  cancelDenied:
    'Die Zahlung lässt sich nicht mehr aufheben und bleibt belastet — bitte stattdessen eine Gutschrift ausführen.',
  originalDeclined:
    'Die ursprüngliche Zahlung war abgelehnt; es gibt nichts aufzuheben.',
  notAbortable:
    'Der Vorgang ist bereits abgeschlossen und lässt sich nicht mehr abbrechen.',
  noStatement:
    'Das Terminal hat zu diesem Vorgang keine Auskunft.',
  technicalError:
    'Das Terminal meldet einen technischen Fehler; über den Vorgang sagt das nichts.',
  unknown:
    'Das Terminal nennt einen Code, dessen Bedeutung nicht bekannt ist.',
};

/**
 * Die Gruende hinter einem Code mit `effect: 'hostUncertain'`: ob (und wie
 * viel) Geld geflossen ist, weiss das Terminal nicht.
 */
export function isHostUncertainReason(reason: HpsCodeReason | undefined): boolean {
  return reason === 'approvedWithCondition'
    || reason === 'hostFault'
    || reason === 'hostTimeout'
    || reason === 'internalError';
}

/** Ein Ergebniscode, dessen Bedeutung feststeht (gemessen oder dokumentiert). */
export interface HpsMeasuredCode {
  /** Der Ergebniscode, wie ihn das Terminal im Feld `responseCode` sendet. */
  readonly code: string;
  /** Bedeutung — deutsch, ohne Umlaute (siehe Vorbild). */
  readonly meaning: string;
  /**
   * `true`: der Code schreibt einen Ausgang fest (Teil der Positivliste,
   * siehe [isConclusive]). `false`: benannt, aber KEINE Aussage ueber den
   * Vorgang -- oder ein ungewisser Host-Ausgang, siehe [HpsCode.effect].
   */
  readonly conclusive: boolean;
}

/** Ein Eintrag der vollstaendigen Codetabelle [HPS_CODES]. */
export interface HpsCode extends HpsMeasuredCode {
  /** Titel, wie hobex ihn fuehrt bzw. das Terminal als `responseText` sendet. */
  readonly title: string;
  readonly effect: HpsCodeEffect;
  readonly reason: HpsCodeReason;
  readonly source: HpsCodeSource;
  /**
   * Der Code weist die ANFRAGE selbst ab (TID, Form, Geraetezustand). Auf eine
   * Zahlung ist das deren Ablehnung; auf eine STATUSABFRAGE heisst es nur, dass
   * diese Abfrage nicht bedient wurde -- ueber den gesuchten Vorgang sagt es
   * nichts (gemessen fuer `100108`). Siehe [isConclusiveAsStatus].
   */
  readonly rejectsRequest: boolean;
  /**
   * Bei diesem Code wird ein Storno nachgeschickt: der Host hat nicht oder
   * nicht brauchbar geantwortet, und das Terminal nimmt den Vorgang nicht
   * selbst zurueck. Nur bei `effect: 'hostUncertain'`. Vorgabe von hobex
   * (16.09.2026) zu `9908`: "ein Timeout wie jeder andere. Richtigerweise
   * sollte in dem Fall ein Storno nachgeschickt werden."
   */
  readonly sendReversal: boolean;
  /**
   * Titel in der TECS-Liste (16.09.2026), wenn der Code dort steht -- sonst
   * `null`. Bei gemessenen Codes weicht er vom [title] ab (`55`: "PIN
   * falsch" gegen "Incorrect PIN").
   */
  readonly tecsTitle: string | null;
}

interface CodeExtra {
  readonly sendReversal?: boolean;
  readonly tecsTitle?: string;
}

function code(
  c: string,
  title: string,
  meaning: string,
  effect: HpsCodeEffect,
  reason: HpsCodeReason,
  source: HpsCodeSource,
  rejectsRequest = false,
  extra: CodeExtra = {},
): HpsCode {
  return {
    code: c,
    title,
    meaning,
    conclusive: effect === 'conclusive',
    effect,
    reason,
    source,
    rejectsRequest,
    sendReversal: extra.sendReversal ?? false,
    tecsTitle: extra.tecsTitle ?? null,
  };
}

/**
 * Die vollstaendige Codetabelle — Vertrag mit dem Dart-Zwilling
 * (`HpsCodes.all` in `lib/src/hobex_hps/response_codes.dart`), ausgegeben als
 * `fixtures/hobex-hps-codes.json`.
 *
 * Zwei Quellen: GEMESSEN an hobex-HPS-Geraeten (TID 3600335, HPS 1.10.0,
 * Firmware 7.3.6, 26.–28.08.2026; TID 3556988 im Betrieb) und die
 * Antwortcodeliste von hobex (erhalten 11.09.2026). Die Regel bleibt: nur ein
 * Code mit feststehender Bedeutung schreibt einen Ausgang fest -- die Liste des
 * Herstellers ist eine solche Feststellung, kein Raten aus der Codefamilie.
 *
 * Eingeordnet wird danach, WO im Ablauf ein dokumentierter Code entsteht:
 * - vor dem Host (Anfrage, Karte, EMV-Kernel, Eingaben, Geraetezustand) ->
 *   `conclusive`, also `declined`;
 * - `100029`, Zeitueberschreitung zum Host MIT auto-reversal -> ebenfalls
 *   `declined`, das Terminal storniert laut hobex selbst;
 * - beim oder nach dem Host OHNE auto-reversal, dazu der Sammelcode `100999`
 *   -> `hostUncertain`.
 *
 * Reihenfolge: zuerst die gemessenen wie im Messprotokoll, dann die
 * dokumentierten aufsteigend -- identisch mit dem Dart-Zwilling.
 */
export const HPS_CODES: readonly HpsCode[] = [
  code(
    '0',
    'Authorized',
    'genehmigt',
    'conclusive',
    'approved',
    'measuredAndDocumented',
    false,
    { tecsTitle: 'Approved Transaction / OK' },
  ),
  code(
    '9002',
    'Invalid Transaction',
    'ungueltiger Vorgang -- das Terminal hat den Vorgang selbst als '
      + 'unzulaessig verworfen, bevor irgendetwas in Bewegung kam',
    'conclusive',
    'invalidTransaction',
    'measuredAndDocumented',
    true,
    { tecsTitle: 'Invalid Transaction' },
  ),
  code(
    '9011',
    'Transaction Canceled',
    'aufgehoben ("Transaction Canceled") -- der Vorgang unter dieser '
      + 'Kennung wurde storniert',
    'conclusive',
    'canceled',
    'measuredAndDocumented',
    false,
    { tecsTitle: 'Transaction cancelled' },
  ),
  code(
    '9027',
    'Original Tx not found',
    'keine Aussage -- steht gleichermassen fuer "nie gesehen", "laeuft '
      + 'gerade", "Karte nicht aufgelegt" und "abgebrochen"',
    'noStatement',
    'noStatement',
    'measuredAndDocumented',
    false,
    { tecsTitle: 'Original Transaction not found' },
  ),
  code(
    '9900',
    'Technical Error Database',
    '"Technical Error Database" -- gemessen im Zusammenhang mit einer '
      + 'nicht rein numerischen Kennung, NACHDEM die Karte verarbeitet war; '
      + 'laut TECS ein Datenbankfehler im Backend -- ob belastet wurde, ist '
      + 'offen',
    'hostUncertain',
    'internalError',
    'measuredAndDocumented',
    false,
    { tecsTitle: 'Technical Error: Database (General)' },
  ),
  code(
    '9003',
    'Invalid Amount',
    '"Invalid Amount" -- der Betrag wird abgewiesen, BEVOR eine Karte '
      + 'verlangt wird (28.08.2026: 99999,99 EUR, Antwort nach 15,7 s ohne '
      + 'Kartenaufforderung); nichts belastet',
    'conclusive',
    'amountInvalid',
    'measuredAndDocumented',
    false,
    { tecsTitle: 'Invalid Amount' },
  ),
  code(
    '100002',
    'Aborted',
    'abgebrochen ("Aborted") -- ueber die Kasse oder am Terminal; '
      + 'nichts belastet',
    'conclusive',
    'aborted',
    'measuredAndDocumented',
  ),
  code(
    '100003',
    'Card not present',
    'Karte nicht aufgelegt ("Card not present") -- innerhalb der Frist '
      + '(gemessen rund 60 s) keine Karte; nichts belastet',
    'conclusive',
    'noCard',
    'measuredAndDocumented',
  ),
  code(
    '100010',
    'Unable to abort transaction',
    'nicht mehr abbrechbar -- der Vorgang ist bereits abgeschlossen',
    'conclusive',
    'notAbortable',
    'measuredAndDocumented',
    true,
  ),
  code(
    '100019',
    'Amount is not in a valid range',
    '"Amount is not in a valid range" -- Betrag ausserhalb des '
      + 'zulaessigen Bereichs, gemessen mit negativem Betrag; Abweisung vor '
      + 'dem Kartenfluss, nichts belastet',
    'conclusive',
    'amountInvalid',
    'measuredAndDocumented',
  ),
  code(
    '100108',
    'Invalid TID',
    '"Invalid TID" -- die Terminal-Kennung gibt es an diesem Geraet '
      + 'nicht; der Vorgang wird abgewiesen, bevor etwas geschieht',
    'conclusive',
    'terminalSetup',
    'measured',
    true,
  ),
  code(
    '55',
    'PIN falsch',
    '"PIN falsch" -- Host-Ablehnung wegen falscher PIN, die erste '
      + 'gemessene Host-Ablehnung ueberhaupt (02.09.2026 im Betrieb, TID '
      + '3556988, HPS 1.11.4, Firmware 2.3.9): die Zahlung antwortete '
      + 'direkt damit, die Statusabfrage danach elfmal in Folge ebenso -- '
      + 'eine Host-Ablehnung bleibt am Terminal abrufbar; nichts belastet',
    'conclusive',
    'wrongPin',
    'measuredAndDocumented',
    false,
    { tecsTitle: 'Incorrect PIN' },
  ),
  // ---- ab hier: Antwortcodeliste von hobex, erhalten 11.09.2026 ----
  code(
    '100001',
    'Bad Request',
    'fehlerhafte Anfrage der Kasse ("Bad Request") -- Abweisung vor dem '
      + 'Kartenfluss; nichts belastet',
    'conclusive',
    'requestRejected',
    'documented',
    true,
  ),
  code(
    '100004',
    'Card read failed',
    'Karte nicht lesbar ("Card read failed") -- Fehler beim Umgang mit '
      + 'der Karte, vor jeder Autorisierung; im Betrieb (TID 3556988, '
      + '28.08.2026) danach dauerhaft 9027; nichts belastet',
    'conclusive',
    'cardReadFailed',
    'documented',
  ),
  code(
    '100005',
    'App select failed',
    'Anwendungsauswahl gescheitert ("App select failed") -- die Karte '
      + 'bietet keine passende Anwendung, vor jeder Autorisierung; im '
      + 'Betrieb danach dauerhaft 9027; nichts belastet',
    'conclusive',
    'cardReadFailed',
    'documented',
  ),
  code(
    '100006',
    'Communication with TecsXml failed',
    'keine Verbindung zum hobex-Host ("Communication with TecsXml '
      + 'failed") -- das Terminal storniert NICHT selbst; ob beim Host '
      + 'etwas angekommen ist, weiss das Terminal nicht',
    'hostUncertain',
    'hostFault',
    'documented',
    false,
    { sendReversal: true },
  ),
  code(
    '100007',
    'Processing of TecsXml step failed',
    'Schritt beim hobex-Host gescheitert ("Processing of TecsXml step '
      + 'failed") -- das Terminal storniert NICHT selbst; ob beim Host '
      + 'belastet wurde, weiss das Terminal nicht',
    'hostUncertain',
    'hostFault',
    'documented',
    false,
    { sendReversal: true },
  ),
  code(
    '100008',
    'Invalid TID',
    'Terminal-Kennung passt nicht ("Invalid TID") -- die TID der '
      + 'Anfrage ist nicht die eingerichtete; Abweisung vor dem '
      + 'Kartenfluss, nichts belastet (am Geraet gemessen wurde dafuer '
      + '100108)',
    'conclusive',
    'terminalSetup',
    'documented',
    true,
  ),
  code(
    '100009',
    'Invalid Tx Type',
    'Vorgangstyp unbekannt oder nicht moeglich ("Invalid Tx Type") -- '
      + 'Abweisung vor dem Kartenfluss; nichts belastet',
    'conclusive',
    'requestRejected',
    'documented',
    true,
  ),
  code(
    '100011',
    'Not Found',
    'nicht gefunden ("Not Found") -- das Terminal kennt den Vorgang '
      + 'nicht; keine Aussage ueber den Vorgang, anders als 9027 aber nie '
      + 'gemessen und deshalb ohne dessen Schlussregel',
    'noStatement',
    'noStatement',
    'documented',
  ),
  code(
    '100012',
    'Max retries exceeded',
    'zu viele Kartenversuche ("Max retries exceeded") -- die Karte '
      + 'wurde mehrfach (Vorgabe 3) erfolglos vorgehalten; nichts belastet',
    'conclusive',
    'cardReadFailed',
    'documented',
  ),
  code(
    '100013',
    'Diagnosis failed',
    'Diagnose gescheitert ("Diagnosis failed") -- das Terminal konnte '
      + 'die Daten des EMV-Kernels nicht lesen; kein Kartenfluss, nichts '
      + 'belastet',
    'conclusive',
    'terminalFault',
    'documented',
    true,
  ),
  code(
    '100014',
    'Card information wasn\'t entered',
    'Kartendaten nicht eingegeben ("Card information wasn\'t entered") '
      + '-- die MOTO-Eingabe kam nicht innerhalb der Frist; nichts belastet',
    'conclusive',
    'noCard',
    'documented',
  ),
  code(
    '100015',
    'Card declined',
    'Karte vom EMV-Kernel abgelehnt ("Card declined") -- Ablehnung im '
      + 'Terminal, vor jeder Autorisierung beim Host; im Betrieb danach '
      + 'dauerhaft 9027; nichts belastet',
    'conclusive',
    'cardDeclined',
    'documented',
  ),
  code(
    '100017',
    'Card Not Supported',
    'Karte nicht unterstuetzt ("Card Not Supported") -- der EMV-Kernel '
      + 'kennt die Karte nicht; nichts belastet',
    'conclusive',
    'cardDeclined',
    'documented',
  ),
  code(
    '100018',
    'Scep enrollment failed',
    'Zertifikatsanmeldung gescheitert ("Scep enrollment failed") -- '
      + 'falscher Code oder keine Verbindung; das Terminal kann den Host '
      + 'nicht ansprechen, nichts belastet',
    'conclusive',
    'terminalSetup',
    'documented',
    true,
  ),
  code(
    '100020',
    'Refund password is invalid',
    'Passwort fuer die Gutschrift falsch ("Refund password is invalid") '
      + '-- die Gutschrift wird nicht ausgefuehrt, nichts ausgezahlt',
    'conclusive',
    'refundPassword',
    'documented',
  ),
  code(
    '100021',
    'Failed to enter the password',
    'Passwort nicht eingegeben ("Failed to enter the password") -- '
      + 'nicht innerhalb der Frist; nichts ausgefuehrt',
    'conclusive',
    'refundPassword',
    'documented',
  ),
  code(
    '100022',
    'Terminal is blocked',
    'Terminal gesperrt ("Terminal is blocked") -- das Geraet ist nicht '
      + 'IN_OPERATION; nichts belastet',
    'conclusive',
    'terminalBlocked',
    'documented',
    true,
  ),
  code(
    '100023',
    'Invalid message type',
    'ungueltige Antwort des hobex-Hosts ("Invalid message type") -- '
      + 'Nachricht und Antwortcode in den UserData ungueltig; ob beim Host '
      + 'belastet wurde, weiss das Terminal nicht',
    'hostUncertain',
    'hostFault',
    'documented',
    false,
    { sendReversal: true },
  ),
  code(
    '100024',
    'Transaction completion has failed',
    'Abschluss des Online-Vorgangs gescheitert ("Transaction completion '
      + 'has failed") -- NACH der Anfrage beim Host; ob belastet bleibt, '
      + 'weiss das Terminal nicht',
    'hostUncertain',
    'hostFault',
    'documented',
    false,
    { sendReversal: true },
  ),
  code(
    '100025',
    'Refund transactions are disabled',
    'Gutschriften abgeschaltet ("Refund transactions are disabled") -- '
      + 'in der Geraeteeinstellung; nichts ausgezahlt',
    'conclusive',
    'refundDisabled',
    'documented',
  ),
  code(
    '100026',
    'Transaction was declined.',
    'Host-Antwort passt nicht zur Karte ("Transaction was declined.") '
      + '-- Chip-Daten fuer eine Karte ohne Chip; das Terminal lehnt ab, ob '
      + 'der Host zuvor belastet hat, ist offen',
    'hostUncertain',
    'hostFault',
    'documented',
    false,
    { sendReversal: true },
  ),
  code(
    '100027',
    'Unsupported UserData in TecsXml Response',
    'unbekannte Daten in der Antwort des hobex-Hosts ("Unsupported '
      + 'UserData in TecsXml Response") -- ob beim Host belastet wurde, '
      + 'weiss das Terminal nicht',
    'hostUncertain',
    'hostFault',
    'documented',
    false,
    { sendReversal: true },
  ),
  code(
    '100028',
    'Tip selection process has failed.',
    'Trinkgeld nicht gewaehlt ("Tip selection process has failed.") -- '
      + 'nicht innerhalb der Frist; nichts belastet',
    'conclusive',
    'tipNotSelected',
    'documented',
  ),
  code(
    '100029',
    'Communication with TecsXml timeout',
    'Zeitueberschreitung zum hobex-Host ("Communication with TecsXml '
      + 'timeout") -- das Terminal storniert den Vorgang SELBST '
      + '(auto-reversal); nichts belastet',
    'conclusive',
    'hostTimeoutReversed',
    'documented',
  ),
  code(
    '100998',
    'Terminal is busy',
    'Terminal beschaeftigt ("Terminal is busy") -- ein anderer Vorgang '
      + 'laeuft oder das Geraet ist nicht bereit; die Anfrage wurde nicht '
      + 'angenommen, nichts belastet',
    'conclusive',
    'terminalBusy',
    'documented',
    true,
  ),
  code(
    '100999',
    'Internal Error',
    'interner Fehler des Terminals ("Internal Error") -- Sammelcode '
      + 'fuer jeden sonst nicht benannten Fehler, an jeder Stelle des '
      + 'Ablaufs moeglich; ob belastet wurde, ist offen',
    'hostUncertain',
    'internalError',
    'documented',
  ),
  ...TECS_CODES,
];

/**
 * @deprecated Seit 0.10.0 [HPS_CODES] -- die Tabelle fuehrt nicht mehr nur
 * gemessene Codes. Gleicher Inhalt, bleibt fuer bestehende Aufrufer.
 */
export const HPS_MEASURED_CODES: readonly HpsMeasuredCode[] = HPS_CODES;

/** `responseCode` einer genehmigten Zahlung. */
export const APPROVED_CODE = '0';
/** Siehe [HPS_CODES]: ungueltiger Vorgang, nichts passiert. */
export const INVALID_TRANSACTION_CODE = '9002';
/** Siehe [HPS_CODES]: aufgehoben. */
export const TRANSACTION_CANCELED_CODE = '9011';
/** Siehe [HPS_CODES]: keine Aussage. */
export const NO_STATEMENT_CODE = '9027';
/** Siehe [HPS_CODES]: Kennung nicht numerisch, keine Aussage. */
export const TECHNICAL_ERROR_CODE = '9900';
/** Siehe [HPS_CODES]: abgebrochen. */
export const ABORTED_CODE = '100002';
/** Siehe [HPS_CODES]: Karte nicht aufgelegt. */
export const CARD_NOT_PRESENT_CODE = '100003';
/** Siehe [HPS_CODES]: nicht mehr abbrechbar. */
export const NOT_ABORTABLE_CODE = '100010';
/** Siehe [HPS_CODES]: Betrag abgewiesen, vor dem Kartenfluss. */
export const INVALID_AMOUNT_CODE = '9003';
/** Siehe [HPS_CODES]: Betrag ausserhalb des zulaessigen Bereichs. */
export const AMOUNT_OUT_OF_RANGE_CODE = '100019';
/** Siehe [HPS_CODES]: Terminal-Kennung unbekannt. */
export const INVALID_TID_CODE = '100108';
/**
 * Siehe [HPS_CODES]: Host-Ablehnung, falsche PIN -- nichts belastet.
 *
 * Zweistellig, weil ein Antwortcode des HOSTS (ISO 8583, 55 = "Incorrect
 * PIN"), kein `9xxx`-Terminalcode und kein `100xxx`-Code der HPS-Anwendung.
 * Daraus folgt KEINE Regel fuer andere zweistellige Codes: in derselben
 * Familie stehen Genehmigungen (`08`, `10`, `11`, `85`). Jeder andere
 * Host-Code bleibt eine Wissensluecke, bis er gemessen ist -- und die
 * Zwei-9027-Regel in `payments.ts` faengt ihn nicht, weil die Statusabfrage
 * dann nicht 9027 antwortet, sondern mit dem Code selbst.
 */
export const WRONG_PIN_CODE = '55';

// ---- Antwortcodeliste von hobex, erhalten 11.09.2026 ----
// Bedeutung, Wirkung und Grund stehen in [HPS_CODES]; hier nur die Namen,
// gleichlautend mit dem Dart-Zwilling (`TransactionResponse.*Code`).

/** `100001` "Bad Request" -- nichts belastet. */
export const BAD_REQUEST_CODE = '100001';
/** `100004` "Card read failed" -- nichts belastet. Im Betrieb am 28.08.2026 gesehen. */
export const CARD_READ_FAILED_CODE = '100004';
/** `100005` "App select failed" -- nichts belastet. Im Betrieb am 28.08.2026 gesehen. */
export const APP_SELECT_FAILED_CODE = '100005';
/** `100006` "Communication with TecsXml failed" (No auto-reversal) -- ungewiss. */
export const HOST_COMMUNICATION_FAILED_CODE = '100006';
/** `100007` "Processing of TecsXml step failed" (No auto-reversal) -- ungewiss. */
export const HOST_STEP_FAILED_CODE = '100007';
/** `100008` "Invalid TID" laut hobex; gemessen wurde [INVALID_TID_CODE]. */
export const INVALID_TID_DOCUMENTED_CODE = '100008';
/** `100009` "Invalid Tx Type" -- nichts belastet. */
export const INVALID_TX_TYPE_CODE = '100009';
/** `100011` "Not Found" -- keine Aussage, aber ohne die Zwei-9027-Regel. */
export const NOT_FOUND_CODE = '100011';
/** `100012` "Max retries exceeded" -- nichts belastet. */
export const MAX_RETRIES_EXCEEDED_CODE = '100012';
/** `100013` "Diagnosis failed" -- nichts belastet. */
export const DIAGNOSIS_FAILED_CODE = '100013';
/** `100014` "Card information wasn't entered" (MOTO) -- nichts belastet. */
export const CARD_INFO_NOT_ENTERED_CODE = '100014';
/** `100015` "Card declined" (EMV-Kernel) -- nichts belastet. Im Betrieb am 28. und 31.08.2026 gesehen. */
export const CARD_DECLINED_CODE = '100015';
/** `100017` "Card Not Supported" -- nichts belastet. */
export const CARD_NOT_SUPPORTED_CODE = '100017';
/** `100018` "Scep enrollment failed" -- nichts belastet. */
export const SCEP_ENROLLMENT_FAILED_CODE = '100018';
/** `100020` "Refund password is invalid" -- nichts ausgezahlt. */
export const REFUND_PASSWORD_INVALID_CODE = '100020';
/** `100021` "Failed to enter the password" -- nichts ausgezahlt. */
export const PASSWORD_NOT_ENTERED_CODE = '100021';
/** `100022` "Terminal is blocked" -- nichts belastet. */
export const TERMINAL_BLOCKED_CODE = '100022';
/** `100023` "Invalid message type" -- ungewiss. */
export const INVALID_MESSAGE_TYPE_CODE = '100023';
/** `100024` "Transaction completion has failed" -- ungewiss. */
export const COMPLETION_FAILED_CODE = '100024';
/** `100025` "Refund transactions are disabled" -- nichts ausgezahlt. */
export const REFUND_DISABLED_CODE = '100025';
/** `100026` "Transaction was declined." (Chip-Daten fuer eine Karte ohne Chip) -- ungewiss. */
export const CHIP_DATA_MISMATCH_CODE = '100026';
/** `100027` "Unsupported UserData in TecsXml Response" -- ungewiss. */
export const UNSUPPORTED_USER_DATA_CODE = '100027';
/** `100028` "Tip selection process has failed." -- nichts belastet. */
export const TIP_SELECTION_FAILED_CODE = '100028';
/** `100029` "Communication with TecsXml timeout" (auto-reversal) -- nichts belastet. */
export const HOST_TIMEOUT_REVERSED_CODE = '100029';
/** `100998` "Terminal is busy" -- nichts belastet; gemessen als HTTP [TERMINAL_BUSY_HTTP_STATUS]. */
export const TERMINAL_BUSY_CODE = '100998';
/** `100999` "Internal Error" -- Sammelcode, ungewiss. */
export const INTERNAL_ERROR_CODE = '100999';


/**
 * HTTP `409` ("Terminal is busy"): das Terminal serialisiert und weist eine
 * zweite Anfrage ab, waehrend eine erste noch laeuft. Am 27.08.2026 gemessen:
 * kommt nach 87 Millisekunden, der abgewiesene Vorgang hinterlaesst KEINE
 * Spur (die Statusabfrage auf seine Kennung liefert weiterhin
 * [NO_STATEMENT_CODE]).
 *
 * Bewusst KEIN Eintrag in [HPS_CODES]: es ist ein HTTP-Status, kein
 * `responseCode` — er entsteht, bevor ueberhaupt ein Antwortrumpf gelesen
 * wird. Siehe `errors.ts` (`HpsConnectTerminalError.isTerminalBusy`) fuer die
 * getrennte Auswertung.
 */
export const TERMINAL_BUSY_HTTP_STATUS = 409;

/**
 * HTTP `404` beim Terminal-Kontakt. **Lesart ungemessen:** am Produktivgeraet
 * (TID 3556988, Firmware 2.3.9) antwortet `POST /api/transaction/abort/...`
 * damit, am Testgeraet (3600335) nie. Es kann "diesen Vorgang kenne ich nicht"
 * heissen oder "diesen Endpunkt gibt es hier nicht" -- beides sagt nichts ueber
 * die Zahlung. Bei hobex angefragt; bis dahin benennt `payments.ts` beim
 * Abbruch beide Lesarten, statt eine zu behaupten.
 *
 * Wie [TERMINAL_BUSY_HTTP_STATUS] bewusst KEIN Eintrag in [HPS_CODES]: ein
 * HTTP-Status ist kein `responseCode`.
 */
export const NOT_FOUND_HTTP_STATUS = 404;

const CODE_BY_ID: ReadonlyMap<string, HpsCode> = new Map(HPS_CODES.map((c) => [c.code, c]));

const PLATZHALTER = 'xx';

/** Eintraege, die eine ganze Familie abdecken (`81xx`), nach ihrem Praefix. */
const CODE_BY_PREFIX: ReadonlyMap<string, HpsCode> = new Map(
  HPS_CODES.filter((c) => c.code.endsWith(PLATZHALTER)).map((c) => [c.code.slice(0, -PLATZHALTER.length), c]),
);

/**
 * Die Schreibweise, unter der [code] in [HPS_CODES] steht: ein rein
 * numerischer Code ohne fuehrende Nullen (`0055` -> `55`, `0000` -> `0`),
 * jeder andere unveraendert. Ohne diese Angleichung waere ein `0000` kein
 * `0` -- und damit eine ABLEHNUNG einer genehmigten Zahlung.
 * [parseHpsTransactionResponse] gleicht deshalb schon beim Einlesen an.
 */
export function normalizeHpsCode(code: string): string {
  const c = code.trim();
  if (!/^\d+$/.test(c)) return c;
  const ohneNullen = c.replace(/^0+/, '');
  return ohneNullen === '' ? '0' : ohneNullen;
}

/**
 * Der Eintrag zu [code] in [HPS_CODES], oder `undefined`, wenn seine
 * Bedeutung nicht feststeht. Findet beide Schreibweisen
 * ([normalizeHpsCode]) und die Familien mit Platzhalter (`8105` -> `81xx`).
 */
export function hpsCodeInfo(code: string | undefined): HpsCode | undefined {
  if (code === undefined) return undefined;
  const c = normalizeHpsCode(code);
  const genau = CODE_BY_ID.get(c);
  if (genau) return genau;
  if (c.length === 4 && /^\d+$/.test(c)) return CODE_BY_PREFIX.get(c.slice(0, 2));
  return undefined;
}

/**
 * Der Grund zu [code] -- `'unknown'` fuer einen Code ausserhalb der Tabelle,
 * `undefined` ohne Code.
 */
export function hpsCodeReason(code: string | undefined): HpsCodeReason | undefined {
  if (code === undefined) return undefined;
  return hpsCodeInfo(code)?.reason ?? 'unknown';
}

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
    responseCode: normalizedCode(stringify(r['responseCode'])),
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

/**
 * Der Ergebniscode in der Schreibweise der Tabelle ([normalizeHpsCode]):
 * `0000` wird `0`. Der Rumpf in `raw` bleibt unveraendert.
 */
function normalizedCode(v: string | undefined): string | undefined {
  const c = nonEmpty(v?.trim());
  return c === undefined ? undefined : normalizeHpsCode(c);
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

/**
 * `true`, wenn das Terminal zu dieser Kennung keine Auskunft gibt (9027).
 *
 * Bewusst NUR `9027`, nicht auch [NOT_FOUND_CODE] (`100011`): auf `9027` ruht
 * die Zwei-9027-Regel in `payments.ts`, und die ist fuer genau diesen Code
 * gemessen. `100011` ist dokumentiert, aber nie gesehen.
 */
export function isNoStatement(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return res.responseCode === NO_STATEMENT_CODE;
}

/**
 * `true`, wenn das Terminal einen technischen Fehler meldet (9900). Seit der
 * TECS-Liste zugleich [isHostUncertain]: ob belastet wurde, ist offen.
 */
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
 * traegt — ein Ergebniscode, der in [HPS_CODES] als `conclusive` gefuehrt
 * wird. Die einzige Stelle, an der ein Code zu einem Ausgang wird.
 */
export function isConclusive(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return hpsCodeInfo(res.responseCode)?.conclusive ?? false;
}

/**
 * Wie [isConclusive], aber fuer die Antwort auf eine STATUSABFRAGE: ein Code,
 * der die Anfrage selbst abweist (`rejectsRequest`, etwa `100022` "Terminal is
 * blocked" oder `100108` "Invalid TID"), sagt dort nichts ueber den gesuchten
 * Vorgang. Als `declined` gelesen, hiesse ein gesperrtes Terminal "die Zahlung
 * ist nicht belastet".
 */
export function isConclusiveAsStatus(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  const info = hpsCodeInfo(res.responseCode);
  return info !== undefined && info.conclusive && !info.rejectsRequest;
}

/**
 * `true`, wenn der Code einen Ausgang meldet, den das Terminal selbst nicht
 * kennt: der hobex-Host war beteiligt, und das Terminal storniert nicht von
 * sich aus (`effect: 'hostUncertain'`). Ein spaeteres `9027` auf die
 * Statusabfrage heisst dann NICHT "nichts belastet" -- es spiegelt nur den
 * Speicher des Terminals, nicht den des Hosts.
 */
export function isHostUncertain(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return hpsCodeInfo(res.responseCode)?.effect === 'hostUncertain';
}

/**
 * `true`, wenn zu diesem Code ein Storno nachzuschicken ist
 * ([HpsCode.sendReversal]) -- der Host hat nicht oder nicht brauchbar
 * geantwortet, etwa `9908`.
 */
export function needsReversal(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return hpsCodeInfo(res.responseCode)?.sendReversal ?? false;
}

/**
 * `true`, wenn ein Ergebniscode VORHANDEN ist, dessen Bedeutung aber nicht
 * feststeht -- er fehlt in [HPS_CODES]. Ein Code, den dieses Modell schlicht
 * nicht kennt; anders als [isNoStatement], [isTechnicalError] und
 * [isHostUncertain], die eine Wissensluecke ueber den VORGANG benennen.
 */
export function isUnknownCode(res: Pick<HpsTransactionResponse, 'responseCode'>): boolean {
  return res.responseCode !== undefined && hpsCodeInfo(res.responseCode) === undefined;
}
