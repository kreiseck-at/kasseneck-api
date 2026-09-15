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

export const RECHNUNG_VERTRAG_VERSION = 1;

export const RECHNUNG_AUFRUFE = [
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
] as const;
export type RechnungAufruf = (typeof RECHNUNG_AUFRUFE)[number];

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

export const TAX_SCHEMES = ['normal', 'smallBusiness', 'reverseCharge', 'igLieferung', 'exportThirdCountry'] as const;
export type TaxScheme = (typeof TAX_SCHEMES)[number];

export const PRICE_MODES = ['net', 'gross'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const VAT_RATES = [0, 10, 13, 20] as const;
export type VatRatePercent = (typeof VAT_RATES)[number];

export const CUSTOMER_TYPES = ['private', 'company'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const INVOICE_LIST_STATUS = ['final', 'paid', 'cancelled', 'open', 'overdue'] as const;
export type InvoiceListStatus = (typeof INVOICE_LIST_STATUS)[number];

export const DOC_TYPES = ['RE', 'GU'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const EINVOICE_FORMATS = ['ubl', 'cii'] as const;
export type EInvoiceFormat = (typeof EINVOICE_FORMATS)[number];

/**
 * Sprachen einer Rechnung. Die Sprache wird beim Festschreiben eingefroren;
 * fehlt sie an Kunde oder Rechnung, gilt `de`. Behoerden bekommen immer `de`
 * (`language_not_allowed`). Datum und Betraege bleiben in jeder Sprache
 * oesterreichisch formatiert.
 */
export const INVOICE_LANGUAGES = ['de', 'en'] as const;
export type InvoiceLanguage = (typeof INVOICE_LANGUAGES)[number];

/**
 * Einheiten einer Position. Die API nimmt nur diese Schluessel an; gedruckt
 * wird das Kuerzel in der Sprache der Rechnung (`RECHNUNG_TEXTE`,
 * `einheit.<schluessel>`), die E-Rechnung fuehrt den UN/ECE-Code
 * (`RECHNUNG_EINHEITEN_CODES`). Ohne Angabe gilt `piece`.
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
export const RECHNUNG_EINHEITEN_CODES: Readonly<Record<InvoiceUnit, string>> = Object.freeze({
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
  hectare: 'HAR',
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
  sheet: 'ST',
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
export type Format = 'email' | 'phone' | 'vatId' | 'country' | 'date' | 'shortCode';

export type Feld =
  | { typ: 'string'; pflicht: boolean; min?: number; max: number; format?: Format }
  | { typ: 'integer'; pflicht: boolean; min: number; max: number }
  | { typ: 'number'; pflicht: boolean; min: number; max: number; nachkomma: number; exklusivMin?: boolean }
  | { typ: 'boolean'; pflicht: boolean }
  | { typ: 'enum'; pflicht: boolean; werte: readonly (string | number)[] }
  | { typ: 'object'; pflicht: boolean; felder: Readonly<Record<string, Feld>> }
  | { typ: 'list'; pflicht: boolean; min: number; max: number; eintrag: Feld }
  | { typ: 'map'; pflicht: boolean; maxSchluessel: number; schluesselMuster: string; wertMax: number };

const text = (max: number, pflicht = false, extra: { min?: number; format?: Format } = {}): Feld =>
  ({ typ: 'string', pflicht, max, ...(pflicht && extra.min === undefined ? { min: 1 } : {}), ...extra });
const idempotencyKey = (pflicht: boolean): Feld => ({ typ: 'string', pflicht, min: 1, max: 120 });
const id: Feld = { typ: 'string', pflicht: false, min: 1, max: 128 };
const idPflicht: Feld = { typ: 'string', pflicht: true, min: 1, max: 128 };
const datum = (pflicht = false): Feld => ({ typ: 'string', pflicht, min: 10, max: 10, format: 'date' });
const limit: Feld = { typ: 'integer', pflicht: false, min: 1, max: 100 };
const cursor: Feld = { typ: 'string', pflicht: false, min: 1, max: 500 };

/** Kunde, wie das Fremdsystem ihn schickt. `vatId` ist die UID-Nummer. */
export const KUNDE_FELDER: Readonly<Record<string, Feld>> = Object.freeze({
  type: { typ: 'enum', pflicht: true, werte: CUSTOMER_TYPES },
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
  isAuthority: { typ: 'boolean', pflicht: false },
  note: text(1000),
  externalId: { typ: 'string', pflicht: false, min: 1, max: 120 },
  /** Sprache der Rechnungen an diesen Kunden; fehlt = `de`. */
  language: { typ: 'enum', pflicht: false, werte: INVOICE_LANGUAGES },
});

/** Beim Aendern ist jedes Kundenfeld optional. */
const KUNDE_PATCH: Readonly<Record<string, Feld>> = Object.freeze(
  Object.fromEntries(Object.entries(KUNDE_FELDER).map(([name, feld]) => [name, { ...feld, pflicht: false }])),
);

/** Eine Rechnungs- oder Gutschriftsposition. Preise in ganzen Cent. */
export const POSITION_FELDER: Readonly<Record<string, Feld>> = Object.freeze({
  description: text(300, true),
  subtitle: text(1000),
  quantity: { typ: 'number', pflicht: true, min: 0, exklusivMin: true, max: 1_000_000, nachkomma: 3 },
  /** Einheit aus `INVOICE_UNITS`; ohne Angabe `piece`. */
  unit: { typ: 'enum', pflicht: false, werte: INVOICE_UNITS },
  unitPriceCents: { typ: 'integer', pflicht: true, min: 0, max: 100_000_000 },
  vatRate: { typ: 'enum', pflicht: true, werte: VAT_RATES },
  discountPct: { typ: 'number', pflicht: false, min: 0, max: 100, nachkomma: 2 },
});

const positionen: Feld = { typ: 'list', pflicht: true, min: 1, max: 500, eintrag: { typ: 'object', pflicht: true, felder: POSITION_FELDER } };

export const RECHNUNG_ANFRAGEN: Readonly<Record<RechnungAufruf, Readonly<Record<string, Feld>>>> = Object.freeze({
  createCustomer: {
    customer: { typ: 'object', pflicht: true, felder: KUNDE_FELDER },
    idempotencyKey: idempotencyKey(false),
  },
  getCustomer: {
    customerId: id,
    externalId: { typ: 'string', pflicht: false, min: 1, max: 120 },
  },
  updateCustomer: {
    customerId: idPflicht,
    customer: { typ: 'object', pflicht: true, felder: KUNDE_PATCH },
  },
  searchCustomers: {
    externalId: { typ: 'string', pflicht: false, min: 1, max: 120 },
    vatId: text(20),
    email: text(254),
    name: text(200),
    limit,
    cursor,
  },
  issueInvoice: {
    idempotencyKey: idempotencyKey(true),
    customerId: id,
    taxScheme: { typ: 'enum', pflicht: true, werte: TAX_SCHEMES },
    priceMode: { typ: 'enum', pflicht: true, werte: PRICE_MODES },
    serviceStart: datum(true),
    serviceEnd: datum(),
    paymentTermDays: { typ: 'integer', pflicht: false, min: 0, max: 365 },
    orderReference: text(200),
    intro: text(2000),
    note: text(2000),
    paymentReference: text(140),
    girocode: { typ: 'boolean', pflicht: false },
    tracking: { typ: 'boolean', pflicht: false },
    items: positionen,
    metadata: { typ: 'map', pflicht: false, maxSchluessel: 20, schluesselMuster: '^[a-zA-Z0-9_]{1,40}$', wertMax: 500 },
    /** Sprache dieser Rechnung; sonst die des Kunden, sonst `de`. */
    language: { typ: 'enum', pflicht: false, werte: INVOICE_LANGUAGES },
    /** Marke (Kennung aus `listBrands`); sonst die Standardmarke. */
    brandId: id,
  },
  cancelInvoice: {
    idempotencyKey: idempotencyKey(true),
    invoiceId: idPflicht,
    reason: { typ: 'enum', pflicht: true, werte: CREDIT_NOTE_REASONS },
    note: text(2000),
  },
  createCreditNote: {
    idempotencyKey: idempotencyKey(true),
    invoiceId: idPflicht,
    reason: { typ: 'enum', pflicht: true, werte: CREDIT_NOTE_REASONS },
    note: text(2000),
    items: positionen,
  },
  getInvoice: {
    invoiceId: id,
    number: { typ: 'string', pflicht: false, min: 1, max: 100 },
  },
  listInvoices: {
    from: datum(),
    to: datum(),
    status: { typ: 'enum', pflicht: false, werte: INVOICE_LIST_STATUS },
    docType: { typ: 'enum', pflicht: false, werte: DOC_TYPES },
    customerId: id,
    limit,
    cursor,
  },
  getInvoicePdf: {
    invoiceId: idPflicht,
    /** Andere Sprache als die der Rechnung: gekennzeichnete Uebersetzungskopie, keine eigene Rechnung. */
    language: { typ: 'enum', pflicht: false, werte: INVOICE_LANGUAGES },
  },
  getInvoiceXml: {
    invoiceId: idPflicht,
    format: { typ: 'enum', pflicht: false, werte: EINVOICE_FORMATS },
  },
  getInvoiceSetupStatus: {},
  listBrands: {},
});

/** Genau eines dieser Felder muss gesetzt sein (je Aufruf, je Gruppe). */
export const RECHNUNG_GENAU_EINS: Readonly<Partial<Record<RechnungAufruf, readonly (readonly string[])[]>>> = Object.freeze({
  getCustomer: [['customerId', 'externalId']],
  getInvoice: [['invoiceId', 'number']],
});

/** Mindestens eines dieser Felder muss gesetzt sein (je Aufruf, je Gruppe). */
export const RECHNUNG_MINDESTENS_EINS: Readonly<Partial<Record<RechnungAufruf, readonly (readonly string[])[]>>> = Object.freeze({
  searchCustomers: [['externalId', 'vatId', 'email', 'name']],
});
