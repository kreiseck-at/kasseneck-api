import { test } from 'node:test';
import assert from 'node:assert/strict';
import abzug from './fixtures/dart-partner.json' with { type: 'json' };
import {
  PARTNER_ENVS,
  PARTNER_FEHLER_CODES,
  PARTNER_PORTAL_FEHLER_CODES,
  PARTNER_WEBHOOK_EVENTS,
  WEBHOOK_UMSCHLAG_FELDER,
  BETRIEB_FELDER,
  WEBHOOK_RETRY_PLAN_SEC,
  partnerFehlerRat,
} from '../src/partner/index.js';

/*
 * Gleichheits-Waechter fuer den Partner-Teil — dasselbe Muster wie
 * `enums.test.ts` fuer die Kassen-Enums: verglichen wird gegen den
 * eingecheckten Abzug der Dart-Seite (test/fixtures/dart-partner.json).
 *
 * **Warum es diese Datei zusaetzlich zu fixtures/oberflaeche.json gibt.** Der
 * Vertrag in `fixtures/` geht in die andere Richtung: den prueft das
 * Dart-Repo gegen dieses Paket. Hier faellt auf, was NUR in Dart landet —
 * ein Fehlercode, ein Ereignis, ein Betriebsfeld oder die Marke `test`, die
 * dort ergaenzt und hier vergessen wurde. Ohne diese Richtung stuende die
 * Luecke erst im naechsten Zwillingslauf drueben, und das ist ein anderes
 * Repo und ein anderer Tag.
 *
 * Die Listen werden in BEIDE Richtungen verglichen: keine fehlt, keine ist zu
 * viel. Ein Fehlercode, den nur eine Seite kennt, ist fuer einen Aufrufer
 * nicht von "gibt es nicht" zu unterscheiden.
 */

const abzugAls = abzug as unknown as Record<string, unknown>;

const listen: Record<string, readonly (string | number)[]> = {
  PARTNER_ENVS,
  PARTNER_FEHLER_CODES,
  PARTNER_PORTAL_FEHLER_CODES,
  PARTNER_WEBHOOK_EVENTS,
  WEBHOOK_UMSCHLAG_FELDER,
  BETRIEB_FELDER,
  WEBHOOK_RETRY_PLAN_SEC,
};

test('Partner: der Abzug nennt seine Quelle', () => {
  // Ohne diese Zeile weiss niemand, welchen Stand des Dart-Pakets die Datei
  // beschreibt — und ein Abzug ohne Herkunft ist eine Behauptung.
  assert.match(String(abzugAls['_quelle'] ?? ''), /kasseneck_api/);
  assert.match(String(abzugAls['_quelle'] ?? ''), /pubspec\.yaml version: \d+\.\d+\.\d+/);
});

test('Partner: jede Liste steht in beiden Sprachen — und in derselben Reihenfolge', () => {
  for (const [name, hier] of Object.entries(listen)) {
    const dort = abzugAls[name];
    assert.ok(Array.isArray(dort), `${name} fehlt im Abzug des Dart-Pakets`);
    assert.deepEqual([...hier], dort, `${name} weicht vom Dart-Zwilling ab`);
  }
});

test('Partner: der Abzug fuehrt keine Liste, die es hier nicht gibt', () => {
  // Die andere Richtung. Ein Name, der drueben entsteht und hier fehlt, faellt
  // sonst niemandem auf: die obige Schleife geht nur ueber die eigenen Namen.
  const eigene = new Set(Object.keys(listen));
  for (const name of Object.keys(abzugAls)) {
    if (name.startsWith('_')) continue;
    assert.ok(eigene.has(name), `Der Abzug fuehrt "${name}" — dieses Paket kennt die Liste nicht`);
  }
});

test('Partner: die Marke test steht im Umschlag beider Sprachen', () => {
  // Die eine Stelle, an der eine Probe von einem echten Ereignis zu
  // unterscheiden ist. Faellt sie auf einer Seite weg, haelt dort jemand eine
  // Probe fuer echt und schreibt seinem Kunden, die Kasse sei fertig.
  assert.ok(WEBHOOK_UMSCHLAG_FELDER.includes('test'), 'hier fehlt die Marke');
  assert.ok((abzugAls['WEBHOOK_UMSCHLAG_FELDER'] as string[]).includes('test'), 'im Dart-Paket fehlt die Marke');
});

test('Partner: jeder Code des Abzugs hat hier auch einen Handlungssatz', () => {
  // Die Liste allein reicht nicht: ein Code ohne Satz sieht aus wie behandelt
  // und sagt nichts.
  const codes = [
    ...(abzugAls['PARTNER_FEHLER_CODES'] as string[]),
    ...(abzugAls['PARTNER_PORTAL_FEHLER_CODES'] as string[]),
  ];
  assert.equal(codes.length, 40, 'der Katalog des Backends hat 28 API- und 12 Portal-Codes');
  for (const code of codes) {
    const rat = partnerFehlerRat(code);
    assert.ok(rat && rat.length > 20, `${code}: kein brauchbarer Handlungssatz`);
  }
});
