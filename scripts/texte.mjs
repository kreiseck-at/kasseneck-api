// Der Katalog der Kassen-Meldungen als Vertragsdatei: was die Browser-Kasse
// und die Kassen-App dem Kassier sagen, genau einmal. Die App zieht diese
// Datei aus dem Tarball und erzeugt daraus ihre Konstanten; das Web importiert
// die Quelle direkt. Aufruf: `npm run fixtures:texte` (bewusst, nie automatisch).
import { readFileSync, writeFileSync } from 'node:fs';
import { RECEIPT_EMAIL_ERROR_MESSAGES, LABELS, ERROR_RULES, ERROR_CODE_RULES, ERROR_OUTCOME_RULES, CALLS_WITH_EFFECT, MESSAGES, CANCELLATION_PAYMENT_ERROR_MESSAGES, RETURN_DISPOSITION_LABELS } from '../dist/esm/pos/texte.js';

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
  // Seit 1.0.0-rc.5: Verfeinerungen je Code und je Ausgang, vor errorRules
  // anzuwenden (findErrorRule); errorRules bleibt eine Regel je Art.
  errorCodeRules: ERROR_CODE_RULES,
  errorOutcomeRules: ERROR_OUTCOME_RULES,
  callsWithEffect: CALLS_WITH_EFFECT,
  receiptEmailErrors: RECEIPT_EMAIL_ERROR_MESSAGES,
  cancellationPaymentErrors: CANCELLATION_PAYMENT_ERROR_MESSAGES,
  // Knoepfe und Zeilennamen, keine Saetze, darum nicht unter `messages`.
  labels: LABELS,
  // Seit 1.3.0: Rueckgabe-Wahl beim Storno -> Beschriftung (Schluessel in `labels`).
  returnDispositionLabels: RETURN_DISPOSITION_LABELS,
};
writeFileSync(new URL('../fixtures/pos-texts.json', import.meta.url), JSON.stringify(vertrag, null, 2) + '\n');
console.log('Kassen-Texte geschrieben:', Object.keys(MESSAGES).length, 'Meldungen,', ERROR_RULES.length, 'Regeln,', ERROR_CODE_RULES.length + ERROR_OUTCOME_RULES.length, 'Verfeinerungen,',
  Object.keys(RECEIPT_EMAIL_ERROR_MESSAGES).length, 'Mail-Fehlercodes,', Object.keys(CANCELLATION_PAYMENT_ERROR_MESSAGES).length, 'Storno-Zahlungscodes,',
  Object.keys(LABELS).length, 'Beschriftungen,', Object.keys(RETURN_DISPOSITION_LABELS).length, 'Rueckgabe-Wahlen');
