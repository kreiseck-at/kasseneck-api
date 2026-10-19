import type { ReceiptWithCompany } from '../client/receipts.js';
import { buildReceiptLayout, CURRENT_LAYOUT_RULESET, type LayoutRuleset, type ReceiptLayout } from '../receipt/layout.js';
import { gutscheineFuerPaket } from './gutscheine.js';

/**
 * Layout wie `beleg-layout.layoutFuerBeleg`: 80 mm, Regelwerk mindestens das
 * aktuelle. Kann der Server es nicht bauen, liefert er `null` (dann baut
 * [receiptLayoutFromResult] selbst); ebenso hier.
 */
export function layoutWieServer(b: ReceiptWithCompany, regelwerk: unknown): ReceiptLayout | null {
  const ruleset = Math.max(Number(regelwerk) || 1, CURRENT_LAYOUT_RULESET) as LayoutRuleset;
  try {
    // Wie layoutFuerBeleg: Gutscheine mit Code stehen am Bon als Positionen.
    return buildReceiptLayout(gutscheineFuerPaket(b.receipt), b.company, {
      paperSize: 'mm80', ruleset, testCashregister: b.testCashregister, testSignature: b.testSignature, registrationInfo: b.registrationInfo,
    });
  } catch {
    return null;
  }
}

