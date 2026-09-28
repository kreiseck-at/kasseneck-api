/**
 * Der Vertrag der Rechnungs-API — als Daten, nicht als Prosa.
 *
 * Aus dieser Datei entstehen drei Dinge, damit sie nicht auseinanderlaufen
 * koennen:
 *
 * 1. `fixtures/rechnung-api.schema.json` (`npm run fixtures:rechnung`) — das
 *    Backend liest es aus dem vendorierten Paket und vergleicht es in beide
 *    Richtungen mit seiner eigenen Pruefung; der Dart-Zwilling zieht es byteweise.
 * 2. Die Listen unter `rechnung` in `fixtures/oberflaeche.json` (Codes, Gruende,
 *    Enums) — ueber denselben Namensraum-Scan wie der Partner-Teil.
 * 3. Die TypeScript-Typen in `typen.ts`.
 *
 * Nach aussen spricht die Schnittstelle Englisch: Feldnamen, Codes, Gruende.
 * Deutsch bleibt, was ein Mensch liest (`message`, der Aufdruck eines Grundes).
 *
 * Beschrieben wird die Anfrage. Was der Server daraus macht — Rechnungsdatum,
 * Nummer, Summen — ist bewusst **nicht** setzbar.
 */

export const INVOICE_CONTRACT_VERSION = 2;

export const INVOICE_ENDPOINTS = [
  'createCustomer',
  'getCustomer',
  'updateCustomer',
  'searchCustomers',
  'issueInvoice',
  'cancelInvoice',
  'createCreditNote',
  'getInvoice',
  'listInvoices',
  'getInvoicePdf',
  'getInvoiceXml',
  'getInvoiceSetupStatus',
  'listBrands',
  'recordInvoicePayment',
] as const;
export type InvoiceEndpoint = (typeof INVOICE_ENDPOINTS)[number];

/**
 * Stabile Fehlercodes. Das Fremdsystem verzweigt am Code, der Text darf sich
 * aendern. `validation` traegt zusaetzlich `errors: [{ field, message }]`.
 */
export const INVOICE_ERROR_CODES = [
  'validation',
  'idempotency_conflict',
  'module_inactive',
  'customer_not_found',
  'customer_exists',
  'short_code_taken',
  'short_code_immutable',
  'recipient_required',
  'invoice_requirements_missing',
  'invoice_not_found',
  'invoice_ambiguous',
  'not_cancellable',
  'partial_credit_exists',
  'credit_exceeds_invoice',
  'einvoice_incomplete',
  'invoice_api_not_enabled',
  'invoice_setup_incomplete',
  'language_not_allowed',
  'brand_not_found',
  'not_payable',
  'payment_exceeds_invoice',
  'tax_scheme_mismatch',
  'vat_rate_not_in_country',
  'reverse_charge_reason_required',
  'reverse_charge_threshold',
  'mixed_supply_not_allowed',
  'oss_not_enabled',
  'einvoice_unavailable', // zu dieser Rechnung entsteht keine E-Rechnung, Grund in `reason`
  'amount_too_large', // Betrag ueber der Grenze des Ganzzahlkerns; erst ab dessen Umstieg gesendet
] as const;
export type InvoiceErrorCode = (typeof INVOICE_ERROR_CODES)[number];

/** Gruende einer Gutschrift. Der Server druckt den deutschen Anzeigetext. */
export const CREDIT_NOTE_REASONS = [
  'cancellation',
  'price_reduction',
  'return',
  'incorrect_invoice',
  'other',
] as const;
export type CreditNoteReason = (typeof CREDIT_NOTE_REASONS)[number];

/**
 * Der Steuerfall einer Rechnung. Er wird vom Server **abgeleitet** (Kundenland,
 * Kundenart, UID, Ware oder Leistung); eine mitgeschickte Angabe muss dazu
 * passen, sonst `tax_scheme_mismatch`. Neue Faelle stehen hinten, damit
 * gespeicherte Reihenfolgen gueltig bleiben. Unter `/v1` hiess `intraCommunitySupply` noch
 * `igLieferung`; unter `/v3` weist der Server den alten Namen mit `validation` ab.
 *
 * - `normal`                oesterreichische Umsatzsteuer
 * - `smallBusiness`         Kleinunternehmer (§ 6 Abs. 1 Z 27 UStG)
 * - `reverseCharge`         Leistung an ein Unternehmen in der EU (Art. 196 MwSt-RL)
 * - `intraCommunitySupply`  Ware an ein Unternehmen in der EU (Art. 6 Abs. 1 UStG)
 * - `exportThirdCountry`    Ware ins Drittland (§ 6 Abs. 1 Z 1 UStG)
 * - `domesticReverseCharge` Uebergang der Steuerschuld im Inland, Grund aus `REVERSE_CHARGE_REASONS`
 * - `oss`                   B2C in der EU ueber den One-Stop-Shop, Satz des Ziellandes
 * - `outsideScope`          Leistung an ein Drittlandsunternehmen — in Oesterreich nicht steuerbar
 */
export const TAX_SCHEMES = [
  'normal',
  'smallBusiness',
  'reverseCharge',
  'intraCommunitySupply',
  'exportThirdCountry',
  'domesticReverseCharge',
  'oss',
  'outsideScope',
] as const;
export type TaxScheme = (typeof TAX_SCHEMES)[number];

/**
 * Gruende fuer den Uebergang der Steuerschuld **im Inland**. Ohne Grund gibt es
 * kein `domesticReverseCharge`: die Bedingungen sind je Fall verschieden, und
 * keine davon laesst sich aus Betrag und Land erraten.
 *
 * `thresholdCents` ist das Entgelt, ab dem der Fall greift – maßgeblich ist das
 * **in der Rechnung ausgewiesene** Entgelt, nicht der Einzelpreis; ein
 * einheitlicher Liefervorgang darf dafuer nicht auf mehrere Rechnungen
 * aufgeteilt werden (UStR Rz 2605d).
 */
export const REVERSE_CHARGE_REASONS = Object.freeze({
  construction: { legalBasis: '§ 19 Abs. 1a UStG', thresholdCents: null },
  scrap: { legalBasis: 'Schrott-UStV, BGBl. II Nr. 129/2007', thresholdCents: null },
  mobile_devices: { legalBasis: '§ 19 Abs. 1e lit. b UStG', thresholdCents: 500_000 },
  it_devices: { legalBasis: '§ 2 Z 1 UStBBKV, BGBl. II Nr. 369/2013', thresholdCents: 500_000 },
  metals: { legalBasis: '§ 2 Z 4 UStBBKV', thresholdCents: null },
  emission_certificates: { legalBasis: '§ 19 Abs. 1e lit. a UStG', thresholdCents: null },
  gas_electricity: { legalBasis: '§ 2 Z 2 UStBBKV', thresholdCents: null },
  energy_certificates: { legalBasis: '§ 2 Z 3 UStBBKV', thresholdCents: null },
  investment_gold: { legalBasis: '§ 2 Z 5 UStBBKV', thresholdCents: null },
  security_transfer: { legalBasis: '§ 19 Abs. 1b UStG', thresholdCents: null },
  foreign_supplier: { legalBasis: '§ 19 Abs. 1 zweiter Satz UStG', thresholdCents: null },
});
export type ReverseChargeReason = keyof typeof REVERSE_CHARGE_REASONS;

/** Ware oder Leistung — ohne das laesst sich ig. Lieferung nicht von Reverse Charge trennen. */
export const ITEM_KINDS = ['goods', 'service'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const PRICE_MODES = ['net', 'gross'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const VAT_RATES = [0, 10, 13, 20] as const;
export type VatRatePercent = (typeof VAT_RATES)[number];

export const CUSTOMER_TYPES = ['private', 'company'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const INVOICE_LIST_STATUS = ['final', 'paid', 'cancelled', 'open', 'overdue'] as const;
export type InvoiceListStatus = (typeof INVOICE_LIST_STATUS)[number];

/**
 * Belegart: Rechnung oder Gutschrift (unter `/v1` `RE` bzw. `GU`). Das Vorzeichen
 * steht in der Belegart, nie im Betrag.
 */
export const DOC_TYPES = ['invoice', 'credit_note'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const EINVOICE_FORMATS = ['ubl', 'cii'] as const;
export type EInvoiceFormat = (typeof EINVOICE_FORMATS)[number];

/**
 * Was einer EN-16931-konformen E-Rechnung fehlt: `einvoice.missing` jeder
 * Rechnungssicht und `data.missing` bei `einvoice_incomplete` bzw.
 * `invoice_requirements_missing`. Unter `/v1` standen hier deutsche Woerter
 * (`Straße`, `PLZ`, …).
 */
export const EINVOICE_MISSING_CODES = [
  'name',
  'street',
  'zip',
  'city',
  'country',
  'vat_id',
  'order_reference',
  'order_reference_format',
] as const;
export type EInvoiceMissingCode = (typeof EINVOICE_MISSING_CODES)[number];

/** Warum eine Rechnung abgeschrieben wurde (`writeOffReasonCode` in `getInvoice`). */
export const WRITE_OFF_REASON_CODES = [
  'uncollectible',
  'time_barred',
  'waived',
  'disputed',
  'settled_externally',
  'other',
] as const;
export type WriteOffReasonCode = (typeof WRITE_OFF_REASON_CODES)[number];

/**
 * Sprachen einer Rechnung. Die Sprache wird beim Festschreiben eingefroren;
 * fehlt sie an Kunde oder Rechnung, gilt `de`. Behoerden bekommen immer `de`
 * (`language_not_allowed`). Datum und Betraege bleiben in jeder Sprache
 * oesterreichisch formatiert.
 */
export const INVOICE_LANGUAGES = ['de', 'en'] as const;
export type InvoiceLanguage = (typeof INVOICE_LANGUAGES)[number];

/**
 * Wie eine Rechnung bezahlt wurde. Der Vermerk ist Buchhaltung, kein Beleg.
 *
 * Ein **Barumsatz** ist nicht nur Bargeld: als Barzahlung gilt auch die Zahlung
 * mit Bankomat- oder Kreditkarte **vor Ort** (§ 131b Abs. 1 Z 3 BAO), nicht
 * aber dieselbe Karte im Internet. Weil `card` und `online` beides sein
 * koennen, sagt das Feld `onSite` es dem Server — und nur dann traegt die
 * Antwort den Hinweis `cash_receipt_required` (bei `cash` immer).
 */
export const INVOICE_PAYMENT_METHODS = ['transfer', 'card', 'online', 'cash'] as const;
export type InvoicePaymentMethod = (typeof INVOICE_PAYMENT_METHODS)[number];

/**
 * Hinweise, die eine erfolgreiche Antwort zusaetzlich tragen kann (`data.notice`).
 * Sie sind keine Fehler: der Aufruf hat gewirkt, es gibt nur etwas zu wissen.
 */
export const INVOICE_NOTICE_CODES = [
  'cash_receipt_required',
  /** Ig. Lieferung und grenzueberschreitendes Reverse Charge: die Zusammenfassende
   *  Meldung ist materielle Voraussetzung (Art. 7 Abs. 1 Z 5 UStG). */
  'recapitulative_statement_due',
  /** Leistung an eine Privatperson im Drittland: der Leistungsort haengt von der
   *  Art der Leistung ab — wir nehmen den oesterreichischen Fall an. */
  'place_of_supply_check',
] as const;
export type InvoiceNoticeCode = (typeof INVOICE_NOTICE_CODES)[number];

/**
 * Einheiten einer Position. Die API nimmt nur diese Schluessel an; gedruckt
 * wird das Kuerzel in der Sprache der Rechnung (`INVOICE_TEXTS`,
 * `unit_symbol.<schluessel>`), die E-Rechnung fuehrt den UN/ECE-Code
 * (`INVOICE_UNIT_CODES`). Ohne Angabe gilt `piece`.
 */
export const INVOICE_UNITS = [
  'piece',
  'pair',
  'set',
  'dozen',
  'second',
  'minute',
  'hour',
  'day',
  'night',
  'week',
  'month',
  'quarter',
  'half_year',
  'year',
  'milligram',
  'gram',
  'kilogram',
  'tonne',
  'millimetre',
  'centimetre',
  'metre',
  'running_metre',
  'kilometre',
  'square_metre',
  'hectare',
  'millilitre',
  'litre',
  'cubic_metre',
  'kilowatt_hour',
  'megawatt_hour',
  'gigabyte',
  'terabyte',
  'flat_rate',
  'person',
  'licence',
  'user',
  'device',
  'session',
  'trip',
  'page',
  'sheet',
  'package',
  'box',
  'carton',
  'bottle',
  'can',
  'roll',
  'bag',
  'pallet',
] as const;
export type InvoiceUnit = (typeof INVOICE_UNITS)[number];

/**
 * UN/ECE-Code je Einheit (Recommendation 20, Verpackungen aus Recommendation 21
 * mit `X`). Mehrere Einheiten duerfen denselben Code tragen (Meter und
 * Laufmeter; Lizenz, Benutzer, Geraet als Stueck). Die Validatoren der
 * E-Rechnung pruefen jeden Code im Backend (Beispiel `api-einheiten`).
 */
export const INVOICE_UNIT_CODES: Readonly<Record<InvoiceUnit, string>> = Object.freeze({
  piece: 'C62',
  pair: 'PR',
  set: 'SET',
  dozen: 'DZN',
  second: 'SEC',
  minute: 'MIN',
  hour: 'HUR',
  day: 'DAY',
  night: 'C62',
  week: 'WEE',
  month: 'MON',
  quarter: 'QAN',
  half_year: 'SAN',
  year: 'ANN',
  milligram: 'MGM',
  gram: 'GRM',
  kilogram: 'KGM',
  tonne: 'TNE',
  millimetre: 'MMT',
  centimetre: 'CMT',
  metre: 'MTR',
  running_metre: 'MTR',
  kilometre: 'KMT',
  square_metre: 'MTK',
  // Rec 20 fuehrt fuer Hektar HAR, EN 16931 laesst davon nur H18
  // („square hectometre", Synonym hectare) zu.
  hectare: 'H18',
  millilitre: 'MLT',
  litre: 'LTR',
  cubic_metre: 'MTQ',
  kilowatt_hour: 'KWH',
  megawatt_hour: 'MWH',
  gigabyte: 'E34',
  terabyte: 'E35',
  flat_rate: 'LS',
  person: 'IE',
  licence: 'C62',
  user: 'C62',
  device: 'C62',
  session: 'C62',
  trip: 'C62',
  page: 'ZP',
  // Ebenso: ST („sheet") steht nicht in der Liste von EN 16931, LEF („leaf") schon.
  sheet: 'LEF',
  package: 'XPK',
  box: 'XBX',
  carton: 'XCT',
  bottle: 'XBO',
  can: 'XCA',
  roll: 'XRO',
  bag: 'XSA',
  pallet: 'XPX',
});

/**
 * Was erfuellt sein muss, bevor ueber die API ausgestellt werden darf — in
 * dieser Reihenfolge meldet `getInvoiceSetupStatus`, was fehlt, und dieselben
 * Schluessel stehen in `invoice_setup_incomplete`.
 *
 * - `module_active`  Modul Rechnung aktiv
 * - `api_enabled`    Rechnungs-API fuer das Konto von Kasseneck freigegeben (nur live)
 * - `live_enabled`   Konto live freigeschaltet (nur live)
 * - `business_name`, `address`, `vat_id`  Pflichtangaben des Ausstellers (§ 11 UStG;
 *   `vat_id` entfaellt bei Kleinunternehmern)
 * - `bank_account`   IBAN und Kontoinhaber
 * - `number_format`  Rechnungsnummern-Format bewusst gespeichert
 */
export const INVOICE_SETUP_REQUIREMENTS = [
  'module_active',
  'api_enabled',
  'live_enabled',
  'business_name',
  'address',
  'vat_id',
  'bank_account',
  'number_format',
] as const;
export type InvoiceSetupRequirement = (typeof INVOICE_SETUP_REQUIREMENTS)[number];

/** Formate, die der Server mit `@kreiseck/validator` bzw. einem Muster prueft. */
export type FieldFormat = 'email' | 'phone' | 'vatId' | 'country' | 'date' | 'shortCode';

export type Field =
  | { type: 'string'; required: boolean; min?: number; max: number; format?: FieldFormat }
  | { type: 'integer'; required: boolean; min: number; max: number }
  | { type: 'number'; required: boolean; min: number; max: number; decimals: number; exclusiveMin?: boolean }
  | { type: 'boolean'; required: boolean }
  | { type: 'enum'; required: boolean; values: readonly (string | number)[] }
  | {
    type: 'object'; required: boolean; fields: Readonly<Record<string, Field>>;
    /**
     * Feldgruppen, von denen GENAU EINE gesetzt sein muss (§ 9.1). Jede Gruppe
     * ist eine Liste von Feldnamen; im JSON Schema wird daraus
     * `oneOf: [{ required: [...] }, ...]`.
     *
     * Gebraucht fuer den Preis einer Position: `unitPriceCents` ODER
     * `unitPriceMicros`, nie beides und nie keines. Als zwei Pflichtfelder
     * liesse sich das nicht ausdruecken, und als zwei optionale waere eine
     * Position ohne Preis gueltig.
     */
    exactlyOne?: readonly (readonly string[])[];
  }
  | { type: 'list'; required: boolean; min: number; max: number; item: Field }
  | { type: 'map'; required: boolean; maxKeys: number; keyPattern: string; valueMax: number };

const text = (max: number, required = false, extra: { min?: number; format?: FieldFormat } = {}): Field =>
  ({ type: 'string', required, max, ...(required && extra.min === undefined ? { min: 1 } : {}), ...extra });
const idempotencyKey = (required: boolean): Field => ({ type: 'string', required, min: 1, max: 120 });
const id: Field = { type: 'string', required: false, min: 1, max: 128 };
const idPflicht: Field = { type: 'string', required: true, min: 1, max: 128 };
const datum = (required = false): Field => ({ type: 'string', required, min: 10, max: 10, format: 'date' });
const limit: Field = { type: 'integer', required: false, min: 1, max: 100 };
const cursor: Field = { type: 'string', required: false, min: 1, max: 500 };

/** Kunde, wie das Fremdsystem ihn schickt. `vatId` ist die UID-Nummer. */
export const CUSTOMER_FIELDS: Readonly<Record<string, Field>> = Object.freeze({
  type: { type: 'enum', required: true, values: CUSTOMER_TYPES },
  name: text(200, true),
  legalForm: text(40),
  email: text(254, false, { format: 'email' }),
  phone: text(40, false, { format: 'phone' }),
  street: text(200),
  houseNumber: text(20),
  zip: text(10),
  city: text(100),
  country: text(2, true, { min: 2, format: 'country' }),
  vatId: text(20, false, { format: 'vatId' }),
  shortCode: text(8, false, { format: 'shortCode' }),
  isAuthority: { type: 'boolean', required: false },
  note: text(1000),
  externalId: { type: 'string', required: false, min: 1, max: 120 },
  /** Sprache der Rechnungen an diesen Kunden; fehlt = `de`. */
  language: { type: 'enum', required: false, values: INVOICE_LANGUAGES },
});

/** Beim Aendern ist jedes Kundenfeld optional. */
const CUSTOMER_PATCH: Readonly<Record<string, Field>> = Object.freeze(
  Object.fromEntries(Object.entries(CUSTOMER_FIELDS).map(([name, feld]) => [name, { ...feld, required: false }])),
);

/**
 * Eine Rechnungs- oder Gutschriftsposition.
 *
 * Der Preis steht in ganzen Cent (`unitPriceCents`) ODER in Mikro-Euro
 * (`unitPriceMicros`, 10⁻⁶ €) — genau eines von beiden (§ 9.1). Der Mikropreis
 * loest denselben Bereich feiner auf: 10¹² Mikro-Euro sind dieselben
 * 10.000.000,00 €, die 10⁸ Cent ausdruecken. Er ist noetig fuer Preise
 * unterhalb eines Cents (Verbrauchsabrechnung, Stueckpreise im Zehntelcent),
 * die bisher gerundet eingereicht werden mussten.
 */
export const ITEM_FIELDS: Readonly<Record<string, Field>> = Object.freeze({
  description: text(300, true),
  subtitle: text(1000),
  quantity: { type: 'number', required: true, min: 0, exclusiveMin: true, max: 1_000_000_000, decimals: 3 },
  /** Einheit aus `INVOICE_UNITS`; ohne Angabe `piece`. */
  unit: { type: 'enum', required: false, values: INVOICE_UNITS },
  /** Ware oder Leistung; ohne Angabe `goods`. Entscheidet ueber den Steuerfall. */
  kind: { type: 'enum', required: false, values: ITEM_KINDS },
  /** Einzelpreis in ganzen Cent. Alternative zu `unitPriceMicros`. */
  unitPriceCents: { type: 'integer', required: false, min: 0, max: 100_000_000 },
  /** Einzelpreis in Mikro-Euro (10⁻⁶ €). Alternative zu `unitPriceCents`. */
  unitPriceMicros: { type: 'integer', required: false, min: 0, max: 1_000_000_000_000 },
  vatRate: { type: 'enum', required: true, values: VAT_RATES },
  discountPct: { type: 'number', required: false, min: 0, max: 100, decimals: 2 },
});

/** Genau einer der beiden Preise je Position (§ 9.1). */
export const ITEM_PRICE_EXACTLY_ONE: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['unitPriceCents']),
  Object.freeze(['unitPriceMicros']),
]);

const positionen: Field = {
  type: 'list',
  required: true,
  min: 1,
  max: 500,
  item: {
    type: 'object', required: true, fields: ITEM_FIELDS, exactlyOne: ITEM_PRICE_EXACTLY_ONE,
  },
};

/**
 * Eine Zahlung zu einer Rechnung. Ohne `amountCents` gilt der volle
 * Bruttobetrag, ohne `paidAt` der heutige Wiener Tag. `reference` ist die
 * Zahlungskennung des Fremdsystems (z. B. `pi_3Q...`) — sie wird gespeichert,
 * aber **nicht gedruckt**: die Rechnung wird aufbewahrt und vervielfaeltigt,
 * und dem Empfaenger nuetzt sie nichts.
 */
export const PAYMENT_FIELDS: Readonly<Record<string, Field>> = Object.freeze({
  method: { type: 'enum', required: true, values: INVOICE_PAYMENT_METHODS },
  amountCents: { type: 'integer', required: false, min: 1, max: 100_000_000 },
  paidAt: datum(),
  reference: text(100),
  /**
   * Die Zahlung erfolgte **vor Ort** beim Unternehmer (Terminal an der Kasse,
   * Zahlung per App am Tresen). Dann ist sie ein Barumsatz. Zu `transfer` passt
   * das nicht — eine Ueberweisung erfolgt nie vor Ort — und wird abgewiesen.
   */
  onSite: { type: 'boolean', required: false },
});

export const INVOICE_REQUESTS: Readonly<Record<InvoiceEndpoint, Readonly<Record<string, Field>>>> = Object.freeze({
  createCustomer: {
    customer: { type: 'object', required: true, fields: CUSTOMER_FIELDS },
    idempotencyKey: idempotencyKey(false),
  },
  getCustomer: {
    customerId: id,
    externalId: { type: 'string', required: false, min: 1, max: 120 },
  },
  updateCustomer: {
    customerId: idPflicht,
    customer: { type: 'object', required: true, fields: CUSTOMER_PATCH },
  },
  searchCustomers: {
    externalId: { type: 'string', required: false, min: 1, max: 120 },
    vatId: text(20),
    email: text(254),
    name: text(200),
    limit,
    cursor,
  },
  issueInvoice: {
    idempotencyKey: idempotencyKey(true),
    customerId: id,
    /**
     * Optional: der Server leitet den Fall ab. Eine Angabe wird geprueft und
     * muss passen (`tax_scheme_mismatch`) — so faellt eine falsche Zuordnung
     * im Fremdsystem auf, statt eine falsche Rechnung zu erzeugen.
     */
    taxScheme: { type: 'enum', required: false, values: TAX_SCHEMES },
    /** Pflicht bei `domesticReverseCharge`, sonst nicht erlaubt. */
    reverseChargeReason: { type: 'enum', required: false, values: Object.keys(REVERSE_CHARGE_REASONS) },
    priceMode: { type: 'enum', required: true, values: PRICE_MODES },
    serviceStart: datum(true),
    serviceEnd: datum(),
    paymentTermDays: { type: 'integer', required: false, min: 0, max: 365 },
    orderReference: text(200),
    intro: text(2000),
    note: text(2000),
    paymentReference: text(140),
    girocode: { type: 'boolean', required: false },
    tracking: { type: 'boolean', required: false },
    items: positionen,
    metadata: { type: 'map', required: false, maxKeys: 20, keyPattern: '^[a-zA-Z0-9_]{1,40}$', valueMax: 500 },
    /** Sprache dieser Rechnung; sonst die des Kunden, sonst `de`. */
    language: { type: 'enum', required: false, values: INVOICE_LANGUAGES },
    /** Marke (Kennung aus `listBrands`); sonst die Standardmarke. */
    brandId: id,
    /**
     * Schon bezahlt: die Zahlung entsteht in **derselben** Transaktion wie das
     * Festschreiben. Sonst gaebe es einen Moment, in dem die Rechnung offen ist
     * und ein sofort geholtes PDF Zahlungsinformationen traegt.
     */
    payment: { type: 'object', required: false, fields: PAYMENT_FIELDS },
    /**
     * Probelauf: alles pruefen und rechnen wie beim Ausstellen, aber nichts
     * festschreiben — keine Nummer, kein Dokument, keine Zahlung, kein
     * Idempotenz-Eintrag. Die Antwort traegt `preview` statt `invoice`.
     */
    dryRun: { type: 'boolean', required: false },
  },
  cancelInvoice: {
    idempotencyKey: idempotencyKey(true),
    invoiceId: idPflicht,
    reason: { type: 'enum', required: true, values: CREDIT_NOTE_REASONS },
    note: text(2000),
  },
  createCreditNote: {
    idempotencyKey: idempotencyKey(true),
    invoiceId: idPflicht,
    reason: { type: 'enum', required: true, values: CREDIT_NOTE_REASONS },
    note: text(2000),
    items: positionen,
  },
  getInvoice: {
    invoiceId: id,
    number: { type: 'string', required: false, min: 1, max: 100 },
  },
  listInvoices: {
    from: datum(),
    to: datum(),
    status: { type: 'enum', required: false, values: INVOICE_LIST_STATUS },
    docType: { type: 'enum', required: false, values: DOC_TYPES },
    customerId: id,
    limit,
    cursor,
  },
  getInvoicePdf: {
    invoiceId: idPflicht,
    /** Andere Sprache als die der Rechnung: gekennzeichnete Uebersetzungskopie, keine eigene Rechnung. */
    language: { type: 'enum', required: false, values: INVOICE_LANGUAGES },
  },
  getInvoiceXml: {
    invoiceId: idPflicht,
    format: { type: 'enum', required: false, values: EINVOICE_FORMATS },
  },
  getInvoiceSetupStatus: {},
  listBrands: {},
  recordInvoicePayment: {
    idempotencyKey: idempotencyKey(true),
    invoiceId: idPflicht,
    method: { type: 'enum', required: true, values: INVOICE_PAYMENT_METHODS },
    amountCents: { type: 'integer', required: false, min: 1, max: 100_000_000 },
    paidAt: datum(),
    reference: text(100),
    onSite: { type: 'boolean', required: false },
  },
});

/** Genau eines dieser Felder muss gesetzt sein (je Aufruf, je Gruppe). */
export const INVOICE_EXACTLY_ONE: Readonly<Partial<Record<InvoiceEndpoint, readonly (readonly string[])[]>>> = Object.freeze({
  getCustomer: [['customerId', 'externalId']],
  getInvoice: [['invoiceId', 'number']],
});

/** Mindestens eines dieser Felder muss gesetzt sein (je Aufruf, je Gruppe). */
export const INVOICE_AT_LEAST_ONE: Readonly<Partial<Record<InvoiceEndpoint, readonly (readonly string[])[]>>> = Object.freeze({
  searchCustomers: [['externalId', 'vatId', 'email', 'name']],
});
