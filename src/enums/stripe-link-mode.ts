/**
 * Modus eines Stripe-Zahlungslinks — Zwilling von `StripeLinkMode` in
 * kasseneck_api/lib/enums/stripe_link_mode.dart.
 *
 * `payment` zieht den Betrag sofort ein, `authorization` reserviert ihn nur
 * (Stripe `capture_method: 'manual'`); eingezogen wird er dann spaeter ueber
 * `stripeCaptureIntent`.
 *
 * Der Wert IST die Nutzlast: das Vorbild sendet `mode.name`, das Backend
 * vergleicht gegen 'authorization' (functions/payment-endpoints.js).
 */
export const StripeLinkMode = {
  payment: 'payment',
  authorization: 'authorization',
} as const;

export type StripeLinkModeKey = keyof typeof StripeLinkMode;
export type StripeLinkMode = (typeof StripeLinkMode)[StripeLinkModeKey];
