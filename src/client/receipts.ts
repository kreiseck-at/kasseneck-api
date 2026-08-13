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
  type ReceiptPayloadRead,
  type ReceiptItem,
  type Voucher,
  fromReceiptPayload,
  toReceiptItemPayload,
  toVoucherPayload,
  receiptItemIsValid,
  negateReceiptItem,
  voucherIsValid,
  type ReportMonth,
} from '../models/index.js';
import { parseServerTimeStamp, toViennaWallClock } from '../vienna-time.js';
import { KasseneckValidationError } from './errors.js';
import type { KasseneckTransport } from './transport.js';

/**
 * Beleg-Endpunkte — Zwilling der Beleg-Aufrufe in
 * kasseneck_api/lib/kasseneck_api.dart.
 *
 * **Alle Belegarten laufen ueber einen einzigen Backend-Endpunkt
 * `createReceipt`.** `sellReceipt`, `cancelReceipt`, `createCancelReceipt` und
 * `zeroReceipt` sind — wie im Flutter-Vorbild — benannte Bequemlichkeits-
 * schichten ueber [createReceipt]; sie legen den Belegtyp fest und reichen den
 * Rest durch. Die Pruefungen und der Nutzlast-Aufbau stehen deshalb genau
 * einmal da und nicht viermal.
 *
 * **Kein Wiederholen fehlgeschlagener Aufrufe** (siehe transport.ts): ein
 * Beleg ist nicht folgenlos wiederholbar.
 *
 * **Kassen-Benutzer-Weg (`registerUserAuth`, Browser-Kasse):** Das Backend
 * laesst diese Identitaet nur bei fuenf Endpunkten zu — `listMyCashregisters`,
 * `listMyReceipts`, `getReceipt`, `createReceipt` und `generateFullReceiptId`
 * (`allowRegisterUser` in functions/index.js). Von den Aufrufen dieser Datei
 * sind also alle offen ausser [getFirstReceiptDate]; siehe den Hinweis dort.
 * Dieses Paket bildet das **nicht** nach — wer darf, entscheidet allein das
 * Backend. Der Hinweis steht hier, damit ein Leser nicht raten muss.
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
}

/** Belegtyp und Inhalt — die vollstaendige Eingabe von [createReceipt]. */
export interface CreateReceiptOptions extends ReceiptCommonOptions {
  receiptType: ReceiptType | ReceiptTypeKey;
  /** Zahlungsart des Aufrufers — wird vor dem Senden geprueft. */
  paymentMethod?: KeckPaymentMethod | KeckPaymentMethodKey;
  /**
   * Zahlungsart, die aus einer **Serverantwort** stammt (Storno eines
   * gelesenen Belegs, siehe [cancelReceipt]). Geht ungeprueft hinaus: der
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
export interface CancelReceiptOptions extends Omit<ReceiptCommonOptions, 'customerDetails'> {
  /** Der zu stornierende Beleg; seine Positionen gehen negiert hinaus. */
  receipt: Receipt;
  /** Abweichende Zahlungsart; ohne Angabe die des stornierten Belegs. */
  paymentMethod?: KeckPaymentMethod | KeckPaymentMethodKey;
}

export interface CreateCancelReceiptOptions extends ReceiptCommonOptions {
  paymentMethod: KeckPaymentMethod | KeckPaymentMethodKey;
  /** Positionen, wie sie auf dem Storno stehen sollen — **nicht** negiert. */
  items: ReceiptItem[];
}

/**
 * Gemeinsame Umsetzung aller Belegarten (Zwilling von `_createReceipt`).
 * Bewusst **nicht** Teil der Paketoberflaeche: der Belegtyp gehoert nicht in
 * die Hand des Aufrufers, sondern zu einem der benannten Aufrufe darunter.
 */
export async function createReceipt(rufen: KasseneckTransport, options: CreateReceiptOptions): Promise<Receipt> {
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

  if (options.customProjectId != null) {
    params['customProjectId'] = options.customProjectId;
  }
  if (options.customerDetails != null) {
    params['customerDetails'] = options.customerDetails.join('\n');
  }
  if (options.legalMessage != null) {
    params['legalMessage'] = options.legalMessage.join('\n');
  }

  return belegAusHuelle(await rufen('createReceipt', params), 'createReceipt');
}

/** Normalbeleg (Verkauf) nach RKSV. */
export function sellReceipt(rufen: KasseneckTransport, options: SellReceiptOptions): Promise<Receipt> {
  return createReceipt(rufen, { ...options, receiptType: ReceiptType.standard });
}

/**
 * Stornobeleg zu einem bereits ausgestellten Beleg: dessen Positionen gehen
 * negiert hinaus, Kundendaten und Zahlungsart werden uebernommen. Gutscheine
 * des Originalbelegs wandern **nicht** mit (wie im Flutter-Vorbild) — ein
 * Gutschein-Storno ist ein eigener fachlicher Vorgang.
 */
export function cancelReceipt(rufen: KasseneckTransport, options: CancelReceiptOptions): Promise<Receipt> {
  const { receipt, paymentMethod, ...rest } = options;
  return createReceipt(rufen, {
    ...rest,
    receiptType: ReceiptType.cancellation,
    customerDetails: receipt.customerDetails,
    items: receipt.items.map(negateReceiptItem),
    // Eine ausdruecklich uebergebene Zahlungsart ist eine Aussage des
    // Aufrufers und wird geprueft. Ohne sie gilt die des stornierten Belegs —
    // die stammt vom Server und geht roh durch (sie kann eine Zahlungsart
    // sein, die dieses Paket noch nicht kennt; still auf 'cash'
    // zurueckzufallen verfaelschte die Zahlungsartenaufteilung im Tages- und
    // Monatsbericht, und zu werfen machte solche Belege unstornierbar).
    ...(paymentMethod != null
      ? { paymentMethod }
      : { paymentMethodFromServer: typeof receipt.paymentMethod === 'object' ? receipt.paymentMethod.value : receipt.paymentMethod }),
  });
}

/**
 * Stornobeleg aus frei uebergebenen Positionen — fuer den Fall, dass der
 * Originalbeleg nicht als Objekt vorliegt. Die Positionen gehen **unveraendert**
 * hinaus; das Vorzeichen setzt der Aufrufer.
 */
export function createCancelReceipt(rufen: KasseneckTransport, options: CreateCancelReceiptOptions): Promise<Receipt> {
  return createReceipt(rufen, { ...options, receiptType: ReceiptType.cancellation });
}

/** Nullbeleg (RKSV-Pruefbeleg) — ohne Positionen und ohne Zahlungsart. */
export function zeroReceipt(rufen: KasseneckTransport): Promise<Receipt> {
  return createReceipt(rufen, { receiptType: ReceiptType.zero });
}

/** Einzelnen Beleg der angemeldeten Kasse holen. */
export async function getReceipt(rufen: KasseneckTransport, receiptId: string): Promise<Receipt> {
  return belegAusHuelle(await rufen('getReceipt', { receiptId }), 'getReceipt');
}

/**
 * Verschluesselte Volltext-Belegnummer erzeugen — der Bezeichner, unter dem der
 * Beleg oeffentlich abrufbar ist (Beleg-Download, Pruefportal).
 */
export async function generateFullReceiptId(rufen: KasseneckTransport, receiptId: string): Promise<string> {
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
export async function getFirstReceiptDate(rufen: KasseneckTransport): Promise<ReportMonth> {
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
 * daneben die Firmen-/Druck-Metadaten (Firma, Adresse, Fusszeilen). Dieses
 * Paket liest davon nur den Beleg: die Metadaten betreffen ausschliesslich das
 * Beleg-Rendering und gehoeren nicht zum RKSV-Kernbeleg (siehe models/receipt.ts).
 */
function belegAusHuelle(daten: unknown, functionName: string): Receipt {
  const huelle = daten as { receipt?: ReceiptPayloadRead } | null | undefined;
  if (huelle == null || typeof huelle !== 'object' || huelle.receipt == null) {
    throw antwortfehler(functionName, 'Antwort enthaelt keinen Beleg (data.receipt fehlt)');
  }
  return fromReceiptPayload(huelle.receipt);
}
