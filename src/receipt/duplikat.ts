import type { LayoutBannerLine, LayoutLine, ReceiptLayout } from './layout.js';

/** Der Aufdruck eines Belegduplikats; derselbe Text im Dart-Zwilling. */
const DUPLIKAT = 'DUPLIKAT';

/** Eigene Kopie einer Zeile: wer am Duplikat dreht, dreht nie am Erstdruck. */
function kopie(zeile: LayoutLine): LayoutLine {
  return zeile.kind === 'columns' ? { ...zeile, columns: zeile.columns.map((c) => ({ ...c })) } : { ...zeile };
}

/**
 * Kennzeichnet einen Nachdruck als **Belegduplikat**. Registrierkassen-Erlass
 * BMF-AV Nr. 2/2026, Abschnitt 4.5.6: „Ein Belegduplikat ist als solches zu
 * bezeichnen, nicht nochmals zu signieren, nicht neuerlich im
 * Datenerfassungsprotokoll aufzunehmen und darf zu keiner Veränderung des
 * Umsatzzählers führen.“ Signatur, DEP und Zähler bleiben ohnehin unberührt,
 * weil ein Nachdruck den gespeicherten Beleg druckt; diese Funktion liefert
 * die Bezeichnung.
 *
 * Die Kasse ruft sie bei **jedem** Nachdruck und bei „Kopie drucken“ auf,
 * nie beim Erstdruck, und gibt das Ergebnis an denselben Druckweg
 * (`escPosLayoutBytes`, `eposPrintXml`, `receiptSheet`, React-Ansicht).
 *
 * Neu ist genau eine erste Zeile: der Aufdruck `DUPLIKAT` als hervorgehobene
 * Zeile (`banner`, Ton `receipt_type`) -- die staerkste Hervorhebung des
 * Modells: fett, zentriert, zwischen zwei `=`-Rahmenzeilen; doppelte Hoehe
 * kennt das Layout nicht. Alles andere bleibt Zeile fuer Zeile wie beim
 * Erstdruck (QR, Betraege, Signaturtext, Warnrahmen von Testkasse und
 * Testsignatur). Mit Logo steht der Aufdruck wie jeder fuehrende Rahmen ueber
 * dem Logo.
 *
 * Reine Funktion: die Eingabe bleibt unangetastet, das Ergebnis ist eine
 * eigene Kopie. Idempotent: traegt das Layout den Aufdruck schon als erste
 * Zeile, kommt er nicht ein zweites Mal dazu.
 */
export function markAsDuplicate(layout: ReceiptLayout): ReceiptLayout {
  const lines = layout.lines.map(kopie);
  const erste = lines[0];
  if (erste?.kind !== 'banner' || erste.text !== DUPLIKAT) {
    const aufdruck: LayoutBannerLine = { kind: 'banner', text: DUPLIKAT, tone: 'receipt_type' };
    lines.unshift(aufdruck);
  }
  return { ...layout, lines };
}
