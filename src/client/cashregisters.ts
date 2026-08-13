import { fromCashregisterPayload, type Cashregister, type CashregisterPayload } from '../models/index.js';
import { KasseneckValidationError } from './errors.js';
import type { KasseneckTransport } from './transport.js';

/**
 * Kassen-Endpunkte.
 *
 * **Anmeldeweg:** `listMyCashregisters` laeuft im Backend unter
 * `checkRequest(req, 'customer', …, {allowRegisterUser: true})` — der Bearer
 * muss also ein Firebase-ID-Token sein. Mit `apiKeyAuth` (api_key als Bearer)
 * ist dieser Endpunkt **nicht** erreichbar; fuer die Browser-Kasse ist
 * `registerUserAuth` der Weg. Dieses Paket bildet das nicht nach — wer darf,
 * entscheidet allein das Backend. Der Hinweis steht hier, damit ein Leser
 * nicht raten muss.
 */

/**
 * Die Kassen, die dem angemeldeten Benutzer offenstehen — fuer einen
 * Kassen-Benutzer genau die ihm zugewiesenen (das Backend filtert, siehe
 * `registerAuth.darfKasse`).
 *
 * Ohne diesen Aufruf kann eine Browser-Kasse ihre Kasse nicht auswaehlen.
 */
export async function listMyCashregisters(rufen: KasseneckTransport): Promise<Cashregister[]> {
  const daten = await rufen<{ cashregisters?: unknown }>('listMyCashregisters');
  const liste = daten?.cashregisters;
  if (!Array.isArray(liste)) {
    throw new KasseneckValidationError(
      'listMyCashregisters',
      'Antwort enthaelt keine Kassenliste (data.cashregisters fehlt)',
      'response',
    );
  }
  return liste.map((eintrag, i) => {
    const nutzlast = (typeof eintrag === 'object' && eintrag !== null ? eintrag : {}) as CashregisterPayload;
    // Die Dokument-ID steht in dieser Antwort im Eintrag selbst; der zweite
    // Parameter ist nur der Rueckfall (siehe fromCashregisterPayload).
    return fromCashregisterPayload(nutzlast, nutzlast.id ?? String(i));
  });
}
