import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { printerCatalogEntry, printerCatalogSettings, CODE_PAGE, PAPER_SIZE, POS_DEVICE_VALUES, type PosDeviceSettings } from '../src/pos/index.js';
import {
  PRINTER_CATALOG, PRINTER_CATALOG_CUTS, PRINTER_CATALOG_PROBLEM_REASONS, PRINTER_CATALOG_QR_MODES, findPrinterCatalogEntry,
  normalizePrinterModel, printerCatalogProblems, type PrinterCatalogEntry, type PrinterDeviceTest,
} from '../src/pos/drucker-katalog.js';
import { CHARS_PER_PAPER_SIZE } from '../src/receipt/grid.js';

/*
 * Druckerkatalog: fixtures/printer-catalog.json ist der Vertrag mit dem Dart-Zwilling (test/drucker_katalog_test.dart
 * rechnet dieselben Faelle). Die Datei fuehrt die ausgelieferten Eintraege, die Wertemengen und die Prueffaelle;
 * dieser Test haelt Code und Datei deckungsgleich.
 */

type Json = Record<string, any>;
const VERTRAG = JSON.parse(readFileSync(new URL('../../fixtures/printer-catalog.json', import.meta.url), 'utf8')) as Json;
const FAELLE = VERTRAG.cases as Json;
const GERAETETEST = FAELLE.deviceTest as PrinterDeviceTest;

/** Der ausgelieferte Katalog, die Eintraege mit `ids` freigegeben (mit dem Geraetetest der Datei). */
const freigegeben = (ids: readonly string[]): PrinterCatalogEntry[] =>
  PRINTER_CATALOG.map((e) => (ids.includes(e.id) ? { ...e, approval: { approved: true, deviceTest: GERAETETEST } } : e));
const ALLE_FREI = freigegeben(PRINTER_CATALOG.map((e) => e.id));
const idVon = (e: PrinterCatalogEntry | null): string | null => e?.id ?? null;

test('Vertrag: Abschnitte der Datei', () => {
  assert.deepEqual(Object.keys(VERTRAG), ['_note', 'rules', 'printers', 'cases']);
  assert.deepEqual(Object.keys(FAELLE), ['normalize', 'lookupShipped', 'lookup', 'lookupPartial', 'deviceTest', 'settings', 'problems']);
});

test('Vertrag: die Wertemengen sind die der Geraete-Einstellungen', () => {
  assert.deepEqual(VERTRAG.rules.paperSize, [...PAPER_SIZE]);
  assert.deepEqual(VERTRAG.rules.charsPerLine, CHARS_PER_PAPER_SIZE);
  assert.deepEqual(VERTRAG.rules.cut, [...PRINTER_CATALOG_CUTS]);
  assert.deepEqual(VERTRAG.rules.qrMode, [...PRINTER_CATALOG_QR_MODES]);
  assert.deepEqual(VERTRAG.rules.codePage, [...CODE_PAGE]);
  assert.deepEqual(VERTRAG.rules.problemReasons, [...PRINTER_CATALOG_PROBLEM_REASONS]);
});

test('Katalog: im Code stehen genau die Eintraege der Datei', () => {
  assert.deepEqual(PRINTER_CATALOG, VERTRAG.printers);
});

test('Katalog: der ausgelieferte Katalog hat keinen Fund, auch ganz freigegeben nicht', () => {
  assert.deepEqual(printerCatalogProblems(PRINTER_CATALOG), []);
  assert.deepEqual(printerCatalogProblems(ALLE_FREI), []);
});

test('Katalog: jeder Name fuehrt genau zu seinem Eintrag', () => {
  for (const e of ALLE_FREI) {
    for (const name of e.matchNames) {
      assert.deepEqual(ALLE_FREI.filter((x) => x.matchNames.includes(name)).map((x) => x.id), [e.id], name);
      assert.equal(idVon(findPrinterCatalogEntry(ALLE_FREI, name)), e.id, name);
    }
  }
});

test('Katalog: Eintraege sind unveraenderlich', () => {
  const e = PRINTER_CATALOG[0]!;
  assert.ok(Object.isFrozen(PRINTER_CATALOG) && Object.isFrozen(e) && Object.isFrozen(e.values) && Object.isFrozen(e.matchNames));
  assert.throws(() => { (e.values as { cut: string }).cut = 'none'; }, TypeError);
});

for (const f of FAELLE.normalize as Json[]) {
  test(`normalize: ${JSON.stringify(f.input)}`, () => {
    assert.equal(normalizePrinterModel(f.input), f.output);
  });
}

for (const f of FAELLE.lookupShipped as Json[]) {
  test(`printerCatalogEntry (ausgeliefert): ${JSON.stringify(f.model)}`, () => {
    assert.equal(idVon(printerCatalogEntry(f.model)), f.expected);
  });
}

for (const f of FAELLE.lookup as Json[]) {
  test(`printerCatalogEntry (alle freigegeben): ${JSON.stringify(f.model)}`, () => {
    assert.equal(idVon(findPrinterCatalogEntry(ALLE_FREI, f.model)), f.expected);
  });
}

for (const f of FAELLE.lookupPartial as Json[]) {
  test(`printerCatalogEntry (freigegeben ${JSON.stringify(f.approve)}): ${JSON.stringify(f.model)}`, () => {
    const katalog = freigegeben(f.approve);
    assert.deepEqual(printerCatalogProblems(katalog), []);
    assert.equal(idVon(findPrinterCatalogEntry(katalog, f.model)), f.expected);
  });
}

test('printerCatalogSettings: je Eintrag die Einstellungen der Datei, alles gueltige Geraete-Werte', () => {
  assert.deepEqual(FAELLE.settings.map((f: Json) => f.id), PRINTER_CATALOG.map((e) => e.id));
  for (const f of FAELLE.settings as Json[]) {
    const eintrag = PRINTER_CATALOG.find((e) => e.id === f.id)!;
    // Der Vorschlag geht unveraendert als Teil der Geraete-Einstellungen hinaus (setMyRegisterDeviceSettings).
    const teil: Partial<PosDeviceSettings> = printerCatalogSettings(eintrag);
    assert.deepEqual(teil, f.settings, f.id);
    for (const [feld, wert] of Object.entries(teil)) {
      const erlaubt = POS_DEVICE_VALUES[feld as keyof PosDeviceSettings];
      if (erlaubt) assert.ok(erlaubt.includes(wert as string), `${f.id}: ${feld} = ${wert}`);
      else assert.equal(typeof wert, 'boolean', `${f.id}: ${feld}`);
    }
  }
});

for (const f of FAELLE.problems as Json[]) {
  test(`printerCatalogProblems: ${f.name}`, () => {
    assert.deepEqual(printerCatalogProblems(f.printers as PrinterCatalogEntry[]), f.expected);
  });
}
