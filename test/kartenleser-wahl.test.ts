import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newCardReaderReference, cardReaderFor, cardReaderMessageKey, MESSAGES, type CardReaderSetup, type CardReaderPaymentStatus, type CardReaderReason } from '../src/pos/index.js';

interface Erwartet { kind: string; readerId?: string; readerIds?: string[]; why?: string }
interface Faelle { version: number; cases: { name: string; setup: CardReaderSetup; expected: Erwartet }[] }
const faelle = JSON.parse(readFileSync(new URL('../../fixtures/card-reader-choice-cases.json', import.meta.url), 'utf8')) as Faelle;

test('Pruefaelle: Wahl des Solos', () => {
  assert.equal(faelle.version, 1);
  assert.ok(faelle.cases.length >= 20);
  for (const f of faelle.cases) {
    const w = cardReaderFor(f.setup);
    const ist: Erwartet = { kind: w.kind };
    if (w.kind === 'reader') ist.readerId = w.reader.readerId;
    if (w.kind === 'choose') ist.readerIds = w.readers.map((l) => l.readerId);
    if (w.kind === 'none') ist.why = w.why;
    assert.deepEqual(ist, f.expected, f.name);
  }
});

interface MeldungsFaelle { version: number; cases: { kind: 'payment' | 'refund'; status: CardReaderPaymentStatus; reason: CardReaderReason | null; key: string | null }[] }
const meldungen = JSON.parse(readFileSync(new URL('../../fixtures/card-reader-message-cases.json', import.meta.url), 'utf8')) as MeldungsFaelle;

test('Pruefaelle: Kassentext je Stand der Zahlung und Rueckbuchung', () => {
  assert.equal(meldungen.version, 1);
  for (const f of meldungen.cases) {
    assert.equal(cardReaderMessageKey(f.kind, { status: f.status, reason: f.reason }), f.key, JSON.stringify(f));
    if (f.key !== null) assert.ok(f.key in MESSAGES, `${f.key} fehlt im Textkatalog`);
  }
  // jeder Stand beider Arten kommt mindestens einmal vor
  for (const kind of ['payment', 'refund']) {
    for (const status of ['successful', 'pending', 'unclear', 'failed', 'cancelled', 'declined']) {
      assert.ok(meldungen.cases.some((f) => f.kind === kind && f.status === status), `${kind}/${status}`);
    }
  }
});

test('Kennung der Zahlung: Form kk-<kasse>-<epochMs>-<zufall>', () => {
  assert.equal(
    newCardReaderReference('CASHBOX-DEMO-1', { nowMs: 1763800000000, random: 'a1b2c3' }),
    'kk-CASHBOX-DEMO-1-1763800000000-a1b2c3',
  );
});

test('Kennung der Zahlung: fremde Zeichen fallen weg, Laenge hoechstens 64', () => {
  const k = newCardReaderReference('ä ö/ü'.repeat(30), { nowMs: 1763800000000, random: 'a1b2c3' });
  assert.match(k, /^[A-Za-z0-9_-]{8,64}$/);
  const lang = newCardReaderReference('K'.repeat(200), { nowMs: 1763800000000, random: 'a1b2c3' });
  assert.equal(lang.length, 64);
  assert.ok(lang.endsWith('-1763800000000-a1b2c3'));
  assert.equal(newCardReaderReference('ä ö/ü', { nowMs: 1, random: 'a1b2c3' }), 'kk-x-1-a1b2c3');
});

test('Kennung der Zahlung: zwei Aufrufe sind verschieden, Zufall aus 6 Zeichen a-z0-9', () => {
  const a = newCardReaderReference('K1');
  const b = newCardReaderReference('K1');
  assert.notEqual(a, b);
  assert.match(a, /^kk-K1-\d+-[a-z0-9]{6}$/);
});
