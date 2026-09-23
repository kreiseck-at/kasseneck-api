# @kreiseck/kasseneck-api (Deutsch)

**Registrierkasse nach RKSV für JavaScript und TypeScript.** Kasseneck ist eine
österreichische Registrierkasse; dieses Paket ist der Client dafür. Ihr Code
stellt Belege aus, das Kasseneck-Backend signiert und verkettet sie, und das
Paket liefert das Ergebnis als typisierte Objekte. Dazu kommen Storno,
Kartenzahlung, Beleg-Layout und Bondruck (ESC/POS, Epson ePOS, WebUSB), die
Partner-API und die Rechnungs-API.

Die vollständige Dokumentation steht auf Englisch in der
[README.md](https://github.com/kreiseck-at/kasseneck-api/blob/main/README.md).

## Installation

```bash
npm install @kreiseck/kasseneck-api
```

Node ab 20.18, läuft auch im Browser; keine Laufzeitabhängigkeiten. React ist
optional und nur für `@kreiseck/kasseneck-api/react` nötig.

## Ein Beleg in wenigen Zeilen

```ts
import { createKasseneckApi, apiKeyAuth, KeckPaymentMethod, VatRate } from '@kreiseck/kasseneck-api';
import { buildReceiptLayout, escPosLayoutBytes } from '@kreiseck/kasseneck-api/receipt';

const api = createKasseneckApi({
  auth: apiKeyAuth({ apiKey: 'kr_live_…', cashregisterToken: 'cb_live_…' }),
});

const { receipt, company, testKasse, testSignatur, pruefangaben } = await api.sellReceiptWithCompany({
  paymentMethod: KeckPaymentMethod.cash,
  items: [{ name: 'Café Latte', quantity: 2, vat: VatRate.vat20, priceCents: 390 }],
});

const layout = buildReceiptLayout(receipt, company, { paperSize: 'mm58', testKasse, testSignatur, pruefangaben });
const bytes = escPosLayoutBytes(layout);   // für den Bondrucker
```

Beträge sind immer ganze Cent (`priceCents`), Mengen am Beleg ganze Zahlen.
Fehler kommen als geworfene Ausnahme; fachliche Fehler tragen einen stabilen
`code`, an dem man entscheidet, nicht am Text.

## Welche RKSV-Pflichten die Software abdeckt

| Aufgabe | Wo sie erledigt wird |
| --- | --- |
| [Signaturerstellungseinheit](https://kasseneck.at/wissen/signaturerstellungseinheit) | Kasseneck, nichts zu installieren |
| [Verkettung und DEP](https://kasseneck.at/wissen/dep), Umsatzzähler | Kasseneck-Backend |
| [Startbeleg, Monatsbeleg, Jahresbeleg](https://kasseneck.at/wissen/startbeleg-monatsbeleg-jahresbeleg) | Kasseneck, automatisch |
| [Meldungen an FinanzOnline](https://kasseneck.at/wissen/finanzonline): Anmeldung, Ausfall, Außerbetriebnahme | Kasseneck-Backend übermittelt sie |
| [Belegerteilungspflicht](https://kasseneck.at/wissen/belegerteilungspflicht) | **dieses Paket**: Bon, PDF, Bildschirm oder Link |
| [Ausfall der Signatureinheit](https://kasseneck.at/wissen/ausfall) | Kasseneck, automatisch |
| [Kassennachschau](https://kasseneck.at/wissen/kassennachschau): DEP-Export | Kasseneck |
| Anmeldepflicht der Kasse, Aufbewahrung, steuerliche Würdigung | **beim Unternehmer** |

> **Kein Rechts- oder Steuerrat.** Die Tabelle beschreibt, was die Software
> tut. Sie ersetzt keine Beratung und sichert nicht zu, dass ein bestimmter
> Betrieb damit alle Pflichten erfüllt. Verbindlich sind BAO, RKSV und die
> Erlässe des BMF; Anmeldung, Betrieb und Aufbewahrung bleiben Sache des
> Unternehmers, auch wo die Software die Meldungen übermittelt. Ausführlich
> und mit Quellen: [kasseneck.at/wissen](https://kasseneck.at/wissen).
> Stand: September 2026.

## Weiter

- Vollständige Dokumentation (Englisch):
  [README.md](https://github.com/kreiseck-at/kasseneck-api/blob/main/README.md)
- Schnittstelle: [kasseneck.at/api-doku](https://kasseneck.at/api-doku)
- Fertige Registrierkasse ohne Programmieren: [kasseneck.at](https://kasseneck.at)
- Kontakt für Integrationen und Partnerschaften:
  [kasseneck.at/kontakt](https://kasseneck.at/kontakt)

**Kasseneck** ist ein Produkt von
[Kreiseck Software Solutions](https://kreiseck.com) aus Salzburg.
Lizenz: Apache-2.0.
