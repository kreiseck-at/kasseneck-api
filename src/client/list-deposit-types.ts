import { posDepositSettingsFromWire, type DepositSettings } from '../pos/pfand.js';
import { KasseneckValidationError } from './errors.js';
import type { InternerTransport } from './aufrufe.js';

/**
 * Pfandarten des Betriebs lesen (`listDepositTypes`, nur unter `/v3`, API-Schluessel).
 * Der Aufruf braucht **kein Kassen-Token**: er gilt dem Betrieb, nicht einer Kasse.
 * `apiKeyAuth` darf deshalb ohne `cashregisterToken` gebaut werden; der Server
 * liest das Token bei diesem Aufruf nicht.
 * Die Antwort ist der Block `deposit` aus `getKasseSettings`. Pfand aus ist kein
 * Fehler: `null`, dann darf ein Fremdsystem keine Pfandzeilen schicken. Eine
 * Antwort, in der `deposit` weder `null` noch ein Objekt ist, wirft
 * [KasseneckValidationError] (Richtung `response`), nie still `null`.
 */
export async function listDepositTypes(transport: InternerTransport): Promise<DepositSettings | null> {
  const daten = await transport<Record<string, unknown> | null>('listDepositTypes', {});
  if (daten === null || typeof daten !== 'object' || Array.isArray(daten) || !('deposit' in daten)) {
    throw antwortfehler('Antwort enthaelt keinen Pfandblock (data.deposit fehlt)');
  }
  const deposit = daten['deposit'];
  if (deposit === null) return null;
  const einstellungen = posDepositSettingsFromWire(deposit);
  if (einstellungen === undefined) throw antwortfehler('data.deposit ist weder null noch ein Objekt');
  return einstellungen;
}

function antwortfehler(grund: string): KasseneckValidationError {
  return new KasseneckValidationError('listDepositTypes', grund, 'response');
}
