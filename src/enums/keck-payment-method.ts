/**
 * Zahlungsart — Zwilling von `KeckPaymentMethod` in
 * kasseneck_api/lib/enums/keck_payment_method.dart.
 *
 * `label` ist das deutsche Anzeige-Label fuer die Zahlungsart-Zeile auf dem Beleg.
 * Muss 1:1 mit dem Backend-Mapping `paymentMethodToString` (functions/helper.js)
 * uebereinstimmen.
 */
export const KeckPaymentMethod = {
  cash: { value: 'cash', needsCreditCard: false, label: 'Barzahlung' },
  creditCard: { value: 'creditCard', needsCreditCard: true, label: 'Kartenzahlung' },
  online: { value: 'online', needsCreditCard: false, label: 'Onlinezahlung' },
  uberApp: { value: 'uberApp', needsCreditCard: false, label: 'Uber App' },
  uberCash: { value: 'uberCash', needsCreditCard: false, label: 'Uber Cash' },
  uberCard: { value: 'uberCard', needsCreditCard: true, label: 'Uber Card' },
  boltApp: { value: 'boltApp', needsCreditCard: false, label: 'Bolt App' },
  boltCash: { value: 'boltCash', needsCreditCard: false, label: 'Bolt Cash' },
  boltCard: { value: 'boltCard', needsCreditCard: true, label: 'Bolt Card' },
} as const;

export type KeckPaymentMethodKey = keyof typeof KeckPaymentMethod;
export type KeckPaymentMethod = (typeof KeckPaymentMethod)[KeckPaymentMethodKey];
