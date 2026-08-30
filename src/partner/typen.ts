/**
 * Die Formen, die die Partner-API sendet und zurueckgibt.
 *
 * **Die Referenz ist das Backend**, nicht diese Datei: `docs/api/partner.md`
 * (ausfuehrlich) und `docs/api/partner.llms.txt` (kompakt) beschreiben Felder,
 * Fehlercodes und Ereignisse. Hier stehen sie als Typen, damit ein Aufrufer
 * beim Tippen sieht, was es gibt — nicht als zweiter Text daneben.
 *
 * **Lesen ist tolerant, Schreiben ist streng.** Antworttypen fuehren `null`
 * dort, wo das Backend `null` schickt, und lassen unbekannte Statuswerte als
 * `string` durch (`(string & {})`): eine Fassung, die einen neuen Status
 * einfuehrt, soll diesen Client nicht zum Absturz bringen, sondern ihn
 * durchreichen. Eingabetypen sind dagegen eng — ein Tippfehler soll ein
 * Compilerfehler sein und keine `validation`-Antwort vom Server.
 */

import type { AvvModus, AvvStatus } from './fehler.js';
import type { KasseneckSecret } from './secret.js';

// ---------------------------------------------------------------------------
// Partner und Schluessel
// ---------------------------------------------------------------------------

/** Umgebung, in der ein Partner-Schluessel arbeitet. */
export type PartnerEnv = 'test' | 'live';

/** Berechtigungen eines Partner-Schluessels. */
export type PartnerScope =
  | 'partner:read'
  | 'customers:read'
  | 'customers:write'
  | 'webhooks:read'
  | 'webhooks:write'
  | 'credentials:read'
  | (string & {});

/**
 * `credentials:read` gehoert **nicht** zum Standardsatz und wird keinem
 * bestehenden Schluessel nachtraeglich hinzugefuegt: wer ihn hat, kann im Namen
 * fremder Betriebe Belege signieren. Dafuer wird ein eigener Schluessel
 * angelegt.
 */
export const SCOPE_CREDENTIALS: PartnerScope = 'credentials:read';

export interface PartnerApp {
  id: string;
  name: string;
  status: string;
  platform: string | null;
  verteilungen: unknown[];
  platforms: string[];
  symbol: { url: string } | null;
  veroeffentlichung: boolean;
  listungErlaubt: boolean;
}

export interface PartnerInfo {
  partner: { id: string; name: string; status: string };
  env: PartnerEnv;
  scopes: PartnerScope[];
  key: { hint: string | null; label: string | null; createdAt: number | null; scopes: PartnerScope[] };
  apps: PartnerApp[];
}

// ---------------------------------------------------------------------------
// Betrieb anlegen
// ---------------------------------------------------------------------------

export type Rechtsform = 'einzel' | 'eu' | 'og' | 'kg' | 'gmbh' | 'gmbhcokg' | 'ag' | 'verein' | 'sonstige';

export type Bundesland =
  | 'burgenland'
  | 'kaernten'
  | 'niederoesterreich'
  | 'oberoesterreich'
  | 'salzburg'
  | 'steiermark'
  | 'tirol'
  | 'vorarlberg'
  | 'wien';

export type KontaktRolle = 'geschaeftsfuehrung' | 'buchhaltung' | 'technik' | 'kasse';

export interface BetriebAdresse {
  street: string;
  /** Hausnummer, kurz und alphanumerisch: `49`, `12a`, `49/5`. */
  number?: string;
  /** Oesterreichische Postleitzahl, vier Ziffern. */
  zip: string;
  city: string;
}

export interface BetriebSteuer {
  /** Steuernummer im Format `12-345/6789`; die Pruefziffer wird geprueft. */
  taxnr: string;
  is_small_business: boolean;
  /** UID, z. B. `ATU12345675`. */
  uid?: string;
  /** GLN, 13 Ziffern. */
  gln?: string;
}

export interface BetriebKontakt {
  name: string;
  email: string;
  phone?: string;
  roles?: KontaktRolle[];
}

export interface BetriebSteuerberater {
  name: string;
  email: string;
  phone: string;
  kontakt_ok: boolean;
}

/**
 * Die Stammdaten eines Betriebs. Geprueft wird mit denselben Regeln wie in
 * Kasseneckens eigener Kundenaufnahme (`@kreiseck/validator`); bei einem
 * Formfehler entsteht **nichts** — die Antwort traegt `code:"validation"` und
 * `data.errors[{field,message}]`.
 */
export interface Betrieb {
  company_name: string;
  rechtsform: Rechtsform;
  /** Anmeldung des Betriebs im Kasseneck-Panel; darf dort noch keinen Zugang haben. */
  email: string;
  address: BetriebAdresse;
  bundesland: Bundesland;
  tax_details: BetriebSteuer;
  /** Mindestens einer, hoechstens zehn. */
  contacts: BetriebKontakt[];
  billing_email?: string;
  /** Firmenbuchnummer, z. B. `FN 123456 a`. */
  firmenbuch?: string;
  /** Gericht: Code (`LG_SALZBURG`), amtlicher Name oder Freitext. */
  gericht?: string;
  web?: string;
  phone?: string;
  branche?: string;
  steuerberater?: BetriebSteuerberater;
}

export interface CreateCustomerOptions {
  appId: string;
  betrieb: Betrieb;
  /**
   * Eigener Schluessel gegen Doppelanlage, hoechstens 120 Zeichen. Derselbe
   * Schluessel liefert die gespeicherte Antwort zurueck — auch bei abweichendem
   * Rumpf. Die eigene Kundennummer ist der natuerliche Wert dafuer.
   */
  idempotencyKey?: string;
  /** `einladen:false` legt den Betrieb ohne Panel-Einladung an (Vorgabe: einladen). */
  zugang?: { einladen: boolean };
}

export type KundenStatus =
  | 'angelegt'
  | 'fon_eingerichtet'
  | 'signatur_beantragt'
  | 'signatur_bereit'
  | 'kasse_angelegt'
  | 'live'
  | 'gesperrt'
  | (string & {});

export interface CreateCustomerResult {
  customerId: string;
  status: KundenStatus;
  env: PartnerEnv;
  firma: string;
  appId: string;
  zugang: { eingeladen: boolean; sentTo: string | null };
  naechsteSchritte: string[];
  /** `true`, wenn derselbe `idempotencyKey` schon einmal ankam. */
  wiederholt: boolean;
}

/**
 * Stand des Auftragsverarbeitungsvertrags eines Betriebs, aus Partnersicht.
 * Die Werte stehen in `AVV_STATUS` (fehler.ts), samt dem, was sie bedeuten.
 */
export interface AvvStand {
  status: AvvStatus;
  version: string | null;
  bestaetigtAt: number | null;
  /** Der Weg, den Kasseneck fuer DIESES Partner-Konto gesetzt hat. */
  modus: AvvModus;
}

export interface KundenZeile {
  customerId: string;
  firma: string;
  status: KundenStatus;
  appId: string | null;
  env: PartnerEnv;
  createdAt: number | null;
  /**
   * Vertragsstand — `null`, wenn die Antwort ihn nicht fuehrt (aeltere
   * Backend-Fassung). Das ist die verlaessliche Quelle fuer [AvvStand.modus];
   * `getPartnerInfo` gibt den Weg nicht aus.
   */
  avv: AvvStand | null;
}

export interface ListCustomersOptions {
  status?: KundenStatus;
  /** 1 bis 200; Vorgabe 50. */
  limit?: number;
  cursor?: string;
}

export interface KundenListe {
  kunden: KundenZeile[];
  /** Weiter mit diesem Wert als `cursor`; `null` heisst: das war alles. */
  cursor: string | null;
  gesamt: number;
}

export interface Kunde extends KundenZeile {
  statusAt: number | null;
  liveEnabled: boolean;
  angelegtAt: number | null;
  angelegtVia: string | null;
  betrieb: Record<string, unknown>;
  fon: { eingerichtet: boolean; verifiedAt: number | null };
  zugang: { email: string | null; eingeladenAt: number | null; angenommenAt: number | null } | null;
}

export interface FonLinkResult {
  customerId: string;
  /** Empfaenger, maskiert — das Backend gibt die Adresse nie im Klartext aus. */
  sentTo: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Signatur
// ---------------------------------------------------------------------------

/**
 * `beantragt → zugeteilt → registriert → bereit`. `registriert` heisst: die
 * Einheit ist FinanzOnline bekannt; `bereit` heisst: sie darf signieren. In der
 * Testumgebung wird ohne `registriert` direkt `bereit` erreicht.
 */
export type SignaturAntragStatus =
  | 'beantragt'
  | 'zugeteilt'
  | 'registriert'
  | 'bereit'
  | 'fehlgeschlagen'
  | 'storniert'
  | (string & {});

export interface SignaturHistorieEintrag {
  von: string | null;
  nach: string;
  at: number;
  grund: string | null;
}

export interface SignaturAntrag {
  requestId: string;
  status: SignaturAntragStatus;
  statusText: string;
  art: string;
  vdaId: string | null;
  signatureId: string | null;
  fehler: { code: string | null; meldung: string | null; rc: string | null } | null;
  angefordertVia: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  historie: SignaturHistorieEintrag[];
}

export interface RequestSignatureResult {
  antrag: SignaturAntrag;
  /** `true`, wenn schon ein Antrag lief — dann ist es der laufende. */
  wiederholt: boolean;
  hinweis: string | null;
}

export interface SignaturStand {
  signatur: { bereit: boolean; signatureId: string | null; vdaId: string | null };
  antraege: SignaturAntrag[];
  fon: { vorhanden: boolean; geprueftAt: number | null };
}

// ---------------------------------------------------------------------------
// Kassen
// ---------------------------------------------------------------------------

/** Die Schritte der Inbetriebnahme, in dieser Reihenfolge. */
export type KassenSchritt = 'signatur' | 'kasse_registrieren' | 'startbeleg' | 'uebermitteln' | (string & {});

export type KassenStatus = 'entwurf' | 'laeuft' | 'live' | 'fehlgeschlagen' | (string & {});

export interface Kasse {
  cashregisterId: string;
  name: string | null;
  status: KassenStatus;
  statusText: string;
  /** `true`: die Kasse geht von selbst live, sobald die Signatur bereit ist. */
  automatisch: boolean;
  /** Der naechste offene Schritt; `null`, wenn die Kasse live ist. */
  schritt: KassenSchritt | null;
  schrittText: string | null;
  erledigt: KassenSchritt[];
  /** Die Schritte, die fuer genau diese Kasse gelten (Testumgebung: weniger). */
  schritte: { key: KassenSchritt; text: string }[];
  signatureId: string | null;
  versuche: number;
  letzterFehler: {
    code: string | null;
    meldung: string | null;
    rc: string | null;
    schritt: KassenSchritt | null;
    at: number | null;
  } | null;
  createdAt: number | null;
}

export interface CreateCashregisterOptions {
  customerId: string;
  /** Hoechstens 60 Zeichen. */
  name?: string;
  /** Vorgabe `true`: die Kasse geht von selbst live, sobald die Signatur da ist. */
  automatisch?: boolean;
}

export interface CreateCashregisterResult {
  kasse: Kasse;
  inbetriebnahme: {
    gestartet: boolean;
    ok: boolean | null;
    schritt: KassenSchritt | null;
    /** `signature_not_ready` oder `automatik_aus`, wenn nicht gestartet wurde. */
    grund: string | null;
  };
}

export interface ActivateCashregisterResult {
  kasse: Kasse;
  /** `true`: die Kasse war schon live, es wurde nichts getan. */
  unveraendert: boolean;
}

export interface KassenListe {
  customerId: string;
  kassen: Kasse[];
  signaturBereit: boolean;
}

// ---------------------------------------------------------------------------
// Zugangsdaten
// ---------------------------------------------------------------------------

/**
 * Eine Kasse samt ihrem Token. **Der Token ist ein Geheimnis des Betriebs** —
 * deshalb steht er als [KasseneckSecret] und nicht als `string` darin.
 */
export interface CustomerCashregisterCredential {
  cashregisterId: string;
  name: string | null;
  live: boolean;
  /** Kopfzeile `cashregister-token` fuer `createReceipt`. Verschluesselt speichern. */
  cashregisterToken: KasseneckSecret;
}

/**
 * Die beiden Geheimnisse, die eine App braucht, um im Namen des Betriebs
 * Belege zu signieren.
 *
 * **Nur verschluesselt speichern. Nie protokollieren, nie in eine Mail, nie in
 * einen Fehlerbericht.** Jeder Abruf wird mitgeschrieben (Partner, Schluessel,
 * Zeitpunkt) und ist fuer den Betrieb und fuer Kasseneck sichtbar.
 *
 * Die Werte stecken in [KasseneckSecret]: `console.log`, `JSON.stringify` und
 * jede Zeichenketten-Umwandlung zeigen eine Maske. Heraus kommt man nur ueber
 * `.reveal()` — und genau diese Stellen findet eine Suche.
 */
export interface CustomerCredentials {
  customerId: string;
  firma: string;
  env: PartnerEnv;
  /** Bearer-Schluessel des Betriebs (`kr_…`). Verschluesselt speichern. */
  apiKey: KasseneckSecret;
  kassen: CustomerCashregisterCredential[];
  hinweis: string;
}

// ---------------------------------------------------------------------------
// Vertrag
// ---------------------------------------------------------------------------

/**
 * Meldung einer in Vollmacht eingeholten Zustimmung. Nur `art:"avv"`, nur mit
 * freigeschaltetem Vollmachtsweg, und nur mit dem `textHash` der geltenden
 * Kasseneck-Fassung — ein abweichender Hash heisst, dass ein anderer Text
 * gezeigt wurde (`text_changed`).
 */
export interface ReportVertragOptions {
  /** Der Betrieb (dieselbe Kennung wie `customerId`; der Endpunkt nennt sie `kundeId`). */
  customerId: string;
  art: 'avv';
  version: string;
  textHash: string;
  /** Wer zugestimmt hat — Name der Person. */
  name: string;
  /** Ihre Funktion im Betrieb. */
  funktion: string;
  /** Zeitpunkt der Zustimmung in Millisekunden; Vorgabe ist der Eingang. */
  akzeptiertAt?: number;
}

export interface ReportVertragResult {
  vertragId: string;
  bestaetigtAt: number;
  art: string;
  version: string;
}
