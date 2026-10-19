import type { ReceiptDueOptions, VoucherDueInfo } from '../src/receipt/due.js';
import type { VoucherCheck, VoucherKind, VoucherStatus } from '../src/pos/gutschein.js';

/*
 * Die Welt eines Zahlbetrag-Falls (`setup` in fixtures/v3/zahlbetrag-faelle.json,
 * deutsche Form der Server-Dokumente) in die Optionen, die eine Kasse an
 * receiptDueCents gibt: gepruefte Gutscheine (wie checkVoucher sie liefert),
 * die Gutschein-Einstellung der Kasse und die Artikel fuer Leistungsgutscheine.
 */

type Json = Record<string, any>;

const ART: Record<string, VoucherKind> = { mehrzweck: 'multi_purpose', einzweck: 'single_purpose', leistung: 'service', aktion: 'promotion' };
const STATUS: Record<string, VoucherStatus> = {
  aktiv: 'active', aufgebraucht: 'used_up', abgelaufen: 'expired', ausgezahlt: 'paid_out', storniert: 'cancelled', gesperrt: 'blocked',
};

/** Ein Gutschein-Dokument des Servers so, wie checkVoucher ihn der Kasse zeigt. */
export function pruefungAus(daten: Json): VoucherCheck {
  const raus: Json = { type: ART[daten.art], status: STATUS[daten.status], codeSuffix: daten.codeEnde };
  const feld = (ziel: string, wert: unknown) => {
    if (wert !== undefined && wert !== null) raus[ziel] = wert;
  };
  feld('balanceCents', daten.saldoCents);
  feld('faceValueCents', daten.nennwertCents);
  feld('quantity', daten.stueck);
  feld('remainingQuantity', daten.stueckOffen);
  feld('vatRateBp', daten.satzBp);
  feld('discountCents', daten.rabattCents);
  feld('discountPercentBp', daten.rabattProzentBp);
  if (daten.kleinunternehmer === true && daten.satzBp === 0) raus.exempt = true;
  if (daten.artikel) {
    raus.article = { id: daten.artikel.id, name: daten.artikel.name, vatRateBp: daten.artikel.satzBp, priceCents: daten.artikel.preisCents };
  }
  return raus as VoucherCheck;
}

export function optionenAusSetup(setup: Json | undefined): ReceiptDueOptions {
  if (setup == null) return {};
  const o: ReceiptDueOptions = {};
  if (Array.isArray(setup.gutscheine)) {
    o.voucherInfo = setup.gutscheine.map((g: Json): VoucherDueInfo => ({ code: g.code, check: pruefungAus(g.daten) }));
  }
  if (setup.einstellung) {
    const e = setup.einstellung;
    o.voucherSettings = {
      sale: true,
      valueVoucherType: e.wertArt === 'einzweck' ? 'single_purpose' : 'multi_purpose',
      vatRateBp: e.wertArt === 'einzweck' ? e.satzBp : null,
    };
  }
  if (Array.isArray(setup.artikel)) {
    o.voucherArticles = setup.artikel.map((a: Json) => ({ id: a.id, priceCents: a.unitPriceCents, vatRateBp: Math.round(a.vatRate * 100) }));
  }
  return o;
}
