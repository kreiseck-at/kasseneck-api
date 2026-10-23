import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { fromReceiptPayload } from '../src/models/index.js';
import { buildReceiptLayout, type BuildReceiptLayoutOptions, type ReceiptLayout } from '../src/receipt/index.js';
import { cashMovementLayout, shiftReceiptLayout } from '../src/pos/index.js';
import { blattWieAufgenommen, druckAusgaben, sha } from './druck-ausgaben.js';

/**
 * Druck-Goldens: was am Papier und am Schirm landet, Byte fuer Byte.
 *
 * `test/fixtures/druck-goldens.json` haelt je Golden-Beleg und je Server-Layout
 * aus `fixtures/v3/antworten` den SHA-256 jeder Ausgabe (ESC/POS in fuenf
 * Varianten je Papier, ePOS-XML, Zeichenraster, Blatt, HTML von Blatt- und
 * Zeilenansicht). Aufgenommen am Stand 4d71203, BEVOR die Layout-Schluessel
 * englisch wurden. Im Feld drucken Bondrucker genau diese Belege; die
 * RKSV-Zeilen (Signatur, QR, „Sicherheitseinrichtung ausgefallen“) duerfen
 * sich durch eine Umbenennung nicht um ein Byte verschieben.
 *
 * Aendert sich eine Ausgabe absichtlich, ist das eine eigene Entscheidung mit
 * eigenem Commit, nie ein Beifang.
 *
 * Bon-Feinschliff (23.10.2026, R2/R5): die Digests der vier Gutschein-Belege voucher-multi-purpose-sale,
 * voucher-single-purpose-sale, voucher-single-purpose-redeem und -redeem-exempt sind absichtlich neu
 * gezogen (kurze Maske `····-XXXX`, Einzweck-Rest mit „€“); alle anderen Digests blieben.
 *
 * Vertragszug (23.10.2026, Backend Tasks 1-3): die Digests der Server-Layouts von je sieben Faellen in `belege` und
 * `kasse-belege` (sale_multi_purpose_voucher, sale_service_voucher, redeem_multi_purpose_voucher,
 * redeem_single_purpose_voucher, redeem_service_voucher, payout_multi_purpose_voucher,
 * get_receipt_single_purpose_redeemed) sind absichtlich neu gezogen: der Vertrag stammt jetzt vom Backend-Stand mit
 * dem vendorierten Paket 0.34.0 (vorher 0.33.1; `_quelle.backendPackage`), dessen Server-Layout die Gutschein-Zeilen
 * neu setzt (Mehrzweckgutschein statt Wertgutschein, Zeile mit Rest am Gutschein, Auszahlung ohne Mengenspalte),
 * und der Leistungsgutschein heisst dort `Leistungsgutschein Maniküre (2 Stück)` (Backend 8a78fc23). Gezeichnet wird
 * die Antwort unveraendert; nur die Eingabe hat sich geaendert. Alle anderen Digests blieben.
 *
 * Ersatzdaten (23.10.2026, R12): die Golden-Belege tragen statt `ATU12345678`/`12-345/6789` die pruefziffernrichtigen
 * Werte `ATU12345675`/`91-123/4565`; die Digests von `receipts` und `ruleset1` sind darum neu gezogen (nur die Kopfzeile
 * mit der UID aendert sich). `server` und `shift` stammen aus dem Vertrag und blieben.
 *
 * Vertragszug final (23.10.2026, Backend 85d18f12, vendortes Paket 0.35.0, Ersatzdaten im Backend): die Digests aller 38
 * Server-Layouts sind neu gezogen (Kopfzeile mit `ATU12345675` statt der alten UID, dazu die Bon-Regeln 0.35.0 bei den
 * Gutschein-Faellen); `receipts`, `ruleset1` und `shift` blieben. Das Server-Layout stammt unveraendert aus dem Vertrag.
 *
 * Kartenseriennummer (1.2.2/0.32.2): die Fixtures tragen statt einer echten die erfundene
 * Seriennummer `5A1C3E07` (gleiche Laenge); die Digests sind darum neu gezogen.
 * Gegenprobe: das alte Layout mit ersetzter Seriennummer ergibt Byte fuer Byte die neuen
 * Ausgaben -- sonst hat sich nichts verschoben.
 */
const goldens = JSON.parse(readFileSync(new URL('../../test/fixtures/druck-goldens.json', import.meta.url), 'utf8')) as {
  receipts: Record<string, Record<string, string>>;
  server: Record<string, Record<string, string>>;
  ruleset1: Record<string, Record<string, string>>;
  shift: Record<string, Record<string, string>>;
};
const wurzel = new URL('../../fixtures/', import.meta.url);

interface Fixture { company: Parameters<typeof buildReceiptLayout>[1]; receipt: Record<string, unknown> & { customerDetails: string[]; legalMessage: string[] }; options?: BuildReceiptLayoutOptions }

function vergleiche(name: string, layout: ReceiptLayout, soll: Record<string, string> | undefined): void {
  assert.ok(soll, `${name}: kein Golden aufgenommen`);
  const ist = Object.fromEntries(Object.entries(druckAusgaben(layout)).map(([k, v]) => [k, sha(v)]));
  assert.deepEqual(Object.keys(ist).sort(), Object.keys(soll).sort(), `${name}: andere Varianten`);
  const anders = Object.keys(soll).filter((k) => ist[k] !== soll[k]);
  assert.deepEqual(anders, [], `${name}: Ausgabe weicht ab`);
}

const namen = readdirSync(new URL('receipts/', wurzel)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

test('Druck-Goldens: jeder Golden-Beleg ist aufgenommen, keiner zu viel', () => {
  assert.deepEqual(Object.keys(goldens.receipts).sort(), namen);
});

for (const name of namen) {
  test(`Druck-Golden ${name}: ESC/POS, ePOS, Blatt und HTML byte-gleich`, () => {
    const f = JSON.parse(readFileSync(new URL(`receipts/${name}.json`, wurzel), 'utf8')) as Fixture;
    const receipt = fromReceiptPayload({ ...f.receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never);
    vergleiche(name, buildReceiptLayout(receipt, f.company, f.options ?? {}), goldens.receipts[name]);
  });
}

// Server-Layouts (`data.layout`) aus dem Vertrag. Am Basisstand kannte das
// Paket nur die deutsche Form; aufgenommen wurde darum dieselbe Zeilenfolge
// mit `regelwerk`/`ton` (belegart/warnung). Seit der Umstellung wird die
// Antwort unveraendert gezeichnet und muss dieselben Bytes ergeben.
let serverFaelle = 0;
for (const datei of ['belege', 'kasse-belege']) {
  const d = JSON.parse(readFileSync(new URL(`v3/antworten/${datei}.json`, wurzel), 'utf8')) as { cases: { name: string; response?: { data?: { layout?: ReceiptLayout } } }[] };
  for (const c of d.cases) {
    const layout = c.response?.data?.layout;
    if (!layout) continue;
    serverFaelle += 1;
    test(`Druck-Golden Server-Layout ${datei}/${c.name}: gezeichnet wie aufgenommen`, () => {
      vergleiche(`${datei}/${c.name}`, layout, goldens.server[`${datei}/${c.name}`]);
    });
  }
}

test('Druck-Goldens: alle Server-Layouts aus dem Vertrag sind aufgenommen', () => {
  assert.equal(serverFaelle, Object.keys(goldens.server).length);
  assert.ok(serverFaelle >= 20);
});

// Regelwerk 1 (Altbelege; der Nullbeleg traegt „Betrag: 0,00 €“ statt der
// Prüfangaben). Aufgenommen am Stand 4d71203 mit der 0.x-Option
// `regelwerk: 1`; heute heisst sie `ruleset: 1`.
for (const name of Object.keys(goldens.ruleset1)) {
  test(`Druck-Golden Regelwerk 1 ${name}: byte-gleich`, () => {
    const roh = JSON.parse(readFileSync(new URL(`receipts/${name}.json`, wurzel), 'utf8')) as Fixture;
    const f: Fixture = { ...roh, options: { ...(roh.options ?? {}), ruleset: 1 } };
    const receipt = fromReceiptPayload({ ...f.receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never);
    const layout = buildReceiptLayout(receipt, f.company, f.options ?? {});
    assert.equal(layout.ruleset, 1);
    vergleiche(`Regelwerk 1 ${name}`, layout, goldens.ruleset1[name]);
  });
}

test('Druck-Goldens Regelwerk 1: Nullbelege und Vollbelege dabei', () => {
  const namen1 = Object.keys(goldens.ruleset1);
  assert.ok(namen1.filter((n) => n.startsWith('zero-')).length >= 3);
  assert.ok(namen1.includes('sale-cash') && namen1.includes('signature-outage-sale'));
});

test('Druck-Goldens: die Blatt-Abbildung wirft bei unbekanntem Feld oder unbekannter Art', () => {
  const blatt = { charsPerLine: 32, blocks: [{ kind: 'logo', widthFraction: 0.5, heightLines: 3 }] };
  assert.deepEqual(blattWieAufgenommen(blatt as never), { zeichen: 32, bloecke: [{ art: 'logo', breiteAnteil: 0.5, hoeheZeilen: 3 }] });
  assert.throws(() => blattWieAufgenommen({ ...blatt, neu: 1 } as never), /unbekanntes Feld blatt\.neu/);
  assert.throws(() => blattWieAufgenommen({ charsPerLine: 32, blocks: [{ kind: 'logo', widthFraction: 0.5, heightLines: 3, size: 'M' }] } as never), /block\.size/);
  assert.throws(() => blattWieAufgenommen({ charsPerLine: 32, blocks: [{ kind: 'bild' }] } as never), /kind\.bild/);
});

// Bons der Schicht (1.9.0): Z-Bon, X-Bon und Kassenbewegung aus den Bon-Daten
// des Vertrags (Quellen in fixtures/shift-receipts.json). Aufgenommen mit
// ihrem ersten Stand, neu aufgenommen in 1.11.0 (Art „Wechselgeld“, ohne Fuss
// „Kein Registrierkassenbeleg“); die Ausgaben der Belege oben aendern sie nicht.
const SCHICHT = JSON.parse(readFileSync(new URL('shift-receipts.json', wurzel), 'utf8')) as { receipts: Record<string, { source: string }> };
const KASSE = JSON.parse(readFileSync(new URL('v3/antworten/kasse.json', wurzel), 'utf8')) as {
  endpoints: Record<string, { cases: Array<{ case: string; response: { data?: { receipt?: Record<string, unknown> } } }> }>;
};

test('Druck-Goldens: jeder Bon der Schicht ist aufgenommen, keiner zu viel', () => {
  assert.deepEqual(Object.keys(goldens.shift).sort(), Object.keys(SCHICHT.receipts).sort());
  assert.ok(Object.keys(goldens.shift).length >= 4);
});

for (const [name, { source }] of Object.entries(SCHICHT.receipts)) {
  test(`Druck-Golden Schicht ${name}: ESC/POS, ePOS, Blatt und HTML byte-gleich`, () => {
    const [endpunkt, fall] = source.split('/') as [string, string];
    const bon = KASSE.endpoints[endpunkt]!.cases.find((c) => c.case === fall)!.response.data!.receipt!;
    const layout = bon.kind === 'cash_movement' ? cashMovementLayout(bon as never) : shiftReceiptLayout(bon as never);
    vergleiche(`Schicht ${name}`, layout, goldens.shift[name]);
  });
}
