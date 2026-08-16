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
export type KasseBelegAusgabe = 'qr' | 'druck' | 'mail' | 'sms' | 'fragen';
export type KasseLayout = 'rechts' | 'links' | 'vollbild';
export type KasseKatpos = 'oben' | 'links';
export type KasseHoehe = 'S' | 'M' | 'L';
export type KasseDruckerArt = 'netz' | 'bt' | 'usb';
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
  preisAnzeigen: boolean; ustAnzeigen: boolean; emoji: boolean; katFarben: boolean; freiErlaubt: boolean;
  saetze: Schalterkarte; menge: KasseMenge; notiz: boolean; suche: boolean; rabatt: 'aus' | 'an';
  zahlBar: boolean; zahlKarte: boolean; trinkgeld: boolean; tgModus: KasseTgModus; tgStufen: Schalterkarte;
  tgSplit: boolean; rueckgeld: boolean; schnellbar: boolean; kassierenModus: KasseKassierenModus;
  belegAusgabe: KasseBelegAusgabe; fertigSekunden: 0 | 3 | 5 | 10;
}

export interface KasseSettingsGeraet {
  layout: KasseLayout; katpos: KasseKatpos; spaltenExtra: number; hoehe: KasseHoehe; touch: boolean;
  druckerAn: boolean; druckerArt: KasseDruckerArt; druckerIp: string; druckerPort: number; druckerBt: string;
  papier: KassePapier; zeichensatz: KasseZeichensatz; schnitt: KasseSchnitt;
  ladeAn: boolean; ladeAuto: KasseLadeAuto;
  terminalIp: string; terminalPort: number;
}

export interface KasseSettings {
  betrieb: KasseSettingsBetrieb;
  geraet: KasseSettingsGeraet;
}

export const KASSE_BETRIEB_STANDARD: Readonly<KasseSettingsBetrieb> = Object.freeze({
  logoText: 'K', logoAn: true, logoGroesse: 'M', wasserzeichen: 'anmeldung', farbe: '#1B46F5',
  stil: 'klar', schrift: 'M', schriftEinst: 'S', kachelstil: 'streifen', uhr: true,
  sperrbild: true, foto: true, autoAbMin: 0, abNachVerkauf: false,
  preisAnzeigen: true, ustAnzeigen: false, emoji: true, katFarben: true, freiErlaubt: true,
  saetze: { 20: true, 13: true, 10: true, 4.9: true, 0: true, 19: false },
  menge: 'x', notiz: false, suche: false, rabatt: 'aus',
  zahlBar: true, zahlKarte: true, trinkgeld: false, tgModus: 'beides',
  tgStufen: { 5: true, 10: true, 15: false, 20: false }, tgSplit: true, rueckgeld: true,
  schnellbar: false, kassierenModus: 'seite',
  belegAusgabe: 'qr', fertigSekunden: 0,
});

export const KASSE_GERAET_STANDARD: Readonly<KasseSettingsGeraet> = Object.freeze({
  layout: 'rechts', katpos: 'oben', spaltenExtra: 0, hoehe: 'M', touch: false,
  druckerAn: false, druckerArt: 'netz', druckerIp: '', druckerPort: 9100, druckerBt: '',
  papier: 'mm80', zeichensatz: 'CP1252', schnitt: 'partial',
  ladeAn: false, ladeAuto: 'bar',
  terminalIp: '', terminalPort: 20008,
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
