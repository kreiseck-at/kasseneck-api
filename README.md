# @kreiseck/kasseneck-api

JavaScript-/TypeScript-Client für das Kasseneck-Backend — der Zwilling des
Flutter-Pakets `kasseneck_api`. Er spricht dieselben Endpunkte, führt dieselben
Modelle und dieselben Enum-Werte; ein eingecheckter Abzug der Dart-Enums wird
im Test gegengeprüft, damit die beiden Pakete nicht auseinanderdriften.

Das Paket deckt ab: Belege ausstellen und stornieren, Belege und Kassen
auflisten, Berichte herunterladen, Status bei FinanzOnline abfragen,
Stripe-Zahllinks und Hobex-Cloud-Zahlungen, das Beleg-Layout und die
ESC/POS-Erzeugung für den Bondrucker.

**Es läuft im Browser und in Node.** ESM ist das Hauptformat, CommonJS liegt
daneben; beides mit eigenen Typdeklarationen. Node ab 20.18 (`fetch` muss
vorhanden sein). Es gibt keine Laufzeitabhängigkeiten.

## Installation

```bash
npm install @kreiseck/kasseneck-api
```

React ist eine optionale Peer-Abhängigkeit und nur für den Unterpfad `./react`
nötig.

## Die zwei Anmeldewege

Der Client nimmt eine **austauschbare Anmeldung** entgegen — ein Objekt, das
pro Anfrage die Kopfzeilen liefert. Es gibt zwei, und keiner ist der
bevorzugte:

| Weg | Wer | Wie |
|-----|-----|-----|
| `apiKeyAuth` | Geräte, POS-Apps, Dritte | `api_key` als Bearer + `cashregister-token`-Kopfzeile |
| `registerUserAuth` | Browser-Kasse | Firebase-ID-Token als Bearer + `register-session`-Kopfzeile, Kasse als Parameter |

```ts
import { apiKeyAuth, registerUserAuth } from '@kreiseck/kasseneck-api';

// Gerät/POS: der api_key gehört auf ein Gerät, nie in einen Browser.
const geraet = apiKeyAuth({ apiKey: 'kr_live_…', cashregisterToken: 'cb_live_…' });

// Browser-Kasse: das Paket kennt Firebase nicht — es bekommt Funktionen, die
// ein gültiges Token bzw. die laufende Sitzung liefern. Beide werden bei JEDEM
// Aufruf befragt (ID-Tokens laufen nach einer Stunde ab, die Kassen-Sitzung
// nach 90 Sekunden).
const kasse = registerUserAuth({
  getIdToken: () => auth.currentUser!.getIdToken(),
  getSessionId: () => sitzungHalter.aktuelleId(),
  cashregisterId: 'kasse-1',
});
```

### Und ein dritter Fall: gar keine Anmeldung

Drei Endpunkte laufen **ohne jede Identität** — sie sind der Weg, auf dem eine
Identität überhaupt erst entsteht: ein Gerät koppeln, seine Kassen-Benutzer
auflisten, einen davon per PIN anmelden. Sie stehen unter `…/register` und
nehmen deshalb **keine Anmeldung** entgegen, sondern nur die Verbindungsangaben:

```ts
import { pairRegisterDevice, registerUserLogin } from '@kreiseck/kasseneck-api/register';

const geraet = await pairRegisterDevice({ code: 'K7NPQR34', label: 'Schank' });
const sitzung = await registerUserLogin({ ...geraet, userId: 'ru-1', pin: '1234' });
```

Mit `sitzung.customToken` meldet sich der Verbraucher bei Firebase an; das
daraus entstehende ID-Token und `sitzung.sessionId` ergeben `registerUserAuth`.

Eine anmeldungsfreie Anmeldung gibt es dafür **nicht** — sie wäre ein
Schlupfloch, mit dem sich jeder andere Aufruf des Pakets ohne Anmeldung bauen
ließe. Die drei bringen ihren Transport selbst mit.

**Welcher Weg für welchen Endpunkt gilt, entscheidet das Backend, nicht dieses
Paket.** Die Endpunkt-Module nennen im Kommentar jeweils, was dort gilt. Zwei
Fälle, die regelmäßig überraschen:

- `listMyCashregisters` und `listMyReceipts` laufen über den Kunden-Pfad und
  brauchen ein **ID-Token** — mit `apiKeyAuth` sind sie nicht erreichbar.
- `getFirstReceiptDate` und die beiden Bericht-Downloads stehen dem
  Kassen-Benutzer **nicht** offen; sie brauchen `apiKeyAuth`.

## Beträge sind ganze Cent

Geld wird in diesem Paket ausnahmslos als **ganzzahliger Cent-Betrag**
gerechnet — `priceCents`, `valueCents`, `totalCents`, `amountCents`. Es gibt
keine Euro-Fließkommazahlen in der Oberfläche. Wo das Backend Euro liefert
(z. B. `total` in der Belegliste) oder erwartet (Hobex), wird genau an dieser
Grenze einmal umgerechnet.

Der Grund ist nicht Ordnungsliebe: Netto, Umsatzsteuer und Brutto einer
Belegzeile müssen sich exakt aufheben, und ein Storno muss seinen Beleg auf den
Cent spiegeln. Mit Fließkomma geht das in etwa jedem hundertsten Betrag schief.

Aus demselben Grund ist `quantity` eine **ganze** Menge. Eine gebrochene wird
abgelehnt, bevor etwas gesendet wird.

## Schnellstart: Beleg verkaufen und drucken

```ts
import {
  createKasseneckApi,
  apiKeyAuth,
  KeckPaymentMethod,
  VatRate,
} from '@kreiseck/kasseneck-api';
import { buildReceiptLayout, escPosLayoutBytes } from '@kreiseck/kasseneck-api/receipt';

const api = createKasseneckApi({
  auth: apiKeyAuth({ apiKey: 'kr_live_…', cashregisterToken: 'cb_live_…' }),
});

// Verkaufen — und in einem Aufruf die Firmendaten für den Belegkopf mitnehmen.
const { receipt, company } = await api.sellReceiptWithCompany({
  paymentMethod: KeckPaymentMethod.cash,
  items: [
    { name: 'Café Latte', quantity: 2, vat: VatRate.vat20, priceCents: 390 },
    { name: 'Marmeladeweckerl', quantity: 1, vat: VatRate.vat10, priceCents: 250 },
  ],
});

// Layout bauen (reines Datenmodell: Zeilen, Ausrichtung, Spalten, QR-Code) …
// Layout-Regelwerk: gespeicherte Belege tragen ihre Version (`layoutRegeln`);
// ohne Angabe gilt das aktuelle (2: Nullbelege mit Block „Prüfangaben“ —
// die Registrierdaten dafür liefert `getReceiptWithCompany` als `pruefangaben`).
const layout = buildReceiptLayout(receipt, company, { paperSize: 'mm58' });

// … und daraus die Bytes für den Bondrucker. Der Transport zum Drucker ist
// bewusst nicht Teil dieses Pakets.
const bytes = escPosLayoutBytes(layout);
```

Ein Misserfolg kommt immer als **geworfener Fehler**, nie als Rückgabewert;
niemand muss selbst auf ein `status`-Feld prüfen. Es gibt fünf Fehlerarten mit
je einem Wächter (`isKasseneckApiError` und Geschwister): fachlicher Fehler,
HTTP-/Formfehler, Netz-/Zeitfehler, Anmeldefehler, Formfehler der Ein- oder
Ausgabe. **In keinem davon steht je ein Geheimnis** — weder Schlüssel noch
Token, weder gesendete noch empfangene Rümpfe.

## Storno: voll oder in Teilen

```ts
const ergebnis = await api.cancelReceipt({
  receipt: beleg,                       // oder: cashregisterId + originalReceiptId
  reason: 'fehleingabe',                // Katalog: CANCELLATION_REASONS
  items: [{ index: 0, quantity: 1 }],   // weglassen = Vollstorno der Restmengen
  note: 'Kunde wollte nur eine',        // intern, wird nie gedruckt
});
ergebnis.receipt;         // der signierte Storno-Beleg (receiptType cancellation)
ergebnis.cancellationOf;  // Bezug auf das Original
ergebnis.remaining;       // Restmengen des Originals danach
```

Der Server negiert die Positionen, prüft Restmengen und Rechte („nur eigene
Belege" oder „alle") und verkettet Original und Storno. Ein Storno-Beleg lässt
sich nicht stornieren, ein voll stornierter Beleg nicht noch einmal. Am
gelesenen Original liefert `remainingQuantities(receipt)` die Reste vorab (für
den Storno-Dialog); die Wahrheit hat der Server.

## Unterpfade

| Unterpfad | Inhalt |
|-----------|--------|
| `@kreiseck/kasseneck-api` | Endpunkte, Anmeldung, Transport, Modelle, Enums, Fehler — alles, was mit dem Backend spricht. |
| `…/receipt` | Beleg-Layout als Datenmodell (framework-frei) und die Brücke zu ESC/POS. |
| `…/printing` | ESC/POS-Erzeugung: Bytefolgen für Bondrucker, ohne jeden Transport. |
| `…/payments` | Stripe-Zahllinks und Hobex-Cloud (beides HTTP-Endpunkte des Backends). |
| `…/register` | Anmeldung der Browser-Kasse: Gerät koppeln und entkoppeln, Benutzer auflisten, per PIN anmelden, Sitzung erneuern und beenden. |
| `…/kasse` | Kachel-Kasse: Kassen-Einstellungen (betriebsweit / je Gerät), Artikelgruppen und Artikel für Kacheln, Rabattverteilung je Steuersatz, Reichweiten der Kassen-Rechte |
| `…/react` | Dünner React-Adapter, der ein Beleg-Layout zeichnet. Braucht React. |
| `…/fixtures/*` | Golden-Belege (JSON): Eingaben `belege/<name>.json`, zugesagte Zeilenausgabe `erwartet/<name>.lines.json`, `manifest.json` mit Prüfsummen — dieselben Dateien prüfen Backend, Browser-Kasse und Flutter-Paket. |

So zieht sich niemand den React-Adapter in ein Node-Programm.

## Was hier grundsätzlich nicht dazugehört

**Hobex HPS, myPOS und SumUp sind nicht Teil dieses Pakets und werden es auch
nicht.** Hobex HPS spricht lokal über TCP mit dem Terminal, myPOS und SumUp
sind Android-SDKs. Ein Browser kann das nicht, und kein Bündler ändert daran
etwas. Wer diese Terminals braucht, nimmt das Flutter-Paket `kasseneck_api`.

Ebenfalls nicht enthalten: die Druckeransteuerung selbst (dieses Paket erzeugt
die Bytes, es verschickt sie nicht), Firmenlogos und Rasterbilder, und die
PDF-Erzeugung.

## Entwicklung

```bash
npm test              # Testsuite in drei Zeitzonen (Wien, UTC, Kiritimati)
npm run build         # ESM- und CJS-Bau nach dist/, inkl. Prüfung der exports
npm run check:consumer # baut den Tarball und übersetzt zwei Verbraucher (CJS/ESM)
```

Die drei Zeitzonen sind kein Übereifer: Zeitfehler sind auf einer Wiener
Maschine zufällig richtig. Belegzeiten werden konsequent als **Wiener
Wanduhrzeit** gedeutet (`parseServerTimeStamp`), nie über `new Date(text)`.

## Lizenz

Apache-2.0 — siehe `LICENSE` und `NOTICE`.
