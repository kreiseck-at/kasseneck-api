/**
 * Kassen-Einstellungen der Browser-Kasse und der Kassen-App in der Form des
 * Drahts `/api/v3` (Nachtrag Stufe 4, §11.7.2): Schluessel und Katalogwerte
 * englisch. Zwilling von `functions-kasse/kasse-settings-core.js` (Backend,
 * dort mit Validator und in der inneren, deutschen Form).
 *
 * Betriebsweit (`business`, am Konto) und je Geraet (`device`). Die
 * Standardwerte stehen hier UND im Backend; `fixtures/kasse-settings-standard.json`
 * ist aus dem Vertrags-Export abgeleitet (Antwort fuer ein Konto ohne
 * gespeicherte Einstellungen) und haelt beide deckungsgleich. Die innere Form
 * derselben Werte liegt unter `fixtures/stored/`. Trinkgeld ist bewusst AUS,
 * bis die Buchung geklaert ist (Spec kachel-kasse § 9).
 */

/*
 * Jedes Enum steht als Liste zur Laufzeit da, der Typ leitet sich daraus ab
 * (`typeof LISTE[number]`). So gibt es die Werte nur einmal, und die Zwillinge
 * (Backend-Validator, Flutter-Paket) koennen gegen dieselben Listen pruefen,
 * statt sie abzuschreiben. Der Name der Liste ist der Feldname in
 * GROSSSCHRIFT (`tileStyle` -> `TILE_STYLE`): so fuehrt `fixtures/oberflaeche.json`
 * jede Liste unter dem Namen des Feldes, zu dem sie gehoert.
 */

export const THEME = ['clear', 'warm', 'night', 'contrast'] as const;
export type PosTheme = typeof THEME[number];
export const FONT_SIZE = ['S', 'M', 'L', 'XL'] as const;
export type PosFontSize = typeof FONT_SIZE[number];
export const WATERMARK = ['off', 'login', 'everywhere'] as const;
export type PosWatermark = typeof WATERMARK[number];
export const QUANTITY = ['off', 'x', 'kg'] as const;
export type PosQuantity = typeof QUANTITY[number];
export const TIP_MODE = ['amount', 'total', 'both'] as const;
export type PosTipMode = typeof TIP_MODE[number];
export const CHECKOUT_MODE = ['page', 'panel'] as const;
export type PosCheckoutMode = typeof CHECKOUT_MODE[number];
/** Kartenanbieter: Karte gibt es erst mit eingerichtetem Anbieter; 'external' = eigenes Terminal ohne Anbindung. */
export const CARD_PROVIDER = ['none', 'external', 'gptom', 'hobex', 'mypos', 'stripe'] as const;
export type PosCardProvider = typeof CARD_PROVIDER[number];
export const RECEIPT_OUTPUT = ['qr', 'print', 'email', 'sms', 'ask'] as const;
export type PosReceiptOutput = typeof RECEIPT_OUTPUT[number];
export const LAYOUT = ['right', 'left', 'fullscreen'] as const;
export type PosLayout = typeof LAYOUT[number];
export const CATEGORY_POSITION = ['top', 'left'] as const;
export type PosCategoryPosition = typeof CATEGORY_POSITION[number];
export const TILE_HEIGHT = ['S', 'M', 'L'] as const;
export type PosTileHeight = typeof TILE_HEIGHT[number];
/**
 * `sdp` = Netzwerk ueber Epson Server Direct Print (der Drucker holt Jobs vom Backend, jeder Browser druckt).
 * `network` = Epson direkt per IP (ePOS). `connect` = Kasseneck Connect (lokaler
 * Agent auf dem Kassen-Rechner druckt fuer die Browser-Kasse).
 */
export const PRINTER_TYPE = ['sdp', 'network', 'bluetooth', 'usb', 'connect'] as const;
export type PosPrinterType = typeof PRINTER_TYPE[number];
/** Terminal-Ansprache: direkt per IP oder ueber Kasseneck Connect (Agent leitet weiter). */
export const TERMINAL_VIA = ['direct', 'connect'] as const;
export type PosTerminalVia = typeof TERMINAL_VIA[number];
/** Art des Kartenterminals an dieser Kasse: keines oder Hobex HPS (JSON-REST am Geraet). */
export const TERMINAL_TYPE = ['none', 'hps'] as const;
export type PosTerminalType = typeof TERMINAL_TYPE[number];
export const PAPER_SIZE = ['mm58', 'mm80'] as const;
export type PosPaperSize = typeof PAPER_SIZE[number];
export const CODE_PAGE = ['CP1252', 'CP437'] as const;
export type PosCodePage = typeof CODE_PAGE[number];
export const CUT = ['partial', 'full', 'none'] as const;
export type PosCut = typeof CUT[number];
export const DRAWER_AUTO_OPEN = ['cash', 'always', 'never'] as const;
export type PosDrawerAutoOpen = typeof DRAWER_AUTO_OPEN[number];
/**
 * Mit welchem Befehl der Signatur-QR auf den Bon kommt.
 *
 * `raster` = der QR wird als Bild gerastert (GS v 0) und geht darum durch jeden
 * Drucker, der Bilder kann. `escpos` = der native QR-Befehl (GS ( k): schaerfer
 * und schneller, aber aeltere Geraete drucken dann gar keinen QR oder
 * Zeichensalat.
 *
 * `auto` ist die Vorgabe und heisst **unbestimmt**: an diesem Geraet hat noch
 * niemand am Papier entschieden. Jede Kasse bleibt dann bei ihrer bisherigen
 * Praxis, die Browser-Kasse beim ESC/POS-Befehl, die App beim Rasterbild.
 * Eine harte Vorgabe waere hier eine stille Umstellung des Altbestands
 * gewesen: jedes Geraet, das nie durch den Drucker-Wizard lief, druckte
 * ploetzlich anders, und ueber BLE kostet ein Rasterbild mehrere Sekunden je
 * Bon. Nur ein ausdruecklich gesetzter Wert aendert etwas.
 *
 * **Eine Geraete-Einstellung, keine des Betriebs:** derselbe Bon kommt an einer
 * Kasse sauber heraus und an der Nebenkasse nicht. Und sie ist nicht
 * kosmetisch: nach § 132a BAO ist der QR Teil des Belegs; wer den falschen
 * Modus stehen laesst, erteilt Belege ohne lesbare Signatur.
 */
export const QR_MODE = ['auto', 'raster', 'escpos'] as const;
export type PosQrMode = typeof QR_MODE[number];

/** Groesse des Kuerzel-Logos in der Kopfzeile der Kasse. */
export const LOGO_SIZE = ['S', 'M', 'L'] as const;
export type PosLogoSize = typeof LOGO_SIZE[number];
/** Schriftgroesse in den Chef-Einstellungen, getrennt von der Schrift der Kasse. */
export const SETTINGS_FONT_SIZE = ['S', 'M', 'L'] as const;
export type PosSettingsFontSize = typeof SETTINGS_FONT_SIZE[number];
/** Kachel-Optik: farbiger Streifen am Rand oder ganz gefuellte Kachel. */
export const TILE_STYLE = ['stripe', 'full'] as const;
export type PosTileStyle = typeof TILE_STYLE[number];
/** Automatisches Abmelden nach Minuten Ruhe; 0 = nie. */
export const AUTO_LOGOUT_MINUTES = [0, 1, 5, 15, 30] as const;
export type PosAutoLogoutMinutes = typeof AUTO_LOGOUT_MINUTES[number];
/** Rabatt am Beleg erlaubt. */
export const DISCOUNT = ['off', 'on'] as const;
export type PosDiscount = typeof DISCOUNT[number];
/** Seite des Wasserzeichens; ALT, abgeloest von watermarkX. */
export const WATERMARK_SIDE = ['left', 'center', 'right'] as const;
export type PosWatermarkSide = typeof WATERMARK_SIDE[number];
/** Deckkraft des Wasserzeichens in Prozent, bewusst Stufen, kein Schieberegler. */
export const WATERMARK_STRENGTH = [3, 6, 10, 16] as const;
export type PosWatermarkStrength = typeof WATERMARK_STRENGTH[number];
/** Groesse des Bild-Logos am Beleg. */
export const LOGO_SCALE = ['S', 'M', 'L', 'XL'] as const;
export type PosLogoScale = typeof LOGO_SCALE[number];
/** Groesse des Wasserzeichens, getrennt vom Beleg-Logo. */
export const WATERMARK_SCALE = ['S', 'M', 'L', 'XL'] as const;
export type PosWatermarkScale = typeof WATERMARK_SCALE[number];
/** Wie lange die Fertig-Seite stehen bleibt, in Sekunden; 0 = bis zum Tippen. */
export const DONE_SCREEN_SECONDS = [0, 3, 5, 10, 15, 30, 60] as const;
export type PosDoneScreenSeconds = typeof DONE_SCREEN_SECONDS[number];

/** Schalter-Landkarte: Steuersaetze / Trinkgeldstufen (Schluessel = Wert als Text, z. B. `'4.9'`). */
export type PosToggleMap = Record<string, boolean>;

export interface PosBusinessSettings {
  logoText: string; logoEnabled: boolean; logoSize: PosLogoSize; watermark: PosWatermark; color: string;
  theme: PosTheme; fontSize: PosFontSize; settingsFontSize: PosSettingsFontSize; tileStyle: PosTileStyle; clock: boolean;
  lockScreen: boolean;
  /** Fotos der Mitarbeiter am Anmeldebildschirm zeigen. */
  staffPhotos: boolean;
  autoLogoutMinutes: PosAutoLogoutMinutes; logoutAfterSale: boolean;
  /** Schnelles Entsperren mit gemerkter PIN (lokal, Server-Login laeuft nach); aus = streng, jeder Login wartet. */
  fastLogin: boolean;
  showPrices: boolean; showVat: boolean; emoji: boolean; categoryColors: boolean; customAmountAllowed: boolean;
  /**
   * Steuersaetze an der Kasse. Unter `/v3` **immer die ganze Karte senden**
   * (Nachtrag §11.7.2): das Backend verlangt mindestens einen Satz an und
   * liest vor dem Pruefen nicht nach.
   */
  vatRates: PosToggleMap; quantity: PosQuantity; note: boolean; search: boolean; discount: PosDiscount;
  /** Bild-Logo (Download-URL aus dem Kasse-Upload); '' = Kuerzel verwenden. */
  logoImage: string;
  /** Seite des Wasserzeichens; ALT: abgeloest von watermarkX, bleibt fuers Mischen alter Staende. */
  watermarkSide: PosWatermarkSide;
  /** Horizontale Lage der Wasserzeichen-MITTE in Prozent (-25 bis 125, darf ueber den Rand hinaus). */
  watermarkX: number;
  /** Vertikale Lage der Wasserzeichen-Mitte in Prozent (-25 bis 125). */
  watermarkY: number;
  /** Deckkraft des Wasserzeichens in Prozent, bewusst Stufen, kein Schieberegler. */
  watermarkStrength: PosWatermarkStrength;
  /** Groesse des Bild-Logos am BELEG (Ansicht, PDF, Kopfzeile). */
  logoScale: PosLogoScale;
  /** Groesse des Wasserzeichens, getrennt vom Beleg-Logo. */
  watermarkScale: PosWatermarkScale;
  payCash: boolean; payCard: boolean; cardProvider: PosCardProvider; tip: boolean; tipMode: PosTipMode; tipSteps: PosToggleMap;
  /** Trinkgeld-Feinheit (App); kein Leser in der Web-Kasse, der Name ist Vertrag. */
  tipSplit: boolean;
  /** Rueckgeld-Rechner. */
  change: boolean;
  /** „Bar passend": schliesst den Betrag ohne Eintippen bar ab. */
  exactCash: boolean;
  checkoutMode: PosCheckoutMode;
  /** Getrennt zahlen: dritter Knopf neben Bar und Karte, ein Beleg mit mehreren Zahlungen. */
  paySplit: boolean;
  /** Trinkgeld-Chips in Prozent (eine Nachkommastelle, max 5, eindeutig, Reihenfolge des Chefs). */
  tipChips: number[];
  /** Rabatt-Chips in Prozent, dieselben Regeln wie tipChips, vom Chef einstellbar. */
  discountChips: number[];
  receiptOutput: PosReceiptOutput; doneScreenSeconds: PosDoneScreenSeconds;
  /** Glas-Optik: Kacheln und Korb leicht durchscheinend (Wasserzeichen schimmert). */
  glass: boolean;
  /** Hilfetexte in den Chef-Einstellungen anzeigen. */
  hints: boolean;
}

/** Aktionen der Kasse, die eine Taste bekommen koennen (Schluessel von `device.shortcuts`). */
export const POS_SHORTCUT_ACTIONS = [
  'checkout', 'complete', 'cancel', 'customAmount', 'cash', 'card', 'exactAmount', 'receipts', 'undoLast',
  'settings', 'logout', 'tip', 'fullscreen', 'clearTendered', 'clearCart', 'splitPayment',
] as const;
export type PosShortcutAction = typeof POS_SHORTCUT_ACTIONS[number];
/** Tastenkarte: Aktion -> Tasten (`Mod+F`, `Enter`, `Escape`, `F5` ...; `Mod` = ⌘ auf dem Mac, Strg sonst). */
export type PosShortcutMap = Record<PosShortcutAction, string[]>;
export const POS_SHORTCUT_DEFAULTS: Readonly<PosShortcutMap> = Object.freeze({
  checkout: ['Enter'], complete: ['Enter'], cancel: ['Escape'],
  // Mod+F gehoert dem Vollbild; Betrag frei liegt auf D. Bar bleibt auf B
  // (Entscheidung vom 21.8., der Tausch von 0.6.25 ist zurueck).
  customAmount: ['Mod+D'], cash: ['Mod+B'], card: ['Mod+K'], exactAmount: ['Mod+P'],
  // NICHT Mod+E: das faengt Chrome auf dem Mac selbst ab („Auswahl fuer
  // Suche verwenden"), am Geraet belegt. J wie Journal laesst er durch.
  receipts: ['Mod+J'], undoLast: ['Mod+Backspace'],
  // NICHT Mod+T: die Taste ist im Browser reserviert (neuer Tab) und kommt
  // nie bei der Seite an. Mod+G laesst Chrome durch.
  settings: ['Mod+S'], logout: ['Mod+L'], tip: ['Mod+G'],
  fullscreen: ['Mod+F'],
  // Mod+C = Kopieren des Browsers; im Kassieren-Schritt ist Kopieren fern,
  // und die Bindung gilt nur dort (Bar + Rueckgeld-Rechner an).
  clearTendered: ['Mod+C'],
  // Bewusst DIESELBE Taste wie clearTendered: die beiden leben in
  // verschiedenen Momenten (Korb vor dem Kassieren, Gegeben-Feld darin),
  // der Verteiler laesst die nicht zustaendige Aktion durchfallen.
  clearCart: ['Mod+C'],
  // Bewusst ohne Vorgabe: jede freie Mod-Taste ist in irgendeinem Browser
  // belegt oder am Geraet unerprobt. Der Chef vergibt sie, wenn er sie braucht.
  splitPayment: [],
});

export interface PosDeviceSettings {
  layout: PosLayout; categoryPosition: PosCategoryPosition; extraColumns: number; tileHeight: PosTileHeight; touch: boolean;
  /** Tastenbelegung dieses Geraets (Vorgabe POS_SHORTCUT_DEFAULTS, je Aktion mischbar). */
  shortcuts: PosShortcutMap;
  printerEnabled: boolean; printerType: PosPrinterType; printerIp: string; printerPort: number; printerBluetoothId: string;
  /** Klartextname des gemerkten Druckers; sonst stuende dort eine nackte Bluetooth-Adresse. */
  printerName: string;
  /** Kennung des Netzwerk-Druckers (Server Direct Print) aus `listMyPrinters`; '' = keiner gewaehlt. */
  printerId: string;
  /** ePOS Device-ID bei `printerType 'network'` (Epson direkt per IP), Vorgabe `local_printer`. */
  printerDeviceId: string;
  /** Kennung des Druckers im lokalen Kasseneck-Connect-Agenten, bei `printerType 'connect'`. */
  connectPrinterId: string;
  paperSize: PosPaperSize; codePage: PosCodePage; cut: PosCut;
  /** Befehl fuer den Signatur-QR auf dem Bon; 'auto' = unbestimmt, der Drucker-Wizard probiert beide aus. */
  qrMode: PosQrMode;
  drawerEnabled: boolean; drawerAutoOpen: PosDrawerAutoOpen;
  terminalIp: string; terminalPort: number; terminalVia: PosTerminalVia;
  /** Art des Terminals ('none' = Kartenzahlung ohne Terminal-Anbindung gesperrt, sofern payCard an). */
  terminalType: PosTerminalType;
  /** Tastenmarken (die kleinen Kuerzel an den Knoepfen) anzeigen. */
  shortcutHints: boolean;
  /** Terminal-ID aus dem Hobex-Vertrag (ohne fuehrende Null); noetig fuer Diagnose und Zahlung. */
  terminalTid: string;
}

export interface PosSettings {
  business: PosBusinessSettings;
  device: PosDeviceSettings;
}

export const POS_BUSINESS_DEFAULTS: Readonly<PosBusinessSettings> = Object.freeze({
  // Das Petrol der Marke: die Aktionsfarbe des Design-Systems (Rolle `brand`).
  logoText: 'K', logoEnabled: true, logoSize: 'M', watermark: 'login', color: '#136B6B',
  theme: 'clear', fontSize: 'M', settingsFontSize: 'S', tileStyle: 'stripe', clock: true,
  lockScreen: true, staffPhotos: true, autoLogoutMinutes: 0, logoutAfterSale: false, fastLogin: true,
  showPrices: true, showVat: false, emoji: true, categoryColors: true, customAmountAllowed: true,
  vatRates: { 20: true, 13: true, 10: true, 4.9: true, 0: true, 19: false },
  quantity: 'x', note: false, search: false, discount: 'off',
  payCash: true, payCard: false, paySplit: false, cardProvider: 'none', tip: false, tipMode: 'both',
  tipSteps: { 5: true, 10: true, 15: false, 20: false }, tipSplit: true, change: true,
  tipChips: [5, 10], exactCash: false, checkoutMode: 'panel',
  // 'ask' = Fertig-Seite bietet QR und Bon an, sicherster Standard.
  receiptOutput: 'ask', doneScreenSeconds: 0,
  logoImage: '', watermarkSide: 'center', watermarkX: 50, watermarkY: 50, watermarkStrength: 6, logoScale: 'M', watermarkScale: 'M',
  glass: true, hints: true,
  discountChips: [5, 10, 15, 20],
});

export const POS_DEVICE_DEFAULTS: Readonly<PosDeviceSettings> = Object.freeze({
  layout: 'right', categoryPosition: 'top', extraColumns: 0, tileHeight: 'M', touch: false,
  shortcuts: { ...POS_SHORTCUT_DEFAULTS },
  printerEnabled: false, printerType: 'sdp', printerIp: '', printerPort: 9100, printerBluetoothId: '', printerName: '',
  printerId: '', printerDeviceId: 'local_printer', connectPrinterId: '',
  paperSize: 'mm80', codePage: 'CP1252', cut: 'partial', qrMode: 'auto',
  drawerEnabled: false, drawerAutoOpen: 'cash',
  terminalIp: '', terminalPort: 8080, terminalTid: '', terminalVia: 'direct',
  terminalType: 'none', shortcutHints: true,
});

/**
 * Die Wertemenge je Feld, soweit das Feld eine hat: dagegen prueft der
 * Schreibweg vor dem Senden (ein deutscher Wert wie `'nacht'` geht so gar
 * nicht erst hinaus). Die Wahrheit ueber Gueltigkeit hat weiter das Backend.
 */
export const POS_BUSINESS_VALUES: Readonly<Partial<Record<keyof PosBusinessSettings, readonly (string | number)[]>>> = Object.freeze({
  logoSize: LOGO_SIZE, watermark: WATERMARK, theme: THEME, fontSize: FONT_SIZE, settingsFontSize: SETTINGS_FONT_SIZE,
  tileStyle: TILE_STYLE, autoLogoutMinutes: AUTO_LOGOUT_MINUTES, quantity: QUANTITY, discount: DISCOUNT,
  cardProvider: CARD_PROVIDER, tipMode: TIP_MODE, checkoutMode: CHECKOUT_MODE, receiptOutput: RECEIPT_OUTPUT,
  doneScreenSeconds: DONE_SCREEN_SECONDS, watermarkSide: WATERMARK_SIDE, watermarkStrength: WATERMARK_STRENGTH,
  logoScale: LOGO_SCALE, watermarkScale: WATERMARK_SCALE,
});

/** Wie [POS_BUSINESS_VALUES] fuer die Geraete-Einstellungen. */
export const POS_DEVICE_VALUES: Readonly<Partial<Record<keyof PosDeviceSettings, readonly (string | number)[]>>> = Object.freeze({
  layout: LAYOUT, categoryPosition: CATEGORY_POSITION, tileHeight: TILE_HEIGHT, printerType: PRINTER_TYPE,
  paperSize: PAPER_SIZE, codePage: CODE_PAGE, cut: CUT, qrMode: QR_MODE, drawerAutoOpen: DRAWER_AUTO_OPEN,
  terminalVia: TERMINAL_VIA, terminalType: TERMINAL_TYPE,
});

/**
 * Standard + gespeichert. Landkarten (`vatRates`, `tipSteps`, `shortcuts`)
 * werden je Schluessel gemischt, damit neue Saetze beim Altbestand ankommen;
 * unbekannte Schluessel bleiben draussen (die Wahrheit ueber Gueltigkeit hat
 * der Server).
 *
 * Fuer die beiden Standards dieses Pakets ([POS_BUSINESS_DEFAULTS],
 * [POS_DEVICE_DEFAULTS]) gilt zusaetzlich die Wertemenge je Feld: ein Wert
 * ausserhalb ([POS_BUSINESS_VALUES], [POS_DEVICE_VALUES]) faellt auf den
 * Standard zurueck, und `shortcuts` nimmt nur bekannte Aktionen an. Das ist
 * der Schutz fuer einen zwischengespeicherten 0.x-Stand: einige Felder heissen
 * innen und aussen gleich (`layout`, `terminalVia`), ihr alter Wert
 * (`'rechts'`, `'direkt'`) kaeme sonst unbemerkt ins englische Modell. Ein
 * Stand in der inneren Form ergibt so die Standardwerte, nie einen Absturz
 * und nie einen deutschen Wert. Wie der Server beim Lesen (Nachtrag §11.7.2).
 */
export function mergePosSettings<T extends object>(
  standard: Readonly<T>,
  gespeichert: Partial<T> | null | undefined,
  values?: Readonly<Record<string, readonly (string | number)[] | undefined>>,
): T {
  const out = JSON.parse(JSON.stringify(standard)) as Record<string, unknown>;
  const mengen = values
    ?? ((standard as object) === POS_BUSINESS_DEFAULTS ? POS_BUSINESS_VALUES
      : (standard as object) === POS_DEVICE_DEFAULTS ? POS_DEVICE_VALUES : undefined);
  const nurAktionen = (standard as object) === POS_DEVICE_DEFAULTS;
  if (gespeichert && typeof gespeichert === 'object') {
    for (const [key, wert] of Object.entries(gespeichert as Record<string, unknown>)) {
      if (!(key in out)) continue;
      const alt = out[key];
      if (alt && typeof alt === 'object' && !Array.isArray(alt) && wert && typeof wert === 'object' && !Array.isArray(wert)) {
        const neu = { ...(wert as Record<string, unknown>) };
        if (nurAktionen && key === 'shortcuts') {
          for (const aktion of Object.keys(neu)) if (!(aktion in (alt as object))) delete neu[aktion];
        }
        out[key] = { ...(alt as Record<string, unknown>), ...neu };
      } else if (wert !== undefined) {
        const erlaubt = (mengen as Record<string, readonly (string | number)[] | undefined> | undefined)?.[key];
        if (erlaubt && !erlaubt.includes(wert as string | number)) continue;
        out[key] = wert;
      }
    }
  }
  return out as T;
}
