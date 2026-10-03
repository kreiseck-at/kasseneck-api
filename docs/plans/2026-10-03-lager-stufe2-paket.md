# Lager-Kern Stufe 2b – `@kreiseck/kasseneck-api` Implementation Plan

Schritte mit Kästchen (`- [ ]`) zum Abhaken; Tasks der Reihe nach, jeder endet grün und mit einem Commit.

**Goal:** Das npm-Paket spricht, was das Backend seit Lager-Kern Stufe 2a anbietet – Standorte und
Bestand an der Kasse, Standort je Kasse, Rückgabe-Wahl beim Storno, Lagerfelder der Rechnungs-API –
als 1.2.0 auf `main`, und die 0.x-Linie bekommt als 0.32.0 genau die Vertragsteile, an denen das
Backend seine Zwillingstests prüft.

**Architecture:** Drei neue Kassen-Aufrufe in einer eigenen Datei `src/pos/lager.ts` (Muster
`trinkgeld.ts`/`drucker.ts`: freie Funktionen über `InternerTransport`, lesen tolerant, schreiben
streng). Die Rückgabe-Wahl ist ein Katalog an einer Stelle (`src/models/cancellation.ts`), den Storno,
Rechnungsvertrag und `./pos` gemeinsam nutzen. Alles, was am Vertrag hängt (Aufruflisten, Fehlercodes,
Kataloge, `surface.json`, Rechnungs-Schema, `./stored`), wird aus dem Backend-Export `functions/vertrag/v3`
abgeleitet und von bestehenden Wächtern gehalten. Die 0.x-Linie bekommt nur Fehlercode und
Rechnungsfelder (eigener Zweig von `origin/release/0.x`).

**Tech Stack:** TypeScript 5.4+, ESM + CJS über zwei `tsc`-Läufe, `node --test` auf `test-dist`,
Node ≥ 20.18; Backend-Vertrag als JSON (`fixtures/v3/`); Backend-Seite Jest (`functions/`).

**Spec:** `/Users/mali/kasseneck-wt-lager-s2/docs/specs/2026-10-02-lager-kern-design.md`, Abschnitt
„Stand Stufe 2a (Backend, 2026-10-03)“ (Übergabe 2b). Dazu `docs/api/rechnungen.md` dort und der
Vertrags-Export `functions/vertrag/v3/` (Vokabular, `antworten/kasse.json`, `stored/`).

---

## Global Constraints

- Code-Kommentare und Commit-Messages **deutsch**, im Stil des Repos (`feat(pos): …`, `fix: …`,
  `test: …`, `chore: …`, `docs: …`); Kommentare in Quelltext mit `ae/oe/ue/ss` wie im Bestand.
- **Keine Spuren:** kein Hinweis auf Werkzeuge, Generatoren oder Assistenten in Code, Kommentaren,
  Doku, Commits, PRs, Branch-Namen. **Keine `Co-Authored-By`-Zeile**, kein Footer in PRs.
- **Öffentliche API englisch** (Exportnamen, Feldnamen, Werte, Fehlercodes, Parameter). Wächter:
  `test/export-namen.test.ts` (Parameter nur aus der Positivliste: `transport`, `options`, `payload`,
  `value` …; darum nehmen neue Aufrufe ein `options`-Objekt).
- CHANGELOG der 1.x-Linie englisch (wie ab 1.0.0), der 0.x-Linie deutsch (wie dort).
- Sichtbarer Text: Halbgeviertstrich „–“, nie den Geviertstrich; deutsche Anführungszeichen „…“.
- **Nur erfundene Testdaten.** Betriebe: Bäckerei Kornblum, Max Hollerer GmbH. Kennungen in neuen
  Fixtures englisch und neutral (`rye-bread`, `store-1`, `van-1`), **nie** mit `art_`-Präfix (der
  Fixture-Wächter `test/fixtures-v3.test.ts` führt `art` als deutsches Wort). Keine echten Namen,
  Steuernummern, UIDs, IBANs.
- **Geld und Mengen als Ganzzahl:** Cent, Mikro-Euro, Lagermengen in Tausendstel der Basiseinheit
  (`1000` = 1 Stück). Nie teilen, nie runden, nie klemmen.
- `fixtures/v3/` ist eine **byte-gleiche Kopie** des Backend-Exports, nie von Hand ändern
  (`test/v3-vertrag.test.ts`). Erzeugte Dateien (`surface.json`, `invoice-api.schema.json`,
  `src/stored/vokabular.ts`, `test/fixtures/stored-zwillinge.json`) nur über ihre Skripte.
- Jeder Task endet **grün** in `npm test` (drei Zeitzonen). Bestehende Tests werden nicht abgeschwächt;
  geänderte Erwartungen nur dort, wo der Vertrag sie ändert (genannt im Task).
- **Pakete nur aus sauberer Kopie veröffentlichen:** frischer Klon des Zweigs, `files`-Whitelist in
  `package.json` (`dist`, `fixtures`, `README.md`, `CHANGELOG.md`, `NOTICE`), `npm pack --dry-run`
  prüfen, keine `.env*`, keine `*.tgz`, kein `test-dist`. Veröffentlichen ist **immer ein vom Nutzer
  bestätigter Schritt**.
- Worktree-Regeln: in diesem Worktree (`/Users/mali/kreiseck/kasseneck-api-wt-lager`, Zweig
  `feature/lager-stufe2`) arbeiten; die 0.x-Rückportierung in einem **eigenen** Worktree auf eigenem
  Zweig; andere Checkouts (Haupt-Checkout, Backend-Worktrees) nur lesen, nie Zweige wechseln.
- Die 0.x-Linie bekommt **keine** neuen Aufrufe und kein neues Verhalten der Kasse – nur den Storno-Code
  und die Rechnungsfelder, die das vendorierende Backend braucht.

**Kommandos** (aus dem Repo-Wurzelverzeichnis):

```bash
npm ci                                   # einmalig im Worktree (kein node_modules vorhanden)
npm run build                            # tsc ESM + CJS, prüft die exports
npm test                                 # alle Tests in drei Zeitzonen
npx tsc -p tsconfig.test.json && TZ=Europe/Vienna node --test test-dist/test/<name>.test.js   # ein Test
```

## Review Focus

- **Kassier ohne Recht `stockCosts`:** `listMyStock` liefert `values: null` (Feld fehlt in der Antwort),
  nicht `[]` – die Oberfläche darf dann keinen Lagerwert „0,00 €“ zeigen; mit Recht und ohne
  Bewertungen ist es `[]`. Test in Task 2.
- **Negativer oder gebrochener Bestand** (mehr verkauft als gebucht, `lager_minus`; 0,250 kg):
  `sellable: -2500`, `available: 250` bleiben exakt so stehen – kein Klemmen auf 0, kein Teilen durch
  1000; `averageCostMicros` ist bei Menge 0 `null`, nie `NaN` oder `0`. Test in Task 2.
- **Standort zurücksetzen:** `setMyCashregisterStockLocation({ stockLocationId: null })` sendet `''`
  und liest `stockLocationId: null`; ohne `cashregisterId` gilt die Kasse der Anmeldung (die Bindung
  aus `registerUserAuth` wird nicht durch `undefined` überschrieben). Test in Task 2.
- **Rückgabe-Wahl mit innerem oder vertipptem Wert** (`'lager'`, `'defekt'` aus 0.x/Firestore, `null`
  aus JavaScript): kein Aufruf geht hinaus, `KasseneckValidationError` nennt den Pfad
  (`items[1].returnDisposition`). Test in Task 4.
- **Gespeicherter Storno-Beleg über `./stored`** mit `rueckgabe: 'defekt'` und `lagerStandortId`:
  englisch `returnDisposition: 'defective'`, `lagerStandortId` nie im Draht; ein unbekannter innerer
  Wert fällt weg wie am Rand des Servers. Test in Task 6.

---

## File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `fixtures/v3/**` | Kopie des Backend-Exports (Skript) | 1 |
| `src/client/aufrufe.ts` | `ALL_CALLS`, `PUBLIC_CALLS`, `POS_CALLS` | 1 |
| `src/models/{cancellation,receipt-errors,receipt-email,payment-errors}.ts`, `src/register/errors.ts`, `src/pos/errors.ts`, `src/client/errors.ts`, `src/invoice/vertrag.ts` | Fehlercode-Listen (`api_not_approved`, `invalid_return_disposition`, Lager-Codes) | 1, 2 |
| `src/stored/vokabular.ts` | erzeugt (`fixtures:stored`) | 1 |
| `src/pos/lager.ts` (neu) | Standorte, Bestand, Standort der Kasse | 2 |
| `src/pos/index.ts` | Exporte `./pos` | 2, 4 |
| `src/pos/artikel.ts`, `src/models/cashregister.ts`, `src/register/pairing.ts` | Standort-Felder, Lager-Rechte | 3 |
| `src/models/cancellation.ts`, `src/models/receipt-item.ts`, `src/models/receipt.ts`, `src/client/receipts.ts` | Rückgabe-Wahl: Katalog, Lesen, Storno-Aufruf | 4 |
| `src/invoice/vertrag.ts`, `src/invoice/typen.ts`, `src/invoice/index.ts`, `fixtures/invoice-api-examples/*` | Lagerfelder der Rechnungs-API | 5 |
| `src/stored/draht.ts`, `scripts/stored-zwillinge.mjs`, `test/fixtures/stored-zwillinge.json` | `./stored`-Zwilling | 6 |
| `README.md`, `CHANGELOG.md` | Doku | 7 |
| `package.json`, `package-lock.json`, `src/version.ts`, versionstragende Fixtures | 1.2.0 | 8 |
| Zweig `fix/lager-stufe2-0x` (von `origin/release/0.x`) | 0.32.0 | 9, 10 |
| keck: `functions/package.json`, `functions/vendor/*.tgz`, zwei Zwillingstests | Backend-Nachzug | 11 |
| Tests: `test/lager-kasse.test.ts` (neu), `test/kasse-v3.test.ts`, `test/oberflaeche.test.ts`, `test/kasse.test.ts`, `test/cancellation.test.ts`, `test/client-receipts.test.ts`, `test/rechnung-vertrag.test.ts`, `test/rechnung-client.test.ts`, `test/stored.test.ts`, `test/stored-backend.test.ts` | | je Task |

---

## Vorbedingungen (vor Task 1, kein Commit)

Der Backend-Zweig `feature/lager-stufe2` ist noch nicht gemergt; im Worktree
`/Users/mali/kasseneck-wt-lager-s2` läuft zur Zeit des Plans ein Merge von `origin/main` (Konflikt im
Export). Das Paket holt den Vertrag **nur aus einem committeten Stand, der `origin/main` enthält** –
sonst fehlen öffentliche Endpunkte von `main` (Rechnungskorb, Mandate), und `PUBLIC_CALLS` liefe gegen
eine falsche Liste.

- [ ] **Schritt 1: Backend-Stand prüfen** (nur lesen, nichts im Backend-Worktree ändern)

```bash
B=/Users/mali/kasseneck-wt-lager-s2
git -C $B fetch -q origin
# a) bevorzugt: Lager ist schon gemergt -> Quelle ist origin/main
git -C $B merge-base --is-ancestor origin/feature/lager-stufe2 origin/main && echo "QUELLE=origin/main"
# b) sonst: der gepushte Lager-Zweig enthaelt origin/main -> Quelle ist origin/feature/lager-stufe2
git -C $B merge-base --is-ancestor origin/main origin/feature/lager-stufe2 && echo "QUELLE=origin/feature/lager-stufe2"
```

Erwartet: mindestens eine der beiden Zeilen. Kommt keine, ist der Backend-Zweig noch nicht auf `main`
nachgezogen – **hier anhalten** und die Backend-Sitzung fragen (`merge origin/main`, dann
`cd functions-kasse && npm run vertrag:v3 && cd ../functions && npm run vertrag:v3`, committen, pushen).

- [ ] **Schritt 2: Export aus dem gewählten Ref in ein Wegwerfverzeichnis holen** (unabhängig vom
  Arbeitsstand des Backend-Worktrees, auch während dort gemergt wird)

```bash
REF=origin/main                      # bzw. origin/feature/lager-stufe2 aus Schritt 1
EXPORT=$(mktemp -d)
git -C /Users/mali/kasseneck-wt-lager-s2 archive "$REF" functions/vertrag/v3 | tar -x -C "$EXPORT"
python3 - "$EXPORT/functions/vertrag/v3/v3-vokabular.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
e = d['endpoints']
assert e['register'][-3:] == ['listMyStockLocations', 'listMyStock', 'setMyCashregisterStockLocation'], e['register'][-3:]
assert 'createInvoiceItem' in e['public'], 'main (Rechnungskorb) fehlt im Export'
assert d['errorCodes']['cancellation'][-1] == 'invalid_return_disposition'
print('Export ok:', len(e['public']), 'oeffentlich,', len(e['register']), 'Kassenweg,', len(e['registerInternal']), 'nur Kasse')
EOF
echo "$EXPORT"   # fuer Task 1 merken
```

Erwartet: `Export ok: 60 oeffentlich, 28 Kassenweg, 22 nur Kasse`. Weicht die Zahl der öffentlichen
Endpunkte ab (`main` hat inzwischen mehr), gilt in Task 1 die Liste des Exports (`endpoints.public`,
äußere Namen über `names`, in Exportreihenfolge) und ihre Länge statt der unten genannten 60.

- [ ] **Schritt 3: Abhängigkeiten im Worktree**

```bash
cd /Users/mali/kreiseck/kasseneck-api-wt-lager && npm ci && npm test
```

Erwartet: grün auf dem Stand 1.1.1.

---

### Task 1: Vertrag `/v3` holen und die abgeleiteten Listen nachziehen

Der neue Export bringt drei Dinge, die bestehende Wächter sofort rot machen (nachgestellt: acht rote
Tests): (a) `api_not_approved` (Entwicklerbereich, keck#529) in `errorCodes.auth`, also in jeder aus
„Anmeldung + Rand“ abgeleiteten Liste; (b) neun öffentliche Endpunkte von `main` (Partner-Abrechnung,
Rechnungskorb, Mandate) – nur als **Namen** in `PUBLIC_CALLS`, ohne Umhüllung; (c) die Lager-Teile:
drei Kassen-Endpunkte, Storno-Code `invalid_return_disposition`, Artikelfeld `stockLocationIds` im
Schema von `listMyArticles`.

**Files:**
- Modify: `fixtures/v3/**` (Skript), `src/stored/vokabular.ts` (Skript), `fixtures/surface.json` (Skript)
- Modify: `src/client/aufrufe.ts` (`ALL_CALLS`, `PUBLIC_CALLS`, `POS_CALLS`, Kommentare 25/19)
- Modify: `src/models/cancellation.ts` (`CANCELLATION_ERROR_CODES`)
- Modify: `src/models/receipt-errors.ts:43`, `src/models/receipt-email.ts:26`, `src/models/payment-errors.ts:45`, `src/register/errors.ts:29`, `src/pos/errors.ts:25`, `src/invoice/vertrag.ts:88`, `src/client/errors.ts:271` (`api_not_approved`)
- Test: `test/oberflaeche.test.ts:141-159`, `test/cancellation.test.ts:61-80`

**Interfaces:**
- Produces: `ApiCall` kennt `'listMyStockLocations' | 'listMyStock' | 'setMyCashregisterStockLocation'`
  (Task 2 braucht das für `InternerTransport`); `isPosOnlyCall` liefert für alle drei `true`;
  `CANCELLATION_ERROR_CODES[19] === 'invalid_return_disposition'`.

- [ ] **Schritt 1: Export holen (macht die Wächter rot)**

```bash
cd /Users/mali/kreiseck/kasseneck-api-wt-lager
KASSENECK_BACKEND="$EXPORT" node scripts/v3-vertrag-holen.mjs
npm run fixtures:stored
npm test 2>&1 | grep -E "^not ok|^# fail"
```

Erwartet: FAIL, u. a. `v3: PUBLIC_CALLS ist deckungsgleich …`, `v3: POS_CALLS …`, `v3: nur ueber den
Kassenweg …`, `Kataloge und Codes sind die des /v3-Vokabulars`, `Fehlercode-Listen: deckungsgleich …`,
`INVOICE_REQUEST_ERROR_CODES …`, `Geldwege: Ablehnungscodes …` (expected 23, actual 24).

- [ ] **Schritt 2: Zahlen in den Wächtern auf den Vertrag stellen** (`test/oberflaeche.test.ts`)

```ts
test('v3: PUBLIC_CALLS ist deckungsgleich mit endpoints.public (aeussere Namen, 60)', () => {
  const erwartet = vokabular.endpoints['public']!.map((innen) => aussenName.get(innen) ?? innen);
  assert.deepEqual([...PUBLIC_CALLS], erwartet);
  assert.equal(PUBLIC_CALLS.length, 60);
  // Unter /v3 geroutet ist genau die oeffentliche Liste.
  assert.deepEqual([...vokabular.endpoints['v3Routed']!].sort(), [...vokabular.endpoints['public']!].sort());
});

test('v3: POS_CALLS ist deckungsgleich mit endpoints.register (28)', () => {
  assert.deepEqual([...POS_CALLS], vokabular.endpoints['register']);
  assert.equal(POS_CALLS.length, 28);
});

test('v3: nur ueber den Kassenweg gehen genau die 22 Namen aus endpoints.registerInternal', () => {
  const alle = new Set<string>([...PUBLIC_CALLS, ...POS_CALLS, ...vokabular.endpoints['registerInternal']!]);
  const nurKasse = [...alle].filter((name) => isPosOnlyCall(name)).sort();
  assert.deepEqual(nurKasse, [...vokabular.endpoints['registerInternal']!].sort());
  assert.equal(nurKasse.length, 22);
  for (const name of ['listMyStockLocations', 'listMyStock', 'setMyCashregisterStockLocation']) assert.ok(isPosOnlyCall(name), name);
});
```

und in `test/cancellation.test.ts` den Katalog-Test:

```ts
// Fehlercodes: die zwanzig aus errorCodes.cancellation, dahinter die der
// Anmeldung und des Rands (den Abgleich mit der Datei haelt receipts-v3.test.ts). Die Kasse entscheidet
// am Code (KasseneckApiError.code), nie am Text.
test('Fehlercode-Katalog: zwanzig /v3-Codes vorn, als Liste und Waechter', () => {
  assert.equal(CANCELLATION_ERROR_CODES.indexOf('cancellation_outcome_unknown'), 18);
  assert.equal(CANCELLATION_ERROR_CODES.indexOf('invalid_return_disposition'), 19);
  assert.equal(isCancellationErrorCode('invalid_return_disposition'), true);
  assert.equal(isCancellationErrorCode('rueckgabe_ungueltig'), false);
  // … die bisherigen Zusicherungen dieses Tests bleiben unveraendert darunter stehen
```

- [ ] **Schritt 3: Aufruflisten** (`src/client/aufrufe.ts`)

In `ALL_CALLS` nach `'listMyReceipts',` einfügen:

```ts
  'listMyStock',
  'listMyStockLocations',
```

und vor `'setMyKasseLogo',`:

```ts
  'setMyCashregisterStockLocation',
```

In `PUBLIC_CALLS` nach `'reportCustomerContract',`:

```ts
  'getPartnerBilling',
  'getPartnerBillingMonth',
```

und nach `'recordInvoicePayment',` (Ende der Liste):

```ts
  // Rechnungskorb und SEPA-Mandate (Backend keck#557): nur die Namen, damit
  // die Liste dem Vertrag folgt; umhuellt sind sie in diesem Paket noch nicht
  // (der offene Transport nimmt jeden Namen).
  'createInvoiceItem',
  'updateInvoiceItem',
  'withdrawInvoiceItem',
  'getInvoiceItem',
  'listInvoiceItems',
  'setCustomerMandate',
  'revokeCustomerMandate',
```

In `POS_CALLS` nach `'listMyTipRecipients',`:

```ts
  // Lager an der Kasse (Lager-Kern Stufe 2): nur ueber den Kassenweg.
  'listMyStockLocations',
  'listMyStock',
  'setMyCashregisterStockLocation',
```

Kommentare anpassen: „Einer der 25 Aufrufe des Kassenwegs“ → „Einer der 28 …“, „Nur ueber den
Kassenweg erreichbar (19 Namen)“ → „(22 Namen)“.

- [ ] **Schritt 4: `api_not_approved` in die abgeleiteten Listen**

In den sortierten Listen jeweils direkt nach `'admin_required',` einfügen (`src/models/receipt-errors.ts:43`,
`src/models/receipt-email.ts:26`, `src/models/payment-errors.ts:45`, `src/register/errors.ts:29`,
`src/models/cancellation.ts:76`, `src/pos/errors.ts:25`, `src/invoice/vertrag.ts:88`
`INVOICE_REQUEST_ERROR_CODES`):

```ts
  'api_not_approved',
```

In `PAYMENT_CALL_REJECTED_CODES` (`src/client/errors.ts`, Reihenfolge von `errorCodes.auth`) direkt nach
`'live_not_enabled',`:

```ts
  'api_not_approved',   // Live-API ohne Freigabe (Entwicklerbereich): vor dem Handler abgewiesen
```

- [ ] **Schritt 5: Storno-Code** (`src/models/cancellation.ts`, in `CANCELLATION_ERROR_CODES` direkt nach
  `'cancellation_outcome_unknown',`)

```ts
  'invalid_return_disposition',             // Rueckgabe-Wahl nicht restock, defective oder disposed (Lager)
```

- [ ] **Schritt 6: erzeugte Vertragsdateien nachziehen und alles prüfen**

```bash
npm run fixtures:kasse && npm run fixtures:oberflaeche && npm test
git status --short
```

Erwartet: PASS. `git status` zeigt `fixtures/v3/**`, `src/stored/vokabular.ts`, `fixtures/surface.json`
(`routes`, `calls.pos`) und die Quelltexte oben; `fixtures/pos-settings-defaults.json` nur, wenn `main`
Einstellungen geändert hat (dann mit einchecken).

- [ ] **Schritt 7: Commit**

```bash
git add fixtures/ src/ test/oberflaeche.test.ts test/cancellation.test.ts
git commit -m "chore(vertrag): fixtures/v3 mit Lager Stufe 2 geholt, Aufruf- und Codelisten nachgezogen"
```

---

### Task 2: Lager an der Kasse – `listMyStockLocations`, `listMyStock`, `setMyCashregisterStockLocation`

**Files:**
- Create: `src/pos/lager.ts`
- Modify: `src/pos/index.ts` (Exporte, Kopfkommentar), `src/pos/errors.ts` (`POS_ERROR_CODES`)
- Create: `test/lager-kasse.test.ts`
- Modify: `test/kasse-v3.test.ts` (Vertragsfälle, Fehlerfälle, Ableitung `POS_ERROR_CODES`)
- Modify: `fixtures/surface.json` (Skript: `pos.stockLocationTypes`)

**Interfaces:**
- Consumes: `ApiCall`-Namen aus Task 1.
- Produces (aus `@kreiseck/kasseneck-api/pos`):
  - `STOCK_LOCATION_TYPES: readonly ['warehouse','store','vehicle','other']`, `type StockLocationType`
  - `interface StockLocation { id: string; name: string; type: StockLocationType | null; address: StockLocationAddress | null; licensePlate: string | null; active: boolean; virtual: boolean }`
  - `interface StockLocationAddress { street: string | null; zip: string | null; city: string | null; country: string | null }`
  - `interface StockLevel { articleId: string; locationId: string; sellable: number; defective: number; reserved: number; available: number }` (Tausendstel)
  - `interface StockValue { articleId: string; stockValueCents: number; averageCostMicros: number | null }`
  - `interface StockList { stock: StockLevel[]; values: StockValue[] | null }`
  - `interface ListMyStockOptions { locationId?: string; articleId?: string; belowMinimum?: boolean }`
  - `interface SetMyCashregisterStockLocationOptions { stockLocationId: string | null; cashregisterId?: string }`
  - `interface CashregisterStockLocation { cashregisterId: string; stockLocationId: string | null }`
  - `listMyStockLocations(transport): Promise<StockLocation[]>`
  - `listMyStock(transport, options?: ListMyStockOptions): Promise<StockList>`
  - `setMyCashregisterStockLocation(transport, options): Promise<CashregisterStockLocation>`

- [ ] **Schritt 1: Failing Tests – Einheiten** (`test/lager-kasse.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listMyStockLocations, listMyStock, setMyCashregisterStockLocation, STOCK_LOCATION_TYPES,
} from '../src/pos/index.js';
import { isKasseneckValidationError } from '../src/client/errors.js';

/*
 * Lager an der Kasse ohne Netz: was hinausgeht und wie die Antwort gelesen
 * wird. Die Vertragsfaelle des Backends prueft kasse-v3.test.ts.
 */

type Aufruf = [string, Record<string, unknown> | undefined];
function attrappe(daten: unknown): { rufen: never; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const rufen = (async (name: string, params?: Record<string, unknown>) => {
    aufrufe.push([name, params]);
    return daten;
  }) as never;
  return { rufen, aufrufe };
}

test('STOCK_LOCATION_TYPES: die vier Typen des Backends, englisch', () => {
  assert.deepEqual([...STOCK_LOCATION_TYPES], ['warehouse', 'store', 'vehicle', 'other']);
});

test('listMyStockLocations: unbekannter Typ wird null, fehlende Adresse null, virtual nur wenn true', async () => {
  const { rufen, aufrufe } = attrappe({
    locations: [
      { id: 'store-1', name: 'Bäckerei Kornblum Filiale', type: 'store', address: { street: 'Mühlgasse 3', zip: '4020', city: 'Linz', country: 'AT' }, licensePlate: null, active: true },
      { id: 'van-1', name: 'Lieferwagen', type: 'boat', address: null, licensePlate: 'L-1234X', active: false, virtual: 'ja' },
    ],
  });
  const orte = await listMyStockLocations(rufen);
  assert.deepEqual(aufrufe, [['listMyStockLocations', undefined]]);
  assert.deepEqual(orte, [
    { id: 'store-1', name: 'Bäckerei Kornblum Filiale', type: 'store', address: { street: 'Mühlgasse 3', zip: '4020', city: 'Linz', country: 'AT' }, licensePlate: null, active: true, virtual: false },
    { id: 'van-1', name: 'Lieferwagen', type: null, address: null, licensePlate: 'L-1234X', active: false, virtual: false },
  ]);
});

test('listMyStock: negativer und gebrochener Bestand bleibt exakt (Tausendstel), ohne Recht stockCosts values null', async () => {
  const zeile = { articleId: 'rye-bread', locationId: 'store-1', sellable: -2500, defective: 0, reserved: 0, available: -2500 };
  const halb = { articleId: 'flour', locationId: 'store-1', sellable: 250, defective: 0, reserved: 0, available: 250 };
  const { rufen } = attrappe({ stock: [zeile, halb] });
  const liste = await listMyStock(rufen);
  assert.deepEqual(liste.stock, [zeile, halb]);
  assert.equal(liste.values, null, 'ohne Recht stockCosts: null, nie []');
});

test('listMyStock: mit Recht leere Werte bleiben [], averageCostMicros bei Menge 0 null', async () => {
  assert.deepEqual((await listMyStock(attrappe({ stock: [], values: [] }).rufen)).values, []);
  const { values } = await listMyStock(attrappe({
    stock: [],
    values: [{ articleId: 'rye-bread', stockValueCents: 4800, averageCostMicros: 3000000 }, { articleId: 'flour', stockValueCents: 0, averageCostMicros: null }],
  }).rufen);
  assert.deepEqual(values, [
    { articleId: 'rye-bread', stockValueCents: 4800, averageCostMicros: 3000000 },
    { articleId: 'flour', stockValueCents: 0, averageCostMicros: null },
  ]);
});

test('listMyStock: leere Filter gehen nicht hinaus, belowMinimum nur wenn true, falscher Typ nicht vor das Netz', async () => {
  const a = attrappe({ stock: [] });
  await listMyStock(a.rufen, { locationId: '', articleId: undefined, belowMinimum: false });
  await listMyStock(a.rufen, { locationId: 'van-1', articleId: 'rye-bread', belowMinimum: true });
  assert.deepEqual(a.aufrufe, [
    ['listMyStock', {}],
    ['listMyStock', { locationId: 'van-1', articleId: 'rye-bread', belowMinimum: true }],
  ]);
  const b = attrappe({ stock: [] });
  await assert.rejects(() => listMyStock(b.rufen, { locationId: 5 as never }), (e) => isKasseneckValidationError(e) && /locationId/.test(e.message));
  await assert.rejects(() => listMyStock(b.rufen, { belowMinimum: 'ja' as never }), /belowMinimum/);
  assert.equal(b.aufrufe.length, 0);
});

test('listMyStock: fehlende Liste ist ein Antwortfehler, keine leere Liste', async () => {
  await assert.rejects(() => listMyStock(attrappe({}).rufen), /data\.stock/);
});

test('setMyCashregisterStockLocation: null setzt zurueck (leerer Text), Antwort null bleibt null', async () => {
  const { rufen, aufrufe } = attrappe({ cashregisterId: 'K1', stockLocationId: null });
  const stand = await setMyCashregisterStockLocation(rufen, { cashregisterId: 'K1', stockLocationId: null });
  assert.deepEqual(aufrufe, [['setMyCashregisterStockLocation', { cashregisterId: 'K1', stockLocationId: '' }]]);
  assert.deepEqual(stand, { cashregisterId: 'K1', stockLocationId: null });
});

test('setMyCashregisterStockLocation: ohne cashregisterId geht keiner hinaus (die Anmeldung bindet die Kasse)', async () => {
  const { rufen, aufrufe } = attrappe({ cashregisterId: 'K1', stockLocationId: 'van-1' });
  await setMyCashregisterStockLocation(rufen, { stockLocationId: 'van-1' });
  assert.deepEqual(aufrufe, [['setMyCashregisterStockLocation', { stockLocationId: 'van-1' }]]);
});

test('setMyCashregisterStockLocation: undefined, Zahl oder leere Kasse gehen nicht hinaus; Antwort ohne Kasse ist ein Fehler', async () => {
  const { rufen, aufrufe } = attrappe({ cashregisterId: 'K1', stockLocationId: 'van-1' });
  await assert.rejects(() => setMyCashregisterStockLocation(rufen, {} as never), /stockLocationId/);
  await assert.rejects(() => setMyCashregisterStockLocation(rufen, { stockLocationId: 7 as never }), /stockLocationId/);
  await assert.rejects(() => setMyCashregisterStockLocation(rufen, { stockLocationId: 'van-1', cashregisterId: ' ' }), /cashregisterId/);
  assert.equal(aufrufe.length, 0);
  await assert.rejects(() => setMyCashregisterStockLocation(attrappe({ stockLocationId: 'van-1' }).rufen, { stockLocationId: 'van-1' }), /cashregisterId/);
});
```

- [ ] **Schritt 2: Failing Tests – Vertragsfälle** (`test/kasse-v3.test.ts`)

Import ergänzen: `listMyStockLocations, listMyStock, setMyCashregisterStockLocation, STOCK_LOCATION_TYPES`
aus `'../src/pos/index.js'`. Nach dem Test `listMyTipRecipients: …` einfügen:

```ts
// --- Lager an der Kasse --------------------------------------------------------

test('listMyStockLocations: Standorte wie im Fall, virtual nur am Hauptstandort', async () => {
  for (const f of erfolge('listMyStockLocations')) {
    const orte = await listMyStockLocations(kassenweg(f).rufen);
    assert.deepEqual(orte, f.response.data.locations.map((l: Json) => ({ ...l, virtual: l.virtual === true })), f.case);
  }
  assert.deepEqual([...STOCK_LOCATION_TYPES], Object.values(VOKABULAR.catalogs.STANDORT_TYP));
});

test('listMyStock: Bestand wie im Fall, values nur mit Recht stockCosts, Filter wie gesendet', async () => {
  for (const f of erfolge('listMyStock')) {
    const { rufen, aufrufe } = kassenweg(f);
    const liste = await listMyStock(rufen, f.params as { locationId?: string });
    assert.deepEqual(gesendet(aufrufe, 'listMyStock', f), f.params, f.case);
    assert.deepEqual(liste.stock, f.response.data.stock, f.case);
    assert.deepEqual(liste.values, f.response.data.values ?? null, f.case);
  }
});

test('setMyCashregisterStockLocation: sendet wie der Fall, leerer Standort heisst zurueckgesetzt', async () => {
  for (const f of erfolge('setMyCashregisterStockLocation')) {
    const { rufen, aufrufe } = kassenweg(f);
    const ziel = f.params.stockLocationId === '' ? null : (f.params.stockLocationId as string);
    const stand = await setMyCashregisterStockLocation(rufen, { cashregisterId: f.params.cashregisterId as string, stockLocationId: ziel });
    assert.deepEqual(gesendet(aufrufe, 'setMyCashregisterStockLocation', f), f.params, f.case);
    assert.deepEqual(stand, f.response.data, f.case);
  }
  // Ohne cashregisterId gilt die Kasse der Anmeldung (registerUserAuth: KASSE1).
  const f = fall('setMyCashregisterStockLocation', 'success_manager');
  const { rufen, aufrufe } = kassenweg(f);
  await setMyCashregisterStockLocation(rufen, { stockLocationId: 'auto1' });
  assert.deepEqual(aufrufe[0]!.params, { cashregisterId: 'KASSE1', stockLocationId: 'auto1' });
});
```

Im Test `Kasse: jeder Fehlerfall der uebrigen Kassen-Aufrufe wird am Code erkannt` die Tabelle `aufrufe`
ergänzen:

```ts
    listMyStockLocations: (r) => listMyStockLocations(r),
    listMyStock: (r) => listMyStock(r),
    setMyCashregisterStockLocation: (r) => setMyCashregisterStockLocation(r, { cashregisterId: 'KASSE1', stockLocationId: 'auto1' }),
```

Im Test `Fehlercode-Listen: deckungsgleich mit dem Vertrag …` die Ableitung von `POS_ERROR_CODES`:

```ts
  assert.deepEqual([...POS_ERROR_CODES], ableiten([
    'listMyArticleGroups', 'listMyArticles', 'getKasseSettings', 'setMyKasseSettings', 'setMyKasseLogo',
    'setMyRegisterDeviceSettings', 'listMyPrinters', 'createPrintJob', 'getPrintJob', 'listMyTipRecipients',
    'listMyStockLocations', 'listMyStock', 'setMyCashregisterStockLocation',
  ]));
```

- [ ] **Schritt 3: Tests laufen lassen, rot**

Run: `npx tsc -p tsconfig.test.json`
Expected: FAIL – `Module '"../src/pos/index.js"' has no exported member 'listMyStockLocations'`.

- [ ] **Schritt 4: Umsetzung** (`src/pos/lager.ts`)

```ts
import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';

/**
 * Lager an der Kasse (Lager-Kern Stufe 2, Backend lager-endpoints.js):
 * Standorte, Bestand und der Standort der Kasse. Alle drei Aufrufe gibt es
 * nur ueber den Kassenweg `/api/v3` (registerInternal); Rechte am Server:
 * `stockView` (lesen), `stockCosts` (Werte), `stockLocation` (Standort setzen).
 *
 * **Ganzzahlen:** Mengen sind Tausendstel der Basiseinheit (`1000` = 1 Stueck,
 * `250` = 0,250 kg), Werte ganze Cent bzw. Mikro-Euro. Nichts wird geteilt,
 * gerundet oder geklemmt -- ein negativer Bestand (mehr verkauft als gebucht)
 * ist eine Aussage des Servers und bleibt negativ.
 */

/** Standort-Typen (Katalog `STANDORT_TYP`), englisch wie am Draht. */
export const STOCK_LOCATION_TYPES = Object.freeze(['warehouse', 'store', 'vehicle', 'other'] as const);
export type StockLocationType = (typeof STOCK_LOCATION_TYPES)[number];

export interface StockLocationAddress {
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
}

export interface StockLocation {
  id: string;
  name: string;
  /** `null`: ein Typ, den dieses Paket nicht kennt. */
  type: StockLocationType | null;
  /** Fahrzeuge haben keine Adresse. */
  address: StockLocationAddress | null;
  /** Kennzeichen, nur bei `vehicle`. */
  licensePlate: string | null;
  /** `false` = aufgeloest; als Standort der Kasse abgewiesen (`location_inactive`). */
  active: boolean;
  /** `true` = Hauptstandort, den der Server ohne eigenes Dokument ergaenzt. */
  virtual: boolean;
}

/** Bestand eines Artikels an einem Standort, in Tausendstel der Basiseinheit. */
export interface StockLevel {
  articleId: string;
  locationId: string;
  sellable: number;
  defective: number;
  reserved: number;
  /** `sellable - reserved`, vom Server gerechnet. */
  available: number;
}

/** Lagerwert eines Artikels -- nur mit dem Recht `stockCosts`. */
export interface StockValue {
  articleId: string;
  stockValueCents: number;
  /** Durchschnittlicher Einstandspreis je Basiseinheit in Mikro-Euro; `null` bei Menge 0. */
  averageCostMicros: number | null;
}

export interface StockList {
  stock: StockLevel[];
  /**
   * `null`, wenn der Aufrufer das Recht `stockCosts` nicht hat (der Server
   * laesst das Feld weg); `[]`, wenn er es hat und nichts bewertet ist. Eine
   * Oberflaeche zeigt bei `null` keinen Wert, nie „0,00 €“.
   */
  values: StockValue[] | null;
}

export interface ListMyStockOptions {
  /** Nur dieser Standort; `''` gilt wie nicht angegeben. */
  locationId?: string;
  /** Nur dieser Artikel; `''` gilt wie nicht angegeben. */
  articleId?: string;
  /** Nur Zeilen unter dem Mindestbestand. */
  belowMinimum?: boolean;
}

export interface SetMyCashregisterStockLocationOptions {
  /** Standort-Kennung; `null` setzt auf den Standard-Standort des Betriebs zurueck. */
  stockLocationId: string | null;
  /** Ohne Angabe gilt die Kasse der Anmeldung (`registerUserAuth`). */
  cashregisterId?: string;
}

export interface CashregisterStockLocation {
  cashregisterId: string;
  /** `null` = Standard-Standort des Betriebs. */
  stockLocationId: string | null;
}

type Roh = Record<string, unknown>;
const objekt = (w: unknown): Roh | null => (w !== null && typeof w === 'object' && !Array.isArray(w) ? (w as Roh) : null);
const text = (w: unknown): string => (typeof w === 'string' ? w : '');
const textOderNull = (w: unknown): string | null => (typeof w === 'string' && w !== '' ? w : null);
const ganzzahl = (w: unknown): number => (typeof w === 'number' && Number.isInteger(w) ? w : 0);
const ganzzahlOderNull = (w: unknown): number | null => (typeof w === 'number' && Number.isInteger(w) ? w : null);
const TYPEN: ReadonlySet<string> = new Set(STOCK_LOCATION_TYPES);

function liste(daten: unknown, feld: string, name: string): unknown[] {
  const roh = objekt(daten)?.[feld];
  if (!Array.isArray(roh)) {
    // Keine Liste ist etwas anderes als eine leere: „nichts am Lager“ darf
    // nicht aussehen wie „Antwort kaputt“.
    throw new KasseneckValidationError(name, `Antwort enthaelt keine Liste (data.${feld} fehlt)`, 'response');
  }
  return roh;
}

function standort(e: unknown): StockLocation {
  const s = objekt(e) ?? {};
  const a = objekt(s.address);
  return {
    id: text(s.id),
    name: text(s.name),
    type: typeof s.type === 'string' && TYPEN.has(s.type) ? (s.type as StockLocationType) : null,
    address: a ? { street: textOderNull(a.street), zip: textOderNull(a.zip), city: textOderNull(a.city), country: textOderNull(a.country) } : null,
    licensePlate: textOderNull(s.licensePlate),
    active: s.active !== false,
    virtual: s.virtual === true,
  };
}

function bestand(e: unknown): StockLevel {
  const b = objekt(e) ?? {};
  return {
    articleId: text(b.articleId),
    locationId: text(b.locationId),
    sellable: ganzzahl(b.sellable),
    defective: ganzzahl(b.defective),
    reserved: ganzzahl(b.reserved),
    available: ganzzahl(b.available),
  };
}

function wert(e: unknown): StockValue {
  const w = objekt(e) ?? {};
  return { articleId: text(w.articleId), stockValueCents: ganzzahl(w.stockValueCents), averageCostMicros: ganzzahlOderNull(w.averageCostMicros) };
}

/** Standorte des Betriebs, samt aufgeloesten (`active: false`) und dem Hauptstandort. */
export async function listMyStockLocations(transport: InternerTransport): Promise<StockLocation[]> {
  const daten = await transport<{ locations?: unknown }>('listMyStockLocations');
  return liste(daten, 'locations', 'listMyStockLocations').map(standort);
}

/** Bestand je Artikel und Standort; Werte nur mit dem Recht `stockCosts`. */
export async function listMyStock(transport: InternerTransport, options: ListMyStockOptions = {}): Promise<StockList> {
  const name = 'listMyStock';
  const params: Record<string, unknown> = {};
  for (const feld of ['locationId', 'articleId'] as const) {
    const w = options[feld];
    if (w === undefined || w === '') continue;
    if (typeof w !== 'string') throw new KasseneckValidationError(name, `${feld} muss Text sein`, 'request');
    params[feld] = w;
  }
  if (options.belowMinimum !== undefined) {
    if (typeof options.belowMinimum !== 'boolean') throw new KasseneckValidationError(name, 'belowMinimum muss true oder false sein', 'request');
    // false filtert am Server nicht; gesendet wird nur der Filter selbst.
    if (options.belowMinimum) params.belowMinimum = true;
  }
  const daten = await transport<{ stock?: unknown; values?: unknown }>(name, params);
  const werte = objekt(daten)?.values;
  return {
    stock: liste(daten, 'stock', name).map(bestand),
    values: Array.isArray(werte) ? werte.map(wert) : null,
  };
}

/**
 * Standort der Kasse setzen -- von dort bucht der Server Verkauf und Storno
 * ab. `stockLocationId: null` setzt zurueck (am Draht der leere Text).
 * Fehler am Code: `location_not_found`, `location_inactive`,
 * `cashregister_not_found`, `cashregister_not_assigned`, `not_permitted`,
 * `module_inactive`.
 */
export async function setMyCashregisterStockLocation(
  transport: InternerTransport,
  options: SetMyCashregisterStockLocationOptions,
): Promise<CashregisterStockLocation> {
  const name = 'setMyCashregisterStockLocation';
  const ziel = options?.stockLocationId;
  if (ziel !== null && typeof ziel !== 'string') {
    throw new KasseneckValidationError(name, 'stockLocationId fehlt (Kennung, oder null zum Zuruecksetzen)', 'request');
  }
  const params: Record<string, unknown> = { stockLocationId: ziel === null ? '' : ziel };
  if (options.cashregisterId !== undefined) {
    if (typeof options.cashregisterId !== 'string' || options.cashregisterId.trim() === '') {
      throw new KasseneckValidationError(name, 'cashregisterId ist leer', 'request');
    }
    params.cashregisterId = options.cashregisterId;
  }
  const daten = objekt(await transport(name, params));
  if (!daten || typeof daten.cashregisterId !== 'string') {
    throw new KasseneckValidationError(name, 'Antwort enthaelt keine Kasse (data.cashregisterId fehlt)', 'response');
  }
  return { cashregisterId: daten.cashregisterId, stockLocationId: textOderNull(daten.stockLocationId) };
}
```

In `src/pos/index.ts` nach dem `trinkgeld`-Export:

```ts
export {
  STOCK_LOCATION_TYPES, type StockLocationType, type StockLocation, type StockLocationAddress,
  type StockLevel, type StockValue, type StockList, type ListMyStockOptions,
  type SetMyCashregisterStockLocationOptions, type CashregisterStockLocation,
  listMyStockLocations, listMyStock, setMyCashregisterStockLocation,
} from './lager.js';
```

und im Kopfkommentar „Kachel-Kasse: Einstellungen, …, Trinkgeld-Empfaenger“ um „, Lager (Standorte, Bestand, Standort der Kasse)“ ergänzen.

In `POS_ERROR_CODES` (`src/pos/errors.ts`, sortiert) nach `'live_not_enabled',`:

```ts
  'location_inactive',
  'location_not_found',
```

und nach `'response_translation_failed',`:

```ts
  'server_error',
```

Kopfkommentar dort: „Fehlerfaelle dieser zehn Endpunkte“ → „dieser dreizehn Endpunkte“ und die Aufzählung
„(Einstellungen, Logo, Artikel, Drucker, Trinkgeld-Empfaenger)“ um „, Lager“ ergänzen.

- [ ] **Schritt 5: Vertrag der Oberfläche nachziehen und alles laufen lassen**

```bash
npm run fixtures:oberflaeche
npx tsc -p tsconfig.test.json && TZ=Europe/Vienna node --test test-dist/test/lager-kasse.test.js test-dist/test/kasse-v3.test.js test-dist/test/oberflaeche.test.js
npm test
```

Expected: PASS; `fixtures/surface.json` hat neu `pos.stockLocationTypes` und `pos.posErrorCodes` mit den drei Codes.

- [ ] **Schritt 6: Commit**

```bash
git add src/pos/lager.ts src/pos/index.ts src/pos/errors.ts test/lager-kasse.test.ts test/kasse-v3.test.ts fixtures/surface.json
git commit -m "feat(pos): Standorte, Bestand und Standort der Kasse (Lager Stufe 2)"
```

---

### Task 3: Standort an Artikel, Kasse und Gerät; Lager-Rechte der Kassen-Benutzer

**Files:**
- Modify: `src/pos/artikel.ts` (`PosArticle`, `PosArticlePayload`, `fromPosArticlePayload`)
- Modify: `src/models/cashregister.ts` (`Cashregister`, `CashregisterPayload`, `fromCashregisterPayload`)
- Modify: `src/register/pairing.ts:169-192` (`RegisterDeviceUsers.cashregister`), `:564-569` (`kasseBereit`), `:206-262` (`RegisterUserPerms`, `REGISTER_PERMS`)
- Modify: `test/lager-kasse.test.ts`, `test/kasse-v3.test.ts`, `test/kasse.test.ts:378-383`
- Modify: `fixtures/surface.json` (Skript: `registerPerms`)

**Interfaces:**
- Produces: `PosArticle.stockLocationIds: string[] | null` (`null` = keine Angabe am Artikel);
  `Cashregister.stockLocationId?: string`; `RegisterDeviceUsers.cashregister?.stockLocationId?: string`;
  `RegisterUserPerms.stockView?/stockCosts?/stockMove?/stockLoss?/stocktakeCount?/stocktakeClose?/stockLocation?: boolean`.

- [ ] **Schritt 1: Failing Tests** (`test/lager-kasse.test.ts` anhängen; Imports oben ergänzen:
  `fromPosArticlePayload` aus `'../src/pos/index.js'`, `fromCashregisterPayload` aus `'../src/models/index.js'`,
  `REGISTER_PERMS` aus `'../src/register/index.js'`)

```ts
test('Artikel: stockLocationIds nur Texte, fehlt -> null, leere Liste bleibt leer', () => {
  assert.deepEqual(fromPosArticlePayload({ id: 'rye-bread', stockLocationIds: ['store-1', 7, '', 'van-1'] as never }).stockLocationIds, ['store-1', 'van-1']);
  assert.deepEqual(fromPosArticlePayload({ id: 'rye-bread', stockLocationIds: [] }).stockLocationIds, []);
  assert.equal(fromPosArticlePayload({ id: 'rye-bread' }).stockLocationIds, null);
});

test('Kasse: stockLocationId nur wenn gesetzt', () => {
  assert.equal(fromCashregisterPayload({ id: 'K1', stockLocationId: 'van-1' }, 'K1').stockLocationId, 'van-1');
  assert.equal('stockLocationId' in fromCashregisterPayload({ id: 'K1', stockLocationId: null }, 'K1'), false);
  assert.equal('stockLocationId' in fromCashregisterPayload({ id: 'K1' }, 'K1'), false);
});

test('Rechte: die sieben Lager-Rechte stehen hinter den elf bisherigen, Reihenfolge des Backends', () => {
  assert.deepEqual([...REGISTER_PERMS].slice(11), [
    'stockView', 'stockCosts', 'stockMove', 'stockLoss', 'stocktakeCount', 'stocktakeClose', 'stockLocation',
  ]);
});
```

In `test/kasse.test.ts` den Test `Die Rechte-Schluessel stehen als Liste bereit`:

```ts
test('Die Rechte-Schluessel stehen als Liste bereit', () => {
  assert.deepEqual([...REGISTER_PERMS], [
    'sell', 'cancel', 'articles', 'layout', 'reports', 'takeover',
    'cancelScope', 'receiptsScope', 'drawer', 'discount', 'tipAssign',
    'stockView', 'stockCosts', 'stockMove', 'stockLoss', 'stocktakeCount', 'stocktakeClose', 'stockLocation',
  ]);
});
```

In `test/kasse-v3.test.ts` nach dem Test `listRegisterUsersForDevice: …`:

```ts
test('listRegisterUsersForDevice: der Standort der gebundenen Kasse reist mit, fehlt er, fehlt das Feld', async () => {
  const basis = erfolge('listRegisterUsersForDevice')[0]!;
  const d = basis.response.data;
  const mit = { ...basis, response: { ...basis.response, data: { ...d, cashregister: { ...d.cashregister, stockLocationId: 'auto1' } } } };
  const stand = await listRegisterUsersForDevice({ ...(mit.params as typeof GERAET), fetch: holenFuer(mit).holen });
  assert.equal(stand.cashregister?.stockLocationId, 'auto1');
  const ohne = await listRegisterUsersForDevice({ ...(basis.params as typeof GERAET), fetch: holenFuer(basis).holen });
  assert.equal(ohne.cashregister !== undefined && 'stockLocationId' in ohne.cashregister, false);
});
```

- [ ] **Schritt 2: rot**

Run: `npx tsc -p tsconfig.test.json`
Expected: FAIL (`stockLocationIds` / `stockLocationId` existieren nicht).

- [ ] **Schritt 3: Umsetzung**

`src/pos/artikel.ts` – an `PosArticle` nach `maxQuantity`:

```ts
  /**
   * Standorte, an denen der Artikel gefuehrt wird (Lager-Kern Stufe 2, innen
   * `standorte`); `null`, wenn der Artikel keine Angabe traegt. Wie die Kasse
   * daraus Kacheln filtert, entscheidet die Oberflaeche.
   */
  stockLocationIds: string[] | null;
```

an `PosArticlePayload`: `stockLocationIds?: string[] | null;` und in `fromPosArticlePayload` nach `maxQuantity`:

```ts
    stockLocationIds: Array.isArray(p.stockLocationIds)
      ? p.stockLocationIds.filter((s): s is string => typeof s === 'string' && s !== '')
      : null,
```

`src/models/cashregister.ts` – an `Cashregister` nach `signatureId`:

```ts
  /** Lager-Standort der Kasse (Lager-Kern Stufe 2); fehlt = Standard-Standort des Betriebs. */
  stockLocationId?: string;
```

an `CashregisterPayload`: `stockLocationId?: string | null;` und in `fromCashregisterPayload` nach `signatureId`:

```ts
    ...(payload.stockLocationId ? { stockLocationId: payload.stockLocationId } : {}),
```

`src/register/pairing.ts` – Feld in `RegisterDeviceUsers`:

```ts
  cashregister?: { ready: boolean; reason?: string | null; stockLocationId?: string };
```

(Kommentar darüber um „`stockLocationId`: Lager-Standort der Kasse, fehlt = Standard-Standort“ ergänzen),
`kasseBereit`:

```ts
function kasseBereit(wert: unknown): { ready: boolean; reason?: string | null; stockLocationId?: string } | undefined {
  if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) return undefined;
  const roh = wert as Record<string, unknown>;
  if (typeof roh['ready'] !== 'boolean') return undefined;
  const standort = roh['stockLocationId'];
  return {
    ready: roh['ready'],
    reason: typeof roh['reason'] === 'string' ? roh['reason'] : null,
    ...(typeof standort === 'string' && standort !== '' ? { stockLocationId: standort } : {}),
  };
}
```

`RegisterUserPerms` nach `tipAssign?: boolean;`:

```ts
  /** Lager: Standorte und Mengen sehen (listMyStockLocations, listMyStock). */
  stockView?: boolean;
  /** Lager: Einkaufswerte sehen (`values` in listMyStock); gibt nur der Inhaber frei. */
  stockCosts?: boolean;
  /** Lager: Wareneingang, Umbuchen. */
  stockMove?: boolean;
  /** Lager: Abgang, Zustand, Gegenbuchung. */
  stockLoss?: boolean;
  /** Inventur: zaehlen. */
  stocktakeCount?: boolean;
  /** Inventur: abschliessen. */
  stocktakeClose?: boolean;
  /** Standort der Kasse waehlen (setMyCashregisterStockLocation). */
  stockLocation?: boolean;
```

`REGISTER_PERMS`:

```ts
export const REGISTER_PERMS = [
  'sell', 'cancel', 'articles', 'layout', 'reports', 'takeover',
  'cancelScope', 'receiptsScope', 'drawer', 'discount', 'tipAssign',
  'stockView', 'stockCosts', 'stockMove', 'stockLoss', 'stocktakeCount', 'stocktakeClose', 'stockLocation',
] as const satisfies readonly BenanntesRecht[];
```

und im Kommentar zu `BenannteSchluessel` „laesst die elf echten Rechte stehen“ → „laesst die benannten Rechte stehen“.

- [ ] **Schritt 4: grün**

```bash
npm run fixtures:oberflaeche && npm test
```

Expected: PASS; `fixtures/surface.json` `registerPerms` mit 18 Einträgen.

- [ ] **Schritt 5: Commit**

```bash
git add src/pos/artikel.ts src/models/cashregister.ts src/register/pairing.ts test/ fixtures/surface.json
git commit -m "feat(pos): Standort an Artikel, Kasse und Geraet, Lager-Rechte der Kassen-Benutzer"
```

---

### Task 4: Rückgabe-Wahl beim Storno (`returnDisposition`)

Heute baut `cancelReceipt` die Positionen neu als `{ index, quantity }` (`src/client/receipts.ts:405`,
im Build `dist/esm/client/receipts.js`) – ein `returnDisposition` an der Position ginge still verloren.

**Files:**
- Modify: `src/models/cancellation.ts` (Katalog, `CancellationItem`)
- Modify: `src/models/receipt-item.ts` (`ReceiptItem`, `ReceiptItemPayloadRead`, `fromReceiptItemPayload`)
- Modify: `src/models/receipt.ts:236-251` (`leseStorno`)
- Modify: `src/client/receipts.ts:154-174` (`CancelReceiptOptions`), `:374-413` (`cancelReceipt`)
- Modify: `src/models/index.ts`, `src/index.ts`, `src/pos/index.ts` (Exporte)
- Test: `test/client-receipts.test.ts`, `test/cancellation.test.ts`, `test/receipts-v3.test.ts`

**Interfaces:**
- Produces: `RETURN_DISPOSITIONS: readonly ['restock','defective','disposed']`, `type ReturnDisposition`,
  `isReturnDisposition(value: unknown): value is ReturnDisposition` (Wurzel und `./pos`);
  `CancellationItem.returnDisposition?`, `CancelReceiptOptions.returnDisposition?`,
  `ReceiptItem.originalIndex?: number`, `ReceiptItem.returnDisposition?`. Task 5 importiert
  `RETURN_DISPOSITIONS` und `ReturnDisposition` aus `src/models/cancellation.ts`.

- [ ] **Schritt 1: Failing Tests – Senden** (`test/client-receipts.test.ts`, nach `cancelReceipt prueft die Eingabe …`)

```ts
test('cancelReceipt: Rueckgabe-Wahl als Vorgabe und je Position geht englisch hinaus', async () => {
  const { rufen, aufrufe } = kassenBenutzerWeg(STORNO_ANTWORT);
  await cancelReceipt(rufen, {
    cashregisterId: KASSEN_ID,
    originalReceiptId: 'kasse-1-ID-12',
    reason: 'customer_cancelled',
    returnDisposition: 'restock',
    items: [{ index: 0, quantity: 1, returnDisposition: 'defective' }, { index: 1, quantity: 2 }],
  });
  const { endpunkt, params } = gesendet(aufrufe, POS_BASE_URL);
  assert.equal(endpunkt, 'cancelReceipt');
  assert.equal(params.returnDisposition, 'restock');
  assert.deepEqual(params.items, [{ index: 0, quantity: 1, returnDisposition: 'defective' }, { index: 1, quantity: 2 }]);
});

test('cancelReceipt: ohne Rueckgabe-Wahl geht kein returnDisposition hinaus (der Server bucht restock)', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  await cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-12', reason: 'input_error', items: [{ index: 0, quantity: 1 }] });
  const { params } = gesendet(aufrufe);
  assert.equal('returnDisposition' in params, false);
  assert.deepEqual(params.items, [{ index: 0, quantity: 1 }]);
});

test('cancelReceipt: innere, vertippte oder leere Rueckgabe-Werte gehen nicht hinaus und nennen das Feld', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  const basis = { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-12', reason: 'other' as const };
  await assert.rejects(
    () => cancelReceipt(rufen, { ...basis, returnDisposition: 'lager' as never }),
    (e) => isKasseneckValidationError(e) && /returnDisposition/.test(e.message) && /restock, defective, disposed/.test(e.message),
  );
  await assert.rejects(
    () => cancelReceipt(rufen, { ...basis, items: [{ index: 0, quantity: 1 }, { index: 1, quantity: 1, returnDisposition: 'defekt' as never }] }),
    /items\[1\]\.returnDisposition/,
  );
  await assert.rejects(() => cancelReceipt(rufen, { ...basis, returnDisposition: null as never }), /returnDisposition/);
  await assert.rejects(() => cancelReceipt(rufen, { ...basis, returnDisposition: 'Restock' as never }), /returnDisposition/);
  assert.equal(aufrufe.length, 0);
});
```

- [ ] **Schritt 2: Failing Tests – Lesen** (`test/cancellation.test.ts`; Import um `RETURN_DISPOSITIONS, isReturnDisposition` ergänzen)

```ts
test('Rueckgabe-Katalog: restock, defective, disposed; die inneren Werte gelten nicht', () => {
  assert.deepEqual([...RETURN_DISPOSITIONS], ['restock', 'defective', 'disposed']);
  assert.equal(isReturnDisposition('defective'), true);
  for (const w of ['lager', 'defekt', 'entsorgt', '', null, undefined, 1]) assert.equal(isReturnDisposition(w), false, String(w));
});

test('fromReceiptPayload: Storno-Zeile und Storno-Eintrag tragen die Rueckgabe-Wahl, ein unbekannter Wert faellt weg', () => {
  const storno = fromReceiptPayload({
    ...NUTZLAST, receiptType: 'cancellation',
    items: [
      { name: 'Semmel', quantity: -1, unitPriceCents: 79, vatRate: 10, articleId: 'roll', originalIndex: 0, returnDisposition: 'defective' },
      { name: 'Kaffee', quantity: -1, unitPriceCents: 280, vatRate: 20, articleId: 'coffee', originalIndex: 1, returnDisposition: 'lost' },
      { name: 'Handeingabe', quantity: -1, unitPriceCents: 100, vatRate: 20 },
    ],
  } as ReceiptPayloadRead);
  assert.equal(storno.items[0]!.returnDisposition, 'defective');
  assert.equal(storno.items[0]!.originalIndex, 0);
  assert.equal('returnDisposition' in storno.items[1]!, false);
  assert.equal(storno.items[1]!.originalIndex, 1);
  assert.equal('originalIndex' in storno.items[2]!, false);
  const original = fromReceiptPayload({
    ...NUTZLAST,
    cancellations: [{ receiptId: 'kasse-1-ID-13', at: 1, by: null, note: null, items: [{ index: 0, quantity: 1, returnDisposition: 'disposed' }, { index: 1, quantity: 1 }] }],
  } as ReceiptPayloadRead);
  assert.deepEqual(original.cancellations![0]!.items, [{ index: 0, quantity: 1, returnDisposition: 'disposed' }, { index: 1, quantity: 1 }]);
});
```

und in `test/client-receipts.test.ts` (Schreibweg bleibt schmal):

```ts
test('toReceiptItemPayload: originalIndex und returnDisposition gehen nie mit createReceipt hinaus', () => {
  const zeile = toReceiptItemPayload({ ...KAFFEE, articleId: 'coffee', originalIndex: 0, returnDisposition: 'restock' });
  assert.deepEqual(zeile, { name: 'Kaffee', quantity: 1, unitPriceCents: 320, vatRate: 20, articleId: 'coffee' });
});
```

In `test/receipts-v3.test.ts`, Test `Kataloge und Codes sind die des /v3-Vokabulars`, nach der Zeile mit
`CANCELLATION_REASONS` (Import `RETURN_DISPOSITIONS` aus `'../src/models/index.js'` ergänzen):

```ts
  assert.deepEqual([...RETURN_DISPOSITIONS], Object.values(VOKABULAR.catalogs.RUECKGABE));
```

- [ ] **Schritt 3: rot**

Run: `npx tsc -p tsconfig.test.json`
Expected: FAIL (`RETURN_DISPOSITIONS` fehlt, `returnDisposition` unbekannt in `CancellationItem`).

- [ ] **Schritt 4: Umsetzung – Katalog und Modelle**

`src/models/cancellation.ts`, nach `isCancellationReason`:

```ts
/**
 * Rueckgabe-Wahl beim Storno und bei der Gutschrift (Lager-Kern Stufe 2,
 * Katalog `RUECKGABE` des Backends): `restock` zurueck ins Lager (Vorgabe des
 * Servers), `defective` als defekt ins Lager, `disposed` entsorgt. Wirkt nur
 * an Positionen mit `articleId`; alle anderen bucht der Server nie und meldet
 * dafuer auch keinen Fehler.
 */
export const RETURN_DISPOSITIONS = Object.freeze(['restock', 'defective', 'disposed'] as const);

export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];

export function isReturnDisposition(value: unknown): value is ReturnDisposition {
  return typeof value === 'string' && (RETURN_DISPOSITIONS as readonly string[]).includes(value);
}
```

`CancellationItem`:

```ts
/** Eine stornierte Position: Index im Original und Menge, an Artikelzeilen die Rueckgabe-Wahl. */
export interface CancellationItem {
  index: number;
  quantity: number;
  /** Wohin die Ware dieser Position geht; fehlt = Vorgabe des Aufrufs bzw. `restock`. */
  returnDisposition?: ReturnDisposition;
}
```

`src/models/receipt-item.ts` – Import `import { isReturnDisposition, type ReturnDisposition } from './cancellation.js';`
(`cancellation.ts` importiert von `receipt.ts` nur den Typ, kein Laufzeitkreis). An `ReceiptItem` nach `articleId`:

```ts
  /** Nur an Storno-Zeilen mit `articleId`: Index der Position im Original. */
  originalIndex?: number;
  /** Nur an Storno-Zeilen mit `articleId`: wohin die Ware ging (Lager-Kern Stufe 2). */
  returnDisposition?: ReturnDisposition;
```

an `ReceiptItemPayloadRead`: `originalIndex?: number | null;` und `returnDisposition?: string | null;`,
in `fromReceiptItemPayload` nach der `articleId`-Zeile:

```ts
    // Lager: Bezug und Rueckgabe-Wahl einer Storno-Zeile (nur gelesen; ein
    // unbekannter Wert faellt weg wie am Rand des Servers).
    ...(Number.isInteger(payload.originalIndex) && (payload.originalIndex as number) >= 0 ? { originalIndex: payload.originalIndex as number } : {}),
    ...(isReturnDisposition(payload.returnDisposition) ? { returnDisposition: payload.returnDisposition } : {}),
```

`toReceiptItemPayload` bleibt unverändert (der Test aus Schritt 2 hält das fest).

`src/models/receipt.ts`, `leseStorno` (Import `isReturnDisposition` aus `./cancellation.js`):

```ts
    items: (eintrag.items ?? []).map((p) => ({
      index: Number(p.index),
      quantity: Number(p.quantity),
      ...(isReturnDisposition(p.returnDisposition) ? { returnDisposition: p.returnDisposition } : {}),
    })),
```

- [ ] **Schritt 5: Umsetzung – `cancelReceipt`** (`src/client/receipts.ts`)

Import `isReturnDisposition, RETURN_DISPOSITIONS, type ReturnDisposition` aus `'../models/index.js'`.
In `CancelReceiptOptions` nach `note`:

```ts
  /**
   * Wohin die Ware der stornierten Artikelzeilen geht (Lager-Kern Stufe 2):
   * Vorgabe fuer alle Positionen, je Position abweichend ueber
   * `items[].returnDisposition`. Fehlt beides, bucht der Server `restock`.
   * Zeilen ohne `articleId` bucht er nie. Ein falscher Wert geht nicht hinaus;
   * der Server meldete ihn als `invalid_return_disposition`.
   */
  returnDisposition?: ReturnDisposition;
```

In `cancelReceipt` die Positionsprüfung ersetzen und die Vorgabe prüfen:

```ts
  if (options.returnDisposition !== undefined && !isReturnDisposition(options.returnDisposition)) {
    throw new KasseneckValidationError('cancelReceipt', `returnDisposition: erlaubt sind ${RETURN_DISPOSITIONS.join(', ')}`, 'request');
  }
  if (options.items !== undefined) {
    if (!Array.isArray(options.items) || options.items.length === 0) {
      throw new KasseneckValidationError('cancelReceipt', 'items muss eine nicht leere Liste sein', 'request');
    }
    for (const [i, pos] of options.items.entries()) {
      if (!Number.isInteger(pos.index) || pos.index < 0 || !Number.isInteger(pos.quantity) || pos.quantity < 1) {
        throw new KasseneckValidationError('cancelReceipt', 'Storno-Menge muss eine ganze Zahl >= 1 sein', 'request');
      }
      if (pos.returnDisposition !== undefined && !isReturnDisposition(pos.returnDisposition)) {
        throw new KasseneckValidationError('cancelReceipt', `items[${i}].returnDisposition: erlaubt sind ${RETURN_DISPOSITIONS.join(', ')}`, 'request');
      }
    }
  }
```

und beim Bauen der Parameter:

```ts
  if (options.items !== undefined) {
    params.items = options.items.map((p) => ({
      index: p.index,
      quantity: p.quantity,
      ...(p.returnDisposition !== undefined ? { returnDisposition: p.returnDisposition } : {}),
    }));
  }
  if (options.returnDisposition !== undefined) params.returnDisposition = options.returnDisposition;
```

Exporte: in `src/models/index.ts` und `src/index.ts` im Block der Cancellation-Exporte
`RETURN_DISPOSITIONS, isReturnDisposition, type ReturnDisposition` ergänzen; in `src/pos/index.ts`:

```ts
// Rueckgabe-Wahl beim Storno (Kassen-Dialog); dieselbe Liste wie an der Wurzel.
export { RETURN_DISPOSITIONS, isReturnDisposition, type ReturnDisposition } from '../models/cancellation.js';
```

- [ ] **Schritt 6: grün, dann Rot-Probe**

```bash
npm run fixtures:oberflaeche && npm test
```

Expected: PASS; `surface.json` `pos.returnDispositions`.

Rot-Probe (Sicherheitszusage „falscher Wert geht nicht hinaus“): in `cancelReceipt` die Zeile
`if (pos.returnDisposition !== undefined && !isReturnDisposition(pos.returnDisposition))` vorübergehend
zu `if (false)` machen, `npx tsc -p tsconfig.test.json && node --test test-dist/test/client-receipts.test.js`
→ der Test „innere, vertippte oder leere Rueckgabe-Werte …“ muss FAIL zeigen; zurücknehmen und mit
`git diff --stat src/client/receipts.ts` belegen, dass nur die beabsichtigte Änderung bleibt.

- [ ] **Schritt 7: Commit**

```bash
git add src/models/ src/client/receipts.ts src/index.ts src/pos/index.ts test/ fixtures/surface.json
git commit -m "feat(storno): Rueckgabe-Wahl je Storno und je Position (returnDisposition)"
```

---

### Task 5: Lagerfelder der Rechnungs-API (`articleId`, `stockLocationId`, `returnDisposition`)

Das Backend (`functions/invoice-api-core.js`) erzeugt aus seinen Regeln dasselbe JSON Schema wie
`fixtures/invoice-api.schema.json`: `articleId` an jeder Position (Kennung 1–128), `stockLocationId`
an `issueInvoice`, `returnDisposition` (`restock|defective|disposed`) an `cancelInvoice`,
`createCreditNote` und **nur** an Gutschrift-Positionen. Eine Rechnungsposition mit
`returnDisposition` weist der Server als unbekanntes Feld ab. `getInvoice` liefert `articleId` nicht
zurück – kein Antwortfeld.

**Files:**
- Modify: `src/invoice/vertrag.ts` (`ITEM_FIELDS`, neu `CREDIT_NOTE_ITEM_FIELDS`, `INVOICE_REQUESTS`)
- Modify: `src/invoice/typen.ts` (`InvoiceItemInput`, neu `CreditNoteItemInput`, `IssueInvoiceRequest`, `CancelInvoiceRequest`, `CreditNoteRequest`)
- Modify: `src/invoice/index.ts` (Exporte)
- Create: `fixtures/invoice-api-examples/issue-stock.json`, `credit-return-disposition.json`, `credit-error-return-disposition.json`, `cancel-error-return-disposition.json`, `issue-error-return-disposition.json`, `issue-error-stock-id.json`
- Modify: `fixtures/invoice-api.schema.json`, `fixtures/surface.json` (Skripte)
- Test: `test/rechnung-vertrag.test.ts:52-59`, `test/rechnung-client.test.ts`

**Interfaces:**
- Consumes: `RETURN_DISPOSITIONS`, `ReturnDisposition` aus `src/models/cancellation.ts` (Task 4).
- Produces (aus `./invoice`): `CREDIT_NOTE_ITEM_FIELDS`, `RETURN_DISPOSITIONS`, `type ReturnDisposition`,
  `type CreditNoteItemInput`; `InvoiceItemInput.articleId?`, `IssueInvoiceRequest.stockLocationId?`,
  `CancelInvoiceRequest.returnDisposition?`, `CreditNoteRequest.items: CreditNoteItemInput[]`.

- [ ] **Schritt 1: Failing Tests – Vertrag** (`test/rechnung-vertrag.test.ts`; Import um `CREDIT_NOTE_ITEM_FIELDS, RETURN_DISPOSITIONS` ergänzen)

Den Test `Vertrag: Positionen von Rechnung und Gutschrift sind dieselbe Beschreibung` ersetzen durch:

```ts
test('Vertrag: Gutschrift-Positionen sind die Rechnungspositionen plus returnDisposition', () => {
  const issue = INVOICE_REQUESTS.issueInvoice['items'];
  const credit = INVOICE_REQUESTS.createCreditNote['items'];
  assert.ok(issue && issue.type === 'list' && issue.item.type === 'object');
  assert.ok(credit && credit.type === 'list' && credit.item.type === 'object');
  assert.equal(issue.item.fields, ITEM_FIELDS);
  assert.equal(credit.item.fields, CREDIT_NOTE_ITEM_FIELDS);
  assert.deepEqual(CREDIT_NOTE_ITEM_FIELDS, { ...ITEM_FIELDS, returnDisposition: { type: 'enum', required: false, values: RETURN_DISPOSITIONS } });
  assert.equal('returnDisposition' in ITEM_FIELDS, false, 'an der Rechnung weist der Server returnDisposition ab');
});

test('Vertrag: Lagerfelder wie im Backend (Kennung 1-128, Rueckgabe-Katalog), alle optional', () => {
  const kennung = { type: 'string', required: false, min: 1, max: 128 };
  assert.deepEqual(ITEM_FIELDS['articleId'], kennung);
  assert.deepEqual(INVOICE_REQUESTS.issueInvoice['stockLocationId'], kennung);
  for (const aufruf of ['cancelInvoice', 'createCreditNote'] as const) {
    assert.deepEqual(INVOICE_REQUESTS[aufruf]['returnDisposition'], { type: 'enum', required: false, values: RETURN_DISPOSITIONS }, aufruf);
  }
  assert.equal('stockLocationId' in INVOICE_REQUESTS.createCreditNote, false, 'die Gutschrift nimmt den Standort ihrer Rechnung');
});
```

- [ ] **Schritt 2: Failing Test – Client sendet unverändert** (`test/rechnung-client.test.ts`)

```ts
test('cancelInvoice und createCreditNote: Rueckgabe-Wahl und articleId gehen unveraendert hinaus', async () => {
  const gutschrift = { ...rechnung, id: 'cn1', docType: 'credit_note' };
  const { fetch, anfragen } = attrappe(
    antwort(erfolg({ creditNote: gutschrift, original: { id: 'inv1', status: 'cancelled' }, originalPaidCents: 0, replayed: false })),
    antwort(erfolg({ creditNote: gutschrift, remainingCents: 0, replayed: false })),
  );
  const api = createInvoiceApi({ apiKey: API_KEY, fetch });
  const storno: CancelInvoiceRequest = { idempotencyKey: 'storno-4711', invoiceId: 'inv1', reason: 'return', returnDisposition: 'disposed' };
  const teil: CreditNoteRequest = {
    idempotencyKey: 'gutschrift-4711', invoiceId: 'inv1', reason: 'return', returnDisposition: 'restock',
    items: [{ description: 'Roggenbrot', quantity: 2, unitPriceCents: 450, vatRate: 10, articleId: 'rye-bread', returnDisposition: 'defective' }],
  };
  await api.cancelInvoice(storno);
  await api.createCreditNote(teil);
  assert.deepEqual(params(anfragen[0]!), storno);
  assert.deepEqual(params(anfragen[1]!), teil);
});
```

(Import `CancelInvoiceRequest, CreditNoteRequest` aus `'../src/invoice/index.js'`, falls noch nicht da.)

- [ ] **Schritt 3: rot**

Run: `npx tsc -p tsconfig.test.json`
Expected: FAIL (`CREDIT_NOTE_ITEM_FIELDS` fehlt, `returnDisposition` nicht in `CancelInvoiceRequest`).

- [ ] **Schritt 4: Umsetzung – Vertrag** (`src/invoice/vertrag.ts`)

Oben:

```ts
import { RETURN_DISPOSITIONS, type ReturnDisposition } from '../models/cancellation.js';

export { RETURN_DISPOSITIONS, type ReturnDisposition };
```

In `ITEM_FIELDS` nach `discountPct`:

```ts
  /**
   * Artikel aus dem Artikelstamm (Lager-Kern Stufe 2): ist er bestandsgefuehrt
   * und das Modul Lager aktiv, bucht das Ausstellen ihn ab -- danach, die
   * Rechnung scheitert nie am Lager. Kein „/“, nicht „.“, „..“ oder „__…__“
   * (prueft der Server, `validation`).
   */
  articleId: id,
```

Nach `ITEM_PRICE_EXACTLY_ONE`:

```ts
/** Rueckgabe-Wahl einer Gutschrift: Vorgabe des Aufrufs oder je Position. */
const returnDisposition: Field = { type: 'enum', required: false, values: RETURN_DISPOSITIONS };

/**
 * Eine Gutschriftsposition: die Rechnungsposition plus `returnDisposition`
 * (wohin die zurueckgenommene Ware geht). An einer Rechnungsposition weist der
 * Server das Feld als unbekannt ab.
 */
export const CREDIT_NOTE_ITEM_FIELDS: Readonly<Record<string, Field>> = Object.freeze({ ...ITEM_FIELDS, returnDisposition });

const gutschriftPositionen: Field = {
  type: 'list',
  required: true,
  min: 1,
  max: 500,
  item: {
    type: 'object', required: true, fields: CREDIT_NOTE_ITEM_FIELDS, exactlyOne: ITEM_PRICE_EXACTLY_ONE,
  },
};
```

In `INVOICE_REQUESTS.issueInvoice` nach `brandId: id,`:

```ts
    /**
     * Lager-Standort, von dem bestandsgefuehrte Positionen abgebucht werden;
     * sonst der Standard-Standort. Ein unbekannter oder aufgeloester Standort
     * bucht am Standard-Standort und meldet ein Ereignis im Lager.
     */
    stockLocationId: id,
```

`cancelInvoice` nach `note: text(2000),`: `returnDisposition,` (Kommentar: „Fuer alle bestandsgefuehrten
Positionen; fehlt = `restock`.“). `createCreditNote`:

```ts
  createCreditNote: {
    idempotencyKey: idempotencyKey(true),
    invoiceId: idPflicht,
    reason: { type: 'enum', required: true, values: CREDIT_NOTE_REASONS },
    note: text(2000),
    items: gutschriftPositionen,
    /** Vorgabe fuer alle Positionen; je Position abweichend ueber `items[].returnDisposition`. */
    returnDisposition,
  },
```

Ist `ReturnDisposition` in `vertrag.ts` nur re-exportiert und sonst ungenutzt, den Typ-Import auf den
Re-Export beschränken (`export type { ReturnDisposition } from '../models/cancellation.js';`), damit
`noUnusedLocals` ruhig bleibt.

- [ ] **Schritt 5: Umsetzung – Typen und Exporte** (`src/invoice/typen.ts`)

```ts
// an InvoiceItemInput, nach discountPct:
  /** Artikel aus dem Artikelstamm; bestandsgefuehrt bucht das Ausstellen ihn vom Lager ab. */
  articleId?: string;

/** Eine Gutschriftsposition: wie eine Rechnungsposition, dazu die Rueckgabe-Wahl. */
export interface CreditNoteItemInput extends InvoiceItemInput {
  /** Wohin die Ware dieser Position geht; fehlt = Vorgabe des Aufrufs bzw. `restock`. */
  returnDisposition?: ReturnDisposition;
}

// an IssueInvoiceRequest, nach brandId:
  /** Lager-Standort fuer bestandsgefuehrte Positionen; sonst der Standard-Standort. */
  stockLocationId?: string;

export interface CancelInvoiceRequest {
  idempotencyKey: string;
  invoiceId: string;
  reason: CreditNoteReason;
  note?: string;
  /** Wohin die Ware bestandsgefuehrter Positionen geht; fehlt = `restock`. */
  returnDisposition?: ReturnDisposition;
}

export interface CreditNoteRequest extends CancelInvoiceRequest {
  items: CreditNoteItemInput[];
}
```

(`ReturnDisposition` in `typen.ts` aus `./vertrag.js` importieren, wie die übrigen Vertragstypen.)
In `src/invoice/index.ts`: `type CreditNoteItemInput` im `typen`-Block, `CREDIT_NOTE_ITEM_FIELDS`,
`RETURN_DISPOSITIONS`, `type ReturnDisposition` im `vertrag`-Block.

- [ ] **Schritt 6: Beispiele** (`fixtures/invoice-api-examples/`, Format wie `credit-ok.json`)

`issue-stock.json`:

```json
{
  "endpoint": "issueInvoice",
  "description": "Bestandsgefuehrter Artikel, abgebucht vom Lieferwagen",
  "request": {
    "idempotencyKey": "ex-13",
    "priceMode": "gross",
    "serviceStart": "2026-10-01",
    "stockLocationId": "van-1",
    "items": [
      {
        "description": "Roggenbrot",
        "quantity": 2,
        "unitPriceCents": 450,
        "vatRate": 10,
        "articleId": "rye-bread"
      }
    ]
  },
  "expected": {
    "ok": true
  }
}
```

`credit-return-disposition.json`:

```json
{
  "endpoint": "createCreditNote",
  "description": "Rueckgabe: Vorgabe zurueck ins Lager, eine Position defekt",
  "request": {
    "idempotencyKey": "ex-14",
    "invoiceId": "invoice_example",
    "reason": "return",
    "returnDisposition": "restock",
    "items": [
      {
        "description": "Roggenbrot",
        "quantity": 1,
        "unitPriceCents": 450,
        "vatRate": 10,
        "articleId": "rye-bread",
        "returnDisposition": "defective"
      }
    ]
  },
  "expected": {
    "ok": true
  }
}
```

`credit-error-return-disposition.json`:

```json
{
  "endpoint": "createCreditNote",
  "description": "Unbekannte Rueckgabe-Wahl an der Position",
  "request": {
    "idempotencyKey": "ex-15",
    "invoiceId": "invoice_example",
    "reason": "return",
    "items": [
      {
        "description": "Roggenbrot",
        "quantity": 1,
        "unitPriceCents": 450,
        "vatRate": 10,
        "articleId": "rye-bread",
        "returnDisposition": "lost"
      }
    ]
  },
  "expected": {
    "ok": false,
    "code": "validation",
    "fields": [
      "items[0].returnDisposition"
    ]
  }
}
```

`cancel-error-return-disposition.json`:

```json
{
  "endpoint": "cancelInvoice",
  "description": "Unbekannte Rueckgabe-Wahl beim Vollstorno",
  "request": {
    "idempotencyKey": "ex-16",
    "invoiceId": "invoice_example",
    "reason": "return",
    "returnDisposition": "lost"
  },
  "expected": {
    "ok": false,
    "code": "validation",
    "fields": [
      "returnDisposition"
    ]
  }
}
```

`issue-error-return-disposition.json`:

```json
{
  "endpoint": "issueInvoice",
  "description": "Die Rueckgabe-Wahl gehoert an die Gutschrift, nicht an die Rechnung",
  "request": {
    "idempotencyKey": "ex-17",
    "priceMode": "gross",
    "serviceStart": "2026-10-01",
    "items": [
      {
        "description": "Roggenbrot",
        "quantity": 1,
        "unitPriceCents": 450,
        "vatRate": 10,
        "returnDisposition": "restock"
      }
    ]
  },
  "expected": {
    "ok": false,
    "code": "validation",
    "fields": [
      "items[0].returnDisposition"
    ]
  }
}
```

`issue-error-stock-id.json`:

```json
{
  "endpoint": "issueInvoice",
  "description": "Lager-Kennungen ohne Schraegstrich und nicht nur Punkte",
  "request": {
    "idempotencyKey": "ex-18",
    "priceMode": "gross",
    "serviceStart": "2026-10-01",
    "stockLocationId": "..",
    "items": [
      {
        "description": "Roggenbrot",
        "quantity": 1,
        "unitPriceCents": 450,
        "vatRate": 10,
        "articleId": "a/b"
      }
    ]
  },
  "expected": {
    "ok": false,
    "code": "validation",
    "fields": [
      "stockLocationId",
      "items[0].articleId"
    ]
  }
}
```

- [ ] **Schritt 7: Schema erzeugen, grün, Probe gegen die Backend-Regeln**

```bash
npm run fixtures:rechnung && npm run fixtures:oberflaeche && npm test
KASSENECK_BACKEND=/Users/mali/kasseneck-wt-lager-s2 node -e '
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require(process.env.KASSENECK_BACKEND + "/functions/invoice-api-core.js");
const s = JSON.parse(fs.readFileSync("fixtures/invoice-api.schema.json", "utf8"));
for (const a of Object.keys(s.endpoints)) assert.deepEqual(core.alsSchema(a), s.endpoints[a].request, a);
const ordner = "fixtures/invoice-api-examples/";
for (const d of fs.readdirSync(ordner).filter((n) => n.endsWith(".json"))) {
  const b = JSON.parse(fs.readFileSync(ordner + d, "utf8"));
  const r = core.pruefeAnfrage(b.endpoint, b.request);
  assert.equal(r.ok, b.expected.ok, d);
  if (!r.ok) { assert.equal(r.code, b.expected.code, d); assert.deepEqual(r.errors.map((e) => e.field).sort(), [...b.expected.fields].sort(), d); }
}
console.log("Rechnungsvertrag == Backend");'
```

Expected: PASS und `Rechnungsvertrag == Backend`. (Die Probe braucht einen Backend-Stand mit Lager
Stufe 2 im Arbeitsbaum, ohne laufenden Merge; sonst denselben Befehl gegen einen sauberen Checkout.)

- [ ] **Schritt 8: Commit**

```bash
git add src/invoice/ fixtures/invoice-api.schema.json fixtures/invoice-api-examples/ fixtures/surface.json test/
git commit -m "feat(invoice): articleId, stockLocationId und returnDisposition in der Rechnungs-API"
```

---

### Task 6: `./stored` nachziehen (Lager-Standort intern, Rückgabe englisch, Artikel-Standorte)

Backend-Stellen, die `./stored` nachbildet und die sich geändert haben: `belegJeKanal` (benennt
`items[].rueckgabe` und `cancellations[].items[].rueckgabe` in `returnDisposition` um, unbekannter Wert
fällt weg), `belegAntwort` (`storno-core.ohneInterneBelegFelder` statt `ohneInterneStornoFelder`: ohne
`lagerStandortId`), seit Stufe 1 außerdem `listMyArticles`, `nurBekannte`, `artikelNachAussen`
(Artikelfelder still, `standorte` → `stockLocationIds`; Letzteres kommt über das in Task 1 erzeugte
`vokabular.ts`).

**Files:**
- Modify: `src/stored/draht.ts` (`_storedReceiptInner`, `_receiptEnvelopeToWire`, neue Helfer)
- Modify: `scripts/stored-zwillinge.mjs` (`BACKEND_STELLEN`), `test/fixtures/stored-zwillinge.json` (Skript)
- Test: `test/stored.test.ts`, `test/stored-backend.test.ts`

**Interfaces:**
- Consumes: `ReceiptItem.returnDisposition`, `CancellationItem.returnDisposition` (Task 4),
  `PosArticle.stockLocationIds` (Task 3).
- Produces: `_RUECKGABE_NACH_AUSSEN` (paketintern, `src/stored/draht.ts`).

- [ ] **Schritt 1: Failing Test ohne Backend** (`test/stored.test.ts`; die Datei hat schon
  `import * as stored`, `_storedReceiptToWire`, `lies(...)`, `Json` und `VOKABULAR`; nur
  `_RUECKGABE_NACH_AUSSEN` an den bestehenden Import aus `'../src/stored/draht.js'` anhängen)

```ts
test('stored: Storno-Zeile mit innerer Rueckgabe und Lager-Standort ergibt den englischen Draht', () => {
  const docs = Object.values(lies('stored/belege.json').documents) as Json[];
  const storno = docs.find((d) => d.cancellationOf);
  const original = docs.find((d) => !d.cancellationOf && d.receiptType === 'standard');
  assert.ok(storno && original, 'Storno- und Normalbeleg im Vertrag');
  const doc = {
    ...storno, lagerStandortId: 'van-1',
    items: storno.items.map((it: Json, i: number) => (i === 0 ? { ...it, articleId: 'rye-bread', originalIndex: 0, rueckgabe: 'defekt' } : it)),
  };
  const draht = _storedReceiptToWire(doc);
  assert.equal('lagerStandortId' in draht, false);
  const zeile = (draht.items as Json[])[0];
  assert.equal(zeile.returnDisposition, 'defective');
  assert.equal('rueckgabe' in zeile, false);
  assert.equal(stored.fromStoredReceipt(doc).items[0]!.returnDisposition, 'defective');
  // Ein unbekannter innerer Wert faellt weg wie am Rand des Servers (warneWeggelassen).
  const fremd = _storedReceiptToWire({ ...doc, items: [{ ...doc.items[0], rueckgabe: 'verloren' }, ...doc.items.slice(1)] });
  assert.equal('returnDisposition' in (fremd.items as Json[])[0], false);
  assert.equal('rueckgabe' in (fremd.items as Json[])[0], false);
  // Am Original: cancellations[].items[].rueckgabe.
  const mitEintrag = { ...original, cancellations: [{ receiptId: 'KECK-1-ID-9', at: 1, by: null, note: null, items: [{ index: 0, quantity: 1, rueckgabe: 'entsorgt' }] }] };
  assert.equal(((_storedReceiptToWire(mitEintrag).cancellations as Json[])[0].items as Json[])[0].returnDisposition, 'disposed');
  assert.deepEqual(stored.fromStoredReceipt(mitEintrag).cancellations![0]!.items, [{ index: 0, quantity: 1, returnDisposition: 'disposed' }]);
  // Der Katalog ist der des Vertrags.
  assert.deepEqual(_RUECKGABE_NACH_AUSSEN, VOKABULAR.catalogs.RUECKGABE);
});
```

- [ ] **Schritt 2: Failing Test mit Backend** (`test/stored-backend.test.ts`)

In `belegServer` die Hülle wie im Handler bauen:

```ts
  const huelle = {
    receipt: storno.ohneInterneBelegFelder(doc), ...betrieb, logo_url: kopf.logoFuerBeleg(version, konto, doc),
    logo_skala: kopf.logoStufeFuerKonto(konto), kopfId: version ? version.id : null, layout: lay, pruefangaben, testSignatur, testKasse,
  };
```

In `extra` des Beleg-Tests anhängen:

```ts
    { ...storno, lagerStandortId: 'van-1', items: storno.items.map((it: Json, i: number) => (i === 0 ? { ...it, articleId: 'rye-bread', originalIndex: 0, rueckgabe: 'defekt' } : it)) },
    { ...storno, items: storno.items.map((it: Json) => ({ ...it, articleId: 'rye-bread', rueckgabe: 'verloren' })) },
    { ...docs[2], lagerStandortId: 'store-1', cancellations: [{ receiptId: 'X-2', at: 1, by: null, note: null, items: [{ index: 0, quantity: 1, rueckgabe: 'entsorgt' }] }] },
```

In den Artikelfällen anhängen:

```ts
    ['a9', { standorte: ['haupt', 'van-1'], einkauf: { standardMicros: 1200000 }, bestandsart: 'menge', mindestJeStandort: { haupt: 5000 } }],
```

- [ ] **Schritt 3: rot**

```bash
npx tsc -p tsconfig.test.json && TZ=Europe/Vienna node --test test-dist/test/stored.test.js
KASSENECK_BACKEND=/Users/mali/kasseneck-wt-lager-s2 TZ=Europe/Vienna node --test test-dist/test/stored-backend.test.js test-dist/test/stored-zwillinge.test.js
```

Expected: FAIL (`_RUECKGABE_NACH_AUSSEN` fehlt; mit Backend: Beleg mit `rueckgabe` weicht ab, Quelltext-Wächter
meldet geänderte Backend-Stellen). Der Backend-Pfad muss einen sauberen Arbeitsbaum mit Lager Stufe 2
**und** `origin/main` haben, mit `npm ci` in `functions` und `functions-kasse` (im Lager-Worktree vorhanden).

- [ ] **Schritt 4: Umsetzung** (`src/stored/draht.ts`, Abschnitt „Belege“)

```ts
/**
 * Interne Dokumentfelder eines Belegs, die keine Antwort traegt (Zwilling von
 * storno-core.INTERNE_BELEG_FELDER): der Lager-Standort der Kasse, den
 * createReceipt fuer die Lagerbuchung an den Beleg kopiert.
 */
const INTERNE_BELEG_FELDER = ['lagerStandortId'] as const;

/** Rueckgabe-Wahl innen -> aussen (Katalog RUECKGABE; stored.test.ts vergleicht mit dem Vertrag). */
export const _RUECKGABE_NACH_AUSSEN: Readonly<Record<string, string>> = Object.freeze({ lager: 'restock', defekt: 'defective', entsorgt: 'disposed' });

/**
 * Zwilling von `rueckgabeUmbenennen` (Rand): `rueckgabe` heisst aussen
 * `returnDisposition`, an Ort und Stelle; ein Wert ausserhalb des Katalogs
 * faellt weg (der Server schreibt dafuer eine Warnzeile).
 */
function rueckgabeUmbenennen(o: unknown): unknown {
  if (!istObjekt(o) || !hat(o, 'rueckgabe')) return o;
  const raus: Objekt = {};
  for (const [k, w] of Object.entries(o)) {
    if (k !== 'rueckgabe') { raus[k] = w; continue; }
    if (typeof w === 'string' && hat(_RUECKGABE_NACH_AUSSEN, w)) raus.returnDisposition = _RUECKGABE_NACH_AUSSEN[w];
  }
  return raus;
}
const zeilenMitRueckgabe = (items: unknown): unknown => (Array.isArray(items) ? items.map(rueckgabeUmbenennen) : items);

/** Zwilling von `belegRueckgabeNachAussen`: Storno-Zeilen und Eintraege in `cancellations[]`. */
function belegRueckgabeNachAussen(beleg: Objekt): Objekt {
  const raus: Objekt = { ...beleg };
  if (Array.isArray(beleg.items)) raus.items = zeilenMitRueckgabe(beleg.items);
  if (Array.isArray(beleg.cancellations)) {
    raus.cancellations = beleg.cancellations.map((c) => (istObjekt(c) && Array.isArray(c.items) ? { ...c, items: zeilenMitRueckgabe(c.items) } : c));
  }
  return raus;
}
```

`_storedReceiptInner` (Kommentar: „ohne Storno-Marke und Lager-Standort (storno-core.ohneInterneBelegFelder)“):

```ts
  const { [STORNO_MARKE]: _s, ...beleg } = doc;
  for (const feld of INTERNE_BELEG_FELDER) delete beleg[feld];
  if (hat(beleg, 'cancellationOf')) beleg.cancellationOf = ohneMarke(beleg.cancellationOf);
  if (Array.isArray(beleg.cancellations)) beleg.cancellations = beleg.cancellations.map(ohneMarke);
  return beleg;
```

`_receiptEnvelopeToWire` (Rand: `belegJeKanal`):

```ts
export function _receiptEnvelopeToWire(huelle: Objekt): Objekt {
  const schema = SCHEMAS.getReceipt;
  const draht = werteNachAussen(schluesselNachAussen(huelle, schema.data), schema.werte) as Objekt;
  return istObjekt(draht.receipt) ? { ...draht, receipt: belegRueckgabeNachAussen(draht.receipt) } : draht;
}
```

`scripts/stored-zwillinge.mjs`, `BACKEND_STELLEN` ergänzen:

```js
  ['functions/gemeinsam/storno-core.js', 'function ohneInterneBelegFelder('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function rueckgabeUmbenennen('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function zeilenMitRueckgabe('],
  ['functions/gemeinsam/api-vokabular-v3.js', 'function belegRueckgabeNachAussen('],
```

- [ ] **Schritt 5: grün mit Backend, dann Quelltext-Wächter neu festhalten**

```bash
npx tsc -p tsconfig.test.json
KASSENECK_BACKEND=/Users/mali/kasseneck-wt-lager-s2 TZ=Europe/Vienna node --test test-dist/test/stored-backend.test.js
KASSENECK_BACKEND=/Users/mali/kasseneck-wt-lager-s2 node scripts/stored-zwillinge.mjs
KASSENECK_BACKEND=/Users/mali/kasseneck-wt-lager-s2 npm test
npm test
```

Expected: `stored-backend` PASS (erst dann festhalten), danach beide `npm test` PASS.

- [ ] **Schritt 6: Commit**

```bash
git add src/stored/draht.ts scripts/stored-zwillinge.mjs test/fixtures/stored-zwillinge.json test/stored.test.ts test/stored-backend.test.ts
git commit -m "feat(stored): Lager-Standort intern, Rueckgabe-Wahl englisch, Artikel-Standorte"
```

---

### Task 7: README und CHANGELOG (1.x)

**Files:**
- Modify: `README.md` (Abschnitte „Cancellation (Storno)“, „Register settings, articles and printers (`./pos`)“, „Invoice API (`./invoice`)“)
- Modify: `CHANGELOG.md` (neuer Eintrag `## 1.2.0` oben)
- Test: `test/readme.test.ts` (bestehend; prüft Beispiel-Importe gegen die Exporte)

- [ ] **Schritt 1: README – Storno** (nach dem Absatz „**Vouchers.** …“ einfügen)

````markdown
**Returns (stock module).** If the account runs the stock module, a
cancellation books the goods of article lines back. `returnDisposition` says
where they go: `restock` (back into stock, the server's default),
`defective` (into stock as defective) or `disposed`. It is a default for the
call and can differ per line:

```ts
await api.cancelReceipt({
  receipt: original,
  reason: 'customer_cancelled',
  returnDisposition: 'restock',
  items: [{ index: 0, quantity: 1, returnDisposition: 'defective' }, { index: 1, quantity: 2 }],
});
```

Lines without `articleId` are never booked, whatever you send. A value outside
`RETURN_DISPOSITIONS` is rejected before sending; the server would answer
`invalid_return_disposition`. The cancellation receipt carries `originalIndex`
and `returnDisposition` on its article lines, the original carries
`returnDisposition` in `cancellations[].items`.
````

- [ ] **Schritt 2: README – Kasse** (vor dem Absatz „`ERROR_RULES` says which text …“ einfügen)

````markdown
**Stock at the register.** Three calls on the register path, permissions
checked by the server (`stockView`, `stockCosts`, `stockLocation` in
`REGISTER_PERMS`):

```ts
import { listMyStockLocations, listMyStock, setMyCashregisterStockLocation } from '@kreiseck/kasseneck-api/pos';

const locations = await listMyStockLocations(transport); // { id, name, type, address, licensePlate, active, virtual }
const { stock, values } = await listMyStock(transport, { locationId: 'van-1' });
await setMyCashregisterStockLocation(transport, { stockLocationId: 'van-1' }); // null resets to the default location
```

Quantities are integers in thousandths of the base unit (`1000` is one
piece, `250` is 0.250 kg) and can be negative when more was sold than booked.
`values` (stock value in cents, average cost in micro-euros) is `null`
without the permission `stockCosts`, never an empty list. Articles carry
`stockLocationIds`, registers `stockLocationId`; errors such as
`location_not_found` and `location_inactive` are in `POS_ERROR_CODES`.
````

- [ ] **Schritt 3: README – Rechnungen** (nach dem Absatz „**Prices and quantities.** …“ einfügen)

```markdown
**Stock.** A line may name its article (`articleId`); if the article is
stock-tracked and the stock module is active, issuing the invoice books it
out, from `stockLocationId` or the default location. The invoice never fails
because of stock. `cancelInvoice` and `createCreditNote` take
`returnDisposition` (`restock`, `defective`, `disposed`), credit-note lines
also per line (`CreditNoteItemInput`); invoice lines reject it. Identifiers
must not contain `/` and must not be `.`, `..` or `__…__` (`validation`).
```

- [ ] **Schritt 4: CHANGELOG** (oberhalb von `## 1.1.1`)

```markdown
## 1.2.0

Stock at the register, returns on cancellation, stock fields in the invoice
API. Reason: since stage 2 of the stock module the backend books sales,
cancellations and invoices against the stock of a location. The register has
to show locations and stock, choose its own location and say where returned
goods go; external invoicing systems have to name the article.

Additive, no breaking change; receipts and existing calls send and read the
same bytes as in 1.1.1.

- **Three register calls** (`./pos`, register path `/api/v3` only):
  `listMyStockLocations`, `listMyStock({ locationId, articleId, belowMinimum })`
  and `setMyCashregisterStockLocation({ stockLocationId, cashregisterId })`
  (`null` resets to the default location). Quantities are integer thousandths
  of the base unit and keep their sign; `values` is `null` without the
  permission `stockCosts`. New list `STOCK_LOCATION_TYPES`; `POS_ERROR_CODES`
  gains `location_inactive`, `location_not_found` and `server_error`.
- **Locations on articles, registers and devices**: `PosArticle.stockLocationIds`
  (`null` when the article names none), `Cashregister.stockLocationId`,
  `cashregister.stockLocationId` in `listRegisterUsersForDevice`.
- **Register permissions** `stockView`, `stockCosts`, `stockMove`, `stockLoss`,
  `stocktakeCount`, `stocktakeClose`, `stockLocation` in `RegisterUserPerms`
  and `REGISTER_PERMS`.
- **Returns on cancellation**: `cancelReceipt` takes `returnDisposition` for the
  call and per line (`RETURN_DISPOSITIONS`: `restock`, `defective`,
  `disposed`), checked before sending. New code `invalid_return_disposition`
  at position 19 of `CANCELLATION_ERROR_CODES`. Cancellation lines with an
  article carry `originalIndex` and `returnDisposition`, and so do the items of
  `cancellations[]`.
- **Invoice API**: `items[].articleId`, `stockLocationId` on `issueInvoice`,
  `returnDisposition` on `cancelInvoice` and `createCreditNote` (also per line,
  `CreditNoteItemInput`, `CREDIT_NOTE_ITEM_FIELDS`). Schema
  `fixtures/invoice-api.schema.json` and six new examples.
- **`./stored`**: stored receipts drop `lagerStandortId` and turn `rueckgabe`
  into `returnDisposition`; stored articles carry `stockLocationIds`.
- **Contract `/v3` caught up with the backend**: `PUBLIC_CALLS` lists the
  public endpoints of partner billing, invoice items and mandates (names only),
  and `api_not_approved` (developer area) is in every derived error list and in
  `PAYMENT_CALL_REJECTED_CODES`. For the Dart twin: `surface.json` changes in
  `routes`, `calls.pos`, `registerPerms`, `pos` and `invoice`.
```

- [ ] **Schritt 5: prüfen und committen**

```bash
npm test
git add README.md CHANGELOG.md
git commit -m "docs: Lager an der Kasse, Rueckgabe beim Storno und Lagerfelder der Rechnungs-API"
```

Expected: PASS (`readme.test.ts` erkennt die neuen Importe; `versionen.test.ts` verlangt den
CHANGELOG-Eintrag erst mit der Version in Task 8).

---

### Task 8: Version 1.2.0, PR, Veröffentlichung (Freigabe durch den Nutzer)

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/version.ts`, `fixtures/surface.json`, `fixtures/pos-texts.json`, `fixtures/invoice-texts.json`, `fixtures/hobex-hps-codes.json`, `fixtures/invoice-api.schema.json`

- [ ] **Schritt 1: Version und versionstragende Vertragsdateien**

```bash
npm version 1.2.0 --no-git-tag-version
sed -i '' "s/PACKAGE_VERSION = '1.1.1'/PACKAGE_VERSION = '1.2.0'/" src/version.ts
npm run fixtures:oberflaeche && npm run fixtures:texte && npm run fixtures:rechnungstexte && npm run fixtures:hobex-hps-codes && npm run fixtures:rechnung
```

- [ ] **Schritt 2: Vertrag ein letztes Mal gegen `origin/main` des Backends prüfen**

```bash
EXPORT=$(mktemp -d)
git -C /Users/mali/kasseneck-wt-lager-s2 fetch -q origin
git -C /Users/mali/kasseneck-wt-lager-s2 archive origin/main functions/vertrag/v3 | tar -x -C "$EXPORT"
KASSENECK_BACKEND="$EXPORT" node scripts/v3-vertrag-holen.mjs && git diff --stat fixtures/v3
```

Expected: keine Änderung. Ändert sich etwas, ist das Backend weitergezogen: Task 1 Schritt 2–6 für die
Unterschiede wiederholen (eigener Commit) und erst dann fortfahren. Ist Lager Stufe 2 noch nicht auf
`origin/main`, hier anhalten – 1.2.0 erscheint erst nach dem Backend.

- [ ] **Schritt 3: alle CI-Ziele lokal**

```bash
npm run build && npm test
npm run fixtures:kasse && npm run fixtures:oberflaeche && git diff --exit-code fixtures/
python3 scripts/rechnung-referenz.py --pruefe fixtures/invoice-calc-random.json
ERREICHBARKEIT_NUR_LOKAL=1 npm run check:erreichbar
npm run check:consumer
```

Expected: alles grün, `git diff --exit-code fixtures/` ohne Ausgabe.

- [ ] **Schritt 4: Commit, Push, PR**

```bash
git add package.json package-lock.json src/version.ts fixtures/ CHANGELOG.md
git commit -m "chore: 1.2.0"
git push -u origin feature/lager-stufe2
gh pr create --base main --head feature/lager-stufe2 \
  --title "1.2.0: Lager an der Kasse, Rückgabe beim Storno, Lagerfelder der Rechnungs-API" \
  --body "Lager-Kern Stufe 2b. Drei Kassen-Aufrufe (Standorte, Bestand, Standort der Kasse), Standort an Artikel/Kasse/Gerät, Lager-Rechte, returnDisposition an cancelReceipt, cancelInvoice und createCreditNote, articleId/stockLocationId in der Rechnungs-API, ./stored nachgezogen, Vertrag /v3 auf den Stand von keck main. Details im CHANGELOG."
```

- [ ] **Schritt 5: Tore vor Merge und Veröffentlichung**

1. CI des PR grün.
2. Backend mit Lager Stufe 2 ist deployt (keck `main`, CI-Deploy), und die Rewrites der drei Aufrufe auf
   `kasse.kasseneck.at/api/v3` sind live (kasseneck-web, Übergabe 2c). Prüfen:

```bash
npm run build && npm run check:erreichbar
```

Expected: keine Meldung zu `listMyStockLocations`, `listMyStock`, `setMyCashregisterStockLocation`. Ist 2c
noch nicht live, **nicht** veröffentlichen (sonst schlägt die tägliche Erreichbarkeitsprüfung fehl); eine
Ausnahme `offen` in `scripts/erreichbarkeit-ausnahmen.json` nur mit Issue-Nummer und nach Rückfrage.
3. Merge nach Freigabe durch den Nutzer.

- [ ] **Schritt 6: Veröffentlichen – NUR nach ausdrücklicher Bestätigung des Nutzers, aus sauberer Kopie**

```bash
P=$(mktemp -d)/kasseneck-api
git clone --branch main --single-branch https://github.com/kreiseck-at/kasseneck-api.git "$P"
cd "$P" && git log -1 --format='%h %s'     # Merge von 1.2.0 bzw. "chore: 1.2.0"
node -p "require('./package.json').version" # 1.2.0
npm ci && npm test
npm pack --dry-run 2>&1 | tee pack.txt
grep -E "\.env|\.secret|\.tgz|test-dist|node_modules|kr_live_" pack.txt && echo "STOP: unerwarteter Inhalt" || echo "Inhalt ok"
npm publish
npm view @kreiseck/kasseneck-api dist-tags   # latest: 1.2.0, legacy: unveraendert
```

`pack.txt` liegt nur im Wegwerfklon. Danach den Wegwerfklon löschen; den Nutzer fragen, ob der dist-tag
`next` (steht auf 1.1.1) mitziehen soll (`npm dist-tag add @kreiseck/kasseneck-api@1.2.0 next`).

---

### Task 9: Rückportierung auf `release/0.x` (Storno-Code und Rechnungsfelder)

Das Backend vendort nur die 0.x-Linie (`functions/package.json`: `file:vendor/kreiseck-kasseneck-api-0.31.0.tgz`)
und hält zwei **benannte Ausnahmen**, bis ein vendorierter Stand führt: `rueckgabe_ungueltig` in
`CANCELLATION_ERROR_CODES` (`functions/test/unit/storno-fehlercodes-zwilling.test.js`) und die
Rechnungsfelder im Schema `fixtures/rechnung-api.schema.json` (`functions/test/unit/invoice-api-vertrag.test.js`).
Die 0.x-Linie spricht die innere Form: der Code heißt dort **`rueckgabe_ungueltig`** (wie im Backend),
die Rechnungs-API ist schon englisch (`returnDisposition`, `restock|defective|disposed`).
`CONTRIBUTING.md` der Linie sagt „nur Fehlerbehebungen“; dies ist bewusst nur Vertragsgleichstand mit dem
Backend, keine Funktion der Kasse (Grund im CHANGELOG).

**Files** (im neuen Worktree):
- Modify: `src/models/cancellation.ts` (`CANCELLATION_ERROR_CODES`)
- Modify: `src/rechnung/vertrag.ts` (`POSITION_FELDER`, neu `GUTSCHRIFT_POSITION_FELDER`, `RETURN_DISPOSITIONS`, `RECHNUNG_ANFRAGEN`)
- Modify: `src/rechnung/typen.ts`, `src/rechnung/index.ts`
- Create: `fixtures/rechnung-api-beispiele/issue-lager.json`, `credit-rueckgabe.json`, `credit-fehler-rueckgabe.json`, `storno-fehler-rueckgabe.json`, `issue-fehler-rueckgabe.json`, `issue-fehler-lagerkennung.json`
- Modify: `fixtures/rechnung-api.schema.json`, `fixtures/oberflaeche.json` (Skripte)
- Test: `test/cancellation.test.ts:59-80`, `test/rechnung-vertrag.test.ts:52-59`

**Interfaces:**
- Produces (0.x, Wurzel bzw. `./rechnung`): `CANCELLATION_ERROR_CODES` endet mit `'rueckgabe_ungueltig'`;
  `RETURN_DISPOSITIONS`, `type ReturnDisposition`, `GUTSCHRIFT_POSITION_FELDER`, `type CreditNoteItemInput`;
  Schema-Felder wie in Task 5 (identisch zu `core.alsSchema` des Backends).

- [ ] **Schritt 1: eigener Worktree, eigener Zweig**

```bash
git -C /Users/mali/kreiseck/kasseneck-api-wt-lager fetch -q origin
git -C /Users/mali/kreiseck/kasseneck-api-wt-lager worktree add -b fix/lager-stufe2-0x /Users/mali/kreiseck/kasseneck-api-wt-lager-0x origin/release/0.x
cd /Users/mali/kreiseck/kasseneck-api-wt-lager-0x && npm ci && npm test
```

Expected: grün auf 0.31.0.

- [ ] **Schritt 2: Failing Tests**

`test/cancellation.test.ts`:

```ts
// Fehlercodes: dieselbe Liste wie functions/gemeinsam/storno-core.js STORNO_FEHLERCODES.
// Die Kasse entscheidet am Code (KasseneckApiError.code), nie am Text.
test('Fehlercode-Katalog: dieselben zwanzig Codes wie das Backend, als Liste und Waechter', () => {
  assert.deepEqual([...CANCELLATION_ERROR_CODES], [
    'beleg_nicht_gefunden', 'belegart_nicht_stornierbar', 'trainingsbeleg', 'bereits_storniert',
    'position_ungueltig', 'menge_ueber_rest', 'grund_unbekannt', 'anmerkung_zu_lang', 'items_ungueltig',
    'kasse_nicht_zugewiesen', 'keine_berechtigung', 'nur_eigene_belege', 'kasse_unvollstaendig',
    'storno_fehlgeschlagen',
    'STORNO_PAYMENTS_REQUIRED', 'STORNO_REFUND_EXCEEDS_PAYMENT', 'STORNO_REFUND_REFERENCE_REQUIRED',
    'STORNO_REFUND_REFERENCE_UNKNOWN', 'STORNO_OUTCOME_UNKNOWN', 'rueckgabe_ungueltig',
  ]);
  assert.equal(isCancellationErrorCode('rueckgabe_ungueltig'), true);
  assert.equal(isCancellationErrorCode('invalid_return_disposition'), false);
  // … die bisherigen Zusicherungen dieses Tests bleiben unveraendert darunter stehen
```

`test/rechnung-vertrag.test.ts` – den Test „Positionen von Rechnung und Gutschrift sind dieselbe
Beschreibung“ ersetzen (Import um `GUTSCHRIFT_POSITION_FELDER, RETURN_DISPOSITIONS` ergänzen):

```ts
test('Vertrag: Gutschrift-Positionen sind die Rechnungspositionen plus returnDisposition', () => {
  const issue = RECHNUNG_ANFRAGEN.issueInvoice['items'];
  const credit = RECHNUNG_ANFRAGEN.createCreditNote['items'];
  assert.ok(issue && issue.typ === 'list' && issue.eintrag.typ === 'object');
  assert.ok(credit && credit.typ === 'list' && credit.eintrag.typ === 'object');
  assert.equal(issue.eintrag.felder, POSITION_FELDER);
  assert.equal(credit.eintrag.felder, GUTSCHRIFT_POSITION_FELDER);
  assert.deepEqual(GUTSCHRIFT_POSITION_FELDER, { ...POSITION_FELDER, returnDisposition: { typ: 'enum', pflicht: false, werte: RETURN_DISPOSITIONS } });
  assert.equal('returnDisposition' in POSITION_FELDER, false);
});

test('Vertrag: Lagerfelder wie im Backend (Kennung 1-128, Rueckgabe-Katalog), alle optional', () => {
  const kennung = { typ: 'string', pflicht: false, min: 1, max: 128 };
  assert.deepEqual(POSITION_FELDER['articleId'], kennung);
  assert.deepEqual(RECHNUNG_ANFRAGEN.issueInvoice['stockLocationId'], kennung);
  for (const aufruf of ['cancelInvoice', 'createCreditNote'] as const) {
    assert.deepEqual(RECHNUNG_ANFRAGEN[aufruf]['returnDisposition'], { typ: 'enum', pflicht: false, werte: RETURN_DISPOSITIONS }, aufruf);
  }
  assert.deepEqual([...RETURN_DISPOSITIONS], ['restock', 'defective', 'disposed']);
});
```

Run: `npx tsc -p tsconfig.test.json` → FAIL (`GUTSCHRIFT_POSITION_FELDER` fehlt).

- [ ] **Schritt 3: Umsetzung**

`src/models/cancellation.ts`, in `CANCELLATION_ERROR_CODES` nach `'STORNO_OUTCOME_UNKNOWN',`:

```ts
  'rueckgabe_ungueltig',              // Lager-Kern Stufe 2: Rueckgabe-Wahl nicht lager, defekt oder entsorgt
```

`src/rechnung/vertrag.ts`:

```ts
/** Rueckgabe-Wahl einer Gutschrift (Lager-Kern Stufe 2), wie im Backend RUECKGABE_API. */
export const RETURN_DISPOSITIONS = ['restock', 'defective', 'disposed'] as const;
export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];
const rueckgabe: Feld = { typ: 'enum', pflicht: false, werte: RETURN_DISPOSITIONS };
```

In `POSITION_FELDER` nach `discountPct`: `articleId: id,` (Kommentar wie in Task 5 Schritt 4). Nach
`POSITION_PREIS_GENAU_EINS`:

```ts
/** Gutschriftsposition: Rechnungsposition plus Rueckgabe-Wahl (an der Rechnung weist der Server sie ab). */
export const GUTSCHRIFT_POSITION_FELDER: Readonly<Record<string, Feld>> = Object.freeze({ ...POSITION_FELDER, returnDisposition: rueckgabe });

const gutschriftPositionen: Feld = {
  typ: 'list',
  pflicht: true,
  min: 1,
  max: 500,
  eintrag: {
    typ: 'object', pflicht: true, felder: GUTSCHRIFT_POSITION_FELDER, genauEins: POSITION_PREIS_GENAU_EINS,
  },
};
```

`RECHNUNG_ANFRAGEN`: `issueInvoice` nach `brandId: id,` → `stockLocationId: id,`; `cancelInvoice` nach
`note` → `returnDisposition: rueckgabe,`; `createCreditNote` → `items: gutschriftPositionen,` und
`returnDisposition: rueckgabe,`.

`src/rechnung/typen.ts`: wie Task 5 Schritt 5 (`InvoiceItemInput.articleId?`, `CreditNoteItemInput`,
`IssueInvoiceRequest.stockLocationId?`, `CancelInvoiceRequest.returnDisposition?`,
`CreditNoteRequest.items: CreditNoteItemInput[]`; `ReturnDisposition` aus `./vertrag.js`).
`src/rechnung/index.ts`: `GUTSCHRIFT_POSITION_FELDER`, `RETURN_DISPOSITIONS`, `type ReturnDisposition`,
`type CreditNoteItemInput` exportieren.

- [ ] **Schritt 4: Beispiele** (`fixtures/rechnung-api-beispiele/`, Format der 0.x-Linie:
  `aufruf`/`beschreibung`/`anfrage`/`erwartet`; Inhalte wie die sechs Dateien in Task 5 Schritt 6, Kennungen
  `bsp-13` … `bsp-18`, `invoiceId` `rechnung_beispiel`)

`credit-fehler-rueckgabe.json` als Vorlage für die Form:

```json
{
  "aufruf": "createCreditNote",
  "beschreibung": "Unbekannte Rueckgabe-Wahl an der Position",
  "anfrage": {
    "idempotencyKey": "bsp-15",
    "invoiceId": "rechnung_beispiel",
    "reason": "return",
    "items": [
      {
        "description": "Roggenbrot",
        "quantity": 1,
        "unitPriceCents": 450,
        "vatRate": 10,
        "articleId": "rye-bread",
        "returnDisposition": "lost"
      }
    ]
  },
  "erwartet": {
    "ok": false,
    "code": "validation",
    "fields": [
      "items[0].returnDisposition"
    ]
  }
}
```

Die übrigen fünf: `issue-lager.json` (bsp-13, `ok: true`), `credit-rueckgabe.json` (bsp-14, `ok: true`),
`storno-fehler-rueckgabe.json` (bsp-16, `cancelInvoice`, Feld `returnDisposition`),
`issue-fehler-rueckgabe.json` (bsp-17, Feld `items[0].returnDisposition`), `issue-fehler-lagerkennung.json`
(bsp-18, Felder `stockLocationId`, `items[0].articleId`) – jeweils mit derselben `anfrage` wie das
gleichnamige 1.x-Beispiel aus Task 5 Schritt 6.

- [ ] **Schritt 5: erzeugen, grün, Probe gegen das Backend**

```bash
npm run fixtures:rechnung && npm run fixtures:oberflaeche && npm test
KASSENECK_BACKEND=/Users/mali/kasseneck-wt-lager-s2 node -e '
const assert = require("node:assert/strict");
const fs = require("node:fs");
const B = process.env.KASSENECK_BACKEND + "/functions/";
const core = require(B + "invoice-api-core.js");
const s = JSON.parse(fs.readFileSync("fixtures/rechnung-api.schema.json", "utf8"));
for (const a of Object.keys(s.aufrufe)) assert.deepEqual(core.alsSchema(a), s.aufrufe[a].anfrage, a);
const ordner = "fixtures/rechnung-api-beispiele/";
for (const d of fs.readdirSync(ordner).filter((n) => n.endsWith(".json"))) {
  const b = JSON.parse(fs.readFileSync(ordner + d, "utf8"));
  const r = core.pruefeAnfrage(b.aufruf, b.anfrage);
  assert.equal(r.ok, b.erwartet.ok, d);
  if (!r.ok) { assert.equal(r.code, b.erwartet.code, d); assert.deepEqual(r.errors.map((e) => e.field).sort(), [...b.erwartet.fields].sort(), d); }
}
const { STORNO_FEHLERCODES } = require(B + "gemeinsam/storno-core.js");
assert.deepEqual([...require("./dist/cjs/index.js").CANCELLATION_ERROR_CODES], [...STORNO_FEHLERCODES]);
console.log("0.x-Vertrag == Backend, ohne Ausnahme");'
```

Expected: PASS und `0.x-Vertrag == Backend, ohne Ausnahme` – genau das prüfen die beiden Backend-Tests
nach dem Entfernen der Ausnahmen (Task 11).

- [ ] **Schritt 6: Commit**

```bash
git add src/ test/ fixtures/
git commit -m "fix: Storno-Code rueckgabe_ungueltig und Lagerfelder der Rechnungs-API fuer den Backend-Vertrag"
```

---

### Task 10: Version 0.32.0, PR, Veröffentlichung unter `legacy` (Freigabe durch den Nutzer)

**Files** (Worktree `/Users/mali/kreiseck/kasseneck-api-wt-lager-0x`): `package.json`, `package-lock.json`,
`CHANGELOG.md`, `fixtures/oberflaeche.json`, `fixtures/kasse-texte.json`, `fixtures/rechnung-texte.json`,
`fixtures/hobex-hps-codes.json`, `fixtures/rechnung-api.schema.json`

- [ ] **Schritt 1: CHANGELOG** (oberhalb von `## 0.31.0`)

```markdown
## 0.32.0

Vertragsgleichstand mit dem Backend für Lager-Kern Stufe 2. Das Backend vendort nur die 0.x-Linie und
prüft daran seine Zwillingstests; darum kommen hier genau die Teile hinzu, die es dafür braucht – kein
neuer Aufruf, kein neues Verhalten der Kasse. Die Kassen-Aufrufe des Lagers gibt es nur in 1.x (ab 1.2.0).

- **Storno-Code `rueckgabe_ungueltig`** am Ende von `CANCELLATION_ERROR_CODES` (Zwilling von
  `STORNO_FEHLERCODES`; unter `/v3` `invalid_return_disposition`). Grund: das Backend weist eine
  Rückgabe-Wahl außerhalb von `lager|defekt|entsorgt` mit diesem Code ab, und die Kasse entscheidet am Code.
- **Rechnungs-API:** `items[].articleId`, `stockLocationId` an `issueInvoice`, `returnDisposition`
  (`restock|defective|disposed`) an `cancelInvoice` und `createCreditNote`, dort auch je Position
  (`CreditNoteItemInput`, `GUTSCHRIFT_POSITION_FELDER`); Schema `fixtures/rechnung-api.schema.json` und
  sechs Beispiele. Grund: das Backend nimmt die Felder seit Stufe 2 an und vergleicht sein Schema in beide
  Richtungen mit dem vendorierten.
```

- [ ] **Schritt 2: Version, Vertragsdateien, alle CI-Ziele der Linie**

```bash
cd /Users/mali/kreiseck/kasseneck-api-wt-lager-0x
npm version 0.32.0 --no-git-tag-version
npm run fixtures:oberflaeche && npm run fixtures:texte && npm run fixtures:rechnungstexte && npm run fixtures:hobex-hps-codes && npm run fixtures:rechnung
grep -rn '"0.31.0"' fixtures/*.json || echo "keine alte Version mehr"
npm run build && npm test
npm run fixtures:kasse && npm run fixtures:oberflaeche && git diff --exit-code fixtures/
npm run check:consumer
```

Expected: grün, `keine alte Version mehr`. (Die genaue Liste der CI-Schritte steht in
`.github/workflows/ci.yml` dieses Zweigs; jeden dort genannten Schritt lokal fahren.)

- [ ] **Schritt 3: Commit, Push, PR gegen `release/0.x`**

```bash
git add package.json package-lock.json CHANGELOG.md fixtures/
git commit -m "chore: 0.32.0 – Lagerfelder fuer den Backend-Vertrag"
git push -u origin fix/lager-stufe2-0x
gh pr create --base release/0.x --head fix/lager-stufe2-0x \
  --title "0.32.0: Storno-Code rueckgabe_ungueltig und Lagerfelder der Rechnungs-API" \
  --body "Vertragsgleichstand mit dem Backend (Lager-Kern Stufe 2), damit das Backend die benannten Ausnahmen in storno-fehlercodes-zwilling und invoice-api-vertrag streichen kann. Kein neuer Aufruf. Details im CHANGELOG."
```

Merge nach grüner CI und Freigabe durch den Nutzer.

- [ ] **Schritt 4: Veröffentlichen – NUR nach ausdrücklicher Bestätigung, aus sauberer Kopie, Kanal `legacy`**

```bash
P=$(mktemp -d)/kasseneck-api-0x
git clone --branch release/0.x --single-branch https://github.com/kreiseck-at/kasseneck-api.git "$P"
cd "$P" && git log -1 --format='%h %s' && node -p "require('./package.json').version"   # 0.32.0
npm ci && npm test
npm pack --dry-run 2>&1 | tee pack.txt
grep -E "\.env|\.secret|\.tgz|test-dist|node_modules|kr_live_" pack.txt && echo "STOP: unerwarteter Inhalt" || echo "Inhalt ok"
npm publish --tag legacy
npm view @kreiseck/kasseneck-api dist-tags   # latest: 1.x (unveraendert), legacy: 0.32.0
```

Nie ohne `--tag legacy`: sonst wandert `latest` auf 0.x. Danach den Wegwerfklon und – nach dem Merge – den
Worktree entfernen: `git -C /Users/mali/kreiseck/kasseneck-api-wt-lager worktree remove /Users/mali/kreiseck/kasseneck-api-wt-lager-0x`.

---

### Task 11: Backend-Nachzug in keck – 0.32.0 vendoren, benannte Ausnahmen entfernen

Voraussetzung: 0.32.0 ist veröffentlicht (Task 10). Arbeitsort: Ist `feature/lager-stufe2` noch offen,
auf diesem Zweig nach Absprache mit dessen Sitzung; sonst eigener Worktree von `origin/main`:

```bash
git -C /Users/mali/kasseneck fetch -q origin
git -C /Users/mali/kasseneck worktree add -b chore/kasseneck-api-0.32.0 /Users/mali/kasseneck-wt-npm-032 origin/main
cd /Users/mali/kasseneck-wt-npm-032/functions && npm ci
```

**Files** (keck):
- Modify: `functions/test/unit/storno-fehlercodes-zwilling.test.js`
- Modify: `functions/test/unit/invoice-api-vertrag.test.js:20-41`, `:55-71`
- Modify: `functions/package.json` (`"@kreiseck/kasseneck-api": "file:vendor/kreiseck-kasseneck-api-0.32.0.tgz"`), `functions/package-lock.json`
- Create: `functions/vendor/kreiseck-kasseneck-api-0.32.0.tgz`; Delete: `functions/vendor/kreiseck-kasseneck-api-0.31.0.tgz`
- Modify: `docs/specs/2026-10-02-lager-kern-design.md` (Übergabe 2b erledigt)

- [ ] **Schritt 1: Ausnahmen entfernen (rot gegen 0.31.0 – Beleg, dass die Tests greifen)**

`functions/test/unit/storno-fehlercodes-zwilling.test.js` vollständig:

```js
'use strict';

// Zwilling am Vertrag: die Storno-Fehlercodes des Backends (storno-core
// STORNO_FEHLERCODES) und des Pakets (@kreiseck/kasseneck-api
// CANCELLATION_ERROR_CODES) muessen dieselbe Liste sein -- die Kasse
// entscheidet am Code. Verglichen wird gegen das VENDORIERTE Paket
// (package.json: file:vendor/...tgz), nicht gegen eine Kopie: fehlt dem
// vendorierten Stand der Export, ist das ein Befund (Paket veroeffentlichen
// und vendoren), kein Grund zum Ueberspringen.
const paket = require('@kreiseck/kasseneck-api');
const { STORNO_FEHLERCODES } = require('../../gemeinsam/storno-core');

describe('Storno-Fehlercodes: Backend und Paket fuehren dieselbe Liste', () => {
  test('das vendorierte Paket kennt CANCELLATION_ERROR_CODES (sonst: Paket >= 0.6.49 vendoren)', () => {
    expect(Array.isArray(paket.CANCELLATION_ERROR_CODES)).toBe(true);
  });

  test('gleiche Codes in gleicher Reihenfolge', () => {
    expect([...(paket.CANCELLATION_ERROR_CODES || [])]).toEqual([...STORNO_FEHLERCODES]);
  });

  test('der Waechter des Pakets nimmt jeden Backend-Code an und lehnt den Anzeigetext ab', () => {
    for (const code of STORNO_FEHLERCODES) expect(paket.isCancellationErrorCode(code)).toBe(true);
    expect(paket.isCancellationErrorCode('Beleg ist bereits vollständig storniert.')).toBe(false);
  });
});
```

`functions/test/unit/invoice-api-vertrag.test.js`: den Block von „// Benannte Ausnahme (Lager-Kern Stufe 2)“
bis einschließlich `function ohneNeue(…) { … }` (Zeilen 20–41) löschen; den Test

```js
  test.each(Object.keys(schema.aufrufe))('%s: Anfrage-Schema identisch', (aufruf) => {
    expect(core.alsSchema(aufruf)).toEqual(schema.aufrufe[aufruf].anfrage);
  });
```

statt der Fassung „(ohne die benannte Ausnahme)“, und den Test „die benannten Lagerfelder fehlen dem
vendorierten Paket noch (sonst Ausnahme loeschen)“ ganz löschen.

Run: `cd functions && npx jest test/unit/storno-fehlercodes-zwilling.test.js test/unit/invoice-api-vertrag.test.js`
Expected: FAIL gegen 0.31.0 (`rueckgabe_ungueltig` fehlt; `stockLocationId`, `articleId`,
`returnDisposition` fehlen im Schema).

- [ ] **Schritt 2: 0.32.0 aus der Registry vendoren**

```bash
cd functions
npm pack @kreiseck/kasseneck-api@0.32.0 --pack-destination vendor
git rm vendor/kreiseck-kasseneck-api-0.31.0.tgz
npm install --save ./vendor/kreiseck-kasseneck-api-0.32.0.tgz
grep -n '"@kreiseck/kasseneck-api"' package.json   # "file:vendor/kreiseck-kasseneck-api-0.32.0.tgz"
```

(`functions-kasse` bleibt bei seinen Anheftungen; 0.32.0 ändert nichts, was dort geprüft wird.)

- [ ] **Schritt 3: grün, Export und Stand prüfen**

```bash
npx jest test/unit/storno-fehlercodes-zwilling.test.js test/unit/invoice-api-vertrag.test.js
npm test
cd .. && node scripts/vertrag-stand.mjs
```

Expected: PASS; `vertrag-stand` meldet keinen Rückstand. Meldet `npm test` den Vertrags-Export als
veraltet (`_quelle.backendPackage` nennt die vendorierte Version), nach `functions/vertrag/v3/README.md`
neu erzeugen und mit einchecken:

```bash
cd functions-kasse && npm run vertrag:v3 && cd ../functions && npm run vertrag:v3 && npm test
```

Danach die übrigen zutreffenden CI-Ziele lokal (mindestens `cd ../functions-kasse && npm test`).

- [ ] **Schritt 4: Spec nachführen** – in `docs/specs/2026-10-02-lager-kern-design.md`, „Übergaben (offen)“,
  den Punkt 2b ersetzen durch:

```markdown
  - 2b erledigt: npm `@kreiseck/kasseneck-api` 1.2.0 (Kassen-Aufrufe, `returnDisposition`, Rechnungsfelder)
    und 0.32.0 (`rueckgabe_ungueltig`, Rechnungsfelder) – vendort, die benannten Ausnahmen in den
    Zwillingstests `storno` und `invoice-api-vertrag` sind entfernt.
```

- [ ] **Schritt 5: Commit** (keck-Stil, ohne Trailer)

```bash
git add functions/package.json functions/package-lock.json functions/vendor/ functions/test/unit/storno-fehlercodes-zwilling.test.js functions/test/unit/invoice-api-vertrag.test.js docs/specs/2026-10-02-lager-kern-design.md
git add functions/vertrag functions-kasse/test/unit/fixtures 2>/dev/null || true   # nur falls Schritt 3 den Export neu erzeugt hat
git commit -m "chore: @kreiseck/kasseneck-api 0.32.0 vendort, benannte Lager-Ausnahmen entfernt"
```

PR nach den Regeln des Backend-Repos (CI fährt die Ziele, `main` deployt per CI). Den Worktree nach dem
Merge entfernen (`git -C /Users/mali/kasseneck worktree remove /Users/mali/kasseneck-wt-npm-032`). Ändert sich
dabei `functions/vertrag/v3`, holt das Paket den Stand beim nächsten Vertragsnachzug (nur `_quelle`).

---

## Self-Review

- **Spec-Abdeckung (Übergabe 2b):** Kassen-Aufrufe → Task 2; `stockLocationIds`/`stockLocationId` an
  Artikel, Kasse, Gerät → Task 3; `cancelReceipt` mit `returnDisposition` (Aufruf und Position) samt
  Prüfung vor dem Senden → Task 4; Fehlercode `invalid_return_disposition` (1.x) → Task 1,
  `rueckgabe_ungueltig` (0.x) → Task 9; Rechnungsfelder 1.x → Task 5, 0.x → Task 9; Vertrags-Fixtures →
  Vorbedingungen + Task 1 + Task 8 Schritt 2; 1.2.0/0.32.0 → Task 8/10; Backend-Ausnahmen → Task 11.
  `listMyStock` `values[]` nur mit Kostenrecht → Task 2. Storno-Zeilen `originalIndex`/`returnDisposition`
  → Task 4 (lesen) und Task 6 (`./stored`).
- **Platzhalter:** keine; die einzige bedingte Anweisung (mehr als 60 öffentliche Endpunkte) nennt die
  Quelle (`endpoints.public`) und die Regel.
- **Typen:** `ReturnDisposition`/`RETURN_DISPOSITIONS` aus `src/models/cancellation.ts` in Task 4, 5, 6;
  `StockLocation`, `StockList`, `SetMyCashregisterStockLocationOptions` nur in Task 2 definiert und in Task 7
  dokumentiert; 0.x-Namen (`GUTSCHRIFT_POSITION_FELDER`, `Feld`, `typ/pflicht/werte`) nur in Task 9.
- **Review Focus:** alle fünf Zeilen haben Tests (Task 2: drei; Task 4; Task 6).
