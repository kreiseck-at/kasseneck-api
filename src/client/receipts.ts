import {
  ReceiptType,
  type ReceiptTypeKey,
  KeckPaymentMethod,
  type KeckPaymentMethodKey,
  CreditCardProvider,
  VoucherAction,
  VoucherType,
} from '../enums/index.js';
import {
  type Receipt,
  type ReceiptCompany,
  type ReceiptCompanyPayload,
  type ReceiptPayloadRead,
  type ReceiptItem,
  type Voucher,
  fromReceiptCompanyPayload,
  fromReceiptPayload,
  toReceiptItemPayload,
  toVoucherPayload,
  receiptItemIsValid,
  voucherIsValid,
  fromReceiptSummaryPayload,
  type ReceiptSummary,
  type ReceiptSummaryPayload,
  type ReportMonth,
  type CancellationItem,
  type CancellationOf,
  type CancellationReason,
  isCancellationReason,
  isReturnDisposition,
  RETURN_DISPOSITIONS,
  type ReturnDisposition,
  type ReceiptPaymentInput,
  type RegistrationInfo,
  type ReceiptEmailVia,
  RECEIPT_EMAIL_VIAS,
  readRegistrationInfo,
} from '../models/index.js';
import { parseServerTimeStamp, toViennaWallClock } from '../vienna-time.js';
import { euroToCents } from '../money.js';
import { KasseneckApiError, KasseneckValidationError, isKasseneckApiError, signiertGelesen } from './errors.js';
import type { InternerTransport } from './aufrufe.js';
import { buildReceiptLayout, type ReceiptLayout } from '../receipt/layout.js';
import type { PosPaperSize } from '../printing/escpos.js';
import type { SheetLogoSize } from '../receipt/blatt.js';

/**
 * Beleg-Endpunkte — Zwilling der Beleg-Aufrufe in
 * kasseneck_api/lib/kasseneck_api.dart.
 *
 * **Draht `/v3`, englisch.** Verkauf und Nullbeleg laufen ueber den
 * Endpunkt `createReceipt`; `sellReceipt` und `zeroReceipt` legen den
 * Belegtyp fest und reichen den Rest durch. Bezahlt wird immer ueber
 * `payments[]` (Pflicht unter `/v3`); `paymentMethod` und die Kartenfelder am
 * Beleg gibt es nicht mehr, die Kartenangaben stehen in der einzelnen
 * Zahlung. Den Zahlbetrag rechnet `receiptDueCents` vorher aus.
 * **[cancelReceipt] geht an den eigenen Endpunkt `cancelReceipt`**: der
 * Server negiert die Positionen des Originals, prueft Restmengen und Rechte
 * und verkettet beide Belege. Einen Storno ueber `createReceipt` gibt es
 * nicht mehr.
 *
 * **Kein Wiederholen fehlgeschlagener Aufrufe** (siehe transport.ts): ein
 * Beleg ist nicht folgenlos wiederholbar. Bei `outcome: 'unknown'`
 * (`receipt_outcome_unknown`, `cancellation_outcome_unknown`, Netz- oder
 * Serverfehler nach dem Senden) erst nachlesen, und bei
 * `payments_sum_mismatch` nennt [paymentsExpectedCents] den Betrag des
 * Servers; auch dann wiederholt das Paket nie selbst.
 *
 * **Kassen-Benutzer-Weg (`registerUserAuth`, Browser-Kasse):** Von den
 * Endpunkten dieser Datei setzen [listMyReceipts], [getReceipt],
 * [createReceipt] und [generateFullReceiptId] ein `allowRegisterUser` — der
 * Browser-Kasse steht hier also alles offen ausser [getFirstReceiptDate];
 * siehe den Hinweis dort. Dieses Paket bildet das **nicht** nach — wer darf,
 * entscheidet allein das Backend. Der Hinweis steht hier, damit ein Leser
 * nicht raten muss.
 */

/** Gemeinsame Zusatzangaben aller Belegarten (Nutzlast von `createReceipt`). */
export interface ReceiptCommonOptions {
  /** Kundendaten fuer den Belegkopf; gehen als `\n`-verbundene Zeichenkette raus. */
  customerDetails?: string[];
  /** Rechtshinweise (z. B. Reverse Charge); gehen als `\n`-verbundene Zeichenkette raus. */
  legalMessage?: string[];
  /** Freier Bezeichner des Aufrufers (Projekt, Auftrag, Schicht). */
  customProjectId?: string;
  /**
   * Trinkgeld in Cent — als Zahl (an den angemeldeten Kassen-Benutzer, Zahlart
   * des Belegs) oder als [TipOptions]. Das Backend bucht daraus signierte
   * Positionen `kind:'tip'` (Mitarbeiter 0 % als Durchlaeufer, Inhaber
   * anteilig je Steuersatz). Nur auf `standard` und `training`.
   */
  tip?: number | TipOptions;
}

/** Trinkgeld mit eigener Zahlart und/oder Empfaengern (Kassen-Benutzer-IDs, Summe = cents). */
export interface TipOptions {
  cents: number;
  /** Zahlart des Trinkgelds; bei mehreren Zahlarten Pflicht (`tip_payment_method_required`). */
  paymentMethod?: KeckPaymentMethod | KeckPaymentMethodKey;
  /** Empfaenger; ohne Angabe der angemeldete Kassen-Benutzer. Summe der cents = cents. */
  recipients?: TipRecipientShare[];
  /**
   * Hat der Empfaenger das Geld schon? `true` = ja (Bargeld mitgenommen,
   * Kartentrinkgeld sofort aus der Lade ausgezahlt), `false` = der Betrieb
   * behaelt es und schuldet es.
   *
   * Entscheidend ist NICHT die Zahlart, sondern der Besitz -- § 2j Abs 2 AVRAG
   * kennt beide Faelle. Ohne Angabe gilt die Voreinstellung des Betriebs (bar:
   * schon erhalten, bargeldlos: einbehalten); diese Angabe braucht es nur fuer
   * die Ausnahme.
   *
   * NUR mit dem Recht `tipAssign` bei persoenlicher Anmeldung: das Merkmal
   * entscheidet, ob der Betrieb Geld schuldet, und gewoehnliches Personal soll
   * das nicht am Geraet umstellen koennen. Ueber einen Geraete-API-Schluessel
   * (ohne angemeldeten Kassen-Benutzer) gilt die Einschraenkung nicht.
   */
  receivedImmediately?: boolean;
}

export interface TipRecipientShare {
  registerUserId: string;
  cents: number;
}

/** Belegtyp und Inhalt, die vollstaendige Eingabe von [createReceipt]. */
export interface CreateReceiptOptions extends ReceiptCommonOptions {
  receiptType: ReceiptType | ReceiptTypeKey;
  /**
   * Zahlungen (siehe [ReceiptPaymentInput]); bei `standard` und `training`
   * Pflicht, auch leer, wenn der Zahlbetrag 0 ist. Null- und Startbeleg
   * nehmen keine (`payments_not_allowed`). Die Summe muss
   * [receiptDueCents] treffen.
   */
  payments?: ReceiptPaymentInput[];
  items?: ReceiptItem[];
  vouchers?: Voucher[];
}

/**
 * Verkauf: Positionen, Gutscheine, Trinkgeld und die Zahlungen. Die
 * Kartenangaben (`provider`, `providerPaymentId`, `providerData`) stehen in
 * der einzelnen Zahlung; die Summe der Zahlungen ist [receiptDueCents].
 */
export interface SellReceiptOptions extends ReceiptCommonOptions {
  payments: ReceiptPaymentInput[];
  items?: ReceiptItem[];
  vouchers?: Voucher[];
}

/**
 * Storno ueber den Endpunkt `cancelReceipt` (Backend: storno-endpoints.js).
 * Der Server negiert die Positionen, prueft Restmengen und Rechte, verkettet
 * Original und Storno-Beleg. Bezug entweder als Beleg-Objekt (`receipt`) oder
 * als Kasse + Beleg-ID.
 */
export type CancelReceiptOptions = {
  /** Grund aus dem Katalog — Pflicht, nur der Anzeigetext landet am Bon. */
  reason: CancellationReason;
  /** Teilstorno: Positionen (Index im Original) und Mengen. Fehlt = Vollstorno der Restmengen. */
  items?: CancellationItem[];
  /** Interne Anmerkung (≤ 200 Zeichen), wird gespeichert, nie gedruckt. */
  note?: string;
  /**
   * Wohin die Ware der stornierten Artikelzeilen geht (Lager-Kern Stufe 2):
   * Vorgabe fuer alle Positionen, je Position abweichend ueber
   * `items[].returnDisposition`. Fehlt beides, bucht der Server `restock`.
   * Zeilen ohne `articleId` bucht er nie. Ein falscher Wert geht nicht hinaus;
   * der Server meldete ihn als `invalid_return_disposition`.
   */
  returnDisposition?: ReturnDisposition;
  /**
   * Rueckzahlung je Zahlung (Betraege negativ, `refundOf` = `id` der
   * Originalzahlung). Ohne Angabe spiegelt der Server die Restbetraege jeder
   * Originalzahlung; ein Teilstorno eines Belegs mit mehreren Zahlungen
   * braucht sie (`cancellation_payments_required`).
   *
   * **Karten-Storno:** `provider`, `providerPaymentId` und `providerData`
   * beschreiben die ERSTATTUNG am Terminal, nie die Originalzahlung. Die
   * Kennung der Originalzahlung (fuer die Rueckbuchung am Terminal) steht in
   * `payments[].providerPaymentId` des Originals; die liefert nur der
   * Kassenweg (Kanal `app`, `registerUserAuth`).
   */
  payments?: ReceiptPaymentInput[];
} & ({ receipt: Receipt; cashregisterId?: string; originalReceiptId?: string } | { receipt?: undefined; cashregisterId: string; originalReceiptId: string });

/** Antwort von [cancelReceipt]: Storno-Beleg, Bezug, Restmengen des Originals danach. */
export interface CancelReceiptResult {
  receipt: Receipt;
  cancellationOf: CancellationOf;
  remaining: number[];
}

/**
 * Beleg **und** die Firmen-/Druckdaten derselben Antwort — das Ergebnis der
 * `…WithCompany`-Varianten. Das Backend liefert beides in einem Aufruf
 * (functions/index.js); wer den Beleg drucken oder anzeigen will, braucht
 * beides und soll dafuer keinen zweiten Aufruf machen muessen.
 */
export interface ReceiptWithCompany {
  receipt: Receipt;
  /** Kopf/Fuss, wie sie fuer DIESEN Beleg gelten (eingefrorene Version des Backends). */
  company: ReceiptCompany;
  /** Beleg einer Testumgebung (Aufdruck TESTKASSE). */
  testCashregister: boolean;
  /** Produktionskonto mit Test-Signatureinheit (Aufdruck TESTSIGNATUR). */
  testSignature: boolean;
  /** Kennung der Kopf-Version; null bei Altbeleg ohne Zuordnung. */
  headerVersionId: string | null;
  /**
   * Vom Backend gebautes Zeilenmodell (`data.layout`, Regelwerk des Belegs,
   * 80 mm); null, wenn nicht mitgeliefert. Es geht unveraendert an
   * `escPosLayoutBytes`, `eposPrintXml`, `receiptSheet` und die React-Ansichten.
   * Drucken und anzeigen ueber [receiptLayoutFromResult].
   */
  layout: ReceiptLayout | null;
  /**
   * Registrierdaten fuer den Block „Prüfangaben“ (Nullbelege, Regelwerk 2),
   * fuer Clients, die das Layout selbst bauen; null bei anderen Belegen.
   */
  registrationInfo: RegistrationInfo | null;
  /**
   * Groesse des Firmenlogos am Beleg (`logo_scale`). Bildschirm, Bon und PDF
   * setzen das Logo in genau dieser Stufe; fehlt der Wert, gilt `M`.
   */
  logoScale: SheetLogoSize;
}

/**
 * Das Zeilenmodell zum Drucken und Anzeigen eines Belegs aus einer Antwort.
 *
 * **Ein Server-Layout gewinnt immer.** Liefert der Server `data.layout`, gilt
 * genau dieses, in seiner Breite (80 mm): im oeffentlichen Kanal traegt nur
 * es den Kartenblock (der Beleg selbst kommt dort ohne Anbieterdaten), und
 * Bildschirm, Bon und PDF zeigen so denselben Beleg. Fehlt es, wird das
 * Layout hier gebaut, mit den Angaben derselben Antwort (`testCashregister`,
 * `testSignature`, `registrationInfo`) und in `fallbackPaperSize` (Vorgabe
 * `mm58` wie in 0.x). Die Druckbreite waehlt allein der Druckweg
 * (`paperSize` bei `escPosLayoutBytes`, `charsPerLine` bei ePOS und Blatt), nie
 * dieser Helfer.
 */
export function receiptLayoutFromResult(result: ReceiptWithCompany, options: { fallbackPaperSize?: PosPaperSize } = {}): ReceiptLayout {
  for (const name of Object.keys(options)) {
    if (name !== 'fallbackPaperSize') {
      throw new KasseneckValidationError('receiptLayoutFromResult', `Unbekannte Option "${name}" (die Druckbreite waehlt der Druckweg)`, 'request');
    }
  }
  if (result.layout != null) return result.layout;
  return buildReceiptLayout(result.receipt, result.company, {
    paperSize: options.fallbackPaperSize ?? 'mm58',
    testCashregister: result.testCashregister,
    testSignature: result.testSignature,
    registrationInfo: result.registrationInfo,
  });
}

/**
 * Gemeinsame Umsetzung aller Belegarten (Zwilling von `_createReceipt`).
 * Bewusst **nicht** Teil der Paketoberflaeche: der Belegtyp gehoert nicht in
 * die Hand des Aufrufers, sondern zu einem der benannten Aufrufe darunter.
 */
export async function createReceipt(rufen: InternerTransport, options: CreateReceiptOptions): Promise<Receipt> {
  const daten = await rufen('createReceipt', createReceiptParams(options));
  return signiertGelesen('createReceipt', () => belegAusHuelle(daten, 'createReceipt'));
}

/** Wie [createReceipt], liest aus derselben Antwort zusaetzlich die Firmendaten. */
async function createReceiptWithCompany(
  rufen: InternerTransport,
  options: CreateReceiptOptions,
): Promise<ReceiptWithCompany> {
  const daten = await rufen('createReceipt', createReceiptParams(options));
  return signiertGelesen('createReceipt', () => belegMitFirmaAusHuelle(daten, 'createReceipt'));
}

/**
 * Baut die Nutzlast von `createReceipt` und prueft die Eingabe. Wirft, bevor
 * irgendetwas rausgeht — ein Beleg ist nicht folgenlos wiederholbar.
 */
function createReceiptParams(options: CreateReceiptOptions): Record<string, unknown> {
  const typ = belegtyp(options.receiptType);
  const { items, vouchers } = options;

  // Unter /v3 weist der Server diese Felder ab (payment_method_not_supported);
  // ein Aufrufer ohne Typen erfaehrt es hier, bevor etwas hinausgeht.
  const altfeld = ALTE_ZAHLFELDER.find((feld) => (options as unknown as Record<string, unknown>)[feld] != null);
  if (altfeld != null) {
    throw eingabefehler(`${altfeld} gibt es unter /v3 nicht mehr: Zahlungen und Kartenangaben gehen als payments hinaus.`);
  }
  if (typ.value === ReceiptType.cancellation.value) {
    throw eingabefehler('Ein Storno geht nur ueber cancelReceipt (Bezug, Grund, Restmengen).');
  }

  if (typ.needsItems) {
    // Ein reiner Gutscheinverkauf ist ein Umsatz ohne Positionen, deshalb
    // zaehlt er hier wie eine Position (wie im Flutter-Vorbild).
    const hatVerkaufsgutschein = vouchers?.some((v) => v.action === VoucherAction.sell) ?? false;
    if ((items == null || items.length === 0) && !hatVerkaufsgutschein) {
      throw eingabefehler(`Positionen sind Pflicht bei receiptType "${typ.value}" und duerfen nicht leer sein.`);
    }
    if (items?.some((item) => !receiptItemIsValid(item)) ?? false) {
      throw eingabefehler('Ungueltige Position uebergeben.');
    }
  }

  const params: Record<string, unknown> = { receiptType: typ.value };

  if (vouchers != null && vouchers.length > 0) {
    if (!typ.allowsVouchers) {
      throw eingabefehler(`Gutscheine sind nicht erlaubt bei receiptType "${typ.value}".`);
    }
    if (vouchers.some((voucher) => !voucherIsValid(voucher))) {
      throw eingabefehler('Ungueltiger Gutschein uebergeben.');
    }
    const kombinationsfehler = checkVoucherCombinationError(vouchers, items ?? []);
    if (kombinationsfehler != null) {
      throw eingabefehler(kombinationsfehler);
    }
    params['vouchers'] = alsNutzlast(vouchers, toVoucherPayload);
  }

  if (items != null && items.length > 0) {
    params['items'] = alsNutzlast(items, toReceiptItemPayload);
  }

  const umsatz = typ.value === ReceiptType.standard.value || typ.value === ReceiptType.training.value;
  if (umsatz) {
    // Pflicht unter /v3 (payments_required); eine leere Liste ist erlaubt,
    // wenn nichts zu zahlen ist (Rabatt deckt alles).
    if (options.payments == null) {
      throw eingabefehler('payments fehlt: unter /v3 ist die Zahlungsliste Pflicht (Summe = receiptDueCents).');
    }
    params['payments'] = gepruefteZahlungen(options.payments, false, 'createReceipt');
  } else if (options.payments != null) {
    throw eingabefehler(`payments sind bei receiptType "${typ.value}" nicht erlaubt.`);
  }

  if (options.tip != null) {
    if (!umsatz) {
      throw eingabefehler(`Trinkgeld ist nur bei receiptType standard oder training moeglich, nicht bei "${typ.value}".`);
    }
    params['tip'] = gepruefterTip(options.tip);
  }

  if (options.customProjectId != null) {
    params['customProjectId'] = options.customProjectId;
  }
  if (options.customerDetails != null) {
    params['customerDetails'] = options.customerDetails.join('\n');
  }
  if (options.legalMessage != null) {
    params['legalMessage'] = options.legalMessage.join('\n');
  }

  return params;
}

/** Felder des alten Einzel-Zahlungswegs; unter /v3 abgewiesen. */
const ALTE_ZAHLFELDER = ['paymentMethod', 'paymentMethodFromServer', 'creditCardProvider', 'cardPaymentId', 'cardPaymentData'] as const;

/** Normalbeleg (Verkauf) nach RKSV. */
export function sellReceipt(transport: InternerTransport, options: SellReceiptOptions): Promise<Receipt> {
  return createReceipt(transport, { ...options, receiptType: ReceiptType.standard });
}

/**
 * Normalbeleg wie [sellReceipt], liefert zusaetzlich die Firmen-/Druckdaten
 * aus derselben Antwort — alles, was ein Belegdruck braucht, in einem Aufruf.
 */
export function sellReceiptWithCompany(
  transport: InternerTransport,
  options: SellReceiptOptions,
): Promise<ReceiptWithCompany> {
  return createReceiptWithCompany(transport, { ...options, receiptType: ReceiptType.standard });
}

const NOTE_MAX = 200;

/** Prueft eine Rueckgabe-Wahl (Vorgabe oder Position); `pfad` nennt das Feld in der Meldung. */
function pruefeRueckgabeWahl(wert: unknown, pfad: string): void {
  if (wert !== undefined && !isReturnDisposition(wert)) {
    throw new KasseneckValidationError('cancelReceipt', `${pfad}: erlaubt sind ${RETURN_DISPOSITIONS.join(', ')}`, 'request');
  }
}

/**
 * Storno-Beleg zu einem bestehenden Beleg — voll oder in Teilen. Prueft die
 * Eingabe, bevor etwas hinausgeht; der Server haelt die Restmengen und die
 * Reichweite des Rechts (eigene/alle) und antwortet mit dem fertigen,
 * signierten Storno-Beleg. Gutscheine des Originals wandern nicht mit.
 */
export async function cancelReceipt(transport: InternerTransport, options: CancelReceiptOptions): Promise<CancelReceiptResult> {
  const cashregisterId = options.receipt?.cashregisterId ?? options.cashregisterId;
  const originalReceiptId = options.receipt?.receiptId ?? options.originalReceiptId;
  if (typeof cashregisterId !== 'string' || cashregisterId.trim() === '') {
    throw new KasseneckValidationError('cancelReceipt', 'cashregisterId fehlt', 'request');
  }
  if (typeof originalReceiptId !== 'string' || originalReceiptId.trim() === '') {
    throw new KasseneckValidationError('cancelReceipt', 'originalReceiptId fehlt', 'request');
  }
  if (!isCancellationReason(options.reason)) {
    throw new KasseneckValidationError('cancelReceipt', 'Storno-Grund fehlt oder ist unbekannt', 'request');
  }
  pruefeRueckgabeWahl(options.returnDisposition, 'returnDisposition');
  if (options.items !== undefined) {
    if (!Array.isArray(options.items) || options.items.length === 0) {
      throw new KasseneckValidationError('cancelReceipt', 'items muss eine nicht leere Liste sein', 'request');
    }
    for (const [i, pos] of options.items.entries()) {
      if (!Number.isInteger(pos.index) || pos.index < 0 || !Number.isInteger(pos.quantity) || pos.quantity < 1) {
        throw new KasseneckValidationError('cancelReceipt', 'Storno-Menge muss eine ganze Zahl >= 1 sein', 'request');
      }
      pruefeRueckgabeWahl(pos.returnDisposition, `items[${i}].returnDisposition`);
    }
  }
  if (options.note !== undefined && options.note.length > NOTE_MAX) {
    throw new KasseneckValidationError('cancelReceipt', `Anmerkung ist zu lang (hoechstens ${NOTE_MAX} Zeichen)`, 'request');
  }
  const altfeld = ALTE_ZAHLFELDER.find((feld) => (options as unknown as Record<string, unknown>)[feld] != null);
  if (altfeld != null) {
    throw new KasseneckValidationError('cancelReceipt', `${altfeld} gibt es unter /v3 nicht mehr: Rueckzahlungen gehen als payments hinaus.`, 'request');
  }
  // `payments: null` gilt wie im Backend als nicht angegeben.
  const zahlungen = options.payments != null ? gepruefteZahlungen(options.payments, true, 'cancelReceipt') : undefined;
  if (zahlungen !== undefined) pruefeKartenRueckbuchung(zahlungen, options.receipt);
  const params: Record<string, unknown> = { cashregisterId, originalReceiptId, reason: options.reason };
  if (options.items !== undefined) {
    params.items = options.items.map((p) => ({
      index: p.index,
      quantity: p.quantity,
      ...(p.returnDisposition !== undefined ? { returnDisposition: p.returnDisposition } : {}),
    }));
  }
  if (options.returnDisposition !== undefined) params.returnDisposition = options.returnDisposition;
  if (options.note !== undefined && options.note !== '') params.note = options.note;
  if (zahlungen !== undefined) params.payments = zahlungen;

  const daten = await transport('cancelReceipt', params);
  return signiertGelesen('cancelReceipt', () => stornoAusHuelle(daten));
}

/** Liest die Storno-Antwort `{ receipt, cancellationOf, remaining }`. */
function stornoAusHuelle(daten: unknown): CancelReceiptResult {
  const receipt = belegAusHuelle(daten, 'cancelReceipt');
  const huelle = daten as { cancellationOf?: unknown; remaining?: unknown };
  const bezug = huelle.cancellationOf as { receiptId?: unknown; fullReceiptId?: unknown; timeStamp?: unknown } | undefined;
  if (bezug == null || typeof bezug.receiptId !== 'string') {
    throw antwortfehler('cancelReceipt', 'Antwort enthaelt keinen Bezug (data.cancellationOf fehlt)');
  }
  if (!Array.isArray(huelle.remaining) || !huelle.remaining.every((n) => Number.isInteger(n))) {
    throw antwortfehler('cancelReceipt', 'Antwort enthaelt keine Restmengen (data.remaining fehlt)');
  }
  return {
    receipt,
    cancellationOf: {
      receiptId: bezug.receiptId,
      fullReceiptId: typeof bezug.fullReceiptId === 'string' ? bezug.fullReceiptId : null,
      ...(typeof bezug.timeStamp === 'string' && bezug.timeStamp !== '' ? { timeStamp: bezug.timeStamp } : {}),
    },
    remaining: huelle.remaining as number[],
  };
}

/** Nullbeleg (RKSV-Pruefbeleg) — ohne Positionen und ohne Zahlungsart. */
export function zeroReceipt(transport: InternerTransport): Promise<Receipt> {
  return createReceipt(transport, { receiptType: ReceiptType.zero });
}

/** Belegliste einer Kasse samt der Kennzahlen, die dieselbe Antwort mitliefert. */
export interface ReceiptList {
  /** Letzte Belege, neueste zuerst (Backend: nach `counter` absteigend). */
  receipts: ReceiptSummary[];
  stats: ReceiptListStats;
}

/**
 * Kennzahlen zur Kasse, die `listMyReceipts` neben der Liste liefert. Sie
 * kommen aus den Tages-Aggregaten des Backends, nicht aus den gelisteten
 * Belegen — die Reihe umfasst sieben Tage, die Liste nur die letzten `limit`
 * Belege.
 */
export interface ReceiptListStats {
  /** Heutiger Umsatz in Cent und Belegzahl (Wiener Kalendertag). */
  today: { revenueCents: number; count: number };
  /** Veraenderung gegenueber gestern in Prozent; `null`, wenn gestern 0 war. */
  trendPercent: number | null;
  /** Sieben Tage, aeltester zuerst; `date` als `YYYY-MM-DD` (Wiener Kalender). */
  days: Array<{ date: string; revenueCents: number }>;
}

export interface ListMyReceiptsOptions {
  /** Kasse, deren Belege gelistet werden (Parameter `cashregisterId`). */
  cashregisterId: string;
  /**
   * Anzahl Belege; ohne Angabe nimmt das Backend 50. Es begrenzt den Wert
   * selbst auf 1 bis 200 — ein groesserer Wunsch wird still gekappt.
   */
  limit?: number;
  /** Zeitfenster (Wiener Wanduhr, `YYYY-MM-DD` oder voller Zeitstempel); der Server deckelt auf 90 Tage. */
  from?: string;
  to?: string;
}

/**
 * Belege einer Kasse auflisten — die Grundlage jeder Belegliste in der
 * Browser-Kasse (Nachdruck, Storno, Tagesuebersicht).
 *
 * Die Eintraege sind **Zusammenfassungen**, keine vollstaendigen Belege (siehe
 * [ReceiptSummary]); fuer Nachdruck oder Storno gehoert der Beleg ueber
 * [getReceipt] bzw. [getReceiptWithCompany] einzeln geholt.
 *
 * **Anmeldeweg:** Der Endpunkt laeuft im Backend unter
 * `checkRequest(req, 'customer', …, {allowRegisterUser: true})`, der Bearer
 * muss also ein ID-Token des Anmeldediensts sein — mit `apiKeyAuth` ist er nicht
 * erreichbar. Ausserdem prueft das Backend die Kassenzuweisung hier im Rumpf
 * (der Endpunkt laeuft mit `checkCashRegister: false`), ein Kassen-Benutzer
 * bekommt also nur die ihm zugewiesenen Kassen.
 */
export async function listMyReceipts(transport: InternerTransport, options: ListMyReceiptsOptions): Promise<ReceiptList> {
  if (typeof options.cashregisterId !== 'string' || options.cashregisterId.trim() === '') {
    throw new KasseneckValidationError('listMyReceipts', 'cashregisterId fehlt', 'request');
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new KasseneckValidationError(
      'listMyReceipts',
      `limit muss eine ganze Zahl ab 1 sein, war "${options.limit}"`,
      'request',
    );
  }
  for (const feld of ['from', 'to'] as const) {
    const wert = options[feld];
    if (wert !== undefined && !/^\d{4}-\d{2}-\d{2}/.test(wert)) {
      throw new KasseneckValidationError('listMyReceipts', `${feld} muss mit YYYY-MM-DD beginnen, war "${wert}"`, 'request');
    }
  }
  const daten = await transport<{ receipts?: unknown; stats?: unknown }>('listMyReceipts', {
    cashregisterId: options.cashregisterId,
    limit: options.limit,
    ...(options.from !== undefined ? { from: options.from } : {}),
    ...(options.to !== undefined ? { to: options.to } : {}),
  });
  const liste = daten?.receipts;
  if (!Array.isArray(liste)) {
    throw antwortfehler('listMyReceipts', 'Antwort enthaelt keine Belegliste (data.receipts fehlt)');
  }
  return {
    receipts: liste.map((eintrag) =>
      fromReceiptSummaryPayload((typeof eintrag === 'object' && eintrag !== null ? eintrag : {}) as ReceiptSummaryPayload),
    ),
    stats: kennzahlen(daten?.stats),
  };
}

/**
 * Kennzahlen aus der Antwort. Sie duerfen Luecken haben, ohne die Belegliste
 * unbrauchbar zu machen — eine fehlende Wochenreihe ist kein Grund, dem
 * Kassier die Belege vorzuenthalten.
 */
function kennzahlen(roh: unknown): ReceiptListStats {
  const quelle = (typeof roh === 'object' && roh !== null ? roh : {}) as {
    today?: { revenue?: unknown; count?: unknown } | null;
    trendPct?: unknown;
    days?: unknown;
  };
  const tage = Array.isArray(quelle.days) ? quelle.days : [];
  return {
    today: {
      revenueCents: euroToCents(quelle.today?.revenue),
      count: typeof quelle.today?.count === 'number' ? quelle.today.count : 0,
    },
    trendPercent: typeof quelle.trendPct === 'number' ? quelle.trendPct : null,
    days: tage.map((tag: unknown) => {
      const eintrag = (typeof tag === 'object' && tag !== null ? tag : {}) as { date?: unknown; revenue?: unknown };
      return {
        date: typeof eintrag.date === 'string' ? eintrag.date : '',
        revenueCents: euroToCents(eintrag.revenue),
      };
    }),
  };
}

/** Einzelnen Beleg der angemeldeten Kasse holen. */
export async function getReceipt(transport: InternerTransport, receiptId: string): Promise<Receipt> {
  return belegAusHuelle(await transport('getReceipt', { receiptId }), 'getReceipt');
}

/**
 * Wie [getReceipt], liefert zusaetzlich die Firmen-/Druckdaten aus derselben
 * Antwort (Firma, Anschrift, Steuernummer, UID, Fusszeilen, Logo-Adresse,
 * Kleinunternehmer-Kennzeichen) — die Angaben, die ein Beleg im Kopf und Fuss
 * traegt (siehe models/receipt-company.ts).
 */
export async function getReceiptWithCompany(
  transport: InternerTransport,
  receiptId: string,
): Promise<ReceiptWithCompany> {
  return belegMitFirmaAusHuelle(await transport('getReceipt', { receiptId }), 'getReceipt');
}

/**
 * Verschluesselte Volltext-Belegnummer erzeugen — der Bezeichner, unter dem der
 * Beleg oeffentlich abrufbar ist (Beleg-Download, Pruefportal).
 */
export async function generateFullReceiptId(transport: InternerTransport, receiptId: string): Promise<string> {
  const daten = await transport<{ fullReceiptId?: unknown }>('generateFullReceiptId', { receiptId });
  const id = daten?.fullReceiptId;
  if (typeof id !== 'string') {
    throw antwortfehler('generateFullReceiptId', 'Antwort enthaelt keine fullReceiptId');
  }
  return id;
}

/**
 * Berichtsmonat des allerersten Belegs dieser Kasse — die untere Grenze aller
 * Monatsberichte.
 *
 * **Nicht fuer den Kassen-Benutzer-Weg (`registerUserAuth`):** dieser Endpunkt
 * fuehrt kein `allowRegisterUser`, das Backend weist die Browser-Kasse hier ab
 * (siehe Modulkommentar oben). Mit `apiKeyAuth` ist er offen.
 */
export async function getFirstReceiptDate(transport: InternerTransport): Promise<ReportMonth> {
  const roh = await transport<unknown>('getFirstReceiptDate');
  if (typeof roh !== 'string') {
    throw antwortfehler('getFirstReceiptDate', 'Antwort enthaelt keinen Zeitstempel');
  }
  // Ueber die Wiener Wanduhrzeit statt ueber getMonth(): der erste Beleg eines
  // Monats liegt gern kurz nach Mitternacht, und der eingebaute Monat waere der
  // des ausfuehrenden Rechners (siehe vienna-time.ts).
  //
  // Die Deutung wirft ein gewoehnliches Error, wenn der Zeitstempel unlesbar
  // ist. Das ist hier ein Antwortproblem und gehoert in die Fehler-Union, die
  // dieser Endpunkt zusagt — sonst faellt der Aufrufer aus allen Waechtern.
  try {
    const wanduhr = toViennaWallClock(parseServerTimeStamp(roh));
    return { month: wanduhr.month, year: wanduhr.year };
  } catch {
    // Der Zeitstempel selbst wandert NICHT in die Meldung: er kommt aus einer
    // fremden Antwort, und was dort steht, ist nicht unsere Zusage.
    throw antwortfehler('getFirstReceiptDate', 'Antwort enthaelt keinen lesbaren Zeitstempel');
  }
}


/**
 * Beleg per E-Mail an den Endkunden — die Eingabe von [sendReceiptEmail].
 *
 * `cashregisterId` steht hier bewusst **nicht**: der Geraeteweg bindet die
 * Kasse ueber die Kopfzeile `cashregister-token`, der Kassen-Benutzer-Weg
 * ueber den Parameter, den `registerUserAuth` ohnehin schon setzt. Eine
 * dritte Stelle waere nur eine Gelegenheit, eine andere Kasse zu behaupten,
 * als die, an der man angemeldet ist — und das Backend nimmt den Belegpfad aus
 * der angemeldeten Kasse, nicht aus der Nutzlast.
 */
export interface SendReceiptEmailOptions {
  /** Verschluesselte Volltext-Belegnummer (siehe [generateFullReceiptId]). */
  fullReceiptId: string;
  /** Empfaengeradresse, wie der Gast sie am Tresen nennt. */
  to: string;
  /**
   * Sprache der Mail. Heute wertet das Backend genau `'de'` aus; der Parameter
   * steht im Vertrag, damit eine zweite Sprache spaeter kein neuer Vertrag ist.
   * Ohne Angabe geht das Feld gar nicht erst hinaus.
   */
  language?: string;
}

/** Was der Versand bestaetigt (Backend: beleg-mail-endpoints.js). */
export interface SendReceiptEmailResult {
  /**
   * Adresse in der Form, in der das Backend sie protokolliert hat (getrimmt,
   * klein). Nennt die Antwort keine, die gesendete (getrimmte) Adresse.
   */
  to: string;
  /**
   * Zeitpunkt des Versands, ISO mit Wiener Zonenoffset
   * (`2026-09-11T14:05:00+02:00`). `null`, wenn die Antwort keinen nennt: der
   * Versand ist trotzdem bestaetigt.
   */
  at: string | null;
  /**
   * Versandweg: `own` (Postfach des Betriebs), `platform` oder
   * `platform_fallback` ([RECEIPT_EMAIL_VIAS]). `null`, wenn die Antwort ihn
   * nicht oder mit einem unbekannten Wert nennt: das ist eine Auskunft ueber
   * den Weg, keine ueber den Erfolg, und darf den bestaetigten Versand nicht
   * zu einem Fehler machen.
   */
  via: ReceiptEmailVia | null;
}

/** Felder von [SendReceiptEmailOptions]; jedes andere wirft vor dem Senden. */
const MAIL_FELDER: readonly string[] = ['fullReceiptId', 'to', 'language'];

/**
 * Schickt einen bereits ausgestellten Beleg als **Link auf die oeffentliche
 * Belegseite** an eine Adresse (Endpunkt `sendReceiptEmail`, Backend
 * beleg-mail-endpoints.js). Kein PDF im Anhang: die Belegseite fuehrt dasselbe
 * Zeilenmodell wie Bildschirm und Bon und liefert dort auf Wunsch ein PDF.
 *
 * **Der Beleg bleibt unberuehrt** (BAO §131/RKSV): das Versandprotokoll fuehrt
 * das Backend in einer Unter-Sammlung neben dem Beleg.
 *
 * **Am Code entscheiden, nie am Text:** fachliche Fehler kommen als
 * [KasseneckApiError] mit `code` aus [RECEIPT_EMAIL_ERROR_CODES] heraus:
 * `invalid_address`, `receipt_not_found` (auch fuer einen Beleg einer
 * fremden Kasse: das Backend gibt darueber bewusst keine Auskunft),
 * `too_many_requests` (5 Mails je Beleg in 24 Stunden, 30 je Kasse und
 * Stunde) und `send_failed`. Dieses Paket reicht sie unveraendert durch und
 * legt keine eigenen Codes an.
 *
 * **Kein Wiederholen ohne Zutun des Bedieners:** ein zweiter Versuch schickt
 * eine zweite Mail und zaehlt auf die Schleuse.
 */
export async function sendReceiptEmail(
  transport: InternerTransport,
  options: SendReceiptEmailOptions,
): Promise<SendReceiptEmailResult> {
  // Ein unbekanntes Feld (etwa das alte `sprache`) ginge sonst still verloren,
  // und die Mail kaeme in der falschen Sprache.
  const fremd = Object.keys(options ?? {}).find((k) => !MAIL_FELDER.includes(k));
  if (fremd != null) {
    throw new KasseneckValidationError('sendReceiptEmail', `unbekanntes Feld "${fremd}"`, 'request');
  }
  // Getrimmt, weil beides von Hand oder per Scanner ins Feld kommt und ein
  // angehaengtes Leerzeichen sonst als ungueltige Adresse zurueckkaeme --
  // nach einem Aufruf, der schon eine Zeile im Protokoll gekostet hat.
  const fullReceiptId = typeof options.fullReceiptId === 'string' ? options.fullReceiptId.trim() : '';
  const to = typeof options.to === 'string' ? options.to.trim() : '';
  if (fullReceiptId === '') {
    throw new KasseneckValidationError('sendReceiptEmail', 'fullReceiptId fehlt', 'request');
  }
  if (to === '') {
    throw new KasseneckValidationError('sendReceiptEmail', 'to fehlt (Empfaengeradresse)', 'request');
  }
  // Die Adresse selbst wird hier NICHT geprueft: das Backend prueft sie mit
  // kreiseck_validator und antwortet mit `invalid_address`. Eine zweite,
  // eigene Regel im Paket koennte strenger sein als die des Backends und eine
  // gueltige Adresse abweisen, ohne dass jemand die Abweichung bemerkt.
  const params: Record<string, unknown> = { fullReceiptId, to };
  if (options.language !== undefined && options.language !== '') params.language = options.language;

  const daten = await transport<{ to?: unknown; at?: unknown; via?: unknown }>('sendReceiptEmail', params);
  // Nachsichtig gelesen (wie der Dart-Zwilling): eine Erfolgsantwort heisst,
  // die Mail ist schon verschickt. Ein Fehler wegen eines fehlenden
  // Antwortfelds luede zum zweiten Versand ein; also zurueck, was da ist.
  const gemeldet = daten?.to;
  const zeit = daten?.at;
  const via = (RECEIPT_EMAIL_VIAS as readonly unknown[]).includes(daten?.via) ? (daten!.via as ReceiptEmailVia) : null;
  return {
    to: typeof gemeldet === 'string' && gemeldet.trim() !== '' ? gemeldet : to,
    at: typeof zeit === 'string' && zeit !== '' ? zeit : null,
    via,
  };
}

/**
 * Prueft die Gutschein-Kombination eines Belegs und liefert den ersten
 * Regelverstoss als Text (oder `null`) — Zwilling von
 * `checkVoucherCombinationError`. Bewusst als Rueckgabewert statt als Fehler:
 * eine Kassenoberflaeche will das pruefen, **bevor** sie den Beleg abschickt.
 */
export function checkVoucherCombinationError(vouchers: Voucher[], items: ReceiptItem[]): string | null {
  let einloesenWert = 0;
  let verkaufenWert = 0;
  let einloesenPromo = 0;
  let verkaufenPromo = 0;

  for (const voucher of vouchers) {
    if (voucher.type === VoucherType.value && voucher.action === VoucherAction.redeem) {
      einloesenWert++;
    } else if (voucher.type === VoucherType.value && voucher.action === VoucherAction.sell) {
      verkaufenWert++;
    } else if (voucher.type === VoucherType.promo && voucher.action === VoucherAction.redeem) {
      einloesenPromo++;
    } else if (voucher.type === VoucherType.promo && voucher.action === VoucherAction.sell) {
      verkaufenPromo++;
    }
  }

  const einloesenGesamt = einloesenWert + einloesenPromo;
  const verkaufenGesamt = verkaufenWert + verkaufenPromo;

  if (verkaufenPromo > 0) {
    return 'Ungueltige Daten: Gutscheine mit type promo duerfen nicht verkauft werden';
  }
  if (einloesenPromo > 1) {
    return 'Ungueltige Daten: Es darf nur ein Gutschein mit type promo eingeloest werden';
  }
  if (einloesenPromo > 0 && einloesenGesamt > 1) {
    return 'Ungueltige Daten: Ein Gutschein mit type promo darf nicht mit anderen Gutscheinen kombiniert werden';
  }
  if (einloesenPromo > 0 && verkaufenGesamt > 0) {
    return 'Ungueltige Daten: Mit einem Gutschein mit type promo duerfen nicht andere Gutscheine verkauft werden';
  }
  if (einloesenGesamt > 0 && items.length === 0) {
    return 'Ungueltige Daten: Gutscheine mit action redeem benoetigen mindestens ein item';
  }
  return null;
}

/**
 * Belegtyp aufloesen. Anders als bei der Zahlungsart bleibt es hier streng:
 * den Belegtyp setzt kein Aufrufer aus Serverdaten, er kommt aus einem der
 * benannten Aufrufe — ein unbekannter Wert waere ein Programmierfehler.
 */
function belegtyp(wert: ReceiptType | ReceiptTypeKey | string): ReceiptType {
  if (typeof wert === 'object') {
    return wert;
  }
  if (!Object.prototype.hasOwnProperty.call(ReceiptType, wert)) {
    throw eingabefehler(`Belegtyp: unbekannter Schluessel "${wert}"`);
  }
  return ReceiptType[wert as ReceiptTypeKey];
}

/**
 * Wandelt Positionen/Gutscheine in ihre Nutzlast und faengt dabei die strengen
 * Schreibpfad-Pruefungen der Modelle ab (unbekannter Steuersatz, unbekannte
 * Gutschein-Aktion). Die Modelle werfen dort ein nacktes `Error`; hier soll
 * nur die Fehler-Union des Pakets herauskommen, damit ein Verbraucher, der
 * nach den Waechtern verzweigt, nicht im "unbekannt"-Zweig landet.
 */
function alsNutzlast<T, P>(werte: T[], wandeln: (wert: T) => P): P[] {
  try {
    return werte.map(wandeln);
  } catch (ursache) {
    // Die Meldungen der Modelle sind vom Paket formuliert und geheimnisfrei
    // (sie nennen den unbekannten Steuersatz bzw. Schluessel, sonst nichts).
    throw eingabefehler(ursache instanceof Error ? ursache.message : 'Ungueltige Nutzlast uebergeben.');
  }
}

/** Positive ganze Cent? */
function istCentBetrag(wert: unknown): wert is number {
  return typeof wert === 'number' && Number.isInteger(wert) && wert > 0;
}

/**
 * Trinkgeld pruefen und in die Nutzlast-Form bringen (Zahl bleibt Zahl; das
 * Objekt geht mit geprueftem Zahlart-Wert und Empfaengern hinaus). Dieselben
 * Regeln wie das Backend (tip-core.normalizeTip) — nur frueher.
 */
function gepruefterTip(tip: number | TipOptions): number | Record<string, unknown> {
  if (typeof tip === 'number') {
    if (!istCentBetrag(tip)) throw eingabefehler('Trinkgeld: Betrag muss eine ganze Zahl in Cent > 0 sein.');
    return tip;
  }
  if (tip == null || typeof tip !== 'object' || !istCentBetrag(tip.cents)) {
    throw eingabefehler('Trinkgeld: Betrag muss eine ganze Zahl in Cent > 0 sein.');
  }
  // Ein unbekannter Schluessel (etwa das alte `sofortErhalten`) weist der
  // Server unter /v3 ab; hier faellt er vor dem Senden.
  const fremd = Object.keys(tip).find((k) => !TIP_FELDER.includes(k));
  if (fremd != null) throw eingabefehler(`Trinkgeld: unbekanntes Feld "${fremd}".`);
  const nutzlast: Record<string, unknown> = { cents: tip.cents };
  if (tip.paymentMethod != null) nutzlast['paymentMethod'] = gepruefteZahlungsart(tip.paymentMethod);
  // Nur mitschicken, wenn gesetzt: fehlt das Feld, entscheidet die
  // Voreinstellung des Betriebs. Ein `false` waere dort eine Aussage, kein
  // Weglassen. Der Wortlaut des Fehlers ist der des Backends
  // (tip-core.normalizeTip) -- wer ihn hier sieht, sieht denselben Satz.
  if (tip.receivedImmediately != null) {
    if (typeof tip.receivedImmediately !== 'boolean') {
      throw eingabefehler('Trinkgeld: receivedImmediately muss true oder false sein.');
    }
    nutzlast['receivedImmediately'] = tip.receivedImmediately;
  }
  if (tip.recipients != null) {
    if (!Array.isArray(tip.recipients) || tip.recipients.length === 0) {
      throw eingabefehler('Trinkgeld: recipients darf nicht leer sein.');
    }
    let summe = 0;
    const gesehen = new Set<string>();
    for (const r of tip.recipients) {
      if (r == null || typeof r.registerUserId !== 'string' || r.registerUserId === '') {
        throw eingabefehler('Trinkgeld: recipients[].registerUserId fehlt.');
      }
      if (!istCentBetrag(r.cents)) throw eingabefehler('Trinkgeld: recipients[].cents muss eine ganze Zahl > 0 sein.');
      if (gesehen.has(r.registerUserId)) throw eingabefehler(`Trinkgeld: Kassen-Benutzer ${r.registerUserId} doppelt.`);
      gesehen.add(r.registerUserId);
      summe += r.cents;
    }
    if (summe !== tip.cents) {
      throw eingabefehler(`Trinkgeld: Summe der Empfaenger (${summe}) entspricht nicht dem Betrag (${tip.cents}).`);
    }
    nutzlast['recipients'] = tip.recipients.map((r) => ({ registerUserId: r.registerUserId, cents: r.cents }));
  }
  return nutzlast;
}

const TIP_FELDER: readonly string[] = ['cents', 'paymentMethod', 'recipients', 'receivedImmediately'];

/**
 * Zahlungsart des Aufrufers pruefen — unbekannt wirft, bevor etwas rausgeht.
 * `mixed` wirft ebenfalls: den Wert vergibt nur der Server (Beleg mit
 * mehreren Zahlarten); gesendet wird stattdessen die Zahlungsliste.
 */
function gepruefteZahlungsart(wert: KeckPaymentMethod | KeckPaymentMethodKey): string {
  let zahlungsart: string;
  if (typeof wert === 'object' && wert !== null) {
    zahlungsart = wert.value;
  } else {
    if (typeof wert !== 'string' || !Object.prototype.hasOwnProperty.call(KeckPaymentMethod, wert)) {
      throw eingabefehler(`Zahlungsart: unbekannter Schluessel "${String(wert)}"`);
    }
    zahlungsart = KeckPaymentMethod[wert as KeckPaymentMethodKey].value;
  }
  if (zahlungsart === KeckPaymentMethod.mixed.value) {
    throw eingabefehler('Zahlungsart "mixed" vergibt nur der Server – mehrere Zahlarten gehen als payments hinaus.');
  }
  return zahlungsart;
}

/** Hoechstzahl der Zahlungen je Beleg (Backend: MAX_ZAHLUNGEN). */
const MAX_ZAHLUNGEN = 20;

/**
 * Zahlungsliste pruefen und in Nutzlast-Form bringen — Formpruefung wie
 * `pruefeZahlungen` im Backend, soweit sie ohne Beleg und Zahlbetrag geht
 * (Summe, Anbieter-Pflicht und Trinkgeld prueft der Server). Wirft, bevor
 * etwas hinausgeht.
 */
function gepruefteZahlungen(roh: unknown, storno: boolean, functionName: string): Record<string, unknown>[] {
  const fehler = (grund: string) => new KasseneckValidationError(functionName, grund, 'request');
  if (!Array.isArray(roh)) throw fehler('payments muss eine Liste sein.');
  if (roh.length > MAX_ZAHLUNGEN) throw fehler(`payments: es sind hoechstens ${MAX_ZAHLUNGEN} Eintraege erlaubt.`);
  return roh.map((eintrag: unknown, i) => {
    const nr = i + 1;
    if (eintrag == null || typeof eintrag !== 'object' || Array.isArray(eintrag)) {
      throw fehler(`Zahlung ${nr}: kein gueltiges Objekt.`);
    }
    const z = eintrag as Record<string, unknown>;
    const method = gepruefteZahlungsart(z['method'] as KeckPaymentMethod | KeckPaymentMethodKey);
    const betrag = z['amountCents'];
    if (typeof betrag !== 'number' || !Number.isInteger(betrag) || (storno ? betrag >= 0 : betrag <= 0)) {
      throw fehler(`Zahlung ${nr}: amountCents muss eine ganze Zahl ${storno ? 'kleiner' : 'groesser'} als 0 sein.`);
    }
    const aus: Record<string, unknown> = { method, amountCents: betrag };
    if (z['tenderedCents'] !== undefined) {
      const gegeben = z['tenderedCents'];
      if (storno || typeof gegeben !== 'number' || !Number.isInteger(gegeben) || gegeben < betrag) {
        throw fehler(`Zahlung ${nr}: tenderedCents muss eine ganze Zahl von mindestens amountCents sein (nur am Verkauf).`);
      }
      aus['tenderedCents'] = gegeben;
    }
    if (z['tipCents'] !== undefined) {
      const trinkgeld = z['tipCents'];
      if (typeof trinkgeld !== 'number' || !Number.isInteger(trinkgeld) || trinkgeld <= 0) {
        throw fehler(`Zahlung ${nr}: tipCents muss eine ganze Zahl groesser als 0 sein.`);
      }
      aus['tipCents'] = trinkgeld;
    }
    if (z['provider'] !== undefined) {
      aus['provider'] = kartenanbieter(String(z['provider']));
    }
    if (z['providerPaymentId'] !== undefined) {
      if (typeof z['providerPaymentId'] !== 'string' || z['providerPaymentId'] === '') {
        throw fehler(`Zahlung ${nr}: providerPaymentId muss ein nicht-leerer Text sein.`);
      }
      aus['providerPaymentId'] = z['providerPaymentId'];
    }
    if (z['providerData'] !== undefined) {
      const daten = z['providerData'];
      if (daten === null || typeof daten !== 'object' || Array.isArray(daten)) {
        throw fehler(`Zahlung ${nr}: providerData muss ein Objekt sein.`);
      }
      aus['providerData'] = daten;
    }
    if (z['refundOf'] !== undefined) {
      if (!storno || typeof z['refundOf'] !== 'string' || z['refundOf'] === '') {
        throw fehler(`Zahlung ${nr}: refundOf gibt es nur am Storno, als id der Originalzahlung.`);
      }
      aus['refundOf'] = z['refundOf'];
    }
    return aus;
  });
}

/** Zahlarten mit Kartenterminal (Backend: KARTEN_ZAHLARTEN). */
const KARTEN_ZAHLARTEN = new Set(['creditCard', 'uberCard', 'boltCard']);

/**
 * Kennung der Originalzahlung fuer die Rueckbuchung am Terminal (Hobex
 * `originalTransactionId`, SumUp-Transaktion, ...): `providerPaymentId` der
 * Zahlung `paymentId` des Originals. Die liefert nur der Kassenweg (Kanal
 * `app`, `registerUserAuth`); am oeffentlichen Weg fehlt sie, und dann wirft
 * dieser Aufruf, statt `undefined` an ein Terminal weiterzugeben.
 */
export function cardRefundReference(receipt: Receipt, paymentId: string): string {
  const zahlung = receipt.payments?.find((z) => z.id === paymentId);
  if (zahlung == null) {
    throw new KasseneckValidationError('cancelReceipt', `Zahlung "${paymentId}" gibt es am Beleg nicht`, 'request');
  }
  const methode = typeof zahlung.method === 'object' ? zahlung.method.value : zahlung.method;
  if (!KARTEN_ZAHLARTEN.has(methode)) {
    throw new KasseneckValidationError('cancelReceipt', `Zahlung "${paymentId}" ist keine Kartenzahlung`, 'request');
  }
  if (typeof zahlung.providerPaymentId !== 'string' || zahlung.providerPaymentId === '') {
    throw new KasseneckValidationError(
      'cancelReceipt',
      `Kennung der Kartenzahlung "${paymentId}" fehlt: sie kommt nur ueber den Kassenweg (registerUserAuth, kasse.kasseneck.at/api/v3), nicht ueber den oeffentlichen Weg`,
      'request',
    );
  }
  return zahlung.providerPaymentId;
}

/**
 * Karten-Rueckbuchung am Storno, geprueft vor dem Senden:
 * - Sie nennt ihren Anbieter (`provider`; `custom` fuer eine Erstattung
 *   ohne angebundenes Terminal). Ganz ohne Anbieterfelder faellt sie.
 * - Ueber einen Anbieter (nicht `custom`) braucht sie einen Bezug: ihre eigene
 *   Terminal-Kennung (`providerPaymentId` der Erstattung) oder, liegt das
 *   Original vor, die Kennung der erstatteten Kartenzahlung dort. Erst wenn
 *   beides fehlt, wirft sie.
 */
function pruefeKartenRueckbuchung(zahlungen: Record<string, unknown>[], original: Receipt | undefined): void {
  zahlungen.forEach((z, i) => {
    if (!KARTEN_ZAHLARTEN.has(String(z['method']))) return;
    const anbieter = z['provider'];
    if (anbieter == null && z['providerPaymentId'] == null) {
      throw new KasseneckValidationError(
        'cancelReceipt',
        `Zahlung ${i + 1}: Karten-Rueckbuchung ohne Anbieter und ohne Kennung (provider angeben, custom fuer eine Erstattung ohne angebundenes Terminal)`,
        'request',
      );
    }
    if (anbieter === CreditCardProvider.custom || z['providerPaymentId'] != null) return;
    const orig = original != null && typeof z['refundOf'] === 'string' ? original.payments?.find((o) => o.id === z['refundOf']) : undefined;
    if (typeof orig?.providerPaymentId === 'string' && orig.providerPaymentId !== '') return;
    throw new KasseneckValidationError(
      'cancelReceipt',
      `Zahlung ${i + 1}: Karten-Rueckbuchung ohne Bezug: providerPaymentId der Erstattung am Terminal angeben (oder das Original ueber den Kassenweg lesen, dort traegt es die Kennung der Kartenzahlung)`,
      'request',
    );
  });
}

/** Kartenanbieter pruefen — er stammt vom Aufrufer, nicht aus Serverdaten. */
function kartenanbieter(wert: string): string {
  if (!Object.prototype.hasOwnProperty.call(CreditCardProvider, wert)) {
    throw eingabefehler(`Kartenanbieter: unbekannter Schluessel "${wert}"`);
  }
  return wert;
}

/** Fehler in der Eingabe des Aufrufers — es geht keine Anfrage raus. */
function eingabefehler(grund: string): KasseneckValidationError {
  return new KasseneckValidationError('createReceipt', grund, 'request');
}

/** Die Antwort meldete Erfolg, trug aber nicht, was der Aufruf zusagt. */
function antwortfehler(functionName: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(functionName, grund, 'response');
}

/**
 * `createReceipt` und `getReceipt` liefern den Beleg unter `data.receipt`,
 * daneben die Firmen-/Druckdaten (Firma, Anschrift, Fusszeilen). Diese Lesart
 * nimmt nur den Beleg: die Druckdaten gehoeren nicht zum RKSV-Kernbeleg (siehe
 * models/receipt.ts), und die bestehenden Aufrufe sollen ihre Zusage behalten.
 * Wer beides braucht, nimmt [belegMitFirmaAusHuelle] ueber die
 * `…WithCompany`-Varianten.
 *
 * Paketintern exportiert, damit `./stored` gespeicherte Belege mit demselben
 * Leser liest; nicht Teil der Paketoberflaeche.
 */
export function belegAusHuelle(daten: unknown, functionName: string): Receipt {
  const huelle = daten as { receipt?: unknown } | null | undefined;
  if (huelle == null || typeof huelle !== 'object' || huelle.receipt == null) {
    throw antwortfehler(functionName, 'Antwort enthaelt keinen Beleg (data.receipt fehlt)');
  }
  const beleg = huelle.receipt;
  if (typeof beleg !== 'object' || Array.isArray(beleg)) {
    throw antwortfehler(functionName, 'Antwort enthaelt keinen Beleg (data.receipt ist kein Objekt)');
  }
  // Positionen und Gutscheine werden gleich mit `.map` gelesen. Eine Antwort,
  // die dort etwas anderes als eine Liste fuehrt, ergab bis hierher einen
  // nackten TypeError ("… .map is not a function") und fiel damit aus der
  // Fehler-Union. Fehlend und `null` bleiben erlaubt: Nullbelege haben keine
  // Positionen.
  const roh = beleg as { items?: unknown; vouchers?: unknown };
  for (const feld of ['items', 'vouchers'] as const) {
    const wert = roh[feld];
    if (wert != null && !Array.isArray(wert)) {
      throw antwortfehler(functionName, `Antwort enthaelt einen Beleg mit unbrauchbarem Feld "${feld}"`);
    }
  }
  return fromReceiptPayload(beleg as ReceiptPayloadRead);
}

/**
 * Beleg **und** Firmendaten aus derselben Huelle. Der Beleg entscheidet:
 * fehlt er, ist die Antwort unbrauchbar. Die Firmendaten duerfen dagegen
 * luecken haben — ein Kundendokument ohne gepflegte Fusszeile ist kein Grund,
 * einen ausgestellten Beleg nicht anzuzeigen (siehe models/receipt-company.ts).
 * Paketintern exportiert wie [belegAusHuelle].
 */
export function belegMitFirmaAusHuelle(daten: unknown, functionName: string): ReceiptWithCompany {
  const receipt = belegAusHuelle(daten, functionName);
  const d = (daten ?? {}) as {
    testCashregister?: unknown;
    testSignature?: unknown;
    headerVersionId?: unknown;
    layout?: unknown;
    registrationInfo?: unknown;
    logo_scale?: unknown;
  };
  const layout = d.layout && typeof d.layout === 'object' && Array.isArray((d.layout as { lines?: unknown }).lines) ? (d.layout as ReceiptLayout) : null;
  const angaben = d.registrationInfo && typeof d.registrationInfo === 'object' ? readRegistrationInfo(d.registrationInfo as Record<string, unknown>) : null;
  return {
    receipt,
    company: fromReceiptCompanyPayload(daten as ReceiptCompanyPayload),
    testCashregister: d.testCashregister === true,
    testSignature: d.testSignature === true,
    headerVersionId: typeof d.headerVersionId === 'string' && d.headerVersionId !== '' ? d.headerVersionId : null,
    layout,
    registrationInfo: angaben,
    logoScale: d.logo_scale === 'S' || d.logo_scale === 'M' || d.logo_scale === 'L' || d.logo_scale === 'XL' ? d.logo_scale : 'M',
  };
}

/**
 * Zahlbetrag des Servers aus einem `payments_sum_mismatch`
 * (`details.expectedCents`), sonst `undefined`. Das Paket wiederholt nie
 * selbst mit diesem Betrag: eine Kartenzahlung ist schon belastet. Die Kasse
 * entscheidet (Differenz nachkassieren oder erstatten) und schickt dann einen
 * neuen Verkauf.
 */
export function paymentsExpectedCents(error: unknown): number | undefined {
  if (!isKasseneckApiError(error) || error.code !== 'payments_sum_mismatch') return undefined;
  const wert = error.details['expectedCents'];
  return Number.isSafeInteger(wert) ? (wert as number) : undefined;
}
