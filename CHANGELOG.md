# Änderungen

Was vor 0.7.0 geschah, steht in der Commit-Historie (`git log`); ab hier wird
es hier geführt. Ein Eintrag nennt die Änderung **und ihren Grund** —
nur der Grund überlebt den nächsten Umbau.

## 0.27.2

- **README auf Englisch** und jede Angabe gegen den Code geprüft. Anfragen kommen inzwischen auch
  aus dem Ausland, und auf npm ist Englisch die Erwartung. RKSV-Begriffe bleiben deutsch und
  werden beim ersten Vorkommen erklärt; ein Glossar am Ende nennt dieselben Begriffe wie der
  Dart-Zwilling. Eine kurze deutsche Einstiegsseite liegt als `README.de.md` im Repo.
- Dabei berichtigt: Beispiele, die nicht kompilierten (`business` statt `betrieb`, `automatic`
  statt `automatisch`, Einheit `'Std'`, optionale `logoUrl`), die Option `regelwerk` statt
  `layoutRegeln`, die Druckwege (WebUSB, ePOS, Druckaufträge gehören zum Paket), `refund` und
  `cancel` am HPS-Terminal, sechs statt drei anmeldungsfreie Aufrufe und § 131b **BAO**.
- `package.json`: Beschreibung englisch zuerst, weitere englische Schlagwörter.

## 0.27.1

- Drei Beispiele zum Mikropreis in `fixtures/rechnung-api-beispiele/`: der Sub-Cent-Fall
  (3.500.000 × 0,000004 € = 14,00 € netto), beide Preise gesetzt und kein Preis gesetzt. Sie sind
  zugleich die Prüfvektoren, die Server und Dart-Zwilling gegen ihre eigene Prüfung fahren — ein
  Beispiel, das nur in der Doku steht, veraltet unbemerkt.

## 0.27.0

- **Rechnungs-API: der Einzelpreis einer Position darf in Mikro-Euro stehen** (`unitPriceMicros`,
  10⁻⁶ €). Genau eines von `unitPriceCents` und `unitPriceMicros` — beide Felder sind dafür
  optional, und die neue Genau-eins-Regel am Positions-Objekt wird im JSON Schema zu
  `oneOf: [{required:['unitPriceCents']}, {required:['unitPriceMicros']}]`. Grund: Preise unterhalb
  eines Cents (Verbrauchsabrechnung, Stückpreise im Zehntelcent) mussten bisher schon beim
  Einreichen gerundet werden; der Rundungsfehler steckte danach in jeder Zeile.
  **Bricht die Form:** wer den Typ `IssueInvoiceItem` selbst baut, bekommt `unitPriceCents` jetzt
  als optionales Feld. Anfragen, die es setzen, bleiben unverändert gültig.
- Der Mikropreis deckt denselben Betragsbereich wie die Cent-Angabe (10¹² Mikro-Euro = 10⁸ Cent =
  10.000.000,00 €). Eine eigene Obergrenze wäre eine stille Bereichsänderung, je nachdem welches
  Feld ein Aufrufer benutzt.
- Die Menge reicht bis 10⁹ statt 10⁶, passend zu `quantityMilli` der gespeicherten Form.
- **Noch nicht enthalten:** `rechnungSummen` rechnet weiterhin wie bisher, nicht über den exakten
  Kern. Das gehört zum Stichtag der Umstellung (Schalter `ganzzahlPflicht`): solange der Server
  eine Rechnung nach dem alten Weg ausstellt, darf eine Vorschau im Aufrufer nicht schon exakt
  runden — sie zeigte sonst an Halbcent-Grenzen einen anderen Cent als die Rechnung.

## 0.26.0

- Beleg: Am Ende steht das Kasseneck-Logo als Bild statt der Zeile „erstellt mit Kasseneck".
  Das Raster entsteht beim Bauen in den beiden Druckmaßen (352 × 51 für 80 mm, 234 × 34 für 58 mm);
  zur Laufzeit wird nichts gerastert, damit beide Pakete denselben Bytestrom erzeugen.
- **ESC/POS: der Vorspann setzt den Druckbereich auf die Breite des Blatts** (`GS L 0` +
  `GS W`, acht Bytes hinter `ESC @`). `ESC a 1` mittelt nicht im Blatt, sondern in der
  Fläche des *Geräts*: Ein 58-mm-Blatt auf einem 80-mm-Drucker setzte den Text in die
  linken 384 Punkte, QR, Logo und Marke aber mittig in die 576 — alles Bildhafte stand
  gegenüber dem Text nach rechts gerückt. Am Gerät nachgestellt und behoben. Passen Gerät
  und Blatt zusammen (der Regelfall), ist der gesetzte Wert der Vorgabewert des Druckers
  und das Druckbild bleibt unverändert; die Bestandsschutz-Digests sind allein wegen
  dieser acht Bytes neu gezogen (Gegenprobe byteweise: sonst hat sich nichts verschoben).
  Der ePOS-Weg trägt denselben Bezugsfehler und ist noch offen — die ePOS-Print-Einheit
  des Prüfgeräts war nicht erreichbar, und ungeprüft geht dorthin nichts.
- `MARKE_TEXT` entfällt. Wer die Marke selbst gesetzt hat, nimmt jetzt den Blockart `marke`.
- ESC/POS: `row()` gibt der ersten Spalte am Drucker nur noch links, nie ihre eigentliche
  Ausrichtung — eine zentrierte oder rechtsbündige erste Spalte ließ den Drucker seine
  eigene Ausrichtung sonst auf jede weitere Spalte derselben Zeile anwenden (dieselbe
  Fehlerklasse wie der in 0.24.0/0.25.0 behobene Ausrichtungsfehler, eine Ebene tiefer).
  Die tatsächliche Ausrichtung fließt weiterhin in die von Hand berechnete Position ein.
- ESC/POS: ein `ESC a`, das der Drucker mitten in der Zeile (Spalte ab der zweiten)
  wortlos verwirft, gilt intern nicht mehr als gesetzt — eine spätere, echte Zeile hielt
  sich sonst fälschlich schon für umgestellt und unterließ den Befehl.
- Prüfung: Der Zwillingsabgleich am **Bytestrom** ist jetzt Teil der Test-Suite
  (`test/zwilling-bytestrom.test.ts`) statt eines Skripts von Hand. Vier SHA-256 über den
  fertigen Bon (58/80 mm, mit und ohne Marke) stehen wortgleich im Dart-Paket; wer in
  einem der beiden Pakete am Druckweg dreht, macht dort oder hier rot. Die bisherigen
  gemeinsamen Prüffälle deckten Raster, Zeilen und Blatt ab — alles Stufen vor den Bytes.

## 0.25.0

- ESC/POS: den Sofort-Reset der Ausrichtung direkt nach QR-Code, QR-Rasterbild und
  Logo-Rasterbild entfernt. Er behandelte nur ein Symptom: seit 0.24.0 steht `ESC a`
  ohnehin vor `ESC $`, und eine volle Zeile bekommt gar keinen Positionsbefehl mehr —
  der Ausrichtungsbefehl des naechsten Elements steht damit selbst immer am
  Zeilenanfang und gilt. Der erzeugte Bytestrom ist dadurch wieder deckungsgleich mit
  dem Dart-Zwilling; bisher war dieser Reset der einzige Unterschied zwischen beiden.

## 0.24.0

- ESC/POS: `ESC a` steht vor `ESC $`, eine volle Zeile bekommt keinen Positionsbefehl mehr.
  Der Drucker nimmt die Ausrichtung nur am Zeilenanfang an; bisher blieb nach dem QR-Code die
  Zentrierung stehen und zentrierte jede Zeile darunter ein zweites Mal.

## 0.23.0

### Rechnung: der Rechenkern in ganzen Zahlen

**Anlass:** Vier Umsetzungen (Server, dieses Paket, Dart, Panel) mussten dieselbe
Reihenfolge von Gleitkomma-Schritten nachbauen, damit Grenzfälle gleich runden.
Ein Cent Unterschied im Brutto-Modus hat das am 16.09.2026 sichtbar gemacht.

- **Neu: Unterpfad `@kreiseck/kasseneck-api/rechnung/rechnen`** — rein, ohne
  Transport, auch für den Browser. Darin:
  - `rechnungRechnen(positionen, { priceMode, taxScheme })` rechnet exakt in
    ganzen Zahlen (BigInt) und rundet einmal je USt-Satz. Preise in Millionstel
    Euro, Mengen in Tausendstel, Rabatt und Satz in Hundertstel-Prozent.
  - `positionAusEuro(item)` wandelt eine Euro-Position verlustfrei um oder
    nennt Feld und Grund.
  - `anteiligerPreis`, `satzSchluessel`, `satzText`, `preisText`.
  - `RechenFehler` mit `code` (`amount_too_large`, `kein_ganzzahlwert`,
    `ausserhalb`), Feld und Index.
- **Prüffälle im Paket:** `fixtures/rechnung-rechnen.json` (20 Fälle von
  Hand), `fixtures/rechnung-rechnen-zufall.json` (400 aus einer unabhängigen
  Referenz in Python) und `fixtures/position-aus-euro.json`. Server,
  Dart-Zwilling und Panel werden gegen dieselben Dateien prüfen.
- **Fehlerkatalog um zwei Codes erweitert:** `einvoice_unavailable` (zu dieser
  Rechnung entsteht keine E-Rechnung, Grund im `reason`) und
  `amount_too_large` (Betrag über der Grenze des Ganzzahlkerns) — beide hinten
  angehängt, damit gespeicherte Reihenfolgen gültig bleiben. Der Katalog geht
  dem Server bewusst voraus, damit Fremdsysteme beide Codes behandeln können,
  bevor der Server sie sendet; heute sendet der Server keinen von beiden,
  `amount_too_large` erst ab dessen Umstieg auf den Ganzzahlkern.
- **Unverändert:** `rechnungSummen`, `fixtures/rechnung-summen.json` und Form
  von Anfrage und Antwort der Rechnungs-API — der Fehlerkatalog wächst nur
  additiv (s. o.). Der Kern rundet an Halbcent-Grenzen richtig, `rechnungSummen`
  rechnet weiterhin wie der Server heute; beides wird in 0.24.0
  zusammengeführt. Wer schon vorab genau rechnen will, nimmt `previewInvoice`.

## 0.22.0

### Rechnung: Brutto bleibt Brutto, Hinweise kommen an, Probelauf

**Anlass:** Rückmeldung eines Shops zur Rechnungs-API (16.09.2026).

- **`issueInvoice` gab `notice` nicht weiter.** Der Typ sah die Liste vor, der
  Aufruf übernahm sie nie — eine ig. Lieferung meldete deshalb nie, dass eine
  Zusammenfassende Meldung fällig ist. Behoben.
- **`recordInvoicePayment` liefert `notice` jetzt als Liste** wie
  `issueInvoice` (bisher ein einzelnes Objekt). **Bricht die Form:** wer
  `result.notice.code` las, liest jetzt `result.notice?.[0]?.code`. Ein Server,
  der noch ein Objekt schickt, wird zur Liste gemacht.
- **Neu: `rechnungSummen(items, priceMode, taxScheme?)`** rechnet die Summen so,
  wie der Server sie ausstellt. Im Brutto-Modus ist das Brutto je Satz der
  vereinbarte Preis: Netto = round(B × 100 / (100 + Satz)), USt = B − Netto.
  Der Server rechnete bis dahin Netto und USt getrennt und setzte das Brutto neu
  zusammen — 14,79 € + 15,00 € zu 20 % wurden 29,80 €. Die Prüffälle stehen in
  `fixtures/rechnung-summen.json`; Server und Dart-Zwilling prüfen dagegen.
- **Neu: `previewInvoice(anfrage)`** — Probelauf von `issueInvoice`
  (`dryRun: true` im Vertrag): prüft und rechnet wie das Ausstellen, schreibt
  nichts fest und verbraucht den `idempotencyKey` nicht. Antwort `preview` mit
  Summen, Steuerfall samt Grund, Sprache, Marke, E-Rechnung — dazu die Hinweise.
- **`totals.byRate[]` trägt `grossCents`.** Die Summen sind auch bei
  Gutschriften positiv; das steht jetzt am Typ.
- **Texte:** `pdf.tabelle.einzelBrutto`, `pdf.tabelle.betragBrutto`,
  `pdf.summe.darinUst` — das PDF einer Brutto-Rechnung zeigt Brutto-Spalten,
  deren Zeilen die Summe ergeben. Dazu `pdf.position.rabatt`: ein Zeilenrabatt
  stand bisher nirgends auf dem Blatt, „2 × 24,90 = 44,82" ging für den Leser
  nicht auf.
- **Kennung als Text:** `getInvoice('…')` und `getCustomer('…')` werfen vor dem
  Senden `KasseneckValidationError` (`scope: 'request'`). Bisher wurde der Text
  Zeichen für Zeichen zu Feldern `0`, `1`, … und der Server konnte nur
  „Bitte Eingaben prüfen." antworten.
- **Feldfehler in der Meldung:** `KasseneckApiError.message` hängt bis zu fünf
  Einträge aus `errors[]` an (`[items[0].vatRate: …]`); `serverMessage` und
  `details` bleiben unverändert.

## 0.21.0

### Rechnung: Kataloge für den abgeleiteten Steuerfall

**Anlass:** Der Server leitet den Steuerfall jetzt selbst ab, statt ihn zu
glauben (Kundenland, Kundenart, UID, Ware oder Leistung).

- `taxScheme` ist in `issueInvoice` **optional**; eine Angabe prüft der Server
  gegen die Ableitung (`tax_scheme_mismatch`).
- Neue Fälle `domesticReverseCharge`, `oss` und `outsideScope`; Katalog der elf
  Gründe für den Übergang der Steuerschuld im Inland
  (`REVERSE_CHARGE_REASONS`, mit Fundstelle und Schwelle).
  `oss` steht im Katalog, **kann aber noch nicht ausgestellt werden** —
  die Ländersätze folgen.
- Positionen tragen `kind` (`goods`/`service`), weil ig. Lieferung und Reverse
  Charge sich genau daran unterscheiden.
- `notice` ist an `issueInvoice` eine **Liste**: eine bar bezahlte ig. Lieferung
  trägt zwei Hinweise zugleich.
- Die Rechnungssicht trägt `reverseChargeReason` und `taxCountry`; neuer
  Befreiungstext für den nicht steuerbaren Umsatz (E-Rechnung, BR-O-10).

## 0.20.0

### Rechnung: richtige Steuerhinweise, Barumsatz auch mit Karte

**Anlass:** drei Befunde aus einer Durchsicht an den Primärquellen.

- **Reverse Charge ist keine Steuerbefreiung.** Der Aufdruck hiess
  „Steuerfreie Leistung – Reverse Charge" und behauptete damit eine Befreiung,
  die es nicht gibt: der Umsatz bleibt steuerpflichtig, nur die Steuer schuldet
  der Empfänger. Das Gesetz trennt beides (§ 11 Abs. 1 Z 3 lit. e = Hinweis auf
  eine Befreiung, § 11 Abs. 1a = Hinweis auf die Steuerschuldnerschaft); Art. 226
  Nr. 11a MwSt-RL nennt den Begriff wörtlich. Jetzt:
  „Steuerschuldnerschaft des Leistungsempfängers."
- **Ig. Lieferung** bekommt denselben Kasten wie Reverse Charge, mit **beiden**
  UID-Nummern — Art. 11 Abs. 2 UStG verlangt sie auf der Rechnung. Der
  Textschlüssel `steuer.reverseCharge.uid` heisst darum jetzt `steuer.uidZeile`,
  neu sind `steuer.igLieferung.titel` und `steuer.igLieferung.text`
  (`steuer.igLieferung` entfällt).
- **`onSite` an der Zahlung.** Ein Barumsatz ist nicht nur Bargeld: als
  Barzahlung gilt auch die Karte **vor Ort** (§ 131b Abs. 1 Z 3 UStG), nicht
  aber dieselbe Karte im Internet. Weil `card`/`online` beides sein können,
  sagt es das Fremdsystem jetzt selbst — der Hinweis `cash_receipt_required`
  kommt bei `cash` immer und sonst nur mit `onSite: true`. `transfer` mit
  `onSite` wird abgewiesen.

## 0.19.0

### hobex HPS: TECS-Antwortcodes eingeordnet, Storno nach ausbleibender Host-Antwort

**Anlass:** hobex hat am 16.09.2026 bestätigt, dass das HPS die Codes der
TECS-Plattform durchreicht, und deren Liste geschickt. Zu `9908` (im Betrieb am
11.09.2026 gesehen, bisher unbekannt und damit offen): „ein Timeout wie jeder
andere. Richtigerweise sollte in dem Fall ein Storno nachgeschickt werden.“

- `HPS_CODES` führt jetzt 365 Codes; die TECS-Liste steht in
  `src/payments/hobex-hps/tecs-codes.ts`, eine Zeile je Code.
- `sendReversal` je Code und `needsReversal()`: bei ausbleibender oder
  unbrauchbarer Host-Antwort schickt `pay` genau einmal ein Storno
  (`/v1/terminal/cancel`) nach. Quittiert → `declined` mit
  `'voidedAfterHostFault'`; sonst Klärung wie bisher, ein späteres `9011`
  zählt ebenfalls als storniert. Gutschriften bekommen kein Storno (TECS:
  `9031`).
- `tecsTitle` je Code: der Titel in der TECS-Liste.
- `normalizeHpsCode()`: `0055` und `55` sind derselbe Code; `responseCode`
  kommt normalisiert an (`0000` → `0`), `raw` bleibt unverändert. Familien mit
  Platzhalter (`81xx`) werden gefunden.
- 16 neue Gründe in `HpsCodeReason` und `HPS_REASON_HINTS`, darunter
  `issuerDeclined`, `insufficientFunds`, `cardExpired`, `hostTimeout`,
  `approvedWithCondition`. **Kassen mit eigener Übersetzung brauchen dafür
  Texte.**
- Eine Genehmigung, die nicht `0` ist (`8`, `10`, `11`, `16`, `32`), bleibt
  offen und wird nie zur Ablehnung.
- `9900` ist jetzt `hostUncertain` (`internalError`) statt `noStatement`:
  gemessen kam er nach verarbeiteter Karte, und die Zwei-9027-Regel hätte
  daraus „nichts belastet“ gemacht.
- `fixtures/hobex-hps-codes.json` führt je Code zusätzlich `sendReversal` und
  `tecsTitle`.

## 0.18.0

### Rechnungs-API: bezahlte Rechnung und Zahlungen nachtragen

**Anlass:** Die API wird vor allem von Online-Shops benutzt, die **vor** der
Rechnung kassieren. Bisher entstand immer eine offene Rechnung — mit Giro-QR
und Fälligkeit auf dem Blatt, obwohl das Geld längst da war.

- `issueInvoice` nimmt `payment` (`method`, optional `amountCents`, `paidAt`,
  `reference`). Die Zahlung entsteht in **derselben** Transaktion wie das
  Festschreiben; ohne `amountCents` gilt der volle Bruttobetrag.
- Neuer Aufruf `recordInvoicePayment` für später eintreffende Zahlungen, mit
  **pflichtigem** `idempotencyKey` — ohne ihn bucht ein Wiederholungslauf nach
  einem Zeitlimit eine zweite Zahlung.
- `INVOICE_PAYMENT_METHODS` (`transfer`, `card`, `online`, `cash`);
  `Invoice.paidCents` und `Invoice.openCents`.
- Neue Fehlercodes `not_payable` (storniert oder Gutschrift) und
  `payment_exceeds_invoice` (mit `remainingCents`).
- Neu: **Hinweise** an einer erfolgreichen Antwort (`INVOICE_NOTICE_CODES`,
  `data.notice`). Bisheriger Fall: `cash_receipt_required`. Grund: eine
  Barzahlung ist ein Barumsatz und braucht einen Beleg (§ 132a BAO), bei
  Registrierkassenpflicht über die Registrierkasse — der Bezahlt-Vermerk ist
  Buchhaltung und ersetzt ihn nicht. Die Rechnung selbst ist bei jeder
  Zahlungsart erlaubt (§ 11 UStG), deshalb wird `cash` gebucht und nicht
  abgewiesen.

`reference` wird gespeichert, aber nicht gedruckt: die Rechnung wird sieben
Jahre aufbewahrt und vervielfältigt, und dem Empfänger nützt die Zahlungs-ID
des Shops nichts.

## 0.17.0

### Rechnungs-API: Sprache (de/en) und Marke je Rechnung

**Anlass:** Rechnungen waren fest Deutsch und trugen immer die Standardmarke.
Internationale Kunden bekamen deutsche Rechnungen, und wer mehrere Marken
führt, konnte sie über die API nicht wählen. Eine übersetzte Zweitrechnung mit
eigener Nummer wäre umsatzsteuerlich falsch (UStR Rz 1527) — deshalb eine
Sprache je Rechnung und die andere nur als gekennzeichnete Kopie (Rz 1528).

- `INVOICE_LANGUAGES` (`de`, `en`); Feld `language` am Kunden und an
  `issueInvoice`, `brandId` an `issueInvoice`; `Invoice.language` und
  `Invoice.brand`.
- Neuer Aufruf `listBrands()` → `[{ id, name, isDefault }]`.
- `getInvoicePdf(id, { language })`: in der anderen Sprache eine
  Übersetzungskopie (gleiche Nummer, Vermerk auf jeder Seite, ohne
  eingebettete E-Rechnung).
- Neue Fehlercodes `language_not_allowed` (Behörden nur Deutsch) und
  `brand_not_found` (angegebene Marke gibt es nicht — kein stiller Rückfall).
- **Einheiten als Katalog:** `INVOICE_UNITS` (49 Einheiten) mit UN/ECE-Code in
  `RECHNUNG_EINHEITEN_CODES`; `items[].unit` nimmt nur noch diese Schlüssel.
  Gedruckt wird das Kürzel in der Sprache der Rechnung; freier Text wie `"Std"`
  ist `validation`. Grund: „Stk" stand sonst auch auf englischen Rechnungen.
- Textkatalog `RECHNUNG_TEXTE` / `rechnungText()` und
  `fixtures/rechnung-texte.json`: alle Texte von Rechnung, Gutschrift und
  E-Rechnung in Deutsch und Englisch, Steuerhinweise mit Gesetzesstelle.

## 0.16.0

### Rechnungs-API: Freigabe und Einrichtung vor dem ersten Ausstellen

**Anlass:** Mit 0.15.0 konnte jedes Konto mit aktivem Modul Rechnung sofort
automatisiert Rechnungen mit fortlaufender Nummer ausstellen — auch mit einem
Probezeitraum, ohne Bankverbindung und mit dem ungewollten Standard-Nummernformat,
das sich mit der ersten Rechnung sperrt. Ein Fremdsystem erfuhr erst beim
Festschreiben, dass etwas fehlt.

- Neuer Aufruf `getInvoiceSetupStatus()` → `{ ready, environment, missing }`.
  Er läuft auch ohne Freigabe und vor der Live-Freischaltung, also genau dann,
  wenn man die Antwort braucht.
- `INVOICE_SETUP_REQUIREMENTS`: `module_active`, `api_enabled`, `live_enabled`,
  `business_name`, `address`, `vat_id`, `bank_account`, `number_format`.
- Neue Fehlercodes: `invoice_api_not_enabled` (Kasseneck hat die Rechnungs-API
  für das Konto nicht freigegeben; nur live) und `invoice_setup_incomplete`
  (`details.missing` wie im Status).

## 0.15.0

### Rechnungs-API: Rechnungen statt Belege, per `api_key`

**Anlass:** Fremdsysteme (Shops, Buchhaltungssoftware) konnten Rechnungen nur
über die Endpunkte des Panels anlegen — mit Anmeldung als Mensch, als Entwurf,
ohne geprüfte Eingabe und ohne Schutz vor einer doppelt ausgestellten Rechnung
nach einem Zeitlimit. Eine festgeschriebene Rechnung lässt sich aber nur per
Gutschrift zurücknehmen; ein Doppel ist also teuer.

- Neuer Unterpfad `@kreiseck/kasseneck-api/rechnung` mit `createRechnungApi`:
  Kunden (`createCustomer`, `getCustomer`, `updateCustomer`, `searchCustomers`),
  Rechnungen (`issueInvoice`, `cancelInvoice`, `createCreditNote`, `getInvoice`,
  `listInvoices`) und Dateien (`getInvoicePdf`, `getInvoiceXml`).
- Anmeldung `rechnungKeyAuth`: Kontoschlüssel als Bearer, **ohne**
  Kassen-Token — eine Rechnung entsteht am Konto, nicht an einer Kasse. Ein
  Partner-Schlüssel oder Kassen-Token wird ohne Netzaufruf abgewiesen.
- Der Vertrag steht als Daten in `src/rechnung/vertrag.ts` und wird als
  `fixtures/rechnung-api.schema.json` ausgeliefert (`npm run fixtures:rechnung`),
  dazu Beispielanfragen unter `fixtures/rechnung-api-beispiele/`. Grund: das
  Backend und der Dart-Zwilling prüfen gegen dieselbe Datei — die Feldliste
  kann nicht an drei Stellen auseinanderlaufen.
- `fixtures/oberflaeche.json` führt die elf Aufrufe und einen Abschnitt
  `rechnung` (Fehlercodes, Gutschrift-Gründe, Steuerschemata).
- `getInvoiceXml` liefert das XML als Text im gewohnten Umschlag statt als rohe
  Datei: so bleibt `einvoice_incomplete` ein gewöhnlicher Fehler mit
  `missing[]`, und der Transport braucht keinen dritten Leseweg.

## 0.14.0

### Das Beleg-Blatt: ein Beleg, der überall gleich aussieht

**Anlass:** Derselbe Beleg sah in der App, am Bon, in der Web-Kasse, im Panel
und im PDF verschieden aus. Das Raster war als einzige Wahrheit gedacht, aber
jeder Zeichner setzte Rahmen, Logo und QR selbst: das Panel stellte das Logo
über den Testkassen-Rahmen, das PDF legte es darauf, die App zeigte keins, der
Bon druckte Warnungen invers und doppelt hoch.

- `renderReceiptGrid` gibt Aufdrucke als drei Rasterzeilen aus (`====`, Text,
  `====`). ESC/POS und ePOS drucken sie als normale fette Zeilen — keine doppelte
  Höhe, kein Invertieren mehr. `grid32`/`grid48` der Belege mit Aufdruck ändern
  sich, das Zeilenmodell nicht.
- Bekannter Unterschied, bleibt so: ESC/POS druckt `EUR` statt `€` (die
  Ein-Byte-Codepage des Bondruckers kennt das Zeichen nicht). Bildschirm, PDF
  und ePOS zeigen `€`; die Zeilen sind dadurch am Bon an diesen Stellen anders
  gefüllt, das Raster bleibt gleich breit.
- Neu `belegBlatt(layout, { zeichen, logo, marke, qrGroesse })`: Reihenfolge
  (Aufdrucke oben, Leerzeile, Logo, Leerzeile, Beleg, Marke), Logo-Maß je Stufe
  S/M/L/XL (nie hochgerechnet), QR-Anteil wie am Drucker.
- Ein QR-Inhalt, der in keine QR-Version passt (Korrektur M, mehr als 2331
  Byte), bekommt im Blatt den Anteil 0, statt dass `belegBlatt` wirft. ESC/POS
  und ePOS lassen den QR dann weg und melden es über `qrFehler`; der Beleg steht
  ohne QR. Die Bildschirm-Ansicht ruft `renderQr` weiter mit der Nutzlast, damit
  die Oberfläche den fehlenden QR anzeigen kann (Papierbeleg-Hinweis). **Grund:** Ein Wurf riss jeden Zeichner mit — die Bon-Ansicht der
  Web-Kasse fiel ganz aus, Bon und PDF ebenso. Neu `qrPasstInVersion(nutzlast)`
  (`./printing`); `qrModulAnzahl` wirft weiter.
- Neu `logoRaster` (RGBA → einfarbiges Rasterbild), `escPosRasterBild`,
  `eposBildXml`; `escPosLayoutBytes` und `eposPrintXml` nehmen `logo` und `marke`.
- Neu `BelegBlattView` / `BelegBlattZeilen` (`./react`); `ReceiptLayoutView` ist
  `@deprecated`. `BelegBlattView` zeigt ein Logo ueber 4096x4096px (oder 0)
  ebenso wenig wie ein nicht geladenes -- neu `LOGO_PIXEL_MAX`,
  `logoPixelZulaessig` (`./receipt`). **Grund:** Bildschirm und Bon zeigen
  dasselbe Logo; das Druck-Kit lehnt ein zu grosses Logo beim Rastern fuer
  den Bon schon ab (dieselbe Grenze), der Bildschirm bisher nicht -- ein
  5000x1200px-Logo erschien am Bildschirm und im PDF, aber nie auf dem
  gedruckten Beleg.
- Neu `ReceiptWithCompany.logoStufe` (aus `logo_skala` der Beleg-Antwort,
  Vorgabe `M`): Panel und App kannten die Logo-Stufe des Betriebs bisher nicht.
- `createPrintJob` nimmt `logo` und `marke`: der Netzwerk-Drucker (Connect)
  druckt dasselbe Blatt wie USB, Bluetooth und ePOS direkt. Neu
  `rasterZeilenBase64` (gemeinsam für ePOS-`<image>` und den Druckjob).
- Goldens `erwartet/<name>.blatt32.json`/`.blatt48.json`,
  `erwartet/logo-probe.raster32.txt` (mit Teiltransparenz) und
  `erwartet/logo-probe-hoch.raster32.txt` (höhenbegrenzt) für den Dart-Zwilling.
- `escPosRasterBild` wirft bei einer Bildhöhe über 65535 Punkten (`GS v 0` trägt
  die Höhe in zwei Bytes).

### Achtung: Brüche

- **Aufdrucke im Raster.** `renderReceiptGrid` gibt jeden Aufdruck als drei
  Zeilen `kind:'banner'` aus (`====`, Text, `====`). *Umstellen:* eigene
  Rahmen oder Sonderstile für Aufdrucke entfernen (sie stünden sonst doppelt)
  und nicht annehmen, dass die erste `banner`-Zeile die einzige ist — der Text
  steht in der mittleren.
- **`ReceiptWithCompany.logoStufe` ist Pflicht.** `getReceiptWithCompany` füllt
  es selbst. *Umstellen:* von Hand gebaute Objekte (Tests, Vorschauen) brauchen
  `logoStufe: 'M'`.
- **QR-Vorgabe `auto` deckelt bei 6 Punkten je Modul (vorher 4)** — in npm und
  Dart dasselbe. Am ESC/POS-Bon wird der QR ohne ausdrückliche Wahl größer
  (80 mm: rund 55 % statt 37 % der Breite). *Umstellen:* wer die alte Größe
  will, stellt `qrGroesse: 'klein'`.
- **Nativer ESC/POS-QR mit Fehlerkorrektur M (vorher L)**, wie ePOS, Bildweg
  und Blatt — der Kasten am Bildschirm ist damit genau der gedruckte QR.
  Manche Nutzlasten brauchen eine Version mehr. *Umstellen:* den alten
  Bytestrom liefert `qrCorrection: 'L'` (zusammen mit `qrGroesse: 'klein'`).
- **ePOS-Vorgabe `qrGroesse` ist `auto`** (vorher `mittel`). Derselbe Wert,
  kein Byte anders; nur wer die Vorgabe ausliest oder dokumentiert, merkt es.

## 0.13.2

### Die Paketseite erklaert, wofuer das Paket da ist

**Anlass:** Wer auf npm landet, sah eine Wand aus Technik und nirgends, worum
es geht. Die Seite traegt jetzt das Kasseneck-Logo, einen englischen Einzeiler
fuer Besucher von aussen, und eine Tabelle, welche Pflichten einer
oesterreichischen Registrierkasse wo erledigt werden — mit Verweisen auf die
Wissensseiten und einem ausdruecklichen Hinweis, dass hier kein Rechtsrat steht
und die Verantwortung beim Unternehmer bleibt. Kopf und Fuss nennen Kreiseck
als Absender und verlinken dorthin. Am Code aendert sich nichts.

### Der Vertrag nennt keinen Anmeldedienst mehr beim Namen

**Anlass:** Die Doku sprach an 16 Stellen von einem bestimmten Anbieter,
obwohl das Paket ihn gar nicht kennt: `registerUserAuth` bekommt eine Funktion,
die ein Token liefert — woher es stammt, geht das Paket nichts an. Ein
Implementierungsdetail im Vertrag bindet beide Seiten grundlos aneinander;
jetzt steht dort "ID-Token des Anmeldediensts". Damit verschwindet der Name
auch aus den ausgelieferten Typdeklarationen.

## 0.13.1

### Der 404 beim Abbruch wird benannt, nicht als Abriss gefuehrt

**Anlass:** Am Produktivterminal (TID 3556988, Firmware 2.3.9) antwortet der
Abbruch mit HTTP 404, am Testgeraet nie. Bisher war das im Nachweis nicht von
einem Leitungsabriss zu unterscheiden -- und `steps` ist der Text, der im
Belastungsstreit gelesen wird. Zwilling: kasseneck_api 6.12.1.

- **`NOT_FOUND_HTTP_STATUS`** und **`HpsConnectTerminalError.isNotFound`**
  (wie `isTerminalBusy`: liest bevorzugt `terminalHttpStatus`).
- Der Abbruch schreibt beide Lesarten hin, ohne eine zu behaupten: das
  Terminal kennt entweder den Vorgang nicht oder den Endpunkt nicht. Welche
  zutrifft, ist ungemessen (bei hobex angefragt).
- **Verhalten unveraendert:** weiter klaeren, nie ein Ausgang.

## 0.13.0

### Beleg per E-Mail an den Gast (`sendReceiptEmail`)

**Anlass:** Der Endpunkt ist im Backend live (keck#361), beide Kassen haben den
Weg gebaut — hinter einer Schnittstelle, hinter der nichts stand, weil kein
Paket den Aufruf kannte. Verschickt wird ein **Link auf die öffentliche
Belegseite**, kein PDF im Anhang: die Belegseite führt dasselbe Zeilenmodell
wie Bildschirm und Bon, ein mitgeschicktes PDF wäre dieselbe Sache ein zweites
Mal, nur unveränderlich veraltet. Der Beleg selbst bleibt unberührt (BAO §131 /
RKSV); das Versandprotokoll führt das Backend neben ihm.

- **`sendReceiptEmail({ fullReceiptId, to, sprache? })`** — auch auf der
  Fassade `createKasseneckApi`. Antwort: `{ to, at, via }` — Adresse in der
  protokollierten Form, Zeitpunkt als ISO mit Wiener Zonenoffset, Versandweg
  (`eigen`, `plattform`, `plattform-fallback`; fehlt er, ist `via` `null` und
  nicht etwa ein Fehler — er sagt etwas über den Weg, nichts über den Erfolg).
- **Kein `cashregisterId` in den Optionen.** Die Kasse kommt aus der Anmeldung:
  beim Gerät über die Kopfzeile `cashregister-token`, beim Kassen-Benutzer über
  den Parameter, den `registerUserAuth` ohnehin setzt. Eine dritte Stelle wäre
  nur eine Gelegenheit, eine andere Kasse zu behaupten als die, an der man
  angemeldet ist — und das Backend nimmt den Belegpfad aus der angemeldeten.
- **`RECEIPT_EMAIL_ERROR_CODES`**, Typ `ReceiptEmailErrorCode` und der Wächter
  `isReceiptEmailErrorCode`: `adresse_ungueltig`, `beleg_nicht_gefunden`
  (auch für einen Beleg einer fremden Kasse — das Backend gibt darüber bewusst
  keine Auskunft), `zu_oft` (5 Mails je Beleg in 24 Stunden, 30 je Kasse und
  Stunde) und `versand_fehlgeschlagen`. Die Codes kommen unverändert als
  `KasseneckApiError.code` heraus; das Paket legt keine eigenen an. **Am Code
  entscheiden, nie am deutschen Text.**
- Die Adresse prüft das Paket **nicht** selbst — nur leer/fehlend wird vor dem
  Senden abgewiesen (`fullReceiptId`, `to`; beides getrimmt, weil es von Hand
  ins Feld kommt). Eine zweite, eigene Adressregel könnte strenger sein als die
  des Backends und eine gültige Adresse abweisen, ohne dass es auffällt.
- `sendReceiptEmail` steht in `AUFRUFE` und damit in
  `fixtures/oberflaeche.json` — der Zwilling `kasseneck_api` (Dart) prüft
  dagegen.

## 0.12.0

### Storno mit Kartendaten der Erstattung

**Anlass:** sastre zieht vom alten Storno-Weg (`createCancelReceipt`, ohne
Bezug) auf `cancelReceipt` um. Bei einer Kartenerstattung haengt sastre heute
die Terminaldaten der Gutschrift/Aufhebung an den Stornobeleg -- ueber den
neuen Endpunkt ging das bisher nicht, der Kartenblock fiele vom Storno-Bon.
Backend: keck#371.

- **`cancelReceipt` nimmt `creditCardProvider`, `cardPaymentId` und
  `cardPaymentData` an** -- die Daten der ERSTATTUNG, nie der Originalzahlung.
  Nur bei Rueckzahlweg Karte: ein ausdruecklich anderer `paymentMethod` wird
  schon hier abgewiesen, ohne Angabe entscheidet das Backend an der
  Zahlungsart des Originals. Ein unbekannter Kartenanbieter geht gar nicht erst
  raus.
- Ohne Kartendaten aendert sich nichts.
- `package-lock.json` traegt wieder die Paketversion (stand seit 0.11.0 auf
  0.10.0).

## 0.11.0

### Die QR-Modulgröße wird gerechnet, nicht gesetzt — samt Notausgang und Modell 1

**Anlass:** Am echten Beleg fehlte der QR-Code, die Probe im Drucker-Wizard
druckte ihn. Der native QR-Befehl bekommt eine Modulgröße in Druckpunkten mit
und rechnet nicht nach, ob das Symbol samt Ruhezone auf die Rolle geht. Ein
Beleg-QR mit realer RKSV-Nutzlast hat 57 Module, mit Ruhezone also 65; bei
sechs Punkten je Modul sind das 390 Druckpunkte, und ein 58-mm-Kopf hat 384.
Zu breit heißt bei den meisten Geräten nicht „abgeschnitten", sondern **gar
kein QR**. Der Befund stammt aus dem Flutter-Zwilling `kasseneck_api` (dort
6.9.0), der fest mit sechs Punkten druckte; dieses Paket druckt seit jeher mit
vier und war davon nicht betroffen. Die Regel ist trotzdem dieselbe — sie
deckelt auch eine bewusst gewählte größere Modulgröße gegen den Papierrand ab.

- **Neu `…/printing`: die Rechenregel, rein und ohne Drucker.**
  `qrModulAnzahl(nutzlast)` gibt die Modulanzahl bei Fehlerkorrektur **M**
  (konservativ: der native Befehl druckt mit L, das braucht nie mehr Module);
  `qrGroesseBerechnen({ papierbreitePunkte, moduleAnzahl, groesse })` und
  `qrGroesseFuer({ nutzlast, papierbreitePunkte, groesse })` geben ein
  `QrGroesse` mit `punkte` (`null` = passt nicht), `module`, `breitePunkte`,
  `unterMindestmass` und `passt`. Dazu `QrModulGroesse`, `QR_MODUL_DECKEL`,
  `QR_RUHEZONE_MODULE` (4), `QR_MINDEST_PUNKTE` (4), `QR_AUSNAHME_PUNKTE` (3),
  `QR_HOECHST_PUNKTE` (8) und `QR_DRUCK_PUNKTE` (58 mm = 384, 80 mm = 576 —
  die echte Kopfbreite, nicht die Spaltenbreite 372/558).
- **`escPosQrCode` rechnet, wenn keine feste `size` mitkommt.** `groesse` ist
  ein **Deckel**, keine Vorgabe: gedruckt wird die größte Größe, die noch
  passt, höchstens aber der Deckel. `auto` deckelt beim Bestandswert dieses
  Pakets (4), `klein` 4, `mittel` 6, `gross` 8. **Ohne ausdrückliche Wahl
  ändert sich kein Byte** — nur dort, wo heute gar nichts herauskommt, rechnet
  die Regel herunter. (Im Flutter-Zwilling deckelt `auto` bei 6, weil dort 6
  der Bestandswert ist; die Regel ist dieselbe, der Bestand nicht.)
- **`EscPosDocument.qrFehler` / `.qrAusweich`.** `qrFehler` heißt „Beleg ohne
  QR" — das Symbol passt auch mit der Ausnahmegröße nicht, und ein Befehl, von
  dem man weiß, dass er nichts druckt, täuscht nur einen Ausdruck vor.
  `qrAusweich` heißt „gedruckt, aber nicht auf dem eingestellten Weg" — unter
  der Mindestgröße oder als Bild. Das eine gehört dem Kunden gesagt, das
  andere dem Chef. `escPosReset` räumt beide weg.
- **Neu `…/receipt`: `escPosLayoutErgebnis`** gibt `{ bytes, qrFehler,
  qrAusweich }`; `escPosLayoutBytes` bleibt unverändert und gibt weiter nur
  die Bytes. Neue Optionen `qrGroesse`, `qrModus` (`QrPrintMode`) und
  `qrMatrix`.
- **Der Notausgang.** Passt das Symbol nativ nicht aufs Papier und ist ein
  `qrMatrix` mitgegeben, geht der QR als Rasterbild hinaus (`GS v 0`) statt
  gar nicht — ein Pflichtbeleg ohne QR ist der schlechteste aller Ausgänge.
  Das Raster kommt vom Aufrufer: dieses Paket rechnet keine QR-Codes und
  verarbeitet keine Bilder. Dafür neu `escPosQrRaster`, `qrRasterPunkte` und
  der Typ `QrMatrix`.
- **Modell 1.** `qrCodeBytes(..., { modell1: true })` bzw. `qrModus:
  'nativeModel1'` stellt den Wahlbefehl `GS ( k 04 00 31 41 31 00` voran. Für
  günstige Drucker, die nur diesen älteren Symboltyp beherrschen; belegt ist
  eines, das bei Modell 2 unter dem Code eine „0" ausgibt — das Parameterbyte
  `0x30` des Druckbefehls, das es nicht als Befehl erkennt. Ohne ausdrückliche
  Wahl geht **gar kein** Modellbefehl hinaus, wie bisher.
- **Derselbe Fehler im ePOS-Weg — und dort ist er der akute.** `eposPrintXml`
  setzte `<symbol … width="6">` fest, unabhängig von der Papierbreite: 57
  Module plus Ruhezone sind bei sechs Punkten 390 Druckpunkte, ein 58-mm-Kopf
  hat 384, und der Epson lässt ein zu breites Symbol weg. **Genau daran fehlte
  am echten Beleg der QR.** Jetzt gilt dieselbe Regel — Untergrenze 4,
  Ausnahme 3 mit Meldung, darunter kein `<symbol>`. Der Bestandswert dieses
  Wegs ist 6, deshalb ist die Vorgabe hier der Deckel `mittel`; ohne
  ausdrückliche Wahl ändert sich nur dort etwas, wo heute gar nichts
  herauskommt. Neu `eposPrintXmlErgebnis` (`{ xml, qrFehler, qrAusweich }`) und
  die Optionen `qrGroesse` an `eposPrintXml` und `eposDirectPrint`; `qrBreite`
  bleibt, ist jetzt aber ausdrücklich die **feste** Größe und schaltet die
  Rechnung ab.
- **Bestandsschutz als Golden-Test.** Zwei feste SHA-256 über den gesamten
  Bytestrom eines Belegs (58 und 80 mm) und zwei weitere über das vollständige
  ePOS-XML halten fest, dass sich ohne Wahl kein Byte ändert. Dazu prüft `test/paket-inhalt.test.ts`, dass die Dateiliste des
  Pakets eine Positivliste bleibt und im mitgelieferten `fixtures/` nichts
  Örtliches liegt.

## 0.10.0

### Die Antwortcodeliste von hobex — jeder Code eingeordnet, jeder Ausgang mit Grund

**Anlass:** hobex hat am 11.09.2026 die Antwortcodeliste der HPS-Anwendung
geschickt. Drei der Codes kamen seit dem 28.08.2026 im Betrieb vor (`100004`,
`100005`, `100015`) und waren bis jetzt ungedeutet. Jede Zahlung damit lief in
die Klaerung und endete erst ueber die Zwei-9027-Regel. Zwilling:
`kasseneck_api` 6.10.0 (6.9.0 war inzwischen vergeben), Begruendungen dort in
`doc/kartenzahlung.md`.

- **`HPS_CODES`** fuehrt alle 31 Codes der Liste zusammen mit den gemessenen:
  Code, hobex-Titel, Bedeutung, Wirkung (`effect`), Grund (`reason`) und
  Quelle (`source`). `isConclusive` liest seine Positivliste daraus.
  `HPS_MEASURED_CODES` bleibt als abgekuendigter Name fuer dieselbe Tabelle.
- **Was vor dem Host scheitert, ist eine Ablehnung** (Kartenlesen, EMV-Kernel,
  Eingaben am Geraet, Geraetezustand, fehlerhafte Anfrage) -- `declined`, ohne
  Abbruch und ohne Statusabfrage. Dazu `100029`: das Terminal storniert laut
  hobex selbst.
- **Neu: `effect: 'hostUncertain'`** (`isHostUncertain`) fuer `100006`,
  `100007`, `100023`, `100024`, `100026`, `100027`, `100999`. Der Host war
  beteiligt, das Terminal storniert nicht selbst. Die Zwei-9027-Regel greift
  hier **nicht**; die Klaerung endet nach zwei Abfragen ohne Neues als
  `unresolved`, nur ein `'0'` entscheidet danach noch, und ein Abbruchversuch
  entfaellt. Bei einer Aufhebung entscheidet ein unveraendertes `'0'` auf die
  Originalzahlung dann ebenfalls nichts.
- **`rejectsRequest` / `isConclusiveAsStatus`:** zehn Codes weisen die Anfrage
  selbst ab (`9002`, `100001`, `100008`, `100108`, `100009`, `100010`,
  `100013`, `100018`, `100022`, `100998`). Auf eine Zahlung sind sie deren
  Ablehnung, auf eine Statusabfrage sagen sie nichts ueber den gesuchten
  Vorgang (gemessen fuer `100108`). Die Klaerung liest den Status deshalb
  ueber `isConclusiveAsStatus` -- sonst haette ein gesperrtes Terminal eine
  verlorene Zahlung als "nicht belastet" ausgewiesen.
- **`HpsPaymentResult.reason`** traegt fuer jeden Ausgang den Grund, den Satz
  fuer den Bediener gibt `HPS_REASON_HINTS`. Gesetzt, wo entschieden wurde:
  bestaetigter Abbruch `aborted`, HTTP 409 `terminalBusy`, eine ueber die
  Zwei-9027-Regel geklaerte Zahlung mit dem Grund ihres eigenen Codes.
  `isHostUncertainResult` sagt einer spaeteren Nachfrage, dass ein `9027` dort
  nicht "nicht belastet" heisst.
- `hpsCodeInfo`, `hpsCodeReason` und die Namen aller neuen Codes
  (`CARD_READ_FAILED_CODE` usw.) sind exportiert.
- Der Nachweis nennt bei einer Ablehnung den hobex-Titel mit
  (`Terminal: abgelehnt (100015 "Card declined")`).
- `fixtures/hobex-hps-codes.json` fuehrt je Code zusaetzlich `title`,
  `effect`, `reason`, `source` und die Saetze je Grund (`gruende`).

## 0.9.4

### `qrModus` faengt bei `auto` an — sonst stellte die Vorgabe den Altbestand um

**Anlass:** 0.9.3 gab `qrModus` die harte Vorgabe `raster`. Die Browser-Kasse
druckt den Signatur-QR aber seit jeher ueber den nativen ESC/POS-Befehl; jedes
Geraet, das nie durch den Drucker-Wizard laeuft, haette damit ploetzlich ein
Rasterbild gedruckt — ueber BLE mehrere Sekunden je Bon, und niemand haette
etwas umgestellt.

- **`QR_MODUS` fuehrt jetzt `auto` als ersten Wert**, und
  `KASSE_GERAET_STANDARD.qrModus` steht darauf. `auto` heisst *unbestimmt*: an
  diesem Geraet hat noch niemand am Papier entschieden, jede Kasse bleibt bei
  ihrer bisherigen Praxis (Browser-Kasse ESC/POS, App Rasterbild). Nur ein
  ausdruecklich gesetzter Wert aendert etwas.
- Wer `KasseQrModus` erschoepfend auswertet, bekommt einen dritten Fall.

## 0.9.3

### `qrModus` am Geraet: mit welchem Befehl der Signatur-QR auf den Bon kommt

**Anlass:** Der Drucker-Wizard laesst zwei Probedrucke machen — einen QR als
Rasterbild, einen ueber den nativen ESC/POS-Befehl — und fragt, welcher lesbar
war. Diese Antwort musste bisher nirgends hin: die Kassen druckten fest im
Rastermodus. An Geraeten, die GS v 0 nicht koennen, kam damit ein Bon ohne
lesbaren QR heraus, und das ist nach § 132a BAO keine Belegerteilung — der
Ausfall faellt am Tresen niemandem auf.

- `QR_MODUS` (`raster` | `escpos`) als Laufzeitliste und Typ `KasseQrModus`.
- `KasseSettingsGeraet.qrModus`, Vorgabe `raster` — der bisherige Weg bleibt
  damit fuer jedes bestehende Geraet unveraendert.
- **Am Geraet und nicht am Betrieb:** welchen Befehl ein Thermodrucker
  versteht, entscheidet das Modell an dieser einen Kasse.

## 0.9.2

### Sechzehn Saetze: einen Beleg weitergeben, und der Drucker-Wizard

**Anlass:** Ein alter Beleg soll sich weitergeben lassen — Link kopieren,
teilen, per E-Mail senden — und der Drucker richtet sich kuenftig ueber einen
Wizard ein, der erst testet und bestaetigen laesst und dann speichert. Beides
entsteht **gleichzeitig** in der Browser-Kasse und in der Kassen-App. Ohne
diese Schluessel haetten beide Seiten dieselben sieben Lagen unabhaengig
formuliert, und der Kassier haette zwei verschiedene Woerter fuer dieselbe
Sache gelesen — genau das, wogegen es diesen Katalog gibt.

- **Beleg weitergeben:** `beleg.link_kopiert`, `beleg.teilen_text`
  (`betrieb`, `nummer`, `betrag`, `link`), `beleg.nicht_teilbar`,
  `beleg.test_hinweis_teilen`.
- **Per E-Mail senden:** `beleg.mail_gesendet` (`an`) und die vier Ausgaenge
  `beleg.mail_adresse_ungueltig`, `beleg.mail_zu_oft`,
  `beleg.mail_fehlgeschlagen`, `beleg.mail_nicht_gefunden`.
- **Drucker-Wizard** (beide Kassen, deshalb ohne `nur`):
  `druck.wizard_verbinden` (`name`), `druck.wizard_testdruck_frage`,
  `druck.wizard_qr_frage`, `druck.wizard_qr_keiner_hinweis`,
  `druck.wizard_nichts_gekommen`, `druck.wizard_gespeichert` (`name`),
  `druck.wizard_abgebrochen`.

**Neu: `BELEG_MAIL_FEHLER` und `belegMailFehler(code)`** — die Zuordnung vom
`code` des Backends (`adresse_ungueltig`, `zu_oft`, `versand_fehlgeschlagen`,
`beleg_nicht_gefunden`) auf den Satz. Grund: die vier Ausgaenge verlangen vom
Kassier vier verschiedene Handlungen, und beide Kassen sollen am **Code**
entscheiden statt an einer Formulierung, die sich im Backend jederzeit aendern
darf. Ein unbekannter Code faellt auf `beleg.mail_fehlgeschlagen` zurueck — ein
leerer Schirm waere schlimmer als ein zu allgemeiner Satz. Die Zuordnung steht
als `belegMailFehler` mit in `fixtures/kasse-texte.json`, weil die App den
Katalog aus dem Tarball liest und das Web die Quelle direkt importiert.

Bewusst ein Objekt und **keine** Liste in Grossschrift: der
Oberflaechen-Vertrag liest jede exportierte Liste als Enum der
Kasseneinstellungen ein, und der Dart-Zwilling schickt deren Werte durch
`KasseSettings.aus`. Fehlercodes haetten dort nichts verloren.

**Abweichung von der Vorlage, bewusst:** `beleg.mail_nicht_gefunden` sagt
„Dieser Beleg wurde nicht gefunden — er konnte nicht gesendet werden." und
nicht denselben Satz wie das schon vorhandene `beleg.nicht_gefunden`. Dort
scheitert das Oeffnen, hier das Senden; der Kassier steht vor einem Adressfeld
und muss lesen, dass nichts hinausgegangen ist. Ein Satz zweimal im Katalog
faellt ohnehin schon seit 0.9.1 im Test auf.

**Neue abgeleitete Pruefungen:** kein Satz zum Weitergeben eines Belegs ist an
eine Seite gebunden; der Teilen-Text traegt den Link, und zwar am Schluss;
jeder platzhalterlose `beleg.mail_`-Satz haengt an genau einem Backend-Code (und
kein Code an zweien); der einzige `beleg.mail_`-Satz mit Platzhalter ist der
ueber das Gelingen; jeder Satz des Wizards gilt auf beiden Seiten.

`FEHLERREGELN` bleibt unveraendert: die Codes sind die Verfeinerung **eines**
Aufrufs (`sendReceiptEmail`), keine neue Art, einen Transportfehler
einzuordnen.

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
