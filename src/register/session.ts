import { KasseneckValidationError } from '../client/errors.js';
import type { InternerTransport } from '../client/aufrufe.js';

/**
 * Die beiden Aufrufe der **laufenden** Kassen-Sitzung. Anders als die drei in
 * pairing.ts haben sie eine Identitaet: sie laufen ueber `registerUserAuth`
 * (ID-Token als Bearer, Sitzung als Kopfzeile `register-session`) und nehmen
 * darum einen fertigen [KasseneckTransport] entgegen wie jeder andere
 * Endpunkt-Aufruf dieses Pakets.
 *
 * Beide fuehren **keinen einzigen Parameter**: welche Sitzung gemeint ist,
 * steht im Token und in der Kopfzeile. Der Parameter `cashregisterId`, den man
 * im Rumpf sieht, kommt aus der Anmeldung.
 *
 * Das Backend setzt fuer beide `allowRegisterUser`; mit `apiKeyAuth` sind sie
 * nicht erreichbar (dieses Paket bildet das nicht nach — wer darf, entscheidet
 * das Backend).
 */

/**
 * Sitzung verlaengern und den neuen Ablaufzeitpunkt liefern (Millisekunden
 * seit 1970).
 *
 * Die Sitzung lebt 90 Sekunden; die Browser-Kasse erneuert alle 30. Ist sie
 * bereits beendet oder uebernommen, antwortet das Backend fachlich ("Sitzung
 * beendet — bitte neu anmelden.") — dann hilft nur eine neue Anmeldung ueber
 * `registerUserLogin`.
 */
export async function renewRegisterSession(rufen: InternerTransport): Promise<number> {
  const daten = await rufen<{ expiresAt?: unknown }>('renewRegisterSession');
  const expiresAt = daten?.expiresAt;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    // Ohne brauchbaren Ablaufzeitpunkt weiss die Kasse nicht, wann sie das
    // naechste Mal erneuern muss — das ist ein Antwortfehler und kein Erfolg.
    throw new KasseneckValidationError(
      'renewRegisterSession',
      'Antwort enthaelt keinen Ablaufzeitpunkt (data.expiresAt fehlt)',
      'response',
    );
  }
  return expiresAt;
}

/**
 * Sitzung beenden und den Lizenzplatz sofort freigeben — der regulaere Weg des
 * Abmeldens.
 *
 * Das Backend antwortet mit `{ok:true}`; dieser Aufruf prueft das Feld
 * **nicht**: dass der Vorgang gelang, sagt bereits die Erfolgshuelle, die der
 * Transport auswertet. Eine zweite Pruefung derselben Aussage braeche nur an
 * einer harmlosen Vertragsaenderung — ausgerechnet beim Abmelden, dem Aufruf,
 * der auch dann durchgehen soll, wenn sonst nichts mehr geht.
 */
export async function endRegisterSession(rufen: InternerTransport): Promise<void> {
  await rufen('endRegisterSession');
}
