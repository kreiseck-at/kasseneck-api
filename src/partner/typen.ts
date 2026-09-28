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
 *
 * **Die Formen sind die der `/v3`** (seit 0.28.0): Feldnamen und Werte, auf
 * die ein Programm verzweigt, sind englisch, die Fehlercodes ebenso; Texte fuer
 * Menschen (`message`, `note`, `statusText`, `nextSteps`) bleiben deutsch.
 *
 * Die Listen in GROSSSCHRIFT (`LEGAL_FORMS`, `CONTRACT_KINDS` …) sind die
 * Zielwerte der Kataloge im Vertrags-Export des Backends
 * (`fixtures/v3/v3-vokabular.json`, `catalogs`); die Tests halten sie gleich.
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

/**
 * Rechtsform des Betriebs, so wie `/v3` sie schreibt und liest.
 *
 * Die oesterreichischen Kurzformen (`eu`, `og`, `kg`, `gmbh`, `gmbhcokg`, `ag`)
 * bleiben wie sie sind; nur die drei Woerter, die es auf Englisch gibt, sind
 * englisch. `/v3` weist die deutschen Werte aus `/v1` (`einzel`, `verein`,
 * `sonstige`) mit `validation` ab, statt sie still zu uebersetzen.
 */
export const LEGAL_FORMS = ['sole_proprietor', 'eu', 'og', 'kg', 'gmbh', 'gmbhcokg', 'ag', 'association', 'other'] as const;

export type LegalForm = typeof LEGAL_FORMS[number];

/**
 * Bundesland als ISO-3166-2-Code: `AT-1` Burgenland, `AT-2` Kaernten,
 * `AT-3` Niederoesterreich, `AT-4` Oberoesterreich, `AT-5` Salzburg,
 * `AT-6` Steiermark, `AT-7` Tirol, `AT-8` Vorarlberg, `AT-9` Wien.
 */
export const AUSTRIAN_STATES = ['AT-1', 'AT-2', 'AT-3', 'AT-4', 'AT-5', 'AT-6', 'AT-7', 'AT-8', 'AT-9'] as const;

export type AustrianState = typeof AUSTRIAN_STATES[number];

/** Rollen einer Kontaktperson; `/v1` sagte `geschaeftsfuehrung`, `buchhaltung`, `technik`, `kasse`. */
export const CONTACT_ROLES = ['management', 'accounting', 'technical', 'pos'] as const;

export type ContactRole = typeof CONTACT_ROLES[number];

export interface BusinessAddress {
  street: string;
  /** Hausnummer, kurz und alphanumerisch: `49`, `12a`, `49/5`. */
  number?: string;
  /** Oesterreichische Postleitzahl, vier Ziffern. */
  zip: string;
  city: string;
}

export interface BusinessTaxDetails {
  /** Steuernummer im Format `12-345/6789`; die Pruefziffer wird geprueft. */
  taxNumber: string;
  smallBusiness: boolean;
  /**
   * UID, z. B. `ATU12345675`. Heisst auf der Leitung `vatId` (auch schon unter
   * `/v1`); ein `uid` wies der Server als unbekanntes Feld ab.
   */
  vatId?: string;
  /** GLN, 13 Ziffern. */
  gln?: string;
}

export interface BusinessContact {
  name: string;
  email: string;
  phone?: string;
  roles?: ContactRole[];
}

export interface BusinessTaxAdvisor {
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
 * Liste wie `partner-core.BETRIEB_FELDER`: ein ueberzaehliges Feld ist hier
 * ein Compilerfehler und nicht erst eine Antwort vom Server. Fuer Daten, die
 * nicht durch die Typpruefung kommen (Datenbank, Formular), beantwortet
 * [unknownBusinessFields] dieselbe Frage zur Laufzeit.
 */
export interface Business {
  companyName: string;
  legalForm: LegalForm;
  /** Anmeldung des Betriebs im Kasseneck-Panel; darf dort noch keinen Zugang haben. */
  email: string;
  address: BusinessAddress;
  state: AustrianState;
  taxDetails: BusinessTaxDetails;
  /** Mindestens einer, hoechstens zehn. */
  contacts: BusinessContact[];
  billingEmail?: string;
  /** Firmenbuchnummer, z. B. `FN 123456 a`. */
  companyRegister?: string;
  /** Gericht: Code (`LG_SALZBURG`), amtlicher Name oder Freitext. */
  court?: string;
  web?: string;
  phone?: string;
  industry?: string;
  taxAdvisor?: BusinessTaxAdvisor;
}

export interface CreateCustomerOptions {
  appId: string;
  business: Business;
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

export type PartnerCustomerStatus =
  | 'created'
  | 'fon_configured'
  | 'signature_requested'
  | 'signature_ready'
  | 'cashregister_created'
  | 'live'
  | 'blocked'
  | (string & {});

/** Abrechnungsrhythmen eines Entgelts; `/v1` sagte `monat`, `jahr`, `einmal`. */
export const FEE_INTERVALS = ['monthly', 'yearly', 'once'] as const;

export type FeeInterval = typeof FEE_INTERVALS[number];

/**
 * Das Entgelt, das mit einem Aufruf gebucht wurde: nur dann in der Antwort,
 * wenn die Konditionen des Partners dafuer einen Preis vorsehen. Unter `/v1`
 * hiess es `entgelt` mit `rhythmus`.
 */
export interface PartnerFee {
  /** Betrag in ganzen Cent. */
  cents: number;
  interval: FeeInterval | (string & {});
  /** `true` fuer einen Testbetrieb: gebucht, aber nicht verrechnet. */
  test: boolean;
}

export interface CreateCustomerResult {
  customerId: string;
  status: PartnerCustomerStatus;
  env: PartnerEnv;
  companyName: string;
  appId: string;
  access: { invited: boolean; sentTo: string | null };
  nextSteps: string[];
  /** Das gebuchte Entgelt; `null`, wenn die Konditionen keinen Preis dafuer vorsehen. */
  fee: PartnerFee | null;
  /** `true`, wenn derselbe `idempotencyKey` schon einmal ankam. */
  replayed: boolean;
}

/**
 * Wie das Partnerkonto den AVV handhabt; `/v1` sagte `direkt`, `vollmacht`,
 * `unterauftrag`.
 */
export const AVV_MODES = ['direct', 'power_of_attorney', 'subprocessor'] as const;

export type AvvMode = typeof AVV_MODES[number];

/**
 * Stand eines Vertrags des Betriebs mit Kasseneck: `pending` (noch nicht
 * bestaetigt), `confirmed`, `outdated` (eine neuere Pflichtfassung ist zu
 * bestaetigen) oder `not_required` (Testumgebung).
 *
 * **Die Vertraege wirken:** live geht ohne beide (AVV und Nutzungsvertrag)
 * keine Kasse live, `activateCashregister` antwortet dann `vertrag_offen`. Der
 * Betrieb bestaetigt sie selbst ueber den Einrichtungs-Link
 * (`sendPartnerCustomerFonLink`); die Ereignisse `customer.avv_accepted` und
 * `customer.terms_accepted` melden die Bestaetigung. In der Testumgebung sind
 * sie nicht noetig.
 */
export interface ContractStatus {
  status: 'pending' | 'confirmed' | 'outdated' | 'not_required' | (string & {});
  version: string | null;
  confirmedAt: number | null;
}

/**
 * Stand des Auftragsverarbeitungsvertrags (AVV, Art. 28 DSGVO). Zusaetzlich zu
 * [ContractStatus] der Status `via_partner` (der Partnervertrag deckt den AVV,
 * Weg `subprocessor`) und `mode`, der Weg des Partnerkontos.
 */
export interface AvvStatus extends ContractStatus {
  status: ContractStatus['status'] | 'via_partner';
  mode: AvvMode | (string & {}) | null;
}

/** FinanzOnline-Stand in der Liste: ist der Link draussen, geoeffnet, der Zugang geprueft? */
export interface PartnerCustomerFonStatus {
  configured: boolean;
  linkSentAt: number | null;
  /** Erste Oeffnung; wird mit einem Ersatz-Link zurueckgesetzt. */
  linkOpenedAt: number | null;
}

export interface PartnerCustomerSummary {
  customerId: string;
  companyName: string;
  status: PartnerCustomerStatus;
  appId: string | null;
  env: PartnerEnv;
  createdAt: number | null;
  /** FinanzOnline-Stand; `null`, wenn die Antwort ihn nicht fuehrt. */
  fon: PartnerCustomerFonStatus | null;
  /**
   * AVV-Stand; `null`, wenn die Antwort ihn nicht fuehrt. Kein erfundenes
   * `pending`: "nicht mitgeliefert" und "nicht bestaetigt" sind zweierlei.
   */
  avv: AvvStatus | null;
  /** Stand des Nutzungsvertrags; `null`, wenn die Antwort ihn nicht fuehrt. */
  terms: ContractStatus | null;
}

export interface ListCustomersOptions {
  status?: PartnerCustomerStatus;
  /** 1 bis 200; Vorgabe 50. */
  limit?: number;
  cursor?: string;
}

export interface PartnerCustomerList {
  customers: PartnerCustomerSummary[];
  /** Weiter mit diesem Wert als `cursor`; `null` heisst: das war alles. */
  cursor: string | null;
  total: number;
}

export interface PartnerCustomer extends PartnerCustomerSummary {
  statusAt: number | null;
  liveEnabled: boolean;
  createdAt: number | null;
  createdVia: string | null;
  business: Record<string, unknown>;
  /** In der Einzelsicht zusaetzlich: wann geprueft, an welche (maskierte) Adresse der Link ging. */
  fon: PartnerCustomerFonStatus & { verifiedAt: number | null; linkSentTo: string | null };
  access: { email: string | null; invitedAt: number | null; acceptedAt: number | null } | null;
}

export interface FonLinkResult {
  customerId: string;
  /** Empfaenger, maskiert — das Backend gibt die Adresse nie im Klartext aus. */
  sentTo: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Vertraege des Betriebs
// ---------------------------------------------------------------------------

/**
 * Vertragsarten: `avv` (Auftragsverarbeitungsvertrag, Art. 28 DSGVO) und
 * `terms` (Nutzungsvertrag, unter `/v1` `nutzung`).
 */
export const CONTRACT_KINDS = ['avv', 'terms'] as const;

export type ContractKind = typeof CONTRACT_KINDS[number];

/**
 * Wo der Betrieb bestaetigt hat. Unter `v1` hiessen die ersten fuenf
 * `einrichten`, `prozess`, `partner_vollmacht`, `admin_papier`,
 * `papier_upload`; `app` und `portal` sind in beiden Sprachen gleich.
 */
export const CONTRACT_SOURCES = [
  'setup_link',
  'process_link',
  'partner_power_of_attorney',
  'admin_paper',
  'paper_upload',
  'app',
  'portal',
] as const;

/** Offen fuer spaeter ergaenzte Wege, siehe [CONTRACT_SOURCES]. */
export type ContractSource = typeof CONTRACT_SOURCES[number] | (string & {});

/**
 * Meldung einer Zustimmung, die der Partner **in Vollmacht** fuer den Betrieb
 * eingeholt hat (`reportCustomerContract`).
 *
 * Geht nur, wenn das Partnerkonto auf dem Vollmachtsweg steht
 * (`mode_not_allowed`) und sein Partnervertrag das Vollmachtskapitel traegt
 * (`power_of_attorney_missing`). Der Vollmachtsweg nimmt nur `kind: 'avv'`;
 * `terms` beantwortet der Server mit `kind_not_allowed`.
 */
export interface ReportCustomerContractOptions {
  customerId: string;
  kind: ContractKind;
  /** Die Fassung, der zugestimmt wurde; muss die geltende sein. */
  version: string;
  /**
   * Pruefsumme des gezeigten Vertragstexts. Weicht sie von der geltenden ab,
   * kommt `text_changed` mit der geltenden in `data.textHash`.
   */
  textHash: string;
  /** Wer zugestimmt hat. */
  name: string;
  /** In welcher Funktion (z. B. Inhaberin, Geschaeftsfuehrer); unter `/v1` `funktion`. */
  signerRole: string;
  /**
   * Zeitpunkt der Zustimmung in Unix-Millisekunden; ohne Angabe gilt der
   * Eingang beim Server. Nicht in der Zukunft, nicht aelter als ein Jahr.
   */
  acceptedAt?: number;
}

export interface ReportCustomerContractResult {
  /** Kennung des Vertragsdatensatzes; unter `/v1` `vertragId`. */
  contractId: string;
  /** Unix-Millisekunden; unter `/v1` `bestaetigtAt`. */
  confirmedAt: number | null;
  kind: ContractKind | (string & {});
  version: string;
}

// ---------------------------------------------------------------------------
// Signatur
// ---------------------------------------------------------------------------

/**
 * `requested → assigned → registered → ready`. `registered` heisst: die
 * Einheit ist FinanzOnline bekannt; `ready` heisst: sie darf signieren. In der
 * Testumgebung wird ohne `registered` direkt `ready` erreicht.
 */
export type SignatureRequestStatus =
  | 'requested'
  | 'assigned'
  | 'registered'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | (string & {});

/**
 * Gruende in der Historie eines Signaturantrags. `card_entered` und
 * `finanzonline` hiessen unter `/v1` `karte_eingetragen` und `fon`.
 */
export const SIGNATURE_HISTORY_REASONS = [
  'api',
  'portal',
  'card_entered',
  'finanzonline',
  'automation_off',
  'test_environment',
  'no_stock',
] as const;

/** Offen fuer spaeter ergaenzte Gruende, siehe [SIGNATURE_HISTORY_REASONS]. */
export type SignatureHistoryReason = typeof SIGNATURE_HISTORY_REASONS[number] | (string & {});

/**
 * `error.code` eines Signaturantrags oder einer Signatur (`SignatureRequest`,
 * `CustomerSignature`). Hiess unter `/v1` `kunde_nicht_gefunden` /
 * `unvollstaendig` / `fon_fehler`; dieser Client spricht seit 0.28.0 nur noch
 * `/v3` und sieht darum nur die englische Form.
 */
export const SIGNATURE_ERROR_CODES = ['customer_not_found', 'incomplete', 'finanzonline_error'] as const;

/** Offen fuer spaeter ergaenzte Codes, siehe [SIGNATURE_ERROR_CODES]. */
export type SignatureErrorCode = typeof SIGNATURE_ERROR_CODES[number] | (string & {});

export interface SignatureHistoryEntry {
  from: SignatureRequestStatus | null;
  to: SignatureRequestStatus;
  at: number;
  reason: SignatureHistoryReason | null;
}

export interface SignatureRequest {
  requestId: string;
  status: SignatureRequestStatus;
  statusText: string;
  /** Art der Signatureinheit; heute nur `signature_card`. */
  kind: string;
  vdaId: string | null;
  signatureId: string | null;
  error: { code: SignatureErrorCode | null; message: string | null; rc: string | null } | null;
  requestedVia: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  history: SignatureHistoryEntry[];
}

export interface RequestSignatureOptions {
  /** Art der Signatureinheit; heute nur `signature_card` (Vorgabe). */
  kind?: string;
  /** `true` beantragt eine WEITERE Signatur, obwohl schon eine besteht. */
  additional?: boolean;
}

export interface RequestSignatureResult {
  request: SignatureRequest;
  /** `true`, wenn schon ein Antrag lief — dann ist es der laufende. */
  replayed: boolean;
  note: string | null;
  /** Das gebuchte Entgelt; `null`, wenn die Konditionen keinen Preis dafuer vorsehen. */
  fee: PartnerFee | null;
}

/**
 * Eine Signatur des Betriebs, einzeln. Ein Betrieb kann mehrere haben
 * (Ersatzkarte, zweiter Standort); `signatureRequestId` ist die Kennung, auf die
 * sich eine Kasse beruft.
 */
export interface CustomerSignature {
  signatureRequestId: string;
  status: SignatureRequestStatus | 'decommissioned';
  statusText: string;
  inProgress: boolean;
  ready: boolean;
  kind: string;
  vdaId: string | null;
  requestId: string | null;
  signatureId: string | null;
  error: { code: SignatureErrorCode | null; message: string | null; rc: string | null } | null;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface CustomerSignatureStatus {
  customerId: string;
  /** Die Kurzform: hat der Betrieb ueberhaupt eine brauchbare Signatur? */
  signature: { ready: boolean; signatureId: string | null; vdaId: string | null };
  /** Jede Signatur einzeln. */
  signatures: CustomerSignature[];
  requests: SignatureRequest[];
  fon: { present: boolean; verifiedAt: number | null };
}

// ---------------------------------------------------------------------------
// Kassen
// ---------------------------------------------------------------------------

/** Die Schritte der Inbetriebnahme, in dieser Reihenfolge. */
export type CashregisterActivationStep = 'signature' | 'register_cashregister' | 'start_receipt' | 'transmit_start_receipt' | (string & {});

export type CustomerCashregisterStatus = 'draft' | 'in_progress' | 'live' | 'failed' | (string & {});

export interface CustomerCashregister {
  cashregisterId: string;
  name: string | null;
  status: CustomerCashregisterStatus;
  statusText: string;
  /** `true`: die Kasse geht von selbst live, sobald die Signatur bereit ist. */
  automatic: boolean;
  /** Der naechste offene Schritt; `null`, wenn die Kasse live ist. */
  step: CashregisterActivationStep | null;
  stepText: string | null;
  completedSteps: CashregisterActivationStep[];
  /** Die Schritte, die fuer genau diese Kasse gelten (Testumgebung: weniger). */
  steps: { key: CashregisterActivationStep; text: string }[];
  signatureId: string | null;
  attempts: number;
  lastError: {
    code: string | null;
    message: string | null;
    rc: string | null;
    step: CashregisterActivationStep | null;
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
  cashregister: CustomerCashregister;
  activation: {
    started: boolean;
    ok: boolean | null;
    step: CashregisterActivationStep | null;
    /** `signature_not_ready` oder `automation_off`, wenn nicht gestartet wurde. */
    reason: string | null;
  };
}

export interface ActivateCashregisterResult {
  cashregister: CustomerCashregister;
  /** `true`: die Kasse war schon live, es wurde nichts getan. */
  unchanged: boolean;
}

export interface CustomerCashregisterList {
  customerId: string;
  cashregisters: CustomerCashregister[];
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
