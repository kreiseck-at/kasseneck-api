// Erzeugt src/stored/vokabular.ts: die Teile des Vertrags-Exports
// (fixtures/v3/v3-vokabular.json), mit denen der Einstieg `./stored`
// gespeicherte Firestore-Dokumente (innen, deutsch) in die Drahtform `/v3`
// uebersetzt. Woertlich uebernommen, nie von Hand gepflegt:
// test/stored.test.ts vergleicht jede Konstante mit der JSON-Datei und den
// Fingerabdruck mit `_quelle.sha256`.
//
// Uebernommen werden die Schemata der Endpunkte, deren Antwort `./stored`
// nachbildet (`getReceipt`, `getKasseSettings`, `listMyArticles`), die
// Artikelfelder und genau die Kataloge, auf die diese Schemata verweisen.
//
// Aufruf: `npm run fixtures:stored` (bewusst, nach `v3-vertrag-holen`).
import { readFileSync, writeFileSync } from 'node:fs';

const vokabular = JSON.parse(readFileSync(new URL('../fixtures/v3/v3-vokabular.json', import.meta.url), 'utf8'));

const ENDPUNKTE = ['getReceipt', 'getKasseSettings', 'listMyArticles'];

const schemas = {};
for (const name of ENDPUNKTE) {
  const s = vokabular.schemas[name];
  if (!s || !s.data || !s.werte) throw new Error(`Schema ${name} ohne data/werte im Vertrag`);
  schemas[name] = { data: s.data, werte: s.werte };
}

const katalogNamen = new Set();
for (const s of Object.values(schemas)) {
  for (const verweis of Object.values(s.werte)) {
    if (!verweis || typeof verweis.$catalog !== 'string') throw new Error(`Wertverweis ohne $catalog: ${JSON.stringify(verweis)}`);
    katalogNamen.add(verweis.$catalog);
  }
}
const catalogs = {};
for (const name of [...katalogNamen].sort()) {
  if (!vokabular.catalogs[name]) throw new Error(`Katalog ${name} fehlt im Vertrag`);
  catalogs[name] = vokabular.catalogs[name];
}

const json = (wert) => JSON.stringify(wert, null, 2);
const inhalt = `// Erzeugt von scripts/stored-vokabular.mjs aus fixtures/v3/v3-vokabular.json.
// Nicht von Hand aendern: test/stored.test.ts vergleicht mit dem Vertrag.

/** Fingerabdruck des Vertrags-Exports, aus dem diese Datei stammt (\`_quelle.sha256\`). */
export const VOKABULAR_QUELLE = ${json(vokabular._quelle.sha256)};

/** Schema-Notation des Vertrags: Blatt 'aussen': 'innen', Objekt { __: 'innen', ... }, Liste [ { __: 'innen', ... } ]. */
export type SchemaEintrag = string | SchemaObjekt | readonly [SchemaObjekt];
export interface SchemaObjekt { readonly [aussen: string]: SchemaEintrag }

/** Schema je Endpunkt (aussen -> innen) und Wertverweise auf die Kataloge. */
export const SCHEMAS: Readonly<Record<'getReceipt' | 'getKasseSettings' | 'listMyArticles', {
  readonly data: SchemaObjekt;
  readonly werte: Readonly<Record<string, { readonly $catalog: string }>>;
}>> = ${json(schemas)};

/** Die Felder eines Artikels in der Antwort (\`listMyArticles\`), aussen. */
export const ARTIKEL_FELDER: readonly string[] = ${json(vokabular.articleFields.outer)};

/** Wertkataloge innen (deutsch) -> aussen (englisch). */
export const KATALOGE: Readonly<Record<string, Readonly<Record<string, string>>>> = ${json(catalogs)};
`;

writeFileSync(new URL('../src/stored/vokabular.ts', import.meta.url), inhalt);
console.log(`src/stored/vokabular.ts: ${ENDPUNKTE.length} Schemata, ${Object.keys(catalogs).length} Kataloge`);
