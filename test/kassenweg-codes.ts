import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * Die Codes, die Anmeldung und Rand auf jedem Endpunkt des Kassenwegs erzeugen
 * koennen, abgeleitet aus fixtures/v3 (geteilt von kasse-v3 und receipts-v3).
 *
 * `errorCodes.auth` fuehrt die Texte in der Reihenfolge von AUTH_MELDUNGEN:
 * zuerst die des gemeinsamen Pruefwegs und der Kassen-Identitaet, am Ende die
 * aus `partner-auth.FEHLER`. Der Partner-Zugang ist darum der Rest der Liste
 * hinter dem letzten Code, den ein Fall des Kassenwegs im Vertrag zeigt.
 */
type Json = Record<string, any>;
const lies = (datei: string): Json =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/v3/${datei}`, import.meta.url)), 'utf8')) as Json;

function kassenwegFaelle(): Set<string> {
  const codes = new Set<string>();
  for (const e of Object.values(lies('antworten/kasse.json').endpoints as Record<string, { cases: Json[] }>)) {
    for (const f of e.cases) if (f.response.status === 'error') codes.add(f.response.code);
  }
  for (const f of lies('antworten/kasse-belege.json').cases as Json[]) {
    if (f.response.status === 'error') codes.add(f.response.code);
  }
  return codes;
}

/** Die Codes des Partner-Zugangs in `errorCodes.auth` (heute sieben). */
export function partnerZugangsCodes(): string[] {
  const auth = lies('v3-vokabular.json').errorCodes.auth as string[];
  const gesehen = kassenwegFaelle();
  let letzter = -1;
  auth.forEach((c, i) => { if (gesehen.has(c)) letzter = i; });
  return auth.slice(letzter + 1);
}

/** `errorCodes.auth` ohne Partner-Zugang, dazu `errorCodes.edge`; sortiert, ohne Doppel. */
export function randUndAnmeldung(): string[] {
  const codes = lies('v3-vokabular.json').errorCodes;
  const partner = new Set(partnerZugangsCodes());
  return [...new Set([...(codes.auth as string[]).filter((c) => !partner.has(c)), ...(codes.edge as string[])])].sort();
}
