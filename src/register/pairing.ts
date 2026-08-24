import type { KasseneckAuth } from '../client/auth.js';
import { KasseneckValidationError } from '../client/errors.js';
import type { InternerTransport } from '../client/aufrufe.js';
import { createTransport, type TransportOptions } from '../client/transport.js';
import { fromReceiptCompanyPayload, type ReceiptCompany, type ReceiptCompanyPayload } from '../models/receipt-company.js';
import {
  KASSE_BETRIEB_STANDARD, KASSE_GERAET_STANDARD, mergeKasseSettings,
  type KasseSettings, type KasseSettingsBetrieb, type KasseSettingsGeraet,
} from '../kasse/settings.js';

/**
 * Die drei Aufrufe, die **ohne jede Identitaet** laufen: Kopplung eines
 * Geraets, Benutzerliste dieses Geraets, PIN-Anmeldung. Sie sind der Weg, auf
 * dem eine Identitaet ueberhaupt erst entsteht — vor ihnen gibt es weder
 * ID-Token noch Sitzung noch `api_key`.
 *
 * **Warum sie keine Anmeldung und keinen Transport entgegennehmen.** Alle
 * uebrigen Endpunkt-Aufrufe dieses Pakets bekommen einen fertigen
 * [KasseneckTransport] als ersten Parameter. Hier ginge das nur mit einer
 * anmeldungsfreien Anmeldung — und die muesste dann exportiert sein. Genau das
 * waere ein Schlupfloch: mit ihr liesse sich `createTransport` bzw.
 * `createKasseneckApi` bauen und damit **jeder** Aufruf des Pakets ohne
 * Anmeldung absetzen, auch `createReceipt`. Das Backend wiese das ab, aber ein
 * Paket, das den Weg anbietet, sagt damit, dass es ihn gibt.
 *
 * Deshalb nehmen diese drei nur die **Verbindungsangaben** (Basis-URL,
 * Zeitlimit, `fetch`) entgegen und bauen ihren Transport selbst — mit einer
 * Anmeldung, die diese Datei nicht verlaesst. Damit gibt es im ganzen Paket
 * keinen Weg, einen anmeldungsfreien Transport in die Hand zu bekommen.
 *
 * **Geheimnisse in der Nutzlast.** Diese drei Aufrufe fuehren Kopplungs-Code,
 * Geraetegeheimnis und PIN — nicht in Kopfzeilen, sondern im Rumpf. Der
 * Transport schuetzt seine Fehler von sich aus nur gegen die Werte, die er als
 * Kopfzeilen gesendet hat (siehe client/errors.ts, `causeDigest`); hier ist
 * diese Liste leer. Die Aufrufe nennen ihm ihre Geheimnisse deshalb
 * ausdruecklich, sonst kaeme ein bezeichner-foermiges Geraetegeheimnis ueber
 * die verdichtete Ursache eines Netzfehlers doch noch ins Protokoll.
 */

/**
 * Anmeldung, die keine ist: weder Kopfzeilen noch Zusatzparameter.
 *
 * **Nicht exportiert und niemals exportieren** — der Grund steht im
 * Modulkommentar. Pro Aufruf ein frisches Objekt, wie die echten Anmeldungen
 * es auch halten.
 */
const ohneAnmeldung: KasseneckAuth = () => ({ headers: {}, params: {} });

/**
 * Verbindungsangaben ohne Anmeldung — alles, was [TransportOptions] ausser der
 * Anmeldung fuehrt. Alle Felder sind wahlfrei: ohne Angabe gelten Basis-URL und
 * Zeitlimit der Produktion und das globale `fetch`.
 */
export type RegisterDeviceConnection = Omit<TransportOptions, 'auth'>;

/** Ausweis eines gekoppelten Geraets — Nachweis der beiden Folgeaufrufe. */
export interface RegisterDeviceCredentials {
  /** Kunde, unter dem das Geraet haengt (aus der Kopplung). */
  ownerUid: string;
  /** Dieses Geraet (aus der Kopplung). */
  deviceId: string;
  /** Geheimnis dieses Geraets; das Backend liefert es genau einmal aus. */
  deviceSecret: string;
}

/** Was das Geraet ueber sich sagt -- fuer das Panel (welches Geraet ist das?). Alles optional. */
export interface RegisterClientInfo {
  userAgent?: string;
  platform?: string;
  language?: string;
  /** IANA-Zeitzone, z. B. Europe/Vienna. */
  tz?: string;
  screen?: { w: number; h: number };
}
/** Standort aus der Browser-Ortung (freiwillig); Grundlage der Standortsperre. */
export interface RegisterGeo {
  lat: number;
  lng: number;
  /** Genauigkeit in Metern. */
  acc?: number;
}
/** Angaben, die Kopplung und Login zusaetzlich mitschicken duerfen. */
export interface RegisterGeraeteAngaben {
  client?: RegisterClientInfo;
  geo?: RegisterGeo | null;
}

export interface PairRegisterDeviceOptions extends RegisterDeviceConnection, RegisterGeraeteAngaben {
  /**
   * Die Kasse ist schon auf einem anderen Geraet geoeffnet (BELEGT-Rueckfrage):
   * `true` uebernimmt sie hierher und widerruft das alte Geraet.
   */
  takeover?: boolean;
  /**
   * Achtstelliger Kopplungs-Code aus dem Panel. Er ist 15 Minuten gueltig,
   * genau **einmal** verwendbar und gilt fuer eine bestimmte Kasse.
   *
   * Gross-/Kleinschreibung und Leerzeichen an den Raendern sind gleichgueltig:
   * das Backend beschneidet und schreibt gross. Dieses Paket prueft das Format
   * **nicht** — es kennt das Alphabet nicht und wuerde eine spaetere Erweiterung
   * ausschliessen.
   */
  code: string;
  /** Bezeichnung dieses Geraets in der Geraeteliste; ohne Angabe "Kasse". */
  label?: string;
}

/** Ergebnis der Kopplung — der vollstaendige Ausweis dieses Geraets. */
export interface PairedRegisterDevice extends RegisterDeviceCredentials {
  /** Kasse, an die die Kopplung dieses Geraet gebunden hat. */
  cashregisterId: string;
  /** Firmenname des Betriebs (Backend: `betrieb`) — Anzeige, kann leer sein. */
  companyName: string;
  /** Bezeichnung der Kasse (Backend: `kasse`) — Anzeige, kann leer sein. */
  cashregisterLabel: string;
}

/**
 * Art eines Kassen-Benutzers: eine Person oder ein Geraet (Sammelkonto). Ein
 * kuenftiger, hier noch unbekannter Wert kommt unveraendert durch, statt still
 * zu "person" zu werden — beim Lesen ist dieses Paket tolerant.
 */
export type RegisterUserKind = 'person' | 'device' | (string & {});

/** Ein Kassen-Benutzer, wie ihn der Anmeldebildschirm zeigt. */
export interface RegisterUserSummary {
  id: string;
  /** Anzeigename; kann leer sein. */
  name: string;
  kind: RegisterUserKind;
  /**
   * Die PIN dieses Benutzers wurde noch nicht unter der aktuellen Regel des
   * Betriebs gesetzt: die Kasse zeigt ihm das Freifeld statt der Kaestchen.
   * Das Backend sendet das Feld nur, wenn es zutrifft; gelesen ist es immer da.
   */
  altbestand: boolean;
}

/** PIN-Regel des Betriebs — daraus baut die Kasse Kaestchen und Tastatur. */
export interface RegisterPinPolicy {
  /** Feste Stellenzahl (Backend: 3 bis 6). */
  stellen: number;
  /** `ziffern` (nur 0-9) oder `zeichen` (0-9 plus Kopplungs-Alphabet). */
  zeichen: 'ziffern' | 'zeichen' | (string & {});
}

/** Anmeldemodus des Geraets; ein unbekannter kuenftiger Wert kommt durch. */
export type RegisterLoginMode = 'auswahl' | 'pin' | (string & {});

/** Antwort von [listRegisterUsersForDevice]: Benutzer, Regel, Modus. */
export interface RegisterDeviceUsers {
  /** Im Modus `pin` bewusst leer — Namen haben am nur-PIN-Geraet nichts verloren. */
  users: RegisterUserSummary[];
  /** Kassen-Einstellungen (betriebsweit + Geraet), gemischt mit den Standardwerten. */
  settings: KasseSettings;
  /** Belegkopf-Daten des Betriebs (Name, Anschrift, UID, Fusszeilen) -- ohne Geheimnisse. */
  betriebsdaten: ReceiptCompany | null;
  /**
   * `null`, wenn das Backend (noch) keine Regel nennt — dann zeigt die Kasse
   * das Freifeld, statt Kaestchen mit einer erratenen Stellenzahl.
   */
  policy: RegisterPinPolicy | null;
  loginMode: RegisterLoginMode;
  /** Der Betrieb verlangt die Ortung beim Login (Standortsperre an). */
  standortsperre: boolean;
  /**
   * Darf die gebundene Kasse ueberhaupt Belege erstellen? `bereit: false`
   * nennt den Grund (ausser Betrieb, Schlussbeleg erstellt) — die Kasse
   * sperrt das Kassieren VOR dem ersten Beleg statt an createReceipt zu
   * scheitern. Fehlt das Feld (aelteres Backend), gilt bereit.
   */
  kasse?: { bereit: boolean; grund?: string | null } | null;
}

/**
 * Rechte eines Kassen-Benutzers (Backend: `perms`, Vorlagen `PERMS_KASSIER`
 * und `PERMS_CHEF`). Der Inhaber kann einzelne Rechte abweichend setzen,
 * deshalb sind weitere Schluessel zugelassen.
 *
 * **Ein fehlendes Recht gilt als nicht erteilt.** Die Oberflaeche soll im
 * Zweifel weniger anbieten, nicht mehr; die tatsaechliche Grenze zieht ohnehin
 * das Backend.
 */
/** Reichweite eines Rechts: keine | nur eigene Belege | alle. */
export type RegisterScope = 'none' | 'own' | 'all';

export interface RegisterUserPerms {
  /** Belege ausstellen. */
  sell: boolean;
  /** Belege stornieren (Schalter, gespiegelt aus cancelScope !== 'none'). */
  cancel: boolean;
  /** Artikelstamm bearbeiten. */
  articles: boolean;
  /** Beleglayout/Kassen-Einstellungen bearbeiten (Chef). */
  layout: boolean;
  /** Berichte ansehen. */
  reports: boolean;
  /** Eine belegte Kasse uebernehmen (nur Kassen-Chef). */
  takeover: boolean;
  /** Storno-Reichweite; fehlt bei Altbestand (dann zaehlt `cancel`: true = all). */
  cancelScope?: RegisterScope;
  /** Belege ansehen; fehlt bei Altbestand (= all). */
  receiptsScope?: RegisterScope;
  /** Kassenlade ohne Verkauf oeffnen. */
  drawer?: boolean;
  /** Rabatt geben. */
  discount?: boolean;
  /** Trinkgeld anderen zuweisen. */
  tipAssign?: boolean;
  [weiteresRecht: string]: boolean | RegisterScope | undefined;
}

/**
 * Die **ausdruecklich benannten** Schluessel eines Typs; die einer
 * Index-Signatur bleiben draussen.
 *
 * Fuer [RegisterUserPerms] ist dieser Umweg noetig: wegen
 * `[weiteresRecht: string]` ist `keyof RegisterUserPerms` schlicht
 * `string | number`. Jede Pruefung dagegen — auch ein
 * `satisfies (keyof RegisterUserPerms)[]` — ginge deshalb ins Leere und
 * liesse jeden Namen durch. Erst die Umbenennung im `as`-Teil wirft die
 * Index-Signatur weg und laesst die elf echten Rechte stehen.
 */
type BenannteSchluessel<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: unknown;
};

/** Ein Recht, das [RegisterUserPerms] namentlich fuehrt. */
type BenanntesRecht = BenannteSchluessel<RegisterUserPerms>;

/**
 * Alle Rechte-Schluessel, die dieses Paket kennt — die Zwillinge pruefen
 * dagegen, und ueber `fixtures/oberflaeche.json` steht die Liste im Vertrag.
 *
 * `satisfies` schliesst die eine Richtung: ein Name, den [RegisterUserPerms]
 * nicht fuehrt (Tippfehler, umbenanntes Recht), kommt hier nicht durch.
 * Die Gegenrichtung schliesst [_RechteVollstaendig] direkt darunter.
 */
export const REGISTER_PERMS = [
  'sell', 'cancel', 'articles', 'layout', 'reports', 'takeover',
  'cancelScope', 'receiptsScope', 'drawer', 'discount', 'tipAssign',
] as const satisfies readonly BenanntesRecht[];

/**
 * Die Gegenrichtung: **jedes** benannte Recht muss in [REGISTER_PERMS] stehen.
 *
 * `Exclude<…>` ist genau die Menge der vergessenen Rechte. Ist sie leer, ist
 * das Argument `never` und alles gut; steht am Interface ein Recht mehr als in
 * der Liste, verlangt `AlleRechteGelistet` ein `never` und bekommt einen
 * Rechtenamen — der Bau bricht ab und nennt ihn:
 *
 *     Type '"kassensturz"' does not satisfy the constraint 'never'.
 *
 * Ohne diese Klammer waere [REGISTER_PERMS] eine handgepflegte Zweitliste:
 * ein neues Recht am Interface kompiliert klaglos, erreicht den Vertrag aber
 * nie — und bei Rechten heisst das, dass Backend und Flutter-Zwilling eine
 * Berechtigung nicht kennen, die es gibt.
 */
type AlleRechteGelistet<Vergessen extends never> = Vergessen;
type _RechteVollstaendig = AlleRechteGelistet<
  Exclude<BenanntesRecht, (typeof REGISTER_PERMS)[number]>
>;

/** Reichweite lesen, mit der Migration des Backends (register-auth.js). */
export function cancelScopeOf(perms: RegisterUserPerms | null | undefined): RegisterScope {
  if (!perms) return 'none';
  if (perms.cancelScope !== undefined) return ['none', 'own', 'all'].includes(perms.cancelScope) ? perms.cancelScope : 'none';
  return perms.cancel === true ? 'all' : 'none';
}
export function receiptsScopeOf(perms: RegisterUserPerms | null | undefined): RegisterScope {
  if (!perms) return 'none';
  if (perms.receiptsScope === undefined) return 'all';
  return ['none', 'own', 'all'].includes(perms.receiptsScope) ? perms.receiptsScope : 'none';
}

/** Der angemeldete Kassen-Benutzer. */
export interface RegisterUser {
  id: string;
  name: string;
  perms: RegisterUserPerms;
}

/** Ergebnis der PIN-Anmeldung. */
export interface RegisterUserSession {
  /**
   * Firebase-Custom-Token. Damit meldet der Verbraucher sich bei Firebase an
   * und bekommt das ID-Token, das `registerUserAuth` braucht; dieses Paket
   * kennt Firebase nicht.
   */
  customToken: string;
  /** Laufende Sitzung — Kopfzeile `register-session` jedes weiteren Aufrufs. */
  sessionId: string;
  /**
   * Ablauf der Sitzung in Millisekunden seit 1970 (das Backend rechnet hier mit
   * `Date.now()`, nicht mit Wiener Wanduhrzeit). Die Sitzung lebt 90 Sekunden
   * und will alle 30 Sekunden erneuert werden.
   */
  expiresAt: number;
  user: RegisterUser;
}

export interface ListRegisterUsersForDeviceOptions
  extends RegisterDeviceConnection,
    RegisterDeviceCredentials {}

export interface RegisterUserLoginOptions extends RegisterDeviceConnection, RegisterDeviceCredentials, RegisterGeraeteAngaben {
  /** Kassen-Benutzer aus [listRegisterUsersForDevice]. */
  userId: string;
  /**
   * PIN dieses Benutzers. Das Format prueft dieses Paket **nicht**: eine zu
   * strenge Pruefung im Client sperrte Benutzer aus, deren PIN das Panel anders
   * gesetzt hat.
   */
  pin: string;
  /** Kasse, an der die Sitzung eroeffnet wird. */
  cashregisterId: string;
  /**
   * Eine belegte Kasse uebernehmen. Nur mit dem Recht `takeover` (Kassen-Chef);
   * die aelteste laufende Sitzung wird dabei verdraengt. Ohne das Recht bleibt
   * es bei der Abweisung "Kasse wird gerade auf … verwendet".
   */
  takeover?: boolean;
}

export interface RegisterPinLoginOptions extends RegisterDeviceConnection, RegisterDeviceCredentials, RegisterGeraeteAngaben {
  /**
   * Die PIN allein — sie identifiziert UND authentifiziert (Geraete-Modus
   * `pin`; das Backend haelt PINs je Betrieb eindeutig). Das Format prueft
   * dieses Paket **nicht** — dieselbe Zurueckhaltung wie bei
   * [RegisterUserLoginOptions.pin].
   */
  pin: string;
  /** Kasse, an der die Sitzung eroeffnet wird. */
  cashregisterId: string;
  /** Wie [RegisterUserLoginOptions.takeover]. */
  takeover?: boolean;
}

/**
 * Geraet koppeln: der Kopplungs-Code wird gegen den dauerhaften Ausweis dieses
 * Geraets getauscht. **Ohne Anmeldung** — der Code ist der Nachweis.
 *
 * Er wird dabei verbraucht, auch wenn der Aufrufer das Ergebnis verliert: eine
 * unvollstaendige Antwort ist deshalb ein Fehler und kein halbes Geraet (siehe
 * [PairedRegisterDevice]).
 */
export async function pairRegisterDevice(options: PairRegisterDeviceOptions): Promise<PairedRegisterDevice> {
  const { code, label, client, geo, takeover, ...verbindung } = options;
  pflicht('pairRegisterDevice', 'code', code);

  // Der Code ist das Geheimnis dieses Aufrufs — siehe Modulkommentar.
  const daten = await transportFuer(verbindung)<Record<string, unknown>>(
    'pairRegisterDevice',
    { code, label, client, geo: geo ?? undefined, takeover: takeover === true ? true : undefined },
    undefined,
    [code],
  );

  return {
    deviceId: pflichtfeld('pairRegisterDevice', daten, 'deviceId'),
    deviceSecret: pflichtfeld('pairRegisterDevice', daten, 'deviceSecret'),
    ownerUid: pflichtfeld('pairRegisterDevice', daten, 'ownerUid'),
    cashregisterId: pflichtfeld('pairRegisterDevice', daten, 'cashregisterId'),
    companyName: text(daten?.['betrieb']),
    cashregisterLabel: text(daten?.['kasse']),
  };
}

/**
 * Kassen-Benutzer dieses Betriebs auflisten — die Auswahl des
 * Anmeldebildschirms. **Ohne Anmeldung**; der Ausweis des Geraets ist der
 * Nachweis.
 *
 * Die Antwort traegt ausschliesslich Kennung, Name und Art: keine Rechte, keine
 * Kassen, keine Hashes. Gesperrte Benutzer fehlen bereits in der Antwort.
 */
/**
 * „Geraet entkoppeln“ an der Kasse selbst: das Geraet weist sich mit seinem
 * Geheimnis aus und sperrt sich im Backend — damit sieht das Panel den
 * Widerruf und keine Sitzung laeuft nach. Idempotent: ein schon gesperrtes
 * Geraet meldet Erfolg. Danach das Geraet lokal vergessen.
 */
export async function unpairRegisterDevice(options: ListRegisterUsersForDeviceOptions): Promise<void> {
  const { ownerUid, deviceId, deviceSecret, ...verbindung } = options;
  const name = 'unpairRegisterDevice';
  pflicht(name, 'ownerUid', ownerUid);
  pflicht(name, 'deviceId', deviceId);
  pflicht(name, 'deviceSecret', deviceSecret);
  await transportFuer(verbindung)<Record<string, unknown>>(name, { ownerUid, deviceId, deviceSecret }, undefined, [deviceSecret]);
}

export async function listRegisterUsersForDevice(
  options: ListRegisterUsersForDeviceOptions,
): Promise<RegisterDeviceUsers> {
  const { ownerUid, deviceId, deviceSecret, ...verbindung } = options;
  const name = 'listRegisterUsersForDevice';
  pflicht(name, 'ownerUid', ownerUid);
  pflicht(name, 'deviceId', deviceId);
  pflicht(name, 'deviceSecret', deviceSecret);

  const daten = await transportFuer(verbindung)<{ users?: unknown; policy?: unknown; loginMode?: unknown; settings?: unknown; betriebsdaten?: unknown; standortsperre?: unknown; kasse?: unknown }>(
    name,
    { ownerUid, deviceId, deviceSecret },
    undefined,
    [deviceSecret],
  );

  const liste = daten?.users;
  if (!Array.isArray(liste)) {
    throw antwortfehler(name, 'Antwort enthaelt keine Benutzerliste (data.users fehlt)');
  }
  const users = liste.map((eintrag): RegisterUserSummary => {
    const roh = (typeof eintrag === 'object' && eintrag !== null ? eintrag : {}) as Record<string, unknown>;
    return {
      // Ein Eintrag ohne Kennung ist nicht anmeldbar — ihn anzuzeigen hiesse,
      // dem Kassier eine Schaltflaeche zu geben, die nichts tun kann.
      id: pflichtfeld(name, roh, 'id'),
      name: text(roh['name']),
      kind: typeof roh['kind'] === 'string' && roh['kind'] ? (roh['kind'] as RegisterUserKind) : 'person',
      altbestand: roh['altbestand'] === true,
    };
  });
  const settingsRoh = (daten?.settings ?? {}) as { betrieb?: unknown; geraet?: unknown };
  const settings: KasseSettings = {
    betrieb: mergeKasseSettings(KASSE_BETRIEB_STANDARD, (settingsRoh.betrieb ?? null) as Partial<KasseSettingsBetrieb> | null),
    geraet: mergeKasseSettings(KASSE_GERAET_STANDARD, (settingsRoh.geraet ?? null) as Partial<KasseSettingsGeraet> | null),
  };
  const bd = daten?.betriebsdaten;
  const betriebsdaten = bd && typeof bd === 'object' ? fromReceiptCompanyPayload(bd as ReceiptCompanyPayload) : null;
  return {
    users,
    policy: regel(daten?.policy),
    loginMode: daten?.loginMode === 'pin' ? 'pin' : 'auswahl',
    settings,
    betriebsdaten,
    standortsperre: daten?.standortsperre === true,
    // 0.6.27 ergaenzte nur den TYP — hier fiel das Feld beim Zusammenbau
    // stumm weg, und die Kasse sah nie eine Sperre. Fehlt es (aelteres
    // Backend), bleibt es undefined: dann gilt bereit.
    kasse: kasseBereit(daten?.kasse),
  };
}

function kasseBereit(wert: unknown): { bereit: boolean; grund?: string | null } | undefined {
  if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) return undefined;
  const roh = wert as Record<string, unknown>;
  if (typeof roh['bereit'] !== 'boolean') return undefined;
  return { bereit: roh['bereit'], grund: typeof roh['grund'] === 'string' ? roh['grund'] : null };
}

/** Die Regel aus der Antwort — oder `null`, wenn keine brauchbare kommt. */
function regel(wert: unknown): RegisterPinPolicy | null {
  if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) return null;
  const roh = wert as Record<string, unknown>;
  const stellen = roh['stellen'];
  const zeichen = roh['zeichen'];
  if (typeof stellen !== 'number' || !Number.isInteger(stellen) || stellen < 1) return null;
  if (typeof zeichen !== 'string' || zeichen === '') return null;
  return { stellen, zeichen: zeichen as RegisterPinPolicy['zeichen'] };
}

/**
 * Kassen-Benutzer per PIN anmelden. **Ohne Anmeldung** — dieser Aufruf
 * erzeugt sie: das Custom Token der Antwort wird zum ID-Token, die `sessionId`
 * zur Kopfzeile `register-session`. Beides zusammen ergibt `registerUserAuth`.
 *
 * Das Backend prueft in dieser Reihenfolge: Geraet, Benutzer, Sperre, PIN,
 * Kassenzuweisung, Kopplungsbindung, Lizenzplatz. Fehlversuche zaehlen und
 * sperren gestaffelt (ab dem fuenften 30 Sekunden, ab dem neunten 15 Minuten).
 */
export async function registerUserLogin(options: RegisterUserLoginOptions): Promise<RegisterUserSession> {
  const { ownerUid, deviceId, deviceSecret, userId, pin, cashregisterId, takeover, client, geo, ...verbindung } = options;
  const name = 'registerUserLogin';
  pflicht(name, 'ownerUid', ownerUid);
  pflicht(name, 'deviceId', deviceId);
  pflicht(name, 'deviceSecret', deviceSecret);
  pflicht(name, 'userId', userId);
  pflicht(name, 'pin', pin);
  pflicht(name, 'cashregisterId', cashregisterId);

  const daten = await transportFuer(verbindung)<Record<string, unknown>>(
    name,
    {
      ownerUid,
      deviceId,
      deviceSecret,
      userId,
      pin,
      cashregisterId,
      // Nur die ausdrueckliche Uebernahme geht mit: das Backend prueft auf
      // `=== true`, und ein mitgesendetes `false` waere nur Rauschen.
      takeover: takeover === true ? true : undefined,
      client, geo: geo ?? undefined,
    },
    undefined,
    [pin, deviceSecret],
  );

  return sitzungAusAntwort(name, daten);
}

/**
 * Kassen-Benutzer allein mit der PIN anmelden (Geraete-Modus `pin`). **Ohne
 * Anmeldung** — wie [registerUserLogin], nur ohne Benutzerauswahl: das Backend
 * ermittelt den Benutzer ueber die betriebsweit eindeutige PIN. Fehlversuche
 * zaehlen und sperren dort am **Geraet**, nicht an einem Benutzer.
 */
export async function registerPinLogin(options: RegisterPinLoginOptions): Promise<RegisterUserSession> {
  const { ownerUid, deviceId, deviceSecret, pin, cashregisterId, takeover, client, geo, ...verbindung } = options;
  const name = 'registerPinLogin';
  pflicht(name, 'ownerUid', ownerUid);
  pflicht(name, 'deviceId', deviceId);
  pflicht(name, 'deviceSecret', deviceSecret);
  pflicht(name, 'pin', pin);
  pflicht(name, 'cashregisterId', cashregisterId);

  const daten = await transportFuer(verbindung)<Record<string, unknown>>(
    name,
    {
      ownerUid,
      deviceId,
      deviceSecret,
      pin,
      cashregisterId,
      // Nur die ausdrueckliche Uebernahme geht mit — wie bei registerUserLogin.
      takeover: takeover === true ? true : undefined,
      client, geo: geo ?? undefined,
    },
    undefined,
    [pin, deviceSecret],
  );

  return sitzungAusAntwort(name, daten);
}

/** Die Sitzungsantwort beider Anmeldewege — ein Vertrag, eine Lesart. */
function sitzungAusAntwort(name: string, daten: Record<string, unknown> | null | undefined): RegisterUserSession {
  const roherBenutzer = daten?.['user'];
  if (typeof roherBenutzer !== 'object' || roherBenutzer === null || Array.isArray(roherBenutzer)) {
    throw antwortfehler(name, 'Antwort enthaelt keinen Benutzer (data.user fehlt)');
  }
  const benutzer = roherBenutzer as Record<string, unknown>;
  const expiresAt = daten?.['expiresAt'];
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    throw antwortfehler(name, 'Antwort enthaelt keinen Ablaufzeitpunkt (data.expiresAt fehlt)');
  }

  return {
    customToken: pflichtfeld(name, daten, 'customToken'),
    sessionId: pflichtfeld(name, daten, 'sessionId'),
    expiresAt,
    user: {
      id: pflichtfeld(name, benutzer, 'id'),
      name: text(benutzer['name']),
      perms: rechte(benutzer['perms']),
    },
  };
}

/** Transport ohne Anmeldung; `auth` steht zuletzt und ist damit nicht zu ueberschreiben. */
function transportFuer(verbindung: RegisterDeviceConnection): InternerTransport {
  return createTransport({ ...verbindung, auth: ohneAnmeldung });
}

/**
 * Pflichtangabe des Aufrufers. Die Meldung nennt das **Feld**, nie seinen Wert
 * — das Feld heisst `pin`, `deviceSecret` oder `code`.
 */
function pflicht(functionName: string, feld: string, wert: unknown): void {
  if (typeof wert !== 'string' || wert.trim() === '') {
    throw new KasseneckValidationError(functionName, `${feld} fehlt`, 'request');
  }
}

/**
 * Pflichtfeld der Antwort. Auch hier wandert **nichts aus der Antwort** in die
 * Meldung; genannt wird nur, welches Feld fehlt.
 */
function pflichtfeld(functionName: string, daten: Record<string, unknown> | null | undefined, feld: string): string {
  const wert = daten?.[feld];
  if (typeof wert !== 'string' || wert === '') {
    throw antwortfehler(functionName, `Antwort enthaelt kein Feld "${feld}"`);
  }
  return wert;
}

/**
 * Rechte lesen: Schalter werden zu Wahrheitswerten, alles Fehlende gilt als
 * nicht erteilt.
 *
 * **Reichweiten sind keine Schalter.** `cancelScope` und `receiptsScope`
 * tragen `none | own | all`; wer sie mit `=== true` liest, macht aus jedem
 * `own` ein `false` — und [cancelScopeOf] liest daraus dann `none`. Der Kassier
 * saehe seine eigenen Belege nicht mehr und der Chef koennte nicht stornieren,
 * obwohl das Backend beides erlaubt. Diese beiden Felder kommen deshalb als
 * Text durch, aber nur mit bekanntem Inhalt: ein unbekannter Wert wird nicht
 * zur Reichweite erhoben (die Grenze zieht ohnehin das Backend, die Oberflaeche
 * soll im Zweifel weniger anbieten).
 */
function rechte(wert: unknown): RegisterUserPerms {
  const roh = (typeof wert === 'object' && wert !== null && !Array.isArray(wert) ? wert : {}) as Record<
    string,
    unknown
  >;
  const gelesen: Record<string, boolean | RegisterScope> = {};
  for (const [name, inhalt] of Object.entries(roh)) {
    gelesen[name] = REICHWEITEN_FELDER.has(name) ? reichweite(inhalt) : inhalt === true;
  }
  return {
    sell: false,
    cancel: false,
    articles: false,
    layout: false,
    reports: false,
    takeover: false,
    ...gelesen,
  };
}

/** Felder, die eine Reichweite tragen statt eines Schalters. */
const REICHWEITEN_FELDER: ReadonlySet<string> = new Set(['cancelScope', 'receiptsScope']);

/** Bekannte Reichweite oder `none` — dieselbe Zurueckhaltung wie [cancelScopeOf]. */
function reichweite(wert: unknown): RegisterScope {
  return wert === 'own' || wert === 'all' || wert === 'none' ? wert : 'none';
}

/** Leere Zeichenkette statt `undefined` — Anzeigefelder duerfen leer sein. */
const text = (wert: unknown): string => (typeof wert === 'string' ? wert : '');

/** Die Antwort meldete Erfolg, trug aber nicht, was der Aufruf zusagt. */
function antwortfehler(functionName: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(functionName, grund, 'response');
}
