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
 */

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
  'netz.keine_verbindung': { text: 'Keine Verbindung zum Server. Bitte die Internetverbindung prüfen und erneut versuchen.' },
  'netz.zeitablauf': { text: 'Der Server antwortet nicht. Bitte die Internetverbindung prüfen und erneut versuchen.' },
  'server.unerwartet': { text: 'Der Server hat unerwartet geantwortet (HTTP {status}). Bitte den Support verständigen.', platzhalter: ['status'] },

  // --- Kopplung ------------------------------------------------------------
  'kopplung.code_fehlt': { text: 'Bitte den Kopplungs-Code eingeben.' },
  'kopplung.fehlgeschlagen': { text: 'Die Kopplung ist fehlgeschlagen. Bitte erneut versuchen.' },
  'kopplung.unvollstaendig': { text: 'Die Kopplung ist unvollständig zurückgekommen. Bitte im Panel einen neuen Code erzeugen und noch einmal versuchen.' },
  'geraet.browser_speicher': { text: 'Dieses Gerät konnte nicht gespeichert werden — der Browser-Speicher steht nicht zur Verfügung. Bitte den privaten Modus verlassen.', nur: ['web'] },

  // --- Anmeldung und Sitzung -----------------------------------------------
  'anmeldung.pin_fehlt': { text: 'Bitte die PIN eingeben.' },
  'anmeldung.fehlgeschlagen': { text: 'Die Anmeldung ist fehlgeschlagen. Bitte erneut versuchen.' },
  'anmeldung.nicht_abgeschlossen': { text: 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.' },
  'anmeldung.wird_abgeschlossen': { text: 'Anmeldung wird gerade abgeschlossen — bitte gleich noch einmal drücken.' },
  'sitzung.abgelaufen': { text: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.' },
  'sitzung.abgelaufen_ohne_netz': { text: 'Keine Verbindung zum Server — die Sitzung ist abgelaufen. Bitte erneut anmelden.' },
  'sitzung.keine': { text: 'Keine Sitzung.' },
  'rechte.nicht_aenderbar': { text: 'Das darfst du nicht ändern — das Recht dafür vergibt der Inhaber im Panel.' },

  // --- Verkauf und Positionen ----------------------------------------------
  'kasse.laden_fehlgeschlagen': { text: 'Die Kasse konnte nicht geladen werden.' },
  'artikel.laden_fehlgeschlagen': { text: 'Die Artikel konnten nicht geladen werden.' },
  'artikel.keine_freigegeben': { text: 'Keine Artikel an dieser Kasse. Im Panel unter „Kacheln & Gruppen“ freischalten.' },
  'artikel.keine_gefunden': { text: 'Keine Artikel gefunden.' },
  'artikel.steuersatz_unbekannt': { text: '„{name}“ hat einen Steuersatz, den die Kasse nicht kennt.', platzhalter: ['name'] },
  'position.betrag_fehlt': { text: 'Bitte einen Betrag eingeben.' },
  'position.bezeichnung_fehlt': { text: 'Bitte eine Bezeichnung eingeben — sie steht am Beleg.' },
  'rabatt.prozent_ungueltig': { text: 'Bitte einen Prozentwert zwischen 0,1 und 100 eingeben.' },

  // --- Abschluss -----------------------------------------------------------
  'abschluss.fehlgeschlagen': { text: 'Der Abschluss ist fehlgeschlagen.' },
  'abschluss.unklar': { text: 'Unklar, ob der Beleg entstanden ist — die Antwort kam nicht an. Bitte nicht noch einmal abschließen: der Beleg kann bereits erstellt und signiert sein. Im Panel unter „Belege“ nachsehen; nur wenn er dort fehlt, den Verkauf erneut abschließen.' },
  'abschluss.nullbeleg_fehlgeschlagen': { text: 'Der Nullbeleg konnte nicht erstellt werden.' },
  'abschluss.signatur_ausgefallen': { text: 'Die Signatureinheit hat nicht geantwortet. Der Beleg ist gültig und trägt den Vermerk „Sicherheitseinrichtung ausgefallen“.' },
  // Erledigen darf nur bestaetigen, was am Server auch wirklich steht – sonst
  // gilt ein Betrag als abgehakt, zu dem es nie einen Beleg gab.
  'abschluss.erledigen_frage': { text: 'Nur erledigen, wenn der Beleg in der Belegliste steht – sonst bleiben {betrag} ohne Beleg. Bitte zuerst unter „Belege“ nachsehen.', platzhalter: ['betrag'] },

  // --- Kartenzahlung -------------------------------------------------------
  'kartenzahlung.nicht_moeglich': { text: 'Kartenzahlung nicht möglich.' },
  'kartenzahlung.nicht_zustande': { text: 'Die Kartenzahlung ist nicht zustande gekommen.' },
  'kartenzahlung.nicht_gestartet': { text: 'Kartenzahlung nicht gestartet: {grund}', platzhalter: ['grund'] },
  'kartenzahlung.unklar': { text: 'Unklar, ob die Kartenzahlung durchgegangen ist — die Verbindung zum Terminal riss ab. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird: die Karte kann belastet sein.' },
  // Die Kennung ist der einzige Anker, um die Zahlung am Terminal-Beleg wiederzufinden — liegt sie vor, gilt dieser Satz statt kartenzahlung.unklar.
  'kartenzahlung.unklar_mit_kennung': { text: 'Unklar, ob die Kartenzahlung durchgegangen ist — die Verbindung zum Terminal riss ab. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird: die Karte kann belastet sein. Kennung der Zahlung: {kennung}.', platzhalter: ['kennung'] },
  'kartenzahlung.wartet_auf_terminal': { text: 'Bitte am Terminal fortfahren …' },
  // Ein geglücktes Kartenergebnis ohne Beleg ist der teuerste Zustand am Tresen:
  // wer hier erneut kassiert, belastet die Karte ein zweites Mal. Beide Sätze
  // nennen deshalb Betrag UND Kennung — nur damit findet der Kassier die Zahlung
  // am Terminal-Beleg wieder — und keiner rät zum Wiederholen.
  'kartenzahlung.karte_gebucht_beleg_offen': { text: 'Die Karte ist bereits mit {betrag} belastet (Kennung {kennung}) — der Beleg dazu fehlt noch. Bitte jetzt den Beleg erstellen und nicht erneut kassieren.', platzhalter: ['betrag', 'kennung'] },
  'kartenzahlung.karte_gebucht_korb_geaendert': { text: 'Es gibt eine gebuchte Kartenzahlung über {betrag} (Kennung {kennung}), aber der Korb hat sich seither geändert. Bitte zuerst entscheiden: den Beleg zur gebuchten Zahlung erstellen oder die Zahlung am Terminal stornieren und hier verwerfen.', platzhalter: ['betrag', 'kennung'] },
  'kartenzahlung.connect_nicht_verbunden': { text: 'Kartenzahlung nicht möglich: Kasseneck Connect ist nicht verbunden — Einstellungen → Kasseneck Connect.', nur: ['web'] },
  // Solange die Karte belastet ist, darf am Korb nichts mehr veraendert werden –
  // sonst passt der Beleg nicht mehr zum Betrag, der schon abgebucht ist.
  'kartenzahlung.korb_gesperrt_karte_belastet': { text: 'Die Karte ist bereits belastet – Warenkorb, Rabatt und Trinkgeld bleiben gesperrt, bis der Beleg entsteht oder die Karte zurückerstattet ist.' },
  // Entkoppeln trennt das Geraet vom Konto, nicht die gebuchte Kartenzahlung
  // vom Terminal – die muss weiterhin von Hand storniert werden.
  'kartenzahlung.entkoppeln_karte_belastet': { text: 'Auf diesem Gerät liegt noch eine gebuchte Kartenzahlung ohne Beleg – sie muss von Hand am Terminal zurückerstattet werden (Betrag siehe unten).' },
  'terminal.keines_gefunden': { text: 'Kein Hobex-Terminal gefunden — ist es eingeschaltet und im selben Netz wie dieser Rechner?', nur: ['web'] },
  'terminal.nicht_bereit': { text: 'Terminal antwortet, ist aber nicht betriebsbereit: {antwort} — TID prüfen.', platzhalter: ['antwort'], nur: ['web'] },
  'gptom.app_fehlt': { text: 'Die GP-Tom-App ist auf diesem Gerät nicht da.', nur: ['app'] },
  'gptom.suche_fehlgeschlagen': { text: 'GP Tom: Suche nach der App fehlgeschlagen: {grund}', platzhalter: ['grund'], nur: ['app'] },
  'gptom.zahlung_fehlgeschlagen': { text: 'GP Tom: Zahlung fehlgeschlagen: {grund}', platzhalter: ['grund'], nur: ['app'] },
  'gptom.terminal_antwortet_nicht': { text: 'Das Terminal hat nicht geantwortet: {grund}', platzhalter: ['grund'], nur: ['app'] },
  'gptom.zahlung_nicht_abgeschlossen': { text: 'Die Zahlung wurde nicht abgeschlossen ({code}).', platzhalter: ['code'], nur: ['app'] },
  // Abgelehnt heißt: das Terminal hat entschieden, es ist sicher nichts gebucht.
  // Der Code ist die einzige Handhabe, mit der der Inhaber bei GP nachfragen kann —
  // liegt einer vor, gilt die Fassung mit Code.
  'gptom.abgelehnt': { text: 'Das Terminal hat die Zahlung abgelehnt.', nur: ['app'] },
  'gptom.abgelehnt_mit_code': { text: 'Das Terminal hat die Zahlung abgelehnt ({code}).', platzhalter: ['code'], nur: ['app'] },
  'gptom.nicht_geoeffnet': { text: 'GP Tom ließ sich nicht öffnen — bitte die GP-Tom-App prüfen und erneut versuchen.', nur: ['app'] },
  // Frist abgelaufen ist kein Abbruch: die Karte kann belastet sein, nur die
  // Antwort blieb aus. Deshalb derselbe Ton wie kartenzahlung.unklar.
  'gptom.zeit_abgelaufen': { text: 'Das Terminal hat in der Frist nicht geantwortet — die Karte kann belastet sein. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird.', nur: ['app'] },
  'gptom.zeit_abgelaufen_mit_kennung': { text: 'Das Terminal hat in der Frist nicht geantwortet — die Karte kann belastet sein. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird. Kennung der Zahlung: {kennung}.', platzhalter: ['kennung'], nur: ['app'] },

  // --- Terminal-Protokoll --------------------------------------------------
  'protokoll.leer': { text: 'Noch keine Einträge — das Protokoll füllt sich mit der ersten Kartenzahlung.' },
  'protokoll.kopiert': { text: 'Das Protokoll liegt in der Zwischenablage.' },

  // --- Belege und Storno ---------------------------------------------------
  'belege.laden_fehlgeschlagen': { text: 'Die Belege konnten nicht geladen werden.' },
  'belege.keine_im_zeitraum': { text: 'Keine Belege in diesem Zeitraum.' },
  'beleg.laden_fehlgeschlagen': { text: 'Der Beleg konnte nicht geladen werden.' },
  'beleg.nicht_gefunden': { text: 'Der Beleg wurde nicht gefunden.' },
  'storno.fehlgeschlagen': { text: 'Das Storno ist fehlgeschlagen.' },
  'storno.grund_fehlt': { text: 'Bitte einen Grund wählen.' },
  'storno.position_fehlt': { text: 'Bitte mindestens eine Position wählen.' },
  // Storno eines Belegs mit mehreren Zahlungen: je Zahlung wird zurückgegeben,
  // und der Server prueft jede Rueckgabe gegen den Rest ihrer Zahlung. Welcher
  // Code welchen Satz bekommt, steht in STORNO_ZAHLUNG_FEHLER.
  'storno.zahlungen_fehlen': { text: 'Dieser Beleg wurde in mehreren Zahlungen bezahlt – bitte angeben, wie zurückgegeben wird.' },
  'storno.rueckgabe_zu_hoch': { text: 'Eine Rückgabe ist höher als der Rest ihrer Zahlung – bitte die Beträge prüfen.' },
  'storno.rueckgabe_ohne_bezug': { text: 'Eine Rückgabe nennt keine Zahlung des Belegs – bitte das Storno neu beginnen.' },
  'storno.rueckgabe_bezug_unbekannt': { text: 'Eine Rückgabe nennt eine Zahlung, die es am Beleg nicht gibt – bitte das Storno neu beginnen.' },
  // Die Antwort kam, aber der Ausgang ist offen: der Storno-Beleg kann schon
  // signiert sein. Wer jetzt noch einmal storniert, storniert womoeglich doppelt.
  'storno.ergebnis_unklar': { text: 'Unklar, ob das Storno entstanden ist – es kann bereits signiert sein. Bitte nicht erneut stornieren, sondern die Belegliste in ein paar Minuten neu laden.' },
  'storno.summe_passt_nicht': { text: 'Die Rückgaben ergeben nicht den Betrag des Stornos – bitte die Beträge prüfen.' },
  // Storno eines Belegs mit mehreren Zahlungen: Karten gehen VON HAND am
  // Terminal zurueck, und zwar erst NACH dem gebuchten Storno -- vorher
  // fliesst kein Geld. Darunter steht die Liste der Karten zum Abhaken; der
  // Satz passt fuer eine oder mehrere Karten, mit oder ohne Anbindung.
  'storno.karten_gutschreiben': { text: 'Das Storno ist gebucht – bitte jede Karte unten am Terminal gutschreiben und abhaken.' },
  // Wie storno.ergebnis_unklar, nur enthielt die Rueckgabe Karten: bevor
  // klar ist, ob das Storno steht, darf keine Gutschrift laufen -- sonst geht
  // Geld zurueck ohne Storno-Beleg.
  'storno.ergebnis_unklar_karten': { text: 'Unklar, ob das Storno entstanden ist – es kann bereits signiert sein. Bitte nicht erneut stornieren und noch keine Karte gutschreiben, sondern die Belegliste in ein paar Minuten neu laden. Steht das Storno dort, die Karten laut Storno-Beleg am Terminal gutschreiben.' },
  // Die Liste der Karten nach dem gebuchten Storno wird geschlossen, obwohl
  // nicht jede Karte abgehakt ist: einmal nachfragen -- eine vergessene
  // Gutschrift faellt sonst erst dem Gast auf.
  'storno.karten_nicht_abgehakt': { text: 'Noch ist nicht jede Karte abgehakt – bitte jede am Terminal gutschreiben. Ist das schon geschehen, zum Schließen noch einmal drücken.' },

  // --- Getrennt zahlen -----------------------------------------------------
  // Ein Tisch zahlt in Teilen, ein Beleg fuer alles. Das Teure ist eine schon
  // belastete Karte: jeder Satz, der sie betrifft, nennt den Betrag, und keiner
  // raet dazu, noch einmal zu kassieren.
  'getrennt.einstellung_hinweis': { text: 'Ein Tisch zahlt in Teilen: jede Zahlung bar oder mit Karte, mit eigenem Trinkgeld – am Ende ein Beleg für alles.' },
  'getrennt.betrag_ueber_offen': { text: 'Der Betrag ist höher als offen – höchstens {betrag}.', platzhalter: ['betrag'] },
  'getrennt.trinkgeld_ueber_betrag': { text: 'Das Trinkgeld ist höher als der Betrag dieser Zahlung.' },
  'getrennt.gegeben_zu_wenig': { text: 'Gegeben ist weniger als der Betrag dieser Zahlung.' },
  'getrennt.noch_offen': { text: 'Es sind noch {betrag} offen – abschließen geht erst, wenn alles kassiert ist.', platzhalter: ['betrag'] },
  'getrennt.summe_passt_nicht': { text: 'Die Zahlungen ergeben nicht den Betrag des Belegs – bitte die Liste prüfen.' },
  'getrennt.korb_gesperrt': { text: 'Der Warenkorb ist gesperrt, solange Zahlungen kassiert sind – erst abschließen oder die Zahlungen entfernen.' },
  'getrennt.wechsel_gesperrt': { text: 'Zurück zu Bar oder Karte geht erst, wenn keine Zahlung mehr kassiert ist.' },
  'getrennt.bar_zurueckgeben': { text: 'Bitte {betrag} Bargeld an den Gast zurückgeben.', platzhalter: ['betrag'] },
  'getrennt.karte_zurueckbuchen_laeuft': { text: 'Die Kartenzahlung über {betrag} wird am Terminal zurückgebucht …', platzhalter: ['betrag'] },
  'getrennt.karte_zurueckgebucht': { text: 'Die Kartenzahlung über {betrag} ist am Terminal zurückgebucht.', platzhalter: ['betrag'] },
  'getrennt.karte_zurueckbuchen_fehlgeschlagen': { text: 'Die Kartenzahlung über {betrag} (Kennung {kennung}) ließ sich nicht zurückbuchen – sie bleibt in der Liste. Bitte am Terminal-Beleg nachsehen und erneut versuchen.', platzhalter: ['betrag', 'kennung'] },
  'getrennt.karte_zurueckbuchen_unklar': { text: 'Unklar, ob die Rückbuchung über {betrag} (Kennung {kennung}) durchgegangen ist – die Zahlung bleibt in der Liste. Bitte am Terminal-Beleg nachsehen, BEVOR erneut zurückgebucht wird.', platzhalter: ['betrag', 'kennung'] },
  // Das Terminal meldet eine Gutschrift, die hier noch als offene Ruecknahme
  // steht – ein zweites Zurueckbuchen waere die doppelte Rueckgabe.
  'getrennt.karte_bereits_zurueckgebucht': { text: 'Das Terminal meldet, dass die Kartenzahlung über {betrag} bereits gutgeschrieben wurde (Kennung {kennung}) – bitte am Terminal-Beleg prüfen und nicht erneut zurückbuchen.', platzhalter: ['betrag', 'kennung'] },
  'getrennt.extern_zurueckbuchen': { text: 'Diese Karte ist nicht an die Kasse angebunden. Bitte {betrag} jetzt am Terminal zurückbuchen und danach bestätigen.', platzhalter: ['betrag'] },
  'getrennt.sitzung_offen': { text: 'Eine getrennte Zahlung ist nicht abgeschlossen, {betrag} sind schon kassiert. Bitte weiter kassieren oder alles zurückbuchen.', platzhalter: ['betrag'] },
  'getrennt.sitzung_unlesbar': { text: 'Eine gespeicherte getrennte Zahlung auf diesem Gerät ließ sich nicht lesen – bitte prüfen, ob schon Karten belastet wurden (Kasseneck-Panel oder Terminal), und offene Beträge von Hand ausgleichen.' },
  'getrennt.ablage_fehlgeschlagen': { text: 'Die getrennte Zahlung ließ sich auf diesem Gerät nicht speichern – bitte die Kasse bis zum Abschluss dieses Belegs nicht neu laden, sonst stehen belastete Karten womöglich nicht mehr in der Liste.' },
  'getrennt.zu_viele_zahlungen': { text: 'Ein Beleg lässt höchstens 20 Zahlungen zu.' },
  'getrennt.entkoppeln_offene_karten': { text: 'Auf diesem Gerät ist noch eine getrennte Zahlung mit belasteten Karten offen – sie müssen von Hand am Terminal zurückgebucht werden (Beträge siehe unten).' },
  'getrennt.positionen_gesperrt': { text: 'Nach Positionen geht nicht mehr – eine Zahlung ist schon als Betrag kassiert.' },
  'getrennt.positionen_waehlen': { text: 'Bitte zuerst antippen, was dieser Gast zahlt.' },

  // --- Beleg weitergeben: Link, Teilen, E-Mail -----------------------------
  // Kopieren, Teilen und Senden fuehren zu demselben Ziel: der oeffentlichen
  // Belegseite (beleg.kasseneck.at/<fullReceiptId>). Kein Satz davon ist
  // plattformgebunden — nur die Huelle unterscheidet sich, nicht das Wort.
  'beleg.link_kopiert': { text: 'Der Link zum Beleg liegt in der Zwischenablage.' },
  // Der Text, der beim Teilen mitgeht. Der Link steht am Schluss, damit ihn
  // jede Huelle (SMS, Messenger, Mail) bis zum Ende als Link erkennt und nicht
  // mitten im Satz abbricht.
  'beleg.teilen_text': { text: 'Beleg {nummer} von {betrieb} über {betrag}: {link}', platzhalter: ['betrieb', 'nummer', 'betrag', 'link'] },
  // Belege aus dem Altbestand tragen keine `fullReceiptId`; ohne sie gibt es
  // keine Belegseite. Der Satz nennt den Grund, sonst sucht der Kassier den
  // Fehler bei sich und versucht es ein zweites Mal.
  'beleg.nicht_teilbar': { text: 'Für diesen Beleg gibt es keinen Link — er stammt aus einer älteren Kasse.' },
  // Ein Testbeleg hat eine Belegseite, ist aber steuerlich nichts wert. Wer
  // den Link weitergibt, muss das vorher lesen, nicht hinterher.
  'beleg.test_hinweis_teilen': { text: 'Test-Umgebung — der Beleg ist steuerlich nicht gültig.' },
  'beleg.mail_gesendet': { text: 'Der Beleg wurde an {an} gesendet.', platzhalter: ['an'] },
  'beleg.mail_adresse_ungueltig': { text: 'Diese E-Mail-Adresse ist nicht gültig.' },
  'beleg.mail_zu_oft': { text: 'Dieser Beleg wurde schon oft gesendet — bitte später noch einmal.' },
  'beleg.mail_fehlgeschlagen': { text: 'Der Beleg konnte nicht gesendet werden. Bitte noch einmal versuchen.' },
  // Bewusst nicht derselbe Satz wie `beleg.nicht_gefunden`: dort scheitert das
  // Oeffnen, hier das Senden. Der Kassier steht vor einem Adressfeld und muss
  // lesen, dass nichts hinausgegangen ist.
  'beleg.mail_nicht_gefunden': { text: 'Dieser Beleg wurde nicht gefunden — er konnte nicht gesendet werden.' },

  // --- Druck ---------------------------------------------------------------
  'druck.fehlgeschlagen': { text: 'Der Ausdruck ist fehlgeschlagen.' },
  'druck.nicht_moeglich': { text: 'Druck nicht möglich: {grund}', platzhalter: ['grund'] },
  'druck.testdruck_fehlgeschlagen': { text: 'Der Testdruck ist fehlgeschlagen.' },
  'druck.testdruck_nicht_moeglich': { text: 'Der Testdruck ist fehlgeschlagen: {grund}', platzhalter: ['grund'] },
  'druck.kein_drucker': { text: 'Kein Bondrucker eingerichtet — in den Einstellungen unter Drucker & Lade.' },
  'druck.drucker_nicht_erreichbar': { text: 'Drucker nicht erreichbar.' },
  'druck.job_abgelaufen': { text: 'Drucker hat den Beleg nicht abgeholt (abgelaufen).', nur: ['web'] },
  'druck.kein_drucker_gefunden': { text: 'Kein Drucker gefunden — ist er eingeschaltet und im selben Netz wie dieser Rechner?', nur: ['web'] },
  'druck.nur_chrome': { text: '{weg}-Druck geht nur in Chrome oder Edge (Windows, Mac, Android) — nicht in Safari und nicht am iPad.', platzhalter: ['weg'], nur: ['web'] },
  'druck.kein_weg_drucker': { text: 'Kein {weg}-Drucker verbunden — „{weg}-Drucker verbinden“ und den Drucker im Dialog wählen.', platzhalter: ['weg'], nur: ['web'] },
  // Der Drucker-Wizard: suchen, verbinden, Testdruck, QR-Probe, erst dann
  // speichern. Derselbe Ablauf in beiden Kassen — deshalb hat kein Satz ein
  // `nur`, obwohl der Weg zum Drucker verschieden ist (Bluetooth in der App,
  // Web Bluetooth im Browser). Was der Chef liest, ist beidesmal dasselbe.
  'druck.wizard_verbinden': { text: 'Verbinde mit {name} …', platzhalter: ['name'] },
  'druck.wizard_testdruck_frage': { text: 'Ist der Testdruck gekommen?' },
  'druck.wizard_qr_frage': { text: 'Welcher QR-Code ist sauber gedruckt?' },
  // Kein Modus druckt einen lesbaren QR-Code: gespeichert wird trotzdem (mit
  // Raster als Vorgabe), aber der Chef muss wissen, dass der QR-Code dann vom
  // Bildschirm gelesen werden muss — nach RKSV gehoert er an den Beleg.
  'druck.wizard_qr_keiner_hinweis': { text: 'Kein QR-Code kam sauber — der Beleg zeigt den QR-Code dann am Bildschirm.' },
  'druck.wizard_nichts_gekommen': { text: 'Nichts gekommen? Drucker an, Papier drin, richtiges Gerät gewählt?' },
  'druck.wizard_gespeichert': { text: '{name} ist eingerichtet.', platzhalter: ['name'] },
  // Abbrechen an jeder Stelle: nichts gespeichert. Der Satz sagt genau das,
  // damit niemand einen halb eingerichteten Drucker vermutet.
  'druck.wizard_abgebrochen': { text: 'Nichts gespeichert.' },
  'bluetooth.aus': { text: 'Bluetooth ist ausgeschaltet. Bitte einschalten und erneut suchen.', nur: ['app'] },
  'bluetooth.freigabe_fehlt': { text: 'Bitte die Freigabe in den Geräte-Einstellungen erteilen.', nur: ['app'] },
  'bluetooth.suche_fehlgeschlagen': { text: 'Die Suche ist fehlgeschlagen: {grund}', platzhalter: ['grund'], nur: ['app'] },

  // --- Kasseneck Connect (nur Browser) -------------------------------------
  'connect.antwortet_nicht': { text: 'Kasseneck Connect antwortet nicht — läuft das Programm auf diesem Rechner?', nur: ['web'] },
  'connect.code_abgelaufen': { text: 'Der Kopplungs-Code ist abgelaufen — im Agent einen neuen erzeugen („kasseneck-connect pair“).', nur: ['web'] },
  'connect.zu_viele_versuche': { text: 'Zu viele Fehlversuche — eine Minute warten und noch einmal versuchen.', nur: ['web'] },
  'connect.drucker_antwortet_nicht': { text: 'Der Drucker antwortet nicht — Strom, Netzwerk und IP prüfen.', nur: ['web'] },
  'connect.nicht_gekoppelt': { text: 'Diese Kasse ist mit Kasseneck Connect nicht gekoppelt — in den Einstellungen „Koppeln“ drücken.', nur: ['web'] },
  'connect.drucker_unbekannt': { text: 'Diesen Drucker kennt Kasseneck Connect nicht (mehr) — bitte neu suchen.', nur: ['web'] },
  'connect.ursprung_nicht_freigegeben': { text: 'Kasseneck Connect nimmt von dieser Adresse nichts an (Ursprung nicht freigegeben).', nur: ['web'] },
  'connect.nicht_installiert': { text: 'Kasseneck Connect nicht gefunden — bitte installieren.', nur: ['web'] },

  // --- Einstellungen -------------------------------------------------------
  'einstellungen.laden_fehlgeschlagen': { text: 'Die Einstellungen konnten nicht geladen werden.' },
  'einstellungen.speichern_fehlgeschlagen': { text: 'Die Einstellung konnte nicht gespeichert werden.' },
  'einstellungen.noch_nicht_geladen': { text: 'Noch nicht geladen — bitte kurz warten oder neu anmelden.' },
  'einstellungen.ip_ungueltig': { text: 'Keine gültige IP-Adresse (z. B. 192.168.1.50).' },
  'entkopplung.fehlgeschlagen': { text: 'Entkoppeln fehlgeschlagen.' },
  'logo.hochladen_fehlgeschlagen': { text: 'Hochladen fehlgeschlagen.' },
  'logo.entfernen_fehlgeschlagen': { text: 'Entfernen fehlgeschlagen.' },

  // --- Nur App -------------------------------------------------------------
  'app.nicht_im_browser': { text: 'Die Kassen-App läuft nicht im Browser — dafür gibt es kasse.kasseneck.at.', nur: ['app'] },
  'app.im_browser_oeffnen': { text: 'Bitte im Browser öffnen: {ziel}', platzhalter: ['ziel'], nur: ['app'] },
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
  { art: 'zeitablauf', schluessel: 'netz.zeitablauf' },
  { art: 'netz', schluessel: 'netz.keine_verbindung' },
  { art: 'unerwartet', schluessel: 'server.unerwartet' },
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
 */
export const BELEG_MAIL_FEHLER = {
  adresse_ungueltig: 'beleg.mail_adresse_ungueltig',
  zu_oft: 'beleg.mail_zu_oft',
  versand_fehlgeschlagen: 'beleg.mail_fehlgeschlagen',
  beleg_nicht_gefunden: 'beleg.mail_nicht_gefunden',
} as const satisfies Record<string, MeldungsSchluessel>;

export type BelegMailFehlercode = keyof typeof BELEG_MAIL_FEHLER;

/**
 * Der Satz zu einem `code` des Backends. Einen Code, den dieses Paket noch
 * nicht kennt, faengt der allgemeine Satz auf: das Senden ist gescheitert und
 * darf wiederholt werden. Ein leerer Schirm waere schlimmer als ein zu
 * allgemeiner Satz.
 */
export function belegMailFehler(code: string | undefined | null): MeldungsSchluessel {
  const fehler: Record<string, MeldungsSchluessel> = BELEG_MAIL_FEHLER;
  return (code !== undefined && code !== null && fehler[code]) || 'beleg.mail_fehlgeschlagen';
}

/**
 * Storno eines Belegs mit mehreren Zahlungen, dazu der offene Ausgang
 * (`STORNO_OUTCOME_UNKNOWN`, gilt fuer jedes Storno): welcher `code` des
 * Backends welchen Satz bekommt. Dieselbe Idee wie BELEG_MAIL_FEHLER – beide Kassen
 * entscheiden am Code, nie am Satz des Backends. Ein Code, der hier fehlt,
 * geht den allgemeinen Weg der Storno-Fehler (`storno.fehlgeschlagen`).
 */
export const STORNO_ZAHLUNG_FEHLER = {
  STORNO_PAYMENTS_REQUIRED: 'storno.zahlungen_fehlen',
  STORNO_REFUND_EXCEEDS_PAYMENT: 'storno.rueckgabe_zu_hoch',
  STORNO_REFUND_REFERENCE_REQUIRED: 'storno.rueckgabe_ohne_bezug',
  STORNO_REFUND_REFERENCE_UNKNOWN: 'storno.rueckgabe_bezug_unbekannt',
  PAYMENTS_SUM_MISMATCH: 'storno.summe_passt_nicht',
  STORNO_OUTCOME_UNKNOWN: 'storno.ergebnis_unklar',
} as const satisfies Record<string, MeldungsSchluessel>;

export type StornoZahlungFehlercode = keyof typeof STORNO_ZAHLUNG_FEHLER;

/**
 * Der Satz zu einem `code` des Backends beim Storno mit mehreren Zahlungen.
 * Einen Code, den dieses Paket noch nicht kennt, faengt der allgemeine Satz
 * `storno.fehlgeschlagen` auf – wie bei `belegMailFehler`.
 */
export function stornoZahlungFehler(code: string | undefined | null): MeldungsSchluessel {
  const fehler: Record<string, MeldungsSchluessel> = STORNO_ZAHLUNG_FEHLER;
  return (code !== undefined && code !== null && fehler[code]) || 'storno.fehlgeschlagen';
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
  'allgemein.abbrechen': { text: 'Abbrechen' },

  // --- Abschluss -------------------------------------------------------------
  'abschluss.beleg_vorhanden': { text: 'Beleg ist vorhanden – erledigen' },
  'abschluss.erledigen': { text: 'Erledigen' },

  // --- Getrennt zahlen -----------------------------------------------------
  'getrennt.knopf': { text: 'Getrennt' },
  'getrennt.einstellung': { text: 'Getrennt zahlen' },
  'getrennt.zu_zahlen': { text: 'Zu zahlen' },
  'getrennt.offen': { text: 'Offen' },
  'getrennt.zahlung': { text: 'Zahlung {n}', platzhalter: ['n'] },
  'getrennt.betrag': { text: 'Betrag' },
  'getrennt.rest': { text: 'Rest' },
  'getrennt.teilen': { text: '÷ {n}', platzhalter: ['n'] },
  'getrennt.trinkgeld_bezug': { text: '% von diesem Betrag' },
  'getrennt.kassieren': { text: 'Zahlung {n} kassieren', platzhalter: ['n'] },
  'getrennt.davon_trinkgeld': { text: 'davon Trinkgeld {betrag}', platzhalter: ['betrag'] },
  'getrennt.entfernen': { text: 'Entfernen' },
  'getrennt.alles_abbrechen': { text: 'Alles abbrechen' },
  'getrennt.weiter_kassieren': { text: 'Weiter kassieren' },
  'getrennt.alles_zurueckbuchen': { text: 'Alles zurückbuchen' },
  'getrennt.am_terminal_zurueckgebucht': { text: 'Am Terminal zurückgebucht' },
  'getrennt.karte_zurueckbuchen': { text: 'Karte zurückbuchen' },
  'getrennt.trotzdem_neu_koppeln': { text: 'Trotzdem neu koppeln' },
  'getrennt.zahlung_behalten': { text: 'Zahlung behalten' },
  'getrennt.klaeren': { text: 'Klären' },
  'getrennt.erneut_zurueckbuchen': { text: 'Erneut zurückbuchen' },
  'getrennt.wurde_belastet': { text: 'Wurde belastet – übernehmen' },
  'getrennt.nicht_belastet': { text: 'Nicht belastet – verwerfen' },
  // Aufteilung: eigener Schritt nach „Weiter“, Tabs „Nach Positionen“ / „Betrag“.
  'getrennt.weiter': { text: 'Weiter · {betrag} getrennt', platzhalter: ['betrag'] },
  'getrennt.aufteilung': { text: 'Aufteilung' },
  'getrennt.zurueck_zahlart': { text: 'Zurück zur Zahlart' },
  'getrennt.tab_positionen': { text: 'Nach Positionen' },
  'getrennt.tab_betrag': { text: 'Betrag' },
  'getrennt.stueck_bezahlt': { text: '{n} bezahlt', platzhalter: ['n'] },
  'getrennt.stueck_weniger': { text: '{name}: ein Stück weniger', platzhalter: ['name'] },
  'getrennt.stueck_mehr': { text: '{name}: ein Stück mehr', platzhalter: ['name'] },
  'getrennt.gegeben': { text: 'Gegeben (bar)' },
  'getrennt.gegeben_rueckgeld': { text: 'Gegeben {gegeben} · Rückgeld {rueckgeld}', platzhalter: ['gegeben', 'rueckgeld'] },
  'getrennt.bar_kassieren': { text: 'Bar' },
  'getrennt.karte_kassieren': { text: 'Karte' },

  // --- Zahlarten in Listen (Kassieren, Storno, Belegliste) -----------------
  'zahlart.kartenzahlung': { text: 'Kartenzahlung' },
  'zahlart.barzahlung': { text: 'Barzahlung' },
  // Beleg mit mehreren Zahlungen (`paymentMethod: 'mixed'` oder mehr als eine
  // Zahlung): weder Bar noch Karte, auch nicht im Filter.
  'zahlart.mehrere': { text: 'Mehrere' },

  // --- Storno eines Belegs mit mehreren Zahlungen --------------------------
  'storno.wie_zurueckgeben': { text: 'Wie zurückgeben?' },
  'storno.wie_bezahlt': { text: 'wie bezahlt' },
  'storno.bar': { text: 'bar' },
  'storno.alles_bar': { text: 'Alles bar' },
  'storno.rest_der_zahlung': { text: 'Rest {betrag}', platzhalter: ['betrag'] },
  'storno.differenz': { text: 'Differenz' },
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
