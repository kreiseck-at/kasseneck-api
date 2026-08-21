/**
 * Kassen-Einstellungen der Browser-Kasse — Zwilling von
 * `functions/kasse-settings-core.js` (Backend, dort mit Validator).
 *
 * Betriebsweit (`register_settings.kasse` am Konto) und je Geraet
 * (`register_devices/{id}.kasse`). Die Standardwerte stehen hier UND im
 * Backend; ein Test in beiden Repos haelt sie deckungsgleich. Trinkgeld ist
 * bewusst AUS, bis die Buchung geklaert ist (Spec kachel-kasse § 9).
 */

export type KasseStil = 'klar' | 'warm' | 'nacht' | 'kontrast';
export type KasseSchrift = 'S' | 'M' | 'L' | 'XL';
export type KasseWasserzeichen = 'aus' | 'anmeldung' | 'ueberall';
export type KasseMenge = 'aus' | 'x' | 'kg';
export type KasseTgModus = 'betrag' | 'gesamt' | 'beides';
export type KasseKassierenModus = 'seite' | 'panel';
/** Kartenanbieter: Karte gibt es erst mit eingerichtetem Anbieter; 'extern' = eigenes Terminal ohne Anbindung. */
export type KasseKartenanbieter = 'keiner' | 'extern' | 'hobex' | 'mypos' | 'stripe';
export const KARTENANBIETER: readonly KasseKartenanbieter[] = ['keiner', 'extern', 'hobex', 'mypos', 'stripe'];
export type KasseBelegAusgabe = 'qr' | 'druck' | 'mail' | 'sms' | 'fragen';
export type KasseLayout = 'rechts' | 'links' | 'vollbild';
export type KasseKatpos = 'oben' | 'links';
export type KasseHoehe = 'S' | 'M' | 'L';
/**
 * `sdp` = Netzwerk ueber Epson Server Direct Print (der Drucker holt Jobs vom Backend, jeder Browser druckt).
 * `connect` = Kasseneck Connect (lokaler Agent auf dem Kassen-Rechner druckt fuer die Browser-Kasse).
 */
export type KasseDruckerArt = 'sdp' | 'netz' | 'bt' | 'usb' | 'connect';
/** Terminal-Ansprache: direkt per IP (wie bisher) oder ueber Kasseneck Connect (Agent leitet weiter). */
export type KasseTerminalVia = 'direkt' | 'connect';
/** Art des Kartenterminals an dieser Kasse: keines oder Hobex HPS (JSON-REST am Geraet). */
export type KasseTerminalArt = 'keins' | 'hps';
export type KassePapier = 'mm58' | 'mm80';
export type KasseZeichensatz = 'CP1252' | 'CP437';
export type KasseSchnitt = 'partial' | 'full' | 'none';
export type KasseLadeAuto = 'bar' | 'immer' | 'nie';

/** Schalter-Landkarte: Steuersaetze / Trinkgeldstufen (Schluessel = Wert als Text). */
export type Schalterkarte = Record<string, boolean>;

export interface KasseSettingsBetrieb {
  logoText: string; logoAn: boolean; logoGroesse: 'S' | 'M' | 'L'; wasserzeichen: KasseWasserzeichen; farbe: string;
  stil: KasseStil; schrift: KasseSchrift; schriftEinst: 'S' | 'M' | 'L'; kachelstil: 'streifen' | 'voll'; uhr: boolean;
  sperrbild: boolean; foto: boolean; autoAbMin: 0 | 1 | 5 | 15 | 30; abNachVerkauf: boolean;
  /** Schnelles Entsperren mit gemerkter PIN (lokal, Server-Login laeuft nach); aus = streng, jeder Login wartet. */
  schnellLogin: boolean;
  preisAnzeigen: boolean; ustAnzeigen: boolean; emoji: boolean; katFarben: boolean; freiErlaubt: boolean;
  saetze: Schalterkarte; menge: KasseMenge; notiz: boolean; suche: boolean; rabatt: 'aus' | 'an';
  zahlBar: boolean; zahlKarte: boolean; kartenanbieter: KasseKartenanbieter; trinkgeld: boolean; tgModus: KasseTgModus; tgStufen: Schalterkarte;
  tgSplit: boolean; rueckgeld: boolean; schnellbar: boolean; kassierenModus: KasseKassierenModus;
  /** Trinkgeld-Chips in Prozent (eine Nachkommastelle, max 5, eindeutig, Reihenfolge des Chefs). */
  tgChips: number[];
  belegAusgabe: KasseBelegAusgabe; fertigSekunden: 0 | 3 | 5 | 10 | 15 | 30 | 60;
}

/** Aktionen der Kasse, die eine Taste bekommen koennen. */
export type KasseTastenAktion = 'kassieren' | 'abschliessen' | 'abbrechen' | 'frei' | 'bar' | 'karte' | 'passend' | 'belege' | 'letzteZurueck' | 'einstellungen' | 'abmelden' | 'trinkgeld' | 'vollbild' | 'gegebenLeeren';
export const KASSE_TASTEN_AKTIONEN: readonly KasseTastenAktion[] = ['kassieren', 'abschliessen', 'abbrechen', 'frei', 'bar', 'karte', 'passend', 'belege', 'letzteZurueck', 'einstellungen', 'abmelden', 'trinkgeld', 'vollbild', 'gegebenLeeren'];
/** Tastenkarte: Aktion -> Tasten (`Mod+F`, `Enter`, `Escape`, `F5` ...; `Mod` = ⌘ auf dem Mac, Strg sonst). */
export type KasseTastenkarte = Record<KasseTastenAktion, string[]>;
export const KASSE_TASTEN_STANDARD: Readonly<KasseTastenkarte> = Object.freeze({
  kassieren: ['Enter'], abschliessen: ['Enter'], abbrechen: ['Escape'],
  // Mod+F gehoert dem Vollbild; Betrag frei liegt auf D. Bar bleibt auf B,
  // Belege auf E (Entscheidung vom 21.8., der Tausch von 0.6.25 ist zurueck).
  frei: ['Mod+D'], bar: ['Mod+B'], karte: ['Mod+K'], passend: ['Mod+P'],
  belege: ['Mod+E'], letzteZurueck: ['Mod+Backspace'],
  // NICHT Mod+T: die Taste ist im Browser reserviert (neuer Tab) und kommt
  // nie bei der Seite an. Mod+G laesst Chrome durch.
  einstellungen: ['Mod+S'], abmelden: ['Mod+L'], trinkgeld: ['Mod+G'],
  vollbild: ['Mod+F'],
  // Mod+C = Kopieren des Browsers — im Kassieren-Schritt ist Kopieren fern,
  // und die Bindung gilt nur dort (Bar + Rueckgeld-Rechner an).
  gegebenLeeren: ['Mod+C'],
});

export interface KasseSettingsGeraet {
  layout: KasseLayout; katpos: KasseKatpos; spaltenExtra: number; hoehe: KasseHoehe; touch: boolean;
  /** Tastenbelegung dieses Geraets (Vorgabe KASSE_TASTEN_STANDARD, je Aktion mischbar). */
  tasten: KasseTastenkarte;
  druckerAn: boolean; druckerArt: KasseDruckerArt; druckerIp: string; druckerPort: number; druckerBt: string;
  /** Kennung des Netzwerk-Druckers (Server Direct Print) aus `listMyPrinters`; '' = keiner gewaehlt. */
  druckerId: string;
  /** ePOS Device-ID bei `druckerArt 'netz'` (Epson direkt per IP), Vorgabe `local_printer`. */
  druckerDevid: string;
  /** Kennung des Druckers im lokalen Kasseneck-Connect-Agenten, bei `druckerArt 'connect'`. */
  connectDruckerId: string;
  papier: KassePapier; zeichensatz: KasseZeichensatz; schnitt: KasseSchnitt;
  ladeAn: boolean; ladeAuto: KasseLadeAuto;
  terminalIp: string; terminalPort: number; terminalVia: KasseTerminalVia;
  /** Art des Terminals ('keins' = Kartenzahlung ohne Terminal-Anbindung gesperrt, sofern zahlKarte an). */
  terminalArt: KasseTerminalArt;
  /** Terminal-ID aus dem Hobex-Vertrag (ohne fuehrende Null); noetig fuer Diagnose und Zahlung. */
  terminalTid: string;
}

export interface KasseSettings {
  betrieb: KasseSettingsBetrieb;
  geraet: KasseSettingsGeraet;
}

export const KASSE_BETRIEB_STANDARD: Readonly<KasseSettingsBetrieb> = Object.freeze({
  logoText: 'K', logoAn: true, logoGroesse: 'M', wasserzeichen: 'anmeldung', farbe: '#1B46F5',
  stil: 'klar', schrift: 'M', schriftEinst: 'S', kachelstil: 'streifen', uhr: true,
  sperrbild: true, foto: true, autoAbMin: 0, abNachVerkauf: false, schnellLogin: true,
  preisAnzeigen: true, ustAnzeigen: false, emoji: true, katFarben: true, freiErlaubt: true,
  saetze: { 20: true, 13: true, 10: true, 4.9: true, 0: true, 19: false },
  menge: 'x', notiz: false, suche: false, rabatt: 'aus',
  zahlBar: true, zahlKarte: false, kartenanbieter: 'keiner', trinkgeld: false, tgModus: 'beides',
  tgStufen: { 5: true, 10: true, 15: false, 20: false }, tgChips: [5, 10], tgSplit: true, rueckgeld: true,
  schnellbar: false, kassierenModus: 'seite',
  // 'fragen' = Fertig-Seite bietet QR und Bon an — sicherster Standard.
  belegAusgabe: 'fragen', fertigSekunden: 0,
});

export const KASSE_GERAET_STANDARD: Readonly<KasseSettingsGeraet> = Object.freeze({
  layout: 'rechts', katpos: 'oben', spaltenExtra: 0, hoehe: 'M', touch: false,
  tasten: { ...KASSE_TASTEN_STANDARD },
  druckerAn: false, druckerArt: 'sdp', druckerIp: '', druckerPort: 9100, druckerBt: '', druckerId: '', druckerDevid: 'local_printer',
  connectDruckerId: '',
  papier: 'mm80', zeichensatz: 'CP1252', schnitt: 'partial',
  ladeAn: false, ladeAuto: 'bar',
  terminalIp: '', terminalPort: 8080, terminalVia: 'direkt',
  terminalArt: 'keins', terminalTid: '',
});

/**
 * Standard + gespeichert. Landkarten (`saetze`, `tgStufen`) werden je Schluessel
 * gemischt, damit neue Saetze beim Altbestand ankommen; unbekannte Schluessel
 * bleiben draussen (die Wahrheit ueber Gueltigkeit hat der Server).
 */
export function mergeKasseSettings<T extends object>(standard: Readonly<T>, gespeichert: Partial<T> | null | undefined): T {
  const out = JSON.parse(JSON.stringify(standard)) as Record<string, unknown>;
  if (gespeichert && typeof gespeichert === 'object') {
    for (const [key, wert] of Object.entries(gespeichert as Record<string, unknown>)) {
      if (!(key in out)) continue;
      const alt = out[key];
      if (alt && typeof alt === 'object' && !Array.isArray(alt) && wert && typeof wert === 'object' && !Array.isArray(wert)) {
        out[key] = { ...(alt as Record<string, unknown>), ...(wert as Record<string, unknown>) };
      } else if (wert !== undefined) {
        out[key] = wert;
      }
    }
  }
  return out as T;
}
