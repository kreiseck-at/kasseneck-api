/**
 * Stripe-Zahlungslink-Sitzung — Zwilling von `StripeUrlSession` in
 * kasseneck_api/lib/models/stripe_url_seesion.dart.
 */
export interface StripeUrlSession {
  id: string;
  url: string;
  shortenUrl: string;
  expiresAt: Date;
}

export interface StripeUrlSessionPayload {
  id: string;
  url: string;
  shorten_payment_url: string;
  expires_at: string;
}

export function toStripeUrlSessionPayload(session: StripeUrlSession): StripeUrlSessionPayload {
  return {
    id: session.id,
    url: session.url,
    shorten_payment_url: session.shortenUrl,
    expires_at: session.expiresAt.toISOString(),
  };
}

export function fromStripeUrlSessionPayload(payload: StripeUrlSessionPayload): StripeUrlSession {
  return {
    id: payload.id,
    url: payload.url,
    shortenUrl: payload.shorten_payment_url,
    expiresAt: new Date(payload.expires_at),
  };
}
