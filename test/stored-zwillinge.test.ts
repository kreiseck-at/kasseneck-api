import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

/**
 * Quelltext-Waechter der Zwillinge in `src/stored` (scripts/stored-zwillinge.mjs).
 *
 * - Immer: die Dateien des Zwillings haben den Stand, der zuletzt gegen das
 *   Backend belegt wurde. Wer sie aendert, faehrt den Backend-Vergleich
 *   (stored-backend.test.ts mit KASSENECK_BACKEND) und haelt dann neu fest:
 *   `KASSENECK_BACKEND=../kasseneck node scripts/stored-zwillinge.mjs`.
 * - Mit KASSENECK_BACKEND: die nachgebauten Stellen im Backend haben den
 *   festgehaltenen Stand. Aendert sich eine, ist der Zwilling zu pruefen.
 *
 * Die CI des Pakets hat kein Backend: dort laeuft nur der erste Teil.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const WURZEL = fileURLToPath(new URL('../..', import.meta.url));
const STAND = JSON.parse(readFileSync(resolve(WURZEL, 'test/fixtures/stored-zwillinge.json'), 'utf8')) as Json;
const skript = async (): Promise<Json> => import(new URL('../../scripts/stored-zwillinge.mjs', import.meta.url).href);
const NEU = 'Zwilling in src/stored gegen das Backend pruefen (stored-backend.test.ts mit KASSENECK_BACKEND), dann `KASSENECK_BACKEND=../kasseneck node scripts/stored-zwillinge.mjs`';

test('stored-zwillinge: die Dateien des Zwillings haben den gegen das Backend belegten Stand', async () => {
  const { zwillingStand } = await skript();
  const ist = zwillingStand(WURZEL) as Record<string, string>;
  for (const [datei, sha] of Object.entries(STAND.zwilling as Record<string, string>)) {
    assert.equal(ist[datei], sha, `${datei} geaendert: ${NEU}`);
  }
  assert.deepEqual(Object.keys(ist).sort(), Object.keys(STAND.zwilling).sort());
});

test('stored-zwillinge: die nachgebauten Stellen im Backend sind unveraendert', async (t: TestContext) => {
  const backend = process.env['KASSENECK_BACKEND'];
  if (!backend) {
    t.skip('KASSENECK_BACKEND fehlt: Pfad zum Backend-Checkout (Repo kasseneck), sonst ist nichts zu pruefen');
    return;
  }
  const { backendStand } = await skript();
  const ist = backendStand(resolve(backend)) as Json[];
  assert.equal(ist.length, STAND.backend.length, `Liste der Stellen geaendert: ${NEU}`);
  ist.forEach((s, i) => {
    const soll = STAND.backend[i];
    assert.equal(`${s.datei} ${s.marke}`, `${soll.datei} ${soll.marke}`);
    assert.equal(s.sha256, soll.sha256, `${s.datei} ${s.marke ?? '(ganze Datei)'} geaendert: ${NEU}`);
  });
});
