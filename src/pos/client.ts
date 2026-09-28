import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import {
  POS_BUSINESS_DEFAULTS, POS_DEVICE_DEFAULTS, POS_BUSINESS_VALUES, POS_DEVICE_VALUES, POS_SHORTCUT_ACTIONS,
  mergePosSettings, posShortcutConflict, _istAltwert0x,
  type PosSettings, type PosBusinessSettings, type PosDeviceSettings,
} from './settings.js';

/*
 * Die Einstellungs-Aufrufe am Draht `/api/v3`: Parameter und Antwort heissen
 * `business`/`device`, Schluessel und Werte englisch (Nachtrag §11.7.2).
 *
 * **Nur geaenderte Felder senden** ([posSettingsChanges]), nie den ganzen
 * gemischten Block: der Server mischt tief, ein nicht geaenderter Wert, den
 * dieses Paket nicht kennt (`theme: 'sepia'`), bleibt so am Server stehen.
 * Gelesen wird er unveraendert ([unknownPosSettingValues] nennt ihn).
 *
 * Vor dem Senden prueft dieser Weg nur die gesendeten Felder (ein Feld mit
 * `undefined` geht nicht hinaus und wird nicht geprueft), und nur, was der
 * Server sicher abweist: einen
 * Schluessel, den es nicht gibt (auch einen deutschen aus 0.x wie `stil`),
 * einen Wert ausserhalb der Wertemenge des Feldes (`'nacht'`), eine
 * Steuersatz-Karte ohne einen Satz an und eine unbekannte Tasten-Aktion.
 * Der Fehler nennt den aeusseren Pfad wie das Backend (`business.theme`).
 * Alles Weitere (Bereiche, Chips, Farbformat) entscheidet der Server und
 * meldet es als `validation` mit `data.errors[].field`.
 */

/** Einstellungen lesen: Standard + gespeichert (Backend: `getKasseSettings`). */
export async function getPosSettings(transport: InternerTransport, options: { deviceId?: string } = {}): Promise<PosSettings> {
  const params: Record<string, unknown> = {};
  if (options.deviceId) params.deviceId = options.deviceId;
  const daten = await transport<{ business?: unknown; device?: unknown }>('getKasseSettings', params);
  return posSettingsFromWire(daten);
}

/** `{business, device}` einer Antwort, gemischt mit den Standardwerten. */
export function posSettingsFromWire(data: { business?: unknown; device?: unknown } | null | undefined): PosSettings {
  return {
    business: mergePosSettings(POS_BUSINESS_DEFAULTS, objekt(data?.business) as Partial<PosBusinessSettings> | null),
    device: mergePosSettings(POS_DEVICE_DEFAULTS, objekt(data?.device) as Partial<PosDeviceSettings> | null),
  };
}

/** Betriebsweite Einstellungen schreiben (Recht `layout`); liefert den gemischten Stand. */
export async function setMyPosSettings(transport: InternerTransport, business: Partial<PosBusinessSettings>): Promise<PosBusinessSettings> {
  const name = 'setMyKasseSettings';
  pruefeTeil(name, 'business', business, POS_BUSINESS_DEFAULTS, POS_BUSINESS_VALUES);
  const saetze = eigenerWert(business, 'vatRates');
  if (saetze !== undefined) {
    const karte = objekt(saetze);
    // Unter /v3 prueft der Server die uebergebene Karte fuer sich: ein
    // einzelner Schalter wie {20: false} waere dort "kein Satz an".
    if (!karte || !Object.values(karte).some((an) => an === true)) {
      throw new KasseneckValidationError(name, 'business.vatRates: mindestens ein Steuersatz muss an sein (immer die ganze Karte senden)', 'request');
    }
  }
  const daten = await transport<{ business?: unknown }>(name, { business });
  return mergePosSettings(POS_BUSINESS_DEFAULTS, objekt(daten?.business) as Partial<PosBusinessSettings> | null);
}

/**
 * Geraete-Einstellungen schreiben (Recht `layout`); liefert den gemischten
 * Stand. `shortcuts` nur als ganze Karte aller bekannten Aktionen
 * ([posSettingsChanges] liefert sie bei jeder Tastenaenderung), sonst wirft
 * der Aufruf vor dem Senden.
 */
export async function setMyRegisterDeviceSettings(transport: InternerTransport, deviceId: string, device: Partial<PosDeviceSettings>): Promise<PosDeviceSettings> {
  const name = 'setMyRegisterDeviceSettings';
  if (typeof deviceId !== 'string' || deviceId.trim() === '') {
    throw new KasseneckValidationError(name, 'deviceId fehlt', 'request');
  }
  pruefeTeil(name, 'device', device, POS_DEVICE_DEFAULTS, POS_DEVICE_VALUES);
  const tasten = eigenerWert(device, 'shortcuts');
  if (tasten !== undefined) {
    const karte = objekt(tasten);
    if (!karte) throw new KasseneckValidationError(name, 'device.shortcuts: keine Tastenkarte', 'request');
    const aktionen: ReadonlySet<string> = new Set(POS_SHORTCUT_ACTIONS);
    for (const aktion of Object.keys(karte)) {
      if (karte[aktion] === undefined) continue;
      if (!aktionen.has(aktion)) {
        throw new KasseneckValidationError(name, `device.shortcuts.${aktion}: unbekannte Aktion`, 'request');
      }
    }
    // Nur die ganze Karte: der Server prueft Doppelbelegungen nur in der
    // gesendeten Karte, eine halbe (`{cash: ['Mod+K']}`) liesse eine
    // Doppelbelegung mit einer gespeicherten Taste durch. posSettingsChanges
    // liefert bei jeder Tastenaenderung die ganze Karte.
    const fehlt = POS_SHORTCUT_ACTIONS.filter((a) => karte[a] === undefined);
    if (fehlt.length > 0) {
      throw new KasseneckValidationError(name, `device.shortcuts: ganze Karte senden (posSettingsChanges), es fehlen ${fehlt.join(', ')}`, 'request');
    }
    // Doppelbelegung in der ganzen Karte, also in der ganzen Belegung.
    const konflikt = posShortcutConflict(karte as Record<string, readonly string[] | undefined>);
    if (konflikt) {
      throw new KasseneckValidationError(name, `device.shortcuts.${konflikt.action}: Taste ${konflikt.key} schon belegt (${konflikt.heldBy})`, 'request');
    }
  }
  const daten = await transport<{ device?: unknown }>(name, { deviceId, device });
  return mergePosSettings(POS_DEVICE_DEFAULTS, objekt(daten?.device) as Partial<PosDeviceSettings> | null);
}

/** Eingabe von [setMyPosLogo]: ein Bild als Data-URL (PNG, JPEG, SVG) oder das Entfernen. */
export type SetMyPosLogoOptions = { image: string } | { remove: true };

/**
 * Bild-Logo der Kasse hochladen oder entfernen (Recht `layout`). Liefert die
 * neue `logoImage`-Adresse, nach dem Entfernen `''`. Formatfehler meldet der
 * Server als `logo_invalid_type`, `logo_too_large` oder `logo_invalid`.
 */
export async function setMyPosLogo(transport: InternerTransport, options: SetMyPosLogoOptions): Promise<string> {
  const name = 'setMyKasseLogo';
  const params: Record<string, unknown> = {};
  if ('remove' in options && options.remove === true) {
    params.remove = true;
  } else if ('image' in options && typeof options.image === 'string' && options.image !== '') {
    params.image = options.image;
  } else {
    throw new KasseneckValidationError(name, 'image fehlt (oder remove: true)', 'request');
  }
  const daten = await transport<{ logoImage?: unknown }>(name, params);
  const bild = daten?.logoImage;
  if (typeof bild !== 'string') {
    throw new KasseneckValidationError(name, 'Antwort enthaelt kein Feld "logoImage"', 'response');
  }
  return bild;
}

/** Eigene Eigenschaft oder `undefined`, nie eine geerbte (`constructor`, `toString`). */
function eigenerWert(block: object, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(block, k) ? (block as Record<string, unknown>)[k] : undefined;
}

function objekt(wert: unknown): Record<string, unknown> | null {
  return wert !== null && typeof wert === 'object' && !Array.isArray(wert) ? (wert as Record<string, unknown>) : null;
}

function pruefeTeil(
  name: string,
  teil: 'business' | 'device',
  block: unknown,
  standard: object,
  werte: Readonly<Record<string, readonly (string | number)[] | undefined>>,
): void {
  const karte = objekt(block);
  // Ein Feld mit `undefined` sendet JSON gar nicht: es zaehlt weder als
  // Einstellung noch wird es geprueft.
  const gesendet = karte ? Object.entries(karte).filter(([, wert]) => wert !== undefined) : [];
  if (gesendet.length === 0) {
    throw new KasseneckValidationError(name, `${teil}: keine Einstellungen uebergeben`, 'request');
  }
  for (const [schluessel, wert] of gesendet) {
    if (!Object.prototype.hasOwnProperty.call(standard, schluessel)) {
      throw new KasseneckValidationError(name, `${teil}.${schluessel}: unbekanntes Feld`, 'request');
    }
    const erlaubt = Object.prototype.hasOwnProperty.call(werte, schluessel) ? werte[schluessel] : undefined;
    if (erlaubt && !erlaubt.includes(wert as string | number)) {
      // Kein Altwert: dann ein Wert, den der Server kennt und dieses Paket
      // nicht. Er kam beim Lesen herein; wer den ganzen Block zurueckschickt,
      // braucht den Hinweis auf den richtigen Weg.
      const hinweis = _istAltwert0x(schluessel, wert)
        ? 'ungueltiger Wert (innere Form 0.x)'
        : 'ungueltiger Wert (vom Server unbekannt? nur geaenderte Felder senden: posSettingsChanges)';
      throw new KasseneckValidationError(name, `${teil}.${schluessel}: ${hinweis}`, 'request');
    }
  }
}
