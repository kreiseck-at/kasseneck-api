/**
 * Aufrunden-Vorschlaege fuer Trinkgeld: genau drei aufsteigende Gesamtbetraege
 * in Cent ueber dem Bezugsbetrag. Nur Ganzzahlen; die Pruefaelle stehen in
 * `fixtures/tip-round-up-cases.json` (gleich im Dart-Zwilling).
 */

function steps(t: number): [number, number] {
  if (t < 1500) return [50, 100];
  if (t < 5000) return [100, 500];
  if (t < 20000) return [500, 1000];
  return [1000, 5000];
}

const ceilDiv = (a: number, b: number): number => Math.floor((a + b - 1) / b);

export function roundUpSuggestions(amountCents: number): number[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return [];
  const t = amountCents;
  const [small, large] = steps(t);
  const lo = Math.max(Math.floor((t * 102) / 100), t + 20);
  const hi = Math.floor((t * (t < 1000 ? 125 : 120)) / 100);

  const set = new Set<number>();
  for (const s of [small, large]) for (let m = ceilDiv(lo, s) * s; m <= hi; m += s) set.add(m);
  const candidates = [...set].sort((a, b) => a - b);

  const chosen = new Set<number>();
  if (candidates.length > 0) {
    const firstRound = candidates.find((k) => k % large === 0);
    chosen.add(firstRound !== undefined && (firstRound - t) * 100 <= t * 10 ? firstRound : candidates[0]!);
  }
  for (const target of [110, 115]) {
    const free = candidates.filter((k) => !chosen.has(k));
    if (free.length === 0) break;
    const dist = (k: number): number => Math.abs(k * 100 - t * target);
    const round = free.find((k) => k % large === 0 && dist(k) <= t * 3);
    if (round !== undefined) { chosen.add(round); continue; }
    let best = free[0]!;
    for (const k of free) if (dist(k) < dist(best)) best = k;
    chosen.add(best);
  }

  let next = chosen.size > 0 ? Math.max(...chosen) : ceilDiv(lo, small) * small - small;
  while (chosen.size < 3) {
    next = (Math.floor(next / small) + 1) * small;
    if (next >= lo) chosen.add(next);
  }
  return [...chosen].sort((a, b) => a - b);
}
