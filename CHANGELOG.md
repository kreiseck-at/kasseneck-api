# Änderungen

Was vor 0.7.0 geschah, steht in der Commit-Historie (`git log`); ab hier wird
es hier geführt. Ein Eintrag nennt die Änderung **und ihren Grund** —
nur der Grund überlebt den nächsten Umbau.

## 0.9.1

### Elf Saetze fuer die vier Ausgaenge einer Kartenzahlung und das Terminal-Protokoll

**Anlass:** Die Kassen-App bekommt GP Tom mit denselben vier Ausgaengen, die
die Browser-Kasse schon kennt — geglueckt, abgebrochen, gescheitert, unklar —
und dazu ein Terminal-Protokoll. Beide Kassen duerfen nur Katalogsaetze zeigen;
ohne diese Schluessel haette die App eigene Formulierungen erfunden, und der
Kassier haette am Tresen zwei verschiedene Woerter fuer dieselbe Lage gelesen.

**Grund fuer die Auswahl:** Der teuerste Fehler an der Kasse ist die zweite
Belastung derselben Karte. Deshalb tragen die neuen Saetze zu den unsicheren
Ausgaengen alles, was der Kassier braucht, um NICHT zu wiederholen: Betrag,
Kennung und den Hinweis auf den Terminal-Beleg.

- **GP Tom** (nur App, wie die uebrigen `gptom.`-Saetze): `gptom.abgelehnt` und
  `gptom.abgelehnt_mit_code` (das Terminal hat entschieden — sicher nichts
  gebucht), `gptom.nicht_geoeffnet` (die App liess sich nicht starten),
  `gptom.zeit_abgelaufen` / `gptom.zeit_abgelaufen_mit_kennung` (Frist abgelaufen
  ist **kein** Abbruch: die Karte kann belastet sein).
- **Karte gebucht, Beleg fehlt:** `kartenzahlung.karte_gebucht_beleg_offen` und
  `kartenzahlung.karte_gebucht_korb_geaendert`, beide mit `betrag` und `kennung`.
  Der zweite nennt die Entscheidung, die er verlangt: Beleg erstellen oder am
  Terminal stornieren und hier verwerfen.
- **Warteschirm:** `kartenzahlung.wartet_auf_terminal`.
- **Terminal-Protokoll:** `protokoll.leer`, `protokoll.kopiert` — ohne `nur`,
  weil an dem Satz nichts plattformgebunden ist.

**Neue abgeleitete Pruefungen** statt einer gepflegten Liste: kein Satz steht
zweimal im Katalog; jeder `gptom.`-Satz gilt nur in der App; jede Fassung
`…_mit_kennung` ist ihre Grundfassung plus dem Anker und teilt deren `nur`;
jeder unklare Ausgang warnt vor dem zweiten Kassieren.

`FEHLERREGELN` bleibt unveraendert — die neuen Saetze sind Ausgaenge einer
Kartenzahlung, keine neue Art, einen Transportfehler einzuordnen.

## 0.9.0

### Alle Kartenzahlungsbloecke im Belegmodell — nicht nur Hobex

**Anlass:** Am Bon aus der Flutter-App standen bei einer Stripe-Zahlung Marke,
letzte vier Ziffern, 3-D Secure, Betrag, Zahlzeitpunkt und Referenz. Dasselbe
Blatt als PDF geoeffnet sagte nur „Zahlungsart: Kartenzahlung". Betroffen waren
vier der sieben Anbieter: GP Tom, SumUp, myPOS und Stripe.

**Ursache:** Bis 0.8.0 trug dieses Modell nur den Hobex-Block, begruendet damit,
die uebrigen Anbieter druckten „in ihren eigenen Apps". Das Argument gilt fuer
die Frage, wer das TERMINAL bedient — nicht dafuer, was auf dem BELEGDOKUMENT
steht. Aus der einen Regel wurde beim Bau des Zeilenmodells die andere. Im
Backend hatte die vorherige PDF-Erzeugung (`generateReceiptPdf`) alle sieben
Anbieter; mit der Umstellung auf dieses Modell fielen vier still weg.

- Neu: `gpTomBlock`, `sumupBlock`, `myposBlock`, `stripeBlock` — Zeile fuer
  Zeile portiert aus `print_paper.dart` des Dart-Zwillings, inklusive der
  Eigenheiten: GP Tom schreibt `transactionType` im Plugin-`toMap` mit
  Tippfehler (`transacitonType`), myPOS liefert den Zeitpunkt als
  `YYMMDDhhmmss` ohne Trenner, Stripe kennt neben Karte auch EPS.
- `stripeReceiptLines` wird exportiert, wie im Dart-Paket: Druck und Anzeige
  sollen dieselbe Quelle haben, nicht zwei.
- Ein myPOS-Zeitpunkt, der nicht wie `YYMMDDhhmmss` aussieht, wird
  **unveraendert** durchgereicht statt zerschnitten — eine halb geratene
  Uhrzeit auf einem Beleg ist schlimmer als ein roher Wert.
- Ein unbekannter Anbieter ergibt weiterhin keinen Block, still und ohne
  Fehler: ein Beleg muss sich immer zeigen lassen.

### Neun Golden-Belege fuer Kartenzahlungen

**Anlass:** Von den 22 Golden-Belegen trug **keiner** eine Kartenzahlung.
Deshalb konnte der Verlust der vier Bloecke passieren, ohne dass irgendetwas
rot wurde.

- Neu: `karte-hobex-hps`, `karte-hobex-cloud`, `karte-gptom`, `karte-gptom-ios`,
  `karte-sumup`, `karte-mypos`, `karte-stripe`, `karte-stripe-eps`,
  `karte-eigener`. Die Paare decken beide Zweige ab, wo es welche gibt
  (Unterschriftsfeld ja/nein, Karte gegen EPS, Tippfehler-Schluessel).
- Neu: eine Pruefung, die die Anbieterliste **aus dem Enum** nimmt statt aus
  einer Handliste — wer einen Anbieter aufnimmt, wird rot, bis ein Golden-Beleg
  dazuliegt. Sie fand beim ersten Lauf sofort zwei weitere Luecken
  (`gpTomIos`, `hobexCloudApi`).
- Neu: eine zweite Pruefung, dass ein Beleg MIT Terminaldaten auch wirklich
  einen Block traegt. Ein Golden-Beleg allein beweist nur, dass die Datei da
  ist.

## 0.7.2

### `55` („PIN falsch") ist eine gemessene Host-Ablehnung → `declined`

**Anlass:** Vorfall vom 02.09.2026 am Produktivterminal 3556988 (HPS 1.11.4,
Firmware 2.3.9), vom Dart-Zwilling `kasseneck_api` 6.4.0 übernommen — die
erste echte Host-Ablehnung, die je beobachtet wurde. Die Zahlung antwortete
direkt mit `55`, die Statusabfrage danach elfmal in Folge ebenfalls. Als
Wissenslücke kostete der Code 90 s Klärung ins Budget, `unresolved`, einen
stehenden Merker und eine Rückfrage an den Bediener — für eine falsch
getippte PIN.

- Neu: `WRONG_PIN_CODE`, in `HPS_MEASURED_CODES` als schlüssig geführt.
- Bewusst **keine** Familienregel für zweistellige Host-Codes: ISO 8583 führt
  dort auch Genehmigungen (`08`, `10`, `11`, `85`). Die Zwei-`9027`-Regel
  greift bei Host-Codes nicht (der Status antwortet mit dem Code selbst);
  ungemessene Host-Codes enden weiterhin bei `unresolved`.
- `fixtures/hobex-hps-codes.json` neu erzeugt; die Vertragsdatei nennt jetzt
  unter `ergaenztAn`, welcher Code von welchem Gerät stammt.

### Neu: `HpsPaymentResult.lastResponse` und Terminal-Klartext im Nachweis

Am 02.09.2026 sah der Bediener bei einer Antwort `55` „PIN falsch" nur
„Ausgang unklar", musste raten und buchte die abgelehnte Zahlung als bezahlt;
75 EUR Umsatz waren weg. Der Klartext hätte die Entscheidung getragen.

- `lastResponse`: die letzte Terminal-Antwort bei `unresolved`, auch wenn sie
  nichts entschied — Material für Anzeige und Katalog, nie ein Beleg.
  `response` bleibt bei `unresolved` weiterhin ungesetzt.
- Der Nachweis nennt bei einem unbekannten Code den Klartext des Terminals:
  `Terminal nennt einen unbekannten Code (55) "PIN falsch"`.

## 0.7.0

### Neu: Unterpfad `./partner` — die Partner-API

Alles, was ein Partner-Softwarehaus über die Kasseneck-Schnittstelle tut, in
einem eigenen Unterpfad. Er liegt bewusst **nicht** in der Wurzel: der
Partner-Schlüssel gehört auf einen Server (er kann Betriebe anlegen und deren
Geheimnisse holen), und die Kassen-Seite des Pakets soll ihn nicht in ein
Browser-Bündel ziehen.

Neue öffentliche Symbole:

- **Anmeldung und Fassade** — `partnerKeyAuth`, `partnerKeyEnv`,
  `createPartnerApi`, `PartnerApi`, `PartnerApiOptions`, `PartnerKeyAuthOptions`.
- **Betriebe** — `createPartnerCustomer`, `listPartnerCustomers`,
  `getPartnerCustomer`, `sendPartnerCustomerFonLink`, `getPartnerInfo`.
- **Signatur und Kassen** — `requestCustomerSignature`,
  `getCustomerSignatureStatus`, `createCustomerCashregister`,
  `activateCashregister`, `listCustomerCashregisters`, `getCustomerCredentials`.
- **Webhooks** — `createPartnerWebhook`, `listPartnerWebhooks`,
  `updatePartnerWebhook`, `deletePartnerWebhook`, `sendPartnerWebhookTest`,
  `listPartnerWebhookDeliveries`, `parseWebhookEvent`,
  `verifyWebhookSignature`, `parseSignatureHeader`, `PARTNER_WEBHOOK_EVENTS`,
  `istPartnerWebhookEvent`, `WEBHOOK_UMSCHLAG_FELDER` und die Konstanten
  `WEBHOOK_SIGNATURE_HEADER`,
  `WEBHOOK_EVENT_HEADER`, `WEBHOOK_DELIVERY_HEADER`, `WEBHOOK_TOLERANCE_SEC`,
  `WEBHOOK_RETRY_PLAN_SEC`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_TIMEOUT_MS`,
  `WEBHOOK_LIMIT`.
- **Ablauf und Fehler** — `PARTNER_ABLAUF`, `naechsterSchritt`,
  `PARTNER_FEHLER_CODES`, `PARTNER_PORTAL_FEHLER_CODES`,
  `istPartnerFehlerCode`, `istPartnerPortalFehlerCode`, `istPartnerFehler`,
  `partnerFehlerCode`, `partnerFehlerRat`, `partnerFeldFehler`,
  `partnerWartezeitSek`, `SCOPE_CREDENTIALS`.
- **Betriebsdaten** — `BETRIEB_FELDER`, `unbekannteBetriebsfelder`,
  `PARTNER_ENVS`.
- **Geheimnisse** — `KasseneckSecret`, `SECRET_MASKE`.
- Dazu die Typen der Nutzlasten (`Betrieb`, `Kunde`, `Kasse`, `SignaturAntrag`,
  `CustomerCredentials`, …).

Warum die einzelnen Entscheidungen so gefallen sind:

- **`KasseneckSecret` statt `string` für die Zugangsdaten eines Betriebs.**
  `getCustomerCredentials` liefert den `api_key` des Betriebs und die Token
  seiner Kassen; wer sie hat, kann in seinem Namen Belege signieren, und ein
  Beleg ist nach RKSV nicht zurücknehmbar. Ein `string` in einem Antwortobjekt
  landet aber in `console.log`, in `JSON.stringify` und im Rumpf eines
  Fehlerberichts. Der Klartext liegt deshalb in einer `WeakMap` neben der
  Instanz — am Objekt hängt kein Feld, das ihn trägt — und `toString`,
  `toJSON`, `Symbol.toPrimitive` sowie der Node-Inspektor zeigen eine Maske.
  Heraus kommt man nur über `.reveal()`; genau diese Stellen findet eine Suche.
- **Die Signaturprüfung liegt fertig im Paket, nicht als Beispiel in der Doku.**
  Sie ist der Teil, den Integratoren am häufigsten falsch bauen, und ein Fehler
  fällt dort nie auf: eine zu lasche Prüfung lässt jeden durch und meldet nichts.
  Umgesetzt mit WebCrypto statt `node:crypto`, damit das Paket weiterhin ohne
  Laufzeitabhängigkeit auskommt — deshalb ist sie asynchron.
- **`env` bei `createPartnerCustomer`.** Ohne Angabe entscheidet der Schlüssel.
  Ein **Live**-Schlüssel darf `env:"test"` verlangen — das ist der vorgesehene
  Weg, die ganze Kette zu proben, ohne sich einen zweiten Schlüssel zu holen.
  Umgekehrt nie: ein Test-Schlüssel mit `env:"live"` bekommt `live_not_allowed`,
  und es entsteht nichts. Der Client prüft das **nicht** selbst vor: der Server
  ist die eine Wahrheit, und ein zweiter Torwächter im Paket wäre der, der
  irgendwann veraltet.
- **Verträge wirken im Partner-Weg nicht mehr** (Backend-Stand 2026-08-31).
  Keine Antwort führt `avv`, `naechsteSchritte` kennt keinen AVV-Schritt, und
  bei der Inbetriebnahme gibt es kein `vertrag_offen` mehr. Weggefallen sind
  deshalb `reportCustomerVertrag`, `vertragOffenRat`, `vertragOffenRatFuer`,
  `AVV_MODI`, `AVV_STATUS`, `avvErfuellt`, `avvSperrt`, `avvStatusText`,
  `istAvvModus`, die Option `avvModus` und der Ablaufschritt `avv`. Der Typ
  `AvvStand` **bleibt** und wird weiterhin gelesen, wenn eine Antwort ihn doch
  führt — vorausgesetzt wird er nirgends. `customer.avv_accepted` steht nicht
  mehr in `PARTNER_WEBHOOK_EVENTS`: es ist ein internes Ereignis, das ein
  Partner weder abonnieren noch proben kann, und ein Name in dieser Liste, den
  niemand bestellen kann, ist ein Versprechen ohne Deckung.
- **Der Fehlerkatalog ist vollständig** — 28 Codes der Schnittstelle
  (`PARTNER_FEHLER_CODES`) und 12 des Partner-Portals
  (`PARTNER_PORTAL_FEHLER_CODES`), jeder mit Handlungssatz. Quelle ist
  `docs/api/fehlercodes.json` im Backend. Ein Code, den nur eine Seite kennt,
  ist für einen Aufrufer nicht von „gibt es nicht" zu unterscheiden; eine halbe
  Liste ist deshalb schlimmer als keine.
- **`test: true` im Webhook-Umschlag.** `sendPartnerWebhookTest` nimmt jetzt ein
  `event` und löst damit **jedes abonnierte Ereignis** mit glaubwürdiger
  Nutzlast aus — eine Leitungsprobe beweist nichts über die Behandlung des
  Ernstfalls. Damit eine Probe nicht für echt gehalten wird, trägt sie
  `test: true` im Umschlag; `PartnerWebhookEvent.test` führt das Feld und ist
  bei echten Ereignissen `false`. Die Zeile `if (ereignis.test) return;` gehört
  an den Anfang jedes Handlers — ohne sie schreibt jemand seinem Kunden, die
  Kasse sei fertig.
- **Betriebsdaten werden streng geprüft.** Das Backend weist ein unbekanntes
  Feld ab, statt es stillschweigend zu verwerfen, und nennt den vollen Pfad
  (`address.land`, `contacts.0.rolle`). Der Typ `Betrieb` führt deshalb genau
  die Liste aus `partner-core.BETRIEB_FELDER`, und `unbekannteBetriebsfelder`
  beantwortet dieselbe Frage zur Laufzeit — für Daten aus Datenbank oder
  Formular, die nie durch die Typprüfung gelaufen sind. Abgewiesen wird hier
  nichts: die Wahrheit bleibt der Server, sonst blockierte ein alter Client ein
  neues Feld.
- **`createCustomerCashregister` ohne `name`, mit `signaturId`.** Kassennamen
  vergibt Kasseneck (sie sind gleich der `cashregisterId`); ein gesendetes
  `name` wäre ein `validation`-Fehler. Dafür bezieht sich **jede** Kasse auf
  eine Signatur: ohne eine einzige `signature_missing`, bei mehreren
  `signature_ambiguous` ohne `signaturId`. `requestCustomerSignature` nimmt
  `weitere`, um eine zusätzliche Signatur zu beantragen (höchstens zehn,
  `signature_limit`).
- **`getPartnerInfo().partner.darfZugangEinrichten`** und `zugang.einladen` mit
  Vorgabe **false**: ein Zugang zum Kundenpanel legt einen Login auf eine fremde
  Adresse an und schickt eine Mail dorthin. Fehlt das Feld, gilt NEIN — eine
  Berechtigung, die nicht ausdrücklich dasteht, hat man nicht.

### Geändert: `KasseneckApiError` trägt `code` und `details`

Bisher blieb vom `data` einer Fehlerantwort nichts übrig. Die Partner-API legt
ihre Entscheidung aber nicht in den Text, sondern in `data.code`
(`live_not_allowed`, `signature_not_ready`, `activation_failed` samt
`data.schritt`); ohne diese Felder müsste ein Aufrufer die deutsche `message`
nach Zeichenketten durchsuchen — die Art Kopplung, die beim nächsten
Formulierungsschliff still bricht.

Die Nutzlast wird dabei **gesiebt** (`fehlerDetails`) und nicht durchgereicht:
höchstens vier Ebenen tief, 50 Einträge je Ebene, Zeichenketten bis 300 Zeichen,
nur bezeichner-förmige Schlüssel — und kein Wert, der mit einem der gesendeten
Geheimnisse überlappt. Damit gilt dieselbe Zusage wie für `causeDigest`.

Additiv: der dritte Konstruktorparameter hat einen Vorgabewert, bestehende
Aufrufer und `catch`-Zweige bleiben unverändert.

### Vertrag

`AUFRUFE` und damit `fixtures/oberflaeche.json` führen 18 Aufrufe mehr (die
Partner-Endpunkte). Der Flutter-Zwilling `kasseneck_api` und die
Hosting-Weiterleitungen in `kasseneck-web` lesen diese Liste — beide müssen
nachziehen, sonst laufen die Aufrufe in Produktion auf die HTML-Seite statt auf
die Function.

**Neuer Abschnitt `partner` in der Vertragsdatei.** Der Partner-Teil wäre sonst
als reine Namensliste über den Vertrag gegangen: die Aufrufe hätte er geführt,
die Fehlercodes, die Webhook-Ereignisse, die Betriebsfelder, die Umgebungen,
die Felder des Webhook-Umschlags und den Wiederholungsplan nicht — und genau
die pflegt der Zwilling von Hand nach. Ein Fehlercode, den nur eine Seite kennt,
hätte auf der anderen keinen Handlungssatz und wäre für einen Aufrufer nicht von
„gibt es nicht" zu unterscheiden. `scripts/oberflaeche.mjs` liest den
Partner-Namensraum genauso ab wie den Kassen-Namensraum; eine neu angelegte
Liste landet damit von selbst im Vertrag statt still zu fehlen.

**Und die Gegenrichtung: `test/fixtures/dart-partner.json`.** Der Vertrag in
`fixtures/` wird drüben geprüft — dieses Repo sähe eine Lücke erst im nächsten
Zwillingslauf im anderen Repo, an einem anderen Tag. Der eingecheckte Abzug der
Dart-Seite (dasselbe Muster wie `dart-enums.json`, samt `_quelle`) macht
`npm test` hier rot, sobald ein Fehlercode, ein Ereignis, ein Betriebsfeld, eine
Umgebung oder die Marke `test` nur in einer der beiden Sprachen ankommt.
