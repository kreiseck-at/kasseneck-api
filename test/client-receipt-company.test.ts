import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KeckPaymentMethod, VatRate } from '../src/enums/index.js';
import { getReceipt, getReceiptWithCompany, sellReceipt, sellReceiptWithCompany } from '../src/client/receipts.js';
import { createKasseneckApi } from '../src/client/api.js';
import { apiKeyAuth } from '../src/client/auth.js';
import type { KasseneckTransport } from '../src/client/transport.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import type { ReceiptPayload } from '../src/models/index.js';

/**
 * `createReceipt` und `getReceipt` liefern neben dem Beleg auch die Firmen-
 * und Druckdaten (Firma, Anschrift, Steuernummer, UID, Fusszeilen, Logo-
 * Adresse, Kleinunternehmer-Kennzeichen). Die Feldnamen sind aus
 * functions/index.js abgeschrieben (Antwortbloecke von `getReceipt` und
 * `createReceipt`), nicht aus dieser Umsetzung abgeleitet.
 *
 * **Gotcha, den diese Datei festhaelt:** `getReceipt` liefert
 * `thanks_message`, `createReceipt` nicht — das Feld muss also fehlen duerfen.
 */

const BELEG_NUTZLAST: ReceiptPayload = {
  qr: '_R1-AT1_KASSE1_AT0-42_2026-08-13T00:30:00_5,00_0,00_0,00_0,00_0,00_U_V_6F0404F0_S',
  sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.SIGNATURWERT',
  certificateSerialNumber: '6F0404F0',
  signaturePreviousReceipt: 'V',
  turnoverCounterAES256ICM: 'U',
  paymentMethod: 'cash',
  items: [{ name: 'Espresso', quantity: 2, unitPriceCents: 250, vatRate: 20 }],
  vouchers: null,
  timeStamp: '2026-08-13T00:30:00',
  cashregisterId: 'KASSE1',
  receiptType: 'standard',
  receiptId: 'AT0-42',
  fullReceiptId: 'VOLLBELEGNUMMER',
  creditCardProvider: null,
  cardPaymentId: null,
  cardPaymentData: null,
  customerDetails: '',
  legalMessage: '',
  signatureSuccess: true,
  customProjectId: null,
};

/** Antwortrumpf von `getReceipt` — mit thanks_message. */
const HUELLE_GET = {
  receipt: BELEG_NUTZLAST,
  is_small_business: true,
  uid: 'ATU12345678',
  taxnr: '12-345/6789',
  company: 'Café Kreiseck',
  phone: '+43 1 1234567',
  street: 'Hauptstraße 5',
  zip: '1010',
  city: 'Wien',
  footer1: 'Vielen Dank',
  footer2: 'www.kreiseck.com',
  footer3: null,
  footer4: null,
  logo_url: 'https://example.invalid/logo.jpg',
  thanks_message: 'Bis bald!\\nWir freuen uns',
  kreiseck_logo: true,
};

/** Antwortrumpf von `createReceipt` — ohne thanks_message (so ist es im Backend). */
const HUELLE_CREATE = { ...HUELLE_GET, thanks_message: undefined } as Record<string, unknown>;

interface Aufruf {
  name: string;
  params: Record<string, unknown> | undefined;
}

function transportMit(daten: unknown): { rufen: KasseneckTransport; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const rufen = (async (name: string, params?: Record<string, unknown>) => {
    aufrufe.push({ name, params });
    return daten;
  }) as KasseneckTransport;
  return { rufen, aufrufe };
}

test('getReceiptWithCompany: liefert Beleg und Firmendaten aus derselben Antwort', async () => {
  const { rufen, aufrufe } = transportMit(HUELLE_GET);
  const { receipt, company } = await getReceiptWithCompany(rufen, 'AT0-42');

  assert.deepEqual(aufrufe, [{ name: 'getReceipt', params: { receiptId: 'AT0-42' } }]);
  assert.equal(receipt.receiptId, 'AT0-42');
  assert.equal(receipt.items[0]?.priceCents, 250);

  assert.deepEqual(company, {
    companyName: 'Café Kreiseck',
    street: 'Hauptstraße 5',
    zip: '1010',
    city: 'Wien',
    phone: '+43 1 1234567',
    uid: 'ATU12345678',
    taxnr: '12-345/6789',
    isSmallBusiness: true,
    footer1: 'Vielen Dank',
    footer2: 'www.kreiseck.com',
    logoUrl: 'https://example.invalid/logo.jpg',
    thanksMessage: ['Bis bald!', 'Wir freuen uns'],
    showKreiseckLogo: true,
  });
});

test('sellReceiptWithCompany: schickt dieselbe Nutzlast wie sellReceipt und liefert die Firmendaten mit', async () => {
  const optionen = {
    paymentMethod: KeckPaymentMethod.cash,
    items: [{ name: 'Espresso', quantity: 2, vat: VatRate.vat20, priceCents: 250 }],
  };
  const mitFirma = transportMit(HUELLE_CREATE);
  const ohneFirma = transportMit(HUELLE_CREATE);

  const ergebnis = await sellReceiptWithCompany(mitFirma.rufen, optionen);
  const beleg = await sellReceipt(ohneFirma.rufen, optionen);

  // Der Weg zum Server ist derselbe — die Variante ergaenzt nur die Auswertung.
  assert.deepEqual(mitFirma.aufrufe, ohneFirma.aufrufe);
  assert.equal(mitFirma.aufrufe[0]?.name, 'createReceipt');
  assert.deepEqual(ergebnis.receipt, beleg);
  assert.equal(ergebnis.company.companyName, 'Café Kreiseck');
});

test('Firmendaten: fehlendes thanks_message ist kein Fehler (createReceipt liefert es nicht)', async () => {
  const { rufen } = transportMit(HUELLE_CREATE);
  const { company } = await sellReceiptWithCompany(rufen, {
    paymentMethod: KeckPaymentMethod.cash,
    items: [{ name: 'Espresso', quantity: 1, vat: VatRate.vat20, priceCents: 250 }],
  });
  assert.deepEqual(company.thanksMessage, []);
});

test('Firmendaten: fehlende und leere Felder werden zu leeren Zeichenketten, nicht zu undefined', async () => {
  // Ein Kundendokument ohne gepflegte Fusszeilen/Anschrift liefert die Felder
  // als null oder gar nicht. Das darf den Belegdruck nicht verhindern.
  const { rufen } = transportMit({ receipt: BELEG_NUTZLAST });
  const { company } = await getReceiptWithCompany(rufen, 'AT0-42');
  assert.deepEqual(company, {
    companyName: '',
    street: '',
    zip: '',
    city: '',
    phone: '',
    taxnr: '',
    isSmallBusiness: false,
    footer1: '',
    footer2: '',
    thanksMessage: [],
    showKreiseckLogo: false,
  });
});

test('Firmendaten: dritte und vierte Fusszeile kommen durch, wenn sie gesetzt sind', async () => {
  const { rufen } = transportMit({ ...HUELLE_GET, footer3: 'Zusatzzeile', footer4: 'Noch eine' });
  const { company } = await getReceiptWithCompany(rufen, 'AT0-42');
  assert.equal(company.footer3, 'Zusatzzeile');
  assert.equal(company.footer4, 'Noch eine');
});

test('Firmendaten: eine Antwort ohne Beleg wirft denselben Fehler wie bisher', async () => {
  const { rufen } = transportMit({ company: 'Café Kreiseck' });
  await assert.rejects(
    () => getReceiptWithCompany(rufen, 'AT0-42'),
    (fehler: unknown) => isKasseneckValidationError(fehler) && /data\.receipt/.test((fehler as Error).message),
  );
});

test('Bestandsaufrufe bleiben unveraendert: getReceipt liefert weiterhin nur den Beleg', async () => {
  const { rufen } = transportMit(HUELLE_GET);
  const beleg = await getReceipt(rufen, 'AT0-42');
  assert.equal(beleg.receiptId, 'AT0-42');
  assert.ok(!Object.prototype.hasOwnProperty.call(beleg, 'company'));
});

test('Die Fabrik reicht beide Varianten durch', async () => {
  const aufrufe: string[] = [];
  const api = createKasseneckApi({
    auth: apiKeyAuth({ apiKey: 'kr_live_TESTSCHLUESSEL', cashregisterToken: 'cb_live_TESTTOKEN' }),
    fetch: async (url) => {
      aufrufe.push(url);
      return {
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
        text: async () => JSON.stringify({ status: 'success', message: '', data: HUELLE_GET }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    },
  });

  const { company } = await api.getReceiptWithCompany('AT0-42');
  assert.equal(company.companyName, 'Café Kreiseck');
  const verkauf = await api.sellReceiptWithCompany({
    paymentMethod: KeckPaymentMethod.cash,
    items: [{ name: 'Espresso', quantity: 1, vat: VatRate.vat20, priceCents: 250 }],
  });
  assert.equal(verkauf.receipt.receiptId, 'AT0-42');
  assert.deepEqual(
    aufrufe.map((u) => u.split('/').at(-1)),
    ['getReceipt', 'createReceipt'],
  );
});
