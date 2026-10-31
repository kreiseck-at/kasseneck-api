/**
 * Kachel-Kasse: Einstellungen, Artikelgruppen/Artikel fuer Kacheln,
 * Rabattverteilung, Drucker, Trinkgeld-Empfaenger, Lager (Standorte, Bestand,
 * Standort der Kasse), Inventur zaehlen, Schicht, Kassenstand und
 * Lade-Protokoll mit ihren Bons. Die Aufrufe heissen 1:1 wie
 * die Backend-Functions (die Rewrites-Waechter der Web-App leiten daraus ab)
 * und sprechen den Kassenweg `/api/v3` (Schluessel und Werte englisch).
 */
export {
  type PosTheme, type PosFontSize, type PosWatermark, type PosQuantity, type PosTipMode,
  type PosCheckoutMode, type PosCardProvider, type PosReceiptOutput,
  type PosShortcutAction, type PosShortcutMap, POS_SHORTCUT_ACTIONS, POS_SHORTCUT_DEFAULTS,
  type PosLayout, type PosCategoryPosition, type PosTileHeight,
  type PosPrinterType, type PosTerminalVia, type PosTerminalType,
  type PosPaperSize, type PosCodePage, type PosCut, type PosDrawerAutoOpen,
  type PosQrMode,
  type PosLogoSize, type PosSettingsFontSize, type PosTileStyle, type PosAutoLogoutMinutes,
  type PosDiscount, type PosWatermarkSide, type PosWatermarkStrength, type PosLogoScale,
  type PosWatermarkScale, type PosDoneScreenSeconds,
  type PosToggleMap, type PosBusinessSettings, type PosDeviceSettings, type PosSettings,
  POS_BUSINESS_DEFAULTS, POS_DEVICE_DEFAULTS, POS_DEVICE_OPTIONAL_FIELDS, POS_BUSINESS_OPTIONAL_FIELDS, posTipKeptByDefault, POS_BUSINESS_VALUES, POS_DEVICE_VALUES, mergePosSettings,
  sanitizePosSettings, unknownPosSettingValues, posSettingsChanges, type PosOpen,
  POS_SHORTCUT_SHARED_PAIRS, posShortcutConflict,
  // Die Enums als Laufzeitlisten, benannt nach ihrem Feld.
  THEME, FONT_SIZE, WATERMARK, QUANTITY, TIP_MODE, CHECKOUT_MODE, CARD_PROVIDER, RECEIPT_OUTPUT,
  LAYOUT, CATEGORY_POSITION, TILE_HEIGHT, PRINTER_TYPE, TERMINAL_VIA, TERMINAL_TYPE, PAPER_SIZE,
  CODE_PAGE, CUT, DRAWER_AUTO_OPEN, QR_MODE,
  LOGO_SIZE, SETTINGS_FONT_SIZE, TILE_STYLE, AUTO_LOGOUT_MINUTES, DISCOUNT, WATERMARK_SIDE,
  WATERMARK_STRENGTH, LOGO_SCALE, WATERMARK_SCALE, DONE_SCREEN_SECONDS,
} from './settings.js';
export {
  type ArticleGroup, type ArticleGroupPayload, fromArticleGroupPayload,
  type PosArticle, type PosArticlePayload, fromPosArticlePayload,
  listMyArticleGroups, listMyArticles,
  QUANTITY_RULES, type QuantityRule, type QuantityDefaults, quantityRuleForUnit, quantityDefaults, allowedQuantity,
} from './artikel.js';
export {
  getPosSettings, setMyPosSettings, setMyRegisterDeviceSettings, setMyPosLogo, posSettingsFromWire,
  type SetMyPosLogoOptions,
} from './client.js';
export {
  POS_ERROR_CODES, type PosErrorCode, isPosErrorCode, posErrorCode, isPosError,
  type PosFieldError, posFieldErrors,
} from './errors.js';
export { distributeDiscount } from '../receipt/discount.js';
// Reichweiten der Kassen-Rechte (Migration wie im Backend) -- bewusst NICHT im
// Register-Unterpfad: dessen Exportnamen sind 1:1 Function-Namen (Rewrites).
export { cancelScopeOf, receiptsScopeOf, stockViewOf, voucherPermsOf, type VoucherPerms, type RegisterScope, type RegisterUserPerms } from '../register/pairing.js';
export {
  type NetworkPrinter, type PrintJob, type PrintJobStatus, PRINT_JOB_STATUSES, type PrintJobSource, PRINT_JOB_SOURCES, isPrintJobFinished,
  type CreatePrintJobOptions, listMyPrinters, createPrintJob, getPrintJob,
} from './drucker.js';
export { listMyTipRecipients } from './trinkgeld.js';
// Prüfung (DEP) an der Kasse: Ordner auf dem USB-Stick (gleich in Web-Kasse und Kassen-App).
export { depFolderName } from './dep.js';
// Prüfung an der Kasse: Kasseninfo für den Prüfer, am Bildschirm und als Ausdruck (gleich im Dart-Zwilling).
export {
  type RegisterInspectionInfo, type RegisterInspectionSignature, type InspectionSignatureStatus,
  type InspectionInfoRow, type InspectionInfoRowKey, type InspectionInfoSection, type InspectionInfoLinesOptions,
  getRegisterInspectionInfo, inspectionInfoRows, inspectionInfoLines,
} from './kasseninfo.js';
export {
  STOCK_LOCATION_TYPES, type StockLocationType, type StockLocation, type StockLocationAddress,
  type StockLevel, type StockValue, type StockList, type ListMyStockOptions,
  type SetMyCashregisterStockLocationOptions, type CashregisterStockLocation,
  listMyStockLocations, listMyStock, setMyCashregisterStockLocation,
} from './lager.js';
export {
  type ListMyStocktakesOptions, type ListMyStocktakeItemsOptions, type ListMyStocktakeCountsOptions,
  type RecordMyStocktakeCountOptions, type VoidMyStocktakeCountOptions,
  listMyStocktakes, listMyStocktakeItems, listMyStocktakeCounts, recordMyStocktakeCount, voidMyStocktakeCount,
  parseQuantityMilli,
} from './inventur.js';
// Die Modelle der Inventur sind dieselben wie in ./inventory.
export type {
  Stocktake, StocktakeItem, StocktakeCount, StocktakeCountResult, StocktakeItemPage, StocktakeCountPage,
  StocktakeActor, StocktakeProgress, StocktakeReview, StocktakeRecount, StocktakeScope,
} from '../inventory/typen.js';
export type { StocktakeStatus } from '../inventory/vertrag.js';

// Gutschein pruefen und Etikett nachdrucken an der Kasse; Gutschein-Sorten (Stufe 4b, 1.17.0).
export {
  VOUCHER_KINDS, VOUCHER_STATUSES, checkVoucher, reprintVoucherLabel, VOUCHER_SETTINGS_DEFAULTS, posVoucherSettingsFromWire,
  VOUCHER_PAYOUTS, VOUCHER_TYPE_KINDS, VOUCHER_AMOUNT_MODES, VOUCHER_TYPE_VALIDITY_PATTERNS,
  type VoucherKind, type VoucherStatus, type VoucherValidity, type VoucherArticle, type VoucherCheck, type PosVoucherSettings,
  type VoucherPayout, type VoucherTypeKind, type PosVoucherType, type VoucherLabelTemplate,
} from './gutschein.js';

// Schicht, Kassenstand und Lade-Protokoll (1.9.0): Aufrufe, Kataloge, Helfer, Bons.
export {
  type GetMyDrawerStateOptions, type OpenMyShiftOptions, type RecordMyCashMovementOptions, type DrawerOpeningEntry,
  type LogMyDrawerOpeningsOptions, type GetMyShiftReportOptions, type TipPayout, type CloseMyShiftOptions, type AfterCountOption,
  getMyDrawerState, openMyShift, recordMyCashMovement, logMyDrawerOpenings, getMyShiftReport, closeMyShift,
  sumDenominations, parseCentsAllowZero, newIdempotencyKey, shiftTipLines, durationText, type ShiftTipLine, type ShiftTipLineKey,
} from './schicht.js';
export {
  EUR_DENOMINATIONS, MOVEMENT_TYPES, MANUAL_MOVEMENT_TYPES, CASH_LOCATIONS, OPENING_REASONS, MANUAL_OPENING_REASONS, SHIFT_RECEIPT_KINDS,
  AFTER_COUNT_TYPES, type AfterCountType, type AfterCount,
  type EurDenomination, type MovementType, type ManualMovementType, type CashLocation, type OpeningReason, type ManualOpeningReason,
  type ShiftReceiptKind, type ShiftStatus, type ShiftActorRole, type Denominations, type ShiftActor, type DrawerInfo, type DrawerRights,
  type NonCashAmount, type ShiftTipTotals, type ShiftTip, type ShiftRunningTotals, type ShiftReconciliation, type Shift, type TipClaim,
  type DrawerOpening, type DrawerState, type CashMovement, type ShiftReceiptHeader, type ShiftReceiptMovement, type ShiftReceiptTip,
  type ShiftSummaryReceipt, type CashMovementReceipt, type ShiftReceipt, type OpenShiftResult, type CashMovementResult,
  type DrawerOpeningsResult, type ShiftReport, type CloseShiftResult,
} from './schicht-typen.js';
export { type ShiftReceiptLayoutOptions, shiftReceiptLayout, cashMovementLayout } from '../receipt/shift-sheet.js';

// Ausgaben eines Belegs (Belegdetail: Art und Ergebnis -> Beschriftung); dieselben Listen wie an der Wurzel.
export { RECEIPT_OUTPUT_KINDS, RECEIPT_OUTPUT_RESULTS, type ReceiptOutputKind, type ReceiptOutputResult } from '../models/receipt-output.js';

// Rueckgabe-Wahl beim Storno (Kassen-Dialog); dieselbe Liste wie an der Wurzel.
export { RETURN_DISPOSITIONS, isReturnDisposition, type ReturnDisposition } from '../models/cancellation.js';

// Was die Kasse selbst sagt: ein Katalog fuer Browser-Kasse und App.
export {
  MESSAGES, ERROR_RULES, ERROR_CODE_RULES, ERROR_OUTCOME_RULES, CALLS_WITH_EFFECT, findErrorRule, messageOutcome, messageText, messageAppliesTo,
  RECEIPT_EMAIL_ERROR_MESSAGES, receiptEmailErrorMessage,
  CANCELLATION_PAYMENT_ERROR_MESSAGES, cancellationPaymentErrorMessage, VOUCHER_ERROR_MESSAGES, voucherErrorMessage, LABELS, labelText, RETURN_DISPOSITION_LABELS, receiptOutputLabel,
  type TextEntry, type MessageKey, type ErrorKind, type ErrorRule, type ErrorRuleDetail, type Surface,
  type ReceiptEmailMessageCode, type CancellationPaymentMessageCode, type LabelKey,
} from './texte.js';
