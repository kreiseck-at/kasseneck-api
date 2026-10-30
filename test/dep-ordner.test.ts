import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { depFolderName } from '../src/pos/index.js';

interface Fall { name: string; cashregisterId: string; from: string | null; to: string | null; expected: string }
const wurzel = fileURLToPath(new URL('../../', import.meta.url));
const { cases } = JSON.parse(readFileSync(join(wurzel, 'fixtures', 'dep-folder-cases.json'), 'utf8')) as { cases: Fall[] };

test('depFolderName: alle Prueffaelle (gleich im Dart-Zwilling)', () => {
  assert.ok(cases.length >= 8);
  for (const f of cases) assert.equal(depFolderName(f.cashregisterId, f.from, f.to), f.expected, f.name);
});

test('depFolderName: nie ein Zeichen, das FAT32 oder exFAT ablehnt', () => {
  for (const id of ['A/B', 'A\\B', 'A:B', 'A*B', 'A?B', 'A"B', 'A<B', 'A>B', 'A|B', 'A\tB', 'A\u0001B']) {
    assert.match(depFolderName(id, '2026-01-01', '2026-01-31'), /^DEP_A_B_2026-01-01_2026-01-31$/, JSON.stringify(id));
  }
});
