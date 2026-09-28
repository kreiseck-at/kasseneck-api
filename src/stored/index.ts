/**
 * `@kreiseck/kasseneck-api/stored`: gespeicherte Firestore-Dokumente (innen,
 * deutsch) als dieselben englischen Modelle, die der Draht `/v3` liefert.
 *
 * Fuer Verbraucher, die Firestore direkt lesen (Admin-Panel, Echtzeit-Listener
 * auf Belege). So gibt es in 1.0 ein englisches Modell und keinen zweiten
 * Draht-Dialekt: jede Funktion hier uebersetzt das Dokument genau so, wie der
 * Server es unter `/v3` bzw. `/api/v3` hinausgibt (Schluessel und Werte aus
 * dem Vertrags-Export `fixtures/v3/v3-vokabular.json`), und liest das
 * Ergebnis dann mit demselben Leser wie eine Antwort. Ein Test haelt jedes
 * gespeicherte Dokument des Vertrags gegen seine Antwort.
 *
 * Belege kommen im Kanal der Kasse (`app`): mit Anbieterdaten der Zahlungen
 * (`payments[].providerData`/`providerPaymentId`, alte Kartenfelder).
 */
import { belegAusHuelle, belegMitFirmaAusHuelle, type ReceiptWithCompany } from '../client/receipts.js';
import { fromReceiptCompanyPayload, type ReceiptCompany, type ReceiptCompanyPayload } from '../models/receipt-company.js';
import type { Receipt, RegistrationInfo } from '../models/receipt.js';
import { buildReceiptLayout, CURRENT_LAYOUT_RULESET, receiptSignatureIsTest, type LayoutRuleset, type ReceiptLayout } from '../receipt/layout.js';
import { sanitizePosSettings, type PosSettings } from '../kasse/settings.js';
import { fromPosArticlePayload, type PosArticle, type PosArticlePayload } from '../kasse/artikel.js';
import { KasseneckValidationError } from '../client/errors.js';
import {
  _receiptEnvelopeToWire, _storedArticleToWire, _storedPosSettingsToWire, _storedReceiptInner, _storedReceiptToWire,
} from './draht.js';

type Objekt = Record<string, unknown>;
const istObjekt = (w: unknown): w is Objekt => w !== null && typeof w === 'object' && !Array.isArray(w);

/** Ein Firestore-Dokument mit seiner Kennung (die nicht in den Daten steht). */
export interface StoredDocument {
  id: string;
  data: unknown;
}

// ---- Belege -----------------------------------------------------------------

/**
 * Ein Belegdokument (`users/{uid}/cashregisters/{id}/receipts/{id}`) als
 * [Receipt], wie `getReceipt` am Kassenweg ihn liefert. Wirft
 * `KasseneckValidationError`, wenn es kein Belegdokument ist.
 */
export function fromStoredReceipt(doc: unknown): Receipt {
  return belegAusHuelle({ receipt: zeilenAlsText(_storedReceiptToWire(doc, 'fromStoredReceipt')) }, 'fromStoredReceipt');
}

/**
 * Freitextzeilen (`customerDetails`, `legalMessage`) als Liste gespeichert:
 * wie am Server (beleg-layout.belegPayload) als Text mit Zeilenumbruechen
 * lesen, statt am Leser zu scheitern.
 */
function zeilenAlsText(beleg: Objekt): Objekt {
  const raus = { ...beleg };
  for (const feld of ['customerDetails', 'legalMessage']) {
    const w = raus[feld];
    if (Array.isArray(w)) raus[feld] = w.filter(Boolean).join('\n');
  }
  return raus;
}

export interface StoredReceiptOptions {
  /**
   * Die Kopf-Version dieses Belegs (`users/{uid}/beleg_kopf/{id}`): die mit
   * `receipt.headerVersionId` (gespeichert `kopfId`), bei Altbelegen ohne
   * Zuordnung die zum Belegzeitpunkt gueltige (`gueltigAb`/`gueltigBis`).
   */
  headerVersion: StoredDocument;
  /**
   * Das Kontodokument (`users/{uid}`): Logo, wenn die Version noch keines
   * kennt, und die Logo-Stufe (`register_settings.kasse.logoSkala`).
   */
  account?: unknown;
  /** Konto einer Testumgebung (Aufdruck TESTKASSE, keine Testsignatur-Warnung). */
  testCashregister?: boolean;
  /**
   * Registrierdaten fuer einen Nullbeleg, der sie nicht selbst traegt
   * (Altbestand; der Server schlaegt sie an Karte und Kasse nach). Fehlt die
   * Angabe, bleiben beide Zeitpunkte leer.
   */
  registrationInfo?: RegistrationInfo;
}

/**
 * Ein Belegdokument samt Firma und Layout, wie `getReceiptWithCompany` am
 * Kassenweg es liefert: Kopf und Fuss aus der Kopf-Version, das Layout mit
 * demselben Regelwerk und in derselben Breite (80 mm) wie am Server.
 */
export function fromStoredReceiptWithCompany(doc: unknown, options: StoredReceiptOptions): ReceiptWithCompany {
  const name = 'fromStoredReceiptWithCompany';
  if (!istObjekt(options) || !istObjekt(options.headerVersion) || typeof options.headerVersion.id !== 'string') {
    throw new KasseneckValidationError(name, 'headerVersion { id, data } fehlt', 'request');
  }
  const beleg = _storedReceiptInner(doc, name);
  const testKasse = options.testCashregister === true;
  const nullbeleg = beleg.receiptType === 'zero';
  const huelle: Objekt = {
    receipt: beleg,
    ...betriebsfelder(options.headerVersion.data, options.account, beleg),
    logo_skala: logoStufe(options.account),
    kopfId: options.headerVersion.id,
    pruefangaben: nullbeleg && istObjekt(beleg.pruefangaben) ? beleg.pruefangaben : null,
    testSignatur: receiptSignatureIsTest({ qr: typeof beleg.qr === 'string' ? beleg.qr : '' }) && !testKasse,
    testKasse,
  };
  const draht = _receiptEnvelopeToWire(huelle);
  draht.receipt = zeilenAlsText(draht.receipt as Objekt);
  const raus = belegMitFirmaAusHuelle(draht, name);
  if (nullbeleg && raus.registrationInfo === null) {
    raus.registrationInfo = options.registrationInfo ?? { cardRegisteredAt: null, cashregisterRegisteredAt: null };
  }
  raus.layout = layoutWieServer(raus, beleg.layoutRegeln);
  return raus;
}

/**
 * Layout wie `beleg-layout.layoutFuerBeleg`: 80 mm, Regelwerk mindestens das
 * aktuelle. Kann der Server es nicht bauen, liefert er `null` (dann baut
 * [receiptLayoutFromResult] selbst); ebenso hier.
 */
function layoutWieServer(b: ReceiptWithCompany, regelwerk: unknown): ReceiptLayout | null {
  const ruleset = Math.max(Number(regelwerk) || 1, CURRENT_LAYOUT_RULESET) as LayoutRuleset;
  try {
    return buildReceiptLayout(b.receipt, b.company, {
      paperSize: 'mm80', ruleset, testCashregister: b.testCashregister, testSignature: b.testSignature, registrationInfo: b.registrationInfo,
    });
  } catch {
    return null;
  }
}

// ---- Firma ------------------------------------------------------------------

const KOPF_FELDER = ['companyName', 'street', 'zip', 'city', 'phone', 'uid', 'taxnr', 'isSmallBusiness',
  'footer1', 'footer2', 'footer3', 'footer4', 'thanksMessage', 'showKreiseckLogo', 'logoUrl'] as const;

/** Zwilling von `beleg-kopf-core.nurKopf`: Luecken der Version mit denselben Vorgaben. */
function nurKopf(version: unknown): Objekt {
  const v = istObjekt(version) ? version : {};
  const raus: Objekt = {};
  for (const f of KOPF_FELDER) {
    if (f === 'logoUrl') { if (v.logoUrl !== undefined) raus.logoUrl = v.logoUrl; continue; }
    raus[f] = v[f] !== undefined ? v[f]
      : f === 'thanksMessage' ? []
        : f === 'isSmallBusiness' || f === 'showKreiseckLogo' ? false
          : f === 'uid' || f.startsWith('footer') ? null : '';
  }
  return raus;
}

/**
 * Betriebsfelder der Beleg-Huelle aus einer Kopf-Version (Zwilling von
 * `alsBetriebPayload` und `logoFuerBeleg`, beleg-kopf-core.js): innere
 * Namen (`uid`, `taxnr`), die der Rand dann uebersetzt.
 */
function betriebsfelder(version: unknown, account: unknown, beleg: { receiptType?: unknown } | undefined): Objekt {
  const k = nurKopf(version);
  const dank = Array.isArray(k.thanksMessage) ? k.thanksMessage : [];
  const konto = istObjekt(account) ? account : {};
  let logo: unknown;
  if (beleg && beleg.receiptType === 'zero') logo = null;
  else if (istObjekt(version) && version.logoUrl !== undefined) logo = version.logoUrl || null;
  else logo = (typeof konto.logo_url === 'string' && konto.logo_url) || null;
  return {
    company: k.companyName, street: k.street, zip: k.zip, city: k.city, phone: k.phone,
    uid: k.uid, taxnr: k.taxnr, is_small_business: k.isSmallBusiness,
    footer1: k.footer1, footer2: k.footer2, footer3: k.footer3, footer4: k.footer4,
    thanks_message: dank.length ? dank.join('\n') : null,
    kreiseck_logo: k.showKreiseckLogo,
    logo_url: logo,
  };
}

/** Zwilling von `logoStufeFuerKonto`: Kasse-Einstellung `logoSkala`, sonst M. */
function logoStufe(account: unknown): string {
  const konto = istObjekt(account) ? account : {};
  const rs = istObjekt(konto.register_settings) ? konto.register_settings : {};
  const kasse = istObjekt(rs.kasse) ? rs.kasse : {};
  return ['S', 'M', 'L', 'XL'].includes(kasse.logoSkala as string) ? (kasse.logoSkala as string) : 'M';
}

/**
 * Eine Kopf-Version (`users/{uid}/beleg_kopf/{id}`) als [ReceiptCompany], wie
 * die Beleg-Antwort sie traegt. `receipt`: ein Nullbeleg traegt kein Logo;
 * `account`: kennt die Version noch kein Logo, gilt das des Kontos.
 */
export function fromStoredCompany(headerVersion: unknown, options: { account?: unknown; receipt?: { receiptType?: unknown } } = {}): ReceiptCompany {
  const draht = _receiptEnvelopeToWire(betriebsfelder(headerVersion, options.account, options.receipt));
  return fromReceiptCompanyPayload(draht as ReceiptCompanyPayload);
}

// ---- Kassen-Einstellungen ------------------------------------------------------

/**
 * Gespeicherte Kassen-Einstellungen als [PosSettings], wie `getKasseSettings`
 * am Kassenweg sie liefert: `betrieb` aus
 * `users/{uid}.register_settings.kasse`, `geraet` aus
 * `users/{uid}/register_devices/{id}.kasse` (fehlt = Vorgaben).
 *
 * Wie beim Lesen vom Draht bleibt ein unbekannter Wert eines bekannten Feldes
 * woertlich stehen ([unknownPosSettingValues] nennt ihn), und Reste der
 * inneren Form 0.x fallen auf die Vorgabe zurueck. Anders als der Server
 * prueft dieser Weg keine Bereiche: einen gespeicherten Wert, den der Server
 * beim Lesen als ungueltig weglaesst, zeigt er als unbekannten Wert.
 */
export function fromStoredPosSettings(stored: { betrieb?: unknown; geraet?: unknown } | null | undefined): PosSettings {
  return sanitizePosSettings(_storedPosSettingsToWire(stored));
}

// ---- Artikel ------------------------------------------------------------------

/**
 * Ein Artikeldokument (`users/{uid}/articles/{id}`) als [PosArticle], wie
 * `listMyArticles` am Kassenweg ihn liefert. Felder, die kein Schreibweg
 * kennt, und Katalogwerte, die der Vertrag nicht kennt, fallen wie am Server
 * weg.
 */
export function fromStoredArticle(id: string, stored: unknown): PosArticle {
  return fromPosArticlePayload(_storedArticleToWire(id, stored) as PosArticlePayload);
}
