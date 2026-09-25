/**
 * Die Fehlercodes der Partner-API und das, was ein Integrator daraufhin tun
 * muss.
 *
 * Das Backend antwortet auf jeden fachlichen Ausgang mit HTTP 200 und legt
 * seine Entscheidung in `data.code` (siehe `docs/api/partner.md` im Backend).
 * Der Transport hebt den Code an `KasseneckApiError.code` — hier steht, was er
 * bedeutet.
 *
 * **Warum die Texte hier stehen und nicht nur im Backend:** die Meldung des
 * Servers sagt, WAS ist. Sie sagt nicht, was der Aufrufer als naechstes tut,
 * und sie kann es auch nicht — dafuer muesste sie seinen Ablauf kennen. Diese
 * Datei ist deshalb kein zweiter Abdruck der Doku, sondern die
 * Handlungsanweisung daneben.
 *
 * **Der Katalog ist vollstaendig.** Die Quelle ist `docs/api/fehlercodes.json`
 * im Backend (Abzug aus `partner-core.FEHLER_KATALOG`); ein Code, den nur eine
 * Seite kennt, ist fuer einen Aufrufer nicht von „gibt es nicht" zu
 * unterscheiden. Deshalb stehen hier BEIDE Flaechen: die der Schnittstelle
 * ([PARTNER_FEHLER_CODES]) und die des Partner-Portals
 * ([PARTNER_PORTAL_FEHLER_CODES]).
 *
 * **Seit 0.29.0 englisch, wie der Rest von `/v3`.** Dieser Client spricht seit
 * 0.28.0 ausschliesslich `/v3` (`PARTNER_BASE_URL`): die paar deutschen Codes,
 * die der Server bis dahin noch roh durchreichte, kommen jetzt genauso englisch
 * an wie alle anderen. [PARTNER_FEHLER_CODES] fuehrt deshalb ausnahmslos die
 * `/v3`-Schreibweise aus `fehlercodes.json`s `v3`-Zuordnung (deutsch -> englisch);
 * ein Aufrufer bekommt vom Server nie mehr die deutsche Form.
 *
 * **`kein_partnerbetrieb` und `request_not_found` fehlen absichtlich.** Beide
 * sind admin-only (`partner-endpoints.js`, ausserhalb von `FEHLER_KATALOG`) und
 * erreichen `/v3` nie: ein Partner-Aufruf kann sie unter keinem Pfad bekommen.
 * Sie standen frueher versehentlich in dieser Liste; `dart-partner.json` (ein
 * eingefrorener Abzug aus Dart 5.3.0, bevor das korrigiert wurde) fuehrt sie
 * weiterhin, siehe die Ausnahme in `test/partner-enums.test.ts`.
 *
 * **Die Vertrags-Codes (`kind_not_allowed`, `mode_not_allowed`,
 * `power_of_attorney_missing`, `not_found`, `no_version`,
 * `unknown_version`, `text_changed`, `already_accepted`) stehen hier, obwohl
 * dieses Paket `reportCustomerContract` nicht anbietet.** Der Katalog des
 * Backends fuehrt sie mit `flaeche: 'api'`/`'beide'`, dieselbe Regel wie bei
 * den Portal-Codes oben: vollstaendig heisst vollstaendig, auch fuer einen
 * Endpunkt, den (noch) kein Aufruf dieses Clients ausloest. Ein Server-Update,
 * das den Endpunkt ergaenzt, bräuchte dann keinen zweiten Fehlerkatalog-Umbau.
 * `not_required` fehlt bewusst: derselbe gemeinsame Server-Zweig wie die
 * anderen sechs, aber ueber die Partner-API nicht erreichbar (der Server hat
 * ihn aus `FEHLER_KATALOG` entfernt, siehe `partner-core.js` im Backend).
 */

import { KasseneckApiError } from '../client/errors.js';

/**
 * Alle Codes, die die **Schnittstelle** kennt. Als Liste und nicht nur als
 * Typ, damit ein Aufrufer sie zur Laufzeit durchgehen kann (Katalogseite,
 * Selbsttest der eigenen Fehlerbehandlung).
 *
 * Reihenfolge und Bestand wie im Abzug des Backends.
 */
export const PARTNER_FEHLER_CODES = [
  // Eingabe, Konto und Takt
  'validation',
  'rate_limited',
  'app_not_found',
  'app_not_accepted',
  'live_not_allowed',
  // Betrieb anlegen
  'customer_exists',
  'customer_conflict',
  'customer_limit',
  'access_not_allowed',
  'email_taken',
  'no_email',
  // FinanzOnline-Link
  'tax_number_missing',
  // Signatur
  'fon_missing',
  'signature_pending',
  'signature_missing',
  'signature_unknown',
  'signature_ambiguous',
  'signature_not_ready',
  'signature_limit',
  'signature_failed',
  // Kasse
  'module_inactive',
  'cashregister_limit',
  'cashregister_not_found',
  'contracts_pending',
  // Vertraege (reportCustomerContract: dieses Paket bietet den Endpunkt nicht
  // an, der Katalog fuehrt die Codes trotzdem vollstaendig, siehe oben)
  'kind_not_allowed',
  'mode_not_allowed',
  'power_of_attorney_missing',
  'not_found',
  'no_version',
  'unknown_version',
  'text_changed',
  'already_accepted',
  'activation_failed',
  // Webhooks
  'webhook_limit',
  'webhook_inactive',
  'event_not_subscribed',
] as const;

/**
 * Die Codes, die nur im **Partner-Portal** entstehen — beim Pflegen der App,
 * der Schluessel, der Mitglieder und der Signaturkarten.
 *
 * Sie stehen hier, obwohl kein Aufruf dieses Clients sie ausloest: der
 * Fehlerkatalog ist eine Liste, und eine halbe Liste ist schlimmer als keine.
 * Wer eine Katalogseite baut oder eine fremde Antwort einsortiert, findet
 * damit jeden Code des Backends wieder.
 */
export const PARTNER_PORTAL_FEHLER_CODES = [
  'app_locked',
  'version_locked',
  'invalid_transition',
  'no_accepted_app',
  'consent',
  'key_limit',
  'last_owner',
  'auth_user_exists',
  'card_missing',
  'card_duplicate',
  'card_not_verified',
  'already_assigned',
] as const;

export type PartnerFehlerCode = typeof PARTNER_FEHLER_CODES[number];
export type PartnerPortalFehlerCode = typeof PARTNER_PORTAL_FEHLER_CODES[number];

/** Ein Code aus einer der beiden Flaechen. */
export type PartnerCode = PartnerFehlerCode | PartnerPortalFehlerCode;

export function istPartnerFehlerCode(wert: unknown): wert is PartnerFehlerCode {
  return typeof wert === 'string' && (PARTNER_FEHLER_CODES as readonly string[]).includes(wert);
}

export function istPartnerPortalFehlerCode(wert: unknown): wert is PartnerPortalFehlerCode {
  return typeof wert === 'string' && (PARTNER_PORTAL_FEHLER_CODES as readonly string[]).includes(wert);
}

/**
 * Was der Aufrufer tun muss. Ein Satz je Code, in der zweiten Person — nicht
 * die Wiederholung der Server-Meldung, sondern der naechste Handgriff.
 *
 * Jeder Code des Katalogs steht hier; `partner-client.test.ts` haelt das fest.
 * Ein Code ohne Satz waere schlimmer als ein fehlender Code: er sieht aus wie
 * behandelt und sagt nichts.
 */
const RAT: Record<PartnerCode, string> = {
  // -- Schnittstelle --------------------------------------------------------
  validation:
    'Eingaben pruefen — data.errors nennt Feld und Grund, verschachtelt mit vollem Pfad (address.zip, contacts.0.email). Auch ein UNBEKANNTES Feld ist ein Formfehler: es wird abgewiesen und nicht stillschweigend verworfen. Es wurde nichts angelegt.',
  rate_limited: 'Zu viele Aufrufe. data.retryAfterSec Sekunden warten und denselben Aufruf wiederholen.',
  app_not_found: 'Die appId gibt es nicht. getPartnerInfo liefert die eigenen Apps samt id.',
  app_not_accepted:
    'Diese App hat noch keine abgenommene Version. Mit einem pk_test_-Schluessel oder mit env:"test" geht es sofort weiter; live erst nach der Abnahme.',
  live_not_allowed:
    'Ein Test-Schluessel erzeugt nichts Echtes. Fuer einen Live-Betrieb den Live-Schluessel nehmen — umgekehrt darf ein Live-Schluessel mit env:"test" sehr wohl einen Testbetrieb anlegen.',
  customer_exists: 'Diesen Betrieb gibt es schon (data.customerId). Mit derselben customerId weiterarbeiten.',
  customer_conflict:
    'Die Steuernummer ist bei Kasseneck bereits registriert. Die Zuordnung zum Partner macht Kasseneck — hello@kasseneck.at.',
  customer_limit: 'Das Tageslimit fuer neue Betriebe ist erreicht (data.max, data.resetAt). Morgen weiter.',
  access_not_allowed:
    'Fuer dieses Partner-Konto sind Zugaenge zum Kundenpanel nicht freigeschaltet — es entstand NICHTS, auch kein Betrieb. Ohne access{invite:true} erneut anlegen oder die Freischaltung erfragen (Stand: getPartnerInfo.partner.canCreateAccess).',
  email_taken:
    'Fuer diese E-Mail gibt es schon einen Kasseneck-Zugang. Eine andere Adresse waehlen, auf die Einladung verzichten oder den Betrieb zuordnen lassen.',
  no_email:
    'Im Konto des Betriebs steht keine E-Mail-Adresse. Ohne sie geht weder eine Einladung noch der FinanzOnline-Link hinaus.',
  tax_number_missing:
    'Am Betrieb ist keine Steuernummer hinterlegt, ohne sie gibt es keinen Einrichtungs-Link. Die Steuernummer bei Kasseneck nachtragen lassen (hello@kasseneck.at), dann sendPartnerCustomerFonLink erneut.',
  fon_missing:
    'Der Betrieb hat noch keinen FinanzOnline-Zugang. sendPartnerCustomerFonLink senden und customer.fon_verified abwarten. Betrifft das ANMELDEN der Signatureinheit, nicht das Beantragen.',
  signature_pending: 'Fuer diesen Betrieb laeuft bereits ein Antrag. Auf signature.ready warten.',
  signature_missing:
    'Der Betrieb hat ueberhaupt keine Signatur, und jede Kasse bezieht sich auf eine. Zuerst requestCustomerSignature.',
  signature_unknown:
    'Die genannte signatureRequestId gehoert nicht zu diesem Betrieb. getCustomerSignatureStatus nennt die seinen.',
  signature_ambiguous:
    'Der Betrieb hat mehrere Signaturen; welche die Kasse benutzt, muss dastehen. Eine aus data.choices als signatureRequestId mitgeben.',
  signature_not_ready:
    'Die Signatur DIESER Kasse ist noch nicht bereit. Auf signature.ready warten; eine mit automatic:true angelegte Kasse geht danach von selbst live.',
  signature_limit:
    'Hoechstens zehn Signaturen je Betrieb. Eine bestehende benutzen, statt mit additional:true eine weitere zu beantragen.',
  signature_failed: 'FinanzOnline hat die Anmeldung abgelehnt (data.rc). Kasseneck klaert das — hello@kasseneck.at.',
  module_inactive: 'Das Modul (data.module, z. B. "cash_register", Text in data.detail) ist fuer diesen Betrieb nicht gebucht. Kasseneck schaltet es frei.',
  cashregister_limit: 'Hoechstens 20 Registrierkassen je Betrieb. Eine bestehende nutzen.',
  cashregister_not_found: 'Diese cashregisterId gibt es bei diesem Betrieb nicht.',
  contracts_pending:
    'Nur live: der Betrieb hat Auftragsverarbeitungs- und Nutzungsvertrag noch nicht bestaetigt. An der Kasse aendert sich nichts. Den Betrieb ueber den Einrichtungs-Link bestaetigen lassen (sendPartnerCustomerFonLink, Stand in avv/terms von getPartnerCustomer), danach activateCashregister erneut.',
  // -- Vertraege (reportCustomerContract) ------------------------------------
  // Dieser Client bietet den Endpunkt (noch) nicht an; die Codes stehen hier
  // nur fuer die Katalogseite und fuer einen Aufrufer, der die rohe Antwort
  // selbst auswertet (siehe Kopfkommentar der Datei).
  kind_not_allowed:
    'reportCustomerContract mit einer anderen Art als "avv". Der Vollmachtsweg nimmt nur den Auftragsverarbeitungsvertrag entgegen. Dieser Client bietet den Endpunkt nicht an.',
  mode_not_allowed:
    'Der Vollmachtsweg ist fuer dieses Partner-Konto nicht freigeschaltet. Kasseneck fragen (hello@kasseneck.at).',
  power_of_attorney_missing:
    'Der Partnervertrag mit dem Vollmachts-Kapitel ist noch nicht bestaetigt. Erst danach nimmt der Vollmachtsweg Meldungen entgegen.',
  not_found:
    'Die genannte customerId gehoert nicht zu diesem Partner-Konto oder existiert nicht. listPartnerCustomers nennt die eigenen.',
  no_version: 'Fuer die gemeldete Vertragsart gibt es derzeit keine gueltige Fassung. Bei Kasseneck nachfragen.',
  unknown_version: 'Die gemeldete Vertragsversion gibt es nicht. Die aktuell geltende Fassung neu abrufen.',
  text_changed:
    'Der gezeigte Vertragstext hat sich seit dem Laden geaendert (data.textHash traegt die aktuell geltende Pruefsumme). Neu laden und danach erneut bestaetigen lassen.',
  already_accepted: 'Diese Fassung ist bereits bestaetigt (data.contractId). Nichts weiter zu tun.',
  activation_failed:
    'Die Inbetriebnahme blieb an data.step haengen (ggf. data.rc). activateCashregister erneut aufrufen — jeder Schritt ist idempotent, der Lauf setzt an der Bruchstelle an.',
  webhook_limit: 'Hoechstens 10 Webhook-Endpunkte je Partner. Einen ungenutzten loeschen.',
  webhook_inactive: 'Der Webhook steht auf active:false. Zuerst aktivieren, dann erneut proben.',
  event_not_subscribed:
    'Der Endpunkt abonniert dieses Ereignis nicht — auch eine Probe bekommt nur, was in seiner events-Liste steht. events erweitern und erneut versuchen.',

  // -- Partner-Portal -------------------------------------------------------
  app_locked:
    'Name, Verteilungen und Kontakt einer App sind fest, sobald eine Version geprueft wird. Aenderungen daran gehen ueber Kasseneck.',
  version_locked: 'Diese App-Version wird geprueft oder ist abgenommen. Fuer Aenderungen eine neue Version anlegen.',
  invalid_transition: 'Dieser Statuswechsel ist nicht vorgesehen. Den geltenden Stand laden und von dort weitergehen.',
  no_accepted_app: 'Einen Live-Schluessel gibt es erst nach der Abnahme einer App. Bis dahin mit dem pk_test_-Schluessel arbeiten.',
  consent: 'Der Datenschutzhinweis wurde nicht bestaetigt. Ohne die Bestaetigung entsteht nichts.',
  key_limit: 'Mehr aktive Schluessel je Umgebung als erlaubt. Zuerst einen widerrufen, dann einen neuen erzeugen.',
  last_owner: 'Der letzte Inhaber eines Partner-Kontos laesst sich nicht entfernen. Zuerst einen zweiten ernennen.',
  auth_user_exists: 'Diese E-Mail-Adresse ist bereits einem Konto zugeordnet. Eine andere waehlen.',
  card_missing: 'Zu diesem Antrag sind noch keine Kartendaten eingetragen.',
  card_duplicate: 'Diese Seriennummer ist bei Kasseneck schon eingetragen — die Karte ist bereits erfasst.',
  card_not_verified: 'Die Kartendaten sind noch nicht geprueft. Die Pruefung abwarten (data.request).',
  already_assigned: 'Fuer diesen Antrag sind bereits Kartendaten eingetragen; ein zweiter Satz ueberschreibt nichts.',
};

/**
 * Der Handlungssatz zu einem Code — aus beiden Flaechen. `undefined` fuer
 * einen Code, den dieses Paket nicht kennt; ein erfundener Satz waere
 * schlimmer als keiner.
 */
export function partnerFehlerRat(code: string): string | undefined {
  return (RAT as Record<string, string | undefined>)[code];
}

/** Der Fehlercode eines geworfenen Fehlers — `undefined`, wenn es keiner der unseren ist. */
export function partnerFehlerCode(error: unknown): string | undefined {
  return error instanceof KasseneckApiError ? error.code : undefined;
}

/** Kurzform fuer `catch (e) { if (istPartnerFehler(e, 'signature_missing')) … }`. */
export function istPartnerFehler(error: unknown, code: PartnerCode): boolean {
  return partnerFehlerCode(error) === code;
}

/** Ein Feldfehler aus `data.errors[]` einer `validation`-Antwort. */
export interface PartnerFeldFehler {
  /**
   * Der Feldpfad, so wie er im gesendeten Betrieb steht — verschachtelt und je
   * Kontakt: `address.zip`, `taxDetails.taxNumber`, `contacts.0.email`.
   */
  field: string;
  message: string;
}

/** Die Feldfehler einer `validation`-Antwort; leer, wenn es keine sind. */
export function partnerFeldFehler(error: unknown): PartnerFeldFehler[] {
  if (!(error instanceof KasseneckApiError)) return [];
  const roh = error.details['errors'];
  if (!Array.isArray(roh)) return [];
  const raus: PartnerFeldFehler[] = [];
  for (const eintrag of roh) {
    if (eintrag === null || typeof eintrag !== 'object') continue;
    const { field, message } = eintrag as { field?: unknown; message?: unknown };
    if (typeof field === 'string' && typeof message === 'string') raus.push({ field, message });
  }
  return raus;
}

/**
 * Wie lange `rate_limited` noch gilt, in Sekunden. `undefined`, wenn der
 * Fehler kein `rate_limited` ist oder das Backend keine Angabe macht.
 */
export function partnerWartezeitSek(error: unknown): number | undefined {
  if (partnerFehlerCode(error) !== 'rate_limited') return undefined;
  const wert = (error as KasseneckApiError).details['retryAfterSec'];
  return typeof wert === 'number' && Number.isFinite(wert) && wert >= 0 ? wert : undefined;
}
