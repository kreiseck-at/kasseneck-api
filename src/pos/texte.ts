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
  'permissions.not_changeable': { text: 'Das darfst du nicht ändern – das Recht dafür vergibt der Inhaber im Panel.' },

  // --- Verkauf und Positionen ----------------------------------------------
  'cashregister.load_failed': { text: 'Die Kasse konnte nicht geladen werden.' },
  'articles.load_failed': { text: 'Die Artikel konnten nicht geladen werden.' },
  'articles.none_enabled': { text: 'Keine Artikel an dieser Kasse. Im Panel unter „Kacheln & Gruppen“ freischalten.' },
  'articles.none_found': { text: 'Keine Artikel gefunden.' },
  'articles.vat_rate_unknown': { text: '„{name}“ hat einen Steuersatz, den die Kasse nicht kennt.', placeholders: ['name'] },
  'item.amount_missing': { text: 'Bitte einen Betrag eingeben.' },
  'item.description_missing': { text: 'Bitte eine Bezeichnung eingeben – sie steht am Beleg.' },
  'discount.percent_invalid': { text: 'Bitte einen Prozentwert zwischen 0,1 und 100 eingeben.' },

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
  // der Bildschirm stellt die Frage daneben.
  'codetable.question': { text: 'Welche Zeile sieht auf dem Papier aus wie oben?' },
  'codetable.instruction': { text: 'Die Nummer der ersten Zeile, die genau wie oben aussieht, in der Kasse antippen.' },
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
  'connect.unpair_question': { text: 'Diesen Browser wirklich von Connect trennen? Der Bondruck geht dann nicht mehr.', only: ['web'] },

  // --- Einstellungen -------------------------------------------------------
  'settings.load_failed': { text: 'Die Einstellungen konnten nicht geladen werden.' },
  'settings.save_failed': { text: 'Die Einstellung konnte nicht gespeichert werden.' },
  'settings.not_loaded_yet': { text: 'Noch nicht geladen – bitte kurz warten oder neu anmelden.' },
  'settings.ip_invalid': { text: 'Keine gültige IP-Adresse (z. B. 192.168.1.50).' },
  'unpairing.failed': { text: 'Entkoppeln fehlgeschlagen.' },
  'logo.upload_failed': { text: 'Hochladen fehlgeschlagen.' },
  'logo.remove_failed': { text: 'Entfernen fehlgeschlagen.' },

  // --- Nur App -------------------------------------------------------------
  'app.not_in_browser': { text: 'Die Kassen-App läuft nicht im Browser – dafür gibt es kasse.kasseneck.at.', only: ['app'] },
  'app.open_in_browser': { text: 'Bitte im Browser öffnen: {target}', placeholders: ['target'], only: ['app'] },
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
 * wiederholen lassen: die sechs, deren Ausgang das Paket selbst als unklar
 * fuehrt (Beleg, auch Null- und Startbeleg ueber `createReceipt`, Storno,
 * FinanzOnline, die drei Geldwege), dazu der Druckjob (zweiter Bon) und die
 * Belegmail (zweite Mail). Ob die Anfrage vor dem Abriss schon draussen war,
 * sieht das Paket nicht (fetch wirft in beiden Faellen gleich); darum gilt
 * hier immer der vorsichtige Satz.
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
  'split.reverse_again': { text: 'Erneut zurückbuchen' },
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
  'cancellation.payment_remainder': { text: 'Rest {amount}', placeholders: ['amount'] },
  'cancellation.difference': { text: 'Differenz' },

  // --- Zeichensatz-Test (Testblatt und Drucker & Lade) ----------------------
  // Das Testblatt druckt diese Texte; sie bleiben reines ASCII bis auf die
  // Knoepfe am Bildschirm. `{chars}` sind die fehlenden Zeichen einer Zeile
  // („€“ bzw. „€ §“), `{number}` die gewaehlte Zeile (1-6).
  'codetable.title': { text: 'ZEICHENSATZ-TEST' },
  'codetable.reference': { text: 'So muss jede Zeile aussehen:' },
  'codetable.replacement_note': { text: '(Ersatz, passt immer)' },
  'codetable.missing': { text: 'ohne {chars}', placeholders: ['chars'] },
  'codetable.print_again': { text: 'Nochmal drucken' },
  'codetable.not_checked': { text: 'Umlaute noch nicht geprüft' },
  'codetable.check': { text: 'Umlaute prüfen' },
  'codetable.current': { text: 'Zeichensatz: Nr. {number}', placeholders: ['number'] },
} as const satisfies Record<string, TextEntry>;

export type LabelKey = keyof typeof BESCHRIFTUNGEN_ROH;
export const LABELS: Record<LabelKey, TextEntry> = BESCHRIFTUNGEN_ROH;

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
