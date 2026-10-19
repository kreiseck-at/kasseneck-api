import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

/*
 * Gespeicherte Belege der neuen Gutscheinform, aus den Vertragsbeispielen
 * zurueckgefuehrt (fuer stored-gutschein.test.ts und stored-backend.test.ts).
 * Positionen sind schon innere Form, die Eintraege werden in die gespeicherte
 * (deutsche) Form gebracht, so wie gutschein-beleg.plane() sie schreibt.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const lies = (datei: string): Json =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/v3/${datei}`, import.meta.url)), 'utf8')) as Json;
const FAELLE: Json[] = lies('antworten/kasse-belege.json').cases;
export const fall = (name: string): Json => {
  const f = FAELLE.find((c) => c.name === name);
  assert.ok(f, name);
  return f;
};
export const BASIS: Json = Object.values(lies('stored/belege.json').documents).find((d: Json) => d.receiptId === 'KECK-1-ID-6');

// gespeicherte Schluessel (innen) -> Vertragsname (aussen), wie BELEG_GUTSCHEIN im Server
const AUSSEN: Record<string, string> = {
  voucherType: 'art', voucherId: 'gutscheinId', codeSuffix: 'codeEnde', amountCents: 'betragCents', vatRateBp: 'satzBp',
  article: 'artikel', articleId: 'artikelId', quantity: 'stueck', positions: 'positionen',
  balanceAfterCents: 'saldoNachCents', remainingQuantityAfter: 'stueckOffenNach', taxedWith: 'versteuertMit', exempt: 'befreit',
  reason: 'grund', zeroRateBucket: 'imNullTopf',
};
const ART_INNEN: Record<string, string> = { multi_purpose: 'mehrzweck', single_purpose: 'einzweck', service: 'leistung', promotion: 'aktion' };

function alsGespeichert(v: Json): Json {
  const raus: Json = {};
  for (const [k, w] of Object.entries(v)) {
    if (k === 'type') raus.type = ART_INNEN[w as string] != null && w !== 'multi_purpose' ? ART_INNEN[w as string] : w;
    else if (k === 'voucherType') raus.art = ART_INNEN[w as string];
    else if (k === 'article') raus.artikel = { id: (w as Json).id, name: (w as Json).name, satzBp: (w as Json).vatRateBp, preisCents: (w as Json).priceCents };
    else raus[AUSSEN[k] ?? k] = w;
  }
  return raus;
}

/** Gespeichertes Dokument zu einem Vertragsfall: Basisbeleg mit Positionen und Eintraegen des Falls. */
export function dokument(name: string, aendere?: (v: Json) => Json): { doc: Json; wire: Json } {
  const wire = fall(name).response.data.receipt;
  const eintraege = wire.vouchers.map((v: Json) => alsGespeichert(aendere ? aendere(v) : v));
  return { doc: { ...BASIS, items: wire.items, vouchers: eintraege }, wire };
}

export const FAELLE_NEU = [
  'redeem_single_purpose_voucher', 'sale_single_purpose_voucher', 'sale_service_voucher', 'redeem_service_voucher',
  'sale_multi_purpose_voucher', 'redeem_multi_purpose_voucher', 'redeem_promotion_voucher', 'payout_multi_purpose_voucher',
  'get_receipt_single_purpose_redeemed',
];

