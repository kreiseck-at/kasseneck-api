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
 * Sinn aendert, legt einen neuen an. `nur` nennt die Seite, wenn ein Satz nur
 * auf einer Plattform vorkommen kann.
 *
 * Die Schluessel sind seit 1.0 englisch, die Texte bleiben deutsch. Welcher
 * Schluessel frueher wie hiess, steht in `fixtures/texte-umbenennung.json`.
 */

import type { ReceiptEmailErrorCode } from '../models/receipt-email.js';

export type Seite = 'web' | 'app';

export interface Meldung {
  readonly text: string;
  /** Erlaubte Platzhalter `{name}`; muessen exakt die im Text sein. */
  readonly platzhalter?: readonly string[];
  /** Fehlt es, gilt der Satz fuer beide Seiten. */
  readonly nur?: readonly Seite[];
}

const MELDUNGEN_ROH = {
  // --- Transport -----------------------------------------------------------
  'network.no_connection': { text: 'Keine Verbindung zum Server. Bitte die Internetverbindung prüfen und erneut versuchen.' },
  'network.timeout': { text: 'Der Server antwortet nicht. Bitte die Internetverbindung prüfen und erneut versuchen.' },
  'server.unexpected': { text: 'Der Server hat unerwartet geantwortet (HTTP {status}). Bitte den Support verständigen.', platzhalter: ['status'] },

  // --- Kopplung ------------------------------------------------------------
  'pairing.code_missing': { text: 'Bitte den Kopplungs-Code eingeben.' },
  'pairing.failed': { text: 'Die Kopplung ist fehlgeschlagen. Bitte erneut versuchen.' },
  'pairing.incomplete': { text: 'Die Kopplung ist unvollständig zurückgekommen. Bitte im Panel einen neuen Code erzeugen und noch einmal versuchen.' },
  'device.browser_storage': { text: 'Dieses Gerät konnte nicht gespeichert werden – der Browser-Speicher steht nicht zur Verfügung. Bitte den privaten Modus verlassen.', nur: ['web'] },

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
  'session.logging_out': { text: 'Kasse meldet in {sekunden} s ab – Bildschirm berühren, um weiterzuarbeiten.', platzhalter: ['sekunden'] },
  // Wer die Abmelden-Taste ein zweites Mal drueckt, beendet die Schicht –
  // der Satz steht in der Rueckfrage, bevor es so weit ist.
  'logout.press_again': { text: 'Noch einmal drücken beendet die Schicht an dieser Kasse.' },
  'permissions.not_changeable': { text: 'Das darfst du nicht ändern – das Recht dafür vergibt der Inhaber im Panel.' },

  // --- Verkauf und Positionen ----------------------------------------------
  'cashregister.load_failed': { text: 'Die Kasse konnte nicht geladen werden.' },
  'articles.load_failed': { text: 'Die Artikel konnten nicht geladen werden.' },
  'articles.none_enabled': { text: 'Keine Artikel an dieser Kasse. Im Panel unter „Kacheln & Gruppen“ freischalten.' },
  'articles.none_found': { text: 'Keine Artikel gefunden.' },
  'articles.vat_rate_unknown': { text: '„{name}“ hat einen Steuersatz, den die Kasse nicht kennt.', platzhalter: ['name'] },
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
  'checkout.locked': { text: 'Kassieren gesperrt: {grund}', platzhalter: ['grund'] },
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
  'completion.resolve_question': { text: 'Nur erledigen, wenn der Beleg in der Belegliste steht – sonst bleiben {betrag} ohne Beleg. Bitte zuerst unter „Belege“ nachsehen.', platzhalter: ['betrag'] },

  // --- Kartenzahlung -------------------------------------------------------
  'card_payment.not_possible': { text: 'Kartenzahlung nicht möglich.' },
  'card_payment.not_completed': { text: 'Die Kartenzahlung ist nicht zustande gekommen.' },
  'card_payment.not_started': { text: 'Kartenzahlung nicht gestartet: {grund}', platzhalter: ['grund'] },
  'card_payment.unknown': { text: 'Unklar, ob die Kartenzahlung durchgegangen ist – die Verbindung zum Terminal riss ab. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird: die Karte kann belastet sein.' },
  // Die Kennung ist der einzige Anker, um die Zahlung am Terminal-Beleg wiederzufinden – liegt sie vor, gilt dieser Satz statt card_payment.unknown.
  'card_payment.unknown_with_id': { text: 'Unklar, ob die Kartenzahlung durchgegangen ist – die Verbindung zum Terminal riss ab. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird: die Karte kann belastet sein. Kennung der Zahlung: {kennung}.', platzhalter: ['kennung'] },
  'card_payment.waiting_for_terminal': { text: 'Bitte am Terminal fortfahren …' },
  // Das Kartenfenster des Terminals ist abgelaufen: es bricht selbst ab, die
  // Kasse muss nichts tun.
  'card_payment.terminal_cancelling': { text: 'Das Terminal bricht gleich von selbst ab …' },
  // Ein geglücktes Kartenergebnis ohne Beleg ist der teuerste Zustand am Tresen:
  // wer hier erneut kassiert, belastet die Karte ein zweites Mal. Beide Sätze
  // nennen deshalb Betrag UND Kennung — nur damit findet der Kassier die Zahlung
  // am Terminal-Beleg wieder — und keiner rät zum Wiederholen.
  'card_payment.card_charged_receipt_open': { text: 'Die Karte ist bereits mit {betrag} belastet (Kennung {kennung}) – der Beleg dazu fehlt noch. Bitte jetzt den Beleg erstellen und nicht erneut kassieren.', platzhalter: ['betrag', 'kennung'] },
  'card_payment.card_charged_cart_changed': { text: 'Es gibt eine gebuchte Kartenzahlung über {betrag} (Kennung {kennung}), aber der Korb hat sich seither geändert. Bitte zuerst entscheiden: den Beleg zur gebuchten Zahlung erstellen oder die Zahlung am Terminal stornieren und hier verwerfen.', platzhalter: ['betrag', 'kennung'] },
  'card_payment.connect_not_connected': { text: 'Kartenzahlung nicht möglich: Kasseneck Connect ist nicht verbunden – Einstellungen → Kasseneck Connect.', nur: ['web'] },
  // Solange die Karte belastet ist, darf am Korb nichts mehr veraendert werden –
  // sonst passt der Beleg nicht mehr zum Betrag, der schon abgebucht ist.
  'card_payment.cart_locked_card_charged': { text: 'Die Karte ist bereits belastet – Warenkorb, Rabatt und Trinkgeld bleiben gesperrt, bis der Beleg entsteht oder die Karte zurückerstattet ist.' },
  // Entkoppeln trennt das Geraet vom Konto, nicht die gebuchte Kartenzahlung
  // vom Terminal – die muss weiterhin von Hand storniert werden.
  'card_payment.unpair_card_charged': { text: 'Auf diesem Gerät liegt noch eine gebuchte Kartenzahlung ohne Beleg – sie muss von Hand am Terminal zurückerstattet werden (Betrag siehe unten).' },
  'terminal.none_found': { text: 'Kein Hobex-Terminal gefunden – ist es eingeschaltet und im selben Netz wie dieser Rechner?', nur: ['web'] },
  'terminal.not_ready': { text: 'Terminal antwortet, ist aber nicht betriebsbereit: {antwort} – TID prüfen.', platzhalter: ['antwort'], nur: ['web'] },
  'gptom.app_missing': { text: 'Die GP-Tom-App ist auf diesem Gerät nicht da.', nur: ['app'] },
  'gptom.search_failed': { text: 'GP Tom: Suche nach der App fehlgeschlagen: {grund}', platzhalter: ['grund'], nur: ['app'] },
  'gptom.payment_failed': { text: 'GP Tom: Zahlung fehlgeschlagen: {grund}', platzhalter: ['grund'], nur: ['app'] },
  'gptom.terminal_not_responding': { text: 'Das Terminal hat nicht geantwortet: {grund}', platzhalter: ['grund'], nur: ['app'] },
  'gptom.payment_not_completed': { text: 'Die Zahlung wurde nicht abgeschlossen ({code}).', platzhalter: ['code'], nur: ['app'] },
  // Abgelehnt heißt: das Terminal hat entschieden, es ist sicher nichts gebucht.
  // Der Code ist die einzige Handhabe, mit der der Inhaber bei GP nachfragen kann —
  // liegt einer vor, gilt die Fassung mit Code.
  'gptom.declined': { text: 'Das Terminal hat die Zahlung abgelehnt.', nur: ['app'] },
  'gptom.declined_with_code': { text: 'Das Terminal hat die Zahlung abgelehnt ({code}).', platzhalter: ['code'], nur: ['app'] },
  'gptom.not_opened': { text: 'GP Tom ließ sich nicht öffnen – bitte die GP-Tom-App prüfen und erneut versuchen.', nur: ['app'] },
  // Frist abgelaufen ist kein Abbruch: die Karte kann belastet sein, nur die
  // Antwort blieb aus. Deshalb derselbe Ton wie card_payment.unknown.
  'gptom.timeout': { text: 'Das Terminal hat in der Frist nicht geantwortet – die Karte kann belastet sein. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird.', nur: ['app'] },
  'gptom.timeout_with_id': { text: 'Das Terminal hat in der Frist nicht geantwortet – die Karte kann belastet sein. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird. Kennung der Zahlung: {kennung}.', platzhalter: ['kennung'], nur: ['app'] },

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
  // Code welchen Satz bekommt, steht in STORNO_ZAHLUNG_FEHLER.
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
  'split.amount_over_open': { text: 'Der Betrag ist höher als offen – höchstens {betrag}.', platzhalter: ['betrag'] },
  'split.tip_over_amount': { text: 'Das Trinkgeld ist höher als der Betrag dieser Zahlung.' },
  'split.tendered_too_little': { text: 'Gegeben ist weniger als der Betrag dieser Zahlung.' },
  'split.still_open': { text: 'Es sind noch {betrag} offen – abschließen geht erst, wenn alles kassiert ist.', platzhalter: ['betrag'] },
  'split.sum_mismatch': { text: 'Die Zahlungen ergeben nicht den Betrag des Belegs – bitte die Liste prüfen.' },
  'split.cart_locked': { text: 'Der Warenkorb ist gesperrt, solange Zahlungen kassiert sind – erst abschließen oder die Zahlungen entfernen.' },
  'split.switch_locked': { text: 'Zurück zu Bar oder Karte geht erst, wenn keine Zahlung mehr kassiert ist.' },
  'split.return_cash': { text: 'Bitte {betrag} Bargeld an den Gast zurückgeben.', platzhalter: ['betrag'] },
  'split.card_reverse_running': { text: 'Die Kartenzahlung über {betrag} wird am Terminal zurückgebucht …', platzhalter: ['betrag'] },
  'split.card_reversed': { text: 'Die Kartenzahlung über {betrag} ist am Terminal zurückgebucht.', platzhalter: ['betrag'] },
  'split.card_reverse_failed': { text: 'Die Kartenzahlung über {betrag} (Kennung {kennung}) ließ sich nicht zurückbuchen – sie bleibt in der Liste. Bitte am Terminal-Beleg nachsehen und erneut versuchen.', platzhalter: ['betrag', 'kennung'] },
  'split.card_reverse_unknown': { text: 'Unklar, ob die Rückbuchung über {betrag} (Kennung {kennung}) durchgegangen ist – die Zahlung bleibt in der Liste. Bitte am Terminal-Beleg nachsehen, BEVOR erneut zurückgebucht wird.', platzhalter: ['betrag', 'kennung'] },
  // Das Terminal meldet eine Gutschrift, die hier noch als offene Ruecknahme
  // steht – ein zweites Zurueckbuchen waere die doppelte Rueckgabe.
  'split.card_already_reversed': { text: 'Das Terminal meldet, dass die Kartenzahlung über {betrag} bereits gutgeschrieben wurde (Kennung {kennung}) – bitte am Terminal-Beleg prüfen und nicht erneut zurückbuchen.', platzhalter: ['betrag', 'kennung'] },
  'split.external_reverse': { text: 'Diese Karte ist nicht an die Kasse angebunden. Bitte {betrag} jetzt am Terminal zurückbuchen und danach bestätigen.', platzhalter: ['betrag'] },
  'split.session_open': { text: 'Eine getrennte Zahlung ist nicht abgeschlossen, {betrag} sind schon kassiert. Bitte weiter kassieren oder alles zurückbuchen.', platzhalter: ['betrag'] },
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
  'receipt.share_text': { text: 'Beleg {nummer} von {betrieb} über {betrag}: {link}', platzhalter: ['betrieb', 'nummer', 'betrag', 'link'] },
  // Belege aus dem Altbestand tragen keine `fullReceiptId`; ohne sie gibt es
  // keine Belegseite. Der Satz nennt den Grund, sonst sucht der Kassier den
  // Fehler bei sich und versucht es ein zweites Mal.
  'receipt.not_shareable': { text: 'Für diesen Beleg gibt es keinen Link – er stammt aus einer älteren Kasse.' },
  // Ein Testbeleg hat eine Belegseite, ist aber steuerlich nichts wert. Wer
  // den Link weitergibt, muss das vorher lesen, nicht hinterher.
  'receipt.test_hint_share': { text: 'Test-Umgebung – der Beleg ist steuerlich nicht gültig.' },
  'receipt.mail_sent': { text: 'Der Beleg wurde an {an} gesendet.', platzhalter: ['an'] },
  'receipt.mail_address_invalid': { text: 'Diese E-Mail-Adresse ist nicht gültig.' },
  'receipt.mail_too_often': { text: 'Dieser Beleg wurde schon oft gesendet – bitte später noch einmal.' },
  'receipt.mail_failed': { text: 'Der Beleg konnte nicht gesendet werden. Bitte noch einmal versuchen.' },
  // Bewusst nicht derselbe Satz wie `receipt.not_found`: dort scheitert das
  // Oeffnen, hier das Senden. Der Kassier steht vor einem Adressfeld und muss
  // lesen, dass nichts hinausgegangen ist.
  'receipt.mail_not_found': { text: 'Dieser Beleg wurde nicht gefunden – er konnte nicht gesendet werden.' },

  // --- Druck ---------------------------------------------------------------
  'print.failed': { text: 'Der Ausdruck ist fehlgeschlagen.' },
  'print.not_possible': { text: 'Druck nicht möglich: {grund}', platzhalter: ['grund'] },
  'print.test_print_failed': { text: 'Der Testdruck ist fehlgeschlagen.' },
  'print.test_print_not_possible': { text: 'Der Testdruck ist fehlgeschlagen: {grund}', platzhalter: ['grund'] },
  'print.no_printer': { text: 'Kein Bondrucker eingerichtet – in den Einstellungen unter Drucker & Lade.' },
  'print.printer_unreachable': { text: 'Drucker nicht erreichbar.' },
  'print.job_expired': { text: 'Drucker hat den Beleg nicht abgeholt (abgelaufen).', nur: ['web'] },
  'print.no_printer_found': { text: 'Kein Drucker gefunden – ist er eingeschaltet und im selben Netz wie dieser Rechner?', nur: ['web'] },
  'print.chrome_only': { text: '{weg}-Druck geht nur in Chrome oder Edge (Windows, Mac, Android) – nicht in Safari und nicht am iPad.', platzhalter: ['weg'], nur: ['web'] },
  'print.no_printer_for_channel': { text: 'Kein {weg}-Drucker verbunden – „{weg}-Drucker verbinden“ und den Drucker im Dialog wählen.', platzhalter: ['weg'], nur: ['web'] },
  // Der Drucker-Wizard: suchen, verbinden, Testdruck, QR-Probe, erst dann
  // speichern. Derselbe Ablauf in beiden Kassen — deshalb hat kein Satz ein
  // `nur`, obwohl der Weg zum Drucker verschieden ist (Bluetooth in der App,
  // Web Bluetooth im Browser). Was der Chef liest, ist beidesmal dasselbe.
  'print.wizard_connect': { text: 'Verbinde mit {name} …', platzhalter: ['name'] },
  'print.wizard_test_print_question': { text: 'Ist der Testdruck gekommen?' },
  'print.wizard_qr_question': { text: 'Welcher QR-Code ist sauber gedruckt?' },
  // Kein Modus druckt einen lesbaren QR-Code: gespeichert wird trotzdem (mit
  // Raster als Vorgabe), aber der Chef muss wissen, dass der QR-Code dann vom
  // Bildschirm gelesen werden muss — nach RKSV gehoert er an den Beleg.
  'print.wizard_qr_none_hint': { text: 'Kein QR-Code kam sauber – der Beleg zeigt den QR-Code dann am Bildschirm.' },
  'print.wizard_nothing_arrived': { text: 'Nichts gekommen? Drucker an, Papier drin, richtiges Gerät gewählt?' },
  'print.wizard_saved': { text: '{name} ist eingerichtet.', platzhalter: ['name'] },
  // Abbrechen an jeder Stelle: nichts gespeichert. Der Satz sagt genau das,
  // damit niemand einen halb eingerichteten Drucker vermutet.
  'print.wizard_cancelled': { text: 'Nichts gespeichert.' },
  'bluetooth.off': { text: 'Bluetooth ist ausgeschaltet. Bitte einschalten und erneut suchen.', nur: ['app'] },
  'bluetooth.permission_missing': { text: 'Bitte die Freigabe in den Geräte-Einstellungen erteilen.', nur: ['app'] },
  'bluetooth.search_failed': { text: 'Die Suche ist fehlgeschlagen: {grund}', platzhalter: ['grund'], nur: ['app'] },

  // --- Kasseneck Connect (nur Browser) -------------------------------------
  'connect.not_responding': { text: 'Kasseneck Connect antwortet nicht – läuft das Programm auf diesem Rechner?', nur: ['web'] },
  'connect.code_expired': { text: 'Der Kopplungs-Code ist abgelaufen – im Agent einen neuen erzeugen („kasseneck-connect pair“).', nur: ['web'] },
  'connect.too_many_attempts': { text: 'Zu viele Fehlversuche – eine Minute warten und noch einmal versuchen.', nur: ['web'] },
  'connect.printer_not_responding': { text: 'Der Drucker antwortet nicht – Strom, Netzwerk und IP prüfen.', nur: ['web'] },
  'connect.not_paired': { text: 'Diese Kasse ist mit Kasseneck Connect nicht gekoppelt – in den Einstellungen „Koppeln“ drücken.', nur: ['web'] },
  'connect.printer_unknown': { text: 'Diesen Drucker kennt Kasseneck Connect nicht (mehr) – bitte neu suchen.', nur: ['web'] },
  'connect.origin_not_allowed': { text: 'Kasseneck Connect nimmt von dieser Adresse nichts an (Ursprung nicht freigegeben).', nur: ['web'] },
  'connect.not_installed': { text: 'Kasseneck Connect nicht gefunden – bitte installieren.', nur: ['web'] },
  'connect.unpair_question': { text: 'Diesen Browser wirklich von Connect trennen? Der Bondruck geht dann nicht mehr.', nur: ['web'] },

  // --- Einstellungen -------------------------------------------------------
  'settings.load_failed': { text: 'Die Einstellungen konnten nicht geladen werden.' },
  'settings.save_failed': { text: 'Die Einstellung konnte nicht gespeichert werden.' },
  'settings.not_loaded_yet': { text: 'Noch nicht geladen – bitte kurz warten oder neu anmelden.' },
  'settings.ip_invalid': { text: 'Keine gültige IP-Adresse (z. B. 192.168.1.50).' },
  'unpairing.failed': { text: 'Entkoppeln fehlgeschlagen.' },
  'logo.upload_failed': { text: 'Hochladen fehlgeschlagen.' },
  'logo.remove_failed': { text: 'Entfernen fehlgeschlagen.' },

  // --- Nur App -------------------------------------------------------------
  'app.not_in_browser': { text: 'Die Kassen-App läuft nicht im Browser – dafür gibt es kasse.kasseneck.at.', nur: ['app'] },
  'app.open_in_browser': { text: 'Bitte im Browser öffnen: {ziel}', platzhalter: ['ziel'], nur: ['app'] },
} as const satisfies Record<string, Meldung>;

export type MeldungsSchluessel = keyof typeof MELDUNGEN_ROH;

// Auf den gemeinsamen Typ gebracht: `Object.entries(MELDUNGEN)` liefert sonst
// pro Schluessel den engsten Literaltyp, und `platzhalter`/`nur` waeren nur
// auf manchen Zweigen der Vereinigung vorhanden.
export const MELDUNGEN: Record<MeldungsSchluessel, Meldung> = MELDUNGEN_ROH;

/**
 * In welcher Reihenfolge ein Fehler eingeordnet wird — auf beiden Seiten
 * dieselbe. Die Arten:
 *   api        — HTTP 200, `status:'error'`: der Satz des Backends, woertlich
 *   klartext   — schon fuer den Bildschirm geschrieben: sein eigener Text
 *   zeitablauf — die Frist lief ab, die Anfrage war draussen
 *   netz       — keine Verbindung zustande gekommen oder abgerissen
 *   unerwartet — der Server hat geantwortet, aber nicht wie zugesagt
 *                (HTML statt JSON, 500, fehlende Huelle); `status` = HTTP-Code
 *   sonst      — alles Uebrige ist technisch: der Ersatzsatz des Vorgangs
 */
export const FEHLERREGELN = [
  { art: 'api', verhalten: 'server_text' },
  { art: 'klartext', verhalten: 'eigener_text' },
  { art: 'zeitablauf', schluessel: 'network.timeout' },
  { art: 'netz', schluessel: 'network.no_connection' },
  { art: 'unerwartet', schluessel: 'server.unexpected' },
  { art: 'sonst', verhalten: 'ersatz' },
] as const;

export type Fehlerart = (typeof FEHLERREGELN)[number]['art'];

/**
 * Beleg per E-Mail senden: welcher `code` des Backends welchen Satz bekommt.
 *
 * `FEHLERREGELN` bleibt davon unberuehrt — das hier ist keine neue Art, einen
 * Transportfehler einzuordnen, sondern die Verfeinerung EINES Aufrufs
 * (`sendReceiptEmail`). Die vier Ausgaenge sind fuer den Kassier vier
 * verschiedene Handlungen: Adresse verbessern, spaeter noch einmal, noch
 * einmal senden, Beleg suchen. Beide Kassen entscheiden am `code`, nicht am
 * Satz des Backends — sonst haengt das Wort am Tresen an einer Formulierung,
 * die sich im Backend jederzeit aendern darf.
 *
 * Bewusst ein Objekt und keine Liste in GROSSSCHRIFT: der
 * Oberflaechen-Vertrag (`fixtures/oberflaeche.json`) liest jede exportierte
 * Liste als Enum der Kasseneinstellungen ein, und der Dart-Zwilling schickt
 * deren Werte durch `KasseSettings.aus`. Fehlercodes haben dort nichts
 * verloren; sie stehen in `fixtures/kasse-texte.json`.
 *
 * Die Codes sind die von `/v3` (`RECEIPT_EMAIL_ERROR_CODES`); unter `/v1` hiessen
 * sie `adresse_ungueltig`, `zu_oft`, `versand_fehlgeschlagen`, `beleg_nicht_gefunden`.
 */
export const BELEG_MAIL_FEHLER = {
  invalid_address: 'receipt.mail_address_invalid',
  too_many_requests: 'receipt.mail_too_often',
  send_failed: 'receipt.mail_failed',
  receipt_not_found: 'receipt.mail_not_found',
} as const satisfies Record<ReceiptEmailErrorCode, MeldungsSchluessel>;

export type BelegMailFehlercode = keyof typeof BELEG_MAIL_FEHLER;

/**
 * Der Satz zu einem `code` des Backends. Einen Code, den dieses Paket noch
 * nicht kennt, faengt der allgemeine Satz auf: das Senden ist gescheitert und
 * darf wiederholt werden. Ein leerer Schirm waere schlimmer als ein zu
 * allgemeiner Satz.
 */
export function belegMailFehler(code: string | undefined | null): MeldungsSchluessel {
  const fehler: Record<string, MeldungsSchluessel> = BELEG_MAIL_FEHLER;
  return (code !== undefined && code !== null && fehler[code]) || 'receipt.mail_failed';
}

/**
 * Storno eines Belegs mit mehreren Zahlungen, dazu der offene Ausgang
 * (`cancellation_outcome_unknown`, gilt fuer jedes Storno): welcher `code` des
 * Backends unter `/v3` welchen Satz bekommt. Dieselbe Idee wie BELEG_MAIL_FEHLER – beide Kassen
 * entscheiden am Code, nie am Satz des Backends. Ein Code, der hier fehlt,
 * geht den allgemeinen Weg der Storno-Fehler (`cancellation.failed`).
 */
export const STORNO_ZAHLUNG_FEHLER = {
  cancellation_payments_required: 'cancellation.payments_missing',
  cancellation_refund_exceeds_payment: 'cancellation.refund_too_high',
  cancellation_refund_reference_required: 'cancellation.refund_without_reference',
  cancellation_refund_reference_unknown: 'cancellation.refund_reference_unknown',
  payments_sum_mismatch: 'cancellation.sum_mismatch',
  cancellation_outcome_unknown: 'cancellation.outcome_unknown',
} as const satisfies Record<string, MeldungsSchluessel>;

export type StornoZahlungFehlercode = keyof typeof STORNO_ZAHLUNG_FEHLER;

/**
 * Der Satz zu einem `code` des Backends beim Storno mit mehreren Zahlungen.
 * Einen Code, den dieses Paket noch nicht kennt, faengt der allgemeine Satz
 * `cancellation.failed` auf – wie bei `belegMailFehler`.
 */
export function stornoZahlungFehler(code: string | undefined | null): MeldungsSchluessel {
  const fehler: Record<string, MeldungsSchluessel> = STORNO_ZAHLUNG_FEHLER;
  return (code !== undefined && code !== null && fehler[code]) || 'cancellation.failed';
}

/**
 * Beschriftungen: Knoepfe, Ueberschriften, Zeilennamen – was kein Satz ist.
 *
 * Getrennt von MELDUNGEN, weil dort jeder Eintrag ein Satz ist (gross am
 * Anfang, Satzzeichen am Schluss) und die Waechter beider Kassen daran
 * Saetze erkennen. „Rest" oder „÷ {n}" sind keine Saetze, muessen aber in
 * beiden Kassen gleich heissen. Dieselben Regeln sonst: Schluessel
 * `bereich.name`, nie umgedeutet, Platzhalter exakt die im Text, `nur` nennt
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
  // `{meldung}` ist der Anfang des Satzes (gekuerzt), nicht der ganze.
  'message.dismiss': { text: 'Meldung ausblenden: {meldung}', platzhalter: ['meldung'] },
  'message.dismiss_warning': { text: 'Verstanden – Warnung ausblenden: {meldung}', platzhalter: ['meldung'] },

  // --- Kopplung und Abmelden -----------------------------------------------
  'pairing.pair_again': { text: 'Neu koppeln' },
  'logout.question': { text: 'Wirklich abmelden?' },
  'logout.keep_working': { text: 'Weiter arbeiten' },
  'device.unpair': { text: 'Gerät entkoppeln' },
  'connect.unpair_confirm': { text: 'Entkoppeln bestätigen', nur: ['web'] },

  // --- Kassieren -------------------------------------------------------------
  // Dieselben Woerter im gewohnten Kassieren und je Zahlung bei „Getrennt“.
  'checkout.tip': { text: 'Trinkgeld' },
  'checkout.no_tip': { text: 'kein' },
  'checkout.custom_amount': { text: 'Eigener Betrag' },
  'checkout.exact': { text: 'passend' },
  'checkout.clear_tendered': { text: 'Gegeben löschen' },
  'checkout.still_missing': { text: 'Es fehlen noch' },
  'checkout.change': { text: 'Rückgeld' },
  // Die Warte-Karte, solange der Betrag am Terminal steht; `{zeit}` ist der
  // Rest des Kartenfensters als m:ss.
  'card_payment.amount_on_terminal': { text: 'Betrag steht am Terminal' },
  'card_payment.present_card': { text: 'Karte vorhalten oder stecken · noch {zeit}', platzhalter: ['zeit'] },

  // --- Abschluss -------------------------------------------------------------
  'completion.receipt_exists': { text: 'Beleg ist vorhanden – erledigen' },
  'completion.resolve': { text: 'Erledigen' },

  // --- Getrennt zahlen -----------------------------------------------------
  'split.button': { text: 'Getrennt' },
  'split.setting': { text: 'Getrennt zahlen' },
  'split.to_pay': { text: 'Zu zahlen' },
  'split.open': { text: 'Offen' },
  'split.payment': { text: 'Zahlung {n}', platzhalter: ['n'] },
  'split.amount': { text: 'Betrag' },
  'split.remaining': { text: 'Rest' },
  'split.divide': { text: '÷ {n}', platzhalter: ['n'] },
  'split.tip_basis': { text: '% von diesem Betrag' },
  'split.of_which_tip': { text: 'davon Trinkgeld {betrag}', platzhalter: ['betrag'] },
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
  'split.continue': { text: 'Weiter · {betrag} getrennt', platzhalter: ['betrag'] },
  'split.allocation': { text: 'Aufteilung' },
  'split.back_to_payment_method': { text: 'Zurück zur Zahlart' },
  'split.tab_items': { text: 'Nach Positionen' },
  'split.tab_amount': { text: 'Betrag' },
  'split.one_less': { text: '{name}: ein Stück weniger', platzhalter: ['name'] },
  'split.one_more': { text: '{name}: ein Stück mehr', platzhalter: ['name'] },
  'split.tendered': { text: 'Gegeben (bar)' },
  'split.tendered_change': { text: 'Gegeben {gegeben} · Rückgeld {rueckgeld}', platzhalter: ['gegeben', 'rueckgeld'] },
  // Je Zahlung oben die Zahlart (Umschalter, kein Ausloeser), unten EIN Knopf,
  // der diese Zahlung mit der gewaehlten Zahlart kassiert.
  'split.payment_method': { text: 'Zahlart' },
  'split.method_cash': { text: 'Bar' },
  'split.method_card': { text: 'Karte' },
  'split.add_payment': { text: 'Zahlung hinzufügen · {betrag}', platzhalter: ['betrag'] },
  // Nach Positionen: die offenen Stueck als Kacheln in der grossen Flaeche;
  // Antippen nimmt ein Stueck in diese Zahlung, „−“ an der Kachel eines heraus.
  'split.open_items': { text: 'Offene Positionen' },
  'split.pieces_open': { text: '{n} offen', platzhalter: ['n'] },
  'split.pieces_selected': { text: '{n} von {offen}', platzhalter: ['n', 'offen'] },
  'split.nothing_selected': { text: 'Noch nichts angetippt' },
  'split.all_paid': { text: 'Alles bezahlt' },

  // --- Zahlarten in Listen (Kassieren, Storno, Belegliste) -----------------
  'payment_method.card': { text: 'Kartenzahlung' },
  'payment_method.cash': { text: 'Barzahlung' },
  // Beleg mit mehreren Zahlungen (`paymentMethod: 'mixed'` oder mehr als eine
  // Zahlung): weder Bar noch Karte, auch nicht im Filter.
  'payment_method.multiple': { text: 'Mehrere' },

  // --- Storno ----------------------------------------------------------------
  'cancellation.title': { text: 'Storno zu {beleg}', platzhalter: ['beleg'] },

  // --- Storno eines Belegs mit mehreren Zahlungen --------------------------
  'cancellation.how_to_refund': { text: 'Wie zurückgeben?' },
  'cancellation.as_paid': { text: 'wie bezahlt' },
  'cancellation.cash': { text: 'bar' },
  'cancellation.all_cash': { text: 'Alles bar' },
  'cancellation.payment_remainder': { text: 'Rest {betrag}', platzhalter: ['betrag'] },
  'cancellation.difference': { text: 'Differenz' },
} as const satisfies Record<string, Meldung>;

export type BeschriftungsSchluessel = keyof typeof BESCHRIFTUNGEN_ROH;
export const BESCHRIFTUNGEN: Record<BeschriftungsSchluessel, Meldung> = BESCHRIFTUNGEN_ROH;

/** Die Beschriftung zum Schluessel, Platzhalter ersetzt; fehlt ein Wert, wirft es wie `meldung`. */
export function beschriftung(schluessel: BeschriftungsSchluessel, werte: Record<string, string | number> = {}): string {
  return ersetze(`beschriftung(${schluessel})`, BESCHRIFTUNGEN[schluessel].text, werte);
}

function ersetze(wo: string, text: string, werte: Record<string, string | number>): string {
  return text.replace(/\{([a-z]+)\}/g, (_, name: string) => {
    const wert = werte[name];
    if (wert === undefined) throw new Error(`${wo}: Platzhalter {${name}} ohne Wert`);
    return String(wert);
  });
}

/** Der Satz zum Schluessel, Platzhalter ersetzt. Fehlt ein Wert, wirft es — ein `{status}` am Tresen waere schlimmer. */
export function meldung(schluessel: MeldungsSchluessel, werte: Record<string, string | number> = {}): string {
  const eintrag: Meldung = MELDUNGEN[schluessel];
  return eintrag.text.replace(/\{([a-z]+)\}/g, (_, name: string) => {
    const wert = werte[name];
    if (wert === undefined) throw new Error(`meldung(${schluessel}): Platzhalter {${name}} ohne Wert`);
    return String(wert);
  });
}

/** Gilt der Satz auf dieser Seite? */
export function meldungGiltFuer(schluessel: MeldungsSchluessel, seite: Seite): boolean {
  const eintrag: Meldung = MELDUNGEN[schluessel];
  return eintrag.nur === undefined || eintrag.nur.includes(seite);
}
