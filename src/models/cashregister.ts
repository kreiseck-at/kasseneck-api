import { parseServerTimeStamp } from '../vienna-time.js';

/**
 * Kasse — die Antwortform von `listMyCashregisters` (functions/index.js).
 *
 * Das Dart-Vorbild (`Cashregister` in kasseneck_api/lib/models/cashregister.dart)
 * liest das **Datenbankdokument** direkt ueber das SDK der Echtzeit-Datenbank und
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
 * **Pfad** in der Datenbank kennt (`users/{uid}/cashregisters/{id}`). In dieser
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
  /** Lager-Standort der Kasse (Lager-Kern Stufe 2); fehlt = Standard-Standort des Betriebs. */
  stockLocationId?: string;
  /**
   * Eigene Abmelde-Werte dieser Kasse; fehlt, wenn die Kasse keine eigenen hat
   * (dann gelten die Werte des Betriebs).
   */
  autoLogout?: CashregisterAutoLogout;
  onboarding: CashregisterOnboarding;
}

/**
 * Automatisches Abmelden an der Kasse. Beide Felder sind einzeln optional: der
 * Server sendet nur, was die Kasse selbst gesetzt hat.
 */
export interface CashregisterAutoLogout {
  /** Abmeldung nach Leerlauf in Minuten; `0` = aus. */
  autoLogoutMinutes?: 0 | 1 | 5 | 15 | 30;
  /** Nach jedem Verkauf abmelden. */
  logoutAfterSale?: boolean;
}

/**
 * Stand der Inbetriebnahme (RKSV): Kasse bei FinanzOnline registriert,
 * Startbeleg erzeugt, Startbeleg uebermittelt. Die drei Kennzeichen entscheiden
 * in der Browser-Kasse, ob ueberhaupt schon kassiert werden darf.
 */
export interface CashregisterOnboarding {
  cashboxRegistered: boolean;
  startReceiptCreated: boolean;
  startReceiptTransmitted: boolean;
  cashboxRegisteredAt?: Date;
  startReceiptCreatedAt?: Date;
  startReceiptTransmittedAt?: Date;
}

/** Nutzlast-Form, die dieses Paket liest — die Feldnamen von `listMyCashregisters`. */
export interface CashregisterPayload {
  id?: string | null;
  label?: string | null;
  description?: string | null;
  create_time?: string | null;
  signature_id?: string | null;
  stockLocationId?: string | null;
  autoLogout?: CashregisterAutoLogoutPayload | null;
  token?: string | null;
  onboarding?: CashregisterOnboardingPayload | null;
}

/** `autoLogout` am Draht `/v3`; die Namen sind dieselben wie am Modell. */
export interface CashregisterAutoLogoutPayload {
  autoLogoutMinutes?: number | null;
  logoutAfterSale?: boolean | null;
}

/**
 * `onboarding` am Draht `/v3` (fixtures/v3/antworten/kasse.json): der
 * Startbeleg heisst dort `start_receipt_*`. Die inneren Namen
 * `startbeleg_*` sendet nur `/v1`; wer sie hier laese, meldete jede Kasse
 * als „Startbeleg fehlt“.
 */
export interface CashregisterOnboardingPayload {
  cashbox_registered?: boolean | null;
  start_receipt_created?: boolean | null;
  start_receipt_transmitted?: boolean | null;
  cashbox_registered_at?: string | null;
  start_receipt_created_at?: string | null;
  start_receipt_transmitted_at?: string | null;
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
    ...(payload.stockLocationId ? { stockLocationId: payload.stockLocationId } : {}),
    ...autoLogoutFeld(payload.autoLogout),
    onboarding: {
      cashboxRegistered: ob.cashbox_registered === true,
      startReceiptCreated: ob.start_receipt_created === true,
      startReceiptTransmitted: ob.start_receipt_transmitted === true,
      ...zeitfeld('cashboxRegisteredAt', ob.cashbox_registered_at),
      ...zeitfeld('startReceiptCreatedAt', ob.start_receipt_created_at),
      ...zeitfeld('startReceiptTransmittedAt', ob.start_receipt_transmitted_at),
    },
  };
}

const AUTO_LOGOUT_MINUTEN: ReadonlySet<number> = new Set([0, 1, 5, 15, 30]);

/**
 * `autoLogout` gibt es nur, wenn die Nutzlast mindestens einen lesbaren Wert
 * traegt. Eine Minutenzahl ausserhalb von 0/1/5/15/30 wird verworfen statt
 * durchgereicht (ein neuer Server-Wert soll die Kasse nicht unlesbar machen).
 */
function autoLogoutFeld(roh: CashregisterAutoLogoutPayload | null | undefined): { autoLogout?: CashregisterAutoLogout } {
  if (roh === null || roh === undefined || typeof roh !== 'object') {
    return {};
  }
  const wert: CashregisterAutoLogout = {};
  if (typeof roh.autoLogoutMinutes === 'number' && AUTO_LOGOUT_MINUTEN.has(roh.autoLogoutMinutes)) {
    wert.autoLogoutMinutes = roh.autoLogoutMinutes as CashregisterAutoLogout['autoLogoutMinutes'];
  }
  if (typeof roh.logoutAfterSale === 'boolean') {
    wert.logoutAfterSale = roh.logoutAfterSale;
  }
  return Object.keys(wert).length === 0 ? {} : { autoLogout: wert };
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
