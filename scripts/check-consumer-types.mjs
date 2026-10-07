#!/usr/bin/env node
/**
 * Prueft das **veroeffentlichte** Paket aus Verbrauchersicht: baut den Tarball
 * (`npm pack`), installiert ihn in zwei frische Wegwerf-Projekte — eines
 * CommonJS, eines ESM — und laesst `tsc` ueber einen Verbraucher laufen, der
 * jeden Unterpfad importiert.
 *
 * Warum das eine eigene Pruefung braucht: Der Doppelbau ESM+CJS scheitert
 * nicht an der Laufzeit, sondern an der **Typaufloesung**. Zeigt die
 * `types`-Bedingung eines Unterpfads auf die ESM-Deklarationen, haelt
 * TypeScript sie wegen `"type": "module"` in der Wurzel-package.json fuer
 * ESM — ein CJS-Verbraucher mit `module: Node16` bekommt dann an jedem Import
 * TS1479, waehrend `require` zur Laufzeit tadellos laeuft. Weder der Bau noch
 * die Testsuite dieses Repos sehen das: beide laufen gegen die Quellen.
 *
 * Bewusst **nicht** Teil von `npm run build`: die Pruefung packt, installiert
 * und uebersetzt zweimal und braucht dafuer ein Vielfaches der Bauzeit. Der
 * schnelle, statische Teil (zeigt `require` in den CJS-Bau, `import` in den
 * ESM-Bau, und liegen die Dateien?) steht in check-build-exports.mjs und
 * laeuft bei jedem Bau mit.
 *
 * Aufruf: `npm run check:consumer`; das Skript baut vorher selbst, damit der
 * Tarball nicht aus einem alten `dist/` entsteht.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const wurzel = process.cwd();
const arbeit = mkdtempSync(join(tmpdir(), 'kasseneck-api-verbraucher-'));

/** Der Verbraucher fasst jeden Unterpfad an — ein Import allein beweist wenig. */
const VERBRAUCHER = `import { createKasseneckApi, apiKeyAuth, VatRate, KeckPaymentMethod } from '@kreiseck/kasseneck-api';
import { buildReceiptLayout, formatCents } from '@kreiseck/kasseneck-api/receipt';
import { createEscPosDocument, escPosText } from '@kreiseck/kasseneck-api/printing';
import type { HobexPayOptions } from '@kreiseck/kasseneck-api/payments';
import { pairRegisterDevice, isRegisterError, registerErrorDetails, type PairedRegisterDevice } from '@kreiseck/kasseneck-api/register';
import { ReceiptLayoutView } from '@kreiseck/kasseneck-api/react';
import { listMyPrinters, setMyPosSettings, POS_SHORTCUT_ACTIONS, type PosSettings, type PosArticle } from '@kreiseck/kasseneck-api/pos';
import { createPartnerApi, verifyWebhookSignature, KasseneckSecret, reportCustomerContract, partnerErrorAdvice, type Business } from '@kreiseck/kasseneck-api/partner';
import { createInvoiceApi, INVOICE_ERROR_CODES, type IssueInvoiceItemInput, type IssueInvoiceRequest, type Invoice, type InvoiceVatIdProof } from '@kreiseck/kasseneck-api/invoice';
import { calculateInvoice } from '@kreiseck/kasseneck-api/invoice/calc';
import { createInventoryClient, verifyInventoryWebhookSignature, parseInventoryWebhookEvent, inventoryShortfalls, INVENTORY_WEBHOOK_EVENTS, RESERVATION_STATUSES, VARIANT_MATRIX_MAX, type StockLevel, type Reservation, type StockOperation, type CreateReservationRequest, type VariantGroup, type AddVariantRequest, type Article } from '@kreiseck/kasseneck-api/inventory';
// 1.0 hat die deutschen Unterpfade ohne Alias entfernt (./kasse -> ./pos,
// ./rechnung -> ./invoice, ./rechnung/rechnen -> ./invoice/calc). Loest einer
// wieder auf, meldet tsc die unbenutzte Erwartung.
// @ts-expect-error entfernt in 1.0
import * as altKasse from '@kreiseck/kasseneck-api/kasse';
// @ts-expect-error entfernt in 1.0
import * as altRechnung from '@kreiseck/kasseneck-api/rechnung';
// @ts-expect-error entfernt in 1.0
import * as altRechnen from '@kreiseck/kasseneck-api/rechnung/rechnen';
import { fromStoredReceipt, fromStoredReceiptWithCompany, fromStoredCompany, fromStoredPosSettings, invalidStoredPosSettings, fromStoredArticle, type StoredDocument } from '@kreiseck/kasseneck-api/stored';
import type { KasseneckTransport } from '@kreiseck/kasseneck-api';

export const api = createKasseneckApi({
  auth: apiKeyAuth({ apiKey: 'kr_test_x', cashregisterToken: 'cb_test_y' }),
});
export const satz: number = VatRate.vat20.rate;
export const zahlungsart: string = KeckPaymentMethod.cash.value;
export const text: string = formatCents(1234);
export const layout = buildReceiptLayout;
export const doc = createEscPosDocument;
export const schreiben = escPosText;
export type Zahlung = HobexPayOptions;
export const koppeln = pairRegisterDevice;
export type Geraet = PairedRegisterDevice;
export const ansicht = ReceiptLayoutView;
// Die Endpunkt-Funktionen nehmen paketintern einen verengten Transport entgegen;
// von aussen bleibt ein KasseneckTransport ohne Umdeutung uebergebbar.
declare const rufen: KasseneckTransport;
export const drucker = listMyPrinters(rufen);
export const betrieb = setMyPosSettings(rufen, { theme: 'night', vatRates: { '20': true } });
export const aktionen: readonly string[] = POS_SHORTCUT_ACTIONS;
export type Einstellungen = PosSettings;
// Ein Artikel-Literal, wie Verbraucher es vor 1.2.0/1.3.0 bauten: ohne
// stockLocationIds, number, ean, internalCode, stockTracked (alle optional).
export const kachelArtikel: PosArticle = {
  id: 'a1', name: 'Semmel', unitPriceCents: 79, vatRate: 10, unit: 'Stk', groupId: null, revenueGroupId: null,
  visible: true, sort: 0, active: true, quantityRule: null, askQuantity: null, maxQuantity: null,
};
export const belegt = (e: unknown): string | null => (isRegisterError(e, 'cashregister_in_use') ? registerErrorDetails(e).deviceLabel : null);
export const partner = createPartnerApi;
export const webhookPruefen = verifyWebhookSignature;
export type Geheimnis = KasseneckSecret;
export const vertragMelden = reportCustomerContract;
export const rat: string = partnerErrorAdvice('brand_new_code');
export type Betriebsdaten = Business;
export const rechnungen = createInvoiceApi;
export const rechnungsCodes: readonly string[] = INVOICE_ERROR_CODES;
export const alt: unknown[] = [altKasse, altRechnung, altRechnen];
export const summen = calculateInvoice(
  [{ unitPriceMicros: 14_790_000, quantityMilli: 1000, vatRateBp: 2000 }],
  { priceMode: 'gross' },
);
// ./inventory: Lager lesen, Konto-Webhooks pruefen und typisiert lesen.
export const lager = createInventoryClient({ apiKey: 'kr_test_x' });
export const lagerPruefen: Promise<boolean> = verifyInventoryWebhookSignature('whsec_x', 't=1,v1=00', '{}', { now: new Date(1000) });
const lagerE = parseInventoryWebhookEvent('{}');
export const lagerFolge: number | null = lagerE && lagerE.type === 'stock.changed' ? lagerE.data.sequence : null;
export const lagerEreignisse: readonly string[] = INVENTORY_WEBHOOK_EVENTS;
export type Bestandszeile = StockLevel;
// ./inventory schreiben und reservieren (1.5.0): idempotencyKey ist Pflicht im Typ.
const reservieren: CreateReservationRequest = { idempotencyKey: 'shop-res-1', items: [{ articleId: 'kaisersemmel', quantity: 6000 }], expiresInMinutes: 30 };
export const reserviert: Promise<Reservation> = lager.createReservation(reservieren);
export const gebucht: Promise<StockOperation> = lager.receiveGoods({ idempotencyKey: 'we-1', items: [{ articleId: 'kaisersemmel', quantity: 60000, unitPriceMicros: 380000 }] });
// @ts-expect-error ohne idempotencyKey keine schreibende Anfrage
export const ohneSchluessel = lager.transferStock({ fromLocationId: 'haupt', toLocationId: 'lieferwagen', items: [] });
const lagerR = parseInventoryWebhookEvent('{}');
export const lagerStand: string | null = lagerR && lagerR.type === 'reservation.expired' ? lagerR.data.status : null;
export const fehlmenge: number = inventoryShortfalls(null)[0]?.available ?? 0;
export const reservierungsStaende: readonly string[] = RESERVATION_STATUSES;
// ./inventory Varianten (1.6.0): Gruppe mit Matrix, Variante als Artikel, Ereignis typisiert.
export const gruppe: Promise<VariantGroup> = lager.createVariantGroup({
  idempotencyKey: 'shop-gruppe-1', name: 'Schürze', attributes: [{ key: 'groesse', label: 'Größe', values: ['S', 'M'] }], createMatrix: true,
});
const variante: AddVariantRequest = { idempotencyKey: 'shop-variante-1', variantGroupId: 'vg_1', variantAttributes: { groesse: 'L' } };
export const varianteArtikel: Promise<Article> = lager.addVariant(variante);
export const stillgelegt: Promise<VariantGroup> = lager.updateVariantGroup({ idempotencyKey: 'shop-gruppe-1-aus', variantGroupId: 'vg_1', active: false });
// @ts-expect-error eine stillgelegte Gruppe laesst sich nicht wieder aktivieren
export const reaktiviert = lager.updateVariantGroup({ idempotencyKey: 'k', variantGroupId: 'vg_1', active: true });
// @ts-expect-error ohne idempotencyKey keine Variante
export const ohneSchluesselVariante = lager.addVariant({ variantGroupId: 'vg_1', variantAttributes: { groesse: 'L' } });
const lagerV = parseInventoryWebhookEvent('{}');
export const gruppenStand: string | null = lagerV && lagerV.type === 'variant_group.updated' ? lagerV.data.updatedAt : null;
export const matrixGrenze: number = VARIANT_MATRIX_MAX;
export const rechnungsPosition: IssueInvoiceItemInput = { description: 'Kaisersemmel', quantity: 6, unitPriceCents: 65, vatRate: 10, articleId: 'kaisersemmel', reservationId: 'res_1' };
// UID-Pruefung beim Ausstellen ohne Steuer: Risiko uebernehmen, Nachweis lesen.
export const mitRisiko: Pick<IssueInvoiceRequest, 'acceptVatIdRisk'> = { acceptVatIdRisk: true };
declare const ausgestellt: Invoice;
export const uidQuelle: InvoiceVatIdProof['source'] | null = ausgestellt.vatIdProof?.source ?? null;
export const risikoTag: string | null = ausgestellt.vatIdRisk?.acceptedOn ?? null;
// ./stored: gespeicherte Dokumente als dieselben Modelle wie am Draht.
export const gespeichert: string = fromStoredReceipt({ receiptId: 'K-1' }).receiptId;
declare const kopf: StoredDocument;
export const mitFirma = fromStoredReceiptWithCompany({}, { headerVersion: kopf }).layout;
export const firma: string = fromStoredCompany({}).companyName;
export const thema: string = fromStoredPosSettings({ betrieb: { stil: 'nacht' } }).business.theme;
export const kachel: boolean = fromStoredArticle('a1', {}).visible;
export const ungueltig: string[] = invalidStoredPosSettings({ betrieb: { wzPos: 500 } });
// Und ein Aufruf, den dieses Paket NICHT umhuellt: KasseneckTransport nimmt
// weiterhin jeden Aufrufnamen entgegen. Ohne diese Zeile faellt es niemandem
// auf, wenn die paketinterne Verengung nach aussen durchschlaegt — und ein
// Verbraucher kaeme an jeden Endpunkt, den dieses Paket noch nicht kennt,
// nicht mehr heran.
export const fremd = rufen('irgendeinNeuerEndpunkt', {});
`;

function lauf(befehl, argumente, verzeichnis) {
  return execFileSync(befehl, argumente, { cwd: verzeichnis, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tarballBauen() {
  lauf('npm', ['run', 'build'], wurzel);
  lauf('npm', ['pack', '--pack-destination', arbeit], wurzel);
  const datei = readdirSync(arbeit).find((name) => name.endsWith('.tgz'));
  if (!datei) {
    throw new Error('npm pack hat keinen Tarball erzeugt');
  }
  return resolve(arbeit, datei);
}

/**
 * Legt ein Wegwerf-Projekt an und uebersetzt den Verbraucher darin.
 * `modul` entscheidet ueber die Modulart des Verbrauchers: 'commonjs' laesst
 * die `type`-Angabe weg (Node-Vorgabe), 'module' setzt sie.
 */
function verbraucherPruefen(name, modul, tarball) {
  const verzeichnis = join(arbeit, name);
  mkdirSync(join(verzeichnis, 'src'), { recursive: true });
  writeFileSync(
    join(verzeichnis, 'package.json'),
    JSON.stringify({ name: `verbraucher-${name}`, version: '1.0.0', private: true, ...(modul === 'module' ? { type: 'module' } : {}) }, null, 2),
  );
  writeFileSync(
    join(verzeichnis, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          // Node16 ist die Einstellung, unter der TypeScript die
          // exports-Bedingungen ueberhaupt erst auswertet.
          module: 'Node16',
          moduleResolution: 'Node16',
          target: 'ES2022',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          jsx: 'react-jsx',
          types: [],
        },
        include: ['src'],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(verzeichnis, 'src', 'index.ts'), VERBRAUCHER);

  lauf('npm', ['install', '--no-audit', '--no-fund', '--silent', tarball, `typescript@${typescriptVersion()}`, '@types/react', 'react'], verzeichnis);
  try {
    lauf(join(verzeichnis, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], verzeichnis);
  } catch (fehler) {
    const ausgabe = `${fehler.stdout ?? ''}${fehler.stderr ?? ''}`.trim();
    return { name, modul, ok: false, ausgabe };
  }
  return { name, modul, ok: true, ausgabe: '' };
}

/**
 * Dieselbe TypeScript-Spanne wie im Repo — unveraendert, nicht auf die
 * Untergrenze zurechtgeschnitten: `^5.4.0` gaebe als `5.4.0` einen
 * ETARGET-Fehler, die Reihe faengt bei 5.4.2 an.
 */
function typescriptVersion() {
  const paket = JSON.parse(lauf('node', ['-p', 'JSON.stringify(require("./package.json"))'], wurzel));
  return paket.devDependencies?.typescript ?? 'latest';
}

let fehlgeschlagen = false;
try {
  const tarball = tarballBauen();
  for (const ergebnis of [verbraucherPruefen('cjs', 'commonjs', tarball), verbraucherPruefen('esm', 'module', tarball)]) {
    if (ergebnis.ok) {
      process.stdout.write(`Verbraucher ${ergebnis.name} (${ergebnis.modul}, module: Node16): tsc gruen\n`);
    } else {
      fehlgeschlagen = true;
      process.stderr.write(`Verbraucher ${ergebnis.name} (${ergebnis.modul}, module: Node16) uebersetzt NICHT:\n${ergebnis.ausgabe}\n`);
    }
  }
} finally {
  rmSync(arbeit, { recursive: true, force: true });
}

process.exit(fehlgeschlagen ? 1 : 0);
