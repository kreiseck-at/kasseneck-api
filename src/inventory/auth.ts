/**
 * Anmeldung fuer die Lager-API: der `api_key` des Kontos als Bearer, ohne
 * `cashregister-token` (gelesen wird am Konto, nicht an einer Kasse).
 *
 * **Der Schluessel gehoert auf einen Server**, etwa in das Backend eines
 * Online-Shops, nie in ein Browser-Buendel.
 *
 * Geprueft wird nur, was ohne Netz sicher falsch ist: ein leerer Wert, ein
 * Partner-Schluessel (`pk_…`) oder ein Kassen-Token (`cb_…`). Die Meldung
 * nennt nie den Wert, nur seine Art.
 */

import type { KasseneckAuth } from '../client/auth.js';
import { KasseneckAuthError } from '../client/errors.js';

export interface InventoryKeyAuthOptions {
  /** `api_key` des Kontos, z. B. `kr_live_…` oder `kr_test_…`. */
  apiKey: string;
}

export function inventoryKeyAuth(options: InventoryKeyAuthOptions): KasseneckAuth {
  const schluessel = typeof options?.apiKey === 'string' ? options.apiKey.trim() : '';
  if (!schluessel) throw new KasseneckAuthError('inventoryKeyAuth: apiKey fehlt');
  if (/^pk_(live|test)_/i.test(schluessel)) {
    throw new KasseneckAuthError('inventoryKeyAuth: das ist ein Partner-Schluessel (pk_…); die Lager-API nimmt den api_key des Kontos (kr_…)');
  }
  if (/^cb_(live|test)_/i.test(schluessel)) {
    throw new KasseneckAuthError('inventoryKeyAuth: das ist ein Kassen-Token (cb_…); die Lager-API nimmt den api_key des Kontos (kr_…)');
  }
  return () => ({ headers: { Authorization: `Bearer ${schluessel}` }, params: {} });
}
