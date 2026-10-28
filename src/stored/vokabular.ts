// Erzeugt von scripts/stored-vokabular.mjs aus fixtures/v3/v3-vokabular.json.
// Nicht von Hand aendern: test/stored.test.ts vergleicht mit dem Vertrag.

/** Fingerabdruck des Vertrags-Exports, aus dem diese Datei stammt (`_quelle.sha256`). */
export const VOKABULAR_QUELLE = "faa66591ae28f1db659b59fd38947edb524632d170c63894aa7f141b7b498301";

/** Schema-Notation des Vertrags: Blatt 'aussen': 'innen', Objekt { __: 'innen', ... }, Liste [ { __: 'innen', ... } ]. */
export type SchemaEintrag = string | SchemaObjekt | readonly [SchemaObjekt];
export interface SchemaObjekt { readonly [aussen: string]: SchemaEintrag }

/** Wertverweis: Name eines Katalogs oder eine eingebettete Zuordnung innen -> aussen. */
export type Wertverweis = { readonly $catalog: string } | Readonly<Record<string, string>>;

/** Schema je Endpunkt (aussen -> innen) und Wertverweise auf die Kataloge. */
export const SCHEMAS: Readonly<Record<'getReceipt' | 'getKasseSettings' | 'listMyArticles', {
  readonly data: SchemaObjekt;
  readonly werte: Readonly<Record<string, Wertverweis>>;
}>> = {
  "getReceipt": {
    "data": {
      "receipt": {
        "__": "receipt",
        "headerVersionId": "kopfId",
        "layoutRuleset": "layoutRegeln",
        "registrationInfo": {
          "__": "pruefangaben",
          "cardRegisteredAt": "karteRegistriertAm",
          "cashregisterRegisteredAt": "kasseRegistriertAm"
        },
        "items": [
          {
            "__": "items",
            "receivedImmediately": "sofortErhalten",
            "keptByEmployee": "direkt"
          }
        ]
      },
      "taxNumber": "taxnr",
      "vatId": "uid",
      "headerVersionId": "kopfId",
      "registrationInfo": {
        "__": "pruefangaben",
        "cardRegisteredAt": "karteRegistriertAm",
        "cashregisterRegisteredAt": "kasseRegistriertAm"
      },
      "testCashregister": "testKasse",
      "testSignature": "testSignatur",
      "logo_scale": "logo_skala",
      "layout": {
        "__": "layout",
        "ruleset": "regelwerk",
        "lines": [
          {
            "__": "lines",
            "tone": "ton"
          }
        ]
      },
      "issuedVouchers": [
        {
          "__": "gutscheine",
          "codeSuffix": "codeEnde",
          "faceValueCents": "nennwertCents",
          "quantity": "stueck",
          "articleName": "artikelName",
          "validity": {
            "__": "gueltigkeit",
            "pattern": "muster",
            "redeemableUntil": "einloesbarBis",
            "refundableUntil": "rueckzahlbarBis",
            "validUntil": "gueltigBis"
          }
        }
      ],
      "outputs": [
        {
          "__": "ausgaben",
          "kind": "art",
          "result": "ergebnis",
          "by": "durch",
          "count": "anzahl"
        }
      ]
    },
    "werte": {
      "receipt.cancellationReason": {
        "$catalog": "STORNO_GRUND"
      },
      "layout.lines[].tone": {
        "$catalog": "LAYOUT_TON"
      },
      "issuedVouchers[].type": {
        "$catalog": "GUTSCHEIN_ART"
      },
      "issuedVouchers[].validity.pattern": {
        "$catalog": "GUTSCHEIN_MUSTER"
      },
      "outputs[].kind": {
        "$catalog": "AUSGABE_ART"
      },
      "outputs[].result": {
        "$catalog": "AUSGABE_ERGEBNIS"
      }
    }
  },
  "getKasseSettings": {
    "data": {
      "business": {
        "__": "betrieb",
        "logoText": "logoText",
        "logoEnabled": "logoAn",
        "logoSize": "logoGroesse",
        "watermark": "wasserzeichen",
        "color": "farbe",
        "theme": "stil",
        "fontSize": "schrift",
        "settingsFontSize": "schriftEinst",
        "tileStyle": "kachelstil",
        "clock": "uhr",
        "lockScreen": "sperrbild",
        "staffPhotos": "foto",
        "autoLogoutMinutes": "autoAbMin",
        "logoutAfterSale": "abNachVerkauf",
        "fastLogin": "schnellLogin",
        "showPrices": "preisAnzeigen",
        "showVat": "ustAnzeigen",
        "emoji": "emoji",
        "categoryColors": "katFarben",
        "customAmountAllowed": "freiErlaubt",
        "vatRates": "saetze",
        "quantity": "menge",
        "note": "notiz",
        "search": "suche",
        "discount": "rabatt",
        "payCash": "zahlBar",
        "payCard": "zahlKarte",
        "paySplit": "zahlGetrennt",
        "cardProvider": "kartenanbieter",
        "tip": "trinkgeld",
        "tipMode": "tgModus",
        "tipSteps": "tgStufen",
        "tipSplit": "tgSplit",
        "change": "rueckgeld",
        "tipChips": "tgChips",
        "exactCash": "schnellbar",
        "tipKeptByDefault": "tgDirekt",
        "checkoutMode": "kassierenModus",
        "receiptOutput": "belegAusgabe",
        "doneScreenSeconds": "fertigSekunden",
        "logoImage": "logoBild",
        "watermarkSide": "wzSeite",
        "watermarkX": "wzPos",
        "watermarkY": "wzPosV",
        "watermarkStrength": "wzStaerke",
        "logoScale": "logoSkala",
        "watermarkScale": "wzSkala",
        "glass": "glas",
        "hints": "hinweise",
        "discountChips": "rabattChips"
      },
      "device": {
        "__": "geraet",
        "layout": "layout",
        "categoryPosition": "katpos",
        "extraColumns": "spaltenExtra",
        "tileHeight": "hoehe",
        "touch": "touch",
        "shortcuts": {
          "__": "tasten",
          "checkout": "kassieren",
          "complete": "abschliessen",
          "cancel": "abbrechen",
          "customAmount": "frei",
          "cash": "bar",
          "card": "karte",
          "exactAmount": "passend",
          "receipts": "belege",
          "undoLast": "letzteZurueck",
          "settings": "einstellungen",
          "logout": "abmelden",
          "tip": "trinkgeld",
          "fullscreen": "vollbild",
          "clearTendered": "gegebenLeeren",
          "clearCart": "korbLeeren",
          "splitPayment": "getrennt",
          "shiftStatus": "kassenstand",
          "openDrawer": "ladeOeffnen",
          "voucherPayout": "gutscheinAuszahlen"
        },
        "printerEnabled": "druckerAn",
        "printerType": "druckerArt",
        "printerIp": "druckerIp",
        "printerPort": "druckerPort",
        "printerBluetoothId": "druckerBt",
        "printerName": "druckerName",
        "printerId": "druckerId",
        "printerDeviceId": "druckerDevid",
        "connectPrinterId": "connectDruckerId",
        "paperSize": "papier",
        "codePage": "zeichensatz",
        "cut": "schnitt",
        "qrMode": "qrModus",
        "drawerEnabled": "ladeAn",
        "drawerAutoOpen": "ladeAuto",
        "drawerId": "ladeId",
        "terminalIp": "terminalIp",
        "terminalPort": "terminalPort",
        "terminalTid": "terminalTid",
        "terminalVia": "terminalVia",
        "terminalType": "terminalArt",
        "shortcutHints": "tastenMarken"
      },
      "vouchers": {
        "__": "gutscheine",
        "sale": "verkauf",
        "valueVoucherType": "wertArt",
        "vatRateBp": "satzBp",
        "label": {
          "__": "etikett",
          "size": "groesse",
          "fields": {
            "__": "felder",
            "business": "betrieb",
            "value": "wert",
            "validity": "gueltigkeit",
            "checkPage": "pruefseite"
          },
          "freeText": "freitext"
        }
      }
    },
    "werte": {
      "business.watermark": {
        "$catalog": "KASSE_BETRIEB_WERTE.watermark"
      },
      "business.theme": {
        "$catalog": "KASSE_BETRIEB_WERTE.theme"
      },
      "business.tileStyle": {
        "$catalog": "KASSE_BETRIEB_WERTE.tileStyle"
      },
      "business.quantity": {
        "$catalog": "KASSE_BETRIEB_WERTE.quantity"
      },
      "business.discount": {
        "$catalog": "KASSE_BETRIEB_WERTE.discount"
      },
      "business.cardProvider": {
        "$catalog": "KASSE_BETRIEB_WERTE.cardProvider"
      },
      "business.tipMode": {
        "$catalog": "KASSE_BETRIEB_WERTE.tipMode"
      },
      "business.checkoutMode": {
        "$catalog": "KASSE_BETRIEB_WERTE.checkoutMode"
      },
      "business.receiptOutput": {
        "$catalog": "KASSE_BETRIEB_WERTE.receiptOutput"
      },
      "business.watermarkSide": {
        "$catalog": "KASSE_BETRIEB_WERTE.watermarkSide"
      },
      "device.layout": {
        "$catalog": "KASSE_GERAET_WERTE.layout"
      },
      "device.categoryPosition": {
        "$catalog": "KASSE_GERAET_WERTE.categoryPosition"
      },
      "device.printerType": {
        "$catalog": "KASSE_GERAET_WERTE.printerType"
      },
      "device.drawerAutoOpen": {
        "$catalog": "KASSE_GERAET_WERTE.drawerAutoOpen"
      },
      "device.terminalVia": {
        "$catalog": "KASSE_GERAET_WERTE.terminalVia"
      },
      "device.terminalType": {
        "$catalog": "KASSE_GERAET_WERTE.terminalType"
      },
      "vouchers.valueVoucherType": {
        "mehrzweck": "multi_purpose",
        "einzweck": "single_purpose"
      }
    }
  },
  "listMyArticles": {
    "data": {
      "articles": [
        {
          "__": "articles",
          "quantityRule": "mengenregel",
          "askQuantity": "mengeFragen",
          "maxQuantity": "maxMenge",
          "tile": {
            "__": "kasse",
            "visible": "sichtbar",
            "sort": "sort"
          },
          "stockLocationIds": "standorte",
          "minStockByLocation": "mindestJeStandort"
        }
      ]
    },
    "werte": {
      "articles[].quantityRule": {
        "$catalog": "MENGENREGEL"
      },
      "articles[].e1aGroup": {
        "$catalog": "E1A_GRUPPE"
      }
    }
  }
};

/** Die Felder eines Artikels in der Antwort (`listMyArticles`), aussen. */
export const ARTIKEL_FELDER: readonly string[] = [
  "id",
  "source",
  "number",
  "name",
  "description",
  "unit",
  "unitPriceCents",
  "vatRate",
  "ean",
  "internalCode",
  "codeSpec",
  "stockTracked",
  "stockQty",
  "minStock",
  "e1aGroup",
  "quantityRule",
  "askQuantity",
  "maxQuantity",
  "revenueGroupId",
  "active",
  "groupId",
  "tile",
  "stockLocationIds",
  "minStockByLocation"
];

/** Wertkataloge innen (deutsch) -> aussen (englisch). */
export const KATALOGE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "AUSGABE_ART": {
    "erstdruck": "print",
    "duplikat": "reprint",
    "mail": "email",
    "link_geteilt": "link_shared",
    "pdf_geteilt": "pdf_shared",
    "abruf": "opened"
  },
  "AUSGABE_ERGEBNIS": {
    "ok": "ok",
    "fehler": "failed",
    "unklar": "unclear"
  },
  "E1A_GRUPPE": {
    "erloese": "revenue",
    "erloese_waren": "revenue_goods",
    "erloese_leistungen": "revenue_services",
    "eigenverbrauch": "own_use_withdrawal",
    "trinkgeld_erhalten": "tips_received",
    "erloese_109a": "revenue_109a",
    "anlagenverkauf": "asset_sales_withdrawals",
    "uebrige_einnahmen": "other_income",
    "zinsertrag": "interest_income",
    "versicherungsentschaedigung": "insurance_payout",
    "foerderung": "subsidy",
    "steuerrueckzahlung": "tax_refund",
    "geschenk_erhalten": "gift_received",
    "vertragsstrafe_erhalten": "penalty_received",
    "ust_vereinnahmt": "vat_collected_gross_system",
    "durchlaufend_einnahme": "pass_through_receipt",
    "waren": "goods_materials",
    "fremdleistungen": "third_party_services",
    "subunternehmer": "subcontractors",
    "leihpersonal": "temporary_staff",
    "personal": "staff_costs",
    "loehne": "wages_salaries",
    "lohnabgaben": "payroll_taxes",
    "personal_sozialaufwand": "staff_welfare",
    "kleidung_mitarbeiter": "staff_clothing",
    "abschreibung": "depreciation_group",
    "afa": "depreciation",
    "gwg": "low_value_assets",
    "kfz_afa": "vehicle_depreciation",
    "afa_degressiv": "declining_balance_depreciation",
    "afa_gebaeude": "building_depreciation",
    "anlagenabgang": "asset_disposal_book_value",
    "instandhaltung_gebaeude": "building_maintenance",
    "bauarbeiten": "construction_work",
    "reise": "travel_expenses",
    "fahrkarten": "travel_tickets",
    "naechtigung_beleg": "lodging_invoice",
    "reise_nebenkosten": "travel_incidentals",
    "fortbildungsreise": "conference_travel",
    "kilometergeld_pkw": "mileage_allowance_car",
    "kilometergeld_motorrad": "mileage_allowance_motorcycle",
    "kilometergeld_fahrrad": "mileage_allowance_bicycle",
    "mitfahrerzuschlag": "passenger_allowance",
    "tagesgeld_inland": "per_diem_domestic",
    "tagesgeld_ausland": "per_diem_abroad",
    "naechtigung_pauschal": "lodging_allowance",
    "oeffi_pauschale": "public_transport_allowance",
    "kfz": "vehicle_costs",
    "treibstoff": "vehicle_fuel",
    "kfz_service": "vehicle_service_repair",
    "kfz_versicherung": "vehicle_insurance",
    "kfz_steuer": "vehicle_tax",
    "vignette_maut": "toll_vignette",
    "parken_garage": "parking_garage",
    "autofahrerklub": "motoring_club",
    "miete": "rent_lease",
    "miete_geschaeftsraum": "premises_rent",
    "leasing_kfz": "vehicle_lease",
    "leasing_geraete": "equipment_lease",
    "coworking": "coworking_storage",
    "provisionen": "commissions_royalties",
    "werbung": "advertising_hospitality",
    "werbung_anzeigen": "advertising",
    "geschenke": "gifts",
    "werbegeschenke": "promotional_gifts",
    "geschenke_geschaeftsfreunde": "business_gifts",
    "bewirtung": "hospitality",
    "bewirtung_werbung": "hospitality_advertising",
    "kundschaft_aufmerksamkeit": "customer_courtesy",
    "lebensmittel": "groceries",
    "bewirtung_voll": "hospitality_full",
    "bewirtung_repraesentation": "hospitality_representation",
    "sponsoring": "sponsorship",
    "trinkgeld_gegeben": "tips_given",
    "kranz_blumen": "wreaths_flowers",
    "spende_sonstige": "donation_non_qualifying",
    "spenden": "donations_qualifying",
    "spende_forschung_kultur": "donation_research_culture",
    "spende_mildtaetig": "donation_charity",
    "spende_umwelt_tier": "donation_environment_animals",
    "spende_feuerwehr": "donation_fire_brigade",
    "spende_sport": "donation_sports",
    "spende_kindergarten": "donation_kindergarten",
    "spende_schule": "donation_school",
    "spende_sonstige_beguenstigt": "donation_other_qualifying",
    "arbeitszimmer": "home_office_room",
    "arbeitsplatzpauschale": "workspace_allowance_group",
    "arbeitsplatz_gross": "workspace_allowance_large",
    "arbeitsplatz_klein": "workspace_allowance_small",
    "arbeitsplatz_mobiliar": "ergonomic_furniture",
    "zinsen": "interest",
    "zinsen_kredit": "loan_interest",
    "zinsen_stundung": "deferral_interest",
    "sv_beitraege": "social_insurance_contributions",
    "svs": "svs_contributions",
    "vorsorgekasse": "self_employed_provision_fund",
    "kammer_versorgung": "chamber_pension_fund",
    "arbeitslosen_optin": "voluntary_unemployment_insurance",
    "uebrige_ausgaben": "other_expenses",
    "telefon_internet": "phone_internet",
    "energie": "energy_utilities",
    "buero": "office_supplies",
    "software": "software_subscriptions",
    "fachliteratur": "professional_literature",
    "fortbildung": "training",
    "beratung": "legal_advisory",
    "steuerberatung": "tax_advisory",
    "rechtsberatung": "legal_counsel",
    "versicherung": "insurance",
    "versicherung_betrieb": "business_insurance",
    "mitgliedsbeitrag": "membership_fee",
    "kammer_verbaende": "chamber_association_fees",
    "betriebssteuern": "business_taxes_fees",
    "bankspesen": "bank_charges",
    "kleidung": "clothing",
    "berufskleidung": "work_clothing",
    "gruendung": "startup_costs",
    "strafe": "penalty",
    "schadenersatz_gezahlt": "damages_paid",
    "ust_bezahlt": "vat_paid_gross_system",
    "telefon_buero": "phone_internet_office_supplies",
    "nicht_abzugsfaehig": "non_deductible",
    "privat": "non_deductible_private",
    "einkommensteuer": "non_deductible_income_tax",
    "strafen": "non_deductible_fines",
    "brille_uhr": "non_deductible_glasses_watch",
    "kleidung_buergerlich": "non_deductible_clothing",
    "zeitungen": "non_deductible_newspapers",
    "fitness_fuehrerschein": "non_deductible_fitness_licence",
    "ball_kultur": "non_deductible_events",
    "durchlaufend_ausgabe": "pass_through_payment"
  },
  "GUTSCHEIN_ART": {
    "mehrzweck": "multi_purpose",
    "einzweck": "single_purpose",
    "leistung": "service",
    "aktion": "promotion"
  },
  "GUTSCHEIN_MUSTER": {
    "unbefristet": "unlimited",
    "1+3": "1+3",
    "frei": "custom"
  },
  "KASSE_BETRIEB_WERTE.cardProvider": {
    "keiner": "none",
    "extern": "external",
    "gptom": "gptom",
    "hobex": "hobex",
    "mypos": "mypos",
    "stripe": "stripe"
  },
  "KASSE_BETRIEB_WERTE.checkoutMode": {
    "seite": "page",
    "panel": "panel"
  },
  "KASSE_BETRIEB_WERTE.discount": {
    "aus": "off",
    "an": "on"
  },
  "KASSE_BETRIEB_WERTE.quantity": {
    "aus": "off",
    "x": "x",
    "kg": "kg"
  },
  "KASSE_BETRIEB_WERTE.receiptOutput": {
    "qr": "qr",
    "druck": "print",
    "mail": "email",
    "sms": "sms",
    "fragen": "ask"
  },
  "KASSE_BETRIEB_WERTE.theme": {
    "klar": "clear",
    "warm": "warm",
    "nacht": "night",
    "kontrast": "contrast"
  },
  "KASSE_BETRIEB_WERTE.tileStyle": {
    "streifen": "stripe",
    "voll": "full"
  },
  "KASSE_BETRIEB_WERTE.tipMode": {
    "betrag": "amount",
    "gesamt": "total",
    "beides": "both"
  },
  "KASSE_BETRIEB_WERTE.watermark": {
    "aus": "off",
    "anmeldung": "login",
    "ueberall": "everywhere"
  },
  "KASSE_BETRIEB_WERTE.watermarkSide": {
    "links": "left",
    "mitte": "center",
    "rechts": "right"
  },
  "KASSE_GERAET_WERTE.categoryPosition": {
    "oben": "top",
    "links": "left"
  },
  "KASSE_GERAET_WERTE.drawerAutoOpen": {
    "bar": "cash",
    "immer": "always",
    "nie": "never"
  },
  "KASSE_GERAET_WERTE.layout": {
    "rechts": "right",
    "links": "left",
    "vollbild": "fullscreen"
  },
  "KASSE_GERAET_WERTE.printerType": {
    "sdp": "sdp",
    "netz": "network",
    "bt": "bluetooth",
    "usb": "usb",
    "connect": "connect"
  },
  "KASSE_GERAET_WERTE.terminalType": {
    "keins": "none",
    "hps": "hps"
  },
  "KASSE_GERAET_WERTE.terminalVia": {
    "direkt": "direct",
    "connect": "connect"
  },
  "LAYOUT_TON": {
    "belegart": "receipt_type",
    "warnung": "warning"
  },
  "MENGENREGEL": {
    "stueck": "piece",
    "dezimal": "decimal"
  },
  "STORNO_GRUND": {
    "fehleingabe": "input_error",
    "kunde_storniert": "customer_cancelled",
    "falsche_zahlart": "wrong_payment_method",
    "doppelt_erfasst": "duplicate",
    "sonstiges": "other"
  }
};
