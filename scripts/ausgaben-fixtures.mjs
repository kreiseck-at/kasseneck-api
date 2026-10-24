// Gemeinsame Prueffaelle der Beleg-Ausgaben fuer den Dart-Zwilling:
//   outputs  - roh gelesenes `data.outputs` aus getReceipt -> erwartete Liste
//              (nachsichtig, receiptOutputsFromWire) und je Eintrag die
//              Beschriftung (receiptOutputLabel);
//   requests - Eintraege fuer logReceiptOutputs -> gesendete Nutzlast oder
//              Abweisung vor dem Senden (scope request, Grund).
// Gerechnet wird mit dem gebauten Paket (dist/), nie von Hand; der Fall
// `mixed` kommt aus dem Vertrags-Export des Backends (v3/antworten/kasse.json).
// Aufruf: `npm run fixtures:ausgaben` (bewusst, nie automatisch).
import { readFileSync, writeFileSync } from 'node:fs';
import { receiptOutputsFromWire } from '../dist/esm/models/receipt-output.js';
import { logReceiptOutputs } from '../dist/esm/client/receipts.js';
import { receiptOutputLabel } from '../dist/esm/pos/index.js';

const lies = (pfad) => JSON.parse(readFileSync(new URL(`../fixtures/${pfad}`, import.meta.url), 'utf8'));

const LIVIA = { id: 'ru_livia', name: 'Livia Lindmayr' };
const at = (min) => `2026-09-26T10:${String(min).padStart(2, '0')}:00+02:00`;
const vertragsfall = lies('v3/antworten/belege.json').cases.find((c) => c.name === 'get_receipt_with_outputs');
if (!vertragsfall) throw new Error('belege.json: Fall get_receipt_with_outputs fehlt');

// --- outputs: Eingaben ----------------------------------------------------------
const outputs = [
  { name: 'contract_get_receipt_with_outputs', input: vertragsfall.response.data.outputs },
  { name: 'not_a_list_object', input: { kind: 'print' } },
  { name: 'not_a_list_none', input: null },
  { name: 'not_a_list_text', input: 'print' },
  { name: 'empty_list', input: [] },
  {
    name: 'broken_entries_dropped',
    input: [
      { kind: 'print', at: at(0), result: 'ok', by: LIVIA },
      null,
      'print',
      42,
      [{ kind: 'print', at: at(0), result: 'ok', by: null }],
      { at: at(1), result: 'ok', by: null },
      { kind: '', at: at(1), result: 'ok', by: null },
      { kind: 'reprint', at: 5, result: 'ok', by: null },
      { kind: 'reprint', at: '', result: 'ok', by: null },
      { kind: 'reprint', at: at(2), by: null },
      { kind: 'reprint', at: at(2), result: '', by: null },
      { kind: 7, at: at(2), result: 'ok', by: null },
      { kind: 'email', at: at(3), result: 'ok', by: LIVIA, extra: true },
    ],
  },
  {
    name: 'unknown_kind_and_result_kept',
    input: [
      { kind: 'fax', at: at(1), result: 'pending', by: { id: 'ru_livia' } },
      { kind: 'print', at: at(2), result: 'queued', by: LIVIA },
      { kind: 'constructor', at: at(3), result: 'ok', by: null },
      { kind: '__proto__', at: at(3), result: 'ok', by: null },
      { kind: 'toString', at: at(3), result: 'ok', by: null },
      { kind: 'outputs_title', at: at(3), result: 'ok', by: null },
    ],
  },
  {
    name: 'actor_rules',
    input: [
      { kind: 'print', at: at(0), result: 'ok', by: { id: 'ru_livia', name: 'Livia Lindmayr' } },
      { kind: 'print', at: at(1), result: 'ok', by: { id: 'ru_livia' } },
      { kind: 'print', at: at(2), result: 'ok', by: { id: 'ru_livia', name: 3 } },
      { kind: 'print', at: at(3), result: 'ok', by: { id: 'kr_account', name: null } },
      { kind: 'print', at: at(4), result: 'ok', by: { name: 'ohne Kennung' } },
      { kind: 'print', at: at(5), result: 'ok', by: { id: '', name: 'leere Kennung' } },
      { kind: 'print', at: at(6), result: 'ok', by: { id: 42 } },
      { kind: 'print', at: at(7), result: 'ok', by: 'ru_livia' },
      { kind: 'print', at: at(8), result: 'ok', by: ['ru_livia'] },
      { kind: 'print', at: at(9), result: 'ok' },
    ],
  },
  {
    name: 'count_rules',
    input: [
      { kind: 'opened', at: at(0), result: 'ok', by: null, count: 40 },
      { kind: 'opened', at: at(1), result: 'ok', by: null, count: 1 },
      { kind: 'opened', at: at(2), result: 'ok', by: null, count: 0 },
      { kind: 'opened', at: at(3), result: 'ok', by: null, count: -2 },
      { kind: 'opened', at: at(4), result: 'ok', by: null, count: 1.5 },
      { kind: 'opened', at: at(5), result: 'ok', by: null, count: '3' },
      { kind: 'opened', at: at(6), result: 'ok', by: null, count: null },
      { kind: 'opened', at: at(7), result: 'ok', by: null },
      { kind: 'opened', at: at(8), result: 'ok', by: null, count: 9007199254740992 },
      { kind: 'print', at: at(9), result: 'ok', by: LIVIA, count: 2 },
    ],
  },
  {
    name: 'label_only_kind',
    input: [
      { kind: 'print', at: at(0), result: 'failed', by: LIVIA },
      { kind: 'reprint', at: at(1), result: 'unclear', by: LIVIA },
      { kind: 'link_shared', at: at(2), result: 'ok', by: LIVIA },
      { kind: 'pdf_shared', at: at(3), result: 'ok', by: LIVIA },
      { kind: 'email', at: at(4), result: 'ok', by: LIVIA },
    ],
  },
].map((f) => {
  const expected = receiptOutputsFromWire(f.input) ?? null;
  return { ...f, expected, labels: expected === null ? null : expected.map((o) => receiptOutputLabel(o)) };
});

// --- requests: Eintraege fuer logReceiptOutputs ----------------------------------
const gut = { key: 'print-0001', receiptId: 'KASSE1-ID-7', at: '2026-09-26T09:58:00+02:00', kind: 'print', result: 'ok' };
const mit = (aenderung) => ({ ...gut, ...aenderung });
const ohne = (feld) => Object.fromEntries(Object.entries(gut).filter(([k]) => k !== feld));
const mixed = lies('v3/antworten/kasse.json').endpoints.logReceiptOutputs.cases.find((c) => c.case === 'mixed');
if (!mixed) throw new Error('kasse.json: Fall logReceiptOutputs/mixed fehlt');
const eintraege = (n, basis) => Array.from({ length: n }, (_, i) => ({ ...basis, key: `share-${1000 + i}` }));

const anfragen = [
  { name: 'contract_mixed', entries: mixed.params.entries },
  { name: 'contract_mixed_without_short_key', entries: mixed.params.entries.filter((e) => e.key !== 'kurz') },
  { name: 'one_entry', entries: [gut] },
  { name: 'no_entries', entries: [] },
  { name: 'max_entries', entries: eintraege(50, { receiptId: 'KASSE1-ID-7', at: 1790409570000, kind: 'link_shared' }) },
  { name: 'too_many_entries', entries: eintraege(51, { receiptId: 'KASSE1-ID-7', at: 1790409570000, kind: 'link_shared' }) },
  { name: 'unknown_field', entries: [mit({ receiptID: 'KASSE1-ID-7' })] },
  { name: 'unknown_field_second_entry', entries: [gut, mit({ key: 'print-0002', note: 'Kopie' })] },
  { name: 'unknown_field_cashregister', entries: [mit({ cashregisterId: 'KASSE2' })] },
  { name: 'key_missing', entries: [ohne('key')] },
  { name: 'key_empty', entries: [mit({ key: '' })] },
  { name: 'key_null', entries: [mit({ key: null })] },
  { name: 'key_blank', entries: [mit({ key: '        ' })] },
  { name: 'key_too_short', entries: [mit({ key: 'kurz' })] },
  { name: 'key_seven', entries: [mit({ key: 'print-1' })] },
  { name: 'key_space', entries: [mit({ key: 'print 0001' })] },
  { name: 'key_umlaut', entries: [mit({ key: 'prínt-0001' })] },
  { name: 'key_too_long', entries: [mit({ key: 'd'.repeat(65) })] },
  { name: 'key_bounds', entries: [mit({ key: 'Ab_-0123' }), mit({ key: 'k'.repeat(64) })] },
  { name: 'key_not_trimmed', entries: [mit({ key: ' print-0001' })] },
  { name: 'receipt_missing', entries: [ohne('receiptId')] },
  { name: 'receipt_blank', entries: [mit({ receiptId: ' ' })] },
  { name: 'kind_internal_word', entries: [mit({ kind: 'erstdruck' })] },
  { name: 'kind_missing', entries: [ohne('kind')] },
  { name: 'kind_null', entries: [mit({ kind: null })] },
  // Mail und Abruf gehen hinaus; der Server lehnt genau diesen Eintrag ab (invalid_output_kind).
  { name: 'kind_server_written', entries: [mit({ key: 'email-0001', kind: 'email' }), mit({ key: 'opened-0001', kind: 'opened' })] },
  { name: 'result_outside_catalog', entries: [mit({ result: 'error' })] },
  // Ein ausdrueckliches null ist kein fehlendes Ergebnis: es liegt ausserhalb des Katalogs.
  { name: 'result_null', entries: [mit({ result: null })] },
  { name: 'result_missing_share', entries: [mit({ key: 'share-0001', kind: 'link_shared', result: undefined })] },
  // Ein Druck ohne Ergebnis geht hinaus; der Server lehnt ihn ab (validation).
  { name: 'result_missing_print', entries: [ohne('result')] },
  { name: 'result_values', entries: ['ok', 'failed', 'unclear'].map((r, i) => mit({ key: `print-000${i + 1}`, kind: 'reprint', result: r })) },
  { name: 'at_missing', entries: [ohne('at')] },
  { name: 'at_empty', entries: [mit({ at: '' })] },
  { name: 'at_null', entries: [mit({ at: null })] },
  { name: 'at_fraction', entries: [mit({ at: 1.5 })] },
  { name: 'at_negative', entries: [mit({ at: -1 })] },
  { name: 'at_zero', entries: [mit({ at: 0 })] },
  { name: 'at_ms', entries: [mit({ at: 1790409480000 })] },
  { name: 'at_unsafe', entries: [mit({ at: 9007199254740992 })] },
  { name: 'at_without_zone', entries: [mit({ at: '2026-09-26T09:58:00' })] },
  { name: 'at_fraction_without_zone', entries: [mit({ at: '2026-09-26T09:58:00.123' })] },
  { name: 'at_offset_without_colon', entries: [mit({ at: '2026-09-26T09:58:00+0200' })] },
  { name: 'at_date_only', entries: [mit({ at: '2026-09-26' })] },
  { name: 'at_space', entries: [mit({ at: '2026-09-26 09:58:00Z' })] },
  { name: 'at_seven_fraction_digits', entries: [mit({ at: '2026-09-26T09:58:00.1234567Z' })] },
  { name: 'at_lowercase_z', entries: [mit({ at: '2026-09-26T07:58:00z' })] },
  {
    name: 'at_with_zone',
    entries: [
      mit({ key: 'print-0001', at: '2026-09-26T07:58:00Z' }),
      mit({ key: 'print-0002', at: '2026-09-26T09:58:00.123456+02:00' }),
      mit({ key: 'print-0003', at: '2026-09-26T07:59:00.000Z' }),
      mit({ key: 'print-0004', at: '2026-09-26T02:58:00-05:00' }),
    ],
  },
  // Der erste Fehler zaehlt (Reihenfolge der Pruefung wie im Paket).
  { name: 'first_error_wins', entries: [gut, mit({ key: 'kurz', kind: 'erstdruck', at: '2026-09-26' })] },
];

const requests = [];
for (const f of anfragen) {
  const entries = f.entries.map((e) => Object.fromEntries(Object.entries(e).filter(([, w]) => w !== undefined)));
  let gesendet;
  const transport = async (_name, params) => {
    gesendet = params;
    return { accepted: entries.length, rejected: [] };
  };
  try {
    await logReceiptOutputs(transport, { entries });
    requests.push({ name: f.name, entries, expected: { sent: gesendet } });
  } catch (e) {
    if (e?.name !== 'KasseneckValidationError' || e.scope !== 'request' || gesendet !== undefined) throw e;
    requests.push({ name: f.name, entries, expected: { error: { scope: 'request', reason: e.reason } } });
  }
}

const datei = {
  version: 1,
  _note:
    'Receipt outputs (Ausgaben eines Belegs). `outputs`: `input` is `data.outputs` of a getReceipt answer as received; `expected` is the list the package reads from it (null when it is no list; an entry without non-empty text kind, at and result is dropped; by is {id, name} with name null when not text, or null without a non-empty text id; count only as a safe whole number from 0; unknown kind or result kept), `labels` is receiptOutputLabel of each expected entry (null for an unknown kind; opened without a whole count from 1 counts as 1). `requests`: `entries` as given to logReceiptOutputs; `expected.sent` is the request body (without cashregisterId, which the sign-in adds), or `expected.error` the rejection before sending (scope request, reason of the first failing check; an unknown field reads `entries[i]: unbekanntes Feld "<name>"`). Written by `npm run fixtures:ausgaben`.',
  outputs,
  requests,
};
writeFileSync(new URL('../fixtures/receipt-outputs-cases.json', import.meta.url), JSON.stringify(datei, null, 2) + '\n');
console.log(`Ausgaben-Prueffaelle geschrieben: ${outputs.length} Lesefaelle, ${requests.length} Anfragen (${requests.filter((r) => r.expected.error).length} abgewiesen)`);
