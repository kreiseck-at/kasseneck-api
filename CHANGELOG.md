# Änderungen

Was vor 0.7.0 geschah, steht in der Commit-Historie (`git log`); ab hier wird
es hier geführt. Ein Eintrag nennt die Änderung **und ihren Grund** —
nur der Grund überlebt den nächsten Umbau.

## 1.4.0

Inventory API, read side and account webhooks: new subpath `./inventory`.
Reason: since stage 5a the backend offers articles, locations, stock and the
stock ledger under `/v3` with the account's `api_key`, plus webhooks that
report every stock change within seconds. A shop that shows stock or keeps
its own copy needs a typed client and, above all, a signature check it
cannot get wrong.

Additive, no breaking change; existing calls send and read the same bytes as
in 1.3.0.

- **`createInventoryClient({ apiKey })`** (`./inventory`, server only, base
  `https://api.kasseneck.at/v3`): `getArticle`, `listArticles`,
  `lookupArticleByCode` (code as text or `{ code }`, or
  `{ externalSystem, externalId }`), `listLocations`, `getStock`, `listStock`,
  `listStockMovements`, and the async iterators `iterateArticles`,
  `iterateStock`, `iterateStockMovements` that follow `nextCursor` until
  `null` (the same cursor twice throws instead of looping). Webhook management:
  `createWebhook`, `updateWebhook`, `deleteWebhook`, `listWebhooks`,
  `sendWebhookTest`, `rotateWebhookSecret`, `listWebhookDeliveries`. Every call
  is also exported as a free function taking the transport.
- **Models**: `Article` (incl. `stockLocationIds`; `purchasePriceMicros` only
  with the account permission `costs`, otherwise the field is absent, not
  `null`), `StockLevel` (`onHand`, `reserved`, `available`, `defective`,
  `sequence`, `updatedAt`), `StockValue`, `StockMovement`, `Location`,
  `InventoryWebhook`, `InventoryWebhookDelivery` (status `delivered`,
  `pending`, `failed`, `dropped`). Quantities are integer thousandths, money
  integer cents, purchase prices integer micro-euros; `available` may be
  negative. A fractional or missing quantity, amount or `sequence` in a
  response throws `KasseneckValidationError` with `scope: 'response'`, as for
  register stock since 1.2.0. A `Date` in `updatedSince`, `changedSince`,
  `from` or `to` goes out as ISO 8601 UTC.
- **Incoming webhooks**: `verifyInventoryWebhookSignature(secret, header, rawBody,
  { toleranceSec = 300, now })` resolves to `true` or `false` and never
  throws: HMAC-SHA256 over `"<t>.<raw body>"`, constant-time comparison,
  300 seconds in both directions, several `v1=` parts allowed; checked against
  the backend's test vector (t=1700000000). Asynchronous because it uses
  WebCrypto, as `./partner` does. `parseInventoryWebhookEvent(rawBody)` returns a typed
  `InventoryWebhookEvent` for `stock.changed` (`cause`, `movementId`),
  `stock.below_minimum` and `article.created|updated|deactivated`, with
  `accountId` instead of `partnerId` in the envelope; an event type this
  version does not know returns `null`, a body that is no envelope throws.
  Both carry `Inventory` in their name on purpose: `./partner` has a
  `verifyWebhookSignature` with an options object that resolves to
  `{ ok, reason }`, and an object is truthy, so a mix-up in plain JavaScript
  would accept every delivery.
- **Errors** through the existing classes: `INVENTORY_ERROR_CODES`
  (`rate_limited` with `retryAfterSec`, `inventory_api_not_enabled`,
  `module_inactive`, `article_not_found`, `invalid_cursor`, the webhook codes
  …), `INVENTORY_REQUEST_ERROR_CODES`, `isInventoryError`,
  `inventoryErrorCode`, `inventoryFieldErrors`, `inventoryRetryAfterSec`.
- **Lists as data**: `INVENTORY_ENDPOINTS`, `INVENTORY_WEBHOOK_EVENTS`,
  `INVENTORY_WEBHOOK_ENVELOPE_FIELDS`, `LOCATION_TYPES`,
  `STOCK_MOVEMENT_TYPES`, `STOCK_MOVEMENT_SOURCES`, `STOCK_CONDITIONS`,
  `STOCK_CHANGE_CAUSES`, `WEBHOOK_DELIVERY_STATUSES`, each held against the
  backend contract.
- **Contract**: `fixtures/v3/` pulled again from the backend (the 14 new
  endpoints, catalogs and events); `PUBLIC_CALLS` and `ALL_CALLS` gain the 14
  names; `surface.json` gains the key `inventory` with the lists above.

## 1.3.0

Article codes on `PosArticle` and the stock words of the register in the
shared catalogue. Reason: the backend already sends `number`, `ean`,
`internalCode` and `stockTracked` per article in `listMyArticles` under
`/api/v3`, but the package dropped them, so the browser register could not
search by scanned code nor tell a stock-tracked article without guessing. The
stock labels lived locally in the browser register; the browser register and
the register app have to use the same words.

Additive, no breaking change; requests send the same bytes as in 1.2.2.

- **`PosArticle`** gains `number`, `ean`, `internalCode` (`string | null`) and
  `stockTracked` (`boolean | null`). Optional on the type like
  `stockLocationIds`, so existing object literals keep compiling; the reader
  `fromPosArticlePayload` always sets them. Texts pass through unchanged
  (leading zeros, case, spaces); an empty or whitespace-only text and a
  value of the wrong type become `null`. `stockTracked: null` means the
  response carries no statement (older backends), not `false`. `./stored`
  (`fromStoredArticle`) returns the same fields.
- **Labels** (`LABELS`, `labelText`): `stock.all_articles`, `stock.location`,
  `stock.default_location`, `stock.resolved`, `stock.where_to`,
  `stock.available`, `stock.return_restock`, `stock.return_defective`,
  `stock.return_disposed`. New `RETURN_DISPOSITION_LABELS` (`./pos`) maps each
  `ReturnDisposition` to its label key.
- **Message** (`MESSAGES`, `messageText`): `cancellation.input_rejected`, for
  a cancellation whose reason, note or lines the server rejected.
- **`fixtures/pos-texts.json`**: the new keys and a new top-level key
  `returnDispositionLabels` after `labels`. `surface.json` and the other
  contract files change only in their version.

## 1.2.2

The receipt fixtures, goldens and tests carried the serial number of a real
signature card (signature card line, machine-readable code). It is replaced by
the made-up `5A1C3E07` (same length); the dependent ESC/POS hex goldens are
regenerated. Reason: fixtures only carry made-up identifiers; backend and web
use the same replacement. No code change. Same change as 0.32.2 on the legacy line.

## 1.2.1

En dash instead of em dash in the visible texts of the invoice catalog
(`src/invoice/texte.ts`, both languages): `pdf.direct_debit.warning` ("Bitte für Deckung sorgen – die
Kosten einer Rücklastschrift werden weiterverrechnet."), `pdf.footer.note`, `tax.reverse_charge.text`,
`einvoice.exemption.small_business` and `einvoice.exemption.outside_scope`. Reason: German typography
uses the spaced en dash as the dash; the em dash appeared only here. Keys, placeholders and every other
character stay the same; whoever compares the texts byte by byte (PDF/e-invoice goldens) updates the
five sentences. Same change as 0.32.1 on the legacy line; the frozen 0.x catalog in
`test/fixtures/vor-1.0/` follows it so the rename check stays character-exact.

## 1.2.0

Stock at the register, returns on cancellation, stock fields in the invoice
API. Reason: since stage 2 of the stock module the backend books sales,
cancellations and invoices against the stock of a location. The register has
to show locations and stock, choose its own location and say where returned
goods go; external invoicing systems have to name the article.

Additive, no breaking change; receipts and existing calls send and read the
same bytes as in 1.1.1.

- **Three register calls** (`./pos`, register path `/api/v3` only):
  `listMyStockLocations(transport)`,
  `listMyStock(transport, { locationId, articleId, belowMinimum })` and
  `setMyCashregisterStockLocation(transport, { stockLocationId, cashregisterId })`
  (`null` resets to the default location). Quantities are integer thousandths
  of the base unit and keep their sign; `values` is `null` without the
  permission `stockCosts`; a location without any address part has
  `address: null`. A response with a missing or fractional quantity is never
  read as `0`: it throws `KasseneckValidationError` with `scope: 'response'`
  (a register treats that as "stock temporarily unavailable" and keeps
  selling). New list `STOCK_LOCATION_TYPES`; `POS_ERROR_CODES` gains
  `location_inactive`, `location_not_found` and `server_error`.
- **Locations on articles, registers and devices**: `PosArticle.stockLocationIds`
  (optional on the type, so existing object literals keep compiling; the
  reader always sets it, `null` when the article names none),
  `Cashregister.stockLocationId`, `cashregister.stockLocationId` in
  `listRegisterUsersForDevice`.
- **Register permissions** `stockView`, `stockCosts`, `stockMove`, `stockLoss`,
  `stocktakeCount`, `stocktakeClose`, `stockLocation` in `RegisterUserPerms`
  and `REGISTER_PERMS`. New `stockViewOf(perms)` (`./pos` and root): a missing
  `stockView` counts as granted, only an explicit `false` blocks it, as in the
  backend.
- **Returns on cancellation**: `cancelReceipt` takes `returnDisposition` for the
  call and per line (`RETURN_DISPOSITIONS`, `isReturnDisposition`: `restock`,
  `defective`, `disposed`), checked before sending. New code
  `invalid_return_disposition`, the last of the `cancelReceipt`-specific codes
  in `CANCELLATION_ERROR_CODES` (before the auth/edge and client codes).
  Cancellation lines with an article carry `originalIndex` and
  `returnDisposition`, and so do the items of `cancellations[]`.
- **Invoice API**: `items[].articleId`, `stockLocationId` on `issueInvoice`,
  `returnDisposition` on `cancelInvoice` and `createCreditNote` (also per line,
  `CreditNoteItemInput`, `CREDIT_NOTE_ITEM_FIELDS`). Schema
  `fixtures/invoice-api.schema.json` and six new examples.
- **`./stored`**: stored receipts drop `lagerStandortId` and turn `rueckgabe`
  into `returnDisposition`; stored articles carry `stockLocationIds`.
- **Contract `/v3` caught up with the backend** (not stock related):
  `PUBLIC_CALLS` lists nine more public endpoints (partner billing, invoice
  items and mandates; names only, no wrappers), and `api_not_approved` (the
  developer area has to approve the account for the live API) is in every
  derived error list. For the Dart twin: `surface.json` changes in `routes`,
  `calls.pos`, `registerPerms`, `pos` and `invoice`.
- **Behaviour change**: `api_not_approved` is in `PAYMENT_CALL_REJECTED_CODES`,
  so a payment call answered with it now has the outcome `rejected` instead of
  `unknown`. Nothing was charged: the approval gate runs before the handler.

## 1.1.1

The code-table test sheet asks for the right row. Reason: a Bluetooth
printer that only knows PC437 printed rows 2 and 3 with correct umlauts but
wrong glyphs for `€` and `§` (`╒`, `⌡`), and row 4 correct with gaps for
`€` and `§`. "The first row that looks exactly like above" confused users,
and "the row with correct umlauts" would pick row 2. The rule now is: the
row with no wrong character; a gap is fine; if several fit, the one with
the fewest gaps; if none fits, 6.

Additive, no breaking change; receipts are byte for byte the same (the 24
`code-table-receipt.*.hex` files are unchanged).

- **Test sheet** (`./receipt`): reference heading `codetable.reference` is
  now "So sehen die Zeichen richtig aus" (32 columns; with a colon it would
  wrap), the footer is the new rule: `codetable.instruction_title` (bold),
  `codetable.instruction`, `codetable.instruction_none` ("Passt keine:
  {number}.", the replacement row). As before, everything outside the test
  rows prints with replacement letters (pure ASCII), so "Lücke" from the
  catalogue stands as "Luecke" on the sheet, on paper and in the line model.
  Rows, big numbers, margins and the end reset are unchanged. Contract:
  `fixtures/expected/code-table-test-sheet.*`.
- **Screen texts** (`fixtures/pos-texts.json`): `codetable.question` is now
  "In welcher Zeile steht kein falsches Zeichen?"; new
  `codetable.question_hint`, `codetable.preview_title`, `codetable.apply`,
  `codetable.other_row`.
- **Preview** (`./printing`): `codeTablePreviewText(table)` returns the
  sample "Käsekrainer 3,50 €" / "Tee 80°" as it prints with that table
  (lines joined by `\n`), e.g. `pc437` gives "Käsekrainer 3,50 EUR", so the
  user sees the effect of a row before applying it. Shared contract with the
  Dart twin: `fixtures/code-table-preview.json`.

## 1.1.0

Receipt printers that print umlauts and special characters correctly.
Reason: `ESC t n` selects the character table, but the number n differs
between manufacturers; many low-cost printers ignore `ESC t 16` or put
another table there and print garbage instead of `ä`. The printer wizard
now prints a test sheet, the user taps the first row that looks right, and
the register keeps that choice per printer on the device.

Additive, no breaking change. Without a chosen table every receipt is byte
for byte the same as in 1.0.0 (all golden receipts unchanged).

- **Code-table catalogue** (`./printing`): `CodeTableId`, `CodeTable`,
  `CODE_TABLES` (six tables: `wpc1252` = `ESC t 16`, `pc858` = 19,
  `pc850` = 2, `pc437` = 0, `iso8859_15` = 40, `replacement` = 0),
  `codeTableById`, `codeTableFromSetting`, `encodeForCodeTable`. For
  ä ö ü Ä Ö Ü ß € § ° every table answers with its own byte or, where the
  table lacks the character, with replacement letters (`ae`, `EUR`, `Par.`,
  `Grad`), never `?`. Shared contract with the Dart twin:
  `fixtures/code-tables.json`.
- **Test sheet** (`./receipt`): `codeTableTestSheet` (line model for the
  screen, 32 columns) and `codeTableTestSheetBytes` (ESC/POS, centred on
  80 mm), `codeTableReferenceImage`. Contract:
  `fixtures/expected/code-table-test-sheet.*`. New texts in
  `fixtures/pos-texts.json` (`codetable.*`).
- **Receipts with a chosen table**: `escPosLayoutBytes(layout, { codeTable })`
  accepts a `CodeTableId`. `€`, `§` and `°` go out as the table's real
  byte where the table has them, otherwise as replacement letters. Missing
  characters are replaced in the text before the columns are laid out, so
  a character that becomes several letters never shifts a column.
  `escPosPrintableText(text, codeTable?)` takes the same optional table;
  without it (or with `null`/`CP1252`) it behaves as before.
- **`CP437` and `§`**: on the old `CP437` name `§` now prints as `Par.`
  (was `?`), with the columns measured after the replacement.

## 1.0.0

The package speaks the English API `/v3` and nothing else, and its own
surface is English as well: exported names, fields, values, error codes,
subpaths, text catalogue keys, placeholders and the contract files in
`fixtures/`. Reason: the backend now runs `/v3` for every endpoint
group, `/v1` is deprecated, and a half-German client on an English wire would
translate twice and drift. One breaking release instead of several: every
consumer migrates once. Rendered texts (messages, labels, printed receipts,
invoice PDFs) are byte for byte the same as in 0.31.0, and so are the printed
bytes of every golden receipt.

Released as `latest` on 30.09.2026, identical in content to 1.0.0-rc.5. The
web register (kasse.kasseneck.at) has run on rc.5 since 29.09.2026. 0.x stays
available under the `legacy` tag and on the `release/0.x` branch.

This entry is written in English, like the developer documentation from here
on.

### 1.0.0-rc.5

Findings from moving the web register onto 1.0.

- **Plain text for edge codes on the register screen.** `ERROR_RULES` is
  unchanged (one rule per kind, as in rc.4), so a register that looks a rule
  up by `kind` alone keeps showing the same sentence. New
  `ERROR_CODE_RULES` refine it per code. `route_missing`, `not_found` and
  `internal_translation_error` (nothing happened on the server) show
  `server.connection_disturbed` ("Die Verbindung zum Kassenserver ist
  gestört. Bitte kurz warten und erneut versuchen."). `dialect_mismatch`,
  `response_translation_failed` and `response_unreadable` (outcome unknown)
  show `server.response_unreadable` ("Die Antwort des Kassenservers war nicht
  lesbar. Bitte die Kasse neu öffnen und vor einem neuen Versuch prüfen, ob
  der letzte Vorgang schon gebucht ist."), which never invites a retry; a
  test holds every code the package treats as outcome-unknown to that. Both
  sentences fit both registers (no page, no browser). The technical
  sentence of the package or the edge stays in `error.message`.
  `findErrorRule(kind, { code, outcome })` applies the code rules, then the
  outcome rules, then `ERROR_RULES`. `pos-texts.json` carries
  `errorCodeRules`, `errorOutcomeRules` and `callsWithEffect` next to
  `errorRules`. `pos-message-cases.json` is at version 2: a case may carry
  `error.code` (`api`) or `error.outcome` (`timeout`, `network`); the cases
  without them are byte for byte those of rc.4. Reason: until 0.31 an HTML
  answer was an HTTP error and showed `server.unexpected`; under 1.0 it is an
  API error, and the register showed "Route fehlt: …" to the cashier.
- **Timeout and network error on a call with an effect never invite a
  retry.** New `ERROR_OUTCOME_RULES`: with outcome `unknown`, `timeout` and
  `network` show `network.outcome_unknown` ("Der Server hat nicht
  geantwortet, der Vorgang kann trotzdem gebucht sein. Bitte vor einem neuen
  Versuch prüfen, ob der letzte Vorgang schon gebucht ist."). New
  `messageOutcome(error)` gives the outcome for the sentence: `unknown` when
  `isOutcomeUnknown` says so, and after a timeout or network error on any
  call in `CALLS_WITH_EFFECT` (the six with an unknown outcome, plus
  `createPrintJob` and `sendReceiptEmail`); fetch fails the same way before
  and after the request left, so the package cannot tell. Every other call
  keeps the rc.4 sentence ("… und erneut versuchen."). Reason: after a
  timeout the receipt, the card payment or the print job may already exist;
  a retry could book or print it twice.
- **New labels:** `register.device_unnamed` ("Kasse", a device without a
  name, `deviceLabel: null`), `login.locked_seconds` (`{seconds}` left of the
  PIN lock), `split.remaining_with_rounding` (`{amount}`, `{cents}` with its
  sign: the last round of a split payment takes the rounding cent). Reason:
  the web register had to write these words itself.
- **`receiptDueCents` throws `ReceiptDueError`, not `RangeError`.** Code
  `receipt_due_unavailable`, the cause in `reason` (`RECEIPT_DUE_ERROR_REASONS`,
  e.g. `tip_without_goods` for a tip with an amount but no goods, also for a
  staff tip), `outcome: 'rejected'`, guard `isReceiptDueError`. The cases are
  in `fixtures/receipt-due-errors.json`. Every computed amount is unchanged
  (the 1206 generated cases). Reason: a `RangeError` without a code could not
  be told apart from a bug, and the register must say "not sent" before it
  starts the card terminal.
- **`./stored`: `fromStoredLayout`, `toStoredLayout`, `fromStoredPrintLogo`,
  `toStoredPrintLogo`.** The internal form of the receipt layout (`regelwerk`,
  banner `ton` `belegart`/`warnung`) and of the print logo (`stufe`,
  `pxBreite`, `pxHoehe`, `breite`, `hoehe`, `zeilen`) to 1.0 and back, checked
  against all 40 golden layouts as 0.31.0 wrote them, byte for byte including
  the key order. `fromStoredLayout` returns `null` for anything short of a
  whole layout (no or empty `lines`, a line that is not an object, no
  `paperSize`), so the caller rebuilds it with the `TESTKASSE` banner.
  Reason: the web register
  cache, the panel and the lab each carried their own copy.
- **`fromStoredReceipt` leaves English 1.0 values as they are** (a fixture
  receipt with `cancellationReason: 'customer_cancelled'`). It did so
  already; now it is promised and tested.
- **`fixtures/v3` refreshed** from the backend (71af3bf). Only the input
  fingerprints in `_quelle` change (the client-version check of 29.09);
  no name, value or code.
- **Contract versions:** a test holds the version in `surface.json`,
  `pos-texts.json`, `invoice-texts.json`, `hobex-hps-codes.json` and
  `invoice-api.schema.json` (and `PACKAGE_VERSION`, `package-lock.json`, this
  file) to `package.json`.

### Migrating from 0.x

#### The 0.x line

0.x keeps talking to `/v1` and gets fixes only. Before 1.0.0 becomes
`latest`, the last 0.x release is to be tagged with the npm dist-tag `legacy`, so
that `npm install @kreiseck/kasseneck-api@legacy` keeps installing it; until then,
pin the 0.x version you use (`@kreiseck/kasseneck-api@^0.31.0`). Nothing forces
an upgrade as long as `/v1` is served.

#### Wire: `/v3` only

- **Base URLs.** Public calls go to `https://api.kasseneck.at/v3`
  (`DEFAULT_BASE_URL`, option `baseUrl`), the register calls to
  `https://kasse.kasseneck.at/api/v3` (`POS_BASE_URL`, new option
  `posBaseUrl`). The browser register on its own origin passes
  `posBaseUrl: '/api/v3'`. The package routes each call itself: the 19
  register-only calls (pairing, sign-in, settings, articles, printers, …)
  always take the register path, and with `registerUserAuth` so do the six
  calls both paths serve (`createReceipt`, `getReceipt`,
  `generateFullReceiptId`, `cancelReceipt`, `sendReceiptEmail`,
  `listMyTipRecipients`). `PUBLIC_CALLS` and `POS_CALLS` list them. Reason:
  the register path and the public API are different hosts with different
  authentication; a single base could not serve both.
- **`baseUrl` now covers public calls only.** Whoever passed `baseUrl` to
  pairing, sign-in or the register calls (the browser register used `/api`)
  switches to `posBaseUrl: '/api/v3'`. Every base must end in `/v3` once
  trailing slashes are removed; `/v1` or a bare `/api` throws a
  `KasseneckValidationError` when the client is created. Reason: a 1.x client
  must never speak `/v1` by accident.
- **Marker, fail closed.** Requests to a Kasseneck base carry
  `Kasseneck-Api-Version: v3` and `Kasseneck-Client: kasseneck-api/<version>`
  (new option `clientHeader` for apps that name themselves). Each response is
  checked before its body is read: HTTP 200 with HTML is `route_missing`, a
  response without `Kasseneck-Api-Version: v3` is `dialect_mismatch`, HTTP 404
  with marker and error envelope is `not_found`. All three are
  `KasseneckApiError`s. In 0.x an HTML page at HTTP 200 was a
  `KasseneckHttpError`. Reason: an answer from an edge without `/v3` may still
  have signed a receipt, and reading it as a 0.x answer would hide that.
- **Browser on another origin.** Until the backend allows the two headers in
  the `/v3` CORS preflight, a browser that calls `api.kasseneck.at/v3` from a
  foreign origin sets the new option `omitKasseneckHeaders: true`. The
  response check stays. Same-origin clients and Node need nothing.
- **English keys, values and codes on the wire.** Error codes are English,
  lower case, `snake_case`: `bereits_storniert` is `already_cancelled`,
  `STORNO_REFUND_REFERENCE_UNKNOWN` is `cancellation_refund_reference_unknown`,
  `PAYMENTS_SUM_MISMATCH` is `payments_sum_mismatch`, `adresse_ungueltig` is
  `invalid_address`, `zu_oft` is `too_many_requests`. Cancellation reasons are
  `input_error`, `customer_cancelled`, `wrong_payment_method`, `duplicate`,
  `other` (the German display text stays in `CANCELLATION_REASONS`). Register
  settings are `{ business, device }` with English keys and values
  (`stil: 'nacht'` is `theme: 'night'`). `listMyReceipts` sends
  `cashregisterId`, `sendReceiptEmail` takes `language` (was `sprache`) and
  reports `via` as `own`, `platform` or `platform_fallback`. The invoice API
  uses `docType` `invoice`/`credit_note` (was `RE`/`GU`) and `taxScheme`
  `intraCommunitySupply` (was `igLieferung`). Texts for people (`message`,
  `serverMessage`, `nextSteps`) and the terms of the BMF and FinanzOnline stay
  German.

#### Behaviour changes

- **`payments[]` is mandatory** on every sale (`sellReceipt`,
  `sellReceiptWithCompany`, `createReceipt` with `standard` or `training`),
  empty only when the amount due is 0. The new `receiptDueCents(items,
  vouchers, receiptType, { tip, tipRecipient })` computes that amount exactly
  as the backend does, including its rounding (checked against 1206 cases
  computed by the backend's own code, `fixtures/receipt-due-generated.json`);
  `receiptDueBreakdown` adds the buckets. `paymentsExpectedCents(error)` reads
  the expected amount of a `payments_sum_mismatch`. Reason: `/v3` knows no
  single payment method; a table that pays with two cards and cash is one
  receipt.
- **`tipRecipient` is required** in `receiptDueCents` (`'owner'` or
  `'staff'`) for a tip without `recipients`, and each `recipients[].owner` is
  required. Reason: an owner's tip is turnover, spread over the goods' VAT
  rates and discounted with them, a staff tip is not; only the register knows
  who is signed in, and a guess would give a wrong amount due. The helper also
  refuses `tip` together with `payments[].tipCents` (`tip_conflict`, as the
  server does). On the sale itself `tip.sofortErhalten` is
  `tip.receivedImmediately`, and unknown tip keys throw.
- **`outcome` on errors.** `KasseneckApiError`, `KasseneckHttpError` and
  `KasseneckNetworkError` carry `outcome: 'unknown' | 'rejected'`
  (`ErrorOutcome`), and `isOutcomeUnknown(error)` covers all three. Unknown
  means the operation may have happened: `dialect_mismatch`,
  `receipt_outcome_unknown`, `cancellation_outcome_unknown`,
  `response_translation_failed` (unless `details.handled === false`),
  `response_unreadable` (a signing or money call reported success but the
  response lacks the receipt, the reference, the remaining quantities, the
  Hobex receipt or the captured payment intent), and on `createReceipt`,
  `cancelReceipt`, `financeWebService`, `hobexPayApi`, `hobexRefundApi` and
  `stripeCaptureIntent` a network error, timeout or HTTP 5xx after sending as
  well as HTTP 200 with the `/v3` marker but an empty, non-JSON (also HTML) or
  status-less body. Never retry those; read the result back. Reason: a
  retried receipt is a second signed receipt in the chain.
- **Money calls have an unknown outcome too (1.0.0-rc.2).** `hobexPay`,
  `hobexRefund` and `stripeCaptureIntent` joined the calls above. In rc.1 a
  timeout, network error or HTTP 5xx on them was `'rejected'`, and a success
  reply without a readable Hobex receipt or payment intent was a
  `KasseneckValidationError` (`scope: 'response'`); now both are `'unknown'`
  (the latter as `KasseneckApiError` `response_unreadable`), and HTML with the
  `/v3` marker is `not-json` with `'unknown'` instead of `route_missing`. An
  error envelope throws a `KasseneckApiError` with its `code`; `hobexRefund`
  never returns `false`. **Callers must never retry these calls, and must not
  pass a `fetch` that retries by itself or wrap the package's requests in a
  retrying layer** (proxy, service worker, HTTP client with a retry policy).
  Reason: an app that read `'rejected'` could charge or refund a card twice;
  a silent resend below the package does the same without any error. Same
  change as in the Dart twin `kasseneck_api` (no `RetryClient`).
- **Findings of the Dart twin (1.0.0-rc.3).** `listMyCashregisters` reads
  the start receipt under `onboarding.start_receipt_created`/`_transmitted`
  (`_at`) as `/v3` sends it; rc.1 and rc.2 read the internal
  `startbeleg_*` names and reported every register as having no start
  receipt (`CashregisterOnboardingPayload` changes accordingly). The fields
  of `CashregisterOnboarding` are English now as well: `startbelegCreated`
  is `startReceiptCreated`, `startbelegTransmitted` is
  `startReceiptTransmitted`, `startbelegCreatedAt` is `startReceiptCreatedAt`,
  `startbelegTransmittedAt` is `startReceiptTransmittedAt`; the German-name
  guard no longer exempts `startbeleg`.
  `sendReceiptEmail` reads its success reply leniently: without `to` it
  returns the address you sent, without `at` it returns `at: null`
  (`SendReceiptEmailResult.at` is `string | null`); throwing there would
  invite a second email. `listMyPrinters` without `data.printers` and
  `createPrintJob`/`getPrintJob` without `data.jobId` throw a
  `KasseneckValidationError` (`scope: 'response'`) instead of returning an
  empty list or an empty id: "no printer yet" must not look like a broken
  reply, and a job without an id cannot be polled, so the cashier would print
  again. `setMyRegisterDeviceSettings` takes `shortcuts` only as the whole map
  of known actions (as `posSettingsChanges` produces it): the server checks
  keys bound twice only within the map it receives.
- **Money calls: an error envelope is not a rejection (1.0.0-rc.4).** On
  `hobexPayApi`, `hobexRefundApi` and `stripeCaptureIntent` an error envelope
  without a code is `outcome: 'unknown'`, and so is every code outside the
  23 rejection codes, all raised before the provider is called: the
  sign-in codes (`errorCodes.auth` without the seven of the partner
  access), the edge codes `validation`, `not_found` and
  `internal_translation_error`, the gates `module_inactive` and
  `not_permitted`, and `route_missing`. `dialect_mismatch` and `response_translation_failed` (also
  with `handled: false`) stay `'unknown'` there. rc.2 and rc.3 read an
  envelope without a code as `'rejected'`, and the README called a retry
  after `'rejected'` safe. Reason: the Hobex and Stripe handlers also answer
  with a plain error message after the provider was called ("Error hobex
  details", "Fehler beim Capturing"), so the card may be charged, the refund
  paid or the payment captured. Same list as in the Dart twin
  `kasseneck_api`.
- **Strict validation before sending.** The 0.x payment fields
  (`paymentMethod`, `paymentMethodFromServer`, `creditCardProvider`,
  `cardPaymentId`, `cardPaymentData`) throw, also from plain JavaScript.
  Unknown keys in tips, layout options, register settings and
  `sendReceiptEmail` throw; for the layout options of 0.x (`testKasse`,
  `testSignatur`, `pruefangaben`, `regelwerk`) the message names the English
  successor. Settings values outside a field's list, a `vatRates` map without
  any rate switched on, unknown shortcut actions and a key bound twice are
  rejected. A card refund through a provider without its own
  `providerPaymentId` and without the original payment's id throws before
  sending. Reason: under 0.x an unknown German option was ignored, and a test
  receipt could silently lose its TESTKASSE banner.
- **Register settings: send only what changed.** Values the package does not
  know are kept as read (`PosOpen<T>`, `unknownPosSettingValues`) and never
  replaced by a default; `posSettingsChanges(before, after)` produces the
  patch, with `vatRates` and `shortcuts` as whole maps. `mergePosSettings`
  always drops the German values of 0.x; `sanitizePosSettings` does the same
  for a state you stored yourself. Reason: the server merges deeply, and a
  whole block would overwrite values a newer server knows.
- **Unknown values stay visible.** `ReceiptSummary.cancellationStatus`
  (was `stornoStand` `offen`/`teil`/`voll`) is `none`/`partial`/`full`, or
  `'unknown'` for a value this version does not know; a missing field stays
  missing and never becomes `none`. `PrintJobStatus` gains `'unknown'`, and
  `isPrintJobFinished` treats it as final.
- **Server layout first.** `receiptLayoutFromResult(result, {
  fallbackPaperSize })` returns the server's `layout` (80 mm) whenever the
  response carries one and only builds one otherwise (default `mm58`, as in
  0.x). Print width is chosen by the print path. Reason: on the public
  channel only the server's layout carries the card block.
- **Error catalogues per endpoint group, one shape everywhere.**
  `RECEIPT_ERROR_CODES` (new), `CANCELLATION_ERROR_CODES`,
  `PAYMENT_ERROR_CODES`, `RECEIPT_EMAIL_ERROR_CODES`, `REGISTER_ERROR_CODES`
  (new) and `POS_ERROR_CODES` (new) list the group's own codes, then the
  sign-in and edge codes that can reach it, then the codes the package sets
  itself (`CLIENT_ERROR_CODES`: `route_missing` everywhere,
  `response_unreadable` for receipts and cancellations), so the derived types
  are wider. The `payments[]` codes of a sale or cancellation
  (`payments_sum_mismatch`, `payment_method_not_supported`, …) are in
  `PAYMENT_ERROR_CODES`: a sale can answer with a code from
  `RECEIPT_ERROR_CODES` or `PAYMENT_ERROR_CODES`, a cancellation with one from
  `CANCELLATION_ERROR_CODES` or `PAYMENT_ERROR_CODES`.
  `RECEIPT_EMAIL_SEND_ERROR_CODES` holds the four sending codes.
  `INVOICE_ERROR_CODES` and `PARTNER_ERROR_CODES` stay the server's catalogues;
  `INVOICE_REQUEST_ERROR_CODES` (new) and `PARTNER_REQUEST_ERROR_CODES` add
  the sign-in, edge and package codes. Every group offers
  `is…ErrorCode(value)`, `…ErrorCode(error)`, `is…Error(error, code?)` (a type
  guard, code optional) and `…FieldErrors(error)`; new are `isReceiptError`,
  `isCancellationError`, `isPaymentError`, `isReceiptEmailError`,
  `isInvoiceErrorCode`, `receiptFieldErrors`, `cancellationFieldErrors`,
  `paymentFieldErrors`, `receiptEmailFieldErrors` and `registerFieldErrors`, and
  `isInvoiceError` takes the code as optional.
- **Partner.** `partnerErrorAdvice` (was `partnerFehlerRat`) always returns a
  sentence, with a fallback for unknown codes; `isPartnerError` accepts
  unknown codes. `reportCustomerContract` is offered now.
- **Tree shaking.** `package.json` declares `"sideEffects": false`, so a
  bundler drops every module whose exports are unused (esbuild, one import of
  `isOutcomeUnknown` from the root: 13 kB before, 2 kB after). No module
  changes anything outside itself when imported, and the package ships no
  CSS; the build checks both (`scripts/check-build-exports.mjs`). Parameter
  names of exported functions and methods are English now as well (for
  example `rasterizeLogo(rgba, pxWidth, pxHeight, dimensions, chars)`); that
  changes nothing at runtime.

#### Exported names

Every German export name has an English successor; there are no aliases, so
the compiler finds every place to change. The most common ones:

| Area | 0.x | 1.0 |
|---|---|---|
| root | `AUFRUFE`, `Aufruf` | `ALL_CALLS`, `ApiCall` |
| root | `KASSE_BETRIEB_STANDARD`, `KASSE_GERAET_STANDARD`, `mergeKasseSettings`, `fromKasseArtikelPayload` | `POS_BUSINESS_DEFAULTS`, `POS_DEVICE_DEFAULTS`, `mergePosSettings`, `fromPosArticlePayload` |
| root | `KasseSettings`, `KasseSettingsBetrieb`, `KasseSettingsGeraet`, `KasseArtikel` | `PosSettings`, `PosBusinessSettings`, `PosDeviceSettings`, `PosArticle` |
| layout | `AKTUELLES_REGELWERK`, `LayoutRegelwerk`, `Pruefangaben` | `CURRENT_LAYOUT_RULESET`, `LayoutRuleset`, `RegistrationInfo` |
| layout options | `testKasse`, `testSignatur`, `pruefangaben`, `regelwerk` | `testCashregister`, `testSignature`, `registrationInfo`, `ruleset` |
| `ReceiptWithCompany` | `testKasse`, `testSignatur`, `kopfId`, `pruefangaben`, `logoStufe` | `testCashregister`, `testSignature`, `headerVersionId`, `registrationInfo`, `logoScale` |
| `ReceiptCompany` | `taxnr`, `uid` | `taxNumber`, `vatId` |
| layout lines | `regelwerk`, `ton` (`belegart`, `warnung`) | `ruleset`, `tone` (`receipt_type`, `warning`) |
| receipt sheet | `belegBlatt`, `BelegBlatt`, `BlattBlock`, `LogoStufe`, `logoRaster`, `logoMass` | `receiptSheet`, `ReceiptSheet`, `SheetBlock`, `SheetLogoSize`, `rasterizeLogo`, `logoDimensions` |
| sheet fields | `zeichen`, `bloecke`, `art`, `fett`, `marke`, `stufe`, `pxBreite`, `pxHoehe` | `charsPerLine`, `blocks`, `kind`, `bold`, `brandMark`, `size`, `pixelWidth`, `pixelHeight` |
| printing | `qrGroesseFuer`, `QR_DRUCK_PUNKTE`, `QrModulGroesse` (`klein`/`mittel`/`gross`) | `qrSizingFor`, `QR_PRINT_WIDTH_DOTS`, `QrModuleSize` (`small`/`medium`/`large`) |
| printing options | `qrGroesse`, `qrModus`, `qrAusweich`, `qrFehler`, `marke` | `qrModuleSize`, `qrMode`, `qrFallback`, `qrError`, `brandMark` |
| React | `BelegBlattView`, `BelegBlattZeilen`, `qrVerdeckt` | `ReceiptSheetView`, `ReceiptSheetLines`, `qrHidden` |
| `./pos` | `getKasseSettings`, `setMyKasseSettings`, `KASSE_TASTEN_AKTIONEN`, `TASTEN_AKTIONEN` | `getPosSettings`, `setMyPosSettings`, `POS_SHORTCUT_ACTIONS` |
| `./pos` value lists | `STIL`, `SCHRIFT`, `DRUCKER_ART`, `PAPIER`, `KASSIEREN_MODUS`, … | `THEME`, `FONT_SIZE`, `PRINTER_TYPE`, `PAPER_SIZE`, `CHECKOUT_MODE`, … |
| `./pos` texts | `MELDUNGEN`, `BESCHRIFTUNGEN`, `meldung`, `beschriftung`, `BELEG_MAIL_FEHLER`, `belegMailFehler` | `MESSAGES`, `LABELS`, `messageText`, `labelText`, `RECEIPT_EMAIL_ERROR_MESSAGES`, `receiptEmailErrorMessage` |
| `./pos` printers | `NetzDrucker`, `DruckJob`, `druckerId`, `titel`, `quelle`, `marke` | `NetworkPrinter`, `PrintJob`, `printerId`, `title`, `source`, `brandMark` |
| `./register` | `RegisterGeraeteAngaben`, `RegisterSessionsStand`, `altbestand`, `selbst` | `RegisterDeviceInfo`, `RegisterSessionOverview`, `pinPolicyOutdated`, `own` |
| `./invoice` | `createRechnungApi`, `rechnungKeyAuth`, `istRechnungFehler`, `rechnungFeldFehler`, `RECHNUNG_TEXTE` | `createInvoiceApi`, `invoiceKeyAuth`, `isInvoiceError`, `invoiceFieldErrors`, `INVOICE_TEXTS` |
| `./invoice` | `rechnungSummen`, `RECHNUNG_AUFRUFE`, `RECHNUNG_VERTRAG_VERSION` (1) | `computeInvoiceTotals`, `INVOICE_ENDPOINTS`, `INVOICE_CONTRACT_VERSION` (2) |
| `./invoice/calc` | `rechnungRechnen`, `positionAusEuro`, `RechenFehler`, `STEUERFREIE_FAELLE`, `BETRAG_GRENZE_CENTS` | `calculateInvoice`, `itemFromEuro`, `CalcError`, `ZERO_RATED_TAX_SCHEMES`, `MAX_AMOUNT_CENTS` |
| `./invoice/calc` codes | `kein_ganzzahlwert`, `ausserhalb`, `kein_zahlwert`, `nachkommastellen` | `not_integer`, `out_of_range`, `not_a_number`, `too_many_decimals` |
| `./partner` | `PARTNER_ABLAUF`, `PARTNER_FEHLER_CODES`, `istPartnerFehler`, `partnerFehlerRat`, `partnerFeldFehler` | `PARTNER_FLOW`, `PARTNER_ERROR_CODES`, `isPartnerError`, `partnerErrorAdvice`, `partnerFieldErrors` |
| `./partner` types | `Betrieb`, `Kunde`, `Kasse`, `SignaturStand`, `WebhookZustellung` | `Business`, `PartnerCustomer`, `CustomerCashregister`, `CustomerSignatureStatus`, `WebhookDelivery` |
| enums | `VatRate.vat4komma9` | `VatRate.vat4_9` |
| misc | `KasseneckSecret.vorhanden`, `UsbTimeoutError.schritt`, `istZeroKind`, `verteileRabatt` | `hasValue`, `step`, `isZeroKind`, `distributeDiscount` |

The register settings fields follow the `/v3` vocabulary (`logoAn` is
`logoEnabled`, `zahlGetrennt` is `paySplit`, `kassierenModus` is
`checkoutMode`, `druckerArt` is `printerType`, `tasten` is `shortcuts`, the
shortcut action `kassieren` is `checkout`, `getrennt` is `splitPayment`, …).
The complete list of settings keys and values, like every other renamed
key in the contract files, is in `fixtures/renames-1.0.json` (`structure`,
`values`). For export names the TSDoc of each 1.0 export and the compiler are
the reference: an old name no longer resolves.

#### Subpaths

| 0.x | 1.0 |
|---|---|
| `@kreiseck/kasseneck-api/kasse` | `@kreiseck/kasseneck-api/pos` |
| `@kreiseck/kasseneck-api/rechnung` | `@kreiseck/kasseneck-api/invoice` |
| `@kreiseck/kasseneck-api/rechnung/rechnen` | `@kreiseck/kasseneck-api/invoice/calc` |
| (none) | `@kreiseck/kasseneck-api/stored` |

The old subpaths are gone, not aliased.

#### Text keys and placeholders

The keys of the register catalogue (`MESSAGES`, `LABELS`) and of the invoice
texts are English: `storno.ergebnis_unklar` is `cancellation.outcome_unknown`,
`getrennt.*` is `split.*`, `kartenzahlung.*` is `card_payment.*`,
`abschluss.*` is `completion.*`, `steuer.igLieferung.titel` is
`tax.intra_community_supply.title`. Every part is lower case with underscores,
only country codes stay upper case (`country.AT`). Placeholders are English
too: `{betrag}` is `{amount}`, `{grund}` is `{reason}`, `{sekunden}` is
`{seconds}`, `{uid}` is `{vatId}`, and so on for 25 of 30 names; pass the
values under the new names (`messageText('checkout.locked', { reason })`). An
old name throws as a missing value. `ERROR_RULES` entries use
`kind`/`behavior`/`key` with the kinds `api`, `plain_text`, `timeout`,
`network`, `unexpected`, `other`. Every rendered text is unchanged; a test
fills each text of both catalogues old and new with the same values and
compares them character for character. The full key and placeholder tables
are `texts` and `placeholders` in `fixtures/renames-1.0.json`.

#### Contract files

The files in `fixtures/` have English paths and keys: `kasse-texte.json` is
`pos-texts.json`, `oberflaeche.json` is `surface.json`,
`kasse-settings-standard.json` is `pos-settings-defaults.json`,
`rechnung-texte.json` is `invoice-texts.json`, `belege/` is `receipts/`,
`erwartet/` is `expected/` (`.blatt32.json` is `.sheet32.json`), golden
receipts are renamed (`verkauf-bar` is `sale-cash`, `storno-voll` is
`cancellation-full`), and the manifest uses `ruleset`, `receipts`, `input`,
`expected`. `surface.json` replaces `aufrufe` with `baseUrls`, `calls` and
`routes`. `fixtures/renames-1.0.json` lists every path and key that changed
from 0.30.0/0.31.0, the renamed machine values and the shape changes; a test
checks it against the frozen 0.x inventory, so no old key is missing. New: `fixtures/v3/` (the backend's `/v3` contract, copied byte for
byte), `receipt-due-generated.json`, `stored/pos-settings-defaults.json`.

#### Removed

- `createCancelReceipt`, `CreateCancelReceiptOptions` and cancelling through
  `createReceipt` with `receiptType: 'cancellation'`: use `cancelReceipt`.
- The single-payment path: `paymentMethod`, `paymentMethodFromServer`,
  `creditCardProvider`, `cardPaymentId`, `cardPaymentData` on sales and
  cancellations, and `SellReceiptWithPaymentsOptions` (there is only one way
  to sell now).
- The deprecated aliases of 0.28: `Rechtsform`, `Bundesland`, `KontaktRolle`
  (use `LegalForm`, `AustrianState`, `ContactRole`).
- `KASSE_TASTEN_AKTIONEN` and `TASTEN_AKTIONEN` as two names for one list:
  there is only `POS_SHORTCUT_ACTIONS`.

#### New

- `…/stored`: `fromStoredReceipt`, `fromStoredReceiptWithCompany`,
  `fromStoredCompany`, `fromStoredPosSettings`, `invalidStoredPosSettings`,
  `fromStoredArticle` turn stored Firestore documents into the `/v3` models,
  following the server's rules. For clients that read Firestore directly.
- Receipts: `receiptDueCents`, `receiptDueBreakdown`, `paymentsExpectedCents`,
  `cardRefundReference`, `receiptLayoutFromResult`, `getReportV2`,
  `RECEIPT_ERROR_CODES`/`isReceiptErrorCode`, `CANCELLATION_STATUSES`,
  `RECEIPT_EMAIL_VIAS`, `RECEIPT_EMAIL_SEND_ERROR_CODES`.
- Transport: `POS_BASE_URL`, `PUBLIC_CALLS`, `POS_CALLS`, options
  `posBaseUrl`, `clientHeader`, `omitKasseneckHeaders`; `ErrorOutcome`,
  `isOutcomeUnknown`.
- `…/register`: `REGISTER_ERROR_CODES`, `isRegisterErrorCode`,
  `registerErrorCode`, `isRegisterError`, `registerErrorDetails`; the pairing
  result carries `companyName`, `cashregisterLabel` and `testEnvironment`.
- `…/pos`: `posSettingsChanges`, `sanitizePosSettings`,
  `unknownPosSettingValues`, `posSettingsFromWire`, `POS_BUSINESS_VALUES`,
  `POS_DEVICE_VALUES`, `POS_SHORTCUT_SHARED_PAIRS`, `posShortcutConflict`,
  `setMyPosLogo`, `isPrintJobFinished`, `POS_ERROR_CODES`, `isPosError`,
  `posFieldErrors`, `QUANTITY_RULES`, `PRINT_JOB_STATUSES`,
  `PRINT_JOB_SOURCES`.
- `…/partner`: `reportCustomerContract`, `PARTNER_REQUEST_ERROR_CODES`, the
  value lists `LEGAL_FORMS`, `AUSTRIAN_STATES`, `CONTACT_ROLES`, `AVV_MODES`,
  `FEE_INTERVALS`, `CONTRACT_KINDS`, `CONTRACT_SOURCES`,
  `SIGNATURE_HISTORY_REASONS`, `SIGNATURE_ERROR_CODES`,
  `WEBHOOK_DELIVERY_STATUSES`, and the events `customer.avv_accepted` and
  `customer.terms_accepted` in `PARTNER_WEBHOOK_EVENTS`.
- `…/invoice`: `WRITE_OFF_REASON_CODES`, `EINVOICE_MISSING_CODES`;
  `getInvoiceXml` returns `{ xml, format, filename }` instead of the bare XML
  text; `InvoiceDetail.payments[]` carries `id` and `reference`.

## 0.31.0

Texte und Einstellung für „Getrennt zahlen" an der Kasse (ein Tisch zahlt in Teilen, ein Beleg mit
mehreren Zahlungen). Nur Texte, eine Einstellung und eine Tasten-Aktion; kein Aufruf und kein
Rechenweg ändert sich.

- **`tenderedCents` an jeder Barzahlung**: die Doku an `ReceiptPaymentInput` und
  `PAYMENT_TENDERED_INVALID` sagte „höchstens an einer Zahlung“. Das Backend erlaubt jetzt jeder
  Barzahlung ihren eigenen gegebenen Betrag. Grund: beim getrennten Zahlen gibt jeder Gast selbst,
  der Bon zeigte Gegeben/Rückgeld aber nur beim letzten. Der Bon druckte schon je Zahlung; ein Test
  hält drei Barzahlungen mit je eigenem Rückgeld fest.
- **Neue Sätze in `MELDUNGEN`** unter `getrennt.*` (Hinweis zur Einstellung, Prüfungen der
  Teilzahlung, gesperrter Warenkorb, Rückbuchung bar/Terminal/Karte ohne Anbindung, angefangene
  Sitzung nach dem Neuladen) und unter `storno.*` (Rückgabe je Zahlung, Karten nach dem Storno von Hand gutschreiben).
  Grund: Browser-Kasse und Kassen-App sollen am Tresen dieselben Worte sagen; eine schon belastete
  Karte nennt in jedem Satz den Betrag, und keiner rät zum zweiten Kassieren.
- **`STORNO_ZAHLUNG_FEHLER`**: Zuordnung der Backend-Codes `STORNO_PAYMENTS_REQUIRED`,
  `STORNO_REFUND_EXCEEDS_PAYMENT`, `STORNO_REFUND_REFERENCE_REQUIRED`,
  `STORNO_REFUND_REFERENCE_UNKNOWN` und `PAYMENTS_SUM_MISMATCH` zu ihrem Satz, auch in
  `fixtures/kasse-texte.json` (`stornoZahlungFehler`). Grund: beide Kassen entscheiden am Code,
  nie am Wortlaut des Backends. `stornoZahlungFehler(code)` liefert den Schlüssel dazu, ein
  unbekannter Code fällt auf `storno.fehlgeschlagen` (wie `belegMailFehler`).
- **Neuer Storno-Code `STORNO_OUTCOME_UNKNOWN`** am Ende von `CANCELLATION_ERROR_CODES` (Zwilling
  von `STORNO_FEHLERCODES` in `functions/gemeinsam/storno-core.js`; unter `/v3`
  `cancellation_outcome_unknown`, `isCancellationErrorCode` prüft weiter exakt) mit dem Satz
  `storno.ergebnis_unklar`. Grund: der Storno-Beleg kann schon signiert sein, obwohl der Ausgang
  offen ist; wer dann noch einmal storniert, storniert womöglich doppelt. Der Satz rät darum,
  nicht zu wiederholen und die Belegliste später neu zu laden.
- **Aufteilung als eigener Schritt**: neue Beschriftungen `getrennt.weiter` („Weiter · {betrag}
  getrennt“), `getrennt.aufteilung`, `getrennt.zurueck_zahlart`, `getrennt.tab_positionen`,
  `getrennt.tab_betrag`, `getrennt.stueck_mehr`/`_weniger`,
  `getrennt.gegeben`, `getrennt.gegeben_rueckgeld` und die Sätze
  `getrennt.positionen_gesperrt` und `getrennt.positionen_waehlen`. Grund: Nutzertest – erst
  „Weiter“, dann je Zahlung nach Positionen (stückweise) oder als Betrag. Nach einer Zahlung als
  Betrag ist „Nach Positionen“ gesperrt, weil sich Beträge keinen Stücken zuordnen lassen; der
  Satz sagt das.
- **Zahlart je Zahlung, ein Knopf zum Hinzufügen**: `getrennt.zahlart` („Zahlart“),
  `getrennt.art_bar`/`getrennt.art_karte` („Bar“/„Karte“) als Umschalter oben in der Zahlung,
  `getrennt.zahlung_hinzufuegen` („Zahlung hinzufügen · {betrag}“) für den einen Knopf unten
  rechts und der Satz `getrennt.gegeben_fehlt` (Barzahlung ohne „Gegeben“ bei eingeschaltetem
  Rückgeld-Rechner, Wortlaut wie beim Abschluss). `getrennt.bar_kassieren`/`getrennt.karte_kassieren`
  und `getrennt.kassieren` („Zahlung {n} kassieren“) entfallen (noch nie veröffentlicht). Grund: Nutzertest – zwei Knöpfe, die sofort kassieren,
  lagen zu nah beieinander; jetzt wählt der Kassier die Zahlart wie jede andere Eingabe, und nur
  ein Knopf löst die Zahlung aus. Offen 0 macht aus demselben Knopf „Abschließen“.
- **Nach Positionen als Kacheln**: `getrennt.offene_positionen`, `getrennt.stueck_offen`
  („{n} offen“), `getrennt.stueck_gewaehlt` („{n} von {offen}“), `getrennt.nichts_gewaehlt` und
  `getrennt.alles_bezahlt`. `getrennt.stueck_bezahlt` entfällt (noch nie veröffentlicht): bezahlte
  Stück verschwinden aus der Auswahl. Grund: Nutzertest – in der großen Fläche stehen nur noch die
  offenen Produkte als Kacheln, der Kassier tippt dort an, was dieser Gast zahlt.
- **`BESCHRIFTUNGEN` und `beschriftung()`**: ein zweiter Katalog für Knöpfe und Zeilennamen
  („Getrennt", „Zahlung {n}", „Offen", „Rest", „÷ {n}", „davon Trinkgeld {betrag}", „Wie
  zurückgeben?", „Alles bar", „Mehrere" …), in `fixtures/kasse-texte.json` unter `beschriftungen`.
  Grund: `MELDUNGEN` führt nur Sätze (die Wächter beider Kassen erkennen Sätze daran), „Rest" ist
  keiner – muss aber in beiden Kassen gleich heißen. Die Zahlarten folgen dem Bon
  („Kartenzahlung", „Barzahlung").
- **Vier weitere Sätze unter `getrennt.*`**: `sitzung_unlesbar` (eine auf dem Gerät abgelegte
  Sitzung lässt sich nicht mehr lesen – auf schon belastete Karten hinweisen, im Panel oder am
  Terminal nachsehen lassen), `ablage_fehlgeschlagen` (die Ablage schlägt fehl – vor dem
  Neuladen warnen, sonst verschwinden belastete Karten aus der Liste), `zu_viele_zahlungen`
  (höchstens 20 Zahlungen je Beleg) und `entkoppeln_offene_karten` (ein entkoppeltes Gerät hatte
  noch offene Kartenzahlungen – die Beträge stehen daneben, der Satz selbst bleibt ohne
  Platzhalter). Grund: die Ablage der Teilzahlung läuft rein lokal auf dem Gerät; geht sie
  verloren oder lässt sie sich nicht lesen, ist eine schon belastete Karte das teure Risiko, und
  der Satz muss zum Nachschauen anleiten statt zum Weiterkassieren zu verleiten.
- **Einstellung `zahlGetrennt`** (Betrieb, Standard `false`) und **Tasten-Aktion `getrennt`**
  (ohne Vorgabe-Taste). Grund: für Betriebe ohne Bedarf bleibt die Kasse, wie sie ist; eine
  unerprobte Vorgabe-Taste finge womöglich der Browser ab. Das Backend (`kasse-settings-core.js`)
  muss beide nachziehen, sonst verwirft sein Validator den Wert beim Speichern.
- **Vorgabe `kassierenModus` jetzt `'panel'`** (vorher `'seite'`): kassiert wird im Korb-Panel,
  die Kacheln bleiben stehen. Grund: Nutzertest – so bleibt der Kachelbereich beim Kassieren
  sichtbar, auch beim getrennten Zahlen. Ein gespeichertes `'seite'` bleibt; gespeichert werden
  aber nur geänderte Felder, darum wechselt jedes Konto, das den Schalter nie angefasst hat, mit
  dem Backend-Standard auf das Korb-Panel. Das Backend (`BETRIEB_STANDARD` in
  `kasse-settings-core.js`) und der Dart-Zwilling ziehen denselben Wert nach.
- **Texte, die bisher nur in der Browser-Kasse standen, jetzt im Katalog**: Sätze
  `kassieren.nichts_erfasst`, `kassieren.gegeben_fehlt`, `kassieren.gegeben_zu_wenig`,
  `kassieren.gesperrt` („Kassieren gesperrt: {grund}“), `trinkgeld.ueber_haelfte`,
  `sitzung.meldet_ab` („Kasse meldet in {sekunden} s ab …“), `abmelden.noch_einmal`,
  `kartenzahlung.terminal_bricht_ab` und `connect.entkoppeln_frage` (nur Web); Beschriftungen
  `kassieren.trinkgeld`, `kassieren.kein`, `kassieren.eigener_betrag`, `kassieren.passend`,
  `kassieren.gegeben_loeschen`, `kassieren.es_fehlen_noch`, `kassieren.rueckgeld`,
  `kartenzahlung.betrag_am_terminal`, `kartenzahlung.karte_vorhalten` („… · noch {zeit}“),
  `kopplung.neu_koppeln`, `abmelden.frage`, `abmelden.weiter_arbeiten`, `geraet.entkoppeln`,
  `connect.entkoppeln_bestaetigen` (nur Web), `storno.titel` („Storno zu {beleg}“),
  `meldung.ausblenden` („Meldung ausblenden: {meldung}“) und `meldung.warnung_ausblenden`
  („Verstanden – Warnung ausblenden: {meldung}“). Wortlaut wie bisher in der Browser-Kasse.
  Grund: Oberflächen-Vertrag – beide Kassen zeigen dieselben Wörter; das X an einer Meldung nennt
  jetzt, welche Meldung es ausblendet (in der Ecke stehen oft mehrere).
- **Halbgeviertstrich statt Geviertstrich** in allen sichtbaren Texten von `MELDUNGEN` (u. a.
  `abschluss.unklar`, `kartenzahlung.unklar`, `kartenzahlung.karte_gebucht_beleg_offen`,
  `connect.*`, `druck.*`) und in den Sätzen der Hobex-Antwortcodes (`transaction-response.ts`,
  auch `fixtures/hobex-hps-codes.json`): „ – “ statt „ — “. Nur das Zeichen ändert sich, kein
  Wortlaut und kein Schlüssel. Wer einen dieser Sätze wörtlich vergleicht, muss nachziehen.
  Grund: einheitliche Typografie am Bildschirm; der Geviertstrich wirkt dort wie ein
  Maschinenzeichen. Die Rechnungstexte (`rechnung/texte.ts`, PDF) bleiben unverändert.
- **`Cancellation` trägt `refundedByPayment`** (Zahlungs-ID auf positive Cent), Zwilling der
  gleichnamigen Backend-Ablage (`functions/gemeinsam/storno-core.js`). Die Lesung
  (`fromReceiptPayload`) behält nur ganzzahlige, nicht negative Werte, verwirft ungültige
  Einträge einzeln statt den ganzen Eintrag zu verwerfen, und lässt das Feld weg, wenn die
  Nutzlast es nicht trägt – bestehende Belege lesen sich unverändert. Auch am `pending`-Eintrag
  vorhanden. Grund: über alle Storno-Einträge darf je Zahlung nie mehr zurückgehen, als bezahlt
  wurde; ohne das Feld ließe sich das am Client nicht nachvollziehen.
- **Weitere Sätze in `MELDUNGEN`**: `getrennt.karte_bereits_zurueckgebucht` (das Terminal meldet
  eine Gutschrift, die hier noch als offene Rückbuchung steht), `abschluss.erledigen_frage` (nur erledigen, was wirklich in der Belegliste steht),
  `kartenzahlung.korb_gesperrt_karte_belastet` und `kartenzahlung.entkoppeln_karte_belastet`.
  Grund: jeder dieser Zustände ist eine schon belastete oder gutgeschriebene Karte ohne
  passenden Beleg – der teuerste Fehler am Tresen ist die doppelte Buchung, und kein Satz davon
  darf zum Wiederholen raten, ohne vorher den Terminal-Beleg zu nennen.
- **Weitere `BESCHRIFTUNGEN`**: `allgemein.abbrechen`, `abschluss.beleg_vorhanden`,
  `abschluss.erledigen`, `getrennt.karte_zurueckbuchen`, `getrennt.trotzdem_neu_koppeln`,
  `getrennt.zahlung_behalten`, `getrennt.klaeren`, `getrennt.wurde_belastet`,
  `getrennt.nicht_belastet`, `getrennt.erneut_zurueckbuchen`, `storno.differenz`. Grund: Knöpfe
  zu den neuen Sätzen oben, in beiden Kassen gleich beschriftet.
- **Storno eines Belegs mit mehreren Zahlungen: Karten gehen von Hand zurück.**
  `storno.karten_gutschreiben` steht nach dem gebuchten Storno über der Liste der Karten zum
  Abhaken (eine oder mehrere, mit oder ohne Anbindung); `storno.ergebnis_unklar_karten` ersetzt
  `storno.ergebnis_unklar`, wenn der gesendete Vorschlag Karten enthielt – erst die Belegliste
  neu laden, erst dann gutschreiben (`STORNO_ZAHLUNG_FEHLER` zeigt weiter auf
  `storno.ergebnis_unklar`, die Wahl trifft die Kasse am Vorschlag). Die Sätze und Knöpfe einer
  Gutschrift am Terminal VOR dem Senden (`storno.gutschrift_laeuft`,
  `storno.gutschrift_fehlgeschlagen`, `storno.gutschrift_unklar`,
  `storno.gutgeschrieben_nicht_gebucht`, `storno.gutschrift_pruefen`,
  `storno.extern_gutschreiben`, `storno.am_terminal_gutgeschrieben`,
  `storno.nicht_gutgeschrieben`) sind wieder entfernt; sie waren nie veröffentlicht. Grund:
  eine Gutschrift vor dem gebuchten Storno lässt Geld zurückgehen, ohne dass ein Storno-Beleg
  sicher entsteht; die automatische Gutschrift kommt als eigener Schritt mit
  Server-Unterstützung.
- **`storno.karten_nicht_abgehakt`**: wird die Liste der Karten nach dem gebuchten Storno
  geschlossen, obwohl nicht jede Karte abgehakt ist, fragt die Kasse einmal nach. Grund: eine
  vergessene Gutschrift fällt sonst erst dem Gast auf, und am Storno-Beleg sieht sie niemand mehr.

## 0.30.0

Mehrere Zahlungen je Beleg. Setzt ein Backend mit `payments` voraus (keck, live seit
2026-09-25); gegen einen älteren Server bleibt alles ohne `payments` wie bisher. Nichts bricht:
ein Beleg ohne Zahlungsliste liest, sendet und druckt sich byte-gleich wie in 0.29.0.

- **`Receipt` und `ReceiptSummary` tragen `payments` (`ReceiptPayment[]`), wenn der Server sie
  liefert**, je Zahlung Zahlart, `amountCents`, bei Bar `tenderedCents`/Rückgeld, bei Karte
  Anbieter und Terminaldaten, bei Stornos `refundOf`, dazu `tipCents` (Trinkgeld je Zahlung).
  Grund: ein Tisch zahlt mit zwei Karten und dem Rest bar, und das Einzelfeld `paymentMethod`
  konnte das nicht abbilden. Altbelege ohne Liste lesen sich unverändert (`payments` fehlt).
- **`KeckPaymentMethod.mixed` („Mehrere Zahlungsarten")**, nur zum Lesen. Der Server setzt ihn als
  `paymentMethod`, wenn die Zahlungen verschiedene Zahlarten haben; wer ihn selbst sendet, wird
  schon im Client abgewiesen. Grund: sonst wäre ein solcher Beleg für einen älteren Leser eine
  unbekannte Zahlart; zum Kassieren gibt es die Zahlungsliste.
- **`payments` bei `sellReceipt`, `createReceipt` und `cancelReceipt`**, mit Form- und
  Konfliktprüfung im Client (`payments` zusammen mit `paymentMethod` oder Kartenfeldern ergibt
  `PAYMENTS_CONFLICT`; `payments: null` gilt als nicht angegeben). Für `sellReceipt` gibt es den
  neuen Typ `SellReceiptWithPaymentsOptions`; `SellReceiptOptions` bleibt ein `interface` und
  bekommt nur das optionale `payments?: undefined`, damit bestehender Code unverändert kompiliert
  und die beiden Wege sich nicht mischen lassen. Beim Storno nennt `refundOf` die Zahlung des
  Originals, auf die zurückgezahlt wird.
- **`PAYMENT_ERROR_CODES` (18 Codes) und `isPaymentErrorCode`**, Zwilling von
  `ZAHLUNGS_FEHLERCODES` im Backend (gleiche Codes, gleiche Reihenfolge). `isPaymentErrorCode`
  erkennt auch die kleingeschriebene `/v3`-Schreibweise, weil `/v3` diese Codes 1:1 klein
  ausliefert. Grund: am Code entscheiden, nie am Text.
- **`CANCELLATION_ERROR_CODES` um vier `STORNO_…`-Codes ergänzt** (`STORNO_PAYMENTS_REQUIRED`,
  `STORNO_REFUND_EXCEEDS_PAYMENT`, `STORNO_REFUND_REFERENCE_REQUIRED`,
  `STORNO_REFUND_REFERENCE_UNKNOWN`) für die Rückzahlung je Zahlung. `isCancellationErrorCode`
  prüft weiter exakt: unter `/v3` heißen die Storno-Codes nach dem Vokabular anders (nicht bloß
  klein), die Namen kommen mit der Umstellung des Pakets auf `/v3`.
- **Beleg-Layout: bei mehr als einer Zahlung eine nummerierte Aufschlüsselung** unter „Gesamt:"
  („Zahlungsarten:", dann „1. Kartenzahlung", „2. Barzahlung" … samt Betrag; der Betrag bricht
  auf 58 mm nie). Darunter eingerückt „davon Trinkgeld", „Gegeben" und „Rückgeld" der jeweiligen
  Zahlung; die Kartenblöcke kommen je Zahlung in Zahlungsreihenfolge, jeweils mit derselben
  Nummer darüber. Grund: auf dem Bon muss nachvollziehbar sein, welcher Betrag wie bezahlt wurde
  und zu welcher Zahlung ein Terminal-Block gehört.
- **Bei genau einer Zahlung bleibt der Beleg wie bisher**, nur „davon Trinkgeld", „Gegeben" und
  „Rückgeld" stehen jetzt eingerückt unter „Zahlungsart:". Ohne Zahlungsliste ändert sich nichts:
  alle bisherigen Vertragsbeispiele (`fixtures/erwartet`) und der Bytestrom-Zwilling sind
  unverändert. Neu sind neun Beispiele `split-*`/`storno-split-*` (Karte+Karte+Bar,
  Tischrunde mit Trinkgeld, Rückgeld, langer Betrag, Voll- und Teilstorno).

## 0.29.0

- **Bricht `./partner` (und nur das): `PARTNER_FEHLER_CODES` ist jetzt durchgehend englisch,
  wie der Rest von `/v3`.** `zugang_nicht_erlaubt` → `access_not_allowed`, `kennung_fehlt` →
  `tax_number_missing`, `vertrag_offen` → `contracts_pending` (Sätze unverändert, nur der
  Schlüssel neu); die `RAT`-Tabelle und `partnerFehlerRat` folgen. Grund: 0.28.0 stellte den
  Partner-Teil auf `/v3` um, liess aber ein paar Codes, die der Server bis dahin noch roh
  durchreichte, unuebersetzt in ihrer `/v1`-Schreibweise stehen (siehe dessen Eintrag "Die
  Fehlercodes bleiben in dieser Stufe wie in `/v1`"): der Server schickt seit dieser Version
  wirklich nur noch englische Codes, und dieses Paket folgt.
- **`PARTNER_FEHLER_CODES` um neun Codes von `reportCustomerContract` ergänzt**: `kind_not_allowed`,
  `mode_not_allowed`, `power_of_attorney_missing`, `not_found`, `no_version`, `not_required`,
  `unknown_version`, `text_changed`, `already_accepted`, mit Handlungssatz. Der Katalog des
  Backends (`partner-core.FEHLER_KATALOG`, Fläche `api`/`beide`) führt sie für die Schnittstelle,
  obwohl dieses Paket `reportCustomerContract` selbst nicht anbietet: derselbe Grund wie bei den
  Portal-Codes: eine halbe Liste ist schlimmer als keine, und ein Code, den nur eine Seite kennt,
  ist für einen Aufrufer nicht von "gibt es nicht" zu unterscheiden.
- **`kein_partnerbetrieb` und `request_not_found` aus `PARTNER_FEHLER_CODES` entfernt.** Beide sind
  admin-only (`partner-endpoints.js`) und stehen gar nicht in `partner-core.FEHLER_KATALOG`; ein
  Partner-Aufruf konnte sie unter keinem Pfad je bekommen. Sie standen seit jeher versehentlich in
  der Liste; ein Aufrufer, der auf sie prüfte, prüfte auf einen Fall, der nie eintritt.
- `module_inactive`s Handlungssatz nennt jetzt `data.module`/`data.detail` statt `data.modul` (die
  Werte selbst, z. B. `cash_register`, waren mit 0.28.0 schon englisch, nur der Text hier hinkte
  nach).
- Neuer Typ `SignatureErrorCode` (`customer_not_found` | `incomplete` | `finanzonline_error`) für
  `SignaturAntrag.error.code` und `CustomerSignature.error.code` (bisher `string | null` ohne
  jeden Hinweis auf die möglichen Werte), nach demselben Muster wie `SignatureHistoryReason`.
- `PartnerFeldFehler.field`s Beispiele sind nicht mehr `address.land`/`tax_details.ustid` (Namen,
  die `/v3` als unbekanntes Feld abweist), sondern echte `/v3`-Pfade: `address.zip`,
  `taxDetails.taxNumber`, `contacts.0.email`.
- Die Tests lesen wieder echte `/v3`-Fehlerantworten: `scripts/partner-v3-antworten.cjs` schickt
  jeden Code aus `fehlerKatalogFuer('api')` jetzt durch denselben Fehlerzweig wie eine echte
  Antwort (`antwortNachAussen` statt der rohen Katalogwerte), und `getCustomerSignatureStatus`
  trägt in der Fixture einen zweiten, fehlgeschlagenen Antrag (`fon_fehler` → `finanzonline_error`)
  als Beleg dafür, dass `request.error.code` denselben Rand durchläuft wie jede Fehlerhülle.

## 0.28.0

- **Bricht `./partner` (und nur das): der Partner-Teil spricht jetzt die englische Partner-API
  `/v3`.** Vorgabe-Adresse ist `PARTNER_BASE_URL` (`https://api.kasseneck.at/v3`), `baseUrl` bleibt
  einstellbar. Grund: das Backend führt die Partner-API ab `/v3` durchgehend englisch (Feldnamen
  und jeder Wert, auf den ein Programm verzweigt), `/v1` ist abgekündigt (Kopfzeilen `Deprecation`
  und `Sunset`). `/v3` weist die deutschen Werte der `/v1` mit `validation` ab statt sie still zu
  übersetzen; ein Client, der weiter `einzel` oder `wien` schickt, bekäme nur noch Fehler.
  Minor-Sprung, weil 0.x: wer `./partner` benutzt, muss umstellen, alles andere nicht.
- Umbenannte Werte (alt → neu): `legalForm` `einzel`/`verein`/`sonstige` →
  `sole_proprietor`/`association`/`other`; `state` `burgenland` … `wien` → `AT-1` … `AT-9`;
  Kontaktrollen `geschaeftsfuehrung`/`buchhaltung`/`technik`/`kasse` →
  `management`/`accounting`/`technical`/`pos`; `avv.mode` `direkt`/`vollmacht`/`unterauftrag` →
  `direct`/`power_of_attorney`/`subprocessor`; Entgelt `entgelt {cents, rhythmus, test}` →
  `fee {cents, interval, test}` mit `monthly`/`yearly`/`once` (neu gelesen an
  `createPartnerCustomer` und `requestCustomerSignature`); Historiengründe
  `karte_eingetragen`/`fon` → `card_entered`/`finanzonline`; Zustellstatus
  `zugestellt`/`offen`/`fehlgeschlagen`/`verworfen` → `delivered`/`pending`/`failed`/`dropped`;
  `deletePartnerWebhook` liefert `{ webhookId, deleted }` statt nur der Kennung; Ereignisse
  `customer.terms_accepted`/`customer.avv_accepted` mit `kind` `terms`/`avv` und den englischen
  Quellen (`setup_link`, `process_link`, `partner_power_of_attorney`, `admin_paper`,
  `paper_upload`), beschrieben durch den neuen Typ `ContractAcceptedEventData`.
- Neue englische Typen `LegalForm`, `AustrianState`, `ContactRole`, `AvvMode`, `FeeInterval`,
  `PartnerFee`, `SignatureHistoryReason`, `WebhookApiVersion`, `WebhookDeliveryStatus`;
  `Rechtsform`, `Bundesland` und `KontaktRolle` bleiben als veraltete Aliase.
- **Webhooks tragen `apiVersion`** (`v1` oder `v3`; fehlt es, ist es ein Bestands-Webhook und damit
  `v1`). Die Sprache der Nutzlast folgt dem Webhook, nicht dem Pfad: ein unter `/v1` angelegter
  schickt weiter deutsch, bis er mit `updatePartnerWebhook(id, { apiVersion: 'v3' })` umgestellt
  wird; zurück gibt es nicht. `lastDelivery` ist jetzt das Objekt `{ at, status, statusCode }`,
  das der Server schon immer schickte (der Typ sagte `number`).
- Dabei berichtigt, was schon unter `/v1` englisch war und hier noch deutsch gelesen wurde (und
  darum leer blieb): `getCustomerSignatureStatus` liest `signature` statt `signatur` und neu
  `signatures[]` und `customerId`; ein Antrag trägt `kind` statt `art`, die Historie `from`/`to`
  statt `von`/`nach`; `requestCustomerSignature` sendet `kind` statt `art`;
  `sendPartnerWebhookTest` liest `event` statt `ereignis`; Zustellungen tragen
  `lastAttemptAt`/`nextAttemptAt`; `BetriebSteuer.uid` heißt `vatId` (ein `uid` wies der Server
  als unbekanntes Feld ab); Kassenschritt `signature` statt `signatur`, Kassenstatus
  `in_progress` statt `laeuft`.
- **`PARTNER_FEHLER_CODES` um `kennung_fehlt` und `vertrag_offen` ergänzt**, beide mit
  Handlungssatz. Grund: der Katalog des Backends (`partner-core.FEHLER_KATALOG`, Fläche `beide`)
  führt sie für die Schnittstelle; `kennung_fehlt` kommt aus `sendPartnerCustomerFonLink`,
  `vertrag_offen` live aus `activateCashregister`. Ein Code, den das Paket nicht kennt, sah für
  einen Aufrufer aus wie „gibt es nicht“.
- **Liste und Einzelsicht eines Betriebs führen `fon`, `avv` und `terms`** in der Form, die der
  Server schickt (`VertragStand`, `KundenFonStand`; die Einzelsicht zusätzlich `verifiedAt` und
  `linkSentTo`). Fehlen sie in der Antwort, bleibt es bei `null`. Der Kommentar an `AvvStand`
  behauptete, Verträge wirkten im Partner-Weg nicht mehr; tatsächlich geht live ohne AVV und
  Nutzungsvertrag keine Kasse live (`vertrag_offen`). Berichtigt, ebenso in `ablauf.ts`.
- `check:erreichbar` prüft die Partner-Aufrufe unter `/v3` (abgelesen aus der Partner-Fassade des
  Baus), alles andere weiter unter `/v1`. Ein `not_found` aus JSON gilt nicht mehr als erreichbar:
  unter `/v3` antwortet der Rand auf einen nicht gerouteten Namen selbst mit JSON.
- **Unverändert:** Belege, Rechnungen, Kasse, Druck, Zahlungen und React sprechen weiter `/v1`
  (`DEFAULT_BASE_URL`), bis es dort eine `/v3` gibt. Die Fehlercodes bleiben in dieser Stufe wie
  in `/v1`, ebenso die Prüfung der Webhook-Signatur. `reportCustomerVertrag` (unter `/v3`
  `reportCustomerContract`) führt dieses Paket nicht und bekommt es auch jetzt nicht.
- Die Tests lesen echte `/v3`-Antworten: `test/fixtures/partner-v3-antworten.json` entsteht aus
  den Sichten des Backends, durch dessen `/v3`-Rand gereicht (`scripts/partner-v3-antworten.cjs`).

## 0.27.3

- **`rechnungSummen` ist als veraltet markiert** (`@deprecated`), das Rechenergebnis bleibt
  unverändert. Grund: seit dem 23.09.2026, 17:05 Uhr stellt der Server jede neue Rechnung über den
  exakten Kern (`rechnungRechnen`) aus; `rechnungSummen` rechnet nach Weg 2 und liegt an
  Halbcent-Grenzen einen Cent je Satz daneben (21,35 € netto zu 10 %: 23,48 € statt 23,49 €). Auf
  den Kern umgestellt wird bewusst nicht: der Server schaltet ihn je Konto über `ganzzahlPflicht`,
  Entwürfe außerhalb des Ausstellens rechnet er teils weiter nach Weg 2, und
  `fixtures/rechnung-summen.json` prüfen Backend und Dart-Zwilling. Der Kopfkommentar behauptete
  noch, die Funktion rechne „genau so wie der Server“; das ist berichtigt, README ebenso.
- **`HpsRefundOptions`, `HpsCancelOptions`, `HpsConnectRefundOptions` und
  `HpsConnectCancelOptions` werden unter `…/payments` exportiert** (nur hinzugefügt). Die Aufrufe
  `refund`/`cancel` gab es dort schon, ihre Optionstypen nicht. Der Kopfkommentar von
  `src/payments/index.ts` sagte noch, Gutschrift und Storno gingen nur über die Flutter-App; das
  gilt seit Connect `/v1/terminal/refund` bzw. `/cancel` nicht mehr.
- § 131b Abs. 1 Z 3 steht in der **BAO**, nicht im UStG: an `INVOICE_PAYMENT_METHODS` und
  `PaymentInput.onSite` berichtigt (Wortlaut gegen das RIS geprüft). Ein Test hält künftig jede
  Zuordnung von § 131 ff. zum UStG in `src/` fest.

## 0.27.2

- **README auf Englisch** und jede Angabe gegen den Code geprüft. Anfragen kommen inzwischen auch
  aus dem Ausland, und auf npm ist Englisch die Erwartung. RKSV-Begriffe bleiben deutsch und
  werden beim ersten Vorkommen erklärt; ein Glossar am Ende nennt dieselben Begriffe wie der
  Dart-Zwilling. Eine kurze deutsche Einstiegsseite liegt als `README.de.md` im Repo.
- Dabei berichtigt: Beispiele, die nicht kompilierten (`business` statt `betrieb`, `automatic`
  statt `automatisch`, Einheit `'Std'`, optionale `logoUrl`), die Option `regelwerk` statt
  `layoutRegeln`, die Druckwege (WebUSB, ePOS, Druckaufträge gehören zum Paket), `refund` und
  `cancel` am HPS-Terminal, sechs statt drei anmeldungsfreie Aufrufe und § 131b **BAO**.
- `package.json`: Beschreibung englisch zuerst, weitere englische Schlagwörter.

## 0.27.1

- Drei Beispiele zum Mikropreis in `fixtures/rechnung-api-beispiele/`: der Sub-Cent-Fall
  (3.500.000 × 0,000004 € = 14,00 € netto), beide Preise gesetzt und kein Preis gesetzt. Sie sind
  zugleich die Prüfvektoren, die Server und Dart-Zwilling gegen ihre eigene Prüfung fahren — ein
  Beispiel, das nur in der Doku steht, veraltet unbemerkt.

## 0.27.0

- **Rechnungs-API: der Einzelpreis einer Position darf in Mikro-Euro stehen** (`unitPriceMicros`,
  10⁻⁶ €). Genau eines von `unitPriceCents` und `unitPriceMicros` — beide Felder sind dafür
  optional, und die neue Genau-eins-Regel am Positions-Objekt wird im JSON Schema zu
  `oneOf: [{required:['unitPriceCents']}, {required:['unitPriceMicros']}]`. Grund: Preise unterhalb
  eines Cents (Verbrauchsabrechnung, Stückpreise im Zehntelcent) mussten bisher schon beim
  Einreichen gerundet werden; der Rundungsfehler steckte danach in jeder Zeile.
  **Bricht die Form:** wer den Typ `IssueInvoiceItem` selbst baut, bekommt `unitPriceCents` jetzt
  als optionales Feld. Anfragen, die es setzen, bleiben unverändert gültig.
- Der Mikropreis deckt denselben Betragsbereich wie die Cent-Angabe (10¹² Mikro-Euro = 10⁸ Cent =
  10.000.000,00 €). Eine eigene Obergrenze wäre eine stille Bereichsänderung, je nachdem welches
  Feld ein Aufrufer benutzt.
- Die Menge reicht bis 10⁹ statt 10⁶, passend zu `quantityMilli` der gespeicherten Form.
- **Noch nicht enthalten:** `rechnungSummen` rechnet weiterhin wie bisher, nicht über den exakten
  Kern. Das gehört zum Stichtag der Umstellung (Schalter `ganzzahlPflicht`): solange der Server
  eine Rechnung nach dem alten Weg ausstellt, darf eine Vorschau im Aufrufer nicht schon exakt
  runden — sie zeigte sonst an Halbcent-Grenzen einen anderen Cent als die Rechnung.

## 0.26.0

- Beleg: Am Ende steht das Kasseneck-Logo als Bild statt der Zeile „erstellt mit Kasseneck".
  Das Raster entsteht beim Bauen in den beiden Druckmaßen (352 × 51 für 80 mm, 234 × 34 für 58 mm);
  zur Laufzeit wird nichts gerastert, damit beide Pakete denselben Bytestrom erzeugen.
- **ESC/POS: der Vorspann setzt den Druckbereich auf die Breite des Blatts** (`GS L 0` +
  `GS W`, acht Bytes hinter `ESC @`). `ESC a 1` mittelt nicht im Blatt, sondern in der
  Fläche des *Geräts*: Ein 58-mm-Blatt auf einem 80-mm-Drucker setzte den Text in die
  linken 384 Punkte, QR, Logo und Marke aber mittig in die 576 — alles Bildhafte stand
  gegenüber dem Text nach rechts gerückt. Am Gerät nachgestellt und behoben. Passen Gerät
  und Blatt zusammen (der Regelfall), ist der gesetzte Wert der Vorgabewert des Druckers
  und das Druckbild bleibt unverändert; die Bestandsschutz-Digests sind allein wegen
  dieser acht Bytes neu gezogen (Gegenprobe byteweise: sonst hat sich nichts verschoben).
  Der ePOS-Weg trägt denselben Bezugsfehler und ist noch offen — die ePOS-Print-Einheit
  des Prüfgeräts war nicht erreichbar, und ungeprüft geht dorthin nichts.
- `MARKE_TEXT` entfällt. Wer die Marke selbst gesetzt hat, nimmt jetzt den Blockart `marke`.
- ESC/POS: `row()` gibt der ersten Spalte am Drucker nur noch links, nie ihre eigentliche
  Ausrichtung — eine zentrierte oder rechtsbündige erste Spalte ließ den Drucker seine
  eigene Ausrichtung sonst auf jede weitere Spalte derselben Zeile anwenden (dieselbe
  Fehlerklasse wie der in 0.24.0/0.25.0 behobene Ausrichtungsfehler, eine Ebene tiefer).
  Die tatsächliche Ausrichtung fließt weiterhin in die von Hand berechnete Position ein.
- ESC/POS: ein `ESC a`, das der Drucker mitten in der Zeile (Spalte ab der zweiten)
  wortlos verwirft, gilt intern nicht mehr als gesetzt — eine spätere, echte Zeile hielt
  sich sonst fälschlich schon für umgestellt und unterließ den Befehl.
- Prüfung: Der Zwillingsabgleich am **Bytestrom** ist jetzt Teil der Test-Suite
  (`test/zwilling-bytestrom.test.ts`) statt eines Skripts von Hand. Vier SHA-256 über den
  fertigen Bon (58/80 mm, mit und ohne Marke) stehen wortgleich im Dart-Paket; wer in
  einem der beiden Pakete am Druckweg dreht, macht dort oder hier rot. Die bisherigen
  gemeinsamen Prüffälle deckten Raster, Zeilen und Blatt ab — alles Stufen vor den Bytes.

## 0.25.0

- ESC/POS: den Sofort-Reset der Ausrichtung direkt nach QR-Code, QR-Rasterbild und
  Logo-Rasterbild entfernt. Er behandelte nur ein Symptom: seit 0.24.0 steht `ESC a`
  ohnehin vor `ESC $`, und eine volle Zeile bekommt gar keinen Positionsbefehl mehr —
  der Ausrichtungsbefehl des naechsten Elements steht damit selbst immer am
  Zeilenanfang und gilt. Der erzeugte Bytestrom ist dadurch wieder deckungsgleich mit
  dem Dart-Zwilling; bisher war dieser Reset der einzige Unterschied zwischen beiden.

## 0.24.0

- ESC/POS: `ESC a` steht vor `ESC $`, eine volle Zeile bekommt keinen Positionsbefehl mehr.
  Der Drucker nimmt die Ausrichtung nur am Zeilenanfang an; bisher blieb nach dem QR-Code die
  Zentrierung stehen und zentrierte jede Zeile darunter ein zweites Mal.

## 0.23.0

### Rechnung: der Rechenkern in ganzen Zahlen

**Anlass:** Vier Umsetzungen (Server, dieses Paket, Dart, Panel) mussten dieselbe
Reihenfolge von Gleitkomma-Schritten nachbauen, damit Grenzfälle gleich runden.
Ein Cent Unterschied im Brutto-Modus hat das am 16.09.2026 sichtbar gemacht.

- **Neu: Unterpfad `@kreiseck/kasseneck-api/rechnung/rechnen`** — rein, ohne
  Transport, auch für den Browser. Darin:
  - `rechnungRechnen(positionen, { priceMode, taxScheme })` rechnet exakt in
    ganzen Zahlen (BigInt) und rundet einmal je USt-Satz. Preise in Millionstel
    Euro, Mengen in Tausendstel, Rabatt und Satz in Hundertstel-Prozent.
  - `positionAusEuro(item)` wandelt eine Euro-Position verlustfrei um oder
    nennt Feld und Grund.
  - `anteiligerPreis`, `satzSchluessel`, `satzText`, `preisText`.
  - `RechenFehler` mit `code` (`amount_too_large`, `kein_ganzzahlwert`,
    `ausserhalb`), Feld und Index.
- **Prüffälle im Paket:** `fixtures/rechnung-rechnen.json` (20 Fälle von
  Hand), `fixtures/rechnung-rechnen-zufall.json` (400 aus einer unabhängigen
  Referenz in Python) und `fixtures/position-aus-euro.json`. Server,
  Dart-Zwilling und Panel werden gegen dieselben Dateien prüfen.
- **Fehlerkatalog um zwei Codes erweitert:** `einvoice_unavailable` (zu dieser
  Rechnung entsteht keine E-Rechnung, Grund im `reason`) und
  `amount_too_large` (Betrag über der Grenze des Ganzzahlkerns) — beide hinten
  angehängt, damit gespeicherte Reihenfolgen gültig bleiben. Der Katalog geht
  dem Server bewusst voraus, damit Fremdsysteme beide Codes behandeln können,
  bevor der Server sie sendet; heute sendet der Server keinen von beiden,
  `amount_too_large` erst ab dessen Umstieg auf den Ganzzahlkern.
- **Unverändert:** `rechnungSummen`, `fixtures/rechnung-summen.json` und Form
  von Anfrage und Antwort der Rechnungs-API — der Fehlerkatalog wächst nur
  additiv (s. o.). Der Kern rundet an Halbcent-Grenzen richtig, `rechnungSummen`
  rechnet weiterhin wie der Server heute; beides wird in 0.24.0
  zusammengeführt. Wer schon vorab genau rechnen will, nimmt `previewInvoice`.

## 0.22.0

### Rechnung: Brutto bleibt Brutto, Hinweise kommen an, Probelauf

**Anlass:** Rückmeldung eines Shops zur Rechnungs-API (16.09.2026).

- **`issueInvoice` gab `notice` nicht weiter.** Der Typ sah die Liste vor, der
  Aufruf übernahm sie nie — eine ig. Lieferung meldete deshalb nie, dass eine
  Zusammenfassende Meldung fällig ist. Behoben.
- **`recordInvoicePayment` liefert `notice` jetzt als Liste** wie
  `issueInvoice` (bisher ein einzelnes Objekt). **Bricht die Form:** wer
  `result.notice.code` las, liest jetzt `result.notice?.[0]?.code`. Ein Server,
  der noch ein Objekt schickt, wird zur Liste gemacht.
- **Neu: `rechnungSummen(items, priceMode, taxScheme?)`** rechnet die Summen so,
  wie der Server sie ausstellt. Im Brutto-Modus ist das Brutto je Satz der
  vereinbarte Preis: Netto = round(B × 100 / (100 + Satz)), USt = B − Netto.
  Der Server rechnete bis dahin Netto und USt getrennt und setzte das Brutto neu
  zusammen — 14,79 € + 15,00 € zu 20 % wurden 29,80 €. Die Prüffälle stehen in
  `fixtures/rechnung-summen.json`; Server und Dart-Zwilling prüfen dagegen.
- **Neu: `previewInvoice(anfrage)`** — Probelauf von `issueInvoice`
  (`dryRun: true` im Vertrag): prüft und rechnet wie das Ausstellen, schreibt
  nichts fest und verbraucht den `idempotencyKey` nicht. Antwort `preview` mit
  Summen, Steuerfall samt Grund, Sprache, Marke, E-Rechnung — dazu die Hinweise.
- **`totals.byRate[]` trägt `grossCents`.** Die Summen sind auch bei
  Gutschriften positiv; das steht jetzt am Typ.
- **Texte:** `pdf.tabelle.einzelBrutto`, `pdf.tabelle.betragBrutto`,
  `pdf.summe.darinUst` — das PDF einer Brutto-Rechnung zeigt Brutto-Spalten,
  deren Zeilen die Summe ergeben. Dazu `pdf.position.rabatt`: ein Zeilenrabatt
  stand bisher nirgends auf dem Blatt, „2 × 24,90 = 44,82" ging für den Leser
  nicht auf.
- **Kennung als Text:** `getInvoice('…')` und `getCustomer('…')` werfen vor dem
  Senden `KasseneckValidationError` (`scope: 'request'`). Bisher wurde der Text
  Zeichen für Zeichen zu Feldern `0`, `1`, … und der Server konnte nur
  „Bitte Eingaben prüfen." antworten.
- **Feldfehler in der Meldung:** `KasseneckApiError.message` hängt bis zu fünf
  Einträge aus `errors[]` an (`[items[0].vatRate: …]`); `serverMessage` und
  `details` bleiben unverändert.

## 0.21.0

### Rechnung: Kataloge für den abgeleiteten Steuerfall

**Anlass:** Der Server leitet den Steuerfall jetzt selbst ab, statt ihn zu
glauben (Kundenland, Kundenart, UID, Ware oder Leistung).

- `taxScheme` ist in `issueInvoice` **optional**; eine Angabe prüft der Server
  gegen die Ableitung (`tax_scheme_mismatch`).
- Neue Fälle `domesticReverseCharge`, `oss` und `outsideScope`; Katalog der elf
  Gründe für den Übergang der Steuerschuld im Inland
  (`REVERSE_CHARGE_REASONS`, mit Fundstelle und Schwelle).
  `oss` steht im Katalog, **kann aber noch nicht ausgestellt werden** —
  die Ländersätze folgen.
- Positionen tragen `kind` (`goods`/`service`), weil ig. Lieferung und Reverse
  Charge sich genau daran unterscheiden.
- `notice` ist an `issueInvoice` eine **Liste**: eine bar bezahlte ig. Lieferung
  trägt zwei Hinweise zugleich.
- Die Rechnungssicht trägt `reverseChargeReason` und `taxCountry`; neuer
  Befreiungstext für den nicht steuerbaren Umsatz (E-Rechnung, BR-O-10).

## 0.20.0

### Rechnung: richtige Steuerhinweise, Barumsatz auch mit Karte

**Anlass:** drei Befunde aus einer Durchsicht an den Primärquellen.

- **Reverse Charge ist keine Steuerbefreiung.** Der Aufdruck hiess
  „Steuerfreie Leistung – Reverse Charge" und behauptete damit eine Befreiung,
  die es nicht gibt: der Umsatz bleibt steuerpflichtig, nur die Steuer schuldet
  der Empfänger. Das Gesetz trennt beides (§ 11 Abs. 1 Z 3 lit. e = Hinweis auf
  eine Befreiung, § 11 Abs. 1a = Hinweis auf die Steuerschuldnerschaft); Art. 226
  Nr. 11a MwSt-RL nennt den Begriff wörtlich. Jetzt:
  „Steuerschuldnerschaft des Leistungsempfängers."
- **Ig. Lieferung** bekommt denselben Kasten wie Reverse Charge, mit **beiden**
  UID-Nummern — Art. 11 Abs. 2 UStG verlangt sie auf der Rechnung. Der
  Textschlüssel `steuer.reverseCharge.uid` heisst darum jetzt `steuer.uidZeile`,
  neu sind `steuer.igLieferung.titel` und `steuer.igLieferung.text`
  (`steuer.igLieferung` entfällt).
- **`onSite` an der Zahlung.** Ein Barumsatz ist nicht nur Bargeld: als
  Barzahlung gilt auch die Karte **vor Ort** (§ 131b Abs. 1 Z 3 UStG), nicht
  aber dieselbe Karte im Internet. Weil `card`/`online` beides sein können,
  sagt es das Fremdsystem jetzt selbst — der Hinweis `cash_receipt_required`
  kommt bei `cash` immer und sonst nur mit `onSite: true`. `transfer` mit
  `onSite` wird abgewiesen.

## 0.19.0

### hobex HPS: TECS-Antwortcodes eingeordnet, Storno nach ausbleibender Host-Antwort

**Anlass:** hobex hat am 16.09.2026 bestätigt, dass das HPS die Codes der
TECS-Plattform durchreicht, und deren Liste geschickt. Zu `9908` (im Betrieb am
11.09.2026 gesehen, bisher unbekannt und damit offen): „ein Timeout wie jeder
andere. Richtigerweise sollte in dem Fall ein Storno nachgeschickt werden.“

- `HPS_CODES` führt jetzt 365 Codes; die TECS-Liste steht in
  `src/payments/hobex-hps/tecs-codes.ts`, eine Zeile je Code.
- `sendReversal` je Code und `needsReversal()`: bei ausbleibender oder
  unbrauchbarer Host-Antwort schickt `pay` genau einmal ein Storno
  (`/v1/terminal/cancel`) nach. Quittiert → `declined` mit
  `'voidedAfterHostFault'`; sonst Klärung wie bisher, ein späteres `9011`
  zählt ebenfalls als storniert. Gutschriften bekommen kein Storno (TECS:
  `9031`).
- `tecsTitle` je Code: der Titel in der TECS-Liste.
- `normalizeHpsCode()`: `0055` und `55` sind derselbe Code; `responseCode`
  kommt normalisiert an (`0000` → `0`), `raw` bleibt unverändert. Familien mit
  Platzhalter (`81xx`) werden gefunden.
- 16 neue Gründe in `HpsCodeReason` und `HPS_REASON_HINTS`, darunter
  `issuerDeclined`, `insufficientFunds`, `cardExpired`, `hostTimeout`,
  `approvedWithCondition`. **Kassen mit eigener Übersetzung brauchen dafür
  Texte.**
- Eine Genehmigung, die nicht `0` ist (`8`, `10`, `11`, `16`, `32`), bleibt
  offen und wird nie zur Ablehnung.
- `9900` ist jetzt `hostUncertain` (`internalError`) statt `noStatement`:
  gemessen kam er nach verarbeiteter Karte, und die Zwei-9027-Regel hätte
  daraus „nichts belastet“ gemacht.
- `fixtures/hobex-hps-codes.json` führt je Code zusätzlich `sendReversal` und
  `tecsTitle`.

## 0.18.0

### Rechnungs-API: bezahlte Rechnung und Zahlungen nachtragen

**Anlass:** Die API wird vor allem von Online-Shops benutzt, die **vor** der
Rechnung kassieren. Bisher entstand immer eine offene Rechnung — mit Giro-QR
und Fälligkeit auf dem Blatt, obwohl das Geld längst da war.

- `issueInvoice` nimmt `payment` (`method`, optional `amountCents`, `paidAt`,
  `reference`). Die Zahlung entsteht in **derselben** Transaktion wie das
  Festschreiben; ohne `amountCents` gilt der volle Bruttobetrag.
- Neuer Aufruf `recordInvoicePayment` für später eintreffende Zahlungen, mit
  **pflichtigem** `idempotencyKey` — ohne ihn bucht ein Wiederholungslauf nach
  einem Zeitlimit eine zweite Zahlung.
- `INVOICE_PAYMENT_METHODS` (`transfer`, `card`, `online`, `cash`);
  `Invoice.paidCents` und `Invoice.openCents`.
- Neue Fehlercodes `not_payable` (storniert oder Gutschrift) und
  `payment_exceeds_invoice` (mit `remainingCents`).
- Neu: **Hinweise** an einer erfolgreichen Antwort (`INVOICE_NOTICE_CODES`,
  `data.notice`). Bisheriger Fall: `cash_receipt_required`. Grund: eine
  Barzahlung ist ein Barumsatz und braucht einen Beleg (§ 132a BAO), bei
  Registrierkassenpflicht über die Registrierkasse — der Bezahlt-Vermerk ist
  Buchhaltung und ersetzt ihn nicht. Die Rechnung selbst ist bei jeder
  Zahlungsart erlaubt (§ 11 UStG), deshalb wird `cash` gebucht und nicht
  abgewiesen.

`reference` wird gespeichert, aber nicht gedruckt: die Rechnung wird sieben
Jahre aufbewahrt und vervielfältigt, und dem Empfänger nützt die Zahlungs-ID
des Shops nichts.

## 0.17.0

### Rechnungs-API: Sprache (de/en) und Marke je Rechnung

**Anlass:** Rechnungen waren fest Deutsch und trugen immer die Standardmarke.
Internationale Kunden bekamen deutsche Rechnungen, und wer mehrere Marken
führt, konnte sie über die API nicht wählen. Eine übersetzte Zweitrechnung mit
eigener Nummer wäre umsatzsteuerlich falsch (UStR Rz 1527) — deshalb eine
Sprache je Rechnung und die andere nur als gekennzeichnete Kopie (Rz 1528).

- `INVOICE_LANGUAGES` (`de`, `en`); Feld `language` am Kunden und an
  `issueInvoice`, `brandId` an `issueInvoice`; `Invoice.language` und
  `Invoice.brand`.
- Neuer Aufruf `listBrands()` → `[{ id, name, isDefault }]`.
- `getInvoicePdf(id, { language })`: in der anderen Sprache eine
  Übersetzungskopie (gleiche Nummer, Vermerk auf jeder Seite, ohne
  eingebettete E-Rechnung).
- Neue Fehlercodes `language_not_allowed` (Behörden nur Deutsch) und
  `brand_not_found` (angegebene Marke gibt es nicht — kein stiller Rückfall).
- **Einheiten als Katalog:** `INVOICE_UNITS` (49 Einheiten) mit UN/ECE-Code in
  `RECHNUNG_EINHEITEN_CODES`; `items[].unit` nimmt nur noch diese Schlüssel.
  Gedruckt wird das Kürzel in der Sprache der Rechnung; freier Text wie `"Std"`
  ist `validation`. Grund: „Stk" stand sonst auch auf englischen Rechnungen.
- Textkatalog `RECHNUNG_TEXTE` / `rechnungText()` und
  `fixtures/rechnung-texte.json`: alle Texte von Rechnung, Gutschrift und
  E-Rechnung in Deutsch und Englisch, Steuerhinweise mit Gesetzesstelle.

## 0.16.0

### Rechnungs-API: Freigabe und Einrichtung vor dem ersten Ausstellen

**Anlass:** Mit 0.15.0 konnte jedes Konto mit aktivem Modul Rechnung sofort
automatisiert Rechnungen mit fortlaufender Nummer ausstellen — auch mit einem
Probezeitraum, ohne Bankverbindung und mit dem ungewollten Standard-Nummernformat,
das sich mit der ersten Rechnung sperrt. Ein Fremdsystem erfuhr erst beim
Festschreiben, dass etwas fehlt.

- Neuer Aufruf `getInvoiceSetupStatus()` → `{ ready, environment, missing }`.
  Er läuft auch ohne Freigabe und vor der Live-Freischaltung, also genau dann,
  wenn man die Antwort braucht.
- `INVOICE_SETUP_REQUIREMENTS`: `module_active`, `api_enabled`, `live_enabled`,
  `business_name`, `address`, `vat_id`, `bank_account`, `number_format`.
- Neue Fehlercodes: `invoice_api_not_enabled` (Kasseneck hat die Rechnungs-API
  für das Konto nicht freigegeben; nur live) und `invoice_setup_incomplete`
  (`details.missing` wie im Status).

## 0.15.0

### Rechnungs-API: Rechnungen statt Belege, per `api_key`

**Anlass:** Fremdsysteme (Shops, Buchhaltungssoftware) konnten Rechnungen nur
über die Endpunkte des Panels anlegen — mit Anmeldung als Mensch, als Entwurf,
ohne geprüfte Eingabe und ohne Schutz vor einer doppelt ausgestellten Rechnung
nach einem Zeitlimit. Eine festgeschriebene Rechnung lässt sich aber nur per
Gutschrift zurücknehmen; ein Doppel ist also teuer.

- Neuer Unterpfad `@kreiseck/kasseneck-api/rechnung` mit `createRechnungApi`:
  Kunden (`createCustomer`, `getCustomer`, `updateCustomer`, `searchCustomers`),
  Rechnungen (`issueInvoice`, `cancelInvoice`, `createCreditNote`, `getInvoice`,
  `listInvoices`) und Dateien (`getInvoicePdf`, `getInvoiceXml`).
- Anmeldung `rechnungKeyAuth`: Kontoschlüssel als Bearer, **ohne**
  Kassen-Token — eine Rechnung entsteht am Konto, nicht an einer Kasse. Ein
  Partner-Schlüssel oder Kassen-Token wird ohne Netzaufruf abgewiesen.
- Der Vertrag steht als Daten in `src/rechnung/vertrag.ts` und wird als
  `fixtures/rechnung-api.schema.json` ausgeliefert (`npm run fixtures:rechnung`),
  dazu Beispielanfragen unter `fixtures/rechnung-api-beispiele/`. Grund: das
  Backend und der Dart-Zwilling prüfen gegen dieselbe Datei — die Feldliste
  kann nicht an drei Stellen auseinanderlaufen.
- `fixtures/oberflaeche.json` führt die elf Aufrufe und einen Abschnitt
  `rechnung` (Fehlercodes, Gutschrift-Gründe, Steuerschemata).
- `getInvoiceXml` liefert das XML als Text im gewohnten Umschlag statt als rohe
  Datei: so bleibt `einvoice_incomplete` ein gewöhnlicher Fehler mit
  `missing[]`, und der Transport braucht keinen dritten Leseweg.

## 0.14.0

### Das Beleg-Blatt: ein Beleg, der überall gleich aussieht

**Anlass:** Derselbe Beleg sah in der App, am Bon, in der Web-Kasse, im Panel
und im PDF verschieden aus. Das Raster war als einzige Wahrheit gedacht, aber
jeder Zeichner setzte Rahmen, Logo und QR selbst: das Panel stellte das Logo
über den Testkassen-Rahmen, das PDF legte es darauf, die App zeigte keins, der
Bon druckte Warnungen invers und doppelt hoch.

- `renderReceiptGrid` gibt Aufdrucke als drei Rasterzeilen aus (`====`, Text,
  `====`). ESC/POS und ePOS drucken sie als normale fette Zeilen — keine doppelte
  Höhe, kein Invertieren mehr. `grid32`/`grid48` der Belege mit Aufdruck ändern
  sich, das Zeilenmodell nicht.
- Bekannter Unterschied, bleibt so: ESC/POS druckt `EUR` statt `€` (die
  Ein-Byte-Codepage des Bondruckers kennt das Zeichen nicht). Bildschirm, PDF
  und ePOS zeigen `€`; die Zeilen sind dadurch am Bon an diesen Stellen anders
  gefüllt, das Raster bleibt gleich breit.
- Neu `belegBlatt(layout, { zeichen, logo, marke, qrGroesse })`: Reihenfolge
  (Aufdrucke oben, Leerzeile, Logo, Leerzeile, Beleg, Marke), Logo-Maß je Stufe
  S/M/L/XL (nie hochgerechnet), QR-Anteil wie am Drucker.
- Ein QR-Inhalt, der in keine QR-Version passt (Korrektur M, mehr als 2331
  Byte), bekommt im Blatt den Anteil 0, statt dass `belegBlatt` wirft. ESC/POS
  und ePOS lassen den QR dann weg und melden es über `qrFehler`; der Beleg steht
  ohne QR. Die Bildschirm-Ansicht ruft `renderQr` weiter mit der Nutzlast, damit
  die Oberfläche den fehlenden QR anzeigen kann (Papierbeleg-Hinweis). **Grund:** Ein Wurf riss jeden Zeichner mit — die Bon-Ansicht der
  Web-Kasse fiel ganz aus, Bon und PDF ebenso. Neu `qrPasstInVersion(nutzlast)`
  (`./printing`); `qrModulAnzahl` wirft weiter.
- Neu `logoRaster` (RGBA → einfarbiges Rasterbild), `escPosRasterBild`,
  `eposBildXml`; `escPosLayoutBytes` und `eposPrintXml` nehmen `logo` und `marke`.
- Neu `BelegBlattView` / `BelegBlattZeilen` (`./react`); `ReceiptLayoutView` ist
  `@deprecated`. `BelegBlattView` zeigt ein Logo ueber 4096x4096px (oder 0)
  ebenso wenig wie ein nicht geladenes -- neu `LOGO_PIXEL_MAX`,
  `logoPixelZulaessig` (`./receipt`). **Grund:** Bildschirm und Bon zeigen
  dasselbe Logo; das Druck-Kit lehnt ein zu grosses Logo beim Rastern fuer
  den Bon schon ab (dieselbe Grenze), der Bildschirm bisher nicht -- ein
  5000x1200px-Logo erschien am Bildschirm und im PDF, aber nie auf dem
  gedruckten Beleg.
- Neu `ReceiptWithCompany.logoStufe` (aus `logo_skala` der Beleg-Antwort,
  Vorgabe `M`): Panel und App kannten die Logo-Stufe des Betriebs bisher nicht.
- `createPrintJob` nimmt `logo` und `marke`: der Netzwerk-Drucker (Connect)
  druckt dasselbe Blatt wie USB, Bluetooth und ePOS direkt. Neu
  `rasterZeilenBase64` (gemeinsam für ePOS-`<image>` und den Druckjob).
- Goldens `erwartet/<name>.blatt32.json`/`.blatt48.json`,
  `erwartet/logo-probe.raster32.txt` (mit Teiltransparenz) und
  `erwartet/logo-probe-hoch.raster32.txt` (höhenbegrenzt) für den Dart-Zwilling.
- `escPosRasterBild` wirft bei einer Bildhöhe über 65535 Punkten (`GS v 0` trägt
  die Höhe in zwei Bytes).

### Achtung: Brüche

- **Aufdrucke im Raster.** `renderReceiptGrid` gibt jeden Aufdruck als drei
  Zeilen `kind:'banner'` aus (`====`, Text, `====`). *Umstellen:* eigene
  Rahmen oder Sonderstile für Aufdrucke entfernen (sie stünden sonst doppelt)
  und nicht annehmen, dass die erste `banner`-Zeile die einzige ist — der Text
  steht in der mittleren.
- **`ReceiptWithCompany.logoStufe` ist Pflicht.** `getReceiptWithCompany` füllt
  es selbst. *Umstellen:* von Hand gebaute Objekte (Tests, Vorschauen) brauchen
  `logoStufe: 'M'`.
- **QR-Vorgabe `auto` deckelt bei 6 Punkten je Modul (vorher 4)** — in npm und
  Dart dasselbe. Am ESC/POS-Bon wird der QR ohne ausdrückliche Wahl größer
  (80 mm: rund 55 % statt 37 % der Breite). *Umstellen:* wer die alte Größe
  will, stellt `qrGroesse: 'klein'`.
- **Nativer ESC/POS-QR mit Fehlerkorrektur M (vorher L)**, wie ePOS, Bildweg
  und Blatt — der Kasten am Bildschirm ist damit genau der gedruckte QR.
  Manche Nutzlasten brauchen eine Version mehr. *Umstellen:* den alten
  Bytestrom liefert `qrCorrection: 'L'` (zusammen mit `qrGroesse: 'klein'`).
- **ePOS-Vorgabe `qrGroesse` ist `auto`** (vorher `mittel`). Derselbe Wert,
  kein Byte anders; nur wer die Vorgabe ausliest oder dokumentiert, merkt es.

## 0.13.2

### Die Paketseite erklaert, wofuer das Paket da ist

**Anlass:** Wer auf npm landet, sah eine Wand aus Technik und nirgends, worum
es geht. Die Seite traegt jetzt das Kasseneck-Logo, einen englischen Einzeiler
fuer Besucher von aussen, und eine Tabelle, welche Pflichten einer
oesterreichischen Registrierkasse wo erledigt werden — mit Verweisen auf die
Wissensseiten und einem ausdruecklichen Hinweis, dass hier kein Rechtsrat steht
und die Verantwortung beim Unternehmer bleibt. Kopf und Fuss nennen Kreiseck
als Absender und verlinken dorthin. Am Code aendert sich nichts.

### Der Vertrag nennt keinen Anmeldedienst mehr beim Namen

**Anlass:** Die Doku sprach an 16 Stellen von einem bestimmten Anbieter,
obwohl das Paket ihn gar nicht kennt: `registerUserAuth` bekommt eine Funktion,
die ein Token liefert — woher es stammt, geht das Paket nichts an. Ein
Implementierungsdetail im Vertrag bindet beide Seiten grundlos aneinander;
jetzt steht dort "ID-Token des Anmeldediensts". Damit verschwindet der Name
auch aus den ausgelieferten Typdeklarationen.

## 0.13.1

### Der 404 beim Abbruch wird benannt, nicht als Abriss gefuehrt

**Anlass:** Am Produktivterminal (TID 3556988, Firmware 2.3.9) antwortet der
Abbruch mit HTTP 404, am Testgeraet nie. Bisher war das im Nachweis nicht von
einem Leitungsabriss zu unterscheiden -- und `steps` ist der Text, der im
Belastungsstreit gelesen wird. Zwilling: kasseneck_api 6.12.1.

- **`NOT_FOUND_HTTP_STATUS`** und **`HpsConnectTerminalError.isNotFound`**
  (wie `isTerminalBusy`: liest bevorzugt `terminalHttpStatus`).
- Der Abbruch schreibt beide Lesarten hin, ohne eine zu behaupten: das
  Terminal kennt entweder den Vorgang nicht oder den Endpunkt nicht. Welche
  zutrifft, ist ungemessen (bei hobex angefragt).
- **Verhalten unveraendert:** weiter klaeren, nie ein Ausgang.

## 0.13.0

### Beleg per E-Mail an den Gast (`sendReceiptEmail`)

**Anlass:** Der Endpunkt ist im Backend live (keck#361), beide Kassen haben den
Weg gebaut — hinter einer Schnittstelle, hinter der nichts stand, weil kein
Paket den Aufruf kannte. Verschickt wird ein **Link auf die öffentliche
Belegseite**, kein PDF im Anhang: die Belegseite führt dasselbe Zeilenmodell
wie Bildschirm und Bon, ein mitgeschicktes PDF wäre dieselbe Sache ein zweites
Mal, nur unveränderlich veraltet. Der Beleg selbst bleibt unberührt (BAO §131 /
RKSV); das Versandprotokoll führt das Backend neben ihm.

- **`sendReceiptEmail({ fullReceiptId, to, sprache? })`** — auch auf der
  Fassade `createKasseneckApi`. Antwort: `{ to, at, via }` — Adresse in der
  protokollierten Form, Zeitpunkt als ISO mit Wiener Zonenoffset, Versandweg
  (`eigen`, `plattform`, `plattform-fallback`; fehlt er, ist `via` `null` und
  nicht etwa ein Fehler — er sagt etwas über den Weg, nichts über den Erfolg).
- **Kein `cashregisterId` in den Optionen.** Die Kasse kommt aus der Anmeldung:
  beim Gerät über die Kopfzeile `cashregister-token`, beim Kassen-Benutzer über
  den Parameter, den `registerUserAuth` ohnehin setzt. Eine dritte Stelle wäre
  nur eine Gelegenheit, eine andere Kasse zu behaupten als die, an der man
  angemeldet ist — und das Backend nimmt den Belegpfad aus der angemeldeten.
- **`RECEIPT_EMAIL_ERROR_CODES`**, Typ `ReceiptEmailErrorCode` und der Wächter
  `isReceiptEmailErrorCode`: `adresse_ungueltig`, `beleg_nicht_gefunden`
  (auch für einen Beleg einer fremden Kasse — das Backend gibt darüber bewusst
  keine Auskunft), `zu_oft` (5 Mails je Beleg in 24 Stunden, 30 je Kasse und
  Stunde) und `versand_fehlgeschlagen`. Die Codes kommen unverändert als
  `KasseneckApiError.code` heraus; das Paket legt keine eigenen an. **Am Code
  entscheiden, nie am deutschen Text.**
- Die Adresse prüft das Paket **nicht** selbst — nur leer/fehlend wird vor dem
  Senden abgewiesen (`fullReceiptId`, `to`; beides getrimmt, weil es von Hand
  ins Feld kommt). Eine zweite, eigene Adressregel könnte strenger sein als die
  des Backends und eine gültige Adresse abweisen, ohne dass es auffällt.
- `sendReceiptEmail` steht in `AUFRUFE` und damit in
  `fixtures/oberflaeche.json` — der Zwilling `kasseneck_api` (Dart) prüft
  dagegen.

## 0.12.0

### Storno mit Kartendaten der Erstattung

**Anlass:** sastre zieht vom alten Storno-Weg (`createCancelReceipt`, ohne
Bezug) auf `cancelReceipt` um. Bei einer Kartenerstattung haengt sastre heute
die Terminaldaten der Gutschrift/Aufhebung an den Stornobeleg -- ueber den
neuen Endpunkt ging das bisher nicht, der Kartenblock fiele vom Storno-Bon.
Backend: keck#371.

- **`cancelReceipt` nimmt `creditCardProvider`, `cardPaymentId` und
  `cardPaymentData` an** -- die Daten der ERSTATTUNG, nie der Originalzahlung.
  Nur bei Rueckzahlweg Karte: ein ausdruecklich anderer `paymentMethod` wird
  schon hier abgewiesen, ohne Angabe entscheidet das Backend an der
  Zahlungsart des Originals. Ein unbekannter Kartenanbieter geht gar nicht erst
  raus.
- Ohne Kartendaten aendert sich nichts.
- `package-lock.json` traegt wieder die Paketversion (stand seit 0.11.0 auf
  0.10.0).

## 0.11.0

### Die QR-Modulgröße wird gerechnet, nicht gesetzt — samt Notausgang und Modell 1

**Anlass:** Am echten Beleg fehlte der QR-Code, die Probe im Drucker-Wizard
druckte ihn. Der native QR-Befehl bekommt eine Modulgröße in Druckpunkten mit
und rechnet nicht nach, ob das Symbol samt Ruhezone auf die Rolle geht. Ein
Beleg-QR mit realer RKSV-Nutzlast hat 57 Module, mit Ruhezone also 65; bei
sechs Punkten je Modul sind das 390 Druckpunkte, und ein 58-mm-Kopf hat 384.
Zu breit heißt bei den meisten Geräten nicht „abgeschnitten", sondern **gar
kein QR**. Der Befund stammt aus dem Flutter-Zwilling `kasseneck_api` (dort
6.9.0), der fest mit sechs Punkten druckte; dieses Paket druckt seit jeher mit
vier und war davon nicht betroffen. Die Regel ist trotzdem dieselbe — sie
deckelt auch eine bewusst gewählte größere Modulgröße gegen den Papierrand ab.

- **Neu `…/printing`: die Rechenregel, rein und ohne Drucker.**
  `qrModulAnzahl(nutzlast)` gibt die Modulanzahl bei Fehlerkorrektur **M**
  (konservativ: der native Befehl druckt mit L, das braucht nie mehr Module);
  `qrGroesseBerechnen({ papierbreitePunkte, moduleAnzahl, groesse })` und
  `qrGroesseFuer({ nutzlast, papierbreitePunkte, groesse })` geben ein
  `QrGroesse` mit `punkte` (`null` = passt nicht), `module`, `breitePunkte`,
  `unterMindestmass` und `passt`. Dazu `QrModulGroesse`, `QR_MODUL_DECKEL`,
  `QR_RUHEZONE_MODULE` (4), `QR_MINDEST_PUNKTE` (4), `QR_AUSNAHME_PUNKTE` (3),
  `QR_HOECHST_PUNKTE` (8) und `QR_DRUCK_PUNKTE` (58 mm = 384, 80 mm = 576 —
  die echte Kopfbreite, nicht die Spaltenbreite 372/558).
- **`escPosQrCode` rechnet, wenn keine feste `size` mitkommt.** `groesse` ist
  ein **Deckel**, keine Vorgabe: gedruckt wird die größte Größe, die noch
  passt, höchstens aber der Deckel. `auto` deckelt beim Bestandswert dieses
  Pakets (4), `klein` 4, `mittel` 6, `gross` 8. **Ohne ausdrückliche Wahl
  ändert sich kein Byte** — nur dort, wo heute gar nichts herauskommt, rechnet
  die Regel herunter. (Im Flutter-Zwilling deckelt `auto` bei 6, weil dort 6
  der Bestandswert ist; die Regel ist dieselbe, der Bestand nicht.)
- **`EscPosDocument.qrFehler` / `.qrAusweich`.** `qrFehler` heißt „Beleg ohne
  QR" — das Symbol passt auch mit der Ausnahmegröße nicht, und ein Befehl, von
  dem man weiß, dass er nichts druckt, täuscht nur einen Ausdruck vor.
  `qrAusweich` heißt „gedruckt, aber nicht auf dem eingestellten Weg" — unter
  der Mindestgröße oder als Bild. Das eine gehört dem Kunden gesagt, das
  andere dem Chef. `escPosReset` räumt beide weg.
- **Neu `…/receipt`: `escPosLayoutErgebnis`** gibt `{ bytes, qrFehler,
  qrAusweich }`; `escPosLayoutBytes` bleibt unverändert und gibt weiter nur
  die Bytes. Neue Optionen `qrGroesse`, `qrModus` (`QrPrintMode`) und
  `qrMatrix`.
- **Der Notausgang.** Passt das Symbol nativ nicht aufs Papier und ist ein
  `qrMatrix` mitgegeben, geht der QR als Rasterbild hinaus (`GS v 0`) statt
  gar nicht — ein Pflichtbeleg ohne QR ist der schlechteste aller Ausgänge.
  Das Raster kommt vom Aufrufer: dieses Paket rechnet keine QR-Codes und
  verarbeitet keine Bilder. Dafür neu `escPosQrRaster`, `qrRasterPunkte` und
  der Typ `QrMatrix`.
- **Modell 1.** `qrCodeBytes(..., { modell1: true })` bzw. `qrModus:
  'nativeModel1'` stellt den Wahlbefehl `GS ( k 04 00 31 41 31 00` voran. Für
  günstige Drucker, die nur diesen älteren Symboltyp beherrschen; belegt ist
  eines, das bei Modell 2 unter dem Code eine „0" ausgibt — das Parameterbyte
  `0x30` des Druckbefehls, das es nicht als Befehl erkennt. Ohne ausdrückliche
  Wahl geht **gar kein** Modellbefehl hinaus, wie bisher.
- **Derselbe Fehler im ePOS-Weg — und dort ist er der akute.** `eposPrintXml`
  setzte `<symbol … width="6">` fest, unabhängig von der Papierbreite: 57
  Module plus Ruhezone sind bei sechs Punkten 390 Druckpunkte, ein 58-mm-Kopf
  hat 384, und der Epson lässt ein zu breites Symbol weg. **Genau daran fehlte
  am echten Beleg der QR.** Jetzt gilt dieselbe Regel — Untergrenze 4,
  Ausnahme 3 mit Meldung, darunter kein `<symbol>`. Der Bestandswert dieses
  Wegs ist 6, deshalb ist die Vorgabe hier der Deckel `mittel`; ohne
  ausdrückliche Wahl ändert sich nur dort etwas, wo heute gar nichts
  herauskommt. Neu `eposPrintXmlErgebnis` (`{ xml, qrFehler, qrAusweich }`) und
  die Optionen `qrGroesse` an `eposPrintXml` und `eposDirectPrint`; `qrBreite`
  bleibt, ist jetzt aber ausdrücklich die **feste** Größe und schaltet die
  Rechnung ab.
- **Bestandsschutz als Golden-Test.** Zwei feste SHA-256 über den gesamten
  Bytestrom eines Belegs (58 und 80 mm) und zwei weitere über das vollständige
  ePOS-XML halten fest, dass sich ohne Wahl kein Byte ändert. Dazu prüft `test/paket-inhalt.test.ts`, dass die Dateiliste des
  Pakets eine Positivliste bleibt und im mitgelieferten `fixtures/` nichts
  Örtliches liegt.

## 0.10.0

### Die Antwortcodeliste von hobex — jeder Code eingeordnet, jeder Ausgang mit Grund

**Anlass:** hobex hat am 11.09.2026 die Antwortcodeliste der HPS-Anwendung
geschickt. Drei der Codes kamen seit dem 28.08.2026 im Betrieb vor (`100004`,
`100005`, `100015`) und waren bis jetzt ungedeutet. Jede Zahlung damit lief in
die Klaerung und endete erst ueber die Zwei-9027-Regel. Zwilling:
`kasseneck_api` 6.10.0 (6.9.0 war inzwischen vergeben), Begruendungen dort in
`doc/kartenzahlung.md`.

- **`HPS_CODES`** fuehrt alle 31 Codes der Liste zusammen mit den gemessenen:
  Code, hobex-Titel, Bedeutung, Wirkung (`effect`), Grund (`reason`) und
  Quelle (`source`). `isConclusive` liest seine Positivliste daraus.
  `HPS_MEASURED_CODES` bleibt als abgekuendigter Name fuer dieselbe Tabelle.
- **Was vor dem Host scheitert, ist eine Ablehnung** (Kartenlesen, EMV-Kernel,
  Eingaben am Geraet, Geraetezustand, fehlerhafte Anfrage) -- `declined`, ohne
  Abbruch und ohne Statusabfrage. Dazu `100029`: das Terminal storniert laut
  hobex selbst.
- **Neu: `effect: 'hostUncertain'`** (`isHostUncertain`) fuer `100006`,
  `100007`, `100023`, `100024`, `100026`, `100027`, `100999`. Der Host war
  beteiligt, das Terminal storniert nicht selbst. Die Zwei-9027-Regel greift
  hier **nicht**; die Klaerung endet nach zwei Abfragen ohne Neues als
  `unresolved`, nur ein `'0'` entscheidet danach noch, und ein Abbruchversuch
  entfaellt. Bei einer Aufhebung entscheidet ein unveraendertes `'0'` auf die
  Originalzahlung dann ebenfalls nichts.
- **`rejectsRequest` / `isConclusiveAsStatus`:** zehn Codes weisen die Anfrage
  selbst ab (`9002`, `100001`, `100008`, `100108`, `100009`, `100010`,
  `100013`, `100018`, `100022`, `100998`). Auf eine Zahlung sind sie deren
  Ablehnung, auf eine Statusabfrage sagen sie nichts ueber den gesuchten
  Vorgang (gemessen fuer `100108`). Die Klaerung liest den Status deshalb
  ueber `isConclusiveAsStatus` -- sonst haette ein gesperrtes Terminal eine
  verlorene Zahlung als "nicht belastet" ausgewiesen.
- **`HpsPaymentResult.reason`** traegt fuer jeden Ausgang den Grund, den Satz
  fuer den Bediener gibt `HPS_REASON_HINTS`. Gesetzt, wo entschieden wurde:
  bestaetigter Abbruch `aborted`, HTTP 409 `terminalBusy`, eine ueber die
  Zwei-9027-Regel geklaerte Zahlung mit dem Grund ihres eigenen Codes.
  `isHostUncertainResult` sagt einer spaeteren Nachfrage, dass ein `9027` dort
  nicht "nicht belastet" heisst.
- `hpsCodeInfo`, `hpsCodeReason` und die Namen aller neuen Codes
  (`CARD_READ_FAILED_CODE` usw.) sind exportiert.
- Der Nachweis nennt bei einer Ablehnung den hobex-Titel mit
  (`Terminal: abgelehnt (100015 "Card declined")`).
- `fixtures/hobex-hps-codes.json` fuehrt je Code zusaetzlich `title`,
  `effect`, `reason`, `source` und die Saetze je Grund (`gruende`).

## 0.9.4

### `qrModus` faengt bei `auto` an — sonst stellte die Vorgabe den Altbestand um

**Anlass:** 0.9.3 gab `qrModus` die harte Vorgabe `raster`. Die Browser-Kasse
druckt den Signatur-QR aber seit jeher ueber den nativen ESC/POS-Befehl; jedes
Geraet, das nie durch den Drucker-Wizard laeuft, haette damit ploetzlich ein
Rasterbild gedruckt — ueber BLE mehrere Sekunden je Bon, und niemand haette
etwas umgestellt.

- **`QR_MODUS` fuehrt jetzt `auto` als ersten Wert**, und
  `KASSE_GERAET_STANDARD.qrModus` steht darauf. `auto` heisst *unbestimmt*: an
  diesem Geraet hat noch niemand am Papier entschieden, jede Kasse bleibt bei
  ihrer bisherigen Praxis (Browser-Kasse ESC/POS, App Rasterbild). Nur ein
  ausdruecklich gesetzter Wert aendert etwas.
- Wer `KasseQrModus` erschoepfend auswertet, bekommt einen dritten Fall.

## 0.9.3

### `qrModus` am Geraet: mit welchem Befehl der Signatur-QR auf den Bon kommt

**Anlass:** Der Drucker-Wizard laesst zwei Probedrucke machen — einen QR als
Rasterbild, einen ueber den nativen ESC/POS-Befehl — und fragt, welcher lesbar
war. Diese Antwort musste bisher nirgends hin: die Kassen druckten fest im
Rastermodus. An Geraeten, die GS v 0 nicht koennen, kam damit ein Bon ohne
lesbaren QR heraus, und das ist nach § 132a BAO keine Belegerteilung — der
Ausfall faellt am Tresen niemandem auf.

- `QR_MODUS` (`raster` | `escpos`) als Laufzeitliste und Typ `KasseQrModus`.
- `KasseSettingsGeraet.qrModus`, Vorgabe `raster` — der bisherige Weg bleibt
  damit fuer jedes bestehende Geraet unveraendert.
- **Am Geraet und nicht am Betrieb:** welchen Befehl ein Thermodrucker
  versteht, entscheidet das Modell an dieser einen Kasse.

## 0.9.2

### Sechzehn Saetze: einen Beleg weitergeben, und der Drucker-Wizard

**Anlass:** Ein alter Beleg soll sich weitergeben lassen — Link kopieren,
teilen, per E-Mail senden — und der Drucker richtet sich kuenftig ueber einen
Wizard ein, der erst testet und bestaetigen laesst und dann speichert. Beides
entsteht **gleichzeitig** in der Browser-Kasse und in der Kassen-App. Ohne
diese Schluessel haetten beide Seiten dieselben sieben Lagen unabhaengig
formuliert, und der Kassier haette zwei verschiedene Woerter fuer dieselbe
Sache gelesen — genau das, wogegen es diesen Katalog gibt.

- **Beleg weitergeben:** `beleg.link_kopiert`, `beleg.teilen_text`
  (`betrieb`, `nummer`, `betrag`, `link`), `beleg.nicht_teilbar`,
  `beleg.test_hinweis_teilen`.
- **Per E-Mail senden:** `beleg.mail_gesendet` (`an`) und die vier Ausgaenge
  `beleg.mail_adresse_ungueltig`, `beleg.mail_zu_oft`,
  `beleg.mail_fehlgeschlagen`, `beleg.mail_nicht_gefunden`.
- **Drucker-Wizard** (beide Kassen, deshalb ohne `nur`):
  `druck.wizard_verbinden` (`name`), `druck.wizard_testdruck_frage`,
  `druck.wizard_qr_frage`, `druck.wizard_qr_keiner_hinweis`,
  `druck.wizard_nichts_gekommen`, `druck.wizard_gespeichert` (`name`),
  `druck.wizard_abgebrochen`.

**Neu: `BELEG_MAIL_FEHLER` und `belegMailFehler(code)`** — die Zuordnung vom
`code` des Backends (`adresse_ungueltig`, `zu_oft`, `versand_fehlgeschlagen`,
`beleg_nicht_gefunden`) auf den Satz. Grund: die vier Ausgaenge verlangen vom
Kassier vier verschiedene Handlungen, und beide Kassen sollen am **Code**
entscheiden statt an einer Formulierung, die sich im Backend jederzeit aendern
darf. Ein unbekannter Code faellt auf `beleg.mail_fehlgeschlagen` zurueck — ein
leerer Schirm waere schlimmer als ein zu allgemeiner Satz. Die Zuordnung steht
als `belegMailFehler` mit in `fixtures/kasse-texte.json`, weil die App den
Katalog aus dem Tarball liest und das Web die Quelle direkt importiert.

Bewusst ein Objekt und **keine** Liste in Grossschrift: der
Oberflaechen-Vertrag liest jede exportierte Liste als Enum der
Kasseneinstellungen ein, und der Dart-Zwilling schickt deren Werte durch
`KasseSettings.aus`. Fehlercodes haetten dort nichts verloren.

**Abweichung von der Vorlage, bewusst:** `beleg.mail_nicht_gefunden` sagt
„Dieser Beleg wurde nicht gefunden — er konnte nicht gesendet werden." und
nicht denselben Satz wie das schon vorhandene `beleg.nicht_gefunden`. Dort
scheitert das Oeffnen, hier das Senden; der Kassier steht vor einem Adressfeld
und muss lesen, dass nichts hinausgegangen ist. Ein Satz zweimal im Katalog
faellt ohnehin schon seit 0.9.1 im Test auf.

**Neue abgeleitete Pruefungen:** kein Satz zum Weitergeben eines Belegs ist an
eine Seite gebunden; der Teilen-Text traegt den Link, und zwar am Schluss;
jeder platzhalterlose `beleg.mail_`-Satz haengt an genau einem Backend-Code (und
kein Code an zweien); der einzige `beleg.mail_`-Satz mit Platzhalter ist der
ueber das Gelingen; jeder Satz des Wizards gilt auf beiden Seiten.

`FEHLERREGELN` bleibt unveraendert: die Codes sind die Verfeinerung **eines**
Aufrufs (`sendReceiptEmail`), keine neue Art, einen Transportfehler
einzuordnen.

## 0.9.1

### Elf Saetze fuer die vier Ausgaenge einer Kartenzahlung und das Terminal-Protokoll

**Anlass:** Die Kassen-App bekommt GP Tom mit denselben vier Ausgaengen, die
die Browser-Kasse schon kennt — geglueckt, abgebrochen, gescheitert, unklar —
und dazu ein Terminal-Protokoll. Beide Kassen duerfen nur Katalogsaetze zeigen;
ohne diese Schluessel haette die App eigene Formulierungen erfunden, und der
Kassier haette am Tresen zwei verschiedene Woerter fuer dieselbe Lage gelesen.

**Grund fuer die Auswahl:** Der teuerste Fehler an der Kasse ist die zweite
Belastung derselben Karte. Deshalb tragen die neuen Saetze zu den unsicheren
Ausgaengen alles, was der Kassier braucht, um NICHT zu wiederholen: Betrag,
Kennung und den Hinweis auf den Terminal-Beleg.

- **GP Tom** (nur App, wie die uebrigen `gptom.`-Saetze): `gptom.abgelehnt` und
  `gptom.abgelehnt_mit_code` (das Terminal hat entschieden — sicher nichts
  gebucht), `gptom.nicht_geoeffnet` (die App liess sich nicht starten),
  `gptom.zeit_abgelaufen` / `gptom.zeit_abgelaufen_mit_kennung` (Frist abgelaufen
  ist **kein** Abbruch: die Karte kann belastet sein).
- **Karte gebucht, Beleg fehlt:** `kartenzahlung.karte_gebucht_beleg_offen` und
  `kartenzahlung.karte_gebucht_korb_geaendert`, beide mit `betrag` und `kennung`.
  Der zweite nennt die Entscheidung, die er verlangt: Beleg erstellen oder am
  Terminal stornieren und hier verwerfen.
- **Warteschirm:** `kartenzahlung.wartet_auf_terminal`.
- **Terminal-Protokoll:** `protokoll.leer`, `protokoll.kopiert` — ohne `nur`,
  weil an dem Satz nichts plattformgebunden ist.

**Neue abgeleitete Pruefungen** statt einer gepflegten Liste: kein Satz steht
zweimal im Katalog; jeder `gptom.`-Satz gilt nur in der App; jede Fassung
`…_mit_kennung` ist ihre Grundfassung plus dem Anker und teilt deren `nur`;
jeder unklare Ausgang warnt vor dem zweiten Kassieren.

`FEHLERREGELN` bleibt unveraendert — die neuen Saetze sind Ausgaenge einer
Kartenzahlung, keine neue Art, einen Transportfehler einzuordnen.

## 0.9.0

### Alle Kartenzahlungsbloecke im Belegmodell — nicht nur Hobex

**Anlass:** Am Bon aus der Flutter-App standen bei einer Stripe-Zahlung Marke,
letzte vier Ziffern, 3-D Secure, Betrag, Zahlzeitpunkt und Referenz. Dasselbe
Blatt als PDF geoeffnet sagte nur „Zahlungsart: Kartenzahlung". Betroffen waren
vier der sieben Anbieter: GP Tom, SumUp, myPOS und Stripe.

**Ursache:** Bis 0.8.0 trug dieses Modell nur den Hobex-Block, begruendet damit,
die uebrigen Anbieter druckten „in ihren eigenen Apps". Das Argument gilt fuer
die Frage, wer das TERMINAL bedient — nicht dafuer, was auf dem BELEGDOKUMENT
steht. Aus der einen Regel wurde beim Bau des Zeilenmodells die andere. Im
Backend hatte die vorherige PDF-Erzeugung (`generateReceiptPdf`) alle sieben
Anbieter; mit der Umstellung auf dieses Modell fielen vier still weg.

- Neu: `gpTomBlock`, `sumupBlock`, `myposBlock`, `stripeBlock` — Zeile fuer
  Zeile portiert aus `print_paper.dart` des Dart-Zwillings, inklusive der
  Eigenheiten: GP Tom schreibt `transactionType` im Plugin-`toMap` mit
  Tippfehler (`transacitonType`), myPOS liefert den Zeitpunkt als
  `YYMMDDhhmmss` ohne Trenner, Stripe kennt neben Karte auch EPS.
- `stripeReceiptLines` wird exportiert, wie im Dart-Paket: Druck und Anzeige
  sollen dieselbe Quelle haben, nicht zwei.
- Ein myPOS-Zeitpunkt, der nicht wie `YYMMDDhhmmss` aussieht, wird
  **unveraendert** durchgereicht statt zerschnitten — eine halb geratene
  Uhrzeit auf einem Beleg ist schlimmer als ein roher Wert.
- Ein unbekannter Anbieter ergibt weiterhin keinen Block, still und ohne
  Fehler: ein Beleg muss sich immer zeigen lassen.

### Neun Golden-Belege fuer Kartenzahlungen

**Anlass:** Von den 22 Golden-Belegen trug **keiner** eine Kartenzahlung.
Deshalb konnte der Verlust der vier Bloecke passieren, ohne dass irgendetwas
rot wurde.

- Neu: `karte-hobex-hps`, `karte-hobex-cloud`, `karte-gptom`, `karte-gptom-ios`,
  `karte-sumup`, `karte-mypos`, `karte-stripe`, `karte-stripe-eps`,
  `karte-eigener`. Die Paare decken beide Zweige ab, wo es welche gibt
  (Unterschriftsfeld ja/nein, Karte gegen EPS, Tippfehler-Schluessel).
- Neu: eine Pruefung, die die Anbieterliste **aus dem Enum** nimmt statt aus
  einer Handliste — wer einen Anbieter aufnimmt, wird rot, bis ein Golden-Beleg
  dazuliegt. Sie fand beim ersten Lauf sofort zwei weitere Luecken
  (`gpTomIos`, `hobexCloudApi`).
- Neu: eine zweite Pruefung, dass ein Beleg MIT Terminaldaten auch wirklich
  einen Block traegt. Ein Golden-Beleg allein beweist nur, dass die Datei da
  ist.

## 0.7.2

### `55` („PIN falsch") ist eine gemessene Host-Ablehnung → `declined`

**Anlass:** Vorfall vom 02.09.2026 am Produktivterminal 3556988 (HPS 1.11.4,
Firmware 2.3.9), vom Dart-Zwilling `kasseneck_api` 6.4.0 übernommen — die
erste echte Host-Ablehnung, die je beobachtet wurde. Die Zahlung antwortete
direkt mit `55`, die Statusabfrage danach elfmal in Folge ebenfalls. Als
Wissenslücke kostete der Code 90 s Klärung ins Budget, `unresolved`, einen
stehenden Merker und eine Rückfrage an den Bediener — für eine falsch
getippte PIN.

- Neu: `WRONG_PIN_CODE`, in `HPS_MEASURED_CODES` als schlüssig geführt.
- Bewusst **keine** Familienregel für zweistellige Host-Codes: ISO 8583 führt
  dort auch Genehmigungen (`08`, `10`, `11`, `85`). Die Zwei-`9027`-Regel
  greift bei Host-Codes nicht (der Status antwortet mit dem Code selbst);
  ungemessene Host-Codes enden weiterhin bei `unresolved`.
- `fixtures/hobex-hps-codes.json` neu erzeugt; die Vertragsdatei nennt jetzt
  unter `ergaenztAn`, welcher Code von welchem Gerät stammt.

### Neu: `HpsPaymentResult.lastResponse` und Terminal-Klartext im Nachweis

Am 02.09.2026 sah der Bediener bei einer Antwort `55` „PIN falsch" nur
„Ausgang unklar", musste raten und buchte die abgelehnte Zahlung als bezahlt;
75 EUR Umsatz waren weg. Der Klartext hätte die Entscheidung getragen.

- `lastResponse`: die letzte Terminal-Antwort bei `unresolved`, auch wenn sie
  nichts entschied — Material für Anzeige und Katalog, nie ein Beleg.
  `response` bleibt bei `unresolved` weiterhin ungesetzt.
- Der Nachweis nennt bei einem unbekannten Code den Klartext des Terminals:
  `Terminal nennt einen unbekannten Code (55) "PIN falsch"`.

## 0.7.0

### Neu: Unterpfad `./partner` — die Partner-API

Alles, was ein Partner-Softwarehaus über die Kasseneck-Schnittstelle tut, in
einem eigenen Unterpfad. Er liegt bewusst **nicht** in der Wurzel: der
Partner-Schlüssel gehört auf einen Server (er kann Betriebe anlegen und deren
Geheimnisse holen), und die Kassen-Seite des Pakets soll ihn nicht in ein
Browser-Bündel ziehen.

Neue öffentliche Symbole:

- **Anmeldung und Fassade** — `partnerKeyAuth`, `partnerKeyEnv`,
  `createPartnerApi`, `PartnerApi`, `PartnerApiOptions`, `PartnerKeyAuthOptions`.
- **Betriebe** — `createPartnerCustomer`, `listPartnerCustomers`,
  `getPartnerCustomer`, `sendPartnerCustomerFonLink`, `getPartnerInfo`.
- **Signatur und Kassen** — `requestCustomerSignature`,
  `getCustomerSignatureStatus`, `createCustomerCashregister`,
  `activateCashregister`, `listCustomerCashregisters`, `getCustomerCredentials`.
- **Webhooks** — `createPartnerWebhook`, `listPartnerWebhooks`,
  `updatePartnerWebhook`, `deletePartnerWebhook`, `sendPartnerWebhookTest`,
  `listPartnerWebhookDeliveries`, `parseWebhookEvent`,
  `verifyWebhookSignature`, `parseSignatureHeader`, `PARTNER_WEBHOOK_EVENTS`,
  `istPartnerWebhookEvent`, `WEBHOOK_UMSCHLAG_FELDER` und die Konstanten
  `WEBHOOK_SIGNATURE_HEADER`,
  `WEBHOOK_EVENT_HEADER`, `WEBHOOK_DELIVERY_HEADER`, `WEBHOOK_TOLERANCE_SEC`,
  `WEBHOOK_RETRY_PLAN_SEC`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_TIMEOUT_MS`,
  `WEBHOOK_LIMIT`.
- **Ablauf und Fehler** — `PARTNER_ABLAUF`, `naechsterSchritt`,
  `PARTNER_FEHLER_CODES`, `PARTNER_PORTAL_FEHLER_CODES`,
  `istPartnerFehlerCode`, `istPartnerPortalFehlerCode`, `istPartnerFehler`,
  `partnerFehlerCode`, `partnerFehlerRat`, `partnerFeldFehler`,
  `partnerWartezeitSek`, `SCOPE_CREDENTIALS`.
- **Betriebsdaten** — `BETRIEB_FELDER`, `unbekannteBetriebsfelder`,
  `PARTNER_ENVS`.
- **Geheimnisse** — `KasseneckSecret`, `SECRET_MASKE`.
- Dazu die Typen der Nutzlasten (`Betrieb`, `Kunde`, `Kasse`, `SignaturAntrag`,
  `CustomerCredentials`, …).

Warum die einzelnen Entscheidungen so gefallen sind:

- **`KasseneckSecret` statt `string` für die Zugangsdaten eines Betriebs.**
  `getCustomerCredentials` liefert den `api_key` des Betriebs und die Token
  seiner Kassen; wer sie hat, kann in seinem Namen Belege signieren, und ein
  Beleg ist nach RKSV nicht zurücknehmbar. Ein `string` in einem Antwortobjekt
  landet aber in `console.log`, in `JSON.stringify` und im Rumpf eines
  Fehlerberichts. Der Klartext liegt deshalb in einer `WeakMap` neben der
  Instanz — am Objekt hängt kein Feld, das ihn trägt — und `toString`,
  `toJSON`, `Symbol.toPrimitive` sowie der Node-Inspektor zeigen eine Maske.
  Heraus kommt man nur über `.reveal()`; genau diese Stellen findet eine Suche.
- **Die Signaturprüfung liegt fertig im Paket, nicht als Beispiel in der Doku.**
  Sie ist der Teil, den Integratoren am häufigsten falsch bauen, und ein Fehler
  fällt dort nie auf: eine zu lasche Prüfung lässt jeden durch und meldet nichts.
  Umgesetzt mit WebCrypto statt `node:crypto`, damit das Paket weiterhin ohne
  Laufzeitabhängigkeit auskommt — deshalb ist sie asynchron.
- **`env` bei `createPartnerCustomer`.** Ohne Angabe entscheidet der Schlüssel.
  Ein **Live**-Schlüssel darf `env:"test"` verlangen — das ist der vorgesehene
  Weg, die ganze Kette zu proben, ohne sich einen zweiten Schlüssel zu holen.
  Umgekehrt nie: ein Test-Schlüssel mit `env:"live"` bekommt `live_not_allowed`,
  und es entsteht nichts. Der Client prüft das **nicht** selbst vor: der Server
  ist die eine Wahrheit, und ein zweiter Torwächter im Paket wäre der, der
  irgendwann veraltet.
- **Verträge wirken im Partner-Weg nicht mehr** (Backend-Stand 2026-08-31).
  Keine Antwort führt `avv`, `naechsteSchritte` kennt keinen AVV-Schritt, und
  bei der Inbetriebnahme gibt es kein `vertrag_offen` mehr. Weggefallen sind
  deshalb `reportCustomerVertrag`, `vertragOffenRat`, `vertragOffenRatFuer`,
  `AVV_MODI`, `AVV_STATUS`, `avvErfuellt`, `avvSperrt`, `avvStatusText`,
  `istAvvModus`, die Option `avvModus` und der Ablaufschritt `avv`. Der Typ
  `AvvStand` **bleibt** und wird weiterhin gelesen, wenn eine Antwort ihn doch
  führt — vorausgesetzt wird er nirgends. `customer.avv_accepted` steht nicht
  mehr in `PARTNER_WEBHOOK_EVENTS`: es ist ein internes Ereignis, das ein
  Partner weder abonnieren noch proben kann, und ein Name in dieser Liste, den
  niemand bestellen kann, ist ein Versprechen ohne Deckung.
- **Der Fehlerkatalog ist vollständig** — 28 Codes der Schnittstelle
  (`PARTNER_FEHLER_CODES`) und 12 des Partner-Portals
  (`PARTNER_PORTAL_FEHLER_CODES`), jeder mit Handlungssatz. Quelle ist
  `docs/api/fehlercodes.json` im Backend. Ein Code, den nur eine Seite kennt,
  ist für einen Aufrufer nicht von „gibt es nicht" zu unterscheiden; eine halbe
  Liste ist deshalb schlimmer als keine.
- **`test: true` im Webhook-Umschlag.** `sendPartnerWebhookTest` nimmt jetzt ein
  `event` und löst damit **jedes abonnierte Ereignis** mit glaubwürdiger
  Nutzlast aus — eine Leitungsprobe beweist nichts über die Behandlung des
  Ernstfalls. Damit eine Probe nicht für echt gehalten wird, trägt sie
  `test: true` im Umschlag; `PartnerWebhookEvent.test` führt das Feld und ist
  bei echten Ereignissen `false`. Die Zeile `if (ereignis.test) return;` gehört
  an den Anfang jedes Handlers — ohne sie schreibt jemand seinem Kunden, die
  Kasse sei fertig.
- **Betriebsdaten werden streng geprüft.** Das Backend weist ein unbekanntes
  Feld ab, statt es stillschweigend zu verwerfen, und nennt den vollen Pfad
  (`address.land`, `contacts.0.rolle`). Der Typ `Betrieb` führt deshalb genau
  die Liste aus `partner-core.BETRIEB_FELDER`, und `unbekannteBetriebsfelder`
  beantwortet dieselbe Frage zur Laufzeit — für Daten aus Datenbank oder
  Formular, die nie durch die Typprüfung gelaufen sind. Abgewiesen wird hier
  nichts: die Wahrheit bleibt der Server, sonst blockierte ein alter Client ein
  neues Feld.
- **`createCustomerCashregister` ohne `name`, mit `signaturId`.** Kassennamen
  vergibt Kasseneck (sie sind gleich der `cashregisterId`); ein gesendetes
  `name` wäre ein `validation`-Fehler. Dafür bezieht sich **jede** Kasse auf
  eine Signatur: ohne eine einzige `signature_missing`, bei mehreren
  `signature_ambiguous` ohne `signaturId`. `requestCustomerSignature` nimmt
  `weitere`, um eine zusätzliche Signatur zu beantragen (höchstens zehn,
  `signature_limit`).
- **`getPartnerInfo().partner.darfZugangEinrichten`** und `zugang.einladen` mit
  Vorgabe **false**: ein Zugang zum Kundenpanel legt einen Login auf eine fremde
  Adresse an und schickt eine Mail dorthin. Fehlt das Feld, gilt NEIN — eine
  Berechtigung, die nicht ausdrücklich dasteht, hat man nicht.

### Geändert: `KasseneckApiError` trägt `code` und `details`

Bisher blieb vom `data` einer Fehlerantwort nichts übrig. Die Partner-API legt
ihre Entscheidung aber nicht in den Text, sondern in `data.code`
(`live_not_allowed`, `signature_not_ready`, `activation_failed` samt
`data.schritt`); ohne diese Felder müsste ein Aufrufer die deutsche `message`
nach Zeichenketten durchsuchen — die Art Kopplung, die beim nächsten
Formulierungsschliff still bricht.

Die Nutzlast wird dabei **gesiebt** (`fehlerDetails`) und nicht durchgereicht:
höchstens vier Ebenen tief, 50 Einträge je Ebene, Zeichenketten bis 300 Zeichen,
nur bezeichner-förmige Schlüssel — und kein Wert, der mit einem der gesendeten
Geheimnisse überlappt. Damit gilt dieselbe Zusage wie für `causeDigest`.

Additiv: der dritte Konstruktorparameter hat einen Vorgabewert, bestehende
Aufrufer und `catch`-Zweige bleiben unverändert.

### Vertrag

`AUFRUFE` und damit `fixtures/oberflaeche.json` führen 18 Aufrufe mehr (die
Partner-Endpunkte). Der Flutter-Zwilling `kasseneck_api` und die
Hosting-Weiterleitungen in `kasseneck-web` lesen diese Liste — beide müssen
nachziehen, sonst laufen die Aufrufe in Produktion auf die HTML-Seite statt auf
die Function.

**Neuer Abschnitt `partner` in der Vertragsdatei.** Der Partner-Teil wäre sonst
als reine Namensliste über den Vertrag gegangen: die Aufrufe hätte er geführt,
die Fehlercodes, die Webhook-Ereignisse, die Betriebsfelder, die Umgebungen,
die Felder des Webhook-Umschlags und den Wiederholungsplan nicht — und genau
die pflegt der Zwilling von Hand nach. Ein Fehlercode, den nur eine Seite kennt,
hätte auf der anderen keinen Handlungssatz und wäre für einen Aufrufer nicht von
„gibt es nicht" zu unterscheiden. `scripts/oberflaeche.mjs` liest den
Partner-Namensraum genauso ab wie den Kassen-Namensraum; eine neu angelegte
Liste landet damit von selbst im Vertrag statt still zu fehlen.

**Und die Gegenrichtung: `test/fixtures/dart-partner.json`.** Der Vertrag in
`fixtures/` wird drüben geprüft — dieses Repo sähe eine Lücke erst im nächsten
Zwillingslauf im anderen Repo, an einem anderen Tag. Der eingecheckte Abzug der
Dart-Seite (dasselbe Muster wie `dart-enums.json`, samt `_quelle`) macht
`npm test` hier rot, sobald ein Fehlercode, ein Ereignis, ein Betriebsfeld, eine
Umgebung oder die Marke `test` nur in einer der beiden Sprachen ankommt.
