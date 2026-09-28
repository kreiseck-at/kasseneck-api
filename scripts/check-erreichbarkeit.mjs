#!/usr/bin/env node
/**
 * Prueft, ob unter der **oeffentlichen** Adresse zu jedem Aufruf aus [ALL_CALLS]
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
 * **Die Adressen von 1.0.** Das Paket spricht nur noch `/v3`: die
 * oeffentlichen Aufrufe unter DEFAULT_BASE_URL, die Partner-Aufrufe unter
 * PARTNER_BASE_URL und die reinen Kassenaufrufe (`isPosOnlyCall`) unter
 * POS_BASE_URL (kasse.kasseneck.at/api/v3). Geprueft wird jeder Aufruf unter
 * der Adresse, die der Transport fuer ihn wirklich waehlt; Adressen und
 * Zuordnung liest das Skript aus dem Bau, nicht aus einer Zweitliste.
 *
 * Aufruf: `npm run check:erreichbar`
 */
import { readFileSync } from 'node:fs';

const transport = await import('../dist/esm/client/transport.js').catch((fehler) => {
  process.stderr.write(`Bau nicht ladbar (${fehler.message}).\nBitte zuerst \`npm run build\`.\n`);
  process.exit(1);
});
const aufrufeModul = await import('../dist/esm/client/aufrufe.js');
const BASIS = transport.DEFAULT_BASE_URL;
const BASIS_KASSE = transport.POS_BASE_URL;
const BASIS_PARTNER = 'https://api.kasseneck.at/v3';

/**
 * Frist je Aufruf, ueber den **ganzen** Abruf -- Verbindung, Antwortkopf UND
 * Rumpf. Ein blosses Zeitlimit bis zum Kopf liesse eine Adresse durch, die
 * `200` schickt und dann schweigt: `text()` haengt dann fuer immer, und die
 * Pruefung meldete nie ein Ergebnis. Der AbortController deckt beides ab, weil
 * das Abbrechen auch den Rumpf-Strom trifft.
 */
const FRIST_MS = 15_000;

const ausnahmenDatei = new URL('./erreichbarkeit-ausnahmen.json', import.meta.url);

/** ALL_CALLS kommt aus dem Bau, nicht aus einer Zweitliste -- sonst prueft das Skript sich selbst. */
function aufrufeLaden() {
  return [...aufrufeModul.ALL_CALLS];
}

/** Die Adresse, die der Transport fuer einen Aufruf waehlt. */
function basisFuer(aufruf, partnerAufrufe) {
  if (partnerAufrufe.has(aufruf)) return BASIS_PARTNER;
  return aufrufeModul.isPosOnlyCall(aufruf) ? BASIS_KASSE : BASIS;
}

/**
 * Die Aufrufe, die das Paket unter `/v3` spricht: die Methoden der
 * Partner-Fassade. Abgelesen aus dem Bau, nie aufgerufen; der Schluessel ist
 * nur formgerecht, damit die Fassade entsteht.
 */
async function partnerAufrufeLaden(aufrufe) {
  const partner = await import('../dist/esm/partner/index.js');
  if (partner.PARTNER_BASE_URL !== BASIS_PARTNER) {
    process.stderr.write(`PARTNER_BASE_URL ist ${partner.PARTNER_BASE_URL}, dieses Skript prueft ${BASIS_PARTNER}.\n`);
    process.exit(1);
  }
  const fassade = partner.createPartnerApi({ partnerKey: 'pk_test_NURFUERDIEFORMNURFUERDIEFORM', fetch: async () => { throw new Error('nie'); } });
  // Die Fassade traegt auch Helfer (etwa errorAdvice), die keinen Aufruf absetzen.
  // Aufrufe sind genau die Methoden, die ALL_CALLS fuehrt; der Rest ist kein Endpunkt.
  return new Set(Object.keys(fassade).filter((name) => typeof fassade[name] === 'function' && aufrufe.includes(name)));
}

/**
 * Setzt einen Aufruf ohne Anmeldung ab und sagt, was zurueckkam.
 * Wirft nie: ein Netzfehler ist ein Ergebnis wie jedes andere.
 */
async function abfragen(aufruf, basis) {
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), FRIST_MS);
  try {
    const antwort = await fetch(`${basis}/${aufruf}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
      signal: abbruch.signal,
    });
    // Innerhalb derselben Frist: Ein Kopf ohne Rumpf ist kein Ergebnis.
    const rumpf = await antwort.text();
    return bewerten(antwort.status, rumpf, antwort.headers.get('kasseneck-api-version'));
  } catch (fehler) {
    const grund = abbruch.signal.aborted
      ? `keine vollstaendige Antwort binnen ${FRIST_MS / 1000} s`
      : `Netzfehler: ${fehler.message}`;
    return { erreichbar: false, netzfehler: !abbruch.signal.aborted, befund: grund };
  } finally {
    clearTimeout(wecker);
  }
}

/** Erreichbar heisst: JSON-Objekt mit einem `status`-Feld und dem Kennzeichen des /v3-Rands. Sonst nichts. */
function bewerten(status, rumpf, version) {
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
  // Unter /v3 antwortet der Rand auf einen Namen, den er nicht routet, selbst
  // mit JSON (code not_found). Das ist eine Function, aber nicht die gesuchte.
  if (geparst.code === 'not_found' || (geparst.data && geparst.data.code === 'not_found')) {
    return { erreichbar: false, netzfehler: false, befund: `HTTP ${status}, not_found -- der Endpunkt ist unter dieser Version nicht geroutet` };
  }
  // 1.0 bricht jede Antwort ohne dieses Kennzeichen ab (fail closed): eine
  // Function, die ohne den /v3-Rand antwortet, ist fuer das Paket nicht da.
  if (version !== 'v3') {
    return { erreichbar: false, netzfehler: false, befund: `HTTP ${status}, ohne Kopfzeile Kasseneck-Api-Version: v3 -- nicht ueber den /v3-Rand geroutet` };
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
      // ALL_CALLS, ist der Eintrag stumm geworden und niemandem faellt es auf.
      maengel.push(`Ausnahme ${eintrag.aufruf} steht nicht (mehr) in ALL_CALLS`);
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

const aufrufe = aufrufeLaden();
const partnerAufrufe = await partnerAufrufeLaden(aufrufe);
if (partnerAufrufe.size === 0) {
  process.stderr.write('Die Partner-Fassade fuehrt keinen Aufruf aus ALL_CALLS -- Abgleich kaputt.\n');
  process.exit(1);
}
const { nachName: ausnahmen, maengel } = ausnahmenLaden(aufrufe);

if (maengel.length > 0) {
  process.stderr.write(`Ausnahmeliste ist nicht in Ordnung:\n${maengel.map((m) => `  - ${m}`).join('\n')}\n`);
  process.exit(1);
}

// In der CI je Push nur der lokale Teil (Bau, Fassade, Ausnahmeliste): der
// Netzteil prueft, was live steht, nicht den Beitrag, und laeuft taeglich
// ueber .github/workflows/erreichbarkeit.yml.
if (process.env.ERREICHBARKEIT_NUR_LOKAL === '1') {
  process.stdout.write(`Lokaler Teil in Ordnung: ${aufrufe.length} Aufrufe, ${partnerAufrufe.size} Partner-Aufrufe, ${ausnahmen.size} Ausnahmen. Netzteil uebersprungen.\n`);
  process.exit(0);
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

process.stdout.write(
  `Erreichbarkeit unter ${BASIS}, ${BASIS_KASSE} (reine Kassenaufrufe) und ${BASIS_PARTNER} (Partner, ${partnerAufrufe.size} Aufrufe); ` +
    `Aufruf ohne Anmeldung, ${aufrufe.length} Aufrufe\n\n`,
);

const fehler = [];
let bestaetigt = 0;

for (const aufruf of aufrufe) {
  const ausnahme = ausnahmen.get(aufruf);
  const basis = basisFuer(aufruf, partnerAufrufe);
  const ergebnis = await abfragen(aufruf, basis);

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
    process.stdout.write(`  ok ${aufruf.padEnd(29)} ${basis === BASIS_KASSE ? 'kasse ' : '/v3   '}${ergebnis.befund}\n`);
  } else {
    fehler.push(`${aufruf} (${basis}): dort antwortet KEINE Function -- ${ergebnis.befund}`);
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
