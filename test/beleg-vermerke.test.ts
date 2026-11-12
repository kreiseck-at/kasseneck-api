import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { fromReceiptPayload, type Receipt } from '../src/models/index.js';
import { belegVermerke, buildReceiptLayout, type BuildReceiptLayoutOptions, type BelegVermerk } from '../src/receipt/index.js';
import { isKasseneckValidationError } from '../src/client/errors.js';

/*
 * Vermerke eines Belegs als strukturierte Form (Kassenteil auf der Rechnung,
 * Zahlungsbestaetigung): dieselben Bausteine wie der Bon, nur ohne Zeilenmodell.
 * Reihenfolge fest: Testkasse, Testsignatur, Training, Storno, Nacherfassung,
 * Signaturausfall.
 */

const wurzel = new URL('../../fixtures/', import.meta.url);

interface Fixture {
  company: Parameters<typeof buildReceiptLayout>[1];
  receipt: Record<string, unknown> & { customerDetails: string[]; legalMessage: string[] };
  options?: BuildReceiptLayoutOptions;
}

const lade = (name: string): Fixture => JSON.parse(readFileSync(new URL(`belege/${name}.json`, wurzel), 'utf8')) as Fixture;
const belegVon = (f: Fixture): Receipt =>
  fromReceiptPayload({ ...f.receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never);
const beleg = (name: string): Receipt => belegVon(lade(name));
const arten = (vermerke: BelegVermerk[]): string[] => vermerke.map((v) => v.art);

test('Signaturausfall: genau der Vermerk „Sicherheitseinrichtung ausgefallen“ ohne Zeilen', () => {
  assert.deepEqual(belegVermerke(beleg('signaturausfall-verkauf'), {}), [
    { art: 'signaturausfall', titel: 'Sicherheitseinrichtung ausgefallen', zeilen: [] },
  ]);
});

test('Storno: Titel STORNOBELEG, darunter der Bezug, das Datum des Originals und der Grund', () => {
  const vermerke = belegVermerke(beleg('storno-voll'), {});
  assert.equal(vermerke[0]!.art, 'storno');
  assert.equal(vermerke[0]!.titel, 'STORNOBELEG');
  assert.deepEqual(vermerke[0]!.zeilen, ['Stornobuchung zu Beleg AT0-KASSE1-42', 'vom 11.08.2026, 09:02 Uhr', 'Grund: Kunde hat storniert']);
});

test('Testkasse und Training: Reihenfolge Testkasse vor Training', () => {
  const vermerke = belegVermerke(beleg('training'), { testKasse: true });
  assert.deepEqual(arten(vermerke), ['testkasse', 'training']);
  assert.equal(vermerke[1]!.titel, 'TRAININGSBELEG');
  assert.ok(vermerke[1]!.zeilen[0]!.startsWith('Trainingsbuchung'), vermerke[1]!.zeilen[0]);
});

test('Normalbeleg: keine Vermerke', () => {
  assert.deepEqual(belegVermerke(beleg('verkauf-bar'), {}), []);
  assert.deepEqual(belegVermerke(beleg('verkauf-bar')), []);
});

test('alle Vermerke zugleich stehen in der festen Reihenfolge', () => {
  const f = lade('storno-voll');
  const r = belegVon({
    ...f,
    receipt: {
      ...f.receipt,
      sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.U2ljaGVyaGVpdHNlaW5yaWNodHVuZyBhdXNnZWZhbGxlbg',
      handbeleg: { nummer: '233', datum: '2026-08-12', uhrzeit: '16:48', grund: 'strom' },
    },
  });
  const vermerke = belegVermerke(r, { testKasse: true, testSignatur: true });
  assert.deepEqual(arten(vermerke), ['testkasse', 'testsignatur', 'storno', 'nacherfassung', 'signaturausfall']);
  assert.deepEqual(arten(belegVermerke(beleg('training'), { testSignatur: true })), ['testsignatur', 'training']);
});

test('Nacherfassung: Titel NACHERFASSUNG, Anlass, Grund, Nummer und Tag des Handbelegs (ohne USt-Hinweis, der haengt an der Firma)', () => {
  assert.deepEqual(belegVermerke(beleg('nacherfassung-einzel-strom-zeit'), {}), [{
    art: 'nacherfassung',
    titel: 'NACHERFASSUNG',
    zeilen: ['nach Ausfall der Kasse', 'Grund: Strom', 'Handbeleg Nr. 233', 'vom 03.11.2026, 16:48 Uhr'],
  }]);
  const sammel = belegVermerke(beleg('nacherfassung-sammel-strom-anzahl'), {});
  assert.deepEqual(sammel[0]!.zeilen.slice(2), ['Tagessammelbeleg', 'Handbelege Nr. 201 bis 248', '48 Belege vom 03.11.2026']);
  const ausserHaus = belegVermerke(beleg('nacherfassung-einzel-ausser-haus-zeit'), {});
  assert.equal(ausserHaus[0]!.zeilen[0], 'Leistung außer Haus');
});

test('Zahlungsbeleg nacherfasst: der Vermerk wie jeder, am Bon kein „USt: Duplikat …“ (die Steuer steht auf der Rechnung)', () => {
  assert.deepEqual(belegVermerke(beleg('rechnungszahlung-nacherfassung'), {}), [{
    art: 'nacherfassung',
    titel: 'NACHERFASSUNG',
    zeilen: ['nach Ausfall der Kasse', 'Grund: Strom', 'Handbeleg Nr. 0815', 'vom 10.11.2026, 16:30 Uhr'],
  }]);
  const texte = (name: string): string[] => {
    const g = lade(name);
    return buildReceiptLayout(belegVon(g), g.company, g.options ?? {}).lines.flatMap((z) => (z.kind === 'text' ? [z.text] : []));
  };
  assert.ok(!texte('rechnungszahlung-nacherfassung').some((t) => t.startsWith('USt: Duplikat')));
  // Gegenprobe: derselbe Bausatz am Warenbeleg traegt den Hinweis.
  assert.ok(texte('nacherfassung-einzel-strom-zeit').includes('USt: Duplikat des Handbelegs'));
});

test('Testkasse und Testsignatur: Titel wie die Warnrahmen am Bon, ohne Zeilen', () => {
  assert.deepEqual(belegVermerke(beleg('verkauf-bar'), { testKasse: true, testSignatur: true }), [
    { art: 'testkasse', titel: 'TESTKASSE — kein gültiger Beleg', zeilen: [] },
    { art: 'testsignatur', titel: 'TESTSIGNATUR — kein gültiger Beleg', zeilen: [] },
  ]);
});

test('Optionen: eine unbekannte oder englische Option wird abgewiesen (sonst fehlte der Testkasse-Vermerk still)', () => {
  const r = beleg('verkauf-bar');
  assert.throws(() => belegVermerke(r, { testCashregister: true } as never), (e: unknown) => isKasseneckValidationError(e) && /testKasse/.test((e as Error).message));
  assert.throws(() => belegVermerke(r, { duplikat: true } as never), (e: unknown) => isKasseneckValidationError(e) && /duplikat/.test((e as Error).message));
});

/**
 * Eine Quelle fuer die Regeln: was `belegVermerke` sagt, steht am Bon genau so
 * (Titel als Banner bzw. Zeile, jede Zeile als Textzeile). Fuer jeden Golden-Beleg.
 */
test('Bon und Vermerke sagen dasselbe: jeder Vermerk steht mit Titel und Zeilen im Layout jedes Golden-Belegs', () => {
  const namen = readdirSync(new URL('belege/', wurzel)).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));
  let mitVermerk = 0;
  for (const name of namen) {
    const f = lade(name);
    const r = belegVon(f);
    const optionen = { testKasse: f.options?.testKasse, testSignatur: f.options?.testSignatur };
    const layout = buildReceiptLayout(r, f.company, f.options ?? {});
    const texte = layout.lines.flatMap((z) => (z.kind === 'text' || z.kind === 'banner' ? [z.text] : []));
    for (const v of belegVermerke(r, optionen)) {
      // Nullbelege setzt der Bon reduziert, ohne Nacherfassung.
      if (v.art === 'nacherfassung' && /^null/.test(name)) continue;
      assert.ok(texte.includes(v.titel), `${name}: Titel „${v.titel}“ fehlt am Bon`);
      for (const zeile of v.zeilen) assert.ok(texte.includes(zeile), `${name}: Zeile „${zeile}“ fehlt am Bon`);
      mitVermerk += 1;
    }
  }
  assert.ok(mitVermerk >= 20, `nur ${mitVermerk} Vermerke geprueft`);
});
