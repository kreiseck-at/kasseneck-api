/**
 * Macht Text fuer den Bondrucker druckbar — Zwilling von `_printable` und
 * `_isEmojiOrZeroWidth` in `kasseneck_api/lib/models/print_paper.dart`
 * (Zeilen 53-88).
 *
 * Warum getrennt vom Erzeuger: Die Ersetzung **aendert die Laenge** ("€" wird
 * zu "EUR", ein Emoji verschwindet). Wer Spalten rechnet, muss den fertigen
 * Text sehen, nicht den rohen — deshalb entscheidet der Aufrufer, wann er
 * ersetzt, und der Erzeuger bekommt bereits druckbaren Text. Der Erzeuger
 * selbst wirft weiterhin bei Zeichen ausserhalb Latin-1; das ist die Schicht,
 * auf der ein Fehler noch etwas bedeutet.
 *
 * Regel: bekannte Sonderzeichen auf ein ASCII-Aequivalent, Latin-1 (inklusive
 * aller deutschen Umlaute) unveraendert, Emoji und Nullbreiten-Zeichen
 * ersatzlos weg, alles Uebrige auf `?`. Ein Artikelname aus einer
 * ERP-Uebernahme mit Gedankenstrich soll den Beleg nicht verhindern.
 */

/** Ersetzungen aus print_paper.dart, Schluessel sind Unicode-Codepunkte. */
const ERSETZUNGEN: ReadonlyMap<number, string> = new Map([
  [0x2013, '-'], // – Halbgeviertstrich
  [0x2014, '-'], // — Geviertstrich
  [0x2011, '-'], // ‑ geschuetzter Bindestrich
  [0x2212, '-'], // − Minus
  [0x201c, '"'], // " oeffnendes Anfuehrungszeichen
  [0x201d, '"'], // " schliessendes Anfuehrungszeichen
  [0x201e, '"'], // „ tiefes Anfuehrungszeichen
  [0x201f, '"'], // ‟
  [0x2018, "'"], // ' einfaches Anfuehrungszeichen
  [0x2019, "'"], // ' typografisches Apostroph
  [0x201a, "'"], // ‚ tiefes einfaches Anfuehrungszeichen
  [0x2032, "'"], // ′ Minutenzeichen
  [0x2026, '...'], // … Auslassungspunkte
  [0x2022, '*'], // • Aufzaehlungspunkt
  [0x2713, 'x'], // ✓ Haken
  [0x2714, 'x'], // ✔ fetter Haken
  [0x20ac, 'EUR'], // € Euro
  [0x2122, 'TM'], // ™ Markenzeichen
  [0x20ba, 'TL'], // ₺ tuerkische Lira
]);

/**
 * Emoji-, Modifier- und Nullbreiten-/Steuerzeichen, die auf dem Beleg nichts
 * verloren haben. Sie werden entfernt statt zu `?` gemacht: ein einzelnes
 * Emoji besteht oft aus mehreren Codepunkten und stuende sonst als Reihe von
 * Fragezeichen auf dem Bon.
 */
function istEmojiOderNullbreite(codepunkt: number): boolean {
  return (
    codepunkt === 0x200d || // Zero-Width Joiner
    (codepunkt >= 0x200b && codepunkt <= 0x200f) ||
    codepunkt === 0x2060 ||
    codepunkt === 0xfeff ||
    (codepunkt >= 0xfe00 && codepunkt <= 0xfe0f) || // Variantenselektoren
    (codepunkt >= 0x1f3fb && codepunkt <= 0x1f3ff) || // Hautton-Modifier
    (codepunkt >= 0x1f000 && codepunkt <= 0x1faff) || // Emoji-Bloecke
    (codepunkt >= 0x2600 && codepunkt <= 0x27bf) || // Symbole und Dingbats
    (codepunkt >= 0x2b00 && codepunkt <= 0x2bff) || // Symbole und Pfeile
    (codepunkt >= 0x2300 && codepunkt <= 0x23ff) // technische Symbole
  );
}

/**
 * Ersetzt alles, was der Bondrucker nicht darstellen kann, durch eine
 * druckbare Entsprechung. Reine Funktion, ohne Zustand und ohne Drucker.
 *
 * Vor `escPosText`/`escPosRow` anwenden, wenn der Text aus fremder Hand kommt
 * (Artikelstamm, ERP-Uebernahme, Kundenname). `•` wird hier zu `*`, und der
 * Erzeuger sagt dasselbe — auch wer diese Funktion weglaesst, bekommt also
 * dasselbe Zeichen (siehe ZEICHEN_ERSATZ in escpos.ts).
 */
export function escPosPrintableText(text: string): string {
  let ergebnis = '';
  for (const zeichen of text) {
    const codepunkt = zeichen.codePointAt(0) as number;
    const ersatz = ERSETZUNGEN.get(codepunkt);
    if (ersatz !== undefined) {
      ergebnis += ersatz;
    } else if (codepunkt <= 0xff) {
      ergebnis += zeichen; // Latin-1 inklusive Umlaute bleibt unveraendert
    } else if (istEmojiOderNullbreite(codepunkt)) {
      // ersatzlos entfernen
    } else {
      ergebnis += '?';
    }
  }
  return ergebnis;
}
