<p align="center">
  <img src="https://raw.githubusercontent.com/kreiseck-at/kasseneck-api/main/doc/kasseneck.gif" alt="Kasseneck — RKSV-Registrierkasse aus Österreich" width="420">
</p>

<h1 align="center">@kreiseck/kasseneck-api</h1>

<p align="center">
  <b>Austrian fiscal cash register (RKSV) for JavaScript and TypeScript — signed receipts, card payments, receipt printing.</b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kreiseck/kasseneck-api"><img src="https://img.shields.io/npm/v/%40kreiseck%2Fkasseneck-api?color=136B6B&label=npm" alt="npm"></a>
  <img src="https://img.shields.io/badge/RKSV-%C2%A7%20131b%20BAO-136B6B" alt="RKSV">
  <img src="https://img.shields.io/badge/Lizenz-Apache--2.0-136B6B" alt="Apache-2.0">
  <a href="https://kasseneck.at"><img src="https://img.shields.io/badge/Kasseneck-kasseneck.at-132A2A" alt="kasseneck.at"></a>
  <a href="https://kreiseck.com"><img src="https://img.shields.io/badge/von-Kreiseck-132A2A" alt="Kreiseck Software Solutions"></a>
</p>

**Kasseneck** ist eine österreichische Registrierkasse nach RKSV. Dieses Paket ist
der JavaScript-/TypeScript-Client dafür: Ihr Code stellt Belege aus, storniert sie,
nimmt Kartenzahlungen entgegen und druckt Bons. Es ist der Zwilling des
Flutter-Pakets [`kasseneck_api`](https://pub.dev/packages/kasseneck_api):
dieselben Endpunkte, dieselben Modelle, dieselben Enum-Werte, im Test
gegeneinander geprüft.

## Was eine Registrierkasse in Österreich können muss

Die Registrierkassen- und Belegerteilungspflicht steht in § 131b der
Bundesabgabenordnung, die technischen Anforderungen an die Sicherheitseinrichtung
in der Registrierkassensicherheitsverordnung (RKSV). Daraus ergibt sich eine
ganze Kette von Aufgaben — die Tabelle zeigt, welche davon **diese Software**
übernimmt und welche beim Betrieb selbst bleiben:

| Aufgabe | Wo sie erledigt wird |
| --- | --- |
| [Signaturerstellungseinheit](https://kasseneck.at/wissen/signaturerstellungseinheit) — jede Barzahlung wird signiert | Kasseneck, nichts zu installieren |
| [Verkettung und DEP](https://kasseneck.at/wissen/dep) — jeder Beleg trägt den vorigen, das Protokoll ist exportierbar | Kasseneck-Backend |
| [Startbeleg, Monatsbeleg, Jahresbeleg](https://kasseneck.at/wissen/startbeleg-monatsbeleg-jahresbeleg) | Kasseneck, automatisch |
| [Meldungen an FinanzOnline](https://kasseneck.at/wissen/finanzonline) — Anmeldung, Ausfall, Außerbetriebnahme | Kasseneck-Backend |
| [Belegerteilungspflicht](https://kasseneck.at/wissen/belegerteilungspflicht) — jeder Kunde bekommt einen Beleg | **dieses Paket** — Bon, PDF, Bildschirm oder Link |
| [Ausfall der Signatureinheit](https://kasseneck.at/wissen/ausfall) — Sammelbeleg, Meldung, Nachsignatur | Kasseneck, automatisch |
| [Kassennachschau](https://kasseneck.at/wissen/kassennachschau) — der Prüfer verlangt das DEP | Kasseneck, Export auf Knopfdruck |
| Anmeldung der Kasse, Aufbewahrung, steuerliche Würdigung | **beim Unternehmer** |

Kurz: Sie bauen die Kassenoberfläche, nicht die Sicherheitseinrichtung. Ein Aufruf
von `createReceipt(...)` erzeugt einen signierten, verketteten und im DEP
abgelegten Beleg. Die Signaturkette wird gegen das offizielle Prüfwerkzeug des
BMF getestet.

> **Kein Rechts- oder Steuerrat.** Dieser Abschnitt beschreibt, was die Software
> tut. Er ersetzt keine Beratung und begründet keine Zusicherung, dass ein
> bestimmter Betrieb damit alle Pflichten erfüllt. Verbindlich sind die
> Bundesabgabenordnung, die RKSV und die Erlässe des BMF; die Verantwortung für
> Anmeldung, Betrieb und Aufbewahrung bleibt beim Unternehmer. Ausführlicher und
> mit Quellen: [kasseneck.at/wissen](https://kasseneck.at/wissen).
> Stand: September 2026.

## Erst ausprobieren

Es gibt eine Test-Umgebung mit eigenem Schlüssel und Test-Signaturen, getrennt
vom Echtbetrieb — die aktuellen Konditionen stehen auf
[kasseneck.at/preise](https://kasseneck.at/preise), die Schnittstelle ist unter
[kasseneck.at/api-doku](https://kasseneck.at/api-doku) beschrieben.

## Lieber eine fertige Kasse?

Dieses Paket ist für alle, die eine eigene Anwendung bauen. Wer einfach kassieren
will, muss nichts davon programmieren:

- **[Kasseneck — die fertige Registrierkasse](https://kasseneck.at)** für Telefon,
  Tablet und Browser, inklusive Signaturerstellungseinheit und
  FinanzOnline-Anmeldung.
- **[Lösungen nach Branche](https://kasseneck.at/branchen)** — vom Lokal bis zum Taxi.
- **[Preise](https://kasseneck.at/preise)**
- **[Kontakt](https://kasseneck.at/kontakt)** — auch für Kassenwechsel,
  Partnerschaften und eigene Integrationen.

## Was drin ist

Belege ausstellen und stornieren, Belege und Kassen auflisten, Berichte
herunterladen, Status bei FinanzOnline abfragen, Stripe-Zahllinks und
Hobex-Cloud-Zahlungen, das Beleg-Layout und die ESC/POS-Erzeugung für den
Bondrucker — und unter `./partner` die **Partner-API**: Betriebe anlegen und bis
zur laufenden Kasse begleiten.

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
| `registerUserAuth` | Browser-Kasse | ID-Token des Anmeldediensts als Bearer + `register-session`-Kopfzeile, Kasse als Parameter |

```ts
import { apiKeyAuth, registerUserAuth } from '@kreiseck/kasseneck-api';

// Gerät/POS: der api_key gehört auf ein Gerät, nie in einen Browser.
const geraet = apiKeyAuth({ apiKey: 'kr_live_…', cashregisterToken: 'cb_live_…' });

// Browser-Kasse: das Paket kennt den Anmeldedienst nicht — es bekommt Funktionen, die
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

Mit `sitzung.customToken` meldet sich der Verbraucher beim Anmeldedienst an; das
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

**Veraltet:** `createCancelReceipt` (Storno über `createReceipt` mit frei
übergebenen, negierten Positionen) bleibt aus Kompatibilität erreichbar, ist aber
`@deprecated` — kein Bezug zum Original, keine Restmengen, kein Schutz vor
doppeltem Storno, keine Gutscheine. Das Backend legt bei diesem Weg
`deprecation` in die Antwort.

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

## Beleg per E-Mail an den Gast

```ts
const bestaetigung = await api.sendReceiptEmail({
  fullReceiptId: beleg.fullReceiptId,   // oder api.generateFullReceiptId(receiptId)
  to: 'gast@example.at',
  sprache: 'de',                        // optional; heute wertet das Backend nur 'de' aus
});
bestaetigung.to;   // Adresse, wie das Backend sie protokolliert hat
bestaetigung.at;   // Zeitpunkt, ISO mit Wiener Zonenoffset
bestaetigung.via;  // 'eigen' | 'plattform' | 'plattform-fallback' | null
```

Verschickt wird ein **Link auf die öffentliche Belegseite**, kein PDF im
Anhang: die Belegseite führt dasselbe Zeilenmodell wie Bildschirm und Bon und
liefert dort auf Wunsch ein PDF. Der Beleg selbst bleibt unberührt (BAO §131 /
RKSV) — das Versandprotokoll führt das Backend neben ihm.

Die Kasse kommt aus der Anmeldung (Kopfzeile `cashregister-token` bzw. der
Parameter, den `registerUserAuth` setzt), nicht aus den Optionen; ein Beleg
einer anderen Kasse ist deshalb dieselbe Auskunft wie ein Beleg, den es nicht
gibt. Auch hier gilt: **am Code entscheiden, nicht am Text.** Die Codes stehen
in `RECEIPT_EMAIL_ERROR_CODES` (`isReceiptEmailErrorCode`):
`adresse_ungueltig`, `beleg_nicht_gefunden`, `zu_oft` (5 Mails je Beleg in 24
Stunden, 30 je Kasse und Stunde) und `versand_fehlgeschlagen`.

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

const partner = createPartnerApi({ partnerKey: process.env.KASSENECK_PARTNER_KEY! });

const { customerId } = await partner.createPartnerCustomer({
  appId: 'app_…',
  idempotencyKey: kundennummer,   // die eigene — schützt vor Doppelanlage
  betrieb: { /* Stammdaten, siehe Referenz */ } as never,
  // env: 'test' — auch mit einem LIVE-Schlüssel erlaubt: so probt man die
  // ganze Kette, ohne sich einen zweiten Schlüssel zu holen. Umgekehrt nie.
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
  if (istPartnerFehler(fehler, 'signature_not_ready')) {
    // Die Signatur DIESER Kasse ist noch nicht bereit — auf signature.ready warten.
    console.error(partner.fehlerRat('signature_not_ready'));
  }
}
```

### Eine Probe ist keine Kasse

`sendPartnerWebhookTest(webhookId, 'cashregister.live')` löst genau das
Ereignis aus, das der eigene Handler behandeln soll — eine Leitungsprobe
beweist nichts über die Behandlung des Ernstfalls. Damit niemand eine Probe
für echt hält, trägt sie `test: true` im Umschlag:

```ts
const geprueft = await parseWebhookEvent({ secret, signatureHeader, body, });
if (!geprueft.ok) return antwort(400);

if (geprueft.event.test) return antwort(200);   // Probe: nichts weiter tun
```

Ohne diese Zeile schreibt jemand seinem Kunden, die Kasse sei fertig.

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

## Rechnungs-API (`./rechnung`)

Für Shops, Buchhaltungs- und Branchensoftware: **Rechnungen** (§ 11 UStG) —
keine Belege — mit dem `api_key` eines Kontos ausstellen. Eine Rechnung ist
nach dem Aufruf **festgeschrieben**: sie trägt ihre fortlaufende Nummer, ist
unveränderlich und lässt sich nur noch per Gutschrift korrigieren.

**Was die Endpunkte tun, steht in der Referenz** — `docs/api/rechnungen.md`
im Backend. Hier steht, wie man den Client benutzt. Der Schlüssel gehört auf
einen **Server**.

```ts
import { createRechnungApi, istRechnungFehler } from '@kreiseck/kasseneck-api/rechnung';

const rechnungen = createRechnungApi({ apiKey: process.env.KASSENECK_API_KEY! });

// 1. Kunde einmal anlegen — externalId ist die eigene Kundennummer.
let kunde;
try {
  kunde = await rechnungen.createCustomer({
    type: 'company', name: 'Café Muster GmbH', country: 'AT',
    street: 'Hauptplatz', houseNumber: '3', zip: '1010', city: 'Wien',
    externalId: 'shop-4711',
  });
} catch (fehler) {
  if (!istRechnungFehler(fehler, 'customer_exists')) throw fehler;
  kunde = await rechnungen.getCustomer({ externalId: 'shop-4711' });
}

// 2. Ausstellen. Beträge in ganzen Cent; das Rechnungsdatum setzt der Server.
const { invoice, replayed } = await rechnungen.issueInvoice({
  idempotencyKey: `bestellung-${bestellnummer}`,   // gleiche Bestellung = gleiche Rechnung
  customerId: kunde.id,
  taxScheme: 'normal',
  priceMode: 'net',
  serviceStart: '2026-09-14',
  items: [{ description: 'Beratung', quantity: 2, unit: 'Std', unitPriceCents: 5000, vatRate: 20 }],
});
// invoice.number, invoice.totals.grossCents (12000), invoice.statusUrl

// 3. Dateien holen.
const pdf = await rechnungen.getInvoicePdf(invoice.id);      // Uint8Array, mit Factur-X
const xml = await rechnungen.getInvoiceXml(invoice.id, 'ubl'); // Peppol-UBL als Text

// 4. Korrigieren — nur per Gutschrift.
await rechnungen.createCreditNote({
  idempotencyKey: `nachlass-${bestellnummer}`,
  invoiceId: invoice.id,
  reason: 'price_reduction',
  items: [{ description: 'Nachlass Beratung', quantity: 1, unitPriceCents: 2000, vatRate: 20 }],
});
```

**Vor dem ersten Ausstellen die Einrichtung abfragen.** Die Rechnungs-API muss
für das Konto von Kasseneck freigegeben sein (live), und Firmenname, Anschrift,
UID, Bankverbindung und Nummernformat müssen stehen — sonst antwortet
`issueInvoice` mit `invoice_api_not_enabled` bzw. `invoice_setup_incomplete`:

```ts
const status = await rechnungen.getInvoiceSetupStatus();
if (!status.ready) console.warn(status.missing.map((m) => m.message).join('\n'));
```

**Sprache und Marke.** Eine Rechnung hat eine Nummer und **eine** Sprache (`de`
oder `en`, `INVOICE_LANGUAGES`): die der Anfrage, sonst die des Kunden
(`customer.language`), sonst Deutsch. Sie wird beim Ausstellen eingefroren;
Gutschriften übernehmen Sprache und Marke ihrer Rechnung. Behörden bekommen
immer Deutsch (`language_not_allowed`). Datum und Beträge bleiben in jeder
Sprache österreichisch formatiert.

```ts
const [marke] = await rechnungen.listBrands();              // [{ id, name, isDefault }]
const { invoice } = await rechnungen.issueInvoice({
  idempotencyKey: `bestellung-${bestellnummer}`,
  customerId: kunde.id,
  taxScheme: 'normal', priceMode: 'net', serviceStart: '2026-09-15',
  language: 'en',                                          // sonst die Sprache des Kunden
  brandId: marke.id,                                       // sonst die Standardmarke
  items: [{ description: 'Consulting', quantity: 2, unitPriceCents: 5000, vatRate: 20 }],
});
// Dieselbe Rechnung als deutsche Übersetzung — KEINE zweite Rechnung:
const kopie = await rechnungen.getInvoicePdf(invoice.id, { language: 'de' });
```

Die Übersetzungskopie trägt dieselbe Nummer, ist auf jeder Seite als
„Übersetzung – keine eigene Rechnung" gekennzeichnet und hat keine eingebettete
E-Rechnung. Eine zweite Rechnung mit eigener Nummer für dieselbe Leistung
wäre umsatzsteuerlich ein Problem (UStR Rz 1527); die Kopie ist das nicht (Rz 1528).
Die Texte beider Sprachen liegen als `RECHNUNG_TEXTE` bzw.
`fixtures/rechnung-texte.json` im Paket.

**Einheiten sind Schlüssel, kein freier Text.** `items[].unit` nimmt einen Wert aus
`INVOICE_UNITS` (`piece`, `hour`, `day`, `flat_rate`, `kilogram`, `square_metre`, …;
ohne Angabe `piece`). Gedruckt wird das Kürzel in der Sprache der Rechnung — `Stk`
bzw. `pcs` —, und die E-Rechnung trägt den UN/ECE-Code aus
`RECHNUNG_EINHEITEN_CODES` (`C62`, `HUR`, …). Freier Text wie `"Std"` ist
`validation` mit Feld `items[0].unit`.

**Schon bezahlt?** Wer online kassiert und danach die Rechnung stellt, gibt die
Zahlung gleich mit: sie entsteht in derselben Transaktion wie das Festschreiben,
und das PDF trägt dann keinen Zahlungskasten und keinen Giro-QR.

```ts
const { invoice } = await rechnungen.issueInvoice({
  idempotencyKey: `bestellung-${bestellnummer}`,
  customerId: kunde.id,
  taxScheme: 'normal', priceMode: 'net', serviceStart: '2026-09-16',
  items: [{ description: 'Beratung', quantity: 2, unitPriceCents: 5000, vatRate: 20, unit: 'hour' }],
  payment: { method: 'card', reference: zahlung.id },      // ohne amountCents: voll bezahlt
});                                                        // invoice.openCents === 0

// Trifft das Geld erst später ein (Überweisung, Teilzahlung):
await rechnungen.recordInvoicePayment({
  idempotencyKey: `zahlung-${zahlung.id}`,                 // Pflicht: sonst bucht eine Wiederholung zweimal
  invoiceId: invoice.id, method: 'transfer', amountCents: 12000, paidAt: '2026-09-20',
});
```

`reference` wird gespeichert, aber **nicht gedruckt**; Kartendaten gehören
ohnehin nicht auf eine Rechnung.

**Barumsatz ist nicht nur Bargeld.** Als Barzahlung gilt auch die Karte **vor
Ort** an der Kasse (§ 131b Abs. 1 Z 3 UStG) — dieselbe Karte im Internet
dagegen nicht. Weil `card` und `online` beides sein können, sagt es das
Fremdsystem selbst:

```ts
payment: { method: 'card', onSite: true }   // Terminal an der Kasse
payment: { method: 'card' }                 // Kartenzahlung im Shop
```

Bei `cash` (immer) und bei `onSite: true` trägt die Antwort
`notice.code = 'cash_receipt_required'`: ein Barumsatz braucht einen Beleg
(§ 132a BAO), bei Registrierkassenpflicht über die Registrierkasse — der
Vermerk an der Rechnung ersetzt ihn nicht. `transfer` mit `onSite` ist ein
Feldfehler, eine Überweisung erfolgt nicht vor Ort.

**Nach einem Zeitlimit mit demselben `idempotencyKey` wiederholen**, nie mit
einem neuen: dann kommt die schon ausgestellte Rechnung zurück
(`replayed: true`). Derselbe Schlüssel mit anderen Daten ergibt
`idempotency_conflict`.

Formfehler kommen als `validation` mit Feldpfaden (`rechnungFeldFehler(fehler)`
→ `[{ field: 'items[0].vatRate', message }]`). Der Vertrag selbst liegt als
Daten im Paket (`RECHNUNG_ANFRAGEN`) und als JSON Schema unter
`@kreiseck/kasseneck-api/fixtures/rechnung-api.schema.json`; das Backend prüft
gegen genau diese Datei.

## Unterpfade

| Unterpfad | Inhalt |
|-----------|--------|
| `@kreiseck/kasseneck-api` | Endpunkte, Anmeldung, Transport, Modelle, Enums, Fehler — alles, was mit dem Backend spricht. |
| `…/receipt` | Beleg-Layout als Datenmodell (framework-frei) und die Brücke zu ESC/POS. |
| `…/printing` | ESC/POS-Erzeugung: Bytefolgen für Bondrucker, ohne jeden Transport. |
| `…/payments` | Stripe-Zahllinks, Hobex-Cloud (beides HTTP-Endpunkte des Backends) und Hobex **HPS** über **Kasseneck Connect** (lokaler Geräte-Agent, spricht mit dem Terminal). |
| `…/register` | Anmeldung der Browser-Kasse: Gerät koppeln und entkoppeln, Benutzer auflisten, per PIN anmelden, Sitzung erneuern und beenden. |
| `…/kasse` | Kachel-Kasse: Kassen-Einstellungen (betriebsweit / je Gerät), Artikelgruppen und Artikel für Kacheln, Rabattverteilung je Steuersatz, Reichweiten der Kassen-Rechte |
| `…/partner` | Partner-API: Betriebe anlegen, FinanzOnline-Link, Signatur, Kassen, Zugangsdaten, Webhooks samt Signaturprüfung. **Gehört auf einen Server.** |
| `…/rechnung` | Rechnungs-API: Kunden anlegen und suchen, Rechnungen festgeschrieben ausstellen, Gutschrift und Storno, PDF und E-Rechnung-XML; der Vertrag als Daten. **Gehört auf einen Server.** |
| `…/react` | Dünner React-Adapter, der ein Beleg-Layout zeichnet. Braucht React. |
| `…/fixtures/*` | Golden-Belege (JSON): Eingaben `belege/<name>.json`, zugesagte Zeilenausgabe `erwartet/<name>.lines.json`, `manifest.json` mit Prüfsummen — dieselben Dateien prüfen Backend, Browser-Kasse und Flutter-Paket. |

So zieht sich niemand den React-Adapter in ein Node-Programm.

## Der QR-Code passt aufs Papier

Der native QR-Befehl bekommt eine Modulgröße in Druckpunkten mit und rechnet
selbst nicht nach, ob das Symbol samt Ruhezone auf die Rolle geht. Zu breit
heißt bei den meisten Bondruckern nicht „abgeschnitten", sondern **gar kein
QR** — auf einem Pflichtbeleg der schlechteste aller Ausgänge. Deshalb rechnet
dieses Paket die Größe, statt sie zu setzen:

```ts
import { qrGroesseFuer, QR_DRUCK_PUNKTE } from '@kreiseck/kasseneck-api/printing';

const mass = qrGroesseFuer({ nutzlast: beleg.qr, papierbreitePunkte: QR_DRUCK_PUNKTE.mm58 });
// mass.punkte: Punkte je Modul, null = passt auch mit der Ausnahmegröße nicht
// mass.unterMindestmass: gedruckt, aber unter 4 Punkten je Modul
```

Am Belegweg passiert das von selbst. `qrGroesse` ist ein **Deckel**, keine
Vorgabe: gedruckt wird die größte Größe, die noch passt, höchstens aber der
Deckel. `auto` (Vorgabe) deckelt bei 6 Punkten je Modul — wie im Dart-Zwilling
und am Epson-Weg; `klein` deckelt bei 4. Alle Druckwege setzen den QR mit
Fehlerkorrektur M.

```ts
import { escPosLayoutErgebnis } from '@kreiseck/kasseneck-api/receipt';

const { bytes, qrFehler, qrAusweich } = escPosLayoutErgebnis(layout, {
  qrGroesse: 'gross',        // 'auto' | 'klein' | 'mittel' | 'gross'
  qrModus: 'nativeModel1',   // ältere Drucker, die nur Modell 1 können
  qrMatrix: rasterFuer,      // Notausgang: der QR als Bild statt gar nicht
});
```

Der Epson-Weg (`eposPrintXml` / `eposDirectPrint`) rechnet genauso;
`eposPrintXmlErgebnis` gibt dort `{ xml, qrFehler, qrAusweich }`. Die Vorgabe
ist auch dort `auto`.

`qrFehler` heißt „Beleg ohne QR" — das gehört dem Kunden gesagt. `qrAusweich`
heißt „gedruckt, aber der eingestellte Weg taugt für dieses Gerät nicht" — das
gehört dem Chef gesagt. Den Bildweg fährt das Paket nur mit einem `qrMatrix`,
das die Nutzlast in ein fertiges Raster übersetzt: hier wird bewusst weder ein
QR gerechnet noch ein Bild verarbeitet.

## Das Beleg-Blatt: überall derselbe Beleg

Bildschirm, Bon, ePOS und PDF setzen dasselbe **Blatt**: Rasterzeilen, Firmenlogo,
QR und die Marke „erstellt mit Kasseneck", mit Größen als Anteil der Blattbreite
und in Zeilen (eine Zeile = zwei Zeichenbreiten).

```tsx
import { BelegBlattView } from '@kreiseck/kasseneck-api/react';

<BelegBlattView layout={layout} logo={{ url: company.logoUrl, stufe: 'M' }} marke={company.showKreiseckLogo} renderQr={(d) => <QrSvg data={d} />} />
```

```ts
import { escPosLayoutBytes, logoMass, logoRaster } from '@kreiseck/kasseneck-api/receipt';

const mass = logoMass({ stufe: 'M', pxBreite: bild.width, pxHoehe: bild.height }, 48);
const raster = logoRaster(imageData.data, bild.width, bild.height, mass, 48);
escPosLayoutBytes(layout, { paperSize: 'mm80', logo: { stufe: 'M', pxBreite: bild.width, pxHoehe: bild.height, raster }, marke: true });
```

Logo-Stufen: S 42 % × 5 Zeilen, M 62 % × 8, L 80 % × 12, XL 94 % × 16 — eingepasst,
nie hochgerechnet. Der Aufdruck (TESTKASSE, STORNOBELEG …) ist ein Rahmen aus
`=`-Zeilen, auf jedem Weg gleich.

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
sie nicht) und die PDF-Erzeugung. Bilder dekodieren (PNG/JPEG): das Paket
rastert fertige RGBA-Pixel, das Laden des Bilds bleibt bei der Anwendung.

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
ID-Token — stehen mit Grund in `scripts/erreichbarkeit-ausnahmen.json`.
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

| `oberflaeche.json` | Aufrufnamen, Enum-Werte, Rechte-Schlüssel, Tasten-Aktionen, Partner-Listen |

Alle drei werden erzeugt (`npm run fixtures:kasse`, `npm run fixtures:oberflaeche`,
`npm run fixtures:hobex-hps-codes`) und nie von Hand geändert; die CI prüft
nach jedem Lauf, dass sie zum Code passen.

`oberflaeche.json` und `hobex-hps-codes.json` tragen die Paketversion. **Nach
jedem `npm version` müssen deshalb alle drei Dateien neu erzeugt und
mitcommittet werden**, sonst wird die CI rot.

### Und die Gegenrichtung

Der Vertrag in `fixtures/` wird **drüben** geprüft: das Dart-Repo zieht ihn und
hält seine Listen dagegen. Eine Lücke fiele hier deshalb erst im nächsten
Zwillingslauf im anderen Repo auf — an einem anderen Tag. Dagegen stehen zwei
von Hand gepflegte Abzüge der Dart-Seite unter `test/fixtures/`, jeder mit
`_quelle`:

| Datei | prüft |
|---|---|
| `dart-enums.json` | Belegtyp, Steuersatz, Zahlungsart, Kartenanbieter, Gutschein, Stripe-Modus |
| `dart-partner.json` | Umgebungen, Fehlercodes (API und Portal), Webhook-Ereignisse, Felder des Webhook-Umschlags samt der Marke `test`, Betriebsfelder, Wiederholungsplan |

Sie machen `npm test` rot, sobald ein Wert nur in einer der beiden Sprachen
ankommt.

## Lizenz

Apache-2.0 — siehe `LICENSE` und `NOTICE`.

---

**Kasseneck** ist ein Produkt von
[Kreiseck Software Solutions](https://kreiseck.com) aus Salzburg — Apps,
Kassensysteme und Automatisierungen. Fragen zur Schnittstelle, zu eigenen
Integrationen oder zu einer Partnerschaft:
[kasseneck.at/kontakt](https://kasseneck.at/kontakt).
