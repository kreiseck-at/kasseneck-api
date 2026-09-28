// Erzeugt von scripts/stored-vokabular.mjs aus fixtures/v3/v3-vokabular.json.
// Nicht von Hand aendern: test/stored.test.ts vergleicht mit dem Vertrag.

/** Fingerabdruck des Vertrags-Exports, aus dem diese Datei stammt (`_quelle.sha256`). */
export const VOKABULAR_QUELLE = "29994ca53adc96e7cb49b9e3688b102a69c126544ef092fc6579a2e1fcd0d555";

/** Schema-Notation des Vertrags: Blatt 'aussen': 'innen', Objekt { __: 'innen', ... }, Liste [ { __: 'innen', ... } ]. */
export type SchemaEintrag = string | SchemaObjekt | readonly [SchemaObjekt];
export interface SchemaObjekt { readonly [aussen: string]: SchemaEintrag }

/** Schema je Endpunkt (aussen -> innen) und Wertverweise auf die Kataloge. */
export const SCHEMAS: Readonly<Record<'getReceipt' | 'getKasseSettings' | 'listMyArticles', {
  readonly data: SchemaObjekt;
  readonly werte: Readonly<Record<string, { readonly $catalog: string }>>;
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
            "receivedImmediately": "sofortErhalten"
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
      }
    },
    "werte": {
      "receipt.cancellationReason": {
        "$catalog": "STORNO_GRUND"
      },
      "layout.lines[].tone": {
        "$catalog": "LAYOUT_TON"
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
          "splitPayment": "getrennt"
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
        "terminalIp": "terminalIp",
        "terminalPort": "terminalPort",
        "terminalTid": "terminalTid",
        "terminalVia": "terminalVia",
        "terminalType": "terminalArt",
        "shortcutHints": "tastenMarken"
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
          }
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
  "tile"
];

/** Wertkataloge innen (deutsch) -> aussen (englisch). */
export const KATALOGE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "E1A_GRUPPE": {
    "waren": "goods_materials",
    "fremdleistungen": "third_party_services",
    "personal": "staff_costs",
    "afa": "depreciation",
    "gwg": "low_value_assets",
    "miete": "rent_lease",
    "instandhaltung_gebaeude": "building_maintenance",
    "reise": "travel_expenses",
    "oeffi_pauschale": "public_transport_allowance",
    "kfz": "vehicle_costs",
    "provisionen": "commissions_royalties",
    "werbung": "advertising_hospitality",
    "zinsen": "interest",
    "sv_beitraege": "social_insurance_contributions",
    "arbeitsplatz_klein": "workspace_allowance_small",
    "arbeitsplatz_gross": "workspace_allowance_large",
    "anlagenabgang": "asset_disposal_book_value",
    "telefon_buero": "phone_internet_office_supplies",
    "beratung": "legal_advisory",
    "uebrige_ausgaben": "other_expenses",
    "erloese": "revenue",
    "erloese_109a": "revenue_109a",
    "anlagenverkauf": "asset_sales_withdrawals",
    "uebrige_einnahmen": "other_income"
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
