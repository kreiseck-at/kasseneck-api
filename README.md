<p align="center">
  <img src="https://raw.githubusercontent.com/kreiseck-at/kasseneck-api/main/doc/kasseneck.gif" alt="Kasseneck: RKSV fiscal cash register from Austria" width="420">
</p>

<h1 align="center">@kreiseck/kasseneck-api</h1>

<p align="center">
  <b>Austrian fiscal cash register (RKSV) for JavaScript and TypeScript: signed receipts, card payments, receipt printing.</b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kreiseck/kasseneck-api"><img src="https://img.shields.io/npm/v/%40kreiseck%2Fkasseneck-api?color=136B6B&label=npm" alt="npm"></a>
  <img src="https://img.shields.io/badge/RKSV-%C2%A7%20131b%20BAO-136B6B" alt="RKSV">
  <img src="https://img.shields.io/badge/License-Apache--2.0-136B6B" alt="Apache-2.0">
  <a href="https://kasseneck.at"><img src="https://img.shields.io/badge/Kasseneck-kasseneck.at-132A2A" alt="kasseneck.at"></a>
  <a href="https://kreiseck.com"><img src="https://img.shields.io/badge/by-Kreiseck-132A2A" alt="Kreiseck Software Solutions"></a>
</p>

<p align="center">
  Deutsch: <a href="https://github.com/kreiseck-at/kasseneck-api/blob/main/README.de.md">README.de.md</a>
</p>

**Kasseneck** is a fiscal cash register (*Registrierkasse*) for Austria that
implements the RKSV, the Austrian cash register security regulation. This
package is its JavaScript and TypeScript client: your code issues receipts,
the Kasseneck backend handles receipt signing and chaining, and the package
returns the results as typed objects. It also cancels receipts, takes card
payments, lays out and prints receipts on thermal printers, and covers the
partner and invoice APIs. It is the twin of the Flutter package
[`kasseneck_api`](https://pub.dev/packages/kasseneck_api): same endpoints, same
models, same enum values, checked against each other in tests.

## Contents

- [Quick start](#quick-start)
- [What a fiscal cash register in Austria must do](#what-a-fiscal-cash-register-in-austria-must-do)
- [Try it first, or use the ready-made register](#try-it-first-or-use-the-ready-made-register)
- [Requirements and subpaths](#requirements-and-subpaths)
- [Base URLs and the `/v3` marker](#base-urls-and-the-v3-marker)
- [Authentication](#authentication)
- [Amounts are integer cents](#amounts-are-integer-cents)
- [Errors](#errors)
- [Receipts](#receipts)
- [Cancellation (Storno)](#cancellation-storno)
- [Sending a receipt by email](#sending-a-receipt-by-email)
- [Receipt printing: QR code, logo, printers](#receipt-printing-qr-code-logo-printers)
- [Register settings, articles and printers (`./pos`)](#register-settings-articles-and-printers-pos)
- [Stored documents (`./stored`)](#stored-documents-stored)
- [Card payments](#card-payments)
- [Partner API (`./partner`)](#partner-api-partner)
- [Invoice API (`./invoice`)](#invoice-api-invoice)
- [Inventory API (`./inventory`)](#inventory-api-inventory)
- [Migrating from 0.x](#migrating-from-0x)
- [Development](#development)
- [Contract files for the twin packages](#contract-files-for-the-twin-packages)
- [Glossary](#glossary)
- [License](#license)

## Quick start

```bash
npm install @kreiseck/kasseneck-api
```

Sell two items, then build the printed receipt (*Beleg*) from the response:

```ts
import {
  createKasseneckApi,
  apiKeyAuth,
  KeckPaymentMethod,
  VatRate,
  receiptDueCents,
  receiptLayoutFromResult,
} from '@kreiseck/kasseneck-api';
import { renderReceiptGrid, escPosLayoutBytes } from '@kreiseck/kasseneck-api/receipt';

const api = createKasseneckApi({
  auth: apiKeyAuth({ apiKey: 'kr_live_…', cashregisterToken: 'cb_live_…' }),
});

const items = [
  { name: 'Café Latte', quantity: 2, vat: VatRate.vat20, priceCents: 390 },
  { name: 'Marmeladeweckerl', quantity: 1, vat: VatRate.vat10, priceCents: 250 },
];
// Optional tip in cents; the backend books it as a signed tip line.
// With its own payment method or recipients: { cents, paymentMethod, recipients }.
const tip = 100;

// The payments must add up to exactly this amount (whole cents). Who gets a
// tip without recipients is the logged-in register user: 'owner' or 'staff'.
const dueCents = receiptDueCents(items, [], 'standard', { tip, tipRecipient: 'staff' }); // 1130

// Sell, and get the company data and the receipt layout in the same call.
const result = await api.sellReceiptWithCompany({
  items,
  tip,
  payments: [{ method: KeckPaymentMethod.cash, amountCents: dueCents, tenderedCents: 2000 }],
});

// Layout: a plain data model (lines, alignment, columns, QR code). The server
// sends it as `layout` (80 mm), and it always wins; only without it does
// receiptLayoutFromResult build one from the same response (test banners
// included) in `fallbackPaperSize` (default 'mm58'). The print width is chosen
// by the print path (`paperSize` below), never by this helper.
const layout = receiptLayoutFromResult(result);

// Character grid: exactly 32 (58 mm) or 48 (80 mm) characters per line.
// Screen, printed receipt and PDF all use this one grid.
const grid = renderReceiptGrid(layout, { charsPerLine: 32 }); // grid.lines[i].text, .bold, .kind, .qr

// ESC/POS bytes for a thermal printer; they print exactly the grid lines.
const bytes = escPosLayoutBytes(layout, { paperSize: 'mm58' });
```

The receipt returned by `sellReceiptWithCompany` (or `sellReceipt`) has already
been signed, chained and stored in the data capture log (*DEP*) by the backend.

**Payments are mandatory.** Every sale carries `payments[]` (several per receipt:
card plus cash and so on); card details (`provider`, `providerPaymentId`,
`providerData`) belong to the single payment. `receiptDueCents` computes the
amount the payments must match, exactly as the backend does (tax buckets,
discount vouchers, tips, value vouchers). If they do not match, the backend
rejects the receipt with `payments_sum_mismatch` without using up a receipt
number; `paymentsExpectedCents(error)` gives its amount. The package never
retries on its own: a card payment has already been charged.

The list may be empty only when the amount due is 0. The single
`paymentMethod` of 0.x and the card fields beside it (`creditCardProvider`,
`cardPaymentId`, `cardPaymentData`) are rejected before anything is sent.
`receiptDueCents` needs `tipRecipient` (`'owner'` or `'staff'`, the role of the
signed-in register user) as soon as a tip has no `recipients`: an owner's tip
is turnover, spread over the VAT rates of the goods and discounted with them,
while a staff tip goes untouched into the 0 % bucket. Only the register knows
which one applies, so the helper never guesses.

Input the amount cannot be computed from (a tip with an amount but no goods,
a tip on a null receipt, a missing `tipRecipient` …) throws a
`ReceiptDueError` with `code: 'receipt_due_unavailable'`, the cause in
`reason` (`RECEIPT_DUE_ERROR_REASONS`) and `outcome: 'rejected'`: nothing has
been sent. Tell the cashier before the card terminal is started.

## What a fiscal cash register in Austria must do

The obligation to use a fiscal cash register and to issue receipts is set out
in § 131b of the Austrian Federal Fiscal Code (*Bundesabgabenordnung*, BAO).
The technical requirements for the security device are in the cash register
security regulation (*Registrierkassensicherheitsverordnung*, RKSV). The table
shows which of the resulting tasks **this software** takes over and which stay
with the business:

| Task | Where it is handled |
| --- | --- |
| [Signature creation unit (*Signaturerstellungseinheit*)](https://kasseneck.at/wissen/signaturerstellungseinheit): every receipt is signed | Kasseneck, nothing to install |
| [Chaining and the data capture log (*DEP*)](https://kasseneck.at/wissen/dep): each receipt carries a value derived from the previous one, the encrypted turnover counter (*Umsatzzähler*) runs along, the log can be exported | Kasseneck backend |
| [Start receipt, monthly receipt, annual receipt (*Startbeleg, Monatsbeleg, Jahresbeleg*)](https://kasseneck.at/wissen/startbeleg-monatsbeleg-jahresbeleg) | Kasseneck, automatic |
| [Notifications to FinanzOnline](https://kasseneck.at/wissen/finanzonline): registration, failure, decommissioning (*Außerbetriebnahme*) with its final receipt (*Schlussbeleg*) | Kasseneck backend submits them |
| [Obligation to issue receipts (*Belegerteilungspflicht*)](https://kasseneck.at/wissen/belegerteilungspflicht): every customer gets a receipt | **this package**: printed receipt, PDF, screen or link |
| [Signature unit failure (*Ausfall der Signatureinheit*)](https://kasseneck.at/wissen/ausfall): collective receipt, notification, subsequent signing | Kasseneck, automatic |
| [Cash register audit (*Kassennachschau*)](https://kasseneck.at/wissen/kassennachschau): the auditor asks for the DEP | Kasseneck, export on request |
| Duty to register the cash register, retention of records, tax assessment | **the business owner** |

In short: you build the point-of-sale interface, not the security device. The
signature chain is tested against the official verification tool of the
Austrian Federal Ministry of Finance (BMF).

> **Not legal or tax advice.** This section describes what the software does.
> It does not replace professional advice and is no assurance that a particular
> business meets all its obligations with it. The BAO, the RKSV and the rulings
> of the BMF are binding. Registering and operating the cash register and
> retaining the records remain the duty of the business owner, also where the
> software submits the notifications. More detail with sources (in German):
> [kasseneck.at/wissen](https://kasseneck.at/wissen).
> As of: September 2026.

## Try it first, or use the ready-made register

There is a test environment with its own key and test signatures, separate
from live operation. The HTTP interface is described at
[kasseneck.at/api-doku](https://kasseneck.at/api-doku).

This package is for people who build their own application. If you just want
to take payments, there is nothing to program:

- **[Kasseneck, the ready-made fiscal cash register](https://kasseneck.at)** for
  phone, tablet and browser, including the signature creation unit and the
  FinanzOnline registration.
- **[Solutions by industry](https://kasseneck.at/branchen)**
- **[Pricing](https://kasseneck.at/preise)**
- **[Contact](https://kasseneck.at/kontakt)**, also for switching registers,
  partnerships and custom integrations.

## Requirements and subpaths

**Runs in the browser and in Node.js.** ESM is the main format, CommonJS ships
alongside it, both with their own type declarations. Node 20.18 or later
(`fetch` must be available). There are no runtime dependencies. React 18 or
later is an optional peer dependency, needed only for `./react`.

Import only the subpath you need, so a Node program never pulls in the React
adapter:

| Subpath | Contents |
|-----------|--------|
| `@kreiseck/kasseneck-api` | Endpoints, authentication, transport, models, enums, errors: everything that talks to the backend. |
| `…/receipt` | Receipt layout as a data model (framework-free), the character grid, the receipt sheet with logo, and the bridges to ESC/POS and Epson ePOS (XML and direct printing over HTTP). |
| `…/printing` | ESC/POS generation (byte sequences for thermal printers), QR sizing, printing over WebUSB. |
| `…/payments` | Stripe payment links, Hobex cloud (both HTTP endpoints of the backend), and Hobex **HPS** via **Kasseneck Connect** (local device agent that talks to the terminal). |
| `…/register` | Sign-in for the browser register: pair and unpair a device, list its users and sessions, sign in by PIN, renew and end the session. |
| `…/pos` | Tile register: register settings (business-wide and per device), article groups and articles for tiles, discount distribution per VAT rate, scopes of register permissions, network printers and print jobs, tip recipients, the register's message catalogue. |
| `…/partner` | Partner API (`/v3`, English): create businesses, FinanzOnline link, signature, cash registers, credentials, webhooks with signature verification. **Belongs on a server.** |
| `…/stored` | Stored Firestore documents (inner form, German) as the same English models the `/v3` wire returns: receipts with company and layout, register settings, articles. For clients that read Firestore directly, such as the admin panel. |
| `…/invoice` | Invoice API: create and search customers, issue finalised invoices, credit notes and cancellation, PDF and e-invoice XML, the contract as data. **Belongs on a server.** |
| `…/invoice/calc` | Pure calculation core for invoice totals (integers, no transport, no dependency beyond types). Safe to run in the browser. |
| `…/inventory` | Inventory API: read articles, locations, stock and the stock ledger; create and update articles, book goods receipts, transfers and losses, reserve stock at checkout; manage account webhooks, verify and parse incoming stock, article and reservation events. **Belongs on a server.** |
| `…/react` | Thin React adapter that renders a receipt layout or a receipt sheet. Needs React. |
| `…/fixtures/*` | Golden receipts (JSON): inputs `receipts/<name>.json`, promised line output `expected/<name>.lines.json`, `manifest.json` with checksums. The backend, the browser register and the Flutter package check against the same files. |

Every exported function carries its documentation as TSDoc in the shipped type
declarations, so your editor shows it on hover. That is also the reference for
the partner and invoice endpoints; this README shows how to use the client.

## Base URLs and the `/v3` marker

1.x speaks only the English API `/v3`. Every field name, every value your code
branches on and every error code is English; texts for people (`message`,
`serverMessage`, `nextSteps`, the printed receipt) stay German, as do the
terms of the BMF and FinanzOnline.

| Path | Default | Option | Used for |
|---|---|---|---|
| public | `https://api.kasseneck.at/v3` (`DEFAULT_BASE_URL`) | `baseUrl` | receipts with `apiKeyAuth`, reports, payments, FinanzOnline, invoice and partner API |
| register (POS) | `https://kasse.kasseneck.at/api/v3` (`POS_BASE_URL`) | `posBaseUrl` | pairing, sign-in, settings, articles, printers; with `registerUserAuth` also receipts, cancellation and receipt email |
| same origin | `/api/v3` | `posBaseUrl: '/api/v3'` | the browser register served from `kasse.kasseneck.at` itself |

The package picks the path per call; `PUBLIC_CALLS` and `POS_CALLS` list which
call goes where. A base of your own (a proxy, the emulator) must end in `/v3`
once trailing slashes are removed, otherwise creating the client throws a
`KasseneckValidationError` right away. There is no `/v1` and no bare `/api` in
the 1.x line.

```ts
import { createKasseneckApi, registerUserAuth } from '@kreiseck/kasseneck-api';

// Browser register on kasse.kasseneck.at: same origin, no CORS involved.
const pos = createKasseneckApi({
  auth: registerUserAuth({ getIdToken, getSessionId, cashregisterId: 'kasse-1' }),
  posBaseUrl: '/api/v3',
  clientHeader: 'kasse-web/2026.09.28', // optional; default kasseneck-api/<version>
});
```

**The marker, fail closed.** Each request to a Kasseneck base (the two hosts
above over https, or a relative path) carries `Kasseneck-Api-Version: v3` and
`Kasseneck-Client`. Each response is checked **before** its body is read:

- HTTP 200 with `text/html` is the hosting fallback page; the call never
  arrived: `KasseneckApiError` with `code: 'route_missing'`.
- A response without `Kasseneck-Api-Version: v3` came from an edge that does
  not speak `/v3`: `code: 'dialect_mismatch'` with `outcome: 'unknown'`
  (behind an old edge a receipt may have been signed). See [Errors](#errors).
- HTTP 404 with the marker and an error envelope is how `/v3` answers an
  unknown endpoint: `code: 'not_found'`.

The package never falls back to another version. A mismatch is an error, not
a reason to try `/v1`.

**Browser on another origin.** A browser that calls `https://api.kasseneck.at/v3`
from a foreign origin sends a CORS preflight that asks for the two headers
above. Until the backend allows them in the `/v3` preflight, set
`omitKasseneckHeaders: true` on such a client. Only the request headers are
dropped; the response check stays. The browser register on its own origin
(`/api/v3`) and any Node process need nothing of this.

## Authentication

The client takes an **exchangeable authentication**: an object that supplies
the headers for each request. There are two, and neither is preferred:

| Mode | For | How |
|-----|-----|-----|
| `apiKeyAuth` | devices, POS apps, third parties | `api_key` as bearer token plus the `cashregister-token` header |
| `registerUserAuth` | browser register | ID token of the sign-in service as bearer token plus the `register-session` header, cash register as the `cashregisterId` parameter |

```ts
import { apiKeyAuth, registerUserAuth } from '@kreiseck/kasseneck-api';

// Device/POS: the api_key belongs on a device, never in a browser.
const device = apiKeyAuth({ apiKey: 'kr_live_…', cashregisterToken: 'cb_live_…' });

// Browser register: the package does not know the sign-in service. It gets
// functions that return a valid token and the current session. Both are asked
// on EVERY call (ID tokens expire after one hour, the register session after
// 90 seconds).
const register = registerUserAuth({
  getIdToken: () => auth.currentUser!.getIdToken(),
  getSessionId: () => sessionHolder.currentId(),
  cashregisterId: 'kasse-1',
});
```

### Calls without any authentication

Six calls run **without any identity**, because they are how an identity comes
into being or how a device manages itself. They live in `…/register` and take
**no authentication**, only the connection settings (`posBaseUrl`, timeout,
`fetch`); they always go to the register path:

| Call | Proof instead of authentication |
|---|---|
| `pairRegisterDevice` | the pairing code from the panel |
| `listRegisterUsersForDevice`, `listRegisterSessionsForDevice` | the device credentials from pairing |
| `unpairRegisterDevice` | the device credentials; locks the device in the backend |
| `registerUserLogin` | device credentials, user and PIN |
| `registerPinLogin` | device credentials and PIN, without choosing a user |

```ts
import { pairRegisterDevice, registerUserLogin } from '@kreiseck/kasseneck-api/register';

const paired = await pairRegisterDevice({ code: 'K7NPQR34', label: 'Bar' });
const session = await registerUserLogin({ ...paired, userId: 'ru-1', pin: '1234' });
```

`paired` carries `companyName`, `cashregisterLabel` and `testEnvironment`. A
device record stored under 0.x (device id and secret) keeps working: the calls
only send the device credentials, no new pairing is needed.

Sign-in errors carry a code from `REGISTER_ERROR_CODES`. Decide with
`isRegisterError(error, code)`; seconds to wait, the name of the device that
holds a session and the like come from `registerErrorDetails(error)`
(`deviceLabel`, `takeoverAllowed`, `retryAfterSec`, `distanceM`,
`pairedDevices`, `licenses`), never from the message text:

```ts
import { isRegisterError, registerErrorDetails, registerPinLogin } from '@kreiseck/kasseneck-api/register';

try {
  await registerPinLogin({ ...paired, pin });
} catch (error) {
  if (isRegisterError(error, 'too_many_attempts')) {
    showWait(registerErrorDetails(error).retryAfterSec);
  } else throw error;
}
```

With `session.customToken` the app signs in to the sign-in service; the
resulting ID token together with `session.sessionId` feeds `registerUserAuth`.
`renewRegisterSession` and `endRegisterSession` then run with
`registerUserAuth` and are also available on `createKasseneckApi`.

The package deliberately exports **no** "empty" authentication: it would be a
loophole for building every other call without authentication. The six calls
build their transport internally.

### Which mode works for which endpoint

**The backend decides, not this package.** The endpoint modules say in their
comments what applies. Cases that regularly surprise:

- `listMyCashregisters` and `listMyReceipts` need an **ID token**
  (`registerUserAuth` works); with `apiKeyAuth` they are not reachable.
- `getFirstReceiptDate` and the two report downloads (`downloadDailyReport`,
  `downloadMonthlyReport`) are **not** open to register users; they need
  `apiKeyAuth`. The same holds for the Stripe and Hobex cloud endpoints.

## Amounts are integer cents

In the receipt API, money is always an **integer amount in cents**:
`priceCents`, `valueCents`, `totalCents`, `amountCents`. Where the backend
returns euros (for example `total` in the receipt list) or expects them
(Hobex), the package converts exactly once at that boundary.

The reason: net, VAT (*USt*) and gross of a receipt line have to add up
exactly, and a cancellation has to mirror its receipt to the cent. With
floating point that goes wrong for roughly one amount in a hundred.

For the same reason a receipt line's `quantity` is a **whole number**. A
fractional one is rejected before anything is sent.

The invoice API has its own units: unit prices in cents or micro-euros,
quantities with up to three decimals. See [Invoice API](#invoice-api-invoice).

## Errors

A failure always arrives as a **thrown error**, never as a return value; you
never check a `status` field yourself. There are five error classes, each with
a type guard:

| Class | Guard | Meaning |
|---|---|---|
| `KasseneckApiError` | `isKasseneckApiError` | The backend answered with an error envelope (locked register, missing module, invalid parameter), or the package refused the response (`route_missing`, `dialect_mismatch`, `response_unreadable`). Carries `code`, `outcome`, `serverMessage` (German display text) and `details`. |
| `KasseneckHttpError` | `isKasseneckHttpError` | The response was not a usable envelope: HTTP 404/500 without envelope, empty body, text instead of JSON. `reason` tells the cases apart; `outcome` as below. |
| `KasseneckNetworkError` | `isKasseneckNetworkError` | No response at all: network down, DNS, aborted connection or timeout (`timedOut`). `outcome` as below. |
| `KasseneckAuthError` | `isKasseneckAuthError` | The request was never sent because authentication failed (missing credentials, or the token or session provider threw). |
| `KasseneckValidationError` | `isKasseneckValidationError` | Wrong shape. `scope: 'request'`: your input breaks a rule the package knows before sending. `scope: 'response'`: the backend reported success but the payload of a non-signing call lacked what it promises (on `createReceipt` and `cancelReceipt` that is `response_unreadable` instead). |

**None of them ever contains a secret**: no key, no token, neither the sent nor
the received body.

**Decide on the code, not the text.** Every code is English, lower case,
`snake_case`, and every endpoint group ships its catalogue with a guard:

| Catalogue | Guard | Where |
|---|---|---|
| `RECEIPT_ERROR_CODES` | `isReceiptError` | `createReceipt`, `getReceipt` |
| `CANCELLATION_ERROR_CODES` | `isCancellationError` | `cancelReceipt` |
| `PAYMENT_ERROR_CODES` | `isPaymentError` | `payments[]` of a sale or cancellation |
| `RECEIPT_EMAIL_ERROR_CODES` | `isReceiptEmailError` | `sendReceiptEmail` |
| `REGISTER_ERROR_CODES` | `isRegisterError` (`…/register`) | pairing and sign-in |
| `POS_ERROR_CODES` | `isPosError` (`…/pos`) | settings, articles, printers, tip recipients |
| `PARTNER_ERROR_CODES` + `PARTNER_REQUEST_ERROR_CODES` | `isPartnerError` (`…/partner`) | partner API |
| `INVOICE_ERROR_CODES` + `INVOICE_REQUEST_ERROR_CODES` | `isInvoiceError` (`…/invoice`) | invoice API |
| `INVENTORY_ERROR_CODES` + `INVENTORY_REQUEST_ERROR_CODES` | `isInventoryError` (`…/inventory`) | inventory API |

Every group has the same helpers: `is…ErrorCode(value)`, `…ErrorCode(error)`
(the code if the group knows it), `is…Error(error, code?)` (a type guard; without
`code` it asks whether the error belongs to the group) and
`…FieldErrors(error)` for the fields of a `validation` error
(`receiptFieldErrors`, `cancellationFieldErrors`, `paymentFieldErrors`,
`receiptEmailFieldErrors`, `registerFieldErrors`, `posFieldErrors`,
`invoiceFieldErrors`, `partnerFieldErrors`). Each list holds the group's own
codes, then the sign-in and edge codes that can reach the same call, then the
codes the package sets itself (`CLIENT_ERROR_CODES`: `route_missing`, and
`response_unreadable` on receipts and cancellations). A sale can fail with a
code from `RECEIPT_ERROR_CODES` or `PAYMENT_ERROR_CODES`, a cancellation with
one from `CANCELLATION_ERROR_CODES` or `PAYMENT_ERROR_CODES`. The invoice and
partner catalogues stay exactly the server's; their `…_REQUEST_ERROR_CODES`
add the rest. The German `serverMessage` is for display and may change.

Validation is strict: the 0.x ways of paying (`paymentMethod` and its card
fields), unknown keys in tips, layout options, register settings and the
receipt email, and values outside a settings field's value list throw a
`KasseneckValidationError` before anything is sent, instead of being dropped
silently. For a layout option of 0.x the message names its English successor.

### `outcome: 'unknown'`: never retry, look it up

`KasseneckApiError`, `KasseneckHttpError` and `KasseneckNetworkError` carry
`outcome`. `'rejected'` means the server turned the request down; whether
anything else is safe to do depends on the code, and on the money calls it
is only set for the codes listed below. `'unknown'` means the operation **may have been carried out**, for
`createReceipt` a signed receipt in the chain. Then never send it again blindly:
read the result back (`getReceipt`, `listMyReceipts`, the original of a
cancellation) and continue from there. A call with an `idempotencyKey` is the
one exception: send it again with the **same** key (see below).
`isOutcomeUnknown(error)` covers all three classes. The outcome is unknown for:

- `dialect_mismatch`, `receipt_outcome_unknown`, `cancellation_outcome_unknown`;
- `response_translation_failed`, unless `details.handled === false`;
- `response_unreadable`: a signing or money-moving call reported success,
  but the response lacks what the call promises (no receipt, no reference, no
  remaining quantities, no Hobex receipt, no captured payment intent);
- on every call with an effect (`UNKNOWN_OUTCOME_CALLS`, also in
  `fixtures/surface.json` as `unknownOutcomeCalls`): the signing calls
  `createReceipt`, `cancelReceipt` and `financeWebService`, the money calls
  `hobexPay` (`hobexPayApi`, charges a card), `hobexRefund`
  (`hobexRefundApi`) and `stripeCaptureIntent`, and since 1.5.1 every other
  call that books, issues, creates, changes, deletes or sends something:
  inventory writes and reservations, webhooks, invoices, credit notes,
  recorded payments, customers, invoice items and SEPA mandates, partner
  businesses, register settings, pairing, print jobs and receipt emails.
  There it is a network error or timeout after sending began, HTTP 5xx, and
  HTTP 200 with the `Kasseneck-Api-Version: v3` marker but an empty,
  non-JSON (also `text/html`) or status-less body (`KasseneckHttpError`,
  `reason` `empty-body`, `not-json` or `missing-status`). HTML without the
  marker stays `route_missing` with `'rejected'`: no function saw the call.
  Reading calls and dry runs (`previewGoodsReceipt`, `previewInvoice`) stay
  `'rejected'`, and so do the register sign-in sessions and
  `createPaymentLinkStripe`: a repeat books nothing (a second short-lived
  session, a second link nobody else has seen);
- on the money calls: every error envelope **without a code**, and every
  code that is not one of the rejection codes below. The Hobex and Stripe
  handlers also answer with a plain error message after the provider was
  called, so an envelope alone does not prove that nothing happened.

On the money calls (`hobexPayApi`, `hobexRefundApi`, `stripeCaptureIntent`)
`outcome` is `'rejected'` only for codes that are produced before the
provider is called, taken from the `/v3` contract (`errorCodes`):

- the sign-in codes (`errorCodes.auth` without the seven of the partner
  access, which never applies to these calls), raised before the handler
  goes on: `method_not_allowed`, `validation` (a required field is missing
  or has the wrong type), `cashregister_token_missing`,
  `cashregister_token_invalid`, `cashregister_not_found`,
  `account_not_found`, `live_not_enabled`, `unauthorized`, `mfa_required`,
  `user_verification_failed`, `admin_required`, `register_user_not_allowed`,
  `register_user_no_business`, `register_user_not_found`, `user_disabled`,
  `session_expired`, `cashregister_not_assigned`,
  `session_other_cashregister`;
- the edge codes that stop the call before the handler (`errorCodes.edge`):
  `validation` (unknown fields), `not_found`, `internal_translation_error`;
- the module and permission gates: `module_inactive`, `not_permitted`;
- `route_missing` (set by the package: no function saw the call).

`dialect_mismatch` and `response_translation_failed` (also with
`handled: false`) stay `'unknown'` there: the handler may have run.

On the money calls an unknown outcome means the card may have been charged,
the refund may have gone through, the payment may have been captured. A
failed `hobexRefund` throws a `KasseneckApiError`; it never returns `false`,
because a `false` on an unclear outcome invites a second refund. Even a
`'rejected'` is no invitation to resend blindly: fix the cause first.

**Never retry a call with an effect blindly, and never put a retrying layer
under the package.** A `fetch` passed in `options.fetch` (or a proxy or service
worker in front of it) must not resend a request by itself after a network
error, a timeout or a 5xx: a silent second send is a second signed receipt, a
second charge, a second refund or a second booking, and the package cannot
see it. Look the result up instead (`getReceipt`, `listMyReceipts`, the Hobex
transaction by its `transactionId`, the Stripe session).

**With an `idempotencyKey`** (inventory writes and reservations, `issueInvoice`,
`cancelInvoice`, `createCreditNote`, `recordInvoicePayment`, `createCustomer`
with a key, invoice items) the safe retry after `'unknown'` is the same request
with the **same** key: it takes effect exactly once and returns the stored
answer (`replayed: true` on invoices). Never a new key: that books a second
time. Without a key (receipts, cancellations, money calls, settings, webhooks,
`updateCustomer`) read the state first and only then decide.

A call through the open transport that this package does not know counts as
having no effect; say so with `transport(name, params, undefined, undefined,
{ hasEffect: true })`. `hasEffect: false` marks a dry run under the name of
the real call.

```ts
import { isOutcomeUnknown, paymentsExpectedCents } from '@kreiseck/kasseneck-api';

try {
  await api.sellReceipt({ items, payments });
} catch (error) {
  if (isOutcomeUnknown(error)) return reloadReceiptsAndAsk(); // never sell again blindly
  const expected = paymentsExpectedCents(error);            // payments_sum_mismatch
  if (expected !== undefined) return askAgain(expected);
  throw error;
}
```

## Receipts

The facade from `createKasseneckApi` offers `sellReceipt` and
`sellReceiptWithCompany`, `zeroReceipt` for a zero receipt (*Nullbeleg*),
`getReceipt` and `getReceiptWithCompany`, `listMyReceipts`, `cancelReceipt`,
`sendReceiptEmail`, the report downloads, the FinanzOnline status queries
(`getCashboxStatus`, `getSignatureStatus`), `getReportV2({ start, end })` for
the raw receipts and company data of a period, and the Stripe and Hobex cloud
payments.

The models are English throughout: the company has `taxNumber` and `vatId`, a
receipt `headerVersionId`, `layoutRuleset` and `registrationInfo`, a receipt
in the list `cancellationStatus` (`none`, `partial`, `full`, or `'unknown'` for
a value this version does not know: then offer no cancellation). The same
rule holds for print job states and register settings: a value the package
does not know is shown as `'unknown'` or kept as sent, never mapped onto a
known one.

**Layout rule sets.** `buildReceiptLayout` sets receipts according to a
numbered rule set. Without the `ruleset` option the current one applies
(`CURRENT_LAYOUT_RULESET`, currently 2: zero receipts carry a block
"Prüfangaben" with the registration data, which `getReceiptWithCompany`
returns as `registrationInfo`). The backend stores the rule set with each receipt,
and `getReceiptWithCompany` also returns the backend-built `layout` in that
rule set, so an old receipt looks the way it did when it was issued.

**Print and show the server's layout.** `layout` in a `…WithCompany` result
is a `ReceiptLayout` (`ruleset`, banner lines with `tone: 'receipt_type' |
'warning'`) and goes unchanged to `escPosLayoutBytes`, `eposPrintXml`,
`receiptSheet` and the React views; `receiptLayoutFromResult(result)` returns
it whenever it is there. Only without it does the helper build the layout,
in `fallbackPaperSize` (default `mm58`, as in 0.x). The server layout is
always 80 mm: on 58 mm paper choose the width at the print path
(`escPosLayoutBytes(layout, { paperSize: 'mm58' })`, `charsPerLine: 32`); the VAT
table then keeps the columns of the 80 mm grid. On the public channel only this layout carries the card block, because
the receipt itself comes without provider data. If you build the layout
yourself, pass the options from the same response:

```ts
buildReceiptLayout(receipt, company, { paperSize: 'mm80', testCashregister, testSignature, registrationInfo });
```

The options of 0.x (`testKasse`, `testSignatur`, `pruefangaben`,
`regelwerk`) are rejected with a `KasseneckValidationError` instead of being
ignored: a test receipt must never lose its "TESTKASSE" banner. The printed
text stays German, and the CSS classes of the React banner stay
`keck-receipt-banner--belegart` and `--warnung`.

Times on receipts are read as **Vienna wall-clock time**
(`parseServerTimeStamp`), never through `new Date(text)`.

## Cancellation (Storno)

A cancellation (*Storno*) refers to the original receipt, in full or in part:

```ts
const result = await api.cancelReceipt({
  receipt: original,                    // or: cashregisterId + originalReceiptId
  reason: 'input_error',                // catalogue: CANCELLATION_REASONS
  items: [{ index: 0, quantity: 1 }],   // omit = cancel all remaining quantities
  note: 'Customer only wanted one',     // internal, stored, never printed
  // Refund per original payment (negative, refundOf = id of that payment).
  // Omit it and the server refunds the remainder of every original payment.
  payments: [{ method: KeckPaymentMethod.cash, amountCents: -390, refundOf: 'p1' }],
});
result.receipt;         // the signed cancellation receipt (receiptType cancellation)
result.cancellationOf;  // reference to the original
result.remaining;       // remaining quantities of the original afterwards
```

The server negates the lines, checks remaining quantities and permissions
("own receipts only" or "all") and chains original and cancellation.
Cancellation, zero, start and training receipts cannot be cancelled, and a
fully cancelled receipt cannot be cancelled again. On a receipt you have read,
`remainingQuantities(receipt)` gives the remaining quantities up front (for the
cancellation dialog); the server has the final word.

Every business error of `cancelReceipt` carries `KasseneckApiError.code` from
`CANCELLATION_ERROR_CODES` (for example `already_cancelled`,
`quantity_exceeds_remaining`, `own_receipts_only`):

```ts
import { isKasseneckApiError, isCancellationErrorCode } from '@kreiseck/kasseneck-api';

try {
  await api.cancelReceipt({ receipt: original, reason: 'input_error' });
} catch (error) {
  if (!isKasseneckApiError(error) || !isCancellationErrorCode(error.code)) throw error;
  switch (error.code) {
    case 'already_cancelled':          // show the receipt as cancelled, disable the button
    case 'quantity_exceeds_remaining': // reload the remaining quantities (someone was faster)
    case 'own_receipts_only':          // ask a manager
      showHint(error.code);
      break;
    default:
      throw error;
  }
}
```

**Card refunds.** The terminal refund needs the transaction id of the original
card payment: `payments[].providerPaymentId` of the original receipt. Only the
register channel (`registerUserAuth`, `kasse.kasseneck.at/api/v3`) returns it;
the public channel leaves provider data out. The refund payment then carries
the id of the refund itself. `cancellation_outcome_unknown` means the
cancellation may have been booked: read the original again, never retry.

`createCancelReceipt` and cancelling through `createReceipt` are gone in 1.0.

**Vouchers.** A value voucher is only mirrored on a full cancellation (without
`items`); it cannot be split. A discount voucher is already part of the
original's turnover, and **every** cancellation takes it back in proportion to
the cancelled quantity. Example: 3 items at € 10 with a € 6 discount means € 8
was paid per item, so the cancellation receipt shows "−10,00" plus a line
"Gutschein-Ausgleich +2,00". What a cancellation granted is stored on its entry
in `receipt.cancellations[]` as `promoAdjustmentCents` (cents per VAT bucket
of the backend). The register can show it in the dialog; it does not have to
calculate anything.

**Returns (stock module).** If the account runs the stock module, a
cancellation books the goods of article lines back. `returnDisposition` says
where they go: `restock` (back into stock, the server's default),
`defective` (into stock as defective) or `disposed`. It is a default for the
call and can differ per line:

```ts
await api.cancelReceipt({
  receipt: original,
  reason: 'customer_cancelled',
  returnDisposition: 'restock',
  items: [{ index: 0, quantity: 1, returnDisposition: 'defective' }, { index: 1, quantity: 2 }],
});
```

Lines without `articleId` are never booked, whatever you send. A value outside
`RETURN_DISPOSITIONS` (also `null` or an empty string) is rejected before
sending with a `KasseneckValidationError` that names the path
(`items[0].returnDisposition`); the server would answer
`invalid_return_disposition`. The cancellation receipt carries `originalIndex`
and `returnDisposition` on its article lines, the original carries
`returnDisposition` in `cancellations[].items`.

**Printed receipt.** The header of a cancellation receipt names the original,
its date and the reason: "STORNOBELEG / Stornobuchung zu Beleg KASSE1-ID-42 /
vom 11.08.2026, 09:02 Uhr / Grund: Fehleingabe". The date comes from
`cancellationOf.timeStamp` (backend since 2026-09-04); older receipts without
it omit that line.

## Sending a receipt by email

```ts
const confirmation = await api.sendReceiptEmail({
  fullReceiptId: original.fullReceiptId, // or: await api.generateFullReceiptId(receiptId)
  to: 'guest@example.at',
  language: 'de',                        // optional; the backend currently only uses 'de'
});
confirmation.to;   // address as the backend logged it (trimmed, lower case)
confirmation.at;   // time, ISO with Vienna offset, or null
confirmation.via;  // 'own' | 'platform' | 'platform_fallback' | null
```

A success response means the email has gone out. If it lacks `to` or `at`,
the call still succeeds: `to` falls back to the address you sent and `at` is
`null`. Throwing there would invite sending the email a second time.

The email contains a **link to the public receipt page**, not a PDF
attachment: the receipt page uses the same line model as screen and printed
receipt and offers a PDF there. The receipt itself stays untouched (BAO § 131,
RKSV); the backend keeps the sending log next to it.

The cash register comes from the authentication (`cashregister-token` header or
the parameter set by `registerUserAuth`), not from the options. A receipt of
another register therefore gets the same answer as a receipt that does not
exist. The codes are in `RECEIPT_EMAIL_ERROR_CODES` (`isReceiptEmailErrorCode`):
`invalid_address`, `receipt_not_found`, `too_many_requests` (5 emails per
receipt in 24 hours, 30 per register per hour) and `send_failed`.

## Receipt printing: QR code, logo, printers

### The QR code fits the paper

The native QR command is given a module size in dots and does not check
whether the symbol plus quiet zone fits the roll. Too wide means, on most
thermal printers, not "cut off" but **no QR code at all**: on a mandatory
receipt the worst possible result. So this package calculates the size instead
of setting it:

```ts
import { qrSizingFor, QR_PRINT_WIDTH_DOTS } from '@kreiseck/kasseneck-api/printing';

const qrSize = qrSizingFor({ payload: receipt.qr, paperWidthDots: QR_PRINT_WIDTH_DOTS.mm58 });
// qrSize.moduleDots: dots per module; null = does not fit even with the exception size
// qrSize.belowMinimum: printed, but below 4 dots per module
```

On the receipt path this happens automatically. `qrModuleSize` is a **cap**, not
a target: the largest size that fits is printed, at most the cap. `auto` (the
default) caps at 6 dots per module, as in the Dart twin and on the Epson path;
`small` caps at 4, `medium` at 6, `large` at 8. All print paths use error
correction level M.

```ts
import { escPosLayoutResult } from '@kreiseck/kasseneck-api/receipt';

const { bytes, qrError, qrFallback } = escPosLayoutResult(layout, {
  qrModuleSize: 'large',     // 'auto' | 'small' | 'medium' | 'large'
  qrMode: 'nativeModel1',    // older printers that only support model 1
  qrMatrix: matrixFor,       // fallback: the QR code as an image instead of none
});
```

The Epson ePOS path (`eposPrintXml` / `eposDirectPrint`) calculates the same
way; `eposPrintXmlResult` returns `{ xml, qrError, qrFallback }`. The default
there is also `auto`.

`qrError` means "receipt without QR code": tell the customer. `qrFallback`
means "printed, but the configured mode does not suit this device": tell the
manager. The image fallback only runs with a `qrMatrix` function that turns
the payload into a finished matrix; the package itself neither encodes QR
codes nor processes images for it.

### The receipt sheet: the same receipt everywhere

Screen, ESC/POS, ePOS and PDF all set the same **sheet**: grid lines, company
logo, QR code and the Kasseneck logo at the end, with sizes as a share of the
sheet width and in lines (one line = two character widths).

```tsx
import { ReceiptSheetView } from '@kreiseck/kasseneck-api/react';

const result = await api.getReceiptWithCompany(receiptId);
const { company, logoScale } = result;
const layout = receiptLayoutFromResult(result);

<ReceiptSheetView
  layout={layout}
  logo={company.logoUrl ? { url: company.logoUrl, size: logoScale } : null}
  brandMark={company.showKreiseckLogo}
  renderQr={(data) => <QrSvg data={data} />}
/>
```

```ts
import { escPosLayoutBytes, logoDimensions, rasterizeLogo } from '@kreiseck/kasseneck-api/receipt';

const logoSize = logoDimensions({ size: 'M', pixelWidth: image.width, pixelHeight: image.height }, 48);
const raster = rasterizeLogo(imageData.data, image.width, image.height, logoSize, 48);
escPosLayoutBytes(layout, { paperSize: 'mm80', logo: { size: 'M', pixelWidth: image.width, pixelHeight: image.height, raster }, brandMark: true });
```

Logo sizes: S 42 % × 5 lines, M 62 % × 8, L 80 % × 12, XL 94 % × 16, always
fitted, never scaled up. Banners (TESTKASSE, STORNOBELEG, …) are framed by
`=` lines, the same on every path. The package rasterises finished RGBA pixels;
loading and decoding the image (PNG, JPEG) stays with your application.

### Getting the bytes to the printer

The package generates ESC/POS bytes and ePOS XML, and it ships three ways to
deliver them: **WebUSB** (`usbConnectPrinter`, `usbPrint` in `…/printing`, for
Chromium-based browsers), **Epson ePOS over HTTP** (`eposDirectPrint` in
`…/receipt`) and **print jobs** for network printers managed by the backend
(`listMyPrinters`, `createPrintJob` in `…/pos`). Bluetooth, serial ports and
raw TCP sockets are up to your application. PDF generation is not part of the
package.

## Register settings, articles and printers (`./pos`)

The calls of the tile register run on the register path and take a transport
from `createTransport` with the same options as `createKasseneckApi`.
Settings come as `{ business, device }` with English keys and values
(`theme: 'night'`, `receiptOutput: 'ask'`, `shortcuts.checkout`), merged with
the defaults `POS_BUSINESS_DEFAULTS` and `POS_DEVICE_DEFAULTS`.

**Send only what changed.** The server merges deeply, so a write carries only
the changed fields. `posSettingsChanges(before, after)` computes them; it sends
`vatRates` and `shortcuts` as whole maps, which is what the server expects:

```ts
import { createTransport, registerUserAuth } from '@kreiseck/kasseneck-api';
import { getPosSettings, setMyPosSettings, posSettingsChanges, isPosError, posFieldErrors } from '@kreiseck/kasseneck-api/pos';

const transport = createTransport({ auth: registerUserAuth({ getIdToken, getSessionId, cashregisterId }), posBaseUrl: '/api/v3' });

const before = await getPosSettings(transport);
const after = { ...before.business, theme: 'night' as const, fontSize: 'L' as const };
try {
  await setMyPosSettings(transport, posSettingsChanges(before.business, after));
} catch (error) {
  if (isPosError(error, 'validation')) showFieldErrors(posFieldErrors(error)); // [{ field: 'business.color', message }]
  else throw error;
}
```

Never send back the whole merged block. A value the server knows and this
version does not (`theme: 'sepia'`) is read and kept as it is;
`unknownPosSettingValues(settings)` names such paths, so the interface can show
them as not editable. Left unchanged, such a value is not sent and stays on the
server; inside a whole block it would be rejected before sending. The same
check rejects unknown keys (also the German keys of 0.x such as `stil`),
values outside a field's list, a `vatRates` map without any rate switched on,
unknown shortcut actions and a key bound twice (`posShortcutConflict`).
Per-device settings go through `setMyRegisterDeviceSettings(transport, deviceId,
changes)`.

A state you stored yourself (for example settings cached in `localStorage`)
goes through `sanitizePosSettings` or `mergePosSettings` first: both drop the
German values of 0.x, so an old cache falls back to the defaults instead of
sending a German value.

The rest of `…/pos`: `listMyArticles` and `listMyArticleGroups` for the tiles
(`visible`, `quantityRule: 'piece' | 'decimal'`, `askQuantity`,
`maxQuantity`; for scanner search `number`, `ean` and `internalCode`, passed
through unchanged and `null` when empty; `stockTracked`, `null` when the
response says nothing), `listMyPrinters`, `createPrintJob` and `getPrintJob` for
network printers (poll until `isPrintJobFinished(job)`; an unknown state is
`'unknown'` and ends the polling), `listMyTipRecipients`, `setMyPosLogo`, and
the register's text catalogue (`MESSAGES`, `LABELS`, `messageText`,
`labelText`). Text keys are English (`cancellation.outcome_unknown`,
`split.add_payment`), and so are the placeholders:
`messageText('checkout.locked', { reason })`. The rendered German texts are
the same as in 0.x.

**Stock at the register.** Three calls on the register path (`/api/v3` only),
permissions checked by the server (`stockView`, `stockCosts`, `stockLocation`
in `REGISTER_PERMS`):

```ts
import { listMyStockLocations, listMyStock, setMyCashregisterStockLocation } from '@kreiseck/kasseneck-api/pos';

const locations = await listMyStockLocations(transport); // { id, name, type, address, licensePlate, active, virtual }
const { stock, values } = await listMyStock(transport, { locationId: 'van-1' });
await setMyCashregisterStockLocation(transport, { stockLocationId: 'van-1' }); // null resets to the default location
```

Quantities are integers in thousandths of the base unit (`1000` is one
piece, `250` is 0.250 kg) and can be negative when more was sold than booked;
the package never rounds, divides or clamps them. `values` (stock value in
cents, average cost in micro-euros, `null` for a quantity of 0) is `null`
without the permission `stockCosts`, never an empty list: show no value then,
not "0,00 €". `address` is `null` when the location has no address part (a
vehicle has none). Articles carry `stockLocationIds` (`null` when the article
names none), registers `stockLocationId` (absent for the default location;
only the result of `setMyCashregisterStockLocation` uses `null` for it), and
`listRegisterUsersForDevice` returns `cashregister.stockLocationId`;
errors such as `location_not_found` and `location_inactive` are in
`POS_ERROR_CODES`. The register's stock words are in the catalogue as
`stock.*` labels (`labelText('stock.where_to')`), and
`RETURN_DISPOSITION_LABELS` gives the label of each return choice
(`labelText(RETURN_DISPOSITION_LABELS.restock)` is "Zurück ins Lager").

`stockViewOf(perms)` (also exported from the package root) tells whether a
register user may see locations and quantities: a missing `stockView` counts
as granted, only an explicit `false` blocks it, and the other stock
permissions count as denied when missing.

**Stock must never block a sale.** A response the package cannot read
(a `KasseneckValidationError` with `scope: 'response'` from `listMyStock` or
`listMyStockLocations`, for example a missing or fractional quantity) is never
turned into a quantity of `0`. Treat it as "stock temporarily unavailable":
hide the stock figures and keep selling.

`ERROR_RULES` says which text a failed call shows, one rule per kind, the
same in both registers. `ERROR_CODE_RULES` (per `error.code`) and
`ERROR_OUTCOME_RULES` (per outcome) refine it; `findErrorRule(kind, { code,
outcome: messageOutcome(error) })` applies all three in that order. A timeout
or network error on a call with an effect (`CALLS_WITH_EFFECT`) shows
`network.outcome_unknown`, which never suggests a retry. The edge codes
show a plain German sentence instead of the package's technical sentence,
which stays in `error.message` for the log: `route_missing`, `not_found` and
`internal_translation_error` (nothing happened on the server)
`server.connection_disturbed`, which suggests trying again;
`dialect_mismatch`, `response_translation_failed` and `response_unreadable`
(outcome unknown) `server.response_unreadable`, which asks to reopen the
register and check whether the last operation was booked, and never
suggests a retry.

## Stored documents (`./stored`)

For clients that read Firestore directly, such as the admin panel. Stored
documents keep the internal German form; `…/stored` turns them into the same
English models the `/v3` wire returns, following the server's own rules
(layout rule set, logo size, `TESTKASSE` banner, the settings merge):

```ts
import { fromStoredReceiptWithCompany, fromStoredPosSettings, invalidStoredPosSettings } from '@kreiseck/kasseneck-api/stored';

// The header version the receipt names (receipt.headerVersionId), plus the account document.
const result = fromStoredReceiptWithCompany(receiptDoc, {
  headerVersion: { id: headerDoc.id, data: headerDoc.data() },
  account: accountDoc.data(),
});
receiptLayoutFromResult(result); // the same layout getReceiptWithCompany returns

const settings = fromStoredPosSettings({ betrieb, geraet }); // stored register settings
invalidStoredPosSettings({ betrieb, geraet });               // paths the server would drop
```

`fromStoredReceipt`, `fromStoredCompany` and `fromStoredArticle` complete the
set. A broken document throws a `KasseneckValidationError`. `fromStoredReceipt`
also takes a receipt that already carries the English 1.0 values (for example
a fixture with `cancellationReason: 'customer_cancelled'`) and leaves them
as they are; the package keeps it that way.

The receipt layout and the print logo have an internal form as well: the
backend under `/api` and the 0.x browser cache use `regelwerk` for `ruleset`,
banner lines with `ton` (`belegart`, `warnung`) for `tone` (`receipt_type`,
`warning`), and a print logo with `stufe`, `pxBreite`, `pxHoehe`, `breite`,
`hoehe`, `zeilen`. `fromStoredLayout` reads either form and keeps the key
order (`null` for anything short of a whole layout: no or empty `lines`, a
line that is not an object, no `paperSize`; `receiptLayoutFromResult` then
rebuilds it), `toStoredLayout` writes the internal one, and
`fromStoredPrintLogo`/`toStoredPrintLogo` do the same for a `PrintLogo`. There is no
reader for stored invoices: the server computes the invoice view, so read it
with `getInvoice` and `listInvoices`.

## Card payments

`…/payments` covers three ways to take card payments from a browser or a Node
process:

- **Stripe payment links** (`createStripeLink`, `stripeCaptureIntent`): remote
  payment by link or QR code, through the backend.
- **Hobex cloud** (`hobexPay`, `hobexRefund`): a terminal registered with
  Hobex, controlled over the network through the backend. Amounts are passed in
  cents; the package converts to euros for Hobex.

`hobexPay`, `hobexRefund` and `stripeCaptureIntent` move money. They are never
retried, neither by the app nor by a retrying `fetch` under the package: on
`isOutcomeUnknown(error)` look the payment up (see
[`outcome: 'unknown'`](#outcome-unknown-never-retry-look-it-up)).
- **Hobex HPS via Kasseneck Connect**, described below.

### Hobex HPS via Kasseneck Connect

A browser has no raw TCP sockets, so **direct** terminal contact as in the
Flutter package `kasseneck_api` (`HpsClient`) stays out of reach of this
package. **Kasseneck Connect** is a local device agent with a plain HTTP
interface that talks to the terminal on behalf of the register, and that is
the way in:

```ts
import { createHpsConnectClient, createHpsPayments } from '@kreiseck/kasseneck-api/payments';

const client = createHpsConnectClient({ token: pairingToken });
const terminal = createHpsPayments(client, { host: '192.168.1.50', tid: '3600335' });

const payment = await terminal.pay({ amountCents: 1050 });
// payment.outcome: 'approved' | 'declined' | 'unresolved', never guessed.
// payment.transactionId is ALWAYS set, also for 'unresolved'.

// Refund, and void of an earlier payment, work the same way:
await terminal.refund({ amountCents: 1050, originalTransactionId: payment.transactionId });
await terminal.cancel({ transactionId: payment.transactionId, amountCents: 1050 });
```

The outcome is always one of three: `approved`, `declined` (provably nothing
charged) or `unresolved` (outcome unknown; a retry could charge a second time).
What that means and why it is built this way is documented in
`src/payments/hobex-hps/payments.ts`; that documentation is authoritative, not
this README.

Terminals that can only be driven through a vendor's Android SDK cannot be
reached from a browser and are not part of this package.

## Partner API (`./partner`)

For software vendors who build Kasseneck into their own product: create
businesses, accompany them until the cash register is live, and then sign
receipts on their behalf.

The partner key (`pk_live_…`) belongs on a **server**. It can create
businesses and, with the extra scope `credentials:read`, fetch their secrets.

This subpath talks to the English Partner API **`/v3`**
(`PARTNER_BASE_URL`, `https://api.kasseneck.at/v3`) like the rest of the
package: every field name and every value your code branches on is English,
including every error code (`PARTNER_ERROR_CODES`, and
`PARTNER_REQUEST_ERROR_CODES` for rejected keys and scopes). Texts for humans
(`message`, `note`, `statusText`, `nextSteps`) stay German.
`partner.errorAdvice(code)` always returns a sentence, with a general fallback
for a code this version does not know.

```ts
import { createPartnerApi, isPartnerError } from '@kreiseck/kasseneck-api/partner';

const partner = createPartnerApi({ partnerKey: process.env.KASSENECK_PARTNER_KEY! });

const { customerId } = await partner.createPartnerCustomer({
  appId: 'app_…',
  idempotencyKey: customerNumber, // your own number; protects against duplicates
  business,                       // master data (type Business): legalForm 'sole_proprietor', state 'AT-5', …
  // env: 'test' is allowed even with a LIVE key: that is how you rehearse the
  // whole chain without a second key. Never the other way round.
});

await partner.sendPartnerCustomerFonLink(customerId);
// … wait for the event customer.fon_verified …
await partner.requestCustomerSignature(customerId);
// … wait for signature.ready …
await partner.createCustomerCashregister({ customerId });  // automatic: true is the default
```

The order is strict, and each step complains with its own code if an earlier
one is missing. The order ships as data (`PARTNER_FLOW`), and for every code
there is an action hint:

```ts
try {
  await partner.activateCashregister(customerId, cashregisterId);
} catch (error) {
  if (isPartnerError(error, 'signature_not_ready')) {
    // The signature of THIS register is not ready yet: wait for signature.ready.
    console.error(partner.errorAdvice('signature_not_ready'));
  }
}
```

`reportCustomerContract` reports a contract the business accepted through
the partner (terms of use or data processing agreement, with the text version
and its hash).

The two migration notes below are history from the 0.x line and use the names
of their time (`PARTNER_FEHLER_CODES`, `partnerFehlerRat`, the aliases
`Rechtsform`, `Bundesland`, `KontaktRolle`). For the move to 1.0 see
[Migrating from 0.x](#migrating-from-0x).

### Migrating from 0.27.x

0.28.0 is a breaking change for `./partner` only. The client now calls `/v3`
instead of `/v1`, and `/v3` rejects the German values of `/v1` with
`validation` instead of translating them. Stored data that goes into
`createPartnerCustomer` must use the new values:

| Where | 0.27.x (`/v1`) | 0.28.0 (`/v3`) |
|---|---|---|
| `business.legalForm` | `einzel`, `verein`, `sonstige` | `sole_proprietor`, `association`, `other` (`eu`, `og`, `kg`, `gmbh`, `gmbhcokg`, `ag` unchanged) |
| `business.state` | `burgenland` … `wien` | `AT-1` … `AT-9` (ISO 3166-2) |
| `business.contacts[].roles` | `geschaeftsfuehrung`, `buchhaltung`, `technik`, `kasse` | `management`, `accounting`, `technical`, `pos` |
| `business.taxDetails` | `uid` (type only; the server always wanted `vatId`) | `vatId` |
| `avv.mode` | `direkt`, `vollmacht`, `unterauftrag` | `direct`, `power_of_attorney`, `subprocessor` |
| fee on `createPartnerCustomer` / `requestCustomerSignature` | not read (`entgelt {cents, rhythmus, test}`) | `fee {cents, interval, test}`, `interval`: `monthly`, `yearly`, `once` |
| signature `history[].reason` | `karte_eingetragen`, `fon` | `card_entered`, `finanzonline` |
| delivery `status`, `lastDelivery.status` | `zugestellt`, `offen`, `fehlgeschlagen`, `verworfen` | `delivered`, `pending`, `failed`, `dropped` |
| `deletePartnerWebhook` | returned the `webhookId` | returns `{ webhookId, deleted }` |
| event `customer.terms_accepted` | `kind: 'nutzung'` | `kind: 'terms'` |
| event `source` | `einrichten`, `prozess`, `partner_vollmacht`, `admin_papier`, `papier_upload` | `setup_link`, `process_link`, `partner_power_of_attorney`, `admin_paper`, `paper_upload` |

Field names in this client that were German are English now as well:
`SignaturStand.signatur` is `signature` (plus `signatures[]`), a request's
`art` is `kind`, history `von`/`nach` are `from`/`to`,
`WebhookTestResult.ereignis` is `event`, a delivery's
`letzterVersuchAt`/`naechsterVersuchAt` are `lastAttemptAt`/`nextAttemptAt`,
and `requestCustomerSignature(id, { kind })` replaces `{ art }`. A webhook
now shows `apiVersion` and `lastDelivery { at, status, statusCode }`. The
types `Rechtsform`, `Bundesland` and `KontaktRolle` remain as deprecated
aliases of `LegalForm`, `AustrianState` and `ContactRole`.

**Webhook payloads have a language of their own.** A webhook created through
`/v1` keeps sending German payloads (`apiVersion: 'v1'`), whatever path you
call. Switch it once, there is no way back:

```ts
await partner.updatePartnerWebhook(webhookId, { apiVersion: 'v3' });
```

Webhook signature verification is unchanged.

### Migrating from 0.28.x

0.29.0 is a breaking change for `./partner` only, and only for
`PARTNER_FEHLER_CODES`: three codes that the server still sent in their
German `/v1` spelling under 0.28.0 now come through English, matching every
other value on `/v3`.

| 0.28.x | 0.29.0 |
|---|---|
| `zugang_nicht_erlaubt` | `access_not_allowed` |
| `kennung_fehlt` | `tax_number_missing` |
| `vertrag_offen` | `contracts_pending` |

`partnerFehlerRat()` and `istPartnerFehler()` follow: look up the new,
English key. A build that still checks the old German string will no longer
match, silently, so this is worth a search across your codebase.

Two codes that never reached this package's own error handling
(`kein_partnerbetrieb`, `request_not_found`, both admin-only and outside the
backend's public catalog) are gone from `PARTNER_FEHLER_CODES`. If you were
checking for them, that check was already dead code: the server never sent
them to a partner call.

`PARTNER_FEHLER_CODES` also gained nine codes for `reportCustomerContract`
(`kind_not_allowed`, `mode_not_allowed`, `power_of_attorney_missing`,
`not_found`, `no_version`, `not_required`, `unknown_version`, `text_changed`,
`already_accepted`), each with a `partnerFehlerRat()` sentence. This package
still does not expose that endpoint; the codes are here for completeness (a
catalog page, or code that reads the raw error yourself), not because a call
of this client can produce them.

The signature error type `SignaturAntrag.error.code` /
`CustomerSignature.error.code` is now `SignatureErrorCode`
(`customer_not_found` | `incomplete` | `finanzonline_error` | any other
string), a documented union instead of a bare `string | null`.

### A test event is not a cash register

`sendPartnerWebhookTest(webhookId, 'cashregister.live')` fires exactly the
event your handler is meant to handle; a mere connectivity check proves
nothing about handling the real case. So that nobody takes a test for real, it
carries `test: true` in the envelope:

```ts
const checked = await parseWebhookEvent({ secret, signatureHeader, body });
if (!checked.ok) return reply(400);

if (checked.event.test) return reply(200);   // test event: do nothing else
```

Without that line someone tells their customer the register is ready.

### Credentials are a third party's secrets

`getCustomerCredentials` returns the business's `api_key` and the tokens of its
cash registers. Whoever holds them can sign receipts in its name, and under the
RKSV a receipt cannot be taken back. They therefore do **not** come as
`string`, but in a wrapper that cannot be printed by accident:

```ts
const credentials = await partner.getCustomerCredentials(customerId);

console.log(credentials.apiKey);          // [apiKey «verborgen»], no plain text
JSON.stringify(credentials);              // every secret inside is masked the same way
`${credentials.apiKey}`;                  // same

storeEncrypted(credentials.apiKey.reveal());   // the only way out
```

Store them encrypted only, never log them, never put them in an email or an
error report. Every fetch is recorded and visible to the business.

### Verifying incoming webhooks

This is where integrations fail most often, so it ships ready-made. Four
things must hold: the **raw** body, a time window against replays (300 seconds
by default), a constant-time comparison, and every exception treated as a
rejection.

```ts
import express from 'express';
import { parseWebhookEvent } from '@kreiseck/kasseneck-api/partner';

const app = express();

// express.raw BEFORE any JSON parser: the signature covers the bytes as received.
app.post('/kasseneck-webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const result = await parseWebhookEvent({
    secret: process.env.KASSENECK_WEBHOOK_SECRET!,
    signatureHeader: req.header('X-Kasseneck-Signature'),
    body: req.body,           // Buffer, not req.body after JSON.parse
  });
  if (!result.ok) return res.status(400).send(result.reason);

  // Answer within 10 s, work afterwards. Deliveries can repeat:
  // deduplicate on event.id.
  res.sendStatus(200);
  await handle(result.event);
});
```

## Invoice API (`./invoice`)

For shops, accounting and industry software: issue **invoices** (*Rechnung*,
§ 11 UStG), not receipts, with the `api_key` of an account. An invoice is
**finalised** by the call: it carries its sequential number, cannot be changed
and can only be corrected by a credit note. The key belongs on a **server**.

```ts
import { createInvoiceApi, isInvoiceError } from '@kreiseck/kasseneck-api/invoice';

const invoices = createInvoiceApi({ apiKey: process.env.KASSENECK_API_KEY! });

// 1. Create the customer once; externalId is your own customer number.
let customer;
try {
  customer = await invoices.createCustomer({
    type: 'company', name: 'Café Muster GmbH', country: 'AT',
    street: 'Hauptplatz', houseNumber: '3', zip: '1010', city: 'Wien',
    externalId: 'shop-4711',
  });
} catch (error) {
  if (!isInvoiceError(error, 'customer_exists')) throw error;
  customer = await invoices.getCustomer({ externalId: 'shop-4711' });
}

// 2. Issue. The server sets the invoice date and derives the tax case.
const { invoice, replayed } = await invoices.issueInvoice({
  idempotencyKey: `order-${orderNumber}`,   // same order = same invoice
  customerId: customer.id,
  priceMode: 'net',
  serviceStart: '2026-09-14',
  items: [{ description: 'Consulting', quantity: 2, unit: 'hour', unitPriceCents: 5000, vatRate: 20 }],
});
// invoice.number, invoice.totals.grossCents (12000), invoice.statusUrl

// 3. Fetch the files.
const pdf = await invoices.getInvoicePdf(invoice.id);      // Uint8Array, with Factur-X
const { xml, filename } = await invoices.getInvoiceXml(invoice.id, 'ubl'); // Peppol UBL, filename invoice-<number>.xml

// 4. Correct, only by credit note.
await invoices.createCreditNote({
  idempotencyKey: `discount-${orderNumber}`,
  invoiceId: invoice.id,
  reason: 'price_reduction',
  items: [{ description: 'Discount on consulting', quantity: 1, unitPriceCents: 2000, vatRate: 20 }],
});
```

**Prices and quantities.** Each line takes exactly one of `unitPriceCents`
(whole cents) and `unitPriceMicros` (micro-euros, 10⁻⁶ €, for prices below one
cent), in the invoice's `priceMode` (net or gross). `quantity` allows up to
three decimals, `discountPct` up to two. `taxScheme` is optional: the server
derives the tax case and checks a given value against it.

**Stock.** A line may name its article (`articleId`); if the article is
stock-tracked and the stock module is active, issuing the invoice books it
out, from `stockLocationId` or the default location. The invoice never fails
because of stock. `cancelInvoice` and `createCreditNote` take
`returnDisposition` (`restock`, `defective`, `disposed`), credit-note lines
also per line (`CreditNoteItemInput`); invoice lines reject it. Identifiers
must not contain `/` and must not be `.`, `..` or `__…__` (`validation`).
The package does not check invoice requests before sending; the server does,
and the examples `issue-stock`, `credit-return-disposition` and
`issue-error-stock-id` in `fixtures/invoice-api-examples/` show the shapes.

**Check the setup before the first invoice.** The invoicing module must be
active, the invoice API enabled for the account by Kasseneck, the account live,
and company name, address, VAT ID, bank account and number format must be
filled in. Otherwise `issueInvoice` answers with `invoice_api_not_enabled` or
`invoice_setup_incomplete`:

```ts
const status = await invoices.getInvoiceSetupStatus();
if (!status.ready) console.warn(status.missing.map((m) => m.message).join('\n'));
```

**Language and brand.** An invoice has one number and **one** language (`de`
or `en`, `INVOICE_LANGUAGES`): the one in the request, otherwise the customer's
(`customer.language`), otherwise German. It is frozen when the invoice is
issued; credit notes take over language and brand of their invoice. Public
authorities always get German (`language_not_allowed`). Dates and amounts keep
Austrian formatting in every language.

```ts
const [brand] = await invoices.listBrands();                // [{ id, name, isDefault }]
const { invoice } = await invoices.issueInvoice({
  idempotencyKey: `order-${orderNumber}`,
  customerId: customer.id,
  priceMode: 'net', serviceStart: '2026-09-15',
  language: 'en',                                           // otherwise the customer's language
  brandId: brand.id,                                        // otherwise the default brand
  items: [{ description: 'Consulting', quantity: 2, unitPriceCents: 5000, vatRate: 20 }],
});
// The same invoice as a German translation, NOT a second invoice:
const copy = await invoices.getInvoicePdf(invoice.id, { language: 'de' });
```

The translated copy carries the same number, is marked on every page as a
translation that is not an invoice of its own ("Übersetzung – keine eigene
Rechnung"), and has no embedded e-invoice. The texts of both languages ship as
`INVOICE_TEXTS` and `fixtures/invoice-texts.json`.

**Units are keys, not free text.** `items[].unit` takes a value from
`INVOICE_UNITS` (`piece`, `hour`, `day`, `flat_rate`, `kilogram`,
`square_metre`, …; default `piece`). The printed abbreviation follows the
invoice language (`Stk` or `pcs`), and the e-invoice carries the UN/ECE code
from `INVOICE_UNIT_CODES` (`C62`, `HUR`, …). Free text such as `"Std"` is
a `validation` error on field `items[0].unit`.

**Already paid?** If you take the payment online and invoice afterwards, pass
the payment along: it is recorded in the same transaction as the
finalisation, and the PDF then has no payment box and no giro QR code.

```ts
const { invoice } = await invoices.issueInvoice({
  idempotencyKey: `order-${orderNumber}`,
  customerId: customer.id,
  priceMode: 'net', serviceStart: '2026-09-16',
  items: [{ description: 'Consulting', quantity: 2, unitPriceCents: 5000, vatRate: 20, unit: 'hour' }],
  payment: { method: 'card', reference: payment.id },      // without amountCents: paid in full
});                                                         // invoice.openCents === 0

// If the money arrives later (bank transfer, partial payment):
await invoices.recordInvoicePayment({
  idempotencyKey: `payment-${payment.id}`,                  // required: otherwise a retry books twice
  invoiceId: invoice.id, method: 'transfer', amountCents: 12000, paidAt: '2026-09-20',
});
```

`reference` is stored but **not printed**; card data does not belong on an
invoice anyway.

**Cash sales.** The API treats `method: 'cash'`, and `method: 'card'` with
`onSite: true` (terminal at the point of sale), as a cash sale (*Barumsatz*,
§ 131b (1) no. 3 BAO). A card payment in an online shop is sent without
`onSite`:

```ts
// Terminal at the point of sale: a cash sale.
await invoices.issueInvoice({
  idempotencyKey: `counter-${orderNumber}`,
  customerId: customer.id,
  priceMode: 'gross', serviceStart: '2026-09-16',
  items: [{ description: 'Coffee beans 1 kg', quantity: 1, unitPriceCents: 2490, vatRate: 10, unit: 'piece' }],
  payment: { method: 'card', onSite: true },
});

// Card payment in the online shop: not a cash sale, so no onSite.
await invoices.issueInvoice({
  idempotencyKey: `shop-${orderNumber}`,
  customerId: customer.id,
  priceMode: 'gross', serviceStart: '2026-09-16',
  items: [{ description: 'Coffee beans 1 kg', quantity: 1, unitPriceCents: 2490, vatRate: 10, unit: 'piece' }],
  payment: { method: 'card', reference: payment.id },
});
```

For those cases the response's `notice` list contains `cash_receipt_required`:
a cash sale needs a receipt (§ 132a BAO), from the fiscal cash register where
the business is obliged to use one. The note on the invoice does not replace
it. `transfer` with `onSite` is a field error. Whether a payment counts as a
cash sale is for the business to assess; the flag only tells the API how it
was classified.

**Notices** (`notice`) are always a list, for `issueInvoice`,
`previewInvoice` and `recordInvoicePayment`. An intra-Community supply carries
`recapitulative_statement_due` (recapitulative statement).

**VAT ID check.** An invoice without VAT that relies on the customer's VAT ID
(intra-Community supply, reverse charge) is only issued with a result of the
VAT ID check (FinanzOnline, otherwise VIES) on the day of issue.
`vat_id_invalid` blocks the invoice. `vat_id_check_pending` means there is no
result yet: retry after `retryAfter` seconds with the same `idempotencyKey`,
or send `acceptVatIdRisk: true` to issue anyway, at the issuer's risk. The
invoice then carries `vatIdRisk` (`acceptedOn`), otherwise the frozen proof
`vatIdProof` (`checkedOn`, `source`, `level`, `code`); both are `null` where
nothing was checked.

```ts
try {
  await invoices.issueInvoice(request);
} catch (error) {
  if (!isInvoiceError(error, 'vat_id_check_pending')) throw error;
  const retryAfter = error.details['retryAfter'];           // seconds
  // later: same request and key, or with acceptVatIdRisk: true
}
```

**After a timeout, retry with the same `idempotencyKey`**, never with a new one:
you then get the invoice that was already issued (`replayed: true`). The same
key with different data gives `idempotency_conflict`. Since 1.5.1 every invoice
call with an effect (`issueInvoice`, `cancelInvoice`, `createCreditNote`,
`recordInvoicePayment`, `createCustomer`, `updateCustomer`) reports
`outcome: 'unknown'` after a timeout, a network error, HTTP 5xx or an
unreadable answer (before: `'rejected'`); `previewInvoice` and the reading
calls stay `'rejected'`. See
[`outcome: 'unknown'`](#outcome-unknown-never-retry-look-it-up).

Validation errors arrive as `validation` with field paths
(`invoiceFieldErrors(error)` → `[{ field: 'items[0].vatRate', message }]`).
The contract itself ships as data (`INVOICE_REQUESTS`) and as a JSON Schema at
`@kreiseck/kasseneck-api/fixtures/invoice-api.schema.json`; the backend
validates against exactly this file.

### Calculating invoice totals in advance

If you charge before the invoice exists, you need the amount the invoice will
show. `previewInvoice` asks the server itself: a dry run that validates like
issuing but finalises nothing and does not use up the `idempotencyKey`. Its
result is authoritative.

```ts
const items = [
  { description: 'Manicure', quantity: 1, unitPriceCents: 1479, vatRate: 20 as const },
  { description: 'Nail polish', quantity: 1, unitPriceCents: 1500, vatRate: 20 as const },
];
const request = { idempotencyKey: `order-${orderNumber}`, customerId: customer.id,
  priceMode: 'gross' as const, serviceStart: '2026-09-16', items };
const { preview, notice } = await invoices.previewInvoice(request);
// preview.totals, preview.taxScheme, preview.taxSchemeReason, then:
await invoices.issueInvoice(request);
```

**Without the server.** `@kreiseck/kasseneck-api/invoice/calc` is the pure
calculation core: no transport, no key, runs in the browser too. It calculates
with integers (BigInt) instead of floating point and rounds exactly once per
VAT rate. Prices are in micro-euros (`unitPriceMicros`), quantities in
thousandths (`quantityMilli`), discount and VAT rate in hundredths of a
percent (`discountBp`, `vatRateBp`):

```ts
import { calculateInvoice, itemFromEuro } from '@kreiseck/kasseneck-api/invoice/calc';

calculateInvoice(
  [{ unitPriceMicros: 14_790_000, quantityMilli: 1000, vatRateBp: 2000 }],
  { priceMode: 'gross' },
);
// { netCents: 1233, vatCents: 246, grossCents: 1479, byRate: [{ rateBp: 2000, … }], lines: […] }

itemFromEuro({ unitPrice: 14.79, quantity: 1, vatRate: 20 });
// { ok: true, position: { unitPriceMicros: 14790000, quantityMilli: 1000, discountBp: 0, vatRateBp: 2000 } }
```

`itemFromEuro(item)` converts a euro line (`unitPrice`, `quantity`,
`vatRate`, `discountPct`) into this form without loss, or names the field and
the reason when that is not possible. Since 23 September 2026 the server
calculates every new invoice with this core. In **gross mode** the gross amount
per rate is the agreed price: net = round(gross × 100 / (100 + rate)),
VAT = gross − net. In **net mode** the VAT per rate is rounded from the net
sum. Rounding is commercial (half a cent rounds away from zero). Totals are
positive for credit notes too; the sign is in the document type
(`docType: 'credit_note'`). Test cases: `fixtures/invoice-calc.json`,
`fixtures/invoice-calc-random.json`, `fixtures/item-from-euro.json`.

**`computeInvoiceTotals` is deprecated.** The older helper in `…/invoice` works on
`unitPriceCents` lines with the previous floating-point formula and does not
run through the core. At half-cent boundaries it can differ from an invoice
issued today by one cent per VAT rate, and by a few cents across several
rates. Example: € 21.35 net at 10 % gives € 23.48 gross with `computeInvoiceTotals`,
but € 23.49 with the core and on the invoice. It stays unchanged for existing
callers; use `calculateInvoice` or `previewInvoice` in new code. Test cases for
the old formula: `fixtures/invoice-totals.json`.

## Inventory API (`./inventory`)

For online shops and other systems that show or mirror the stock of a
Kasseneck account: read articles, locations, stock per location and the stock
ledger, and get every stock change pushed by webhook within seconds, also the
ones made at the register in the shop. Since 1.5.0 also the write side:
create and update articles, book goods receipts, transfers, losses and
condition changes, and reserve stock at checkout (see
[Shop: reserve and invoice](#shop-reserve-and-invoice)). Uses the `api_key` of
the account and belongs on a **server**. Reading needs the module `lager`,
writing additionally the account switch *Lager-API schreiben*, which Kasseneck
turns on (always on in the test environment, `kr_test_…`; otherwise
`inventory_api_not_enabled`). Purchase prices and stock values appear only when
the account has the permission `costs` (otherwise the fields are absent, not
`null`).

**Integers with a fixed scale:** quantities in thousandths of the base unit
(`1000` = 1 piece, `250` = 0.250 kg), money in cents, purchase prices in
micro-euros. `available = onHand − reserved` and may be negative: the register
never refuses a sale. A fractional quantity in a response throws
`KasseneckValidationError` with `scope: 'response'`; it is never read as `0`.

```ts
import express from 'express';
import { createInventoryClient, verifyInventoryWebhookSignature, parseInventoryWebhookEvent } from '@kreiseck/kasseneck-api/inventory';

const inventory = createInventoryClient({ apiKey: process.env.KASSENECK_API_KEY! });

// 1. Read: an article by its EAN, then its stock per location.
const article = await inventory.lookupArticleByCode('9001234567896');
const { stock } = await inventory.getStock(article.id);
// stock[0]: { articleId, locationId, onHand: 12000, reserved: 2000, available: 10000, defective: 0, sequence: 42, updatedAt }

// 2. Initial sync, page by page over nextCursor.
for await (const row of inventory.iterateStock()) {
  await shop.saveStock(row.articleId, row.locationId, row.available, row.sequence);
}

// 3. Subscribe once. The secret is shown only in this response.
const { secret } = await inventory.createWebhook({
  url: 'https://shop.example.com/kasseneck-webhook',
  events: ['stock.changed', 'stock.below_minimum'],
  description: 'Bäckerei Kornblum online shop',
});

// 4. Receive. express.raw BEFORE any JSON parser: the signature covers the bytes as received.
const app = express();
app.post('/kasseneck-webhook', express.raw({ type: '*/*' }), async (req, res) => {
  // await is required: the check is asynchronous, and a forgotten await
  // yields a Promise, which is truthy, so every delivery would pass.
  if (!(await verifyInventoryWebhookSignature(secret, req.header('X-Kasseneck-Signature'), req.body))) {
    return res.sendStatus(400);
  }
  let event;
  try {
    event = parseInventoryWebhookEvent(req.body);   // throws on a malformed envelope
  } catch {
    return res.sendStatus(400);
  }
  res.sendStatus(200);                  // answer within 10 s, work afterwards
  if (!event || event.test) return;     // unknown type of a later version, or a test delivery
  if (event.type === 'stock.changed') {
    // State, not delta: keep it only if sequence is higher than the stored one.
    await shop.saveStockIfNewer(event.data.articleId, event.data.locationId, event.data.available, event.data.sequence);
  }
});
```

- **Signature.** `verifyInventoryWebhookSignature(secret, header, rawBody, { toleranceSec, now })`
  resolves to `true` or `false` and never throws. It is the same procedure as
  for partner webhooks: `X-Kasseneck-Signature: t=<unix seconds>,v1=<hex>`
  with HMAC-SHA256 over `"<t>.<raw body>"`, compared in constant time, and a
  window of 300 seconds in both directions against replays. It is asynchronous
  because it uses WebCrypto: always `await` it, a forgotten `await` leaves a
  Promise, which is truthy, and lets every delivery through. The name differs
  on purpose from `verifyWebhookSignature` in `./partner`, which takes an
  options object and resolves to `{ ok, reason }`. After `rotateWebhookSecret`
  only the new secret is valid; pass both during your own switch-over
  (`secret` may be a list, one match is enough).
- **Parsing.** `parseInventoryWebhookEvent(rawBody)` returns `null` for an
  event type this version does not know (answer 2xx and skip it) and throws
  `KasseneckValidationError` on a body that is no envelope or carries a
  fractional quantity; verify first, then parse inside `try`.
- **Events.** `stock.changed` carries the current state of one article at one
  location (`onHand`, `reserved`, `available`, `defective`, `sequence`,
  `updatedAt`) plus `cause` (`sale`, `invoice`, `goods_receipt`, `transfer`,
  `takeover`, `reservation` …) and `movementId`; changes within 10 seconds are
  combined into one delivery. `stock.below_minimum` fires once when
  `available` (`onHand − reserved`, so a reservation alone can trigger it)
  drops below the minimum stock set for the location (`minStockByLocation` of
  the article); `minStock` in the payload is that threshold. The article's own
  `minStock` is a legacy field and never triggers it, and
  `listStock({ belowMinimum: true })` follows the same rule. In movements,
  `goods_receipt` is a goods receipt; `receipt` only ever means a sales receipt
  (`source.type`).
  `article.created`, `article.updated` and `article.deactivated` carry the
  article as `getArticle` returns it, without purchase prices.
  `reservation.expired`, `reservation.released` and `reservation.redeemed`
  carry the reservation as `getReservation` returns it, with its status after
  the change; `released` and `redeemed` also fire for a partial release or
  redemption (status still `active`). Deduplicate on `event.id`; deliveries
  are retried after 1 min, 5 min, 30 min, 2 h and 12 h.
- **Safety net without webhooks.** `listStock({ changedSince })` and
  `listArticles({ updatedSince })` are sorted by `updatedAt` ascending and
  include the boundary, so remembering the last `updatedAt` and asking again
  loses nothing. Lists take `limit` (1–200, default 50) and `cursor`.
- **Test deliveries.** `sendWebhookTest` sends a recognisably invented payload
  with `test: true` in the envelope. At most 20 per account and calendar day in
  Vienna (live and test environment count separately; rejected calls do not
  count); after that `rate_limited` with the wait until midnight in Vienna.
  Deliveries carry `deliveryId` (the header `X-Kasseneck-Delivery`), webhooks
  `consecutiveFailures`, the same names as for partner webhooks.
- **Errors.** `rate_limited` (about 20 requests per second per account, or the
  daily limit of `sendWebhookTest`) carries the wait in
  `inventoryRetryAfterSec(error)`. `inventory_api_not_enabled`,
  `module_inactive`, `article_not_found`, `invalid_cursor`,
  `webhook_not_found`, `webhook_limit` (5 per account),
  `invalid_webhook_url`, `event_not_subscribed` and `webhook_inactive` are
  decided on the code with `isInventoryError(error, code)`.

### Writing: articles and bookings

Every write takes an `idempotencyKey` (1 to 120 characters). The same request
with the same key takes effect exactly once; repeating it returns the stored
answer of the first call, the same key with different content gives
`idempotency_conflict`. After a timeout or a network error, repeat with the
**same** key, never with a new one. Since 1.5.1 every write, reservation and
webhook call reports `outcome: 'unknown'` in that case (also after HTTP 5xx or
an unreadable answer; before: `'rejected'`), so `isOutcomeUnknown(error)` is
the signal to resend with the same key; `previewGoodsReceipt` and the reading
calls stay `'rejected'`. The client refuses to send a write without
a valid key, and checks before sending only what is certainly wrong without the
network (required ids, integer quantities, amounts and prices, the range of
`expiresInMinutes`); everything else the server decides and reports with its
code.

```ts
import { createInventoryClient, isInventoryError, inventoryFieldErrors } from '@kreiseck/kasseneck-api/inventory';

const inventory = createInventoryClient({ apiKey: process.env.KASSENECK_API_KEY! });

// A foreign article with its EAN; without ean the server assigns an own code.
const roll = await inventory.createArticle({
  idempotencyKey: 'shop-article-1001',
  name: 'Kaisersemmel',
  ean: '9001234567896',
  unitPriceCents: 65,
  vatRate: 10,
  stockTracked: true,
  minStockByLocation: { haupt: 20000 },   // thousandths: warn below 20 pieces
  externalIds: { shop: '1001' },          // lookupArticleByCode({ externalSystem: 'shop', externalId: '1001' })
});

// Goods receipt: 60 pieces at 0.38 EUR each, plus freight spread by value.
const receipt = await inventory.receiveGoods({
  idempotencyKey: 'shop-goods-receipt-118',
  items: [{ articleId: roll.id, quantity: 60000, unitPriceMicros: 380000 }],
  landedCosts: [{ type: 'freight', amountCents: 450 }],
  reference: 'LS-2026-118',
});
// receipt: { operationId, movementIds, lotIds, warnings: [] }

try {
  await inventory.recordStockLoss({ idempotencyKey: 'shop-loss-7', reason: 'breakage', items: [{ articleId: roll.id, quantity: 2000 }] });
} catch (error) {
  if (isInventoryError(error, 'exceeds_stock')) { /* losses, transfers and condition changes never overdraw */ }
  else if (isInventoryError(error, 'validation')) console.log(inventoryFieldErrors(error));
  else throw error;
}
```

- **Articles.** `updateArticle({ idempotencyKey, articleId, …fields })` changes
  only the fields it names; `null` clears an optional one. `externalIds` and
  `metadata` are replaced as a whole, `minStockByLocation` is merged per
  location (`{ haupt: null }` removes just that one). `stockKind` is fixed after
  the first movement (`stock_kind_locked`). `deactivateArticle` frees the code
  and the external ids. `code_taken` and `external_id_taken` carry `field` and
  the `articleId` that holds the code in `error.details`. `minStock` is a
  legacy field without effect; use `minStockByLocation`.
- **Bookings.** `receiveGoods`, `transferStock`, `recordStockLoss` (`reason`
  from `STOCK_LOSS_REASONS`; `other` needs `note`, `withdrawal` needs
  `withdrawalType`), `changeStockCondition` (`sellable` ↔ `defective`) and
  `reverseStockMovement({ operationId, reason })` answer with a
  `StockOperation`. `warnings[]` are notices from `INVENTORY_WARNING_CODES`,
  never errors: the booking took effect. Prices may be sent without the
  permission `costs`; values come back only in `previewGoodsReceipt`, which is
  `receiveGoods` with `dryRun: true` (books nothing, needs no key; a `null`
  key counts as none and is not sent). `receiveGoods` itself refuses
  `dryRun: true` before sending (`KasseneckValidationError`, `scope:
  'request'`): a preview is not a booking, call `previewGoodsReceipt`.

### Shop: reserve and invoice

Hold the goods while the customer pays, turn the reservation into a sale with
the invoice, and let the server release what was never paid:

```ts
import { createInventoryClient, inventoryShortfalls, isInventoryError, parseInventoryWebhookEvent } from '@kreiseck/kasseneck-api/inventory';
import { createInvoiceApi } from '@kreiseck/kasseneck-api/invoice';

const inventory = createInventoryClient({ apiKey: process.env.KASSENECK_API_KEY! });
const invoices = createInvoiceApi({ apiKey: process.env.KASSENECK_API_KEY! });

// 1. Checkout: reserve everything or nothing, measured against `available`.
async function checkout(order: Order) {
  try {
    return await inventory.createReservation({
      idempotencyKey: `checkout-${order.id}`,   // the same key on every retry of this checkout
      reference: `Bestellung ${order.number}`,
      expiresInMinutes: 30,
      items: [{ articleId: 'kaisersemmel', quantity: 6000 }],   // 6 pieces, at the default location
    });
  } catch (error) {
    if (!isInventoryError(error, 'insufficient_available')) throw error;
    // Nothing was reserved. Tell the customer what is short:
    // [{ articleId, locationId, requested: 6000, available: 2000 }]
    return showShortage(inventoryShortfalls(error));
  }
}

// 2. Paid: issue the invoice; the position redeems the reservation.
async function paid(order: Order, reservationId: string) {
  const { invoice, notice } = await invoices.issueInvoice({
    idempotencyKey: `invoice-${order.id}`,
    priceMode: 'gross',
    serviceStart: '2026-10-06',
    orderReference: `Bestellung ${order.number}`,
    items: [{
      description: 'Kaisersemmel', quantity: 6, unitPriceCents: 65, vatRate: 10,
      articleId: 'kaisersemmel', reservationId,
    }],
    payment: { method: 'online' },
  });
  // Expired before the invoice: no error, the invoice sells without it.
  if (notice?.some((n) => n.code === 'reservation_expired')) log('sold without reservation', invoice.number);
}

// 3. Abandoned cart: give the goods back at once instead of waiting for expiry.
async function abandoned(order: Order, reservationId: string) {
  await inventory.releaseReservation({ idempotencyKey: `release-${order.id}`, reservationId });
}

// 4. Webhooks (subscribe to reservation.* with createWebhook, verify as above).
function onDelivery(rawBody: Buffer) {
  const event = parseInventoryWebhookEvent(rawBody);
  if (event && !event.test && event.type === 'reservation.expired') {
    return shop.cancelUnpaidOrder(event.data.reference);   // the stock is available again
  }
}
```

- **Redeeming.** A position with `reservationId` needs `articleId`. The server
  checks it when the invoice is issued: `reservation_not_found` (unknown or
  another account), `reservation_not_active` (already redeemed or released),
  `reservation_mismatch` (no open quantity of this article at the invoice's
  stock location, `stockLocationId` or the default location); nothing is issued
  then. An expired reservation is no error but the notice `reservation_expired`
  (with `reservationId`). The reservation is redeemed when the invoice is
  booked into stock: selling less than reserved releases the rest, selling
  more gives the warning `reservation_exceeded`. Credit notes take no
  `reservationId`.
- **Expiry.** Without `expiresInMinutes` the account's default applies (7 days);
  5 to 43,200 minutes are allowed. `extendReservation` sets a new expiry from
  now, only for an active reservation that is not yet due
  (`reservation_not_active`). `releaseReservation` without `items` releases
  everything, with `items` per position (without `quantity` the whole rest);
  the status becomes `released` only when nothing is open.
- **Events.** `reservation.expired`, `reservation.released` and
  `reservation.redeemed` carry the reservation with its status afterwards.
  `listReservations({ status: 'active' })` or `({ reference })` is the safety
  net without webhooks; the stock ledger shows reservations as movements of
  type `reservation` with `quantityDelta: 0` and the change in `reservedDelta`.

## Migrating from 0.x

1.0 is one breaking step: the wire, the exported names and the contract files
all become English at once. The full list is in the
[CHANGELOG](https://github.com/kreiseck-at/kasseneck-api/blob/main/CHANGELOG.md#100);
the fixture renames are machine-readable in `fixtures/renames-1.0.json`. The
short version:

- **Wire.** Only `/v3`: `api.kasseneck.at/v3` and `kasse.kasseneck.at/api/v3`.
  A `baseUrl` ending in `/v1` or `/api` throws. `baseUrl` now covers public
  calls only; whoever passed it to pairing, sign-in or register calls (the
  browser register used `/api`) switches to `posBaseUrl: '/api/v3'`.
- **Payments.** `payments[]` is mandatory; `paymentMethod`,
  `createCancelReceipt` and cancelling through `createReceipt` are gone.
  `receiptDueCents` needs `tipRecipient` for a tip without recipients.
- **Outcome.** Check `isOutcomeUnknown(error)` before any retry of a sale or
  cancellation.
- **Names.** German export names are English (`KASSE_BASE_URL` is
  `POS_BASE_URL`, `mergeKasseSettings` is `mergePosSettings`,
  `rechnungRechnen` is `calculateInvoice`, …), and so are field names, values
  and error codes. There are no aliases.
- **Subpaths.** `./kasse` is `./pos`, `./rechnung` is `./invoice`,
  `./rechnung/rechnen` is `./invoice/calc`; `./stored` is new.
- **Texts.** Catalogue keys and placeholders are English
  (`storno.ergebnis_unklar` is `cancellation.outcome_unknown`, `{betrag}` is
  `{amount}`); every rendered text is byte for byte the same.

0.x stays on `/v1` and gets fixes only, published under the npm dist-tag `legacy`
(`npm install @kreiseck/kasseneck-api@legacy`).

## Development

```bash
npm test              # test suite in three time zones (Vienna, UTC, Kiritimati)
npm run build         # ESM and CJS build into dist/, including a check of the exports
npm run check:consumer # packs the tarball and compiles two consumers (CJS/ESM)
npm run check:erreichbar # asks the public address: is there a function behind every call?
```

The three time zones are not overkill: time bugs happen to be correct on a
machine in Vienna.

### `check:erreichbar`: the only check that talks to `api.kasseneck.at`

The test suite and `check:consumer` run against mocks or against the tarball;
neither ever makes a call. If a call lacks its hosting rewrite, the published
address returns the HTML fallback page instead of the function, and no mock
sees that.

The check needs **no credentials**. A call without authentication answers,
when there is a function behind it, with an error envelope (`status` field)
and the header `Kasseneck-Api-Version: v3`. That is the proof: the call was
accepted and authentication was checked. An HTML page, a 404 or a missing
marker proves that there is no `/v3` function. That is why the script looks
for the envelope and the marker, not for success. Each call is asked at the
address the transport really picks for it: public calls at
`api.kasseneck.at/v3`, register-only calls at `kasse.kasseneck.at/api/v3`.

It is deliberately outside `npm test` because it needs the network. Without a
network it says so and exits with 0. CI runs the local part on every push;
the network part runs daily. A call that deliberately has no function would be
listed with a reason in `scripts/erreichbarkeit-ausnahmen.json`; since 1.0 that
list is empty. If an exception becomes reachable, the check fails; otherwise
the list would never shrink.

## Contract files for the twin packages

This package is the source for the Dart package `kasseneck_api` and for
validators in the backend. Files in `fixtures/` ship in the tarball and state
in machine form what both sides agreed on, among them:

| File | Contents | Generated by |
|---|---|---|
| `pos-settings-defaults.json` | field names and defaults of the register settings as sent on `/api/v3` (`business`, `device`), derived from the backend contract in `fixtures/v3/` | `npm run fixtures:kasse` |
| `stored/pos-settings-defaults.json` | the same defaults in the stored (internal, German) form (`betrieb`, `geraet`) | `npm run fixtures:kasse` |
| `surface.json` | base URLs (`baseUrls.public`, `baseUrls.pos`), the calls per path (`calls`, and the backend's `routes`), the calls with an effect whose outcome is `unknown` after a timeout, network error, 5xx or unreadable answer (`unknownOutcomeCalls`, sorted), settings value lists (`enums`, keyed by field), other register lists (`pos`), register error codes, permission keys, shortcut actions, partner, invoice and inventory lists | `npm run fixtures:oberflaeche` |
| `hobex-hps-codes.json` | measured HPS result codes, their meaning and whether they settle an outcome (the contract behind `isConclusive`) | `npm run fixtures:hobex-hps-codes` |
| `pos-texts.json` | the register's message catalogue | `npm run fixtures:texte` |
| `invoice-texts.json` | invoice texts in both languages | `npm run fixtures:rechnungstexte` |
| `invoice-api.schema.json` | JSON Schema of the invoice API | `npm run fixtures:rechnung` |
| `pos-message-cases.json` | error cases and the message each one must show in both registers | by hand |
| `receipt-due-generated.json` | 1206 amounts due computed by the backend's own code, the reference for `receiptDueCents` | `node scripts/v3-zahlbetrag-generieren.mjs` |
| `receipt-due-errors.json` | input the amount due cannot be computed from, with the `reason` of the `ReceiptDueError` each one throws | by hand |
| `v3/` | the backend's `/v3` contract (vocabulary, response cases, stored cases, amounts due), copied byte for byte | `node scripts/v3-vertrag-holen.mjs` |
| `renames-1.0.json` | everything in these files that changed from 0.x to 1.0: paths (`files`), text catalogue keys (`texts`), placeholders, structural keys (`structure`), machine values (`values`), shape changes (`shapes`); rendered texts are unchanged | `npm run fixtures:umbenennung` |

They are generated and never edited by hand. CI regenerates the register
settings and `surface.json` and fails if they differ from the committed
files; the test suite checks the others against the code.

`surface.json`, `hobex-hps-codes.json`, `pos-texts.json`,
`invoice-texts.json` and `invoice-api.schema.json` carry the package version.
**After every `npm version`, regenerate them and commit them along**,
otherwise the tests fail (`test/versionen.test.ts`).

### And the other direction

The contract in `fixtures/` is checked **over there**: the Dart repository
pulls it and holds its lists against it. A gap would therefore only show up in
the next twin run in the other repository, on another day. Against that there
are two hand-maintained snapshots of the Dart side under `test/fixtures/`,
each with a `_quelle` field:

| File | Checks |
|---|---|
| `dart-enums.json` | receipt type, VAT rate, payment method, card provider, voucher, Stripe mode |
| `dart-partner.json` | environments, error codes (API and portal), webhook events, fields of the webhook envelope including the `test` flag, business fields, retry plan |

They make `npm test` fail as soon as a value arrives in only one of the two
languages.

## Glossary

German terms used in this package, in its identifiers and on the linked pages:

| German | English |
|---|---|
| Beleg | receipt |
| Startbeleg | start receipt |
| Nullbeleg | zero receipt |
| Monatsbeleg | monthly receipt |
| Jahresbeleg | annual receipt |
| Schlussbeleg | final receipt |
| Storno | cancellation |
| Signaturerstellungseinheit | signature creation unit |
| DEP (Datenerfassungsprotokoll) | data capture log (DEP) |
| Kassennachschau | cash register audit |
| Belegerteilungspflicht | obligation to issue receipts |
| Registrierkasse | fiscal cash register |
| Umsatzzähler | turnover counter |
| Außerbetriebnahme | decommissioning |
| Ausfall der Signatureinheit | signature unit failure |
| Rechnung | invoice |
| USt | VAT |
| FinanzOnline | name of the online portal of the Austrian tax administration |
| BMF | name of the Austrian Federal Ministry of Finance |

## License

Apache-2.0, see `LICENSE` and `NOTICE`.

---

**Kasseneck** is a product of
[Kreiseck Software Solutions](https://kreiseck.com) from Salzburg, Austria:
apps, point-of-sale systems and automation. Questions about the interface,
custom integrations or a partnership:
[kasseneck.at/kontakt](https://kasseneck.at/kontakt).
