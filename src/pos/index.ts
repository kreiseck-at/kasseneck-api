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
  POS_BUSINESS_DEFAULTS, POS_DEVICE_DEFAULTS, POS_DEVICE_OPTIONAL_FIELDS, POS_BUSINESS_OPTIONAL_FIELDS, POS_BUSINESS_OPTIONAL_CHOICES, POS_DEVICE_OPTIONAL_CHOICES, posTipKeptByDefault, posCustomDiscountAllowed, posTipKeptMode, tipKeptFor, type TipKeptDecision, DISCOUNT_PRESET_KIND, type PosDiscountPreset, type PosDiscountPresetKind, POS_BUSINESS_OPTIONAL_LISTS, posTipKinds, posTipStart, posCartWidth, POS_BUSINESS_VALUES, POS_DEVICE_VALUES, mergePosSettings,
  sanitizePosSettings, unknownPosSettingValues, posSettingsChanges, type PosOpen,
  POS_SHORTCUT_SHARED_PAIRS, posShortcutConflict,
  // Die Enums als Laufzeitlisten, benannt nach ihrem Feld.
  THEME, FONT_SIZE, WATERMARK, QUANTITY, TIP_MODE, TIP_KINDS, TIP_START, TIP_KEPT_MODE, type PosTipKeptMode, CART_WIDTH, type PosTipKind, type PosCartWidth, CHECKOUT_MODE, CARD_PROVIDER, RECEIPT_OUTPUT,
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
  isBookableArticle, tilePrompts,
} from './artikel.js';
export {
  REFERENCE_MODES, type ReferenceMode, type PosReference, REFERENCE_INPUT_MAX, REFERENCE_LABEL_MAX, REFERENCE_HINT_MAX,
  REFERENCE_PATTERN_MAX, REFERENCE_PATTERN_TEMPLATES, cleanReferenceText, isValidReferencePattern, isDigitsOnlyPattern,
  type ReferenceCheckResult, checkReference, referenceLineName, fromReferencePayload,
} from './kachel-referenz.js';
export {
  ADD_ONS_MAX, ADD_ON_BLOCK_REASONS, type AddOnBlockReason, isSelectableAddOn, addOnsFor, addOnReferencesValid,
  addOnsOfItem, addOnRemap, addOnDisplayOrder, orderAddOnLines,
} from './zusaetze.js';
export {
  DEPOSIT_KINDS, type DepositKind, DEPOSIT_TYPES, type DepositContainerType, DEPOSIT_RETURN_MODES, type DepositReturnMode,
  DEPOSIT_ON_PREMISES_DEFAULTS, type DepositOnPremisesDefault, type DepositAmount, type DepositType, type DepositSettings,
  type DepositEntry, type DepositSharedReturnPoint, type CashRegisterDeposit,
  posDepositSettingsFromWire, depositEntriesFromWire, cashRegisterDepositFromWire,
  depositsFor, depositAmountOn, viennaDay, withDepositLines, depositReturnLine,
  type DepositPreviewItem, type DepositPreviewLine, type DepositPreviewInput, type DepositPreviewArticle, type DepositPreviewResult, type DepositPreviewErrorCode,
} from './pfand.js';
export {
  ARTICLE_EXTERNAL_VOUCHER_TYPES, type ArticleExternalVoucher, ARTICLE_EXTERNAL_VOUCHER_INVALID, ARTICLE_EXTERNAL_VOUCHER_VAT_RATES,
  EXTERNAL_VOUCHER_ARTICLE_REASONS, type ExternalVoucherArticleReason, type ExternalVoucherArticleInput,
  isArticleExternalVoucher, checkExternalVoucherValue, checkExternalVoucherArticle,
  type ExternalVoucherTileBlock, externalVoucherTileBlock,
} from './fremdgutschein-artikel.js';
// Form-Erkennung eigener Codes im Gutschein-Feld (Nachfrage statt Abweisung); dieselbe Funktion wie an der Wurzel.
export { ownVoucherCodeShape, OWN_VOUCHER_CODE_SHAPES, type OwnVoucherCodeShape } from '../models/voucher.js';
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
export { cancelScopeOf, receiptsScopeOf, stockViewOf, voucherPermsOf, depositReturnOf, type VoucherPerms, type RegisterScope, type RegisterUserPerms } from '../register/pairing.js';
export {
  type NetworkPrinter, type PrintJob, type PrintJobStatus, PRINT_JOB_STATUSES, type PrintJobSource, PRINT_JOB_SOURCES, isPrintJobFinished,
  type CreatePrintJobOptions, listMyPrinters, createPrintJob, getPrintJob,
} from './drucker.js';
export { listMyTipRecipients } from './trinkgeld.js';
export {
  posDiscountPresets, discountPresetChipText, discountChipsFromPresets, checkDiscountPresets, discountBlockLines,
  INVALID_DISCOUNT_PRESET, DISCOUNT_PRESETS_MAX, DISCOUNT_PRESET_NAME_MAX, DISCOUNT_PRESET_PERCENT_BP, DISCOUNT_PRESET_AMOUNT_CENTS, DISCOUNT_PRESET_MESSAGES,
  type DiscountPresetReason, type DiscountPresetError, type DiscountPresetsCheck, type DiscountBlockLine, type DiscountTotal,
} from './rabatt-vorlagen.js';
// Prüfung (DEP) an der Kasse: Ordner auf dem USB-Stick (gleich in Web-Kasse und Kassen-App).
export { depFolderName } from './dep.js';
// Prüfung an der Kasse: Kasseninfo für den Prüfer, am Bildschirm und als Ausdruck (gleich im Dart-Zwilling).
export {
  type RegisterInspectionInfo, type RegisterInspectionSignature, type InspectionSignatureStatus,
  type InspectionInfoRow, type InspectionInfoRowKey, type InspectionInfoSection, type InspectionInfoLinesOptions,
  getRegisterInspectionInfo, inspectionInfoRows, inspectionInfoLines,
} from './kasseninfo.js';
// Connect-Bestand: die Kasse meldet Version und System von Kasseneck Connect.
export { type ConnectStateReport, reportConnectState } from './connect-bestand.js';
export {
  type ReturnCode, type ReturnCodeEntry, type ReturnCodeMatch, type ReturnCodeArticle, type ReturnCodeGroup, type ReturnCodeInput,
  learnReturnCode, listReturnCodes, matchReturnCode,
} from './leergut.js';
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
  VOUCHER_PAYOUTS, VOUCHER_TYPE_KINDS, VOUCHER_AMOUNT_MODES, VOUCHER_TYPE_VALIDITY_PATTERNS, EXTERNAL_VOUCHERS, type PosExternalVouchers,
  type VoucherKind, type VoucherStatus, type VoucherValidity, type VoucherArticle, type VoucherCheck, type PosVoucherSettings, type PosVoucherReturnType,
  type VoucherPayout, type VoucherTypeKind, type PosVoucherType, type VoucherLabelTemplate,
} from './gutschein.js';

// Schicht, Kassenstand und Lade-Protokoll (1.9.0): Aufrufe, Kataloge, Helfer, Bons.
export {
  type GetMyDrawerStateOptions, type OpenMyShiftOptions, type RecordMyCashMovementOptions, type DrawerOpeningEntry,
  type LogMyDrawerOpeningsOptions, type GetMyShiftReportOptions, type TipPayout, type CloseMyShiftOptions, type AfterCountOption, type RecordMyShiftCountOptions,
  getMyDrawerState, openMyShift, recordMyCashMovement, logMyDrawerOpenings, getMyShiftReport, closeMyShift, recordMyShiftCount,
  sumDenominations, parseCentsAllowZero, newIdempotencyKey, shiftTipLines, durationText, type ShiftTipLine, type ShiftTipLineKey,
} from './schicht.js';
export {
  EUR_DENOMINATIONS, MOVEMENT_TYPES, MANUAL_MOVEMENT_TYPES, CASH_LOCATIONS, OPENING_REASONS, MANUAL_OPENING_REASONS, SHIFT_RECEIPT_KINDS,
  AFTER_COUNT_TYPES, type AfterCountType, type AfterCount,
  EXPECTED_PART_KEYS, DIFFERENCE_PART_TYPES, type ExpectedPartKey, type ShiftExpectedPart, type DifferencePartType, type ShiftDifferencePart,
  type LastShift, type ShiftCountResult,
  type EurDenomination, type MovementType, type ManualMovementType, type CashLocation, type OpeningReason, type ManualOpeningReason,
  type ShiftReceiptKind, type ShiftStatus, type ShiftActorRole, type Denominations, type ShiftActor, type DrawerInfo, type DrawerRights,
  type NonCashAmount, type ShiftTipTotals, type ShiftTip, type ShiftOwnerTip, type ShiftDiscount, type ShiftRunningTotals, type ShiftReconciliation, type Shift, type TipClaim,
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
  CANCELLATION_PAYMENT_ERROR_MESSAGES, cancellationPaymentErrorMessage, CANCELLATION_VOUCHER_ERROR_MESSAGES, cancellationErrorMessage, VOUCHER_ERROR_MESSAGES, voucherErrorMessage,
  EXTERNAL_VOUCHER_TILE_MESSAGES, EXTERNAL_VOUCHER_ARTICLE_MESSAGES, externalVoucherArticleErrorMessage, EXTERNAL_VOUCHERS_LABELS, EXTERNAL_VOUCHER_KIND_LABELS, TIP_KEPT_MODE_LABELS,
  LABELS, labelText, RETURN_DISPOSITION_LABELS, receiptOutputLabel,
  type TextEntry, type MessageKey, type ErrorKind, type ErrorRule, type ErrorRuleDetail, type Surface,
  type ReceiptEmailMessageCode, type CancellationPaymentMessageCode, type LabelKey,
} from './texte.js';
export { roundUpSuggestions } from './aufrunden.js';
