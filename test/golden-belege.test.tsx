import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';

import { fromReceiptPayload } from '../src/models/index.js';
import { buildReceiptLayout, escPosLayoutBytes, type BuildReceiptLayoutOptions, type ReceiptLayout } from '../src/receipt/index.js';
import { ReceiptLayoutView } from '../src/react/index.js';

/**
 * Golden-Belege: `fixtures/belege/*.json` sind die Eingaben, `fixtures/erwartet/
 * *.lines.json` die zugesagte Zeilenausgabe -- fuer keck (PDF/Beleg-Link), die
 * Browser-Kasse und das Flutter-Paket dieselben Dateien. Aendert sich das
 * Layout absichtlich, werden sie mit `npm run fixtures:erneuern` neu erzeugt
 * und der Diff im Review gelesen. Alles andere ist ein Fehler.
 */
// test-dist liegt eine Ebene tiefer (test-dist/test/...): die Fixtures liegen im Repo-Wurzelverzeichnis.
const wurzel = new URL('../../fixtures/', import.meta.url);
const namen = readdirSync(new URL('belege/', wurzel)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

interface Fixture { company: Parameters<typeof buildReceiptLayout>[1]; receipt: Record<string, unknown> & { customerDetails: string[]; legalMessage: string[] }; options?: BuildReceiptLayoutOptions }
const lade = (name: string): Fixture => JSON.parse(readFileSync(new URL(`belege/${name}.json`, wurzel), 'utf8')) as Fixture;
const erwartet = (name: string): ReceiptLayout => JSON.parse(readFileSync(new URL(`erwartet/${name}.lines.json`, wurzel), 'utf8')) as ReceiptLayout;
const layoutVon = (f: Fixture): ReceiptLayout =>
  buildReceiptLayout(fromReceiptPayload({ ...f.receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never), f.company, f.options ?? {});

test('Golden-Belege: alle 17 Faelle aus der Spec liegen vor', () => {
  assert.deepEqual(namen, ['langer-artikelname', 'null-ausfall', 'null-jahr', 'null-monat', 'null-pruef', 'null-schluss', 'null-start', 'rabattzeilen', 'signaturausfall-verkauf', 'storno-teil', 'storno-voll', 'testkasse-verkauf', 'testsignatur-verkauf', 'training', 'verkauf-bar', 'verkauf-karte', 'verkauf-kleinunternehmer']);
});

for (const name of namen) {
  test(`Golden-Beleg ${name}: Layout ist Zeile fuer Zeile die zugesagte Ausgabe`, () => {
    assert.deepEqual(layoutVon(lade(name)), erwartet(name));
  });
}

test('Golden-Belege: Manifest traegt die Pruefsummen von Eingabe und Erwartung (Drift in fremden Repos erkennbar)', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', wurzel), 'utf8')) as { regelwerk: number; belege: Record<string, { eingabe: string; erwartet: string }> };
  assert.equal(manifest.regelwerk, 2);
  for (const name of namen) {
    const e = createHash('sha256').update(readFileSync(new URL(`belege/${name}.json`, wurzel))).digest('hex');
    const a = createHash('sha256').update(readFileSync(new URL(`erwartet/${name}.lines.json`, wurzel))).digest('hex');
    assert.deepEqual(manifest.belege[name], { eingabe: e, erwartet: a }, `Manifest fuer ${name} veraltet -- npm run fixtures:erneuern`);
  }
});

test('Golden-Belege: ESC/POS und React sind deterministisch und tragen den Belegart-Aufdruck', () => {
  for (const name of ['storno-voll', 'training', 'null-monat', 'testkasse-verkauf']) {
    const layout = erwartet(name);
    const a = escPosLayoutBytes(layout), b = escPosLayoutBytes(layout);
    assert.deepEqual(a, b);
    const html = renderToStaticMarkup(<ReceiptLayoutView layout={layout} />);
    const bannerTexte = layout.lines.filter((z) => z.kind === 'banner').map((z) => (z as { text: string }).text);
    for (const t of bannerTexte) {
      assert.ok(html.includes(t.replace('—', '—')), `${name}: React zeigt „${t}“ nicht`);
      // im Bytestrom steht der Text (Gedankenstrich ersetzt) mit doppelter Hoehe
      const bytes = Buffer.from(a).toString('latin1');
      assert.ok(bytes.includes(t.split(' — ')[0]!), `${name}: ESC/POS druckt „${t}“ nicht`);
    }
  }
});

test('Rot-Probe: ein Stornobeleg OHNE Aufdruck ist kein gueltiges Golden -- der Vergleich schlaegt an', () => {
  const l = layoutVon(lade('storno-voll'));
  const ohne: ReceiptLayout = { ...l, lines: l.lines.filter((z) => z.kind !== 'banner') };
  assert.notDeepEqual(ohne, erwartet('storno-voll'));
});
