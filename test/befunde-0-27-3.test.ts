import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type {
  HpsCancelOptions,
  HpsConnectCancelOptions,
  HpsConnectRefundOptions,
  HpsPayments,
  HpsRefundOptions,
} from '../src/payments/index.js';

const WURZEL = new URL('../../', import.meta.url);
const lies = (pfad: string): string => readFileSync(new URL(pfad, WURZEL), 'utf8');

/**
 * `HpsPayments.refund/cancel` und `HpsConnectClient.refund/cancel` gibt es
 * unter `…/payments`; ihre Optionstypen muessen dort ebenfalls zu haben sein,
 * sonst kann ein Verbraucher die Aufrufe nicht sauber typisieren. Die
 * Pruefung ist die Uebersetzung dieser Datei: fehlt ein Export, bricht `tsc`.
 */
test('payments: Optionstypen fuer Gutschrift und Aufhebung sind exportiert', () => {
  const gutschrift: HpsRefundOptions = { amountCents: 100, originalTransactionId: 'T1' };
  const aufhebung: HpsCancelOptions = { transactionId: 'T1', amountCents: 100 };
  const passt: Parameters<HpsPayments['refund']>[0] = gutschrift;
  const passtAuch: Parameters<HpsPayments['cancel']>[0] = aufhebung;
  const connectGutschrift: HpsConnectRefundOptions | undefined = undefined;
  const connectAufhebung: HpsConnectCancelOptions | undefined = undefined;
  assert.equal(passt.amountCents, 100);
  assert.equal(passtAuch.transactionId, 'T1');
  assert.equal(connectGutschrift ?? connectAufhebung, undefined);
});

test('payments: Kopfkommentar verweist Gutschrift/Storno nicht mehr auf die Flutter-App', () => {
  const kopf = lies('src/payments/index.ts');
  assert.doesNotMatch(kopf, /braucht weiterhin\s+\*?\s*die\s+\*?\s*Flutter-App/);
});

function dateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    return statSync(pfad).isDirectory() ? dateien(pfad) : [pfad];
  });
}

/** § 131 ff. (Registrierkasse, Barumsatz) stehen in der BAO, nicht im UStG. */
test('Quellen: § 131/131b wird der BAO zugeordnet, nie dem UStG', () => {
  const src = new URL('src/', WURZEL).pathname;
  const falsch = dateien(src)
    .filter((d) => /\.tsx?$/.test(d))
    .filter((d) => /§\s*131[a-z]?\b[^\n]{0,40}UStG/.test(readFileSync(d, 'utf8')));
  assert.deepEqual(falsch, []);
});

/**
 * `rechnungSummen` rechnet nach der frueheren Formel (Weg 2) und ist
 * deshalb zugunsten des Kerns als veraltet markiert; der Kopf darf nicht
 * mehr behaupten, genau wie der Server zu rechnen.
 */
test('rechnungSummen: als veraltet markiert, verweist auf rechnungRechnen', () => {
  const quelle = lies('src/rechnung/summen.ts');
  assert.match(quelle, /@deprecated[^]*?rechnungRechnen[^]*?export function rechnungSummen/);
  assert.doesNotMatch(quelle, /genau so, wie der Server sie beim\s+\*\s*Ausstellen rechnet/);
});
