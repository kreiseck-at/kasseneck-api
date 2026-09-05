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

import type { KasseneckSecret } from './secret.js';

// ---------------------------------------------------------------------------
// Partner und Schluessel
// ---------------------------------------------------------------------------

/**
 * Die beiden Umgebungen. Als Liste und nicht nur als Typ, damit ein Aufrufer
 * sie zur Laufzeit pruefen kann — und damit der Zwilling sie nachhaelt.
 */
export const PARTNER_ENVS = ['live', 'test'] as const;

/** Umgebung, in der ein Partner-Schluessel bzw. ein Betrieb lebt. */
export type PartnerEnv = typeof PARTNER_ENVS[number];

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
  distributions: unknown[];
  platforms: string[];
  symbol: { url: string } | null;
  published: boolean;
  listingAllowed: boolean;
}

export interface PartnerInfo {
  partner: {
    id: string;
    name: string;
    status: string;
    /**
     * Darf dieser Partner fuer seine Betriebe einen Zugang zum Kundenpanel
     * einrichten lassen? **Vorgabe `false`** — die Freischaltung setzt
     * Kasseneck je Partner. Ohne sie antworten `access:{invite:true}` und
     * `resendPartnerCustomerInvite` mit `zugang_nicht_erlaubt`, und es
     * entsteht nichts, auch kein Betrieb.
     */
    canCreateAccess: boolean;
  };
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
  taxNumber: string;
  smallBusiness: boolean;
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
  mayContact: boolean;
}

/**
 * Die Stammdaten eines Betriebs. Geprueft wird mit denselben Regeln wie in
 * Kasseneckens eigener Kundenaufnahme (`@kreiseck/validator`); bei einem
 * Formfehler entsteht **nichts** — die Antwort traegt `code:"validation"` und
 * `data.errors[{field,message}]`.
 *
 * **Genau diese Felder, kein weiteres.** Das Backend weist ein unbekanntes
 * Feld ab, statt es stillschweigend zu verwerfen, und nennt seinen vollen
 * Pfad (`address.land`, `contacts.0.rolle`). Deshalb hat dieser Typ dieselbe
 * Liste wie `partner-core.BETRIEB_FELDER` — ein ueberzaehliges Feld ist hier
 * ein Compilerfehler und nicht erst eine Antwort vom Server. Fuer Daten, die
 * nicht durch die Typpruefung kommen (Datenbank, Formular), beantwortet
 * [unbekannteBetriebsfelder] dieselbe Frage zur Laufzeit.
 */
export interface Betrieb {
  companyName: string;
  legalForm: Rechtsform;
  /** Anmeldung des Betriebs im Kasseneck-Panel; darf dort noch keinen Zugang haben. */
  email: string;
  address: BetriebAdresse;
  state: Bundesland;
  taxDetails: BetriebSteuer;
  /** Mindestens einer, hoechstens zehn. */
  contacts: BetriebKontakt[];
  billingEmail?: string;
  /** Firmenbuchnummer, z. B. `FN 123456 a`. */
  companyRegister?: string;
  /** Gericht: Code (`LG_SALZBURG`), amtlicher Name oder Freitext. */
  court?: string;
  web?: string;
  phone?: string;
  industry?: string;
  taxAdvisor?: BetriebSteuerberater;
}

export interface CreateCustomerOptions {
  appId: string;
  business: Betrieb;
  /**
   * Eigener Schluessel gegen Doppelanlage, hoechstens 120 Zeichen. Derselbe
   * Schluessel liefert die gespeicherte Antwort zurueck — auch bei abweichendem
   * Rumpf. Die eigene Kundennummer ist der natuerliche Wert dafuer.
   */
  idempotencyKey?: string;
  /**
   * `invite:true` legt zusaetzlich einen Zugang zum Kundenpanel an und
   * schickt die Einladung an `betrieb.email`. **Vorgabe ist `false`:** viele
   * Betriebe arbeiten ausschliesslich in der App des Partners, und ein
   * stillschweigend erzeugter Login samt Mail waere dort etwas, das niemand
   * erwartet. Nachholen laesst er sich mit `resendPartnerCustomerInvite`.
   *
   * Nur erlaubt, wenn `getPartnerInfo().partner.canCreateAccess` gilt —
   * sonst `zugang_nicht_erlaubt`, und es entsteht nichts, auch kein Betrieb.
   */
  access?: { invite: boolean };
  /**
   * In welcher Umgebung der Betrieb entsteht. Ohne Angabe entscheidet der
   * Schluessel.
   *
   * Ein LIVE-Schluessel darf `env:"test"` verlangen — das ist der vorgesehene
   * Weg, die ganze Kette zu proben, ohne sich einen zweiten Schluessel zu
   * holen. Umgekehrt nie: ein Test-Schluessel mit `env:"live"` bekommt
   * `live_not_allowed`, und es entsteht nichts.
   *
   * Ein so angelegter Live-Betrieb ist **sofort freigeschaltet** und traegt das
   * Modul `registrierkasse`; es wird auf keine Freigabe durch Kasseneck
   * gewartet.
   */
  env?: PartnerEnv;
}

export type KundenStatus =
  | 'created'
  | 'fon_configured'
  | 'signature_requested'
  | 'signature_ready'
  | 'cashregister_created'
  | 'live'
  | 'blocked'
  | (string & {});

export interface CreateCustomerResult {
  customerId: string;
  status: KundenStatus;
  env: PartnerEnv;
  companyName: string;
  appId: string;
  access: { invited: boolean; sentTo: string | null };
  nextSteps: string[];
  /** `true`, wenn derselbe `idempotencyKey` schon einmal ankam. */
  replayed: boolean;
}

/**
 * Stand des Auftragsverarbeitungsvertrags eines Betriebs.
 *
 * **Vertraege wirken im Partner-Weg nicht mehr** (Stand 2026-08-31): keine
 * Antwort fuehrt dieses Feld, kein Schritt in `naechsteSchritte` verlangt
 * einen Vertrag, und eine Kasse geht deswegen nicht weniger live. Der Typ
 * bleibt, damit eine Antwort, die ihn doch noch traegt, lesbar durchkommt —
 * **vorausgesetzt wird er nirgends**. Fuer selbst registrierte Kunden gibt es
 * die Maschinerie weiterhin, aber nicht ueber diese Schnittstelle.
 */
export interface AvvStand {
  status: string;
  version: string | null;
  confirmedAt: number | null;
  mode: string | null;
}

export interface KundenZeile {
  customerId: string;
  companyName: string;
  status: KundenStatus;
  appId: string | null;
  env: PartnerEnv;
  createdAt: number | null;
  /**
   * Vertragsstand, falls die Antwort ihn ueberhaupt fuehrt — heute tut sie das
   * nicht, der Wert ist dann `null`. Siehe [AvvStand]: nichts in diesem Client
   * setzt ihn voraus.
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
  customers: KundenZeile[];
  /** Weiter mit diesem Wert als `cursor`; `null` heisst: das war alles. */
  cursor: string | null;
  total: number;
}

export interface Kunde extends KundenZeile {
  statusAt: number | null;
  liveEnabled: boolean;
  createdAt: number | null;
  createdVia: string | null;
  business: Record<string, unknown>;
  fon: { configured: boolean; verifiedAt: number | null };
  access: { email: string | null; invitedAt: number | null; acceptedAt: number | null } | null;
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
  | 'requested'
  | 'assigned'
  | 'registered'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | (string & {});

export interface SignaturHistorieEintrag {
  von: string | null;
  nach: string;
  at: number;
  reason: string | null;
}

export interface SignaturAntrag {
  requestId: string;
  status: SignaturAntragStatus;
  statusText: string;
  art: string;
  vdaId: string | null;
  signatureId: string | null;
  error: { code: string | null; message: string | null; rc: string | null } | null;
  requestedVia: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  history: SignaturHistorieEintrag[];
}

export interface RequestSignatureResult {
  request: SignaturAntrag;
  /** `true`, wenn schon ein Antrag lief — dann ist es der laufende. */
  replayed: boolean;
  note: string | null;
}

export interface SignaturStand {
  signatur: { ready: boolean; signatureId: string | null; vdaId: string | null };
  requests: SignaturAntrag[];
  fon: { present: boolean; verifiedAt: number | null };
}

// ---------------------------------------------------------------------------
// Kassen
// ---------------------------------------------------------------------------

/** Die Schritte der Inbetriebnahme, in dieser Reihenfolge. */
export type KassenSchritt = 'signatur' | 'register_cashregister' | 'start_receipt' | 'transmit_start_receipt' | (string & {});

export type KassenStatus = 'draft' | 'laeuft' | 'live' | 'failed' | (string & {});

export interface Kasse {
  cashregisterId: string;
  name: string | null;
  status: KassenStatus;
  statusText: string;
  /** `true`: die Kasse geht von selbst live, sobald die Signatur bereit ist. */
  automatic: boolean;
  /** Der naechste offene Schritt; `null`, wenn die Kasse live ist. */
  step: KassenSchritt | null;
  stepText: string | null;
  completedSteps: KassenSchritt[];
  /** Die Schritte, die fuer genau diese Kasse gelten (Testumgebung: weniger). */
  steps: { key: KassenSchritt; text: string }[];
  signatureId: string | null;
  attempts: number;
  lastError: {
    code: string | null;
    message: string | null;
    rc: string | null;
    step: KassenSchritt | null;
    at: number | null;
  } | null;
  createdAt: number | null;
}

export interface CreateCashregisterOptions {
  customerId: string;
  /** Vorgabe `true`: die Kasse geht von selbst live, sobald die Signatur da ist. */
  automatic?: boolean;
  /**
   * Auf welche Signatur sich die Kasse bezieht. **Jede Kasse bezieht sich auf
   * eine**; ohne eine einzige entsteht keine (`signature_missing`).
   *
   * Hat der Betrieb genau eine, ist sie vorausgewaehlt und dieses Feld
   * ueberfluessig. Bei mehreren muss es dastehen, sonst `signature_ambiguous`
   * samt `data.choices[]`; eine fremde Kennung ist `signature_unknown`. Die
   * Kennungen nennt `getCustomerSignatureStatus`.
   *
   * **Einen Namen gibt es hier nicht.** Kassennamen vergibt Kasseneck, sie
   * sind gleich der `cashregisterId`; ein mitgesendetes `name` waere ein
   * `validation`-Fehler.
   */
  signatureRequestId?: string;
}

export interface CreateCashregisterResult {
  cashregister: Kasse;
  activation: {
    started: boolean;
    ok: boolean | null;
    step: KassenSchritt | null;
    /** `signature_not_ready` oder `automatik_aus`, wenn nicht gestartet wurde. */
    reason: string | null;
  };
}

export interface ActivateCashregisterResult {
  cashregister: Kasse;
  /** `true`: die Kasse war schon live, es wurde nichts getan. */
  unchanged: boolean;
}

export interface KassenListe {
  customerId: string;
  cashregisters: Kasse[];
  signatureReady: boolean;
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
  companyName: string;
  env: PartnerEnv;
  /** Bearer-Schluessel des Betriebs (`kr_…`). Verschluesselt speichern. */
  apiKey: KasseneckSecret;
  cashregisters: CustomerCashregisterCredential[];
  note: string;
}
