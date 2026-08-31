/**
 * Die Aufrufe der Partner-API — Betriebe, Signatur, Kassen.
 *
 * Jede Funktion nimmt den Transport als ersten Parameter und ist einzeln
 * importierbar; die Fassade [createPartnerApi] bindet ihn nur einmal.
 *
 * **Was hier geprueft wird und was nicht.** Vor dem Senden prueft dieser Client
 * nur, was er ohne den Server wissen kann: dass eine Kennung ueberhaupt da ist,
 * dass eine Liste nicht leer ist, dass eine Zahl im erlaubten Bereich liegt.
 * Die fachliche Pruefung der Betriebsdaten (Steuernummer samt Pruefziffer, UID,
 * PLZ, Gericht) macht das Backend mit `@kreiseck/validator` — sie hier zu
 * wiederholen hiesse, zwei Wahrheiten zu haben, von denen eine veraltet.
 * Ein Formfehler kommt als `KasseneckApiError` mit `code:"validation"` zurueck;
 * `partnerFeldFehler(fehler)` macht `data.errors[]` daraus. **Es entsteht dabei
 * nichts** — der Aufruf ist folgenlos wiederholbar.
 *
 * Nach dem Senden wird nichts hart gecastet: fehlt ein zugesagtes Feld, wirft
 * der Aufruf `KasseneckValidationError` mit `scope:'response'` statt spaeter
 * einen `TypeError` an unpassender Stelle.
 */

import type { InternerTransport } from '../client/aufrufe.js';
import { KasseneckValidationError } from '../client/errors.js';
import { alsSecret } from './secret.js';
import type {
  AvvStand,
  KundenZeile,
  ActivateCashregisterResult,
  CreateCashregisterOptions,
  CreateCashregisterResult,
  CreateCustomerOptions,
  CreateCustomerResult,
  CustomerCredentials,
  FonLinkResult,
  Kasse,
  KassenListe,
  Kunde,
  KundenListe,
  ListCustomersOptions,
  PartnerInfo,
  RequestSignatureResult,
  SignaturAntrag,
  SignaturStand,
} from './typen.js';

// ---------------------------------------------------------------------------
// Kleine Helfer — bewusst hier und nicht in einem Sammelmodul: sie gehoeren zur
// Auswertung dieser Antworten und zu nichts sonst.
// ---------------------------------------------------------------------------

/** Ein Objekt aus der Antwort, oder ein leeres — nie ein Cast auf gut Glueck. */
function objekt(wert: unknown): Record<string, unknown> {
  return wert !== null && typeof wert === 'object' && !Array.isArray(wert)
    ? (wert as Record<string, unknown>)
    : {};
}

function liste(wert: unknown): unknown[] {
  return Array.isArray(wert) ? wert : [];
}

function text(wert: unknown, rueckfall = ''): string {
  return typeof wert === 'string' ? wert : rueckfall;
}

function textOderNull(wert: unknown): string | null {
  return typeof wert === 'string' ? wert : null;
}

function zahlOderNull(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null;
}

function jaNein(wert: unknown, rueckfall = false): boolean {
  return typeof wert === 'boolean' ? wert : rueckfall;
}

/**
 * Verlangt ein Feld der Antwort. Der Fehler nennt das Feld und den Vorgang,
 * damit ein Aufrufer nicht raten muss, welcher der Aufrufe etwas anderes
 * schickte als zugesagt.
 */
function verlangt(wert: unknown, vorgang: string, feld: string): Record<string, unknown> {
  if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) {
    throw new KasseneckValidationError(vorgang, `Antwort enthaelt kein ${feld}`, 'response');
  }
  return wert as Record<string, unknown>;
}

/** Eine Pflichteingabe des Aufrufers — der Fehler geht raus, bevor etwas gesendet wird. */
function pflicht(wert: unknown, vorgang: string, feld: string): string {
  const s = typeof wert === 'string' ? wert.trim() : '';
  if (!s) throw new KasseneckValidationError(vorgang, `${feld} fehlt`, 'request');
  return s;
}

// ---------------------------------------------------------------------------
// Partner
// ---------------------------------------------------------------------------

/**
 * Wer bin ich, in welcher Umgebung, mit welchen Rechten — und welche Apps
 * gehoeren mir. `apps[].id` ist die `appId` fuer [createPartnerCustomer].
 *
 * Der guenstigste Selbsttest beim Hochfahren: er beweist Schluessel, Umgebung
 * und Rechte in einem Aufruf.
 */
export async function getPartnerInfo(rufen: InternerTransport): Promise<PartnerInfo> {
  const daten = objekt(await rufen<unknown>('getPartnerInfo'));
  const partner = verlangt(daten['partner'], 'getPartnerInfo', 'partner');
  const key = objekt(daten['key']);
  return {
    partner: {
      id: text(partner['id']),
      name: text(partner['name']),
      status: text(partner['status'], 'aktiv'),
      // Fehlt das Feld, gilt NEIN. Eine Berechtigung, die man nicht
      // ausdruecklich hat, hat man nicht — ein `true` aus Kulanz erzeugte
      // hier einen Aufruf, der `zugang_nicht_erlaubt` bekommt.
      darfZugangEinrichten: jaNein(partner['darfZugangEinrichten']),
    },
    env: text(daten['env']) === 'test' ? 'test' : 'live',
    scopes: liste(daten['scopes']).filter((s): s is string => typeof s === 'string'),
    key: {
      hint: textOderNull(key['hint']),
      label: textOderNull(key['label']),
      createdAt: zahlOderNull(key['createdAt']),
      scopes: liste(key['scopes']).filter((s): s is string => typeof s === 'string'),
    },
    apps: liste(daten['apps']).map((eintrag) => {
      const a = objekt(eintrag);
      return {
        id: text(a['id']),
        name: text(a['name']),
        status: text(a['status']),
        platform: textOderNull(a['platform']),
        verteilungen: liste(a['verteilungen']),
        platforms: liste(a['platforms']).filter((p): p is string => typeof p === 'string'),
        symbol: a['symbol'] ? { url: text(objekt(a['symbol'])['url']) } : null,
        veroeffentlichung: jaNein(a['veroeffentlichung']),
        listungErlaubt: jaNein(a['listungErlaubt']),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Betriebe
// ---------------------------------------------------------------------------

/**
 * Legt einen Betrieb an.
 *
 * **Ohne Panel-Zugang**, solange nicht `zugang:{einladen:true}` dabeisteht:
 * viele Betriebe arbeiten ausschliesslich in der App des Partners. Fuer die
 * Einladung braucht das Partner-Konto ausserdem
 * `partner.darfZugangEinrichten`.
 *
 * **`env` waehlt die Umgebung.** Ohne Angabe entscheidet der Schluessel; ein
 * Live-Schluessel darf mit `env:"test"` einen Testbetrieb anlegen, ein
 * Test-Schluessel niemals einen Live-Betrieb (`live_not_allowed`).
 *
 * **`idempotencyKey` benutzen.** Ein verlorener Antwortweg ist kein
 * Sonderfall, und ohne Schluessel legt der zweite Versuch einen zweiten Betrieb
 * an. Mit Schluessel kommt die gespeicherte Antwort zurueck (`wiederholt:true`)
 * — auch dann, wenn der Rumpf inzwischen abweicht. Die eigene Kundennummer ist
 * der natuerliche Wert dafuer.
 */
export async function createPartnerCustomer(
  rufen: InternerTransport,
  optionen: CreateCustomerOptions,
): Promise<CreateCustomerResult> {
  const appId = pflicht(optionen?.appId, 'createPartnerCustomer', 'appId');
  const betrieb = optionen?.betrieb;
  if (betrieb === null || typeof betrieb !== 'object') {
    throw new KasseneckValidationError('createPartnerCustomer', 'betrieb fehlt', 'request');
  }
  const daten = objekt(
    await rufen<unknown>('createPartnerCustomer', {
      appId,
      betrieb,
      idempotencyKey: optionen.idempotencyKey,
      zugang: optionen.zugang,
      env: optionen.env,
    }),
  );
  const customerId = textOderNull(daten['customerId']);
  if (!customerId) {
    throw new KasseneckValidationError('createPartnerCustomer', 'Antwort enthaelt keine customerId', 'response');
  }
  const zugang = objekt(daten['zugang']);
  return {
    customerId,
    status: text(daten['status'], 'angelegt'),
    env: text(daten['env']) === 'test' ? 'test' : 'live',
    firma: text(daten['firma']),
    appId: text(daten['appId'], appId),
    zugang: { eingeladen: jaNein(zugang['eingeladen']), sentTo: textOderNull(zugang['sentTo']) },
    naechsteSchritte: liste(daten['naechsteSchritte']).filter((s): s is string => typeof s === 'string'),
    wiederholt: jaNein(daten['wiederholt']),
  };
}

/** Betriebe dieses Partners, seitenweise. `cursor` aus der Antwort setzt fort. */
export async function listPartnerCustomers(
  rufen: InternerTransport,
  optionen: ListCustomersOptions = {},
): Promise<KundenListe> {
  if (optionen.limit !== undefined && (!Number.isInteger(optionen.limit) || optionen.limit < 1 || optionen.limit > 200)) {
    throw new KasseneckValidationError('listPartnerCustomers', 'limit muss zwischen 1 und 200 liegen', 'request');
  }
  const daten = objekt(
    await rufen<unknown>('listPartnerCustomers', {
      status: optionen.status,
      limit: optionen.limit,
      cursor: optionen.cursor,
    }),
  );
  return {
    kunden: liste(daten['kunden']).map(kundenZeile),
    cursor: textOderNull(daten['cursor']),
    gesamt: zahlOderNull(daten['gesamt']) ?? 0,
  };
}

function kundenZeile(eintrag: unknown): KundenZeile {
  const k = objekt(eintrag);
  return {
    customerId: text(k['customerId']),
    firma: text(k['firma']),
    status: text(k['status']),
    appId: textOderNull(k['appId']),
    env: text(k['env']) === 'test' ? ('test' as const) : ('live' as const),
    createdAt: zahlOderNull(k['createdAt']),
    avv: avvStand(k['avv']),
  };
}

/**
 * Der Vertragsstand, **falls** die Antwort ihn ueberhaupt fuehrt — heute tut
 * sie das nicht, dann bleibt es bei `null`. Kein erfundenes `offen`: „nicht
 * mitgeliefert" und „nicht bestaetigt" duerfen fuer einen Aufrufer nicht
 * dasselbe sein.
 */
function avvStand(wert: unknown): AvvStand | null {
  if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) return null;
  const a = wert as Record<string, unknown>;
  return {
    status: text(a['status']),
    version: textOderNull(a['version']),
    bestaetigtAt: zahlOderNull(a['bestaetigtAt']),
    modus: textOderNull(a['modus']),
  };
}

/** Ein Betrieb mit allem, was der Partner ueber ihn sehen darf — nie Geheimnisse. */
export async function getPartnerCustomer(rufen: InternerTransport, customerId: string): Promise<Kunde> {
  const id = pflicht(customerId, 'getPartnerCustomer', 'customerId');
  const daten = objekt(await rufen<unknown>('getPartnerCustomer', { customerId: id }));
  const k = verlangt(daten['kunde'], 'getPartnerCustomer', 'kunde');
  const fon = objekt(k['fon']);
  const zugang = k['zugang'];
  return {
    ...kundenZeile(k),
    statusAt: zahlOderNull(k['statusAt']),
    liveEnabled: jaNein(k['liveEnabled']),
    angelegtAt: zahlOderNull(k['angelegtAt']),
    angelegtVia: textOderNull(k['angelegtVia']),
    betrieb: objekt(k['betrieb']),
    fon: { eingerichtet: jaNein(fon['eingerichtet']), verifiedAt: zahlOderNull(fon['verifiedAt']) },
    zugang:
      zugang === null || typeof zugang !== 'object'
        ? null
        : {
            email: textOderNull(objekt(zugang)['email']),
            eingeladenAt: zahlOderNull(objekt(zugang)['eingeladenAt']),
            angenommenAt: zahlOderNull(objekt(zugang)['angenommenAt']),
          },
  };
}

/**
 * Schickt dem Betrieb den Einrichtungs-Link fuer seinen FinanzOnline-Zugang.
 * Ohne diesen Zugang gibt es live keine Signatureinheit (`fon_missing`).
 *
 * Die Antwort nennt den Empfaenger **maskiert** — die Adresse gibt das Backend
 * nie im Klartext aus.
 */
export async function sendPartnerCustomerFonLink(
  rufen: InternerTransport,
  customerId: string,
): Promise<FonLinkResult> {
  const id = pflicht(customerId, 'sendPartnerCustomerFonLink', 'customerId');
  const daten = objekt(await rufen<unknown>('sendPartnerCustomerFonLink', { customerId: id }));
  return {
    customerId: text(daten['customerId'], id),
    sentTo: text(daten['sentTo']),
    expiresAt: zahlOderNull(daten['expiresAt']) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Signatur
// ---------------------------------------------------------------------------

function antrag(eintrag: unknown): SignaturAntrag {
  const a = objekt(eintrag);
  const fehler = a['fehler'];
  return {
    requestId: text(a['requestId']),
    status: text(a['status']),
    statusText: text(a['statusText']),
    art: text(a['art'], 'signaturkarte'),
    vdaId: textOderNull(a['vdaId']),
    signatureId: textOderNull(a['signatureId']),
    fehler:
      fehler === null || typeof fehler !== 'object'
        ? null
        : {
            code: textOderNull(objekt(fehler)['code']),
            meldung: textOderNull(objekt(fehler)['meldung']),
            rc: textOderNull(objekt(fehler)['rc']),
          },
    angefordertVia: textOderNull(a['angefordertVia']),
    createdAt: zahlOderNull(a['createdAt']),
    updatedAt: zahlOderNull(a['updatedAt']),
    historie: liste(a['historie']).map((h) => {
      const e = objekt(h);
      return {
        von: textOderNull(e['von']),
        nach: text(e['nach']),
        at: zahlOderNull(e['at']) ?? 0,
        grund: textOderNull(e['grund']),
      };
    }),
  };
}

/**
 * Beantragt die Signatureinheit. Kasseneck laesst die Karte beim
 * Vertrauensdiensteanbieter **auf diesen Betrieb** ausstellen und meldet sie
 * bei FinanzOnline an; einen Vorrat fertiger Karten gibt es nicht.
 *
 * Der Antrag erzeugt sofort ein Signatur-OBJEKT: `antrag.requestId` ist
 * zugleich die `signaturId`, auf die sich eine Kasse beruft — auch solange
 * noch keine Karte zugewiesen ist.
 *
 * **Je Betrieb laeuft nur ein Antrag.** Ein zweiter Aufruf liefert den
 * laufenden zurueck (`wiederholt:true`) und ist damit folgenlos wiederholbar.
 * Eine WEITERE Signatur (Ersatzkarte, zweiter Standort) entsteht nur mit
 * `weitere:true` — hoechstens zehn je Betrieb (`signature_limit`). Der
 * Abschluss kommt als Ereignis `signature.ready`, nicht als Antwort auf diesen
 * Aufruf.
 */
export async function requestCustomerSignature(
  rufen: InternerTransport,
  customerId: string,
  optionen: { art?: string; weitere?: boolean } = {},
): Promise<RequestSignatureResult> {
  const id = pflicht(customerId, 'requestCustomerSignature', 'customerId');
  const daten = objekt(
    await rufen<unknown>('requestCustomerSignature', {
      customerId: id,
      art: optionen.art,
      weitere: optionen.weitere,
    }),
  );
  return {
    antrag: antrag(verlangt(daten['antrag'], 'requestCustomerSignature', 'antrag')),
    wiederholt: jaNein(daten['wiederholt']),
    hinweis: textOderNull(daten['hinweis']),
  };
}

/** Stand der Signatur eines Betriebs samt aller Antraege und des FON-Zugangs. */
export async function getCustomerSignatureStatus(
  rufen: InternerTransport,
  customerId: string,
): Promise<SignaturStand> {
  const id = pflicht(customerId, 'getCustomerSignatureStatus', 'customerId');
  const daten = objekt(await rufen<unknown>('getCustomerSignatureStatus', { customerId: id }));
  const signatur = objekt(daten['signatur']);
  const fon = objekt(daten['fon']);
  return {
    signatur: {
      bereit: jaNein(signatur['bereit']),
      signatureId: textOderNull(signatur['signatureId']),
      vdaId: textOderNull(signatur['vdaId']),
    },
    antraege: liste(daten['antraege']).map(antrag),
    fon: { vorhanden: jaNein(fon['vorhanden']), geprueftAt: zahlOderNull(fon['geprueftAt']) },
  };
}

// ---------------------------------------------------------------------------
// Kassen
// ---------------------------------------------------------------------------

function kasse(eintrag: unknown): Kasse {
  const k = objekt(eintrag);
  const fehler = k['letzterFehler'];
  return {
    cashregisterId: text(k['cashregisterId']),
    name: textOderNull(k['name']),
    status: text(k['status']),
    statusText: text(k['statusText']),
    automatisch: jaNein(k['automatisch'], true),
    schritt: textOderNull(k['schritt']),
    schrittText: textOderNull(k['schrittText']),
    erledigt: liste(k['erledigt']).filter((s): s is string => typeof s === 'string'),
    schritte: liste(k['schritte']).map((s) => ({ key: text(objekt(s)['key']), text: text(objekt(s)['text']) })),
    signatureId: textOderNull(k['signatureId']),
    versuche: zahlOderNull(k['versuche']) ?? 0,
    letzterFehler:
      fehler === null || typeof fehler !== 'object'
        ? null
        : {
            code: textOderNull(objekt(fehler)['code']),
            meldung: textOderNull(objekt(fehler)['meldung']),
            rc: textOderNull(objekt(fehler)['rc']),
            schritt: textOderNull(objekt(fehler)['schritt']),
            at: zahlOderNull(objekt(fehler)['at']),
          },
    createdAt: zahlOderNull(k['createdAt']),
  };
}

/**
 * Legt eine Kasse an.
 *
 * **Jede Kasse bezieht sich auf eine Signatur.** Ohne eine einzige — auch eine
 * noch laufende zaehlt — entsteht keine (`signature_missing`); bei mehreren
 * muss `signaturId` dastehen (`signature_ambiguous`).
 *
 * **Darf vor der fertigen Signatur aufgerufen werden:** die Kasse bleibt dann
 * auf `entwurf` und geht von selbst live, sobald IHRE Signatur bereit ist
 * (`automatisch:true`, Vorgabe). `inbetriebnahme.grund` sagt, warum gerade
 * nichts lief: `signature_not_ready` oder `automatik_aus`.
 *
 * Hoechstens 20 Kassen je Betrieb (`cashregister_limit`); ohne gebuchtes Modul
 * `module_inactive`.
 */
export async function createCustomerCashregister(
  rufen: InternerTransport,
  optionen: CreateCashregisterOptions,
): Promise<CreateCashregisterResult> {
  const id = pflicht(optionen?.customerId, 'createCustomerCashregister', 'customerId');
  const daten = objekt(
    await rufen<unknown>('createCustomerCashregister', {
      customerId: id,
      automatisch: optionen.automatisch,
      signaturId: optionen.signaturId,
    }),
  );
  const ib = objekt(daten['inbetriebnahme']);
  return {
    kasse: kasse(verlangt(daten['kasse'], 'createCustomerCashregister', 'kasse')),
    inbetriebnahme: {
      gestartet: jaNein(ib['gestartet']),
      ok: typeof ib['ok'] === 'boolean' ? ib['ok'] : null,
      schritt: textOderNull(ib['schritt']),
      grund: textOderNull(ib['grund']),
    },
  };
}

/**
 * Nimmt eine Kasse in Betrieb — von Hand, wenn `automatisch:false` gilt oder
 * ein Lauf abgebrochen ist.
 *
 * **Jeder Schritt der Kette ist idempotent**, der Startbeleg entsteht nach
 * RKSV genau einmal und ein vorhandener wird erkannt. Ein Wiederholungsaufruf
 * setzt deshalb an der Bruchstelle an und macht nichts doppelt; eine bereits
 * laufende Kasse antwortet mit `unveraendert:true`. Das ist der eine
 * veraendernde Aufruf dieses Clients, der ohne Idempotenzschluessel gefahrlos
 * wiederholbar ist — weil der Server ihn so gebaut hat.
 */
export async function activateCashregister(
  rufen: InternerTransport,
  customerId: string,
  cashregisterId: string,
): Promise<ActivateCashregisterResult> {
  const kunde = pflicht(customerId, 'activateCashregister', 'customerId');
  const kassenId = pflicht(cashregisterId, 'activateCashregister', 'cashregisterId');
  const daten = objekt(await rufen<unknown>('activateCashregister', { customerId: kunde, cashregisterId: kassenId }));
  return {
    kasse: kasse(verlangt(daten['kasse'], 'activateCashregister', 'kasse')),
    unveraendert: jaNein(daten['unveraendert']),
  };
}

/** Die Kassen eines Betriebs samt Stand der Inbetriebnahme — **nie** Token. */
export async function listCustomerCashregisters(
  rufen: InternerTransport,
  customerId: string,
): Promise<KassenListe> {
  const id = pflicht(customerId, 'listCustomerCashregisters', 'customerId');
  const daten = objekt(await rufen<unknown>('listCustomerCashregisters', { customerId: id }));
  return {
    customerId: text(daten['customerId'], id),
    kassen: liste(daten['kassen']).map(kasse),
    signaturBereit: jaNein(daten['signaturBereit']),
  };
}

/**
 * Holt die **Geheimnisse des Betriebs**: seinen `api_key` und die Token seiner
 * Kassen. Damit signiert eine App in seinem Namen Belege — und ein Beleg ist
 * nach RKSV nicht zuruecknehmbar.
 *
 * Braucht den Scope `credentials:read`, der **nicht** zum Standardsatz gehoert
 * und keinem bestehenden Schluessel nachtraeglich hinzugefuegt wird; dafuer
 * wird ein eigener Schluessel angelegt. Jeder Abruf wird mitgeschrieben
 * (Partner, Schluessel, Zeitpunkt) und ist fuer den Betrieb sichtbar.
 *
 * **Nur verschluesselt speichern. Nie protokollieren, nie in eine Mail, nie in
 * einen Fehlerbericht.** Die Werte kommen darum als [KasseneckSecret] und
 * nicht als `string` zurueck: `console.log`, `JSON.stringify` und jede
 * Zeichenketten-Umwandlung zeigen eine Maske, heraus kommt man nur ueber
 * `.reveal()`.
 */
export async function getCustomerCredentials(
  rufen: InternerTransport,
  customerId: string,
): Promise<CustomerCredentials> {
  const id = pflicht(customerId, 'getCustomerCredentials', 'customerId');
  const daten = objekt(await rufen<unknown>('getCustomerCredentials', { customerId: id }));
  return {
    customerId: text(daten['customerId'], id),
    firma: text(daten['firma']),
    env: text(daten['env']) === 'test' ? 'test' : 'live',
    apiKey: alsSecret('apiKey', daten['apiKey']),
    kassen: liste(daten['kassen']).map((eintrag) => {
      const k = objekt(eintrag);
      return {
        cashregisterId: text(k['cashregisterId']),
        name: textOderNull(k['name']),
        live: jaNein(k['live']),
        cashregisterToken: alsSecret('cashregisterToken', k['cashregisterToken']),
      };
    }),
    hinweis: text(daten['hinweis']),
  };
}
