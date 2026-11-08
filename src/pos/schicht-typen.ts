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
 * einer Umbuchung), `expense`, `count_difference`, `handover_difference` und
 * `interim_difference` (Differenz einer Zwischenzaehlung) vergibt nur der Server.
 */
export const MOVEMENT_TYPES = Object.freeze([
  'change_in', 'cash_drop', 'owner_deposit', 'owner_withdrawal', 'tip_payout', 'other_in', 'other_out', 'transfer_out',
  'transfer_in', 'expense', 'count_difference', 'handover_difference', 'interim_difference',
] as const);
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Was die Kasse von Hand buchen darf. Pflichtangaben je Art (sonst lehnt der
 * Server ab): `note` bei `other_in`/`other_out`, `recipientId` bei
 * `tip_payout`, `targetDrawerId` bei `transfer_out`. `location` bei
 * `change_in`/`cash_drop` ist freiwillig.
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
 * `cash_movement`, `shift_open`, `shift_close` und `voucher_payout` meldet die Kasse selbst beim
 * jeweiligen Vorgang; von Hand waehlt der Kassier aus [MANUAL_OPENING_REASONS].
 */
export const OPENING_REASONS = Object.freeze([
  'sale', 'cash_movement', 'shift_open', 'shift_close', 'change', 'check', 'misoperation', 'other', 'voucher_payout',
] as const);
export type OpeningReason = (typeof OPENING_REASONS)[number];

/** Die Gruende des Knopfs „Lade“; `other` braucht einen Text (`note`). */
export const MANUAL_OPENING_REASONS = Object.freeze(['change', 'check', 'misoperation', 'other'] as const);
export type ManualOpeningReason = (typeof MANUAL_OPENING_REASONS)[number];

/**
 * Was nach dem Zaehlen beim Schicht-Abschluss mit dem Geld geschieht (Katalog
 * `NACH_ZAEHLUNG_ART`): `cash_drop` = entnehmen (gebucht als Abschoepfung),
 * `change_in` = einlegen (gebucht als Wechselgeld). Beides Geldtransit, kein Umsatz.
 */
export const AFTER_COUNT_TYPES = Object.freeze(['cash_drop', 'change_in'] as const);
export type AfterCountType = (typeof AFTER_COUNT_TYPES)[number];

/**
 * Entnehmen oder Einlegen nach dem Zaehlen: `amountCents` immer positiv, die
 * Richtung sagt `type`. Gezaehlt wird immer die ganze Lade; was danach bleibt,
 * steht in `leftInDrawerCents` (Schicht, Z-Bon).
 */
export interface AfterCount {
  /** Ein Wert aus [AFTER_COUNT_TYPES] oder ein kuenftiger. */
  type: AfterCountType | (string & {});
  amountCents: number;
}

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
  /**
   * Wechselgeld der Lade in Cent („Wechselgeld in der Lade“): bleibt nach jedem
   * Schicht-Abschluss drin, mehr wird beim Schliessen entnommen. Fehlt, wenn
   * nicht eingestellt (dann bleibt alles in der Lade, wie bisher).
   */
  changeFloatCents?: number;
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
  /** Steht dem Mitarbeiter aus der Lade zu (bar oder Karte am Terminal des Betriebs). */
  receivedImmediatelyCents: number;
  /** Behaelt der Betrieb und zahlt es ueber den Lohn („über Lohn“). */
  retainedCents: number;
  /** In dieser Schicht aus der Lade ausgezahlt („schon genommen“). */
  paidOutCents: number;
  /**
   * Beim Storno selbst zurueckgegeben („Gibt die Mitarbeiterin direkt“, „selbst zurückgegeben“).
   * Eigene Zahl, damit „schon genommen“ nie negativ wird: offen = verdient − genommen + selbst
   * zurueckgegeben. Fehlt es in der Antwort (Backend vor dieser Regel), gilt 0.
   */
  refundedByEmployeeCents: number;
}

/**
 * Trinkgeld eines Mitarbeiters mit seinem offenen Anspruch an die Lade
 * (`openCents`, „offen“): im Kassenstand ([DrawerState.tips]) und auf dem
 * Z- und X-Bon. Was davon gezeigt wird, sagt [shiftTipLines].
 */
export interface ShiftTip extends ShiftTipTotals {
  /**
   * Offene Forderung an die Lade beim Oeffnen der Schicht („aus früheren Schichten“, Fix-Runde 2,
   * R64); ohne offene Schicht der ganze Anspruch. Fehlt es (Backend bzw. Schicht vor dieser Regel), 0.
   * Fuer den Leser geht auf: offen = aus früheren Schichten + verdient − über Lohn − schon genommen
   * + selbst zurückgegeben.
   */
  carriedOverCents: number;
  openCents: number;
}

/** Laufstand der Schicht (nur mit `cashView`). */
export interface ShiftRunningTotals {
  cashSalesCents: number;
  cashCancellationsCents: number;
  /** Nach Zahlart sortiert. */
  nonCashByMethod: NonCashAmount[];
  /** Eingelöste Gutscheine in Cent (kein Bargeld, nicht in der Lade); fehlt bei älteren Servern, dann 0. */
  voucherRedeemedCents: number;
  receiptCount: number;
  cancellationCount: number;
  cashInCents: number;
  cashOutCents: number;
  /** Nach Name sortiert. */
  tips: ShiftTipTotals[];
  openingsWithoutSale: number;
  /**
   * Trinkgeld an Kassen-Benutzer mit „Trinkgeld steuerpflichtig“ (Inhaber): zählt als Umsatz des Betriebs,
   * nie als Anspruch, nie in „offen“ (nur Anzeige, 1.28.0). Nach Name sortiert; der Server sendet es nur,
   * wenn es etwas gibt (fehlt = keines).
   */
  ownerTips?: ShiftOwnerTip[];
  /** Trinkgeld ohne angemeldeten Empfänger in Cent (nur Anzeige, 1.28.0); fehlt = 0. */
  unassignedTipCents?: number;
  /**
   * Gewaehrte Rabatte je Name (nur Anzeige, nie im Soll): `cents` gewaehrt (positiv), `count` Belege mit diesem
   * Namen, ein Storno nimmt beides zurueck. Der Server sendet es erst ab dem ersten Rabatt (fehlt = keiner);
   * auf dem Z-Bon steht es als Block ([discountBlockLines]).
   */
  discounts?: ShiftDiscount[];
}

/** Ein Eintrag von [ShiftRunningTotals.discounts] bzw. [ShiftSummaryReceipt.discounts]. */
export interface ShiftDiscount {
  /** Name der Rabattzeile am Beleg (`''` = unbenannt, „Rabatt“). */
  name: string;
  cents: number;
  count: number;
}

/** Ein Eintrag von [ShiftRunningTotals.ownerTips]: Trinkgeld, das als Umsatz erfasst ist. */
export interface ShiftOwnerTip {
  registerUserId: string;
  name: string | null;
  cents: number;
}

/** Nachrechnung des Laufstands beim Abschluss: stimmt er, oder welche Felder weichen ab. */
export interface ShiftReconciliation {
  matches: boolean;
  /** Je abweichendem Feld (Name wie in [ShiftRunningTotals]) der gespeicherte und der nachgerechnete Wert. */
  deviations: Record<string, { stored: unknown; recomputed: unknown }> | null;
}

/**
 * Wie sich das Soll in der Lade zusammensetzt (`Shift.expectedParts`, Karte „So setzt sich das zusammen“):
 * Anfang, Barverkaeufe, Trinkgeld bar, Storno bar, Einzahlungen, Ausgaben aus der Lade und die
 * Summe der Zwischenzaehlungs-Differenzen. Die Summe der Teile ist das Soll.
 */
export const EXPECTED_PART_KEYS = Object.freeze([
  'opening', 'cash_sales', 'cash_tips', 'cancellations', 'cash_in', 'cash_out', 'interim_difference',
] as const);
export type ExpectedPartKey = (typeof EXPECTED_PART_KEYS)[number];

/** Ein Teil des Solls in Cent (Vorzeichen wie gebucht, Ausgaben negativ). */
export interface ShiftExpectedPart {
  /** Offen fuer einen kuenftigen Teil des Servers; bekannt sind [EXPECTED_PART_KEYS]. */
  key: ExpectedPartKey | (string & {});
  cents: number;
}

/** Teile der Gesamtdifferenz einer geschlossenen Schicht mit Zwischenzaehlung: `interim` je Zaehlung, `closing` der Abschluss. */
export const DIFFERENCE_PART_TYPES = Object.freeze(['interim', 'closing'] as const);
export type DifferencePartType = (typeof DIFFERENCE_PART_TYPES)[number];

export interface ShiftDifferencePart {
  /** Offen fuer einen kuenftigen Wert; bekannt sind [DIFFERENCE_PART_TYPES]. */
  type: DifferencePartType | (string & {});
  cents: number;
  /** Zeitpunkt der Zaehlung (ISO 8601, UTC); beim Abschluss kann er fehlen. */
  at: string | null;
}

export interface Shift {
  id: string;
  drawerId: string;
  cashregisterId: string | null;
  number: number;
  status: ShiftStatus;
  openedAt: string | null;
  openedBy: ShiftActor | null;
  // Ab hier bis `blind` nur mit dem Recht `shift`: ohne es sendet der Server von
  // einer offenen Schicht nur die Grunddaten (Kennung, Lade, Kasse, Nummer,
  // Status, geoeffnet am und von) – die Kasse verkauft in sie, sieht aber
  // nichts von Startgeld und Abschluss. Was fehlt, fehlt auch im Modell.
  openedDeviceId?: string | null;
  closedAt?: string | null;
  closedBy?: ShiftActor | null;
  closedDeviceId?: string | null;
  /** Startgeld; blind `null`, wenn es uebernommen wurde. */
  openingFloatCents?: number | null;
  openingDenominations?: Denominations | null;
  openingFloatTakenOver?: boolean;
  comment?: string | null;
  /** Wurde blind gezaehlt (nach dem Abschluss); offen `null`. */
  blind?: boolean | null;
  // Nur mit `cashView`:
  countedCents?: number | null;
  suggestedFloatCents?: number | null;
  runningTotals?: ShiftRunningTotals;
  expectedCents?: number | null;
  /**
   * Gesamtdifferenz der Schicht. Mit Zwischenzaehlungen ist sie NICHT `countedCents − expectedCents`:
   * jede Zwischenzaehlung verschiebt das Soll um ihre Differenz, gespeichert wird die Summe aus den
   * Zwischen-Teilen und dem Abschluss-Teil (`differenceParts`). Ohne Zwischenzaehlung gilt Ist − Soll.
   */
  differenceCents?: number | null;
  reconciliation?: ShiftReconciliation | null;
  // Nur wenn beim Abschluss Geld entnommen oder eingelegt wurde (sonst fehlen beide):
  /** Entnommen bzw. eingelegt nach dem Zaehlen. */
  afterCount?: AfterCount;
  /** Was danach in der Lade bleibt (Ist ∓ Betrag); fehlt blind (ohne `cashView`). */
  leftInDrawerCents?: number;
  // Ablauf der Kasse (Spec Kasse-Ablauf): was der Server nur sendet, wenn es zutrifft, fehlt sonst.
  /**
   * Wurde der Anfang gezaehlt? `false` heisst: der Bestand wurde ohne Zaehlen uebernommen.
   * Steht an offenen und geschlossenen Schichten und auf den Z-Bon-Daten (`ShiftSummaryReceipt.openingCounted`);
   * fehlt das Feld (aeltere Server), gilt es als unbekannt, nicht als gezaehlt.
   */
  openingCounted?: boolean;
  /** Das Soll in Teilen (Summe = `expectedCents`); nur an der offenen Schicht mit `cashView`. */
  expectedParts?: ShiftExpectedPart[];
  /** Bar-Trinkgeld, das in der Lade liegt (Teil des Solls); nur an der offenen Schicht mit `cashView`. */
  cashTipsInDrawerCents?: number;
  /** Zahl der Zwischenzaehlungen dieser Schicht; nur an der offenen Schicht mit `cashView`. */
  interimCounts?: number;
  /** Summe der Differenzen der Zwischenzaehlungen in Cent; fehlt, wenn der Server sie nicht sendet. */
  interimDifferenceCents?: number;
  /** Teile der Gesamtdifferenz; nur an geschlossenen Schichten mit Zwischenzaehlung. */
  differenceParts?: ShiftDifferencePart[];
  /**
   * Rohwert der Zaehlung vor der Trinkgeld-Auszahlung; nur wenn mit `countedBeforePayout`
   * geschlossen wurde. `countedCents` bleibt dann der Stand nach der Auszahlung.
   */
  countedBeforePayoutCents?: number;
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
  /** Die offene Schicht oder `null`; ohne Recht `shift` nur ihre Grunddaten, ohne Betrag (siehe [Shift]). */
  shift?: Shift | null;
  /** Schicht seit mindestens 16 Stunden offen; fehlt ohne Recht `shift`. */
  longOpenWarning?: boolean;
  tipClaims: TipClaim[];
  /**
   * Trinkgeld je Mitarbeiter in der laufenden Schicht und offene Ansprueche
   * (auch aus frueheren Schichten), nach Name; fuer jede Sitzung, auch ohne
   * `cashView` (Trinkgeld ist kein Bar-Soll). Wer ueberall 0 hat, fehlt.
   */
  tips: ShiftTip[];
  /** Vorschlag fuer das Startgeld (letzter Stand); bei offener Schicht `null`. Nur mit `shift` und `cashView`. */
  suggestedFloatCents?: number | null;
  /** Soll in der Lade; ohne Schicht `null`. Nur mit `shift` und `cashView`. */
  expectedCents?: number | null;
  /** Die letzten Oeffnungen, neueste zuerst; nur mit `cashView`. */
  recentOpenings?: DrawerOpening[];
  /**
   * Nummer der Schicht, aus der der Vorschlag stammt („von Schicht {number}
   * übernommen“). Nur ohne offene Schicht und nur, wenn die letzte Schicht
   * mit einem Betrag „Bleibt in der Kassenlade“ schloss.
   */
  suggestedFromShiftNumber?: number;
  /**
   * Die zuletzt geschlossene Schicht dieser Lade (Karte „Letzte Schicht“ am Schichtbeginn);
   * `null`, wenn es keine gibt, fehlt ohne Recht `shift`.
   */
  lastShift?: LastShift | null;
}

/** Die zuletzt geschlossene Schicht einer Lade. */
export interface LastShift {
  number: number;
  closedAt: string;
  /** Wer sie schloss; `null`, wenn kein Name bekannt ist. */
  closedByName: string | null;
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

/** Trinkgeld auf dem Z- und X-Bon: offen = Anspruch beim Abschluss bzw. jetzt. */
export type ShiftReceiptTip = ShiftTip;

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
  /**
   * Gesamtdifferenz; mit Zwischenzaehlungen nicht `countedCents − expectedCents`, sondern die Summe der
   * Zwischen-Teile und des Abschluss-Teils (`differenceParts`), wie an `Shift.differenceCents`.
   */
  differenceCents: number | null;
  comment: string | null;
  openingsWithoutSale: number;
  /** Gewaehrte Rabatte je Name; fehlt, wenn es keine gab (der Bon bleibt dann wie bisher). */
  discounts?: ShiftDiscount[];
  /** Entnommen bzw. eingelegt nach dem Zaehlen; fehlt, wenn kein Geld bewegt wurde. */
  afterCount?: AfterCount;
  /**
   * „Bleibt in der Kassenlade“; nur zusammen mit `afterCount`, blind `null`
   * (mit „Entnommen“ ergaebe es sonst das Ist).
   */
  leftInDrawerCents?: number | null;
  /**
   * Wurde der Anfang gezaehlt? Nur mit `false` druckt der Bon „Anfang uebernommen, nicht
   * gezaehlt“; fehlt das Feld (der Server sendet es auf dem Bon nicht), bleibt die Zeile weg.
   */
  openingCounted?: boolean;
  /** Summe der Zwischenzaehlungs-Differenzen; fehlt, wenn sie 0 ist oder blind. */
  interimDifferenceCents?: number;
  /** Teile der Gesamtdifferenz (Zwischenzaehlungen und Abschluss); fehlt ohne Zwischenzaehlung und blind. */
  differenceParts?: ShiftDifferencePart[];
  /**
   * Die Zaehlung vor der Trinkgeld-Auszahlung (Rohwert); nur wenn so geschlossen wurde, blind `null`.
   * `countedCents` ist dann der Stand nach der Auszahlung.
   */
  countedBeforePayoutCents?: number | null;
  /** Stueckelung zu `countedBeforePayoutCents`; blind `null`. */
  countedBeforePayoutDenominations?: Denominations | null;
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

/** Antwort von `recordMyShiftCount`: Soll, Zaehlung und Differenz dieser Zwischenzaehlung (Cent). */
export interface ShiftCountResult {
  count: { expectedCents: number; countedCents: number; differenceCents: number };
}

export interface CashMovementResult {
  movement: CashMovement;
  receipt: CashMovementReceipt;
}

export interface DrawerOpeningsResult {
  accepted: number;
  /** Schon gemeldet (gleicher Schluessel): zaehlt nicht doppelt. */
  duplicates: number;
  /** Die Lade, in die gemeldet wurde: eine stillgelegte meldet in die Hauptlade. */
  drawerId: string | null;
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
 * Fehler), `ready` = nur geprueft (`checkOnly`), Schliessen mit diesem Betrag
 * ginge, `closed` = geschlossen mit Z-Bon.
 */
export type CloseShiftResult =
  | { status: 'recount' }
  | { status: 'ready' }
  | {
    status: 'closed';
    shift: Shift;
    receipt: ShiftSummaryReceipt;
    /** Bon „Kassenbewegung“ der Entnahme bzw. Einlage („Bon fürs Kuvert“); nur wenn Geld bewegt wurde. */
    afterCountReceipt?: CashMovementReceipt;
    lastShiftOfRegister: boolean;
  };
