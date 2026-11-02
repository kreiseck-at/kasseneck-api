import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';

/**
 * Was die Kasse ueber Kasseneck Connect an Kasseneck meldet (Bestand: welche Connect-Version an welchem
 * Kassengeraet laeuft). Nur Angaben, die die Kasse von Connect liest – nie IP, Rechner- oder Benutzername.
 * Aeltere Connect-Versionen kennen `osVersion`, `arch` und `features` nicht: dann `null` bzw. `[]`.
 */
export interface ConnectStateReport {
  /** Kassengeraet, an dem Connect laeuft. */
  deviceId: string;
  /** Connect-Version, z. B. `1.4.0`. */
  version: string;
  /** `macos`, `windows` oder `linux`. */
  os: string;
  osVersion: string | null;
  arch: string | null;
  /** Faehigkeiten aus `GET /v1/status` (`bluetooth`, `https`, `update` …). */
  features: string[];
  /** Ob HTTPS vertraut ist (`tls.trusted`), `null` ohne HTTPS. */
  httpsTrusted: boolean | null;
  /** Bluetooth-Stand (`poweredOn`, `poweredOff`, `unauthorized` …), `null` ohne Bluetooth. */
  bluetooth: string | null;
}

const FELDER: ReadonlyArray<keyof ConnectStateReport> = ['deviceId', 'version', 'os', 'osVersion', 'arch', 'features', 'httpsTrusted', 'bluetooth'];

/**
 * Meldet den Stand von Kasseneck Connect an diesem Kassengeraet (`reportConnectState`, nur Kassenweg).
 * Geprueft wird nur die Form; was der Server nicht annimmt, lehnt er mit `invalid_connect_report` ab.
 */
export async function reportConnectState(transport: InternerTransport, report: ConnectStateReport): Promise<void> {
  const name = 'reportConnectState';
  const anfrage = (grund: string) => new KasseneckValidationError(name, grund, 'request');
  if (report === null || typeof report !== 'object' || Array.isArray(report)) throw anfrage('Anfrage muss ein Objekt sein');
  const fremd = Object.keys(report).find((k) => !(FELDER as readonly string[]).includes(k));
  if (fremd != null) throw anfrage(`unbekanntes Feld "${fremd}"`);
  const text = (v: unknown) => typeof v === 'string' && v.length > 0;
  const textOderNull = (v: unknown) => v === null || typeof v === 'string';
  if (!text(report.deviceId)) throw anfrage('deviceId fehlt');
  if (!text(report.version)) throw anfrage('version fehlt');
  if (!text(report.os)) throw anfrage('os fehlt');
  if (!textOderNull(report.osVersion)) throw anfrage('osVersion muss Text oder null sein');
  if (!textOderNull(report.arch)) throw anfrage('arch muss Text oder null sein');
  if (!Array.isArray(report.features) || !report.features.every((f) => typeof f === 'string')) throw anfrage('features muss eine Liste von Texten sein');
  if (!(report.httpsTrusted === null || typeof report.httpsTrusted === 'boolean')) throw anfrage('httpsTrusted muss true, false oder null sein');
  if (!textOderNull(report.bluetooth)) throw anfrage('bluetooth muss Text oder null sein');
  await transport<unknown>(name, {
    deviceId: report.deviceId, version: report.version, os: report.os, osVersion: report.osVersion, arch: report.arch,
    features: [...report.features], httpsTrusted: report.httpsTrusted, bluetooth: report.bluetooth,
  });
}
