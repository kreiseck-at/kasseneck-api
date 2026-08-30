import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

import { KasseneckSecret, SECRET_MASKE } from '../src/partner/secret.js';
import { getCustomerCredentials } from '../src/partner/endpunkte.js';
import type { InternerTransport } from '../src/client/aufrufe.js';

/**
 * Die Zusage: ein Geheimnis eines fremden Betriebs verlaesst das Objekt NUR
 * ueber `.reveal()`. Jeder andere Weg — Zeichenkette, Protokoll, JSON,
 * Fehlerbericht — zeigt eine Maske.
 *
 * Woran diese Tests scheitern: an einem `KasseneckSecret`, das seinen Wert an
 * einem eigenen Feld haelt oder eine der vier Ausgabewege-Ueberschreibungen
 * verliert. Genau das ist die Rot-Probe fuer diese Datei — ein
 * `readonly wert: string` statt der WeakMap macht `Aus einem Protokoll…`,
 * `JSON.stringify` und `inspect` gleichzeitig rot.
 */

const KLARTEXT = 'kr_live_GEHEIMERKUNDENSCHLUESSEL9d3';
const TOKEN = 'cb_live_GEHEIMESKASSENTOKEN77';

test('Geheimnis: reveal ist der einzige Weg an den Klartext', () => {
  const geheim = new KasseneckSecret('apiKey', KLARTEXT);
  assert.equal(geheim.reveal(), KLARTEXT);
  assert.equal(geheim.vorhanden, true);
  assert.equal(new KasseneckSecret('apiKey', '').vorhanden, false);
});

test('Geheimnis: toString, Vorlagenzeichenkette und Verkettung zeigen die Maske', () => {
  const geheim = new KasseneckSecret('apiKey', KLARTEXT);
  const wege = [geheim.toString(), `${geheim}`, '' + (geheim as unknown as string), String(geheim)];
  for (const weg of wege) {
    assert.ok(weg.includes(SECRET_MASKE), `Maske fehlt: ${weg}`);
    assert.ok(!weg.includes(KLARTEXT), `Klartext durchgereicht: ${weg}`);
    assert.ok(weg.includes('apiKey'), 'die Beschriftung fehlt — ein Protokoll saehe nicht, WELCHER Wert fehlt');
  }
});

test('Geheimnis: JSON.stringify gibt den Klartext nicht aus — auch tief verschachtelt nicht', () => {
  const geheim = new KasseneckSecret('cashregisterToken', TOKEN);
  const text = JSON.stringify({ a: { b: [geheim] } });
  assert.ok(!text.includes(TOKEN));
  assert.ok(text.includes(SECRET_MASKE));
});

test('Geheimnis: util.inspect und console.log zeigen nichts', () => {
  const geheim = new KasseneckSecret('apiKey', KLARTEXT);
  // inspect mit voller Tiefe und "showHidden": genau das, was ein
  // Fehlerdienst tut, wenn er ein Objekt aufschluesselt.
  const tief = inspect({ zugang: geheim }, { depth: null, showHidden: true, getters: true });
  assert.ok(!tief.includes(KLARTEXT), `inspect zeigte den Klartext: ${tief}`);
  assert.ok(tief.includes(SECRET_MASKE));
});

test('Geheimnis: kein eigenes Feld traegt den Klartext', () => {
  const geheim = new KasseneckSecret('apiKey', KLARTEXT);
  // Der Kern der Bauweise: was nicht am Objekt haengt, findet auch ein
  // Ausgabeweg nicht, den dieses Paket nicht kennt.
  const namen = [...Object.getOwnPropertyNames(geheim), ...Object.getOwnPropertySymbols(geheim).map(String)];
  for (const name of namen) {
    const wert = (geheim as unknown as Record<string, unknown>)[name];
    assert.notEqual(wert, KLARTEXT, `Feld "${name}" traegt den Klartext`);
  }
  assert.equal(JSON.stringify(Object.values(geheim)).includes(KLARTEXT), false);
});

test('Geheimnis: die Werte aus getCustomerCredentials sind gehuellt, nicht roh', async () => {
  const rufen: InternerTransport = (async () => ({
    customerId: 'cust_1',
    firma: 'Baeckerei Jobst',
    env: 'live',
    apiKey: KLARTEXT,
    kassen: [{ cashregisterId: 'kasse_1', name: 'Theke', live: true, cashregisterToken: TOKEN }],
    hinweis: 'Nur verschluesselt speichern.',
  })) as unknown as InternerTransport;

  const zugang = await getCustomerCredentials(rufen, 'cust_1');
  assert.ok(zugang.apiKey instanceof KasseneckSecret);
  assert.ok(zugang.kassen[0]?.cashregisterToken instanceof KasseneckSecret);
  // Der ganze Antwortbaum, so wie ihn ein unachtsames Protokoll ausgeben wuerde.
  const ausgabe = `${JSON.stringify(zugang)} ${inspect(zugang, { depth: null })}`;
  assert.ok(!ausgabe.includes(KLARTEXT), 'der api_key des Betriebs stand in der Ausgabe');
  assert.ok(!ausgabe.includes(TOKEN), 'ein Kassen-Token stand in der Ausgabe');
  // Und der Weg heraus fuehrt trotzdem hin.
  assert.equal(zugang.apiKey.reveal(), KLARTEXT);
  assert.equal(zugang.kassen[0]?.cashregisterToken.reveal(), TOKEN);
});

test('Geheimnis: eine fehlende Angabe wird ein leeres Geheimnis, kein undefined', async () => {
  const rufen: InternerTransport = (async () => ({ customerId: 'cust_1', kassen: [{}] })) as unknown as InternerTransport;
  const zugang = await getCustomerCredentials(rufen, 'cust_1');
  // Ein `undefined` waere hier das schlimmste Ergebnis: der Aufrufer haette
  // einen Typ, der Geheimnis sagt, und einen Wert, den er ungeprueft ausgibt.
  assert.ok(zugang.apiKey instanceof KasseneckSecret);
  assert.equal(zugang.apiKey.vorhanden, false);
  assert.equal(zugang.apiKey.reveal(), '');
});
