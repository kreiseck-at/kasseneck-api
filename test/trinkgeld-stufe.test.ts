import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POS_BUSINESS_DEFAULTS, POS_BUSINESS_OPTIONAL_CHOICES, POS_BUSINESS_VALUES, TIP_KEPT_MODE, TIP_KEPT_MODE_LABELS,
  mergePosSettings, posTipKeptMode, tipKeptFor, setMyPosSettings, labelText, messageText, type PosBusinessSettings,
} from '../src/pos/index.js';
import { KATALOGE } from '../src/stored/vokabular.js';
import { isKasseneckValidationError } from '../src/client/errors.js';

/*
 * Trinkgeld gleich behalten in drei Stufen (business.tipKeptMode, Backend tgDirektModus fragen|immer|nie):
 * fehlt die Stufe, gilt ask wie bisher, tipKeptByDefault bleibt die Vorbelegung des Schalters.
 */

const mit = (b: Partial<PosBusinessSettings>) => mergePosSettings(POS_BUSINESS_DEFAULTS, b);

test('Stufen: dieselben wie der Vertrag (KASSE_BETRIEB_WERTE.tipKeptMode), optional ohne Standardwert', () => {
  assert.deepEqual([...TIP_KEPT_MODE], Object.values(KATALOGE['KASSE_BETRIEB_WERTE.tipKeptMode']!));
  assert.ok((POS_BUSINESS_OPTIONAL_CHOICES as readonly string[]).includes('tipKeptMode'));
  assert.equal('tipKeptMode' in POS_BUSINESS_DEFAULTS, false);
  assert.deepEqual(POS_BUSINESS_VALUES.tipKeptMode, TIP_KEPT_MODE);
});

test('posTipKeptMode: gespeichert, sonst ask (fehlt, unbekannt, deutscher Altwert)', () => {
  assert.equal(posTipKeptMode(POS_BUSINESS_DEFAULTS), 'ask');
  assert.equal(posTipKeptMode(null), 'ask');
  assert.equal(posTipKeptMode(mit({ tipKeptMode: 'always' })), 'always');
  assert.equal(posTipKeptMode(mit({ tipKeptMode: 'never' })), 'never');
  assert.equal(posTipKeptMode({ tipKeptMode: 'sometimes' }), 'ask');
  // Ein deutscher Wert der inneren Form kommt gar nicht erst ins Modell.
  assert.equal('tipKeptMode' in mit({ tipKeptMode: 'immer' } as unknown as Partial<PosBusinessSettings>), false);
});

test('tipKeptFor: eine Regel fuer Web und App', () => {
  // ask: Schalter, Vorbelegung tipKeptByDefault, eine Wahl am Schalter gewinnt.
  assert.deepEqual(tipKeptFor(POS_BUSINESS_DEFAULTS), { showSwitch: true, kept: false });
  assert.deepEqual(tipKeptFor(mit({ tipKeptByDefault: true })), { showSwitch: true, kept: true });
  assert.deepEqual(tipKeptFor(mit({ tipKeptByDefault: true, tipKeptMode: 'ask' }), false), { showSwitch: true, kept: false });
  assert.deepEqual(tipKeptFor(mit({ tipKeptByDefault: false }), true), { showSwitch: true, kept: true });
  assert.deepEqual(tipKeptFor(mit({ tipKeptByDefault: true }), null), { showSwitch: true, kept: true });
  // always/never: kein Schalter, eine Wahl zaehlt nicht, die Vorbelegung auch nicht.
  for (const wahl of [undefined, true, false]) {
    assert.deepEqual(tipKeptFor(mit({ tipKeptMode: 'always', tipKeptByDefault: false }), wahl), { showSwitch: false, kept: true });
    assert.deepEqual(tipKeptFor(mit({ tipKeptMode: 'never', tipKeptByDefault: true }), wahl), { showSwitch: false, kept: false });
  }
  // Unbekannte Stufe (neuer Server): wie ask.
  assert.deepEqual(tipKeptFor({ tipKeptMode: 'sometimes', tipKeptByDefault: true }), { showSwitch: true, kept: true });
  assert.deepEqual(tipKeptFor(undefined), { showSwitch: true, kept: false });
});

test('setMyPosSettings: tipKeptMode geht nur mit einem Wert des Katalogs hinaus', async () => {
  const aufrufe: Record<string, unknown>[] = [];
  const rufen = (async (_name: string, params: Record<string, unknown>) => {
    aufrufe.push(params);
    return { business: { ...POS_BUSINESS_DEFAULTS, tipKeptMode: 'never' } };
  }) as unknown as Parameters<typeof setMyPosSettings>[0];
  const stand = await setMyPosSettings(rufen, { tipKeptMode: 'never' });
  assert.deepEqual(aufrufe[0]!['business'], { tipKeptMode: 'never' });
  assert.equal(posTipKeptMode(stand), 'never');
  await assert.rejects(setMyPosSettings(rufen, { tipKeptMode: 'nie' } as unknown as Partial<PosBusinessSettings>), (e) => isKasseneckValidationError(e));
  assert.equal(aufrufe.length, 1);
});

test('Texte: Stufen im Kundenbereich und Hinweise an der Kasse', () => {
  assert.equal(labelText('tip_kept_mode.title'), 'Trinkgeld gleich behalten');
  assert.deepEqual(TIP_KEPT_MODE.map((m) => labelText(TIP_KEPT_MODE_LABELS[m])), ['Jedes Mal fragen', 'Immer gleich behalten', 'Immer offen lassen']);
  assert.equal(messageText('tip.kept_hint'), 'Trinkgeld kommt als eigene Position auf den Beleg; der angemeldete Benutzer nimmt es gleich bar aus der Lade.');
  assert.equal(messageText('tip.open_hint'), 'Trinkgeld kommt als eigene Position auf den Beleg und bleibt für den angemeldeten Benutzer offen, bis es ausgezahlt wird.');
});
