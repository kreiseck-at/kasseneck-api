import { KasseneckValidationError } from '../client/errors.js';
import { ARTIKEL_FELDER, KATALOGE, SCHEMAS, type SchemaEintrag, type SchemaObjekt } from './vokabular.js';

/*
 * Gespeicherte Form (Firestore, innen, deutsch) -> Drahtform `/v3` (englisch),
 * Feld fuer Feld so, wie der Server antwortet. Paketintern: die oeffentlichen
 * Funktionen in `index.ts` lesen das Ergebnis mit den normalen Lesern des
 * Pakets, damit `./stored` und der Draht dasselbe Modell ergeben.
 *
 * Zwei Arten von Wissen stecken hier:
 *
 * - **Aus dem Vertrag** (`vokabular.ts`, erzeugt aus fixtures/v3): welche
 *   Schluessel wie heissen und welche Werte wie uebersetzt werden. Die
 *   Uebersetzung selbst ist der Zwilling von `schluessel` und `werteAbbilden`
 *   im Backend (functions/gemeinsam/api-vokabular-v3.js).
 * - **Zwillinge der Handler** (nicht im Vertrag, siehe die Kommentare je
 *   Stelle): was der Handler vor dem Rand am Dokument tut, etwa die
 *   Kachel-Vorgaben eines Artikels oder das Mischen der Tastenkarte.
 */

export type Objekt = Record<string, unknown>;
export const hat = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
export const istObjekt = (w: unknown): w is Objekt => w !== null && typeof w === 'object' && !Array.isArray(w);

/** Schema-Eintrag zerlegt: innerer Name, Unterschema (ohne `__`) und ob es eine Liste ist. */
export function regel(eintrag: SchemaEintrag): { innen: string; unter: SchemaObjekt | null; liste: boolean } {
  const liste = Array.isArray(eintrag);
  const kern = (liste ? (eintrag as readonly [SchemaObjekt])[0] : eintrag) as string | SchemaObjekt;
  if (typeof kern === 'string') return { innen: kern, unter: null, liste };
  const { __: innen, ...unter } = kern;
  return { innen: innen as string, unter: unter as SchemaObjekt, liste };
}

/**
 * Schluessel innen -> aussen (Zwilling von `schluessel(obj, schema, 'aus')`).
 * Kopiert, veraendert die Eingabe nie; ein Treffer wandert wie am Server ans
 * Ende des Objekts.
 */
function schluesselNachAussen(obj: unknown, schema: SchemaObjekt): unknown {
  if (!istObjekt(obj)) return obj;
  const raus: Objekt = { ...obj };
  for (const [aussen, eintrag] of Object.entries(schema)) {
    if (aussen === '__') continue;
    const { innen, unter, liste } = regel(eintrag);
    if (!hat(raus, innen)) continue;
    let wert = raus[innen];
    if (unter) {
      wert = liste ? (Array.isArray(wert) ? wert.map((e) => schluesselNachAussen(e, unter)) : wert) : schluesselNachAussen(wert, unter);
    }
    delete raus[innen];
    raus[aussen] = wert;
  }
  return raus;
}

/** Innere Namen einer Schema-Ebene (was der Server innen an dieser Stelle kennt). */
export function innereNamen(schema: SchemaObjekt): Map<string, string> {
  const raus = new Map<string, string>();
  for (const [aussen, eintrag] of Object.entries(schema)) if (aussen !== '__') raus.set(regel(eintrag).innen, aussen);
  return raus;
}

/** Wert an einem aeusseren Pfad (`a.b`, `a[].b`) abbilden (Zwilling von `anPfad`). */
function anPfad(obj: unknown, teile: readonly string[], fn: (w: unknown) => unknown): unknown {
  if (obj == null || teile.length === 0 || typeof obj !== 'object') return obj;
  const [kopf, ...rest] = teile as [string, ...string[]];
  const liste = kopf.endsWith('[]');
  const name = liste ? kopf.slice(0, -2) : kopf;
  if (!hat(obj, name)) return obj;
  const wert = (obj as Objekt)[name];
  let neu: unknown;
  if (liste) neu = Array.isArray(wert) ? wert.map((e) => (rest.length ? anPfad(e, rest, fn) : fn(e))) : wert;
  else neu = rest.length ? anPfad(wert, rest, fn) : fn(wert);
  return { ...(obj as Objekt), [name]: neu };
}

/**
 * Werte ueber die Kataloge des Vertrags abbilden (Zwilling von
 * `werteAbbilden`). Ein Wert, den der Katalog nicht kennt, bleibt woertlich
 * stehen, wie am Server.
 */
function werteNachAussen(obj: unknown, werte: Readonly<Record<string, { readonly $catalog: string }>>): unknown {
  let raus = obj;
  for (const [pfad, { $catalog }] of Object.entries(werte)) {
    const katalog = KATALOGE[$catalog];
    if (!katalog) throw new Error(`stored: Katalog ${$catalog} fehlt im Vokabular`);
    raus = anPfad(raus, pfad.split('.'), (v) => (typeof v === 'string' && hat(katalog, v) ? katalog[v] : v));
  }
  return raus;
}

/** Englische Werte eines Katalogs (was an dieser Stelle hinaus darf). */
const aeussereWerte = (name: string): ReadonlySet<string> => new Set(Object.values(KATALOGE[name] ?? {}));

// ---- Belege -----------------------------------------------------------------

/**
 * Interne Marke der Storno-Reservierung: `stornoMarke` am Storno-Beleg,
 * `marke` im Bezug und in `cancellations[]`. Handler
 * (storno-core.ohneInterneStornoFelder) und Rand (ohneStornoMarke) nehmen sie
 * heraus; der Vertrag nennt die Namen nicht (nur `$function: belegJeKanal`).
 */
const STORNO_MARKE = 'stornoMarke';
const MARKE = 'marke';
const ohneMarke = (o: unknown): unknown => {
  if (!istObjekt(o) || !hat(o, MARKE)) return o;
  const { [MARKE]: _m, ...rest } = o;
  return rest;
};

/**
 * Zwilling von `beleg-pruefangaben.alsIso`: leer (auch 0, '') -> null;
 * Firestore-Zeitstempel, Zahl oder Zeichenkette -> ISO-Zeitpunkt in UTC;
 * nicht lesbar -> null.
 */
function alsIso(ts: unknown): string | null {
  if (!ts) return null;
  let d: unknown = ts;
  if (typeof (d as { toDate?: unknown }).toDate === 'function') d = (d as { toDate: () => unknown }).toDate();
  if (typeof d === 'number' || typeof d === 'string') d = new Date(d);
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

/**
 * Ein Belegdokument, wie Handler und Rand es vor der Uebersetzung sehen:
 * ohne Storno-Marke (storno-core.ohneInterneStornoFelder, Rand
 * ohneStornoMarke). Alles andere bleibt woertlich, auch `pruefangaben` im
 * Beleg selbst (der Server reicht sie so durch). Wirft, wenn es kein
 * Belegdokument ist.
 */
export function _storedReceiptInner(doc: unknown, functionName: string): Objekt {
  if (!istObjekt(doc) || typeof doc.receiptId !== 'string') {
    throw new KasseneckValidationError(functionName, 'Kein Belegdokument (receiptId fehlt)', 'response');
  }
  const { [STORNO_MARKE]: _s, ...beleg } = doc;
  if (hat(beleg, 'cancellationOf')) beleg.cancellationOf = ohneMarke(beleg.cancellationOf);
  if (Array.isArray(beleg.cancellations)) beleg.cancellations = beleg.cancellations.map(ohneMarke);
  return beleg;
}

/**
 * Registrierdaten der Huelle aus den beim Ausstellen festgehaltenen
 * `pruefangaben` (Zwilling von `pruefangabenFuerBeleg`, erster Zweig): genau
 * die zwei Felder, je ueber [alsIso].
 */
export function pruefangabenDerHuelle(p: Objekt): Objekt {
  return { karteRegistriertAm: alsIso(p.karteRegistriertAm), kasseRegistriertAm: alsIso(p.kasseRegistriertAm) };
}

/**
 * Eine Beleg-Huelle der inneren Form (`receipt`, Betriebsfelder, `kopfId`,
 * `pruefangaben`, `testKasse` ...) in die Drahtform von `getReceipt` unter
 * `/api/v3` (Kanal `app`: Anbieterdaten bleiben).
 */
export function _receiptEnvelopeToWire(huelle: Objekt): Objekt {
  const schema = SCHEMAS.getReceipt;
  return werteNachAussen(schluesselNachAussen(huelle, schema.data), schema.werte) as Objekt;
}

/**
 * Ein Belegdokument (`users/{uid}/cashregisters/{id}/receipts/{id}`) in der
 * Form von `data.receipt` einer `/api/v3`-Antwort (Kanal `app`: Anbieterdaten
 * bleiben). Wirft, wenn es kein Belegdokument ist.
 */
export function _storedReceiptToWire(doc: unknown, functionName = 'fromStoredReceipt'): Objekt {
  return _receiptEnvelopeToWire({ receipt: _storedReceiptInner(doc, functionName) }).receipt as Objekt;
}

// ---- Artikel ------------------------------------------------------------------

/**
 * Zwilling von `kachelAttribute` (article-groups-core): sichtbar, wenn nicht
 * ausdruecklich aus; Reihenfolge ganzzahlig ab 0, sonst 0.
 */
function kachelAttribute(e: unknown): Objekt {
  const k = istObjekt(e) ? e : {};
  return {
    sichtbar: typeof k.sichtbar === 'boolean' ? k.sichtbar : true,
    sort: Number.isInteger(k.sort) && (k.sort as number) >= 0 ? k.sort : 0,
  };
}

/**
 * Nur bekannte Felder hinaus (Zwilling von `nurBekannte`): ein Feld, das
 * kein Schreibweg kennt, und ein Katalogwert, den der Katalog nicht kennt,
 * fallen weg; `undefined` ebenso.
 */
function nurBekannte(obj: Objekt, erlaubt: ReadonlySet<string>, werte: Readonly<Record<string, ReadonlySet<string>>> = {}): Objekt {
  const raus: Objekt = {};
  for (const [k, w] of Object.entries(obj)) {
    if (w === undefined || !erlaubt.has(k)) continue;
    if (hat(werte, k) && w !== null && !werte[k]!.has(w as string)) continue;
    raus[k] = w;
  }
  return raus;
}

/**
 * Ein Artikeldokument (`users/{uid}/articles/{id}`) in der Form eines
 * Eintrags von `listMyArticles` unter `/api/v3`. Vor dem Rand ergaenzt der
 * Handler `groupId`/`revenueGroupId` (fehlt -> `null`) und die Kachel
 * (article-endpoints.js listMyArticles); das steht nicht im Vertrag.
 */
export function _storedArticleToWire(id: string, doc: unknown, functionName = 'fromStoredArticle'): Objekt {
  if (typeof id !== 'string' || id === '' || !istObjekt(doc)) {
    throw new KasseneckValidationError(functionName, 'Kein Artikeldokument (id oder Daten fehlen)', 'response');
  }
  const a = doc;
  const handler: Objekt = {
    id, ...a, groupId: a.groupId || null, revenueGroupId: a.revenueGroupId || null, kasse: kachelAttribute(a.kasse),
    create_time: undefined, update_time: undefined,
  };
  const schema = SCHEMAS.listMyArticles;
  const huelle = werteNachAussen(schluesselNachAussen({ articles: [handler] }, schema.data), schema.werte) as { articles: Objekt[] };
  const artikel = huelle.articles[0]!;
  const katalog = (pfad: string): ReadonlySet<string> => aeussereWerte(schema.werte[pfad]!.$catalog);
  const raus = nurBekannte(artikel, new Set(ARTIKEL_FELDER), {
    quantityRule: katalog('articles[].quantityRule'), e1aGroup: katalog('articles[].e1aGroup'),
  });
  if (istObjekt(raus.tile)) {
    const kachel = regel(regel(schema.data.articles as SchemaEintrag).unter!.tile as SchemaEintrag).unter!;
    raus.tile = nurBekannte(raus.tile, new Set(Object.keys(kachel)));
  }
  return raus;
}
