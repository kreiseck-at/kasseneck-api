import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportConnectState, type ConnectStateReport } from '../src/pos/index.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import type { InternerTransport } from '../src/client/aufrufe.js';
import { POS_CALLS, UNKNOWN_OUTCOME_CALLS } from '../src/client/aufrufe.js';

function transport(): { rufen: InternerTransport; aufrufe: Array<{ name: string; params: unknown }> } {
  const aufrufe: Array<{ name: string; params: unknown }> = [];
  const rufen = (async (name: string, params?: unknown) => {
    aufrufe.push({ name, params });
    return {};
  }) as InternerTransport;
  return { rufen, aufrufe };
}

const VOLL: ConnectStateReport = {
  deviceId: 'dev_theke', version: '1.4.0', os: 'macos', osVersion: '26.5.1', arch: 'arm64',
  features: ['bluetooth', 'https', 'update'], httpsTrusted: true, bluetooth: 'poweredOn',
};

test('reportConnectState sendet genau die acht Felder', async () => {
  const t = transport();
  await reportConnectState(t.rufen, VOLL);
  assert.deepEqual(t.aufrufe, [{ name: 'reportConnectState', params: VOLL }]);
});

test('alter Connect: fehlende Angaben gehen als null bzw. leere Liste hinaus', async () => {
  const t = transport();
  await reportConnectState(t.rufen, { deviceId: 'dev_theke', version: '1.3.0', os: 'macos', osVersion: null, arch: null, features: [], httpsTrusted: null, bluetooth: null });
  assert.deepEqual(t.aufrufe[0]?.params, { deviceId: 'dev_theke', version: '1.3.0', os: 'macos', osVersion: null, arch: null, features: [], httpsTrusted: null, bluetooth: null });
});

test('weist Unbrauchbares vor dem Senden ab', async () => {
  for (const kaputt of [
    null,
    { ...VOLL, deviceId: '' },
    { ...VOLL, version: 4 },
    { ...VOLL, features: 'bluetooth' },
    { ...VOLL, httpsTrusted: 'ja' },
    { ...VOLL, rechnername: 'Kassa-PC' },
  ]) {
    const t = transport();
    await assert.rejects(reportConnectState(t.rufen, kaputt as ConnectStateReport), (e: unknown) => isKasseneckValidationError(e));
    assert.equal(t.aufrufe.length, 0);
  }
});

test('reportConnectState ist ein Kassenweg-Aufruf mit unklarem Ausgang bei Zeitlimit', () => {
  assert.ok((POS_CALLS as readonly string[]).includes('reportConnectState'));
  assert.ok((UNKNOWN_OUTCOME_CALLS as readonly string[]).includes('reportConnectState'));
});
