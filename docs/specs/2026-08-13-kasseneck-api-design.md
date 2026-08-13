# Spec: `@kreiseck/kasseneck-api` — der JavaScript-Zwilling

**Datum:** 2026-08-13 · **Größe:** L · **Status:** specced
**Block B** der Browser-Kasse (Übersicht: `kasseneck/docs/backlog.md`, Eintrag `browser-kasse`)

## Ziel

Ein npm-Client für das Kasseneck-Backend — der **Zwilling** von `kasseneck_api` (pub.dev, Flutter).
Gleiche Modelle, gleiche Enums, gleiche Werte. Nicht „ähnlich", sondern gleich: Beide sprechen
dasselbe Backend, und ein abweichender Steuersatz-Schlüssel oder Belegtyp fällt sonst erst im
Betrieb auf.

**Erster Verbraucher** ist die Browser-Kasse (Block C, `apps/kasse` im Web-Monorepo). Das Paket ist
aber kein Anhängsel davon: Es ist der veröffentlichte Client, den auch Dritte einsetzen können —
genau wie das Flutter-Paket.

**Erfolgskriterium:** Die Browser-Kasse kann ausschließlich über dieses Paket kassieren — kein
direkter `fetch` auf einen Backend-Endpunkt in der Anwendung.

**Nicht in diesem Scope:** die Kasse selbst (Block C), Drucker- und Terminal-**Transport** (Block D).

## Verhältnis zum Flutter-Paket

Das Flutter-Paket (`kasseneck_api` 4.8.0) enthält Modelle, Enums, den RKSV-Service, ESC/POS-Druck,
Terminal-Anbindungen, ein Beleg-Widget und Berichte.

**Übertragbar:** Modelle, Enums, API-Client, ESC/POS-**Erzeugung** (reine Bytefolgen-Logik),
Beleg-Darstellung, Hobex **Cloud** und Stripe-Zahllinks (beides HTTP).

**Nicht übertragbar, und zwar grundsätzlich:** Hobex **HPS** spricht lokal über TCP mit dem Terminal,
myPOS und SumUp sind Android-SDKs. Ein Browser kann das nicht, und kein Bündler ändert daran etwas.
Das gehört als Kommentar in den Code, damit niemand es später „nachrüstet".

**Parallele Versionierung:** Gleiche fachliche Änderung → gleiche Versionsnummer in beiden Paketen.
SumUp wird aus dem Flutter-Paket herausgelöst (Block E), damit die beiden sich wieder decken.

### Gleichheits-Wächter

Ein Test vergleicht die Enum-Werte gegen einen **eingecheckten Abzug der Dart-Enums**. Driften die
Pakete auseinander, bricht er. Vorbild: `rksv-package-equiv.test.js` im Backend, das dieselbe Frage
zwischen Backend und Paket stellt.

Der Abzug wird bewusst eingecheckt und nicht zur Laufzeit aus dem Flutter-Repo gelesen: Ein Wächter,
der ein zweites Repository braucht, läuft irgendwann nicht mehr und wird dann abgeschaltet.

## Aufbau

```
src/
  models/      Beleg, Position, Gutschein, Kasse, Kunde, Rechnung, Bericht
  enums/       Belegtyp, Zahlungsart, Steuersatz, Kartenanbieter, Gutscheinart, …
  client/      API-Client + Anmeldung
  printing/    ESC/POS-Erzeugung (Bytefolgen, kein Transport)
  receipt/     Beleg-Layout (ohne Framework)
  payments/    Hobex Cloud, Stripe-Zahllinks
react/         dünner Adapter, eigener Einstiegspunkt
```

**Unterpfad-Exporte** wie bei `@kreiseck/rksv`: `.`, `./react`, `./printing`, `./payments`.
So zieht sich niemand den React-Adapter in ein Node-Programm.

## Anmeldung: zwei Wege, ein Client

Das ist die zentrale Neuerung gegenüber dem Flutter-Paket. Es kennt nur den `api_key`; im Browser
gibt es den nicht mehr:

| Weg | Wer | Wie |
|-----|-----|-----|
| `api_key` | Geräte, POS-Apps, Dritte | `Authorization: Bearer <api_key>` + `cashregister-token`-Header |
| Kassen-Benutzer | Browser-Kasse | Firebase-ID-Token als Bearer + `register-session`-Header, Kasse als Parameter |

Der Client nimmt beides über eine **austauschbare Anmeldung** entgegen (ein Objekt, das die Header
liefert und das Token bei Bedarf erneuert). Er bevorzugt keinen der beiden Wege — sonst wäre der
zweite dauerhaft ein Sonderfall.

**Wichtig:** Der Kassen-Benutzer-Weg braucht keine Kenntnis von Firebase im Paket. Das Paket bekommt
eine Funktion, die ein gültiges Token liefert; woher es stammt, ist Sache des Verbrauchers.

## Beleg-Darstellung

Der Kern erzeugt aus einem Beleg ein **Layout-Modell** (Zeilen, Ausrichtung, Betonung, Trenner) —
nutzbar im Browser, in Node für ein PDF, und als Vorlage für den ESC/POS-Erzeuger.

Der **React-Adapter** zeichnet dieses Modell. Er ist ein eigener Einstiegspunkt und React eine
Peer-Abhängigkeit, damit das Paket ohne React nutzbar bleibt.

## Modul-Format — bewusste Abweichung

Die bestehenden `@kreiseck`-Pakete sind CommonJS. Das passt für Behörden-Anbindungen, die
serverseitig laufen. Dieses Paket läuft im **Browser**, gebündelt von Vite — dort ist **ESM** das
richtige Format.

Deshalb: **ESM als Hauptformat, CommonJS zusätzlich** für Node-Verbraucher. Zwei `tsc`-Läufe, wie es
`@kreiseck/rksv` mit seinen drei tsconfigs ohnehin vormacht. Übernommen werden dagegen:
`tsc`-Bau nach `dist/`, `node --test`, Unterpfad-Exporte, `files`, `publishConfig`, Apache-2.0,
`NOTICE`, Node ≥ 20.18.

## Tests

Nach dem Muster der bestehenden Pakete (`node --test` auf übersetztem Testcode), plus:

- **Gleichheits-Wächter** gegen den Dart-Enum-Abzug (siehe oben)
- **Vertragstests** für jeden Client-Aufruf: welcher Endpunkt, welche Parameter — die Stelle, an der
  ein Tippfehler sonst erst in Produktion auffällt
- **Beide Anmeldewege** je Aufruf: derselbe Aufruf erzeugt mit `api_key` die eine, mit
  Kassen-Benutzer die andere Kopfzeile
- **ESC/POS**: erzeugte Bytefolgen gegen feste Erwartungswerte — hier zählt jedes Byte
- Für sicherheitsrelevante Zusagen gilt die **Rot-Probe**: Eigenschaft brechen, Fehlschlag belegen,
  zurücknehmen

## Offene Punkte

- **Veröffentlichung** erst, wenn der Durchstich mit der Kasse steht; bis dahin lokale Verknüpfung.
  Ein Paket zu veröffentlichen, dessen erster Verbraucher noch nicht existiert, legt eine
  Schnittstelle fest, die man beim ersten echten Gebrauch bereut.
- **GitHub-Repo** (`kreiseck-at`) anlegen — vor dem ersten Push zu entscheiden.
- Welche Berichts- und Rechnungs-Endpunkte der erste Wurf abdeckt, entscheidet sich am Bedarf der
  Kasse; das Flutter-Paket kann hier mehr, als Block C braucht.
