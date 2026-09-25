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

/**
 * Eintraege, die NACH dem Abzug dazukamen und dort nie ankommen werden.
 *
 * Das Dart-Paket fuehrt seit langem keinen Partner-Client mehr
 * (kasseneck_api 9.0.2 auf origin/main: kein lib/src/partner, zwillinge.yaml
 * nennt die Partner-Aufrufe `nicht_zutreffend`, "bekommt bewusst keinen
 * Partner-Zwilling"). Der Abzug beschreibt also Dart 5.3.0 und waechst nicht
 * mehr. Was das Backend seither an Codes der Schnittstelle ergaenzt hat, steht
 * hier, benannt und begruendet, statt den Abzug so zu faelschen, als haette
 * Dart es.
 */
const NACH_DEM_ABZUG: Record<string, readonly string[]> = {
  // `tax_number_missing`/`contracts_pending`: dieselben zwei wie zuvor
  // (`kennung_fehlt` aus sendPartnerCustomerFonLink, `vertrag_offen` aus
  // activateCashregister live), seit 0.29.0 in ihrer `/v3`-Schreibweise.
  // Die uebrigen acht sind reportCustomerContract/reportCustomerVertrag
  // (partner-core.FEHLER_KATALOG, flaeche 'api'/'beide'); dieser Endpunkt
  // existierte in Dart 5.3.0 so wenig wie in diesem Paket. `not_required`
  // gehoert NICHT dazu: derselbe Server-Zweig, aber ueber die Partner-API
  // unerreichbar, darum in fehler.ts seit dieser Korrektur weder hier noch
  // dort gefuehrt (siehe Kopfkommentar dort).
  PARTNER_FEHLER_CODES: [
    'tax_number_missing', 'contracts_pending',
    'kind_not_allowed', 'mode_not_allowed', 'power_of_attorney_missing',
    'not_found', 'no_version', 'unknown_version', 'text_changed', 'already_accepted',
  ],
};

/**
 * Umgekehrt: Codes, die der eingefrorene Dart-Abzug noch fuehrt, dieses Paket
 * seit 0.29.0 aber nicht mehr: `kein_partnerbetrieb` und `request_not_found`
 * sind admin-only (`functions-partner/partner-endpoints.js`, ausserhalb von
 * `FEHLER_KATALOG`) und erreichten `/v3` nie; sie standen bis 0.28.0
 * versehentlich in PARTNER_FEHLER_CODES (siehe Kopfkommentar in fehler.ts).
 * Der Dart-Snapshot ist aelter als diese Korrektur und aendert sich nicht mehr.
 */
const NICHT_MEHR_OEFFENTLICH: Record<string, readonly string[]> = {
  PARTNER_FEHLER_CODES: ['kein_partnerbetrieb', 'request_not_found'],
};

/**
 * Codes, die der Dart-Abzug noch deutsch fuehrt und die der Server seit
 * `/v3` (0.28.0 fuer die Route, 0.29.0 fuer die Codes selbst) englisch
 * schickt. Nur fuer den Ordnungsvergleich unten; Dart bekommt nie `/v3` und
 * kennt diese Schreibweise darum nicht.
 */
const V3_UEBERSETZT: Record<string, Record<string, string>> = {
  PARTNER_FEHLER_CODES: { zugang_nicht_erlaubt: 'access_not_allowed' },
};

test('Partner: die Nachtraege stehen wirklich nur hier und nicht im Abzug', () => {
  // Sonst deckte die Ausnahme einen Eintrag, den es auf beiden Seiten gibt,
  // und saenke nie.
  for (const [name, nachtraege] of Object.entries(NACH_DEM_ABZUG)) {
    const hier = listen[name] as readonly string[];
    const dort = abzugAls[name] as string[];
    for (const eintrag of nachtraege) {
      assert.ok(hier.includes(eintrag), `${name}: ${eintrag} fehlt hier`);
      assert.ok(!dort.includes(eintrag), `${name}: ${eintrag} steht schon im Abzug, die Ausnahme ist tot`);
    }
  }
});

test('Partner: die Streichungen stehen wirklich nur im Abzug und nicht mehr hier', () => {
  // Sonst deckte die Ausnahme einen Eintrag, der auf beiden Seiten fehlt, und
  // saenke nie.
  for (const [name, gestrichen] of Object.entries(NICHT_MEHR_OEFFENTLICH)) {
    const hier = listen[name] as readonly string[];
    const dort = abzugAls[name] as string[];
    for (const eintrag of gestrichen) {
      assert.ok(dort.includes(eintrag), `${name}: ${eintrag} steht nicht mehr im Abzug, die Ausnahme ist tot`);
      assert.ok(!hier.includes(eintrag), `${name}: ${eintrag} steht hier noch`);
    }
  }
});

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
    const nachtraege = new Set<string | number>(NACH_DEM_ABZUG[name] ?? []);
    const gestrichen = new Set<string | number>(NICHT_MEHR_OEFFENTLICH[name] ?? []);
    const uebersetzt = V3_UEBERSETZT[name] ?? {};
    const dortUebersetzt = (dort as (string | number)[])
      .filter((x) => !gestrichen.has(x))
      .map((x) => (typeof x === 'string' && x in uebersetzt ? uebersetzt[x]! : x));
    assert.deepEqual([...hier].filter((x) => !nachtraege.has(x)), dortUebersetzt, `${name} weicht vom Dart-Zwilling ab`);
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
  // und sagt nichts. Ausnahmen: die beiden admin-only Codes aus
  // NICHT_MEHR_OEFFENTLICH (dieses Paket fuehrt sie seit 0.29.0 bewusst nicht
  // mehr, siehe dort) fallen weg; `zugang_nicht_erlaubt` steht wie in Dart
  // deutsch im Abzug, hat hier aber nur noch unter seiner `/v3`-Schreibweise
  // einen Satz (V3_UEBERSETZT).
  const gestrichen = new Set(NICHT_MEHR_OEFFENTLICH['PARTNER_FEHLER_CODES'] ?? []);
  const uebersetzt = V3_UEBERSETZT['PARTNER_FEHLER_CODES'] ?? {};
  const codes = [
    ...(abzugAls['PARTNER_FEHLER_CODES'] as string[]),
    ...(abzugAls['PARTNER_PORTAL_FEHLER_CODES'] as string[]),
  ]
    .filter((c) => !gestrichen.has(c))
    .map((c) => uebersetzt[c] ?? c);
  assert.equal(codes.length, 38, 'der Katalog des Backends hat 26 API- und 12 Portal-Codes ohne die zwei Streichungen');
  for (const code of codes) {
    const rat = partnerFehlerRat(code);
    assert.ok(rat && rat.length > 20, `${code}: kein brauchbarer Handlungssatz`);
  }
});
