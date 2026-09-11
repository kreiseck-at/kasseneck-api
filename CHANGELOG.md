# Änderungen

Was vor 0.7.0 geschah, steht in der Commit-Historie (`git log`); ab hier wird
es hier geführt. Ein Eintrag nennt die Änderung **und ihren Grund** —
nur der Grund überlebt den nächsten Umbau.

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
`kasseneck_api` 6.9.0, Begruendungen dort in `doc/kartenzahlung.md`.

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
