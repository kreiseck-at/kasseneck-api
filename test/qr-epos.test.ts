import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { eposPrintXml, eposPrintXmlErgebnis, type ReceiptLayout } from '../src/receipt/index.js';
import { qrModulAnzahl } from '../src/printing/index.js';

/**
 * Der zweite Druckweg: ePOS-Print XML fuer Epson-Geraete. Dort steckte
 * derselbe Fehler wie im nativen ESC/POS-Befehl des Flutter-Zwillings — die
 * QR-Modulgroesse stand fest auf 6, unabhaengig von der Papierbreite. 57
 * Module plus Ruhezone sind bei sechs Punkten 390 Druckpunkte, ein 58-mm-Kopf
 * hat 384; der Drucker laesst das Symbol dann weg. Genau daran fehlte am
 * echten Beleg der QR.
 *
 * Der Bestandswert dieses Wegs ist 6 (nicht 4 wie beim ESC/POS-Befehl dieses
 * Pakets) — deshalb ist die Vorgabe hier der Deckel `mittel`. Ohne
 * ausdrueckliche Wahl aendert sich damit nur dort etwas, wo heute gar nichts
 * herauskommt.
 */

const wurzel = new URL('../../fixtures/', import.meta.url);
const roh = JSON.parse(
  readFileSync(new URL('erwartet/verkauf-bar.lines.json', wurzel), 'utf8'),
) as ReceiptLayout;
const basis: ReceiptLayout = { ...roh, paperSize: 'mm58' };

const mitQr = (nutzlast: string, papier: 'mm58' | 'mm80' = 'mm58'): ReceiptLayout => ({
  ...basis,
  paperSize: papier,
  lines: basis.lines.map((z) => (z.kind === 'qr' ? { ...z, data: nutzlast } : z)),
});

const digest = (xml: string): string => createHash('sha256').update(xml, 'utf8').digest('hex');

/** `width`-Attribut des <symbol>-Elements, oder null wenn keines da ist. */
const symbolBreite = (xml: string): number | null => {
  const m = /<symbol\b[^>]*\bwidth="(\d+)"/.exec(xml);
  return m ? Number(m[1]) : null;
};

/** Eine Nutzlast, wie sie wirklich auf einem RKSV-Beleg steht: 193 Byte, 57 Module. */
const RKSV =
  '_R1-AT1_KASSENECK1_AT0-KASSENECK1-10420_2026-08-13T10:15:30_12,90_0,00_0,00_0,00_0,00_' +
  'PL5nQ2V0b3JRRA==_6F0404F0_Ky9lbXBmYW5nZXJzY2hsdXNzZWw=_' +
  'bGV0enRlci1TaWduYXR1cndlcnQtUktTVi1CZWxlZy1EZW1vLTAx';

// -------------------------------------------------------- Bestandsschutz

test('ePOS-Bestandsschutz: das XML eines Belegs auf 58 mm ist byteidentisch', () => {
  assert.equal(
    digest(eposPrintXml(basis)),
    '8815fd017a5483413d545093145d76fe5d00ab9bf977b37e6fb6b72aff509785',
  );
});

test('ePOS-Bestandsschutz: das XML eines Belegs auf 80 mm ist byteidentisch', () => {
  assert.equal(
    digest(eposPrintXml({ ...roh, paperSize: 'mm80' })),
    'e7318f34c510dd291cd64a67cfd9cdd68352ed1cd70ec76a60f1a779aecab0b0',
  );
});

test('ePOS-Bestandsschutz: wo der Bestandswert passt, bleibt es bei 6', () => {
  // 45 Module: (45 + 8) * 6 = 318 <= 384. Auf 58 mm rechnerisch bis 7 moeglich,
  // gedruckt werden 6 — der Deckel ist der Bestandswert dieses Wegs.
  assert.equal(symbolBreite(eposPrintXml(basis)), 6);
  assert.equal(symbolBreite(eposPrintXml({ ...roh, paperSize: 'mm80' })), 6);
});

// ------------------------------------------------------------- die Rechnung

test('ePOS: der reale Beleg-QR wird auf 58 mm heruntergerechnet — heute faellt er aus', () => {
  assert.equal(qrModulAnzahl(RKSV), 57);
  // (57 + 8) * 6 = 390 > 384 -> der Drucker laesst das Symbol weg.
  // (57 + 8) * 5 = 325 <= 384.
  assert.equal(symbolBreite(eposPrintXml(mitQr(RKSV))), 5);
  // Auf 80 mm (576 Punkte) passt der Bestandswert weiterhin.
  assert.equal(symbolBreite(eposPrintXml(mitQr(RKSV, 'mm80'))), 6);
});

test('ePOS: der Deckel waehlt, das Papier begrenzt', () => {
  assert.equal(symbolBreite(eposPrintXml(basis, { qrGroesse: 'klein' })), 4);
  assert.equal(symbolBreite(eposPrintXml(basis, { qrGroesse: 'gross' })), 7);
  assert.equal(symbolBreite(eposPrintXml({ ...roh, paperSize: 'mm80' }, { qrGroesse: 'gross' })), 8);
  // Kein Deckel hebt an, wo das Papier nicht reicht.
  assert.equal(symbolBreite(eposPrintXml(mitQr(RKSV), { qrGroesse: 'gross' })), 5);
});

test('ePOS: feste qrBreite schaltet die Rechnung ab', () => {
  const ergebnis = eposPrintXmlErgebnis(mitQr(RKSV), { qrBreite: 6 });
  assert.equal(symbolBreite(ergebnis.xml), 6);
  assert.deepEqual([ergebnis.qrFehler, ergebnis.qrAusweich], [null, null]);
});

test('ePOS: unter der Mindestgroesse wird gedruckt, aber gemeldet', () => {
  const ergebnis = eposPrintXmlErgebnis(mitQr('X'.repeat(600)));
  assert.equal(symbolBreite(ergebnis.xml), 3);
  assert.match(ergebnis.qrAusweich ?? '', /unter dem Mindestmass/);
  assert.equal(ergebnis.qrFehler, null);
});

test('ePOS: was nicht aufs Papier passt, wird nicht als Symbol vorgetaeuscht', () => {
  const ergebnis = eposPrintXmlErgebnis(mitQr('X'.repeat(1000)));
  assert.equal(symbolBreite(ergebnis.xml), null, 'es steht doch ein <symbol> im XML');
  assert.equal(ergebnis.xml.includes('<symbol'), false);
  assert.match(ergebnis.qrFehler ?? '', /121 Modulen ist fuer 58 mm \(384 Punkte\) zu breit/);
  assert.equal(ergebnis.qrAusweich, null);
  // Der Beleg selbst bleibt vollstaendig: die Ausrichtungs-Klammer bleibt heil.
  assert.equal(ergebnis.xml.includes('</epos-print>'), true);
});

test('ePOS: leere Nutzlast geht unveraendert den Bestandsweg', () => {
  const ergebnis = eposPrintXmlErgebnis(mitQr(''));
  assert.equal(symbolBreite(ergebnis.xml), 6);
  assert.deepEqual([ergebnis.qrFehler, ergebnis.qrAusweich], [null, null]);
});

test('ePOS: eposPrintXml gibt genau das XML des Ergebnisses', () => {
  for (const layout of [basis, mitQr(RKSV), mitQr('X'.repeat(1000))]) {
    assert.equal(eposPrintXml(layout), eposPrintXmlErgebnis(layout).xml);
  }
});
