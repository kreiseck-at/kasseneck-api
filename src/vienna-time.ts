/**
 * Deutung von Server-Zeitstempeln in der Geschaeftszeitzone Europe/Vienna —
 * Zwilling von `ViennaTime.parseServerTimeStamp` in
 * kasseneck_api/lib/services/vienna_time.dart.
 *
 * Zwei Richtungen: `parseServerTimeStamp` deutet die Nutzlast als Zeitpunkt,
 * `toViennaWallClock` liest zu einem Zeitpunkt die Wiener Wanduhrzeit zurueck.
 * Die Rueckrichtung braucht jeder, der aus einem Zeitpunkt einen fachlichen
 * Kalenderwert ableitet (Berichtsmonat, Tagesabgrenzung): die eingebauten
 * `getMonth()`/`getFullYear()` liefern die Zeitzone des ausfuehrenden
 * Rechners, und ein Beleg vom 1. Maerz 00:30 Wiener Zeit faellt damit auf
 * einer UTC-Maschine in den Februar. Weitere Anzeigehilfen des Dart-Vorbilds
 * (`dayKey`, `now()`) sind nicht Teil dieses Pakets.
 *
 * Der Kasseneck-Server liefert Zeitstempel uneinheitlich: neue Belege als
 * Wiener Wanduhrzeit ohne Offset (`getLokalAustriaTimeFinanzamtFormat()` im
 * Backend, Format `YYYY-MM-DDTHH:mm:ss`), manche aeltere/andere Felder als
 * echten Zeitpunkt mit `Z`/Offset. `new Date(raw)` allein ist dafuer
 * ungeeignet: JS deutet einen offsetlosen ISO-String als **lokale** Zeit des
 * ausfuehrenden Rechners — auf einer Wiener Maschine zufaellig richtig, in
 * jeder anderen Zeitzone (z. B. einer Browser-Kasse im Ausland) falsch.
 */
const STUNDE_MS = 60 * 60 * 1000;

const NAIVER_ZEITSTEMPEL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;
const HAT_ZEITZONE = /Z$|[+-]\d{2}:?\d{2}$/;

/**
 * Server-Zeitstempel parsen: ohne Offset = Wiener Wanduhrzeit, mit
 * Offset/`Z` = bereits ein echter Zeitpunkt. Ergebnis ist immer ein echter
 * Zeitpunkt (JS-`Date`, intern UTC-Millisekunden seit Epoch).
 */
export function parseServerTimeStamp(raw: string): Date {
  const trimmed = raw.trim();
  if (HAT_ZEITZONE.test(trimmed)) {
    const zeitpunkt = new Date(trimmed);
    // `new Date` macht aus '2026-99-99T00:00:00Z' klaglos ein Invalid Date:
    // eine Zeitzone allein macht noch kein Datum. Ohne diese Pruefung wandert
    // der Unsinn still weiter und wird erst in einer Ableitung zu NaN — dort,
    // wo niemand mehr auf den Zeitstempel schaut.
    if (Number.isNaN(zeitpunkt.getTime())) {
      throw new Error(`Zeitstempel: unlesbares Format "${raw}"`);
    }
    return zeitpunkt;
  }
  const match = NAIVER_ZEITSTEMPEL.exec(trimmed);
  if (!match) {
    throw new Error(`Zeitstempel: unlesbares Format "${raw}"`);
  }
  const [, jahr, monat, tag, stunde, minute, sekunde, bruchteil] = match;
  return fromViennaWallClock({
    year: Number(jahr),
    month: Number(monat),
    day: Number(tag),
    hour: Number(stunde),
    minute: Number(minute),
    second: Number(sekunde),
    millisecond: bruchteil ? Number(bruchteil.padEnd(3, '0').slice(0, 3)) : 0,
  });
}

/** Wiener Wanduhrzeit: die Ziffern, die eine Uhr in Wien anzeigt. `month` ist 1-12. */
export interface ViennaWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

type WanduhrFelder = ViennaWallClock;

/**
 * Echter Zeitpunkt -> Wiener Wanduhrzeit (Gegenstueck zu
 * [parseServerTimeStamp]). Der Versatz kommt aus derselben Sommerzeitregel wie
 * die Hinrichtung; hier ist er direkt anwendbar, weil der Zeitpunkt schon
 * feststeht.
 */
export function toViennaWallClock(zeitpunkt: Date): ViennaWallClock {
  const utcMs = zeitpunkt.getTime();
  // Ein Invalid Date wuerde hier lautlos zu NaN in jedem Feld — und damit zu
  // einem NaN-Berichtsmonat beim Aufrufer.
  if (Number.isNaN(utcMs)) {
    throw new Error('Zeitpunkt: unbrauchbarer Wert (Invalid Date)');
  }
  const versatzMs = (istSommerzeit(utcMs) ? 2 : 1) * STUNDE_MS;
  const verschoben = new Date(utcMs + versatzMs);
  return {
    year: verschoben.getUTCFullYear(),
    month: verschoben.getUTCMonth() + 1,
    day: verschoben.getUTCDate(),
    hour: verschoben.getUTCHours(),
    minute: verschoben.getUTCMinutes(),
    second: verschoben.getUTCSeconds(),
    millisecond: verschoben.getUTCMilliseconds(),
  };
}

/** Wiener Wanduhrzeit (Ziffern wie angezeigt) -> echter Zeitpunkt (UTC). */
function fromViennaWallClock(wand: WanduhrFelder): Date {
  const basisUtcMs = Date.UTC(wand.year, wand.month - 1, wand.day, wand.hour, wand.minute, wand.second, wand.millisecond);
  // Erst Sommerzeit annehmen; stimmt die Annahme fuer den resultierenden
  // Zeitpunkt, war sie richtig — sonst gilt Winterzeit (wie im Dart-Vorbild).
  const sommerVariante = basisUtcMs - 2 * STUNDE_MS;
  if (istSommerzeit(sommerVariante)) {
    return new Date(sommerVariante);
  }
  return new Date(basisUtcMs - 1 * STUNDE_MS);
}

/** EU-Sommerzeit: letzter Sonntag im Maerz 01:00 UTC bis letzter Sonntag im Oktober 01:00 UTC. */
function istSommerzeit(utcMs: number): boolean {
  const jahr = new Date(utcMs).getUTCFullYear();
  const start = letzterSonntagUtcMs(jahr, 3);
  const ende = letzterSonntagUtcMs(jahr, 10);
  return utcMs >= start && utcMs < ende;
}

/** Letzter Sonntag des Monats, 01:00 UTC (EU-Umstellungszeitpunkt). */
function letzterSonntagUtcMs(jahr: number, monat: number): number {
  const letzterTag = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  // JS-Wochentag (0=Sonntag..6=Samstag) ist bereits die Anzahl Tage seit dem
  // letzten Sonntag — keine Umrechnung noetig (anders als Darts weekday, das
  // Montag=1..Sonntag=7 zaehlt und dafuer `% 7` braucht).
  const wochentag = new Date(Date.UTC(jahr, monat - 1, letzterTag)).getUTCDay();
  return Date.UTC(jahr, monat - 1, letzterTag - wochentag, 1, 0, 0, 0);
}
