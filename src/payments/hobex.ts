import { type HobexReceipt, type HobexReceiptPayload, fromHobexReceiptPayload } from '../models/index.js';
import { KasseneckValidationError } from '../client/errors.js';
import type { KasseneckTransport } from '../client/transport.js';
import { toViennaWallClock } from '../vienna-time.js';

/**
 * Hobex-Kartenzahlung ueber die **Cloud-API** — Zwilling der Hobex-Aufrufe in
 * kasseneck_api/lib/kasseneck_api.dart (Zeilen 491-526).
 *
 * Der Ablauf hat zwei Schritte: eine Kennung erzeugen ([newHobexTransactionId])
 * und damit belasten ([hobexPay]). Die Kennung ist der Faden, an dem das
 * Backend eine haengende Zahlung wiederfindet (`getHobexStatusWithTimeout`,
 * functions/payment-endpoints.js) — sie ist deshalb kein Schmuck, sondern die
 * Absicherung gegen eine doppelte Belastung.
 *
 * **Nur der Cloud-Weg ist hier drin, und das bleibt so.** Hobex **HPS** ist ein
 * physisches Terminal, mit dem die Kasse **lokal ueber TCP** spricht; **myPOS**
 * und **SumUp** sind **Android-SDKs**. Ein Browser hat weder rohe TCP-Sockets
 * noch eine Android-Laufzeit — das ist keine fehlende Umsetzung und kein
 * Buendler-Problem, sondern eine Grenze der Umgebung. Wer diese drei Wege
 * braucht, braucht die Flutter-App, nicht dieses Paket.
 *
 * **Kassen-Benutzer-Weg (`registerUserAuth`, Browser-Kasse):** Das Backend
 * laesst diese Identitaet nur bei fuenf Endpunkten zu (`allowRegisterUser` in
 * functions/index.js — `listMyCashregisters`, `listMyReceipts`, `getReceipt`,
 * `createReceipt`, `generateFullReceiptId`); keiner der beiden Aufrufe dieser
 * Datei ist darunter. Beide laufen nur mit `apiKeyAuth`. Dieses Paket bildet
 * das **nicht** nach — wer darf, entscheidet allein das Backend.
 */

/** Endpunktnamen aus dem Vorbild — beide mit Suffix `Api`. */
const ENDPUNKT_PAY = 'hobexPayApi';
const ENDPUNKT_REFUND = 'hobexRefundApi';

/**
 * Cent -> Euro. **Die einzige Umrechnungsstelle dieses Moduls.** Betraege
 * werden im ganzen Paket in Cent gefuehrt (exakte Ganzzahl-Arithmetik); die
 * Hobex-Schnittstelle erwartet dagegen Euro als Gleitkommazahl (`amount`,
 * `tip`), und das Backend reicht sie unveraendert an Hobex weiter. Das
 * Gegenstueck fuer die Antwortrichtung steht in models/hobex-receipt.ts.
 */
const centsToEuro = (cents: number): number => cents / 100;

export interface HobexPayOptions {
  /** Kennung der Zahlung — siehe [newHobexTransactionId]. */
  transactionId: string;
  /** Zu belastender Betrag in **Cent** (ohne Trinkgeld). */
  amountCents: number;
  /** Trinkgeld in **Cent**; Hobex belastet Betrag + Trinkgeld in einem. */
  tipCents?: number;
  /** Freier Verwendungszweck, den Hobex mitfuehrt (z. B. Tischnummer). */
  reference?: string;
}

export interface HobexRefundOptions {
  /** Kennung der zu erstattenden Zahlung. */
  transactionId: string;
  /** Zu erstattender Betrag in **Cent** (ohne Trinkgeld). */
  amountCents: number;
  /** Zu erstattendes Trinkgeld in **Cent**. */
  tipCents?: number;
}

/** Zeit- und Zufallsquelle von [newHobexTransactionId] — fuer Tests einspeisbar. */
export interface HobexTransactionIdOptions {
  /** Zeitpunkt der Kennung; ohne Angabe jetzt. */
  now?: Date;
  /** Zufallsquelle in `[0, 1)` wie `Math.random`; ohne Angabe `Math.random`. */
  random?: () => number;
}

/**
 * Belastet eine Karte ueber die **Hobex-Cloud-API** und liefert den
 * entstandenen [HobexReceipt].
 *
 * **Der Endpunkt heisst `hobexPayApi`** — mit Suffix; ohne ihn gibt es ihn
 * nicht.
 */
export async function hobexPay(rufen: KasseneckTransport, options: HobexPayOptions): Promise<HobexReceipt> {
  const params = zahlungsNutzlast(ENDPUNKT_PAY, options);
  // `reference` steht im Vorbild **unbedingt** in der Nutzlast: ohne Angabe
  // geht sie als null raus, nicht gar nicht. Der Transport wirft nur
  // `undefined` weg, `null` bleibt erhalten — genau diese Unterscheidung.
  params['reference'] = options.reference ?? null;
  return belegAusNutzlast(await rufen(ENDPUNKT_PAY, params));
}

/**
 * Erstattet eine zuvor ueber die Hobex-Cloud getaetigte Zahlung. Das Backend
 * storniert zuerst (Void, solange der Tagesabschluss aussteht) und erstattet
 * erst danach.
 *
 * **Ohne Rueckgabewert, mit Absicht.** Das Vorbild liefert
 * `resJson['status'] == 'success'`; in diesem Paket wirft die Fehlerhuelle
 * schon im Transport, sobald der Status nicht ausdruecklich Erfolg ist. Ein
 * Wahrheitswert waere hier also immer `true` — eine Luege ueber den
 * Informationsgehalt, an der ein Aufrufer ein `if` aufhaengt, das nie greift.
 * Misserfolg kommt als geworfener Fehler.
 *
 * **Der Endpunkt heisst `hobexRefundApi`** — mit Suffix.
 */
export async function hobexRefund(rufen: KasseneckTransport, options: HobexRefundOptions): Promise<void> {
  // Anders als die Zahlung sendet der Refund im Vorbild **keine** reference.
  await rufen(ENDPUNKT_REFUND, zahlungsNutzlast(ENDPUNKT_REFUND, options));
}

/**
 * Erzeugt eine neue Hobex-Transaktionskennung: 19 Ziffern aus Zeitanteil und
 * Zufall (Zwilling von `newHobexTransactionId` im Vorbild, Zeile 522).
 *
 * Zwei bewusste Abweichungen:
 *
 * 1. **Wiener Wanduhrzeit statt Geraetezeit.** Das Vorbild nimmt
 *    `DateTime.now()` in der Zeitzone des Geraets; damit haetten zwei Kassen
 *    desselben Betriebs in verschiedenen Zeitzonen Kennungen, die sich um
 *    Stunden unterscheiden, und der Tageswechsel in der Kennung faende nicht
 *    zum Geschaeftstag statt. Fachlich ist Wien die Zeitzone (siehe
 *    vienna-time.ts) — und eine Browser-Kasse laeuft in der Zeitzone des Gasts,
 *    nicht des Betriebs.
 * 2. **Millisekunden statt Mikrosekunden.** JavaScript hat keine
 *    Mikrosekunden-Uhr. Das Vorbild fuellt mit sechs Bruchteilsstellen auf und
 *    haengt zwei Zufallsziffern an, von denen die Laengenbegrenzung eine wieder
 *    abschneidet; hier stehen drei Bruchteilsstellen und vier Zufallsziffern.
 *    Laenge und Form (nur Ziffern, 19 Stellen, `JJMMTThhmmss` voran) bleiben
 *    gleich.
 *
 * Zeit- und Zufallsquelle sind einspeisbar, damit die Kennung pruefbar ist.
 */
export function newHobexTransactionId(options: HobexTransactionIdOptions = {}): string {
  const wand = toViennaWallClock(options.now ?? new Date());
  const zufall = options.random ?? Math.random;
  const zeitanteil =
    zweistellig(wand.year % 100) +
    zweistellig(wand.month) +
    zweistellig(wand.day) +
    zweistellig(wand.hour) +
    zweistellig(wand.minute) +
    zweistellig(wand.second) +
    String(wand.millisecond).padStart(3, '0');
  // Vier Ziffern, immer vierstellig: eine kuerzere Zahl wuerde die Kennung
  // verkuerzen und damit ihre Form verlassen. Der Wert wird auf [0, 1)
  // begrenzt — eine fremde Zufallsquelle koennte 1 liefern.
  const zufallsanteil = String(Math.floor(begrenzt(zufall()) * 10_000)).padStart(4, '0');
  return zeitanteil + zufallsanteil;
}

/**
 * Gemeinsame Nutzlast beider Hobex-Aufrufe: Kennung und die beiden Betraege in
 * Euro. Prueft, bevor irgendetwas rausgeht — hier bewegt sich Geld auf einer
 * fremden Karte, und ein NaN-Betrag oder eine leere Kennung ist an einem
 * Zahlungsterminal nichts, was man dem Backend zum Ausprobieren schickt.
 */
function zahlungsNutzlast(
  functionName: string,
  options: { transactionId: string; amountCents: number; tipCents?: number },
): Record<string, unknown> {
  if (typeof options.transactionId !== 'string' || !options.transactionId.trim()) {
    throw eingabefehler(functionName, 'transactionId fehlt');
  }
  const amountCents = gepruefterBetrag(functionName, options.amountCents, 'amountCents', 1);
  const tipCents = gepruefterBetrag(functionName, options.tipCents ?? 0, 'tipCents', 0);
  return {
    transactionId: options.transactionId,
    // Euro-Umrechnung genau hier, an der Hobex-Grenze.
    amount: centsToEuro(amountCents),
    tip: centsToEuro(tipCents),
  };
}

/**
 * Ganzzahliger Cent-Betrag ab [mindestens]. `Number.isInteger` faengt NaN,
 * Unendlich und Bruchteils-Cent in einem — ein halber Cent ergibt bei der
 * Euro-Umrechnung eine dritte Nachkommastelle, die Hobex nicht kennt.
 */
function gepruefterBetrag(functionName: string, cents: number, feld: string, mindestens: number): number {
  if (!Number.isInteger(cents)) {
    throw eingabefehler(functionName, `${feld} muss eine ganze Zahl in Cent sein.`);
  }
  if (cents < mindestens) {
    throw eingabefehler(functionName, `${feld} muss mindestens ${mindestens} Cent betragen.`);
  }
  return cents;
}

/**
 * Hobex-Beleg aus der Antwort lesen. Geprueft werden die beiden Felder, ohne
 * die der Beleg nichts wert ist: die Kennung der Zahlung und der Zeitstempel
 * (an ihm scheitert die Lesart des Modells sonst mit einem nackten TypeError,
 * weil sie ihn zerlegt). Die uebrigen Felder bleiben so tolerant wie im
 * Vorbild — ein Beleg, dem Hobex den Kartenaussteller schuldig bleibt, ist
 * trotzdem eine erfolgte Zahlung.
 */
function belegAusNutzlast(daten: unknown): HobexReceipt {
  const roh = daten as Partial<HobexReceiptPayload> | null | undefined;
  if (
    roh == null ||
    typeof roh !== 'object' ||
    typeof roh.transactionId !== 'string' ||
    typeof roh.transactionDate !== 'string'
  ) {
    throw antwortfehler(ENDPUNKT_PAY, 'Antwort enthaelt keinen Hobex-Beleg');
  }
  return fromHobexReceiptPayload(roh as HobexReceiptPayload);
}

const zweistellig = (wert: number): string => String(wert).padStart(2, '0');

/** Auf `[0, 1)` begrenzen — eine fremde Zufallsquelle haelt sich nicht daran. */
const begrenzt = (wert: number): number => (Number.isFinite(wert) ? Math.min(Math.max(wert, 0), 0.999_999_9) : 0);

/** Fehler in der Eingabe des Aufrufers — es geht keine Anfrage raus. */
function eingabefehler(functionName: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(functionName, grund, 'request');
}

/** Die Antwort meldete Erfolg, trug aber nicht, was der Aufruf zusagt. */
function antwortfehler(functionName: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(functionName, grund, 'response');
}
