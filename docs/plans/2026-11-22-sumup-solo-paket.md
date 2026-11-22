# SumUp Solo – Pakete (Teil B) Implementation Plan

Schritte mit Kästchen (`- [ ]`) zum Abhaken; Tasks der Reihe nach, jeder endet grün und mit einem Commit.

**Goal:** `@kreiseck/kasseneck-api` 1.43.0 und `kasseneck_api` 11.34.0 sprechen die dreizehn Kassen-Aufrufe von SumUp Solo
(Einrichtung, Zahlung, Rückbuchung), kennen ihre Typen, Fehlercodes und Texte `solo.*` und drucken eine Cloud-Zahlung wie
eine SDK-Zahlung. Browser-Kasse (Teil D) und Kassen-App (Teil C) bauen nur noch Abläufe darauf.

**Architecture:** Eine neue Datei `src/pos/kartenleser.ts` (Muster `lager.ts`: freie Funktionen über `InternerTransport`,
lesen tolerant, schreiben streng), exportiert über `./pos`. Dazu zwei reine Helfer, die App und Browser-Kasse gleich
brauchen: die Kennung einer Zahlung und die Wahl des Solos. Die Wahl hat Prüffälle als JSON, die der Dart-Zwilling
wiederholt. Alles am Vertrag (Aufruflisten, Fehlercodes, `surface.json`) kommt aus dem Backend-Export
`functions/vertrag/v3` des Branches `feature/sumup-solo-cloud` (keck#1010) und wird von den bestehenden Wächtern gehalten.
Dart zieht erst nach, wenn npm 1.43.0 veröffentlicht ist.

**Tech Stack:** TypeScript, `node --test` (drei Zeitzonen), Vertrag als JSON (`fixtures/v3/`); Dart/Flutter 3.47.9,
`flutter test`, `MockClient`.

**Spec:** `/Users/mali/kasseneck-wt-sumup-solo/docs/specs/2026-11-18-sumup-solo-cloud-design.md`, Abschnitte „Endpunkte“,
„Fehlercodes“, „Pakete“, „Stand Teil A“ (vor allem „Vertrag mit den Teilen B/C/D“ und „Sandbox-Lauf“). Wo Grundtext und
„Stand Teil A“ sich unterscheiden, gilt „Stand Teil A“.

## Globale Vorgaben

- Npm-Worktree `~/kreiseck/kasseneck-api-wt-sumup-solo`, Dart-Worktree `~/kasseneck_api-wt-sumup-solo`, beide Branch
  `feature/sumup-solo` von `origin/main`. Backend-Quelle des Vertrags: `KASSENECK_BACKEND=/Users/mali/kasseneck-wt-sumup-solo`.
- Die 13 Namen, genau so geschrieben und in dieser Reihenfolge (wie `KASSEN_ENDPUNKTE` im Backend): `getCardReaderSetup`,
  `startCardAccountConnection`, `disconnectCardAccount`, `pairCardReader`, `renameCardReader`, `removeCardReader`,
  `setDeviceCardReader`, `startCardReaderPayment`, `getCardReaderPayment`, `cancelCardReaderPayment`,
  `resolveCardReaderPayment`, `refundCardReaderPayment`, `getCardReaderRefund`.
- Jeder der 13 Aufrufe verlangt `deviceId` (Kennung aus `register_devices`); das Backend antwortet ohne sie `validation`.
- Felder außen englisch, genau wie im Backend (`sumup-cloud-core.js` `zahlungAussen`/`rueckbuchungAussen`,
  `sumup-cloud-einrichtung.js` `leserAussen`/`stand`): Stände `pending|successful|failed|cancelled|declined|unclear`,
  Gründe `busy|offline|declined|cancelled|expired|setup|amount_mismatch|no_response|not_refundable|amount_too_high`.
- Betrag nur in ganzen Cent, 100 bis 1.000.000 (`CARD_READER_MIN_CENTS`, `CARD_READER_MAX_CENTS`). `providerData.amount` ist
  Euro (wie beim SDK-Weg), nie Cent.
- Kennung einer Zahlung oder Rückbuchung: `^[A-Za-z0-9_-]{8,64}$`.
- Texte in der Tonlage der bestehenden Kartensätze: kurze Handlungssätze, keine Rechtssprache, kein Halbgeviertstrich ohne
  Leerzeichen, keine englischen Wörter außer Produktnamen. Gilt für beide Kassen (kein `only`).
- Bestehende Belege drucken byte-gleich (Goldens unverändert bis auf den neuen Prüffall).
- Npm veröffentlicht der User; Dart wird nach grüner CI aus einer frischen Worktree des geprüften Stands veröffentlicht
  (`dart pub publish --dry-run`, Dateiliste ansehen, dann `--force`).

## Review Focus

1. **Unbekannter Stand vom Server** (eine spätere Backend-Fassung liefert einen neuen `status`): die Kasse muss weiter
   fragen und darf nie „gescheitert“ annehmen. Abgebildet auf `unclear` (Task 2, Test „unbekannter Stand wird unclear“).
2. **`card_reader_choice_needed` ohne lesbare Liste** (Feld fehlt oder kaputt): `cardReaderChoices` liefert `[]`, nie eine
   Ausnahme (Task 2, Test).
3. **Kassen-ID mit Zeichen außerhalb `[A-Za-z0-9_-]`** oder sehr lang: `newCardReaderReference` liefert trotzdem eine gültige
   Kennung ≤ 64 Zeichen (Task 3, Test).
4. **Zuweisung zeigt auf einen Solo im Stand `pairing` oder auf einen entfernten**: zählt wie „keine Zuweisung“, nie als
   bereit (Task 3, Prüffälle).
5. **Alter SDK-Beleg ohne `channel`**: druckt unverändert, auch ohne `paymentType` (Task 5, Golden byte-gleich).

---

## Stufe 1: npm (lokal, vor dem Test der Browser-Kasse)

### Task 1: Vertrag holen, Aufrufe einordnen

**Files:**
- Modify: `fixtures/v3/**` (per Skript), `src/stored/vokabular.ts`, `test/fixtures/partner-v3-antworten.json`,
  `test/fixtures/stored-zwillinge.json` (per Skript)
- Modify: `src/client/aufrufe.ts` (`ALL_CALLS`, `POS_CALLS`, `UNKNOWN_OUTCOME_CALLS`, `CALLS_WITHOUT_EFFECT`)
- Modify: `test/oberflaeche.test.ts` (Zahlen), `fixtures/surface.json` (per Skript)

**Interfaces:**
- Produces: die 13 Namen in `POS_CALLS` in der Reihenfolge des Vokabulars (`endpoints.register`).

- [ ] **Step 1:** `KASSENECK_BACKEND=/Users/mali/kasseneck-wt-sumup-solo node scripts/v3-vertrag-holen.mjs`, dann
  `npm run fixtures:stored` und die Skripte, die #211 mitlaufen ließ (`scripts/partner-v3-antworten.cjs`,
  `scripts/stored-zwillinge.mjs`). Erwartet laut Backend-Export: nur additiv (register 55 → 68, registerInternal 44 → 57,
  13 neue Endpunkte in `antworten/kasse.json`, neue Gruppe `errorCodes.cardReader`).
- [ ] **Step 2:** `npm test` – rot an den Wächtern, die die Namen vermissen (`POS_CALLS` ≠ `endpoints.register`,
  Einordnung, Oberfläche). Das ist der Prüfstand für Step 3.
- [ ] **Step 3:** Namen eintragen. Einordnung:
  - `CALLS_WITHOUT_EFFECT` `read`: `getCardReaderSetup`, `getCardReaderPayment`, `getCardReaderRefund` (die Nachfrage
    stößt am Server höchstens eine Klärung an, die selbst idempotent ist).
  - `CALLS_WITHOUT_EFFECT` `repeatable`: `startCardAccountConnection` (legt nur einen Anmeldelink an, den ohne die Antwort
    niemand erreicht und der nach 15 min verfällt – wie `createPaymentLinkStripe`), `setDeviceCardReader` (dieselbe
    Zuweisung noch einmal ändert nichts – wie `claimTerminal`).
  - `UNKNOWN_OUTCOME_CALLS` (alphabetisch einsortiert): `cancelCardReaderPayment`, `disconnectCardAccount`,
    `pairCardReader`, `refundCardReaderPayment`, `removeCardReader`, `renameCardReader`, `resolveCardReaderPayment`,
    `startCardReaderPayment`.
  - `GELDWEGE` in `src/client/errors.ts` bleibt unverändert. Grund (als Kommentar an `UNKNOWN_OUTCOME_CALLS` festhalten):
    die Solo-Handler antworten immer mit Code, auch `server_error`; ob nach einem Fehler beim Start oder bei der
    Rückbuchung etwas lief, beantwortet allein `getCardReaderPayment` bzw. `getCardReaderRefund` (Eintrag fehlt =
    `card_payment_not_found` = nichts gesendet). Die Kassen fragen dort nach, statt aus dem Code zu schließen.
- [ ] **Step 4:** `npm run fixtures:oberflaeche`; in `test/oberflaeche.test.ts` 55 → 68 und 44 → 57 (die veralteten
  Kommentare „48“/„37“ in `aufrufe.ts` gleich mit richtigstellen).
- [ ] **Step 5:** `npm test`. Ist alles grün: Commit `feat: SumUp Solo – Vertrag aus dem Backend, dreizehn Kassen-Aufrufe
  eingeordnet`. Bleiben nur Tests rot, die die Methoden selbst brauchen (Vertragsfälle in `test/kasse-v3.test.ts`), nichts
  abschalten: Task 1 und Task 2 gehen dann zusammen in den Commit von Task 2.

### Task 2: Aufrufe und Typen (`src/pos/kartenleser.ts`)

**Files:**
- Create: `src/pos/kartenleser.ts`, `test/kartenleser-kasse.test.ts`
- Modify: `src/pos/index.ts` (Exportblock nach dem Lager-Block), `src/pos/errors.ts` (`POS_ERROR_CODES`),
  `test/kasse-v3.test.ts` (Fälle der 13 Endpunkte, Liste der Endpunkte für den Code-Abgleich l. 760–766,
  „Fehlerfall am Code erkannt“ l. 727–749), `README.md` (Abschnitt `./pos`, ein kurzes Beispiel Zahlung starten und
  nachfragen)

**Interfaces (Produces, exakt so):**

```ts
export const CARD_ACCOUNT_STATES = ['none', 'connected', 'expired'] as const;
export const CARD_ACCOUNT_METHODS = ['oauth', 'api_key'] as const;
export const CARD_READER_STATUSES = ['pairing', 'paired', 'expired'] as const;
export const CARD_READER_PAYMENT_STATUSES = ['pending', 'successful', 'failed', 'cancelled', 'declined', 'unclear'] as const;
export const CARD_READER_REASONS = ['busy', 'offline', 'declined', 'cancelled', 'expired', 'setup', 'amount_mismatch',
  'no_response', 'not_refundable', 'amount_too_high'] as const;
export const CARD_READER_DECISIONS = ['receipt', 'discard'] as const;
export const CARD_READER_BLUETOOTH = 'bluetooth';
export const CARD_READER_MIN_CENTS = 100;
export const CARD_READER_MAX_CENTS = 1_000_000;

export interface CardAccountConnection { state: CardAccountState; method: CardAccountMethod | null;
  merchantCode: string | null; refundsEnabled: boolean; connectAvailable: boolean }
export interface CardReader { readerId: string; name: string; serial: string | null; model: string | null;
  status: CardReaderStatus | null; online: boolean | null; battery: number | null; busy: boolean; busyDevice: string | null }
export interface CardReaderSetup { connection: CardAccountConnection; readers: CardReader[];
  deviceReader: string | null; canManage: boolean }
export interface CardReaderTransaction { id: string | null; code: string | null; cardType: string | null;
  cardLastDigits: string | null; entryMode: string | null; authCode: string | null; amountCents: number | null; timeMs: number | null }
export interface SumupCloudProviderData { channel: 'cloud'; transactionCode: string | null; transactionId: string | null;
  amount: number; currency: string; cardType: string | null; cardLastDigits: string | null; entryMode: string | null;
  authCode: string | null; merchantCode: string | null; foreignTransactionId: string; readerId: string | null }
export interface CardReaderReceiptPayment { provider: 'sumup'; providerPaymentId: string; providerData: SumupCloudProviderData }
export interface CardReaderPayment { reference: string; status: CardReaderPaymentStatus; reason: CardReaderReason | null;
  amountCents: number; readerId: string | null; readerName: string | null; transaction: CardReaderTransaction | null;
  receiptPayment: CardReaderReceiptPayment | null }
export interface CardReaderRefund { reference: string; paymentReference: string; status: CardReaderPaymentStatus;
  reason: CardReaderReason | null; amountCents: number }

getCardReaderSetup(transport, o: { deviceId: string; withStatus?: boolean }): Promise<CardReaderSetup>
startCardAccountConnection(transport, o: { deviceId: string }): Promise<{ authorizeUrl: string }>
disconnectCardAccount(transport, o: { deviceId: string }): Promise<void>
pairCardReader(transport, o: { deviceId: string; pairingCode: string; name: string }): Promise<CardReader>
renameCardReader(transport, o: { deviceId: string; readerId: string; name: string }): Promise<CardReader>
removeCardReader(transport, o: { deviceId: string; readerId: string }): Promise<void>
setDeviceCardReader(transport, o: { deviceId: string; readerId: string | null }): Promise<string | null> // deviceReader
startCardReaderPayment(transport, o: { deviceId: string; reference: string; amountCents: number; readerId?: string }): Promise<CardReaderPayment>
getCardReaderPayment(transport, o: { deviceId: string; reference: string }): Promise<CardReaderPayment>
cancelCardReaderPayment(transport, o: { deviceId: string; reference: string }): Promise<CardReaderPayment>
resolveCardReaderPayment(transport, o: { deviceId: string; reference: string; decision: CardReaderDecision }): Promise<CardReaderPayment>
refundCardReaderPayment(transport, o: { deviceId: string; reference: string; paymentReference: string; amountCents: number }): Promise<CardReaderRefund>
getCardReaderRefund(transport, o: { deviceId: string; reference: string }): Promise<CardReaderRefund>

isCardReaderFinal(status: CardReaderPaymentStatus): boolean        // successful|failed|cancelled|declined
cardReaderChoices(error: unknown): CardReader[]                    // details.readers bei card_reader_choice_needed, sonst []
cardReaderBusyDevice(error: unknown): string | null                // details.busyDevice bei card_reader_busy, sonst null
```

Lese- und Schreibregeln (bestimmen die Tests):
- Vor dem Senden prüfen (`KasseneckValidationError`, `scope: 'request'`, kein Aufruf): `deviceId` leer; `reference` nicht
  im Kennungsformat; `amountCents` nicht ganzzahlig oder außerhalb 100…1.000.000 (Zahlung) bzw. 1…1.000.000 (Rückbuchung:
  das Backend erlaubt jeden Rest > 0); `decision` nicht im Katalog;
  `readerId` leer (bei `setDeviceCardReader` sind `null` und `'bluetooth'` erlaubt). `pairingCode` und `name` gehen
  unverändert hinaus; normiert und geprüft wird am Server (`validation` mit `posFieldErrors`).
- Antwort lesen: fehlt `reference` oder ist `amountCents` keine Ganzzahl → `KasseneckValidationError` (`'response'`).
  Unbekannter `status` → `'unclear'` (Kommentar: „weiter fragen, nie scheitern lassen“). Unbekannter `reason`,
  `status` eines Solos oder `method` → `null`. Fehlende optionale Felder → `null`, `busy` fehlt → `false`.
  `receiptPayment` nur, wenn `status === 'successful'` und `providerPaymentId` ein nicht leerer Text ist; `providerData`
  wird wie gesendet durchgereicht (die Kasse schreibt es 1:1 in `createReceipt`), nur `channel` muss `'cloud'` sein,
  sonst `null`.
- `setDeviceCardReader` sendet `readerId` immer, auch als ausdrückliches `null` (das Backend wertet ein fehlendes Feld als
  Eingabefehler, nur `null` heißt „keine Zuweisung“). Der Test prüft, dass der Schlüssel mit `null` im Aufruf steht.
- `disconnectCardAccount`/`removeCardReader` lesen die Antwort (`{ disconnected: true }`, `{ readerId, removed: true }`)
  nicht aus; ein Erfolg ohne diese Felder ist trotzdem Erfolg.

- [ ] **Step 1: Tests schreiben** in `test/kartenleser-kasse.test.ts` mit der Attrappe aus `test/lager-kasse.test.ts`
  (`attrappe(daten)`, `aufrufe`): je Aufruf genau `[[name, params]]` mit `deviceId`; die Prüffehler oben je einzeln
  (kein Aufruf); „unbekannter Stand wird unclear“ (`status: 'wartet_neu'` → `'unclear'`); „receiptPayment nur bei
  successful“ (Antwort `failed` mit `receiptPayment` → `null`); `cardReaderChoices` mit kaputter/fehlender Liste → `[]`,
  mit zwei Solos → zwei `CardReader`; `cardReaderBusyDevice` bei anderem Code → `null`. In `test/kasse-v3.test.ts` die
  13 Endpunkte in die Vertragsfälle aufnehmen (die Fälle kommen aus `fixtures/v3/antworten/kasse.json`).
- [ ] **Step 2:** `npm test` → rot (Modul fehlt).
- [ ] **Step 3:** `src/pos/kartenleser.ts` schreiben, Exporte in `src/pos/index.ts`. `POS_ERROR_CODES` um genau die Codes
  ergänzen, die der Wächter in `test/kasse-v3.test.ts` aus den 13 Endpunkten ableitet (sortiert, `route_missing` bleibt
  letzter).
- [ ] **Step 4:** `npm test` grün, `npm run build`, `npm run check:consumer`. `fixtures:oberflaeche` erneut laufen lassen
  (neue Kataloge werden `pos.*`) und den Diff ansehen.
- [ ] **Step 5:** Commit `feat: SumUp Solo – dreizehn Kassen-Aufrufe und Typen (./pos)`.

### Task 3: Kennung und Wahl des Solos (geteilte Regeln)

**Files:**
- Modify: `src/pos/kartenleser.ts`, `src/pos/index.ts`
- Create: `fixtures/card-reader-choice-cases.json`, `test/kartenleser-wahl.test.ts`
- Modify: Liste der veröffentlichten Fixtures (Wächter `test/paket-inhalt.test.ts`, `package.json` `files` falls dort
  einzeln genannt)

**Interfaces (Produces):**

```ts
newCardReaderReference(cashregisterId: string, o?: { nowMs?: number; random?: string }): string
type CardReaderChoice =
  | { kind: 'reader'; reader: CardReader }
  | { kind: 'choose'; readers: CardReader[] }
  | { kind: 'bluetooth' }
  | { kind: 'none'; why: 'not_connected' | 'expired' | 'no_reader' };
cardReaderFor(setup: CardReaderSetup): CardReaderChoice
```

- `newCardReaderReference`: Form `kk-<kasse>-<epochMs>-<zufall>` wie der SDK-Zahler der App. `<kasse>`: nur
  `[A-Za-z0-9_-]` behalten, auf so viele Zeichen kürzen, dass das Ganze ≤ 64 bleibt; leer → `x`. `<zufall>`: 6 Zeichen
  `[a-z0-9]` aus `crypto.getRandomValues` (Vorgabe), `random` überschreibt das für Tests.
- `cardReaderFor` in dieser Reihenfolge (zählt nur Solos mit `status === 'paired'`):
  1. `connection.state === 'none'` → `none/not_connected`; `'expired'` → `none/expired`.
  2. `deviceReader === 'bluetooth'` → `bluetooth`.
  3. `deviceReader` ist ein gekoppelter Solo → `reader` (dieser).
  4. genau ein gekoppelter Solo → `reader`.
  5. mehrere gekoppelte → `choose` (alle gekoppelten, Reihenfolge wie geliefert; besetzte bleiben drin, die Kasse graut
     sie aus).
  6. sonst → `none/no_reader`.

- [ ] **Step 1:** Prüffälle `fixtures/card-reader-choice-cases.json` schreiben: `{ version: 1, cases: [{ name, setup,
  expected }] }`, je Zeile oben mindestens ein Fall, dazu: Zuweisung auf Solo im Stand `pairing` (→ wie ohne Zuweisung),
  Zuweisung auf entfernten Solo (→ wie ohne), ein gekoppelter plus einer `pairing` (→ `reader`), `expired` mit
  gekoppelten Solos (→ `none/expired`). `expected` nennt nur `kind`, `readerId` bzw. `readerIds`, `why`.
- [ ] **Step 2:** `test/kartenleser-wahl.test.ts`: spielt jeden Fall ab; `newCardReaderReference('CASHBOX-DEMO-1',
  { nowMs: 1763800000000, random: 'a1b2c3' })` → `'kk-CASHBOX-DEMO-1-1763800000000-a1b2c3'`; Kassen-ID `'ä ö/ü'.repeat(30)`
  → passt auf `^[A-Za-z0-9_-]{8,64}$`; zwei Aufrufe ohne `random` → verschieden.
- [ ] **Step 3:** `npm test` → rot. Umsetzen. `npm test` → grün.
- [ ] **Step 4:** Commit `feat: SumUp Solo – Kennung der Zahlung und Wahl des Solos mit Prüffällen`.

### Task 4: Texte `solo.*` und Fehlerregeln

**Files:**
- Modify: `src/pos/texte.ts` (`MELDUNGEN_ROH`, `BESCHRIFTUNGEN_ROH`, `ERROR_CODE_RULES`), `fixtures/pos-texts.json`
  (per `npm run fixtures:texte`), `fixtures/pos-message-cases.json`, `test/umbenennung-1.0.test.ts` (`NACH_1_0`),
  `test/texte-vertrag.test.ts` (Schlüsselliste, falls dort einzeln)

Schlüssel (Interface für Teil C und D, so benennen). Die Sätze sind Vorschläge; Form und Satzzeichen richten sich nach den
Regeln in `test/texte.test.ts`, der Inhalt bleibt.

Meldungen (Sätze):

| Schlüssel | Satz | Platzhalter |
|---|---|---|
| `solo.not_connected` | Die Kasse ist noch nicht mit SumUp verbunden. Der Chef verbindet sie in den Einstellungen unter Kartenterminal. | |
| `solo.connection_expired` | Die Verbindung zu SumUp ist abgelaufen. Der Chef verbindet in den Einstellungen unter Kartenterminal neu. | |
| `solo.connect_unavailable` | Mit SumUp verbinden geht noch nicht. Bitte Kasseneck kontaktieren. | |
| `solo.connect_waiting` | Im neuen Fenster bei SumUp anmelden und den Zugriff erlauben. Die Kasse merkt die Verbindung von selbst. | |
| `solo.connected_as` | Verbunden mit SumUp, Händlernummer {merchant}. | merchant |
| `solo.disconnect_question` | Die Verbindung zu SumUp trennen? Alle Solos werden entkoppelt. | |
| `solo.pair_hint` | Am Solo abmelden, dann unter Verbindungen „API“ wählen und „Verbinden“ drücken. Den Code vom Solo hier eingeben. | |
| `solo.code_invalid` | Diesen Code kennt SumUp nicht. Bitte den Code vom Solo genau abschreiben. | |
| `solo.not_waiting` | Der Solo wartet nicht mehr auf die Kopplung. Bitte am Solo einen neuen Code holen. | |
| `solo.too_many` | Es sind schon zu viele Solos gekoppelt. Bitte zuerst einen entfernen. | |
| `solo.not_found` | Diesen Solo gibt es nicht mehr. Bitte die Liste neu laden. | |
| `solo.no_reader` | Es ist noch kein Solo gekoppelt. Der Chef koppelt ihn in den Einstellungen unter Kartenterminal. | |
| `solo.busy` | Solo „{name}“ ist gerade bei {device} besetzt. | name, device |
| `solo.busy_short` | Der Solo ist gerade besetzt. | |
| `solo.waiting` | Karte an den Solo „{name}“ halten. | name |
| `solo.checking` | Die Zahlung wird bei SumUp geprüft. | |
| `solo.check_hint` | In der SumUp-App unter Transaktionen nachsehen: {amount}, {time}, Solo „{name}“. | amount, time, name |
| `solo.offline` | Der Solo ist nicht erreichbar. Ist er eingeschaltet und mit dem Internet verbunden? | |
| `solo.declined` | Die Karte wurde abgelehnt, es wurde nichts abgebucht. | |
| `solo.cancelled` | Die Zahlung wurde abgebrochen, es wurde nichts abgebucht. | |
| `solo.expired` | Am Solo kam keine Karte, es wurde nichts abgebucht. | |
| `solo.setup` | Der Solo ist bei SumUp nicht richtig eingerichtet. Bitte in den Einstellungen neu koppeln. | |
| `solo.amount_mismatch` | SumUp meldet einen anderen Betrag als die Kasse. Bitte in der SumUp-App nachsehen, bevor neu kassiert wird. | |
| `solo.module_inactive` | Das Kassenmodul des Betriebs ist nicht aktiv. | |
| `solo.below_minimum` | Mit dem Solo geht Karte erst ab 1,00 €. | |
| `solo.unavailable` | SumUp ist gerade nicht erreichbar. Es wurde nichts abgebucht. | |
| `solo.refund_running` | Die Rückbuchung auf die Karte läuft. | |
| `solo.refund_checking` | Die Rückbuchung wird bei SumUp geprüft. | |
| `solo.refund_declined` | SumUp hat die Rückbuchung abgelehnt. | |
| `solo.refund_not_enabled` | Zurückbuchen ist für dieses SumUp-Konto nicht freigeschaltet. Bitte die Karte in der SumUp-App zurückbuchen. | |
| `solo.refund_unknown` | SumUp hat nicht gemeldet, ob die Rückbuchung durchging. Bar nur zurückgeben, wenn sicher ist, dass sie nicht durchging. | |
| `solo.refund_too_high` | So viel kann auf diese Karte nicht mehr zurückgebucht werden. | |

Beschriftungen: `solo.section_title` „Solo“, `solo.connect` „Mit SumUp verbinden“, `solo.disconnect` „Trennen“,
`solo.pair` „Solo koppeln“, `solo.code_label` „Code vom Solo“, `solo.name_label` „Name“, `solo.rename` „Umbenennen“,
`solo.remove` „Entfernen“, `solo.assign` „Diesem Gerät zuweisen“, `solo.assigned` „Diesem Gerät zugewiesen“,
`solo.use_bluetooth` „Bluetooth-Leser (Air) verwenden“, `solo.status_paired` „Bereit“, `solo.status_pairing`
„Wird gekoppelt“, `solo.status_expired` „Abgelaufen“, `solo.online` „Online“, `solo.offline_label` „Offline“,
`solo.battery` „Akku {percent} %“, `solo.choose_title` „Welcher Solo?“, `solo.remember` „Für dieses Gerät merken“,
`solo.other_reader` „Anderen Solo nehmen“, `solo.refund_to_card` „Auf die Karte zurückbuchen“, `solo.refund_cash`
„Bar zurückgeben“, `solo.real_payment` „Echt kassieren“.

`ERROR_CODE_RULES` (`kind: 'api'`): `card_account_not_connected` → `solo.not_connected`, `card_account_expired` →
`solo.connection_expired`, `card_account_connect_unavailable` → `solo.connect_unavailable`, `card_reader_not_found` →
`solo.not_found`, `card_reader_busy` → `solo.busy_short`, `card_reader_code_invalid` → `solo.code_invalid`,
`card_reader_not_waiting` → `solo.not_waiting`, `too_many_card_readers` → `solo.too_many`,
`card_payment_amount_invalid` → `solo.below_minimum`, `card_refund_not_enabled` → `solo.refund_not_enabled`,
`card_refund_amount_invalid` → `solo.refund_too_high`, `card_provider_unavailable` → `solo.unavailable`. Ohne Regel
(die Kasse behandelt sie im Ablauf selbst): `card_reader_choice_needed`, `card_payment_not_found`,
`card_payment_reference_conflict`, `card_refund_not_possible`, `card_account_currency`.

- [ ] **Step 1:** In `test/umbenennung-1.0.test.ts` die neuen Schlüssel in `NACH_1_0` eintragen und je Regel einen Fall in
  `fixtures/pos-message-cases.json` anlegen → `npm test` rot.
- [ ] **Step 2:** Texte und Regeln eintragen, `npm run fixtures:texte`. `test/sumup-kasse.test.ts` bleibt unverändert
  (die neuen Schlüssel heißen `solo.*`, nicht `sumup.*`).
- [ ] **Step 3:** `npm test` grün (Satzregeln, Platzhalter, Dubletten, „rät nicht zum Wiederholen“).
- [ ] **Step 4:** Commit `feat: SumUp Solo – Texte solo.* für App und Browser-Kasse`.

### Task 5: Cloud-Zahlung drucken

**Files:**
- Modify: `src/receipt/layout.ts` (`sumupBlock`)
- Create: `fixtures/receipts/card-sumup-cloud.json`; per `npm run fixtures:erneuern`: `fixtures/expected/card-sumup-cloud.*`,
  `fixtures/manifest.json`
- Modify: `test/golden-belege.test.tsx` (Liste l. 30), `test/fixtures/druck-goldens.json` (`receipts`), Kopf von
  `test/druck-goldens.test.ts` (datierte Notiz)

Regel: `sumupBlock` druckt wie bisher; nur bei `providerData.channel === 'cloud'` ohne `paymentType` fällt die Zeile
„Zahlungstyp:“ weg (der Cloud-Weg kennt das Feld nicht, „n/a“ wäre falsch). Alles andere (Kopf „Sumup Beleg“, Kartentyp,
Kartennummer, Gesamtbetrag in Euro, Transaktionscode, Modus) bleibt gleich. Kein Druck von `authCode`, `readerId`,
`merchantCode`.

- [ ] **Step 1:** Prüffall `card-sumup-cloud.json` (Beleg mit einer Zahlung `provider: 'sumup'`, `providerData` genau in der
  Form von `getCardReaderPayment`/`success_cashier` aus `fixtures/v3/antworten/kasse.json`, Betrag 10,90 €) und
  Golden-Einträge anlegen; Test „Cloud-Zahlung druckt wie SDK-Zahlung ohne Zahlungstyp-Zeile“ (enthält „Gesamtbetrag:
  10,90 EUR“ und den Transaktionscode, keine Zeile mit „Zahlungstyp“) → rot.
- [ ] **Step 2:** Regel umsetzen, `npm run fixtures:erneuern`; `git diff fixtures/expected` zeigt nur `card-sumup-cloud.*`
  und `manifest.json`.
- [ ] **Step 3:** `npm test` grün. Commit `feat: SumUp Solo – Cloud-Zahlung druckt wie eine SDK-Zahlung`.

### Task 6: Stand 1.43.0 für den lokalen Test

**Files:** `package.json`, `package-lock.json`, `src/version.ts`, `CHANGELOG.md`, Versionsfelder der Fixtures (Wächter
`test/versionen.test.ts`)

- [ ] **Step 1:** Version 1.43.0 überall, wo `test/versionen.test.ts` es verlangt. CHANGELOG: `## 1.42.0` bekommt sein Datum
  (`npm view @kreiseck/kasseneck-api time --json`, Eintrag `1.42.0`), neu `## 1.43.0 - unveröffentlicht` auf Englisch mit
  „Reason:“ je Punkt (13 Aufrufe, Typen, `cardReaderFor`/`newCardReaderReference` mit Prüffällen, Texte `solo.*`,
  Druckregel). Satz zum Vertrag: „Contract pulled from backend branch feature/sumup-solo-cloud (keck#1010); re-pulled from
  main before publishing.“
- [ ] **Step 2:** Volle Prüfung: `npm test`, `KASSENECK_BACKEND=/Users/mali/kasseneck-wt-sumup-solo npm test`,
  `npm run build`, `npm run check:consumer`, `npm run check:erreichbar` (nur lokal; die 13 Namen gibt es live noch nicht –
  falls der Lauf die Live-Adressen prüft, Einträge in `scripts/erreichbarkeit-ausnahmen.json` mit Vermerk keck#1010).
- [ ] **Step 3:** `npm pack` in der Worktree → `kreiseck-kasseneck-api-1.43.0.tgz` (nicht committen). Den Dateiinhalt
  prüfen (`tar tzf`): keine `*.local.*`, `.env`, `credential`, `*.key`. Diese Datei nutzt Teil D für den lokalen Test.
- [ ] **Step 4:** Commit `chore: 1.43.0 – SumUp Solo (unveröffentlicht)`. Nicht pushen.

## Stufe 2: Veröffentlichen (erst nach dem lokalen Test und dem Merge von keck#1010)

### Task 7: npm 1.43.0

- [ ] **Step 1:** Warten, bis keck#1010 gemergt und deployt ist. Vertrag aus `main` neu holen (frische keck-Worktree auf
  `origin/main`, `KASSENECK_BACKEND=<diese Worktree> node scripts/v3-vertrag-holen.mjs`, `npm run fixtures:stored`); der
  Diff darf nur die Herkunft (`_quelle`) ändern. Ändert er mehr, zuerst die Ursache klären.
- [ ] **Step 2:** CHANGELOG-Satz zum Vertrag auf „pulled from the deployed backend“ stellen, Ausnahmen aus Task 6 Step 2
  wieder entfernen, volle Prüfung wie Task 6.
- [ ] **Step 3:** Push, PR gegen `kreiseck-at/kasseneck-api` (deutscher Text, ohne Fußzeile), CI abwarten, mergen (bei
  Ablehnung durch die Rechteprüfung dem User `! gh pr merge <nr> --merge -R kreiseck-at/kasseneck-api` geben).
- [ ] **Step 4:** Der User veröffentlicht aus einer frischen Worktree von `main` (`npm pack --dry-run` vorher ansehen, dann
  `npm publish`). Danach CHANGELOG-Datum nachtragen.

### Task 8: Dart 11.34.0 (Zwilling)

**Files (Dart-Worktree):** `zwillinge.yaml` (`npm_version: 1.43.0`), `test/fixtures/vertrag/**` (per Skript),
`lib/src/aufrufe.dart`, neu `lib/src/kasse/kartenleser.dart`, `lib/src/kasse/belege.dart` (`RegisterReceiptClient`),
`lib/pos.dart`, `lib/src/kasse/codes.dart` (`posErrorCodes`), `lib/src/v3.dart` (`unknownOutcomeCalls`, `kPackageVersion`),
`lib/src/kasse/texte_katalog.dart` (per Generator), `lib/models/print_paper.dart` (`_sumup`), Tests unten, `pubspec.yaml`,
`README.md`, `README.de.md`, `CHANGELOG.md`.

**Interfaces (Produces):** Methoden an `RegisterReceiptClient`, je mit `required String deviceId` und den Feldern von
Task 2 als benannte Parameter, Rückgaben `CardReaderSetup`, `CardReader`, `CardReaderPayment`, `CardReaderRefund`
(je mit `static const Set<String> fields`), `Future<void>` für Trennen/Entfernen, `Future<String?>` für
`setDeviceCardReader`. Freie Funktionen `newCardReaderReference(String cashregisterId, {int? nowMs, String? random})`,
`cardReaderFor(CardReaderSetup)` mit `sealed class CardReaderChoice`, `cardReaderChoices(Object error)`,
`cardReaderBusyDevice(Object error)`, `isCardReaderFinal(String status)`. Lese- und Prüfregeln wie Task 2/3. Achtung: `RegisterTransport.call` lässt `null`-Werte weg; `setDeviceCardReader(null)` muss
das Feld trotzdem als JSON-`null` senden (eigener Weg im Transport oder Option, mit Test am gesendeten Rumpf).

- [ ] **Step 1:** `tool/zwillinge.sh ziehen` (aus dem veröffentlichten 1.43.0), `tool/zeichensatz_layout.sh`,
  `dart run tool/texte_erzeugen.dart`. `flutter test` → rot an den Zwillingstests (Aufrufe, Codes, Texte, Prüffälle).
  `card-reader-choice-cases.json` in die Pflichtliste von `tool/zwillinge.sh` aufnehmen.
- [ ] **Step 2:** Tests: `test/kartenleser_test.dart` (Stil `test/kartenzahlung`/`kartentrinkgeld_test.dart`: `MockClient`,
  URL `https://kasse.kasseneck.at/api/v3/<name>`, `deviceId` im Rumpf, Prüffehler ohne Aufruf, unbekannter Stand →
  `unclear`), Wiederholung von `card-reader-choice-cases.json`, Kennung wie Task 3. In `test/kasse_v3_test.dart` die 13
  Endpunkte (Gruppen, `_rufe`, `hasLength(55)` → 68, `modelle`), `test/ausgang_einordnung_test.dart` (gleiche Einordnung wie
  Task 1), `test/oeffentliche_namen_test.dart` (Wörter `reader`, `readers`, `rename`, `disconnect`), `test/texte_umbenennung_test.dart`
  (`_nach10`), Druck: `test/print_rendering_test.dart` Cloud-Fall ohne Zahlungstyp-Zeile, 89 → 90 in
  `aufdruck_rueckfall_test.dart` und `blatt_zeichner_test.dart`.
- [ ] **Step 3:** Umsetzen bis `flutter analyze` und `flutter test` grün; `tool/zwillinge.sh pruefen`.
- [ ] **Step 4:** Version 11.34.0 (`pubspec.yaml`, `kPackageVersion`, beide READMEs), CHANGELOG „Twin of
  `@kreiseck/kasseneck-api` `1.43.0`: …“ mit „Contract pulled from the published npm 1.43.0“.
- [ ] **Step 5:** Push, PR gegen `mhmmdlkts/kasseneck_flutter_api`, CI abwarten, mergen. Aus frischer Worktree von `main`:
  `dart pub publish --dry-run`, Dateiliste ansehen, `dart pub publish --force`.

## Später (nicht in diesem Plan)

- 0.x-Linie (Backend vendort 0.41.0 für Beleg-PDF und Mail): dieselbe Druckregel, sonst druckt das Backend bei einer
  Cloud-Zahlung „Zahlungstyp: n/a“. Eigener Zweig von `origin/release/0.x`, `npm publish --tag legacy` (User), danach
  vendoren in keck.
- App-Weg für Karteck (gleiche Namen unter `api.kasseneck.at/v3`).

## Test-Checkliste für dich (Nutzer)

Teil B hat keine eigene Oberfläche; geprüft wird er mit der Browser-Kasse (Plan Teil D, dort die Checkliste). Hier nur:
- Nach Task 7: `npm view @kreiseck/kasseneck-api version` zeigt 1.43.0.
- Nach Task 8: pub.dev zeigt `kasseneck_api` 11.34.0.

## Externe TODOs

- npm 1.43.0 veröffentlichen (du, Browser-Freigabe), erst nach Merge und Deploy von keck#1010.
