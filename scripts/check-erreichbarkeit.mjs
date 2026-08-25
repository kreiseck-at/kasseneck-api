#!/usr/bin/env node
/**
 * Prueft, ob unter der **oeffentlichen** Adresse zu jedem Aufruf aus [AUFRUFE]
 * wirklich eine Function antwortet.
 *
 * Warum das eine eigene Pruefung braucht: Ein neuer Endpunkt ging live und
 * liess zwei Fehler stehen, obwohl fuenf Pruefebenen gruen waren -- unter
 * anderem, weil die Hosting-Weiterleitung fehlte und api.kasseneck.at die
 * HTML-Auffangseite lieferte statt der Function. Keine der fuenf Ebenen konnte
 * das sehen: Unit-Tests und Handler-Tests reden mit Attrappen, selbst die
 * Emulator-Laeufe reden mit 127.0.0.1. Auch `check:consumer` hilft hier nicht --
 * es prueft den Tarball aus Verbrauchersicht, setzt aber keinen einzigen Aufruf
 * ab.
 *
 * Der Kern ist eine Unterscheidung, kein Aufrufergebnis. Ein Aufruf **ohne
 * Anmeldung** antwortet, wenn dort eine Function steht, mit
 *
 *   {"status":"error","message":"Ungueltiger Request: Authorization key erwartet."}
 *
 * Das ist der Beweis, dass eine Function antwortet: Sie hat den Aufruf
 * angenommen und die Anmeldung geprueft. Eine HTML-Seite oder ein 404 ist der
 * Beweis, dass dort keine steht. Deshalb braucht diese Pruefung **keine
 * Zugangsdaten** -- und deshalb prueft sie auf `status`, nicht auf Erfolg: Ein
 * Test, der nur `status === 'error'` erwartete, wuerde die HTML-Seite nie von
 * einem Anmeldefehler unterscheiden.
 *
 * Bewusst **nicht** Teil von `npm test`: Die Pruefung braucht Netz. Ein
 * Testlauf im Zug oder in einem abgeschotteten Bauknecht darf daran nicht
 * scheitern. Ist das Netz nicht erreichbar, sagt das Skript es und endet mit 0.
 *
 * Aufruf: `npm run check:erreichbar`
 */
import { readFileSync } from 'node:fs';

const BASIS = 'https://api.kasseneck.at/v1';

/**
 * Frist je Aufruf, ueber den **ganzen** Abruf -- Verbindung, Antwortkopf UND
 * Rumpf. Ein blosses Zeitlimit bis zum Kopf liesse eine Adresse durch, die
 * `200` schickt und dann schweigt: `text()` haengt dann fuer immer, und die
 * Pruefung meldete nie ein Ergebnis. Der AbortController deckt beides ab, weil
 * das Abbrechen auch den Rumpf-Strom trifft.
 */
const FRIST_MS = 15_000;

const ausnahmenDatei = new URL('./erreichbarkeit-ausnahmen.json', import.meta.url);

/** AUFRUFE kommt aus dem Bau, nicht aus einer Zweitliste -- sonst prueft das Skript sich selbst. */
async function aufrufeLaden() {
  try {
    const modul = await import('../dist/esm/client/aufrufe.js');
    return [...modul.AUFRUFE];
  } catch (fehler) {
    process.stderr.write(
      `AUFRUFE nicht ladbar (${fehler.message}).\nBitte zuerst \`npm run build\`.\n`,
    );
    process.exit(1);
  }
}

/**
 * Setzt einen Aufruf ohne Anmeldung ab und sagt, was zurueckkam.
 * Wirft nie: ein Netzfehler ist ein Ergebnis wie jedes andere.
 */
async function abfragen(aufruf) {
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), FRIST_MS);
  try {
    const antwort = await fetch(`${BASIS}/${aufruf}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
      signal: abbruch.signal,
    });
    // Innerhalb derselben Frist: Ein Kopf ohne Rumpf ist kein Ergebnis.
    const rumpf = await antwort.text();
    return bewerten(antwort.status, rumpf);
  } catch (fehler) {
    const grund = abbruch.signal.aborted
      ? `keine vollstaendige Antwort binnen ${FRIST_MS / 1000} s`
      : `Netzfehler: ${fehler.message}`;
    return { erreichbar: false, netzfehler: !abbruch.signal.aborted, befund: grund };
  } finally {
    clearTimeout(wecker);
  }
}

/** Erreichbar heisst: JSON-Objekt mit einem `status`-Feld. Sonst nichts. */
function bewerten(status, rumpf) {
  const anfang = rumpf.trimStart().slice(0, 40).replace(/\s+/g, ' ');
  let geparst;
  try {
    geparst = JSON.parse(rumpf);
  } catch {
    return {
      erreichbar: false,
      netzfehler: false,
      befund: `HTTP ${status}, kein JSON (Rumpf beginnt mit "${anfang}") -- sieht nach der HTML-Auffangseite aus, also nach fehlender Weiterleitung`,
    };
  }
  if (geparst === null || typeof geparst !== 'object' || Array.isArray(geparst)) {
    return { erreichbar: false, netzfehler: false, befund: `HTTP ${status}, JSON ist kein Objekt` };
  }
  if (typeof geparst.status !== 'string') {
    return { erreichbar: false, netzfehler: false, befund: `HTTP ${status}, JSON ohne status-Feld` };
  }
  return { erreichbar: true, netzfehler: false, befund: `HTTP ${status}, status="${geparst.status}"` };
}

/** Ein Vorabgriff sagt, ob ueberhaupt Netz da ist. Jede HTTP-Antwort genuegt als Beweis. */
async function netzDa() {
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), FRIST_MS);
  try {
    const antwort = await fetch(`${BASIS}/`, { method: 'GET', signal: abbruch.signal });
    await antwort.text();
    return { ok: true };
  } catch (fehler) {
    return {
      ok: false,
      grund: abbruch.signal.aborted ? `keine Antwort binnen ${FRIST_MS / 1000} s` : fehler.message,
    };
  } finally {
    clearTimeout(wecker);
  }
}

function ausnahmenLaden(aufrufe) {
  const roh = JSON.parse(readFileSync(ausnahmenDatei, 'utf8'));
  const nachName = new Map();
  const maengel = [];
  for (const eintrag of roh.ausnahmen ?? []) {
    if (typeof eintrag.aufruf !== 'string' || eintrag.aufruf === '') {
      maengel.push('Ausnahme ohne Aufrufnamen');
      continue;
    }
    if (nachName.has(eintrag.aufruf)) {
      maengel.push(`Ausnahme ${eintrag.aufruf} steht doppelt`);
      continue;
    }
    if (!aufrufe.includes(eintrag.aufruf)) {
      // Eine Ausnahme darf keine Leiche decken: Steht der Name nicht mehr in
      // AUFRUFE, ist der Eintrag stumm geworden und niemandem faellt es auf.
      maengel.push(`Ausnahme ${eintrag.aufruf} steht nicht (mehr) in AUFRUFE`);
      continue;
    }
    if (eintrag.art === 'nicht_zutreffend') {
      if (typeof eintrag.grund !== 'string' || eintrag.grund.trim() === '') {
        maengel.push(`Ausnahme ${eintrag.aufruf}: art "nicht_zutreffend" braucht einen Grund`);
        continue;
      }
    } else if (eintrag.art === 'offen') {
      if (eintrag.issue === undefined || eintrag.issue === '') {
        maengel.push(`Ausnahme ${eintrag.aufruf}: art "offen" braucht eine Issue-Nummer`);
        continue;
      }
    } else {
      maengel.push(`Ausnahme ${eintrag.aufruf}: unbekannte art "${eintrag.art}"`);
      continue;
    }
    nachName.set(eintrag.aufruf, eintrag);
  }
  return { nachName, maengel };
}

const aufrufe = await aufrufeLaden();
const { nachName: ausnahmen, maengel } = ausnahmenLaden(aufrufe);

if (maengel.length > 0) {
  process.stderr.write(`Ausnahmeliste ist nicht in Ordnung:\n${maengel.map((m) => `  - ${m}`).join('\n')}\n`);
  process.exit(1);
}

const netz = await netzDa();
if (!netz.ok) {
  process.stdout.write(
    `Netz nicht erreichbar (${netz.grund}) -- Erreichbarkeitspruefung uebersprungen.\n` +
      'Das ist kein Fehler: Diese Pruefung braucht das offene Internet und laeuft deshalb\n' +
      'ausserhalb von `npm test`.\n',
  );
  process.exit(0);
}

process.stdout.write(`Erreichbarkeit unter ${BASIS} (Aufruf ohne Anmeldung, ${aufrufe.length} Aufrufe)\n\n`);

const fehler = [];
let bestaetigt = 0;

for (const aufruf of aufrufe) {
  const ausnahme = ausnahmen.get(aufruf);
  const ergebnis = await abfragen(aufruf);

  if (ausnahme) {
    if (ergebnis.erreichbar) {
      // Sonst saenke die Zahl nie: Eine erledigte Ausnahme muss verschwinden.
      fehler.push(
        `${aufruf}: steht als Ausnahme (${ausnahme.art}), ist aber erreichbar (${ergebnis.befund}).\n` +
          '    Bitte aus scripts/erreichbarkeit-ausnahmen.json streichen.',
      );
      process.stdout.write(`  ! ${aufruf.padEnd(30)} Ausnahme, aber erreichbar\n`);
    } else {
      const marke = ausnahme.art === 'offen' ? `offen, ${ausnahme.issue}` : 'nicht zutreffend';
      process.stdout.write(`  - ${aufruf.padEnd(30)} Ausnahme (${marke})\n`);
    }
    continue;
  }

  if (ergebnis.erreichbar) {
    bestaetigt += 1;
    process.stdout.write(`  ok ${aufruf.padEnd(29)} ${ergebnis.befund}\n`);
  } else {
    fehler.push(`${aufruf}: dort antwortet KEINE Function -- ${ergebnis.befund}`);
    process.stdout.write(`  X  ${aufruf.padEnd(29)} ${ergebnis.befund}\n`);
  }
}

process.stdout.write(
  `\n${bestaetigt} von ${aufrufe.length} Aufrufen erreichbar, ${ausnahmen.size} als Ausnahme gefuehrt.\n`,
);

if (fehler.length > 0) {
  process.stderr.write(`\n${fehler.length} Befund(e):\n${fehler.map((f) => `  - ${f}`).join('\n')}\n`);
  process.exit(1);
}
