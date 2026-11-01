import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { escPosLayoutBytes, type ReceiptLayout } from '../src/receipt/index.js';

/*
 * Papierschnitt am Bon (Option `cut` von escPosLayoutBytes) gegen die
 * gemeinsamen Prueffaelle `fixtures/print-cut-cases.json` und ihre Bytes unter
 * `expected/print-cut.<fall>.hex` (auch im Dart-Zwilling).
 */

interface Fall { name: string; receipt: string; paperSize?: 'mm58' | 'mm80'; cut?: boolean | 'full' | 'partial' }
const wurzel = new URL('../../fixtures/', import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL('print-cut-cases.json', wurzel), 'utf8')) as { cases: Fall[] };
const layoutVon = (f: Fall): ReceiptLayout => {
  const golden = JSON.parse(readFileSync(new URL(`expected/${f.receipt}.lines.json`, wurzel), 'utf8')) as ReceiptLayout;
  return f.paperSize === undefined ? golden : { ...golden, paperSize: f.paperSize };
};
const hex = (bytes: Uint8Array): string => {
  const teile: string[] = [];
  for (let i = 0; i < bytes.length; i += 32) teile.push(Array.from(bytes.subarray(i, i + 32), (b) => b.toString(16).padStart(2, '0')).join(''));
  return teile.join('\n') + '\n';
};

/** Fuenf Leerzeilen und GS V 0 (voll) bzw. GS V 1 (teilweise). */
const SCHNITT_VOLL = [0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x30];
const SCHNITT_TEIL = [0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x31];

test('Schnitt: jeder Fall hat seine Hex-Datei und keine mehr', () => {
  const dateien = readdirSync(new URL('expected/', wurzel)).filter((d) => d.startsWith('print-cut.')).sort();
  assert.deepEqual(dateien, cases.map((f) => `print-cut.${f.name}.hex`).sort());
  assert.deepEqual(new Set(cases.map((f) => JSON.stringify(f.cut ?? null))), new Set(['null', 'true', '"full"', '"partial"', 'false']));
});

test('Schnitt: Bytes je Fall wie die Hex-Datei (gleich im Dart-Zwilling)', () => {
  for (const f of cases) {
    const optionen = f.cut === undefined ? {} : { cut: f.cut };
    assert.equal(hex(escPosLayoutBytes(layoutVon(f), optionen)), readFileSync(new URL(`expected/print-cut.${f.name}.hex`, wurzel), 'utf8'), f.name);
  }
});

test('Schnitt: ohne Schnitt fehlen genau die fuenf Leerzeilen und GS V, teilweise ist nur das letzte Byte anders', () => {
  for (const receipt of ['sale-cash', 'zero-start', 'cancellation-full']) {
    for (const paperSize of ['mm58', 'mm80'] as const) {
      const layout = { ...layoutVon({ name: '', receipt }), paperSize };
      const voll = Array.from(escPosLayoutBytes(layout));
      const ohne = Array.from(escPosLayoutBytes(layout, { cut: false }));
      const teil = Array.from(escPosLayoutBytes(layout, { cut: 'partial' }));
      assert.deepEqual(voll.slice(-SCHNITT_VOLL.length), SCHNITT_VOLL, `${receipt}/${paperSize}`);
      assert.deepEqual(ohne, voll.slice(0, -SCHNITT_VOLL.length), `${receipt}/${paperSize}`);
      assert.deepEqual(teil, [...ohne, ...SCHNITT_TEIL], `${receipt}/${paperSize}`);
      assert.deepEqual(Array.from(escPosLayoutBytes(layout, { cut: true })), voll);
      assert.deepEqual(Array.from(escPosLayoutBytes(layout, { cut: 'full' })), voll);
    }
  }
});
