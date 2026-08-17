import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KeckPaymentMethod, ReceiptType, VatRate, VoucherAction, VoucherType } from '../src/enums/index.js';
import type { Receipt, ReceiptCompany } from '../src/models/index.js';
import {
  buildReceiptLayout,
  formatCents,
  escPosLayoutBytes,
  type LayoutLine,
  type ReceiptLayout,
  SMALL_BUSINESS_NOTICE,
} from '../src/receipt/index.js';
import { isKasseneckValidationError } from '../src/client/errors.js';

/**
 * Das Beleg-Layout ist der Bauplan eines Kasseneck-Belegs: welche Angabe steht
 * in welcher Reihenfolge, wie ausgerichtet, in welchen Spalten. Die
 * Erwartungen hier sind aus dem Flutter-Vorbild
 * `kasseneck_api/lib/models/print_paper.dart` (`setKeckReceipt`, ab Zeile 210)
 * abgeschrieben — nicht aus dieser Umsetzung abgeleitet.
 *
 * Alle Geldbetraege sind ganzzahlige Cent; die Erwartungswerte der
 * USt-Aufteilung wurden gerechnet **und** nachgemessen (siehe Kommentar an der
 * jeweiligen Stelle), nicht im Kopf ueberschlagen.
 */

// ------------------------------------------------------------------ Vorlagen

const FIRMA: ReceiptCompany = {
  companyName: 'Café Kreiseck',
  street: 'Hauptstraße 5',
  zip: '1010',
  city: 'Wien',
  phone: '+43 1 1234567',
  uid: 'ATU12345678',
  taxnr: '12-345/6789',
  isSmallBusiness: false,
  footer1: 'Vielen Dank für Ihren Einkauf',
  footer2: 'www.kreiseck.com',
  thanksMessage: ['Bis bald!'],
  showKreiseckLogo: false,
};

const QR_INHALT =
  '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-13T00:30:00_5,00_2,70_0,00_0,00_0,00_UMSATZ_VORGAENGER_6F0404F0_SIGNATUR';

const BELEG: Receipt = {
  receiptId: 'AT0-KASSE1-42',
  cashregisterId: 'KASSE1',
  // Wiener Wanduhrzeit ohne Offset, wie das Backend sie liefert. Bewusst kurz
  // nach Mitternacht: eine Deutung ueber die Rechnerzeitzone verschoebe hier
  // in zwei der drei Test-Zeitzonen den Kalendertag.
  timeStamp: '2026-08-13T00:30:00',
  items: [
    { name: 'Espresso', quantity: 2, vat: VatRate.vat20, priceCents: 250 },
    { name: 'Semmel', quantity: 3, vat: VatRate.vat10, priceCents: 90 },
  ],
  vouchers: [],
  paymentMethod: KeckPaymentMethod.cash,
  turnoverCounterAES256ICM: 'UMSATZ',
  signaturePreviousReceipt: 'VORGAENGER',
  certificateSerialNumber: '6F0404F0',
  receiptType: ReceiptType.standard,
  sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.SIGNATURWERT',
  qr: QR_INHALT,
  fullReceiptId: 'VOLLBELEGNUMMER',
  customerDetails: ['Musterfirma GmbH', 'Hauptstraße 1'],
  legalMessage: ['Reverse Charge'],
};

// --------------------------------------------------------------- Lesehelfer

/** Alle Textzeilen (ohne Spaltenzeilen). */
function textZeilen(layout: ReceiptLayout): string[] {
  return layout.lines.filter((z): z is Extract<LayoutLine, { kind: 'text' }> => z.kind === 'text').map((z) => z.text);
}

/** Alle Spaltenzeilen als Feld ihrer Spaltentexte. */
function spaltenZeilen(layout: ReceiptLayout): string[][] {
  return layout.lines
    .filter((z): z is Extract<LayoutLine, { kind: 'columns' }> => z.kind === 'columns')
    .map((z) => z.columns.map((s) => s.text));
}

/** Jede Zeile als eine Zeichenkette — fuer Reihenfolge- und Enthaltensein-Pruefungen. */
function alsText(layout: ReceiptLayout): string[] {
  return layout.lines.map((zeile) => {
    switch (zeile.kind) {
      case 'text':
        return zeile.text;
      case 'columns':
        return zeile.columns.map((s) => s.text).join(' ');
      case 'rule':
        return `<rule ${zeile.char}>`;
      case 'space':
        return `<space ${zeile.lines}>`;
      case 'qr':
        return `<qr ${zeile.data}>`;
      case 'banner':
        return `<banner ${zeile.text}>`;
    }
  });
}

/** Erste Spaltenzeile, deren erste Spalte [beschriftung] ist. */
function zeileMitBeschriftung(layout: ReceiptLayout, beschriftung: string): string[] {
  const treffer = spaltenZeilen(layout).find((spalten) => spalten[0] === beschriftung);
  assert.ok(treffer, `Zeile "${beschriftung}" fehlt im Layout`);
  return treffer;
}

/** Position der ersten Zeile, die [teil] enthaelt. */
function stelleVon(layout: ReceiptLayout, teil: string): number {
  const stelle = alsText(layout).findIndex((zeile) => zeile.includes(teil));
  assert.notEqual(stelle, -1, `"${teil}" steht nirgends im Layout`);
  return stelle;
}

// ------------------------------------------------------------- Pflichtangaben

test('Layout: der Belegkopf traegt Unternehmen, Anschrift, Steuernummer und Telefon', () => {
  const layout = buildReceiptLayout(BELEG, FIRMA);
  const texte = textZeilen(layout);

  assert.equal(texte[0], 'Café Kreiseck');
  assert.equal(texte[1], 'Hauptstraße 5');
  assert.equal(texte[2], '1010 Wien');
  // taxInfo im Vorbild: UID, wenn vorhanden — sonst die Steuernummer.
  assert.equal(texte[3], 'ATU12345678');
  assert.equal(texte[4], '+43 1 1234567');

  const kopf = layout.lines[0];
  assert.equal(kopf?.kind, 'text');
  assert.equal(kopf.kind === 'text' ? kopf.align : null, 'center');
  assert.equal(kopf.kind === 'text' ? kopf.bold : null, true);
});

test('Layout: ohne UID steht die Steuernummer im Kopf', () => {
  const ohneUid: ReceiptCompany = { ...FIRMA, uid: '' };
  assert.equal(textZeilen(buildReceiptLayout(BELEG, ohneUid))[3], '12-345/6789');
});

test('Layout: Belegnummer, Kassennummer und Belegzeit stehen als beschriftete Zeilen', () => {
  const layout = buildReceiptLayout(BELEG, FIRMA);

  // Wiener Wanduhrzeit — in allen drei Test-Zeitzonen derselbe Wert.
  assert.deepEqual(zeileMitBeschriftung(layout, 'Datum:'), ['Datum:', '13.08.2026 00:30:00']);
  assert.deepEqual(zeileMitBeschriftung(layout, 'Kassen-ID:'), ['Kassen-ID:', 'KASSE1']);
  assert.deepEqual(zeileMitBeschriftung(layout, 'Beleg-ID:'), ['Beleg-ID:', 'AT0-KASSE1-42']);
});

test('Layout: die Belegzeit stammt aus der Wiener Zeitdeutung, nicht aus new Date(...)', () => {
  // Zeitstempel mit Zonenangabe: 21:30 UTC im August sind 23:30 in Wien
  // (Sommerzeit). Wer den Zeitstempel ueber die Rechnerzeitzone deutet,
  // bekommt in UTC 21:30 und in Pacific/Kiritimati den naechsten Tag.
  const beleg: Receipt = { ...BELEG, timeStamp: '2026-08-12T21:30:00Z' };
  assert.deepEqual(zeileMitBeschriftung(buildReceiptLayout(beleg, FIRMA), 'Datum:'), [
    'Datum:',
    '12.08.2026 23:30:00',
  ]);
});

test('Layout: Kundendaten stehen unter dem Belegkopf', () => {
  const layout = buildReceiptLayout(BELEG, FIRMA);
  assert.deepEqual(zeileMitBeschriftung(layout, 'Kunde:'), ['Kunde:', 'Musterfirma GmbH']);
  // Folgezeilen ohne Beschriftung, aber mit dem naechsten Kundendatum.
  const folge = spaltenZeilen(layout).find((spalten) => spalten[1] === 'Hauptstraße 1');
  assert.deepEqual(folge, ['', 'Hauptstraße 1']);
});

test('Layout: jede Position zeigt Menge und Bezeichnung, rechts Summe und Steuerkategorie', () => {
  const layout = buildReceiptLayout(BELEG, FIRMA);
  const spalten = spaltenZeilen(layout);

  // Vorbild: Menge auf zwei Zeichen aufgefuellt, dann ' x ', dann der Name;
  // ab Menge 2 zusaetzlich der Einzelpreis.
  const espresso = spalten.find((s) => (s[0] ?? '').includes('Espresso'));
  assert.deepEqual(espresso, ['2  x Espresso je 2,50', '5,00 A']);

  const semmel = spalten.find((s) => (s[0] ?? '').includes('Semmel'));
  assert.deepEqual(semmel, ['3  x Semmel je 0,90', '2,70 B']);
});

test('Layout: bei Menge 1 steht kein Einzelpreis in der Positionszeile', () => {
  const beleg: Receipt = { ...BELEG, items: [{ name: 'Melange', quantity: 1, vat: VatRate.vat20, priceCents: 420 }] };
  const espresso = spaltenZeilen(buildReceiptLayout(beleg, FIRMA)).find((s) => (s[0] ?? '').includes('Melange'));
  assert.deepEqual(espresso, ['1  x Melange', '4,20 A']);
});

test('Layout: die USt-Aufteilung fuehrt Kopfzeile, Kategorie, Satz, MwSt, Netto und Brutto', () => {
  const layout = buildReceiptLayout(BELEG, FIRMA);
  const spalten = spaltenZeilen(layout);

  assert.ok(
    spalten.some((s) => s[0] === 'MwSt%' && s[1] === 'MwSt' && s[2] === 'Netto' && s[3] === 'Brutto'),
    'Kopfzeile der USt-Tabelle fehlt',
  );

  // Nachgemessen (node -e): 20 % auf 500 Cent brutto -> netto 417, MwSt 83;
  // 10 % auf 270 Cent brutto -> netto 245, MwSt 25.
  assert.deepEqual(
    spalten.find((s) => s[0] === 'A 20%'),
    ['A 20%', '0,83', '4,17', '5,00'],
  );
  assert.deepEqual(
    spalten.find((s) => s[0] === 'B 10%'),
    ['B 10%', '0,25', '2,45', '2,70'],
  );
});

test('Layout: Gesamtsumme und Zahlungsart stehen unter der USt-Aufteilung', () => {
  const layout = buildReceiptLayout(BELEG, FIRMA);
  assert.deepEqual(zeileMitBeschriftung(layout, 'Gesamt:'), ['Gesamt:', '7,70 €']);
  assert.deepEqual(zeileMitBeschriftung(layout, 'Zahlungsart:'), ['Zahlungsart:', 'Barzahlung']);
  assert.ok(stelleVon(layout, 'Gesamt:') > stelleVon(layout, 'MwSt%'));
});

test('Layout: unbekannte Zahlungsart aus einer Serverantwort steht roh auf dem Beleg', () => {
  // Der Server darf eine Zahlungsart kennen, die dieses Paket noch nicht hat —
  // dann steht ihr Schluessel da, statt dass der Beleg gar nicht baut.
  const beleg: Receipt = { ...BELEG, paymentMethod: 'kryptowaehrung' };
  assert.deepEqual(zeileMitBeschriftung(buildReceiptLayout(beleg, FIRMA), 'Zahlungsart:'), [
    'Zahlungsart:',
    'kryptowaehrung',
  ]);
});

test('Layout: der RKSV-QR-Code steht als eigene Zeile im Layout', () => {
  const layout = buildReceiptLayout(BELEG, FIRMA);
  const qr = layout.lines.filter((z) => z.kind === 'qr');
  assert.equal(qr.length, 1, 'genau eine QR-Zeile erwartet');
  assert.equal(qr[0]?.kind === 'qr' ? qr[0].data : null, QR_INHALT);
  // Nach RKSV steht der QR unter dem Beleginhalt, vor den Fusszeilen.
  assert.ok(stelleVon(layout, '<qr ') > stelleVon(layout, 'Gesamt:'));
  assert.ok(stelleVon(layout, '<qr ') < stelleVon(layout, 'www.kreiseck.com'));
});

test('Layout: Rechtshinweise, Dankestext und Fusszeilen stehen am Belegende', () => {
  const layout = buildReceiptLayout(BELEG, FIRMA);
  const texte = textZeilen(layout);
  assert.ok(texte.includes('Reverse Charge'));
  assert.ok(texte.includes('Bis bald!'));
  assert.equal(texte.at(-2), 'Vielen Dank für Ihren Einkauf');
  assert.equal(texte.at(-1), 'www.kreiseck.com');
});

test('Layout: dritte und vierte Fusszeile erscheinen nur, wenn sie gesetzt sind', () => {
  const ohne = textZeilen(buildReceiptLayout(BELEG, FIRMA));
  assert.equal(ohne.filter((z) => z === 'Zusatzzeile').length, 0);

  const mit = textZeilen(buildReceiptLayout(BELEG, { ...FIRMA, footer3: 'Zusatzzeile', footer4: 'Noch eine' }));
  assert.equal(mit.at(-2), 'Zusatzzeile');
  assert.equal(mit.at(-1), 'Noch eine');
});

test('Layout: ein Beleg ohne gueltige Signatur traegt den Ausfallhinweis', () => {
  // Das Backend legt bei ausgefallener Signatureinheit den base64url-kodierten
  // Text 'Sicherheitseinrichtung ausgefallen' als dritten JWS-Teil ab.
  const ausgefallen = 'eyJhbGciOiJFUzI1NiJ9.QVQx.U2ljaGVyaGVpdHNlaW5yaWNodHVuZyBhdXNnZWZhbGxlbg';
  const beleg: Receipt = { ...BELEG, sig: ausgefallen };
  assert.ok(textZeilen(buildReceiptLayout(beleg, FIRMA)).includes('Sicherheitseinrichtung ausgefallen'));
  // Der gute Beleg darf ihn nicht tragen.
  assert.ok(!textZeilen(buildReceiptLayout(BELEG, FIRMA)).includes('Sicherheitseinrichtung ausgefallen'));
});

test('Layout: ein Kleinunternehmer-Beleg traegt den Hinweis auf die Steuerbefreiung', () => {
  // Wortlaut aus dem Backend (functions/index.js, INVOICE_TAX_NOTE.smallBusiness).
  // Ohne den Hinweis stuende in der USt-Tabelle "D 0%" ohne jede Begruendung.
  const hinweis = 'Umsatzsteuerbefreit – Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG.';
  const firma: ReceiptCompany = { ...FIRMA, isSmallBusiness: true, uid: '' };
  const layout = buildReceiptLayout(BELEG, firma);

  assert.ok(textZeilen(layout).includes(hinweis), 'Kleinunternehmer-Hinweis fehlt');
  // Er steht bei den uebrigen Rechtshinweisen, nach den Summen und vor dem QR.
  assert.ok(stelleVon(layout, hinweis) > stelleVon(layout, 'Gesamt:'));
  assert.ok(stelleVon(layout, hinweis) < stelleVon(layout, 'Reverse Charge'));
  assert.ok(stelleVon(layout, hinweis) < stelleVon(layout, '<qr '));

  // Wer keiner ist, bekommt ihn nicht.
  assert.ok(!textZeilen(buildReceiptLayout(BELEG, FIRMA)).includes(hinweis));
});

test('Layout: der Kleinunternehmer-Hinweis steht auch ohne weitere Rechtshinweise', () => {
  const firma: ReceiptCompany = { ...FIRMA, isSmallBusiness: true };
  const beleg: Receipt = { ...BELEG, legalMessage: [] };
  assert.ok(
    textZeilen(buildReceiptLayout(beleg, firma)).includes(
      'Umsatzsteuerbefreit – Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG.',
    ),
  );
});

// ------------------------------------------------------------------ Betraege

test('Betraege: Cent werden mit Komma und zwei Stellen ausgegeben', () => {
  assert.equal(formatCents(0), '0,00');
  assert.equal(formatCents(5), '0,05');
  assert.equal(formatCents(770), '7,70');
  assert.equal(formatCents(9999), '99,99');
  assert.equal(formatCents(-1999), '-19,99');
  assert.equal(formatCents(123456789), '1234567,89');
});

test('Betraege: mehrere Steuersaetze behalten ihre Summen', () => {
  const beleg: Receipt = {
    ...BELEG,
    items: [
      { name: 'Wein', quantity: 1, vat: VatRate.vat20, priceCents: 1999 },
      { name: 'Milch', quantity: 2, vat: VatRate.vat10, priceCents: 149 },
      { name: 'Brot', quantity: 3, vat: VatRate.vat4komma9, priceCents: 333 },
      { name: 'Buch', quantity: 1, vat: VatRate.vat0, priceCents: 1000 },
    ],
  };
  const layout = buildReceiptLayout(beleg, FIRMA);
  const spalten = spaltenZeilen(layout);

  // Nachgemessen: 1999 + 298 + 999 + 1000 = 4296 Cent.
  assert.deepEqual(zeileMitBeschriftung(layout, 'Gesamt:'), ['Gesamt:', '42,96 €']);

  const tabelle = spalten.filter((s) => /^[A-G] /.test(s[0] ?? ''));
  assert.equal(tabelle.length, 4, 'vier Steuersaetze erwartet');

  // Die Brutto-Spalte der Tabelle muss die Gesamtsumme ergeben, und je Zeile
  // muessen Netto und MwSt zusammen wieder den Brutto-Wert ergeben.
  const alsCent = (betrag: string): number => Math.round(Number(betrag.replace(',', '.')) * 100);
  let bruttoSumme = 0;
  for (const zeile of tabelle) {
    const [, mwst, netto, brutto] = zeile as [string, string, string, string];
    assert.equal(alsCent(netto) + alsCent(mwst), alsCent(brutto), `Zeile ${zeile[0]} geht nicht auf`);
    bruttoSumme += alsCent(brutto);
  }
  assert.equal(bruttoSumme, 4296);
});

/** Die Zeilen der USt-Tabelle (ohne Kopfzeile) als Cent-Werte je Spalte. */
function tabelleInCent(layout: ReceiptLayout): number[][] {
  return spaltenZeilen(layout)
    .filter((s) => /^[A-G?] /.test(s[0] ?? ''))
    .map((s) => s.slice(1).map((betrag) => Math.round(Number(betrag.replace(',', '.')) * 100)));
}

function belegMitPreis(preisCents: number, menge = 1): Receipt {
  return { ...BELEG, items: [{ name: 'Position', quantity: menge, vat: VatRate.vat20, priceCents: preisCents }] };
}

test('Betraege: der Stornobeleg spiegelt die USt-Aufteilung des Belegs', () => {
  // 99 Cent zu 20 %: das Netto liegt bei genau 82,5 Cent — hier entscheidet
  // die Rundungsrichtung. Nachgemessen: Netto 83, MwSt 16.
  const verkauf = buildReceiptLayout(belegMitPreis(33, 3), FIRMA);
  const storno = buildReceiptLayout(belegMitPreis(-33, 3), FIRMA);
  assert.deepEqual(
    spaltenZeilen(verkauf).find((s) => s[0] === 'A 20%'),
    ['A 20%', '0,16', '0,83', '0,99'],
  );
  assert.deepEqual(
    spaltenZeilen(storno).find((s) => s[0] === 'A 20%'),
    ['A 20%', '-0,16', '-0,83', '-0,99'],
  );
});

test('Betraege: Beleg und Storno heben sich in jeder Spalte der USt-Tabelle auf', () => {
  // Der Rundungsfehler trifft nur Betraege, deren Netto genau auf einem halben
  // Cent liegt — bei 20 % jeden sechsten. Ein einzelner Beispielwert wuerde
  // ihn also meistens verfehlen; deshalb eine Schleife.
  const schief: string[] = [];
  for (let cents = 1; cents <= 600; cents++) {
    const verkauf = tabelleInCent(buildReceiptLayout(belegMitPreis(cents), FIRMA));
    const storno = tabelleInCent(buildReceiptLayout(belegMitPreis(-cents), FIRMA));
    assert.equal(verkauf.length, 1);
    assert.equal(storno.length, 1);
    const links = verkauf[0] as number[];
    const rechts = storno[0] as number[];
    if (links.some((wert, i) => wert + (rechts[i] as number) !== 0)) {
      schief.push(`${cents} Cent: ${links.join('/')} gegen ${rechts.join('/')}`);
    }
  }
  assert.deepEqual(schief.slice(0, 5), [], `${schief.length} Betraege gehen zwischen Beleg und Storno nicht auf`);
});

test('Betraege: ein eingeloester Promo-Gutschein mindert die USt-Aufteilung anteilig', () => {
  const beleg: Receipt = {
    ...BELEG,
    items: [
      { name: 'Wein', quantity: 1, vat: VatRate.vat20, priceCents: 2000 },
      { name: 'Milch', quantity: 1, vat: VatRate.vat10, priceCents: 1000 },
    ],
    vouchers: [{ name: 'Aktion', action: VoucherAction.redeem, type: VoucherType.promo, valueCents: 300 }],
  };
  const layout = buildReceiptLayout(beleg, FIRMA);
  const spalten = spaltenZeilen(layout);

  // Nachgemessen: 300 Cent auf 3000 Cent Umsatz -> 20 %: 300*2000~/3000 = 200,
  // 10 %: 300*1000~/3000 = 100. Bleiben 1800 bzw. 900 Cent brutto.
  assert.equal(spalten.find((s) => s[0] === 'A 20%')?.[3], '18,00');
  assert.equal(spalten.find((s) => s[0] === 'B 10%')?.[3], '9,00');
  assert.deepEqual(zeileMitBeschriftung(layout, 'Gesamt:'), ['Gesamt:', '27,00 €']);
  // Der Gutschein selbst steht als eigene Zeile auf dem Beleg — mit dem
  // Belegtext des Vorbilds (Gutscheinart, Wert, Name).
  assert.ok(
    spalten.some((s) => s[0] === 'Promotionsgutschein 3 € - Aktion' && s[1] === '-3,00 €'),
    'Gutscheinzeile fehlt',
  );
});

test('Betraege: ein eingeloester Wertgutschein erzeugt eine Zwischensumme', () => {
  const beleg: Receipt = {
    ...BELEG,
    vouchers: [{ name: 'Geschenkgutschein', action: VoucherAction.redeem, type: VoucherType.value, valueCents: 500 }],
  };
  const layout = buildReceiptLayout(beleg, FIRMA);
  // Zwischensumme 7,70 €, abzueglich 5,00 € Gutschein -> Gesamt 2,70 €.
  assert.deepEqual(zeileMitBeschriftung(layout, 'Zwischensumme'), ['Zwischensumme', '7,70 €']);
  assert.ok(
    spaltenZeilen(layout).some((s) => s[0] === 'Wertgutschein 5 € - Geschenkgutschein' && s[1] === '-5,00 €'),
    'Gutscheinzeile fehlt',
  );
  assert.deepEqual(zeileMitBeschriftung(layout, 'Gesamt:'), ['Gesamt:', '2,70 €']);
});

test('Betraege: ein verkaufter Wertgutschein steht als Position mit 0 % Umsatzsteuer', () => {
  const beleg: Receipt = {
    ...BELEG,
    items: [],
    vouchers: [{ name: 'Geschenkgutschein', action: VoucherAction.sell, type: VoucherType.value, valueCents: 5000 }],
  };
  const layout = buildReceiptLayout(beleg, FIRMA);
  assert.ok(
    spaltenZeilen(layout).some((s) => s[0] === '1  x Wertgutschein 50 € - Geschenkgutschein' && s[1] === '50,00 D'),
    'Positionszeile des verkauften Gutscheins fehlt',
  );
  assert.deepEqual(zeileMitBeschriftung(layout, 'Gesamt:'), ['Gesamt:', '50,00 €']);
  assert.equal(spaltenZeilen(layout).find((s) => s[0] === 'D 0%')?.[3], '50,00');
});

test('Layout: ein Nullbeleg ohne Positionen baut trotzdem — reduziert, mit QR und Betrag 0 (Regelwerk 1)', () => {
  const beleg: Receipt = {
    ...BELEG,
    receiptType: ReceiptType.zero,
    items: [],
    customerDetails: [],
    legalMessage: [],
  };
  const layout = buildReceiptLayout(beleg, FIRMA);
  assert.ok(textZeilen(layout).includes('Betrag: 0,00 €'));
  assert.equal(layout.lines.filter((z) => z.kind === 'qr').length, 1);
  // Reduziert: keine Gesamt-/Zahlungsart-Zeile, keine Fusszeilen (siehe layout-belegart.test)
  assert.equal(spaltenZeilen(layout).some((s) => s[0] === 'Gesamt:'), false);
});

test('Layout: ein unbekannter Steuersatz verhindert den Beleg nicht', () => {
  // Ein Beleg mit einem Satz, den dieses Paket noch nicht kennt (rohe Zahl aus
  // der Nutzlast). Er muss angezeigt werden koennen — der Beleg ist bereits
  // ausgestellt und signiert.
  const beleg: Receipt = { ...BELEG, items: [{ name: 'Sondersatz', quantity: 1, vat: 7, priceCents: 107 }] };
  const layout = buildReceiptLayout(beleg, FIRMA);
  assert.ok(spaltenZeilen(layout).some((s) => (s[0] ?? '').includes('Sondersatz')));
  assert.deepEqual(zeileMitBeschriftung(layout, 'Gesamt:'), ['Gesamt:', '1,07 €']);
});

// ------------------------------------------------------- Bruecke zu ESC/POS

/** Sucht eine Zeichenfolge (Latin-1) in einem Bytestrom. */
function enthaeltText(bytes: Uint8Array, text: string): boolean {
  const gesucht = Array.from(text, (z) => z.charCodeAt(0));
  for (let i = 0; i + gesucht.length <= bytes.length; i++) {
    let treffer = true;
    for (let k = 0; k < gesucht.length; k++) {
      if (bytes[i + k] !== gesucht[k]) {
        treffer = false;
        break;
      }
    }
    if (treffer) return true;
  }
  return false;
}

test('ESC/POS: ein Artikelname mit "€" druckt durch — das Layout fuehrt das Zeichen, die Ausgabe ersetzt es', () => {
  // Kurzer Name mit Absicht: eine Spalte, die nicht in ihre Breite passt,
  // laeuft in eine Folgezeile — der Bytestrom traegt den Text dann geteilt.
  const beleg: Receipt = {
    ...BELEG,
    items: [{ name: '€-Kaffee', quantity: 1, vat: VatRate.vat20, priceCents: 300 }],
  };
  const layout = buildReceiptLayout(beleg, FIRMA);

  // Auf dem Bildschirm steht das echte Zeichen.
  assert.ok(
    spaltenZeilen(layout).some((s) => (s[0] ?? '').includes('€-Kaffee')),
    'das Layout muss das Euro-Zeichen tragen',
  );

  // Der Bondrucker kann nur eine Ein-Byte-Codepage: ohne Ersetzung wuerfe die
  // Kodierung und der gesamte Ausdruck fiele aus.
  const bytes = escPosLayoutBytes(layout);
  assert.ok(enthaeltText(bytes, 'EUR-Kaffee'), 'Ersetzung fehlt im Bytestrom');
  assert.ok(!enthaeltText(bytes, '?-Kaffee'));
});

test('ESC/POS: die Gesamtsumme steht im Bytestrom mit EUR statt mit dem Zeichen', () => {
  const bytes = escPosLayoutBytes(buildReceiptLayout(BELEG, FIRMA));
  assert.ok(enthaeltText(bytes, '7,70 EUR'));
});

test('ESC/POS: der Kleinunternehmer-Hinweis druckt durch — der Gedankenstrich wird ersetzt', () => {
  // Der Wortlaut des Backends traegt einen Gedankenstrich (U+2013). Der liegt
  // ausserhalb von Latin-1: ohne die Ersetzung aus Task 6 wuerfe die Kodierung
  // und der gesamte Beleg fiele aus — wegen eines Strichs.
  const layout = buildReceiptLayout(BELEG, { ...FIRMA, isSmallBusiness: true });
  assert.ok(
    textZeilen(layout).some((z) => z.includes('–')),
    'im Layout muss der Gedankenstrich stehen bleiben',
  );
  const bytes = escPosLayoutBytes(layout);
  assert.ok(
    enthaeltText(bytes, 'Umsatzsteuerbefreit - Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG.'),
    'Hinweis fehlt im Bytestrom',
  );
});

test('ESC/POS: Umlaute bleiben erhalten und werden als ein Byte kodiert', () => {
  const bytes = escPosLayoutBytes(buildReceiptLayout(BELEG, FIRMA));
  // 'Café Kreiseck' — das é ist 0xE9 in Latin-1/CP1252, ein einziges Byte.
  assert.ok(enthaeltText(bytes, 'Café Kreiseck'));
});

test('ESC/POS: der Bytestrom traegt Vorspann, QR-Inhalt und Schnitt', () => {
  const bytes = escPosLayoutBytes(buildReceiptLayout(BELEG, FIRMA));
  // Vorspann wie im Vorbild: ESC @ (Init) und ESC t 16 (CP1252).
  assert.deepEqual(Array.from(bytes.slice(0, 5)), [27, 64, 27, 116, 16]);
  assert.ok(enthaeltText(bytes, QR_INHALT), 'QR-Inhalt fehlt im Bytestrom');
  // GS V 0 — voller Schnitt am Ende.
  assert.deepEqual(Array.from(bytes.slice(-3)), [29, 86, 48]);
});

test('ESC/POS: ohne Schnitt endet der Strom mit dem Belegtext', () => {
  const bytes = escPosLayoutBytes(buildReceiptLayout(BELEG, FIRMA), { cut: false });
  assert.notDeepEqual(Array.from(bytes.slice(-3)), [29, 86, 48]);
});

test('ESC/POS: die 80-mm-Rolle nutzt die breitere USt-Tabelle', () => {
  // Im Vorbild haengen die Spaltenbreiten der USt-Tabelle am Papierformat.
  const schmal = buildReceiptLayout(BELEG, FIRMA);
  const breit = buildReceiptLayout(BELEG, FIRMA, { paperSize: 'mm80' });
  const breiten = (layout: ReceiptLayout): number[] => {
    const kopf = layout.lines.find((z) => z.kind === 'columns' && z.columns[0]?.text === 'MwSt%');
    assert.ok(kopf?.kind === 'columns');
    return kopf.columns.map((s) => s.width);
  };
  assert.deepEqual(breiten(schmal), [3, 3, 3, 3]);
  assert.deepEqual(breiten(breit), [3, 4, 3, 2]);
  // Und beide Formate ergeben einen druckbaren Strom.
  assert.ok(escPosLayoutBytes(breit, { paperSize: 'mm80' }).length > 0);
});

test('ESC/POS: jede Spaltenzeile des Layouts belegt zusammen zwoelf Zwoelftel', () => {
  // Der Erzeuger wirft, wenn die Breiten einer Zeile nicht 12 ergeben — dieser
  // Test faengt eine kaputte Zeile schon im Layout ab, mit klarer Meldung.
  for (const zeile of buildReceiptLayout(BELEG, FIRMA).lines) {
    if (zeile.kind !== 'columns') continue;
    const summe = zeile.columns.reduce((acc, s) => acc + s.width, 0);
    assert.equal(summe, 12, `Zeile "${zeile.columns.map((s) => s.text).join('|')}" ergibt ${summe}`);
  }
});

// ------------------------------------------------- Fehler-Union des Layouts

/**
 * `errors.ts` sagt zu: "Alle Fehler, die dieses Paket wirft". Diese Zusage muss
 * auch fuer das Layout gelten — ein Verbraucher, der nach den Waechtern
 * verzweigt (`isKasseneckValidationError` & Co.), darf hier nicht in den
 * "unbekannt"-Zweig fallen.
 */
test('Layout: ein unlesbarer Belegzeitstempel kommt als KasseneckValidationError', () => {
  const beleg: Receipt = { ...BELEG, timeStamp: 'gestern frueh' };
  assert.throws(
    () => buildReceiptLayout(beleg, FIRMA),
    (fehler: unknown) => {
      assert.ok(isKasseneckValidationError(fehler), `erwartet KasseneckValidationError, bekam ${String(fehler)}`);
      assert.equal(fehler.scope, 'response');
      // Der Zeitstempel stammt aus einer fremden Antwort und gehoert nicht in
      // die Meldung — dieselbe Zusage wie bei getFirstReceiptDate.
      assert.ok(!fehler.message.includes('gestern frueh'), 'der rohe Zeitstempel darf nicht in der Meldung stehen');
      return true;
    },
  );
});

test('Layout: eine fehlende Zahlungsart laesst sich anzeigen, statt zu werfen', () => {
  // Start- und Nullbelege tragen keine Zahlungsart; das Backend sendet dann
  // `paymentMethod: null`, und `typeof null === 'object'` machte daraus einen
  // nackten TypeError beim Lesen von `.label`.
  const beleg = { ...BELEG, paymentMethod: null } as unknown as Receipt;
  const layout = buildReceiptLayout(beleg, FIRMA);
  const zeile = layout.lines.find((z) => z.kind === 'columns' && z.columns[0]?.text === 'Zahlungsart:');
  assert.ok(zeile?.kind === 'columns');
  assert.equal(zeile.columns[1]?.text, '');
});

test('Layout: eine unbekannte Zahlungsart steht weiterhin roh da', () => {
  const beleg = { ...BELEG, paymentMethod: 'klarna' } as unknown as Receipt;
  const layout = buildReceiptLayout(beleg, FIRMA);
  const zeile = layout.lines.find((z) => z.kind === 'columns' && z.columns[0]?.text === 'Zahlungsart:');
  assert.ok(zeile?.kind === 'columns');
  assert.equal(zeile.columns[1]?.text, 'klarna');
});

test('Layout: der Kleinunternehmer-Hinweis ist als Konstante zugaenglich', () => {
  // Der Wortlaut steht woertlich im Backend (INVOICE_TAX_NOTE.smallBusiness);
  // eine Kassenoberflaeche, die ihn vorab anzeigen will, soll ihn nicht
  // abschreiben muessen.
  assert.equal(SMALL_BUSINESS_NOTICE, 'Umsatzsteuerbefreit – Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG.');
  const layout = buildReceiptLayout(BELEG, { ...FIRMA, isSmallBusiness: true });
  assert.ok(textZeilen(layout).includes(SMALL_BUSINESS_NOTICE));
});
