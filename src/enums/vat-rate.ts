import { defineEnum } from './define-enum.js';

/**
 * Steuersatz — Zwilling von `VatRate` in kasseneck_api/lib/enums/vat_rate.dart.
 *
 * `category` ist der RKSV-Kategorie-Buchstabe der Steuersaetze (A=20%, B=10%, C=13%,
 * D=0%, E=19%, G=4,9%). Er haengt an der Signaturkette des Backends — unantastbar.
 */
export const VatRate = defineEnum({
  vat0: { value: 'vat0', rate: 0, category: 'D' },
  // Grundnahrungsmittel ab 01.07.2026 -> Betrag-Satz-Besonders (BMF/RKSV)
  vat4komma9: { value: 'vat4komma9', rate: 4.9, category: 'G' },
  vat10: { value: 'vat10', rate: 10, category: 'B' },
  vat13: { value: 'vat13', rate: 13, category: 'C' },
  vat19: { value: 'vat19', rate: 19, category: 'E' },
  vat20: { value: 'vat20', rate: 20, category: 'A' },
});

export type VatRateKey = keyof typeof VatRate;
export type VatRate = (typeof VatRate)[VatRateKey];
