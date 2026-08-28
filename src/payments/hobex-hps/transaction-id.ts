/**
 * Erzeugung und Pruefung der HPS-Transaktionskennung.
 *
 * **Die Kennung steht VOR dem ersten Netzweg fest.** Kasseneck Connects
 * eigene Doku sagt es woertlich: "`transactionId` MUSS die Kasse vergeben und
 * sich merken" (`kasseneck-connect/lib/src/api/routes_terminal.dart`,
 * `_handlePayment`). Ohne das ist ein abgerissener Vorgang unauffindbar — das
 * ist der Kernfehler vom 24.08.2026.
 *
 * **Warum nicht `newHobexTransactionId` aus `../hobex.js`?** Diese Funktion
 * erzeugt 19 Ziffern (Zeitanteil + Zufall) fuer die Hobex-CLOUD-API, die keine
 * Laengengrenze dokumentiert. Das HPS-REST-Terminal dagegen erlaubt
 * hoechstens **18** Ziffern (`kasseneck-connect`s eigene Pruefung,
 * `_transactionId`-Regex in `routes_terminal.dart`, und `HpsClient`s
 * `_maxTransactionIdLength` im Dart-Zwilling) — eine 19-stellige Kennung waere
 * an dieser Schnittstelle bereits eine Formverletzung, VOR jeder Pruefung auf
 * "rein numerisch". Sie taugt hier also nicht.
 *
 * Stattdessen **derselbe Ansatz wie `HpsClient.newTransactionId()`** im
 * Dart-Zwilling: Millisekunden-Zeitstempel (13 Ziffern) plus ein 5-stelliger
 * Zaehler je Millisekunde, macht genau 18 Ziffern. Der Zeitstempel beginnt
 * bis zum Jahr 2286 nicht mit einer Null — das schliesst die Falle, vor der
 * gewarnt wurde ("fuehrende Nullen werden am Terminal normalisiert, zwei
 * Kennungen waeren sonst derselbe Vorgang"): zwei in dieser Millisekunde
 * erzeugte Kennungen unterscheiden sich immer im Zaehler-Suffix, nie nur in
 * einer fuehrenden Null.
 */

/** Laengengrenze der Kennung laut HPS-REST-Spezifikation (siehe oben). */
export const MAX_TRANSACTION_ID_LENGTH = 18;

const NUMERIC_TRANSACTION_ID = /^\d+$/;

/**
 * `true`, wenn [value] als HPS-Transaktionskennung taugt: nicht leer,
 * hoechstens [MAX_TRANSACTION_ID_LENGTH] Zeichen, rein numerisch.
 *
 * Bewusst KEINE Pruefung auf eine fuehrende Null bei einer selbst
 * UEBERGEBENEN Kennung — weder Connects Formregel noch der Dart-Zwilling
 * verlangen das von einem Aufrufer, der eine eigene Kennung mitbringt (siehe
 * `HpsClient._checkTransactionId`). Die Falle betrifft nur die ERZEUGUNG,
 * siehe [newHpsTransactionId].
 */
export function isValidHpsTransactionId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_TRANSACTION_ID_LENGTH && NUMERIC_TRANSACTION_ID.test(value);
}

export interface HpsTransactionIdGeneratorOptions {
  /** Uhr fuer die Kennung; Vorgabe `Date.now`. Einspeisbar fuer Tests. */
  now?: () => number;
}

/**
 * Erzeugt eine Funktion, die bei jedem Aufruf eine neue, innerhalb dieses
 * Erzeugers eindeutige Kennung liefert.
 *
 * Eindeutigkeit ist eine LOGISCHE Uhr, angelehnt an das Snowflake-Verfahren:
 * die zuletzt vergebene Millisekunde laeuft niemals rueckwaerts. Liefert die
 * Uhr keinen groesseren Wert als beim letzten Aufruf — egal ob dieselbe
 * Millisekunde oder eine zurueckspringende Uhr (Zeitumstellung,
 * NTP-Korrektur) — bleibt die Millisekunde stehen und nur der Zaehler steigt.
 * Ist der Zaehler einer Millisekunde ausgeschoepft (100000 Kennungen),
 * schaltet die Millisekunde gedanklich um eins weiter.
 *
 * Die Garantie gilt nur INNERHALB des einen Erzeugers (eigener, gekapselter
 * Zustand) — zwei getrennte Erzeuger oder Prozesse, die in derselben
 * Millisekunde eine Kennung bilden, koennen kollidieren. Fuer den Einsatz
 * hier passt das: eine Kasse erzeugt Kennungen aus genau einem laufenden
 * Prozess.
 */
export function createHpsTransactionIdGenerator(
  options: HpsTransactionIdGeneratorOptions = {},
): () => string {
  const now = options.now ?? Date.now;
  let lastMs: number | null = null;
  let counter = 0;

  return function newHpsTransactionId(): string {
    const current = Math.trunc(now());
    let ms: number;
    if (lastMs === null || current > lastMs) {
      ms = current;
      counter = 0;
    } else {
      ms = lastMs;
      counter += 1;
      if (counter >= 100_000) {
        ms += 1;
        counter = 0;
      }
    }
    lastMs = ms;
    return `${ms}${String(counter).padStart(5, '0')}`;
  };
}

/** Bequeme Vorgabeinstanz fuer den Alltagsgebrauch — eigener, gekapselter Zustand. */
export const newHpsTransactionId = createHpsTransactionIdGenerator();
