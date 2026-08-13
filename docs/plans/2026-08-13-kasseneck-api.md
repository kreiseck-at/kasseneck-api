# `@kreiseck/kasseneck-api` Implementation Plan

**Goal:** Der veröffentlichte JavaScript-Client für das Kasseneck-Backend — Zwilling von
`kasseneck_api` (pub.dev), erster Verbraucher ist die Browser-Kasse.

**Architecture:** Reines TypeScript-Paket ohne Framework-Abhängigkeit. Enums und Modelle spiegeln
das Flutter-Paket wertgleich; ein Gleichheits-Wächter hält das fest. Der Client trennt **Transport**
(HTTP, Fehlerhülle) von **Anmeldung** (austauschbar: `api_key` oder Kassen-Benutzer) und von den
**Endpunkten**. Beleg-Darstellung entsteht als Layout-Modell ohne Framework; ein dünner React-Adapter
zeichnet es als eigener Einstiegspunkt.

**Tech Stack:** TypeScript 5.4+, Ausgabe ESM **und** CommonJS über zwei `tsc`-Läufe, Tests mit
`node --test` auf übersetztem Testcode, Node ≥ 20.18 — die Konventionen der bestehenden
`@kreiseck`-Pakete, mit einer benannten Abweichung beim Modulformat.

**Spec:** `docs/specs/2026-08-13-kasseneck-api-design.md`
**Vorbild-Paket:** `~/kreiseck-wt-rksv/packages/rksv` (Bauweise, tsconfigs, Exporte, NOTICE)
**Zwilling:** `~/kasseneck_api` (Flutter, Version 4.8.0)

## Global Constraints

- Code-Kommentare und Commit-Messages auf **Deutsch**; Commit-Stil `feat: …` / `fix: …` / `test: …`.
- Der Output soll ununterscheidbar von handgeschriebenem Code und handgeschriebener Doku sein
  — keine Werkzeug- oder Generator-Hinweise in Code, Kommentaren, Commits oder Dokumenten.
- **Wertgleichheit mit dem Flutter-Paket ist Pflicht**, nicht Absicht: Enum-Schlüssel und
  -Nutzlastwerte müssen identisch sein. Die RKSV-Kategorie-Buchstaben (`A`=20 %, `B`=10 %, `C`=13 %,
  `D`=0 %, `E`=19 %, `G`=4,9 %) hängen an der Signatur — sie sind **unantastbar**.
- **Geldbeträge sind ganzzahlige Cent.** Keine Fließkommazahlen für Beträge, nirgends.
- **Das Backend antwortet immer mit HTTP 200**; Erfolg oder Fehler stehen im Rumpf
  (`{status: "success"|"error", ...}`). Der Client übersetzt das in ein sauberes Ergebnis bzw. einen
  Fehler — ein Verbraucher darf nie selbst auf `status` prüfen müssen.
- **Kein Firebase im Paket.** Der Kassen-Benutzer-Weg bekommt eine Funktion, die ein Token liefert.
- **Nativ ist draußen:** Hobex HPS (lokales TCP), myPOS und SumUp (Android-SDKs) kommen nicht ins
  Paket. Wo das auffallen könnte, steht ein Kommentar mit Begründung.
- **Testdisziplin:** Ein Namenstest zählt nicht. Jeder Test muss aus dem Zustand vor der Umsetzung
  heraus **rot** sein können. Für sicherheitsrelevante Zusagen eine belegte **Rot-Probe**
  (Eigenschaft brechen, Fehlschlag mit Ausgabe belegen, zurücknehmen, per `git diff --stat`
  nachweisen). Bestehende Tests werden **nicht** abgeschwächt, damit neuer Code durchgeht.
- Jeder Task endet **grün**.

**Kommandos** (aus dem Repo-Wurzelverzeichnis `~/kreiseck/kasseneck-api`):

```bash
npm run build      # tsc, ESM + CJS
npm test           # tsc der Tests + node --test
```

---

## File Structure

| Datei | Verantwortung |
|-------|---------------|
| `package.json`, `tsconfig*.json`, `LICENSE`, `NOTICE`, `README.md` | Gerüst nach dem Vorbild `@kreiseck/rksv`, aber ESM+CJS |
| `src/enums/*.ts` | Belegtyp, Steuersatz, Zahlungsart, Kartenanbieter, Gutscheinart/-aktion, Kassen-/Signaturstatus |
| `src/models/*.ts` | Beleg, Position, Gutschein, Kasse, Berichtsmonat, Stripe-Sitzung, Hobex-Beleg |
| `src/client/transport.ts` | HTTP, Fehlerhülle, Zeitüberschreitung |
| `src/client/auth.ts` | Anmeldung: `apiKeyAuth(...)` und `registerUserAuth(...)` |
| `src/client/index.ts` | `KasseneckApi` — die Endpunkte |
| `src/printing/escpos.ts` | Bytefolgen-Erzeugung |
| `src/receipt/layout.ts` | Beleg-Layout ohne Framework |
| `react/index.tsx` | Adapter, eigener Einstiegspunkt, React als Peer |
| `src/payments/*.ts` | Hobex Cloud, Stripe-Zahllinks |
| `test/**` | `node --test`, inkl. Gleichheits-Wächter |
| `test/fixtures/dart-enums.json` | eingecheckter Abzug der Dart-Enums |

---

### Task 1: Gerüst, Enums und der Gleichheits-Wächter

**Files:** `package.json`, `tsconfig.json`, `tsconfig.cjs.json`, `tsconfig.test.json`, `LICENSE`,
`NOTICE`, `.gitignore`, `src/enums/*.ts`, `src/index.ts`, `test/enums.test.ts`,
`test/fixtures/dart-enums.json`

**Produces:** alle Enums als konstante Objekte plus Typen; `dart-enums.json`; der Wächter.

**Die Enum-Werte, wörtlich aus dem Flutter-Paket** (`~/kasseneck_api/lib/enums/`):

```
ReceiptType:  start | standard | zero | cancellation | training
              je mit needsItems / isZero / allowsVouchers (siehe receipt_type.dart)
VatRate:      vat0=0/'D' · vat4komma9=4.9/'G' · vat10=10/'B' · vat13=13/'C' · vat19=19/'E' · vat20=20/'A'
KeckPaymentMethod: cash, creditCard, online, uberApp, uberCash, uberCard, boltApp, boltCash, boltCard
              je mit needsCreditCard / label (siehe keck_payment_method.dart)
CreditCardProvider: gpTomAndroid, gpTomIos, hobexCloudApi, hobexHps, sumup, myposPro, stripe, custom
VoucherType:  value | promo        VoucherAction: sell | redeem
```

`hobexHps`, `sumup`, `myposPro` bleiben im **Enum** (das Backend kennt sie, Belege aus der
Flutter-App tragen sie), nur die **Anbindung** fehlt. Ein Kommentar hält das fest.

- [ ] **Step 1: Failing test** — `test/enums.test.ts` liest `test/fixtures/dart-enums.json` und
  vergleicht Schlüssel **und** Werte gegen die TypeScript-Enums. Beide Richtungen: kein Schlüssel
  fehlt, keiner ist zu viel.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import abzug from './fixtures/dart-enums.json' with { type: 'json' };
import { VatRate, ReceiptType } from '../src/enums/index.js';

test('Steuersätze decken sich mit dem Flutter-Paket', () => {
  assert.deepEqual(Object.keys(VatRate).sort(), Object.keys(abzug.VatRate).sort());
  for (const [k, v] of Object.entries(abzug.VatRate)) {
    assert.deepEqual({ rate: VatRate[k].rate, category: VatRate[k].category }, v,
      `Steuersatz ${k} weicht ab — die Kategorie haengt an der Signatur`);
  }
});
```

- [ ] **Step 2:** `npm test` → FAIL (nichts existiert)
- [ ] **Step 3:** Gerüst anlegen (Vorbild `~/kreiseck-wt-rksv/packages/rksv`: `files`,
  `publishConfig`, `engines`, `license`, `prepublishOnly`), **aber** Ausgabe ESM **und** CJS über
  zwei tsconfigs, `exports` mit `types`/`import`/`require` je Unterpfad
- [ ] **Step 4:** Enums schreiben; `dart-enums.json` aus den Dart-Dateien erzeugen (von Hand
  übertragen, Herkunft im Kopf der Datei vermerken)
- [ ] **Step 5:** `npm test` → PASS · `npm run build` → beide Formate liegen in `dist/`
- [ ] **Step 6: Rot-Probe** — einen Kategorie-Buchstaben verfälschen, Wächter muss fallen,
  zurücknehmen, `git diff --stat` belegen
- [ ] **Step 7: Commit** `feat(paket): Geruest, Enums und Gleichheits-Waechter`

---

### Task 2: Modelle

**Files:** `src/models/*.ts`, `test/models.test.ts`

Beleg, Belegposition, Gutschein, Kasse, Berichtsmonat, Stripe-Sitzung, Hobex-Beleg — Feldnamen
**wie im Flutter-Paket** (`~/kasseneck_api/lib/models/`), damit dieselbe Nutzlast entsteht.

**Verbindlich:** Beträge als **ganzzahlige Cent**; Umwandlung von/zu der Nutzlast an genau einer
Stelle. Ein Modell, das mal Cent und mal Euro führt, erzeugt Rundungsfehler, die niemand mehr
zuordnet.

- [ ] **Step 1:** Tests zuerst — Nutzlast hin und zurück (`toPayload`/`fromPayload`) ergibt
  denselben Wert; Beträge bleiben ganzzahlig; ein Beleg mit allen fünf Steuersätzen behält seine
  Summen
- [ ] **Step 2:** FAIL · **Step 3:** Modelle · **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(paket): Modelle des Beleg- und Kassenbereichs`

---

### Task 3: Transport und die zwei Anmeldewege

**Files:** `src/client/transport.ts`, `src/client/auth.ts`, `test/transport.test.ts`,
`test/auth.test.ts`

**Das Herzstück.** Drei Dinge, sauber getrennt:

1. **Transport** — POST an `<basis>/<funktion>`, JSON hin, JSON zurück, Zeitüberschreitung,
   Netzfehler als eigener Fehlertyp.
2. **Fehlerhülle** — Das Backend antwortet **immer** mit HTTP 200; `{status:"error", message}` wird
   zu einem geworfenen `KasseneckApiError` mit Meldung und Funktionsname. Ein Verbraucher prüft nie
   selbst auf `status`.
3. **Anmeldung** — austauschbar:
   - `apiKeyAuth({ apiKey, cashregisterToken })` → `Authorization: Bearer <apiKey>` +
     `cashregister-token`
   - `registerUserAuth({ getIdToken, getSessionId })` → `Authorization: Bearer <idToken>` +
     `register-session`; die Kasse geht als Parameter `cashregisterId` mit
   Beide liefern nur Kopfzeilen und ggf. Zusatzparameter — **kein** Weg bevorzugt den anderen.

- [ ] **Step 1: Failing tests**
  - derselbe Aufruf erzeugt mit `apiKeyAuth` die eine, mit `registerUserAuth` die andere Kopfzeile
  - `{status:"error"}` wirft mit der Meldung des Backends **und** dem Funktionsnamen
  - `{status:"success"}` liefert die Nutzlast ohne Hülle
  - HTTP-Fehler und Netzfehler sind unterscheidbar von fachlichen Fehlern
  - **Kein Geheimnis in der Fehlermeldung:** Ein Fehler darf weder `api_key` noch Token enthalten —
    Fehlermeldungen landen in Protokollen
- [ ] **Step 2:** FAIL · **Step 3:** umsetzen · **Step 4:** PASS
- [ ] **Step 5: Rot-Probe** für die Geheimnis-Zusage und für die Fehlerhülle
- [ ] **Step 6: Commit** `feat(paket): Transport, Fehlerhuelle und zwei Anmeldewege`

---

### Task 4: Beleg-Endpunkte

**Files:** `src/client/index.ts`, `test/client-receipts.test.ts`

Nach dem Vorbild von `~/kasseneck_api/lib/kasseneck_api.dart`:
`sellReceipt`, `cancelReceipt`, `createCancelReceipt`, `zeroReceipt`, `getReceipt`,
`generateFullReceiptId`, `getFirstReceiptDate`.

**Verbindlich:** Je Aufruf ein **Vertragstest** — welcher Endpunktname, welche Parameter. Das ist die
Stelle, an der ein Tippfehler sonst erst in Produktion auffällt; die Typprüfung sieht ihn nicht,
weil es Zeichenketten sind.

- [ ] **Step 1:** Tests zuerst, je Aufruf Name **und** vollständige Parameterliste; dazu: mit
  `registerUserAuth` geht `cashregisterId` mit, mit `apiKeyAuth` nicht
- [ ] **Step 2:** FAIL · **Step 3:** umsetzen · **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(paket): Beleg-Endpunkte`

---

### Task 5: Berichte und Status

**Files:** `src/client/index.ts`, `test/client-reports.test.ts`

`downloadDailyReport`, `downloadMonthlyReport` (beide liefern Binärdaten — als `Uint8Array`, nicht
als Zeichenkette), `getCashboxStatus`, `getSignatureStatus`.

- [ ] **Step 1:** Tests zuerst, inklusive: Binärantworten werden **nicht** als Text behandelt
- [ ] **Step 2:** FAIL · **Step 3:** umsetzen · **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(paket): Berichte und Statusabfragen`

---

### Task 6: ESC/POS-Erzeugung

**Files:** `src/printing/escpos.ts`, `test/escpos.test.ts`

Reine Bytefolgen-Erzeugung nach dem Vorbild `~/kasseneck_api/lib/src/printing/escpos/` —
Textausgabe, Ausrichtung, Betonung, Schnitt, QR-Code, Spalten. **Kein Transport.**

**Verbindlich:** Die Tests vergleichen **Byte für Byte** gegen feste Erwartungswerte. Bei ESC/POS
zählt jedes Byte; ein „ungefähr richtiger" Steuerbefehl druckt Unsinn.

- [ ] **Step 1:** Tests zuerst, mit festen Byte-Erwartungen aus dem Flutter-Vorbild
- [ ] **Step 2:** FAIL · **Step 3:** umsetzen · **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(paket): ESC/POS-Erzeugung`

---

### Task 7: Beleg-Layout und React-Adapter

**Files:** `src/receipt/layout.ts`, `react/index.tsx`, `test/layout.test.ts`, `test/react.test.tsx`

**Kern:** aus einem Beleg ein Layout-Modell (Zeilen mit Ausrichtung, Betonung, Trennern) — ohne
Framework, nutzbar im Browser, in Node für ein PDF und als Vorlage für den ESC/POS-Erzeuger.

**Adapter:** zeichnet das Modell; React als **Peer-Abhängigkeit**, eigener Einstiegspunkt `./react`.

- [ ] **Step 1:** Tests zuerst — Layout enthält die Pflichtangaben eines Belegs
  (Unternehmen, Belegnummer, Datum, Positionen mit Menge und Bezeichnung, Summe, QR); der
  React-Adapter erzeugt daraus Text (`react-dom/server`), ohne dass das Kern-Paket React braucht
- [ ] **Step 2:** FAIL · **Step 3:** umsetzen · **Step 4:** PASS
- [ ] **Step 5:** Prüfen, dass ein Import des Kerns **kein** React lädt
- [ ] **Step 6: Commit** `feat(paket): Beleg-Layout und React-Adapter`

---

### Task 8: Zahlungen

**Files:** `src/payments/stripe.ts`, `src/payments/hobex.ts`, `test/payments.test.ts`

`createStripeLink`, `stripeCaptureIntent`, `hobexPay`, `hobexRefund` — alles über dieselben
Backend-Endpunkte wie im Flutter-Paket.

**Verbindlich:** Ein Kommentar hält fest, **warum** Hobex HPS, myPOS und SumUp fehlen (lokales TCP
bzw. Android-SDKs — im Browser grundsätzlich nicht erreichbar), damit niemand sie „nachrüstet".

- [ ] **Step 1:** Tests zuerst, je Aufruf Name und vollständige Parameterliste
- [ ] **Step 2:** FAIL · **Step 3:** umsetzen · **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(paket): Stripe-Zahllinks und Hobex Cloud`

---

## Nach dem Plan

- **Noch nicht veröffentlichen.** Erst wenn die Browser-Kasse (Block C) damit kassiert, steht die
  Schnittstelle. Bis dahin bindet die Kasse das Paket lokal ein.
- **GitHub-Repo** unter `kreiseck-at` anlegen — vor dem ersten Push zu entscheiden.
- **Versionierung** ab der ersten Veröffentlichung parallel zum Flutter-Paket führen.
- Offen für später: Rechnungs-Endpunkte, Artikel/Lager, weitere Berichte — nach Bedarf von Block C.
