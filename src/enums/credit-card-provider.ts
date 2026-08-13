/**
 * Kartenanbieter — Zwilling von `CreditCardProvider` in
 * kasseneck_api/lib/enums/credit_card_provider.dart.
 *
 * `hobexHps`, `sumup` und `myposPro` bleiben Teil des Enums: Das Backend kennt sie,
 * und Belege aus der Flutter-App tragen sie weiterhin. Nur die Anbindung im
 * Browser-Paket fehlt bewusst — Hobex HPS spricht lokal per TCP mit dem Terminal,
 * myPOS und SumUp sind Android-SDKs. Ein Browser kann das nicht, und kein Bundler
 * aendert daran etwas.
 */
export const CreditCardProvider = {
  gpTomAndroid: 'gpTomAndroid',
  gpTomIos: 'gpTomIos',
  hobexCloudApi: 'hobexCloudApi',
  hobexHps: 'hobexHps',
  sumup: 'sumup',
  myposPro: 'myposPro',
  stripe: 'stripe',
  custom: 'custom',
} as const;

export type CreditCardProviderKey = keyof typeof CreditCardProvider;
export type CreditCardProvider = (typeof CreditCardProvider)[CreditCardProviderKey];
