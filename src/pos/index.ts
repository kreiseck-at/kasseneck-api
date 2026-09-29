/**
 * Kachel-Kasse: Einstellungen, Artikelgruppen/Artikel fuer Kacheln,
 * Rabattverteilung, Drucker, Trinkgeld-Empfaenger. Die Aufrufe heissen 1:1 wie
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
  POS_BUSINESS_DEFAULTS, POS_DEVICE_DEFAULTS, POS_BUSINESS_VALUES, POS_DEVICE_VALUES, mergePosSettings,
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
export { cancelScopeOf, receiptsScopeOf, type RegisterScope, type RegisterUserPerms } from '../register/pairing.js';
export {
  type NetworkPrinter, type PrintJob, type PrintJobStatus, PRINT_JOB_STATUSES, type PrintJobSource, PRINT_JOB_SOURCES, isPrintJobFinished,
  type CreatePrintJobOptions, listMyPrinters, createPrintJob, getPrintJob,
} from './drucker.js';
export { listMyTipRecipients } from './trinkgeld.js';

// Was die Kasse selbst sagt: ein Katalog fuer Browser-Kasse und App.
export {
  MESSAGES, ERROR_RULES, findErrorRule, messageText, messageAppliesTo,
  RECEIPT_EMAIL_ERROR_MESSAGES, receiptEmailErrorMessage,
  CANCELLATION_PAYMENT_ERROR_MESSAGES, cancellationPaymentErrorMessage, LABELS, labelText,
  type TextEntry, type MessageKey, type ErrorKind, type ErrorRule, type Surface,
  type ReceiptEmailMessageCode, type CancellationPaymentMessageCode, type LabelKey,
} from './texte.js';
