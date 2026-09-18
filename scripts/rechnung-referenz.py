#!/usr/bin/env python3
"""Unabhaengige Referenz fuer den Ganzzahl-Rechenkern der Rechnung.

Erzeugt die Pruefdatei fixtures/rechnung-rechnen-zufall.json und prueft sie
wieder. Absichtlich anders gebaut als src/rechnung/rechnen.ts: exakte Brueche
statt eines gemeinsamen Nenners, Rundung ueber Fraction-Vergleich statt ueber
(2a+b)/(2b). Ein gemeinsamer Denkfehler faellt dadurch auf.

  python3 scripts/rechnung-referenz.py --erzeuge --seed 20260918 --anzahl 400
  python3 scripts/rechnung-referenz.py --pruefe fixtures/rechnung-rechnen-zufall.json
"""
from __future__ import annotations

import argparse
import json
import random
from fractions import Fraction
from pathlib import Path

STEUERFREI = {
    "smallBusiness", "reverseCharge", "igLieferung",
    "exportThirdCountry", "domesticReverseCharge", "outsideScope",
}
TAX_SCHEMES = [
    "normal", "smallBusiness", "reverseCharge", "igLieferung",
    "exportThirdCountry", "domesticReverseCharge", "oss", "outsideScope",
]
GRENZE_CENTS = 99_999_999_999


def rund(x: Fraction) -> int:
    """Kaufmaennisch, halbe Einheit vom Nullpunkt weg."""
    vorzeichen = -1 if x < 0 else 1
    betrag = abs(x)
    ganz = int(betrag)
    rest = betrag - ganz
    if rest > Fraction(1, 2) or rest == Fraction(1, 2):
        ganz += 1
    return vorzeichen * ganz


def zeilenbetrag(p: dict) -> Fraction:
    """Zeile in Cent, exakt."""
    return (
        Fraction(p["unitPriceMicros"], 10 ** 6)
        * Fraction(p["quantityMilli"], 10 ** 3)
        * Fraction(10_000 - p.get("discountBp", 0), 10_000)
        * 100
    )


def verteile(zeilen: list[tuple[int, Fraction]], ziel: int) -> dict[int, int]:
    """Startwert gerundet, Rest nach exaktem Abstand, bei Gleichstand frueher."""
    wert = {i: rund(x) for i, x in zeilen}
    rest = ziel - sum(wert.values())
    if rest:
        schritt = 1 if rest > 0 else -1
        kandidaten = sorted(
            (i for i, x in zeilen if x != 0),
            key=lambda i: (-schritt * (dict(zeilen)[i] - wert[i]), i),
        )
        k = 0
        while rest and kandidaten:
            wert[kandidaten[k % len(kandidaten)]] += schritt
            rest -= schritt
            k += 1
    return wert


def rechne(positionen: list[dict], price_mode: str, tax_scheme: str = "normal") -> dict:
    steuerfrei = tax_scheme in STEUERFREI
    brutto_preise = price_mode == "gross" and not steuerfrei

    je_satz: dict[int, list[tuple[int, Fraction]]] = {}
    saetze: list[int] = []
    for i, p in enumerate(positionen):
        satz = 0 if steuerfrei else p.get("vatRateBp", 0)
        saetze.append(satz)
        je_satz.setdefault(satz, []).append((i, zeilenbetrag(p)))

    by_rate = []
    lines: list[dict | None] = [None] * len(positionen)
    for satz, zeilen in je_satz.items():
        s = sum((x for _, x in zeilen), Fraction(0))
        r = Fraction(satz, 10_000)
        if brutto_preise:
            gross = rund(s)
            net = rund(Fraction(gross) / (1 + r))
            vat = gross - net
            netto_zeilen = [(i, x / (1 + r)) for i, x in zeilen]
            brutto_zeilen = zeilen
        else:
            net = rund(s)
            vat = rund(s * r)
            gross = net + vat
            netto_zeilen = zeilen
            brutto_zeilen = [(i, x * (1 + r)) for i, x in zeilen]
        netto_je_zeile = verteile(netto_zeilen, net)
        brutto_je_zeile = verteile(brutto_zeilen, gross)
        for i, _ in zeilen:
            lines[i] = {
                "netCents": netto_je_zeile[i],
                "grossCents": brutto_je_zeile[i],
                "rateBp": satz,
            }
        by_rate.append({"rateBp": satz, "netCents": net, "vatCents": vat, "grossCents": gross})

    by_rate.sort(key=lambda b: -b["rateBp"])
    return {
        "netCents": sum(b["netCents"] for b in by_rate),
        "vatCents": sum(b["vatCents"] for b in by_rate),
        "grossCents": sum(b["grossCents"] for b in by_rate),
        "byRate": by_rate,
        "lines": lines,
    }


# Pflichtklassen: von Hand gewaehlte Grenzfaelle, die garantiert in der Datei
# stehen (nicht nur zufaellig auftauchen). "ueber 2^53" und "ueber 2^63"
# pruefen, dass der Zwischenwert Preis * Menge * Rabattzaehler die
# Genauigkeitsgrenze eines float64-Mantissenbereichs (2^53) bzw. eines
# vorzeichenbehafteten 64-Bit-Ganzzahlbereichs (2^63) ueberschreitet, ohne
# dabei die Rechnungsobergrenze (99.999.999.999 Cent) zu verletzen — sonst
# waere der Fall gar nicht erst gueltig und ein reiner Fall fuer Aufgabe 3.
PFLICHT = [
    ("Zwischenprodukt ueber 2^53", [{"unitPriceMicros": 999_999_999_999, "quantityMilli": 10_000, "vatRateBp": 2000}], "net", "normal"),
    ("Zwischenprodukt ueber 2^63", [{"unitPriceMicros": 1_000_000_000_000, "quantityMilli": 50_000_000, "discountBp": 9999, "vatRateBp": 2000}], "net", "normal"),
    ("negativer Rest bei der Verteilung", [{"unitPriceMicros": 6000, "quantityMilli": 1000, "vatRateBp": 0}, {"unitPriceMicros": 6000, "quantityMilli": 1000, "vatRateBp": 0}], "net", "normal"),
    ("Abzugszeile", [{"unitPriceMicros": 100_000_000, "quantityMilli": 1000, "vatRateBp": 2000}, {"unitPriceMicros": 10_000_000, "quantityMilli": -1000, "vatRateBp": 2000}], "net", "normal"),
    ("Rabatt 100 %", [{"unitPriceMicros": 99_990_000, "quantityMilli": 3000, "discountBp": 10_000, "vatRateBp": 2000}], "net", "normal"),
    ("Menge 0", [{"unitPriceMicros": 5_000_000, "quantityMilli": 0, "vatRateBp": 2000}], "net", "normal"),
    ("Gleichstand", [{"unitPriceMicros": 2_810_000, "quantityMilli": 2977, "vatRateBp": 2000}, {"unitPriceMicros": 810_000, "quantityMilli": 2377, "vatRateBp": 2000}], "net", "normal"),
    ("halber Cent netto", [{"unitPriceMicros": 21_350_000, "quantityMilli": 1000, "vatRateBp": 1000}], "net", "normal"),
    ("halber Cent brutto", [{"unitPriceMicros": 10_030_000, "quantityMilli": 500, "vatRateBp": 2000}], "gross", "normal"),
    ("steuerfrei", [{"unitPriceMicros": 12_000_000, "quantityMilli": 1000, "vatRateBp": 2000}], "gross", "smallBusiness"),
]

REALISTISCHE_SAETZE = [0, 490, 1000, 1300, 1900, 2000]


def ueber_grenze(p: dict) -> bool:
    """Wie der Kern: eine einzelne Zeile darf die Obergrenze nicht ueberschreiten."""
    return abs(zeilenbetrag(p)) > GRENZE_CENTS


def ergebnis_ueber_grenze(ergebnis: dict) -> bool:
    return any(abs(ergebnis[feld]) > GRENZE_CENTS for feld in ("netCents", "vatCents", "grossCents"))


def zufalls_position(rng: random.Random) -> dict:
    wuerfel = rng.random()
    if wuerfel < 0.03:
        # Selten: beide Seiten gross wuerfeln. Ein Teil davon ueberschreitet die
        # Obergrenze und wird vom Aufrufer verworfen (siehe zufalls_fall) — das
        # ist gewollt: die Erzeugung soll das auch tatsaechlich einmal treffen.
        preis = rng.randint(0, 1_000_000_000_000)
        menge = rng.randint(-1_000_000_000_000, 1_000_000_000_000)
    elif wuerfel < 0.12:
        # Eine Seite gross, die andere massvoll — bleibt fast immer im Rahmen.
        if rng.random() < 0.5:
            preis = rng.randint(0, 1_000_000_000_000)
            menge = rng.randint(-500_000, 500_000)
        else:
            preis = rng.randint(0, 5_000_000_000)
            menge = rng.randint(-1_000_000_000_000, 1_000_000_000_000)
    else:
        preis = rng.randint(0, 5_000_000_000)
        menge = rng.randint(-500_000, 500_000)

    rabatt = 0 if rng.random() < 0.6 else rng.randint(0, 10_000)
    if rng.random() < 0.8:
        satz = rng.choice(REALISTISCHE_SAETZE)
    else:
        satz = rng.randint(0, 10_000)

    p: dict = {"unitPriceMicros": preis, "quantityMilli": menge, "vatRateBp": satz}
    if rabatt:
        p["discountBp"] = rabatt
    return p


def zufalls_fall(rng: random.Random, index: int) -> dict | None:
    anzahl_pos = rng.choices([1, 2, 3, 4, 5], weights=[35, 30, 20, 10, 5])[0]
    positionen = [zufalls_position(rng) for _ in range(anzahl_pos)]
    if any(ueber_grenze(p) for p in positionen):
        return None

    price_mode = "net" if rng.random() < 0.5 else "gross"
    if rng.random() < 0.25:
        tax_scheme = rng.choice([s for s in TAX_SCHEMES if s != "normal"])
    else:
        tax_scheme = "normal"

    ergebnis = rechne(positionen, price_mode, tax_scheme)
    if ergebnis_ueber_grenze(ergebnis):
        return None

    name = f"Zufall {index:03d}: {anzahl_pos} Position(en), {price_mode}, {tax_scheme}"
    fall: dict = {"name": name, "priceMode": price_mode}
    if tax_scheme != "normal":
        fall["taxScheme"] = tax_scheme
    fall["positionen"] = positionen
    fall["erwartet"] = ergebnis
    return fall


def erzeuge_faelle(seed: int, anzahl: int) -> tuple[list[dict], int]:
    faelle: list[dict] = []
    for name, positionen, price_mode, tax_scheme in PFLICHT:
        ergebnis = rechne(positionen, price_mode, tax_scheme)
        fall: dict = {"name": name, "priceMode": price_mode}
        if tax_scheme != "normal":
            fall["taxScheme"] = tax_scheme
        fall["positionen"] = positionen
        fall["erwartet"] = ergebnis
        faelle.append(fall)

    rng = random.Random(seed)
    verworfen = 0
    index = 1
    while len(faelle) < anzahl:
        fall = zufalls_fall(rng, index)
        index += 1
        if fall is None:
            verworfen += 1
            continue
        faelle.append(fall)
    return faelle, verworfen


def komprimiert(objekt) -> str:
    return json.dumps(objekt, ensure_ascii=False, separators=(", ", ": "))


def formatiere_fall(fall: dict, einzug: str) -> str:
    inner = einzug + "  "
    zeilen = [f"{einzug}{{"]
    zeilen.append(f'{inner}"name": {json.dumps(fall["name"], ensure_ascii=False)},')
    zeilen.append(f'{inner}"priceMode": {json.dumps(fall["priceMode"])},')
    if "taxScheme" in fall:
        zeilen.append(f'{inner}"taxScheme": {json.dumps(fall["taxScheme"])},')
    positionen = ",\n".join(f"{inner}  {komprimiert(p)}" for p in fall["positionen"])
    zeilen.append(f'{inner}"positionen": [\n{positionen}\n{inner}],')
    e = fall["erwartet"]
    by_rate = ",\n".join(f"{inner}    {komprimiert(b)}" for b in e["byRate"])
    lines = ",\n".join(f"{inner}    {komprimiert(l)}" for l in e["lines"])
    zeilen.append(f'{inner}"erwartet": {{')
    zeilen.append(f'{inner}  "netCents": {e["netCents"]},')
    zeilen.append(f'{inner}  "vatCents": {e["vatCents"]},')
    zeilen.append(f'{inner}  "grossCents": {e["grossCents"]},')
    zeilen.append(f'{inner}  "byRate": [\n{by_rate}\n{inner}  ],')
    zeilen.append(f'{inner}  "lines": [\n{lines}\n{inner}  ]')
    zeilen.append(f"{inner}}}")
    zeilen.append(f"{einzug}}}")
    return "\n".join(zeilen)


BESCHREIBUNG = (
    "Zufällig erzeugte Prüffälle des Ganzzahl-Rechenkerns (rechnungRechnen). "
    "Erzeugt von scripts/rechnung-referenz.py (npm run fixtures:rechnungzufall), "
    "nicht von Hand — für Handfälle siehe rechnung-rechnen.json. Preise in "
    "Millionstel Euro, Mengen in Tausendstel, Rabatt und Satz in "
    "Hundertstel-Prozent, Beträge in Cent. Die Pflichtklassen (2^53/2^63, "
    "Abzugszeile, Rabatt 100 %, Menge 0, Gleichstand, halber Cent, steuerfrei) "
    "sind garantiert enthalten, der Rest ist mit festem Seed gewürfelt."
)

REGEL = {
    "zeile": "Preis × Menge × (10000 − Rabatt) ÷ 10^11 Cent, exakt als Bruch",
    "net": "Netto = rund(Σ Zeilen); USt = rund(Σ Zeilen × Satz ÷ 10000); Brutto = Netto + USt",
    "gross": "Brutto B = rund(Σ Zeilen); Netto = rund(B × 10000 ÷ (10000 + Satz)); USt = B − Netto",
    "steuerfrei": "smallBusiness, reverseCharge, igLieferung, exportThirdCountry, domesticReverseCharge, outsideScope: jede Zeile zu 0 %",
    "rundung": "kaufmännisch, halbe Einheit vom Nullpunkt weg, auf dem Bruch",
    "zeilen": "Startwert kaufmännisch gerundet, Rest nach exaktem Abstand, bei Gleichstand an die frühere Zeile; eine Zeile über 0 bekommt nie einen Cent",
}


def schreibe_datei(pfad: Path, seed: int, faelle: list[dict]) -> None:
    teile = ["{\n"]
    teile.append(f'  "beschreibung": {json.dumps(BESCHREIBUNG, ensure_ascii=False)},\n')
    teile.append(f'  "seed": {seed},\n')
    teile.append(f'  "anzahl": {len(faelle)},\n')
    regel_text = json.dumps(REGEL, ensure_ascii=False, indent=2).replace("\n", "\n  ")
    teile.append(f'  "regel": {regel_text},\n')
    teile.append('  "faelle": [\n')
    teile.append(",\n".join(formatiere_fall(f, "    ") for f in faelle))
    teile.append("\n  ]\n")
    teile.append("}\n")
    text = "".join(teile)
    # Selbstpruefung: die Datei muss gueltiges JSON sein und beim Rueckparsen
    # exakt dieselben Faelle ergeben wie die erzeugten.
    geparst = json.loads(text)
    assert geparst["faelle"] == faelle, "Formatierung hat den Inhalt veraendert"
    pfad.write_text(text, encoding="utf-8")


def pruefe_datei(pfad: Path) -> int:
    daten = json.loads(pfad.read_text(encoding="utf-8"))
    faelle = daten["faelle"]
    abweichungen = 0
    for f in faelle:
        erhalten = rechne(f["positionen"], f["priceMode"], f.get("taxScheme", "normal"))
        if erhalten != f["erwartet"]:
            abweichungen += 1
            print(f"ABWEICHUNG bei \"{f['name']}\": erwartet {f['erwartet']}, erhalten {erhalten}")
    print(f"{len(faelle)} Faelle geprueft, {abweichungen} Abweichungen")
    return abweichungen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--erzeuge", action="store_true", help="Datei neu erzeugen")
    parser.add_argument("--pruefe", metavar="DATEI", help="bestehende Datei gegen die Referenz pruefen")
    parser.add_argument("--seed", type=int, default=20260918)
    parser.add_argument("--anzahl", type=int, default=400)
    parser.add_argument("--ziel", default="fixtures/rechnung-rechnen-zufall.json")
    args = parser.parse_args()

    if args.erzeuge:
        faelle, verworfen = erzeuge_faelle(args.seed, args.anzahl)
        ziel = Path(args.ziel)
        schreibe_datei(ziel, args.seed, faelle)
        print(f"{len(faelle)} Faelle nach {ziel} geschrieben (seed {args.seed}, {verworfen} verworfen wegen Obergrenze).")
    elif args.pruefe:
        abweichungen = pruefe_datei(Path(args.pruefe))
        if abweichungen:
            raise SystemExit(1)
    else:
        parser.error("bitte --erzeuge oder --pruefe angeben")


if __name__ == "__main__":
    main()
