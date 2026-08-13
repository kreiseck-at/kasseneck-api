import {
  ReceiptType,
  type ReceiptTypeKey,
  KeckPaymentMethod,
  type KeckPaymentMethodKey,
  CreditCardProvider,
  VoucherAction,
  VoucherType,
} from '../enums/index.js';
import { requireEnumKey } from '../models/enum-payload.js';
import {
  type Receipt,
  type ReceiptPayload,
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
  paymentMethod?: KeckPaymentMethod | KeckPaymentMethodKey;
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
  vouchers?: Voucher[];
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
      throw new Error(`Positionen sind Pflicht bei receiptType "${typ.value}" und duerfen nicht leer sein.`);
    }
    if (items?.some((item) => !receiptItemIsValid(item)) ?? false) {
      throw new Error('Ungueltige Position uebergeben.');
    }
  }

  const params: Record<string, unknown> = { receiptType: typ.value };

  if (vouchers != null && vouchers.length > 0) {
    if (!typ.allowsVouchers) {
      throw new Error(`Gutscheine sind nicht erlaubt bei receiptType "${typ.value}".`);
    }
    if (vouchers.some((voucher) => !voucherIsValid(voucher))) {
      throw new Error('Ungueltiger Gutschein uebergeben.');
    }
    const kombinationsfehler = checkVoucherCombinationError(vouchers, items ?? []);
    if (kombinationsfehler != null) {
      throw new Error(kombinationsfehler);
    }
    params['vouchers'] = vouchers.map(toVoucherPayload);
  }

  if (items != null && items.length > 0) {
    params['items'] = items.map(toReceiptItemPayload);
  }

  if (options.paymentMethod != null) {
    const zahlungsart = zahlungsartEintrag(options.paymentMethod);
    params['paymentMethod'] = zahlungsart.value;
    const anbieter = options.creditCardProvider ?? CreditCardProvider.custom;
    if (zahlungsart === KeckPaymentMethod.creditCard) {
      if (options.cardPaymentId != null) {
        params['cardPaymentId'] = options.cardPaymentId;
        params['creditCardProvider'] = requireEnumKey(CreditCardProvider, anbieter, 'Kartenanbieter');
        // Bewusst auch als `null`, wenn der Anbieter keine Rohdaten liefert:
        // das Feld gehoert zur Kartenzahlung und das Backend nimmt null an.
        params['cardPaymentData'] = options.cardPaymentData ?? null;
      } else if (anbieter !== CreditCardProvider.custom) {
        throw new Error(`cardPaymentId ist Pflicht bei creditCardProvider "${anbieter}".`);
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
    // Der gelesene Beleg kann eine Zahlungsart tragen, die dieses Paket noch
    // nicht kennt (roher String, siehe models/receipt.ts). Fuer den Schreibweg
    // muss sie aufloesbar sein — sonst ginge ein Storno mit unbekannter
    // Zahlungsart hinaus.
    paymentMethod: paymentMethod ?? zahlungsartEintrag(receipt.paymentMethod),
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
    throw new Error('generateFullReceiptId: Antwort enthaelt keine fullReceiptId');
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
    throw new Error('getFirstReceiptDate: Antwort enthaelt keinen Zeitstempel');
  }
  // Ueber die Wiener Wanduhrzeit statt ueber getMonth(): der erste Beleg eines
  // Monats liegt gern kurz nach Mitternacht, und der eingebaute Monat waere der
  // des ausfuehrenden Rechners (siehe vienna-time.ts).
  const wanduhr = toViennaWallClock(parseServerTimeStamp(roh));
  return { month: wanduhr.month, year: wanduhr.year };
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

/** Belegtyp aufloesen — Objekt-Eintrag oder Schluessel, unbekannt wirft. */
function belegtyp(wert: ReceiptType | ReceiptTypeKey | string): ReceiptType {
  return typeof wert === 'object' ? wert : requireEnumKey(ReceiptType, wert, 'Belegtyp');
}

/** Zahlungsart aufloesen — Objekt-Eintrag oder Schluessel, unbekannt wirft. */
function zahlungsartEintrag(wert: KeckPaymentMethod | KeckPaymentMethodKey | string): KeckPaymentMethod {
  return typeof wert === 'object' ? wert : requireEnumKey(KeckPaymentMethod, wert, 'Zahlungsart');
}

/**
 * `createReceipt` und `getReceipt` liefern den Beleg unter `data.receipt`,
 * daneben die Firmen-/Druck-Metadaten (Firma, Adresse, Fusszeilen). Dieses
 * Paket liest davon nur den Beleg: die Metadaten betreffen ausschliesslich das
 * Beleg-Rendering und gehoeren nicht zum RKSV-Kernbeleg (siehe models/receipt.ts).
 */
function belegAusHuelle(daten: unknown, functionName: string): Receipt {
  const huelle = daten as { receipt?: ReceiptPayload } | null | undefined;
  if (huelle == null || typeof huelle !== 'object' || huelle.receipt == null) {
    throw new Error(`${functionName}: Antwort enthaelt keinen Beleg (data.receipt fehlt)`);
  }
  return fromReceiptPayload(huelle.receipt);
}
