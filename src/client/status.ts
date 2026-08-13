import { KasseneckValidationError } from './errors.js';
import type { KasseneckTransport } from './transport.js';

/**
 * Betriebsstatus von Kasse und Signatureinheit bei FinanzOnline — Zwilling von
 * `getCashboxStatus`/`getSignatureStatus` in
 * kasseneck_api/lib/kasseneck_api.dart (Zeilen 410-440).
 *
 * Beide laufen ueber den **einen** Backend-Endpunkt `financeWebService`, der
 * seine Vorgangsart als `method` **neben** `params` im Rumpf erwartet (so das
 * Dart-Vorbild `_financeWebServicePostRequest`, so die Auswertung `b.method` im
 * Backend). Die Antwort ist die uebliche Erfolgshuelle; darin liegt die
 * FinanzOnline-Meldung unter `data.rkdbMessage`.
 *
 * **Kassen-Benutzer-Weg (`registerUserAuth`, Browser-Kasse):**
 * `financeWebService` setzt kein `allowRegisterUser`; beide Abfragen
 * funktionieren nur mit `apiKeyAuth`. Dieses Paket bildet das **nicht** nach —
 * wer darf, entscheidet allein das Backend.
 */

/**
 * Betriebsstatus, den FinanzOnline meldet. Die vier bekannten Werte sind
 * benannt; ein noch unbekannter Wert kommt **unveraendert** durch (`string`),
 * statt wie im Dart-Vorbild still zu `null` zu werden. Lesen ist in diesem
 * Paket tolerant: "unbekannter Status" und "kein Status" duerfen fuer den
 * Aufrufer nicht dasselbe sein, sonst meldet eine Kasse mit einem neuen
 * FON-Status genauso wie eine ohne Antwort.
 */
export type CashboxStatus = 'AKTIVIERT' | 'REGISTRIERT' | 'IN_BETRIEB' | 'AUSFALL' | (string & {});

/**
 * Status der Signatureinheit. Wie [CashboxStatus], zusaetzlich der
 * **abgeleitete** Wert `NOT_REGISTERED`: er ist kein FON-Status, sondern die
 * Uebersetzung des Returncodes `B33` ("Signatureinheit nicht registriert").
 */
export type SignatureStatus = CashboxStatus | 'NOT_REGISTERED';

/**
 * Vorgangsnamen, unter denen Fehler dieser beiden Abfragen erscheinen. Beide
 * laufen ueber denselben Endpunkt `financeWebService`; ein Fehler, der nur den
 * Endpunkt nennt, verschweigt dem Aufrufer, ob der Kassen- oder der
 * Signaturstatus scheiterte. Der Transport bildet denselben Namen aus
 * `<funktion>/<method>` — hier stehen die Konstanten fuer die Fehler, die schon
 * vor dem Senden entstehen.
 */
const VORGANG_KASSE = 'financeWebService/status_cashbox';
const VORGANG_SIGNATUR = 'financeWebService/status_signature';

/** FinanzOnline-Meldung, wie sie unter `data.rkdbMessage` ankommt. */
interface RkdbAntwort {
  rkdbMessage?: { rc?: unknown; msg?: unknown; status?: unknown };
}

/** Betriebsstatus der Kasse bei FinanzOnline. */
export async function getCashboxStatus(rufen: KasseneckTransport): Promise<CashboxStatus> {
  const daten = await rufen<RkdbAntwort>('financeWebService', {}, { method: 'status_cashbox' });
  return statusAusMeldung(daten, VORGANG_KASSE);
}

/**
 * Status der Signatureinheit mit der Zertifikatsseriennummer [zertifikatNrHex]
 * (hexadezimal, z. B. `6F0404F0`).
 *
 * **Der Returncode wird vor dem Status gelesen** (wie im Dart-Vorbild): `B33`
 * heisst "nicht registriert" und schlaegt jedes Statusfeld, das daneben stehen
 * mag. Andersherum meldete eine nie registrierte Karte am Ende "in Betrieb".
 */
export async function getSignatureStatus(
  rufen: KasseneckTransport,
  zertifikatNrHex: string,
): Promise<SignatureStatus> {
  if (typeof zertifikatNrHex !== 'string' || !zertifikatNrHex.trim()) {
    throw new KasseneckValidationError(VORGANG_SIGNATUR, 'zertifikatNrHex fehlt', 'request');
  }
  const daten = await rufen<RkdbAntwort>(
    'financeWebService',
    { zertifikatnr_hex: zertifikatNrHex },
    { method: 'status_signature' },
  );
  if (daten?.rkdbMessage?.rc === 'B33') {
    return 'NOT_REGISTERED';
  }
  return statusAusMeldung(daten, VORGANG_SIGNATUR);
}

function statusAusMeldung(daten: RkdbAntwort | null | undefined, functionName: string): string {
  const status = daten?.rkdbMessage?.status;
  if (typeof status !== 'string' || !status) {
    // Der Inhalt der Antwort wandert NICHT in die Meldung — er kommt von einer
    // fremden Stelle, und was dort steht, ist nicht unsere Zusage.
    throw new KasseneckValidationError(functionName, 'Antwort enthaelt keinen Status (data.rkdbMessage.status)', 'response');
  }
  return status;
}
