/**
 * Technik von hobex fuer Haendler mit hobex-Terminal, rund um die Uhr
 * erreichbar. Quelle: Angabe des Inhabers am 11.11.2026 („hobex Technik
 * 0662 225588“); es ist die Durchwahl 88 der Zentrale +43 662 2255-0 (hobex,
 * „Zahlen & Fakten“).
 *
 * `phone` international (fuer einen `tel:`-Link nur Ziffern und `+` daraus
 * nehmen), `display` so, wie man sie in Oesterreich liest und waehlt.
 * Gedacht fuer die Stellen, an denen hobex helfen kann: Stoerung beim
 * hobex-Host, Terminal nicht betriebsbereit, TID passt nicht, das Terminal hat
 * geantwortet und kennt den Ausgang nicht -- nie fuer Fehler im eigenen Netz
 * oder an Kasseneck Connect. Die Kasse zeigt sie in einem eigenen Fenster mit
 * den Angaben, die hobex fragt (Beschriftungen `hobex_help.*` im Katalog).
 */
export const HOBEX_SUPPORT = Object.freeze({
  phone: '+43 662 2255-88',
  display: '0662 2255-88',
  availability: '24/7',
} as const);
