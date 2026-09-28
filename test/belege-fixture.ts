/**
 * Die Golden-Eingaben unter `fixtures/belege/` sind eine Zusage an alle
 * Verbraucher (keck, Web, Flutter) und tragen noch die Namen von 0.x: Firma
 * mit `uid`/`taxnr`, Storno-Grund deutsch (`fehleingabe`), Layout-Optionen
 * deutsch (`testKasse`, `testSignatur`, `pruefangaben`). Bis Aufgabe 10 sie
 * auf `/v3` umstellt, bildet dieser Lader sie auf das englische Modell ab;
 * die Dateien selbst (und ihr Hash im Manifest) bleiben Byte fuer Byte.
 */
const GRUND: Record<string, string> = {
  fehleingabe: 'input_error',
  kunde_storniert: 'customer_cancelled',
  falsche_zahlart: 'wrong_payment_method',
  doppelt_erfasst: 'duplicate',
  sonstiges: 'other',
};

export function belegFixtureAufV3<F extends { company: object; receipt: Record<string, unknown>; options?: object }>(f: F): F {
  const { uid, taxnr, ...firma } = f.company as Record<string, unknown>;
  const company = { ...firma, ...(uid !== undefined ? { vatId: uid } : {}), ...(taxnr !== undefined ? { taxNumber: taxnr } : {}) };
  const grund = f.receipt['cancellationReason'];
  const receipt = typeof grund === 'string' && grund in GRUND ? { ...f.receipt, cancellationReason: GRUND[grund] } : f.receipt;
  return { ...f, company, receipt, ...(f.options !== undefined ? { options: layoutOptionenAufV3(f.options as Record<string, unknown>) } : {}) };
}

/** Layout-Optionen der Fixtures (0.x) -> englische Optionen. */
export function layoutOptionenAufV3(o: Record<string, unknown>): Record<string, unknown> {
  const aus: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'testKasse') aus['testCashregister'] = v;
    else if (k === 'testSignatur') aus['testSignature'] = v;
    else if (k === 'regelwerk') aus['ruleset'] = v;
    else if (k === 'pruefangaben') {
      const p = (v ?? {}) as { karteRegistriertAm?: unknown; kasseRegistriertAm?: unknown };
      aus['registrationInfo'] = v == null ? v : { cardRegisteredAt: p.karteRegistriertAm, cashregisterRegisteredAt: p.kasseRegistriertAm };
    } else aus[k] = v;
  }
  return aus;
}
