// Die gemessene hobex-HPS-Codetabelle als Golden-Datei — der Vertrag mit dem
// Dart-Zwilling `kasseneck_api` (`lib/src/hobex_hps/transaction_response.dart`).
//
// Beide Seiten muessen sich einig sein, welcher Ergebniscode eine Aussage
// traegt (`isConclusive`, siehe `src/payments/hobex-hps/transaction-response.ts`)
// und welche Bedeutung er hat -- lief das einmal auseinander, faende der
// eine Zwilling einen Vorgang schluessig, den der andere fuer eine
// Wissensluecke haelt. Ohne diese Datei bemerkte niemand den Unterschied, bis
// eine echte Zahlung falsch eingeordnet wird.
//
// Aufruf: `npm run fixtures:hobex-hps-codes` (bewusst, nie automatisch).
import { readFileSync, writeFileSync } from 'node:fs';
import {
  HPS_MEASURED_CODES,
  TERMINAL_BUSY_HTTP_STATUS,
} from '../dist/esm/payments/hobex-hps/index.js';

const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const vertrag = {
  version: paket.version,
  // Messumgebung, siehe Dart-Zwilling `doc/kartenzahlung.md` -- damit ein
  // spaeterer Widerspruch nicht erst am Terminal auffaellt, sondern schon
  // beim Lesen dieser Datei: welches Geraet, welcher Zeitraum.
  gemessenAn: {
    tid: '3600335',
    hpsVersion: '1.10.0',
    firmware: '7.3.6',
    zeitraum: '26.-28.08.2026',
  },
  codes: HPS_MEASURED_CODES.map(({ code, meaning, conclusive }) => ({ code, meaning, conclusive })),
  terminalBusyHttpStatus: TERMINAL_BUSY_HTTP_STATUS,
};

writeFileSync(
  new URL('../fixtures/hobex-hps-codes.json', import.meta.url),
  JSON.stringify(vertrag, null, 2) + '\n',
);
console.log('hobex-hps-codes geschrieben:', vertrag.codes.length, 'Codes,',
  vertrag.codes.filter((c) => c.conclusive).length, 'davon schluessig');
