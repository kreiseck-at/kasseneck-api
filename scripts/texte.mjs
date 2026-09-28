// Der Katalog der Kassen-Meldungen als Vertragsdatei: was die Browser-Kasse
// und die Kassen-App dem Kassier sagen, genau einmal. Die App zieht diese
// Datei aus dem Tarball und erzeugt daraus ihre Konstanten; das Web importiert
// die Quelle direkt. Aufruf: `npm run fixtures:texte` (bewusst, nie automatisch).
import { readFileSync, writeFileSync } from 'node:fs';
import { RECEIPT_EMAIL_ERROR_MESSAGES, LABELS, ERROR_RULES, MESSAGES, CANCELLATION_PAYMENT_ERROR_MESSAGES } from '../dist/esm/pos/texte.js';

const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Die Zuordnung `code` -> Satz steht mit in der Datei: die App liest sie aus
// dem Tarball und entscheidet damit am Code dasselbe wie das Web, das die
// Quelle direkt importiert.
// Strukturschluessel englisch seit 1.0 (unter 0.x: meldungen, fehlerregeln,
// belegMailFehler, stornoZahlungFehler, beschriftungen; Tabelle in
// fixtures/renames-1.0.json, Abschnitt `structure`).
const vertrag = {
  version: paket.version,
  messages: MESSAGES,
  errorRules: ERROR_RULES,
  receiptEmailErrors: RECEIPT_EMAIL_ERROR_MESSAGES,
  cancellationPaymentErrors: CANCELLATION_PAYMENT_ERROR_MESSAGES,
  // Knoepfe und Zeilennamen, keine Saetze, darum nicht unter `messages`.
  labels: LABELS,
};
writeFileSync(new URL('../fixtures/pos-texts.json', import.meta.url), JSON.stringify(vertrag, null, 2) + '\n');
console.log('Kassen-Texte geschrieben:', Object.keys(MESSAGES).length, 'Meldungen,', ERROR_RULES.length, 'Regeln,',
  Object.keys(RECEIPT_EMAIL_ERROR_MESSAGES).length, 'Mail-Fehlercodes,', Object.keys(CANCELLATION_PAYMENT_ERROR_MESSAGES).length, 'Storno-Zahlungscodes,',
  Object.keys(LABELS).length, 'Beschriftungen');
