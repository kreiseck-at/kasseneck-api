/**
 * Prüfung (DEP) bei der Kassennachschau an der Kasse (Spec dep-nachschau, Stufe 2): der Ordner, in den Web-Kasse
 * und Kassen-App DEP, Übergabeprotokoll und Positionen auf den USB-Stick legen. Beide Kassen benennen ihn gleich;
 * die Prüffälle stehen in `fixtures/dep-folder-cases.json` (auch im Dart-Zwilling).
 */

/** Zeichen, die FAT32 und exFAT in Namen nicht erlauben, Steuerzeichen und Leerraum. */
const UNERLAUBT = /[\\/:*?"<>|\u0000-\u001f\u007f\s]/g;
const teil = (s: string): string => s.trim().replace(UNERLAUBT, '_');

/**
 * `DEP_<Kassen-ID>_<von>_<bis>` (Tage JJJJ-MM-TT, wie der Export sie nennt). Ohne Anfang `DEP_<id>_bis_<bis>`, ohne
 * Ende `DEP_<id>_ab_<von>`, ohne beides `DEP_<id>_alles`. Was ein Stick nicht als Namen nimmt, wird zu `_`.
 */
export function depFolderName(cashregisterId: string, from?: string | null, to?: string | null): string {
  const id = teil(String(cashregisterId ?? '')) || 'Kasse';
  const von = typeof from === 'string' && from.trim() ? teil(from) : null;
  const bis = typeof to === 'string' && to.trim() ? teil(to) : null;
  if (von && bis) return `DEP_${id}_${von}_${bis}`;
  if (bis) return `DEP_${id}_bis_${bis}`;
  if (von) return `DEP_${id}_ab_${von}`;
  return `DEP_${id}_alles`;
}
