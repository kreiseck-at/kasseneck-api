/**
 * Anmeldung fuer die Rechnungs-API: der `api_key` des Kontos als Bearer.
 *
 * Anders als `apiKeyAuth` **ohne** `cashregister-token` — eine Rechnung
 * entsteht nicht an einer Kasse, sondern am Konto.
 *
 * **Der Schluessel gehoert auf einen Server.** Mit ihm entstehen festgeschriebene
 * Rechnungen mit fortlaufender Nummer, die sich nur noch per Gutschrift
 * korrigieren lassen.
 *
 * Geprueft wird nur, was ohne Netz sicher falsch ist: ein leerer Wert, ein
 * Partner-Schluessel (`pk_…`) oder ein Kassen-Token (`cb_…`). Die Form des
 * Kontoschluessels selbst bleibt offen, weil das Backend neben `kr_<env>_…`
 * weiterhin aeltere Formen annimmt. Die Meldung nennt nie den Wert, nur seine Art.
 */

import type { KasseneckAuth } from '../client/auth.js';
import { KasseneckAuthError } from '../client/errors.js';

export interface RechnungKeyAuthOptions {
  /** `api_key` des Kontos, z. B. `kr_live_…` oder `kr_test_…`. */
  apiKey: string;
}

export function rechnungKeyAuth(options: RechnungKeyAuthOptions): KasseneckAuth {
  const schluessel = typeof options?.apiKey === 'string' ? options.apiKey.trim() : '';
  if (!schluessel) {
    throw new KasseneckAuthError('rechnungKeyAuth: apiKey fehlt');
  }
  if (/^pk_(live|test)_/i.test(schluessel)) {
    throw new KasseneckAuthError(
      'rechnungKeyAuth: das ist ein Partner-Schluessel (pk_…) — die Rechnungs-API nimmt den api_key des Kontos (kr_…)',
    );
  }
  if (/^cb_(live|test)_/i.test(schluessel)) {
    throw new KasseneckAuthError(
      'rechnungKeyAuth: das ist ein Kassen-Token (cb_…) — die Rechnungs-API nimmt den api_key des Kontos (kr_…)',
    );
  }
  // Pro Aufruf ein frisches Objekt, wie bei den anderen Anmeldungen.
  return () => ({
    headers: { Authorization: `Bearer ${schluessel}` },
    params: {},
  });
}
