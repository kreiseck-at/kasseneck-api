import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HPS_MEASURED_CODES, TERMINAL_BUSY_HTTP_STATUS } from '../src/payments/hobex-hps/index.js';

/**
 * Golden-Test des Vertrags mit dem Dart-Zwilling: `fixtures/hobex-hps-codes.json`
 * muss genau die Codetabelle fuehren, die `transaction-response.ts`
 * tatsaechlich als schluessig bzw. Wissensluecke behandelt.
 *
 * Anders als `test/oberflaeche.test.ts` liest dieser Test die Quelle nicht
 * "was gibt es alles" (kein automatisches Ableiten ueber Namensmuster) --
 * die Codetabelle IST bereits die single source of truth
 * ([HPS_MEASURED_CODES]), der Generator (`scripts/hobex-hps-codes.mjs`)
 * schreibt sie nur unveraendert in JSON. Der Test haelt trotzdem beide Seiten
 * synchron, weil ein `npm run build` zwischen einer Aenderung an
 * [HPS_MEASURED_CODES] und einem erneuten `fixtures:hobex-hps-codes`-Lauf
 * leicht vergessen wird.
 */

const vertrag = JSON.parse(
  readFileSync(new URL('../../fixtures/hobex-hps-codes.json', import.meta.url), 'utf8'),
) as {
  version: string;
  codes: { code: string; meaning: string; conclusive: boolean }[];
  terminalBusyHttpStatus: number;
};

const veraltet = 'fixtures/hobex-hps-codes.json ist veraltet -- `npm run fixtures:hobex-hps-codes` ausfuehren';

test('Golden: die gemessene Codetabelle steht in fixtures/hobex-hps-codes.json', () => {
  assert.deepEqual(
    vertrag.codes,
    HPS_MEASURED_CODES.map(({ code, meaning, conclusive }) => ({ code, meaning, conclusive })),
    veraltet,
  );
  assert.equal(vertrag.terminalBusyHttpStatus, TERMINAL_BUSY_HTTP_STATUS, veraltet);
});

test('Die Vertragsdatei nennt die Paketversion', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(vertrag.version, pkg.version, veraltet);
});

test('Jeder schluessige Code ist genau einmal genannt -- keine Dopplung, keine Luecke in der Positivliste', () => {
  const schluessige = HPS_MEASURED_CODES.filter((c) => c.conclusive).map((c) => c.code);
  assert.equal(new Set(schluessige).size, schluessige.length, 'ein Code kommt doppelt vor');
  // '0' (genehmigt) und die vier Ablehnungsgruende muessen zwingend dabei
  // sein -- faellt einer weg, meldet der Zahlweg fuer einen tatsaechlich
  // entschiedenen Vorgang faelschlich "unresolved".
  for (const erwartet of ['0', '9002', '9011', '100002', '100003', '100010']) {
    assert.ok(schluessige.includes(erwartet), `${erwartet} fehlt in der Positivliste`);
  }
  // 9027 und 9900 sind GEMESSEN, aber ausdruecklich KEINE Aussage -- die
  // Regression, die dieses ganze Vorhaben ausgeloest hat.
  for (const wissensluecke of ['9027', '9900']) {
    assert.ok(!schluessige.includes(wissensluecke), `${wissensluecke} duerfte NICHT schluessig sein`);
  }
});
