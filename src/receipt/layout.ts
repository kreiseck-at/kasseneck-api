import { VatRate, VoucherAction, VoucherType } from '../enums/index.js';
import {
  receiptCompanyTaxInfo,
  receiptItemTotalCents,
  receiptSubSumCents,
  receiptSumCents,
  voucherIsValid,
  type Receipt,
  type ReceiptCompany,
  type ReceiptItem,
  type Voucher,
} from '../models/index.js';
import { parseServerTimeStamp, toViennaWallClock } from '../vienna-time.js';
import type { PosPaperSize } from '../printing/escpos.js';

/**
 * Beleg-Layout — der Bauplan eines Kasseneck-Belegs als reines Datenmodell.
 *
 * Aufbau und Reihenfolge stammen aus dem Flutter-Vorbild
 * `kasseneck_api/lib/models/print_paper.dart` (`setKeckReceipt`). Der
 * Unterschied: dort entstehen unmittelbar Druckerbytes, hier entsteht **eine
 * Folge von Zeilen**. Wer sie zeichnet, entscheidet der Aufrufer — der
 * React-Adapter (`@kreiseck/kasseneck-api/react`) fuer den Bildschirm,
 * [escPosLayoutBytes] (`./layout-escpos.js`) fuer den Bondrucker, ein
 * PDF-Erzeuger im Backend. Damit steht die Reihenfolge der Belegangaben genau
 * einmal da und nicht je Ausgabeweg erneut.
 *
 * Kein Framework, keine Druckerabhaengigkeit, keine Bildverarbeitung: das
 * Modell laeuft unveraendert im Browser und in Node.
 *
 * **Der Text im Modell ist echter Text.** Ein Euro-Zeichen ist hier ein „€",
 * kein „EUR". Bondrucker koennen es nicht darstellen; die Ersetzung sitzt
 * deshalb an genau einer Stelle in der ESC/POS-Bruecke und nicht hier — sonst
 * stuende auch auf dem Bildschirm „EUR".
 *
 * Bewusst **nicht** enthalten: Firmenlogo und Rasterbilder (brauchen
 * Bildverarbeitung, die im Browser anders aussieht als in Node), PDF-Erzeugung,
 * Druckeransteuerung und die anbieterspezifischen Kartenzahlungsbloecke des
 * Vorbilds (GP Tom, Hobex, SumUp, myPOS, Stripe).
 */

// ------------------------------------------------------------------- Typen

/** Ausrichtung einer Zeile bzw. einer Spalte. */
export type LayoutAlign = 'left' | 'center' | 'right';

/** Eine Spalte einer Spaltenzeile; `width` ist ein Zwoelftel-Anteil (1..12). */
export interface LayoutColumn {
  text: string;
  width: number;
  align: LayoutAlign;
}

/** Eine Textzeile ueber die volle Breite. */
export interface LayoutTextLine {
  kind: 'text';
  text: string;
  align: LayoutAlign;
  bold: boolean;
}

/** Eine Zeile aus mehreren Spalten; die Breiten ergeben zusammen 12. */
export interface LayoutColumnsLine {
  kind: 'columns';
  columns: LayoutColumn[];
}

/** Eine durchgehende Trennlinie aus [char]. */
export interface LayoutRuleLine {
  kind: 'rule';
  char: string;
}

/** Leerraum von [lines] Zeilen. */
export interface LayoutSpaceLine {
  kind: 'space';
  lines: number;
}

/** Der maschinenlesbare RKSV-Code. [data] ist die Nutzlast, unveraendert. */
export interface LayoutQrLine {
  kind: 'qr';
  data: string;
}

export type LayoutLine = LayoutTextLine | LayoutColumnsLine | LayoutRuleLine | LayoutSpaceLine | LayoutQrLine;

/** Der fertige Bauplan eines Belegs. */
export interface ReceiptLayout {
  lines: LayoutLine[];
  /** Papierbreite, nach der die Spaltenbreiten gewaehlt wurden. */
  paperSize: PosPaperSize;
}

export interface BuildReceiptLayoutOptions {
  /**
   * Papierbreite; sie bestimmt — wie im Vorbild — allein die Spaltenbreiten
   * der USt-Tabelle. Vorgabe `mm58`.
   */
  paperSize?: PosPaperSize;
}

// -------------------------------------------------------------- Formatierung

/**
 * Cent-Betrag als Anzeigetext: `1234` -> `"12,34"`. Die **einzige** Stelle, an
 * der aus Cent eine Zeichenkette wird. Erwartet ganze Cent (Geld wird in
 * diesem Paket ausnahmslos ganzzahlig gerechnet).
 */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * Belegzeit als `DD.MM.YYYY HH:mm:ss` in **Wiener** Zeit — Zwilling von
 * `KasseneckReceipt.readableTime`. Der Server liefert seine Zeitstempel
 * uneinheitlich; gedeutet wird deshalb ueber `parseServerTimeStamp` und nie
 * ueber `new Date(text)` (siehe ../vienna-time.ts).
 */
function belegZeit(timeStamp: string): string {
  const t = toViennaWallClock(parseServerTimeStamp(timeStamp));
  const zwei = (n: number): string => String(n).padStart(2, '0');
  return `${zwei(t.day)}.${zwei(t.month)}.${t.year} ${zwei(t.hour)}:${zwei(t.minute)}:${zwei(t.second)}`;
}

// ------------------------------------------------------------------ Signatur

/** Text, den das Backend statt einer Signatur ablegt, wenn die Karte ausfaellt. */
const SIGNATUR_AUSGEFALLEN = 'Sicherheitseinrichtung ausgefallen';

/**
 * Derselbe Text base64url-kodiert — so steht er als dritter JWS-Teil im Feld
 * `sig` (Zwilling von `RKSVService.isSigSuccess`). Fest hinterlegt statt zur
 * Laufzeit kodiert: `btoa`/`Buffer` sind in Browser und Node verschieden zu
 * haben, und der Wert ist unveraenderlich.
 */
const SIGNATUR_AUSGEFALLEN_BASE64URL = 'U2ljaGVyaGVpdHNlaW5yaWNodHVuZyBhdXNnZWZhbGxlbg';

/** Wurde der Beleg ohne funktionierende Signatureinheit ausgestellt? */
export function receiptSignatureFailed(receipt: Receipt): boolean {
  return receipt.sig.split('.')[2] === SIGNATUR_AUSGEFALLEN_BASE64URL;
}

// ------------------------------------------------------------- Steuersaetze

interface Steuersatz {
  rate: number;
  /** RKSV-Kategoriebuchstabe (A/B/C/D/E/G) — `?`, wenn der Satz unbekannt ist. */
  category: string;
}

/**
 * Steuersatz einer Position. Ein roher Zahlenwert bedeutet: die Nutzlast
 * fuehrt einen Satz, den dieses Paket noch nicht kennt (siehe
 * models/receipt-item.ts). Der Beleg ist dann bereits ausgestellt und
 * signiert — er muss sich anzeigen lassen, also erhaelt der Satz seine Zahl
 * und einen Platzhalter als Kategorie.
 */
function steuersatz(vat: VatRate | number): Steuersatz {
  if (typeof vat === 'number') {
    return { rate: vat, category: '?' };
  }
  return { rate: vat.rate, category: vat.category };
}

/** `20` -> `"20"`, `4.9` -> `"4,9"` (wie im Vorbild). */
function satzText(rate: number): string {
  return String(rate).replace('.', ',');
}

interface Steuergruppe {
  satz: Steuersatz;
  bruttoCents: number;
}

// -------------------------------------------------------------- Gutscheine

/**
 * Belegtext eines Gutscheins — Zwilling von `KeckVoucher.receiptText`:
 * Gutscheinart, Wert und Name, wobei ein Name, der die Gutscheinart schon
 * nennt, allein stehen bleibt.
 */
function gutscheinText(voucher: Voucher): string {
  let text = '';
  if (voucher.type === VoucherType.value) {
    text += 'Wertgutschein';
  } else if (voucher.type === VoucherType.promo) {
    text += 'Promotionsgutschein';
  }
  const name = voucher.name;
  if (name != null && name.toLowerCase().includes(text.toLowerCase())) {
    return name;
  }
  if (voucher.valueCents != null) {
    text += ` ${gutscheinBetrag(voucher.valueCents)} €`;
  }
  if (name != null && name.length > 0) {
    text += ` - ${name}`;
  }
  return text;
}

/**
 * Ganze Betraege kurz (`"10"`), krumme mit zwei Nachkommastellen (`"1,50"`) —
 * Zwilling von `KeckVoucher.formatVoucherAmount`.
 */
function gutscheinBetrag(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : formatCents(cents);
}

// ----------------------------------------------------------------- Bauteile

function textZeile(text: string, align: LayoutAlign = 'left', bold = false): LayoutTextLine {
  return { kind: 'text', text, align, bold };
}

/** Zwei Spalten: links beschriftet, rechts der Wert (Vorbild: `addDoubleText`). */
function paarZeile(links: string, rechts: string, linksBreite = 6, rechtsBreite = 6): LayoutColumnsLine {
  return {
    kind: 'columns',
    columns: [
      { text: links, width: linksBreite, align: 'left' },
      { text: rechts, width: rechtsBreite, align: 'right' },
    ],
  };
}

/** Vier Spalten der USt-Tabelle (Vorbild: `_addTable`). */
function tabellenZeile(werte: [string, string, string, string], paperSize: PosPaperSize): LayoutColumnsLine {
  const breit = paperSize === 'mm80';
  const breiten = [3, breit ? 4 : 3, 3, breit ? 2 : 3];
  return {
    kind: 'columns',
    columns: werte.map((text, i) => ({
      text,
      width: breiten[i] as number,
      align: i === 3 ? ('right' as const) : ('left' as const),
    })),
  };
}

/** Positionszeile: Menge, Bezeichnung, ab Menge 2 der Einzelpreis. */
function positionsZeile(item: ReceiptItem, satz: Steuersatz): LayoutColumnsLine {
  const menge = String(item.quantity);
  // Vorbild: Menge auf zwei Zeichen auffuellen, danach ' x ' — bei drei- und
  // mehrstelligen Mengen faellt das Leerzeichen dahinter weg.
  const kopf = menge.padEnd(2) + (menge.length > 2 ? ' x' : ' x ');
  const einzelpreis = item.quantity > 1 ? ` je ${formatCents(item.priceCents)}` : '';
  return {
    kind: 'columns',
    columns: [
      { text: `${kopf}${item.name}${einzelpreis}`, width: 7, align: 'left' },
      { text: `${formatCents(receiptItemTotalCents(item))} ${satz.category}`, width: 5, align: 'right' },
    ],
  };
}

// ------------------------------------------------------------------- Aufbau

/**
 * Baut das Layout eines Belegs. Reihenfolge und Spaltenbreiten folgen
 * `print_paper.dart` (`setKeckReceipt`).
 */
export function buildReceiptLayout(
  receipt: Receipt,
  company: ReceiptCompany,
  options: BuildReceiptLayoutOptions = {},
): ReceiptLayout {
  const paperSize = options.paperSize ?? 'mm58';
  const lines: LayoutLine[] = [];

  // --- Belegkopf: Firma, Anschrift, Steuerangabe, Telefon
  lines.push(textZeile(company.companyName, 'center', true));
  lines.push(textZeile(company.street, 'center'));
  lines.push(textZeile(`${company.zip} ${company.city}`, 'center'));
  lines.push(textZeile(receiptCompanyTaxInfo(company), 'center'));
  lines.push(textZeile(company.phone, 'center'));

  // --- Kundendaten
  if (receipt.customerDetails.length > 0) {
    lines.push({ kind: 'space', lines: 1 });
    receipt.customerDetails.forEach((zeile, i) => {
      lines.push(i === 0 ? paarZeile('Kunde:', zeile, 5, 7) : paarZeile('', zeile, 1, 11));
    });
  }

  // --- Belegkennung
  lines.push({ kind: 'space', lines: 1 });
  lines.push(paarZeile('Datum:', belegZeit(receipt.timeStamp), 4, 8));
  lines.push(paarZeile('Kassen-ID:', receipt.cashregisterId));
  lines.push(paarZeile('Beleg-ID:', receipt.receiptId));
  lines.push({ kind: 'space', lines: 1 });

  // --- Positionen; dabei die Steuergruppen aufsammeln (Reihenfolge des
  //     ersten Auftretens, wie im Vorbild).
  const gruppen = new Map<number, Steuergruppe>();
  const gruppeVon = (satz: Steuersatz): Steuergruppe => {
    const vorhanden = gruppen.get(satz.rate);
    if (vorhanden !== undefined) {
      return vorhanden;
    }
    const neu: Steuergruppe = { satz, bruttoCents: 0 };
    gruppen.set(satz.rate, neu);
    return neu;
  };

  for (const item of receipt.items) {
    const satz = steuersatz(item.vat);
    gruppeVon(satz).bruttoCents += receiptItemTotalCents(item);
    lines.push(positionsZeile(item, satz));
  }

  // --- Gutscheine: verkaufte Wertgutscheine sind Umsatz zu 0 %, eingeloeste
  //     Promotionsgutscheine mindern die Steuergruppen anteilig.
  let promoCents = 0;
  for (const voucher of receipt.vouchers) {
    const wert = voucher.valueCents ?? 0;
    if (voucherIsValid(voucher) && voucher.action === VoucherAction.sell) {
      gruppeVon(steuersatz(VatRate.vat0)).bruttoCents += wert;
    }
    if (voucher.action === VoucherAction.sell && voucher.type === VoucherType.value) {
      lines.push({
        kind: 'columns',
        columns: [
          { text: `1  x ${gutscheinText(voucher)}`, width: 7, align: 'left' },
          { text: `${formatCents(wert)} ${VatRate.vat0.category}`, width: 5, align: 'right' },
        ],
      });
    }
    if (voucher.action === VoucherAction.redeem && voucher.type === VoucherType.promo) {
      promoCents += wert;
      lines.push({
        kind: 'columns',
        columns: [
          { text: gutscheinText(voucher), width: 7, align: 'left' },
          { text: `-${formatCents(wert)} €`, width: 5, align: 'right' },
        ],
      });
    }
  }

  verteilePromoGutschein(gruppen, promoCents);

  // --- USt-Aufteilung
  lines.push({ kind: 'space', lines: 1 });
  lines.push(tabellenZeile(['MwSt%', 'MwSt', 'Netto', 'Brutto'], paperSize));
  for (const gruppe of gruppen.values()) {
    // Netto aus dem Brutto in ganzen Cent, MwSt als Rest: so ergeben Netto und
    // MwSt zusammen immer wieder exakt den Brutto-Betrag der Zeile. (Das
    // Vorbild rundet beide Werte einzeln aus einer Gleitkommazahl und kann
    // dabei um einen Cent auseinanderlaufen.)
    const bruttoCents = gruppe.bruttoCents;
    const nettoCents = Math.round((bruttoCents * 100) / (100 + gruppe.satz.rate));
    lines.push(
      tabellenZeile(
        [
          `${gruppe.satz.category} ${satzText(gruppe.satz.rate)}%`,
          formatCents(bruttoCents - nettoCents),
          formatCents(nettoCents),
          formatCents(bruttoCents),
        ],
        paperSize,
      ),
    );
  }
  lines.push({ kind: 'rule', char: '-' });

  // --- Summen
  const summeCents = receiptSumCents(receipt);
  const zwischensummeCents = receiptSubSumCents(receipt);
  if (summeCents !== zwischensummeCents) {
    lines.push(paarZeile('Zwischensumme', `${formatCents(zwischensummeCents)} €`));
    for (const voucher of receipt.vouchers) {
      if (voucher.action === VoucherAction.redeem && voucher.type === VoucherType.value) {
        lines.push(paarZeile(gutscheinText(voucher), `-${formatCents(voucher.valueCents ?? 0)} €`));
      }
    }
    lines.push({ kind: 'rule', char: '-' });
  }
  lines.push(paarZeile('Gesamt:', `${formatCents(summeCents)} €`));
  lines.push(
    paarZeile(
      'Zahlungsart:',
      // Eine Zahlungsart, die dieses Paket noch nicht kennt, steht roh da —
      // besser als ein Beleg, der sich nicht anzeigen laesst.
      typeof receipt.paymentMethod === 'object' ? receipt.paymentMethod.label : receipt.paymentMethod,
    ),
  );
  lines.push({ kind: 'space', lines: 1 });

  // --- Rechtshinweise und Ausfallhinweis
  if (receipt.legalMessage.length > 0) {
    for (const zeile of receipt.legalMessage) {
      lines.push(textZeile(zeile, 'center'));
    }
    lines.push({ kind: 'space', lines: 1 });
  }
  if (receiptSignatureFailed(receipt)) {
    lines.push(textZeile(SIGNATUR_AUSGEFALLEN, 'center'));
    lines.push({ kind: 'space', lines: 1 });
  }

  // --- RKSV-QR-Code
  lines.push({ kind: 'qr', data: receipt.qr });
  lines.push({ kind: 'space', lines: 1 });

  // --- Dankestext und Fusszeilen
  if (company.thanksMessage.length > 0) {
    lines.push({ kind: 'space', lines: 1 });
    for (const zeile of company.thanksMessage) {
      lines.push(textZeile(zeile, 'center'));
    }
  }
  for (const fuss of [company.footer1, company.footer2, company.footer3, company.footer4]) {
    // Leere Fusszeilen werden ausgelassen: sie truegen nichts und erzeugten
    // auf dem Bildschirm eine sichtbare Luecke.
    if (fuss != null && fuss.length > 0) {
      lines.push(textZeile(fuss, 'center'));
    }
  }

  return { lines, paperSize };
}

/**
 * Verteilt einen eingeloesten Promotionsgutschein anteilig auf die
 * Steuergruppen — Zwilling von `print_paper.dart` (Zeilen 296-325).
 *
 * Der Gutschein mindert keinen einzelnen Artikel, sondern den Umsatz: jede
 * Gruppe gibt ihren Anteil am Brutto ab. Der durch die ganzzahlige Teilung
 * uebrig bleibende Cent geht an die groesste Gruppe, damit die Tabelle in
 * Summe wieder die Zwischensumme ergibt.
 */
function verteilePromoGutschein(gruppen: Map<number, Steuergruppe>, promoCents: number): void {
  const gesamtCents = [...gruppen.values()].reduce((summe, g) => summe + g.bruttoCents, 0);
  const nutzbarCents = promoCents > gesamtCents ? gesamtCents : promoCents;
  if (nutzbarCents <= 0 || gesamtCents <= 0) {
    return;
  }

  const anteile = new Map<number, number>();
  let verteiltCents = 0;
  for (const [satz, gruppe] of gruppen) {
    const anteil = Math.trunc((nutzbarCents * gruppe.bruttoCents) / gesamtCents);
    anteile.set(satz, anteil);
    verteiltCents += anteil;
  }

  const restCents = nutzbarCents - verteiltCents;
  if (restCents > 0) {
    const groesste = [...gruppen.entries()].sort((a, b) => b[1].bruttoCents - a[1].bruttoCents)[0];
    if (groesste !== undefined && groesste[1].bruttoCents > 0) {
      anteile.set(groesste[0], (anteile.get(groesste[0]) ?? 0) + restCents);
    }
  }

  for (const [satz, gruppe] of gruppen) {
    gruppe.bruttoCents -= anteile.get(satz) ?? 0;
  }
}
