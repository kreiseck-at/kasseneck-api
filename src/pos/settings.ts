/**
 * Kassen-Einstellungen der Browser-Kasse und der Kassen-App in der Form des
 * Drahts `/api/v3` (Nachtrag Stufe 4, §11.7.2): Schluessel und Katalogwerte
 * englisch. Zwilling von `functions-kasse/kasse-settings-core.js` (Backend,
 * dort mit Validator und in der inneren, deutschen Form).
 *
 * Betriebsweit (`business`, am Konto) und je Geraet (`device`). Die
 * Standardwerte stehen hier UND im Backend; `fixtures/pos-settings-defaults.json`
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
 * GROSSSCHRIFT (`tileStyle` -> `TILE_STYLE`): so fuehrt `fixtures/surface.json`
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

/**
 * Ein Feld mit Wertemenge, offen fuer Werte, die dieses Paket (noch) nicht
 * kennt. Kommt vom Server ein neuer Wert (etwa `theme: 'sepia'`), bleibt er im
 * Modell stehen und geht bei einem Teil-Schreiben nie verloren (der Server
 * mischt); [unknownPosSettingValues] zeigt, welche Felder das betrifft.
 */
export type PosOpen<T extends string | number> = T | (T extends string ? (string & {}) : (number & {}));

export interface PosBusinessSettings {
  logoText: string; logoEnabled: boolean; logoSize: PosOpen<PosLogoSize>; watermark: PosOpen<PosWatermark>; color: string;
  theme: PosOpen<PosTheme>; fontSize: PosOpen<PosFontSize>; settingsFontSize: PosOpen<PosSettingsFontSize>; tileStyle: PosOpen<PosTileStyle>; clock: boolean;
  lockScreen: boolean;
  /** Fotos der Mitarbeiter am Anmeldebildschirm zeigen. */
  staffPhotos: boolean;
  autoLogoutMinutes: PosOpen<PosAutoLogoutMinutes>; logoutAfterSale: boolean;
  /** Schnelles Entsperren mit gemerkter PIN (lokal, Server-Login laeuft nach); aus = streng, jeder Login wartet. */
  fastLogin: boolean;
  showPrices: boolean; showVat: boolean; emoji: boolean; categoryColors: boolean; customAmountAllowed: boolean;
  /**
   * Steuersaetze an der Kasse. Unter `/v3` **immer die ganze Karte senden**
   * (Nachtrag §11.7.2): das Backend verlangt mindestens einen Satz an und
   * liest vor dem Pruefen nicht nach.
   */
  vatRates: PosToggleMap; quantity: PosOpen<PosQuantity>; note: boolean; search: boolean; discount: PosOpen<PosDiscount>;
  /** Bild-Logo (Download-URL aus dem Kasse-Upload); '' = Kuerzel verwenden. */
  logoImage: string;
  /** Seite des Wasserzeichens; ALT: abgeloest von watermarkX, bleibt fuers Mischen alter Staende. */
  watermarkSide: PosOpen<PosWatermarkSide>;
  /** Horizontale Lage der Wasserzeichen-MITTE in Prozent (-25 bis 125, darf ueber den Rand hinaus). */
  watermarkX: number;
  /** Vertikale Lage der Wasserzeichen-Mitte in Prozent (-25 bis 125). */
  watermarkY: number;
  /** Deckkraft des Wasserzeichens in Prozent, bewusst Stufen, kein Schieberegler. */
  watermarkStrength: PosOpen<PosWatermarkStrength>;
  /** Groesse des Bild-Logos am BELEG (Ansicht, PDF, Kopfzeile). */
  logoScale: PosOpen<PosLogoScale>;
  /** Groesse des Wasserzeichens, getrennt vom Beleg-Logo. */
  watermarkScale: PosOpen<PosWatermarkScale>;
  payCash: boolean; payCard: boolean; cardProvider: PosOpen<PosCardProvider>; tip: boolean; tipMode: PosOpen<PosTipMode>; tipSteps: PosToggleMap;
  /** Trinkgeld-Feinheit (App); kein Leser in der Web-Kasse, der Name ist Vertrag. */
  tipSplit: boolean;
  /** Rueckgeld-Rechner. */
  change: boolean;
  /** „Bar passend": schliesst den Betrag ohne Eintippen bar ab. */
  exactCash: boolean;
  checkoutMode: PosOpen<PosCheckoutMode>;
  /** Getrennt zahlen: dritter Knopf neben Bar und Karte, ein Beleg mit mehreren Zahlungen. */
  paySplit: boolean;
  /** Trinkgeld-Chips in Prozent (eine Nachkommastelle, max 5, eindeutig, Reihenfolge des Chefs). */
  tipChips: number[];
  /** Rabatt-Chips in Prozent, dieselben Regeln wie tipChips, vom Chef einstellbar. */
  discountChips: number[];
  receiptOutput: PosOpen<PosReceiptOutput>; doneScreenSeconds: PosOpen<PosDoneScreenSeconds>;
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

/**
 * Aktionen, die sich eine Taste teilen duerfen (Backend `TASTEN_PAARE`): sie
 * leben in verschiedenen Momenten, der Verteiler laesst die nicht zustaendige
 * durchfallen. Jede andere Doppelbelegung weist der Server ab, und dieses
 * Paket schon vor dem Senden.
 */
export const POS_SHORTCUT_SHARED_PAIRS: readonly (readonly [PosShortcutAction, PosShortcutAction])[] = Object.freeze([
  ['checkout', 'complete'],
  ['clearTendered', 'clearCart'],
] as const);

const darfTeilen = (a: string, b: string): boolean =>
  POS_SHORTCUT_SHARED_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/**
 * Die erste Doppelbelegung einer Tastenkarte: `{ action, key, heldBy }` oder
 * `null`. Geprueft wird die ganze Karte, so wie der Server sie nach dem
 * Speichern haelt (er selbst prueft nur die gesendeten Eintraege).
 */
export function posShortcutConflict(shortcuts: Readonly<Record<string, readonly string[] | undefined>>): { action: string; key: string; heldBy: string } | null {
  const belegt = new Map<string, string>();
  for (const aktion of Object.keys(shortcuts)) {
    const tasten = shortcuts[aktion];
    if (!Array.isArray(tasten)) continue;
    for (const t of tasten) {
      const vorher = belegt.get(t);
      if (vorher !== undefined && vorher !== aktion && !darfTeilen(vorher, aktion)) return { action: aktion, key: t, heldBy: vorher };
      belegt.set(t, aktion);
    }
  }
  return null;
}

export interface PosDeviceSettings {
  layout: PosOpen<PosLayout>; categoryPosition: PosOpen<PosCategoryPosition>; extraColumns: number; tileHeight: PosOpen<PosTileHeight>; touch: boolean;
  /** Tastenbelegung dieses Geraets (Vorgabe POS_SHORTCUT_DEFAULTS, je Aktion mischbar). */
  shortcuts: PosShortcutMap;
  printerEnabled: boolean; printerType: PosOpen<PosPrinterType>; printerIp: string; printerPort: number; printerBluetoothId: string;
  /** Klartextname des gemerkten Druckers; sonst stuende dort eine nackte Bluetooth-Adresse. */
  printerName: string;
  /** Kennung des Netzwerk-Druckers (Server Direct Print) aus `listMyPrinters`; '' = keiner gewaehlt. */
  printerId: string;
  /** ePOS Device-ID bei `printerType 'network'` (Epson direkt per IP), Vorgabe `local_printer`. */
  printerDeviceId: string;
  /** Kennung des Druckers im lokalen Kasseneck-Connect-Agenten, bei `printerType 'connect'`. */
  connectPrinterId: string;
  paperSize: PosOpen<PosPaperSize>; codePage: PosOpen<PosCodePage>; cut: PosOpen<PosCut>;
  /** Befehl fuer den Signatur-QR auf dem Bon; 'auto' = unbestimmt, der Drucker-Wizard probiert beide aus. */
  qrMode: PosOpen<PosQrMode>;
  drawerEnabled: boolean; drawerAutoOpen: PosOpen<PosDrawerAutoOpen>;
  terminalIp: string; terminalPort: number; terminalVia: PosOpen<PosTerminalVia>;
  /** Art des Terminals ('none' = Kartenzahlung ohne Terminal-Anbindung gesperrt, sofern payCard an). */
  terminalType: PosOpen<PosTerminalType>;
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

/** Eigene Eigenschaft, nie eine geerbte (`toString`, `constructor`, `__proto__`). */
const eigen = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Werte der inneren Form (0.x, deutsch), die unter einem Feldnamen stehen
 * koennten, den auch die Drahtform traegt. Wichtig sind `layout` und
 * `terminalVia` (innen und aussen gleich benannt); die Tabelle fuehrt aber jeden
 * Katalog, damit ein zwischengespeicherter Mischstand nie einen deutschen Wert
 * ins englische Modell traegt. Ein Test haelt sie deckungsgleich mit den
 * Katalogen des Vokabulars (innere Werte ohne die gleichlautenden).
 */
const ALTWERTE_0X: Readonly<Record<string, readonly (string | number)[]>> = Object.freeze({
  watermark: ['aus', 'anmeldung', 'ueberall'],
  theme: ['klar', 'nacht', 'kontrast'],
  tileStyle: ['streifen', 'voll'],
  quantity: ['aus'],
  discount: ['aus', 'an'],
  cardProvider: ['keiner', 'extern'],
  tipMode: ['betrag', 'gesamt', 'beides'],
  checkoutMode: ['seite'],
  receiptOutput: ['druck', 'mail', 'fragen'],
  watermarkSide: ['links', 'mitte', 'rechts'],
  layout: ['rechts', 'links', 'vollbild'],
  categoryPosition: ['oben', 'links'],
  printerType: ['netz', 'bt'],
  drawerAutoOpen: ['bar', 'immer', 'nie'],
  terminalVia: ['direkt'],
  terminalType: ['keins'],
});

/** Tasten-Aktionen der inneren Form (0.x). */
const ALTAKTIONEN_0X: ReadonlySet<string> = new Set([
  'kassieren', 'abschliessen', 'abbrechen', 'frei', 'bar', 'karte', 'passend', 'belege', 'letzteZurueck',
  'einstellungen', 'abmelden', 'trinkgeld', 'vollbild', 'gegebenLeeren', 'korbLeeren', 'getrennt',
]);

/** Ein Wert der inneren Form 0.x fuer dieses Feld? (paketintern, fuer die Meldung der Vorab-Pruefung) */
export function _istAltwert0x(feld: string, wert: unknown): boolean {
  const alte = eigen(ALTWERTE_0X, feld) ? ALTWERTE_0X[feld] : undefined;
  return !!alte && alte.includes(wert as string | number);
}

/** Nur fuer den Test: die beiden Tabellen der inneren Form. */
export const _ALTFORM_0X = Object.freeze({ werte: ALTWERTE_0X, aktionen: [...ALTAKTIONEN_0X] });

/**
 * Standard + gespeichert. Landkarten (`vatRates`, `tipSteps`, `shortcuts`)
 * werden je Schluessel gemischt, damit neue Saetze beim Altbestand ankommen;
 * Schluessel, die der Standard nicht fuehrt, bleiben draussen.
 *
 * **Immer** (unabhaengig davon, welches Standard-Objekt uebergeben wird, auch
 * eine Kopie oder das einer zweiten Paketkopie) faellt ein Wert der inneren
 * Form 0.x auf den Standard zurueck (`layout: 'rechts'`, `terminalVia:
 * 'direkt'`), und deutsche Tasten-Aktionen (`kassieren`) kommen nicht in die
 * Tastenkarte. Ein unbekannter **englischer** Wert (`theme: 'sepia'`) bleibt
 * dagegen stehen: er kann ein neuer Wert des Servers sein.
 */
export function mergePosSettings<T extends object>(standard: Readonly<T>, gespeichert: Partial<T> | null | undefined): T {
  const out = JSON.parse(JSON.stringify(standard)) as Record<string, unknown>;
  if (gespeichert && typeof gespeichert === 'object') {
    for (const key of Object.keys(gespeichert)) {
      if (!eigen(out, key)) continue;
      const wert = (gespeichert as Record<string, unknown>)[key];
      const alt = out[key];
      if (alt && typeof alt === 'object' && !Array.isArray(alt) && wert && typeof wert === 'object' && !Array.isArray(wert)) {
        const neu: Record<string, unknown> = {};
        for (const k of Object.keys(wert)) {
          if (key === 'shortcuts' && ALTAKTIONEN_0X.has(k)) continue;
          if (k === '__proto__') continue;
          neu[k] = (wert as Record<string, unknown>)[k];
        }
        out[key] = { ...(alt as Record<string, unknown>), ...neu };
      } else if (wert !== undefined) {
        const alte = eigen(ALTWERTE_0X, key) ? ALTWERTE_0X[key] : undefined;
        if (alte && alte.includes(wert as string | number)) continue;
        out[key] = wert;
      }
    }
  }
  return out as T;
}

/**
 * Einen gespeicherten oder zwischengespeicherten Stand `{business, device}`
 * lesen: gemischt mit den Standardwerten, ohne Werte und Tasten-Aktionen der
 * inneren Form 0.x (siehe [mergePosSettings]). Der Weg fuer jeden Stand, den
 * ein Verbraucher selbst abgelegt hat; ein Stand in der inneren Form ergibt
 * die Standardwerte, nie einen deutschen Wert und nie einen Absturz.
 */
export function sanitizePosSettings(stored: unknown): PosSettings {
  const roh = stored !== null && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const teil = (k: string): Record<string, unknown> | null => {
    const w = eigen(roh, k) ? roh[k] : undefined;
    return w !== null && typeof w === 'object' && !Array.isArray(w) ? (w as Record<string, unknown>) : null;
  };
  return {
    business: mergePosSettings(POS_BUSINESS_DEFAULTS, teil('business') as Partial<PosBusinessSettings> | null),
    device: mergePosSettings(POS_DEVICE_DEFAULTS, teil('device') as Partial<PosDeviceSettings> | null),
  };
}

/**
 * Die Felder, deren Wert dieses Paket nicht kennt (neuer Wert des Servers),
 * als Pfade (`business.theme`, `device.printerType`). Die Oberflaeche kann sie
 * als „vom Server, hier nicht einstellbar" zeigen; sie bleiben erhalten, solange
 * nur geaenderte Felder geschrieben werden ([posSettingsChanges]).
 */
export function unknownPosSettingValues(settings: PosSettings): string[] {
  const raus: string[] = [];
  const pruefe = (teil: 'business' | 'device', block: object, mengen: Readonly<Record<string, readonly (string | number)[] | undefined>>) => {
    for (const k of Object.keys(mengen)) {
      const erlaubt = mengen[k];
      if (!erlaubt || !eigen(block, k)) continue;
      if (!erlaubt.includes((block as Record<string, string | number>)[k]!)) raus.push(`${teil}.${k}`);
    }
  };
  pruefe('business', settings.business, POS_BUSINESS_VALUES);
  pruefe('device', settings.device, POS_DEVICE_VALUES);
  // Tasten-Aktionen, die dieses Paket nicht kennt (eine kuenftige des Servers).
  const bekannt: ReadonlySet<string> = new Set(POS_SHORTCUT_ACTIONS);
  const tasten = eigen(settings.device, 'shortcuts') ? settings.device.shortcuts : undefined;
  if (tasten && typeof tasten === 'object') {
    for (const aktion of Object.keys(tasten)) if (!bekannt.has(aktion)) raus.push(`device.shortcuts.${aktion}`);
  }
  return raus;
}

/**
 * Was sich zwischen zwei Staenden eines Teils geaendert hat, als Nutzlast fuer
 * `setMyPosSettings` bzw. `setMyRegisterDeviceSettings`: **nur geaenderte
 * Felder** (der Server mischt, ein nicht geaenderter, hier unbekannter Wert
 * geht so nie verloren). `vatRates` geht bei einer Aenderung als ganze Karte
 * (Nachtrag §11.7.2), `shortcuts` ebenfalls ganz, aber nur mit den Aktionen,
 * die dieses Paket kennt: so sieht die Doppelbelegungspruefung des Servers die
 * ganze Belegung, und eine unbekannte Aktion bleibt per Mischen am Server
 * stehen. `tipSteps` geht nur mit den geaenderten Eintraegen.
 */
export function posSettingsChanges<T extends object>(before: Readonly<T>, after: Readonly<T>): Partial<T> {
  const raus: Record<string, unknown> = {};
  const gleich = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of Object.keys(after)) {
    if (k === '__proto__') continue;
    const neu = (after as Record<string, unknown>)[k];
    const alt = eigen(before, k) ? (before as Record<string, unknown>)[k] : undefined;
    if (gleich(alt, neu)) continue;
    if (k === 'shortcuts' && neu && typeof neu === 'object' && !Array.isArray(neu)) {
      const bekannt: ReadonlySet<string> = new Set(POS_SHORTCUT_ACTIONS);
      const ganz: Record<string, unknown> = {};
      for (const aktion of Object.keys(neu)) if (bekannt.has(aktion)) ganz[aktion] = (neu as Record<string, unknown>)[aktion];
      raus[k] = ganz;
      continue;
    }
    if (k !== 'vatRates' && neu && typeof neu === 'object' && !Array.isArray(neu) && alt && typeof alt === 'object' && !Array.isArray(alt)) {
      const teil: Record<string, unknown> = {};
      for (const e of Object.keys(neu)) {
        if (e === '__proto__') continue;
        const a = eigen(alt, e) ? (alt as Record<string, unknown>)[e] : undefined;
        if (!gleich(a, (neu as Record<string, unknown>)[e])) teil[e] = (neu as Record<string, unknown>)[e];
      }
      if (Object.keys(teil).length) raus[k] = teil;
      continue;
    }
    raus[k] = neu;
  }
  return raus as Partial<T>;
}
