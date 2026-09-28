// Standardwerte der Kassen-Einstellungen als Golden-Dateien, abgeleitet aus
// dem Vertrags-Export des Backends (fixtures/v3), nie von Hand:
//
// - fixtures/kasse-settings-standard.json: die Drahtform `/api/v3`
//   ({business, device}, englisch). `business` ist die Antwort fuer ein Konto
//   ohne gespeicherte Einstellungen (listRegisterUsersForDevice,
//   account_without_settings), `device` die fuer ein Geraet ohne gespeicherte
//   Einstellungen (getKasseSettings, cashier_unknown_device).
// - fixtures/stored/kasse-settings-standard.json: dieselben Werte in der
//   inneren Form ({betrieb, geraet}, deutsch), uebersetzt mit dem Schema
//   `getKasseSettings` und den Katalogen aus v3-vokabular.json. Diese Form
//   steht in Firestore und im Backend-Validator (kasse-settings-core.js).
//
// Sie sind die Zusage an alle Verbraucher: Backend, Browser-Kasse und die
// Flutter-Kasse rechnen mit denselben Vorgaben. Ein Zwilling, der still andere
// Standardwerte hat, faellt sonst erst am Tresen auf.
//
// Aufruf: `npm run fixtures:kasse` (bewusst, nie automatisch).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const lies = (pfad) => JSON.parse(readFileSync(new URL(`../fixtures/v3/${pfad}`, import.meta.url), 'utf8'));
const antworten = lies('antworten/kasse.json').endpoints;
const vokabular = lies('v3-vokabular.json');

const fall = (endpunkt, name) => {
  const gefunden = antworten[endpunkt].cases.find((c) => c.case === name);
  if (!gefunden || gefunden.response.status !== 'success') throw new Error(`Fall ${endpunkt}/${name} fehlt im Vertrag`);
  return gefunden.response.data;
};

const draht = {
  business: fall('listRegisterUsersForDevice', 'account_without_settings').settings.business,
  device: fall('getKasseSettings', 'cashier_unknown_device').device,
};

const schema = vokabular.schemas.getKasseSettings;
const katalog = (feldpfad) => {
  const verweis = schema.werte[feldpfad];
  if (!verweis) return null;
  const karte = vokabular.catalogs[verweis.$catalog];
  // Katalog innen -> aussen, hier gebraucht aussen -> innen.
  return new Map(Object.entries(karte).map(([innen, aussen]) => [aussen, innen]));
};

function nachInnen(teil) {
  const teilSchema = schema.data[teil];
  const raus = {};
  for (const [aussen, wert] of Object.entries(draht[teil])) {
    const eintrag = teilSchema[aussen];
    if (eintrag === undefined) throw new Error(`${teil}.${aussen} fehlt im Schema getKasseSettings`);
    if (typeof eintrag === 'object') {
      // Verschachtelte Karte mit eigenen Namen (shortcuts -> tasten).
      const innen = {};
      for (const [k, v] of Object.entries(wert)) {
        if (typeof eintrag[k] !== 'string') throw new Error(`${teil}.${aussen}.${k} fehlt im Schema`);
        innen[eintrag[k]] = v;
      }
      raus[eintrag.__] = innen;
      continue;
    }
    const werte = katalog(`${teil}.${aussen}`);
    if (werte && !werte.has(wert)) throw new Error(`${teil}.${aussen}: Wert ${wert} fehlt im Katalog`);
    raus[eintrag] = werte ? werte.get(wert) : wert;
  }
  return raus;
}

const innen = { [schema.data.business.__]: nachInnen('business'), [schema.data.device.__]: nachInnen('device') };

const schreibe = (ziel, inhalt) => writeFileSync(new URL(ziel, import.meta.url), JSON.stringify(inhalt, null, 2) + '\n');
schreibe('../fixtures/kasse-settings-standard.json', draht);
mkdirSync(new URL('../fixtures/stored/', import.meta.url), { recursive: true });
schreibe('../fixtures/stored/kasse-settings-standard.json', innen);
console.log('Kassen-Standardwerte geschrieben:', Object.keys(draht.business).length, 'Betriebs- und',
  Object.keys(draht.device).length, 'Geraetefelder (Draht und innere Form)');
