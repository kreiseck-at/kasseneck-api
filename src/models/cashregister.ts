/**
 * Kasse — Zwilling von `Cashregister` in
 * kasseneck_api/lib/models/cashregister.dart.
 *
 * `id` und `userId` sind wie im Dart-Vorbild kein Teil der Nutzlast selbst
 * (Firestore-Dokument-ID bzw. Pfad-Segment), sondern werden separat
 * mitgegeben.
 *
 * `createTime` ist hier ein echtes `Date`/ISO-String-Paar statt eines
 * Firestore-`Timestamp`s: das Dart-Vorbild liest das Feld direkt aus einem
 * Firestore-Dokument (`cloud_firestore`-SDK), dieses Paket spricht das
 * Backend dagegen ausschliesslich ueber die HTTPS-Endpunkte, die
 * `create_time` bereits als ISO-8601-String senden (siehe z. B.
 * `listMyCashregisters` im Backend).
 */
export interface Cashregister {
  userId: string;
  id: string;
  createTime: Date;
  token: string;
  aesKey: string;
  signatureId?: string;
}

export interface CashregisterPayload {
  create_time: string;
  token: string;
  aes_key: string;
  signature_id?: string | null;
}

export function toCashregisterPayload(kasse: Cashregister): CashregisterPayload {
  return {
    create_time: kasse.createTime.toISOString(),
    token: kasse.token,
    aes_key: kasse.aesKey,
    signature_id: kasse.signatureId ?? null,
  };
}

export function fromCashregisterPayload(payload: CashregisterPayload, id: string, userId: string): Cashregister {
  return {
    userId,
    id,
    createTime: new Date(payload.create_time),
    token: payload.token,
    aesKey: payload.aes_key,
    signatureId: payload.signature_id ?? undefined,
  };
}
