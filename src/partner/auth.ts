/**
 * Anmeldung eines Partner-Servers: der Partner-Schluessel als Bearer.
 *
 * Ein dritter Weg neben `apiKeyAuth` (Geraete) und `registerUserAuth`
 * (Browser-Kasse) — und der einzige, mit dem die Partner-Endpunkte antworten.
 * Er traegt **keine** Kopfzeile `cashregister-token`: ein Partner arbeitet nie
 * an einer Kasse, sondern ueber Betriebe.
 *
 * **Der Schluessel gehoert auf einen Server.** Er kann Betriebe anlegen und —
 * mit `credentials:read` — deren Geheimnisse holen. In einer Browser- oder
 * Mobil-App ist er ausgeliefert, nicht hinterlegt.
 */

import type { KasseneckAuth } from '../client/auth.js';
import { KasseneckAuthError } from '../client/errors.js';
import type { PartnerEnv } from './typen.js';

/**
 * Form eines Partner-Schluessels: `pk_test_…` bzw. `pk_live_…`. Der Rest ist
 * opak — die Laenge kann sich aendern, das Praefix nicht (an ihm haengt die
 * Umgebung).
 */
const SCHLUESSEL_FORM = /^pk_(test|live)_[A-Za-z0-9_-]{16,}$/;

/**
 * Die Umgebung eines Partner-Schluessels, ohne Netzaufruf — `null`, wenn es
 * keiner ist. Nuetzlich fuer die Zusicherung „auf diesem Server laeuft nur
 * `pk_live_`" beim Hochfahren.
 */
export function partnerKeyEnv(schluessel: string): PartnerEnv | null {
  const treffer = SCHLUESSEL_FORM.exec(typeof schluessel === 'string' ? schluessel.trim() : '');
  return treffer ? (treffer[1] as PartnerEnv) : null;
}

export interface PartnerKeyAuthOptions {
  /** Partner-Schluessel `pk_test_…` / `pk_live_…`. */
  partnerKey: string;
}

/**
 * Anmeldung per Partner-Schluessel.
 *
 * Die Form wird hier geprueft und nicht erst vom Server: ein vertauschter
 * `kr_live_`-Schluessel (der eines Betriebs) faellt sonst als nichtssagendes
 * „ungueltiger Schluessel" auf, obwohl er tadellos ist — nur eben fuer einen
 * anderen Weg. Die Meldung nennt nie den Wert, nur seine Art.
 */
export function partnerKeyAuth(options: PartnerKeyAuthOptions): KasseneckAuth {
  const schluessel = typeof options?.partnerKey === 'string' ? options.partnerKey.trim() : '';
  if (!schluessel) {
    throw new KasseneckAuthError('partnerKeyAuth: partnerKey fehlt');
  }
  if (!partnerKeyEnv(schluessel)) {
    throw new KasseneckAuthError(
      'partnerKeyAuth: partnerKey hat nicht die Form pk_test_… / pk_live_… — ein Betriebsschluessel (kr_…) passt hier nicht',
    );
  }
  // Pro Aufruf ein frisches Objekt: der Transport darf daran schreiben, ohne
  // die naechste Anfrage zu vergiften (wie apiKeyAuth).
  return () => ({ headers: { Authorization: `Bearer ${schluessel}` }, params: {} });
}
