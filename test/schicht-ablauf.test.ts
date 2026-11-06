import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  CART_WIDTH,
  POS_BUSINESS_DEFAULTS,
  POS_DEVICE_DEFAULTS,
  TIP_KINDS,
  TIP_START,
  closeMyShift,
  getMyDrawerState,
  labelText,
  mergePosSettings,
  messageText,
  posCartWidth,
  posTipKinds,
  posTipStart,
  recordMyShiftCount,
  setMyPosSettings,
  setMyRegisterDeviceSettings,
  shiftReceiptLayout,
  unknownPosSettingValues,
  sanitizePosSettings,
  posSettingsChanges,
  type PosBusinessSettings,
  type PosDeviceSettings,
  type ShiftSummaryReceipt,
} from '../src/pos/index.js';
import { POS_CALLS, type InternerTransport } from '../src/client/aufrufe.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import { gridToText, renderReceiptGrid } from '../src/receipt/index.js';

/*
 * Schicht-Ablauf der Kasse (1.28.0): Zwischenzaehlung, Zaehlung vor der
 * Auszahlung, letzte Schicht, Teile des Solls, Trinkgeld-Arten, Spaltenbreite
 * und die Zeilen des Z-Bons dazu. Die Antworten des Servers im Vertrag
 * (fixtures/v3/antworten/kasse.json) prueft test/pos-schicht.test.ts; hier
 * stehen die Faelle, die der Vertrag nicht oder nur am Rand fuehrt.
 */

type Json = Record<string, any>;

/** Ein Transport, der die Anfrage mitschreibt und die vorbereitete Antwort liefert. */
function stumm(antwort: unknown): { rufen: InternerTransport; aufrufe: Array<{ name: string; params: Json }> } {
  const aufrufe: Array<{ name: string; params: Json }> = [];
  const rufen = (async (name: string, params: Json) => {
    aufrufe.push({ name, params });
    return antwort;
  }) as unknown as InternerTransport;
  return { rufen, aufrufe };
}

// ---- recordMyShiftCount ---------------------------------------------------------

test('recordMyShiftCount: sendet shiftId, countedCents, Stueckelung, Kommentar und Schluessel; liest count', async () => {
  const { rufen, aufrufe } = stumm({ count: { expectedCents: 29400, countedCents: 29000, differenceCents: -400 } });
  const r = await recordMyShiftCount(rufen, {
    shiftId: 'haupt_KASSE1_s2', countedCents: 29000, denominations: { '20000': 1, '5000': 1, '2000': 2 }, comment: 'Kassensturz', idempotencyKey: 'zz-1',
  });
  assert.deepEqual(r, { count: { expectedCents: 29400, countedCents: 29000, differenceCents: -400 } });
  assert.deepEqual(aufrufe, [{
    name: 'recordMyShiftCount',
    params: { shiftId: 'haupt_KASSE1_s2', countedCents: 29000, denominations: { '20000': 1, '5000': 1, '2000': 2 }, comment: 'Kassensturz', idempotencyKey: 'zz-1' },
  }]);
});

test('recordMyShiftCount: gehoert zu POS_CALLS; 0 ist ein gueltiger Betrag', async () => {
  assert.ok((POS_CALLS as readonly string[]).includes('recordMyShiftCount'));
  const { rufen, aufrufe } = stumm({ count: { expectedCents: 0, countedCents: 0, differenceCents: 0 } });
  await recordMyShiftCount(rufen, { shiftId: 's1', countedCents: 0, idempotencyKey: 'k' });
  assert.equal(aufrufe[0]!.params.countedCents, 0);
});

test('recordMyShiftCount: fehlende Kennung, fehlender Schluessel, krummer Betrag werfen vor dem Senden', async () => {
  const { rufen, aufrufe } = stumm({});
  for (const o of [
    { countedCents: 100, idempotencyKey: 'k' },
    { shiftId: 's1', countedCents: 100 },
    { shiftId: 's1', countedCents: 10.5, idempotencyKey: 'k' },
    { shiftId: 's1', countedCents: '100', idempotencyKey: 'k' },
    { shiftId: 's1', countedCents: 100, idempotencyKey: 'k', denominations: { '500': 1.5 } },
    { shiftId: 's1', countedCents: 100, idempotencyKey: 'k', comment: 5 },
  ]) {
    await assert.rejects(recordMyShiftCount(rufen, o as never), (e) => isKasseneckValidationError(e) && e.scope === 'request');
  }
  assert.equal(aufrufe.length, 0);
});

test('recordMyShiftCount: eine Antwort ohne Ganzzahl ist ein Antwortfehler, nie 0', async () => {
  const { rufen } = stumm({ count: { expectedCents: '29400', countedCents: 29000, differenceCents: -400 } });
  await assert.rejects(recordMyShiftCount(rufen, { shiftId: 's1', countedCents: 29000, idempotencyKey: 'k' }), (e) => isKasseneckValidationError(e) && e.scope === 'response');
  const ohne = stumm({});
  await assert.rejects(recordMyShiftCount(ohne.rufen, { shiftId: 's1', countedCents: 1, idempotencyKey: 'k' }), (e) => isKasseneckValidationError(e) && e.scope === 'response');
});

// ---- closeMyShift: countedBeforePayout ------------------------------------------------

test('closeMyShift: countedBeforePayout geht als Wahrheitswert hinaus, alles andere wirft', async () => {
  const antwort = { status: 'recount' };
  const { rufen, aufrufe } = stumm(antwort);
  await closeMyShift(rufen, { shiftId: 's1', countedCents: 100, idempotencyKey: 'k', countedBeforePayout: true });
  assert.equal(aufrufe[0]!.params.countedBeforePayout, true);
  await assert.rejects(closeMyShift(rufen, { shiftId: 's1', countedCents: 100, idempotencyKey: 'k', countedBeforePayout: 'ja' as never }), (e) => isKasseneckValidationError(e));
  assert.equal(aufrufe.length, 1);
});

// ---- Kassenstand: lastShift, Teile des Solls ------------------------------------------

const STAND = {
  drawer: { id: 'haupt_KASSE1', name: 'Hauptlade', shiftMode: true, cashregisterId: 'KASSE1' },
  rights: { shift: true, cashMove: true, cashView: true, drawer: true },
  tipClaims: [],
  tips: [],
};

test('lastShift: Nummer, Zeit und Name; ohne Namen bleibt closedByName null; null bleibt null; fehlt = fehlt', async () => {
  const mit = await getMyDrawerState(stumm({ ...STAND, shift: null, lastShift: { number: 7, closedAt: '2026-09-25T20:00:00.000Z', closedByName: 'Anna Chef' } }).rufen);
  assert.deepEqual(mit.lastShift, { number: 7, closedAt: '2026-09-25T20:00:00.000Z', closedByName: 'Anna Chef' });
  const ohneName = await getMyDrawerState(stumm({ ...STAND, shift: null, lastShift: { number: 7, closedAt: '2026-09-25T20:00:00.000Z', closedByName: null } }).rufen);
  assert.equal(ohneName.lastShift!.closedByName, null);
  const keine = await getMyDrawerState(stumm({ ...STAND, shift: null, lastShift: null }).rufen);
  assert.equal(keine.lastShift, null);
  const fehlt = await getMyDrawerState(stumm({ ...STAND, shift: null }).rufen);
  assert.equal('lastShift' in fehlt, false);
});

test('lastShift: ohne Zeit oder Nummer ist die Antwort kaputt', async () => {
  for (const kaputt of [{ number: 7, closedByName: 'x' }, { number: '7', closedAt: '2026-09-25T20:00:00.000Z', closedByName: null }]) {
    await assert.rejects(getMyDrawerState(stumm({ ...STAND, shift: null, lastShift: kaputt }).rufen), (e) => isKasseneckValidationError(e) && e.scope === 'response');
  }
});

const OFFENE_SCHICHT = {
  id: 'haupt_KASSE1_s2', drawerId: 'haupt_KASSE1', cashregisterId: 'KASSE1', number: 2, status: 'open',
  openedAt: '2026-09-25T15:00:00.000Z', openedBy: { registerUserId: 'ru_chef', name: 'Anna Chef', role: 'register_user' },
};

test('Shift: openingCounted, expectedParts, cashTipsInDrawerCents, interimCounts und Differenz-Teile werden gelesen, fehlend bleibt fehlend', async () => {
  const teile = [{ key: 'opening', cents: 15000 }, { key: 'cash_sales', cents: 9400 }, { key: 'interim_difference', cents: -200 }];
  const zu = [{ type: 'interim', cents: -200, at: '2026-09-25T13:30:00.000Z' }, { type: 'closing', cents: 200, at: '2026-09-25T15:00:00.000Z' }];
  const voll = await getMyDrawerState(stumm({
    ...STAND,
    shift: { ...OFFENE_SCHICHT, openingCounted: false, expectedParts: teile, cashTipsInDrawerCents: 400, interimCounts: 1, interimDifferenceCents: -200, differenceParts: zu, countedBeforePayoutCents: 29400 },
  }).rufen);
  assert.equal(voll.shift!.openingCounted, false);
  assert.deepEqual(voll.shift!.expectedParts, teile);
  assert.equal(voll.shift!.cashTipsInDrawerCents, 400);
  assert.equal(voll.shift!.interimCounts, 1);
  assert.equal(voll.shift!.interimDifferenceCents, -200);
  assert.deepEqual(voll.shift!.differenceParts, zu);
  assert.equal(voll.shift!.countedBeforePayoutCents, 29400);
  const grund = await getMyDrawerState(stumm({ ...STAND, shift: OFFENE_SCHICHT }).rufen);
  for (const feld of ['openingCounted', 'expectedParts', 'cashTipsInDrawerCents', 'interimCounts', 'interimDifferenceCents', 'differenceParts', 'countedBeforePayoutCents']) {
    assert.equal(feld in grund.shift!, false, feld);
  }
});

test('Shift: ein Teil des Solls mit krummem Betrag ist ein Antwortfehler', async () => {
  await assert.rejects(
    getMyDrawerState(stumm({ ...STAND, shift: { ...OFFENE_SCHICHT, expectedParts: [{ key: 'opening', cents: 1.5 }] } }).rufen),
    (e) => isKasseneckValidationError(e) && e.scope === 'response',
  );
});

// ---- Einstellungen: Trinkgeld-Arten, Start, Spaltenbreite ------------------------------

test('Einstellungen: tipKinds, tipStart, cartWidth haben keinen Standardwert und werden gemischt, wenn sie die Form haben', () => {
  for (const feld of ['tipKinds', 'tipStart']) assert.equal(feld in POS_BUSINESS_DEFAULTS, false, feld);
  assert.equal('cartWidth' in POS_DEVICE_DEFAULTS, false);
  const b = mergePosSettings(POS_BUSINESS_DEFAULTS, { tipKinds: ['round_up', 'total'], tipStart: 'round_up' } as Partial<PosBusinessSettings>);
  assert.deepEqual(b.tipKinds, ['round_up', 'total']);
  assert.equal(b.tipStart, 'round_up');
  assert.equal(mergePosSettings(POS_DEVICE_DEFAULTS, { cartWidth: 'wide' } as Partial<PosDeviceSettings>).cartWidth, 'wide');
  // Eine falsche Form oder ein Wert der inneren Form 0.x kommt nicht herein.
  const schlecht = mergePosSettings(POS_BUSINESS_DEFAULTS, { tipKinds: [], tipStart: 5 } as unknown as Partial<PosBusinessSettings>);
  assert.equal('tipKinds' in schlecht, false);
  assert.equal('tipStart' in schlecht, false);
  assert.equal('tipKinds' in mergePosSettings(POS_BUSINESS_DEFAULTS, { tipKinds: ['prozent'] } as unknown as Partial<PosBusinessSettings>), false);
  assert.equal('tipStart' in mergePosSettings(POS_BUSINESS_DEFAULTS, { tipStart: 'aufrunden' } as unknown as Partial<PosBusinessSettings>), false);
  assert.equal('cartWidth' in mergePosSettings(POS_DEVICE_DEFAULTS, { cartWidth: 'breit' } as unknown as Partial<PosDeviceSettings>), false);
});

test('Einstellungen: wirksame Werte ohne Angabe: alle drei Arten, Start Prozent, Breite medium', () => {
  assert.deepEqual(posTipKinds(POS_BUSINESS_DEFAULTS), [...TIP_KINDS]);
  assert.equal(posTipStart(POS_BUSINESS_DEFAULTS), 'percent');
  assert.equal(posCartWidth(POS_DEVICE_DEFAULTS), 'medium');
  assert.deepEqual([...TIP_START], [...TIP_KINDS]);
  assert.deepEqual([...CART_WIDTH], ['narrow', 'medium', 'wide']);
  assert.deepEqual(posTipKinds(null), [...TIP_KINDS]);
});

test('Einstellungen: der Start liegt immer unter den angebotenen Arten', () => {
  const b = (tipKinds: string[], tipStart?: string) => ({ ...POS_BUSINESS_DEFAULTS, tipKinds, ...(tipStart === undefined ? {} : { tipStart }) }) as PosBusinessSettings;
  assert.equal(posTipStart(b(['round_up', 'total'], 'total')), 'total');
  // Start nicht angeboten oder ohne Start: Prozent, wenn angeboten, sonst die erste Art.
  assert.equal(posTipStart(b(['percent', 'total'], 'round_up')), 'percent');
  assert.equal(posTipStart(b(['round_up', 'total'])), 'round_up');
  assert.equal(posTipStart(b(['total'], 'percent')), 'total');
});

test('setMyPosSettings: tipKinds und tipStart gehen hinaus; Wert ausserhalb, leere Liste, Dublette wirft vor dem Senden', async () => {
  const antwort = { business: { ...POS_BUSINESS_DEFAULTS, tipKinds: ['percent', 'round_up'], tipStart: 'percent', tipMode: 'both' } };
  const { rufen, aufrufe } = stumm(antwort);
  const stand = await setMyPosSettings(rufen, { tipKinds: ['percent', 'round_up'], tipStart: 'percent' });
  assert.deepEqual(aufrufe[0]!.params, { business: { tipKinds: ['percent', 'round_up'], tipStart: 'percent' } });
  assert.deepEqual(stand.tipKinds, ['percent', 'round_up']);
  for (const schlecht of [
    { tipKinds: [] }, { tipKinds: ['percent', 'percent'] }, { tipKinds: ['prozent'] }, { tipKinds: 'percent' }, { tipStart: 'prozent' }, { tipStart: 'half' },
  ]) {
    await assert.rejects(setMyPosSettings(rufen, schlecht as never), (e) => isKasseneckValidationError(e) && e.scope === 'request');
  }
  assert.equal(aufrufe.length, 1);
});

test('setMyRegisterDeviceSettings: cartWidth geht hinaus, ein fremder Wert wirft', async () => {
  const { rufen, aufrufe } = stumm({ device: { ...POS_DEVICE_DEFAULTS, cartWidth: 'narrow' } });
  const stand = await setMyRegisterDeviceSettings(rufen, 'dev_1', { cartWidth: 'narrow' });
  assert.deepEqual(aufrufe[0]!.params, { deviceId: 'dev_1', device: { cartWidth: 'narrow' } });
  assert.equal(stand.cartWidth, 'narrow');
  await assert.rejects(setMyRegisterDeviceSettings(rufen, 'dev_1', { cartWidth: 'schmal' } as never), (e) => isKasseneckValidationError(e));
  await assert.rejects(setMyRegisterDeviceSettings(rufen, 'dev_1', { cartWidth: null } as never), (e) => isKasseneckValidationError(e));
  assert.equal(aufrufe.length, 1);
});

test('Einstellungen: ein neuer Wert des Servers bleibt stehen und wird gemeldet; nur Geaendertes geht hinaus', () => {
  const stand = sanitizePosSettings({ business: { tipKinds: ['percent', 'voucher'], tipStart: 'round_up' }, device: { cartWidth: 'huge' } });
  assert.deepEqual(stand.business.tipKinds, ['percent', 'voucher']);
  assert.deepEqual(unknownPosSettingValues(stand), ['business.tipKinds', 'device.cartWidth']);
  const vorher = mergePosSettings(POS_BUSINESS_DEFAULTS, { tipKinds: ['percent', 'round_up', 'total'] } as Partial<PosBusinessSettings>);
  const nachher = { ...vorher, tipKinds: ['percent'] };
  assert.deepEqual(posSettingsChanges(vorher, nachher), { tipKinds: ['percent'] });
});

// ---- Texte -------------------------------------------------------------------------------

test('Texte: Wortlaut und Platzhalter der neuen Schluessel', () => {
  assert.equal(labelText('shift.state_closed'), 'Schicht geschlossen');
  assert.equal(labelText('shift.band_closing'), 'Verkaufen ist pausiert, bis du fertig bist oder abbrichst.');
  assert.equal(labelText('shift.take_over_amount', { amount: '150,00' }), '150,00 übernehmen');
  assert.equal(labelText('shift.missing', { amount: '2,00' }), 'fehlen 2,00');
  assert.equal(labelText('shift.close_title_numbered', { number: 7 }), 'Schicht 7 schließen');
  assert.equal(labelText('shift.closed_title', { number: 7 }), 'Schicht 7 geschlossen');
  assert.equal(labelText('shift.interim_title', { number: 7 }), 'Schicht 7 zählen');
  assert.equal(labelText('shift.running_since_drawer', { drawer: 'Hauptlade', time: '08:00', duration: '2 Std.' }), 'Hauptlade · läuft seit 08:00 (2 Std.)');
  assert.equal(labelText('tip.round_to', { amount: '20,00' }), 'auf 20,00');
  assert.equal(labelText('tip.remainder_is_tip'), 'Rest ist Trinkgeld');
  assert.equal(labelText('shift.taken_over_unchecked', { number: 3 }), 'Schicht 3 wurde ohne Zählen übernommen');
  assert.equal(labelText('shift.taken_over_unchecked_by', { name: 'Anna Chef', time: '08:00' }), 'Anna Chef, 08:00');
  assert.equal(labelText('settings.cart_width_narrow'), 'Schmal');
  assert.equal(labelText('settings.cart_width_medium'), 'Mittel');
  assert.equal(labelText('settings.cart_width_wide'), 'Breit');
  assert.equal(messageText('shift.started_taken_over', { number: 4, amount: '150,00', from: 3, time: '22:05' }),
    'Schicht 4 hat begonnen – mit 150,00 in der Lade, übernommen von Schicht 3 (22:05).');
  assert.equal(messageText('tip.summary', { tip: '2,00', total: '22,00' }), 'Trinkgeld 2,00 · der Gast zahlt 22,00');
  assert.equal(messageText('tip.total_below_sum'), 'Der Betrag liegt unter der Summe.');
  assert.equal(messageText('shift.interim_saved'), 'Zählung festgehalten.');
});

test('Texte: die alten Schluessel behalten ihren Wortlaut (1.0-Vertrag)', () => {
  assert.equal(labelText('shift.close_title'), 'Schicht schließen');
  assert.equal(labelText('shift.running_since', { duration: '2 Std.' }), 'läuft seit 2 Std.');
  assert.equal(labelText('shift.counted'), 'Gezählt');
});

// ---- Z-Bon ---------------------------------------------------------------------------------

const FAELLE = JSON.parse(readFileSync(new URL('../../fixtures/shift-ablauf-cases.json', import.meta.url), 'utf8')) as {
  cases: Record<string, { receipt: ShiftSummaryReceipt; grid32: string; grid48: string }>;
};

test('Z-Bon Ablauf: Zeilen und Raster wie aufgenommen (32 und 48 Zeichen)', () => {
  assert.deepEqual(Object.keys(FAELLE.cases), ['z-bon-ablauf', 'z-bon-ablauf-blind']);
  for (const [name, f] of Object.entries(FAELLE.cases)) {
    const layout = shiftReceiptLayout(f.receipt);
    assert.equal(gridToText(renderReceiptGrid(layout, { charsPerLine: 32 })), f.grid32, `${name} 32`);
    assert.equal(gridToText(renderReceiptGrid(layout, { charsPerLine: 48 })), f.grid48, `${name} 48`);
  }
});

test('Z-Bon Ablauf: Zwischenzaehlung, Gezaehlt vor Ist, Differenz-Teile, Anfang nicht gezaehlt — in dieser Reihenfolge', () => {
  const text = gridToText(renderReceiptGrid(shiftReceiptLayout(FAELLE.cases['z-bon-ablauf']!.receipt), { charsPerLine: 48 }));
  const zeilen = text.split('\n').map((z) => z.replace(/ +/g, ' ').trim());
  const stelle = (muster: string): number => {
    const i = zeilen.findIndex((z) => z.startsWith(muster));
    assert.ok(i >= 0, muster);
    return i;
  };
  assert.ok(stelle('Anfang übernommen, nicht gezählt') > stelle('Startgeld übernommen'));
  assert.ok(stelle('Zwischenzählung') > stelle('Bar aus Storno') && stelle('Zwischenzählung') < stelle('Bewegungen'));
  assert.ok(stelle('Gezählt') > stelle('Soll') && stelle('Gezählt') < stelle('Ist'));
  assert.ok(stelle('Ist') < stelle('Differenz'));
  assert.ok(stelle('davon Zwischenzählung 15:30') > stelle('Differenz'));
  assert.ok(stelle('davon Abschluss') > stelle('davon Zwischenzählung 15:30'));
  // Eine Zwischenzaehlung ohne Differenz faellt weg (nur die mit -2,00 steht da).
  assert.equal(zeilen.filter((z) => z.startsWith('davon Zwischenzählung')).length, 1);
});

test('Z-Bon ohne die neuen Felder: keine der neuen Zeilen (die Goldens in schicht-layout.test.ts bleiben byte-gleich)', () => {
  const alt = structuredClone(FAELLE.cases['z-bon-ablauf']!.receipt) as unknown as Json;
  for (const feld of ['openingCounted', 'interimDifferenceCents', 'differenceParts', 'countedBeforePayoutCents', 'countedBeforePayoutDenominations']) delete alt[feld];
  const text = gridToText(renderReceiptGrid(shiftReceiptLayout(alt as ShiftSummaryReceipt), { charsPerLine: 48 }));
  assert.doesNotMatch(text, /nicht gezählt|Zwischenzählung|^Gezählt|davon /m);
  // openingCounted: true druckt ebenfalls nichts.
  const gezaehlt = { ...alt, openingCounted: true } as ShiftSummaryReceipt;
  assert.doesNotMatch(gridToText(renderReceiptGrid(shiftReceiptLayout(gezaehlt), { charsPerLine: 48 })), /nicht gezählt/);
});

test('Z-Bon blind: keine Zaehlung vor Auszahlung, keine Teile; „Anfang nicht gezaehlt“ bleibt (kein Betrag)', () => {
  const text = gridToText(renderReceiptGrid(shiftReceiptLayout(FAELLE.cases['z-bon-ablauf-blind']!.receipt), { charsPerLine: 48 }));
  assert.match(text, /^Anfang übernommen, nicht gezählt/m);
  assert.doesNotMatch(text, /^Gezählt|davon |Zwischenzählung/m);
});
