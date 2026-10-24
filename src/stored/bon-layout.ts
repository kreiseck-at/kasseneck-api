import type { ReceiptWithCompany } from '../client/receipts.js';
import { buildReceiptLayout, CURRENT_LAYOUT_RULESET, type LayoutRuleset, type ReceiptLayout } from '../receipt/layout.js';

/**
 * Layout wie `beleg-layout.layoutFuerBeleg`: 80 mm, Regelwerk mindestens das
 * aktuelle. Kann der Server es nicht bauen, liefert er `null` (dann baut
 * [receiptLayoutFromResult] selbst); ebenso hier.
 */
export function layoutWieServer(b: ReceiptWithCompany, regelwerk: unknown): ReceiptLayout | null {
  const ruleset = Math.max(Number(regelwerk) || 1, CURRENT_LAYOUT_RULESET) as LayoutRuleset;
  try {
    // Wie layoutFuerBeleg seit dem Paket 0.34.0 des Servers: der Beleg geht
    // unveraendert ans Paket (keine Aufbereitung der Gutscheine mehr).
    return buildReceiptLayout(b.receipt, b.company, {
      paperSize: 'mm80', ruleset, testCashregister: b.testCashregister, testSignature: b.testSignature, registrationInfo: b.registrationInfo,
    });
  } catch {
    return null;
  }
}

