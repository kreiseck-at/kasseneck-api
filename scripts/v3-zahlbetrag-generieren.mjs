#!/usr/bin/env node
/**
 * Erzeugt `fixtures/receipt-due-generated.json`: Rechenfaelle fuer den
 * Zwilling `receiptDueCents`, gerechnet mit dem **echten Backend-Code**
 * (`functions/gemeinsam/beleg-toepfe.js`, `tip-core.js`, `zahlungen-core.js`),
 * in derselben Reihenfolge wie `createReceipt` in `functions/index.js`:
 * `interneForm`, Trinkgeld aus `tip`, dann je Zahlart aus `payments[].tipCents`
 * (`buildTipItems`, hinten angehaengt), `belegToepfe`, `zahlbetragCents`.
 *
 * Aufruf: `KASSENECK_BACKEND=../kasseneck node scripts/v3-zahlbetrag-generieren.mjs`
 * (Vorgabe `../kasseneck`). Fester Seed: zwei Laeufe gegen denselben
 * Backend-Stand ergeben dieselben Bytes. Das Backend wird nur gelesen.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const SEED = 20260928;
const ANZAHL = 1200;
const backend = resolve(process.env.KASSENECK_BACKEND ?? '../kasseneck');
const kern = (datei) => resolve(backend, 'functions/gemeinsam', datei);
const require = createRequire(kern('beleg-toepfe.js'));
const belegToepfe = require(kern('beleg-toepfe.js'));
const tipCore = require(kern('tip-core.js'));
const zahlungen = require(kern('zahlungen-core.js'));

// mulberry32: klein, deterministisch, ueberall gleich.
function zufall(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = zufall(SEED);
const ganz = (min, max) => min + Math.floor(r() * (max - min + 1));
const eins = (liste) => liste[Math.floor(r() * liste.length)];
const ja = (p) => r() < p;

const BRUCHMENGEN = [0.5, 0.25, 0.125, 0.375, 0.333, 0.1, 0.2, 0.7, 0.75, 1.5, 2.5, 1.25, 0.05, 0.001, 0.35, 3.7];
const SAETZE = [20, 20, 10, 10, 13, 0, 19, 4.9, 7];
const ZAHLARTEN = ['cash', 'creditCard', 'online'];

function position(storno) {
  const menge = ja(0.5) ? eins(BRUCHMENGEN) : ganz(1, 5);
  // Oft ungerade Cent: dort liegen die halben Cent der Bruchmengen.
  const preis = ja(0.3) ? ganz(1, 99) : ganz(1, 5000);
  return { name: 'P', quantity: storno ? -menge : menge, priceCents: preis, vatRate: eins(SAETZE) };
}

function fall(i) {
  const receiptType = ja(0.03) ? eins(['zero', 'start']) : ja(0.12) ? 'cancellation' : ja(0.1) ? 'training' : 'standard';
  if (receiptType === 'zero' || receiptType === 'start') return { name: `gen_${i}`, input: { receiptType, items: [], vouchers: [] } };
  const storno = receiptType === 'cancellation';
  const items = Array.from({ length: ganz(1, 5) }, () => position(storno));
  const vouchers = [];
  const g = r();
  if (g < 0.25) vouchers.push({ action: 'redeem', type: 'promo', valueCents: ganz(1, 3000) });
  else if (g < 0.35) vouchers.push({ action: 'sell', type: 'value', valueCents: ganz(100, 5000) });
  else if (g < 0.45) vouchers.push({ action: 'redeem', type: 'value', valueCents: ganz(100, 3000) });
  else if (g < 0.5) vouchers.push({ action: 'redeem', type: 'value', valueCents: ganz(100, 3000) }, { action: 'sell', type: 'value', valueCents: ganz(100, 3000) });
  const input = { receiptType, items, vouchers };
  if (storno && ja(0.3)) {
    // Gespiegelte Trinkgeld-Position am Storno (negativ), Personal oder Inhaber.
    const owner = ja(0.4);
    items.push({ name: 'Trinkgeld', quantity: 1, priceCents: -ganz(1, 500), vatRate: owner ? eins([20, 10]) : 0, kind: 'tip', owner });
  }
  if (!storno) {
    const t = r();
    input.tipRecipient = ja(0.5) ? 'owner' : 'staff';
    if (t < 0.25) input.tip = ganz(1, 500);
    else if (t < 0.35) {
      const a = ganz(1, 300);
      const b = ganz(1, 300);
      input.tip = { cents: a + b, recipients: [{ cents: a, owner: ja(0.5) }, { cents: b, owner: ja(0.5) }] };
    } else if (t < 0.55) {
      input.payments = Array.from({ length: ganz(1, 3) }, () => ({ method: eins(ZAHLARTEN), ...(ja(0.7) ? { tipCents: ganz(1, 400) } : {}) }));
    } else delete input.tipRecipient;
  }
  return { name: `gen_${i}`, input };
}

/** Die Faelle aus dem Review (halber Cent, Promo mit Bruchmenge, Inhaber-Aufteilung, Inhaber-Anmeldung). */
const BENANNT = [
  { name: 'half_cent_single', input: { receiptType: 'standard', items: [{ name: 'A', quantity: 0.5, priceCents: 29, vatRate: 20 }], vouchers: [] } },
  {
    name: 'half_cent_promo_value_staff_tip',
    input: {
      receiptType: 'standard',
      items: [{ name: 'A', quantity: 0.5, priceCents: 29, vatRate: 20 }, { name: 'B', quantity: 2, priceCents: 350, vatRate: 10 }],
      vouchers: [{ action: 'redeem', type: 'promo', valueCents: 100 }, { action: 'redeem', type: 'value', valueCents: 200 }],
      tip: 50,
      tipRecipient: 'staff',
    },
  },
  {
    name: 'half_cent_owner_split',
    input: {
      receiptType: 'standard',
      items: [{ name: 'A', quantity: 0.5, priceCents: 29, vatRate: 20 }, { name: 'B', quantity: 0.5, priceCents: 57, vatRate: 10 }],
      vouchers: [],
      tip: 100,
      tipRecipient: 'owner',
    },
  },
  {
    name: 'owner_login_promo_exceeds',
    input: { receiptType: 'standard', items: [{ name: 'A', quantity: 1, priceCents: 500, vatRate: 20 }], vouchers: [{ action: 'redeem', type: 'promo', valueCents: 600 }], tip: 100, tipRecipient: 'owner' },
  },
  // 0,001 x 1 ct ergibt eine Warenbasis von 0 Cent: der Server weist das Trinkgeld ab.
  { name: 'tip_without_goods_base', input: { receiptType: 'standard', items: [{ name: 'A', quantity: 0.001, priceCents: 1, vatRate: 20 }], vouchers: [], tip: 10, tipRecipient: 'staff' } },
  {
    name: 'payment_tip_cents_owner',
    input: {
      receiptType: 'standard',
      items: [{ name: 'A', quantity: 3, priceCents: 333, vatRate: 20 }, { name: 'B', quantity: 0.5, priceCents: 57, vatRate: 10 }],
      vouchers: [{ action: 'redeem', type: 'promo', valueCents: 150 }],
      payments: [{ method: 'creditCard', tipCents: 120 }, { method: 'cash' }, { method: 'creditCard', tipCents: 30 }],
      tipRecipient: 'owner',
    },
  },
];

const UMSATZ = new Set(['standard', 'cancellation', 'training']);
const tief = (x) => JSON.parse(JSON.stringify(x));

/** Wie createReceipt: Positionen in Drahtform, Trinkgeld-Runden, Toepfe. */
function rechne({ receiptType, items, vouchers, tip, payments, tipRecipient }) {
  const draht = items.map((p) => ({
    name: p.name, quantity: p.quantity, unitPriceCents: p.priceCents, vatRate: p.vatRate,
    ...(p.kind === 'tip' ? { kind: 'tip', recipient: p.owner ? { registerUserId: 'ru_inhaber', name: 'Inhaber', owner: true } : null } : {}),
  }));
  const innen = belegToepfe.interneForm(tief(draht), tief(vouchers));
  let alle = innen.items;
  const anmeldung = (cents) => [{ registerUserId: 'ru_login', name: 'Login', inhaber: tipRecipient === 'owner', cents }];
  const runde = (cents, empfaenger) => {
    const gebaut = tipCore.buildTipItems({ tip: { cents, paymentMethod: 'cash', recipients: null }, receiptItems: alle, empfaenger });
    if (gebaut.error) throw new Error(gebaut.error);
    alle = [...alle, ...gebaut.items];
  };
  try {
    if (tip != null) {
      const cents = typeof tip === 'number' ? tip : tip.cents;
      const empf = typeof tip === 'object' && tip.recipients
        ? tip.recipients.map((x, i) => ({ registerUserId: `ru_${i}`, name: `E${i}`, inhaber: x.owner, cents: x.cents }))
        : anmeldung(cents);
      runde(cents, empf);
    }
    for (const { cents } of zahlungen.tipsJeZahlart(payments ?? [])) runde(cents, anmeldung(cents));
  } catch (fehler) {
    return { error: fehler.message };
  }
  if (!UMSATZ.has(receiptType)) return { dueCents: 0, counterDeltaCents: 0, valueVoucherFlowCents: 0, bucketsCents: null };
  const t = belegToepfe.belegToepfe(alle, innen.vouchers);
  const due = zahlungen.zahlbetragCents(t, innen.vouchers, receiptType);
  const TOEPFE = ['amountRateStandard', 'amountRateReduced1', 'amountRateReduced2', 'amountRateZero', 'amountRateSpecial', 'amountRatOthers'];
  return {
    dueCents: due,
    counterDeltaCents: t.zaehlerDeltaCents,
    valueVoucherFlowCents: due - t.zaehlerDeltaCents,
    bucketsCents: Object.fromEntries(TOEPFE.map((b) => [b, Math.round(t[b] * 100)])),
  };
}

const cases = [...BENANNT, ...Array.from({ length: ANZAHL }, (_, i) => fall(i))].map((f) => ({ ...f, expected: rechne(f.input) }));
// JSON kennt kein -0; der Vergleich im Test soll dieselben Zahlen sehen.
const inhalt = JSON.parse(JSON.stringify({ seed: SEED, cases }, (_k, v) => (Object.is(v, -0) ? 0 : v)));
const quellen = Object.fromEntries(['beleg-toepfe.js', 'tip-core.js', 'zahlungen-core.js', 'vat-buckets.js'].map((d) => [d, createHash('sha256').update(readFileSync(kern(d))).digest('hex')]));
const datei = {
  _note: 'Erzeugt von scripts/v3-zahlbetrag-generieren.mjs mit dem echten Backend-Code. Nicht von Hand pflegen.',
  _source: quellen,
  ...inhalt,
};
// Ein Fall je Zeile: lesbar im Diff, ohne die Datei aufzublaehen.
const kopf = JSON.stringify({ _note: datei._note, _source: datei._source, seed: datei.seed }, null, 2).replace(/\n}$/, '');
const zeilen = datei.cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n');
writeFileSync(new URL('../fixtures/receipt-due-generated.json', import.meta.url), `${kopf},\n  "cases": [\n${zeilen}\n  ]\n}\n`);
const fehler = cases.filter((c) => c.expected.error).length;
console.log(`${cases.length} Faelle geschrieben (${fehler} mit Fehler), Backend ${backend}`);
