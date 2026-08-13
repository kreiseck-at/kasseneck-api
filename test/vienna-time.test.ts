import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseServerTimeStamp } from '../src/vienna-time.js';

// Werte 1:1 aus kasseneck_api/test/vienna_time_test.dart uebernommen
// (Primaerquelle statt Zusammenfassung) — Dart-Vorbild bereits gegen die
// tatsaechlichen EU-DST-Umstellungstermine 2026 verifiziert.

test('parseServerTimeStamp: offsetloser String wird als Wiener Wanduhrzeit gedeutet (Sommerzeit)', () => {
  const instant = parseServerTimeStamp('2026-07-17T23:30:00');
  assert.equal(instant.toISOString(), '2026-07-17T21:30:00.000Z');
});

test('parseServerTimeStamp: offsetloser String wird als Wiener Wanduhrzeit gedeutet (Winterzeit)', () => {
  const instant = parseServerTimeStamp('2026-01-10T12:00:00');
  assert.equal(instant.toISOString(), '2026-01-10T11:00:00.000Z');
});

test('parseServerTimeStamp: Wanduhrzeit kann in den Vortag (UTC) zurueckfallen', () => {
  // 01.07. 00:05:19 Wien (Sommerzeit) = 30.06. 22:05:19 UTC.
  const instant = parseServerTimeStamp('2026-07-01T00:05:19');
  assert.equal(instant.toISOString(), '2026-06-30T22:05:19.000Z');
});

test('parseServerTimeStamp: String mit Z wird unveraendert als Zeitpunkt gelesen (kein zweites Verschieben)', () => {
  const instant = parseServerTimeStamp('2026-06-30T22:05:19.000Z');
  assert.equal(instant.toISOString(), '2026-06-30T22:05:19.000Z');
});

test('parseServerTimeStamp: beide Formen desselben Zeitpunkts ergeben denselben Zeitpunkt', () => {
  const ohneOffset = parseServerTimeStamp('2026-07-01T00:05:19');
  const mitOffset = parseServerTimeStamp('2026-06-30T22:05:19.000Z');
  assert.equal(ohneOffset.getTime(), mitOffset.getTime());
});

test('parseServerTimeStamp: ein offsetloser String wird NICHT als UTC gelesen', () => {
  // Rot-Probe-Anker: wuerde man die Deutung durch new Date(str) ersetzen,
  // laese man den String je nach Laufzeit-Zeitzone des Prozesses (nicht nach
  // Wien) — auf einem UTC-Prozess z. B. als 10:00 UTC statt der korrekten
  // 08:00 UTC (10:00 Wien im Sommer). Dieser Test verlangt explizit die
  // Wiener Deutung, unabhaengig von der Zeitzone des Testlaeufers.
  const instant = parseServerTimeStamp('2026-08-13T10:00:00');
  assert.notEqual(instant.toISOString(), '2026-08-13T10:00:00.000Z');
  assert.equal(instant.toISOString(), '2026-08-13T08:00:00.000Z');
});

test('parseServerTimeStamp: unlesbares Format wirft statt still ein falsches Datum zu liefern', () => {
  assert.throws(() => parseServerTimeStamp('nicht-mal-ein-datum'), /Zeitstempel/);
});
