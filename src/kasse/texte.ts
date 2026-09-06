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

  // --- Kartenzahlung -------------------------------------------------------
  'kartenzahlung.nicht_moeglich': { text: 'Kartenzahlung nicht möglich.' },
  'kartenzahlung.nicht_zustande': { text: 'Die Kartenzahlung ist nicht zustande gekommen.' },
  'kartenzahlung.nicht_gestartet': { text: 'Kartenzahlung nicht gestartet: {grund}', platzhalter: ['grund'] },
  'kartenzahlung.unklar': { text: 'Unklar, ob die Kartenzahlung durchgegangen ist — die Verbindung zum Terminal riss ab. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird: die Karte kann belastet sein.' },
  // Die Kennung ist der einzige Anker, um die Zahlung am Terminal-Beleg wiederzufinden — liegt sie vor, gilt dieser Satz statt kartenzahlung.unklar.
  'kartenzahlung.unklar_mit_kennung': { text: 'Unklar, ob die Kartenzahlung durchgegangen ist — die Verbindung zum Terminal riss ab. Bitte am Terminal-Beleg nachsehen, BEVOR neu kassiert wird: die Karte kann belastet sein. Kennung der Zahlung: {kennung}.', platzhalter: ['kennung'] },
  'kartenzahlung.connect_nicht_verbunden': { text: 'Kartenzahlung nicht möglich: Kasseneck Connect ist nicht verbunden — Einstellungen → Kasseneck Connect.', nur: ['web'] },
  'terminal.keines_gefunden': { text: 'Kein Hobex-Terminal gefunden — ist es eingeschaltet und im selben Netz wie dieser Rechner?', nur: ['web'] },
  'terminal.nicht_bereit': { text: 'Terminal antwortet, ist aber nicht betriebsbereit: {antwort} — TID prüfen.', platzhalter: ['antwort'], nur: ['web'] },
  'gptom.app_fehlt': { text: 'Die GP-Tom-App ist auf diesem Gerät nicht da.', nur: ['app'] },
  'gptom.suche_fehlgeschlagen': { text: 'GP Tom: Suche nach der App fehlgeschlagen: {grund}', platzhalter: ['grund'], nur: ['app'] },
  'gptom.zahlung_fehlgeschlagen': { text: 'GP Tom: Zahlung fehlgeschlagen: {grund}', platzhalter: ['grund'], nur: ['app'] },
  'gptom.terminal_antwortet_nicht': { text: 'Das Terminal hat nicht geantwortet: {grund}', platzhalter: ['grund'], nur: ['app'] },
  'gptom.zahlung_nicht_abgeschlossen': { text: 'Die Zahlung wurde nicht abgeschlossen ({code}).', platzhalter: ['code'], nur: ['app'] },

  // --- Belege und Storno ---------------------------------------------------
  'belege.laden_fehlgeschlagen': { text: 'Die Belege konnten nicht geladen werden.' },
  'belege.keine_im_zeitraum': { text: 'Keine Belege in diesem Zeitraum.' },
  'beleg.laden_fehlgeschlagen': { text: 'Der Beleg konnte nicht geladen werden.' },
  'beleg.nicht_gefunden': { text: 'Der Beleg wurde nicht gefunden.' },
  'storno.fehlgeschlagen': { text: 'Das Storno ist fehlgeschlagen.' },
  'storno.grund_fehlt': { text: 'Bitte einen Grund wählen.' },
  'storno.position_fehlt': { text: 'Bitte mindestens eine Position wählen.' },

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
