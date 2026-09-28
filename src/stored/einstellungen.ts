import {
  POS_BUSINESS_DEFAULTS, POS_BUSINESS_VALUES, POS_DEVICE_DEFAULTS, POS_DEVICE_VALUES, POS_SHORTCUT_DEFAULTS, POS_SHORTCUT_SHARED_PAIRS,
} from '../pos/settings.js';
import { hat, innereNamen, istObjekt, regel, type Objekt } from './draht.js';
import { KATALOGE, SCHEMAS, type SchemaEintrag, type SchemaObjekt } from './vokabular.js';

/*
 * Gespeicherte Kassen-Einstellungen -> Drahtform `{business, device}`, in der
 * Reihenfolge des Servers (functions-kasse/kasse-settings-endpoints.js,
 * getKasseSettings unter /api/v3):
 *
 *   1. `mische` (kasse-settings-core): nur innen bekannte Schluessel; Karten
 *      (`saetze`, `tgStufen`, `tasten`) per Object.assign in die Vorgabe;
 *      danach `entwirreTasten` mit ALLEN gespeicherten Aktionen, auch
 *      unbekannten.
 *   2. `nurGueltig` (kasse-settings-v3): was der Validator nicht annimmt,
 *      faellt weg, Karten eintragsweise (fremder Steuersatz, unbekannte
 *      Aktion, Taste ausserhalb des Musters).
 *   3. Rand: Schluessel und Werte englisch.
 *
 * Einzige bewusste Abweichung: ein Wert eines Aufzaehlungsfeldes, den dieser
 * Validator nicht kennt, aber vom richtigen Typ ist (`stil: 'sepia'`), bleibt
 * stehen wie ein unbekannter Wert vom Draht (Regel aus Aufgabe 7): er kann ein
 * neuer Wert des Servers sein; [unknownPosSettingValues] nennt ihn. Alles
 * andere, was der Server weglaesst, faellt auch hier weg und steht in der
 * Liste `weggelassen` (aeussere Pfade wie am Server).
 *
 * Die Pruefer sind Zwillinge von PRUEFER_BETRIEB/PRUEFER_GERAET; der
 * Backend-Vergleich (test/stored-backend.test.ts) und der Quelltext-Waechter
 * halten sie am Server.
 */

type Teil = 'business' | 'device';
type Pruefer = (w: unknown) => boolean;

const bool: Pruefer = (v) => typeof v === 'boolean';
const hex: Pruefer = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const kuerzel: Pruefer = (v) => typeof v === 'string' && /^[A-Za-z0-9]{1,3}$/.test(v);
const ganz = (min: number, max: number): Pruefer => (v) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const ip: Pruefer = (v) => v === '' || (typeof v === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every((t) => Number(t) <= 255));
const kennung: Pruefer = (v) => typeof v === 'string' && v.length <= 64 && /^[\w:.\- ]*$/.test(v);
// eslint-disable-next-line no-control-regex
const UNSICHTBAR = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/;
const klartext: Pruefer = (v) => typeof v === 'string' && v.length <= 64 && !UNSICHTBAR.test(v) && (v === '' || v.trim() !== '');
const tid: Pruefer = (v) => typeof v === 'string' && /^\d{0,16}$/.test(v);
const prozentChips: Pruefer = (v) => {
  if (!Array.isArray(v) || v.length > 5) return false;
  const gesehen: number[] = [];
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || x > 100) return false;
    const r = Math.round(x * 10) / 10;
    if (r !== x || gesehen.includes(r)) return false;
    gesehen.push(r);
  }
  return true;
};
const logoBildUrl: Pruefer = (v) => v === '' || (typeof v === 'string' && v.length <= 600 && v.startsWith('https://firebasestorage.googleapis.com/'));

/** Pruefer je aeusserem Feld, soweit das Feld keine Aufzaehlung und keine Karte ist. */
const PRUEFER: Readonly<Record<Teil, Readonly<Record<string, Pruefer>>>> = {
  business: {
    logoText: kuerzel, logoEnabled: bool, color: hex, clock: bool, lockScreen: bool, staffPhotos: bool, logoutAfterSale: bool,
    fastLogin: bool, showPrices: bool, showVat: bool, emoji: bool, categoryColors: bool, customAmountAllowed: bool,
    note: bool, search: bool, payCash: bool, payCard: bool, tip: bool, tipSplit: bool, change: bool, exactCash: bool,
    paySplit: bool, tipChips: prozentChips, logoImage: logoBildUrl, watermarkX: ganz(-25, 125), watermarkY: ganz(-25, 125),
    glass: bool, hints: bool, discountChips: prozentChips,
  },
  device: {
    extraColumns: ganz(-2, 4), touch: bool, printerEnabled: bool, printerIp: ip, printerPort: ganz(1, 65535),
    printerBluetoothId: kennung, printerName: klartext, printerId: kennung, printerDeviceId: kennung, connectPrinterId: kennung,
    drawerEnabled: bool, terminalIp: ip, terminalPort: ganz(1, 65535), terminalTid: tid, shortcutHints: bool,
  },
};

/** Aufzaehlungen (aussen, englisch) je Teil. */
const AUFZAEHLUNGEN: Readonly<Record<Teil, Readonly<Record<string, readonly (string | number)[] | undefined>>>> = {
  business: POS_BUSINESS_VALUES, device: POS_DEVICE_VALUES,
};

/** Schalter-Karten: erlaubte Schluessel (Backend STEUERSAETZE, TG_STUFEN = Schluessel der Vorgabe). */
const KARTEN: Readonly<Record<string, readonly string[]>> = {
  vatRates: Object.keys(POS_BUSINESS_DEFAULTS.vatRates),
  tipSteps: Object.keys(POS_BUSINESS_DEFAULTS.tipSteps),
};

/** Tastenmuster (Backend TASTE_MUSTER). */
const TASTE_MUSTER = /^((Ctrl|Alt|Shift|Meta|Mod)\+){0,3}([A-Z0-9]|F\d{1,2}|Enter|Escape|Backspace|Space|Tab|Delete|Arrow(Up|Down|Left|Right)|[+\-*/.,])$/;

/** Schema-Teil (aussen -> innen) und die Kataloge seiner Werte. */
function teilSchema(teil: Teil): SchemaObjekt {
  return regel(SCHEMAS.getKasseSettings.data[teil] as SchemaEintrag).unter as SchemaObjekt;
}
function katalogFuer(teil: Teil, aussen: string): Readonly<Record<string, string>> | null {
  const verweis = SCHEMAS.getKasseSettings.werte[`${teil}.${aussen}`];
  return verweis ? KATALOGE[verweis.$catalog] ?? null : null;
}

/** Tasten: aeussere und innere Aktionsnamen, Vorgabe und Paare in innerer Form. */
const TASTEN_SCHEMA = regel(teilSchema('device').shortcuts as SchemaEintrag).unter as SchemaObjekt;
const AKTION_AUSSEN = innereNamen(TASTEN_SCHEMA); // innen -> aussen
const AKTION_INNEN = new Map([...AKTION_AUSSEN].map(([i, a]) => [a, i]));
const innen = (aktion: string): string => AKTION_INNEN.get(aktion) ?? aktion;
const TASTEN_VORGABE_INNEN: Readonly<Objekt> = Object.fromEntries(
  Object.entries(POS_SHORTCUT_DEFAULTS).map(([a, t]) => [innen(a), [...t]]),
);
const darfTeilen = (a: string, b: string): boolean =>
  POS_SHORTCUT_SHARED_PAIRS.some(([x, y]) => (innen(x) === a && innen(y) === b) || (innen(x) === b && innen(y) === a));

/** Zwilling von `entwirreTasten`: die gespeicherte Wahl gewinnt, eine beanspruchte Vorgabe-Taste faellt. */
function entwirreTasten(gemischt: Objekt, gespeichert: Objekt): Objekt {
  const beansprucht = new Map<unknown, string>();
  for (const [aktion, tasten] of Object.entries(gespeichert)) {
    if (!Array.isArray(tasten)) continue;
    for (const t of tasten) beansprucht.set(t, aktion);
  }
  const raus: Objekt = {};
  for (const [aktion, tasten] of Object.entries(gemischt)) {
    if (!Array.isArray(tasten) || aktion in gespeichert) { raus[aktion] = tasten; continue; }
    raus[aktion] = tasten.filter((t) => {
      const inhaber = beansprucht.get(t);
      return !inhaber || inhaber === aktion || darfTeilen(inhaber, aktion);
    });
  }
  return raus;
}

/** Nimmt `tastenkarte` diesen einen Eintrag an? (bekannte Aktion, 0-3 Tasten im Muster) */
function tasteGueltig(aktion: string, tasten: unknown): boolean {
  if (!AKTION_AUSSEN.has(aktion)) return false;
  return Array.isArray(tasten) && tasten.length <= 3 && tasten.every((t) => typeof t === 'string' && TASTE_MUSTER.test(t));
}

/**
 * Ein Aufzaehlungswert: gueltig (innen bekannt), unbekannt vom richtigen Typ
 * (bleibt, siehe oben) oder ungueltig. Innen gilt die Liste des Servers, also
 * die aeussere Liste durch den Katalog zurueck: ein englischer Wert im
 * gespeicherten Stand (`stil: 'night'`) ist dort ungueltig.
 */
function aufzaehlung(liste: readonly (string | number)[], katalog: Readonly<Record<string, string>> | null, w: unknown): 'gueltig' | 'unbekannt' | 'ungueltig' {
  const zurueck = new Map(Object.entries(katalog ?? {}).map(([i, a]) => [a, i]));
  const innenListe = liste.map((a) => (typeof a === 'string' && zurueck.has(a) ? zurueck.get(a) : a));
  if (innenListe.includes(w as string | number)) return 'gueltig';
  if (typeof w !== typeof liste[0]) return 'ungueltig';
  if (liste.includes(w as string | number) || zurueck.has(w as string)) return 'ungueltig';
  return 'unbekannt';
}

function teilNachAussen(teil: Teil, gespeichert: unknown, weg: string[]): Objekt {
  if (!istObjekt(gespeichert)) return {};
  const schema = teilSchema(teil);
  const aussenName = innereNamen(schema); // innen -> aussen
  const raus: Objekt = {};
  for (const [k, w] of Object.entries(gespeichert)) {
    const aussen = aussenName.get(k);
    // mische: was innen unbekannt ist, kommt gar nicht erst in den Stand.
    if (aussen === undefined || w === undefined) continue;
    const pfad = `${teil}.${aussen}`;
    if (aussen === 'shortcuts') {
      if (!w || typeof w !== 'object') { weg.push(pfad); continue; }
      let gemischt: Objekt = Object.assign({}, TASTEN_VORGABE_INNEN, w);
      if (!Array.isArray(w)) gemischt = entwirreTasten(gemischt, w as Objekt);
      const karte: Objekt = {};
      for (const [aktion, tasten] of Object.entries(gemischt)) {
        if (tasteGueltig(aktion, tasten)) karte[AKTION_AUSSEN.get(aktion)!] = tasten;
        else weg.push(`${pfad}.${AKTION_AUSSEN.get(aktion) ?? aktion}`);
      }
      raus[aussen] = karte;
      continue;
    }
    if (hat(KARTEN, aussen)) {
      if (!w || typeof w !== 'object') { weg.push(pfad); continue; }
      const karte: Objekt = {};
      for (const [sk, sw] of Object.entries(w)) {
        if (KARTEN[aussen]!.includes(sk) && typeof sw === 'boolean') karte[sk] = sw;
        else weg.push(`${pfad}.${sk}`);
      }
      raus[aussen] = karte;
      continue;
    }
    const liste = AUFZAEHLUNGEN[teil][aussen];
    if (liste) {
      const katalog = katalogFuer(teil, aussen);
      const art = aufzaehlung(liste, katalog, w);
      if (art === 'ungueltig') { weg.push(pfad); continue; }
      raus[aussen] = katalog && typeof w === 'string' && hat(katalog, w) ? katalog[w] : w;
      continue;
    }
    const pruefer = PRUEFER[teil][aussen];
    if (pruefer && pruefer(w)) raus[aussen] = w;
    else weg.push(pfad);
  }
  return raus;
}

/**
 * Gespeicherte Einstellungen `{ betrieb, geraet }` in der Drahtform, nur die
 * gespeicherten und gueltigen Felder (die Vorgaben mischt der Leser dazu),
 * und die weggelassenen aeusseren Pfade.
 */
export function _storedPosSettingsToWire(stored: { betrieb?: unknown; geraet?: unknown } | null | undefined): {
  business: Objekt; device: Objekt; weggelassen: string[];
} {
  const s = istObjekt(stored) ? stored : {};
  const weg: string[] = [];
  const business = teilNachAussen('business', s.betrieb, weg);
  const device = teilNachAussen('device', s.geraet, weg);
  return { business, device, weggelassen: weg };
}

/** Nur fuer den Test: die Feldliste der Pruefer (muss mit der Vorgabe deckungsgleich sein). */
export const _PRUEFER_FELDER = Object.freeze({
  business: [...Object.keys(PRUEFER.business), ...Object.keys(POS_BUSINESS_VALUES), ...Object.keys(KARTEN)],
  device: [...Object.keys(PRUEFER.device), ...Object.keys(POS_DEVICE_VALUES), 'shortcuts'],
  standard: { business: Object.keys(POS_BUSINESS_DEFAULTS), device: Object.keys(POS_DEVICE_DEFAULTS) },
});
