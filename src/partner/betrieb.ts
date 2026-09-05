/**
 * Was ein Betrieb ueber die Schnittstelle mitbringen darf — Feld fuer Feld.
 *
 * **Unbekannte Felder werden abgewiesen, nicht stillschweigend verworfen.**
 * Vorher verschwand ein `iban` oder ein vertippter Feldname spurlos: der
 * Partner glaubte, er habe die Steuernummer geschickt, und Kasseneck hatte
 * nichts. Ein Feld, das man schickt und das nichts bewirkt, ist der teuerste
 * Fehler in einer Schnittstelle, weil ihn niemand bemerkt.
 *
 * Seitdem antwortet `createPartnerCustomer` mit `validation` und dem genauen
 * Feldpfad — verschachtelt und je Kontakt: `address.land`,
 * `tax_details.ustid`, `contacts.1.abteilung`.
 *
 * Zwei Dinge halten diese Seite dagegen:
 *
 * - der Typ [Betrieb] (typen.ts) hat genau diese Felder, und TypeScript meldet
 *   ein ueberzaehliges schon beim Tippen;
 * - [unbekannteBetriebsfelder] beantwortet dieselbe Frage zur Laufzeit — fuer
 *   Daten, die aus einer Datenbank oder einem Formular kommen und deshalb nie
 *   durch die Typpruefung gelaufen sind.
 *
 * **Die Wahrheit bleibt der Server.** Dieser Client weist nichts von sich aus
 * ab: eine spaetere Backend-Fassung darf ein Feld ergaenzen, ohne dass ein
 * aelterer Client es blockiert. [unbekannteBetriebsfelder] ist die Vorschau,
 * nicht das Tor.
 *
 * Quelle der Liste: `partner-core.BETRIEB_FELDER` im Backend.
 */

/**
 * Jedes erlaubte Feld als Pfad. `[]` markiert eine Liste — im Fehlerpfad des
 * Servers steht dort der Index (`contacts.0.name`).
 *
 * Bewusst flach und nicht verschachtelt: so ist es EINE Liste, die der
 * Zwilling Zeile fuer Zeile nachhalten kann. Das Schema fuer die Pruefung
 * entsteht daraus (siehe unten) und nicht daneben.
 */
export const BETRIEB_FELDER = [
  'companyName',
  'legalForm',
  'state',
  'industry',
  'companyRegister',
  'court',
  'web',
  'phone',
  'email',
  'billingEmail',
  'address.street',
  'address.number',
  'address.zip',
  'address.city',
  'taxDetails.taxNumber',
  'taxDetails.vatId',
  'taxDetails.gln',
  'taxDetails.smallBusiness',
  'contacts[].name',
  'contacts[].email',
  'contacts[].phone',
  'contacts[].roles',
  'taxAdvisor.name',
  'taxAdvisor.email',
  'taxAdvisor.phone',
  'taxAdvisor.mayContact',
] as const;

export type BetriebFeld = typeof BETRIEB_FELDER[number];

/** `true` = einfacher Wert, `Schema` = Unterfelder, `[Schema]` = Liste davon. */
interface Schema {
  [feld: string]: true | Schema | [Schema];
}

/** Das Schema entsteht aus [BETRIEB_FELDER] — eine Quelle, keine zweite Liste. */
const SCHEMA: Schema = (() => {
  const wurzel: Schema = {};
  for (const pfad of BETRIEB_FELDER) {
    const teile = pfad.split('.');
    let stand = wurzel;
    teile.forEach((rohes, i) => {
      const liste = rohes.endsWith('[]');
      const name = liste ? rohes.slice(0, -2) : rohes;
      if (i === teile.length - 1) {
        stand[name] = true;
        return;
      }
      if (liste) {
        const vorhanden = stand[name];
        const eintrag: Schema = Array.isArray(vorhanden) ? vorhanden[0] : {};
        stand[name] = [eintrag];
        stand = eintrag;
        return;
      }
      const vorhanden = stand[name];
      const unter: Schema = vorhanden !== undefined && vorhanden !== true && !Array.isArray(vorhanden) ? vorhanden : {};
      stand[name] = unter;
      stand = unter;
    });
  }
  return wurzel;
})();

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return wert !== null && typeof wert === 'object' && !Array.isArray(wert);
}

function sammle(eingabe: unknown, schema: Schema, pfad: string): string[] {
  if (!istObjekt(eingabe)) return [];
  const raus: string[] = [];
  for (const [name, wert] of Object.entries(eingabe)) {
    const voll = pfad ? `${pfad}.${name}` : name;
    const erlaubt = schema[name];
    if (erlaubt === undefined) {
      raus.push(voll);
      continue;
    }
    if (erlaubt === true) continue;
    if (Array.isArray(erlaubt)) {
      // Ein falscher Typ ist kein unbekanntes Feld — den meldet der Server als
      // eigenen Formfehler auf demselben Pfad.
      if (!Array.isArray(wert)) continue;
      wert.forEach((eintrag, idx) => raus.push(...sammle(eintrag, erlaubt[0]!, `${voll}.${idx}`)));
      continue;
    }
    raus.push(...sammle(wert, erlaubt, voll));
  }
  return raus;
}

/**
 * Die Feldpfade eines Betriebs, die [BETRIEB_FELDER] nicht kennt — dieselbe
 * Ableitung wie im Backend, also dieselben Pfade wie in `data.errors[].field`.
 * Leer heisst: aus dieser Sicht ist nichts ueberzaehlig.
 *
 * Sagt **nichts** ueber die Werte: Steuernummer, UID, PLZ und Gericht prueft
 * das Backend mit `@kreiseck/validator`. Diese Funktion beantwortet nur die
 * Frage „schicke ich etwas, das dort niemand erwartet?".
 */
export function unbekannteBetriebsfelder(business: unknown): string[] {
  return sammle(business, SCHEMA, '');
}
