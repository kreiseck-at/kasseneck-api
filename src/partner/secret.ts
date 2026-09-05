/**
 * Ein Geheimnis eines fremden Betriebs — der `api_key` und die Kassen-Token,
 * die `getCustomerCredentials` liefert.
 *
 * **Warum ein eigener Typ und nicht `string`:** diese Werte gehoeren einem
 * Dritten. Wer sie hat, kann in seinem Namen Belege signieren — und ein Beleg
 * ist nach RKSV nicht zuruecknehmbar. Ein `string` in einem Antwortobjekt
 * landet aber genau dort, wo Objekte nun einmal landen: in
 * `console.log(antwort)`, in `JSON.stringify(antwort)` unter einem Fehler, im
 * Rumpf eines Fehlerberichts, in einer Mail an den Kunden. Kein einziger
 * dieser Wege ist boese gemeint, und jeder einzelne gibt den Schluessel weiter.
 *
 * Deshalb kommt man hier nur ueber **einen** benannten Weg an den Wert:
 * [reveal]. Der Name ist mit Absicht so gewaehlt, dass eine Suche nach
 * `.reveal(` in einer fremden Codebasis genau die Stellen zeigt, an denen ein
 * Geheimnis das Objekt verlaesst.
 *
 * **Wie die Maskierung haelt.** Der Wert liegt in einer `WeakMap` neben dem
 * Objekt, nicht *im* Objekt: die Instanz hat kein einziges eigenes Feld mit
 * dem Klartext, und was nicht da ist, kann auch kein Ausgabeweg finden — auch
 * keiner, den dieses Paket nicht kennt. Die Ueberschreibungen von `toString`,
 * `toJSON`, `Symbol.toPrimitive` und dem Node-Inspektor kommen **zusaetzlich**,
 * damit die Maske nicht als `[object Object]` erscheint, sondern als Satz, der
 * sagt, was fehlt und warum.
 *
 * Ein privates Klassenfeld (`#wert`) waere die naheliegende Alternative und
 * reicht nicht: `util.inspect` zeigt private Felder in neueren Node-Fassungen
 * an, und ein Fehlerdienst, der ein Objekt tief durchlaeuft, kommt ohnehin nur
 * an das, was am Objekt haengt. Die WeakMap loest beides auf einmal.
 */

/**
 * Der Klartext, ausserhalb der Instanz. `WeakMap`, damit ein weggeworfenes
 * Geheimnis samt Wert eingesammelt werden kann.
 */
const werte = new WeakMap<KasseneckSecret, string>();

/** Wie ein maskiertes Geheimnis in Text erscheint. */
export const SECRET_MASKE = '«verborgen»';

export class KasseneckSecret {
  /**
   * Wofuer dieses Geheimnis steht (`apiKey`, `cashregisterToken`). Kein
   * Geheimnis, nur eine Beschriftung — sie steht in der Maske, damit ein
   * Protokoll erkennen laesst, WELCHER Wert fehlt.
   */
  readonly label: string;

  constructor(label: string, wert: string) {
    this.label = label;
    werte.set(this, wert);
  }

  /**
   * Der Klartext. Der einzige Weg heraus — und die Stelle, an der ein
   * Aufrufer sich entscheidet, das Geheimnis weiterzugeben.
   *
   * Verschluesselt speichern. Nie protokollieren, nie in eine Mail, nie in
   * einen Fehlerbericht.
   */
  reveal(): string {
    return werte.get(this) ?? '';
  }

  /** Ob ueberhaupt ein Wert da ist — ohne ihn anzufassen. */
  get vorhanden(): boolean {
    return (werte.get(this) ?? '').length > 0;
  }

  toString(): string {
    return `[${this.label} ${SECRET_MASKE}]`;
  }

  /**
   * Greift bei `JSON.stringify` — dem Weg, auf dem ein Geheimnis am
   * unauffaelligsten in ein Protokoll rutscht.
   */
  toJSON(): string {
    return this.toString();
  }

  /**
   * Greift bei `` `${geheimnis}` `` und bei `'' + geheimnis`. Ohne diese
   * Ueberschreibung stuende zwar dasselbe wie in [toString], aber
   * `Symbol.toPrimitive` hat Vorrang — wer ihn spaeter versehentlich anders
   * belegt, umgeht die Maske.
   */
  [Symbol.toPrimitive](): string {
    return this.toString();
  }

  /** Greift bei `console.log`, `util.inspect` und den meisten Fehlerdiensten. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}

/** Baut ein Geheimnis aus einem Antwortfeld; fehlt es, entsteht ein leeres. */
export function alsSecret(label: string, wert: unknown): KasseneckSecret {
  return new KasseneckSecret(label, typeof wert === 'string' ? wert : '');
}
