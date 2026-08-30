# @kreiseck/kasseneck-api

JavaScript-/TypeScript-Client für das Kasseneck-Backend — der Zwilling des
Flutter-Pakets `kasseneck_api`. Er spricht dieselben Endpunkte, führt dieselben
Modelle und dieselben Enum-Werte; ein eingecheckter Abzug der Dart-Enums wird
im Test gegengeprüft, damit die beiden Pakete nicht auseinanderdriften.

Das Paket deckt ab: Belege ausstellen und stornieren, Belege und Kassen
auflisten, Berichte herunterladen, Status bei FinanzOnline abfragen,
Stripe-Zahllinks und Hobex-Cloud-Zahlungen, das Beleg-Layout und die
ESC/POS-Erzeugung für den Bondrucker — und unter `./partner` die
**Partner-API**: Betriebe anlegen und bis zur laufenden Kasse begleiten.

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

## Partner-API (`./partner`)

Für Softwarehäuser, die Kasseneck in ihr eigenes Produkt einbauen: Betriebe
anlegen, bis zur laufenden Kasse begleiten und danach in ihrem Namen Belege
signieren.

**Was die Endpunkte tun, steht in der Referenz** —
`docs/api/partner.md` (ausführlich) und `docs/api/partner.llms.txt` (kompakt,
für Werkzeuge und Sprachmodelle). Dieses README wiederholt sie nicht; hier
steht, wie man den Client benutzt.

Der Partner-Schlüssel (`pk_live_…`) gehört auf einen **Server**. Er kann
Betriebe anlegen und — mit dem Zusatz-Scope `credentials:read` — deren
Geheimnisse holen.

```ts
import { createPartnerApi, istPartnerFehler } from '@kreiseck/kasseneck-api/partner';

const partner = createPartnerApi({
  partnerKey: process.env.KASSENECK_PARTNER_KEY!,
  // Welcher der drei Vertragswege für dieses Konto gilt, setzt Kasseneck;
  // die API gibt ihn nicht aus. Er steuert nur die Formulierung der Hinweise.
  avvModus: 'vollmacht',
});

const { customerId } = await partner.createPartnerCustomer({
  appId: 'app_…',
  idempotencyKey: kundennummer,   // die eigene — schützt vor Doppelanlage
  betrieb: { /* Stammdaten, siehe Referenz */ } as never,
});

await partner.sendPartnerCustomerFonLink(customerId);
// … auf das Ereignis customer.fon_verified warten …
await partner.requestCustomerSignature(customerId);
// … auf signature.ready warten …
await partner.createCustomerCashregister({ customerId });  // automatisch:true ist Vorgabe
```

Die Reihenfolge ist hart, und jeder Schritt beschwert sich mit einem eigenen
Code, wenn ein vorheriger fehlt. Sie steht als Daten im Paket
(`PARTNER_ABLAUF`), und zu jedem Code gibt es einen Handlungssatz:

```ts
try {
  await partner.activateCashregister(customerId, cashregisterId);
} catch (fehler) {
  if (istPartnerFehler(fehler, 'vertrag_offen')) {
    // Ohne bestätigten Auftragsverarbeitungsvertrag geht KEINE neue Kasse live.
    // Der Satz nennt den Weg, der für dieses Partner-Konto gilt.
    console.error(partner.vertragOffenRat());
  }
}
```

### Zugangsdaten sind Geheimnisse eines Dritten

`getCustomerCredentials` liefert den `api_key` des Betriebs und die Token
seiner Kassen. Wer sie hat, kann in seinem Namen Belege signieren — und ein
Beleg ist nach RKSV nicht zurücknehmbar. Sie kommen deshalb **nicht als
`string`**, sondern in einer Hülle, die sich nicht versehentlich ausgeben
lässt:

```ts
const zugang = await partner.getCustomerCredentials(customerId);

console.log(zugang);                     // [apiKey «verborgen»] — kein Klartext
JSON.stringify(zugang);                  // ebenso
`${zugang.apiKey}`;                      // ebenso

speichereVerschluesselt(zugang.apiKey.reveal());   // der einzige Weg heraus
```

Nur verschlüsselt speichern, nie protokollieren, nie in eine Mail oder einen
Fehlerbericht. Jeder Abruf wird mitgeschrieben und ist für den Betrieb
sichtbar.

### Eingehende Webhooks prüfen

Das ist die Stelle, an der Integrationen am häufigsten scheitern — deshalb
liegt sie fertig im Paket. Vier Dinge müssen stimmen: der **rohe** Rumpf, das
Zeitfenster gegen Wiedereinspielung, ein zeitkonstanter Vergleich, und jede
Ausnahme als Ablehnung.

```ts
import express from 'express';
import { parseWebhookEvent } from '@kreiseck/kasseneck-api/partner';

const app = express();

// express.raw VOR jedem JSON-Parser: signiert sind die Bytes, die ankommen.
app.post('/kasseneck-webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const ergebnis = await parseWebhookEvent({
    secret: process.env.KASSENECK_WEBHOOK_SECRET!,
    signatureHeader: req.header('X-Kasseneck-Signature'),
    body: req.body,           // Buffer — nicht req.body nach JSON.parse
  });
  if (!ergebnis.ok) return res.status(400).send(ergebnis.reason);

  // Innerhalb von 10 s antworten, Arbeit danach. Zustellungen können sich
  // wiederholen: auf event.id entdoppeln.
  res.sendStatus(200);
  await verarbeite(ergebnis.event);
});
```

## Unterpfade

| Unterpfad | Inhalt |
|-----------|--------|
| `@kreiseck/kasseneck-api` | Endpunkte, Anmeldung, Transport, Modelle, Enums, Fehler — alles, was mit dem Backend spricht. |
| `…/receipt` | Beleg-Layout als Datenmodell (framework-frei) und die Brücke zu ESC/POS. |
| `…/printing` | ESC/POS-Erzeugung: Bytefolgen für Bondrucker, ohne jeden Transport. |
| `…/payments` | Stripe-Zahllinks und Hobex-Cloud (beides HTTP-Endpunkte des Backends). |
| `…/register` | Anmeldung der Browser-Kasse: Gerät koppeln und entkoppeln, Benutzer auflisten, per PIN anmelden, Sitzung erneuern und beenden. |
| `…/kasse` | Kachel-Kasse: Kassen-Einstellungen (betriebsweit / je Gerät), Artikelgruppen und Artikel für Kacheln, Rabattverteilung je Steuersatz, Reichweiten der Kassen-Rechte |
| `…/partner` | Partner-API: Betriebe anlegen, FinanzOnline-Link, Auftragsverarbeitungsvertrag, Signatur, Kassen, Zugangsdaten, Webhooks samt Signaturprüfung. **Gehört auf einen Server.** |
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
Backend-Validator `kasse-settings-core.js`. Zwei Dateien in `fixtures/` reisen
im Tarball mit und sagen in Maschinenform, worauf sich alle drei geeinigt haben:

| Datei | Inhalt |
|---|---|
| `kasse-settings-standard.json` | Feldnamen und Standardwerte der Kassen-Einstellungen |
| `oberflaeche.json` | Aufrufnamen, Enum-Werte, Rechte-Schlüssel, Tasten-Aktionen |

Beide werden erzeugt (`npm run fixtures:kasse`, `npm run fixtures:oberflaeche`)
und nie von Hand geändert; die CI prüft nach jedem Lauf, dass sie zum Code passen.

`oberflaeche.json` trägt die Paketversion. **Nach jedem `npm version` müssen deshalb beide
Dateien neu erzeugt und mitcommittet werden**, sonst wird die CI rot.

## Lizenz

Apache-2.0 — siehe `LICENSE` und `NOTICE`.
