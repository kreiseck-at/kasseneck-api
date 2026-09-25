import { KeckPaymentMethod, type KeckPaymentMethodKey, CreditCardProvider } from '../enums/index.js';
import { readEnumKey, requireEnumKey } from './enum-payload.js';

/**
 * Eine Zahlung am Beleg — Zwilling der Eintraege in `payments`, wie
 * `functions/gemeinsam/zahlungen-core.js` (`pruefeZahlungen`) sie normalisiert
 * und ablegt.
 *
 * Ein Beleg kann ueber mehrere Zahlungen bezahlt sein (zwei Karten, Rest bar).
 * Dann steht die Liste unter `payments`, und das Einzelfeld `paymentMethod`
 * ist `mixed`, sobald verschiedene Zahlarten vorkommen (zwei Karten ergeben
 * `creditCard`). Altbelege haben keine Liste; dort gilt weiter
 * `paymentMethod` samt Kartenfeldern.
 *
 * Betraege in ganzen Cent: am Verkauf positiv, am Storno negativ (Rueckzahlung).
 * `method`/`provider` sind beim Lesen wie ueberall entweder der bekannte
 * Enum-Eintrag oder der rohe Schluessel (siehe `enum-payload.ts`).
 */
export interface ReceiptPayment {
  /** Vom Server vergeben (`p1`, `p2`, …); Bezugspunkt fuer `refundOf`. */
  id?: string;
  method: KeckPaymentMethod | string;
  amountCents: number;
  /** Nur bei Barzahlung: gegebener Betrag. */
  tenderedCents?: number;
  /** Nur neben `tenderedCents`: Rueckgeld (vom Server gerechnet). */
  changeCents?: number;
  /** Kartenanbieter bzw. Terminal. */
  provider?: CreditCardProvider | string;
  /** Kennung der Zahlung am Terminal/Anbieter. */
  providerPaymentId?: string;
  /** Terminaldaten fuer den Kartenblock (frueher `cardPaymentData`). */
  providerData?: Record<string, unknown>;
  /** Nur am Storno: `id` der Originalzahlung, die erstattet wird. */
  refundOf?: string;
  /**
   * Trinkgeld, das mit dieser Zahlung gegeben wurde, in ganzen Cent — TEIL
   * von `amountCents` (das Terminal bucht Betrag + Trinkgeld zusammen). Nur
   * an Verkaufs-/Trainingsbelegen.
   */
  tipCents?: number;
}

/** Nutzlast-Form einer Zahlung (Backend-Dokument bzw. Antwort). */
export interface ReceiptPaymentPayload {
  id?: string;
  method: string;
  amountCents: number;
  tenderedCents?: number;
  changeCents?: number;
  provider?: string;
  providerPaymentId?: string;
  providerData?: Record<string, unknown>;
  refundOf?: string;
  tipCents?: number;
}

/**
 * Eine Zahlung, wie der Aufrufer sie an `createReceipt`/`sellReceipt`/
 * `cancelReceipt` schickt. `id` und `changeCents` vergibt der Server.
 *
 * - `method`: jede Zahlungsart ausser `mixed`.
 * - `amountCents`: ganze Cent, am Verkauf > 0, am Storno < 0.
 * - `tenderedCents`: nur bei Barzahlung am Verkauf, hoechstens an einer Zahlung.
 * - `provider`/`providerPaymentId`/`providerData`: bei Karten Pflicht
 *   (`providerPaymentId` ausser bei `custom`), bei `online` optional, sonst
 *   nicht erlaubt; am Storno beschreiben sie die Erstattung und sind optional.
 * - `refundOf`: nur am Storno.
 * - `tipCents`: Trinkgeld dieser Zahlung, ganze Cent > 0, Teil von
 *   `amountCents`; nur am Verkauf, nie neben `tip` (den Rest prueft der Server).
 */
export interface ReceiptPaymentInput {
  method: KeckPaymentMethod | KeckPaymentMethodKey;
  amountCents: number;
  tenderedCents?: number;
  provider?: CreditCardProvider;
  providerPaymentId?: string;
  providerData?: Record<string, unknown>;
  refundOf?: string;
  tipCents?: number;
}

/** Lesepfad: nur vorhandene Felder uebernehmen, nichts ergaenzen. */
export function fromReceiptPaymentPayload(payload: ReceiptPaymentPayload): ReceiptPayment {
  return {
    ...(typeof payload.id === 'string' ? { id: payload.id } : {}),
    method: readEnumKey(KeckPaymentMethod, payload.method),
    amountCents: payload.amountCents,
    ...(typeof payload.tenderedCents === 'number' ? { tenderedCents: payload.tenderedCents } : {}),
    ...(typeof payload.changeCents === 'number' ? { changeCents: payload.changeCents } : {}),
    ...(typeof payload.provider === 'string' ? { provider: readEnumKey(CreditCardProvider, payload.provider) } : {}),
    ...(typeof payload.providerPaymentId === 'string' ? { providerPaymentId: payload.providerPaymentId } : {}),
    ...(payload.providerData != null && typeof payload.providerData === 'object' ? { providerData: payload.providerData } : {}),
    ...(typeof payload.refundOf === 'string' ? { refundOf: payload.refundOf } : {}),
    ...(typeof payload.tipCents === 'number' ? { tipCents: payload.tipCents } : {}),
  };
}

/**
 * Schreibpfad: Zahlungen zurueck in die Nutzlast — streng wie
 * `toReceiptPayload`: ein roher, unbekannter Schluessel bei `method` oder
 * `provider` wirft.
 */
export function toReceiptPaymentPayload(payment: ReceiptPayment): ReceiptPaymentPayload {
  return {
    ...(payment.id !== undefined ? { id: payment.id } : {}),
    method: typeof payment.method === 'object' ? payment.method.value : requireEnumKey(KeckPaymentMethod, payment.method, 'Zahlungsart').value,
    amountCents: payment.amountCents,
    ...(payment.tenderedCents !== undefined ? { tenderedCents: payment.tenderedCents } : {}),
    ...(payment.changeCents !== undefined ? { changeCents: payment.changeCents } : {}),
    ...(payment.provider !== undefined ? { provider: requireEnumKey(CreditCardProvider, payment.provider, 'Kartenanbieter') } : {}),
    ...(payment.providerPaymentId !== undefined ? { providerPaymentId: payment.providerPaymentId } : {}),
    ...(payment.providerData !== undefined ? { providerData: payment.providerData } : {}),
    ...(payment.refundOf !== undefined ? { refundOf: payment.refundOf } : {}),
    ...(payment.tipCents !== undefined ? { tipCents: payment.tipCents } : {}),
  };
}
