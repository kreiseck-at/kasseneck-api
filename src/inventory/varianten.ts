/**
 * Variantengruppen der Lager-API (Backend Stufe 5c): Gruppe anlegen (mit
 * Matrix oder genannten Varianten), aendern oder stilllegen, eine Variante
 * ergaenzen, Gruppen lesen.
 *
 * Eine Variante ist ein gewoehnlicher Artikel mit `variantGroupId` und
 * `variantAttributes`; gelesen, gebucht und reserviert wird sie wie jeder
 * Artikel. Die Gruppenantworten tragen nur die Kennungen der Varianten, die
 * Artikel selbst liefert `listArticles({ variantGroupId })`.
 *
 * Wie in `schreiben.ts` geht die Anfrage flach hinaus, genau mit den Feldern,
 * die der Aufrufer nennt (`undefined` faellt weg, `null` bleibt).
 *
 * **Vor dem Senden geprueft wird nur, was ohne Netz sicher falsch ist:**
 * - `idempotencyKey` fehlt, ist leer oder laenger als 120 Zeichen (die drei
 *   schreibenden Aufrufe);
 * - `variantGroupId` fehlt oder ist leer;
 * - `createMatrix: true` zusammen mit `variants` (schliessen sich aus);
 * - `variants` ist keine Liste, ein Eintrag kein Objekt, `variantAttributes`
 *   einer Variante fehlt oder ist kein Objekt;
 * - ein Preis, eine Menge oder ein Einkaufspreis (auch in `defaults`) ist
 *   keine Ganzzahl;
 * - eine Aenderung nennt kein Feld, `active` ist nicht `false` oder steht
 *   nicht allein, `addAttributeValues` ist kein Objekt.
 * Die Grenzen (Merkmale, Werte, Matrix, aktive Varianten) prueft der Server:
 * er darf sie anheben, ohne dass diese Paketversion dann falsch abweist.
 *
 * **Wiederholen** wie bei jedem Schreiben: nach `outcome: 'unknown'` denselben
 * Aufruf mit **demselben** `idempotencyKey`; er wirkt genau einmal und liefert
 * die gespeicherte Antwort. Ein neuer Schluessel legte die Gruppe ein zweites
 * Mal an. Ein abgebrochenes Stilllegen vollendet jede Wiederholung von
 * `updateVariantGroup({ active: false })`, auch mit neuem Schluessel.
 */

import type { ApiCall, InternerTransport } from '../client/aufrufe.js';
import { abfrage, anfragefehler, kennung, seitenweise } from './endpunkte.js';
import { liste, naechsterCursor, objekt, variantengruppe } from './lesen.js';
import { anfrage, artikelAus, artikelZahlen, ganz, schluessel } from './schreiben.js';
import type {
  AddVariantRequest,
  Article,
  CreateVariantGroupRequest,
  UpdateVariantGroupRequest,
  VariantGroup,
  VariantGroupListQuery,
  VariantGroupPage,
} from './typen.js';

type Params = Record<string, unknown>;

const istObjekt = (w: unknown): w is Params => w !== null && typeof w === 'object' && !Array.isArray(w);

/** Vorgaben: nur der Preis ist eine Zahl mit Skala (Cent); `null` leert bzw. heisst „nicht angegeben“. */
function vorgabenZahlen(name: ApiCall, w: unknown): void {
  if (w === undefined || w === null) return;
  if (!istObjekt(w)) throw anfragefehler(name, 'defaults muss ein Objekt oder null sein');
  ganz(name, 'defaults.unitPriceCents', w.unitPriceCents, { leerbar: true });
}

/** Eine Variante der Anfrage: Merkmale als Objekt, Zahlen ganzzahlig. */
function variante(name: ApiCall, w: unknown, praefix: string): void {
  const stelle = praefix ? praefix.slice(0, -1) : 'Anfrage';
  if (!istObjekt(w)) throw anfragefehler(name, `${stelle} muss ein Objekt sein`);
  if (!istObjekt(w.variantAttributes)) {
    throw anfragefehler(name, `${praefix}variantAttributes fehlt oder ist kein Objekt { merkmal: wert }`);
  }
  artikelZahlen(name, w, praefix);
}

const gruppeAus = (name: ApiCall, daten: unknown): VariantGroup =>
  variantengruppe({ name, pfad: 'variantGroup' }, objekt(daten)?.variantGroup);

/**
 * Legt eine Variantengruppe an: mit `createMatrix: true` alle Kombinationen der
 * Werte (hoechstens 100), sonst die genannten `variants[]` (hoechstens 100),
 * ohne beides nur die Gruppe. Jede Variante entsteht als Artikel mit den
 * Feldern wie bei `createArticle`; was sie nicht nennt, fuellen die Vorgaben.
 * Antwort: die Gruppe mit `variants[]` (Kennung und Merkmale je Variante).
 *
 * Braucht die Anlage mehr Schreibvorgaenge, als in einen Vorgang passen,
 * kommt `too_many_positions` mit `field` (`variants` bzw. `createMatrix`) und
 * nichts ist geschrieben: weniger Varianten senden, den Rest per [addVariant].
 */
export async function createVariantGroup(transport: InternerTransport, request: CreateVariantGroupRequest): Promise<VariantGroup> {
  const name = 'createVariantGroup';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  if (p.createMatrix === true && p.variants !== null && p.variants !== undefined) {
    throw anfragefehler(name, 'createMatrix und variants schliessen sich aus: entweder alle Kombinationen oder die genannten Varianten');
  }
  vorgabenZahlen(name, p.defaults);
  if (p.variants !== null && p.variants !== undefined) {
    if (!Array.isArray(p.variants)) throw anfragefehler(name, 'variants muss eine Liste sein');
    p.variants.forEach((x, i) => variante(name, x, `variants[${i}].`));
  }
  return gruppeAus(name, await transport(name, p));
}

/**
 * Aendert eine aktive Gruppe (Name, Vorgaben, neue Werte) oder legt sie mit
 * `active: false` still: die Gruppe und alle ihre Varianten, endgueltig. Die
 * Antwort kommt erst, wenn alle Varianten stillgelegt sind. Bestehende
 * Varianten aendern Name und Vorgaben nicht (dafuer `updateArticle`).
 */
export async function updateVariantGroup(transport: InternerTransport, request: UpdateVariantGroupRequest): Promise<VariantGroup> {
  const name = 'updateVariantGroup';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  kennung(name, 'variantGroupId', p.variantGroupId);
  const aenderungen = (['name', 'defaults', 'addAttributeValues'] as const).filter((k) => p[k] !== undefined);
  if (p.active !== undefined) {
    if (p.active !== false) throw anfragefehler(name, 'active kennt nur false (stilllegen); eine stillgelegte Gruppe bleibt stillgelegt');
    if (aenderungen.length) throw anfragefehler(name, 'active: false steht allein, ohne weitere Aenderung');
  } else if (!aenderungen.length) {
    throw anfragefehler(name, 'die Aenderung nennt kein Feld');
  }
  vorgabenZahlen(name, p.defaults);
  if (p.addAttributeValues !== undefined && !istObjekt(p.addAttributeValues)) {
    throw anfragefehler(name, 'addAttributeValues muss ein Objekt { merkmal: [werte] } sein');
  }
  return gruppeAus(name, await transport(name, p));
}

/**
 * Legt eine Variante in einer aktiven Gruppe an. Antwort: der Artikel wie
 * `createArticle`. Gibt es die Kombination schon, kommt
 * `variant_already_exists` mit `articleId` der bestehenden Variante; nach dem
 * Stilllegen einer Variante ist ihre Kombination wieder frei.
 */
export async function addVariant(transport: InternerTransport, request: AddVariantRequest): Promise<Article> {
  const name = 'addVariant';
  const p = anfrage(name, request);
  schluessel(name, p, { pflicht: true });
  kennung(name, 'variantGroupId', p.variantGroupId);
  variante(name, p, '');
  return artikelAus(name, await transport(name, p));
}

/** Eine Variantengruppe mit ihren aktiven Varianten (eingefroren, wenn stillgelegt). */
export async function getVariantGroup(transport: InternerTransport, variantGroupId: string): Promise<VariantGroup> {
  const name = 'getVariantGroup';
  return gruppeAus(name, await transport(name, { variantGroupId: kennung(name, 'variantGroupId', variantGroupId) }));
}

/** Variantengruppen nach `updatedAt` aufsteigend; Filter `active` und `updatedSince` (inklusive). */
export async function listVariantGroups(transport: InternerTransport, query?: VariantGroupListQuery): Promise<VariantGroupPage> {
  const name = 'listVariantGroups';
  const daten = await transport(name, abfrage(name, query));
  return { variantGroups: liste(name, daten, 'variantGroups', variantengruppe), nextCursor: naechsterCursor(name, daten) };
}

/** Alle Variantengruppen der Abfrage, Seite fuer Seite ueber `nextCursor`. */
export function iterateVariantGroups(
  transport: InternerTransport,
  query?: VariantGroupListQuery,
): AsyncGenerator<VariantGroup, void, undefined> {
  const { cursor, ...rest } = query ?? {};
  return seitenweise('listVariantGroups', cursor, async (c) => {
    const s = await listVariantGroups(transport, { ...rest, cursor: c });
    return { eintraege: s.variantGroups, nextCursor: s.nextCursor };
  });
}
