/**
 * Berichtsmonat — Zwilling von `ReportMonth` in
 * kasseneck_api/lib/models/report_month.dart.
 *
 * Hat im Dart-Vorbild bewusst **keine** JSON-Nutzlast (kein `fromJson`/
 * `toJson`) — es ist ein reiner Kalender-Werttyp fuer Monats-Arithmetik und
 * Anzeige, kein Beleg-/Backend-Feld. `month` ist die Monatszahl 1-12
 * (entspricht `KeckMonth.id` im Flutter-Paket) statt eines eigenen Enums —
 * ein eigenes `KeckMonth`-Enum wuerde hier nur fuer diesen einen Werttyp
 * Maschinerie aufbauen, die niemand sonst braucht.
 */
export interface ReportMonth {
  month: number;
  year: number;
}

// Reihenfolge wie `KeckMonth.values` im Flutter-Paket (Index 0 = Januar).
const MONTH_KEYS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const MONTH_NAMES_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

export function reportMonthFromDate(date: Date): ReportMonth {
  return { month: date.getMonth() + 1, year: date.getFullYear() };
}

export function previousReportMonth(rm: ReportMonth): ReportMonth {
  return rm.month === 1 ? { month: 12, year: rm.year - 1 } : { month: rm.month - 1, year: rm.year };
}

export function nextReportMonth(rm: ReportMonth): ReportMonth {
  return rm.month === 12 ? { month: 1, year: rm.year + 1 } : { month: rm.month + 1, year: rm.year };
}

/** Schluessel-Format wie `ReportMonth.toString()` im Flutter-Paket, z. B. `"march_2026"`. */
export function reportMonthKey(rm: ReportMonth): string {
  return `${MONTH_KEYS[rm.month - 1]}_${rm.year}`;
}

/** Deutsches Anzeige-Format wie `ReportMonth.readable` im Flutter-Paket, z. B. `"März 2026"`. */
export function reportMonthReadable(rm: ReportMonth): string {
  return `${MONTH_NAMES_DE[rm.month - 1]} ${rm.year}`;
}
