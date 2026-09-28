import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Waechter fuer die nachgebauten Teile von test/fixtures/partner-v3-antworten.json.
 *
 * Der Generator (scripts/partner-v3-antworten.cjs) laesst Sichten und Rand des
 * Backends echt laufen, schreibt aber die Rohdaten, die hineingehen
 * (gespeicherte Dokumente, Handler-Antworten, Vertragsereignisse), von Hand
 * nach. Zweimal stand darin ein Code, den der Server an dieser Stelle nie
 * sendet (signature.failed mit fon_fehler, cashregister.failed mit
 * vertrag_offen), und alle Tests blieben gruen. Dieser Test liest darum den
 * Quelltext des Backends und verlangt, dass jeder Code, jedes Ereignis und
 * jeder Status- oder Katalogwert der nachgebauten Rohdaten in den Dateien
 * vorkommt, aus denen sie abgeschrieben sind.
 *
 * Er braucht einen Backend-Checkout (KASSENECK_BACKEND) und wird ohne ihn mit
 * Begruendung uebersprungen: die CI dieses Repos hat kein Backend. Er gehoert
 * darum zu jedem Neuerzeugen der Fixture. Die dauerhafte Loesung ist ein
 * Export der Partner-Faelle aus dem Backend (fixtures/v3/antworten); dann
 * entfallen Generator und Waechter.
 *
 * Rot-Probe: im Generator einen Code tauschen (etwa `already_accepted` gegen
 * `already_confirmed`), dann faellt dieser Test mit genau diesem Wert.
 */

const BACKEND = process.env['KASSENECK_BACKEND'];
const SKRIPT = fileURLToPath(new URL('../../scripts/partner-v3-antworten.cjs', import.meta.url));

/** Schluessel, deren Werte Codes, Ereignisse oder Katalogwerte sind. */
const WERTSCHLUESSEL = new Set([
  'code', 'status', 'grund', 'art', 'kind', 'source', 'rhythmus', 'type', 'event', 'events', '__ereignis',
  'rechtsform', 'bundesland', 'roles', 'modus', 'von', 'nach', 'via', 'angelegtVia', 'step', 'field',
]);

interface Nachgebaut {
  name: string;
  quellen: string[];
  roh: unknown;
}

function literale(wert: unknown, schluessel: string | null, raus: Set<string>): void {
  if (Array.isArray(wert)) {
    for (const w of wert) literale(w, schluessel, raus);
    return;
  }
  if (wert !== null && typeof wert === 'object') {
    for (const [k, v] of Object.entries(wert)) literale(v, k, raus);
    return;
  }
  if (typeof wert === 'string' && schluessel !== null && WERTSCHLUESSEL.has(schluessel)) raus.add(wert);
}

function kommtVor(quelltext: string, literal: string): boolean {
  const e = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(['"\`])${e}\\1|(^|[\\s{,])${e}\\s*:`, 'm').test(quelltext);
}

test('Nachgebaute Partner-Rohdaten: jeder Code und jedes Ereignis steht im Backend-Quelltext', (t) => {
  if (!BACKEND) {
    t.skip('KASSENECK_BACKEND fehlt: Pfad zum Backend-Checkout (Repo kasseneck), sonst ist nichts zu pruefen');
    return;
  }
  const liste = JSON.parse(
    execFileSync(process.execPath, [SKRIPT, '--nachgebaut'], { env: { ...process.env, KASSENECK_BACKEND: BACKEND }, encoding: 'utf8' }),
  ) as Nachgebaut[];
  assert.ok(liste.length > 0, 'der Generator meldet keine nachgebauten Teile');

  const fehlt: string[] = [];
  for (const teil of liste) {
    assert.ok(teil.quellen.length > 0, `${teil.name}: keine Quelle genannt`);
    const text = teil.quellen.map((q) => readFileSync(join(BACKEND, q), 'utf8')).join('\n');
    const werte = new Set<string>();
    // Die Huelle { status: 'success' | 'error', message, data } baut
    // successResponse/errorWith; ihr status ist kein Code des Handlers.
    const roh = teil.roh as Record<string, unknown>;
    const huelle = roh !== null && typeof roh === 'object' && 'data' in roh && (roh['status'] === 'success' || roh['status'] === 'error');
    literale(huelle ? { ...roh, status: undefined } : teil.roh, null, werte);
    for (const w of werte) if (!kommtVor(text, w)) fehlt.push(`${teil.name}: '${w}' nicht in ${teil.quellen.join(', ')}`);
  }
  assert.deepEqual(fehlt, []);
});

test('Nachgebaute Partner-Rohdaten: die Fehlerereignisse tragen die Codes, mit denen der Server sie feuert', (t) => {
  if (!BACKEND) {
    t.skip('KASSENECK_BACKEND fehlt: Pfad zum Backend-Checkout (Repo kasseneck), sonst ist nichts zu pruefen');
    return;
  }
  const liste = JSON.parse(
    execFileSync(process.execPath, [SKRIPT, '--nachgebaut'], { env: { ...process.env, KASSENECK_BACKEND: BACKEND }, encoding: 'utf8' }),
  ) as Nachgebaut[];
  const code = (name: string) => (liste.find((x) => x.name === name)?.roh as { code?: string } | undefined)?.code;
  assert.equal(code('signature.failed'), 'signature_failed');
  assert.ok(['signature_not_ready', 'fon_missing', 'activation_failed'].includes(code('cashregister.failed') ?? ''));
});
