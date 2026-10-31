import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import { parseServerTimeStamp, toViennaWallClock } from '../vienna-time.js';
import { labelText, messageText, type LabelKey } from './texte.js';

/**
 * Kasseninfo fuer die Pruefung (Kassennachschau, Stufe 2b): was die Kasse dem
 * Pruefer ueber sich sagt – Produkt, Hersteller, Kassen-ID, Signatur,
 * DEP, Abschluesse und Kontakt. Die Werte kommen vom Kassenweg
 * (`getRegisterInspectionInfo`), die Woerter aus dem Katalog (`inspection.*`).
 *
 * Am Bildschirm und auf dem Ausdruck steht derselbe Text: [inspectionInfoRows]
 * fuer den Bildschirm (Bezeichnung und Wertzeilen), [inspectionInfoLines] fuer
 * den Bondrucker (Textzeilen in Bonbreite). Die Prueffaelle stehen in
 * `fixtures/inspection-info-cases.json`; der Dart-Zwilling rechnet gegen
 * dieselbe Datei.
 *
 * Fehlt ein Wert, entfaellt die Zeile; ein „unbekannt“ steht nie da.
 */

/** Stand der Signatureinheit: in Betrieb oder ein offener Ausfall der Kasse. */
export type InspectionSignatureStatus = 'active' | 'outage';

/**
 * Signatureinheit der Kasse, wie das Zertifikat sie nennt. Zeitpunkte als
 * ISO-8601 in UTC; die Seriennummer dezimal als Text (sie kann groesser als
 * 2^53 sein). Was der Server nicht sicher weiss, fehlt.
 */
export interface RegisterInspectionSignature {
  /** Anbieter der Karte; heute nur `a_trust`. Fehlt bei Testkarten und unbekanntem Anbieter. */
  provider?: string;
  serialHex?: string;
  serialDecimal?: string;
  /** Inhaber laut Zertifikat, etwa `UID ATU12345675`. */
  holder?: string;
  /** Aussteller laut Zertifikat. */
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  /** `true` nur, wenn der Inhaber mit A-Trust abgeglichen ist und passt. */
  holderChecked?: boolean;
  /** Testkarte (Sandbox); fehlt die Angabe, gilt `false`. */
  testCard: boolean;
  /** Fehlt, wenn der Server keinen oder einen diesem Paket unbekannten Stand meldet. */
  status?: InspectionSignatureStatus;
  /** Beginn eines offenen Ausfalls (nur bei `status: 'outage'`). */
  outageSince?: string;
}

/** Antwort von [getRegisterInspectionInfo]. Jedes Feld kann fehlen, `signature` ist dann `null`. */
export interface RegisterInspectionInfo {
  cashregisterId?: string;
  product?: { name?: string; cloudBased?: boolean };
  manufacturer?: { name?: string; vatId?: string };
  /** `null` ohne Signatureinheit oder ohne lesbares Zertifikat einer echten Karte. */
  signature: RegisterInspectionSignature | null;
  /** Zeitplan des Monatsbelegs; `monthlyTime` als `HH:MM` in `timeZone`. */
  closings?: { monthlyDay?: number; monthlyTime?: string; timeZone?: string; annualIsDecember?: boolean };
  /** Kontaktadresse fuer den Pruefer; kommt nur vom Server, nie fest aus der Kasse. */
  contactEmail?: string;
}

type Roh = Record<string, unknown>;
const objekt = (v: unknown): Roh | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Roh) : null);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const wahr = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/** Nur gesetzte Felder: ein fehlender Wert steht nicht als `undefined` im Ergebnis. */
function nurGesetzt<T extends object>(felder: T): T {
  return Object.fromEntries(Object.entries(felder).filter(([, v]) => v !== undefined)) as T;
}

/** Positivliste: nur die bekannten Felder mit passendem Typ, alles andere faellt weg. */
function signaturAus(v: unknown): RegisterInspectionSignature | null {
  const s = objekt(v);
  if (s === null) return null;
  const status = s.status === 'active' || s.status === 'outage' ? s.status : undefined;
  return nurGesetzt<RegisterInspectionSignature>({
    provider: text(s.provider),
    serialHex: text(s.serialHex),
    serialDecimal: text(s.serialDecimal),
    holder: text(s.holder),
    issuer: text(s.issuer),
    validFrom: text(s.validFrom),
    validTo: text(s.validTo),
    holderChecked: wahr(s.holderChecked),
    testCard: s.testCard === true,
    status,
    outageSince: text(s.outageSince),
  });
}

function infoAus(daten: unknown): RegisterInspectionInfo {
  const d = objekt(daten);
  if (d === null) {
    throw new KasseneckValidationError('getRegisterInspectionInfo', 'Antwort ist kein Objekt (data fehlt)', 'response');
  }
  const produkt = objekt(d.product);
  const hersteller = objekt(d.manufacturer);
  const abschluesse = objekt(d.closings);
  const tag = abschluesse?.monthlyDay;
  return nurGesetzt<RegisterInspectionInfo>({
    cashregisterId: text(d.cashregisterId),
    product: produkt === null ? undefined : nurGesetzt({ name: text(produkt.name), cloudBased: wahr(produkt.cloudBased) }),
    manufacturer: hersteller === null ? undefined : nurGesetzt({ name: text(hersteller.name), vatId: text(hersteller.vatId) }),
    signature: signaturAus(d.signature),
    closings: abschluesse === null ? undefined : nurGesetzt({
      monthlyDay: typeof tag === 'number' && Number.isInteger(tag) && tag >= 1 && tag <= 31 ? tag : undefined,
      monthlyTime: text(abschluesse.monthlyTime),
      timeZone: text(abschluesse.timeZone),
      annualIsDecember: wahr(abschluesse.annualIsDecember),
    }),
    contactEmail: text(d.contactEmail),
  });
}

/**
 * Kasseninfo fuer die Pruefung (`getRegisterInspectionInfo`, nur Kassenweg).
 * Jeder Kassen-Benutzer darf sie lesen, ebenso ein Geraet mit API-Schluessel;
 * die Kasse ist die der Anmeldung. Liest nur, aendert nichts.
 */
export async function getRegisterInspectionInfo(transport: InternerTransport): Promise<RegisterInspectionInfo> {
  return infoAus(await transport<unknown>('getRegisterInspectionInfo'));
}

// ---- Formatierer ----------------------------------------------------------------

/** Teil der Kasseninfo, zu dem eine Zeile gehoert; vor `signature` steht die Ueberschrift „Signatur“. */
export type InspectionInfoSection = 'register' | 'signature' | 'operation';

/** Kennung einer Zeile der Kasseninfo, in der Reihenfolge der Ausgabe. */
export type InspectionInfoRowKey =
  | 'product' | 'manufacturer' | 'cashregister_id'
  | 'unit' | 'hosting' | 'certificate' | 'holder' | 'issuer' | 'valid' | 'check' | 'status'
  | 'dep' | 'closings' | 'contact';

/**
 * Eine Zeile der Kasseninfo am Bildschirm: Bezeichnung und eine oder mehrere
 * Wertzeilen (die Seriennummer hat zwei). `label` ist leer bei `product`: die
 * Zeile steht ohne Bezeichnung ueber die ganze Breite.
 */
export interface InspectionInfoRow {
  key: InspectionInfoRowKey;
  section: InspectionInfoSection;
  label: string;
  value: string[];
}

/** Optionen von [inspectionInfoLines]. */
export interface InspectionInfoLinesOptions {
  /** Zeichen je Zeile des Bondruckers (meist 32, 42 oder 48), mindestens 24. */
  width: number;
  /** Zeitpunkt des Drucks; die letzte Zeile nennt ihn in Wiener Zeit. */
  printedAt: Date;
}

/** Breite der Bezeichnungsspalte im Ausdruck (die laengste Bezeichnung hat 10 Zeichen). */
const SPALTE = 13;
/** Schmaler darf der Bon nicht sein: die Wertspalte braucht noch 11 Zeichen. */
const MINDESTBREITE = 24;
/**
 * Geschuetztes Leerzeichen, nur innerhalb dieses Moduls: haelt „UID ATU…“ beim
 * Umbruch zusammen. Hinaus geht immer ein gewoehnliches Leerzeichen.
 */
const GESCHUETZT = '\u00a0';

/** Steuerzeichen (auch Zeilenumbruch, Tabulator und C1) aus Serverwerten werden Leerzeichen. */
const bereinigt = (v: string | undefined): string | undefined => {
  if (v === undefined) return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return t === '' ? undefined : t;
};

/** [teil] in [text] haelt beim Umbruch zusammen (seine Leerzeichen werden geschuetzt). */
const zusammen = (text: string, teil: string): string => text.replace(teil, () => teil.split(' ').join(GESCHUETZT));
/** Der ganze [text] haelt zusammen, soweit er in die Zeile passt („UID ATU76279224“). */
const ganz = (text: string): string => zusammen(text, text);

const zwei = (n: number): string => String(n).padStart(2, '0');

/** `TT.MM.JJJJ` und `HH:MM` eines Zeitpunkts in Wiener Zeit, nie aus der Zeitzone des Geraets. */
function wienerZeit(zeitpunkt: Date): { date: string; time: string } {
  const t = toViennaWallClock(zeitpunkt);
  return { date: `${zwei(t.day)}.${zwei(t.month)}.${t.year}`, time: `${zwei(t.hour)}:${zwei(t.minute)}` };
}

/** Ein Zeitpunkt des Servers in Wiener Zeit; unlesbar = `null` (die Angabe entfaellt). */
function wien(iso: string | undefined): { date: string; time: string } | null {
  if (iso === undefined) return null;
  try {
    return wienerZeit(parseServerTimeStamp(iso));
  } catch {
    return null;
  }
}

/** Die Zeilen mit geschuetzten Leerzeichen; [inspectionInfoRows] und [inspectionInfoLines] teilen sie. */
function zeilenRoh(info: RegisterInspectionInfo): InspectionInfoRow[] {
  const zeilen: InspectionInfoRow[] = [];
  const zeile = (key: InspectionInfoRowKey, section: InspectionInfoSection, label: LabelKey | null, werte: Array<string | undefined>): void => {
    const value = werte.filter((w): w is string => w !== undefined);
    if (value.length > 0) zeilen.push({ key, section, label: label === null ? '' : labelText(label), value });
  };

  // --- Kasse
  const produkt = bereinigt(info.product?.name);
  if (produkt !== undefined) {
    zeile('product', 'register', null, [info.product?.cloudBased === true ? labelText('inspection.product_cloud', { name: produkt }) : produkt]);
  }
  const herstellerName = bereinigt(info.manufacturer?.name);
  const uid = bereinigt(info.manufacturer?.vatId);
  const uidText = uid === undefined ? undefined : ganz(labelText('inspection.vat_id', { number: uid }));
  const hersteller = [herstellerName, uidText].filter((t): t is string => t !== undefined);
  zeile('manufacturer', 'register', 'inspection.manufacturer', [hersteller.length > 0 ? hersteller.join(', ') : undefined]);
  zeile('cashregister_id', 'register', 'inspection.cashregister_id', [bereinigt(info.cashregisterId)]);

  // --- Signatur
  const s = info.signature;
  if (s !== null && s !== undefined) {
    const aTrust = !s.testCard && s.provider === 'a_trust';
    zeile('unit', 'signature', 'inspection.unit', [
      s.testCard ? labelText('inspection.unit_test_card') : aTrust ? labelText('inspection.unit_a_trust') : undefined,
    ]);
    zeile('hosting', 'signature', 'inspection.hosting', [aTrust ? labelText('inspection.hosting_server') : undefined]);
    const hex = bereinigt(s.serialHex);
    const dezimal = bereinigt(s.serialDecimal);
    // Die Zahl bleibt beim Umbruch bei ihrer Angabe in Klammern („11c6c7cd (hex)“).
    const seriennr = (key: LabelKey, nummer: string): string => zusammen(labelText(key, { number: nummer }), `${nummer} (`);
    zeile('certificate', 'signature', 'inspection.certificate', [
      hex === undefined ? undefined : seriennr('inspection.serial_hex', hex),
      dezimal === undefined ? undefined : seriennr(hex === undefined ? 'inspection.serial_decimal_only' : 'inspection.serial_decimal', dezimal),
    ]);
    zeile('holder', 'signature', 'inspection.holder', [bereinigt(s.holder)]);
    zeile('issuer', 'signature', 'inspection.issuer', [bereinigt(s.issuer)]);
    const von = wien(s.validFrom);
    const bis = wien(s.validTo);
    zeile('valid', 'signature', 'inspection.valid', [
      von !== null && bis !== null ? labelText('inspection.valid_range', { from: von.date, to: bis.date })
        : von !== null ? labelText('inspection.valid_from', { date: von.date })
          : bis !== null ? labelText('inspection.valid_to', { date: bis.date }) : undefined,
    ]);
    zeile('check', 'signature', 'inspection.check', [s.holderChecked === true ? labelText('inspection.check_holder') : undefined]);
    const seit = s.status === 'outage' ? wien(s.outageSince) : null;
    // Datum und Uhrzeit des Ausfalls bleiben beim Umbruch zusammen.
    const ausfall = seit === null ? labelText('inspection.status_outage')
      : zusammen(labelText('inspection.status_outage_since', seit), `${seit.date}, ${seit.time}`);
    zeile('status', 'signature', 'inspection.status', [
      s.status === 'active' ? labelText('inspection.status_active') : s.status === 'outage' ? ausfall : undefined,
    ]);
  }

  // --- DEP, Abschluesse, Kontakt
  zeile('dep', 'operation', 'inspection.dep', [labelText('inspection.dep_online')]);
  const tag = info.closings?.monthlyDay;
  const uhrzeit = bereinigt(info.closings?.monthlyTime);
  if (tag !== undefined && uhrzeit !== undefined) {
    const monat = tag === 1
      ? labelText('inspection.closings_monthly_first', { time: uhrzeit })
      : labelText('inspection.closings_monthly_day', { n: tag, time: uhrzeit });
    const satz = info.closings?.annualIsDecember === true ? `${monat}, ${labelText('inspection.closings_annual_december')}` : monat;
    zeile('closings', 'operation', 'inspection.closings', [satz]);
  }
  zeile('contact', 'operation', 'inspection.contact', [bereinigt(info.contactEmail)]);
  return zeilen;
}

const offen = (t: string): string => t.split(GESCHUETZT).join(' ');

/**
 * Die Zeilen der Kasseninfo fuer den Bildschirm, in der Reihenfolge des
 * Ausdrucks. Ueberschrift („Kasseninfo für die Prüfung“, `inspection.title`),
 * die Ueberschrift vor dem Teil `signature` (`inspection.signature`) und der
 * Absatz „So arbeitet die Kasse:“ (`inspection.how_it_works`,
 * `inspection.how_it_works_text`) kommen aus dem Katalog.
 */
export function inspectionInfoRows(info: RegisterInspectionInfo): InspectionInfoRow[] {
  return zeilenRoh(info).map((z) => ({ ...z, value: z.value.map(offen) }));
}

/**
 * Wortweiser Umbruch auf [breite] Zeichen. Getrennt wird nur an gewoehnlichen
 * Leerzeichen; ein Wort, das allein zu lang ist, wird an seinen geschuetzten
 * Leerzeichen und dann hart geteilt. Nie laenger als [breite].
 */
function umbrechen(eingabe: string, breite: number): string[] {
  const woerter: string[] = [];
  for (const wort of eingabe.split(' ')) {
    if (wort === '') continue;
    if (wort.length <= breite) {
      woerter.push(wort);
      continue;
    }
    for (const teil of wort.split(GESCHUETZT)) {
      for (let i = 0; i < teil.length; i += breite) woerter.push(teil.slice(i, i + breite));
    }
  }
  const zeilen: string[] = [];
  let zeile = '';
  for (const wort of woerter) {
    if (zeile === '') zeile = wort;
    else if (zeile.length + 1 + wort.length <= breite) zeile += ` ${wort}`;
    else {
      zeilen.push(zeile);
      zeile = wort;
    }
  }
  if (zeile !== '') zeilen.push(zeile);
  return zeilen.map(offen);
}

/** Eine Zeile im Ausdruck: Bezeichnung in der Spalte, Werte rechts davon; ohne Bezeichnung ueber die ganze Breite. */
function druckzeilen(z: InspectionInfoRow, breite: number): string[] {
  if (z.label === '') return z.value.flatMap((w) => umbrechen(w, breite));
  const aus: string[] = [];
  let kopf: string | null = z.label.padEnd(SPALTE);
  if (z.label.length >= SPALTE) {
    // Passt die Bezeichnung nicht in die Spalte, steht sie allein darueber.
    aus.push(...umbrechen(z.label, breite));
    kopf = null;
  }
  for (const w of z.value) {
    for (const teil of umbrechen(w, breite - SPALTE)) {
      aus.push((kopf ?? ' '.repeat(SPALTE)) + teil);
      kopf = null;
    }
  }
  return aus;
}

/**
 * Die Kasseninfo als Textzeilen fuer den Bondrucker: kein Belegkopf, keine
 * Belegnummer, nicht signiert (kein Beleg). Ueberschriften in Grossschrift,
 * Bezeichnungen in einer Spalte von 13 Zeichen, lange Werte brechen wortweise
 * in der Wertspalte um. Zwischen den Bloecken eine Leerzeile, am Ende
 * „Gedruckt TT.MM.JJJJ, HH:MM“ (Wiener Zeit). Keine Zeile ist laenger als
 * [InspectionInfoLinesOptions.width].
 */
export function inspectionInfoLines(info: RegisterInspectionInfo, options: InspectionInfoLinesOptions): string[] {
  const breite = options?.width;
  if (typeof breite !== 'number' || !Number.isInteger(breite) || breite < MINDESTBREITE) {
    throw new KasseneckValidationError('inspectionInfoLines', `width muss eine ganze Zahl ab ${MINDESTBREITE} sein`, 'request');
  }
  const gedruckt = options.printedAt;
  if (!(gedruckt instanceof Date) || Number.isNaN(gedruckt.getTime())) {
    throw new KasseneckValidationError('inspectionInfoLines', 'printedAt muss ein gueltiges Date sein', 'request');
  }
  const zeilen = zeilenRoh(info);
  const teil = (section: InspectionInfoSection): string[] => zeilen.filter((z) => z.section === section).flatMap((z) => druckzeilen(z, breite));
  const signatur = teil('signature');
  const wann = wienerZeit(gedruckt);
  const bloecke: string[][] = [
    umbrechen(labelText('inspection.title').toUpperCase(), breite),
    teil('register'),
    signatur.length > 0 ? [...umbrechen(labelText('inspection.signature').toUpperCase(), breite), ...signatur] : [],
    teil('operation'),
    [...umbrechen(labelText('inspection.how_it_works'), breite), ...umbrechen(messageText('inspection.how_it_works_text'), breite)],
    umbrechen(zusammen(labelText('inspection.printed_at', wann), `${wann.date}, ${wann.time}`), breite),
  ];
  return bloecke.filter((b) => b.length > 0).flatMap((b, i) => (i === 0 ? b : ['', ...b]));
}
