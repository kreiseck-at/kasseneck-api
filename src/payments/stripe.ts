import { StripeLinkMode, type StripeLinkModeKey } from '../enums/index.js';
import {
  type ReceiptItem,
  type ReceiptItemPayload,
  type StripeUrlSession,
  type StripeUrlSessionPayload,
  fromStripeUrlSessionPayload,
  toReceiptItemPayload,
  receiptItemIsValid,
} from '../models/index.js';
import { KasseneckValidationError } from '../client/errors.js';
import type { KasseneckTransport } from '../client/transport.js';

/**
 * Stripe-Zahlungslinks — Zwilling der Stripe-Aufrufe in
 * kasseneck_api/lib/kasseneck_api.dart (Zeilen 443-484).
 *
 * Zwei Aufrufe: [createStripeLink] erzeugt eine Checkout-Sitzung samt Kurzlink
 * (`pay.kasseneck.at/…`), den der Gast oeffnet; [stripeCaptureIntent] zieht die
 * zuvor nur reservierte Zahlung eines `authorization`-Links spaeter ein.
 *
 * **Kassen-Benutzer-Weg (`registerUserAuth`, Browser-Kasse):** Das Backend
 * laesst diese Identitaet nur bei fuenf Endpunkten zu (`allowRegisterUser` in
 * functions/index.js — `listMyCashregisters`, `listMyReceipts`, `getReceipt`,
 * `createReceipt`, `generateFullReceiptId`); keiner der beiden Aufrufe dieser
 * Datei ist darunter. Beide laufen nur mit `apiKeyAuth`. Dieses Paket bildet
 * das **nicht** nach — wer darf, entscheidet allein das Backend. Der Hinweis
 * steht hier, damit ein Leser nicht raten muss.
 */

/** Endpunktname aus dem Vorbild — **nicht** `createStripeLink`. */
const ENDPUNKT_LINK = 'createPaymentLinkStripe';
const ENDPUNKT_CAPTURE = 'stripeCaptureIntent';

export interface CreateStripeLinkOptions {
  /** Positionen des Zahlungslinks; mindestens eine, alle gueltig. */
  items: ReceiptItem[];
  /** Soll das Backend nach bezahltem Link selbsttaetig einen Beleg erzeugen? */
  createReceiptAfterPayment: boolean;
  /** Sofort einziehen (`payment`) oder nur reservieren (`authorization`). */
  mode: StripeLinkMode | StripeLinkModeKey;
  /** Eigener Bezeichner fuer den Zahlungs-Webhook des Aufrufers. */
  webhookId?: string;
  /** Telefonnummer des Gasts (landet in den Stripe-Metadaten). */
  customerPhone?: string;
  /** E-Mail des Gasts (Stripe schickt die Zahlungsbestaetigung dorthin). */
  customerEmail?: string;
}

/**
 * Ergebnis von [stripeCaptureIntent] — das eingezogene Zahlungsversprechen
 * (Stripe PaymentIntent), **nicht** noch einmal die Zahlungslink-Sitzung.
 *
 * Das ist eine bewusste Abweichung vom Dart-Vorbild: dort steht
 * `StripeUrlSession.fromJson(resJson['data'])`, das Backend antwortet an dieser
 * Stelle aber mit `{id, status, amount_received, currency}` (successResponse in
 * functions/payment-endpoints.js). Weder `url` noch `shorten_payment_url` noch
 * `expires_at` sind darin — die Sitzungs-Lesart kann hier gar nicht gelingen.
 */
export interface StripeCaptureResult {
  /** Bezeichner des PaymentIntent (`pi_…`), nicht der der Sitzung (`cs_…`). */
  id: string;
  /** Stripe-Status des Einzugs, z. B. `succeeded`. */
  status: string;
  /** Tatsaechlich eingezogener Betrag in Cent (Stripe fuehrt die kleinste Waehrungseinheit). */
  amountReceivedCents: number;
  /** Waehrungscode, wie Stripe ihn fuehrt (klein geschrieben, z. B. `eur`). */
  currency: string;
}

/**
 * Erzeugt einen Stripe-Zahlungslink fuer [items] (Fernzahlung: Link per
 * Nachricht, QR-Code oder Kurzlink).
 *
 * **Der Endpunkt heisst `createPaymentLinkStripe`**, nicht wie diese Funktion —
 * Methodenname und Endpunktname fallen wie schon beim Monatsbericht
 * auseinander (siehe client/reports.ts).
 */
export async function createStripeLink(
  rufen: KasseneckTransport,
  options: CreateStripeLinkOptions,
): Promise<StripeUrlSession> {
  const { items } = options;

  // Vor dem Senden pruefen: ein Zahlungslink ist zwar folgenlos wiederholbar,
  // eine abgewiesene Anfrage aber eine unnoetige Runde ueber das Netz — und der
  // Backend-Fehlertext nennt den Grund weit weniger genau als diese Pruefung.
  if (!Array.isArray(items) || items.length === 0) {
    throw eingabefehler(ENDPUNKT_LINK, 'Positionen sind Pflicht und duerfen nicht leer sein.');
  }
  if (items.some((item) => !receiptItemIsValid(item))) {
    throw eingabefehler(ENDPUNKT_LINK, 'Ungueltige Position uebergeben.');
  }

  const params: Record<string, unknown> = {
    items: positionsNutzlast(items),
    createReceiptAfterPayment: options.createReceiptAfterPayment,
    // Im Vorbild `mode.name`; Schluessel und Wert sind hier identisch.
    mode: gepruefterModus(options.mode),
  };

  // Die drei uebrigen Felder stehen im Vorbild unter `if (… != null)` — ohne
  // Angabe geht kein leeres Feld raus.
  if (options.webhookId != null) {
    params['webhookId'] = options.webhookId;
  }
  // **Abweichung vom Vorbild, mit Absicht:** Dart sendet `customerPhone`/
  // `customerEmail` in camelCase. Das Backend nimmt die beiden Felder aber
  // ausschliesslich als `customer_phone`/`customer_email` entgegen (so stehen
  // sie in den optionalParams von `createPaymentLinkStripe`, und nur so werden
  // sie ausgewertet), und unbekannte Parameter weist `checkRequest` nicht ab —
  // sie fallen still unter den Tisch. Wer die camelCase-Namen uebernaehme,
  // gaebe dem Aufrufer zwei Felder, die nachweislich nichts bewirken.
  if (options.customerPhone != null) {
    params['customer_phone'] = options.customerPhone;
  }
  if (options.customerEmail != null) {
    params['customer_email'] = options.customerEmail;
  }

  return sitzungAusNutzlast(await rufen(ENDPUNKT_LINK, params));
}

/**
 * Zieht die zuvor nur reservierte Zahlung einer `authorization`-Sitzung ein.
 *
 * **Der Parameter heisst `stripe_sessions_id`** — mit "sessions" im Plural, so
 * das Vorbild und so das Backend. Der naheliegende Singular waere ein fehlender
 * Pflichtparameter.
 */
export async function stripeCaptureIntent(
  rufen: KasseneckTransport,
  stripeSessionId: string,
): Promise<StripeCaptureResult> {
  if (typeof stripeSessionId !== 'string' || !stripeSessionId.trim()) {
    throw eingabefehler(ENDPUNKT_CAPTURE, 'stripeSessionId fehlt');
  }
  const daten = await rufen(ENDPUNKT_CAPTURE, { stripe_sessions_id: stripeSessionId });
  return einzugAusNutzlast(daten);
}

/**
 * Positionen in ihre Nutzlast wandeln und dabei die strenge Schreibpfad-
 * Pruefung des Modells abfangen (unbekannter Steuersatz). Das Modell wirft dort
 * ein nacktes `Error`; aus einem Endpunkt-Aufruf soll nur die Fehler-Union
 * dieses Pakets herauskommen (dasselbe Vorgehen wie in client/receipts.ts).
 */
function positionsNutzlast(items: ReceiptItem[]): ReceiptItemPayload[] {
  try {
    return items.map(toReceiptItemPayload);
  } catch (ursache) {
    throw eingabefehler(ENDPUNKT_LINK, ursache instanceof Error ? ursache.message : 'Ungueltige Nutzlast uebergeben.');
  }
}

/**
 * Modus aufloesen. Bleibt streng: der Modus kommt vom Aufrufer, und das Backend
 * kennt genau zwei Werte — ein dritter waere ein Programmierfehler, der sonst
 * still als `payment` durchginge (das Backend setzt `capture_method: 'manual'`
 * nur bei genau 'authorization').
 */
function gepruefterModus(wert: StripeLinkMode | StripeLinkModeKey): string {
  if (!Object.prototype.hasOwnProperty.call(StripeLinkMode, wert)) {
    throw eingabefehler(ENDPUNKT_LINK, `Stripe-Link-Modus: unbekannter Wert "${String(wert)}"`);
  }
  return StripeLinkMode[wert as StripeLinkModeKey];
}

/**
 * Zahlungslink-Sitzung aus der Antwort lesen. Alle vier Felder muessen da sein:
 * eine Sitzung ohne `url` ist kein Zahlungslink, und ein unlesbares Ablaufdatum
 * wuerde als `Invalid Date` weiterwandern und erst beim Anzeigen auffallen.
 */
function sitzungAusNutzlast(daten: unknown): StripeUrlSession {
  const roh = daten as Partial<StripeUrlSessionPayload> | null | undefined;
  if (
    roh == null ||
    typeof roh !== 'object' ||
    typeof roh.id !== 'string' ||
    typeof roh.url !== 'string' ||
    typeof roh.shorten_payment_url !== 'string' ||
    typeof roh.expires_at !== 'string'
  ) {
    throw antwortfehler(ENDPUNKT_LINK, 'Antwort enthaelt keine Zahlungslink-Sitzung');
  }
  const sitzung = fromStripeUrlSessionPayload(roh as StripeUrlSessionPayload);
  if (Number.isNaN(sitzung.expiresAt.getTime())) {
    throw antwortfehler(ENDPUNKT_LINK, 'Antwort enthaelt kein lesbares Ablaufdatum');
  }
  return sitzung;
}

/** Ergebnis des Einzugs aus der Antwort lesen (Felder siehe [StripeCaptureResult]). */
function einzugAusNutzlast(daten: unknown): StripeCaptureResult {
  const roh = daten as
    | { id?: unknown; status?: unknown; amount_received?: unknown; currency?: unknown }
    | null
    | undefined;
  if (
    roh == null ||
    typeof roh !== 'object' ||
    typeof roh.id !== 'string' ||
    typeof roh.status !== 'string' ||
    typeof roh.amount_received !== 'number' ||
    typeof roh.currency !== 'string'
  ) {
    throw antwortfehler(ENDPUNKT_CAPTURE, 'Antwort enthaelt kein eingezogenes Zahlungsversprechen');
  }
  return {
    id: roh.id,
    status: roh.status,
    // Stripe fuehrt Betraege in der kleinsten Waehrungseinheit — hier bereits
    // Cent, es wird also nichts umgerechnet (anders als bei Hobex).
    amountReceivedCents: roh.amount_received,
    currency: roh.currency,
  };
}

/** Fehler in der Eingabe des Aufrufers — es geht keine Anfrage raus. */
function eingabefehler(functionName: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(functionName, grund, 'request');
}

/** Die Antwort meldete Erfolg, trug aber nicht, was der Aufruf zusagt. */
function antwortfehler(functionName: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(functionName, grund, 'response');
}
