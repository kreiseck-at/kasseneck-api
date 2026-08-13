/**
 * Firmen- und Druckdaten eines Belegs — Zwilling der Metadaten von
 * `KasseneckReceipt` in kasseneck_api/lib/models/kasseneck_receipt.dart
 * (`toMetadataJson`/`fromMetadata`).
 *
 * Das Backend liefert sie **neben** dem Beleg: `getReceipt` und `createReceipt`
 * legen Firma, Anschrift, Steuernummer, UID, Fusszeilen, Logo-Adresse und das
 * Kleinunternehmer-Kennzeichen direkt in die Antwort (functions/index.js).
 * Zum RKSV-Kernbeleg gehoeren sie nicht — sie betreffen ausschliesslich die
 * Darstellung. Deshalb stehen sie hier als eigenes Modell und nicht in
 * [Receipt]: derselbe Beleg, spaeter erneut gedruckt, kann eine
 * zwischenzeitlich geaenderte Fusszeile tragen.
 *
 * **Gotcha:** `thanks_message` liefert nur `getReceipt`, `createReceipt`
 * nicht (functions/index.js, Antwortbloecke von `getReceipt` bzw.
 * `createReceipt`). Das Feld ist deshalb kein Pflichtfeld der Nutzlast; ohne
 * es bleibt [thanksMessage] leer.
 */
export interface ReceiptCompany {
  companyName: string;
  street: string;
  zip: string;
  city: string;
  phone: string;
  /** UID (Umsatzsteuer-Identifikationsnummer); fehlt bei Kleinunternehmern. */
  uid?: string;
  /** Steuernummer des Finanzamts. */
  taxnr: string;
  /** Kleinunternehmer nach § 6 Abs 1 Z 27 UStG (keine USt im Ausweis). */
  isSmallBusiness: boolean;
  footer1: string;
  footer2: string;
  footer3?: string;
  footer4?: string;
  /** Adresse des Firmenlogos; dieses Paket laedt und zeichnet es nicht. */
  logoUrl?: string;
  /** Dankestext am Belegende, je Zeile ein Eintrag. */
  thanksMessage: string[];
  /** Kreiseck-Branding am Belegende (Firestore-Flag `branding.kreiseck_logo`). */
  showKreiseckLogo: boolean;
}

/**
 * Nutzlast-Form, die dieses Paket **liest** — die Feldnamen der Backend-
 * Antwort. Alles ist optional: ein Kundendokument ohne gepflegte Anschrift
 * oder Fusszeile liefert die Felder als `null` oder gar nicht, und ein
 * fehlender Firmenname darf keinen Belegdruck verhindern.
 */
export interface ReceiptCompanyPayload {
  company?: string | null;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  phone?: string | null;
  uid?: string | null;
  taxnr?: string | null;
  is_small_business?: boolean | null;
  footer1?: string | null;
  footer2?: string | null;
  footer3?: string | null;
  footer4?: string | null;
  logo_url?: string | null;
  /** Nur `getReceipt` liefert dieses Feld — siehe Modulkommentar. */
  thanks_message?: string | null;
  kreiseck_logo?: boolean | null;
}

/** Leere Zeichenkette statt `undefined` — siehe [ReceiptCompanyPayload]. */
const text = (wert: string | null | undefined): string => (typeof wert === 'string' ? wert : '');

/**
 * Zerlegt den Dankestext in Zeilen. Das Vorbild trennt an der **Zeichenfolge**
 * `\n` (Backslash + n), nicht am Zeilenumbruch — so legt es die Flutter-Seite
 * auch wieder ab (`toMetadataJson`). Ein echter Zeilenumbruch wird zusaetzlich
 * getrennt: er kommt aus einem mehrzeiligen Eingabefeld im Panel und wuerde
 * sonst als Umbruch **innerhalb** einer Layout-Zeile weiterwandern.
 */
function zeilen(wert: string | null | undefined): string[] {
  if (typeof wert !== 'string' || wert.length === 0) {
    return [];
  }
  return wert.split(/\\n|\r?\n/);
}

export function fromReceiptCompanyPayload(payload: ReceiptCompanyPayload): ReceiptCompany {
  const firma: ReceiptCompany = {
    companyName: text(payload.company),
    street: text(payload.street),
    zip: text(payload.zip),
    city: text(payload.city),
    phone: text(payload.phone),
    taxnr: text(payload.taxnr),
    isSmallBusiness: payload.is_small_business === true,
    footer1: text(payload.footer1),
    footer2: text(payload.footer2),
    thanksMessage: zeilen(payload.thanks_message),
    showKreiseckLogo: payload.kreiseck_logo === true,
  };
  // Die vier Kann-Felder bleiben weg, wenn sie leer sind — ein leerer String
  // in `footer3` erzeugte sonst eine leere Zeile auf dem Beleg.
  if (payload.uid) firma.uid = payload.uid;
  if (payload.footer3) firma.footer3 = payload.footer3;
  if (payload.footer4) firma.footer4 = payload.footer4;
  if (payload.logo_url) firma.logoUrl = payload.logo_url;
  return firma;
}

/**
 * Steuerangabe im Belegkopf — Zwilling von `KasseneckReceipt.taxInfo`: die UID,
 * wenn es eine gibt, sonst die Steuernummer.
 */
export function receiptCompanyTaxInfo(company: ReceiptCompany): string {
  return company.uid !== undefined && company.uid.length > 0 ? company.uid : company.taxnr;
}
