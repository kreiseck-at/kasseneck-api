/**
 * Nacherfassung eines Handbelegs, innere Form (`handbeleg` am
 * Firestore-Beleg; unter `/v3` heisst es `manualReceipt`). Nach einem Ausfall
 * der Kasse oder einer Leistung ausser Haus traegt der nacherfasste Beleg
 * Nummer, Datum und Grund des handschriftlichen Belegs; sein eigener
 * Zeitstempel bleibt der Zeitpunkt der Nacherfassung.
 *
 * Rechtsgrundlage: § 17 Abs 5 RKSV, Erlass 2019 Abschnitt 3.6.1 und 6.7.
 * Geprueft wird am Server; dieses Paket liest nur.
 */

/** Innere Gruende: fuenf Ausfall-Gruende und die Leistung ausser Haus. */
export const HANDBELEG_GRUENDE = ['internet', 'strom', 'geraet', 'stoerung', 'sonstiges', 'ausser_haus'] as const;
export type HandbelegGrund = (typeof HANDBELEG_GRUENDE)[number];

export interface Handbeleg {
  nummer: string;
  nummerBis?: string;
  anzahl?: number;
  /** `YYYY-MM-DD` (Wiener Tag). */
  datum: string;
  /** `HH:MM`. */
  uhrzeit?: string;
  grund: HandbelegGrund | string;
  /** Eigener Text zum Grund, nur bei `sonstiges`. */
  grundText?: string;
}

const istText = (w: unknown): w is string => typeof w === 'string' && w !== '';

/** Liest `handbeleg`; ohne Nummer, Datum oder Grund `undefined`, falsche Zusatzfelder fallen weg. */
export function leseHandbeleg(roh: unknown): Handbeleg | undefined {
  if (roh === null || typeof roh !== 'object' || Array.isArray(roh)) return undefined;
  const o = roh as Record<string, unknown>;
  if (!istText(o['nummer']) || !istText(o['datum']) || !istText(o['grund'])) return undefined;
  return {
    nummer: o['nummer'],
    ...(istText(o['nummerBis']) ? { nummerBis: o['nummerBis'] } : {}),
    ...(typeof o['anzahl'] === 'number' && Number.isInteger(o['anzahl']) ? { anzahl: o['anzahl'] } : {}),
    datum: o['datum'],
    ...(istText(o['uhrzeit']) ? { uhrzeit: o['uhrzeit'] } : {}),
    grund: o['grund'],
    ...(istText(o['grundText']) ? { grundText: o['grundText'] } : {}),
  };
}
