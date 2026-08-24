/**
 * Kassen-Einstellungen der Browser-Kasse — Zwilling von
 * `functions/kasse-settings-core.js` (Backend, dort mit Validator).
 *
 * Betriebsweit (`register_settings.kasse` am Konto) und je Geraet
 * (`register_devices/{id}.kasse`). Die Standardwerte stehen hier UND im
 * Backend; ein Test in beiden Repos haelt sie deckungsgleich. Trinkgeld ist
 * bewusst AUS, bis die Buchung geklaert ist (Spec kachel-kasse § 9).
 */

/*
 * Jedes Enum steht als Liste zur Laufzeit da, der Typ leitet sich daraus ab
 * (`typeof LISTE[number]`). So gibt es die Werte nur einmal, und die Zwillinge
 * (Backend-Validator, Flutter-Paket) koennen gegen dieselben Listen pruefen,
 * statt sie abzuschreiben.
 */

export const STIL = ['klar', 'warm', 'nacht', 'kontrast'] as const;
export type KasseStil = typeof STIL[number];
export const SCHRIFT = ['S', 'M', 'L', 'XL'] as const;
export type KasseSchrift = typeof SCHRIFT[number];
export const WASSERZEICHEN = ['aus', 'anmeldung', 'ueberall'] as const;
export type KasseWasserzeichen = typeof WASSERZEICHEN[number];
export const MENGE = ['aus', 'x', 'kg'] as const;
export type KasseMenge = typeof MENGE[number];
export const TG_MODUS = ['betrag', 'gesamt', 'beides'] as const;
export type KasseTgModus = typeof TG_MODUS[number];
export const KASSIEREN_MODUS = ['seite', 'panel'] as const;
export type KasseKassierenModus = typeof KASSIEREN_MODUS[number];
/** Kartenanbieter: Karte gibt es erst mit eingerichtetem Anbieter; 'extern' = eigenes Terminal ohne Anbindung. */
export const KARTENANBIETER = ['keiner', 'extern', 'gptom', 'hobex', 'mypos', 'stripe'] as const;
export type KasseKartenanbieter = typeof KARTENANBIETER[number];
export const BELEG_AUSGABE = ['qr', 'druck', 'mail', 'sms', 'fragen'] as const;
export type KasseBelegAusgabe = typeof BELEG_AUSGABE[number];
export const LAYOUT = ['rechts', 'links', 'vollbild'] as const;
export type KasseLayout = typeof LAYOUT[number];
export const KATPOS = ['oben', 'links'] as const;
export type KasseKatpos = typeof KATPOS[number];
export const HOEHE = ['S', 'M', 'L'] as const;
export type KasseHoehe = typeof HOEHE[number];
/**
 * `sdp` = Netzwerk ueber Epson Server Direct Print (der Drucker holt Jobs vom Backend, jeder Browser druckt).
 * `connect` = Kasseneck Connect (lokaler Agent auf dem Kassen-Rechner druckt fuer die Browser-Kasse).
 */
export const DRUCKER_ART = ['sdp', 'netz', 'bt', 'usb', 'connect'] as const;
export type KasseDruckerArt = typeof DRUCKER_ART[number];
/** Terminal-Ansprache: direkt per IP (wie bisher) oder ueber Kasseneck Connect (Agent leitet weiter). */
export const TERMINAL_VIA = ['direkt', 'connect'] as const;
export type KasseTerminalVia = typeof TERMINAL_VIA[number];
/** Art des Kartenterminals an dieser Kasse: keines oder Hobex HPS (JSON-REST am Geraet). */
export const TERMINAL_ART = ['keins', 'hps'] as const;
export type KasseTerminalArt = typeof TERMINAL_ART[number];
export const PAPIER = ['mm58', 'mm80'] as const;
export type KassePapier = typeof PAPIER[number];
export const ZEICHENSATZ = ['CP1252', 'CP437'] as const;
export type KasseZeichensatz = typeof ZEICHENSATZ[number];
export const SCHNITT = ['partial', 'full', 'none'] as const;
export type KasseSchnitt = typeof SCHNITT[number];
export const LADE_AUTO = ['bar', 'immer', 'nie'] as const;
export type KasseLadeAuto = typeof LADE_AUTO[number];

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
  /** Bild-Logo (Download-URL aus dem Kasse-Upload); '' = Kuerzel verwenden. */
  logoBild: string;
  /** Seite des Wasserzeichens — ALT: abgeloest von wzPos, bleibt fuers Mischen alter Staende. */
  wzSeite: 'links' | 'mitte' | 'rechts';
  /** Horizontale Lage der Wasserzeichen-MITTE in Prozent (-25 bis 125 — darf ueber den Rand hinaus). */
  wzPos: number;
  /** Vertikale Lage der Wasserzeichen-Mitte in Prozent (-25 bis 125). */
  wzPosV: number;
  /** Deckkraft des Wasserzeichens in Prozent — bewusst Stufen, kein Schieberegler. */
  wzStaerke: 3 | 6 | 10 | 16;
  /** Groesse des Bild-Logos am BELEG (Ansicht, PDF, Kopfzeile). */
  logoSkala: 'S' | 'M' | 'L' | 'XL';
  /** Groesse des Wasserzeichens — getrennt vom Beleg-Logo. */
  wzSkala: 'S' | 'M' | 'L' | 'XL';
  zahlBar: boolean; zahlKarte: boolean; kartenanbieter: KasseKartenanbieter; trinkgeld: boolean; tgModus: KasseTgModus; tgStufen: Schalterkarte;
  tgSplit: boolean; rueckgeld: boolean; schnellbar: boolean; kassierenModus: KasseKassierenModus;
  /** Trinkgeld-Chips in Prozent (eine Nachkommastelle, max 5, eindeutig, Reihenfolge des Chefs). */
  tgChips: number[];
  /** Rabatt-Chips in Prozent — dieselben Regeln wie tgChips, vom Chef einstellbar. */
  rabattChips: number[];
  belegAusgabe: KasseBelegAusgabe; fertigSekunden: 0 | 3 | 5 | 10 | 15 | 30 | 60;
  /** Glas-Optik: Kacheln und Korb leicht durchscheinend (Wasserzeichen schimmert). */
  glas: boolean;
  /** Hilfetexte in den Chef-Einstellungen anzeigen. */
  hinweise: boolean;
}

/** Aktionen der Kasse, die eine Taste bekommen koennen. */
export const KASSE_TASTEN_AKTIONEN = ['kassieren', 'abschliessen', 'abbrechen', 'frei', 'bar', 'karte', 'passend', 'belege', 'letzteZurueck', 'einstellungen', 'abmelden', 'trinkgeld', 'vollbild', 'gegebenLeeren', 'korbLeeren'] as const;
export type KasseTastenAktion = typeof KASSE_TASTEN_AKTIONEN[number];
/** Kurzer Name, damit alle Enum-Listen gleich heissen; der alte bleibt gueltig. */
export const TASTEN_AKTIONEN = KASSE_TASTEN_AKTIONEN;
/** Tastenkarte: Aktion -> Tasten (`Mod+F`, `Enter`, `Escape`, `F5` ...; `Mod` = ⌘ auf dem Mac, Strg sonst). */
export type KasseTastenkarte = Record<KasseTastenAktion, string[]>;
export const KASSE_TASTEN_STANDARD: Readonly<KasseTastenkarte> = Object.freeze({
  kassieren: ['Enter'], abschliessen: ['Enter'], abbrechen: ['Escape'],
  // Mod+F gehoert dem Vollbild; Betrag frei liegt auf D. Bar bleibt auf B,
  // Belege auf E (Entscheidung vom 21.8., der Tausch von 0.6.25 ist zurueck).
  frei: ['Mod+D'], bar: ['Mod+B'], karte: ['Mod+K'], passend: ['Mod+P'],
  // NICHT Mod+E: das faengt Chrome auf dem Mac selbst ab („Auswahl fuer
  // Suche verwenden") — am Geraet belegt. J wie Journal laesst er durch.
  belege: ['Mod+J'], letzteZurueck: ['Mod+Backspace'],
  // NICHT Mod+T: die Taste ist im Browser reserviert (neuer Tab) und kommt
  // nie bei der Seite an. Mod+G laesst Chrome durch.
  einstellungen: ['Mod+S'], abmelden: ['Mod+L'], trinkgeld: ['Mod+G'],
  vollbild: ['Mod+F'],
  // Mod+C = Kopieren des Browsers — im Kassieren-Schritt ist Kopieren fern,
  // und die Bindung gilt nur dort (Bar + Rueckgeld-Rechner an).
  gegebenLeeren: ['Mod+C'],
  // Bewusst DIESELBE Taste wie gegebenLeeren: die beiden leben in
  // verschiedenen Momenten (Korb vor dem Kassieren, Gegeben-Feld darin) —
  // der Verteiler laesst die nicht zustaendige Aktion durchfallen.
  korbLeeren: ['Mod+C'],
});

export interface KasseSettingsGeraet {
  layout: KasseLayout; katpos: KasseKatpos; spaltenExtra: number; hoehe: KasseHoehe; touch: boolean;
  /** Tastenbelegung dieses Geraets (Vorgabe KASSE_TASTEN_STANDARD, je Aktion mischbar). */
  tasten: KasseTastenkarte;
  druckerAn: boolean; druckerArt: KasseDruckerArt; druckerIp: string; druckerPort: number; druckerBt: string;
  /** Klartextname des gemerkten Druckers; sonst stuende dort eine nackte Bluetooth-Adresse. */
  druckerName: string;
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
  /** Tastenmarken (die kleinen Kuerzel an den Knoepfen) anzeigen. */
  tastenMarken: boolean;
  /** Terminal-ID aus dem Hobex-Vertrag (ohne fuehrende Null); noetig fuer Diagnose und Zahlung. */
  terminalTid: string;
}

export interface KasseSettings {
  betrieb: KasseSettingsBetrieb;
  geraet: KasseSettingsGeraet;
}

export const KASSE_BETRIEB_STANDARD: Readonly<KasseSettingsBetrieb> = Object.freeze({
  // Petrol aus der Markenpalette ("Ecke, Aktion") — nicht das alte Blau.
  logoText: 'K', logoAn: true, logoGroesse: 'M', wasserzeichen: 'anmeldung', farbe: '#116B6B',
  stil: 'klar', schrift: 'M', schriftEinst: 'S', kachelstil: 'streifen', uhr: true,
  sperrbild: true, foto: true, autoAbMin: 0, abNachVerkauf: false, schnellLogin: true,
  preisAnzeigen: true, ustAnzeigen: false, emoji: true, katFarben: true, freiErlaubt: true,
  saetze: { 20: true, 13: true, 10: true, 4.9: true, 0: true, 19: false },
  menge: 'x', notiz: false, suche: false, rabatt: 'aus',
  zahlBar: true, zahlKarte: false, kartenanbieter: 'keiner', trinkgeld: false, tgModus: 'beides',
  tgStufen: { 5: true, 10: true, 15: false, 20: false }, tgChips: [5, 10], tgSplit: true, rueckgeld: true,
  schnellbar: false, kassierenModus: 'seite',
  // 'fragen' = Fertig-Seite bietet QR und Bon an — sicherster Standard.
  logoBild: '', wzSeite: 'mitte', wzPos: 50, wzPosV: 50, wzStaerke: 6, logoSkala: 'M', wzSkala: 'M',
  glas: true, hinweise: true,
  rabattChips: [5, 10, 15, 20],
  belegAusgabe: 'fragen', fertigSekunden: 0,
});

export const KASSE_GERAET_STANDARD: Readonly<KasseSettingsGeraet> = Object.freeze({
  layout: 'rechts', katpos: 'oben', spaltenExtra: 0, hoehe: 'M', touch: false,
  tasten: { ...KASSE_TASTEN_STANDARD },
  druckerAn: false, druckerArt: 'sdp', druckerIp: '', druckerPort: 9100, druckerBt: '', druckerName: '', druckerId: '', druckerDevid: 'local_printer',
  connectDruckerId: '',
  papier: 'mm80', zeichensatz: 'CP1252', schnitt: 'partial',
  ladeAn: false, ladeAuto: 'bar',
  terminalIp: '', terminalPort: 8080, terminalVia: 'direkt',
  terminalArt: 'keins', terminalTid: '', tastenMarken: true,
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
