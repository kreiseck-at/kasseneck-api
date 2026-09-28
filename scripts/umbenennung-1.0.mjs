// Erzeugt fixtures/renames-1.0.json: was in den Vertragsdateien seit 1.0
// anders heisst. Dateipfade (`files`), die Schluessel der Textkataloge
// (`texts`), die Platzhalter in den Texten (`placeholders`) und die
// Strukturschluessel (`structure`), jeweils von der 0.x-Linie auf 1.0.
//
// Die Katalogschluessel:
// Die Tabelle entsteht aus Woertern, nicht aus einzelnen Schluesseln: jeder
// Bereich und jedes Wort eines Schluessels wird nach den Listen unten
// uebersetzt, ganze Namen nur dort, wo Wort fuer Wort kein Englisch ergibt
// (`GANZ_KASSE`). Ein Wort ohne Eintrag bricht ab, ebenso zwei alte
// Schluessel mit demselben neuen. Die Werte (deutsche Texte) bleiben, wie sie
// sind bis auf die Platzhalter; das prueft `test/umbenennung-1.0.test.ts`
// gegen den eingefrorenen Stand in `test/fixtures/vor-1.0/`.
//
// Eine Schreibweise fuer beide Kataloge: jeder Teil klein mit Unterstrich
// (`bereich.name_mit_unterstrich`), einzige Ausnahme sind Laendercodes
// (`country.AT`). Der Erzeuger prueft das an jedem neuen Schluessel.
//
// Aufruf:
//   node scripts/umbenennung-1.0.mjs              Tabelle schreiben
//   node scripts/umbenennung-1.0.mjs <datei>...   zusaetzlich in den Dateien jeden
//                                                 alten Katalogschluessel und
//                                                 Platzhalter ersetzen (einmalig)
//   node scripts/umbenennung-1.0.mjs --umziehen   Dateien unter fixtures/ auf die
//                                                 neuen Pfade und Schluessel
//                                                 bringen (einmalig, streng)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const lies = (pfad) => JSON.parse(readFileSync(new URL(pfad, import.meta.url), 'utf8'));
const alt = {
  kasse: lies('../test/fixtures/vor-1.0/kasse-texte.json'),
  rechnung: lies('../test/fixtures/vor-1.0/rechnung-texte.json'),
  faelle: lies('../test/fixtures/vor-1.0/kasse-meldungen-faelle.json'),
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
  karten_gutschreiben: 'refund_cards',
  kein_weg_drucker: 'no_printer_for_channel',
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
 * Reverse-Charge-Gruende, Gutschrift-Gruende, Zahlungsarten, Laender. Dazu
 * Woerter, die schon englisch und klein sind.
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
]);

/**
 * Teile der Rechnungsschluessel. Steuertexte tragen den Steuerfall in
 * Schreibweise der Schluessel (`intra_community_supply` zu `intraCommunitySupply`).
 */
const TEIL_RECHNUNG = {
  am: 'date',
  ausfuhr: 'export_third_country',
  befreiung: 'exemption',
  beschreibung: 'description',
  betrag: 'amount',
  betragBrutto: 'amount_gross',
  betragNetto: 'amount_net',
  bezahlt: 'paid',
  bezeichnung: 'label',
  bezug: 'reference',
  darinUst: 'included_vat',
  datum: 'date',
  domestic: 'domestic_reverse_charge',
  einheit: 'unit_symbol',
  einheitName: 'unit_name',
  einleitung: 'intro',
  einzelBrutto: 'unit_gross',
  einzelNetto: 'unit_net',
  einzugAm: 'collection_date',
  empfaenger: 'recipient',
  erstattung: 'refund',
  faelligkeit: 'due_date',
  fuss: 'footer',
  gesamt: 'grand_total',
  grund: 'reason',
  gutschrift: 'credit_note',
  hinweis: 'note',
  hinweisBis: 'note_until',
  igLieferung: 'intra_community_supply',
  kleinunternehmer: 'small_business',
  konto: 'account',
  kontakt: 'contact',
  kopie: 'copy',
  land: 'country',
  lastschrift: 'direct_debit',
  leistungszeitraum: 'service_period',
  mandatVom: 'mandate_date',
  mandatsreferenz: 'mandate_reference',
  menge: 'quantity',
  nummer: 'number',
  outsideScope: 'outside_scope',
  passwort: 'password',
  pille: 'badge',
  position: 'item',
  rabatt: 'discount',
  rcGrund: 'reverse_charge_reason',
  rechnung: 'invoice',
  reverseCharge: 'reverse_charge',
  seite: 'page',
  sitz: 'registered_office',
  steuer: 'tax',
  summe: 'totals',
  tabelle: 'table',
  titel: 'title',
  uid: 'vat_id',
  uidZeile: 'vat_id_line',
  umsatzsteuer: 'vat',
  ust: 'vat',
  verwendungszweck: 'payment_reference',
  vom: 'dated',
  warnung: 'warning',
  zahlbarBis: 'payable_until',
  zahlung: 'payment',
  zahlungsart: 'payment_method',
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
    for (const teil of neu.split('.')) {
      if (!/^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|[A-Z]{2})$/.test(teil)) {
        throw new Error(`${katalog}: ${neu} verlaesst die Schreibweise (${teil})`);
      }
    }
    if (vergeben.has(neu)) {
      throw new Error(`${katalog}: ${alterSchluessel} und ${vergeben.get(neu)} ergaeben beide ${neu}`);
    }
    vergeben.set(neu, alterSchluessel);
    raus[alterSchluessel] = neu;
  }
  return raus;
}


// ---- Platzhalter ---------------------------------------------------------------
//
// Seit 1.0 heissen auch die Platzhalter in den Texten englisch (`{betrag}` ->
// `{amount}`). Der Satz, der am Bildschirm oder im PDF entsteht, bleibt
// Zeichen fuer Zeichen derselbe; das prueft test/umbenennung-1.0.test.ts,
// indem es jeden Text alt und neu mit denselben Werten fuellt.
// Kassentexte erlauben nur Kleinbuchstaben (`messageText`), Rechnungstexte
// auch Grossbuchstaben (`invoiceText`).

const PLATZHALTER = {
  an: 'recipient',
  antwort: 'response',
  beleg: 'receipt',
  betrag: 'amount',
  betrieb: 'business',
  code: 'code',
  datum: 'date',
  gegeben: 'tendered',
  gesamt: 'total',
  grund: 'reason',
  kaeufer: 'buyer',
  kennung: 'reference',
  link: 'link',
  meldung: 'message',
  n: 'n',
  name: 'name',
  netto: 'net',
  nummer: 'number',
  offen: 'open',
  ort: 'place',
  prozent: 'percent',
  rueckgeld: 'change',
  satz: 'rate',
  sekunden: 'seconds',
  status: 'status',
  uid: 'vatId',
  verkaeufer: 'seller',
  weg: 'channel',
  zeit: 'time',
  ziel: 'target',
};

/** Alle Schluessel einer Ebene: jeder alte genau einmal, sonst Abbruch. */
function deckt(name, zuordnung, alteSchluessel) {
  const fehlt = [...new Set(alteSchluessel)].filter((s) => !(s in zuordnung));
  const tot = Object.keys(zuordnung).filter((s) => !alteSchluessel.includes(s));
  if (fehlt.length || tot.length) throw new Error(`${name}: fehlt ${fehlt.join(', ') || '-'}; zu viel ${tot.join(', ') || '-'}`);
}

const namenIn = (text) => [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]);

function platzhalter() {
  const kasse = [...Object.values(alt.kasse.meldungen), ...Object.values(alt.kasse.beschriftungen)].flatMap((e) => namenIn(e.text));
  const rechnung = Object.values(alt.rechnung.texte).flatMap((t) => Object.values(t).flatMap(namenIn));
  deckt('Platzhalter', PLATZHALTER, [...kasse, ...rechnung]);
  const neu = Object.values(PLATZHALTER);
  if (new Set(neu).size !== neu.length) throw new Error('Platzhalter: ein neuer Name ist doppelt vergeben');
  for (const n of new Set(kasse)) if (!/^[a-z]+$/.test(PLATZHALTER[n])) throw new Error(`Platzhalter ${n}: Kassentexte kennen nur Kleinbuchstaben`);
  return PLATZHALTER;
}

// ---- Dateien -------------------------------------------------------------------
//
// Jede Datei unter fixtures/ der 0.x-Linie (eingefroren in
// test/fixtures/vor-1.0/fixtures-0.x.json, Stand 0.31.0) bekommt genau einen
// neuen Pfad. Ein Pfad, den die Listen nicht kennen, bricht ab. Dateien, die
// erst mit 1.0 kamen, stehen nicht hier.

const DATEIEN = {
  'hobex-hps-codes.json': 'hobex-hps-codes.json',
  'kasse-meldungen-faelle.json': 'pos-message-cases.json',
  'kasse-settings-standard.json': 'pos-settings-defaults.json',
  'kasse-texte.json': 'pos-texts.json',
  'manifest.json': 'manifest.json',
  'oberflaeche.json': 'surface.json',
  'position-aus-euro.json': 'item-from-euro.json',
  'rechnung-api.schema.json': 'invoice-api.schema.json',
  'rechnung-rechnen-zufall.json': 'invoice-calc-random.json',
  'rechnung-rechnen.json': 'invoice-calc.json',
  'rechnung-summen.json': 'invoice-totals.json',
  'rechnung-texte.json': 'invoice-texts.json',
};

/** Namen der Golden-Belege (fixtures/belege -> fixtures/receipts, ebenso unter erwartet/). */
const BELEGE = {
  'karte-eigener': 'card-custom',
  'karte-gptom': 'card-gptom',
  'karte-gptom-ios': 'card-gptom-ios',
  'karte-hobex-cloud': 'card-hobex-cloud',
  'karte-hobex-hps': 'card-hobex-hps',
  'karte-mypos': 'card-mypos',
  'karte-stripe': 'card-stripe',
  'karte-stripe-eps': 'card-stripe-eps',
  'karte-sumup': 'card-sumup',
  'langer-artikelname': 'long-item-name',
  'null-ausfall': 'zero-outage-end',
  'null-jahr': 'zero-annual',
  'null-monat': 'zero-monthly',
  'null-pruef': 'zero-manual',
  'null-schluss': 'zero-final',
  'null-start': 'zero-start',
  'rabatt-chef-trinkgeld': 'discount-owner-tip',
  'rabatt-einfach': 'discount-simple',
  'rabatt-trinkgeld': 'discount-tip',
  'rabatt-wertgutschein': 'discount-value-voucher',
  'rabattzeilen': 'discount-lines',
  'signaturausfall-verkauf': 'signature-outage-sale',
  'split-bar-rueckgeld': 'split-cash-change',
  'split-eine-karte-trinkgeld': 'split-one-card-tip',
  'split-karte-karte-bar': 'split-card-card-cash',
  'split-langer-betrag': 'split-long-amount',
  'split-tischrunde-trinkgeld': 'split-table-round-tip',
  'split-trinkgeld-karte': 'split-tip-card',
  'split-zwei-karten-gleicher-anbieter': 'split-two-cards-same-provider',
  'storno-rabatt': 'cancellation-discount',
  'storno-split-teil': 'cancellation-split-partial',
  'storno-split-voll': 'cancellation-split-full',
  'storno-teil': 'cancellation-partial',
  'storno-voll': 'cancellation-full',
  'testkasse-verkauf': 'test-cashregister-sale',
  'testsignatur-verkauf': 'test-signature-sale',
  'training': 'training',
  'verkauf-bar': 'sale-cash',
  'verkauf-karte': 'sale-card',
  'verkauf-kleinunternehmer': 'sale-small-business',
};

/** Endungen unter erwartet/ (Zeilen, Raster, Blatt). */
const ENDUNGEN = {
  '.lines.json': '.lines.json',
  '.grid32.txt': '.grid32.txt',
  '.grid48.txt': '.grid48.txt',
  '.blatt32.json': '.sheet32.json',
  '.blatt48.json': '.sheet48.json',
};

/** Logo-Proben unter erwartet/. */
const LOGO_PROBEN = {
  'logo-probe.raster32.txt': 'logo-sample.raster32.txt',
  'logo-probe-hoch.raster32.txt': 'logo-sample-tall.raster32.txt',
};

/** Beispiele der Rechnungs-API (fixtures/rechnung-api-beispiele -> fixtures/invoice-api-examples). */
const BEISPIELE = {
  'brands-ok': 'brands-ok',
  'credit-fehler-grund': 'credit-error-reason',
  'credit-ok': 'credit-ok',
  'customer-fehler-uid': 'customer-error-vat-id',
  'customer-get-fehler-beide': 'customer-get-error-both',
  'customer-ok': 'customer-ok',
  'customer-search-fehler-leer': 'customer-search-error-empty',
  'issue-bezahlt': 'issue-paid',
  'issue-brutto-20': 'issue-gross-20',
  'issue-englisch': 'issue-english',
  'issue-fehler-cent': 'issue-error-cent',
  'issue-fehler-einheit': 'issue-error-unit',
  'issue-fehler-menge': 'issue-error-quantity',
  'issue-fehler-negativ': 'issue-error-negative',
  'issue-fehler-preis-beide': 'issue-error-price-both',
  'issue-fehler-preis-fehlt': 'issue-error-price-missing',
  'issue-fehler-satz': 'issue-error-rate',
  'issue-fehler-sprache': 'issue-error-language',
  'issue-fehler-unbekannt': 'issue-error-unknown',
  'issue-fehler-zahlungsart': 'issue-error-payment-method',
  'issue-gemischt': 'issue-mixed',
  'issue-kleinunternehmer': 'issue-small-business',
  'issue-mikropreis': 'issue-micro-price',
  'issue-netto-20': 'issue-net-20',
  'issue-rabatt': 'issue-discount',
  'setup-status-fehler-feld': 'setup-status-error-field',
  'setup-status-ok': 'setup-status-ok',
  'zahlung-fehler-ohne-schluessel': 'payment-error-without-key',
  'zahlung-fehler-vor-ort': 'payment-error-on-site',
  'zahlung-nachtrag': 'payment-recorded-later',
};

function nachschlagen(liste, schluessel, wo) {
  const neu = liste[schluessel];
  if (neu === undefined) throw new Error(`${wo}: ${schluessel} steht in keiner Liste`);
  return neu;
}

/** Neuer Pfad (relativ zu fixtures/) eines Pfads vor 1.0; unbekannt bricht ab. */
export function neuerPfad(pfad) {
  if (pfad in DATEIEN) return DATEIEN[pfad];
  let m = /^belege\/([^/]+)\.json$/.exec(pfad);
  if (m) return `receipts/${nachschlagen(BELEGE, m[1], pfad)}.json`;
  m = /^rechnung-api-beispiele\/([^/]+)\.json$/.exec(pfad);
  if (m) return `invoice-api-examples/${nachschlagen(BEISPIELE, m[1], pfad)}.json`;
  m = /^erwartet\/([^/]+)$/.exec(pfad);
  if (m) {
    if (m[1] in LOGO_PROBEN) return `expected/${LOGO_PROBEN[m[1]]}`;
    const endung = Object.keys(ENDUNGEN).find((e) => m[1].endsWith(e));
    if (!endung) throw new Error(`${pfad}: unbekannte Endung`);
    return `expected/${nachschlagen(BELEGE, m[1].slice(0, -endung.length), pfad)}${ENDUNGEN[endung]}`;
  }
  throw new Error(`${pfad}: steht in keiner Liste`);
}

function dateien() {
  const liste = lies('../test/fixtures/vor-1.0/fixtures-0.x.json').dateien;
  const raus = {};
  const vergeben = new Map();
  for (const pfad of liste) {
    const neu = neuerPfad(pfad);
    if (vergeben.has(neu)) throw new Error(`${pfad} und ${vergeben.get(neu)} ergaeben beide ${neu}`);
    for (const teil of neu.split('/')) if (!/^[a-z0-9][a-z0-9.-]*$/.test(teil)) throw new Error(`${neu}: Schreibweise`);
    vergeben.set(neu, pfad);
    raus[pfad] = neu;
  }
  // Keine tote Zeile in den Listen.
  const genutzt = new Set(liste.map((p) => p.replace(/^(belege|rechnung-api-beispiele)\/|\.json$|^erwartet\/|(\.lines\.json|\.grid(32|48)\.txt|\.blatt(32|48)\.json)$/g, '')));
  for (const [name, liste2] of [['BELEGE', BELEGE], ['BEISPIELE', BEISPIELE]]) {
    for (const s of Object.keys(liste2)) if (!genutzt.has(s)) throw new Error(`${name}: ${s} gibt es nicht`);
  }
  for (const s of Object.keys(DATEIEN)) if (!liste.includes(s)) throw new Error(`DATEIEN: ${s} gibt es nicht`);
  return raus;
}

// ---- Struktur, Werte, Formen ----------------------------------------------------
//
// `structure`: reine Umbenennungen von Schluesseln, je (neue) Datei bzw.
// Dateigruppe und Ebene; jede Ebene nennt jeden alten Schluessel, auch die,
// die bleiben. `values`: umbenannte Maschinenwerte (Enums, Codes). `shapes`:
// wo sich die Form aendert (Liste wird Objekt, Abschnitt aufgeteilt).
// `removed`: Schluessel, die es in 1.0 nicht mehr gibt, mit Grund.
// test/umbenennung-1.0.test.ts haelt das gegen den eingefrorenen Bestand
// von 0.31.0 (test/fixtures/vor-1.0/fixtures-0.x.json): jeder Schluessel, der
// dort steht und in 1.0 fehlt, steht hier.
//
// Die Einstellungen der Kasse sind in 0.x die gespeicherte (innere) Form;
// ihre Namen und Werte kommen aus dem Vertrags-Export des Backends
// (fixtures/v3/v3-vokabular.json: Schema getKasseSettings, Kataloge
// KASSE_BETRIEB_WERTE/KASSE_GERAET_WERTE), nicht aus einer Zweitliste hier.

const VOKABULAR = lies('../fixtures/v3/v3-vokabular.json');
const BESTAND_0X = lies('../test/fixtures/vor-1.0/fixtures-0.x.json');
/** Alle Schluessel, die eine Datei der 0.x-Linie trug (eingefrorener Bestand). */
const SCHLUESSEL_0X = (datei) => new Set(BESTAND_0X.schluesselMengen[BESTAND_0X.schluesselJeDatei[datei]]);

/** Eine Ebene des Einstellungs-Schemas: innen -> aussen (Unterobjekte unter ihrem `__`-Namen). */
function schemaEbene(knoten) {
  return Object.fromEntries(Object.entries(knoten).filter(([k]) => k !== '__').map(([aussen, innen]) => [typeof innen === 'string' ? innen : innen.__, aussen]));
}
const SCHEMA = VOKABULAR.schemas.getKasseSettings.data;
const EINSTELLUNGEN = {
  file: { [SCHEMA.business.__]: 'business', [SCHEMA.device.__]: 'device' },
  business: schemaEbene(SCHEMA.business),
  device: schemaEbene(SCHEMA.device),
  shortcuts: schemaEbene(SCHEMA.device.shortcuts),
};
/** Werte der Einstellungen je (neuem) Feldnamen: innen -> aussen. */
const EINSTELLUNGS_WERTE = Object.fromEntries(Object.entries(VOKABULAR.catalogs)
  .filter(([name]) => /^KASSE_(BETRIEB|GERAET)_WERTE\./.test(name))
  .map(([name, werte]) => [name.split('.')[1], werte]));

const RECHNUNG_REGEL = { zeile: 'line', net: 'net', gross: 'gross', steuerfrei: 'taxExempt', rundung: 'rounding' };
const STEUERFALL = { igLieferung: 'intraCommunitySupply' };

const STRUKTUR = {
  'pos-texts.json': {
    file: { version: 'version', meldungen: 'messages', fehlerregeln: 'errorRules', belegMailFehler: 'receiptEmailErrors', stornoZahlungFehler: 'cancellationPaymentErrors', beschriftungen: 'labels' },
    entry: { text: 'text', platzhalter: 'placeholders', nur: 'only' },
    errorRule: { art: 'kind', verhalten: 'behavior', schluessel: 'key' },
    // Schluessel sind Fehlercodes des Backends: unter /v3 englisch (v3-vokabular errorCodes).
    receiptEmailErrors: { adresse_ungueltig: 'invalid_address', zu_oft: 'too_many_requests', versand_fehlgeschlagen: 'send_failed', beleg_nicht_gefunden: 'receipt_not_found' },
    cancellationPaymentErrors: {
      STORNO_PAYMENTS_REQUIRED: 'cancellation_payments_required',
      STORNO_REFUND_EXCEEDS_PAYMENT: 'cancellation_refund_exceeds_payment',
      STORNO_REFUND_REFERENCE_REQUIRED: 'cancellation_refund_reference_required',
      STORNO_REFUND_REFERENCE_UNKNOWN: 'cancellation_refund_reference_unknown',
      PAYMENTS_SUM_MISMATCH: 'payments_sum_mismatch',
      STORNO_OUTCOME_UNKNOWN: 'cancellation_outcome_unknown',
    },
  },
  'invoice-texts.json': {
    file: { version: 'version', sprachen: 'languages', texte: 'texts', einheiten: 'units' },
  },
  'pos-message-cases.json': {
    file: { version: 'version', faelle: 'cases' },
    case: { name: 'name', fehler: 'error', ersatz: 'fallback', erwartet: 'expected' },
    error: { art: 'kind', serverMessage: 'serverMessage', text: 'text', status: 'status' },
    expected: { schluessel: 'key', werte: 'values' },
  },
  'pos-settings-defaults.json': EINSTELLUNGEN,
  'surface.json': {
    file: { version: 'version', enums: 'enums', rechte: 'registerPerms', tastenAktionen: 'posShortcutActions', partner: 'partner', rechnung: 'invoice' },
    // Schluessel = Feld der Einstellungen, innen -> aussen wie oben; nur
    // die Felder, die 0.x dort als Enum fuehrte.
    enums: Object.fromEntries(Object.entries({ ...EINSTELLUNGEN.business, ...EINSTELLUNGEN.device }).filter(([innen]) => SCHLUESSEL_0X('oberflaeche.json').has(innen))),
    partner: {
      betriebFelder: 'businessFields', partnerEnvs: 'partnerEnvs', partnerFehlerCodes: 'partnerErrorCodes', partnerPortalFehlerCodes: 'partnerPortalErrorCodes',
      partnerWebhookEvents: 'partnerWebhookEvents', webhookRetryPlanSec: 'webhookRetryPlanSec', webhookUmschlagFelder: 'webhookEnvelopeFields',
    },
    invoice: { rechnungAufrufe: 'invoiceEndpoints', steuerfreieFaelle: 'zeroRatedTaxSchemes' },
  },
  'manifest.json': {
    file: { regelwerk: 'ruleset', belege: 'receipts', logoProbe: 'logoSample' },
    receipt: { eingabe: 'input', erwartet: 'expected', grid32: 'grid32', grid48: 'grid48', blatt32: 'sheet32', blatt48: 'sheet48' },
    logoSample: { raster32: 'raster32', hoch32: 'tall32' },
  },
  'receipts/*.json': {
    company: { uid: 'vatId', taxnr: 'taxNumber' },
    options: { testKasse: 'testCashregister', testSignatur: 'testSignature', pruefangaben: 'registrationInfo' },
    registrationInfo: { karteRegistriertAm: 'cardRegisteredAt', kasseRegistriertAm: 'cashregisterRegisteredAt' },
  },
  'expected/*.lines.json': {
    layout: { regelwerk: 'ruleset' },
    line: { ton: 'tone' },
  },
  'expected/*.sheet*.json': {
    sheet: { zeichen: 'charsPerLine', bloecke: 'blocks' },
    block: { art: 'kind', breiteAnteil: 'widthFraction', hoeheZeilen: 'heightLines', fett: 'bold', leer: 'blank', nutzlast: 'payload' },
    size: { breite: 'width', hoehe: 'height' },
  },
  'hobex-hps-codes.json': {
    file: { version: 'version', gemessenAn: 'measuredOn', ergaenztAn: 'supplementedOn', dokumentiert: 'documented', codes: 'codes', gruende: 'reasons', terminalBusyHttpStatus: 'terminalBusyHttpStatus' },
    terminal: { tid: 'tid', hpsVersion: 'hpsVersion', firmware: 'firmware', zeitraum: 'period', codes: 'codes' },
    documented: { quelle: 'source', erhalten: 'received', kennzeichen: 'field' },
  },
  'item-from-euro.json': {
    file: { beschreibung: 'description', regel: 'rule', faelle: 'cases' },
    case: { name: 'name', item: 'item', erwartet: 'expected' },
    expected: { position: 'item', feld: 'field', grund: 'reason' },
  },
  'invoice-calc.json': {
    file: { beschreibung: 'description', regel: 'rule', faelle: 'cases' },
    rule: { ...RECHNUNG_REGEL, zeilen: 'lines' },
    case: { name: 'name', priceMode: 'priceMode', taxScheme: 'taxScheme', positionen: 'items', erwartet: 'expected' },
  },
  'invoice-calc-random.json': {
    file: { beschreibung: 'description', seed: 'seed', anzahl: 'count', regel: 'rule', faelle: 'cases' },
    rule: { ...RECHNUNG_REGEL, zeilen: 'lines' },
    case: { name: 'name', priceMode: 'priceMode', taxScheme: 'taxScheme', positionen: 'items', erwartet: 'expected' },
  },
  'invoice-totals.json': {
    file: { beschreibung: 'description', regel: 'rule', faelle: 'cases' },
    rule: RECHNUNG_REGEL,
    case: { name: 'name', priceMode: 'priceMode', taxScheme: 'taxScheme', items: 'items', erwartet: 'expected' },
  },
  'invoice-api-examples/*.json': {
    file: { aufruf: 'endpoint', beschreibung: 'description', anfrage: 'request', erwartet: 'expected' },
  },
  'invoice-api.schema.json': {
    file: { $schema: '$schema', title: 'title', version: 'version', paket: 'package', aufrufe: 'endpoints', codes: 'codes', gruende: 'creditNoteReasons' },
    endpoint: { anfrage: 'request', genauEins: 'exactlyOne', mindestensEins: 'atLeastOne' },
  },
};

/** Umbenannte Maschinenwerte: Datei(gruppe) -> Ort -> alt -> neu. */
const WERTE = {
  'pos-texts.json': {
    'errorRules[].kind': { api: 'api', klartext: 'plain_text', zeitablauf: 'timeout', netz: 'network', unerwartet: 'unexpected', sonst: 'other' },
    'errorRules[].behavior': { server_text: 'server_text', eigener_text: 'own_text', ersatz: 'fallback' },
  },
  'pos-message-cases.json': {
    'cases[].error.kind': { api: 'api', klartext: 'plain_text', zeitablauf: 'timeout', netz: 'network', unerwartet: 'unexpected', sonst: 'other' },
  },
  'pos-settings-defaults.json': Object.fromEntries(Object.entries(EINSTELLUNGS_WERTE).map(([feld, w]) => [`*.${feld}`, w])),
  'surface.json': {
    ...Object.fromEntries(Object.entries(EINSTELLUNGS_WERTE).map(([feld, w]) => [`enums.${feld}[]`, w])),
    'posShortcutActions[]': EINSTELLUNGEN.shortcuts,
    'invoice.docTypes[]': { RE: 'invoice', GU: 'credit_note' },
    'invoice.taxSchemes[]': STEUERFALL,
    'invoice.zeroRatedTaxSchemes[]': STEUERFALL,
  },
  'receipts/*.json': {
    'receipt.cancellationReason': { fehleingabe: 'input_error', kunde_storniert: 'customer_cancelled', falsche_zahlart: 'wrong_payment_method', doppelt_erfasst: 'duplicate', sonstiges: 'other' },
  },
  'expected/*.lines.json': {
    'lines[].tone': VOKABULAR.catalogs.LAYOUT_TON,
  },
  'expected/*.sheet*.json': {
    'blocks[].kind': { zeile: 'line', marke: 'brandMark' },
  },
  'item-from-euro.json': {
    'cases[].expected.reason': { kein_zahlwert: 'not_a_number', nachkommastellen: 'too_many_decimals', ausserhalb: 'out_of_range' },
  },
  'invoice-calc.json': { 'cases[].taxScheme': STEUERFALL },
  'invoice-calc-random.json': { 'cases[].taxScheme': STEUERFALL },
  'invoice-totals.json': { 'cases[].taxScheme': STEUERFALL },
  // Beispiel-Kennungen (frei gewaehlt, seit 1.0 englisch).
  'invoice-api-examples/*.json': {
    'request.idempotencyKey': Object.fromEntries([...Array.from({ length: 12 }, (_, i) => [`bsp-${i + 1}`, `ex-${i + 1}`]),
      ['bsp-bezahlt', 'ex-paid'], ['bsp-einheit', 'ex-unit'], ['bsp-en-1', 'ex-en-1'], ['bsp-en-2', 'ex-en-2'], ['bsp-mikro-1', 'ex-micro-1'], ['bsp-mikro-2', 'ex-micro-2'],
      ['bsp-mikro-3', 'ex-micro-3'], ['bsp-vor-ort', 'ex-on-site'], ['bsp-zahlung-1', 'ex-payment-1'], ['bsp-zahlungsart', 'ex-payment-method']]),
    'request.customerId': { kunde_beispiel: 'customer_example' },
    'request.invoiceId': { rechnung_beispiel: 'invoice_example' },
    'request.brandId': { marke_beispiel: 'brand_example' },
    'request.payment.reference': { pi_3QbeispielXYZ: 'pi_3QexampleXYZ' },
  },
  'invoice-api.schema.json': { 'endpoints.*.request.properties.taxScheme.enum[]': STEUERFALL, 'endpoints.*.request.properties.docType.enum[]': { RE: 'invoice', GU: 'credit_note' } },
};

/** Formwechsel: nicht nur ein anderer Name. */
const FORMEN = [
  {
    file: 'surface.json', before: 'aufrufe', after: 'calls.public, calls.pos, routes.public, routes.pos, baseUrls',
    description: 'Die eine Aufrufliste ist je Weg geteilt: calls.public (api.kasseneck.at/v3) und calls.pos (kasse.kasseneck.at/api/v3) nennen die Aufrufe des Pakets, '
      + 'routes.public/routes.pos alle Endpunkte des Backends je Weg, baseUrls die zwei Basisadressen. Die sechs Beleg-Aufrufe stehen in beiden calls-Listen.',
  },
  {
    file: 'pos-texts.json', before: 'receiptEmailErrors (Codes von /v1)', after: 'receiptEmailErrors (Codes von /v3)',
    description: 'Die Schluessel sind die Fehlercodes des Backends; unter /v3 heissen sie englisch (Zuordnung in structure).',
  },
];

/** Schluessel ohne Nachfolger in 1.0. */
const ENTFERNT = {};

// ---- Umzug (einmalig, erledigt) --------------------------------------------------

/**
 * Wo in einer Pruefgeruest-Datei vor 1.0 welche Ebene gilt (Pfad mit `[]`
 * fuer Listen und `*` fuer Datenschluessel). `frei`: Teilbaum bleibt, wie er
 * ist (Schluessel sind dort schon englisch oder Daten). Ein Objekt an einem
 * Pfad ohne Eintrag bricht ab.
 */
const UMZUG = {
  'hobex-hps-codes.json': { '': 'file', gemessenAn: 'terminal', 'ergaenztAn[]': 'terminal', 'dokumentiert[]': 'documented', 'codes[]': 'frei', gruende: 'frei' },
  'position-aus-euro.json': { '': 'file', 'faelle[]': 'case', 'faelle[].item': 'frei', 'faelle[].erwartet': 'frei' },
  'rechnung-rechnen.json': { '': 'file', regel: 'rule', 'faelle[]': 'case', 'faelle[].positionen[]': 'frei', 'faelle[].erwartet': 'frei' },
  'rechnung-rechnen-zufall.json': { '': 'file', regel: 'rule', 'faelle[]': 'case', 'faelle[].positionen[]': 'frei', 'faelle[].erwartet': 'frei' },
  'rechnung-summen.json': { '': 'file', regel: 'rule', 'faelle[]': 'case', 'faelle[].items[]': 'frei', 'faelle[].erwartet': 'frei' },
  'manifest.json': { '': 'file', belege: 'belegnamen', 'belege.*': 'receipt', logoProbe: 'logoSample' },
};

/**
 * Ein Objekt nach den Ebenen einer Datei umbenennen. Streng: ein Schluessel
 * ohne Eintrag in seiner Ebene oder ein Objekt an einem Pfad ohne Ebene
 * bricht ab.
 */
export function umbenannt(wert, alteDatei, pfad = '') {
  if (Array.isArray(wert)) return wert.map((w) => umbenannt(w, alteDatei, `${pfad}[]`));
  if (wert === null || typeof wert !== 'object') return wert;
  const orte = UMZUG[alteDatei];
  if (!orte) throw new Error(`${alteDatei}: kein Umzug beschrieben`);
  const ebene = orte[pfad];
  if (ebene === undefined) throw new Error(`${alteDatei}: ${pfad || '(Wurzel)'} hat keine Ebene`);
  if (ebene === 'frei') return wert;
  const zuordnung = ebene === 'belegnamen' ? BELEGE : STRUKTUR[DATEIEN[alteDatei]][ebene];
  const aus = {};
  for (const [k, v] of Object.entries(wert)) {
    const neu = zuordnung[k];
    if (neu === undefined) throw new Error(`${alteDatei}: ${pfad ? `${pfad}.` : ''}${k} steht nicht in der Ebene ${ebene}`);
    const wild = pfad ? `${pfad}.*` : '*';
    aus[neu] = umbenannt(v, alteDatei, wild in orte ? wild : pfad ? `${pfad}.${k}` : k);
  }
  return aus;
}

function struktur() {
  const k = STRUKTUR['pos-texts.json'];
  deckt('pos-texts.json', k.file, Object.keys(alt.kasse));
  const eintraege = [...Object.values(alt.kasse.meldungen), ...Object.values(alt.kasse.beschriftungen)];
  deckt('pos-texts.json/entry', k.entry, eintraege.flatMap((e) => Object.keys(e)));
  deckt('pos-texts.json/errorRule', k.errorRule, alt.kasse.fehlerregeln.flatMap((r) => Object.keys(r)));
  deckt('pos-texts.json/errorRules[].kind', WERTE['pos-texts.json']['errorRules[].kind'], alt.kasse.fehlerregeln.map((r) => r.art));
  deckt('pos-texts.json/errorRules[].behavior', WERTE['pos-texts.json']['errorRules[].behavior'], alt.kasse.fehlerregeln.filter((r) => 'verhalten' in r).map((r) => r.verhalten));
  deckt('invoice-texts.json', STRUKTUR['invoice-texts.json'].file, Object.keys(alt.rechnung));
  const f = STRUKTUR['pos-message-cases.json'];
  deckt('pos-message-cases.json', f.file, Object.keys(alt.faelle));
  deckt('pos-message-cases.json/case', f.case, alt.faelle.faelle.flatMap((x) => Object.keys(x)));
  deckt('pos-message-cases.json/error', f.error, alt.faelle.faelle.flatMap((x) => Object.keys(x.fehler)));
  deckt('pos-message-cases.json/expected', f.expected, alt.faelle.faelle.flatMap((x) => (typeof x.erwartet === 'object' ? Object.keys(x.erwartet) : [])));
  for (const [name, zuordnung] of Object.entries(STRUKTUR).flatMap(([d, z]) => Object.entries(z).map(([t, m]) => [`${d}/${t}`, m]))) {
    const neu = Object.values(zuordnung);
    if (new Set(neu).size !== neu.length) throw new Error(`${name}: ein neuer Name ist doppelt vergeben`);
    for (const n of neu) if (!/^[_$]?[a-z][A-Za-z0-9_]*$/.test(n)) throw new Error(`${name}: ${n}`);
  }
  for (const [datei, orte] of Object.entries(UMZUG)) {
    if (!(datei in DATEIEN)) throw new Error(`UMZUG: ${datei} steht nicht in DATEIEN`);
    for (const ebene of Object.values(orte)) {
      if (ebene !== 'frei' && ebene !== 'belegnamen' && !(ebene in STRUKTUR[DATEIEN[datei]])) throw new Error(`UMZUG ${datei}: Ebene ${ebene} fehlt in STRUKTUR`);
    }
  }
  return STRUKTUR;
}

// ---- Tabelle -------------------------------------------------------------------

/** Die Tabelle alt -> neu, ohne zu schreiben (auch fuer den Frischewaechter im Test). */
export function umbenennungsTabelle() {
  return {
    _note:
      'Everything in the fixture contract that is different in 1.0 compared with 0.x (0.30.0/0.31.0): file paths (files), '
      + 'text catalog keys (texts), placeholders (placeholders), renamed keys (structure), renamed machine values (values), '
      + 'shape changes (shapes) and keys without successor (removed). Files that are new in 1.0 are not listed. '
      + 'Generated by scripts/umbenennung-1.0.mjs, never edit by hand. Rendered texts stay byte-identical.',
    files: dateien(),
    texts: {
      pos: {
        messages: tabelle(Object.keys(alt.kasse.meldungen), kasseSchluessel, 'Kasse/Meldungen'),
        labels: tabelle(Object.keys(alt.kasse.beschriftungen), kasseSchluessel, 'Kasse/Beschriftungen'),
      },
      invoice: tabelle(Object.keys(alt.rechnung.texte.de), rechnungSchluessel, 'Rechnung'),
    },
    placeholders: platzhalter(),
    structure: struktur(),
    values: WERTE,
    shapes: FORMEN,
    removed: ENTFERNT,
  };
}

/** Die Datei, wie sie eingecheckt ist: Einrueckung 2, Zeilenende am Schluss. */
export function umbenennungsDatei() {
  return JSON.stringify(umbenennungsTabelle(), null, 2) + '\n';
}

// ---- Aufruf von der Kommandozeile ------------------------------------------------

/**
 * Quelltexte umschreiben (einmalig beim Umstieg): jeder alte Katalog-
 * Schluessel in Anfuehrungszeichen wird der neue, jeder alte Platzhalter
 * `{alt}` der neue, ebenso die Namen in `placeholders: [...]`.
 */
function quelltexte(dateien, t) {
  const alles = { ...t.texts.pos.messages, ...t.texts.pos.labels, ...t.texts.invoice };
  for (const datei of dateien) {
    let ersetzt = 0;
    const nachher = readFileSync(datei, 'utf8')
      .replace(/(['"])([A-Za-z][A-Za-z_]*(?:\.[A-Za-z0-9_]+)+)\1/g, (treffer, zeichen, schluessel) => {
        const neu = alles[schluessel];
        if (neu === undefined) return treffer;
        ersetzt += 1;
        return `${zeichen}${neu}${zeichen}`;
      })
      .replace(/\{([a-zA-Z]+)\}/g, (treffer, name) => {
        const neu = t.placeholders[name];
        if (neu === undefined || neu === name) return treffer;
        ersetzt += 1;
        return `{${neu}}`;
      })
      .replace(/placeholders: \[([^\]]*)\]/g, (_treffer, liste) => `placeholders: [${liste.replace(/'([a-zA-Z]+)'/g, (t2, name) => {
        const neu = t.placeholders[name];
        if (neu === undefined) throw new Error(`${datei}: Platzhalter ${name} steht in keiner Liste`);
        if (neu !== name) ersetzt += 1;
        return `'${neu}'`;
      })}]`);
    writeFileSync(datei, nachher);
    console.log(datei, ersetzt, 'ersetzt');
  }
}

/**
 * Umzug (einmalig): Pfade unter fixtures/ nach `files`, Pruefgeruest-Dateien
 * nach `structure`. Das Format der Datei bleibt, ersetzt werden nur die
 * Schluessel; danach muss sie geparst genau `umbenannt(alt)` sein.
 */
function umziehen(t) {
  const wurzel = new URL('../fixtures/', import.meta.url);
  for (const [alterPfad, neuerPfad2] of Object.entries(t.files)) {
    if (alterPfad === neuerPfad2 && !(alterPfad in UMZUG)) continue;
    // Das Manifest schreibt scripts/belege-fixtures.mjs neu.
    if (alterPfad === 'manifest.json') continue;
    const quelle = new URL(alterPfad, wurzel);
    let text;
    try { text = readFileSync(quelle, 'utf8'); } catch { continue; } // schon umgezogen
    if (alterPfad in UMZUG) {
      const soll = umbenannt(JSON.parse(text), alterPfad);
      const ebenen = Object.values(STRUKTUR[DATEIEN[alterPfad]]);
      const namen = Object.assign({}, ...ebenen, alterPfad === 'manifest.json' ? BELEGE : {});
      text = text.replace(/"([^"\\]+)":/g, (treffer, k) => (k in namen && namen[k] !== k ? `"${namen[k]}":` : treffer));
      if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(soll)) throw new Error(`${alterPfad}: Ersetzung weicht von der strengen Umbenennung ab`);
    }
    mkdirSync(new URL('.', new URL(neuerPfad2, wurzel)), { recursive: true });
    writeFileSync(new URL(neuerPfad2, wurzel), text);
    if (alterPfad !== neuerPfad2) rmSync(quelle);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const t = umbenennungsTabelle();
  const argumente = process.argv.slice(2);
  if (argumente[0] === '--umziehen') umziehen(t);
  else quelltexte(argumente, t);
  writeFileSync(new URL('../fixtures/renames-1.0.json', import.meta.url), umbenennungsDatei());
  console.log('Umbenennung geschrieben:', Object.keys(t.files).length, 'Dateien,',
    Object.keys(t.texts.pos.messages).length, 'Meldungen,', Object.keys(t.texts.pos.labels).length, 'Beschriftungen,',
    Object.keys(t.texts.invoice).length, 'Rechnungstexte,', Object.keys(t.placeholders).length, 'Platzhalter');
}
