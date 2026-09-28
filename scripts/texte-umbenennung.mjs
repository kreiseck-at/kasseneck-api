// Erzeugt fixtures/texte-umbenennung.json: die englischen Schluessel der
// Textkataloge (Kasse und Rechnung) zu den deutschen Schluesseln der 0.x-Linie.
//
// Die Tabelle entsteht aus Woertern, nicht aus einzelnen Schluesseln: jeder
// Bereich und jedes Wort eines Schluessels wird nach den Listen unten
// uebersetzt, ganze Namen nur dort, wo Wort fuer Wort kein Englisch ergibt
// (`GANZ_KASSE`). Ein Wort ohne Eintrag bricht ab, ebenso zwei alte
// Schluessel mit demselben neuen. Die Werte (deutsche Texte) bleiben, wie sie
// sind; das prueft `test/texte-umbenennung.test.ts` gegen den eingefrorenen
// Stand in `test/fixtures/texte-vor-1.0/`.
//
// Schreibweise wie bisher je Katalog: Kasse `bereich.name_mit_unterstrich`,
// Rechnung `bereich.teil.teil` mit Binnenmajuskel.
//
// Aufruf:
//   node scripts/texte-umbenennung.mjs            Tabelle schreiben
//   node scripts/texte-umbenennung.mjs <datei>…   zusaetzlich jeden alten
//                                                 Schluessel in Anfuehrungszeichen
//                                                 in den Dateien durch den neuen
//                                                 ersetzen (einmalig beim Umstieg)
import { readFileSync, writeFileSync } from 'node:fs';

const lies = (pfad) => JSON.parse(readFileSync(new URL(pfad, import.meta.url), 'utf8'));
const alt = {
  kasse: lies('../test/fixtures/texte-vor-1.0/kasse-texte.json'),
  rechnung: lies('../test/fixtures/texte-vor-1.0/rechnung-texte.json'),
};

// ---- Kasse ---------------------------------------------------------------------

const BEREICH_KASSE = {
  abmelden: 'logout',
  abschluss: 'completion',
  allgemein: 'common',
  anmeldung: 'login',
  app: 'app',
  artikel: 'articles',
  beleg: 'receipt',
  belege: 'receipts',
  bluetooth: 'bluetooth',
  connect: 'connect',
  druck: 'print',
  einstellungen: 'settings',
  entkopplung: 'unpairing',
  geraet: 'device',
  getrennt: 'split',
  gptom: 'gptom',
  kartenzahlung: 'card_payment',
  kasse: 'cashregister',
  kassieren: 'checkout',
  kopplung: 'pairing',
  logo: 'logo',
  meldung: 'message',
  netz: 'network',
  position: 'item',
  protokoll: 'log',
  rabatt: 'discount',
  rechte: 'permissions',
  server: 'server',
  sitzung: 'session',
  storno: 'cancellation',
  terminal: 'terminal',
  trinkgeld: 'tip',
  zahlart: 'payment_method',
};

/** Ganze Namen, bei denen Wort fuer Wort kein Englisch ergibt (Wortstellung, Redewendung). */
const GANZ_KASSE = {
  abgelaufen_ohne_netz: 'expired_offline',
  alles_abbrechen: 'cancel_all',
  alles_zurueckbuchen: 'reverse_all',
  am_terminal_zurueckgebucht: 'reversed_on_terminal',
  antwortet_nicht: 'not_responding',
  art_bar: 'method_cash',
  art_karte: 'method_card',
  davon_trinkgeld: 'of_which_tip',
  drucker_antwortet_nicht: 'printer_not_responding',
  erneut_zurueckbuchen: 'reverse_again',
  es_fehlen_noch: 'still_missing',
  gegeben_loeschen: 'clear_tendered',
  im_browser_oeffnen: 'open_in_browser',
  bar_zurueckgeben: 'return_cash',
  drucker_nicht_erreichbar: 'printer_unreachable',
  karte_vorhalten: 'present_card',
  karten_gutschreiben: 'credit_cards',
  karte_zurueckbuchen: 'reverse_card',
  keine: 'none',
  keine_verbindung: 'no_connection',
  keine_freigegeben: 'none_enabled',
  keine_gefunden: 'none_found',
  keines_gefunden: 'none_found',
  meldet_ab: 'logging_out',
  neu_koppeln: 'pair_again',
  noch_einmal: 'press_again',
  noch_nicht_geladen: 'not_loaded_yet',
  nur_chrome: 'chrome_only',
  positionen_waehlen: 'select_items',
  rest_der_zahlung: 'payment_remainder',
  stueck_mehr: 'one_more',
  stueck_weniger: 'one_less',
  summe_passt_nicht: 'sum_mismatch',
  terminal_antwortet_nicht: 'terminal_not_responding',
  terminal_bricht_ab: 'terminal_cancelling',
  trinkgeld_bezug: 'tip_basis',
  trotzdem_neu_koppeln: 'pair_again_anyway',
  warnung_ausblenden: 'dismiss_warning',
  weiter_arbeiten: 'keep_working',
  wie_bezahlt: 'as_paid',
  wie_zurueckgeben: 'how_to_refund',
  wird_abgeschlossen: 'completing',
  zahlung_behalten: 'keep_payment',
  zahlung_hinzufuegen: 'add_payment',
  zeit_abgelaufen: 'timeout',
  zeit_abgelaufen_mit_kennung: 'timeout_with_id',
  zu_viele_versuche: 'too_many_attempts',
  zu_viele_zahlungen: 'too_many_payments',
  zu_zahlen: 'to_pay',
  zurueck_zahlart: 'back_to_payment_method',
};

/** Woerter, die schon Englisch sind oder Eigennamen. */
const BLEIBT_KASSE = new Set(['app', 'browser', 'code', 'connect', 'ip', 'job', 'link', 'mail', 'pin', 'qr', 'terminal', 'test', 'text', 'wizard']);

const WORT_KASSE = {
  abbrechen: 'cancel',
  abgebrochen: 'cancelled',
  abgehakt: 'checked',
  abgelaufen: 'expired',
  abgelehnt: 'declined',
  abgeschlossen: 'completed',
  ablage: 'storage',
  adresse: 'address',
  aenderbar: 'changeable',
  alles: 'all',
  am: 'on',
  auf: 'for',
  aufteilung: 'allocation',
  aus: 'off',
  ausblenden: 'dismiss',
  ausgefallen: 'down',
  bar: 'cash',
  barzahlung: 'cash',
  belastet: 'charged',
  beleg: 'receipt',
  bereit: 'ready',
  bereits: 'already',
  bestaetigen: 'confirm',
  betrag: 'amount',
  bezahlt: 'paid',
  bezeichnung: 'description',
  bezug: 'reference',
  differenz: 'difference',
  drucker: 'printer',
  eigener: 'custom',
  einstellung: 'setting',
  entfernen: 'remove',
  entkoppeln: 'unpair',
  erfasst: 'entered',
  ergebnis: 'outcome',
  erledigen: 'resolve',
  erreichbar: 'reachable',
  extern: 'external',
  fehlen: 'missing',
  fehlgeschlagen: 'failed',
  fehlt: 'missing',
  frage: 'question',
  freigabe: 'permission',
  freigegeben: 'allowed',
  geaendert: 'changed',
  gebucht: 'charged',
  gefunden: 'found',
  gegeben: 'tendered',
  gekommen: 'arrived',
  gekoppelt: 'paired',
  geoeffnet: 'opened',
  gesendet: 'sent',
  gespeichert: 'saved',
  gesperrt: 'locked',
  gestartet: 'started',
  gewaehlt: 'selected',
  grund: 'reason',
  gutschreiben: 'credit',
  haelfte: 'half',
  hinweis: 'hint',
  hoch: 'high',
  hochladen: 'upload',
  im: 'in',
  installiert: 'installed',
  karte: 'card',
  karten: 'cards',
  kartenzahlung: 'card',
  kassieren: 'checkout',
  kein: 'no',
  keiner: 'none',
  keine: 'none',
  kennung: 'id',
  klaeren: 'clarify',
  knopf: 'button',
  kopiert: 'copied',
  korb: 'cart',
  laden: 'load',
  laeuft: 'running',
  leer: 'empty',
  mehrere: 'multiple',
  mit: 'with',
  moeglich: 'possible',
  nicht: 'not',
  nichts: 'nothing',
  noch: 'still',
  nullbeleg: 'zero_receipt',
  offen: 'open',
  offene: 'open',
  oft: 'often',
  ohne: 'without',
  passend: 'exact',
  position: 'item',
  positionen: 'items',
  prozent: 'percent',
  rest: 'remaining',
  rueckgabe: 'refund',
  rueckgeld: 'change',
  signatur: 'signature',
  sitzung: 'session',
  speicher: 'storage',
  speichern: 'save',
  steuersatz: 'vat_rate',
  stueck: 'pieces',
  suche: 'search',
  tab: 'tab',
  teilbar: 'shareable',
  teilen: 'share',
  testdruck: 'test_print',
  titel: 'title',
  trinkgeld: 'tip',
  ueber: 'over',
  unbekannt: 'unknown',
  unerwartet: 'unexpected',
  ungueltig: 'invalid',
  unklar: 'unknown',
  unlesbar: 'unreadable',
  unvollstaendig: 'incomplete',
  ursprung: 'origin',
  verbinden: 'connect',
  verbindung: 'connection',
  verbunden: 'connected',
  viele: 'many',
  vorhanden: 'exists',
  waehlen: 'select',
  wartet: 'waiting',
  wechsel: 'switch',
  weg: 'channel',
  weiter: 'continue',
  wenig: 'little',
  wurde: 'was',
  zahlart: 'payment_method',
  zahlung: 'payment',
  zahlungen: 'payments',
  zeitablauf: 'timeout',
  zeitraum: 'period',
  zu: 'too',
  zurueckbuchen: 'reverse',
  zurueckgeben: 'return',
  zurueckgebucht: 'reversed',
  zustande: 'completed',
};

// Einzelwoerter, deren Bedeutung am Bereich haengt: „teilen" heisst beim
// Getrennt-Zahlen „durch n teilen", sonst „teilen" (Link weitergeben).
// „kein" ist an der Kasse die Taste „kein Trinkgeld".
const GANZ_JE_BEREICH_KASSE = {
  'getrennt.teilen': 'divide',
  'kassieren.kein': 'no_tip',
};

function kasseSchluessel(schluessel) {
  const [bereich, ...rest] = schluessel.split('.');
  const neuBereich = BEREICH_KASSE[bereich];
  if (!neuBereich) throw new Error(`Kasse: Bereich ohne Uebersetzung: ${bereich} (${schluessel})`);
  if (rest.length !== 1) throw new Error(`Kasse: erwartet bereich.name: ${schluessel}`);
  const name = rest[0];
  const ganz = GANZ_JE_BEREICH_KASSE[schluessel] ?? GANZ_KASSE[name];
  if (ganz) return `${neuBereich}.${ganz}`;
  const woerter = name.split('_').map((wort) => {
    if (BLEIBT_KASSE.has(wort)) return wort;
    const neu = WORT_KASSE[wort];
    if (!neu) throw new Error(`Kasse: Wort ohne Uebersetzung: ${wort} (${schluessel})`);
    return neu;
  });
  return `${neuBereich}.${woerter.join('_')}`;
}

// ---- Rechnung ------------------------------------------------------------------

/**
 * Codes, die schon Englisch sind und so bleiben muessen, weil ein Aufrufer den
 * Schluessel aus ihnen zusammensetzt: Einheiten (`INVOICE_UNITS`),
 * Reverse-Charge-Gruende, Gutschrift-Gruende, Zahlungsarten, Laender.
 */
const BLEIBT_RECHNUNG = new Set([
  'bag', 'bottle', 'box', 'can', 'carton', 'centimetre', 'cubic_metre', 'day', 'device', 'dozen', 'flat_rate',
  'gigabyte', 'gram', 'half_year', 'hectare', 'hour', 'kilogram', 'kilometre', 'kilowatt_hour', 'licence', 'litre',
  'megawatt_hour', 'metre', 'milligram', 'millilitre', 'millimetre', 'minute', 'month', 'night', 'package', 'page',
  'pair', 'pallet', 'person', 'piece', 'quarter', 'roll', 'running_metre', 'second', 'session', 'set', 'sheet',
  'square_metre', 'terabyte', 'tonne', 'trip', 'user', 'week', 'year',
  'construction', 'scrap', 'mobile_devices', 'it_devices', 'metals', 'emission_certificates', 'gas_electricity',
  'energy_certificates', 'investment_gold', 'security_transfer', 'foreign_supplier',
  'cancellation', 'price_reduction', 'return', 'incorrect_invoice', 'other',
  'cash', 'transfer', 'card', 'online',
  'AT', 'DE', 'CH', 'IT', 'LI',
  'pdf', 'einvoice', 'meta', 'text', 'iban', 'bic', 'qr', 'status', 'link', 'register', 'pos',
  'reverseCharge', 'outsideScope', 'domestic',
]);

const TEIL_RECHNUNG = {
  am: 'date',
  ausfuhr: 'exportThirdCountry',
  befreiung: 'exemption',
  beschreibung: 'description',
  betrag: 'amount',
  betragBrutto: 'amountGross',
  betragNetto: 'amountNet',
  bezahlt: 'paid',
  bezeichnung: 'label',
  bezug: 'reference',
  darinUst: 'includedVat',
  datum: 'date',
  einheit: 'unit',
  einheitName: 'unitName',
  einleitung: 'intro',
  einzelBrutto: 'unitGross',
  einzelNetto: 'unitNet',
  einzugAm: 'collectionDate',
  empfaenger: 'recipient',
  erstattung: 'refund',
  faelligkeit: 'dueDate',
  fuss: 'footer',
  gesamt: 'grandTotal',
  grund: 'reason',
  gutschrift: 'creditNote',
  hinweis: 'note',
  hinweisBis: 'noteUntil',
  igLieferung: 'intraCommunitySupply',
  kleinunternehmer: 'smallBusiness',
  konto: 'account',
  kontakt: 'contact',
  kopie: 'copy',
  land: 'country',
  lastschrift: 'directDebit',
  leistungszeitraum: 'servicePeriod',
  mandatVom: 'mandateDate',
  mandatsreferenz: 'mandateReference',
  menge: 'quantity',
  nummer: 'number',
  passwort: 'password',
  pille: 'badge',
  position: 'item',
  rabatt: 'discount',
  rcGrund: 'rcReason',
  rechnung: 'invoice',
  seite: 'page',
  sitz: 'registeredOffice',
  steuer: 'tax',
  summe: 'totals',
  tabelle: 'table',
  titel: 'title',
  uid: 'vatId',
  uidZeile: 'vatIdLine',
  umsatzsteuer: 'vat',
  ust: 'vat',
  verwendungszweck: 'paymentReference',
  vom: 'dated',
  warnung: 'warning',
  zahlbarBis: 'payableUntil',
  zahlung: 'payment',
  zahlungsart: 'paymentMethod',
  zwischensumme: 'subtotal',
};

function rechnungSchluessel(schluessel) {
  return schluessel.split('.').map((teil) => {
    if (BLEIBT_RECHNUNG.has(teil)) return teil;
    const neu = TEIL_RECHNUNG[teil];
    if (!neu) throw new Error(`Rechnung: Teil ohne Uebersetzung: ${teil} (${schluessel})`);
    return neu;
  }).join('.');
}

// ---- Tabelle -------------------------------------------------------------------

function tabelle(schluessel, uebersetze, katalog) {
  const raus = {};
  const vergeben = new Map();
  for (const alterSchluessel of schluessel) {
    const neu = uebersetze(alterSchluessel);
    if (vergeben.has(neu)) {
      throw new Error(`${katalog}: ${alterSchluessel} und ${vergeben.get(neu)} ergaeben beide ${neu}`);
    }
    vergeben.set(neu, alterSchluessel);
    raus[alterSchluessel] = neu;
  }
  return raus;
}

const umbenennung = {
  _hinweis:
    'Alte (0.x) und neue (1.0) Schluessel der Textkataloge. Erzeugt von scripts/texte-umbenennung.mjs, nicht von Hand pflegen. Die Werte bleiben byte-gleich.',
  kasse: {
    meldungen: tabelle(Object.keys(alt.kasse.meldungen), kasseSchluessel, 'Kasse/Meldungen'),
    beschriftungen: tabelle(Object.keys(alt.kasse.beschriftungen), kasseSchluessel, 'Kasse/Beschriftungen'),
  },
  rechnung: tabelle(Object.keys(alt.rechnung.texte.de), rechnungSchluessel, 'Rechnung'),
};

writeFileSync(new URL('../fixtures/texte-umbenennung.json', import.meta.url), JSON.stringify(umbenennung, null, 2) + '\n');
console.log('Umbenennung geschrieben:',
  Object.keys(umbenennung.kasse.meldungen).length, 'Meldungen,',
  Object.keys(umbenennung.kasse.beschriftungen).length, 'Beschriftungen,',
  Object.keys(umbenennung.rechnung).length, 'Rechnungstexte');

// ---- Quelltexte umschreiben (einmalig) -------------------------------------------

const dateien = process.argv.slice(2);
if (dateien.length) {
  const alles = { ...umbenennung.kasse.meldungen, ...umbenennung.kasse.beschriftungen, ...umbenennung.rechnung };
  for (const datei of dateien) {
    const vorher = readFileSync(datei, 'utf8');
    let ersetzt = 0;
    const nachher = vorher.replace(/(['"])([A-Za-z][A-Za-z_]*(?:\.[A-Za-z0-9_]+)+)\1/g, (treffer, zeichen, schluessel) => {
      const neu = alles[schluessel];
      if (neu === undefined) return treffer;
      ersetzt += 1;
      return `${zeichen}${neu}${zeichen}`;
    });
    writeFileSync(datei, nachher);
    console.log(datei, ersetzt, 'ersetzt');
  }
}
