/**
 * Was die Kasse selbst sagt — auf dem Bildschirm, in beiden Huellen.
 *
 * Die Browser-Kasse und die Kassen-App sind eine Kasse. Was der Kassier bei
 * einem Fehler liest, steht hier genau einmal; beide Apps beziehen den Satz
 * von hier, und wer ihn aendert, aendert ihn auf beiden Seiten oder gar nicht.
 *
 * Nicht hier: die fachlichen Saetze des Backends („Kopplungs-Code ist
 * abgelaufen.", „PIN falsch, noch 2 Versuche"). Die gehen unveraendert durch.
 *
 * Ein Satz sagt, was los ist, und was zu tun ist. Nie Innereien.
 *
 * Schluessel: `bereich.name`. Ein Schluessel wird nie umgedeutet — wer den
 * Sinn aendert, legt einen neuen an. `only` nennt die Seite, wenn ein Satz nur
 * auf einer Plattform vorkommen kann.
 *
 * Die Schluessel sind seit 1.0 englisch, die Texte bleiben deutsch. Welcher
 * Schluessel frueher wie hiess, steht in `fixtures/renames-1.0.json`,
 * ebenso die Strukturschluessel (`platzhalter` -> `placeholders`, `nur` ->
 * `only`), die Platzhalter und die Arten der Fehlerregeln (Abschnitte
 * `placeholders` und `structure`).
 */

import type { ReceiptEmailSendErrorCode } from '../models/receipt-email.js';
import type { ReturnDisposition } from '../models/cancellation.js';
import type { ReceiptOutput, ReceiptOutputKind } from '../models/receipt-output.js';
import type { PosExternalVouchers } from './gutschein.js';
import type { PosTipKeptMode } from './settings.js';
import type { TipClaimScope } from './schicht-typen.js';
import { ARTICLE_EXTERNAL_VOUCHER_INVALID, type ArticleExternalVoucher, type ExternalVoucherArticleReason, type ExternalVoucherTileBlock } from './fremdgutschein-artikel.js';
import { isOutcomeUnknown, KasseneckApiError, KasseneckHttpError, KasseneckNetworkError, type ErrorOutcome } from '../client/errors.js';

export type Surface = 'web' | 'app';

export interface TextEntry {
  readonly text: string;
  /** Erlaubte Platzhalter `{name}`; muessen exakt die im Text sein. */
  readonly placeholders?: readonly string[];
  /** Fehlt es, gilt der Satz fuer beide Seiten. */
  readonly only?: readonly Surface[];
}

const MELDUNGEN_ROH = {
  // --- Transport -----------------------------------------------------------
  'network.no_connection': { text: 'Keine Verbindung zum Server. Bitte die Internetverbindung prüfen und erneut versuchen.' },
  'network.timeout': { text: 'Der Server antwortet nicht. Bitte die Internetverbindung prüfen und erneut versuchen.' },
  // Frist oder Netzfehler auf einem Aufruf mit Wirkung (ERROR_OUTCOME_RULES):
  // der Vorgang kann trotzdem gebucht sein, darum nie „erneut versuchen“.
  'network.outcome_unknown': { text: 'Der Server hat nicht geantwortet, der Vorgang kann trotzdem gebucht sein. Bitte vor einem neuen Versuch prüfen, ob der letzte Vorgang schon gebucht ist.' },
  'server.unexpected': { text: 'Der Server hat unerwartet geantwortet (HTTP {status}). Bitte den Support verständigen.', placeholders: ['status'] },
  // Rand-Codes, die ein Kassier nicht deuten kann (siehe ERROR_CODE_RULES): der
  // technische Satz bleibt in `error.message`, auf den Schirm kommt dieser.
  // Nur fuer Codes, bei denen der Server nichts ausgefuehrt hat: dann darf
  // der Satz zum neuen Versuch raten.
  'server.connection_disturbed': { text: 'Die Verbindung zum Kassenserver ist gestört. Bitte kurz warten und erneut versuchen.' },
  // Codes mit unklarem Ausgang (der Vorgang kann gebucht sein): nie zum
  // Wiederholen raten, erst nachsehen. „Kasse neu öffnen“ passt fuer beide
  // Seiten (Web: neu laden, App: neu starten).
  'server.response_unreadable': { text: 'Die Antwort des Kassenservers war nicht lesbar. Bitte die Kasse neu öffnen und vor einem neuen Versuch prüfen, ob der letzte Vorgang schon gebucht ist.' },

  // --- Kopplung ------------------------------------------------------------
  'pairing.code_missing': { text: 'Bitte den Kopplungs-Code eingeben.' },
  'pairing.failed': { text: 'Die Kopplung ist fehlgeschlagen. Bitte erneut versuchen.' },
  'pairing.incomplete': { text: 'Die Kopplung ist unvollständig zurückgekommen. Bitte im Panel einen neuen Code erzeugen und noch einmal versuchen.' },
  'device.browser_storage': { text: 'Dieses Gerät konnte nicht gespeichert werden – der Browser-Speicher steht nicht zur Verfügung. Bitte den privaten Modus verlassen.', only: ['web'] },

  // --- Anmeldung und Sitzung -----------------------------------------------
  'login.pin_missing': { text: 'Bitte die PIN eingeben.' },
  'login.failed': { text: 'Die Anmeldung ist fehlgeschlagen. Bitte erneut versuchen.' },
  'login.not_completed': { text: 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.' },
  'login.completing': { text: 'Anmeldung wird gerade abgeschlossen – bitte gleich noch einmal drücken.' },
  'session.expired': { text: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.' },
  'session.expired_offline': { text: 'Keine Verbindung zum Server – die Sitzung ist abgelaufen. Bitte erneut anmelden.' },
  'session.none': { text: 'Keine Sitzung.' },
  // Die Sperre nach Untaetigkeit kuendigt sich an: der Countdown laeuft in
  // Sekunden, eine Beruehrung haelt die Schicht offen.
  'session.logging_out': { text: 'Kasse meldet in {seconds} s ab – Bildschirm berühren, um weiterzuarbeiten.', placeholders: ['seconds'] },
  // Wer die Abmelden-Taste ein zweites Mal drueckt, beendet die Schicht –
  // der Satz steht in der Rueckfrage, bevor es so weit ist.
  'logout.press_again': { text: 'Noch einmal drücken beendet die Schicht an dieser Kasse.' },
  // Seit 1.11.0 an seiner Stelle: die Rueckfrage beim Abmelden mit vollem Warenkorb. Ein zweiter Druck meldet ab
  // und leert den Korb; die Schicht der Kassenlade laeuft weiter (das alte Wort „Schicht“ fuehrte dort in die Irre).
  'logout.cart_cleared': { text: 'Noch einmal drücken meldet dich ab – der Warenkorb wird geleert.' },
  'permissions.not_changeable': { text: 'Das darfst du nicht ändern – das Recht dafür vergibt der Inhaber im Panel.' },

  // --- Verkauf und Positionen ----------------------------------------------
  'cashregister.load_failed': { text: 'Die Kasse konnte nicht geladen werden.' },
  'articles.load_failed': { text: 'Die Artikel konnten nicht geladen werden.' },
  'articles.none_enabled': { text: 'Keine Artikel an dieser Kasse. Im Panel unter „Kacheln & Gruppen“ freischalten.' },
  'articles.none_found': { text: 'Keine Artikel gefunden.' },
  'articles.vat_rate_unknown': { text: '„{name}“ hat einen Steuersatz, den die Kasse nicht kennt.', placeholders: ['name'] },
  'item.amount_missing': { text: 'Bitte einen Betrag eingeben.' },
  'item.description_missing': { text: 'Bitte eine Bezeichnung eingeben – sie steht am Beleg.' },
  // Kachel mit Betrag und Referenz (1.26.0): Eingabeblatt beim Antippen.
  'reference.missing': { text: 'Bitte „{name}“ eingeben.', placeholders: ['name'] },
  'reference.format_invalid': { text: 'Das Format passt nicht.' },
  'reference.format_warning': { text: 'Das Format passt nicht. Trotzdem übernehmen?' },
  'discount.percent_invalid': { text: 'Bitte einen Prozentwert zwischen 0,1 und 100 eingeben.' },
  // Rabatt-Vorlagen (benannte Rabatt-Chips, 1.31.0): Fehler der Pruefung (checkDiscountPresets) und der gesperrte Chip.
  'discount.preset_over_total': { text: 'Der Rabatt ist höher als der Betrag, auf den er gilt.' },
  'discount_preset.list': { text: 'Höchstens 5 Rabatt-Vorlagen als Liste.' },
  'discount_preset.entry': { text: 'Eine Rabatt-Vorlage ist ein Objekt mit Name, Art und Wert.' },
  'discount_preset.name': { text: 'Name mit 1 bis 24 Zeichen, ohne Steuerzeichen.' },
  'discount_preset.duplicate': { text: 'Diesen Namen gibt es schon.' },
  'discount_preset.kind': { text: 'Prozent oder Betrag.' },
  'discount_preset.percent': { text: 'Prozent zwischen 0,1 und 100 mit höchstens einer Nachkommastelle.' },
  'discount_preset.amount': { text: 'Betrag zwischen 0,01 € und 1.000.000,00 €.' },
  'discount_preset.unknown_field': { text: 'Unbekanntes Feld.' },

  // --- Kassieren -----------------------------------------------------------
  // Der Grund ueber dem Knopf, solange der Beleg nicht abgeschlossen werden kann.
  'checkout.nothing_entered': { text: 'Noch nichts erfasst – bitte zuerst eine Position aufnehmen.' },
  'checkout.tendered_missing': { text: 'Erst eintippen, was der Gast gibt – der Rückgeld-Rechner ist an.' },
  'checkout.tendered_too_little': { text: 'Gegeben ist weniger als der Betrag.' },
  // Lebenszyklus der Kasse (ausser Betrieb, Signatureinheit …): der Grund
  // kommt vom Server bzw. aus dem Kassenstand und steht hinter dem Doppelpunkt.
  'checkout.locked': { text: 'Kassieren gesperrt: {reason}', placeholders: ['reason'] },
  // Keine gesetzliche Obergrenze – steuerfrei ist aber nur ortsuebliches
  // Trinkgeld (§ 3 Abs 1 Z 16a EStG). Eine Warnung, keine Sperre.
  'tip.over_half': { text: 'Über 50 % Trinkgeld – wirklich? Steuerfrei ist nur ortsübliches Trinkgeld.' },
  // Bar-Trinkgeld „gleich behalten“ (Hinweis zur Einstellung, Beschriftungen unten).
  'tip.kept_setting_hint': { text: 'Der Mitarbeiter steckt das Bar-Trinkgeld beim Verkauf gleich ein: es zählt nicht ins Soll der Lade und gilt als genommen. An der Kasse lässt es sich je Verkauf umstellen.' },
  // Hinweis unter dem Trinkgeld beim Kassieren je nach Wahl (tipKeptFor): gleich behalten bzw. offen fuer den Benutzer.
  'tip.kept_hint': { text: 'Trinkgeld kommt als eigene Position auf den Beleg; der angemeldete Benutzer nimmt es gleich bar aus der Lade.' },
  'tip.open_hint': { text: 'Trinkgeld kommt als eigene Position auf den Beleg und bleibt für den angemeldeten Benutzer offen, bis es ausgezahlt wird.' },
  // Kartentrinkgeld (Spec 2026-11-11-kartentrinkgeld, 1.37.0): Hinweise zur Karten-Stufe und zum Not-Aus Selbst-Auszahlen.
  'tip.card_kept_setting_hint': { text: 'Der Mitarbeiter nimmt das Kartentrinkgeld beim Verkauf bar aus der Lade: das Soll der Lade sinkt, es gilt als genommen. An der Kasse lässt es sich je Verkauf umstellen. Das geht nur bei offener Schicht, mit genug Bargeld in der Lade und für Mitarbeiter, die den Kassenstand sehen – sonst bleibt es offen.' },
  'tip.self_payout_hint': { text: 'Jeder persönlich angemeldete Mitarbeiter sieht sein Trinkgeld und zahlt es sich selbst aus. Aus: nur mit dem Recht „Schicht“.' },
  'tip.overpaid_hint': { text: 'Es wurde mehr ausgezahlt, als offen war. Das nächste Trinkgeld gleicht das aus.' },
  'tip.terminal_hint': { text: 'Trinkgeld wird an der Kasse eingetragen, nicht am Terminal – ein am Terminal getipptes Trinkgeld kennt die Kasse nicht.' },
  // Kartentrinkgeld Stufe 3 (1.37.0): Anspruchs-Modus im Kundenbereich (F2) und „Mein Trinkgeld“ ohne Auszahl-Recht.
  'tip_claim_scope.hint': { text: 'Je Kassenlade: das Trinkgeld steht an der Kassenlade, an der es entstand, und wird dort ausgezahlt. Je Person: ein Stand über alle Kassenladen, an jeder auszahlbar.' },
  'my_tips.payout_not_allowed': { text: 'Auszahlen nur mit dem Recht „Schicht“.' },

  // --- Abschluss -----------------------------------------------------------
  'completion.failed': { text: 'Der Abschluss ist fehlgeschlagen.' },
  'completion.unknown': { text: 'Unklar, ob der Beleg entstanden ist – die Antwort kam nicht an. Bitte nicht noch einmal abschließen: der Beleg kann bereits erstellt und signiert sein. Im Panel unter „Belege“ nachsehen; nur wenn er dort fehlt, den Verkauf erneut abschließen.' },
  'completion.zero_receipt_failed': { text: 'Der Nullbeleg konnte nicht erstellt werden.' },
  'completion.signature_down': { text: 'Die Signatureinheit hat nicht geantwortet. Der Beleg ist gültig und trägt den Vermerk „Sicherheitseinrichtung ausgefallen“.' },
  // Erledigen darf nur bestaetigen, was am Server auch wirklich steht – sonst
  // gilt ein Betrag als abgehakt, zu dem es nie einen Beleg gab.
  'completion.resolve_question': { text: 'Nur erledigen, wenn der Beleg in der Belegliste steht – sonst bleiben {amount} ohne Beleg. Bitte zuerst unter „Belege“ nachsehen.', placeholders: ['amount'] },

  // --- Kartenzahlung -------------------------------------------------------
  'card_payment.not_possible': { text: 'Kartenzahlung nicht möglich.' },
  'card_payment.not_completed': { text: 'Die Kartenzahlung ist nicht zustande gekommen.' },
  'card_payment.not_started': { text: 'Kartenzahlung nicht gestartet: {reason}', placeholders: ['reason'] },
  'card_payment.unknown': { text: 'Unklar, ob die Kartenzahlung durchgegangen ist – die Verbindung zum Terminal riss ab. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird: die Karte kann belastet sein.' },
  // Die Kennung ist der einzige Anker, um die Zahlung am Terminal-Beleg wiederzufinden – liegt sie vor, gilt dieser Satz statt card_payment.unknown.
  'card_payment.unknown_with_id': { text: 'Unklar, ob die Kartenzahlung durchgegangen ist – die Verbindung zum Terminal riss ab. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird: die Karte kann belastet sein. Kennung der Zahlung: {reference}.', placeholders: ['reference'] },
  // Dieselben Saetze fuer das hobex-HPS-Terminal: es druckt keinen Beleg, an dem
  // der Kassier nachsehen koennte (Inhaber, 12.11.2026). Den Ausgang sagt das
  // Klaeren (Nachfrage beim Terminal) oder die Technik von hobex.
  'card_payment.unknown_hps': { text: 'Unklar, ob die Kartenzahlung durchgegangen ist – die Verbindung zum Terminal riss ab. Die Karte kann belastet sein: erst klären, dann neu kassieren.' },
  'card_payment.unknown_with_id_hps': { text: 'Unklar, ob die Kartenzahlung durchgegangen ist – die Verbindung zum Terminal riss ab. Die Karte kann belastet sein: erst klären, dann neu kassieren. Kennung der Zahlung: {reference}.', placeholders: ['reference'] },
  // Kurzfassung fuer eine Karte, die schon zum Klaeren in der Liste steht (rote Ecke,
  // Sperre einer neuen Zahlung): Betrag und Kennung genuegen, den Rest sagt das
  // Klaeren-Fenster. Die Kennung darf gekuerzt sein (erste und letzte Ziffern);
  // ganz steht sie im Fenster und in der Liste.
  'card_payment.unclear_short': { text: 'Kartenzahlung {amount} unklar – bitte klären. Kennung {reference}.', placeholders: ['amount', 'reference'] },
  'card_payment.waiting_for_terminal': { text: 'Bitte am Terminal fortfahren …' },
  // Das Kartenfenster des Terminals ist abgelaufen: es bricht selbst ab, die
  // Kasse muss nichts tun.
  'card_payment.terminal_cancelling': { text: 'Das Terminal bricht gleich von selbst ab …' },
  // Ein geglücktes Kartenergebnis ohne Beleg ist der teuerste Zustand am Tresen:
  // wer hier erneut kassiert, belastet die Karte ein zweites Mal. Beide Sätze
  // nennen deshalb Betrag UND Kennung — nur damit findet der Kassier die Zahlung
  // am Terminal-Beleg wieder — und keiner rät zum Wiederholen.
  'card_payment.card_charged_receipt_open': { text: 'Die Karte ist bereits mit {amount} belastet (Kennung {reference}) – der Beleg dazu fehlt noch. Bitte jetzt den Beleg erstellen und nicht erneut kassieren.', placeholders: ['amount', 'reference'] },
  'card_payment.card_charged_cart_changed': { text: 'Es gibt eine gebuchte Kartenzahlung über {amount} (Kennung {reference}), aber der Korb hat sich seither geändert. Bitte zuerst entscheiden: den Beleg zur gebuchten Zahlung erstellen oder die Zahlung am Terminal stornieren und hier verwerfen.', placeholders: ['amount', 'reference'] },
  'card_payment.connect_not_connected': { text: 'Kartenzahlung nicht möglich: Kasseneck Connect ist nicht verbunden – Einstellungen → Kasseneck Connect.', only: ['web'] },
  // Solange die Karte belastet ist, darf am Korb nichts mehr veraendert werden –
  // sonst passt der Beleg nicht mehr zum Betrag, der schon abgebucht ist.
  'card_payment.cart_locked_card_charged': { text: 'Die Karte ist bereits belastet – Warenkorb, Rabatt und Trinkgeld bleiben gesperrt, bis der Beleg entsteht oder die Karte zurückerstattet ist.' },
  // Entkoppeln trennt das Geraet vom Konto, nicht die gebuchte Kartenzahlung
  // vom Terminal – die muss weiterhin von Hand storniert werden.
  'card_payment.unpair_card_charged': { text: 'Auf diesem Gerät liegt noch eine gebuchte Kartenzahlung ohne Beleg – sie muss von Hand am Terminal zurückerstattet werden (Betrag siehe unten).' },
  'terminal.none_found': { text: 'Kein Hobex-Terminal gefunden – ist es eingeschaltet und im selben Netz wie dieser Rechner?', only: ['web'] },
  'terminal.not_ready': { text: 'Terminal antwortet, ist aber nicht betriebsbereit: {response} – TID prüfen.', placeholders: ['response'], only: ['web'] },
  // Terminal-Suche mit mehreren Treffern (1.33.0): uebernommen wird nur ein Treffer, an dem die
  // Diagnose die TID dieses Geraets bestaetigt -- sonst nennt die Kasse die Adressen und setzt keine.
  'terminal.several_found': { text: 'Mehrere Terminals gefunden: {hosts}. Die IP-Adresse des richtigen von Hand eintragen.', placeholders: ['hosts'], only: ['web'] },
  'terminal.tid_not_found': { text: 'Mehrere Terminals gefunden: {hosts}. Keines meldet die TID {tid} – TID prüfen oder die IP-Adresse von Hand eintragen.', placeholders: ['hosts', 'tid'], only: ['web'] },
  'gptom.app_missing': { text: 'Die GP-Tom-App ist auf diesem Gerät nicht da.', only: ['app'] },
  'gptom.search_failed': { text: 'GP Tom: Suche nach der App fehlgeschlagen: {reason}', placeholders: ['reason'], only: ['app'] },
  'gptom.payment_failed': { text: 'GP Tom: Zahlung fehlgeschlagen: {reason}', placeholders: ['reason'], only: ['app'] },
  'gptom.terminal_not_responding': { text: 'Das Terminal hat nicht geantwortet: {reason}', placeholders: ['reason'], only: ['app'] },
  'gptom.payment_not_completed': { text: 'Die Zahlung wurde nicht abgeschlossen ({code}).', placeholders: ['code'], only: ['app'] },
  // Abgelehnt heißt: das Terminal hat entschieden, es ist sicher nichts gebucht.
  // Der Code ist die einzige Handhabe, mit der der Inhaber bei GP nachfragen kann —
  // liegt einer vor, gilt die Fassung mit Code.
  'gptom.declined': { text: 'Das Terminal hat die Zahlung abgelehnt.', only: ['app'] },
  'gptom.declined_with_code': { text: 'Das Terminal hat die Zahlung abgelehnt ({code}).', placeholders: ['code'], only: ['app'] },
  'gptom.not_opened': { text: 'GP Tom ließ sich nicht öffnen – bitte die GP-Tom-App prüfen und erneut versuchen.', only: ['app'] },
  // Frist abgelaufen ist kein Abbruch: die Karte kann belastet sein, nur die
  // Antwort blieb aus. Deshalb derselbe Ton wie card_payment.unknown.
  'gptom.timeout': { text: 'Das Terminal hat in der Frist nicht geantwortet – die Karte kann belastet sein. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird.', only: ['app'] },
  'gptom.timeout_with_id': { text: 'Das Terminal hat in der Frist nicht geantwortet – die Karte kann belastet sein. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird. Kennung der Zahlung: {reference}.', placeholders: ['reference'], only: ['app'] },

  // --- Terminal-Protokoll --------------------------------------------------
  'log.empty': { text: 'Noch keine Einträge – das Protokoll füllt sich mit der ersten Kartenzahlung.' },
  'log.copied': { text: 'Das Protokoll liegt in der Zwischenablage.' },

  // --- Belege und Storno ---------------------------------------------------
  'receipts.load_failed': { text: 'Die Belege konnten nicht geladen werden.' },
  'receipts.none_in_period': { text: 'Keine Belege in diesem Zeitraum.' },
  'receipt.load_failed': { text: 'Der Beleg konnte nicht geladen werden.' },
  'receipt.not_found': { text: 'Der Beleg wurde nicht gefunden.' },
  'cancellation.failed': { text: 'Das Storno ist fehlgeschlagen.' },
  'cancellation.reason_missing': { text: 'Bitte einen Grund wählen.' },
  'cancellation.item_missing': { text: 'Bitte mindestens eine Position wählen.' },
  // Storno eines Belegs mit mehreren Zahlungen: je Zahlung wird zurückgegeben,
  // und der Server prueft jede Rueckgabe gegen den Rest ihrer Zahlung. Welcher
  // Code welchen Satz bekommt, steht in CANCELLATION_PAYMENT_ERROR_MESSAGES.
  'cancellation.payments_missing': { text: 'Dieser Beleg wurde in mehreren Zahlungen bezahlt – bitte angeben, wie zurückgegeben wird.' },
  'cancellation.refund_too_high': { text: 'Eine Rückgabe ist höher als der Rest ihrer Zahlung – bitte die Beträge prüfen.' },
  'cancellation.refund_without_reference': { text: 'Eine Rückgabe nennt keine Zahlung des Belegs – bitte das Storno neu beginnen.' },
  'cancellation.refund_reference_unknown': { text: 'Eine Rückgabe nennt eine Zahlung, die es am Beleg nicht gibt – bitte das Storno neu beginnen.' },
  // Die Antwort kam, aber der Ausgang ist offen: der Storno-Beleg kann schon
  // signiert sein. Wer jetzt noch einmal storniert, storniert womoeglich doppelt.
  'cancellation.outcome_unknown': { text: 'Unklar, ob das Storno entstanden ist – es kann bereits signiert sein. Bitte nicht erneut stornieren, sondern die Belegliste in ein paar Minuten neu laden.' },
  'cancellation.sum_mismatch': { text: 'Die Rückgaben ergeben nicht den Betrag des Stornos – bitte die Beträge prüfen.' },
  // Storno eines Belegs mit mehreren Zahlungen: Karten gehen VON HAND am
  // Terminal zurueck, und zwar erst NACH dem gebuchten Storno -- vorher
  // fliesst kein Geld. Darunter steht die Liste der Karten zum Abhaken; der
  // Satz passt fuer eine oder mehrere Karten, mit oder ohne Anbindung.
  'cancellation.refund_cards': { text: 'Das Storno ist gebucht – bitte jede Karte unten am Terminal gutschreiben und abhaken.' },
  // Wie cancellation.outcome_unknown, nur enthielt die Rueckgabe Karten: bevor
  // klar ist, ob das Storno steht, darf keine Gutschrift laufen -- sonst geht
  // Geld zurueck ohne Storno-Beleg.
  'cancellation.outcome_unknown_cards': { text: 'Unklar, ob das Storno entstanden ist – es kann bereits signiert sein. Bitte nicht erneut stornieren und noch keine Karte gutschreiben, sondern die Belegliste in ein paar Minuten neu laden. Steht das Storno dort, die Karten laut Storno-Beleg am Terminal gutschreiben.' },
  // Die Liste der Karten nach dem gebuchten Storno wird geschlossen, obwohl
  // nicht jede Karte abgehakt ist: einmal nachfragen -- eine vergessene
  // Gutschrift faellt sonst erst dem Gast auf.
  'cancellation.cards_not_checked': { text: 'Noch ist nicht jede Karte abgehakt – bitte jede am Terminal gutschreiben. Ist das schon geschehen, zum Schließen noch einmal drücken.' },
  // Das Backend weist Grund, Notiz oder Positionen des Stornos zurueck
  // (`unknown_reason`, `note_too_long`, `invalid_items`): am Server geschah
  // nichts, der Kassier beginnt das Storno von vorn.
  'cancellation.input_rejected': { text: 'Die Eingabe wurde abgelehnt – bitte das Storno neu beginnen.' },
  // Storno eines Belegs mit Mitarbeiter-Trinkgeld (Schichten-Spec, Nachtrag 5): gesendet wird erst
  // nach der Wahl, ohne Vorauswahl. Fehlt sie, steht dieser Satz unter dem Knopf.
  'cancellation.tip_refund_missing': { text: 'Bitte wählen: Trinkgeld auch zurückgeben?' },
  'cancellation.tip_source_missing': { text: 'Bitte wählen: Woher kommt das Trinkgeld zurück?' },
  // Beleg mit Wertgutschein: keine Frage, das Trinkgeld geht mit (Ruling R59, asksRefundTip).
  'cancellation.tip_refunded_with_voucher': { text: 'Beleg mit Gutschein: Das Trinkgeld wird mitstorniert.' },
  // Rueckgabe als Gutschein (refundAs voucher): die Kasse zeigt „Als Gutschein“ nur, wenn es geht; diese
  // Saetze sind fuer den seltenen Fall, dass der Server trotzdem ablehnt.
  'cancellation.voucher_not_available': { text: 'Als Gutschein geht hier nicht – bitte wie bezahlt zurückgeben.' },
  'cancellation.voucher_reason': { text: 'Als Gutschein nur bei „Kunde hat storniert“ oder „Sonstiges“.' },
  'cancellation.voucher_with_voucher': { text: 'Dieser Beleg hat einen Gutschein – bitte wie bezahlt zurückgeben.' },
  'cancellation.voucher_no_type': { text: 'Keine Gutschein-Sorte für Rückgaben eingestellt – bitte wie bezahlt zurückgeben.' },
  'cancellation.voucher_amount': { text: 'Dieser Betrag geht nicht als Gutschein – bitte wie bezahlt zurückgeben.' },
  'cancellation.voucher_type_changed': { text: 'Die Gutschein-Sorte für Rückgaben hat sich geändert – bitte erneut versuchen.' },
  // Zahlung auf Rechnung (1.38.0): ein Zahlungsbeleg steht in der Belegliste, storniert wird er nur bei
  // der Rechnung (sonst passten Rechnung und Beleg nicht mehr zusammen). Code invoice_payment_not_cancellable.
  'cancellation.invoice_payment_not_cancellable': { text: 'Diese Zahlung gehört zu einer Rechnung. Storniere sie im Kundenbereich bei der Rechnung.' },

  // --- Gutscheine: Fehlersätze (Zuordnung in VOUCHER_ERROR_MESSAGES) ---------
  'voucher_error.not_found': { text: 'Diesen Gutschein gibt es in diesem Betrieb nicht.' },
  'voucher_error.invalid': { text: 'Dieser Gutschein ist nicht gültig.' },
  'voucher_error.invalid_code': { text: 'Der Code ist nicht vollständig oder falsch abgetippt.' },
  'voucher_error.expired': { text: 'Der Gutschein ist abgelaufen.' },
  'voucher_error.used_up': { text: 'Der Gutschein ist bereits aufgebraucht.' },
  'voucher_error.blocked': { text: 'Der Gutschein ist gesperrt.' },
  'voucher_error.cancelled': { text: 'Der Gutschein wurde storniert.' },
  'voucher_error.insufficient_balance': { text: 'Auf dem Gutschein ist nicht genug Guthaben.' },
  'voucher_error.exceeds_total': { text: 'Der Gutschein deckt mehr, als offen ist. Bitte den Betrag anpassen.' },
  'voucher_error.balance_changed': { text: 'Der Gutschein wurde gerade anderswo verwendet. Bitte neu prüfen.' },
  'voucher_error.rate_mismatch': { text: 'Dieser Gutschein gilt nur für Leistungen mit {rate} %.', placeholders: ['rate'] },
  'voucher_error.item_mismatch': { text: 'Dieser Gutschein gilt nicht für die gewählten Positionen.' },
  'voucher_error.already_used': { text: 'Dieser Gutschein wurde bereits verwendet.' },
  'voucher_error.partial_cancel': { text: 'Belege mit Gutschein lassen sich nur ganz stornieren.' },
  'voucher_error.settings_missing': { text: 'Die Gutschein-Einstellungen fehlen. Bitte die Kasse neu laden.' },
  'voucher_error.too_many_checks': { text: 'Zu viele Versuche. Bitte in einer Stunde wieder.' },
  'voucher_error.sale_off': { text: 'Gutscheine verkaufen geht hier noch nicht.' },
  // Gutschein-Sorten (Stufe 4b, 1.17.0): Verkauf nur ueber eine Sorte; bei den beiden Satzpaaren laedt die Kasse die Sorten neu.
  'voucher_error.type_required': { text: 'Bitte eine Gutschein-Sorte wählen.' },
  'voucher_error.type_not_found': { text: 'Diese Gutschein-Sorte gibt es nicht mehr. Die Kasse lädt die Sorten neu.' },
  'voucher_error.amount_mismatch': { text: 'Die Gutschein-Sorte hat sich geändert. Die Kasse lädt die Sorten neu.' },
  'voucher_error.service_not_allowed': { text: 'Dieser Artikel ist nicht als Leistungsgutschein freigegeben.' },
  'voucher_error.payout_not_allowed': { text: 'Dieser Gutschein kann nicht ausgezahlt werden.' },
  // Fremdgutscheine (Server 2026-11): Woerter wie gutschein-transaktion.fehlerText im Backend.
  'voucher_error.external_not_enabled': { text: 'Fremde Gutscheine sind für dieses Konto nicht freigegeben.' },
  'voucher_error.external_type_not_enabled': { text: 'Fremde Einzweckgutscheine sind für dieses Konto nicht freigegeben.' },
  'voucher_error.external_number_invalid': { text: 'Gutscheinnummer prüfen: 1 bis 40 Zeichen, nur Buchstaben, Ziffern und - _ . / sind erlaubt.' },
  'voucher_error.external_number_is_own_code': { text: 'Das ist ein eigener Gutscheincode. Bitte als eigenen Gutschein einlösen.' },
  'voucher_error.external_duplicate': { text: 'Diese Gutscheinnummer steht schon auf dem Beleg.' },
  // Fremdgutscheine an der Kasse (1.31.0): Kachel gesperrt (Zuordnung in EXTERNAL_VOUCHER_TILE_MESSAGES), Hinweis im
  // Storno eines Belegs mit fremdem Gutschein-Verkauf, Hilfe-Satz unter dem Schalter im Kundenbereich.
  'external_voucher.not_enabled': { text: 'Fremde Gutscheine sind aus. Bitte im Panel freischalten.' },
  'external_voucher.type_not_enabled': { text: 'Fremde Leistungsgutscheine sind aus. Bitte im Panel freischalten.' },
  // Eingabe in der Form eines eigenen Codes, aber keiner (ownVoucherCodeShape `checksum`/`length`): nachfragen, nie abweisen.
  'external_voucher.looks_like_own_code': { text: 'Sieht aus wie ein Kasseneck-Code, ist aber keiner. Als fremden Gutschein verwenden?' },
  'cancellation.external_voucher_check': { text: 'Vorher im eigenen Gutscheinsystem prüfen, ob er schon benutzt wurde.' },
  'settings.external_vouchers_hint': { text: 'Ob ein Gutschein Wert- oder Leistungsgutschein ist und mit welchem Satz er verkauft wurde, legt der Betrieb fest. Das Guthaben führt sein eigenes System.' },
  // Artikel als fremder Gutschein speichern (article_external_voucher_invalid, Zuordnung je data.grund in
  // EXTERNAL_VOUCHER_ARTICLE_MESSAGES): Woerter wie fremdgutschein-artikel-core im Backend; `invalid` fuer
  // invalid_type und einen unbekannten Grund (der Backend-Satz dazu ist technisch); invalid_rate mit deutschem
  // Dezimalkomma statt der Liste aus STEUERSAETZE.join.
  'external_voucher_article.invalid': { text: 'Diese Art von fremdem Gutschein gibt es nicht.' },
  'external_voucher_article.service_voucher': { text: 'Ein fremder Gutschein kann kein Leistungsgutschein mit Code sein.' },
  'external_voucher_article.add_ons': { text: 'Ein fremder Gutschein hat keine Zusätze.' },
  'external_voucher_article.stock_tracked': { text: 'Ein fremder Gutschein führt keinen Lagerbestand.' },
  'external_voucher_article.reference': { text: 'Ein fremder Gutschein fragt keine Referenz ab, die Kasse fragt die Gutscheinnummer.' },
  'external_voucher_article.asks_quantity': { text: 'Ein fremder Gutschein fragt keine Menge ab.' },
  'external_voucher_article.deposit': { text: 'Ein fremder Gutschein hat kein Pfand.' },
  'external_voucher_article.rate_required': { text: 'Ein Einzweckgutschein braucht den Steuersatz, mit dem er verkauft wird.' },
  'external_voucher_article.invalid_rate': { text: 'Ein Einzweckgutschein braucht einen Steuersatz der Kasse: 20, 13, 10, 4,9, 0 oder 19 %.' },
  'external_voucher_article.price_required': { text: 'Ein fremder Gutschein braucht einen Preis oder „Betrag beim Antippen eingeben“.' },
  // Satz der Kasse selbst (1.17.0): eine Verkaufszeile im Korb passt nach dem Neuladen der Sorten nicht mehr (Sorte
  // geaendert, deaktiviert oder geloescht). Die Zeile sperrt das Kassieren, bis sie entfernt und neu gewaehlt ist;
  // der Satz nach einer Absage des Servers bleibt voucher_error.type_not_found bzw. voucher_error.amount_mismatch.
  'voucher.type_changed': { text: 'Diese Gutschein-Sorte hat sich geändert. Bitte die Zeile entfernen und die Kachel neu antippen.' },
  // Gutscheine an der Kasse, Stufe 3 (1.13.0): Sätze der Kasse selbst (nicht des Servers).
  'voucher.reentry_needed': { text: 'Die Karte ist belastet, der Beleg fehlt noch: zu jedem Gutschein den Code erneut eingeben, dann den Beleg abschließen.' },
  'voucher.reentry_mismatch': { text: 'Mit diesen Gutscheinen ergibt der Beleg nicht mehr den belasteten Betrag – die Karte zurückbuchen.' },
  'voucher.not_this_voucher': { text: 'Das ist nicht der Gutschein ····-{suffix}.', placeholders: ['suffix'] },
  'voucher.reentry_no_permission': { text: 'Die Karte ist belastet, der Beleg fehlt noch: den Gutschein-Code kann nur jemand mit dem Recht zum Einlösen nachtragen – sonst die Karte zurückbuchen.' },
  'voucher.already_covered': { text: 'Diese Positionen deckt schon ein anderer Gutschein.' },
  'voucher.payout_reason_too_long': { text: 'Der Grund hat höchstens 200 Zeichen.' },
  'voucher.payout_reason_missing': { text: 'Für die Auszahlung fehlt der Grund.' },
  'voucher.payout_check_first': { text: 'Die letzte Auszahlung ging unklar aus und kann schon gebucht sein. Erst unter „Belege“ die Liste neu laden und nachsehen, dann ist eine neue möglich.' },
  'voucher.sale_max_amount': { text: 'Höchstens {amount} je Gutschein.', placeholders: ['amount'] },
  'voucher.sale_not_at_terminal': { text: 'Gutscheine mit Karte am Terminal zu verkaufen geht an dieser Kasse noch nicht – bar kassieren.' },
  'voucher.no_redeem_with_sale': { text: 'Auf einem Beleg, der Gutscheine verkauft, lässt sich kein Gutschein einlösen.' },
  'voucher.code_not_on_receipt': { text: 'Der Code steht nicht auf dem Bon – jetzt auf den Gutschein schreiben.' },
  'cancellation.voucher_sale_cancelled': { text: 'Der Gutschein ····-{suffix} wird mitstorniert und gilt danach nicht mehr.', placeholders: ['suffix'] },
  'cancellation.promo_valid_again': { text: 'Der Aktionsgutschein ····-{suffix} gilt danach wieder.', placeholders: ['suffix'] },

  // --- Getrennt zahlen -----------------------------------------------------
  // Ein Tisch zahlt in Teilen, ein Beleg fuer alles. Das Teure ist eine schon
  // belastete Karte: jeder Satz, der sie betrifft, nennt den Betrag, und keiner
  // raet dazu, noch einmal zu kassieren.
  'split.setting_hint': { text: 'Ein Tisch zahlt in Teilen: jede Zahlung bar oder mit Karte, mit eigenem Trinkgeld – am Ende ein Beleg für alles.' },
  'split.amount_over_open': { text: 'Der Betrag ist höher als offen – höchstens {amount}.', placeholders: ['amount'] },
  'split.tip_over_amount': { text: 'Das Trinkgeld ist höher als der Betrag dieser Zahlung.' },
  'split.tendered_too_little': { text: 'Gegeben ist weniger als der Betrag dieser Zahlung.' },
  'split.still_open': { text: 'Es sind noch {amount} offen – abschließen geht erst, wenn alles kassiert ist.', placeholders: ['amount'] },
  'split.sum_mismatch': { text: 'Die Zahlungen ergeben nicht den Betrag des Belegs – bitte die Liste prüfen.' },
  'split.cart_locked': { text: 'Der Warenkorb ist gesperrt, solange Zahlungen kassiert sind – erst abschließen oder die Zahlungen entfernen.' },
  'split.switch_locked': { text: 'Zurück zu Bar oder Karte geht erst, wenn keine Zahlung mehr kassiert ist.' },
  'split.return_cash': { text: 'Bitte {amount} Bargeld an den Gast zurückgeben.', placeholders: ['amount'] },
  'split.card_reverse_running': { text: 'Die Kartenzahlung über {amount} wird am Terminal zurückgebucht …', placeholders: ['amount'] },
  'split.card_reversed': { text: 'Die Kartenzahlung über {amount} ist am Terminal zurückgebucht.', placeholders: ['amount'] },
  'split.card_reverse_failed': { text: 'Die Kartenzahlung über {amount} (Kennung {reference}) ließ sich nicht zurückbuchen – sie bleibt in der Liste. Bitte am Terminal-Beleg nachsehen und erneut versuchen.', placeholders: ['amount', 'reference'] },
  'split.card_reverse_unknown': { text: 'Unklar, ob die Rückbuchung über {amount} (Kennung {reference}) durchgegangen ist – die Zahlung bleibt in der Liste. Bitte am Terminal-Beleg nachsehen, BEVOR erneut zurückgebucht wird.', placeholders: ['amount', 'reference'] },
  // Das Terminal meldet eine Gutschrift, die hier noch als offene Ruecknahme
  // steht – ein zweites Zurueckbuchen waere die doppelte Rueckgabe.
  'split.card_already_reversed': { text: 'Das Terminal meldet, dass die Kartenzahlung über {amount} bereits gutgeschrieben wurde (Kennung {reference}) – bitte am Terminal-Beleg prüfen und nicht erneut zurückbuchen.', placeholders: ['amount', 'reference'] },
  // Dieselben drei Saetze fuer das hobex-HPS-Terminal: es druckt keinen Beleg
  // (Inhaber, 12.11.2026) -- sie sagen, was zu tun ist, nicht wo man nachsieht.
  'split.card_reverse_failed_hps': { text: 'Die Kartenzahlung über {amount} (Kennung {reference}) ließ sich nicht zurückbuchen – sie bleibt in der Liste. Bitte erneut versuchen.', placeholders: ['amount', 'reference'] },
  'split.card_reverse_unknown_hps': { text: 'Unklar, ob die Rückbuchung über {amount} (Kennung {reference}) durchgegangen ist – die Zahlung bleibt in der Liste. Nicht noch einmal zurückbuchen, bevor das geklärt ist.', placeholders: ['amount', 'reference'] },
  'split.card_already_reversed_hps': { text: 'Das Terminal meldet, dass die Kartenzahlung über {amount} bereits gutgeschrieben wurde (Kennung {reference}) – bitte nicht erneut zurückbuchen.', placeholders: ['amount', 'reference'] },
  'split.external_reverse': { text: 'Diese Karte ist nicht an die Kasse angebunden. Bitte {amount} jetzt am Terminal zurückbuchen und danach bestätigen.', placeholders: ['amount'] },
  'split.session_open': { text: 'Eine getrennte Zahlung ist nicht abgeschlossen, {amount} sind schon kassiert. Bitte weiter kassieren oder alles zurückbuchen.', placeholders: ['amount'] },
  'split.session_unreadable': { text: 'Eine gespeicherte getrennte Zahlung auf diesem Gerät ließ sich nicht lesen – bitte prüfen, ob schon Karten belastet wurden (Kasseneck-Panel oder Terminal), und offene Beträge von Hand ausgleichen.' },
  'split.storage_failed': { text: 'Die getrennte Zahlung ließ sich auf diesem Gerät nicht speichern – bitte die Kasse bis zum Abschluss dieses Belegs nicht neu laden, sonst stehen belastete Karten womöglich nicht mehr in der Liste.' },
  'split.too_many_payments': { text: 'Ein Beleg lässt höchstens 20 Zahlungen zu.' },
  'split.unpair_open_cards': { text: 'Auf diesem Gerät ist noch eine getrennte Zahlung mit belasteten Karten offen – sie müssen von Hand am Terminal zurückgebucht werden (Beträge siehe unten).' },
  'split.items_locked': { text: 'Nach Positionen geht nicht mehr – eine Zahlung ist schon als Betrag kassiert.' },
  'split.select_items': { text: 'Bitte zuerst antippen, was dieser Gast zahlt.' },
  // Barzahlung mit Rueckgeld-Rechner: ohne „Gegeben" wird die Zahlung nicht
  // hinzugefuegt – derselbe Grund wie beim Abschluss einer Barzahlung, auf
  // DIESE Zahlung bezogen.
  'split.tendered_missing': { text: 'Erst eintippen, was der Gast für diese Zahlung gibt – der Rückgeld-Rechner ist an.' },
  // Klaeren einer Karte mit offenem Ausgang am hobex-HPS-Terminal: zuerst fragt
  // die Kasse das Terminal (Paket `clarifyPayment`), erst wenn es nichts sagen
  // kann, entscheidet der Kassier mit „Wurde belastet" / „Nicht belastet". Das
  // HPS-Terminal druckt keinen Beleg (Inhaber, 12.11.2026): die Zeilen sagen,
  // wer es weiss oder wann es noch einmal geht.
  // Im Fenster steht unter dem Titel (`split.clarify_title`) genau eine dieser
  // Zeilen zum Stand, darunter die Kennung (`split.clarify_reference`):
  // `clarify_asking` waehrend der Nachfrage, `clarify_open` (das Terminal hat
  // geantwortet und weiss es nicht), `clarify_not_asked` (Kasseneck Connect oder
  // das Netz verhinderten die Nachfrage), `clarify_no_answer` (gefragt, aber nie
  // eine Antwort -- Connect oder das Netz), `clarify_busy` (das Terminal arbeitet
  // gerade an etwas anderem) und `clarify_manual` (eine Antwort bewiese nichts
  // mehr, oder es ist kein Terminal eingerichtet).
  'split.clarify_asking': { text: 'Das Terminal wird gefragt …' },
  'split.clarify_charged': { text: 'Das Terminal meldet: belastet. Die Zahlung wurde übernommen.' },
  'split.clarify_not_charged': { text: 'Das Terminal meldet: nicht belastet. Die Zahlung wurde verworfen.' },
  'split.clarify_open': { text: 'Das Terminal weiß es nicht. hobex kann die Zahlung nachsehen.' },
  'split.clarify_not_asked': { text: 'Das Terminal konnte nicht gefragt werden ({reason}). Bitte später erneut klären.', placeholders: ['reason'] },
  'split.clarify_busy': { text: 'Das Terminal ist gerade belegt. Bitte gleich erneut klären.' },
  'split.clarify_no_answer': { text: 'Das Terminal hat nicht geantwortet. Bitte später erneut klären.' },
  'split.clarify_manual': { text: 'Das Terminal kann es nicht sicher sagen. hobex kann die Zahlung nachsehen.' },
  // Der Grund, warum der Ausgang offen blieb, als kurze Zeile unter dem Stand:
  // je Grund mit Stoerung beim oder nach dem hobex-Host (`isHostUncertainReason`,
  // Schluessel = Grund in snake_case) und fuer einen Code ohne feste Bedeutung
  // das, was das Terminal meldete.
  'split.clarify_reason_host_fault': { text: 'Grund: Störung zwischen Terminal und hobex.' },
  'split.clarify_reason_host_timeout': { text: 'Grund: hobex hat nicht rechtzeitig geantwortet.' },
  'split.clarify_reason_internal_error': { text: 'Grund: Das Terminal meldet einen internen Fehler.' },
  'split.clarify_reason_approved_with_condition': { text: 'Grund: Genehmigung mit Vorbehalt, etwa nur über einen Teilbetrag.' },
  'split.clarify_reason_terminal': { text: 'Grund: Das Terminal meldete „{text}“ (Code {code}).', placeholders: ['text', 'code'] },

  // --- Beleg weitergeben: Link, Teilen, E-Mail -----------------------------
  // Kopieren, Teilen und Senden fuehren zu demselben Ziel: der oeffentlichen
  // Belegseite (beleg.kasseneck.at/<fullReceiptId>). Kein Satz davon ist
  // plattformgebunden — nur die Huelle unterscheidet sich, nicht das Wort.
  'receipt.link_copied': { text: 'Der Link zum Beleg liegt in der Zwischenablage.' },
  // Der Text, der beim Teilen mitgeht. Der Link steht am Schluss, damit ihn
  // jede Huelle (SMS, Messenger, Mail) bis zum Ende als Link erkennt und nicht
  // mitten im Satz abbricht.
  'receipt.share_text': { text: 'Beleg {number} von {business} über {amount}: {link}', placeholders: ['business', 'number', 'amount', 'link'] },
  // Belege aus dem Altbestand tragen keine `fullReceiptId`; ohne sie gibt es
  // keine Belegseite. Der Satz nennt den Grund, sonst sucht der Kassier den
  // Fehler bei sich und versucht es ein zweites Mal.
  'receipt.not_shareable': { text: 'Für diesen Beleg gibt es keinen Link – er stammt aus einer älteren Kasse.' },
  // Ein Testbeleg hat eine Belegseite, ist aber steuerlich nichts wert. Wer
  // den Link weitergibt, muss das vorher lesen, nicht hinterher.
  'receipt.test_hint_share': { text: 'Test-Umgebung – der Beleg ist steuerlich nicht gültig.' },
  'receipt.mail_sent': { text: 'Der Beleg wurde an {recipient} gesendet.', placeholders: ['recipient'] },
  'receipt.mail_address_invalid': { text: 'Diese E-Mail-Adresse ist nicht gültig.' },
  'receipt.mail_too_often': { text: 'Dieser Beleg wurde schon oft gesendet – bitte später noch einmal.' },
  'receipt.mail_failed': { text: 'Der Beleg konnte nicht gesendet werden. Bitte noch einmal versuchen.' },
  // Bewusst nicht derselbe Satz wie `receipt.not_found`: dort scheitert das
  // Oeffnen, hier das Senden. Der Kassier steht vor einem Adressfeld und muss
  // lesen, dass nichts hinausgegangen ist.
  'receipt.mail_not_found': { text: 'Dieser Beleg wurde nicht gefunden – er konnte nicht gesendet werden.' },

  // --- Druck ---------------------------------------------------------------
  'print.failed': { text: 'Der Ausdruck ist fehlgeschlagen.' },
  'print.not_possible': { text: 'Druck nicht möglich: {reason}', placeholders: ['reason'] },
  'print.test_print_failed': { text: 'Der Testdruck ist fehlgeschlagen.' },
  'print.test_print_not_possible': { text: 'Der Testdruck ist fehlgeschlagen: {reason}', placeholders: ['reason'] },
  'print.no_printer': { text: 'Kein Bondrucker eingerichtet – in den Einstellungen unter Drucker & Lade.' },
  'print.printer_unreachable': { text: 'Drucker nicht erreichbar.' },
  'print.job_expired': { text: 'Drucker hat den Beleg nicht abgeholt (abgelaufen).', only: ['web'] },
  'print.no_printer_found': { text: 'Kein Drucker gefunden – ist er eingeschaltet und im selben Netz wie dieser Rechner?', only: ['web'] },
  'print.chrome_only': { text: '{channel}-Druck geht nur in Chrome oder Edge (Windows, Mac, Android) – nicht in Safari und nicht am iPad.', placeholders: ['channel'], only: ['web'] },
  'print.no_printer_for_channel': { text: 'Kein {channel}-Drucker verbunden – „{channel}-Drucker verbinden“ und den Drucker im Dialog wählen.', placeholders: ['channel'], only: ['web'] },
  // Der Drucker-Wizard: suchen, verbinden, Testdruck, QR-Probe, erst dann
  // speichern. Derselbe Ablauf in beiden Kassen — deshalb hat kein Satz ein
  // `only`, obwohl der Weg zum Drucker verschieden ist (Bluetooth in der App,
  // Web Bluetooth im Browser). Was der Chef liest, ist beidesmal dasselbe.
  'print.wizard_connect': { text: 'Verbinde mit {name} …', placeholders: ['name'] },
  'print.wizard_test_print_question': { text: 'Ist der Testdruck gekommen?' },
  'print.wizard_qr_question': { text: 'Welcher QR-Code ist sauber gedruckt?' },
  // Kein Modus druckt einen lesbaren QR-Code: gespeichert wird trotzdem (mit
  // Raster als Vorgabe), aber der Chef muss wissen, dass der QR-Code dann vom
  // Bildschirm gelesen werden muss — nach RKSV gehoert er an den Beleg.
  'print.wizard_qr_none_hint': { text: 'Kein QR-Code kam sauber – der Beleg zeigt den QR-Code dann am Bildschirm.' },
  'print.wizard_nothing_arrived': { text: 'Nichts gekommen? Drucker an, Papier drin, richtiges Gerät gewählt?' },
  'print.wizard_saved': { text: '{name} ist eingerichtet.', placeholders: ['name'] },
  // Abbrechen an jeder Stelle: nichts gespeichert. Der Satz sagt genau das,
  // damit niemand einen halb eingerichteten Drucker vermutet.
  'print.wizard_cancelled': { text: 'Nichts gespeichert.' },
  // Zeichensatz-Test im Drucker-Wizard: das Testblatt nennt die Anleitung,
  // der Bildschirm stellt die Frage daneben. Die Regel ist „kein falsches
  // Zeichen“, nicht „erste Zeile“ und nicht „Umlaute richtig“: ein Drucker
  // mit nur PC437 druckt Zeile 2 und 3 mit richtigen Umlauten, aber falschem
  // € und § (╒, ⌡); richtig ist dort Zeile 4, mit Luecken fuer € und §.
  // Am Papier steht „Lücke“ als „Luecke“ (Ersatzbuchstaben wie jeder Text
  // ausserhalb der Testzeilen), am Bildschirm mit Umlaut.
  'codetable.question': { text: 'In welcher Zeile steht kein falsches Zeichen?' },
  'codetable.question_hint': { text: 'Lücken sind in Ordnung.' },
  'codetable.instruction': { text: 'Die Zeile, in der KEIN falsches Zeichen steht. Eine Lücke ist in Ordnung. Passen mehrere, die mit den wenigsten Lücken.' },
  // `{number}` ist die Ersatz-Zeile (6), die immer passt.
  'codetable.instruction_none': { text: 'Passt keine: {number}.', placeholders: ['number'] },
  'bluetooth.off': { text: 'Bluetooth ist ausgeschaltet. Bitte einschalten und erneut suchen.', only: ['app'] },
  'bluetooth.permission_missing': { text: 'Bitte die Freigabe in den Geräte-Einstellungen erteilen.', only: ['app'] },
  'bluetooth.search_failed': { text: 'Die Suche ist fehlgeschlagen: {reason}', placeholders: ['reason'], only: ['app'] },

  // --- Kasseneck Connect (nur Browser) -------------------------------------
  'connect.not_responding': { text: 'Kasseneck Connect antwortet nicht – läuft das Programm auf diesem Rechner?', only: ['web'] },
  'connect.code_expired': { text: 'Der Kopplungs-Code ist abgelaufen – im Agent einen neuen erzeugen („kasseneck-connect pair“).', only: ['web'] },
  'connect.too_many_attempts': { text: 'Zu viele Fehlversuche – eine Minute warten und noch einmal versuchen.', only: ['web'] },
  'connect.printer_not_responding': { text: 'Der Drucker antwortet nicht – Strom, Netzwerk und IP prüfen.', only: ['web'] },
  'connect.not_paired': { text: 'Diese Kasse ist mit Kasseneck Connect nicht gekoppelt – in den Einstellungen „Koppeln“ drücken.', only: ['web'] },
  'connect.printer_unknown': { text: 'Diesen Drucker kennt Kasseneck Connect nicht (mehr) – bitte neu suchen.', only: ['web'] },
  'connect.origin_not_allowed': { text: 'Kasseneck Connect nimmt von dieser Adresse nichts an (Ursprung nicht freigegeben).', only: ['web'] },
  'connect.not_installed': { text: 'Kasseneck Connect nicht gefunden – bitte installieren.', only: ['web'] },
  // Chrome fragt ab 142 vor dem Zugriff einer https-Seite auf 127.0.0.1 nach („Lokales Netzwerk“).
  // Ist das gesperrt, findet die Kasse Connect nicht -- installieren hilft dann nicht (1.33.0).
  'connect.local_network_blocked': { text: 'Der Browser sperrt den Zugang zu Kasseneck Connect. Freigeben: Schloss neben der Adresse (installierte App: Menü ⋮ → App-Info) → Website-Einstellungen → „Lokales Netzwerk“ → „Zulassen“.', only: ['web'] },
  'connect.unpair_question': { text: 'Diesen Browser wirklich von Connect trennen? Der Bondruck geht dann nicht mehr.', only: ['web'] },

  // --- Geraete im Betrieb (1.39.0, Connect-Betrieb Stufe 2) ----------------------
  // Drucker-, Papier-, Terminal- und Sperrbild-Saetze gelten fuer beide Kassen; die Connect-Saetze nur im Browser.
  // `printer.` und `terminal.` statt `device.`: dieser Namensraum meint das Kassengeraet.
  'printer.paper_out': { text: 'Drucker: Papier leer – neue Rolle einlegen.' },
  'printer.cover_open': { text: 'Drucker: Deckel offen – bitte schließen.' },
  'printer.not_ready': { text: 'Drucker nicht bereit – Deckel schließen und Papier prüfen.' },
  'printer.paper_near_end': { text: 'Drucker: Papier fast leer.' },
  'printer.unreachable': { text: 'Drucker nicht erreichbar – eingeschaltet und im Netz?' },
  'printer.none': { text: 'Kein Drucker eingerichtet.' },
  // Der Drucker schweigt auf die Statusfrage (z. B. TM-T20III bei offenem Deckel): nur ein Hinweis, der Bon wird gedruckt.
  'printer.no_status_answer': { text: 'Drucker antwortet nicht – Deckel und Papier prüfen.' },
  'manager.ask': { text: 'Chef fragen.' },
  'terminal.unreachable': { text: 'Terminal nicht erreichbar – eingeschaltet?' },
  'terminal.tid_mismatch': { text: 'Die TID passt nicht zum Terminal.' },
  'terminal.tid_hint': { text: 'Die TID steht auf jedem Terminal-Beleg.' },
  'lock_screen.card_payment_unclear': { text: 'Eine Kartenzahlung ist unklar – bitte anmelden und prüfen.' },
  'lock_screen.receipt_unclear': { text: 'Ein Beleg ist unklar – bitte anmelden und prüfen.' },
  'lock_screen.payout_unclear': { text: 'Eine Auszahlung ist unklar – bitte anmelden und prüfen.' },
  'lock_screen.reversal_unclear': { text: 'Eine Rückbuchung ist unklar – bitte anmelden und prüfen.' },
  'lock_screen.split_open': { text: 'Eine getrennte Zahlung ist offen – bitte anmelden und prüfen.' },
  // Auf dem Testdruck, unter der Linie fuer die Papierbreite.
  'print.test_ruler_hint': { text: 'Linie in einer Zeile? Sonst 58 mm wählen.' },
  'connect.browser_blocks': { text: 'Der Browser sperrt Kasseneck Connect.', only: ['web'] },
  'connect.updating': { text: 'Kasseneck Connect wird aktualisiert …', only: ['web'] },
  'connect.other_installation': { text: 'Ein anderes Kasseneck Connect antwortet.', only: ['web'] },
  'connect.other_installation_hint': { text: 'Anderer Benutzer am Rechner?', only: ['web'] },
  // Sprueche der Browser-Kasse, die bisher im Code standen (lib/connect.ts, App.tsx, einstellungen-schema.ts).
  'connect.pair_invalid': { text: 'Der Kopplungs-Code stimmt nicht.', only: ['web'] },
  'connect.pair_request_throttled': { text: 'Die Kopplung wurde gerade eben schon angefordert – der Tab sollte offen sein. Sonst kurz warten oder den Code eintippen.', only: ['web'] },
  'connect.print_in_progress': { text: 'Der Auftrag wird gerade gedruckt.', only: ['web'] },
  'connect.printer_timeout': { text: 'Der Drucker hat nicht rechtzeitig geantwortet.', only: ['web'] },
  'connect.printer_refused': { text: 'Der Drucker hat den Druck abgelehnt – Papier und Deckel prüfen.', only: ['web'] },
  'connect.bad_request': { text: 'Kasseneck Connect konnte mit dieser Anfrage nichts anfangen.', only: ['web'] },
  'connect.unreadable_answer': { text: 'Kasseneck Connect antwortet unverständlich – bitte neu starten.', only: ['web'] },
  'connect.error_generic': { text: 'Kasseneck Connect meldet einen Fehler.', only: ['web'] },
  'connect.unpaired_done': { text: 'Entkoppelt – dieser Browser hat keinen Zugriff mehr. Neu koppeln geht jederzeit.', only: ['web'] },
  'connect.switched_over': { text: 'Umgestellt – jetzt unten koppeln und den Drucker wählen.', only: ['web'] },

  // --- Einstellungen -------------------------------------------------------
  'settings.load_failed': { text: 'Die Einstellungen konnten nicht geladen werden.' },
  'settings.save_failed': { text: 'Die Einstellung konnte nicht gespeichert werden.' },
  'settings.not_loaded_yet': { text: 'Noch nicht geladen – bitte kurz warten oder neu anmelden.' },
  'settings.ip_invalid': { text: 'Keine gültige IP-Adresse (z. B. 192.168.1.50).' },
  'unpairing.failed': { text: 'Entkoppeln fehlgeschlagen.' },
  'logo.upload_failed': { text: 'Hochladen fehlgeschlagen.' },
  'logo.remove_failed': { text: 'Entfernen fehlgeschlagen.' },

  // --- Inventur zählen ------------------------------------------------------
  // Gezählt wird blind und nur online; bei unklarem Ausgang schickt
  // „Erneut senden“ dieselbe Zählung mit demselben Schlüssel (sie zählt genau
  // einmal), nie eine neue. `{quantity}` ist die Menge samt Einheit („12 Stk“),
  // `{count}` die Zahl der erfassten Seriennummern.
  'stocktake.none_open': { text: 'An diesem Standort läuft gerade keine Inventur. Eine Inventur legt der Inhaber im Panel an.' },
  'stocktake.scan_or_search': { text: 'Artikel scannen oder suchen.' },
  'stocktake.counted': { text: '{name}: {quantity} gezählt.', placeholders: ['name', 'quantity'] },
  'stocktake.blind_hint': { text: 'Blind zählen – die Kasse zeigt keinen Buchbestand. Bitte zählen, was wirklich da ist.' },
  'stocktake.recount_hint': { text: 'Bitte die markierten Positionen nachzählen.' },
  'stocktake.unknown_code': { text: 'Zu „{code}“ gibt es keinen Artikel. Bitte den Code prüfen oder den Artikel suchen.', placeholders: ['code'] },
  'stocktake.quantity_invalid': { text: 'Bitte eine gültige Menge eingeben – höchstens drei Nachkommastellen, bei Stückware nur ganze Zahlen.' },
  'stocktake.serials_capture': { text: 'Bitte für jedes Stück die Seriennummer scannen.' },
  'stocktake.serials_mismatch': { text: 'Je Stück genau eine Seriennummer: {count} erfasst, {quantity} gezählt.', placeholders: ['count', 'quantity'] },
  'stocktake.reason_missing': { text: 'Bitte einen Grund für das Stornieren eingeben.' },
  'stocktake.outcome_unknown': { text: 'Unklar, ob die Zählung angekommen ist. „Erneut senden“ schickt dieselbe Zählung – sie zählt auch dann nur einmal.' },

  // --- Schicht und Kassenstand ---------------------------------------------
  // Soll und Differenz nennt kein Satz: ohne Recht `cashView` wird blind
  // gezaehlt. `{number}` ist die Schicht-Nummer, `{since}` die Startzeit
  // („08:00“ bzw. „gestern 22:15“), `{type}` die Beschriftung der Art
  // (`cash_movement.type_*`), `{amount}` der Betrag samt Euro-Zeichen.
  // „Erneut senden“ schickt denselben Vorgang mit demselben Schluessel.
  'shift.required': { text: 'Bitte zuerst die Schicht öffnen.' },
  'shift.required_other': { text: 'Die Schicht muss ein berechtigter Mitarbeiter öffnen.' },
  'shift.recount': { text: 'Der gezählte Betrag weicht ab – bitte noch einmal zählen.' },
  'shift.comment_required': { text: 'Die Abweichung ist größer als erlaubt – bitte kurz begründen.' },
  'shift.closed': { text: 'Schicht {number} geschlossen.', placeholders: ['number'] },
  'shift.long_open': { text: 'Die Schicht läuft seit {since}.', placeholders: ['since'] },
  'shift.already_open': { text: 'An dieser Lade läuft schon eine Schicht.' },
  'shift.already_closed': { text: 'Diese Schicht ist schon geschlossen.' },
  'shift.recount_exhausted': { text: 'Es wurde schon zweimal gezählt. Bitte den Betrag der zweiten Zählung senden oder den Chef rufen.' },
  'shift.mode_off': { text: 'An dieser Lade ist der Schichtbetrieb aus. Bitte im Panel einschalten.' },
  'shift.outcome_unknown': { text: 'Unklar, ob das angekommen ist. „Erneut senden“ schickt denselben Vorgang – er zählt nur einmal.' },
  'cash_movement.exceeds_balance': { text: 'So viel Bargeld ist laut Kassenstand nicht in der Lade.' },
  'cash_movement.note_required': { text: 'Bitte einen Grund eingeben.' },
  'cash_movement.booked': { text: '{type} über {amount} gebucht.', placeholders: ['type', 'amount'] },
  'cash_movement.type_invalid': { text: 'Diese Art der Kassenbewegung ist hier nicht möglich.' },
  'cash_movement.same_drawer': { text: 'Eine Umbuchung in dieselbe Lade geht nicht. Bitte eine andere Lade wählen.' },
  'tip_payout.exceeds_claim': { text: 'Mehr als der offene Anspruch kann nicht ausgezahlt werden.' },
  'denominations.invalid': { text: 'Scheine und Münzen ergeben nicht den Betrag.' },
  'amount.invalid': { text: 'Bitte einen gültigen Betrag eingeben.' },
  'drawer.not_found': { text: 'Diese Lade gibt es nicht mehr. Bitte im Panel die Lade dieses Geräts prüfen.' },
  'drawer.inactive': { text: 'Diese Lade ist stillgelegt. Bitte im Panel eine andere Lade zuordnen.' },
  'tip_payout.recipient_required': { text: 'Bitte einen Mitarbeiter wählen.' },
  'tip_payout.none_open': { text: 'In dieser Schicht ist kein Trinkgeld offen.' },
  'shift.pending_hint': { text: 'Noch nicht bestätigt. „Erneut senden“ schickt denselben Vorgang – er zählt nur einmal.' },
  // Wechselgeld der Lade (1.11.0): beim Öffnen der Schicht liegt weniger in der Lade als eingestellt.
  // `{amount}` was fehlt, `{total}` das eingestellte Wechselgeld, beide samt Euro-Zeichen.
  'shift.change_float_missing': { text: 'Es fehlen {amount} bis zum Wechselgeld von {total}.', placeholders: ['amount', 'total'] },

  // --- Prüfung (DEP) bei der Kassennachschau ---------------------------------
  // Nur der Chef exportiert (Inhaber oder Recht „Einstellungen“); ein Kassier
  // sieht nur den Hinweis. Seit 1.23.0 ohne Rechtssprache (keine Frist, keine
  // Behörde): an der Kasse steht nur, wer exportiert und dass es Internet braucht.
  'dep.manager_only': { text: 'Den Export macht der Chef.' },
  'dep.offline': { text: 'Ohne Internet geht der Export nicht.' },
  'dep.creating': { text: 'Wird erstellt …' },
  'dep.running': { text: 'Für diese Kasse läuft schon ein Export. Bitte kurz warten, er wird gleich fertig.' },
  'dep.failed': { text: 'Der Export ist fehlgeschlagen. Bitte erneut erstellen.' },
  'dep.too_many_exports': { text: 'Heute sind an diesem Konto keine weiteren Exporte möglich – morgen geht es wieder. Ein schon erstellter Export bleibt nutzbar.' },
  'dep.period_invalid': { text: 'Bitte einen gültigen Zeitraum wählen: „Von“ nicht in der Zukunft, „Bis“ nicht vor „Von“.' },
  'dep.usb_hint': { text: 'USB-Stick anstecken (FAT32 oder exFAT). Der Prüfer behält den Stick.' },
  'dep.saved': { text: 'Gespeichert im Ordner {folder}.', placeholders: ['folder'] },
  'dep.save_failed': { text: 'Speichern hat nicht geklappt. Bitte den Stick prüfen und erneut speichern.' },
  'dep.zip_fallback': { text: 'Dieser Browser kann keinen Ordner wählen – der Export kommt als ZIP-Datei in den Download-Ordner.', only: ['web'] },
  'dep.code_once': { text: 'Code und QR-Code gibt es nur auf diesem Bildschirm. Wer zurückgeht, erstellt beim nächsten Mal einen neuen Link.' },
  'dep.revoked': { text: 'Der Link ist widerrufen.' },

  // --- Prüfung: Kasseninfo für den Prüfer (1.23.0) -----------------------------
  // Der Absatz unter „So arbeitet die Kasse:“ (Bildschirm und Ausdruck), die
  // Frage nach einem Nullbeleg (nur mit eingerichtetem Drucker) und der Satz,
  // wenn die Angaben nicht kommen.
  'inspection.how_it_works_text': { text: 'Erfasst wird in der Kassen-App oder in der Web-Kasse, gespeichert wird online. Jeder Beleg wird beim Erstellen signiert. Den Beleg gibt es gedruckt, per Mail oder als QR-Code.' },
  'inspection.print_question': { text: 'Kasseninfo für den Prüfer auch drucken?' },
  'inspection.load_failed': { text: 'Die Kasseninfo konnte nicht geladen werden.' },
  // Sperre nach einem Nullbeleg mit unklarem Ausgang (wie `voucher.payout_check_first`):
  // erst die Belegliste neu laden, dann ist ein neuer Nullbeleg möglich.
  'zero_receipt.check_first': { text: 'Der letzte Nullbeleg ging unklar aus und kann schon erstellt sein. Erst unter „Belege“ die Liste neu laden und nachsehen, dann ist ein neuer möglich.' },

  // --- Nur App -------------------------------------------------------------
  'app.not_in_browser': { text: 'Die Kassen-App läuft nicht im Browser – dafür gibt es kasse.kasseneck.at.', only: ['app'] },
  'app.open_in_browser': { text: 'Bitte im Browser öffnen: {target}', placeholders: ['target'], only: ['app'] },

  // --- Nur Browser-Kasse: neue Fassung (1.37.0) ----------------------------
  // Ein offener Tab laeuft nach einem Deploy mit dem alten Buendel weiter. Die
  // Zeile steht nur, solange an der Kasse nichts laeuft, und laedt nie von
  // selbst neu (Knopf `version.reload`). Die App kommt ueber den Store.
  'version.new_available': { text: 'Neue Fassung verfügbar – bei Gelegenheit neu laden.', only: ['web'] },
  // Einmal kurz nach dem Selbst-Neuladen (Spec 2026-11-13-fassung-aktuell).
  'version.updated': { text: 'Kasse aktualisiert auf {version}.', placeholders: ['version'], only: ['web'] },

  // --- Schicht-Ablauf der Kasse (1.28.0) -----------------------------------
  'shift.started_taken_over': { text: 'Schicht {number} hat begonnen – mit {amount} in der Lade, übernommen von Schicht {from} ({time}).', placeholders: ['number', 'amount', 'from', 'time'] },
  'tip.summary': { text: 'Trinkgeld {tip} · der Gast zahlt {total}', placeholders: ['tip', 'total'] },
  'tip.total_below_sum': { text: 'Der Betrag liegt unter der Summe.' },
  'shift.interim_saved': { text: 'Zählung festgehalten.' },
  // Waehrend Zwischenzaehlung oder Abschluss rechts: getippte Wege der Kopfzeile sagen, warum sie gesperrt sind.
  'shift.finish_step_first': { text: 'Erst den Schritt rechts abschließen oder abbrechen.' },
  'tip.revenue_hint': { text: 'Steuerpflichtiges Trinkgeld zählt als Umsatz des Betriebs und wird nicht ausgezahlt.' },
  'tip.unassigned_hint': { text: 'Trinkgeld ohne angemeldeten Benutzer.' },

  // --- Pfand und Leergut (1.32.0): Fehlersätze (Zuordnung in DEPOSIT_ERROR_MESSAGES) ---
  'deposit.changed': { text: 'Pfand wurde geändert. Bitte Summe prüfen.' },
  'deposit_error.not_enabled': { text: 'Pfand ist für diesen Betrieb nicht eingeschaltet.' },
  'deposit_error.type_not_found': { text: 'Diese Pfandart gibt es nicht mehr.' },
  'deposit_error.set_by_server': { text: 'Das Pfand bucht die Kasse selbst.' },
  'deposit_error.invalid_quantity': { text: 'Pfand gibt es nur für ganze Stück.' },
  'deposit_error.return_not_offered': { text: 'Diese Kasse nimmt kein Leergut zurück.' },
  'deposit_error.type_not_issued': { text: 'Dieses Leergut wurde hier nie verkauft.' },
  'deposit_error.follows_item': { text: 'Pfand wird mit seinem Artikel storniert.' },
  'deposit_error.invalid': { text: 'Die Pfand-Angaben stimmen nicht.' },
} as const satisfies Record<string, TextEntry>;

export type MessageKey = keyof typeof MELDUNGEN_ROH;

// Auf den gemeinsamen Typ gebracht: `Object.entries(MESSAGES)` liefert sonst
// pro Schluessel den engsten Literaltyp, und `placeholders`/`only` waeren nur
// auf manchen Zweigen der Vereinigung vorhanden.
export const MESSAGES: Record<MessageKey, TextEntry> = MELDUNGEN_ROH;

/**
 * In welcher Reihenfolge ein Fehler eingeordnet wird, auf beiden Seiten
 * dieselbe. Genau eine Regel je Art (`kind`), mit einem Verhalten
 * (`behavior`) oder dem Schluessel des Satzes (`key`). Die Arten:
 *   api        - HTTP 200, `status:'error'`: der Satz des Backends, woertlich
 *                (`server_text`)
 *   plain_text - schon fuer den Bildschirm geschrieben: sein eigener Text
 *                (`own_text`)
 *   timeout    - die Frist lief ab, die Anfrage war draussen
 *   network    - keine Verbindung zustande gekommen oder abgerissen
 *   unexpected - der Server hat geantwortet, aber nicht wie zugesagt
 *                (HTML statt JSON, 500, fehlende Huelle); `status` = HTTP-Code
 *   other      - alles Uebrige ist technisch: der Ersatzsatz des Vorgangs
 *                (`fallback`)
 * Unter 0.x hiessen sie `klartext`, `zeitablauf`, `netz`, `unerwartet`,
 * `sonst` (Tabelle in `fixtures/renames-1.0.json`).
 *
 * Seit 1.0.0-rc.5 verfeinern [ERROR_CODE_RULES] und [ERROR_OUTCOME_RULES]
 * diese Liste; sie stehen bewusst getrennt, damit ein Leser, der nur nach
 * `kind` sucht, weiter genau den Satz von rc.4 zeigt. [findErrorRule] wendet
 * alle drei in der richtigen Reihenfolge an.
 */
export const ERROR_RULES = [
  { kind: 'api', behavior: 'server_text' },
  { kind: 'plain_text', behavior: 'own_text' },
  { kind: 'timeout', key: 'network.timeout' },
  { kind: 'network', key: 'network.no_connection' },
  { kind: 'unexpected', key: 'server.unexpected' },
  { kind: 'other', behavior: 'fallback' },
] as const;

export type ErrorKind = (typeof ERROR_RULES)[number]['kind'];

/**
 * Regeln je Code (`error.code`), vor der Regel der Art: sie ersetzen den
 * technischen Satz des Pakets bzw. des Rands durch einen Menschentext. Der
 * technische Satz bleibt in `error.message` fuers Protokoll.
 *   - `dialect_mismatch`, `response_translation_failed`, `response_unreadable`:
 *     Ausgang unklar, der Vorgang kann gebucht sein; der Satz raet nie zum
 *     Wiederholen, sondern zum Nachsehen.
 *   - `route_missing`, `not_found`, `internal_translation_error`: am Server
 *     geschah nichts, ein neuer Versuch ist sicher (auch auf den Geldwegen:
 *     alle drei stehen in `PAYMENT_CALL_REJECTED_CODES`).
 */
export const ERROR_CODE_RULES = [
  { kind: 'api', codes: ['dialect_mismatch', 'response_translation_failed', 'response_unreadable'], key: 'server.response_unreadable' },
  { kind: 'api', codes: ['route_missing', 'not_found', 'internal_translation_error'], key: 'server.connection_disturbed' },
  // Schicht und Kassenstand (1.9.0): die Saetze des Backends nennen Felder
  // und Schwellen; die Kasse sagt, was zu tun ist. Der Server hat in jedem
  // dieser Faelle nichts gebucht.
  { kind: 'api', codes: ['shift_not_open'], key: 'shift.required' },
  { kind: 'api', codes: ['shift_already_open'], key: 'shift.already_open' },
  { kind: 'api', codes: ['shift_closed'], key: 'shift.already_closed' },
  { kind: 'api', codes: ['comment_required'], key: 'shift.comment_required' },
  { kind: 'api', codes: ['recount_exhausted'], key: 'shift.recount_exhausted' },
  { kind: 'api', codes: ['shift_mode_off'], key: 'shift.mode_off' },
  { kind: 'api', codes: ['cash_movement_exceeds_balance'], key: 'cash_movement.exceeds_balance' },
  { kind: 'api', codes: ['note_required'], key: 'cash_movement.note_required' },
  { kind: 'api', codes: ['invalid_movement_type'], key: 'cash_movement.type_invalid' },
  { kind: 'api', codes: ['transfer_same_drawer'], key: 'cash_movement.same_drawer' },
  { kind: 'api', codes: ['tip_payout_exceeds_claim'], key: 'tip_payout.exceeds_claim' },
  { kind: 'api', codes: ['invalid_denominations'], key: 'denominations.invalid' },
  { kind: 'api', codes: ['invalid_amount'], key: 'amount.invalid' },
  { kind: 'api', codes: ['drawer_not_found'], key: 'drawer.not_found' },
  { kind: 'api', codes: ['drawer_inactive'], key: 'drawer.inactive' },
  // Prüfung (DEP, 1.21.0): nur der Chef; die Tagesgrenze und ein laufender
  // Export sagen, was zu tun ist. Der Server hat nichts angelegt. Bewusst
  // ohne export_failed (kommt auch von Zahlungswegen mit unklarem Ausgang)
  // und ohne too_many_links (der Satz des Backends nennt die Grenze).
  { kind: 'api', codes: ['manager_only'], key: 'dep.manager_only' },
  { kind: 'api', codes: ['export_running'], key: 'dep.running' },
  { kind: 'api', codes: ['too_many_exports'], key: 'dep.too_many_exports' },
  // Storno eines Zahlungsbelegs (Zahlung auf Rechnung, 1.38.0): der Satz sagt, wo es geht. Der Server
  // hat nichts storniert. Gilt auch auf dem Storno-Weg ([cancellationErrorMessage]).
  { kind: 'api', codes: ['invoice_payment_not_cancellable'], key: 'cancellation.invoice_payment_not_cancellable' },
] as const;

/**
 * Regeln je Ausgang, nach den Code-Regeln und vor der Regel der Art: eine
 * Frist oder ein Netzfehler auf einem Aufruf mit Wirkung (Ausgang unklar,
 * siehe [messageOutcome]) raet nie zum Wiederholen. Ein Netzfehler auf einem
 * Aufruf ohne Wirkung behaelt den Satz von rc.4 („erneut versuchen“).
 */
export const ERROR_OUTCOME_RULES = [
  { kind: 'timeout', outcome: 'unknown', key: 'network.outcome_unknown' },
  { kind: 'network', outcome: 'unknown', key: 'network.outcome_unknown' },
] as const;

export type ErrorRule = (typeof ERROR_RULES)[number] | (typeof ERROR_CODE_RULES)[number] | (typeof ERROR_OUTCOME_RULES)[number];

/** Was ueber einen Fehler bekannt ist, ausser seiner Art. */
export interface ErrorRuleDetail {
  /** `error.code` eines `KasseneckApiError`. */
  code?: string | null;
  /** Ausgang fuer den Satz, siehe [messageOutcome]. */
  outcome?: ErrorOutcome | null;
}

/**
 * Die Regel fuer einen Fehler: zuerst eine Code-Regel mit passender Art und
 * passendem `code`, dann eine Ausgangs-Regel mit passender Art und
 * passendem `outcome`, sonst die Regel der Art aus [ERROR_RULES]. Beide
 * Kassen ordnen so ein.
 */
export function findErrorRule(kind: ErrorKind, detail: ErrorRuleDetail = {}): ErrorRule {
  const { code, outcome } = detail;
  if (code !== undefined && code !== null) {
    const treffer = ERROR_CODE_RULES.find((r) => r.kind === kind && (r.codes as readonly string[]).includes(code));
    if (treffer) return treffer;
  }
  if (outcome !== undefined && outcome !== null) {
    const treffer = ERROR_OUTCOME_RULES.find((r) => r.kind === kind && r.outcome === outcome);
    if (treffer) return treffer;
  }
  // Jede Art hat genau eine Regel; hierher kommt nur eine fremde Art nicht.
  return ERROR_RULES.find((r) => r.kind === kind) ?? ERROR_RULES[ERROR_RULES.length - 1]!;
}

/**
 * Kassen-Aufrufe mit Wirkung, die sich nach einem Netzfehler nicht gefahrlos
 * wiederholen lassen: Beleg (auch Null- und Startbeleg ueber
 * `createReceipt`), Storno, FinanzOnline, die drei Geldwege, der Druckjob
 * (zweiter Bon) und die Belegmail (zweite Mail). Ob die Anfrage vor dem
 * Abriss schon draussen war, sieht das Paket nicht (fetch wirft in beiden
 * Faellen gleich); darum gilt hier immer der vorsichtige Satz, auch fuer
 * einen Fehler, der vor dem Senden entstand.
 *
 * Seit 1.5.1 fuehrt der Transport jeden Aufruf mit Wirkung als unklar
 * (`UNKNOWN_OUTCOME_CALLS`, eine Obermenge dieser Liste), und
 * [messageOutcome] folgt zuerst ihm. Die Liste bleibt als Vertrag der
 * Kassentexte (`callsWithEffect` in `fixtures/pos-texts.json`) unveraendert.
 */
export const CALLS_WITH_EFFECT = Object.freeze([
  'createReceipt',
  'cancelReceipt',
  'financeWebService',
  'hobexPayApi',
  'hobexRefundApi',
  'stripeCaptureIntent',
  'createPrintJob',
  'sendReceiptEmail',
] as const);
const MIT_WIRKUNG: ReadonlySet<string> = new Set(CALLS_WITH_EFFECT);

/**
 * Der Ausgang, nach dem der Satz gewaehlt wird: `'unknown'`, wenn das Paket
 * ihn als unklar fuehrt ([isOutcomeUnknown]) oder wenn eine Frist bzw. ein
 * Netzfehler einen Aufruf aus [CALLS_WITH_EFFECT] traf; sonst der Ausgang
 * des Fehlers (`'rejected'`) bzw. `undefined` fuer fremde Fehler.
 */
export function messageOutcome(error: unknown): ErrorOutcome | undefined {
  if (isOutcomeUnknown(error)) return 'unknown';
  if (error instanceof KasseneckNetworkError) return MIT_WIRKUNG.has(error.functionName.split('/')[0]!) ? 'unknown' : error.outcome;
  if (error instanceof KasseneckApiError || error instanceof KasseneckHttpError) return error.outcome;
  return undefined;
}

/**
 * Beleg per E-Mail senden: welcher `code` des Backends welchen Satz bekommt.
 *
 * `ERROR_RULES` bleibt davon unberuehrt – das hier ist keine neue Art, einen
 * Transportfehler einzuordnen, sondern die Verfeinerung EINES Aufrufs
 * (`sendReceiptEmail`). Die vier Ausgaenge sind fuer den Kassier vier
 * verschiedene Handlungen: Adresse verbessern, spaeter noch einmal, noch
 * einmal senden, Beleg suchen. Beide Kassen entscheiden am `code`, nicht am
 * Satz des Backends — sonst haengt das Wort am Tresen an einer Formulierung,
 * die sich im Backend jederzeit aendern darf.
 *
 * Bewusst ein Objekt und keine Liste in GROSSSCHRIFT: der
 * Oberflaechen-Vertrag (`fixtures/surface.json`) liest jede exportierte
 * Liste als Enum der Kasseneinstellungen ein, und der Dart-Zwilling schickt
 * deren Werte durch `KasseSettings.aus`. Fehlercodes haben dort nichts
 * verloren; sie stehen in `fixtures/pos-texts.json`.
 *
 * Die Codes sind die von `/v3` (`RECEIPT_EMAIL_SEND_ERROR_CODES`; Anmelde- und Rand-Codes fallen auf den Ersatzsatz); unter `/v1` hiessen
 * sie `adresse_ungueltig`, `zu_oft`, `versand_fehlgeschlagen`, `beleg_nicht_gefunden`.
 */
export const RECEIPT_EMAIL_ERROR_MESSAGES = {
  invalid_address: 'receipt.mail_address_invalid',
  too_many_requests: 'receipt.mail_too_often',
  send_failed: 'receipt.mail_failed',
  receipt_not_found: 'receipt.mail_not_found',
} as const satisfies Record<ReceiptEmailSendErrorCode, MessageKey>;

export type ReceiptEmailMessageCode = keyof typeof RECEIPT_EMAIL_ERROR_MESSAGES;

/**
 * Der Satz zu einem `code` des Backends. Einen Code, den dieses Paket noch
 * nicht kennt, faengt der allgemeine Satz auf: das Senden ist gescheitert und
 * darf wiederholt werden. Ein leerer Schirm waere schlimmer als ein zu
 * allgemeiner Satz.
 */
export function receiptEmailErrorMessage(code: string | undefined | null): MessageKey {
  const fehler: Record<string, MessageKey> = RECEIPT_EMAIL_ERROR_MESSAGES;
  return (code !== undefined && code !== null && fehler[code]) || 'receipt.mail_failed';
}

/**
 * Storno eines Belegs mit mehreren Zahlungen, dazu der offene Ausgang
 * (`cancellation_outcome_unknown`, gilt fuer jedes Storno): welcher `code` des
 * Backends unter `/v3` welchen Satz bekommt. Dieselbe Idee wie RECEIPT_EMAIL_ERROR_MESSAGES – beide Kassen
 * entscheiden am Code, nie am Satz des Backends. Ein Code, der hier fehlt,
 * geht den allgemeinen Weg der Storno-Fehler (`cancellation.failed`).
 */
export const CANCELLATION_PAYMENT_ERROR_MESSAGES = {
  cancellation_payments_required: 'cancellation.payments_missing',
  cancellation_refund_exceeds_payment: 'cancellation.refund_too_high',
  cancellation_refund_reference_required: 'cancellation.refund_without_reference',
  cancellation_refund_reference_unknown: 'cancellation.refund_reference_unknown',
  payments_sum_mismatch: 'cancellation.sum_mismatch',
  cancellation_outcome_unknown: 'cancellation.outcome_unknown',
} as const satisfies Record<string, MessageKey>;

export type CancellationPaymentMessageCode = keyof typeof CANCELLATION_PAYMENT_ERROR_MESSAGES;

/**
 * Der Satz zu einem `code` des Backends beim Storno mit mehreren Zahlungen.
 * Einen Code, den dieses Paket noch nicht kennt, faengt der allgemeine Satz
 * `cancellation.failed` auf – wie bei `receiptEmailErrorMessage`.
 */
export function cancellationPaymentErrorMessage(code: string | undefined | null): MessageKey {
  const fehler: Record<string, MessageKey> = CANCELLATION_PAYMENT_ERROR_MESSAGES;
  return (code !== undefined && code !== null && fehler[code]) || 'cancellation.failed';
}

/**
 * Storno mit Rueckgabe als Gutschein (`refundAs: 'voucher'`, 1.25.0): welcher `code` welchen Satz bekommt.
 * Eigene Tabelle neben CANCELLATION_PAYMENT_ERROR_MESSAGES (die bleibt der Stand der 0.x-Linie); die Codes
 * fuer abgelehnte Eingaben und `idempotency_conflict` teilen sich `cancellation.input_rejected`.
 */
export const CANCELLATION_VOUCHER_ERROR_MESSAGES = {
  refund_as_voucher_not_available: 'cancellation.voucher_not_available',
  refund_as_voucher_reason: 'cancellation.voucher_reason',
  refund_as_voucher_with_voucher: 'cancellation.voucher_with_voucher',
  refund_as_voucher_no_type: 'cancellation.voucher_no_type',
  refund_as_voucher_amount: 'cancellation.voucher_amount',
  voucher_type_not_found: 'cancellation.voucher_type_changed',
  voucher_amount_mismatch: 'cancellation.voucher_type_changed',
  refund_as_invalid: 'cancellation.input_rejected',
  refund_as_conflict: 'cancellation.input_rejected',
  idempotency_key_required: 'cancellation.input_rejected',
  idempotency_conflict: 'cancellation.input_rejected',
} as const satisfies Record<string, MessageKey>;

/**
 * Der Satz zu einem `code` eines Stornos: zuerst die Rueckgabe als Gutschein, dann eine Code-Regel mit
 * Storno-Satz (Schluessel `cancellation.*` in [ERROR_CODE_RULES], seit 1.38.0 der Zahlungsbeleg), dann
 * die Storno-Zahlungen, sonst `cancellation.failed`. Fuer die Kassen der eine Weg beim Storno.
 */
export function cancellationErrorMessage(code: string | undefined | null): MessageKey {
  if (code === undefined || code === null) return cancellationPaymentErrorMessage(code);
  const gutschein: Record<string, MessageKey> = CANCELLATION_VOUCHER_ERROR_MESSAGES;
  if (gutschein[code]) return gutschein[code];
  const regel = ERROR_CODE_RULES.find((r) => r.key.startsWith('cancellation.') && (r.codes as readonly string[]).includes(code));
  return regel?.key ?? cancellationPaymentErrorMessage(code);
}

/**
 * Fremdgutscheine an der Kasse (1.31.0): Satz zur gesperrten Kachel ([externalVoucherTileBlock]).
 */
export const EXTERNAL_VOUCHER_TILE_MESSAGES = {
  not_enabled: 'external_voucher.not_enabled',
  type_not_enabled: 'external_voucher.type_not_enabled',
} as const satisfies Record<ExternalVoucherTileBlock, MessageKey>;

/**
 * Artikel als fremder Gutschein: Satz je verletzter Regel (`data.grund` zu
 * `article_external_voucher_invalid`, bzw. [checkExternalVoucherArticle] im Editor).
 */
export const EXTERNAL_VOUCHER_ARTICLE_MESSAGES = {
  invalid_type: 'external_voucher_article.invalid',
  service_voucher: 'external_voucher_article.service_voucher',
  add_ons: 'external_voucher_article.add_ons',
  stock_tracked: 'external_voucher_article.stock_tracked',
  reference: 'external_voucher_article.reference',
  asks_quantity: 'external_voucher_article.asks_quantity',
  deposit: 'external_voucher_article.deposit',
  rate_required: 'external_voucher_article.rate_required',
  invalid_rate: 'external_voucher_article.invalid_rate',
  price_required: 'external_voucher_article.price_required',
} as const satisfies Record<ExternalVoucherArticleReason, MessageKey>;

/**
 * Der Satz zu einer Absage beim Speichern eines Artikels: nur fuer
 * `article_external_voucher_invalid` (sonst `undefined`), je `grund`; ein
 * unbekannter oder fehlender Grund (`reason` = `data.grund`) bekommt den allgemeinen Satz.
 */
export function externalVoucherArticleErrorMessage(code: string | undefined | null, reason?: string | null): MessageKey | undefined {
  if (code !== ARTICLE_EXTERNAL_VOUCHER_INVALID) return undefined;
  const saetze: Record<string, MessageKey> = EXTERNAL_VOUCHER_ARTICLE_MESSAGES;
  return (typeof reason === 'string' && Object.prototype.hasOwnProperty.call(saetze, reason) ? saetze[reason] : undefined) ?? 'external_voucher_article.invalid';
}

/**
 * Gutschein-Fehler (`/v3`): welcher `code` des Backends welchen Satz bekommt.
 * Wie RECEIPT_EMAIL_ERROR_MESSAGES: beide Kassen entscheiden am Code. Ein
 * unbekannter Code geht den allgemeinen Weg des Aufrufs.
 */
export const VOUCHER_ERROR_MESSAGES = {
  voucher_not_found: 'voucher_error.not_found',
  voucher_invalid: 'voucher_error.invalid',
  voucher_invalid_code: 'voucher_error.invalid_code',
  voucher_expired: 'voucher_error.expired',
  voucher_used_up: 'voucher_error.used_up',
  voucher_blocked: 'voucher_error.blocked',
  voucher_cancelled: 'voucher_error.cancelled',
  voucher_insufficient_balance: 'voucher_error.insufficient_balance',
  voucher_exceeds_total: 'voucher_error.exceeds_total',
  voucher_balance_changed: 'voucher_error.balance_changed',
  voucher_rate_mismatch: 'voucher_error.rate_mismatch',
  voucher_item_mismatch: 'voucher_error.item_mismatch',
  voucher_already_used: 'voucher_error.already_used',
  voucher_partial_cancel: 'voucher_error.partial_cancel',
  voucher_settings_missing: 'voucher_error.settings_missing',
  too_many_voucher_checks: 'voucher_error.too_many_checks',
  voucher_type_required: 'voucher_error.type_required',
  voucher_type_not_found: 'voucher_error.type_not_found',
  voucher_amount_mismatch: 'voucher_error.amount_mismatch',
  voucher_service_not_allowed: 'voucher_error.service_not_allowed',
  voucher_payout_not_allowed: 'voucher_error.payout_not_allowed',
  external_voucher_not_enabled: 'voucher_error.external_not_enabled',
  external_voucher_type_not_enabled: 'voucher_error.external_type_not_enabled',
  external_voucher_number_invalid: 'voucher_error.external_number_invalid',
  external_voucher_number_is_own_code: 'voucher_error.external_number_is_own_code',
  external_voucher_duplicate: 'voucher_error.external_duplicate',
} as const satisfies Record<string, MessageKey>;

export type VoucherMessageCode = keyof typeof VOUCHER_ERROR_MESSAGES;

/** Der Satz zu einem Gutschein-`code`; `undefined` für jeden anderen Code. */
export function voucherErrorMessage(code: string | undefined | null): MessageKey | undefined {
  const fehler: Record<string, MessageKey> = VOUCHER_ERROR_MESSAGES;
  return code !== undefined && code !== null ? fehler[code] : undefined;
}

/**
 * Pfand-Fehler (`/v3`, createReceipt und cancelReceipt): welcher `code` des
 * Backends welchen Satz bekommt. Kassensprache, keine Rechtssprache.
 */
export const DEPOSIT_ERROR_MESSAGES = {
  deposit_not_enabled: 'deposit_error.not_enabled',
  deposit_type_not_found: 'deposit_error.type_not_found',
  deposit_set_by_server: 'deposit_error.set_by_server',
  invalid_deposit_quantity: 'deposit_error.invalid_quantity',
  deposit_return_not_offered: 'deposit_error.return_not_offered',
  deposit_type_not_issued: 'deposit_error.type_not_issued',
  deposit_follows_item: 'deposit_error.follows_item',
  invalid_deposit: 'deposit_error.invalid',
} as const satisfies Record<string, MessageKey>;

export type DepositMessageCode = keyof typeof DEPOSIT_ERROR_MESSAGES;

/** Der Satz zu einem Pfand-`code`; `undefined` für jeden anderen Code. */
export function depositErrorMessage(code: string | undefined | null): MessageKey | undefined {
  const fehler: Record<string, MessageKey> = DEPOSIT_ERROR_MESSAGES;
  return code !== undefined && code !== null && Object.prototype.hasOwnProperty.call(fehler, code) ? fehler[code] : undefined;
}

/**
 * Beschriftungen: Knoepfe, Ueberschriften, Zeilennamen – was kein Satz ist.
 *
 * Getrennt von MESSAGES, weil dort jeder Eintrag ein Satz ist (gross am
 * Anfang, Satzzeichen am Schluss) und die Waechter beider Kassen daran
 * Saetze erkennen. „Rest" oder „÷ {n}" sind keine Saetze, muessen aber in
 * beiden Kassen gleich heissen. Dieselben Regeln sonst: Schluessel
 * `bereich.name`, nie umgedeutet, Platzhalter exakt die im Text, `only` nennt
 * die Seite.
 *
 * Die Woerter der Zahlarten folgen dem Bon („Kartenzahlung", „Barzahlung",
 * „Zahlung {n}", „davon Trinkgeld").
 */
const BESCHRIFTUNGEN_ROH = {
  // --- Allgemein -------------------------------------------------------------
  'common.cancel': { text: 'Abbrechen' },
  // Das X an einer Meldung nennt, WELCHE es ausblendet – bei mehreren
  // Meldungen in der Ecke sonst fuer Vorlese-Programme lauter gleiche Knoepfe.
  // `{message}` ist der Anfang des Satzes (gekuerzt), nicht der ganze.
  'message.dismiss': { text: 'Meldung ausblenden: {message}', placeholders: ['message'] },
  'message.dismiss_warning': { text: 'Verstanden – Warnung ausblenden: {message}', placeholders: ['message'] },

  // --- Kopplung und Abmelden -----------------------------------------------
  'pairing.pair_again': { text: 'Neu koppeln' },
  // Ein Geraet ohne Namen (`deviceLabel: null` unter /v3) in der Auswahl.
  'register.device_unnamed': { text: 'Kasse' },
  // Restzeit der PIN-Sperre unter dem Satz des Backends.
  'login.locked_seconds': { text: 'Noch {seconds} s gesperrt', placeholders: ['seconds'] },
  'logout.question': { text: 'Wirklich abmelden?' },
  'logout.keep_working': { text: 'Weiter arbeiten' },
  'device.unpair': { text: 'Gerät entkoppeln' },
  'connect.unpair_confirm': { text: 'Entkoppeln bestätigen', only: ['web'] },

  // --- Kassieren -------------------------------------------------------------
  // Dieselben Woerter im gewohnten Kassieren und je Zahlung bei „Getrennt“.
  'checkout.tip': { text: 'Trinkgeld' },
  'checkout.no_tip': { text: 'kein' },
  'checkout.custom_amount': { text: 'Eigener Betrag' },
  'checkout.exact': { text: 'passend' },
  'checkout.clear_tendered': { text: 'Gegeben löschen' },
  'checkout.still_missing': { text: 'Es fehlen noch' },
  'checkout.change': { text: 'Rückgeld' },
  // Schalter beim Trinkgeld (nur Mitarbeiter-Trinkgeld, reine Barzahlung), vorbelegt aus der Einstellung.
  'checkout.tip_kept': { text: 'gleich behalten' },
  'tip.kept_setting': { text: 'Bar-Trinkgeld behält der Mitarbeiter gleich' },
  // Stufe „Trinkgeld gleich behalten“ im Kundenbereich (business.tipKeptMode, Zuordnung TIP_KEPT_MODE_LABELS).
  'tip_kept_mode.title': { text: 'Trinkgeld gleich behalten' },
  'tip_kept_mode.always': { text: 'Immer gleich behalten' },
  'tip_kept_mode.never': { text: 'Immer offen lassen' },
  'tip_kept_mode.ask': { text: 'Jedes Mal fragen' },
  // Editor „Rabatt-Vorlagen“ im Kundenbereich und in den Einstellungen der Kasse (business.discountPresets).
  'discount_presets.title': { text: 'Rabatt-Vorlagen' },
  'discount_presets.name': { text: 'Name' },
  'discount_presets.percent': { text: 'Prozent' },
  'discount_presets.amount': { text: 'Betrag' },
  'discount_presets.add': { text: 'Vorlage hinzufügen' },
  'discount_presets.remove': { text: 'Entfernen' },
  'discount_presets.limit': { text: 'Höchstens 5 Vorlagen.' },
  // Block auf Z-Bon und Zwischenbericht (discountBlockLines): je Name „Name (n×)“, ab zwei Eintraegen die Summe.
  'shift_receipt.discounts': { text: 'Rabatte' },
  'shift_receipt.discounts_total': { text: 'Rabatte gesamt' },
  'shift_receipt.discount_line': { text: '{name} ({count}×)', placeholders: ['name', 'count'] },
  'shift_receipt.discount_unnamed': { text: 'Rabatt' },
  // Die Warte-Karte, solange der Betrag am Terminal steht; `{time}` ist der
  // Rest des Kartenfensters als m:ss.
  'card_payment.amount_on_terminal': { text: 'Betrag steht am Terminal' },
  'card_payment.present_card': { text: 'Karte vorhalten oder stecken · noch {time}', placeholders: ['time'] },

  // --- Abschluss -------------------------------------------------------------
  'completion.receipt_exists': { text: 'Beleg ist vorhanden – erledigen' },
  'completion.resolve': { text: 'Erledigen' },

  // --- Getrennt zahlen -----------------------------------------------------
  'split.button': { text: 'Getrennt' },
  'split.setting': { text: 'Getrennt zahlen' },
  'split.to_pay': { text: 'Zu zahlen' },
  'split.open': { text: 'Offen' },
  'split.payment': { text: 'Zahlung {n}', placeholders: ['n'] },
  'split.amount': { text: 'Betrag' },
  'split.remaining': { text: 'Rest' },
  // Letzte Runde bei Getrennt zahlen: der Rest samt Rundungscent;
  // `{cents}` traegt das Vorzeichen (`+1`, `−1`).
  'split.remaining_with_rounding': { text: 'Rest inkl. Rundung {amount} ({cents} ct)', placeholders: ['amount', 'cents'] },
  'split.divide': { text: '÷ {n}', placeholders: ['n'] },
  'split.tip_basis': { text: '% von diesem Betrag' },
  'split.of_which_tip': { text: 'davon Trinkgeld {amount}', placeholders: ['amount'] },
  'split.remove': { text: 'Entfernen' },
  'split.cancel_all': { text: 'Alles abbrechen' },
  'split.continue_checkout': { text: 'Weiter kassieren' },
  'split.reverse_all': { text: 'Alles zurückbuchen' },
  'split.reversed_on_terminal': { text: 'Am Terminal zurückgebucht' },
  'split.reverse_card': { text: 'Karte zurückbuchen' },
  'split.pair_again_anyway': { text: 'Trotzdem neu koppeln' },
  'split.keep_payment': { text: 'Zahlung behalten' },
  'split.clarify': { text: 'Klären' },
  // Titel und Kennungszeile des Klaeren-Fensters: der Betrag, den das Terminal
  // belasten sollte, und die ganze Kennung, mit der sich die Zahlung am
  // Terminal-Beleg wiederfinden laesst.
  'split.clarify_title': { text: 'Karte klären · {amount}', placeholders: ['amount'] },
  'split.clarify_reference': { text: 'Kennung {reference}', placeholders: ['reference'] },
  'split.reverse_again': { text: 'Erneut zurückbuchen' },
  // Fenster „Technik von hobex“ (Inhaber, 12.11.2026): die Nummer gross zum
  // Antippen, daneben die Erreichbarkeit (`HOBEX_SUPPORT.availability`, „24/7“),
  // und darunter, was hobex am Telefon fragt -- TID, Kennung, Betrag, Zeit,
  // Meldung, Anbindung, Adresse, Seriennummer. Nur was die Kasse kennt: eine
  // Zeile ohne Wert (etwa die Seriennummer, solange sie fehlt) steht nicht da.
  // Geoeffnet ueber `hobex_help.open`, nur bei einem Problem am Terminal oder
  // beim hobex-Host, nie bei Kasseneck Connect oder dem eigenen Netz.
  'hobex_help.open': { text: 'Technik von hobex …' },
  'hobex_help.title': { text: 'Technik von hobex' },
  'hobex_help.data': { text: 'Das fragt hobex' },
  'hobex_help.tid': { text: 'TID' },
  'hobex_help.reference': { text: 'Kennung der Zahlung' },
  'hobex_help.reversal_reference': { text: 'Kennung der Rückbuchung' },
  'hobex_help.amount': { text: 'Betrag' },
  'hobex_help.time': { text: 'Zeit' },
  'hobex_help.reason': { text: 'Meldung' },
  'hobex_help.protocol': { text: 'Anbindung' },
  'hobex_help.address': { text: 'Adresse' },
  'hobex_help.serial': { text: 'Seriennummer' },
  'hobex_help.copy': { text: 'Angaben kopieren' },
  'hobex_help.copied': { text: 'Kopiert' },
  'split.was_charged': { text: 'Wurde belastet – übernehmen' },
  'split.not_charged': { text: 'Nicht belastet – verwerfen' },
  // Aufteilung: eigener Schritt nach „Weiter“, Tabs „Nach Positionen“ / „Betrag“.
  'split.continue': { text: 'Weiter · {amount} getrennt', placeholders: ['amount'] },
  'split.allocation': { text: 'Aufteilung' },
  'split.back_to_payment_method': { text: 'Zurück zur Zahlart' },
  'split.tab_items': { text: 'Nach Positionen' },
  'split.tab_amount': { text: 'Betrag' },
  'split.one_less': { text: '{name}: ein Stück weniger', placeholders: ['name'] },
  'split.one_more': { text: '{name}: ein Stück mehr', placeholders: ['name'] },
  'split.tendered': { text: 'Gegeben (bar)' },
  'split.tendered_change': { text: 'Gegeben {tendered} · Rückgeld {change}', placeholders: ['tendered', 'change'] },
  // Je Zahlung oben die Zahlart (Umschalter, kein Ausloeser), unten EIN Knopf,
  // der diese Zahlung mit der gewaehlten Zahlart kassiert.
  'split.payment_method': { text: 'Zahlart' },
  'split.method_cash': { text: 'Bar' },
  'split.method_card': { text: 'Karte' },
  'split.add_payment': { text: 'Zahlung hinzufügen · {amount}', placeholders: ['amount'] },
  // Nach Positionen: die offenen Stueck als Kacheln in der grossen Flaeche;
  // Antippen nimmt ein Stueck in diese Zahlung, „−“ an der Kachel eines heraus.
  'split.open_items': { text: 'Offene Positionen' },
  'split.pieces_open': { text: '{n} offen', placeholders: ['n'] },
  'split.pieces_selected': { text: '{n} von {open}', placeholders: ['n', 'open'] },
  'split.nothing_selected': { text: 'Noch nichts angetippt' },
  'split.all_paid': { text: 'Alles bezahlt' },

  // --- Zahlarten in Listen (Kassieren, Storno, Belegliste) -----------------
  'payment_method.card': { text: 'Kartenzahlung' },
  'payment_method.cash': { text: 'Barzahlung' },
  // Beleg mit mehreren Zahlungen (`paymentMethod: 'mixed'` oder mehr als eine
  // Zahlung): weder Bar noch Karte, auch nicht im Filter.
  'payment_method.multiple': { text: 'Mehrere' },

  // --- Storno ----------------------------------------------------------------
  'cancellation.title': { text: 'Storno zu {receipt}', placeholders: ['receipt'] },

  // --- Storno eines Belegs mit mehreren Zahlungen --------------------------
  'cancellation.how_to_refund': { text: 'Wie zurückgeben?' },
  'cancellation.as_paid': { text: 'wie bezahlt' },
  'cancellation.cash': { text: 'bar' },
  'cancellation.all_cash': { text: 'Alles bar' },
  // Rueckgabe als Gutschein: dritte Wahl in „Wie zurückgeben?“ und die Bestaetigung.
  'cancellation.as_voucher': { text: 'Als Gutschein' },
  'cancellation.voucher_confirm': { text: '{amount} als Gutschein zurückgeben', placeholders: ['amount'] },
  'cancellation.payment_remainder': { text: 'Rest {amount}', placeholders: ['amount'] },
  // Die Zeile unter „wie bezahlt“: wohin das Geld zurückgeht, Teile mit „ · “ verbunden
  // („20,00 € auf die Karte · 4,90 € bar zurückgeben“). Karte = jede Zahlart mit Karte.
  'cancellation.refund_cash': { text: '{amount} bar', placeholders: ['amount'] },
  'cancellation.refund_card': { text: '{amount} auf die Karte', placeholders: ['amount'] },
  'cancellation.refund_other': { text: '{amount} per {method}', placeholders: ['amount', 'method'] },
  'cancellation.refund_line': { text: '{refunds} zurückgeben', placeholders: ['refunds'] },
  'cancellation.refund_line_estimated': { text: 'voraussichtlich {refunds} zurückgeben', placeholders: ['refunds'] },
  // Als Gutschein: das Mitarbeiter-Trinkgeld geht bar zurück, nie auf den Gutschein.
  'cancellation.voucher_tip_cash': { text: '{amount} Trinkgeld bar zurückgeben', placeholders: ['amount'] },
  'cancellation.difference': { text: 'Differenz' },

  // --- Storno mit oder ohne Trinkgeld (Schichten-Spec, Nachtrag 5) -----------
  // Erste Frage bei offenem Mitarbeiter-Trinkgeld, zweite nur bei Ja und Barrueckgabe.
  'cancellation.tip_refund_question': { text: 'Trinkgeld auch zurückgeben?' },
  'cancellation.tip_refund_yes': { text: 'Ja' },
  'cancellation.tip_refund_no': { text: 'Nein' },
  'cancellation.tip_source_question': { text: 'Woher kommt das Trinkgeld zurück?' },
  'cancellation.tip_source_drawer': { text: 'Aus der Lade' },
  'cancellation.tip_source_employee': { text: 'Gibt die Mitarbeiterin direkt' },
  // Trinkgeld-Zeile im Storno-Blatt nach „Nein“ (Fix-Runde 1, R63): sie geht nicht mit.
  'cancellation.tip_stays': { text: 'bleibt' },

  // --- Zeichensatz-Test (Testblatt und Drucker & Lade) ----------------------
  // Das Testblatt druckt diese Texte mit Ersatzbuchstaben (reines ASCII);
  // die Knoepfe stehen nur am Bildschirm. `{chars}` sind die fehlenden Zeichen einer Zeile
  // („€“ bzw. „€ §“), `{number}` die gewaehlte Zeile (1-6).
  'codetable.title': { text: 'ZEICHENSATZ-TEST' },
  // Genau 32 Spalten: mit Doppelpunkt waeren es 33, die Ueberschrift braeche um.
  'codetable.reference': { text: 'So sehen die Zeichen richtig aus' },
  'codetable.replacement_note': { text: '(Ersatz, passt immer)' },
  'codetable.missing': { text: 'ohne {chars}', placeholders: ['chars'] },
  'codetable.print_again': { text: 'Nochmal drucken' },
  'codetable.not_checked': { text: 'Umlaute noch nicht geprüft' },
  'codetable.check': { text: 'Umlaute prüfen' },
  'codetable.current': { text: 'Zeichensatz: Nr. {number}', placeholders: ['number'] },
  // Ueberschrift der Anleitung am Testblatt.
  'codetable.instruction_title': { text: 'Welche Zeile nehmen?' },
  // Nach der Wahl: das Beispiel so, wie es mit der Zeile am Bon steht
  // (`codeTablePreviewText`), dann uebernehmen oder zurueck zur Frage.
  'codetable.preview_title': { text: 'So steht es dann am Bon:' },
  'codetable.apply': { text: 'Übernehmen' },
  'codetable.other_row': { text: 'Andere Zeile' },

  // --- Lager an der Kasse ----------------------------------------------------
  // Standort-Auswahl, Bestandsanzeige und die Rueckgabe-Wahl beim Storno
  // (`RETURN_DISPOSITION_LABELS`). „aufgelöst“ steht an einem Standort mit
  // `active: false`, „verfügbar“ an der Menge `available`.
  'stock.all_articles': { text: 'Alle Artikel' },
  'stock.location': { text: 'Lager-Standort' },
  'stock.default_location': { text: 'Standard-Standort' },
  'stock.resolved': { text: 'aufgelöst' },
  'stock.where_to': { text: 'Wohin mit der Ware?' },
  'stock.available': { text: 'verfügbar' },
  'stock.return_restock': { text: 'Zurück ins Lager' },
  'stock.return_defective': { text: 'Defekt' },
  'stock.return_disposed': { text: 'Entsorgt' },

  // --- Inventur zählen ---------------------------------------------------------
  // Knöpfe und Zeilen des Zählbildschirms. „gesendet“ und „unbestätigt“ stehen
  // an den Zählungen der Sitzung (unbestätigt: unklarer Ausgang, „Erneut
  // senden“ mit demselben Schlüssel).
  'stocktake.title': { text: 'Inventur zählen' },
  'stocktake.quantity': { text: 'Menge' },
  'stocktake.defective': { text: 'Defekt' },
  'stocktake.count_zero': { text: '0 zählen' },
  'stocktake.next': { text: 'Weiter' },
  'stocktake.void': { text: 'Stornieren' },
  'stocktake.reason': { text: 'Grund' },
  'stocktake.progress': { text: '{counted} von {total} gezählt', placeholders: ['counted', 'total'] },
  'stocktake.serial_numbers': { text: 'Seriennummern erfassen' },
  'stocktake.recount': { text: 'Nachzählen' },
  'stocktake.resend': { text: 'Erneut senden' },
  'stocktake.my_counts': { text: 'Meine Zählungen' },
  'stocktake.sent': { text: 'gesendet' },
  'stocktake.unconfirmed': { text: 'unbestätigt' },
  'stocktake.voided': { text: 'storniert' },

  // --- Schicht und Kassenstand ---------------------------------------------
  'shift.open_title': { text: 'Schicht öffnen' },
  'shift.take_over': { text: 'Bestand übernehmen' },
  'shift.count': { text: 'Zählen' },
  'shift.by_denomination': { text: 'Nach Scheinen und Münzen' },
  'shift.close_title': { text: 'Schicht schließen' },
  'shift.cash_title': { text: 'Kassenstand' },
  'shift.x_report': { text: 'Zwischenbericht' },
  'shift.pay_out_tips': { text: 'Trinkgeld auszahlen' },
  'drawer.reason_title': { text: 'Warum öffnen Sie die Lade?' },
  'drawer.reason_change': { text: 'Wechselgeld' },
  'drawer.reason_check': { text: 'Kontrolle' },
  'drawer.reason_misoperation': { text: 'Fehlbedienung' },
  'drawer.reason_other': { text: 'Sonstiges' },
  // Je Art einer Kassenbewegung (auch die, die nur der Server vergibt: sie
  // stehen auf dem Z-Bon und im Bericht).
  'cash_movement.type_change_in': { text: 'Wechselgeld' },
  'cash_movement.type_cash_drop': { text: 'Abschöpfung' },
  'cash_movement.type_owner_deposit': { text: 'Privateinlage' },
  'cash_movement.type_owner_withdrawal': { text: 'Privatentnahme' },
  'cash_movement.type_tip_payout': { text: 'Trinkgeld-Auszahlung' },
  'cash_movement.type_other_in': { text: 'Sonstige Einzahlung' },
  'cash_movement.type_other_out': { text: 'Sonstige Auszahlung' },
  'cash_movement.type_transfer_out': { text: 'Umbuchung' },
  'cash_movement.type_transfer_in': { text: 'Umbuchung (Eingang)' },
  'cash_movement.type_expense': { text: 'Barausgabe' },
  'cash_movement.type_count_difference': { text: 'Zähldifferenz' },
  'cash_movement.type_handover_difference': { text: 'Übergabedifferenz' },
  'cash_movement.type_interim_difference': { text: 'Zwischenzählung' },
  // Bon der Schicht (Z-Bon, X-Bon, Kassenbewegung): Titel und Zeilennamen.
  'shift_receipt.title_close': { text: 'Schichtabschluss' },
  'shift_receipt.title_interim': { text: 'Zwischenbericht' },
  'shift_receipt.title_movement': { text: 'Kassenbewegung' },
  'shift_receipt.cashregister': { text: 'Kasse' },
  'shift_receipt.drawer': { text: 'Lade' },
  'shift_receipt.shift': { text: 'Schicht' },
  'shift_receipt.number': { text: 'Nr. {number}', placeholders: ['number'] },
  'shift_receipt.opened': { text: 'Geöffnet' },
  'shift_receipt.closed': { text: 'Geschlossen' },
  'shift_receipt.by': { text: 'von' },
  'shift_receipt.opening_float': { text: 'Startgeld' },
  'shift_receipt.opening_float_taken_over': { text: 'Startgeld übernommen' },
  'shift_receipt.cash_sales': { text: 'Bar aus Verkäufen' },
  'shift_receipt.cash_cancellations': { text: 'Bar aus Storno' },
  'shift_receipt.movements': { text: 'Bewegungen' },
  'shift_receipt.expected': { text: 'Soll' },
  'shift_receipt.counted': { text: 'Ist' },
  'shift_receipt.difference': { text: 'Differenz' },
  // Nach der Zählung beim Abschluss (1.11.0): „Entnommen“ (negativ) bzw. „Eingelegt“, dann was bleibt (fett).
  'shift_receipt.taken_out': { text: 'Entnommen' },
  'shift_receipt.put_in': { text: 'Eingelegt' },
  'shift_receipt.left_in_drawer': { text: 'Bleibt in der Kassenlade' },
  'shift_receipt.comment': { text: 'Kommentar' },
  'shift_receipt.non_cash': { text: 'Unbar (nur Information)' },
  'shift_receipt.receipts': { text: 'Belege' },
  'shift_receipt.cancellations': { text: 'Stornos' },
  'shift_receipt.openings_without_sale': { text: 'Öffnungen ohne Verkauf' },
  // Trinkgeld je Mitarbeiter (Bon, Kassenstand, Nachtrag 3): verdient = sofort + über Lohn, schon
  // genommen = in dieser Schicht aus der Lade ausgezahlt, offen = Anspruch an die Lade.
  'shift_receipt.tips': { text: 'Trinkgeld' },
  'shift_receipt.tip_earned': { text: 'verdient' },
  'shift_receipt.tip_retained': { text: 'über Lohn' },
  // „genommen“ statt „genommen“ (Inhaber, 12.11.2026): kuerzer, gleich auf Bon, Kassenstand, Panel und PDF.
  'shift_receipt.tip_paid_out': { text: 'genommen' },
  // Beim Storno von der Mitarbeiterin selbst zurueckgegeben (Fix-Runde 1, R62) – nie ein negatives „genommen“.
  'shift_receipt.tip_refunded_by_employee': { text: 'selbst zurückgegeben' },
  // Offene Forderung beim Oeffnen der Schicht (Fix-Runde 2, R64).
  'shift_receipt.tip_carried_over': { text: 'aus früheren Schichten' },
  'shift_receipt.tip_open': { text: 'offen' },
  'shift_receipt.movement_number': { text: 'Nr.' },
  'shift_receipt.type': { text: 'Art' },
  'shift_receipt.amount': { text: 'Betrag' },
  'shift_receipt.location': { text: 'Ort' },
  'shift_receipt.location_bank': { text: 'Bank' },
  'shift_receipt.location_safe': { text: 'Tresor' },
  'shift_receipt.recipient': { text: 'Empfänger' },
  'shift_receipt.target_drawer': { text: 'Ziel-Lade' },
  'shift_receipt.note': { text: 'Grund' },
  'shift_receipt.operator': { text: 'Bediener' },
  'shift_receipt.time': { text: 'Zeit' },
  'cash_movement.pay_in': { text: 'Einzahlung' },
  'cash_movement.pay_out': { text: 'Auszahlung' },
  'cash_movement.print': { text: 'Beleg drucken' },
  'drawer.recent_openings': { text: 'Letzte Öffnungen' },
  'drawer.reason_sale': { text: 'Verkauf' },
  'drawer.reason_cash_movement': { text: 'Kassenbewegung' },
  'drawer.reason_shift_open': { text: 'Schichtbeginn' },
  'drawer.reason_shift_close': { text: 'Schichtabschluss' },
  'drawer.reason_voucher_payout': { text: 'Gutschein-Auszahlung' },
  'shift.resend': { text: 'Erneut senden' },
  'shift.next': { text: 'Weiter' },
  'shift.print_close': { text: 'Schichtabschluss drucken' },
  'shift.print_again': { text: 'Nochmals drucken' },
  'shift.back_to_register': { text: 'Zur Kasse' },
  'shift.later': { text: 'Später senden' },
  'time.yesterday': { text: 'gestern' },
  // Kassenstand an der Kasse (1.11.0): Karte „In der Kassenlade sollten sein“, Schichtkopf, Zahlungen.
  'shift.drawer_should_have': { text: 'In der Kassenlade sollten sein' },
  'shift.drawer_named': { text: 'Kassenlade: {name}', placeholders: ['name'] },
  'shift.running_since': { text: 'läuft seit {duration}', placeholders: ['duration'] },
  'shift.since': { text: 'seit {time}', placeholders: ['time'] },
  'shift.collected_outside_drawer': { text: 'Kassiert, aber nicht in der Kassenlade' },
  'shift.non_cash_short': { text: 'unbar' },
  'shift.voucher_redeemed': { text: 'Gutschein eingelöst' },
  // Gutscheine an der Kasse (1.12.0)
  'voucher.button': { text: 'Gutschein' },
  'voucher.redeem': { text: 'Gutschein einlösen' },
  'voucher.sell': { text: 'Gutschein verkaufen' },
  'voucher.payout': { text: 'Gutschein auszahlen' },
  'voucher.code': { text: 'Code' },
  'voucher.scan': { text: 'Code scannen' },
  'voucher.check': { text: 'Prüfen' },
  'voucher.amount': { text: 'Betrag' },
  'voucher.balance': { text: 'Rest am Gutschein: {amount}', placeholders: ['amount'] },
  'voucher.remaining_quantity': { text: '{n} von {total} übrig', placeholders: ['n', 'total'] },
  'voucher.reason': { text: 'Grund' },
  'voucher.multi_purpose': { text: 'Mehrzweckgutschein' },
  'voucher.single_purpose': { text: 'Einzweckgutschein {rate} %', placeholders: ['rate'] },
  'voucher.service': { text: 'Leistungsgutschein' },
  'voucher.promotion': { text: 'Aktionsgutschein' },
  'voucher.payment_line': { text: 'Gutschein ····-{suffix}', placeholders: ['suffix'] },
  // Kassen-Navigation, Beleg-Fertig-Seite, Mengen (Paket-Nachzug Gutscheine).
  'quantity.at_most': { text: 'höchstens {count}', placeholders: ['count'] },
  'quantity.at_least': { text: 'mindestens {count}', placeholders: ['count'] },
  'receipts.number_hint': { text: 'Nummer' },
  'receipts.clear_number': { text: 'Nummer löschen' },
  'receipts.open': { text: 'Öffnen' },
  'receipt.creating': { text: 'Beleg wird erstellt …' },
  'receipt_done.sale_title': { text: 'Verkauf abgeschlossen' },
  'receipt_done.paid_by_voucher': { text: 'mit Gutschein bezahlt' },
  'receipt_done.payout_title': { text: 'Auszahlung abgeschlossen' },
  'receipt_done.paid_out': { text: '{method} ausgezahlt', placeholders: ['method'] },
  'voucher.code_mask': { text: '····-{suffix}', placeholders: ['suffix'] },
  'cart.close': { text: 'Warenkorb schließen' },
  'nav.register': { text: 'Kasse' },
  'nav.receipts': { text: 'Belege' },
  'nav.vouchers': { text: 'Gutscheine' },
  'nav.open_drawer': { text: 'Kassenlade öffnen' },
  'nav.stocktake': { text: 'Inventur' },
  'nav.dep': { text: 'Prüfung (DEP)' },
  // Seit 1.23.0 der Menüeintrag (Kasseninfo, Nullbeleg, DEP); `nav.dep` bleibt für ältere Kassen.
  'nav.inspection': { text: 'Prüfung' },
  'nav.settings': { text: 'Einstellungen' },
  'nav.settings_locked': { text: 'nur mit Chef-Anmeldung' },
  'nav.logout': { text: 'Abmelden' },
  'nav.logging_out': { text: 'Wird abgemeldet …' },
  'nav.fullscreen': { text: 'Vollbild' },
  'nav.fullscreen_exit': { text: 'Vollbild verlassen' },
  'voucher.covers_items': { text: 'Deckt: {items}', placeholders: ['items'] },
  'voucher.code_shown_once': { text: 'Code nur jetzt sichtbar: {code}', placeholders: ['code'] },
  'voucher.not_in_split': { text: 'Gutscheine gehen beim getrennten Kassieren nicht.' },
  'voucher.payout_not_possible': { text: 'Dieser Gutschein lässt sich nicht auszahlen.' },
  'voucher.add_article': { text: '{article} hinzufügen', placeholders: ['article'] },
  'voucher.payout_confirm': { text: '{amount} bar auszahlen?', placeholders: ['amount'] },
  'cancellation.voucher_back': { text: '{amount} geht zurück auf den Gutschein', placeholders: ['amount'] },
  // Gutscheine an der Kasse, Stufe 3 (1.13.0)
  'voucher.apply': { text: 'Übernehmen' },
  'voucher.redeemable_until': { text: 'einlösbar bis {date}', placeholders: ['date'] },
  'voucher.remove_line': { text: '{line} entfernen', placeholders: ['line'] },
  'voucher.reenter_code': { text: 'Code erneut eingeben' },
  'voucher.refundable_until': { text: 'rückzahlbar bis {date}', placeholders: ['date'] },
  'voucher.code_done': { text: 'Fertig' },
  'voucher.article': { text: 'Artikel' },
  'voucher.add': { text: 'Hinzufügen' },
  // Kachel mit Betrag und Referenz (1.26.0): Felder und Knoepfe des Eingabeblatts.
  'tile_prompt.amount': { text: 'Betrag' },
  'tile_prompt.quantity': { text: 'Menge' },
  'tile_prompt.apply': { text: 'Übernehmen' },
  'tile_prompt.apply_anyway': { text: 'Trotzdem übernehmen' },
  // Zusatz-Kacheln (1.27.0): Fenster nach dem Antippen einer Hauptleistung, Knopf an der Korbzeile.
  'addons.title': { text: 'Zusätze zu {name}', placeholders: ['name'] },
  'addons.none': { text: 'Ohne Zusatz' },
  'addons.done': { text: 'Fertig' },
  'addons.open': { text: 'Zusätze' },
  // Fremdgutscheine an der Kasse (1.31.0): Kachel-Blatt („Gutscheinnummer“, Betrag = tile_prompt.amount), Blatt
  // „Fremder Gutschein“ beim Einlösen und Auszahlen (Betrag = voucher.amount, Grund = voucher.reason), Korbzeile,
  // Umschalter im Blatt „Gutschein auszahlen“; Schalter im Kundenbereich und Haken im Artikel-Editor.
  'external_voucher.number': { text: 'Gutscheinnummer' },
  'external_voucher.title': { text: 'Fremder Gutschein' },
  'external_voucher.kind': { text: 'Art' },
  'external_voucher.kind_value': { text: 'Wertgutschein' },
  'external_voucher.kind_service': { text: 'Leistungsgutschein' },
  'external_voucher.rate': { text: 'Satz' },
  'external_voucher.taxed_with': { text: 'Versteuert mit (optional)' },
  'external_voucher.line_name': { text: 'Gutschein Nr. {number}', placeholders: ['number'] },
  'external_voucher.use_as_external': { text: 'Als fremden Gutschein' },
  'voucher.payout_source_own': { text: 'Kasseneck-Gutschein' },
  'voucher.payout_source_external': { text: 'Fremder Gutschein' },
  'settings.external_vouchers': { text: 'Fremde Gutscheine' },
  'settings.external_vouchers_off': { text: 'Aus' },
  'settings.external_vouchers_multi_purpose': { text: 'Nur Wertgutscheine' },
  'settings.external_vouchers_all': { text: 'Wert- und Leistungsgutscheine' },
  'article.external_voucher': { text: 'Verkauft einen fremden Gutschein' },
  // Gutschein-Sorten als Kacheln im Reiter „Gutscheine“ (Stufe 4b, 1.17.0): Kachel je Sorte mit Betrag
  // oder „Betrag eingeben“, darunter klein die Art; dazu die feste Kachel „Leistungsgutschein“.
  'voucher.tab': { text: 'Gutscheine' },
  'voucher.enter_amount': { text: 'Betrag eingeben' },
  'voucher.service_tile': { text: 'Leistungsgutschein' },
  'voucher.kind_multi_short': { text: 'Mehrzweck' },
  'voucher.kind_single_short': { text: 'Einzweck {rate} %', placeholders: ['rate'] },
  'shift.all_payments': { text: 'Alle Zahlungen dieser Schicht (bar + unbar)' },
  'shift.receipt_count_one': { text: '1 Beleg' },
  'shift.receipt_count_other': { text: '{count} Belege', placeholders: ['count'] },
  'shift.openings_without_sale_count': { text: '{count}× ohne Verkauf geöffnet', placeholders: ['count'] },
  'cash_movement.pay_in_short': { text: 'Einzahlen' },
  'cash_movement.pay_out_short': { text: 'Auszahlen' },
  'drawer.recent_openings_full': { text: 'Letzte Öffnungen der Kassenlade' },
  // Warnzeile an den Druck-Knöpfen: nur ein leiser Hinweis, die Knöpfe bleiben wie sie sind.
  'printer.warn_unreachable': { text: 'Drucker nicht erreichbar' },
  'printer.warn_none': { text: 'Kein Drucker eingerichtet' },
  'printer.check': { text: 'Prüfen' },
  'printer.set_up': { text: 'Einrichten' },
  // Dauer (Zusammensetzung: durationText): ab 1 Tag „1 Tag 3 Std.“, sonst „8 Std. 32 Min.“, unter 1 Std. nur Minuten.
  'duration.days_one': { text: '{days} Tag', placeholders: ['days'] },
  'duration.days_other': { text: '{days} Tage', placeholders: ['days'] },
  'duration.hours': { text: '{hours} Std.', placeholders: ['hours'] },
  'duration.minutes': { text: '{minutes} Min.', placeholders: ['minutes'] },
  // Trinkgeld auszahlen (eine Liste mit Kurzwahlen) und Trinkgeld-Karte im Kassenstand.
  'tip_payout.open_amount': { text: 'offen {amount}', placeholders: ['amount'] },
  'tip_payout.done': { text: 'erledigt' },
  // Kartentrinkgeld ueber die Kasse (1.37.0, Spec keck 2026-11-11 § 4.3): statt „erledigt“ bei 0 offen.
  'tip_payout.nothing_open': { text: 'nichts offen' },
  'tip_payout.for_all': { text: 'Für alle' },
  'tip_payout.nothing': { text: 'Nichts' },
  'tip_payout.all_open': { text: 'Alles Offene' },
  'tip_payout.title': { text: 'Auszahlung' },
  'tip_payout.persons_one': { text: '1 Person' },
  'tip_payout.persons_other': { text: '{count} Personen', placeholders: ['count'] },
  'tip_payout.pay_amount': { text: '{amount} auszahlen', placeholders: ['amount'] },
  'tip_payout.pay_out': { text: 'Auszahlen' },
  // Wechselgeld je Kassenlade (Einstellung) und Schritt „Geld entnehmen“ beim Schicht-Abschluss (1.11.0).
  'drawer.change_float': { text: 'Wechselgeld in der Lade' },
  'drawer.change_float_hint': { text: 'Bleibt nach jedem Schicht-Abschluss drin. Mehr wird beim Schließen entnommen.' },
  'drawer.change_float_empty_hint': { text: 'Leer = alles bleibt in der Lade (wie bisher).' },
  'shift.step_take_out': { text: 'Geld entnehmen' },
  'shift.left_in_drawer': { text: 'Bleibt in der Kassenlade' },
  'shift.change_float_next_shift': { text: 'Wechselgeld für die nächste Schicht' },
  'shift.take_out': { text: 'Entnehmen' },
  'shift.put_in': { text: 'Einlegen' },
  'shift.take_out_at_most': { text: 'höchstens {amount}', placeholders: ['amount'] },
  'shift.put_in_hint': { text: 'Geld in die Kassenlade legen' },
  'shift.after_count_tap_hint': { text: 'Tippe auf einen Betrag, um ihn zu ändern – der andere rechnet sich selbst.' },
  'shift.take_out_amount': { text: '{amount} entnehmen', placeholders: ['amount'] },
  'shift.put_in_amount': { text: '{amount} einlegen', placeholders: ['amount'] },
  'shift.continue_without_take_out': { text: 'Weiter ohne Entnahme' },
  'shift.print_envelope_receipt': { text: 'Bon fürs Kuvert drucken' },
  // Bedienhilfe (Vorlesetext) des Vorzeichen-Knopfs −/+ im Feld „Entnehmen“.
  'shift.toggle_take_out_put_in': { text: 'Entnehmen oder Einlegen umschalten' },
  'shift.put_in_change_float': { text: 'Wechselgeld einlegen' },
  'shift.taken_over_from_shift': { text: 'von Schicht {number} übernommen', placeholders: ['number'] },
  // Schritt „Geld entnehmen“: Zeile „Gezählt“, Knopf „Zurück“, letzter Schritt der Schrittleiste „Fertig“;
  // Bedienhilfe der Betragsknöpfe, `{title}` ist ihre Beschriftung („Bleibt in der Kassenlade“, „Entnehmen“ …).
  'shift.counted': { text: 'Gezählt' },
  'shift.back': { text: 'Zurück' },
  'shift.done': { text: 'Fertig' },
  'shift.edit_amount': { text: '{title} ändern', placeholders: ['title'] },
  // Kassenstand: Ein- und Auszahlungen der Schicht getrennt (Trinkgeld-Auszahlungen zählen zu den Auszahlungen);
  // Buchungsknopf im Blatt Einzahlung/Auszahlung mit Betrag.
  'shift.pay_ins': { text: 'Einzahlungen' },
  'shift.pay_outs': { text: 'Auszahlungen' },
  'cash_movement.pay_in_amount': { text: '{amount} einzahlen', placeholders: ['amount'] },
  'cash_movement.pay_out_amount': { text: '{amount} auszahlen', placeholders: ['amount'] },
  // Belegdetail: Zeile „Ausgaben“ (eingeklappt mit Anzahl), aufgeklappt je Eintrag die Art
  // (`receipt.output_<kind>`, Arten wie RECEIPT_OUTPUT_KINDS), dazu „fehlgeschlagen“ bei Ergebnis `failed`.
  // `{count}` beim Abruf ist die Zahl der Abrufe in dieser Stunde.
  'receipt.outputs_title': { text: 'Ausgaben' },
  'receipt.outputs_count': { text: '{count} Ausgaben', placeholders: ['count'] },
  'receipt.output_print': { text: 'Erstdruck' },
  'receipt.output_reprint': { text: 'Duplikat' },
  'receipt.output_email': { text: 'E-Mail' },
  'receipt.output_link_shared': { text: 'Link geteilt' },
  'receipt.output_pdf_shared': { text: 'PDF geteilt' },
  'receipt.output_opened': { text: 'Link geöffnet ({count}×)', placeholders: ['count'] },
  'receipt.output_failed': { text: 'fehlgeschlagen' },

  // --- Prüfung (DEP) bei der Kassennachschau -----------------------------------
  'dep.title': { text: 'Prüfung (DEP)' },
  'dep.period': { text: 'Zeitraum' },
  'dep.period_all': { text: 'Alles seit Inbetriebnahme' },
  'dep.period_year': { text: 'Ein Jahr' },
  'dep.period_quarter': { text: 'Ein Quartal' },
  'dep.period_custom': { text: 'Eigener Zeitraum' },
  'dep.from': { text: 'Von' },
  'dep.to': { text: 'Bis' },
  'dep.create': { text: 'Export erstellen' },
  'dep.receipts': { text: '{count} Belege', placeholders: ['count'] },
  'dep.save_usb': { text: 'Auf USB-Stick speichern' },
  'dep.handover_link': { text: 'Link für den Prüfer' },
  'dep.code': { text: 'Code' },
  'dep.valid_until': { text: 'gültig bis {date}', placeholders: ['date'] },
  'dep.revoke': { text: 'Widerrufen' },
  'dep.checksum': { text: 'Prüfsumme (SHA-256)' },
  'dep.new_export': { text: 'Neuer Export' },

  // --- Prüfung: Reiter mit Kasseninfo, Nullbeleg und DEP (1.23.0) ----------------
  // Die drei Teile der Seite „Prüfung“ in dieser Reihenfolge.
  'inspection.part_inspector': { text: 'Für den Prüfer' },
  'inspection.part_zero_receipt': { text: 'Nullbeleg' },
  'inspection.part_dep': { text: 'DEP' },
  // Die Kasseninfo (inspectionInfoRows, inspectionInfoLines): Überschriften,
  // Bezeichnungen und Werte; im Ausdruck stehen die Überschriften in Großschrift.
  'inspection.title': { text: 'Kasseninfo für die Prüfung' },
  'inspection.product_cloud': { text: '{name} – cloudbasierte Registrierkasse', placeholders: ['name'] },
  'inspection.manufacturer': { text: 'Hersteller' },
  'inspection.vat_id': { text: 'UID {number}', placeholders: ['number'] },
  'inspection.cashregister_id': { text: 'Kassen-ID' },
  'inspection.signature': { text: 'Signatur' },
  'inspection.unit': { text: 'Einheit' },
  'inspection.unit_a_trust': { text: 'Signaturkarte von A-Trust' },
  'inspection.unit_test_card': { text: 'Testkarte' },
  'inspection.hosting': { text: 'Betrieb' },
  'inspection.hosting_server': { text: 'im Signier-Server von Kasseneck' },
  'inspection.certificate': { text: 'Zertifikat' },
  'inspection.serial_hex': { text: 'Seriennr. {number} (hex)', placeholders: ['number'] },
  'inspection.serial_decimal': { text: '{number} (dezimal)', placeholders: ['number'] },
  'inspection.serial_decimal_only': { text: 'Seriennr. {number} (dezimal)', placeholders: ['number'] },
  'inspection.holder': { text: 'Inhaber' },
  'inspection.issuer': { text: 'Aussteller' },
  'inspection.valid': { text: 'Gültig' },
  'inspection.valid_range': { text: '{from} – {to}', placeholders: ['from', 'to'] },
  'inspection.valid_from': { text: 'ab {date}', placeholders: ['date'] },
  'inspection.valid_to': { text: 'bis {date}', placeholders: ['date'] },
  'inspection.check': { text: 'Abgleich' },
  'inspection.check_holder': { text: 'Inhaber mit A-Trust geprüft' },
  'inspection.status': { text: 'Status' },
  'inspection.status_active': { text: 'in Betrieb' },
  'inspection.status_outage': { text: 'ausgefallen' },
  'inspection.status_outage_since': { text: 'ausgefallen seit {date}, {time}', placeholders: ['date', 'time'] },
  'inspection.dep': { text: 'DEP' },
  'inspection.dep_online': { text: 'online gespeichert, jederzeit exportierbar (USB-Stick, Link)' },
  'inspection.closings': { text: 'Abschlüsse' },
  'inspection.closings_monthly_first': { text: 'Monatsbeleg automatisch am Monatsersten um {time}', placeholders: ['time'] },
  'inspection.closings_monthly_day': { text: 'Monatsbeleg automatisch am {n}. jedes Monats um {time}', placeholders: ['n', 'time'] },
  'inspection.closings_annual_december': { text: 'der Dezember-Beleg ist der Jahresbeleg' },
  'inspection.contact': { text: 'Kontakt' },
  'inspection.how_it_works': { text: 'So arbeitet die Kasse:' },
  'inspection.printed_at': { text: 'Gedruckt {date}, {time}', placeholders: ['date', 'time'] },
  // Drucken: Knopf im Teil „Für den Prüfer“ und die Antworten auf die Frage nach dem Nullbeleg.
  'inspection.print': { text: 'Kasseninfo drucken' },
  'inspection.print_yes': { text: 'Drucken' },
  'inspection.print_no': { text: 'Nein' },
  // Nullbeleg: Knopf (Reiter „Prüfung“ und Einstellungen der App) und Ergebnis
  // mit Belegnummer und Uhrzeit. Scheitert er, gilt `completion.zero_receipt_failed`.
  'zero_receipt.create': { text: 'Nullbeleg erstellen' },
  'zero_receipt.created': { text: 'Nullbeleg {number} erstellt, {time}', placeholders: ['number', 'time'] },
  // Prüfung kompakt (1.28.0): der Nullbeleg steht danach wie ein Verkaufsbeleg da (Titel, Rückweg);
  // das DEP fragt den Zeitraum erst nach „DEP exportieren“ in einem Fenster.
  'zero_receipt.done_title': { text: 'Nullbeleg erstellt' },
  'zero_receipt.back': { text: 'Zurück zur Prüfung' },
  'dep.export': { text: 'DEP exportieren' },
  'dep.period_question': { text: 'Welcher Zeitraum?' },
  'common.close': { text: 'Schließen' },

  // --- Schicht-Ablauf der Kasse (1.28.0) -----------------------------------
  // Schicht beginnen, laufen lassen, zaehlen, schliessen. `shift.close_title` und
  // `shift.running_since` gibt es seit 1.11.0 mit anderem Wortlaut und bleiben; die
  // Fassungen mit Nummer bzw. Lade heissen darum `shift.close_title_numbered` und
  // `shift.running_since_drawer`.
  'shift.state_closed': { text: 'Schicht geschlossen' },
  'shift.start_title': { text: 'Schicht beginnen' },
  'shift.band_closed': { text: 'Zum Verkaufen rechts die Schicht beginnen.' },
  'shift.band_closing': { text: 'Verkaufen ist pausiert, bis du fertig bist oder abbrichst.' },
  'shift.band_interim': { text: 'Verkaufen ist kurz pausiert.' },
  'shift.band_cash': { text: 'Zum Verkaufen auf die Kacheln tippen.' },
  // Trinkgeld, das als Umsatz zählt (steuerpflichtig, Inhaber) bzw. ohne Empfänger -- nur Anzeige im Kassenstand,
  // wortgleich mit dem Kundenbereich.
  'tip.revenue_title': { text: 'Als Umsatz erfasst' },
  'tip.revenue_badge': { text: 'Umsatz' },
  'tip.unassigned': { text: 'Nicht zugeordnet' },
  'shift.last_shift': { text: 'Letzte Schicht' },
  'shift.in_drawer_by_system': { text: 'Laut Kasse in der Lade' },
  'shift.take_over_amount': { text: '{amount} übernehmen', placeholders: ['amount'] },
  'shift.top_up': { text: 'Auffüllen' },
  'shift.missing': { text: 'fehlen {amount}', placeholders: ['amount'] },
  'shift.count_coins': { text: 'Scheine und Münzen zählen' },
  'shift.count_please': { text: 'Zähl bitte, was in der Lade liegt.' },
  'drawer.open_for_count': { text: 'Lade öffnen zum Zählen' },
  'drawer.open_for_tips': { text: 'Lade öffnen für Trinkgeld' },
  'drawer.open_for_take': { text: 'Lade öffnen zum Entnehmen' },
  'shift.close_title_numbered': { text: 'Schicht {number} schließen', placeholders: ['number'] },
  'shift.closed_title': { text: 'Schicht {number} geschlossen', placeholders: ['number'] },
  'shift.running_since_drawer': { text: '{drawer} · läuft seit {time} ({duration})', placeholders: ['drawer', 'time', 'duration'] },
  'shift.step_count': { text: 'Zählen' },
  'shift.step_tips': { text: 'Trinkgeld' },
  'shift.step_take': { text: 'Entnehmen' },
  'shift.step_done': { text: 'Fertig' },
  'shift.expected': { text: 'In der Lade sollten sein' },
  'shift.of_which_cash_tips': { text: 'davon Trinkgeld bar' },
  'shift.breakdown': { text: 'So setzt sich das zusammen' },
  'shift.part_opening': { text: 'Anfang' },
  'shift.part_cash_sales': { text: 'Barverkäufe' },
  'shift.part_cash_tips': { text: 'Trinkgeld bar' },
  'shift.part_cancellations': { text: 'Storno bar' },
  'shift.part_cash_in': { text: 'Einzahlungen' },
  'shift.part_cash_out': { text: 'Ausgaben aus der Lade' },
  'shift.part_interim': { text: 'Zwischenzählung' },
  'tip.who_takes_now': { text: 'Wer nimmt sein Trinkgeld jetzt bar mit?' },
  'tip.later_hint': { text: 'Was du nicht auszahlst, bleibt offen und wird in einer späteren Schicht ausgezahlt.' },
  'tip.later': { text: 'Später' },
  'tip.pay_out': { text: 'Auszahlen' },
  'tip.pay_out_amount': { text: '{amount} auszahlen', placeholders: ['amount'] },
  'shift.now_in_drawer': { text: 'Jetzt in der Lade' },
  'shift.interim_title': { text: 'Schicht {number} zählen', placeholders: ['number'] },
  'shift.interim_save': { text: 'Zählung festhalten' },
  'shift.opening_not_counted': { text: 'Anfang nicht gezählt' },
  // Titel der Hinweiskarte, wenn eine Schicht ohne Zaehlen uebernommen wurde (Unterzeile: `shift.taken_over_unchecked_by`).
  'shift.taken_over_unchecked_by': { text: '{name}, {time}', placeholders: ['name', 'time'] },
  'shift.taken_over_unchecked': { text: 'Schicht {number} wurde ohne Zählen übernommen', placeholders: ['number'] },
  // Trinkgeld-Arten beim Kassieren (Reiter) und ihre Hilfstexte.
  'tip.kind_percent': { text: 'Prozent' },
  'tip.kind_round_up': { text: 'Aufrunden' },
  'tip.kind_total': { text: 'Gesamt' },
  'tip.round_to': { text: 'auf {amount}', placeholders: ['amount'] },
  'tip.guest_pays_total': { text: 'Der Gast zahlt insgesamt' },
  'tip.remainder_is_tip': { text: 'Rest ist Trinkgeld' },
  'voucher.section': { text: 'Gutschein' },
  'voucher.code_placeholder': { text: 'Code eingeben oder scannen' },
  // Breite der rechten Spalte (Geraete-Einstellung `cartWidth`) und ihre Werte.
  'settings.cart_width': { text: 'Breite der rechten Spalte' },
  'settings.cart_width_narrow': { text: 'Schmal' },
  'settings.cart_width_medium': { text: 'Mittel' },
  'settings.cart_width_wide': { text: 'Breit' },
  // Z-Bon der Schicht: Zwischenzaehlung, Zaehlung vor der Auszahlung, Teile der Differenz.
  'shift_receipt.opening_not_counted': { text: 'Anfang übernommen, nicht gezählt' },
  'shift_receipt.interim_count': { text: 'Zwischenzählung' },
  'shift_receipt.counted_before_payout': { text: 'Gezählt' },
  'shift_receipt.difference_part_interim': { text: 'davon Zwischenzählung' },
  'shift_receipt.difference_part_closing': { text: 'davon Abschluss' },
  // Zahlungen auf Rechnungen (1.38.0): Summe der Zahlungsbelege der Schicht, nur Information (das Geld
  // steckt schon im Barumsatz bzw. unbar).
  'shift_receipt.invoice_payments': { text: 'Zahlungen auf Rechnungen' },
  // Nachtrag Schicht-Ablauf (1.28.0): Band-Titel ohne Punkt wie `shift.state_closed`.
  'shift.state_closing': { text: 'Schicht wird geschlossen' },
  'shift.state_interim': { text: 'Zwischenzählung' },
  'shift.tips_paid_out': { text: 'Trinkgeld ausgezahlt' },
  'shift.difference_none': { text: 'stimmt' },
  'shift.start_new': { text: 'Neue Schicht beginnen' },
  'shift.drawer_from_to': { text: '{drawer} · {from} bis {to}', placeholders: ['drawer', 'from', 'to'] },
  'shift.running_since_by': { text: '{drawer} · läuft seit {time} ({name})', placeholders: ['drawer', 'time', 'name'] },
  'shift.z_receipt_printed': { text: 'Z-Bon gedruckt' },
  'shift.count_now': { text: 'Jetzt zählen' },
  'shift.interim_entry': { text: 'Zwischenzählung' },
  'drawer.open': { text: 'Lade öffnen' },
  'time.today_at': { text: 'heute {time}', placeholders: ['time'] },
  'tip.summary_percent': { text: 'Trinkgeld {tip} ({percent} %)', placeholders: ['tip', 'percent'] },
  'settings.tip_kinds': { text: 'Trinkgeld-Arten' },
  'settings.tip_start': { text: 'Zuerst offen' },

  // --- Pfand und Leergut (1.32.0) ---
  'deposit.return': { text: 'Leergut' },
  'deposit.payout': { text: 'Bar auszahlen' },
  'deposit.offset': { text: 'Mit Einkauf verrechnen' },
  'deposit.unknown_code': { text: 'Welches Leergut ist das?' },
  'deposit.over_usual': { text: 'Mehr als üblich – trotzdem annehmen?' },
  'deposit.on_premises': { text: 'Vor Ort' },
  'deposit.takeaway': { text: 'Mitnahme' },
  'deposit.sum': { text: 'Summe Leergut' },

  // --- Nur Browser-Kasse: neue Fassung (1.37.0) ---
  // Der Knopf an `version.new_available`.
  'version.reload': { text: 'Neu laden', only: ['web'] },

  // --- Fassung der Kasse, leise Zeile in den Einstellungen und auf dem PIN-Schirm (beide Kassen) ---
  'version.line': { text: 'Fassung {version} · {time}', placeholders: ['version', 'time'] },

  // --- Kartentrinkgeld an der Kasse (Spec 2026-11-11-kartentrinkgeld, 1.37.0) ---
  // Die eine Zeile beim Kassieren je Zahlart und Ergebnis (tipStatus), mit Betrag; einzeilig.
  'tip.line_cash_kept': { text: '{amount} gleich einstecken', placeholders: ['amount'] },
  'tip.line_cash_open': { text: '{amount} in der Lade lassen', placeholders: ['amount'] },
  'tip.line_card_kept': { text: '{amount} aus der Lade nehmen', placeholders: ['amount'] },
  'tip.line_card_open': { text: '{amount} später auszahlen', placeholders: ['amount'] },
  // Fertig-Seite unter „Bezahlt“ (§ 4.5): Titel mit Name, dann der Betrag und was geschieht.
  'done.tip_title': { text: 'Trinkgeld {name}', placeholders: ['name'] },
  'done.tip_open': { text: '{amount} · offen {open}', placeholders: ['amount', 'open'] },
  'done.tip_open_loading': { text: '{amount}', placeholders: ['amount'] },
  'done.tip_kept_card': { text: '{amount} · jetzt aus der Lade nehmen', placeholders: ['amount'] },
  'done.tip_kept_cash': { text: '{amount} · gleich einstecken', placeholders: ['amount'] },
  'done.tip_pay_out': { text: 'Auszahlen' },
  // „Mein Trinkgeld“ im Namen-Menü (§ 4.6).
  'my_tips.title': { text: 'Mein Trinkgeld' },
  'my_tips.open_here': { text: 'Offen an dieser Lade' },
  'my_tips.open_total': { text: 'Offen (alle Laden)' },
  'my_tips.kept_today': { text: 'Heute genommen' },
  'my_tips.other_drawer': { text: '{drawer}: {amount} offen', placeholders: ['drawer', 'amount'] },
  'my_tips.nothing_open': { text: 'Nichts offen' },
  'my_tips.overpaid': { text: 'Zu viel ausgezahlt: {amount}, wird verrechnet', placeholders: ['amount'] },
  'my_tips.pay_out': { text: 'Auszahlen' },
  'my_tips.pay_out_amount': { text: 'Betrag' },
  // Storno-Blatt: eine Zeile je Mitarbeiter-Trinkgeld, in jedem Fall (§ 4.4).
  'cancellation.tip_deducted': { text: '{amount} Trinkgeld werden vom Guthaben von {name} abgezogen', placeholders: ['amount', 'name'] },
  // Z-/X-Bon und Kassenstand: Teil von „genommen“ (shiftTipLines) und Soll-Teil (expectedParts).
  // Kurz, damit die Zeile unter „genommen“ auf 80 mm in eine Zeile passt (eingerueckt, mit Betrag).
  'shift_receipt.tip_card_taken': { text: 'davon Kartentrinkgeld' },
  'shift.part_card_tips_taken': { text: 'Kartentrinkgeld bar genommen' },
  // Einstellungen (Kasse und Kundenbereich): Karten-Stufe (Werte wie TIP_KEPT_MODE_LABELS), Vorbelegung, Not-Aus.
  'tip_card_kept_mode.title': { text: 'Kartentrinkgeld gleich behalten' },
  'tip.card_kept_setting': { text: 'Kartentrinkgeld nimmt der Mitarbeiter gleich bar aus der Lade' },
  'tip_self_payout.title': { text: 'Mitarbeiter zahlen sich ihr Trinkgeld selbst aus' },
  // Anspruchs-Modus (F2, Kundenbereich; Werte TIP_CLAIM_SCOPES, Zuordnung TIP_CLAIM_SCOPE_LABELS).
  'tip_claim_scope.title': { text: 'Offenes Trinkgeld zählt' },
  'tip_claim_scope.per_drawer': { text: 'Je Kassenlade' },
  'tip_claim_scope.per_person': { text: 'Je Person (alle Kassenladen)' },

  // --- Geraete im Betrieb (1.39.0): Beschriftungen und Knoepfe ---------------------
  // Gelten fuer beide Kassen. Vorhandene Knoepfe werden wiederverwendet: `common.cancel` (Abbrechen), `nav.settings`
  // (Einstellungen), `printer.set_up` (Einrichten), `receipts.open` (Öffnen), `codetable.print_again` (Nochmal drucken),
  // `codetable.apply` (Übernehmen).
  'devices.title': { text: 'Geräte' },
  'devices.connect': { text: 'Connect' },
  'devices.printer': { text: 'Drucker' },
  'devices.terminal': { text: 'Terminal' },
  'devices.computer': { text: 'Rechner' },
  'devices.pairing': { text: 'Kopplung' },
  'devices.environment': { text: 'Umgebung' },
  'devices.live': { text: 'Live' },
  'devices.test_environment': { text: 'Testumgebung' },
  'devices.printer_ready': { text: 'Bondrucker bereit' },
  'devices.printer_missing': { text: 'Noch kein Bondrucker' },
  'devices.checking': { text: 'Wird geprüft …' },
  'devices.test_print_sent': { text: 'Testdruck gesendet' },
  'devices.terminal_ready': { text: 'Kartenterminal bereit' },
  'devices.terminal_found': { text: 'Terminal gefunden' },
  'devices.terminals_found': { text: '{n} Terminals gefunden', placeholders: ['n'] },
  'devices.printer_found': { text: 'Drucker gefunden' },
  'devices.printers_found': { text: '{n} Drucker gefunden', placeholders: ['n'] },
  'devices.no_printer_found': { text: 'Kein Drucker gefunden' },
  'devices.no_terminal_found': { text: 'Kein Terminal gefunden' },
  'devices.no_terminal_assigned': { text: 'Kein Terminal zugewiesen' },
  'devices.connected': { text: 'Verbunden' },
  'devices.connecting': { text: 'Wird verbunden …' },
  'devices.not_connected': { text: 'Nicht verbunden' },
  'devices.connect_missing': { text: 'Kasseneck Connect fehlt' },
  'devices.settings_applied': { text: '{width} – Einstellungen übernommen', placeholders: ['width'] },
  'devices.model_unknown': { text: 'Modell unbekannt' },
  'devices.paper_width_question': { text: 'Wie breit ist das Papier?' },
  'devices.line_wrapped': { text: 'Linie umgebrochen' },
  'devices.tid_of_this_register': { text: 'TID dieser Kasse' },
  'devices.tid_example': { text: 'z. B. 12345678' },
  'devices.hobex_terminal': { text: 'Hobex-Terminal' },
  'devices.tid_value': { text: 'TID {tid}', placeholders: ['tid'] },
  'devices.address_port': { text: '{ip} · Port {port}', placeholders: ['ip', 'port'] },
  'devices.paper_width': { text: 'Papierbreite' },
  'devices.cut': { text: 'Abschneiden' },
  'devices.code_page': { text: 'Zeichensatz' },
  'devices.qr_code': { text: 'QR-Code' },
  'devices.from_printer': { text: 'vom Drucker' },
  'devices.address': { text: 'Adresse' },
  'devices.test_page': { text: 'Testseite' },
  'devices.drawer': { text: 'Kassenlade' },
  'devices.drawer_opens_on_cash': { text: 'öffnet bei Barzahlung' },
  'devices.check_again': { text: 'Nochmal prüfen' },
  'devices.not_now': { text: 'Nicht jetzt' },
  'devices.change': { text: 'ändern' },
  'devices.advanced': { text: 'Erweitert' },
  'devices.search_again': { text: 'Neu suchen' },
  'devices.view': { text: 'Ansehen' },
  'devices.use_this': { text: 'Dieses verwenden' },
  'devices.how_it_works': { text: 'So geht’s' },
  'devices.update_after_payment': { text: 'Nach der Zahlung aktualisieren' },
  'devices.print': { text: 'Drucken' },
  'devices.save': { text: 'Speichern' },
  'devices.check': { text: 'prüfen' },
  'devices.none': { text: 'keiner' },
  'devices.search': { text: 'Suchen' },
  'devices.test_print_paper': { text: 'Testdruck auf Papier ({width}, {count} Zeichen)', placeholders: ['width', 'count'] },
  'devices.searching': { text: 'Sucht …' },
  'devices.yes': { text: 'ja' },
  'devices.no': { text: 'nein' },
  'terminal.change_in_panel': { text: 'Im Panel ändern' },
  'connect.pair': { text: 'Koppeln', only: ['web'] },
  'connect.unpair': { text: 'Entkoppeln', only: ['web'] },
  'connect.unpair_yes': { text: 'Ja, entkoppeln', only: ['web'] },
  // Schalter in den Geraete-Einstellungen: der Hinweis „Drucker antwortet nicht“ (`printer.no_status_answer`) an den Druckknoepfen.
  'printer.hint_setting': { text: 'Warnen, wenn der Drucker nicht antwortet' },
  'connect.code_prompt': { text: 'Kopplungs-Code aus Kasseneck Connect (6 Ziffern):', only: ['web'] },
  // Titel der Geraete-Einstellungen (Drucker, Terminal, Connect). Keine Erklaersaetze dazu (Spec Connect-Betrieb 2.1).
  'printer.section_title': { text: 'Drucker & Lade' },
  'connect.status_title': { text: 'Verbindung' },
  'connect.install_title': { text: 'Connect installieren' },
  'connect.name': { text: 'Kasseneck Connect' },
  'connect.switch_title': { text: 'Auf Kasseneck Connect umstellen' },
  'printer.use': { text: 'Bondrucker verwenden' },
  'printer.bluetooth_title': { text: 'Bluetooth-Drucker' },
  'printer.print_qr': { text: 'QR-Code drucken' },
  'printer.old_way_title': { text: 'Bisheriger Druckweg' },
  'printer.cut_title': { text: 'Papier abschneiden' },
  'printer.bon_texts_title': { text: 'Bon-Texte' },
  'printer.test_page_print': { text: 'Testseite drucken' },
  'printer.drawer_title': { text: 'Kassenlade am Drucker' },
  'printer.drawer_auto_title': { text: 'Lade öffnet von selbst' },
  'printer.drawer_open_now': { text: 'Lade jetzt öffnen' },
  'terminal.card_terminal': { text: 'Kartenterminal' },
  'terminal.tid_title': { text: 'Terminal-ID (TID)' },
  'terminal.search_title': { text: 'Terminal suchen' },
  'terminal.ip_title': { text: 'IP-Adresse' },
  'terminal.port_title': { text: 'Port' },
} as const satisfies Record<string, TextEntry>;

export type LabelKey = keyof typeof BESCHRIFTUNGEN_ROH;
export const LABELS: Record<LabelKey, TextEntry> = BESCHRIFTUNGEN_ROH;

/**
 * Rueckgabe beim Storno (`returnDisposition`): welche Beschriftung jede Wahl
 * traegt. Ein Objekt wie CANCELLATION_PAYMENT_ERROR_MESSAGES, keine Liste in
 * GROSSSCHRIFT (der Oberflaechen-Vertrag liest Listen als Enums ein); die
 * App liest die Zuordnung aus `fixtures/pos-texts.json`.
 */
export const RETURN_DISPOSITION_LABELS = {
  restock: 'stock.return_restock',
  defective: 'stock.return_defective',
  disposed: 'stock.return_disposed',
} as const satisfies Record<ReturnDisposition, LabelKey>;

/** Stufe „Trinkgeld gleich behalten“ (`business.tipKeptMode`) -> Beschriftung im Kundenbereich. */
export const TIP_KEPT_MODE_LABELS = {
  ask: 'tip_kept_mode.ask',
  always: 'tip_kept_mode.always',
  never: 'tip_kept_mode.never',
} as const satisfies Record<PosTipKeptMode, LabelKey>;

/**
 * Wo der offene Trinkgeld-Anspruch gefuehrt wird (`TIP_CLAIM_SCOPES`, Spec 2026-11-11-kartentrinkgeld F2) ->
 * Beschriftung im Kundenbereich.
 */
export const TIP_CLAIM_SCOPE_LABELS = {
  per_drawer: 'tip_claim_scope.per_drawer',
  per_person: 'tip_claim_scope.per_person',
} as const satisfies Record<TipClaimScope, LabelKey>;

/** Freigabe fuer Fremdgutscheine (`externalVouchers`) -> Beschriftung der Stufe im Kundenbereich. */
export const EXTERNAL_VOUCHERS_LABELS = {
  off: 'settings.external_vouchers_off',
  multi_purpose: 'settings.external_vouchers_multi_purpose',
  all: 'settings.external_vouchers_all',
} as const satisfies Record<PosExternalVouchers, LabelKey>;

/** Art eines fremden Gutscheins (Artikel, Blatt) -> Beschriftung: Wert- bzw. Leistungsgutschein. */
export const EXTERNAL_VOUCHER_KIND_LABELS = {
  multi_purpose: 'external_voucher.kind_value',
  single_purpose: 'external_voucher.kind_service',
} as const satisfies Record<ArticleExternalVoucher, LabelKey>;

/** Art einer Ausgabe -> Beschriftung (`receipt.output_<kind>`). */
const AUSGABE_BESCHRIFTUNG = {
  print: 'receipt.output_print',
  reprint: 'receipt.output_reprint',
  email: 'receipt.output_email',
  link_shared: 'receipt.output_link_shared',
  pdf_shared: 'receipt.output_pdf_shared',
  opened: 'receipt.output_opened',
} as const satisfies Record<ReceiptOutputKind, LabelKey>;

/**
 * Die Beschriftung der Art einer Ausgabe (Belegdetail, Zeile „Ausgaben“), nie
 * eine Ausnahme: `null` bei einer Art, die dieses Paket nicht kennt (neuerer
 * Server); `opened` ohne gueltige Anzahl (ganze Zahl ab 1) zaehlt als ein
 * Abruf. Nur die Art: „fehlgeschlagen“ (`receipt.output_failed`) setzt die
 * Kasse selbst dazu, wenn `result` `failed` ist.
 */
export function receiptOutputLabel(output: ReceiptOutput): string | null {
  const art: unknown = output?.kind;
  if (typeof art !== 'string' || !Object.prototype.hasOwnProperty.call(AUSGABE_BESCHRIFTUNG, art)) return null;
  const key = AUSGABE_BESCHRIFTUNG[art as ReceiptOutputKind];
  if (art !== 'opened') return labelText(key);
  const anzahl: unknown = output.count;
  return labelText(key, { count: typeof anzahl === 'number' && Number.isSafeInteger(anzahl) && anzahl >= 1 ? anzahl : 1 });
}

/** Die Beschriftung zum Schluessel, Platzhalter ersetzt; fehlt ein Wert, wirft es wie `messageText`. */
export function labelText(key: LabelKey, values: Record<string, string | number> = {}): string {
  return ersetze(`labelText(${key})`, LABELS[key].text, values);
}

function ersetze(wo: string, text: string, werte: Record<string, string | number>): string {
  return text.replace(/\{([a-z]+)\}/g, (_, name: string) => {
    const wert = werte[name];
    if (wert === undefined) throw new Error(`${wo}: Platzhalter {${name}} ohne Wert`);
    return String(wert);
  });
}

/** Der Satz zum Schluessel, Platzhalter ersetzt. Fehlt ein Wert, wirft es — ein `{status}` am Tresen waere schlimmer. */
export function messageText(key: MessageKey, values: Record<string, string | number> = {}): string {
  const eintrag: TextEntry = MESSAGES[key];
  return eintrag.text.replace(/\{([a-z]+)\}/g, (_, name: string) => {
    const wert = values[name];
    if (wert === undefined) throw new Error(`messageText(${key}): Platzhalter {${name}} ohne Wert`);
    return String(wert);
  });
}

/** Gilt der Satz auf dieser Seite? */
export function messageAppliesTo(key: MessageKey, surface: Surface): boolean {
  const eintrag: TextEntry = MESSAGES[key];
  return eintrag.only === undefined || eintrag.only.includes(surface);
}
