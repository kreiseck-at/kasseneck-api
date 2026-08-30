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
 * und sie kann es auch nicht: `vertrag_offen` bedeutet je nach Vertragsweg des
 * Partner-Kontos drei verschiedene naechste Schritte. Diese Datei ist deshalb
 * kein zweiter Abdruck der Doku, sondern die Handlungsanweisung daneben.
 */

import { KasseneckApiError } from '../client/errors.js';

/** Die drei Wege, auf denen ein Betrieb zum Auftragsverarbeitungsvertrag kommt. */
export const AVV_MODI = ['direkt', 'vollmacht', 'unterauftrag'] as const;
export type AvvModus = typeof AVV_MODI[number];

/** Vorgabe, solange Kasseneck fuer das Partner-Konto nichts anderes gesetzt hat. */
export const AVV_MODUS_STANDARD: AvvModus = 'direkt';

export function istAvvModus(wert: unknown): wert is AvvModus {
  return typeof wert === 'string' && (AVV_MODI as readonly string[]).includes(wert);
}

/**
 * Alle Codes, die die Partner-API kennt. Als Liste und nicht nur als Typ,
 * damit ein Aufrufer sie zur Laufzeit durchgehen kann (Katalogseite,
 * Selbsttest der eigenen Fehlerbehandlung).
 */
export const PARTNER_FEHLER_CODES = [
  // Eingabe und Konto
  'validation',
  'app_not_found',
  'app_not_accepted',
  'customer_exists',
  'customer_conflict',
  'email_taken',
  'customer_limit',
  'rate_limited',
  // Vertrag (Art. 28 DSGVO)
  'vertrag_offen',
  'modus_not_allowed',
  'vollmacht_fehlt',
  'text_changed',
  'art_not_allowed',
  'already_accepted',
  'not_found',
  // Signatur und Kasse
  'fon_missing',
  'no_card_available',
  'signature_pending',
  'signature_not_ready',
  'signature_failed',
  'module_inactive',
  'cashregister_limit',
  'cashregister_not_found',
  'activation_failed',
  // Webhooks
  'webhook_limit',
  'event_not_subscribed',
  'webhook_inactive',
] as const;

export type PartnerFehlerCode = typeof PARTNER_FEHLER_CODES[number];

export function istPartnerFehlerCode(wert: unknown): wert is PartnerFehlerCode {
  return typeof wert === 'string' && (PARTNER_FEHLER_CODES as readonly string[]).includes(wert);
}

/**
 * Was der Aufrufer tun muss. Ein Satz je Code, in der zweiten Person — nicht
 * die Wiederholung der Server-Meldung, sondern der naechste Handgriff.
 *
 * `vertrag_offen` fehlt hier mit Absicht: sein naechster Handgriff haengt am
 * Vertragsweg des Partner-Kontos, den nur der Aufrufer kennt. Dafuer gibt es
 * [vertragOffenRat].
 */
const RAT: Record<Exclude<PartnerFehlerCode, 'vertrag_offen'>, string> = {
  validation: 'Eingaben pruefen — data.errors nennt Feld und Grund. Es wurde nichts angelegt.',
  app_not_found: 'Die appId gibt es nicht. getPartnerInfo liefert die eigenen Apps samt id.',
  app_not_accepted:
    'Diese App hat noch keine abgenommene Version. Mit einem pk_test_-Schluessel geht es sofort weiter; live erst nach der Abnahme.',
  customer_exists: 'Diesen Betrieb gibt es schon (data.customerId). Mit derselben customerId weiterarbeiten.',
  customer_conflict:
    'Die Steuernummer ist bei Kasseneck bereits registriert. Die Zuordnung zum Partner macht Kasseneck — hello@kasseneck.at.',
  email_taken:
    'Fuer diese E-Mail gibt es schon einen Kasseneck-Zugang. Eine andere Adresse waehlen oder den Betrieb zuordnen lassen.',
  customer_limit: 'Das Tageslimit fuer neue Betriebe ist erreicht (data.max, data.resetAt). Morgen weiter.',
  rate_limited: 'Zu viele Aufrufe. data.retryAfterSec Sekunden warten und denselben Aufruf wiederholen.',
  modus_not_allowed:
    'Fuer dieses Partner-Konto ist der Vollmachtsweg nicht freigeschaltet. reportCustomerVertrag ist damit nicht der richtige Weg.',
  vollmacht_fehlt:
    'Der Partnervertrag mit dem Vollmachts-Kapitel ist nicht bestaetigt. Im Partner-Portal bestaetigen, dann erneut melden.',
  text_changed:
    'Der gemeldete textHash passt nicht zur geltenden Fassung. Den aktuellen Text holen, erneut anzeigen, mit dem neuen Hash melden — die alte Zustimmung gilt nicht.',
  art_not_allowed: 'In Vollmacht laesst sich nur der Auftragsverarbeitungsvertrag (art:"avv") melden.',
  already_accepted: 'Dieser Vertrag ist in dieser Fassung bereits bestaetigt. Nichts zu tun.',
  not_found: 'Der genannte Datensatz gehoert nicht zu diesem Partner-Konto oder gibt es nicht.',
  fon_missing:
    'Der Betrieb hat noch keinen FinanzOnline-Zugang. sendPartnerCustomerFonLink senden und customer.fon_verified abwarten.',
  no_card_available:
    'Zurzeit ist keine gepruefte Signaturkarte frei. Kasseneck kuemmert sich und meldet sich — hier ist nichts zu tun.',
  signature_pending: 'Fuer diesen Betrieb laeuft bereits ein Antrag. Auf signature.ready warten.',
  signature_not_ready:
    'Die Signatur ist noch nicht bereit. Auf das Ereignis signature.ready warten; eine mit automatisch:true angelegte Kasse geht danach von selbst live.',
  signature_failed: 'FinanzOnline hat die Registrierung abgelehnt (data.rc). Kasseneck klaert das — hello@kasseneck.at.',
  module_inactive: 'Das Modul (data.modul) ist fuer diesen Betrieb nicht gebucht. Kasseneck schaltet es frei.',
  cashregister_limit: 'Hoechstens 20 Registrierkassen je Betrieb. Eine bestehende nutzen.',
  cashregister_not_found: 'Diese cashregisterId gibt es bei diesem Betrieb nicht.',
  activation_failed:
    'Die Inbetriebnahme blieb an data.schritt haengen (ggf. data.rc). activateCashregister erneut aufrufen — jeder Schritt ist idempotent, der Lauf setzt an der Bruchstelle an.',
  webhook_limit: 'Hoechstens 10 Webhook-Endpunkte je Partner. Einen ungenutzten loeschen.',
  event_not_subscribed: 'Der Endpunkt abonniert das Ereignis nicht. events erweitern und erneut versuchen.',
  webhook_inactive: 'Der Webhook steht auf aktiv:false. Zuerst aktivieren.',
};

/**
 * Was `vertrag_offen` fuer dieses Partner-Konto bedeutet.
 *
 * Ohne bestaetigten Auftragsverarbeitungsvertrag (Art. 28 DSGVO) nimmt
 * Kasseneck **keine neue Kasse** in Betrieb; laufende Kassen bleiben
 * unberuehrt. Welcher der drei Wege gilt, setzt Kasseneck je Partner-Konto —
 * die Partner-API gibt ihn heute nicht aus, er ist deshalb Teil der
 * Client-Einstellungen ([PartnerApiOptions.avvModus]).
 */
export function vertragOffenRat(modus: AvvModus = AVV_MODUS_STANDARD): string {
  switch (modus) {
    case 'vollmacht':
      return (
        'Der Auftragsverarbeitungsvertrag dieses Betriebs fehlt. Vertragsweg "vollmacht": ' +
        'den unveraenderten Kasseneck-Text in der eigenen App zeigen, die Zustimmung einholen ' +
        'und mit reportCustomerVertrag melden (art:"avv", passender textHash). Danach die Kasse erneut aktivieren.'
      );
    case 'unterauftrag':
      return (
        'Der Auftragsverarbeitungsvertrag dieses Betriebs fehlt. Vertragsweg "unterauftrag": ' +
        'der Betrieb hat den Vertrag mit euch, Kasseneck ist Unterauftragsverarbeiter. ' +
        'Faellt die Deckung weg (Partnervertrag beendet oder Partner-Konto gesperrt), steht der Betrieb wieder auf offen — ' +
        'dann klaert das Kasseneck, hello@kasseneck.at.'
      );
    case 'direkt':
    default:
      return (
        'Der Auftragsverarbeitungsvertrag dieses Betriebs fehlt. Vertragsweg "direkt" (Vorgabe): ' +
        'der Betrieb bestaetigt selbst — im Kasseneck-Panel oder ueber den Einrichtungs-Link. ' +
        'Ein Partner kann das auf diesem Weg nicht fuer ihn tun. Das Ereignis customer.avv_accepted meldet die Bestaetigung.'
      );
  }
}

/**
 * Der Handlungssatz zu einem Code. `modus` wird nur fuer `vertrag_offen`
 * gebraucht und sonst ignoriert.
 */
export function partnerFehlerRat(code: string, modus: AvvModus = AVV_MODUS_STANDARD): string | undefined {
  if (code === 'vertrag_offen') return vertragOffenRat(modus);
  return istPartnerFehlerCode(code) ? RAT[code as Exclude<PartnerFehlerCode, 'vertrag_offen'>] : undefined;
}

/** Der Fehlercode eines geworfenen Fehlers — `undefined`, wenn es keiner der unseren ist. */
export function partnerFehlerCode(fehler: unknown): string | undefined {
  return fehler instanceof KasseneckApiError ? fehler.code : undefined;
}

/** Kurzform fuer `catch (e) { if (istPartnerFehler(e, 'vertrag_offen')) … }`. */
export function istPartnerFehler(fehler: unknown, code: PartnerFehlerCode): boolean {
  return partnerFehlerCode(fehler) === code;
}

/** Ein Feldfehler aus `data.errors[]` einer `validation`-Antwort. */
export interface PartnerFeldFehler {
  field: string;
  message: string;
}

/** Die Feldfehler einer `validation`-Antwort; leer, wenn es keine sind. */
export function partnerFeldFehler(fehler: unknown): PartnerFeldFehler[] {
  if (!(fehler instanceof KasseneckApiError)) return [];
  const roh = fehler.details['errors'];
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
export function partnerWartezeitSek(fehler: unknown): number | undefined {
  if (partnerFehlerCode(fehler) !== 'rate_limited') return undefined;
  const wert = (fehler as KasseneckApiError).details['retryAfterSec'];
  return typeof wert === 'number' && Number.isFinite(wert) && wert >= 0 ? wert : undefined;
}
