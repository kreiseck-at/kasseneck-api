/**
 * Leser der Schicht-Antworten: aus dem Draht `/v3` werden die Modelle in
 * `schicht-typen.ts`. Paketintern, nicht Teil der Oberflaeche.
 *
 * Regel wie beim Lager: ein Betrag, eine Anzahl oder eine Nummer ist eine
 * Ganzzahl, eine Kennung ein nicht leerer Text, sonst endet der Aufruf mit
 * `KasseneckValidationError`. Ein Ersatzwert wie `0` waere eine falsche
 * Aussage („nichts in der Lade“ statt „Antwort kaputt“). Texte sind
 * nachsichtiger: ein fehlender oder fremder Wert wird `null`.
 *
 * Felder, die nur mit Recht kommen (`expectedCents`, `runningTotals` …),
 * stehen im Modell genau dann, wenn der Server sie sendet.
 */

import { KasseneckValidationError, type ValidationScope } from '../client/errors.js';
import { SHIFT_RECEIPT_KINDS } from './schicht-typen.js';
import type {
  CashMovement,
  CashMovementReceipt,
  CashMovementResult,
  DrawerOpeningsResult,
  OpenShiftResult,
  ShiftReport,
  CloseShiftResult,
  Denominations,
  DrawerOpening,
  DrawerState,
  NonCashAmount,
  Shift,
  ShiftActor,
  ShiftReceiptHeader,
  ShiftReconciliation,
  ShiftRunningTotals,
  ShiftSummaryReceipt,
  ShiftTip,
  ShiftTipTotals,
  TipClaim,
} from './schicht-typen.js';

type Roh = Record<string, unknown>;

/** Wer liest (fuer die Meldung) und wo im Rumpf. */
export interface Ort {
  name: string;
  pfad: string;
  /** `response` fuer Antworten, `request` fuer Bon-Daten, die ein Aufrufer uebergibt. */
  scope: ValidationScope;
}

const hat = (o: Roh, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const unter = (ort: Ort, teil: string): Ort => ({ ...ort, pfad: ort.pfad === '' ? teil : `${ort.pfad}.${teil}` });

function fehler(ort: Ort, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(ort.name, `${ort.scope === 'response' ? 'Antwort' : 'Bon-Daten'}: ${grund}`, ort.scope);
}

function objekt(w: unknown): Roh | null {
  return w !== null && typeof w === 'object' && !Array.isArray(w) ? (w as Roh) : null;
}

/** Ein Objekt, das da sein muss. */
export function pflichtObjekt(ort: Ort, w: unknown): Roh {
  const o = objekt(w);
  if (!o) throw fehler(ort, `${ort.pfad || 'data'} ist kein Objekt`);
  return o;
}

const text = (w: unknown): string | null => (typeof w === 'string' ? w : null);

function kennung(ort: Ort, o: Roh, feld: string): string {
  const w = o[feld];
  if (typeof w !== 'string' || w === '') throw fehler(ort, `${ort.pfad}.${feld} fehlt`);
  return w;
}

function ganzzahl(ort: Ort, o: Roh, feld: string): number {
  const w = o[feld];
  if (typeof w !== 'number' || !Number.isSafeInteger(w)) throw fehler(ort, `${ort.pfad}.${feld} ist keine ganze Zahl`);
  return w;
}

function ganzzahlOderNull(ort: Ort, o: Roh, feld: string): number | null {
  const w = o[feld];
  return w === undefined || w === null ? null : ganzzahl(ort, o, feld);
}

function wahr(ort: Ort, o: Roh, feld: string): boolean {
  const w = o[feld];
  if (typeof w !== 'boolean') throw fehler(ort, `${ort.pfad}.${feld} ist kein Wahrheitswert`);
  return w;
}

function wahrOderNull(ort: Ort, o: Roh, feld: string): boolean | null {
  const w = o[feld];
  return w === undefined || w === null ? null : wahr(ort, o, feld);
}

function liste<T>(ort: Ort, o: Roh, feld: string, lese: (ort: Ort, w: unknown) => T): T[] {
  const w = o[feld];
  if (!Array.isArray(w)) throw fehler(ort, `${ort.pfad}.${feld} ist keine Liste`);
  return w.map((e, i) => lese(unter(ort, `${feld}[${i}]`), e));
}

/** Setzt ein Feld nur, wenn der Server es sendet (Recht). */
function wennDa<T>(ziel: Roh, o: Roh, feld: string, lese: () => T): void {
  if (hat(o, feld)) ziel[feld] = lese();
}

function stueckelung(ort: Ort, o: Roh, feld: string): Denominations | null {
  const w = o[feld];
  if (w === undefined || w === null) return null;
  const karte = objekt(w);
  if (!karte) throw fehler(ort, `${ort.pfad}.${feld} ist keine Stueckelung`);
  const raus: Denominations = {};
  for (const k of Object.keys(karte)) raus[k] = ganzzahl(unter(ort, feld), karte, k);
  return raus;
}

function akteur(ort: Ort, w: unknown): ShiftActor | null {
  if (w === undefined || w === null) return null;
  const o = pflichtObjekt(ort, w);
  return { registerUserId: text(o.registerUserId), name: text(o.name), role: text(o.role) ?? '' };
}

function unbar(ort: Ort, w: unknown): NonCashAmount {
  const o = pflichtObjekt(ort, w);
  return { method: kennung(ort, o, 'method'), cents: ganzzahl(ort, o, 'cents') };
}

function trinkgeld(ort: Ort, w: unknown): ShiftTipTotals {
  const o = pflichtObjekt(ort, w);
  return {
    registerUserId: kennung(ort, o, 'registerUserId'),
    name: text(o.name),
    receivedImmediatelyCents: ganzzahl(ort, o, 'receivedImmediatelyCents'),
    retainedCents: ganzzahl(ort, o, 'retainedCents'),
    paidOutCents: ganzzahl(ort, o, 'paidOutCents'),
    // Fehlt bei einem Backend vor der Regel R62: dann 0, statt die ganze Antwort zu verwerfen.
    refundedByEmployeeCents: o.refundedByEmployeeCents === undefined || o.refundedByEmployeeCents === null ? 0 : ganzzahl(ort, o, 'refundedByEmployeeCents'),
  };
}

/** Trinkgeld mit offenem Anspruch (Kassenstand, Bon). */
function trinkgeldMitOffen(ort: Ort, w: unknown): ShiftTip {
  const o = pflichtObjekt(ort, w);
  return {
    ...trinkgeld(ort, o),
    // Fehlt bei einem Backend vor der Regel R64: dann 0.
    carriedOverCents: o.carriedOverCents === undefined || o.carriedOverCents === null ? 0 : ganzzahl(ort, o, 'carriedOverCents'),
    openCents: ganzzahl(ort, o, 'openCents'),
  };
}

function laufstand(ort: Ort, w: unknown): ShiftRunningTotals {
  const o = pflichtObjekt(ort, w);
  return {
    cashSalesCents: ganzzahl(ort, o, 'cashSalesCents'),
    cashCancellationsCents: ganzzahl(ort, o, 'cashCancellationsCents'),
    nonCashByMethod: liste(ort, o, 'nonCashByMethod', unbar),
    receiptCount: ganzzahl(ort, o, 'receiptCount'),
    cancellationCount: ganzzahl(ort, o, 'cancellationCount'),
    cashInCents: ganzzahl(ort, o, 'cashInCents'),
    cashOutCents: ganzzahl(ort, o, 'cashOutCents'),
    tips: liste(ort, o, 'tips', trinkgeld),
    openingsWithoutSale: ganzzahl(ort, o, 'openingsWithoutSale'),
  };
}

function abgleich(ort: Ort, w: unknown): ShiftReconciliation | null {
  if (w === undefined || w === null) return null;
  const o = pflichtObjekt(ort, w);
  const abw = o.deviations;
  let deviations: ShiftReconciliation['deviations'] = null;
  if (abw !== undefined && abw !== null) {
    const karte = pflichtObjekt(unter(ort, 'deviations'), abw);
    deviations = {};
    for (const [feld, eintrag] of Object.entries(karte)) {
      const e = pflichtObjekt(unter(ort, `deviations.${feld}`), eintrag);
      deviations[feld] = { stored: e.stored, recomputed: e.recomputed };
    }
  }
  return { matches: wahr(ort, o, 'matches'), deviations };
}

/** Eine Schicht; was nur mit `cashView` kommt, steht nur, wenn gesendet. */
export function schicht(ort: Ort, w: unknown): Shift {
  const o = pflichtObjekt(ort, w);
  const status = o.status;
  if (status !== 'open' && status !== 'closed') throw fehler(ort, `${ort.pfad}.status ist unbekannt`);
  const raus: Shift = {
    id: kennung(ort, o, 'id'),
    drawerId: kennung(ort, o, 'drawerId'),
    cashregisterId: text(o.cashregisterId),
    number: ganzzahl(ort, o, 'number'),
    status,
    openedAt: text(o.openedAt),
    openedBy: akteur(unter(ort, 'openedBy'), o.openedBy),
  };
  const r = raus as unknown as Roh;
  // Ohne Recht `shift` fehlen sie (Grunddaten der offenen Schicht).
  wennDa(r, o, 'openedDeviceId', () => text(o.openedDeviceId));
  wennDa(r, o, 'closedAt', () => text(o.closedAt));
  wennDa(r, o, 'closedBy', () => akteur(unter(ort, 'closedBy'), o.closedBy));
  wennDa(r, o, 'closedDeviceId', () => text(o.closedDeviceId));
  wennDa(r, o, 'openingFloatCents', () => ganzzahlOderNull(ort, o, 'openingFloatCents'));
  wennDa(r, o, 'openingDenominations', () => stueckelung(ort, o, 'openingDenominations'));
  wennDa(r, o, 'openingFloatTakenOver', () => wahr(ort, o, 'openingFloatTakenOver'));
  wennDa(r, o, 'comment', () => text(o.comment));
  wennDa(r, o, 'blind', () => wahrOderNull(ort, o, 'blind'));
  wennDa(r, o, 'countedCents', () => ganzzahlOderNull(ort, o, 'countedCents'));
  wennDa(r, o, 'suggestedFloatCents', () => ganzzahlOderNull(ort, o, 'suggestedFloatCents'));
  wennDa(r, o, 'runningTotals', () => laufstand(unter(ort, 'runningTotals'), o.runningTotals));
  wennDa(r, o, 'expectedCents', () => ganzzahlOderNull(ort, o, 'expectedCents'));
  wennDa(r, o, 'differenceCents', () => ganzzahlOderNull(ort, o, 'differenceCents'));
  wennDa(r, o, 'reconciliation', () => abgleich(unter(ort, 'reconciliation'), o.reconciliation));
  return raus;
}

function schichtOderNull(ort: Ort, w: unknown): Shift | null {
  return w === null ? null : schicht(ort, w);
}

function anspruch(ort: Ort, w: unknown): TipClaim {
  const o = pflichtObjekt(ort, w);
  return { registerUserId: kennung(ort, o, 'registerUserId'), name: text(o.name), cents: ganzzahl(ort, o, 'cents') };
}

function oeffnung(ort: Ort, w: unknown): DrawerOpening {
  const o = pflichtObjekt(ort, w);
  const von = objekt(o.by);
  return {
    at: text(o.at),
    deviceTime: text(o.deviceTime),
    reason: kennung(ort, o, 'reason'),
    by: von ? { name: text(von.name) } : null,
    ok: wahr(ort, o, 'ok'),
  };
}

export function ladeStand(ort: Ort, w: unknown): DrawerState {
  const o = pflichtObjekt(ort, w);
  const lade = pflichtObjekt(unter(ort, 'drawer'), o.drawer);
  const ladeOrt = unter(ort, 'drawer');
  const rechte = pflichtObjekt(unter(ort, 'rights'), o.rights);
  const rechteOrt = unter(ort, 'rights');
  const raus: DrawerState = {
    drawer: {
      id: kennung(ladeOrt, lade, 'id'),
      name: text(lade.name),
      shiftMode: wahr(ladeOrt, lade, 'shiftMode'),
      cashregisterId: text(lade.cashregisterId),
    },
    rights: {
      shift: wahr(rechteOrt, rechte, 'shift'),
      cashMove: wahr(rechteOrt, rechte, 'cashMove'),
      cashView: wahr(rechteOrt, rechte, 'cashView'),
      drawer: wahr(rechteOrt, rechte, 'drawer'),
    },
    tipClaims: liste(ort, o, 'tipClaims', anspruch),
    tips: liste(ort, o, 'tips', trinkgeldMitOffen),
  };
  const r = raus as unknown as Roh;
  wennDa(r, o, 'shift', () => schichtOderNull(unter(ort, 'shift'), o.shift));
  wennDa(r, o, 'longOpenWarning', () => wahr(ort, o, 'longOpenWarning'));
  wennDa(r, o, 'suggestedFloatCents', () => ganzzahlOderNull(ort, o, 'suggestedFloatCents'));
  wennDa(r, o, 'expectedCents', () => ganzzahlOderNull(ort, o, 'expectedCents'));
  wennDa(r, o, 'recentOpenings', () => liste(ort, o, 'recentOpenings', oeffnung));
  return raus;
}

export function bewegung(ort: Ort, w: unknown): CashMovement {
  const o = pflichtObjekt(ort, w);
  const empfaenger = objekt(o.recipient);
  const paar = objekt(o.counterpart);
  return {
    id: kennung(ort, o, 'id'),
    number: ganzzahl(ort, o, 'number'),
    shiftId: text(o.shiftId),
    type: kennung(ort, o, 'type'),
    amountCents: ganzzahl(ort, o, 'amountCents'),
    location: text(o.location) as CashMovement['location'],
    note: text(o.note),
    by: akteur(unter(ort, 'by'), o.by),
    at: text(o.at),
    recipient: empfaenger ? { registerUserId: text(empfaenger.registerUserId), name: text(empfaenger.name) } : null,
    counterpart: paar ? { drawerId: text(paar.drawerId), movementId: text(paar.movementId) } : null,
  };
}

function bonKopf(ort: Ort, o: Roh): ShiftReceiptHeader {
  const art = o.kind;
  if (typeof art !== 'string' || !(SHIFT_RECEIPT_KINDS as readonly string[]).includes(art)) throw fehler(ort, `${ort.pfad}.kind ist unbekannt`);
  const betrieb = objekt(o.business) ?? {};
  const kasse = objekt(o.cashregister) ?? {};
  const lade = objekt(o.drawer) ?? {};
  return {
    kind: art as ShiftReceiptHeader['kind'],
    blind: wahr(ort, o, 'blind'),
    business: { name: text(betrieb.name) },
    cashregister: { id: text(kasse.id), name: text(kasse.name) },
    drawer: { name: text(lade.name) },
  };
}

/** Bon-Daten eines Z- oder X-Bons; eine andere Art ist ein Fehler. */
export function schichtBon(ort: Ort, w: unknown): ShiftSummaryReceipt {
  const o = pflichtObjekt(ort, w);
  const kopf = bonKopf(ort, o);
  if (kopf.kind === 'cash_movement') throw fehler(ort, `${ort.pfad}.kind ist cash_movement, erwartet Z- oder X-Bon`);
  const s = pflichtObjekt(unter(ort, 'shift'), o.shift);
  const sOrt = unter(ort, 'shift');
  return {
    ...kopf,
    kind: kopf.kind,
    shift: {
      number: ganzzahl(sOrt, s, 'number'),
      openedAt: text(s.openedAt),
      closedAt: text(s.closedAt),
      openedByName: text(s.openedByName),
      closedByName: text(s.closedByName),
    },
    openingFloatCents: ganzzahlOderNull(ort, o, 'openingFloatCents'),
    openingFloatTakenOver: wahr(ort, o, 'openingFloatTakenOver'),
    openingDenominations: stueckelung(ort, o, 'openingDenominations'),
    cashSalesCents: ganzzahlOderNull(ort, o, 'cashSalesCents'),
    cashCancellationsCents: ganzzahlOderNull(ort, o, 'cashCancellationsCents'),
    receiptCount: ganzzahl(ort, o, 'receiptCount'),
    cancellationCount: ganzzahl(ort, o, 'cancellationCount'),
    nonCashByMethod: liste(ort, o, 'nonCashByMethod', unbar),
    movements: liste(ort, o, 'movements', (mOrt, mw) => {
      const m = pflichtObjekt(mOrt, mw);
      return {
        number: ganzzahl(mOrt, m, 'number'),
        type: kennung(mOrt, m, 'type'),
        amountCents: ganzzahl(mOrt, m, 'amountCents'),
        note: text(m.note),
        byName: text(m.byName),
        at: text(m.at),
      };
    }),
    tips: liste(ort, o, 'tips', trinkgeldMitOffen),
    expectedCents: ganzzahlOderNull(ort, o, 'expectedCents'),
    countedCents: ganzzahlOderNull(ort, o, 'countedCents'),
    countedDenominations: stueckelung(ort, o, 'countedDenominations'),
    differenceCents: ganzzahlOderNull(ort, o, 'differenceCents'),
    comment: text(o.comment),
    openingsWithoutSale: ganzzahl(ort, o, 'openingsWithoutSale'),
  };
}

/** Bon-Daten einer Kassenbewegung; eine andere Art ist ein Fehler. */
export function bewegungsBon(ort: Ort, w: unknown): CashMovementReceipt {
  const o = pflichtObjekt(ort, w);
  const kopf = bonKopf(ort, o);
  if (kopf.kind !== 'cash_movement') throw fehler(ort, `${ort.pfad}.kind ist ${kopf.kind}, erwartet cash_movement`);
  const s = objekt(o.shift);
  const m = pflichtObjekt(unter(ort, 'movement'), o.movement);
  const mOrt = unter(ort, 'movement');
  return {
    ...kopf,
    kind: 'cash_movement',
    shift: s ? { number: ganzzahl(unter(ort, 'shift'), s, 'number') } : null,
    movement: {
      number: ganzzahl(mOrt, m, 'number'),
      type: kennung(mOrt, m, 'type'),
      amountCents: ganzzahl(mOrt, m, 'amountCents'),
      note: text(m.note),
      location: text(m.location) as CashMovementReceipt['movement']['location'],
      recipientName: text(m.recipientName),
      targetDrawerName: text(m.targetDrawerName),
      byName: text(m.byName),
      at: text(m.at),
    },
  };
}

export function abschluss(ort: Ort, w: unknown): CloseShiftResult {
  const o = pflichtObjekt(ort, w);
  if (o.status === 'recount') return { status: 'recount' };
  if (o.status !== 'closed') throw fehler(ort, `${ort.pfad || 'data'}.status ist unbekannt`);
  return {
    status: 'closed',
    shift: schicht(unter(ort, 'shift'), o.shift),
    receipt: schichtBon(unter(ort, 'receipt'), o.receipt),
    lastShiftOfRegister: wahr(ort, o, 'lastShiftOfRegister'),
  };
}

export function geoeffnet(ort: Ort, w: unknown): OpenShiftResult {
  const o = pflichtObjekt(ort, w);
  const raus: OpenShiftResult = { shift: schicht(unter(ort, 'shift'), o.shift) };
  wennDa(raus as unknown as Roh, o, 'handoverDifferenceCents', () => ganzzahlOderNull(ort, o, 'handoverDifferenceCents'));
  return raus;
}

export function gebucht(ort: Ort, w: unknown): CashMovementResult {
  const o = pflichtObjekt(ort, w);
  return { movement: bewegung(unter(ort, 'movement'), o.movement), receipt: bewegungsBon(unter(ort, 'receipt'), o.receipt) };
}

export function gemeldet(ort: Ort, w: unknown): DrawerOpeningsResult {
  const o = pflichtObjekt(ort, w);
  return { accepted: ganzzahl(ort, o, 'accepted'), duplicates: ganzzahl(ort, o, 'duplicates'), drawerId: text(o.drawerId) };
}

export function bericht(ort: Ort, w: unknown): ShiftReport {
  const o = pflichtObjekt(ort, w);
  return {
    shift: schicht(unter(ort, 'shift'), o.shift),
    movements: liste(ort, o, 'movements', bewegung),
    receipt: schichtBon(unter(ort, 'receipt'), o.receipt),
  };
}
