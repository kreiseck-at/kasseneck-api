import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import type { TipRecipient } from '../models/index.js';

/**
 * Die Personen, denen dieser Aufrufer Trinkgeld zuweisen kann.
 *
 * Es ist **dieselbe Menge**, die `createReceipt` akzeptiert — wer hier steht,
 * wird beim Verkauf nicht zurueckgewiesen. Ist ein Kassen-Benutzer ohne das
 * Recht `tipAssign` angemeldet, steht nur er selbst darin.
 */
export async function listMyTipRecipients(rufen: InternerTransport): Promise<TipRecipient[]> {
  const daten = await rufen<{ recipients?: unknown }>('listMyTipRecipients');
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
