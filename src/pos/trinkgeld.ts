import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import type { TipRecipient } from '../models/index.js';
import { anfrage } from '../inventory/schreiben.js';
import { tipStand, type Ort } from './schicht-lesen.js';
import type { TipBalance } from './schicht-typen.js';
import type { TipPaymentKind } from './settings.js';
import type { LabelKey } from './texte.js';

/**
 * Die Personen, denen dieser Aufrufer Trinkgeld zuweisen kann.
 *
 * Es ist **dieselbe Menge**, die `createReceipt` akzeptiert — wer hier steht,
 * wird beim Verkauf nicht zurueckgewiesen. Ist ein Kassen-Benutzer ohne das
 * Recht `tipAssign` angemeldet, steht nur er selbst darin.
 */
export async function listMyTipRecipients(transport: InternerTransport): Promise<TipRecipient[]> {
  const daten = await transport<{ recipients?: unknown }>('listMyTipRecipients');
  const roh = daten?.recipients;
  if (!Array.isArray(roh)) {
    // Keine Liste ist etwas anderes als eine leere Liste: „noch niemand
    // angelegt" darf nicht aussehen wie „Antwort kaputt".
    throw new KasseneckValidationError('listMyTipRecipients', 'Antwort enthaelt keine Liste (data.recipients fehlt)', 'response');
  }
  return roh.map((e) => {
    const d = (e ?? {}) as Record<string, unknown>;
    // Dieselbe Gestalt wie der Empfaenger am Beleg-Item — `TipRecipient` aus
    // src/models/receipt-item.ts. Kein neuer Typ: „wer kann Trinkgeld
    // bekommen" und „wer hat es bekommen" sind dieselbe Sache.
    return { registerUserId: String(d.registerUserId ?? ''), name: String(d.name ?? ''), owner: d.owner === true };
  });
}

export interface GetMyTipBalanceOptions {
  /** Ohne Angabe gilt die Hauptlade der Kasse (`cashregisterId`). */
  drawerId?: string;
  cashregisterId?: string;
}

/**
 * „Mein Trinkgeld“ (Spec 2026-11-11-kartentrinkgeld, § 4.6, § 5): der Trinkgeld-Stand der angemeldeten Person an
 * dieser Lade -- offen (auch negativ: zu viel ausgezahlt), heute schon genommen, andere Laden mit offenem Betrag.
 * Nur ueber den Kassenweg `/api/v3` und nur fuer eine persoenliche Anmeldung (Kassen-Benutzer `kind: person`);
 * eine gemeinsame Geraete-Anmeldung und der Inhaber bekommen `not_a_person_login`. Nie der Stand einer anderen
 * Person. Lesen ohne Wirkung.
 */
export async function getMyTipBalance(transport: InternerTransport, options: GetMyTipBalanceOptions = {}): Promise<TipBalance> {
  const name = 'getMyTipBalance';
  const p = anfrage(name, options);
  if (p.drawerId === '') delete p.drawerId;
  const ort: Ort = { name, pfad: '', scope: 'response' };
  return tipStand(ort, await transport(name, p));
}

/** Was mit dem Trinkgeld dieses Verkaufs geschieht ([tipStatus]). */
export type TipStatusKind = 'kept' | 'open';

/** Ergebnis von [tipStatus]: `kept` = gleich behalten, `open` = offen; `key` die Zeile aus dem Katalog mit `{amount}`. */
export interface TipStatus {
  status: TipStatusKind;
  key: LabelKey;
}

/**
 * Die eine Zeile beim Kassieren und auf der Fertig-Seite (Spec 2026-11-11-kartentrinkgeld, § 4.4): sie sagt, was
 * mit dem Mitarbeiter-Trinkgeld wirklich geschieht -- nicht die Stufe, sondern das Ergebnis von `tipKeptFor` (und
 * bei Karte der Deckung durch das Soll, F1). Bar: „{amount} gleich einstecken“ / „{amount} in der Lade lassen“,
 * Karte: „{amount} aus der Lade nehmen“ / „{amount} später auszahlen“. Den Text liefert `labelText(key, { amount })`.
 */
export function tipStatus(method: TipPaymentKind, kept: boolean): TipStatus {
  if (method === 'card') return kept ? { status: 'kept', key: 'tip.line_card_kept' } : { status: 'open', key: 'tip.line_card_open' };
  return kept ? { status: 'kept', key: 'tip.line_cash_kept' } : { status: 'open', key: 'tip.line_cash_open' };
}
