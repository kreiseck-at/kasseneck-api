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
  negateReceiptItem,
  voucherIsValid,
  fromReceiptSummaryPayload,
  type ReceiptSummary,
  type ReceiptSummaryPayload,
  type ReportMonth,
  type CancellationItem,
  type CancellationOf,
  type CancellationReason,
  isCancellationReason,
} from '../models/index.js';
import { parseServerTimeStamp, toViennaWallClock } from '../vienna-time.js';
import { euroToCents } from '../money.js';
import { KasseneckValidationError } from './errors.js';
import type { InternerTransport } from './aufrufe.js';
import type { Pruefangaben, ReceiptLayout } from '../receipt/layout.js';

/**
 * Beleg-Endpunkte — Zwilling der Beleg-Aufrufe in
 * kasseneck_api/lib/kasseneck_api.dart.
 *
 * **Verkauf, freier Storno und Nullbeleg laufen ueber einen einzigen
 * Backend-Endpunkt `createReceipt`.** `sellReceipt`, `createCancelReceipt` und
 * `zeroReceipt` sind — wie im Flutter-Vorbild — benannte Bequemlichkeits-
 * schichten ueber [createReceipt]; sie legen den Belegtyp fest und reichen den
 * Rest durch. **[cancelReceipt] geht an den eigenen Endpunkt `cancelReceipt`**:
 * der Server negiert die Positionen des Originals, prueft Restmengen und
 * Rechte und verkettet beide Belege (Storno-API).
 *
 * **Kein Wiederholen fehlgeschlagener Aufrufe** (siehe transport.ts): ein
 * Beleg ist nicht folgenlos wiederholbar.
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
  /** Kartenanbieter; ohne Angabe gilt `custom`. */
  creditCardProvider?: CreditCardProvider;
  /** Transaktionsbezeichner der Kartenzahlung. */
  cardPaymentId?: string;
  /** Freier Bezeichner des Aufrufers (Projekt, Auftrag, Schicht). */
  customProjectId?: string;
  /** Rohdaten der Kartenzahlung (Terminal-/Anbieterantwort). */
  cardPaymentData?: Record<string, unknown>;
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
  /** Zahlart des Trinkgelds; ohne Angabe gilt die des Belegs. */
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
  sofortErhalten?: boolean;
}

export interface TipRecipientShare {
  registerUserId: string;
  cents: number;
}

/** Belegtyp und Inhalt — die vollstaendige Eingabe von [createReceipt]. */
export interface CreateReceiptOptions extends ReceiptCommonOptions {
  receiptType: ReceiptType | ReceiptTypeKey;
  /** Zahlungsart des Aufrufers — wird vor dem Senden geprueft. */
  paymentMethod?: KeckPaymentMethod | KeckPaymentMethodKey;
  /**
   * Zahlungsart, die aus einer **Serverantwort** stammt (Storno eines
   * gelesenen Belegs). Geht ungeprueft hinaus: der
   * Server hat den Wert selbst vergeben und weist unbekannte selbst ab —
   * ergaenzt er eine Zahlungsart vor dem naechsten Paket-Update, waeren sonst
   * alle Belege damit unstornierbar. Nur fuer diesen einen Weg gedacht; eine
   * ausdruecklich uebergebene `paymentMethod` sticht.
   */
  paymentMethodFromServer?: string;
  items?: ReceiptItem[];
  vouchers?: Voucher[];
}

export interface SellReceiptOptions extends ReceiptCommonOptions {
  paymentMethod: KeckPaymentMethod | KeckPaymentMethodKey;
  items?: ReceiptItem[];
  vouchers?: Voucher[];
}

/**
 * `customerDetails` fehlt hier absichtlich (wie im Flutter-Vorbild): die
 * Kundendaten des Stornos sind die des stornierten Belegs, sonst stimmten
 * Beleg und Storno nicht mehr ueberein.
 */
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
  /** Rueckzahlweg; ohne Angabe die Zahlungsart des stornierten Belegs. */
  paymentMethod?: KeckPaymentMethod | KeckPaymentMethodKey;
} & ({ receipt: Receipt; cashregisterId?: string; originalReceiptId?: string } | { receipt?: undefined; cashregisterId: string; originalReceiptId: string });

/** Antwort von [cancelReceipt]: Storno-Beleg, Bezug, Restmengen des Originals danach. */
export interface CancelReceiptResult {
  receipt: Receipt;
  cancellationOf: CancellationOf;
  remaining: number[];
}

export interface CreateCancelReceiptOptions extends ReceiptCommonOptions {
  paymentMethod: KeckPaymentMethod | KeckPaymentMethodKey;
  /** Positionen, wie sie auf dem Storno stehen sollen — **nicht** negiert. */
  items: ReceiptItem[];
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
  testKasse: boolean;
  /** Produktionskonto mit Test-Signatureinheit (Aufdruck TESTSIGNATUR). */
  testSignatur: boolean;
  /** Kennung der Kopf-Version; null bei altem Backend/Altbeleg ohne Zuordnung. */
  kopfId: string | null;
  /** Vom Backend gebautes Zeilenmodell (Regelwerk des Belegs); null, wenn nicht mitgeliefert. */
  layout: ReceiptLayout | null;
  /**
   * Registrierdaten fuer den Block „Prüfangaben“ (Nullbelege, Regelwerk 2) --
   * fuer Clients, die das Layout selbst bauen; null bei altem Backend.
   */
  pruefangaben: Pruefangaben | null;
}

/**
 * Gemeinsame Umsetzung aller Belegarten (Zwilling von `_createReceipt`).
 * Bewusst **nicht** Teil der Paketoberflaeche: der Belegtyp gehoert nicht in
 * die Hand des Aufrufers, sondern zu einem der benannten Aufrufe darunter.
 */
export async function createReceipt(rufen: InternerTransport, options: CreateReceiptOptions): Promise<Receipt> {
  return belegAusHuelle(await rufen('createReceipt', createReceiptParams(options)), 'createReceipt');
}

/** Wie [createReceipt], liest aus derselben Antwort zusaetzlich die Firmendaten. */
async function createReceiptWithCompany(
  rufen: InternerTransport,
  options: CreateReceiptOptions,
): Promise<ReceiptWithCompany> {
  return belegMitFirmaAusHuelle(await rufen('createReceipt', createReceiptParams(options)), 'createReceipt');
}

/**
 * Baut die Nutzlast von `createReceipt` und prueft die Eingabe. Wirft, bevor
 * irgendetwas rausgeht — ein Beleg ist nicht folgenlos wiederholbar.
 */
function createReceiptParams(options: CreateReceiptOptions): Record<string, unknown> {
  const typ = belegtyp(options.receiptType);
  const { items, vouchers } = options;

  if (typ.needsItems) {
    // Ein reiner Gutscheinverkauf ist ein Umsatz ohne Positionen — deshalb
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

  // Vom Aufrufer kommt sie geprueft, vom Server roh — siehe die beiden Felder
  // in [CreateReceiptOptions]. Die Typpruefung allein reicht dafuer nicht: ein
  // Verbraucher ohne Typen faellt durch dieses Netz, und ein Tippfehler in der
  // Zahlungsart faellt sonst erst am Server auf.
  const zahlungsart =
    options.paymentMethod != null ? gepruefteZahlungsart(options.paymentMethod) : options.paymentMethodFromServer;
  if (zahlungsart != null) {
    params['paymentMethod'] = zahlungsart;
    const anbieter = options.creditCardProvider ?? CreditCardProvider.custom;
    if (zahlungsart === KeckPaymentMethod.creditCard.value) {
      if (options.cardPaymentId != null) {
        params['cardPaymentId'] = options.cardPaymentId;
        // Der Kartenanbieter kommt dagegen vom Aufrufer, nicht vom Server —
        // hier bleibt der Schreibpfad streng.
        params['creditCardProvider'] = kartenanbieter(anbieter);
        // Bewusst auch als `null`, wenn der Anbieter keine Rohdaten liefert:
        // das Feld gehoert zur Kartenzahlung und das Backend nimmt null an.
        params['cardPaymentData'] = options.cardPaymentData ?? null;
      } else if (anbieter !== CreditCardProvider.custom) {
        throw eingabefehler(`cardPaymentId ist Pflicht bei creditCardProvider "${anbieter}".`);
      }
    }
  }

  if (options.tip != null) {
    if (typ.value !== ReceiptType.standard.value && typ.value !== ReceiptType.training.value) {
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

/** Normalbeleg (Verkauf) nach RKSV. */
export function sellReceipt(rufen: InternerTransport, options: SellReceiptOptions): Promise<Receipt> {
  return createReceipt(rufen, { ...options, receiptType: ReceiptType.standard });
}

/**
 * Normalbeleg wie [sellReceipt], liefert zusaetzlich die Firmen-/Druckdaten
 * aus derselben Antwort — alles, was ein Belegdruck braucht, in einem Aufruf.
 */
export function sellReceiptWithCompany(
  rufen: InternerTransport,
  options: SellReceiptOptions,
): Promise<ReceiptWithCompany> {
  return createReceiptWithCompany(rufen, { ...options, receiptType: ReceiptType.standard });
}

const NOTE_MAX = 200;

/**
 * Storno-Beleg zu einem bestehenden Beleg — voll oder in Teilen. Prueft die
 * Eingabe, bevor etwas hinausgeht; der Server haelt die Restmengen und die
 * Reichweite des Rechts (eigene/alle) und antwortet mit dem fertigen,
 * signierten Storno-Beleg. Gutscheine des Originals wandern nicht mit.
 */
export async function cancelReceipt(rufen: InternerTransport, options: CancelReceiptOptions): Promise<CancelReceiptResult> {
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
  if (options.items !== undefined) {
    if (!Array.isArray(options.items) || options.items.length === 0) {
      throw new KasseneckValidationError('cancelReceipt', 'items muss eine nicht leere Liste sein', 'request');
    }
    for (const pos of options.items) {
      if (!Number.isInteger(pos.index) || pos.index < 0 || !Number.isInteger(pos.quantity) || pos.quantity < 1) {
        throw new KasseneckValidationError('cancelReceipt', 'Storno-Menge muss eine ganze Zahl >= 1 sein', 'request');
      }
    }
  }
  if (options.note !== undefined && options.note.length > NOTE_MAX) {
    throw new KasseneckValidationError('cancelReceipt', `Anmerkung ist zu lang (hoechstens ${NOTE_MAX} Zeichen)`, 'request');
  }
  const params: Record<string, unknown> = { cashregisterId, originalReceiptId, reason: options.reason };
  if (options.items !== undefined) params.items = options.items.map((p) => ({ index: p.index, quantity: p.quantity }));
  if (options.note !== undefined && options.note !== '') params.note = options.note;
  if (options.paymentMethod != null) params.paymentMethod = gepruefteZahlungsart(options.paymentMethod);

  const daten = await rufen('cancelReceipt', params);
  const receipt = belegAusHuelle(daten, 'cancelReceipt');
  const huelle = daten as { cancellationOf?: unknown; remaining?: unknown };
  const bezug = huelle.cancellationOf as { receiptId?: unknown; fullReceiptId?: unknown } | undefined;
  if (bezug == null || typeof bezug.receiptId !== 'string') {
    throw antwortfehler('cancelReceipt', 'Antwort enthaelt keinen Bezug (data.cancellationOf fehlt)');
  }
  if (!Array.isArray(huelle.remaining) || !huelle.remaining.every((n) => Number.isInteger(n))) {
    throw antwortfehler('cancelReceipt', 'Antwort enthaelt keine Restmengen (data.remaining fehlt)');
  }
  return {
    receipt,
    cancellationOf: { receiptId: bezug.receiptId, fullReceiptId: typeof bezug.fullReceiptId === 'string' ? bezug.fullReceiptId : null },
    remaining: huelle.remaining as number[],
  };
}

/**
 * Stornobeleg aus frei uebergebenen Positionen — fuer den Fall, dass der
 * Originalbeleg nicht als Objekt vorliegt. Die Positionen gehen **unveraendert**
 * hinaus; das Vorzeichen setzt der Aufrufer.
 *
 * @deprecated Alter Storno-Weg ohne Bezug: kein Verweis auf das Original,
 * keine Restmengen, kein Schutz vor doppeltem Storno, Gutscheine werden nicht
 * zurueckgenommen. Das Backend nimmt ihn weiter an und legt `deprecation` in
 * die Antwort. Stattdessen [cancelReceipt] (Endpunkt `cancelReceipt`): Bezug,
 * Grund, Teilstorno, Fehlercodes.
 */
export function createCancelReceipt(rufen: InternerTransport, options: CreateCancelReceiptOptions): Promise<Receipt> {
  return createReceipt(rufen, { ...options, receiptType: ReceiptType.cancellation });
}

/** Nullbeleg (RKSV-Pruefbeleg) — ohne Positionen und ohne Zahlungsart. */
export function zeroReceipt(rufen: InternerTransport): Promise<Receipt> {
  return createReceipt(rufen, { receiptType: ReceiptType.zero });
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
  /**
   * Kasse, deren Belege gelistet werden. Geht als Parameter **`cashregisterid`**
   * hinaus — klein geschrieben, anders als das `cashregisterId` der Anmeldung:
   * so heisst der Pflichtparameter dieses Endpunkts im Backend, und ein
   * Tippfehler faellt sonst erst im Betrieb auf.
   */
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
 * muss also ein Firebase-ID-Token sein — mit `apiKeyAuth` ist er nicht
 * erreichbar. Ausserdem prueft das Backend die Kassenzuweisung hier im Rumpf
 * (der Endpunkt laeuft mit `checkCashRegister: false`), ein Kassen-Benutzer
 * bekommt also nur die ihm zugewiesenen Kassen.
 */
export async function listMyReceipts(rufen: InternerTransport, options: ListMyReceiptsOptions): Promise<ReceiptList> {
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
  const daten = await rufen<{ receipts?: unknown; stats?: unknown }>('listMyReceipts', {
    cashregisterid: options.cashregisterId,
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
    today?: { umsatz?: unknown; count?: unknown } | null;
    trendPct?: unknown;
    days?: unknown;
  };
  const tage = Array.isArray(quelle.days) ? quelle.days : [];
  return {
    today: {
      revenueCents: euroToCents(quelle.today?.umsatz),
      count: typeof quelle.today?.count === 'number' ? quelle.today.count : 0,
    },
    trendPercent: typeof quelle.trendPct === 'number' ? quelle.trendPct : null,
    days: tage.map((tag: unknown) => {
      const eintrag = (typeof tag === 'object' && tag !== null ? tag : {}) as { date?: unknown; umsatz?: unknown };
      return {
        date: typeof eintrag.date === 'string' ? eintrag.date : '',
        revenueCents: euroToCents(eintrag.umsatz),
      };
    }),
  };
}

/** Einzelnen Beleg der angemeldeten Kasse holen. */
export async function getReceipt(rufen: InternerTransport, receiptId: string): Promise<Receipt> {
  return belegAusHuelle(await rufen('getReceipt', { receiptId }), 'getReceipt');
}

/**
 * Wie [getReceipt], liefert zusaetzlich die Firmen-/Druckdaten aus derselben
 * Antwort (Firma, Anschrift, Steuernummer, UID, Fusszeilen, Logo-Adresse,
 * Kleinunternehmer-Kennzeichen) — die Angaben, die ein Beleg im Kopf und Fuss
 * traegt (siehe models/receipt-company.ts).
 */
export async function getReceiptWithCompany(
  rufen: InternerTransport,
  receiptId: string,
): Promise<ReceiptWithCompany> {
  return belegMitFirmaAusHuelle(await rufen('getReceipt', { receiptId }), 'getReceipt');
}

/**
 * Verschluesselte Volltext-Belegnummer erzeugen — der Bezeichner, unter dem der
 * Beleg oeffentlich abrufbar ist (Beleg-Download, Pruefportal).
 */
export async function generateFullReceiptId(rufen: InternerTransport, receiptId: string): Promise<string> {
  const daten = await rufen<{ fullReceiptId?: unknown }>('generateFullReceiptId', { receiptId });
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
export async function getFirstReceiptDate(rufen: InternerTransport): Promise<ReportMonth> {
  const roh = await rufen<unknown>('getFirstReceiptDate');
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
  const nutzlast: Record<string, unknown> = { cents: tip.cents };
  if (tip.paymentMethod != null) nutzlast['paymentMethod'] = gepruefteZahlungsart(tip.paymentMethod);
  // Nur mitschicken, wenn gesetzt: fehlt das Feld, entscheidet die
  // Voreinstellung des Betriebs. Ein `false` waere dort eine Aussage, kein
  // Weglassen. Der Wortlaut des Fehlers ist der des Backends
  // (tip-core.normalizeTip) -- wer ihn hier sieht, sieht denselben Satz.
  if (tip.sofortErhalten != null) {
    if (typeof tip.sofortErhalten !== 'boolean') {
      throw eingabefehler('Trinkgeld: sofortErhalten muss true oder false sein.');
    }
    nutzlast['sofortErhalten'] = tip.sofortErhalten;
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

/** Zahlungsart des Aufrufers pruefen — unbekannt wirft, bevor etwas rausgeht. */
function gepruefteZahlungsart(wert: KeckPaymentMethod | KeckPaymentMethodKey): string {
  if (typeof wert === 'object') {
    return wert.value;
  }
  if (!Object.prototype.hasOwnProperty.call(KeckPaymentMethod, wert)) {
    throw eingabefehler(`Zahlungsart: unbekannter Schluessel "${wert}"`);
  }
  return KeckPaymentMethod[wert as KeckPaymentMethodKey].value;
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
 */
function belegAusHuelle(daten: unknown, functionName: string): Receipt {
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
 */
function belegMitFirmaAusHuelle(daten: unknown, functionName: string): ReceiptWithCompany {
  const receipt = belegAusHuelle(daten, functionName);
  const d = (daten ?? {}) as { testKasse?: unknown; testSignatur?: unknown; kopfId?: unknown; layout?: unknown; pruefangaben?: unknown };
  const layout = d.layout && typeof d.layout === 'object' && Array.isArray((d.layout as { lines?: unknown }).lines) ? (d.layout as ReceiptLayout) : null;
  const pa = d.pruefangaben && typeof d.pruefangaben === 'object' ? (d.pruefangaben as { karteRegistriertAm?: unknown; kasseRegistriertAm?: unknown }) : null;
  const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    receipt,
    company: fromReceiptCompanyPayload(daten as ReceiptCompanyPayload),
    testKasse: d.testKasse === true,
    testSignatur: d.testSignatur === true,
    kopfId: typeof d.kopfId === 'string' ? d.kopfId : null,
    layout,
    pruefangaben: pa ? { karteRegistriertAm: text(pa.karteRegistriertAm), kasseRegistriertAm: text(pa.kasseRegistriertAm) } : null,
  };
}
