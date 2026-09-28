import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import {
  POS_BUSINESS_DEFAULTS, POS_DEVICE_DEFAULTS, POS_BUSINESS_VALUES, POS_DEVICE_VALUES, POS_SHORTCUT_ACTIONS,
  mergePosSettings,
  type PosSettings, type PosBusinessSettings, type PosDeviceSettings,
} from './settings.js';

/*
 * Die Einstellungs-Aufrufe am Draht `/api/v3`: Parameter und Antwort heissen
 * `business`/`device`, Schluessel und Werte englisch (Nachtrag §11.7.2).
 *
 * Vor dem Senden prueft dieser Weg nur, was der Server sicher abweist: einen
 * Schluessel, den es nicht gibt (auch einen deutschen aus 0.x wie `stil`),
 * einen Wert ausserhalb der Wertemenge des Feldes (`'nacht'`), eine
 * Steuersatz-Karte ohne einen Satz an und eine unbekannte Tasten-Aktion.
 * Der Fehler nennt den aeusseren Pfad wie das Backend (`business.theme`).
 * Alles Weitere (Bereiche, Chips, Farbformat) entscheidet der Server und
 * meldet es als `validation` mit `data.errors[].field`.
 */

/** Einstellungen lesen: Standard + gespeichert (Backend: `getKasseSettings`). */
export async function getKasseSettings(rufen: InternerTransport, options: { deviceId?: string } = {}): Promise<PosSettings> {
  const params: Record<string, unknown> = {};
  if (options.deviceId) params.deviceId = options.deviceId;
  const daten = await rufen<{ business?: unknown; device?: unknown }>('getKasseSettings', params);
  return posSettingsFromWire(daten);
}

/** `{business, device}` einer Antwort, gemischt mit den Standardwerten. */
export function posSettingsFromWire(daten: { business?: unknown; device?: unknown } | null | undefined): PosSettings {
  return {
    business: mergePosSettings(POS_BUSINESS_DEFAULTS, objekt(daten?.business) as Partial<PosBusinessSettings> | null),
    device: mergePosSettings(POS_DEVICE_DEFAULTS, objekt(daten?.device) as Partial<PosDeviceSettings> | null),
  };
}

/** Betriebsweite Einstellungen schreiben (Recht `layout`); liefert den gemischten Stand. */
export async function setMyKasseSettings(rufen: InternerTransport, business: Partial<PosBusinessSettings>): Promise<PosBusinessSettings> {
  const name = 'setMyKasseSettings';
  pruefeTeil(name, 'business', business, POS_BUSINESS_DEFAULTS, POS_BUSINESS_VALUES);
  const saetze = (business as Record<string, unknown>).vatRates;
  if (saetze !== undefined) {
    const karte = objekt(saetze);
    // Unter /v3 prueft der Server die uebergebene Karte fuer sich: ein
    // einzelner Schalter wie {20: false} waere dort "kein Satz an".
    if (!karte || !Object.values(karte).some((an) => an === true)) {
      throw new KasseneckValidationError(name, 'business.vatRates: mindestens ein Steuersatz muss an sein (immer die ganze Karte senden)', 'request');
    }
  }
  const daten = await rufen<{ business?: unknown }>(name, { business });
  return mergePosSettings(POS_BUSINESS_DEFAULTS, objekt(daten?.business) as Partial<PosBusinessSettings> | null);
}

/** Geraete-Einstellungen schreiben (Recht `layout`); liefert den gemischten Stand. */
export async function setMyRegisterDeviceSettings(rufen: InternerTransport, deviceId: string, device: Partial<PosDeviceSettings>): Promise<PosDeviceSettings> {
  const name = 'setMyRegisterDeviceSettings';
  if (typeof deviceId !== 'string' || deviceId.trim() === '') {
    throw new KasseneckValidationError(name, 'deviceId fehlt', 'request');
  }
  pruefeTeil(name, 'device', device, POS_DEVICE_DEFAULTS, POS_DEVICE_VALUES);
  const tasten = (device as Record<string, unknown>).shortcuts;
  if (tasten !== undefined) {
    const karte = objekt(tasten);
    if (!karte) throw new KasseneckValidationError(name, 'device.shortcuts: keine Tastenkarte', 'request');
    const aktionen: ReadonlySet<string> = new Set(POS_SHORTCUT_ACTIONS);
    for (const aktion of Object.keys(karte)) {
      if (!aktionen.has(aktion)) {
        throw new KasseneckValidationError(name, `device.shortcuts.${aktion}: unbekannte Aktion`, 'request');
      }
    }
  }
  const daten = await rufen<{ device?: unknown }>(name, { deviceId, device });
  return mergePosSettings(POS_DEVICE_DEFAULTS, objekt(daten?.device) as Partial<PosDeviceSettings> | null);
}

/** Eingabe von [setMyKasseLogo]: ein Bild als Data-URL (PNG, JPEG, SVG) oder das Entfernen. */
export type SetMyKasseLogoOptions = { image: string } | { remove: true };

/**
 * Bild-Logo der Kasse hochladen oder entfernen (Recht `layout`). Liefert die
 * neue `logoImage`-Adresse, nach dem Entfernen `''`. Formatfehler meldet der
 * Server als `logo_invalid_type`, `logo_too_large` oder `logo_invalid`.
 */
export async function setMyKasseLogo(rufen: InternerTransport, options: SetMyKasseLogoOptions): Promise<string> {
  const name = 'setMyKasseLogo';
  const params: Record<string, unknown> = {};
  if ('remove' in options && options.remove === true) {
    params.remove = true;
  } else if ('image' in options && typeof options.image === 'string' && options.image !== '') {
    params.image = options.image;
  } else {
    throw new KasseneckValidationError(name, 'image fehlt (oder remove: true)', 'request');
  }
  const daten = await rufen<{ logoImage?: unknown }>(name, params);
  const bild = daten?.logoImage;
  if (typeof bild !== 'string') {
    throw new KasseneckValidationError(name, 'Antwort enthaelt kein Feld "logoImage"', 'response');
  }
  return bild;
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
  if (!karte || Object.keys(karte).length === 0) {
    throw new KasseneckValidationError(name, `${teil}: keine Einstellungen uebergeben`, 'request');
  }
  for (const [schluessel, wert] of Object.entries(karte)) {
    if (!(schluessel in standard)) {
      throw new KasseneckValidationError(name, `${teil}.${schluessel}: unbekanntes Feld`, 'request');
    }
    const erlaubt = werte[schluessel];
    if (erlaubt && wert !== undefined && !erlaubt.includes(wert as string | number)) {
      throw new KasseneckValidationError(name, `${teil}.${schluessel}: ungueltiger Wert`, 'request');
    }
  }
}
