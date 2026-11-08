import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  POS_BUSINESS_DEFAULTS, mergePosSettings, posDiscountPresets, discountPresetChipText, discountChipsFromPresets, checkDiscountPresets,
  discountBlockLines, shiftReceiptLayout, setMyPosSettings, posSettingsChanges, sanitizePosSettings, messageText, labelText,
  INVALID_DISCOUNT_PRESET, DISCOUNT_PRESETS_MAX, DISCOUNT_PRESET_KIND, POS_ERROR_CODES, type PosDiscountPreset, type ShiftSummaryReceipt,
} from '../src/pos/index.js';
import { fromStoredPosSettings, invalidStoredPosSettings } from '../src/stored/index.js';
import { KasseneckValidationError } from '../src/client/errors.js';
import { gridToText, renderReceiptGrid } from '../src/receipt/index.js';

/*
 * Rabatt-Vorlagen (business.discountPresets): die Pruefaelle fixtures/discount-preset-cases.json sind byte-gleich mit
 * dem Backend (functions-kasse/test/unit/fixtures/discount-preset-cases.json). `innen` ist die gespeicherte Form
 * (rabattVorlagen/art/prozentBp/betragCents), `aussen` die Drahtform; die Faelle der Pruefung stehen innen und werden hier
 * in die Drahtform uebersetzt.
 */

type Json = Record<string, any>;
const FAELLE = JSON.parse(readFileSync(new URL('../../fixtures/discount-preset-cases.json', import.meta.url), 'utf8')) as Json;

const KIND: Record<string, string> = { prozent: 'percent', betrag: 'amount' };
const FELD: Record<string, string> = { art: 'kind', prozentBp: 'percentBp', betragCents: 'amountCents' };
/** Gespeicherte Vorlage -> Drahtform (Schluessel und Art); alles Fremde bleibt, wie es ist. */
const draht = (v: unknown): unknown => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
  return Object.fromEntries(Object.entries(v as Json).map(([k, w]) => [FELD[k] ?? k, k === 'art' ? KIND[w] ?? w : w]));
};
const drahtListe = (l: unknown): unknown => (Array.isArray(l) ? l.map(draht) : l);

test('Vertrag: die Faelle sind die des Backends (Abschnitte und Anzahl)', () => {
  assert.deepEqual(Object.keys(FAELLE), ['hinweis', 'wirksam', 'chipText', 'spiegelung', 'pruefung', 'bonBlock']);
  assert.ok(FAELLE.wirksam.length >= 5 && FAELLE.chipText.length >= 9 && FAELLE.spiegelung.length >= 5 && FAELLE.pruefung.length >= 27 && FAELLE.bonBlock.length >= 4);
});

test('Katalog: Arten, Grenzen und Fehlercode wie im Backend', () => {
  assert.deepEqual([...DISCOUNT_PRESET_KIND], ['percent', 'amount']);
  assert.equal(DISCOUNT_PRESETS_MAX, 5);
  assert.equal(INVALID_DISCOUNT_PRESET, 'invalid_discount_preset');
  assert.ok((POS_ERROR_CODES as readonly string[]).includes(INVALID_DISCOUNT_PRESET));
});

for (const f of FAELLE.wirksam as Json[]) {
  test(`wirksam: ${f.name}`, () => {
    // Direkt aus der Drahtform (ohne Standard-Chips) ...
    assert.deepEqual(posDiscountPresets(f.aussen), f.erwartetAussen);
    // ... und durch den Leser: Vorlagen ueberstimmen die Standard-Chips, ohne Vorlagen gilt discountChips.
    const geleser = mergePosSettings(POS_BUSINESS_DEFAULTS, { ...f.aussen });
    const erwartet = 'discountPresets' in f.aussen || 'discountChips' in f.aussen ? f.erwartetAussen : posDiscountPresets({ discountChips: POS_BUSINESS_DEFAULTS.discountChips });
    assert.deepEqual(posDiscountPresets(geleser), erwartet);
  });
  test(`wirksam (gespeichert): ${f.name}`, () => {
    const stand = fromStoredPosSettings({ betrieb: f.innen });
    if ('rabattVorlagen' in f.innen) assert.deepEqual(stand.business.discountPresets, f.erwartetAussen);
    else assert.equal('discountPresets' in stand.business, false);
    if ('rabattVorlagen' in f.innen || 'rabattChips' in f.innen) assert.deepEqual(posDiscountPresets(stand.business), f.erwartetAussen);
  });
}

for (const f of FAELLE.chipText as Json[]) {
  test(`chipText: ${f.chip}`, () => {
    assert.equal(discountPresetChipText(f.vorlageAussen), f.chip);
  });
}

for (const f of FAELLE.spiegelung as Json[]) {
  test(`spiegelung: ${f.name}`, () => {
    assert.deepEqual(discountChipsFromPresets(drahtListe(f.vorlagen) as PosDiscountPreset[]), f.rabattChips);
    // Die gespeicherte Form ergibt dieselben Chips am Ausgang des Lesers.
    const stand = fromStoredPosSettings({ betrieb: { rabattVorlagen: f.vorlagen, rabattChips: [99] } });
    assert.deepEqual(stand.business.discountChips, f.rabattChips);
  });
}

for (const f of FAELLE.pruefung as Json[]) {
  test(`pruefung: ${f.name}`, () => {
    const r = checkDiscountPresets(drahtListe(f.eingabe));
    assert.equal(r.ok, f.ok);
    if (r.ok) {
      assert.deepEqual(r.value, drahtListe(f.wert));
    } else {
      assert.equal(r.code, f.code);
      assert.deepEqual(r.errors.map((e) => ({ index: e.index, feld: e.field, meldung: e.message })),
        (f.fehler as Json[]).map((e) => ({ index: e.index, feld: e.feld === null ? null : FELD[e.feld] ?? e.feld, meldung: e.meldung })));
    }
  });
}

test('pruefung: Eindeutigkeit ohne Rolle von Gross und Klein, auch mit Umlauten', () => {
  const eins = (name: string, kind: 'amount' = 'amount') => ({ name, kind, amountCents: 100 });
  assert.equal(checkDiscountPresets([eins('Stammkunde'), eins('STAMMKUNDE')]).ok, false);
  assert.equal(checkDiscountPresets([eins('Ärger'), eins('ärger')]).ok, false);
  assert.equal(checkDiscountPresets([eins('Stammkunde'), eins('Stammkunden')]).ok, true);
  // Getrimmt verglichen.
  assert.equal(checkDiscountPresets([eins('Stammkunde'), eins(' stammkunde ')]).ok, false);
});

for (const f of FAELLE.bonBlock as Json[]) {
  test(`bonBlock: ${f.name}`, () => {
    const lines = discountBlockLines((f.rabatte as Json[]).map((r) => ({ name: r.name, cents: r.cents, count: r.anzahl })));
    assert.deepEqual(lines, f.zeilen);
  });
}

test('bonBlock: ein voll stornierter Name (Betrag 0) entfaellt, auch die Summe zaehlt ihn nicht', () => {
  assert.deepEqual(discountBlockLines([{ name: 'A', cents: 0, count: 2 }, { name: 'B', cents: 300, count: 1 }]), [{ label: 'B (1×)', cents: -300 }]);
  assert.deepEqual(discountBlockLines([{ name: 'A', cents: 0, count: 2 }]), []);
});

test('Texte: Fehlertexte der Pruefung sind die Saetze des Backends', () => {
  for (const f of FAELLE.pruefung as Json[]) {
    for (const e of (f.fehler ?? []) as Json[]) assert.ok(Object.values(MELDUNGEN()).includes(e.meldung), e.meldung);
  }
  assert.equal(labelText('discount_presets.title'), 'Rabatt-Vorlagen');
  assert.equal(labelText('shift_receipt.discounts'), 'Rabatte');
  assert.equal(messageText('discount.preset_over_total'), 'Der Rabatt ist höher als der Betrag, auf den er gilt.');
});
function MELDUNGEN(): Record<string, string> {
  const raus: Record<string, string> = {};
  for (const k of ['list', 'entry', 'name', 'duplicate', 'kind', 'percent', 'amount', 'unknown_field'] as const) raus[k] = messageText(`discount_preset.${k}`);
  return raus;
}

test('Leser: unbekannte Art und Teilformen fallen weg, die Liste bleibt', () => {
  const s = sanitizePosSettings({ business: { discountPresets: [
    { name: 'A', kind: 'percent', percentBp: 500 }, { name: 'B', kind: 'staffel', percentBp: 500 }, { name: 'C', kind: 'amount' },
    { name: 'D', kind: 'amount', amountCents: 1.5 }, 'x', null, { kind: 'amount', amountCents: 5 }, { name: 'E', kind: 'amount', amountCents: 250 },
  ] } });
  assert.deepEqual(s.business.discountPresets, [{ name: 'A', kind: 'percent', percentBp: 500 }, { name: 'E', kind: 'amount', amountCents: 250 }]);
  // Keine Liste: das Feld fehlt, die Chips gelten.
  assert.equal('discountPresets' in sanitizePosSettings({ business: { discountPresets: 'x' } }).business, false);
  // Leere Liste bleibt (keine Chips).
  assert.deepEqual(sanitizePosSettings({ business: { discountPresets: [] } }).business.discountPresets, []);
  // Ein Konto ohne das Feld: Standard unveraendert.
  assert.equal('discountPresets' in POS_BUSINESS_DEFAULTS, false);
});

test('Gespeichert: ungueltige Vorlagen fehlen still, englische Werte sind innen unbekannt', () => {
  const ungueltig = [
    [{ name: 'A', art: 'percent', percentBp: 500 }],
    [{ name: 'A', art: 'prozent', percentBp: 500 }],
    [{ name: 'A', art: 'prozent', prozentBp: 5 }],
    'Stammkunde',
  ];
  for (const rabattVorlagen of ungueltig) {
    const stored = { betrieb: { rabattVorlagen, rabattChips: [5, 10] } };
    assert.equal('discountPresets' in fromStoredPosSettings(stored).business, false, JSON.stringify(rabattVorlagen));
    assert.deepEqual(invalidStoredPosSettings(stored), []);
    assert.deepEqual(fromStoredPosSettings(stored).business.discountChips, [5, 10]);
  }
});

test('Schreiben: nur geaenderte Vorlagen gehen als ganze Liste, die Pruefung laeuft vor dem Senden', async () => {
  const vorher = mergePosSettings(POS_BUSINESS_DEFAULTS, {});
  const nachher = { ...vorher, discountPresets: [{ name: 'Stammkunde', kind: 'amount', amountCents: 500 }] as PosDiscountPreset[] };
  const aenderung = posSettingsChanges(vorher, nachher);
  assert.deepEqual(aenderung, { discountPresets: [{ name: 'Stammkunde', kind: 'amount', amountCents: 500 }] });
  const gesendet: unknown[] = [];
  const transport = (async (_name: string, params: unknown) => { gesendet.push(params); return { business: { discountPresets: [{ name: 'Stammkunde', kind: 'amount', amountCents: 500 }] } }; }) as never;
  const stand = await setMyPosSettings(transport, aenderung);
  assert.deepEqual(gesendet, [{ business: aenderung }]);
  assert.deepEqual(stand.discountPresets, [{ name: 'Stammkunde', kind: 'amount', amountCents: 500 }]);
  // Ungueltig: wirft vor dem Senden, mit Vorlage, Feld, Satz und Code.
  await assert.rejects(
    setMyPosSettings(transport, { discountPresets: [{ name: 'A', kind: 'percent', percentBp: 1005 }] }),
    (e: unknown) => e instanceof KasseneckValidationError && /discountPresets\[0\]\.percentBp: Prozent zwischen 0,1 und 100.*invalid_discount_preset/.test(e.message),
  );
  await assert.rejects(setMyPosSettings(transport, { discountPresets: 'x' as never }), KasseneckValidationError);
  assert.equal(gesendet.length, 1);
});

// ---- Z-Bon ---------------------------------------------------------------------------------------------------------

const KASSE = JSON.parse(readFileSync(new URL('../../fixtures/v3/antworten/kasse.json', import.meta.url), 'utf8')).endpoints as Record<string, { cases: Array<{ case: string; response: Json }> }>;
const zBon = (): Json => structuredClone(KASSE.closeMyShift!.cases.find((c) => c.case === 'success_manager')!.response.data.receipt);
const GOLDEN = JSON.parse(readFileSync(new URL('../../test/fixtures/rabatte-z-bon.json', import.meta.url), 'utf8')) as Json;
const darstellung = (bon: Json) => {
  const layout = shiftReceiptLayout(bon as ShiftSummaryReceipt);
  return { lines: layout.lines, grid32: gridToText(renderReceiptGrid(layout, { charsPerLine: 32 })) };
};

test('Z-Bon: ohne Rabatte byte-gleich (Feld fehlt, null, leere Liste)', () => {
  const basis = JSON.stringify(shiftReceiptLayout(zBon() as ShiftSummaryReceipt));
  for (const wert of [undefined, null, []]) {
    const bon = zBon();
    if (wert !== undefined) bon.discounts = wert;
    assert.equal(JSON.stringify(shiftReceiptLayout(bon as ShiftSummaryReceipt)), basis);
  }
});

test('Z-Bon: Block „Rabatte“ nach dem Unbar-Block, vor den Zaehlern, wie der Golden', () => {
  const ein = zBon();
  ein.discounts = [{ name: 'Stammkunde', cents: 500, count: 1 }];
  const mehr = zBon();
  mehr.discounts = [{ name: 'Mitarbeiter-Rabatt', cents: 1200, count: 3 }, { name: 'Stammkunde', cents: 500, count: 1 }];
  const leer = zBon();
  leer.discounts = [{ name: '', cents: 100, count: 2 }, { name: 'Stammkunde', cents: 50, count: 1 }];
  for (const [bon, golden] of [[ein, GOLDEN.eins], [mehr, GOLDEN.mehrere], [leer, GOLDEN.unbenannt]] as const) {
    assert.deepEqual(bon.discounts, golden.discounts);
    assert.deepEqual(darstellung(bon), { lines: golden.lines, grid32: golden.grid32 });
  }
  // Der Block steht vor „Belege“ und enthaelt die Summe nur ab zwei Eintraegen.
  const text = darstellung(mehr).grid32;
  assert.ok(text.indexOf('Rabatte') < text.indexOf('Belege'));
  assert.equal(darstellung(ein).grid32.includes('Rabatte gesamt'), false);
  assert.ok(JSON.stringify(darstellung(mehr).lines).includes('Mitarbeiter-Rabatt (3×)'));
});

test('Z-Bon lesen: discounts wird gelesen, ein kaputter Eintrag ist ein Antwortfehler', () => {
  const bon = zBon();
  bon.discounts = [{ name: 'Stammkunde', cents: 1.5, count: 1 }];
  assert.throws(() => shiftReceiptLayout(bon as ShiftSummaryReceipt));
});
