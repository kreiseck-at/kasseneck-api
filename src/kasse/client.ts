import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import {
  KASSE_BETRIEB_STANDARD, KASSE_GERAET_STANDARD, mergeKasseSettings,
  type KasseSettings, type KasseSettingsBetrieb, type KasseSettingsGeraet,
} from './settings.js';

/** Einstellungen lesen — Standard + gespeichert (Backend: `getKasseSettings`). */
export async function getKasseSettings(rufen: InternerTransport, options: { deviceId?: string } = {}): Promise<KasseSettings> {
  const params: Record<string, unknown> = {};
  if (options.deviceId) params.deviceId = options.deviceId;
  const daten = await rufen<{ betrieb?: unknown; geraet?: unknown }>('getKasseSettings', params);
  return {
    betrieb: mergeKasseSettings(KASSE_BETRIEB_STANDARD, (daten?.betrieb ?? null) as Partial<KasseSettingsBetrieb> | null),
    geraet: mergeKasseSettings(KASSE_GERAET_STANDARD, (daten?.geraet ?? null) as Partial<KasseSettingsGeraet> | null),
  };
}

function nichtLeer(name: string, block: object): void {
  if (!block || typeof block !== 'object' || Object.keys(block).length === 0) {
    throw new KasseneckValidationError(name, 'Keine Einstellungen uebergeben', 'request');
  }
}

/** Betriebsweite Einstellungen schreiben (Recht `layout`); liefert den gemischten Stand. */
export async function setMyKasseSettings(rufen: InternerTransport, betrieb: Partial<KasseSettingsBetrieb>): Promise<KasseSettingsBetrieb> {
  nichtLeer('setMyKasseSettings', betrieb);
  const daten = await rufen<{ betrieb?: unknown }>('setMyKasseSettings', { betrieb });
  return mergeKasseSettings(KASSE_BETRIEB_STANDARD, (daten?.betrieb ?? null) as Partial<KasseSettingsBetrieb> | null);
}

/** Geraete-Einstellungen schreiben (Recht `layout`); liefert den gemischten Stand. */
export async function setMyRegisterDeviceSettings(rufen: InternerTransport, deviceId: string, geraet: Partial<KasseSettingsGeraet>): Promise<KasseSettingsGeraet> {
  if (typeof deviceId !== 'string' || deviceId.trim() === '') {
    throw new KasseneckValidationError('setMyRegisterDeviceSettings', 'deviceId fehlt', 'request');
  }
  nichtLeer('setMyRegisterDeviceSettings', geraet);
  const daten = await rufen<{ geraet?: unknown }>('setMyRegisterDeviceSettings', { deviceId, geraet });
  return mergeKasseSettings(KASSE_GERAET_STANDARD, (daten?.geraet ?? null) as Partial<KasseSettingsGeraet> | null);
}
