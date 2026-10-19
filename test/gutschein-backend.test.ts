import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { fromReceiptCompanyPayload, fromReceiptPayload, receiptSumCents } from '../src/models/index.js';
import { buildReceiptLayout, type ReceiptLayout } from '../src/receipt/index.js';

/*
 * Gutschein-Katalog des Backends gegen diese Linie (das Backend vendort 0.x
 * und setzt damit Bon, PDF und Mail): jeder Erfolgsfall von
 * functions/test/unit/fixtures/gutschein-faelle.json und sein Storno,
 * gespeichert wie createReceipt/cancelReceipt (Helfer gutschein-gespeichert),
 * geht einmal roh (die Firestore-Form, wie sie ist) und einmal aufbereitet
 * (functions/beleg-layout.js belegPayload mit gutscheineFuerPaket) durch
 * fromReceiptPayload und buildReceiptLayout. Beide Male muss gelten:
 * receiptSumCents und „Gesamt“ = Zahlbetrag des Servers
 * (gutschein-beleg.zahlbetrag), Steuertabelle = signierte Toepfe. Dieselbe
 * Pruefung wie beleg-layout-gutschein.test.js im Backend (Vorfall 16.10.2026:
 * Verkauf ueber 30 € zeigte „Gesamt 60,00“).
 *
 * Braucht einen Backend-Checkout (KASSENECK_BACKEND, Repo kasseneck mit
 * `npm ci` in functions); ohne ihn wird der Test mit Hinweis uebersprungen.
 * Die Golden-Belege gutschein-* (layout-gutschein-neu.test.ts) halten die
 * Zeilen dann am letzten belegten Stand.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const BACKEND = process.env['KASSENECK_BACKEND'];
const HINWEIS = 'KASSENECK_BACKEND fehlt: Pfad zum Backend-Checkout (Repo kasseneck, npm ci in functions), sonst ist nichts zu vergleichen';
const lade = BACKEND ? createRequire(resolve(BACKEND, 'functions/package.json')) : null;

// Vor dem Stichtag stand ein Wertgutschein-Verkauf nicht im 0-%-Topf (Bestandsluecke): der Bon zeigt die
// 0-%-Zeile, der Topf ist leer -- bewusst unveraendert (Backend-Test: VOR_STICHTAG).
const VOR_STICHTAG = ['mz_verkauf_vor_stichtag', 'alt_value_verkauf_vor_stichtag_unveraendert'];
// Rabattgutschein + Trinkgeld verteilt das Paket anders als belegToepfe (Backend-Test: BEKANNT).
const BEKANNT = ['ak_prozent_mit_trinkgeld'];
const KATEGORIE: Record<string, string> = { A: 'amountRateStandard', B: 'amountRateReduced1', C: 'amountRateReduced2', D: 'amountRateZero', E: 'amountRateSpecial' };

const zeilenText = (w: unknown): string => (Array.isArray(w) ? w.filter(Boolean).join('\n') : typeof w === 'string' ? w : '');
/** Firestore-Beleg -> Nutzlast wie belegPayload, aber ohne Aufbereitung der Gutscheine. */
const roh = (b: Json): Json => ({
  ...b, customerDetails: zeilenText(b.customerDetails), legalMessage: zeilenText(b.legalMessage), paymentMethod: b.paymentMethod ?? null,
  receiptType: b.receiptType || 'standard', sig: b.sig || '', qr: b.qr || '', fullReceiptId: b.fullReceiptId || '',
});
const euro = (c: number): string => `${(c / 100).toFixed(2).replace('.', ',')} €`;
const gesamt = (l: ReceiptLayout): string | null => {
  const z = l.lines.find((x) => x.kind === 'columns' && x.columns[0]!.text === 'Gesamt:');
  return z && z.kind === 'columns' ? z.columns[1]!.text : null;
};
const steuer = (l: ReceiptLayout): Record<string, number> => {
  const r: Record<string, number> = {};
  for (const z of l.lines) {
    if (z.kind !== 'columns' || z.columns.length !== 4) continue;
    const m = /^([A-E]) /.exec(z.columns[0]!.text);
    const c = m ? Math.round(Number(z.columns[3]!.text.replace(/\./g, '').replace(',', '.')) * 100) : 0;
    if (m && c !== 0) r[m[1]!] = c;
  }
  return r;
};
const toepfe = (b: Json): Record<string, number> => {
  const r: Record<string, number> = {};
  for (const [k, feld] of Object.entries(KATEGORIE)) {
    const c = Math.round((Number(b[feld]) || 0) * 100);
    if (c !== 0) r[k] = c;
  }
  return r;
};

test('Gutschein-Katalog des Backends roh und aufbereitet: Gesamt = Zahlbetrag, Steuertabelle = Toepfe', (t: TestContext) => {
  if (!lade) { t.skip(HINWEIS); return; }
  const g = globalThis as Json;
  const vorher = { beforeAll: g.beforeAll, afterAll: g.afterAll, emu: process.env['FUNCTIONS_EMULATOR'], ab: process.env['GUTSCHEIN_NULLTOPF_AB_TEST'] };
  // Der Helfer ist fuer jest geschrieben; ausserhalb davon sind die Haken leer.
  g.beforeAll = g.beforeAll ?? (() => {});
  g.afterAll = g.afterAll ?? (() => {});
  try {
    const welt = lade('./test/unit/helpers/gutschein-gespeichert.js');
    const gb = lade('./gemeinsam/gutschein-beleg.js');
    const { belegPayload } = lade('./beleg-layout.js');
    // Stichtag des 0-%-Topfs aus dem Katalog (wie welt.stichtagAusKatalog im Backend).
    process.env['FUNCTIONS_EMULATOR'] = 'true';
    process.env['GUTSCHEIN_NULLTOPF_AB_TEST'] = welt.katalog.nulltopfAb;
    const firma = fromReceiptCompanyPayload({ company: 'Bäckerei Kornblum', street: 'Neubaugasse 12', zip: '1070', city: 'Wien', uid: 'ATU12345675' });
    const abweichend: string[] = [];
    let geprueft = 0;
    for (const f of welt.erfolgsFaelle() as Json[]) {
      const o = welt.gespeichert(f);
      const belege: Array<[string, Json]> = [['', o]];
      try { belege.push([' (Storno)', welt.storniert(o)]); } catch { /* nicht stornierbar */ }
      for (const [zusatz, doc] of belege) {
        geprueft += 1;
        const soll = gb.zahlbetrag(doc.items, doc.vouchers, doc.receiptType) as number;
        for (const [weg, payload] of [['roh', roh(doc)], ['aufbereitet', belegPayload(doc)]] as const) {
          const beleg = fromReceiptPayload(payload);
          const l = buildReceiptLayout(beleg, firma, { paperSize: 'mm80' });
          const name = `${f.name}${zusatz} ${weg}`;
          if (receiptSumCents(beleg) !== soll) abweichend.push(`${name}: receiptSumCents ${receiptSumCents(beleg)}, Zahlbetrag ${soll}`);
          if (gesamt(l) !== euro(soll)) abweichend.push(`${name}: Gesamt ${gesamt(l)}, Zahlbetrag ${euro(soll)}`);
          const ohneTopf = VOR_STICHTAG.includes(f.name) || BEKANNT.includes(f.name);
          if (!ohneTopf && JSON.stringify(steuer(l)) !== JSON.stringify(toepfe(doc))) abweichend.push(`${name}: Steuer ${JSON.stringify(steuer(l))}, Toepfe ${JSON.stringify(toepfe(doc))}`);
        }
      }
    }
    assert.ok(geprueft > 30, `nur ${geprueft} Belege`);
    assert.deepEqual(abweichend, []);
  } finally {
    g.beforeAll = vorher.beforeAll;
    g.afterAll = vorher.afterAll;
    for (const [k, w] of [['FUNCTIONS_EMULATOR', vorher.emu], ['GUTSCHEIN_NULLTOPF_AB_TEST', vorher.ab]] as const) {
      if (w === undefined) delete process.env[k]; else process.env[k] = w;
    }
  }
});
