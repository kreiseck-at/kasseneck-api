import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseServerTimeStamp, toViennaWallClock } from '../src/vienna-time.js';

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

// --- Rueckrichtung: Zeitpunkt -> Wiener Wanduhrzeit ---------------------
//
// `toViennaWallClock` ist die Grundlage jedes fachlichen Kalenderwerts
// (Berichtsmonat, Tagesabgrenzung). Vertauschte jemand den Versatz 2/1,
// bliebe ohne diese Tests die ganze Suite gruen — und ein erster Beleg vom
// 01.07. 00:30 Wiener Zeit fiele in den Juni.

test('toViennaWallClock: Sommerzeit ist zwei Stunden vor UTC', () => {
  assert.deepEqual(toViennaWallClock(new Date('2026-07-17T21:30:00Z')), {
    year: 2026,
    month: 7,
    day: 17,
    hour: 23,
    minute: 30,
    second: 0,
    millisecond: 0,
  });
});

test('toViennaWallClock: Winterzeit ist eine Stunde vor UTC', () => {
  assert.deepEqual(toViennaWallClock(new Date('2026-01-10T11:00:00Z')), {
    year: 2026,
    month: 1,
    day: 10,
    hour: 12,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
});

test('toViennaWallClock: Fruehjahrsgrenze — 29.03.2026 01:00 UTC springt von 01:59 auf 03:00', () => {
  const davor = toViennaWallClock(new Date('2026-03-29T00:59:59Z'));
  assert.deepEqual([davor.day, davor.hour, davor.minute, davor.second], [29, 1, 59, 59]);
  const danach = toViennaWallClock(new Date('2026-03-29T01:00:00Z'));
  assert.deepEqual([danach.day, danach.hour, danach.minute, danach.second], [29, 3, 0, 0]);
});

test('toViennaWallClock: Herbstgrenze — 25.10.2026 01:00 UTC faellt von 02:59 auf 02:00 zurueck', () => {
  const davor = toViennaWallClock(new Date('2026-10-25T00:59:59Z'));
  assert.deepEqual([davor.day, davor.hour, davor.minute, davor.second], [25, 2, 59, 59]);
  const danach = toViennaWallClock(new Date('2026-10-25T01:00:00Z'));
  assert.deepEqual([danach.day, danach.hour, danach.minute, danach.second], [25, 2, 0, 0]);
});

test('toViennaWallClock: kehrt parseServerTimeStamp exakt um (beide Jahreszeiten)', () => {
  for (const roh of ['2026-07-17T23:30:00', '2026-01-10T12:00:00', '2026-03-01T00:30:00']) {
    const wanduhr = toViennaWallClock(parseServerTimeStamp(roh));
    const zurueck = `${String(wanduhr.year).padStart(4, '0')}-${String(wanduhr.month).padStart(2, '0')}-${String(wanduhr.day).padStart(2, '0')}T${String(wanduhr.hour).padStart(2, '0')}:${String(wanduhr.minute).padStart(2, '0')}:${String(wanduhr.second).padStart(2, '0')}`;
    assert.equal(zurueck, roh);
  }
});

test('parseServerTimeStamp: Unsinn hinter einem Z wird nicht still zu einem unbrauchbaren Zeitpunkt', () => {
  // '2026-99-99T00:00:00Z' hat eine Zeitzone, ist aber kein Datum. `new Date`
  // macht daraus klaglos ein Invalid Date — und jede Ableitung daraus (Monat,
  // Jahr) wird NaN, ohne dass irgendwo etwas auffaellt.
  assert.throws(() => parseServerTimeStamp('2026-99-99T00:00:00Z'), /Zeitstempel/);
  assert.throws(() => parseServerTimeStamp('gestern Z'), /Zeitstempel/);
});

test('toViennaWallClock: unbrauchbarer Zeitpunkt wirft statt NaN-Felder zu liefern', () => {
  assert.throws(() => toViennaWallClock(new Date(NaN)), /Zeitpunkt/);
});
