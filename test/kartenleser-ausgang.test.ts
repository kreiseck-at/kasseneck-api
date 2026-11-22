import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KasseneckApiError } from '../src/client/errors.js';

/*
 * Kartenleser: Start und Rueckbuchung antworten bei jeder unerwarteten Ausnahme
 * mit `server_error`, auch NACH dem Anbieteraufruf. Darum gilt dort der Ausgang
 * als unklar; die Kasse fragt mit DERSELBEN Kennung nach, nie mit einer neuen.
 */
for (const name of ['startCardReaderPayment', 'refundCardReaderPayment']) {
  test(`${name}: server_error und Huelle ohne Code gelten als unklar`, () => {
    assert.equal(new KasseneckApiError(name, 'Fehler', {}, 'server_error').outcome, 'unknown');
    assert.equal(new KasseneckApiError(name, 'Fehler', {}).outcome, 'unknown');
  });
  test(`${name}: andere Codes bleiben abgelehnt`, () => {
    for (const code of ['card_reader_busy', 'card_payment_amount_invalid', 'card_account_not_connected', 'card_reader_choice_needed', 'validation']) {
      assert.equal(new KasseneckApiError(name, 'Nein', {}, code).outcome, 'rejected', code);
    }
  });
}

test('andere Kartenleser-Aufrufe: server_error bleibt abgelehnt (Lesen und Verwalten)', () => {
  for (const name of ['getCardReaderPayment', 'pairCardReader', 'getCardReaderSetup']) {
    assert.equal(new KasseneckApiError(name, 'Fehler', {}, 'server_error').outcome, 'rejected', name);
  }
});
