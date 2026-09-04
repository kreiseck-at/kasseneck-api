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
import { buildReceiptLayout, renderReceiptGrid, escPosLayoutBytes } from '@kreiseck/kasseneck-api/receipt';

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
  // Trinkgeld in Cent (optional): das Backend bucht daraus eine signierte
  // Position „Trinkgeld“ — Mitarbeiter 0 % als Durchläufer, Inhaber als Umsatz.
  // Als Objekt mit eigener Zahlart/Empfängern: { cents, paymentMethod, recipients }.
  tip: 100,
});

// Layout bauen (reines Datenmodell: Zeilen, Ausrichtung, Spalten, QR-Code) …
// Layout-Regelwerk: gespeicherte Belege tragen ihre Version (`layoutRegeln`);
// ohne Angabe gilt das aktuelle (2: Nullbelege mit Block „Prüfangaben“ —
// die Registrierdaten dafür liefert `getReceiptWithCompany` als `pruefangaben`).
const layout = buildReceiptLayout(receipt, company, { paperSize: 'mm58' });

// … das Zeichenraster (exakt 32/48 Zeichen je Zeile — die eine Wahrheit für
// Bildschirm, Bondruck und PDF: Spalten in ganzen Zeichen, rechte Spalte bündig,
// wortweiser Umbruch) …
const grid = renderReceiptGrid(layout);          // grid.lines[i].text, .bold, .kind, .qr

// … und daraus die Bytes für den Bondrucker (druckt genau die Rasterzeilen).
// Der Transport zum Drucker ist bewusst nicht Teil dieses Pakets.
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

**Fehler entscheidet man am Code, nicht am Text.** Jeder fachliche Fehler von
`cancelReceipt` trägt `KasseneckApiError.code` aus `CANCELLATION_ERROR_CODES`
(z. B. `bereits_storniert`, `menge_ueber_rest`, `nur_eigene_belege`). Die
deutsche Meldung (`serverMessage`) ist Anzeige und darf sich ändern.

```ts
import { isKasseneckApiError, isCancellationErrorCode } from '@kreiseck/kasseneck-api';

try {
  await api.cancelReceipt({ receipt: beleg, reason: 'fehleingabe' });
} catch (fehler) {
  if (isKasseneckApiError(fehler) && isCancellationErrorCode(fehler.code)) {
    switch (fehler.code) {
      case 'bereits_storniert':  // Beleg im Dialog als „storniert" zeigen, Knopf sperren
      case 'menge_ueber_rest':   // Restmengen neu laden (jemand war schneller)
      case 'nur_eigene_belege':  // Chef holen
        break;
    }
  }
  throw fehler;
}
```

**Gutscheine.** Ein Wertgutschein wird nur beim Vollstorno (ohne `items`)
gespiegelt — er ist unteilbar. Ein Rabattgutschein ist am Original bereits in
den Umsatz eingerechnet; **jeder** Storno nimmt ihn anteilig der stornierten
Menge zurück: bei 3 Stück à 10 € mit 6 € Rabatt sind 8 € je Stück Entgelt, der
Storno-Beleg trägt dann „−10,00" plus eine Zeile „Gutschein-Ausgleich +2,00".
Was ein Storno gewährt hat, steht am Eintrag in `receipt.cancellations[]` als
`promoAdjustmentCents` (Cent je Steuertopf) — die Kasse kann es im Dialog
zeigen, rechnen muss sie nichts.

**Bon.** Der Kopfblock des Storno-Bons nennt Bezug, Datum des Originals und
Grund: „STORNOBELEG / Stornobuchung zu Beleg KASSE1-ID-42 / vom 11.08.2026,
09:02 Uhr / Grund: Fehleingabe". Das Datum kommt aus `cancellationOf.timeStamp`
(Backend seit 2026-09-04); Altbelege ohne bleiben ohne die Zeile.

## Unterpfade

| Unterpfad | Inhalt |
|-----------|--------|
| `@kreiseck/kasseneck-api` | Endpunkte, Anmeldung, Transport, Modelle, Enums, Fehler — alles, was mit dem Backend spricht. |
| `…/receipt` | Beleg-Layout als Datenmodell (framework-frei) und die Brücke zu ESC/POS. |
| `…/printing` | ESC/POS-Erzeugung: Bytefolgen für Bondrucker, ohne jeden Transport. |
| `…/payments` | Stripe-Zahllinks, Hobex-Cloud (beides HTTP-Endpunkte des Backends) und Hobex **HPS** über **Kasseneck Connect** (lokaler Geräte-Agent, spricht mit dem Terminal). |
| `…/register` | Anmeldung der Browser-Kasse: Gerät koppeln und entkoppeln, Benutzer auflisten, per PIN anmelden, Sitzung erneuern und beenden. |
| `…/kasse` | Kachel-Kasse: Kassen-Einstellungen (betriebsweit / je Gerät), Artikelgruppen und Artikel für Kacheln, Rabattverteilung je Steuersatz, Reichweiten der Kassen-Rechte |
| `…/react` | Dünner React-Adapter, der ein Beleg-Layout zeichnet. Braucht React. |
| `…/fixtures/*` | Golden-Belege (JSON): Eingaben `belege/<name>.json`, zugesagte Zeilenausgabe `erwartet/<name>.lines.json`, `manifest.json` mit Prüfsummen — dieselben Dateien prüfen Backend, Browser-Kasse und Flutter-Paket. |

So zieht sich niemand den React-Adapter in ein Node-Programm.

## Hobex HPS über Kasseneck Connect

Ein Browser hat weiterhin keine rohen TCP-Sockets — ein **direkter**
Terminal-Kontakt wie beim Flutter-Paket `kasseneck_api` (`HpsClient`) bleibt
deshalb außerhalb der Reichweite dieses Pakets. **Kasseneck Connect** ist aber
ein lokaler Geräte-Agent mit gewöhnlicher HTTP-Schnittstelle, der für die Kasse
mit dem Terminal spricht — und darüber geht es:

```ts
import { createHpsConnectClient, createHpsPayments } from '@kreiseck/kasseneck-api/payments';

const client = createHpsConnectClient({ token: kopplungsToken });
const zahlweg = createHpsPayments(client, { host: '192.168.1.50', tid: '3600335' });

const ergebnis = await zahlweg.pay({ amountCents: 1050 });
// ergebnis.outcome: 'approved' | 'declined' | 'unresolved' — nie geraten.
// ergebnis.transactionId ist IMMER gesetzt, auch bei 'unresolved'.
```

Der Ausgang ist immer einer von drei: `approved`, `declined` (beweisbar nichts
belastet) oder `unresolved` (Ausgang unbekannt, eine Wiederholung könnte ein
zweites Mal belasten). Was das bedeutet und warum es so gebaut ist, steht in
`src/payments/hobex-hps/payments.ts` — dort ist die Dokumentation der Maßstab,
nicht dieses README.

**Nur `pay` — bewusst kein `refund`/`cancel`.** Kasseneck Connect exponiert
dafür (noch) keinen Endpunkt; eine Gutschrift oder ein Storno am HPS-Terminal
braucht weiterhin die Flutter-App. **myPOS** und **SumUp** bleiben
Android-SDKs ohne Entsprechung hier.

## Was hier grundsätzlich nicht dazugehört

Die Druckeransteuerung selbst (dieses Paket erzeugt die Bytes, es verschickt
sie nicht), Firmenlogos und Rasterbilder, und die PDF-Erzeugung.

## Entwicklung

```bash
npm test              # Testsuite in drei Zeitzonen (Wien, UTC, Kiritimati)
npm run build         # ESM- und CJS-Bau nach dist/, inkl. Prüfung der exports
npm run check:consumer # baut den Tarball und übersetzt zwei Verbraucher (CJS/ESM)
npm run check:erreichbar # fragt die öffentliche Adresse: antwortet dort zu jedem Aufruf eine Function?
```

Die drei Zeitzonen sind kein Übereifer: Zeitfehler sind auf einer Wiener
Maschine zufällig richtig. Belegzeiten werden konsequent als **Wiener
Wanduhrzeit** gedeutet (`parseServerTimeStamp`), nie über `new Date(text)`.

### `check:erreichbar` — spricht als einzige mit `api.kasseneck.at`

Testsuite und `check:consumer` laufen gegen Attrappen bzw. gegen den Tarball;
keine von beiden setzt je einen Aufruf ab. Fehlt einem Aufruf die
Hosting-Weiterleitung, liefert die veröffentlichte Adresse die
HTML-Auffangseite statt der Function — und das sieht keine Attrappe.

Die Prüfung braucht **keine Zugangsdaten**. Ein Aufruf ohne Anmeldung
antwortet, wenn dort eine Function steht, mit
`{"status":"error","message":"Ungültiger Request: Authorization key erwartet."}`.
Genau das ist der Beweis: Der Aufruf wurde angenommen und die Anmeldung
geprüft. Eine HTML-Seite oder ein 404 ist der Beweis, dass dort keine Function
steht. Deshalb prüft das Skript auf ein `status`-Feld und nicht auf Erfolg.

Bewusst außerhalb von `npm test`: Sie braucht Netz. Ist keines da, sagt sie es
und endet mit 0. Aufrufe, die unter `/v1` absichtlich keine Weiterleitung
haben — der Kassen-Weg über `kasse.kasseneck.at/api`, die Aufrufe mit
Firebase-ID-Token — stehen mit Grund in `scripts/erreichbarkeit-ausnahmen.json`.
Wird eine Ausnahme erreichbar, schlägt die Prüfung an: Sonst sänke die Zahl nie.

## Vertragsdateien für die Zwillinge

Dieses Paket ist die Quelle für das Dart-Paket `kasseneck_api` und den
Backend-Validator `kasse-settings-core.js`. Drei Dateien in `fixtures/` reisen
im Tarball mit und sagen in Maschinenform, worauf sich beide Seiten geeinigt haben:

| Datei | Inhalt |
|---|---|
| `kasse-settings-standard.json` | Feldnamen und Standardwerte der Kassen-Einstellungen |
| `oberflaeche.json` | Aufrufnamen, Enum-Werte, Rechte-Schlüssel, Tasten-Aktionen |
| `hobex-hps-codes.json` | Gemessene HPS-Ergebniscodes, ihre Bedeutung und ob sie einen Ausgang festschreiben — der Vertrag hinter `.../payments/hobex-hps`s `isConclusive`. |

Alle drei werden erzeugt (`npm run fixtures:kasse`, `npm run fixtures:oberflaeche`,
`npm run fixtures:hobex-hps-codes`) und nie von Hand geändert; die CI prüft
nach jedem Lauf, dass sie zum Code passen.

`oberflaeche.json` und `hobex-hps-codes.json` tragen die Paketversion. **Nach
jedem `npm version` müssen deshalb alle drei Dateien neu erzeugt und
mitcommittet werden**, sonst wird die CI rot.

## Lizenz

Apache-2.0 — siehe `LICENSE` und `NOTICE`.
