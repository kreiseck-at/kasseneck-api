/**
 * Schicht, Kassenstand und Lade-Protokoll: Kataloge und Modelle, wie sie am
 * Kassenweg `/api/v3` ankommen (Backend schicht-endpoints.js, Vokabular
 * `KASSEN_BEWEGUNG_ART`, `KASSEN_ORT`, `LADE_OEFFNUNG_GRUND`,
 * `SCHICHT_BON_ART`). Die Modelle sind die Drahtform, Feld fuer Feld.
 *
 * **Fehlt ein Feld, fehlt das Recht.** Ohne `cashView` sendet der Server kein
 * Soll, kein Ist, keinen Laufstand und keinen Vorschlag (Blindzaehlung); im
 * Modell fehlen sie dann auch (`undefined`), nie stehen sie als `0` da. Auf
 * dem Bon (`ShiftSummaryReceipt`) stehen dieselben Werte blind als `null`.
 *
 * Alle Betraege in Cent (Ganzzahl, Vorzeichen wie gebucht), Zeiten als
 * ISO 8601 (UTC), Stueckelung als Karte „Wert in Cent“ -> Anzahl
 * (`{ "2000": 1, "500": 3 }`).
 */

/** Scheine und Muenzen in Euro-Cent, vom groessten Schein abwaerts (Backend `EUR_STUECKELUNG`). */
export const EUR_DENOMINATIONS = Object.freeze([50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const);
export type EurDenomination = (typeof EUR_DENOMINATIONS)[number];

/**
 * Alle Arten einer Kassenbewegung (Katalog `KASSEN_BEWEGUNG_ART`). Die ersten
 * acht sendet die Kasse ([MANUAL_MOVEMENT_TYPES]); `transfer_in` (Gegenseite
 * einer Umbuchung), `expense`, `count_difference` und `handover_difference`
 * vergibt nur der Server.
 */
export const MOVEMENT_TYPES = Object.freeze([
  'change_in', 'cash_drop', 'owner_deposit', 'owner_withdrawal', 'tip_payout', 'other_in', 'other_out', 'transfer_out',
  'transfer_in', 'expense', 'count_difference', 'handover_difference',
] as const);
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Was die Kasse von Hand buchen darf. Pflichtangaben je Art (sonst lehnt der
 * Server ab): `location` bei `change_in`/`cash_drop`, `note` bei
 * `other_in`/`other_out`, `recipientId` bei `tip_payout`, `targetDrawerId`
 * bei `transfer_out`.
 */
export const MANUAL_MOVEMENT_TYPES = Object.freeze([
  'change_in', 'cash_drop', 'owner_deposit', 'owner_withdrawal', 'tip_payout', 'other_in', 'other_out', 'transfer_out',
] as const);
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

/** Woher Wechselgeld kommt bzw. wohin abgeschoepft wird (Katalog `KASSEN_ORT`). */
export const CASH_LOCATIONS = Object.freeze(['bank', 'safe'] as const);
export type CashLocation = (typeof CASH_LOCATIONS)[number];

/**
 * Warum die Lade aufging (Katalog `LADE_OEFFNUNG_GRUND`). `sale`,
 * `cash_movement`, `shift_open` und `shift_close` meldet die Kasse selbst beim
 * jeweiligen Vorgang; von Hand waehlt der Kassier aus [MANUAL_OPENING_REASONS].
 */
export const OPENING_REASONS = Object.freeze([
  'sale', 'cash_movement', 'shift_open', 'shift_close', 'change', 'check', 'misoperation', 'other',
] as const);
export type OpeningReason = (typeof OPENING_REASONS)[number];

/** Die Gruende des Knopfs „Lade“; `other` braucht einen Text (`note`). */
export const MANUAL_OPENING_REASONS = Object.freeze(['change', 'check', 'misoperation', 'other'] as const);
export type ManualOpeningReason = (typeof MANUAL_OPENING_REASONS)[number];

/** Arten der Bon-Daten (Katalog `SCHICHT_BON_ART`): Z-Bon, X-Bon, Kassenbewegung. */
export const SHIFT_RECEIPT_KINDS = Object.freeze(['shift_close', 'shift_interim', 'cash_movement'] as const);
export type ShiftReceiptKind = (typeof SHIFT_RECEIPT_KINDS)[number];

export type ShiftStatus = 'open' | 'closed';
/** Wer gehandelt hat: Kassen-Benutzer, Inhaber (Panel) oder Admin. */
export type ShiftActorRole = 'register_user' | 'owner' | 'admin';

/** Stueckelung: Wert in Cent (als Text) -> Anzahl. */
export type Denominations = Record<string, number>;

export interface ShiftActor {
  registerUserId: string | null;
  name: string | null;
  role: ShiftActorRole | string;
}

export interface DrawerInfo {
  id: string;
  name: string | null;
  /** Schichtbetrieb: verkauft wird erst nach dem Oeffnen einer Schicht. */
  shiftMode: boolean;
  cashregisterId: string | null;
}

/** Die vier Rechte des angemeldeten Benutzers an der Lade. */
export interface DrawerRights {
  /** Schicht oeffnen und schliessen. */
  shift: boolean;
  /** Ein- und Auszahlungen buchen. */
  cashMove: boolean;
  /** Soll, Ist und Differenz sehen; ohne dieses Recht wird blind gezaehlt. */
  cashView: boolean;
  /** Die Lade von Hand oeffnen (mit Grund). */
  drawer: boolean;
}

export interface NonCashAmount {
  /** Zahlart, wie am Beleg (`card` …). */
  method: string;
  cents: number;
}

export interface ShiftTipTotals {
  registerUserId: string;
  name: string | null;
  /** Schon erhalten (bar mitgenommen). */
  receivedImmediatelyCents: number;
  /** Behaelt der Betrieb und schuldet es. */
  retainedCents: number;
}

/** Laufstand der Schicht (nur mit `cashView`). */
export interface ShiftRunningTotals {
  cashSalesCents: number;
  cashCancellationsCents: number;
  /** Nach Zahlart sortiert. */
  nonCashByMethod: NonCashAmount[];
  receiptCount: number;
  cancellationCount: number;
  cashInCents: number;
  cashOutCents: number;
  /** Nach Name sortiert. */
  tips: ShiftTipTotals[];
  openingsWithoutSale: number;
}

/** Nachrechnung des Laufstands beim Abschluss: stimmt er, oder welche Felder weichen ab. */
export interface ShiftReconciliation {
  matches: boolean;
  /** Je abweichendem Feld (Name wie in [ShiftRunningTotals]) der gespeicherte und der nachgerechnete Wert. */
  deviations: Record<string, { stored: unknown; recomputed: unknown }> | null;
}

export interface Shift {
  id: string;
  drawerId: string;
  cashregisterId: string | null;
  number: number;
  status: ShiftStatus;
  openedAt: string | null;
  openedBy: ShiftActor | null;
  openedDeviceId: string | null;
  closedAt: string | null;
  closedBy: ShiftActor | null;
  closedDeviceId: string | null;
  /** Startgeld; blind `null`, wenn es uebernommen wurde. */
  openingFloatCents: number | null;
  openingDenominations: Denominations | null;
  openingFloatTakenOver: boolean;
  comment: string | null;
  /** Wurde blind gezaehlt (nach dem Abschluss); offen `null`. */
  blind: boolean | null;
  // Nur mit `cashView`:
  countedCents?: number | null;
  suggestedFloatCents?: number | null;
  runningTotals?: ShiftRunningTotals;
  expectedCents?: number | null;
  differenceCents?: number | null;
  reconciliation?: ShiftReconciliation | null;
}

/** Offener Trinkgeld-Anspruch eines Mitarbeiters (auszahlbar beim Abschluss oder per `tip_payout`). */
export interface TipClaim {
  registerUserId: string;
  name: string | null;
  cents: number;
}

/** Eine gemeldete Oeffnung der Lade (nur mit `cashView`). */
export interface DrawerOpening {
  /** Serverzeit des Eingangs. */
  at: string | null;
  /** Zeit am Geraet (bei nachgesendeten Oeffnungen frueher als `at`). */
  deviceTime: string | null;
  reason: OpeningReason | string;
  by: { name: string | null } | null;
  /** Ging der Impuls an die Lade durch? */
  ok: boolean;
}

/** Stand der Lade fuer die Kasse: Lade, Rechte, Schicht und was das Recht `cashView` zeigt. */
export interface DrawerState {
  drawer: DrawerInfo;
  rights: DrawerRights;
  /** Die offene Schicht oder `null`; fehlt ohne Recht `shift`. */
  shift?: Shift | null;
  /** Schicht seit mindestens 16 Stunden offen; fehlt ohne Recht `shift`. */
  longOpenWarning?: boolean;
  tipClaims: TipClaim[];
  /** Vorschlag fuer das Startgeld (letzter Stand); bei offener Schicht `null`. Nur mit `shift` und `cashView`. */
  suggestedFloatCents?: number | null;
  /** Soll in der Lade; ohne Schicht `null`. Nur mit `shift` und `cashView`. */
  expectedCents?: number | null;
  /** Die letzten Oeffnungen, neueste zuerst; nur mit `cashView`. */
  recentOpenings?: DrawerOpening[];
}

export interface CashMovement {
  id: string;
  number: number;
  shiftId: string | null;
  type: MovementType | string;
  /** Mit Vorzeichen: Auszahlungen negativ. */
  amountCents: number;
  location: CashLocation | null;
  note: string | null;
  by: ShiftActor | null;
  at: string | null;
  recipient: { registerUserId: string | null; name: string | null } | null;
  /** Gegenbuchung einer Umbuchung in der anderen Lade. */
  counterpart: { drawerId: string | null; movementId: string | null } | null;
}

/** Kopf jedes Bons der Schicht. */
export interface ShiftReceiptHeader {
  kind: ShiftReceiptKind;
  /** Ohne `cashView` erstellt: Soll, Ist, Differenz und Barumsatz sind `null`. */
  blind: boolean;
  business: { name: string | null };
  cashregister: { id: string | null; name: string | null };
  drawer: { name: string | null };
}

export interface ShiftReceiptMovement {
  number: number;
  type: MovementType | string;
  amountCents: number;
  note: string | null;
  byName: string | null;
  at: string | null;
}

export interface ShiftReceiptTip extends ShiftTipTotals {
  paidOutCents: number;
}

/** Bon-Daten des Z-Bons (`shift_close`) bzw. X-Bons (`shift_interim`). */
export interface ShiftSummaryReceipt extends ShiftReceiptHeader {
  kind: 'shift_close' | 'shift_interim';
  shift: { number: number; openedAt: string | null; closedAt: string | null; openedByName: string | null; closedByName: string | null };
  openingFloatCents: number | null;
  openingFloatTakenOver: boolean;
  openingDenominations: Denominations | null;
  cashSalesCents: number | null;
  cashCancellationsCents: number | null;
  receiptCount: number;
  cancellationCount: number;
  nonCashByMethod: NonCashAmount[];
  movements: ShiftReceiptMovement[];
  tips: ShiftReceiptTip[];
  expectedCents: number | null;
  /** Beim X-Bon immer `null`. */
  countedCents: number | null;
  countedDenominations: Denominations | null;
  differenceCents: number | null;
  comment: string | null;
  openingsWithoutSale: number;
}

/** Bon-Daten einer Kassenbewegung. */
export interface CashMovementReceipt extends ShiftReceiptHeader {
  kind: 'cash_movement';
  shift: { number: number } | null;
  movement: {
    number: number;
    type: MovementType | string;
    amountCents: number;
    note: string | null;
    location: CashLocation | null;
    recipientName: string | null;
    targetDrawerName: string | null;
    byName: string | null;
    at: string | null;
  };
}

export type ShiftReceipt = ShiftSummaryReceipt | CashMovementReceipt;

export interface OpenShiftResult {
  shift: Shift;
  /** Unterschied zum uebergebenen Bestand beim Zaehlen; nur mit `cashView`. */
  handoverDifferenceCents?: number | null;
}

export interface CashMovementResult {
  movement: CashMovement;
  receipt: CashMovementReceipt;
}

export interface DrawerOpeningsResult {
  accepted: number;
  /** Schon gemeldet (gleicher Schluessel): zaehlt nicht doppelt. */
  duplicates: number;
}

export interface ShiftReport {
  shift: Shift;
  /** Blind ohne `count_difference`/`handover_difference`. */
  movements: CashMovement[];
  /** X-Bon (offene Schicht) bzw. Z-Bon zum Nachdruck. */
  receipt: ShiftSummaryReceipt;
}

/**
 * Ergebnis von `closeMyShift`: `recount` = bitte noch einmal zaehlen (kein
 * Fehler), `closed` = geschlossen mit Z-Bon.
 */
export type CloseShiftResult =
  | { status: 'recount' }
  | { status: 'closed'; shift: Shift; receipt: ShiftSummaryReceipt; lastShiftOfRegister: boolean };
