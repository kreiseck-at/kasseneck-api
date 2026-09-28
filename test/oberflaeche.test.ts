import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_CALLS, POS_CALLS, PUBLIC_CALLS, isPosCall, isPosOnlyCall } from '../src/client/aufrufe.js';
import { DEFAULT_BASE_URL, POS_BASE_URL } from '../src/client/transport.js';
import * as kasse from '../src/pos/index.js';
import { POS_SHORTCUT_ACTIONS, POS_BUSINESS_DEFAULTS, POS_DEVICE_DEFAULTS } from '../src/pos/index.js';
import { REGISTER_ERROR_CODES, REGISTER_PERMS } from '../src/register/index.js';
import * as partner from '../src/partner/index.js';
import * as rechnung from '../src/invoice/index.js';

const vertrag = JSON.parse(
  readFileSync(new URL('../../fixtures/oberflaeche.json', import.meta.url), 'utf8'),
);

const veraltet = 'fixtures/oberflaeche.json ist veraltet — `npm run fixtures:oberflaeche` ausfuehren';

/*
 * Dieselbe Ableitung wie im Erzeuger: jede exportierte Konstante in
 * GROSSSCHRIFT, deren Wert eine Liste aus Text oder Zahlen ist, gehoert in den
 * Vertrag. So faellt ein neu angelegtes Enum schon in `npm test` auf und nicht
 * erst im Waechter der CI.
 */
const schluessel = (name: string) => name.toLowerCase().replace(/_(.)/g, (_, z: string) => z.toUpperCase());
const namensraum = kasse as unknown as Record<string, unknown>;
// `enums` = Wertemengen der Einstellungen (Schluessel = Feldname), `kasse` =
// alle uebrigen Listen des Kassen-Teils. Jede Liste steht in genau einem.
const felder = new Set<string>([...Object.keys(POS_BUSINESS_DEFAULTS), ...Object.keys(POS_DEVICE_DEFAULTS)]);
const enumListen = new Map<string, readonly (string | number)[]>();
const kasseListen = new Map<string, readonly (string | number)[]>();
for (const name of Object.keys(namensraum).sort()) {
  const wert = namensraum[name];
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
  if (!Array.isArray(wert)) continue;
  if (!wert.every((eintrag) => typeof eintrag === 'string' || typeof eintrag === 'number')) continue;
  // Die Tasten-Aktionen tragen einen eigenen Schluessel.
  if (wert === (POS_SHORTCUT_ACTIONS as readonly string[])) continue;
  (felder.has(schluessel(name)) ? enumListen : kasseListen).set(schluessel(name), wert as readonly (string | number)[]);
}

test('Golden: die Oberflaeche steht in fixtures/oberflaeche.json', () => {
  assert.deepEqual(Object.keys(vertrag), [
    'version', 'baseUrls', 'calls', 'routes', 'enums', 'registerPerms', 'registerErrorCodes', 'posShortcutActions', 'pos', 'partner', 'invoice',
  ], veraltet);
  assert.deepEqual(vertrag.routes, { public: [...PUBLIC_CALLS], pos: [...POS_CALLS] }, veraltet);
  assert.deepEqual(vertrag.registerPerms, [...REGISTER_PERMS], veraltet);
  assert.deepEqual(vertrag.posShortcutActions, [...POS_SHORTCUT_ACTIONS], veraltet);
  assert.deepEqual(vertrag.registerErrorCodes, [...REGISTER_ERROR_CODES], veraltet);
});

test('Golden: die Aufrufe des Pakets, geteilt nach Weg (oeffentlich /v3, Kassenweg /api/v3)', () => {
  assert.deepEqual(vertrag.baseUrls, { public: DEFAULT_BASE_URL, pos: POS_BASE_URL }, veraltet);
  assert.equal(vertrag.baseUrls.public, 'https://api.kasseneck.at/v3');
  assert.equal(vertrag.baseUrls.pos, 'https://kasse.kasseneck.at/api/v3');
  assert.deepEqual(vertrag.calls.public, ALL_CALLS.filter((n) => !isPosOnlyCall(n)), veraltet);
  assert.deepEqual(vertrag.calls.pos, ALL_CALLS.filter((n) => isPosCall(n)), veraltet);
  // Jeder Aufruf des Pakets hat mindestens einen Weg; die Kasse ruft alle 25 des Kassenwegs.
  const beide = new Set<string>([...vertrag.calls.public, ...vertrag.calls.pos]);
  assert.deepEqual(ALL_CALLS.filter((n) => !beide.has(n)), []);
  assert.deepEqual([...vertrag.calls.pos].sort(), [...POS_CALLS].sort());
});

test('Golden: der Vertrag fuehrt JEDE Enum-Liste des Pakets, keine mehr und keine weniger', () => {
  assert.deepEqual(Object.keys(vertrag.enums).sort(), [...enumListen.keys()].sort(), veraltet);
  for (const [name, liste] of enumListen) {
    assert.deepEqual(vertrag.enums[name], [...liste], `${veraltet} (enums.${name})`);
  }
  assert.deepEqual(Object.keys(vertrag.pos ?? {}).sort(), [...kasseListen.keys()].sort(), veraltet);
  for (const [name, liste] of kasseListen) {
    assert.deepEqual(vertrag.pos[name], [...liste], `${veraltet} (pos.${name})`);
  }
  // Leer gegen leer waere gruen, ohne etwas zu pruefen.
  assert.ok(enumListen.has('theme') && kasseListen.has('posErrorCodes'), 'Einstellungs- oder Kassen-Listen fehlen');
});

/**
 * Dieselbe Ableitung fuer den Partner-Teil. Er kam eine Zeitlang nur als
 * Namensliste ueber den Vertrag — die 18 Aufrufe standen darin, die
 * Fehlercodes, die Webhook-Ereignisse, die drei Vertragswege und der
 * Wiederholungsplan nicht. Genau die pflegt der Zwilling von Hand nach.
 */
const partnerRaum = partner as unknown as Record<string, unknown>;
const partnerListen = new Map<string, readonly (string | number)[]>();
for (const name of Object.keys(partnerRaum).sort()) {
  const wert = partnerRaum[name];
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
  if (!Array.isArray(wert)) continue;
  if (!wert.every((eintrag) => typeof eintrag === 'string' || typeof eintrag === 'number')) continue;
  partnerListen.set(schluessel(name), wert as readonly (string | number)[]);
}

test('Golden: der Vertrag fuehrt JEDE Partner-Liste des Pakets, keine mehr und keine weniger', () => {
  assert.deepEqual(Object.keys(vertrag.partner ?? {}).sort(), [...partnerListen.keys()].sort(), veraltet);
  for (const [name, liste] of partnerListen) {
    assert.deepEqual(vertrag.partner[name], [...liste], `${veraltet} (partner.${name})`);
  }
  // Ohne diese Zusicherung koennte der Erzeuger den ganzen Abschnitt
  // weglassen und der Test bliebe gruen (leer gegen leer).
  assert.ok(partnerListen.size >= 4, 'der Partner-Teil traegt keine Listen mehr — dann prueft dieser Test nichts');
});

/**
 * Dieselbe Ableitung fuer die Rechnungs-API: Fehlercodes, Gutschrift-Gruende,
 * Steuerschemata. Die Feldbeschreibung selbst prueft rechnung-vertrag.test.ts
 * gegen das Schema; hier nur, was als Liste in die Oberflaeche geht.
 */
const rechnungRaum = rechnung as unknown as Record<string, unknown>;
const rechnungListen = new Map<string, readonly (string | number)[]>();
for (const name of Object.keys(rechnungRaum).sort()) {
  const wert = rechnungRaum[name];
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
  if (!Array.isArray(wert)) continue;
  if (!wert.every((eintrag) => typeof eintrag === 'string' || typeof eintrag === 'number')) continue;
  rechnungListen.set(schluessel(name), wert as readonly (string | number)[]);
}

test('Golden: der Vertrag fuehrt JEDE Rechnungs-Liste des Pakets, keine mehr und keine weniger', () => {
  assert.deepEqual(Object.keys(vertrag.invoice ?? {}).sort(), [...rechnungListen.keys()].sort(), veraltet);
  for (const [name, liste] of rechnungListen) {
    assert.deepEqual(vertrag.invoice[name], [...liste], `${veraltet} (invoice.${name})`);
  }
  // Leer gegen leer waere gruen, ohne etwas zu pruefen.
  assert.ok(rechnungListen.has('invoiceErrorCodes') && rechnungListen.has('creditNoteReasons'),
    'der Rechnungs-Teil traegt seine Codes nicht mehr — dann prueft dieser Test nichts');
});

test('Die Vertragsdatei nennt die Paketversion', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(vertrag.version, pkg.version, veraltet);
});

/*
 * Die Aufruflisten der 1.x-Linie gegen den Backend-Vertrag `/v3`
 * (`fixtures/v3/v3-vokabular.json`, geholt mit `scripts/v3-vertrag-holen.mjs`).
 */
const vokabular = JSON.parse(
  readFileSync(new URL('../../fixtures/v3/v3-vokabular.json', import.meta.url), 'utf8'),
) as { endpoints: Record<string, string[]>; names: Record<string, string> };
const aussenName = new Map(Object.entries(vokabular.names).map(([aussen, innen]) => [innen, aussen]));

test('v3: PUBLIC_CALLS ist deckungsgleich mit endpoints.public (aeussere Namen, 51)', () => {
  const erwartet = vokabular.endpoints['public']!.map((innen) => aussenName.get(innen) ?? innen);
  assert.deepEqual([...PUBLIC_CALLS], erwartet);
  assert.equal(PUBLIC_CALLS.length, 51);
  // Unter /v3 geroutet ist genau die oeffentliche Liste.
  assert.deepEqual([...vokabular.endpoints['v3Routed']!].sort(), [...vokabular.endpoints['public']!].sort());
});

test('v3: POS_CALLS ist deckungsgleich mit endpoints.register (25)', () => {
  assert.deepEqual([...POS_CALLS], vokabular.endpoints['register']);
  assert.equal(POS_CALLS.length, 25);
});

test('v3: nur ueber den Kassenweg gehen genau die 19 Namen aus endpoints.registerInternal', () => {
  const alle = new Set<string>([...PUBLIC_CALLS, ...POS_CALLS, ...vokabular.endpoints['registerInternal']!]);
  const nurKasse = [...alle].filter((name) => isPosOnlyCall(name)).sort();
  assert.deepEqual(nurKasse, [...vokabular.endpoints['registerInternal']!].sort());
  assert.equal(nurKasse.length, 19);
});

test('v3: jeder Aufruf des Pakets steht in PUBLIC_CALLS oder POS_CALLS', () => {
  const bekannt = new Set<string>([...PUBLIC_CALLS, ...POS_CALLS]);
  assert.deepEqual(ALL_CALLS.filter((name) => !bekannt.has(name)), []);
});
