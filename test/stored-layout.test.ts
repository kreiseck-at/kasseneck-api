import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromStoredLayout, toStoredLayout, fromStoredPrintLogo, toStoredPrintLogo } from '../src/stored/index.js';
import * as stored from '../src/stored/index.js';
import { createPrintJob } from '../src/pos/drucker.js';
import type { ReceiptLayout } from '../src/receipt/layout.js';
import type { PrintLogo } from '../src/receipt/layout-escpos.js';
import { KasseneckValidationError } from '../src/client/errors.js';

/*
 * Zeilenmodell innere Form (0.31, `/api`) <-> Form 1.0, gegen echte
 * Ausgaben: die 40 Goldens, wie 0.31.0 sie festgeschrieben hat
 * (test/fixtures/vor-1.0/layouts-0.31.json, aus git e4b2887 gezogen von
 * scripts/layouts-vor-1.0.mjs), und dieselben Goldens heute
 * (fixtures/expected/*.lines.json).
 */
const lies = (pfad: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../${pfad}`, import.meta.url)), 'utf8'));
const alt = lies('test/fixtures/vor-1.0/layouts-0.31.json') as { version: string; pairs: Array<{ before: string; after: string; layout: Record<string, unknown> }> };

test('Golden-Paare: es sind die 40 Zeilenmodelle von 0.31.0, jedes mit einem heutigen Golden', () => {
  assert.equal(alt.version, '0.31.0');
  assert.equal(alt.pairs.length, 40);
  // Die Paare tragen wirklich die innere Form, sonst pruefte der Rundlauf nichts.
  assert.ok(alt.pairs.every((p) => 'regelwerk' in p.layout && !('ruleset' in p.layout)));
  const toene = new Set(alt.pairs.flatMap((p) => (p.layout.lines as Array<Record<string, unknown>>).map((z) => z.ton).filter(Boolean)));
  assert.deepEqual([...toene].sort(), ['belegart', 'warnung']);
});

test('fromStoredLayout: jedes 0.31-Zeilenmodell ergibt genau das heutige Golden', () => {
  for (const p of alt.pairs) {
    assert.deepEqual(fromStoredLayout(p.layout), lies(`fixtures/${p.after}`), p.after);
  }
});

test('toStoredLayout: jedes heutige Golden ergibt genau die 0.31-Ausgabe, und zurueck', () => {
  for (const p of alt.pairs) {
    const neu = lies(`fixtures/${p.after}`) as ReceiptLayout;
    assert.deepEqual(toStoredLayout(neu), p.layout, p.after);
    assert.deepEqual(fromStoredLayout(toStoredLayout(neu)), neu, p.after);
    assert.deepEqual(toStoredLayout(fromStoredLayout(p.layout)!), p.layout, p.before);
  }
});

test('fromStoredLayout: die Form 1.0 geht unveraendert durch, Unlesbares wird null', () => {
  const neu = lies(`fixtures/${alt.pairs[0]!.after}`);
  assert.deepEqual(fromStoredLayout(neu), neu);
  for (const roh of [null, undefined, 'x', 42, [], {}, { lines: 'x' }]) assert.equal(fromStoredLayout(roh), null, JSON.stringify(roh));
  // Ein unbekannter Ton geht woertlich durch, in beide Richtungen.
  const fremd = { lines: [{ kind: 'banner', text: 'X', ton: 'neu' }], paperSize: 'mm80', regelwerk: 2 };
  assert.deepEqual(fromStoredLayout(fremd), { lines: [{ kind: 'banner', text: 'X', tone: 'neu' }], paperSize: 'mm80', ruleset: 2 });
  assert.deepEqual(toStoredLayout(fromStoredLayout(fremd)!), fremd);
  // Die Eingabe bleibt unberuehrt.
  const vorher = JSON.stringify(alt.pairs[0]!.layout);
  fromStoredLayout(alt.pairs[0]!.layout);
  assert.equal(JSON.stringify(alt.pairs[0]!.layout), vorher);
  assert.throws(() => toStoredLayout({} as ReceiptLayout), KasseneckValidationError);
});

const vokabular = lies('fixtures/v3/v3-vokabular.json') as {
  schemas: { createPrintJob: { params: { layout: Record<string, unknown>; logo: Record<string, string> } } };
  catalogs: { LAYOUT_TON: Record<string, string> };
};

test('dieselben Namen wie der Rand des Backends (Vokabular createPrintJob, Katalog LAYOUT_TON)', () => {
  const v = vokabular.schemas.createPrintJob.params;
  assert.equal(v.layout.ruleset, 'regelwerk');
  assert.equal((v.layout.lines as Array<Record<string, string>>)[0]!.tone, 'ton');
  for (const [innen, aussen] of Object.entries(vokabular.catalogs.LAYOUT_TON)) {
    const l = { lines: [{ kind: 'banner', text: 'T', tone: aussen }], paperSize: 'mm80', ruleset: 2 } as unknown as ReceiptLayout;
    assert.equal((toStoredLayout(l).lines as Array<Record<string, unknown>>)[0]!.ton, innen);
  }
});

function probeLogo(breite: number, hoehe: number): PrintLogo {
  const dots = new Uint8Array(breite * hoehe);
  for (let i = 0; i < dots.length; i++) dots[i] = (i * 7 + (i >> 3)) % 3 === 0 ? 1 : 0;
  return { size: 'L', pixelWidth: 300, pixelHeight: 120, raster: { width: breite, height: hoehe, dots } };
}

test('Drucklogo: innere Form traegt dieselben Werte, die das Paket unter /v3 schickt (Vokabular logo)', async () => {
  const logo = probeLogo(13, 5);
  let gesendet: Record<string, unknown> | undefined;
  const transport = (async (_name: string, params: Record<string, unknown>) => { gesendet = params; return { jobId: 'j1', status: 'pending' }; }) as unknown as Parameters<typeof createPrintJob>[0];
  await createPrintJob(transport, { printerId: 'p', layout: lies(`fixtures/${alt.pairs[0]!.after}`), logo });
  const draht = gesendet!.logo as Record<string, unknown>;
  const innen = toStoredPrintLogo(logo);
  const zuordnung = Object.entries(vokabular.schemas.createPrintJob.params.logo).filter(([k]) => k !== '__');
  assert.deepEqual(Object.keys(innen).sort(), zuordnung.map(([, i]) => i).sort());
  for (const [aussen, i] of zuordnung) assert.deepEqual(innen[i], draht[aussen], `${aussen} -> ${i}`);
});

test('Drucklogo: Rundlauf ueber ungerade Breiten, Punkte bleiben Punkte', () => {
  for (const [b, h] of [[1, 1], [8, 2], [13, 5], [17, 3], [384, 4]] as const) {
    const logo = probeLogo(b, h);
    const zurueck = fromStoredPrintLogo(toStoredPrintLogo(logo));
    assert.deepEqual({ ...zurueck, raster: { ...zurueck.raster, dots: [...zurueck.raster.dots] } }, { ...logo, raster: { ...logo.raster, dots: [...logo.raster.dots] } }, `${b}x${h}`);
  }
});

test('Drucklogo: unpassende innere Form wirft KasseneckValidationError', () => {
  const gut = toStoredPrintLogo(probeLogo(13, 5));
  for (const kaputt of [null, { ...gut, stufe: 'XXL' }, { ...gut, breite: 0 }, { ...gut, hoehe: 6 }, { ...gut, zeilen: '%%%' }, { ...gut, zeilen: undefined }]) {
    assert.throws(() => fromStoredPrintLogo(kaputt), KasseneckValidationError, JSON.stringify(kaputt));
  }
});

test('./stored exportiert die vier Funktionen', () => {
  for (const n of ['fromStoredLayout', 'toStoredLayout', 'fromStoredPrintLogo', 'toStoredPrintLogo']) {
    assert.equal(typeof (stored as Record<string, unknown>)[n], 'function', n);
  }
});
