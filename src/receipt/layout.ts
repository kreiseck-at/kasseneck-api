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
import { KasseneckValidationError } from '../client/errors.js';
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

/**
 * Hervorgehobene Zeile (Belegart, Testhinweise): fett, zentriert, vom
 * Zeichner sichtbar abgesetzt (Rahmen, invers oder Groesse). Der Text ist
 * bereits fertig (RKSV § 11 Abs. 3: Trainings- und Stornobuchungen sind
 * ausdruecklich als solche zu bezeichnen).
 */
export interface LayoutBannerLine {
  kind: 'banner';
  text: string;
  /** `warnung` fuer Testkasse/Testsignatur (nicht gueltiger Beleg), sonst `belegart`. */
  ton: 'belegart' | 'warnung';
}

export type LayoutLine = LayoutTextLine | LayoutColumnsLine | LayoutRuleLine | LayoutSpaceLine | LayoutQrLine | LayoutBannerLine;

/**
 * Version des Layout-Regelwerks. Alte Belege werden mit ihrer gespeicherten
 * Version gesetzt.
 * - 1: Nullbeleg reduziert mit Summenzeile „Betrag: 0,00 €“.
 * - 2: Nullbeleg als Pruefbeleg mit Block „Prüfangaben“ (Barumsatz, Signatur,
 *   Signaturkarte, Zertifizierungsdienst, Registrierdaten); reduziert nur,
 *   wenn alle Betraege wirklich 0 sind. Vollbelege unveraendert.
 */
export type LayoutRegelwerk = 1 | 2;
export const AKTUELLES_REGELWERK: LayoutRegelwerk = 2;

/**
 * Registrierdaten fuer den Block „Prüfangaben“ auf Nullbelegen (Regelwerk 2).
 * Kennt sie nur das Backend (FinanzOnline-Registrierung der Signaturkarte und
 * der Kasse); fehlen sie, entfallen die Zeilen. Datum als „YYYY-MM-DD“ oder
 * ISO-Zeitstempel (Wiener Kalendertag).
 */
export interface Pruefangaben {
  karteRegistriertAm?: string | null;
  kasseRegistriertAm?: string | null;
}

/** Der fertige Bauplan eines Belegs. */
export interface ReceiptLayout {
  lines: LayoutLine[];
  /** Papierbreite, nach der die Spaltenbreiten gewaehlt wurden. */
  paperSize: PosPaperSize;
  /** Regelwerk, nach dem gesetzt wurde. */
  regelwerk: LayoutRegelwerk;
}

export interface BuildReceiptLayoutOptions {
  /**
   * Papierbreite; sie bestimmt — wie im Vorbild — allein die Spaltenbreiten
   * der USt-Tabelle. Vorgabe `mm58`.
   */
  paperSize?: PosPaperSize;
  /** Layout-Regelwerk (Vorgabe: aktuelles). Unbekannt -> Fehler, nie stumm anders setzen. */
  regelwerk?: LayoutRegelwerk;
  /** Beleg einer Testumgebung: Rahmen „TESTKASSE — kein gültiger Beleg“ oben und unten. */
  testKasse?: boolean;
  /**
   * Produktionskonto hat mit einer Test-Signatureinheit signiert: Rahmen
   * „TESTSIGNATUR — kein gültiger Beleg“. Der Aufrufer entscheidet (er kennt
   * das Konto); [receiptSignatureIsTest] sagt nur, OB die Signatur eine Testsignatur ist.
   */
  testSignatur?: boolean;
  /** Registrierdaten fuer den Block „Prüfangaben“ (nur Nullbelege, Regelwerk 2). */
  pruefangaben?: Pruefangaben | null;
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
 *
 * Ist der Zeitstempel unlesbar, wirft die Deutung ein gewoehnliches `Error`.
 * Das ist ein Antwortproblem und gehoert in die Fehler-Union dieses Pakets —
 * sonst faellt ein Aufrufer, der nach den Waechtern verzweigt, aus allen
 * heraus (dieselbe Umwandlung wie in client/receipts.ts bei
 * getFirstReceiptDate).
 */
function belegZeit(timeStamp: string): string {
  let t;
  try {
    t = toViennaWallClock(parseServerTimeStamp(timeStamp));
  } catch {
    // Der Zeitstempel selbst wandert NICHT in die Meldung: er kommt aus einer
    // fremden Antwort, und was dort steht, ist nicht unsere Zusage.
    throw new KasseneckValidationError('buildReceiptLayout', 'Beleg enthaelt keinen lesbaren Zeitstempel', 'response');
  }
  const zwei = (n: number): string => String(n).padStart(2, '0');
  return `${zwei(t.day)}.${zwei(t.month)}.${t.year} ${zwei(t.hour)}:${zwei(t.minute)}:${zwei(t.second)}`;
}

/**
 * Zahlungsart als Anzeigetext. Drei Faelle, und alle drei kommen vor:
 * bekannter Eintrag (Beschriftung), unbekannter Schluessel (roh — besser als
 * ein Beleg, der sich nicht anzeigen laesst), und **gar keiner**: Start- und
 * Nullbelege tragen keine Zahlungsart, das Backend sendet dann `null`. Da
 * `typeof null === 'object'` ist, ergab das beim Lesen von `.label` einen
 * nackten TypeError.
 */
function zahlungsartText(wert: Receipt['paymentMethod']): string {
  if (wert != null && typeof wert === 'object') {
    return wert.label;
  }
  return typeof wert === 'string' ? wert : '';
}

// -------------------------------------------------------- Kleinunternehmer

/**
 * Hinweis auf die Steuerbefreiung, den ein Kleinunternehmerbeleg tragen muss —
 * ohne ihn stuende in der USt-Tabelle „D 0 %" ohne jede Begruendung, und ab
 * 400 € greift § 11 UStG voll.
 *
 * Wortlaut **woertlich** aus dem Backend (`INVOICE_TAX_NOTE.smallBusiness` in
 * functions/index.js), damit auf Beleg und Rechnung derselbe Satz steht. Er
 * traegt einen Gedankenstrich (U+2013), kein Bindestrich; der Bondrucker
 * bekommt ihn ueber die Ersetzung der ESC/POS-Bruecke.
 *
 * Weder `print_paper.dart` noch das Beleg-PDF des Backends drucken den Hinweis
 * heute — hier liegt das Kennzeichen vor, also steht er hier.
 *
 * Der **Name** ist englisch wie die uebrige Oberflaeche (`DEFAULT_BASE_URL`,
 * `formatCents`, `buildReceiptLayout`); der **Wortlaut** ist selbstverstaendlich
 * deutsch — er steht so auf oesterreichischen Belegen.
 */
export const SMALL_BUSINESS_NOTICE = 'Umsatzsteuerbefreit – Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG.';

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

/**
 * Traegt der Beleg eine **Test**-Signatur? Erkannt am ZDA-Kennzeichen `AT100`
 * im maschinenlesbaren Code (`_R1-AT100_...`) — der Testpfad der Testumgebungen.
 * Ob das ein Problem ist, weiss nur der Aufrufer (Testkonto: normal;
 * Produktionskonto: „TESTSIGNATUR“-Warnung).
 */
export function receiptSignatureIsTest(receipt: Pick<Receipt, 'qr'>): boolean {
  return /^_R1-AT100_/.test(receipt.qr ?? '');
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

/**
 * Netto in ganzen Cent aus einem Brutto-Betrag.
 *
 * Gerundet wird **von der Null weg** — nicht mit `Math.round`, das `.5` immer
 * Richtung +unendlich schiebt. Sonst spiegelt ein Stornobeleg seinen
 * Originalbeleg nicht: 99 Cent zu 20 % liegen mit 82,5 Cent Netto genau auf der
 * Rundungsgrenze, der Beleg zeigte „0,83 / 0,16", der Storno aber
 * „-0,82 / -0,17" — Beleg und Storno heben sich in der Netto- und
 * MwSt-Spalte nicht auf. Bei 20 % trifft das jeden sechsten Cent-Betrag.
 * (Dieselbe Regel gilt in printing/escpos.ts und in Darts `toStringAsFixed`.)
 */
function nettoAusBrutto(bruttoCents: number, rate: number): number {
  const betrag = Math.round((Math.abs(bruttoCents) * 100) / (100 + rate));
  return bruttoCents < 0 ? -betrag : betrag;
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

// ---------------------------------------------------------------- Belegart

const TESTKASSE_TEXT = 'TESTKASSE — kein gültiger Beleg';
const TESTSIGNATUR_TEXT = 'TESTSIGNATUR — kein gültiger Beleg';
/** Erklaerung am Trainingsbeleg (Wortlaut mit dem Betreiber abgestimmt). */
const TRAINING_ERKLAERUNG = [
  'Trainingsbuchung — kein Kauf, keine Zahlung, keine steuerliche Buchung.',
  'Sollten Sie diesen Beleg als Kunde erhalten haben, sagen Sie bitte dem Betrieb Bescheid.',
];

function bannerZeile(text: string, ton: LayoutBannerLine['ton'] = 'belegart'): LayoutBannerLine {
  return { kind: 'banner', text, ton };
}

/** Belegtyp als Zeichenkette (Enum-Objekt oder roher Serverwert). */
function belegtyp(receipt: Receipt): string {
  return typeof receipt.receiptType === 'object' ? receipt.receiptType.value : String(receipt.receiptType ?? '');
}

/** Ist das ein Nullbeleg (Start-, Monats-, Jahres-, Schluss-, Pruefbeleg)? */
export function receiptIsZero(receipt: Receipt): boolean {
  const t = belegtyp(receipt);
  return t === 'zero' || t === 'start';
}

/**
 * Sind alle Betraege des Belegs wirklich 0? (Keine Positionen mit Wert, keine
 * Gutscheine.) Ein Nullbeleg, der das nicht erfuellt, ist ein Datenfehler --
 * Regelwerk 2 setzt ihn dann als normalen Beleg.
 */
export function receiptAmountsAreZero(receipt: Receipt): boolean {
  if (receipt.vouchers.length > 0) return false;
  return receiptSumCents(receipt) === 0 && receipt.items.every((it) => it.priceCents === 0 || it.quantity === 0);
}

/**
 * Zertifizierungsdienst aus der QR-Kennung `_R1-<ZDA>_` (RKSV-Detailspezifikation:
 * AT0 geschlossenes System, AT1 A-Trust, AT2 GlobalTrust, AT3 PrimeSign,
 * AT100 Testsignatur). Unbekannte Kennung: nur die Kennung.
 */
export function receiptZdaText(qr: string): string | null {
  const m = /^_R1-(AT\d+)_/.exec(qr ?? '');
  if (!m) return null;
  const kennung = m[1] as string;
  const namen: Record<string, string> = { AT0: 'geschlossenes System', AT1: 'A-Trust', AT2: 'GlobalTrust', AT3: 'PrimeSign', AT100: 'Testsignatur' };
  const name = namen[kennung];
  return name ? `${name} (${kennung})` : kennung;
}

/** „YYYY-MM-DD“ oder ISO -> „TT.MM.JJJJ“ (Wiener Kalendertag); Unlesbares -> null. */
function pruefDatum(wert: string | null | undefined): string | null {
  if (!wert) return null;
  const nurTag = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wert);
  if (nurTag) return `${nurTag[3]}.${nurTag[2]}.${nurTag[1]}`;
  try {
    const t = toViennaWallClock(parseServerTimeStamp(wert));
    const zwei = (n: number): string => String(n).padStart(2, '0');
    return `${zwei(t.day)}.${zwei(t.month)}.${t.year}`;
  } catch {
    return null;
  }
}

/** Block „Prüfangaben“ des Nullbelegs (Regelwerk 2). Nichts Geheimes: alles steht auch im QR bzw. bei FinanzOnline. */
function pruefangabenBlock(receipt: Receipt, angaben: Pruefangaben | null): LayoutLine[] {
  const out: LayoutLine[] = [];
  out.push({ kind: 'rule', char: '-' });
  out.push(textZeile('Prüfangaben', 'center', true));
  out.push(paarZeile('Barumsatz:', '0,00 €'));
  out.push(paarZeile('Signatur:', receiptSignatureFailed(receipt) ? 'ausgefallen' : 'signiert'));
  if (receipt.certificateSerialNumber) out.push(paarZeile('Signaturkarte:', receipt.certificateSerialNumber));
  const zda = receiptZdaText(receipt.qr);
  if (zda) out.push(paarZeile('Zertifizierungsdienst:', zda, 7, 5));
  const karte = pruefDatum(angaben?.karteRegistriertAm);
  if (karte) out.push(paarZeile('Karte registriert:', karte));
  const kasse = pruefDatum(angaben?.kasseRegistriertAm);
  if (kasse) out.push(paarZeile('Kasse registriert:', kasse));
  out.push({ kind: 'rule', char: '-' });
  return out;
}

/** Monat/Jahr des Belegs in Wiener Zeit -- fuer „Nullbeleg 08/2026“. */
function belegMonatJahr(timeStamp: string): { monat: string; jahr: string } {
  try {
    const t = toViennaWallClock(parseServerTimeStamp(timeStamp));
    return { monat: String(t.month).padStart(2, '0'), jahr: String(t.year) };
  } catch {
    return { monat: '??', jahr: '????' };
  }
}

/** Grund eines Stornos lesbar (Katalog-Code oder freier Text). */
function stornoGrundText(code: string | undefined): string | null {
  if (!code) return null;
  const bekannt: Record<string, string> = {
    kunde_storniert: 'Kunde hat storniert', falsch_erfasst: 'Falsch erfasst', ware_retour: 'Ware zurückgenommen',
    doppelt: 'Doppelt erfasst', preis_falsch: 'Preis falsch', sonstiges: 'Sonstiges',
  };
  return bekannt[code] ?? code;
}

/**
 * Belegart-Block unter dem Betriebskopf: Titel als Banner, Untertitel als
 * zentrierte Textzeilen. Verkaufsbelege bekommen keinen Block.
 */
function belegartBlock(receipt: Receipt): LayoutLine[] {
  const t = belegtyp(receipt);
  const aus: LayoutLine[] = [];
  if (t === 'cancellation') {
    aus.push(bannerZeile('STORNOBELEG'));
    aus.push(textZeile(receipt.cancellationOf ? `Stornobuchung zu Beleg ${receipt.cancellationOf.receiptId}` : 'Stornobuchung', 'center'));
    const grund = stornoGrundText(typeof receipt.cancellationReason === 'string' ? receipt.cancellationReason : undefined);
    if (grund) aus.push(textZeile(`Grund: ${grund}`, 'center'));
  } else if (t === 'training') {
    aus.push(bannerZeile('TRAININGSBELEG'));
    for (const z of TRAINING_ERKLAERUNG) aus.push(textZeile(z, 'center'));
  } else if (t === 'start') {
    aus.push(bannerZeile('STARTBELEG'));
    aus.push(textZeile('Nullbeleg zur Inbetriebnahme', 'center'));
  } else if (t === 'zero') {
    const { monat, jahr } = belegMonatJahr(receipt.timeStamp);
    switch (receipt.zeroKind) {
      case 'monthly':
        aus.push(bannerZeile('MONATSBELEG'), textZeile(`Nullbeleg ${monat}/${jahr}`, 'center'));
        break;
      case 'annual':
        aus.push(bannerZeile('JAHRESBELEG'), textZeile(`Nullbeleg ${jahr} — Prüfung mit BMF-App`, 'center'));
        break;
      case 'annual_replacement':
        // Ersatz-Jahresbeleg wird im Folgejahr erzeugt und gilt fuer das Vorjahr.
        aus.push(bannerZeile('JAHRESBELEG'), textZeile(`Nullbeleg ${String(Number(jahr) - 1)} — Prüfung mit BMF-App (Ersatzbeleg)`, 'center'));
        break;
      case 'final':
        aus.push(bannerZeile('SCHLUSSBELEG'), textZeile('Nullbeleg zur Außerbetriebnahme', 'center'));
        break;
      case 'outage_end':
        aus.push(bannerZeile('NULLBELEG'), textZeile('Prüfbeleg nach Signaturausfall', 'center'));
        break;
      default:
        aus.push(bannerZeile('NULLBELEG'), textZeile('Prüfbeleg', 'center'));
    }
  }
  return aus;
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
  const regelwerk = options.regelwerk ?? AKTUELLES_REGELWERK;
  if (regelwerk !== 1 && regelwerk !== 2) {
    throw new KasseneckValidationError('buildReceiptLayout', `Unbekanntes Layout-Regelwerk ${String(regelwerk)} — bitte Paket aktualisieren`, 'request');
  }
  const lines: LayoutLine[] = [];
  // Regelwerk 2: ein „Nullbeleg“ mit echten Betraegen wird nicht reduziert --
  // die Zahlen stehen drauf, statt hinter einer Null zu verschwinden.
  const nullbeleg = receiptIsZero(receipt) && (regelwerk === 1 || receiptAmountsAreZero(receipt));
  const warnungen: LayoutBannerLine[] = [];
  if (options.testKasse) warnungen.push(bannerZeile(TESTKASSE_TEXT, 'warnung'));
  if (options.testSignatur) warnungen.push(bannerZeile(TESTSIGNATUR_TEXT, 'warnung'));

  // --- Warnrahmen oben (Testkasse/Testsignatur): ueber dem Kopf, damit ihn niemand uebersieht.
  lines.push(...warnungen);

  // --- Belegkopf: Firma, Anschrift, Steuerangabe, Telefon
  lines.push(textZeile(company.companyName, 'center', true));
  lines.push(textZeile(company.street, 'center'));
  lines.push(textZeile(`${company.zip} ${company.city}`, 'center'));
  lines.push(textZeile(receiptCompanyTaxInfo(company), 'center'));
  lines.push(textZeile(company.phone, 'center'));

  // --- Belegart (Storno, Training, Nullbeleg-Arten) direkt unter dem Kopf
  const belegart = belegartBlock(receipt);
  if (belegart.length > 0) {
    lines.push({ kind: 'space', lines: 1 });
    lines.push(...belegart);
  }

  // --- Nullbeleg: reduziert (§ 132a Abs. 3 BAO / RKSV § 11 Abs. 1 -- Pflichtangaben
  //     ja, Positionen/MwSt-Tabelle/Zahlungsart/Fusszeilen nein).
  if (nullbeleg) {
    lines.push({ kind: 'space', lines: 1 });
    lines.push(paarZeile('Datum:', belegZeit(receipt.timeStamp), 4, 8));
    lines.push(paarZeile('Kassen-ID:', receipt.cashregisterId));
    lines.push(paarZeile('Beleg-ID:', receipt.receiptId));
    lines.push({ kind: 'space', lines: 1 });
    if (regelwerk === 1) {
      lines.push(textZeile('Betrag: 0,00 €', 'center', true));
    } else {
      lines.push(...pruefangabenBlock(receipt, options.pruefangaben ?? null));
    }
    lines.push({ kind: 'space', lines: 1 });
    if (receiptSignatureFailed(receipt)) {
      lines.push(textZeile(SIGNATUR_AUSGEFALLEN, 'center'));
      lines.push({ kind: 'space', lines: 1 });
    }
    lines.push({ kind: 'qr', data: receipt.qr });
    lines.push({ kind: 'space', lines: 1 });
    lines.push(...warnungen);
    return { lines, paperSize, regelwerk };
  }

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
    const nettoCents = nettoAusBrutto(bruttoCents, gruppe.satz.rate);
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
  lines.push(paarZeile('Zahlungsart:', zahlungsartText(receipt.paymentMethod)));
  lines.push({ kind: 'space', lines: 1 });

  // --- Rechtshinweise und Ausfallhinweis
  const hinweise = company.isSmallBusiness
    ? [SMALL_BUSINESS_NOTICE, ...receipt.legalMessage]
    : receipt.legalMessage;
  if (hinweise.length > 0) {
    for (const zeile of hinweise) {
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

  // --- Warnrahmen unten (Testkasse/Testsignatur)
  if (warnungen.length > 0) {
    lines.push({ kind: 'space', lines: 1 });
    lines.push(...warnungen);
  }

  return { lines, paperSize, regelwerk };
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
