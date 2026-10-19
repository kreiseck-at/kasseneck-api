import type { Receipt } from '../models/receipt.js';
import type { ReceiptItem } from '../models/receipt-item.js';
import type { Voucher } from '../models/voucher.js';

/*
 * Zwilling von `gutscheineFuerPaket` (functions/beleg-layout.js): der Bon
 * kennt Gutscheine mit Code nur als Positionen. Eintraege, deren Betrag schon
 * als Position am Beleg steht (Einzweck, Leistung, Mehrzweck im 0-%-Topf),
 * fallen fuer das Zeilenmodell weg, sonst zaehlte es sie ein zweites Mal; die
 * maskierte Code-Endung wandert an die passende Position. Nur Darstellung,
 * der Beleg selbst bleibt unberuehrt.
 */

const POSITIONS_ARTEN = ['single_purpose', 'service'];
const centsDerPosition = (it: ReceiptItem): number => Math.round(Math.abs(it.priceCents * it.quantity));
const centsDesEintrags = (v: Voucher): number =>
  Number.isInteger(v.amountCents) ? Math.abs(v.amountCents as number) : Math.abs(v.valueCents ?? 0);

export function gutscheineFuerPaket(receipt: Receipt): Receipt {
  const positionen = receipt.items.map((it) => ({ ...it }));
  const vergeben = new Set<number>();
  const codeAnPosition = (v: Voucher, kinds: string[]): void => {
    const cents = centsDesEintrags(v);
    const i = positionen.findIndex((it, k) => !vergeben.has(k) && it.kind != null && kinds.includes(it.kind)
      && centsDerPosition(it) === cents && !String(it.name || '').includes('····'));
    if (i < 0) return;
    vergeben.add(i);
    if (typeof v.code === 'string' && v.code) positionen[i]!.name = `${positionen[i]!.name} ${v.code}`;
  };
  const bleiben: Voucher[] = [];
  for (const v of receipt.vouchers) {
    if (POSITIONS_ARTEN.includes(v.type)) {
      if (v.action === 'sell') codeAnPosition(v, ['voucher']);
      continue;
    }
    if (v.zeroRateBucket === true) {
      codeAnPosition(v, ['voucher_float']);
      continue;
    }
    bleiben.push(v);
  }
  return { ...receipt, items: positionen, vouchers: bleiben };
}
