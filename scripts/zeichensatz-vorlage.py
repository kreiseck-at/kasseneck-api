#!/usr/bin/env python3
"""Rastert die Vorlage-Zeile des Zeichensatz-Testblatts.

Die Zeile "So muss jede Zeile aussehen" geht als Bild auf das Papier: ein
Bild druckt jeder Drucker gleich, egal welche Code-Tabelle er gerade hat.
Jedes Zeichen sitzt in seiner Zelle von 12 x 24 Punkten (Font A) an genau der
Spalte, an der es auch in den Testzeilen darunter steht.

    npm run fixtures:zeichensatz-vorlage
    python3 scripts/zeichensatz-vorlage.py

Braucht Pillow und die Schrift Menlo (macOS). Werkbank-Abhaengigkeit, keine
des Pakets: das Ergebnis wird committet, zur Laufzeit rastert niemand.
"""
from __future__ import annotations

import base64
import hashlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SCHRIFT = '/System/Library/Fonts/Menlo.ttc'
ZEICHEN = ['ä', 'ö', 'ü', 'Ä', 'Ö', 'Ü', 'ß', '€', '§', '°']
# Muss zu src/receipt/code-table-test-sheet.ts passen: erstes Zeichen in
# Spalte 5, danach jede zweite Spalte.
ERSTE_SPALTE = 5
SPALTEN = 32
PUNKTE_JE_ZEICHEN = 12
HOEHE = 24
GRUNDLINIE = 19
GROESSE = 20
# Achtfach zeichnen, auf Punkte mitteln, harte Schwelle ohne Fehlerstreuung
# (wie bei der Marke: Streuung setzt die Binnenraeume zu).
UEBER = 8
SCHWELLE = 160

breite = SPALTEN * PUNKTE_JE_ZEICHEN
schrift = ImageFont.truetype(SCHRIFT, GROESSE * UEBER, index=0)
gross = Image.new('L', (breite * UEBER, HOEHE * UEBER), 255)
stift = ImageDraw.Draw(gross)
for i, z in enumerate(ZEICHEN):
    x = (ERSTE_SPALTE + 2 * i) * PUNKTE_JE_ZEICHEN * UEBER
    w = schrift.getlength(z)
    stift.text((x + (PUNKTE_JE_ZEICHEN * UEBER - w) / 2, GRUNDLINIE * UEBER), z, font=schrift, fill=0, anchor='ls')
klein = gross.resize((breite, HOEHE), Image.BOX)

byte_je_zeile = (breite + 7) // 8
bits = bytearray(byte_je_zeile * HOEHE)
for y in range(HOEHE):
    for x in range(breite):
        if klein.getpixel((x, y)) < SCHWELLE:
            bits[y * byte_je_zeile + (x >> 3)] |= 0x80 >> (x & 7)

schrift_hash = hashlib.sha256(Path(SCHRIFT).read_bytes()).hexdigest()
ausgabe = f"""// Erzeugt von scripts/zeichensatz-vorlage.py -- nicht von Hand aendern.
// Schrift: Menlo Regular {GROESSE} px (sha256 {schrift_hash}), Schwelle {SCHWELLE}.

/** Die Vorlage-Zeile als Rasterbild: {breite} x {HOEHE} Punkte, MSB zuerst, je Zeile auf volle Bytes aufgefuellt; base64. */
export const CODE_TABLE_REFERENCE_RASTER: {{ readonly width: number; readonly height: number; readonly bits: string }} = {{
  width: {breite},
  height: {HOEHE},
  bits: "{base64.b64encode(bytes(bits)).decode('ascii')}",
}};
"""
ziel = Path(__file__).resolve().parent.parent / 'src/receipt/code-table-reference-data.ts'
ziel.write_text(ausgabe, encoding='utf-8')
print('geschrieben:', ziel, f'({breite} x {HOEHE})')
