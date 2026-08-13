import { parseServerTimeStamp } from '../vienna-time.js';

/**
 * Kasse — die Antwortform von `listMyCashregisters` (functions/index.js).
 *
 * Das Dart-Vorbild (`Cashregister` in kasseneck_api/lib/models/cashregister.dart)
 * liest das **Firestore-Dokument** direkt ueber das `cloud_firestore`-SDK und
 * kommt deshalb an `token` und `aes_key`. Dieses Paket spricht das Backend
 * ausschliesslich ueber die HTTPS-Endpunkte, und die geben beides nicht her:
 *
 * - **`aes_key` steht in dieser Antwort ueberhaupt nicht** (nur im
 *   Admin-Export). Ein Feld dafuer versprach hier einen `string` und lieferte
 *   `undefined` — deshalb gibt es keines mehr.
 * - **`token` ist fuer Kassen-Benutzer bewusst `null`**: im Browser traegt die
 *   Sitzung die Identitaet, und ein einmal ausgelieferter Kassen-Token liesse
 *   sich ohne Sitzung und ohne PIN weiterverwenden (so steht es im Backend an
 *   der Stelle selbst).
 *
 * `create_time` kommt aus `isoTs(...)` und ist **`null`**, wenn das Dokument
 * keinen Zeitstempel traegt. Aus `null` wird hier kein Zeitpunkt: `new Date(null)`
 * ergaebe still den 1.1.1970, und ein erfundenes Datum ist schlechter als ein
 * fehlendes.
 *
 * Aus demselben Grund fehlt `userId`: das Dart-Vorbild traegt es, weil es den
 * Firestore-**Pfad** kennt (`users/{uid}/cashregisters/{id}`). In dieser
 * Antwort steht es nicht, und ein Kassen-Benutzer erfaehrt die Kennung seines
 * Betriebs bewusst nie — sie steckt allein im Token.
 */
export interface Cashregister {
  id: string;
  /** Anzeigename der Kasse, sofern gepflegt. */
  label?: string;
  /** Freie Beschreibung, sofern gepflegt. */
  description?: string;
  /** Anlagezeitpunkt; fehlt, wenn die Antwort keinen lesbaren traegt. */
  createTime?: Date;
  /** Kassen-Token; fuer Kassen-Benutzer nie enthalten (siehe Klassenkommentar). */
  token?: string;
  /** Zugeordnete Signatureinheit. */
  signatureId?: string;
  onboarding: CashregisterOnboarding;
}

/**
 * Stand der Inbetriebnahme (RKSV): Kasse bei FinanzOnline registriert,
 * Startbeleg erzeugt, Startbeleg uebermittelt. Die drei Kennzeichen entscheiden
 * in der Browser-Kasse, ob ueberhaupt schon kassiert werden darf.
 */
export interface CashregisterOnboarding {
  cashboxRegistered: boolean;
  startbelegCreated: boolean;
  startbelegTransmitted: boolean;
  cashboxRegisteredAt?: Date;
  startbelegCreatedAt?: Date;
  startbelegTransmittedAt?: Date;
}

/** Nutzlast-Form, die dieses Paket liest — die Feldnamen von `listMyCashregisters`. */
export interface CashregisterPayload {
  id?: string | null;
  label?: string | null;
  description?: string | null;
  create_time?: string | null;
  signature_id?: string | null;
  token?: string | null;
  onboarding?: CashregisterOnboardingPayload | null;
}

export interface CashregisterOnboardingPayload {
  cashbox_registered?: boolean | null;
  startbeleg_created?: boolean | null;
  startbeleg_transmitted?: boolean | null;
  cashbox_registered_at?: string | null;
  startbeleg_created_at?: string | null;
  startbeleg_transmitted_at?: string | null;
}

/**
 * Liest eine Kasse aus der Antwort. `id` gewinnt aus der Nutzlast, faellt aber
 * auf den uebergebenen Wert zurueck — die Liste fuehrt die Dokument-ID mit,
 * ein einzeln gelesenes Dokument nicht.
 */
export function fromCashregisterPayload(payload: CashregisterPayload, id: string): Cashregister {
  const ob = payload.onboarding ?? {};
  return {
    id: payload.id ?? id,
    ...(payload.label ? { label: payload.label } : {}),
    ...(payload.description ? { description: payload.description } : {}),
    ...zeitfeld('createTime', payload.create_time),
    ...(payload.token ? { token: payload.token } : {}),
    ...(payload.signature_id ? { signatureId: payload.signature_id } : {}),
    onboarding: {
      cashboxRegistered: ob.cashbox_registered === true,
      startbelegCreated: ob.startbeleg_created === true,
      startbelegTransmitted: ob.startbeleg_transmitted === true,
      ...zeitfeld('cashboxRegisteredAt', ob.cashbox_registered_at),
      ...zeitfeld('startbelegCreatedAt', ob.startbeleg_created_at),
      ...zeitfeld('startbelegTransmittedAt', ob.startbeleg_transmitted_at),
    },
  };
}

/**
 * Ein Zeitfeld, das es nur gibt, wenn die Nutzlast einen lesbaren Zeitstempel
 * traegt. `null` (der Normalfall aus `isoTs`) und unlesbarer Unsinn ergeben
 * **kein** Feld statt eines erfundenen Zeitpunkts — die Kassenliste soll sich
 * auch dann anzeigen lassen, wenn ein einzelner Eintrag ein kaputtes Datum
 * fuehrt (dieselbe tolerante Leserichtung wie beim Enum-Lesen).
 */
function zeitfeld<K extends string>(name: K, roh: string | null | undefined): Partial<Record<K, Date>> {
  const wert = zeitpunkt(roh);
  return (wert === undefined ? {} : { [name]: wert }) as Partial<Record<K, Date>>;
}

function zeitpunkt(roh: string | null | undefined): Date | undefined {
  if (typeof roh !== 'string' || roh.trim() === '') {
    return undefined;
  }
  try {
    // Ueber parseServerTimeStamp und nie ueber `new Date(text)`: ein
    // offsetloser Zeitstempel waere sonst die lokale Zeit des ausfuehrenden
    // Rechners (siehe ../vienna-time.ts).
    return parseServerTimeStamp(roh);
  } catch {
    return undefined;
  }
}
