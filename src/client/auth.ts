/**
 * Die zwei Anmeldewege ans Kasseneck-Backend — gleichrangig, austauschbar,
 * keiner ist der bevorzugte:
 *
 * - `apiKeyAuth` — der Weg der Geraete, POS-Apps und Dritten: der `api_key` als
 *   Bearer plus die Kopfzeile `cashregister-token` (wie im Flutter-Zwilling
 *   `kasseneck_api`).
 * - `registerUserAuth` — der Weg der Browser-Kasse: ein Kassen-Benutzer, per
 *   PIN an einem gekoppelten Geraet angemeldet. Firebase-ID-Token als Bearer,
 *   die laufende Sitzung als Kopfzeile `register-session`, die Kasse als
 *   Parameter `cashregisterId` in der Nutzlast.
 *
 * Eine Anmeldung liefert **nur** Kopfzeilen und ggf. Zusatzparameter. Sie
 * fuehrt keine eigenen HTTP-Aufrufe, kennt den Transport nicht und haelt keinen
 * Zustand — genau deshalb ist sie austauschbar und einzeln testbar.
 *
 * Das Paket weiss **nichts** von Firebase: `registerUserAuth` bekommt eine
 * Funktion, die ein gueltiges ID-Token liefert (darf `async` sein). Sie wird
 * bei **jedem** Aufruf befragt — Firebase-ID-Tokens laufen nach einer Stunde
 * ab, die Sitzung der Browser-Kasse lebt sogar nur 90 Sekunden und wird alle
 * 30 Sekunden erneuert; ein einmal gemerkter Wert waere also bald tot.
 */

/** Was eine Anmeldung zu einer Anfrage beisteuert. */
export interface AuthCredentials {
  /** Kopfzeilen der Anfrage (mindestens `Authorization`). */
  headers: Record<string, string>;
  /** Zusatzparameter, die in die Nutzlast wandern (z. B. `cashregisterId`). */
  params: Record<string, unknown>;
}

/**
 * Eine Anmeldung ist eine Funktion, die pro Anfrage frische Zugangsdaten
 * liefert (synchron oder asynchron).
 */
export type KasseneckAuth = () => AuthCredentials | Promise<AuthCredentials>;

export interface ApiKeyAuthOptions {
  /** API-Schluessel im Format `kr_<env>_<...>` (opak). */
  apiKey: string;
  /** Kassen-Token der Kasse, an der gearbeitet wird (`cb_<env>_<...>`). */
  cashregisterToken: string;
}

export interface RegisterUserAuthOptions {
  /** Liefert ein gueltiges Firebase-ID-Token; wird pro Anfrage befragt. */
  getIdToken: () => string | Promise<string>;
  /** Liefert die laufende Kassen-Sitzung; wird pro Anfrage befragt. */
  getSessionId: () => string | Promise<string>;
  /** Kasse, an der der Kassen-Benutzer angemeldet ist. */
  cashregisterId: string;
}

/** Anmeldung per API-Schluessel und Kassen-Token (Geraete, POS-Apps, Dritte). */
export function apiKeyAuth(options: ApiKeyAuthOptions): KasseneckAuth {
  // Fehlende Zugangsdaten fallen hier auf und nicht erst als 401 vom Backend.
  // Die Meldung nennt nur das leere Feld, nie einen Wert.
  if (!options.apiKey) {
    throw new Error('apiKeyAuth: apiKey fehlt');
  }
  if (!options.cashregisterToken) {
    throw new Error('apiKeyAuth: cashregisterToken fehlt');
  }
  const { apiKey, cashregisterToken } = options;
  // Pro Aufruf ein frisches Objekt: der Transport (oder ein Aufrufer) darf
  // daran herumschreiben, ohne die naechste Anfrage zu vergiften.
  return () => ({
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'cashregister-token': cashregisterToken,
    },
    params: {},
  });
}

/** Anmeldung eines Kassen-Benutzers der Browser-Kasse (ID-Token + Sitzung). */
export function registerUserAuth(options: RegisterUserAuthOptions): KasseneckAuth {
  if (!options.cashregisterId) {
    throw new Error('registerUserAuth: cashregisterId fehlt');
  }
  const { getIdToken, getSessionId, cashregisterId } = options;
  return async () => {
    // Beides bei JEDEM Aufruf frisch — siehe Modulkommentar (Ablaufzeiten).
    const [idToken, sessionId] = await Promise.all([getIdToken(), getSessionId()]);
    if (!idToken) {
      throw new Error('registerUserAuth: getIdToken lieferte kein Token');
    }
    if (!sessionId) {
      throw new Error('registerUserAuth: getSessionId lieferte keine Sitzung');
    }
    return {
      headers: {
        Authorization: `Bearer ${idToken}`,
        'register-session': sessionId,
      },
      params: { cashregisterId },
    };
  };
}
