/**
 * Leergut-Codes an der Kasse (Pfand & Leergut): ein Code, den die Kasse im Leergut-Blatt noch nicht kennt,
 * wird einer Pfandart zugeordnet und gelernt (`learnReturnCode`); `listReturnCodes` liest die gelernten Codes.
 * `matchReturnCode` ist die Regel, mit der ein Scan im Leergut-Blatt einer Pfandart zugeordnet wird – Web-Kasse
 * und Kassen-App (ueber den Dart-Zwilling) benutzen genau diese Regel.
 */

import { Gtin } from '@kreiseck/validator';
import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import { depositsFor, type DepositEntry, type DepositType } from './pfand.js';

/** Ein gelernter Leergut-Code: die GTIN und die Pfandart, der sie zugeordnet ist. */
export interface ReturnCode {
  gtin: string;
  depositTypeId: string;
}

/** Eine Zeile der Zuordnung: Pfandart und Stueckzahl, die ein Scan ins Leergut-Blatt bringt. */
export interface ReturnCodeEntry {
  depositTypeId: string;
  quantity: number;
}

/** Ergebnis von `matchReturnCode`: die Eintraege oder `unknown` (Code ist keiner Pfandart zuzuordnen). */
export type ReturnCodeMatch = { entries: ReturnCodeEntry[] } | { unknown: true };

type Objekt = Record<string, unknown>;
const istObjekt = (w: unknown): w is Objekt => w !== null && typeof w === 'object' && !Array.isArray(w);

function leergutCode(wert: unknown): ReturnCode | null {
  if (!istObjekt(wert) || typeof wert['gtin'] !== 'string' || typeof wert['depositTypeId'] !== 'string') return null;
  return { gtin: wert['gtin'], depositTypeId: wert['depositTypeId'] };
}

/**
 * Lernt einen Leergut-Code (`learnMyLeergutCode`, nur Kassenweg, Recht `depositReturn`): `gtin` muss eine gueltige
 * GTIN sein, `depositTypeId` eine aktive Pfandart. Die Form wird vor dem Senden geprueft; was der Server nicht
 * annimmt, lehnt er mit `invalid_deposit` oder `deposit_type_not_found` ab.
 */
export async function learnReturnCode(transport: InternerTransport, code: ReturnCode): Promise<ReturnCode> {
  const name = 'learnMyLeergutCode';
  const anfrage = (grund: string) => new KasseneckValidationError(name, grund, 'request');
  if (!istObjekt(code)) throw anfrage('Anfrage muss ein Objekt sein');
  const fremd = Object.keys(code).find((k) => k !== 'gtin' && k !== 'depositTypeId');
  if (fremd != null) throw anfrage(`unbekanntes Feld "${fremd}"`);
  if (typeof code.gtin !== 'string' || !Gtin.isValid(code.gtin)) throw anfrage('gtin ist keine gueltige GTIN');
  if (typeof code.depositTypeId !== 'string' || code.depositTypeId === '') throw anfrage('depositTypeId fehlt');
  const antwort = await transport<unknown>(name, { gtin: code.gtin, depositTypeId: code.depositTypeId });
  return leergutCode(antwort) ?? { gtin: code.gtin, depositTypeId: code.depositTypeId };
}

/** Liest die gelernten Leergut-Codes (`listMyLeergutCodes`, nur Kassenweg): nur aktive Pfandarten, nach GTIN sortiert. */
export async function listReturnCodes(transport: InternerTransport): Promise<ReturnCode[]> {
  const antwort = await transport<unknown>('listMyLeergutCodes', {});
  const liste = istObjekt(antwort) && Array.isArray(antwort['codes']) ? antwort['codes'] : [];
  return liste.map(leergutCode).filter((c): c is ReturnCode => c != null);
}

/** Was `matchReturnCode` von einem Artikel braucht (Teil von `PosArticle`). */
export interface ReturnCodeArticle {
  groupId?: string | null;
  ean?: string | null;
  number?: string | null;
  internalCode?: string | null;
  deposits?: DepositEntry[] | null;
  externalVoucher?: unknown;
}

/** Was `matchReturnCode` von einer Gruppe braucht (Teil von `ArticleGroup`). */
export interface ReturnCodeGroup {
  id: string;
  deposits?: DepositEntry[] | null;
}

export interface ReturnCodeInput {
  articles: ReadonlyArray<ReturnCodeArticle>;
  groups: ReadonlyArray<ReturnCodeGroup>;
  learned: ReadonlyArray<ReturnCode>;
  depositTypes: ReadonlyArray<Pick<DepositType, 'id' | 'active'>>;
}

/**
 * Ordnet einen Scan im Leergut-Blatt einer Pfandart zu. Reihenfolge: (1) gelernter Code -> 1 Stueck; (2) `gtin` eines
 * Pfandeintrags an Artikel oder Gruppe -> 1 Stueck dieser Pfandart; (3) Artikel-EAN, -Nummer oder -Code mit wirksamer
 * Pfandliste -> jeder Eintrag mit seiner `quantity` (Kiste: 1 Kiste + 20 Flaschen); sonst `unknown`. Es zaehlen nur
 * aktive Pfandarten: ein Treffer auf eine stillgelegte oder unbekannte Pfandart ist `unknown` (die Suche endet am
 * ersten Treffer, sie faellt nicht auf die naechste Stufe zurueck). Der Code wird getrimmt, ein leerer ist `unknown`.
 */
export function matchReturnCode(code: string, input: ReturnCodeInput): ReturnCodeMatch {
  const unbekannt: ReturnCodeMatch = { unknown: true };
  const gesucht = typeof code === 'string' ? code.trim() : '';
  if (gesucht === '') return unbekannt;
  const aktiv = new Set(input.depositTypes.filter((t) => t.active).map((t) => t.id));
  const eins = (depositTypeId: string): ReturnCodeMatch => (aktiv.has(depositTypeId) ? { entries: [{ depositTypeId, quantity: 1 }] } : unbekannt);

  const gelernt = input.learned.find((l) => l.gtin === gesucht);
  if (gelernt != null) return eins(gelernt.depositTypeId);

  const gruppeVon = (a: ReturnCodeArticle) => input.groups.find((g) => g.id === a.groupId) ?? null;
  for (const a of input.articles) {
    const hit = (depositsFor(a, gruppeVon(a))).find((d) => d.gtin === gesucht);
    if (hit != null) return eins(hit.depositTypeId);
  }
  for (const g of input.groups) {
    const hit = (g.deposits ?? []).find((d) => d.gtin === gesucht);
    if (hit != null) return eins(hit.depositTypeId);
  }

  const artikel = input.articles.find((a) => a.ean === gesucht || a.number === gesucht || a.internalCode === gesucht);
  if (artikel == null) return unbekannt;
  const liste = depositsFor(artikel, gruppeVon(artikel));
  if (liste.length === 0 || !liste.every((d) => aktiv.has(d.depositTypeId))) return unbekannt;
  return { entries: liste.map((d) => ({ depositTypeId: d.depositTypeId, quantity: d.quantity })) };
}
