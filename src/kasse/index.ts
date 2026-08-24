/**
 * Kachel-Kasse: Einstellungen, Artikelgruppen/Artikel fuer Kacheln,
 * Rabattverteilung. Die Aufrufe heissen 1:1 wie die Backend-Functions
 * (die Rewrites-Waechter der Web-App leiten daraus ab).
 */
export {
  type KasseStil, type KasseSchrift, type KasseWasserzeichen, type KasseMenge, type KasseTgModus,
  type KasseKassierenModus, type KasseKartenanbieter, KARTENANBIETER, type KasseBelegAusgabe,
  type KasseTastenAktion, type KasseTastenkarte, KASSE_TASTEN_AKTIONEN, KASSE_TASTEN_STANDARD, type KasseLayout, type KasseKatpos, type KasseHoehe,
  type KasseDruckerArt, type KasseTerminalVia, type KasseTerminalArt,
  type KassePapier, type KasseZeichensatz, type KasseSchnitt, type KasseLadeAuto,
  type Schalterkarte, type KasseSettingsBetrieb, type KasseSettingsGeraet, type KasseSettings,
  KASSE_BETRIEB_STANDARD, KASSE_GERAET_STANDARD, mergeKasseSettings,
  // Die Enums als Laufzeitlisten — dieselben Werte, die die Typen oben tragen.
  STIL, SCHRIFT, WASSERZEICHEN, MENGE, TG_MODUS, KASSIEREN_MODUS, BELEG_AUSGABE,
  LAYOUT, KATPOS, HOEHE, DRUCKER_ART, TERMINAL_VIA, TERMINAL_ART, PAPIER,
  ZEICHENSATZ, SCHNITT, LADE_AUTO, TASTEN_AKTIONEN,
} from './settings.js';
export {
  type ArticleGroup, type ArticleGroupPayload, fromArticleGroupPayload,
  type KasseArtikel, type KasseArtikelPayload, fromKasseArtikelPayload,
  listMyArticleGroups, listMyArticles,
  type Mengenregel, type MengenVorgabe, mengenregelFuerEinheit, mengenVorgabe, mengeErlaubt,
} from './artikel.js';
export { getKasseSettings, setMyKasseSettings, setMyRegisterDeviceSettings } from './client.js';
export { verteileRabatt } from '../receipt/discount.js';
// Reichweiten der Kassen-Rechte (Migration wie im Backend) -- bewusst NICHT im
// Register-Unterpfad: dessen Exportnamen sind 1:1 Function-Namen (Rewrites).
export { cancelScopeOf, receiptsScopeOf, type RegisterScope, type RegisterUserPerms } from '../register/pairing.js';
export { type NetzDrucker, type DruckJob, type DruckJobStatus, type CreatePrintJobOptions, listMyPrinters, createPrintJob, getPrintJob } from './drucker.js';
