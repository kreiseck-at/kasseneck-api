/**
 * Bindet bei Enums mit Zusatzfeldern das `value`-Feld zur Bauzeit an den eigenen
 * Objekt-Schluessel — `vat20: { value: 'vat20', ... }` kompiliert, `vat20: { value:
 * 'vat2O', ... }` nicht. `value` ist die Nutzlast, die an das Backend geht: ein
 * Tippfehler dort erzeugt sonst erst in Produktion einen Beleg mit unbekanntem
 * Steuersatz bzw. Belegtyp.
 *
 * `const T` erhaelt die Literal-Typen (wie `as const`), ohne dass der Aufrufer
 * `as const` selbst schreiben muss.
 */
export function defineEnum<const T extends { [K in keyof T]: { value: K } & Record<string, unknown> }>(
  eintraege: T,
): T {
  return eintraege;
}
