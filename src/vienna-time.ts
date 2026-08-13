/**
 * Deutung von Server-Zeitstempeln in der Geschaeftszeitzone Europe/Vienna —
 * Zwilling von `ViennaTime.parseServerTimeStamp` in
 * kasseneck_api/lib/services/vienna_time.dart (nur die Deutungsrichtung
 * Nutzlast -> Zeitpunkt; Anzeige-/Wanduhr-Hilfen wie `toWallClock`,
 * `dayKey`, `now()` sind reine Anzeigehilfen des Dart-Vorbilds und nicht
 * Teil dieses Pakets).
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
    return new Date(trimmed);
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

interface WanduhrFelder {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
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
