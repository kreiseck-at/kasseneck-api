import { CANCELLATION_REASONS, isCancellationReason, type Receipt } from '../models/index.js';
import { parseServerTimeStamp, toViennaWallClock } from '../vienna-time.js';
import { KasseneckValidationError } from '../client/errors.js';

/**
 * Vermerke eines Belegs: was ihn als besonderen Beleg ausweist (Testkasse,
 * Testsignatur, Training, Storno, Nacherfassung, Signaturausfall). Eine Quelle
 * fuer die Regeln: der Bon ([buildReceiptLayout]) setzt seine Bloecke aus
 * diesen Bausteinen, und [belegVermerke] gibt sie strukturiert hinaus, damit
 * ein anderes Blatt (Kassenteil auf der A4-Rechnung, Zahlungsbestaetigung)
 * dieselben Vermerke anordnet, ohne eigene Regeln zu erfinden.
 *
 * Die Woerter sind Pflichtwoerter und bleiben in jeder Sprache deutsch
 * (RKSV § 11 Abs. 3: Trainings- und Stornobuchungen ausdruecklich als solche
 * bezeichnen; § 17 Abs. 4 und 5: Signaturausfall, Nacherfassung).
 *
 * „Duplikat“ ist kein Vermerk des Belegs: das druckt nur der Nachdruck auf
 * Papier.
 *
 * Abhaengig nur vom Belegmodell und der Wiener Zeit.
 */

/** Art eines Vermerks, in der festen Reihenfolge von [belegVermerke]. */
export type BelegVermerkArt = 'testkasse' | 'testsignatur' | 'training' | 'storno' | 'nacherfassung' | 'signaturausfall';

/** Ein Vermerk: Titel (hervorgehoben) und Zeilen darunter, fertiger Text. */
export interface BelegVermerk {
  art: BelegVermerkArt;
  titel: string;
  zeilen: string[];
}

export interface BelegVermerkOptionen {
  /** Beleg einer Testumgebung (wie [BuildReceiptLayoutOptions.testKasse]). */
  testKasse?: boolean;
  /** Produktionskonto mit Test-Signatureinheit (wie [BuildReceiptLayoutOptions.testSignatur]). */
  testSignatur?: boolean;
}

// ------------------------------------------------------------------- Texte

export const TESTKASSE_TEXT = 'TESTKASSE — kein gültiger Beleg';
export const TESTSIGNATUR_TEXT = 'TESTSIGNATUR — kein gültiger Beleg';

/** Text, den das Backend statt einer Signatur ablegt, wenn die Karte ausfaellt. */
export const SIGNATUR_AUSGEFALLEN = 'Sicherheitseinrichtung ausgefallen';

/**
 * Derselbe Text base64url-kodiert -- so steht er als dritter JWS-Teil im Feld
 * `sig` (Zwilling von `RKSVService.isSigSuccess`). Fest hinterlegt statt zur
 * Laufzeit kodiert: `btoa`/`Buffer` sind in Browser und Node verschieden zu
 * haben, und der Wert ist unveraenderlich.
 */
const SIGNATUR_AUSGEFALLEN_BASE64URL = 'U2ljaGVyaGVpdHNlaW5yaWNodHVuZyBhdXNnZWZhbGxlbg';

/** Erklaerung am Trainingsbeleg (Wortlaut mit dem Betreiber abgestimmt). */
const TRAINING_ERKLAERUNG = [
  'Trainingsbuchung — kein Kauf, keine Zahlung, keine steuerliche Buchung.',
  'Sollten Sie diesen Beleg als Kunde erhalten haben, sagen Sie bitte dem Betrieb Bescheid.',
];

/** Grund-Zeile nach einem Ausfall der Kasse (innere Gruende); `sonstiges` druckt den eigenen Text. */
const NACHERFASSUNG_GRUND: Readonly<Record<string, string>> = {
  internet: 'Internet', strom: 'Strom', geraet: 'Gerät defekt', stoerung: 'Störung',
};

// ------------------------------------------------------------ Hilfsregeln

/** Wurde der Beleg ohne funktionierende Signatureinheit ausgestellt? */
export function receiptSignatureFailed(receipt: Pick<Receipt, 'sig'>): boolean {
  return receipt.sig.split('.')[2] === SIGNATUR_AUSGEFALLEN_BASE64URL;
}

/** Belegtyp als Zeichenkette (Enum-Objekt oder roher Serverwert). */
export function belegtyp(receipt: Pick<Receipt, 'receiptType'>): string {
  return typeof receipt.receiptType === 'object' ? receipt.receiptType.value : String(receipt.receiptType ?? '');
}

/**
 * Datum des stornierten Originals: „11.08.2026, 09:02 Uhr". Ein unlesbarer
 * Zeitstempel am BEZUG ist kein Grund, den Storno-Bon zu verweigern (der
 * Beleg selbst ist gueltig) -- dann bleibt die Zeile weg.
 */
function originalDatum(timeStamp: string): string | null {
  try {
    const t = toViennaWallClock(parseServerTimeStamp(timeStamp));
    const zwei = (n: number): string => String(n).padStart(2, '0');
    return `${zwei(t.day)}.${zwei(t.month)}.${t.year}, ${zwei(t.hour)}:${zwei(t.minute)} Uhr`;
  } catch {
    return null;
  }
}

/**
 * Grund eines Stornos lesbar -- aus dem EINEN Katalog des Modells
 * (`CANCELLATION_REASONS`, derselbe, den die Kasse anbietet und das Backend
 * annimmt). Unbekannter Code (Fremdclient): sichtbar, aber ohne zu werfen.
 */
function stornoGrundText(code: string | undefined): string | null {
  if (!code) return null;
  return isCancellationReason(code) ? CANCELLATION_REASONS[code] : code;
}

/** `YYYY-MM-DD` als `TT.MM.JJJJ`; anderes bleibt, wie es kam. */
function handbelegDatum(tag: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tag);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : tag;
}

// ---------------------------------------------------------------- Bausteine

export function testkasseVermerk(): BelegVermerk {
  return { art: 'testkasse', titel: TESTKASSE_TEXT, zeilen: [] };
}

export function testsignaturVermerk(): BelegVermerk {
  return { art: 'testsignatur', titel: TESTSIGNATUR_TEXT, zeilen: [] };
}

/** Trainingsbeleg: Titel und Erklaerung; sonst `null`. */
export function trainingVermerk(receipt: Receipt): BelegVermerk | null {
  return belegtyp(receipt) === 'training' ? { art: 'training', titel: 'TRAININGSBELEG', zeilen: [...TRAINING_ERKLAERUNG] } : null;
}

/** Stornobeleg: Bezug, Datum des Originals (wenn der Bezug es traegt, Backend seit 2026-09-04) und Grund; sonst `null`. */
export function stornoVermerk(receipt: Receipt): BelegVermerk | null {
  if (belegtyp(receipt) !== 'cancellation') return null;
  const zeilen = [receipt.cancellationOf ? `Stornobuchung zu Beleg ${receipt.cancellationOf.receiptId}` : 'Stornobuchung'];
  const datum = receipt.cancellationOf?.timeStamp ? originalDatum(receipt.cancellationOf.timeStamp) : null;
  if (datum) zeilen.push(`vom ${datum}`);
  const grund = stornoGrundText(typeof receipt.cancellationReason === 'string' ? receipt.cancellationReason : undefined);
  if (grund) zeilen.push(`Grund: ${grund}`);
  return { art: 'storno', titel: 'STORNOBELEG', zeilen };
}

/**
 * Teile der Nacherfassung: Anlass (Art und Grund), Handbeleg (Nummer und Tag) und der USt-Hinweis.
 * Der Vermerk (§ 17 Abs. 5 RKSV) besteht aus Titel, Anlass und Handbeleg; den USt-Hinweis setzt nur
 * der Bon, denn ob er gilt, haengt an der Firma (Kleinunternehmer) und am Beleg (Zahlungsbeleg).
 */
export interface NacherfassungTeile {
  titel: string;
  anlass: string[];
  handbeleg: string[];
  /** „USt: Duplikat des Handbelegs“ bzw. „… der Handbelege“ (Erlass 2019, 3.3 Faelle 5 und 6, 2.4.11). */
  ustHinweis: string;
}

/**
 * Nacherfassung eines Handbelegs (`handbeleg`): Art, Grund, Nummer und Tag
 * des Handbelegs bzw. der Handbelege eines Tagessammelbelegs. Ohne Handbeleg `null`.
 */
export function nacherfassungTeile(receipt: Receipt): NacherfassungTeile | null {
  const h = receipt.handbeleg;
  if (!h) return null;
  const anlass = [h.grund === 'ausser_haus' ? 'Leistung außer Haus' : 'nach Ausfall der Kasse'];
  const grund = h.grund === 'sonstiges' ? h.grundText : NACHERFASSUNG_GRUND[h.grund];
  if (grund) anlass.push(`Grund: ${grund}`);
  const tag = handbelegDatum(h.datum);
  if (h.nummerBis) {
    return {
      titel: 'NACHERFASSUNG',
      anlass,
      handbeleg: ['Tagessammelbeleg', `Handbelege Nr. ${h.nummer} bis ${h.nummerBis}`, `${h.anzahl ? `${h.anzahl} Belege ` : ''}vom ${tag}`],
      ustHinweis: 'USt: Duplikat der Handbelege',
    };
  }
  return {
    titel: 'NACHERFASSUNG',
    anlass,
    handbeleg: [`Handbeleg Nr. ${h.nummer}`, `vom ${tag}${h.uhrzeit ? `, ${h.uhrzeit} Uhr` : ''}`],
    ustHinweis: 'USt: Duplikat des Handbelegs',
  };
}

/** Signaturausfall (§ 17 Abs. 4 RKSV): der Vermerk ohne Zeilen; sonst `null`. */
export function signaturausfallVermerk(receipt: Receipt): BelegVermerk | null {
  return receiptSignatureFailed(receipt) ? { art: 'signaturausfall', titel: SIGNATUR_AUSGEFALLEN, zeilen: [] } : null;
}

// ------------------------------------------------------------------ Ausgabe

const OPTIONEN: ReadonlySet<string> = new Set(['testKasse', 'testSignatur']);
const OPTIONEN_NEU: Readonly<Record<string, string>> = { testCashregister: 'testKasse', testSignature: 'testSignatur' };

/**
 * Die Vermerke eines Belegs in fester Reihenfolge: Testkasse, Testsignatur,
 * Training, Storno, Nacherfassung, Signaturausfall. Ein gewoehnlicher Beleg
 * hat keine (`[]`).
 *
 * Ob Testkasse oder Testsignatur, weiss nur der Aufrufer (er kennt das Konto),
 * wie bei [buildReceiptLayout]. Eine unbekannte Option wirft
 * (`KasseneckValidationError`, `scope: 'request'`): eine englische
 * (`testCashregister`) darf nie still wegfallen, sonst saehe ein Testbeleg gueltig aus.
 *
 * Firmendaten kennt diese Ausgabe nicht; der USt-Hinweis der Nacherfassung
 * („USt: Duplikat …“) gehoert darum nicht zum Vermerk (siehe [NacherfassungTeile]).
 */
export function belegVermerke(receipt: Receipt, optionen: BelegVermerkOptionen = {}): BelegVermerk[] {
  for (const name of Object.keys(optionen)) {
    if (OPTIONEN.has(name)) continue;
    const richtig = OPTIONEN_NEU[name];
    throw new KasseneckValidationError('belegVermerke', richtig !== undefined ? `Option "${name}" heisst "${richtig}"` : `Unbekannte Option "${name}"`, 'request');
  }
  const vermerke: Array<BelegVermerk | null> = [
    optionen.testKasse ? testkasseVermerk() : null,
    optionen.testSignatur ? testsignaturVermerk() : null,
    trainingVermerk(receipt),
    stornoVermerk(receipt),
    ((): BelegVermerk | null => {
      const teile = nacherfassungTeile(receipt);
      return teile ? { art: 'nacherfassung', titel: teile.titel, zeilen: [...teile.anlass, ...teile.handbeleg] } : null;
    })(),
    signaturausfallVermerk(receipt),
  ];
  return vermerke.filter((v): v is BelegVermerk => v !== null);
}
