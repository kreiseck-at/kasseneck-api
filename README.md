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
- [Authentication](#authentication)
- [Amounts are integer cents](#amounts-are-integer-cents)
- [Errors](#errors)
- [Receipts](#receipts)
- [Cancellation (Storno)](#cancellation-storno)
- [Sending a receipt by email](#sending-a-receipt-by-email)
- [Receipt printing: QR code, logo, printers](#receipt-printing-qr-code-logo-printers)
- [Card payments](#card-payments)
- [Partner API (`./partner`)](#partner-api-partner)
- [Invoice API (`./rechnung`)](#invoice-api-rechnung)
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
} from '@kreiseck/kasseneck-api';
import { buildReceiptLayout, renderReceiptGrid, escPosLayoutBytes } from '@kreiseck/kasseneck-api/receipt';

const api = createKasseneckApi({
  auth: apiKeyAuth({ apiKey: 'kr_live_…', cashregisterToken: 'cb_live_…' }),
});

// Sell, and get the company data for the receipt header in the same call.
const { receipt, company, testKasse, testSignatur, pruefangaben } = await api.sellReceiptWithCompany({
  paymentMethod: KeckPaymentMethod.cash,
  items: [
    { name: 'Café Latte', quantity: 2, vat: VatRate.vat20, priceCents: 390 },
    { name: 'Marmeladeweckerl', quantity: 1, vat: VatRate.vat10, priceCents: 250 },
  ],
  // Optional tip in cents; the backend books it as a signed tip line.
  // With its own payment method or recipients: { cents, paymentMethod, recipients }.
  tip: 100,
});

// Layout: a plain data model (lines, alignment, columns, QR code).
// testKasse / testSignatur add the "not a valid receipt" banner where needed.
const layout = buildReceiptLayout(receipt, company, { paperSize: 'mm58', testKasse, testSignatur, pruefangaben });

// Character grid: exactly 32 (58 mm) or 48 (80 mm) characters per line.
// Screen, printed receipt and PDF all use this one grid.
const grid = renderReceiptGrid(layout);          // grid.lines[i].text, .bold, .kind, .qr

// ESC/POS bytes for a thermal printer; they print exactly the grid lines.
const bytes = escPosLayoutBytes(layout);
```

The receipt returned by `sellReceiptWithCompany` (or `sellReceipt`) has already
been signed, chained and stored in the data capture log (*DEP*) by the backend.

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
| `…/kasse` | Tile register: register settings (business-wide and per device), article groups and articles for tiles, discount distribution per VAT rate, scopes of register permissions, network printers and print jobs, tip recipients, the register's message catalogue. |
| `…/partner` | Partner API: create businesses, FinanzOnline link, signature, cash registers, credentials, webhooks with signature verification. **Belongs on a server.** |
| `…/rechnung` | Invoice API: create and search customers, issue finalised invoices, credit notes and cancellation, PDF and e-invoice XML, the contract as data. **Belongs on a server.** |
| `…/rechnung/rechnen` | Pure calculation core for invoice totals (integers, no transport, no dependency beyond types). Safe to run in the browser. |
| `…/react` | Thin React adapter that renders a receipt layout or a receipt sheet. Needs React. |
| `…/fixtures/*` | Golden receipts (JSON): inputs `belege/<name>.json`, promised line output `erwartet/<name>.lines.json`, `manifest.json` with checksums. The backend, the browser register and the Flutter package check against the same files. |

Every exported function carries its documentation as TSDoc in the shipped type
declarations, so your editor shows it on hover. That is also the reference for
the partner and invoice endpoints; this README shows how to use the client.

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
**no authentication**, only the connection settings (base URL, timeout,
`fetch`):

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
quantities with up to three decimals. See [Invoice API](#invoice-api-rechnung).

## Errors

A failure always arrives as a **thrown error**, never as a return value; you
never check a `status` field yourself. There are five error classes, each with
a type guard:

| Class | Guard | Meaning |
|---|---|---|
| `KasseneckApiError` | `isKasseneckApiError` | The backend received the request and rejected it (locked register, missing module, invalid parameter). Retrying does not help. Carries `code` (where the endpoint defines one), `serverMessage` (German display text) and `details`. |
| `KasseneckHttpError` | `isKasseneckHttpError` | The response was not a usable envelope: HTTP 404/500, empty body, HTML instead of JSON. `reason` tells the cases apart. |
| `KasseneckNetworkError` | `isKasseneckNetworkError` | No response at all: network down, DNS, aborted connection or timeout (`timedOut`). |
| `KasseneckAuthError` | `isKasseneckAuthError` | The request was never sent because authentication failed (missing credentials, or the token or session provider threw). |
| `KasseneckValidationError` | `isKasseneckValidationError` | Wrong shape. `scope: 'request'`: your input breaks a rule the package knows before sending. `scope: 'response'`: the backend reported success but the payload lacked what the call promises. |

**None of them ever contains a secret**: no key, no token, neither the sent nor
the received body.

**Decide on the code, not the text.** Where an endpoint has a catalogue of
error codes (cancellation, receipt email, partner and invoice API), branch on
`error.code`. The German `serverMessage` is for display and may change.

## Receipts

The facade from `createKasseneckApi` offers `sellReceipt` and
`sellReceiptWithCompany`, `zeroReceipt` for a zero receipt (*Nullbeleg*),
`getReceipt` and `getReceiptWithCompany`, `listMyReceipts`, `cancelReceipt`,
`sendReceiptEmail`, the report downloads, the FinanzOnline status queries
(`getCashboxStatus`, `getSignatureStatus`) and the Stripe and Hobex cloud
payments.

**Layout rule sets.** `buildReceiptLayout` sets receipts according to a
numbered rule set. Without the `regelwerk` option the current one applies
(`AKTUELLES_REGELWERK`, currently 2: zero receipts carry a block
"Prüfangaben" with the registration data, which `getReceiptWithCompany`
returns as `pruefangaben`). The backend stores the rule set with each receipt,
and `getReceiptWithCompany` also returns the backend-built `layout` in that
rule set, so an old receipt looks the way it did when it was issued.

Times on receipts are read as **Vienna wall-clock time**
(`parseServerTimeStamp`), never through `new Date(text)`.

## Cancellation (Storno)

A cancellation (*Storno*) refers to the original receipt, in full or in part:

```ts
const result = await api.cancelReceipt({
  receipt: original,                    // or: cashregisterId + originalReceiptId
  reason: 'fehleingabe',                // catalogue: CANCELLATION_REASONS
  items: [{ index: 0, quantity: 1 }],   // omit = cancel all remaining quantities
  note: 'Customer only wanted one',     // internal, stored, never printed
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
`CANCELLATION_ERROR_CODES` (for example `bereits_storniert`,
`menge_ueber_rest`, `nur_eigene_belege`):

```ts
import { isKasseneckApiError, isCancellationErrorCode } from '@kreiseck/kasseneck-api';

try {
  await api.cancelReceipt({ receipt: original, reason: 'fehleingabe' });
} catch (error) {
  if (!isKasseneckApiError(error) || !isCancellationErrorCode(error.code)) throw error;
  switch (error.code) {
    case 'bereits_storniert':  // show the receipt as cancelled, disable the button
    case 'menge_ueber_rest':   // reload the remaining quantities (someone was faster)
    case 'nur_eigene_belege':  // ask a manager
      showHint(error.code);
      break;
    default:
      throw error;
  }
}
```

**Deprecated:** `createCancelReceipt` (cancellation through `createReceipt`
with freely passed, negated lines) remains available for compatibility but is
`@deprecated`: no reference to the original, no remaining quantities, no
protection against double cancellation, no voucher handling. The backend adds
`deprecation` to its response on this path.

**Vouchers.** A value voucher is only mirrored on a full cancellation (without
`items`); it cannot be split. A discount voucher is already part of the
original's turnover, and **every** cancellation takes it back in proportion to
the cancelled quantity. Example: 3 items at € 10 with a € 6 discount means € 8
was paid per item, so the cancellation receipt shows "−10,00" plus a line
"Gutschein-Ausgleich +2,00". What a cancellation granted is stored on its entry
in `receipt.cancellations[]` as `promoAdjustmentCents` (cents per VAT bucket
of the backend). The register can show it in the dialog; it does not have to
calculate anything.

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
  sprache: 'de',                         // optional; the backend currently only uses 'de'
});
confirmation.to;   // address as the backend logged it (trimmed, lower case)
confirmation.at;   // time, ISO with Vienna offset
confirmation.via;  // 'eigen' | 'plattform' | 'plattform-fallback' | null
```

The email contains a **link to the public receipt page**, not a PDF
attachment: the receipt page uses the same line model as screen and printed
receipt and offers a PDF there. The receipt itself stays untouched (BAO § 131,
RKSV); the backend keeps the sending log next to it.

The cash register comes from the authentication (`cashregister-token` header or
the parameter set by `registerUserAuth`), not from the options. A receipt of
another register therefore gets the same answer as a receipt that does not
exist. The codes are in `RECEIPT_EMAIL_ERROR_CODES` (`isReceiptEmailErrorCode`):
`adresse_ungueltig`, `beleg_nicht_gefunden`, `zu_oft` (5 emails per receipt in
24 hours, 30 per register per hour) and `versand_fehlgeschlagen`.

## Receipt printing: QR code, logo, printers

### The QR code fits the paper

The native QR command is given a module size in dots and does not check
whether the symbol plus quiet zone fits the roll. Too wide means, on most
thermal printers, not "cut off" but **no QR code at all**: on a mandatory
receipt the worst possible result. So this package calculates the size instead
of setting it:

```ts
import { qrGroesseFuer, QR_DRUCK_PUNKTE } from '@kreiseck/kasseneck-api/printing';

const qrSize = qrGroesseFuer({ nutzlast: receipt.qr, papierbreitePunkte: QR_DRUCK_PUNKTE.mm58 });
// qrSize.punkte: dots per module; null = does not fit even with the exception size
// qrSize.unterMindestmass: printed, but below 4 dots per module
```

On the receipt path this happens automatically. `qrGroesse` is a **cap**, not
a target: the largest size that fits is printed, at most the cap. `auto` (the
default) caps at 6 dots per module, as in the Dart twin and on the Epson path;
`klein` caps at 4, `mittel` at 6, `gross` at 8. All print paths use error
correction level M.

```ts
import { escPosLayoutErgebnis } from '@kreiseck/kasseneck-api/receipt';

const { bytes, qrFehler, qrAusweich } = escPosLayoutErgebnis(layout, {
  qrGroesse: 'gross',        // 'auto' | 'klein' | 'mittel' | 'gross'
  qrModus: 'nativeModel1',   // older printers that only support model 1
  qrMatrix: matrixFor,       // fallback: the QR code as an image instead of none
});
```

The Epson ePOS path (`eposPrintXml` / `eposDirectPrint`) calculates the same
way; `eposPrintXmlErgebnis` returns `{ xml, qrFehler, qrAusweich }`. The default
there is also `auto`.

`qrFehler` means "receipt without QR code": tell the customer. `qrAusweich`
means "printed, but the configured mode does not suit this device": tell the
manager. The image fallback only runs with a `qrMatrix` function that turns
the payload into a finished matrix; the package itself neither encodes QR
codes nor processes images for it.

### The receipt sheet: the same receipt everywhere

Screen, ESC/POS, ePOS and PDF all set the same **sheet**: grid lines, company
logo, QR code and the Kasseneck logo at the end, with sizes as a share of the
sheet width and in lines (one line = two character widths).

```tsx
import { BelegBlattView } from '@kreiseck/kasseneck-api/react';

const { receipt, company, logoStufe } = await api.getReceiptWithCompany(receiptId);
const layout = buildReceiptLayout(receipt, company);

<BelegBlattView
  layout={layout}
  logo={company.logoUrl ? { url: company.logoUrl, stufe: logoStufe } : null}
  marke={company.showKreiseckLogo}
  renderQr={(data) => <QrSvg data={data} />}
/>
```

```ts
import { escPosLayoutBytes, logoMass, logoRaster } from '@kreiseck/kasseneck-api/receipt';

const logoSize = logoMass({ stufe: 'M', pxBreite: image.width, pxHoehe: image.height }, 48);
const raster = logoRaster(imageData.data, image.width, image.height, logoSize, 48);
escPosLayoutBytes(layout, { paperSize: 'mm80', logo: { stufe: 'M', pxBreite: image.width, pxHoehe: image.height, raster }, marke: true });
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
(`listMyPrinters`, `createPrintJob` in `…/kasse`). Bluetooth, serial ports and
raw TCP sockets are up to your application. PDF generation is not part of the
package.

## Card payments

`…/payments` covers three ways to take card payments from a browser or a Node
process:

- **Stripe payment links** (`createStripeLink`, `stripeCaptureIntent`): remote
  payment by link or QR code, through the backend.
- **Hobex cloud** (`hobexPay`, `hobexRefund`): a terminal registered with
  Hobex, controlled over the network through the backend. Amounts are passed in
  cents; the package converts to euros for Hobex.
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

```ts
import { createPartnerApi, istPartnerFehler } from '@kreiseck/kasseneck-api/partner';

const partner = createPartnerApi({ partnerKey: process.env.KASSENECK_PARTNER_KEY! });

const { customerId } = await partner.createPartnerCustomer({
  appId: 'app_…',
  idempotencyKey: customerNumber, // your own number; protects against duplicates
  business,                       // master data (type Betrieb): name, legal form, address, tax details, contacts
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
one is missing. The order ships as data (`PARTNER_ABLAUF`), and for every code
there is an action hint:

```ts
try {
  await partner.activateCashregister(customerId, cashregisterId);
} catch (error) {
  if (istPartnerFehler(error, 'signature_not_ready')) {
    // The signature of THIS register is not ready yet: wait for signature.ready.
    console.error(partner.fehlerRat('signature_not_ready'));
  }
}
```

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

## Invoice API (`./rechnung`)

For shops, accounting and industry software: issue **invoices** (*Rechnung*,
§ 11 UStG), not receipts, with the `api_key` of an account. An invoice is
**finalised** by the call: it carries its sequential number, cannot be changed
and can only be corrected by a credit note. The key belongs on a **server**.

```ts
import { createRechnungApi, istRechnungFehler } from '@kreiseck/kasseneck-api/rechnung';

const invoices = createRechnungApi({ apiKey: process.env.KASSENECK_API_KEY! });

// 1. Create the customer once; externalId is your own customer number.
let customer;
try {
  customer = await invoices.createCustomer({
    type: 'company', name: 'Café Muster GmbH', country: 'AT',
    street: 'Hauptplatz', houseNumber: '3', zip: '1010', city: 'Wien',
    externalId: 'shop-4711',
  });
} catch (error) {
  if (!istRechnungFehler(error, 'customer_exists')) throw error;
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
const xml = await invoices.getInvoiceXml(invoice.id, 'ubl'); // Peppol UBL as text

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
`RECHNUNG_TEXTE` and `fixtures/rechnung-texte.json`.

**Units are keys, not free text.** `items[].unit` takes a value from
`INVOICE_UNITS` (`piece`, `hour`, `day`, `flat_rate`, `kilogram`,
`square_metre`, …; default `piece`). The printed abbreviation follows the
invoice language (`Stk` or `pcs`), and the e-invoice carries the UN/ECE code
from `RECHNUNG_EINHEITEN_CODES` (`C62`, `HUR`, …). Free text such as `"Std"` is
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
payment: { method: 'card', onSite: true }   // terminal at the point of sale
payment: { method: 'card' }                 // card payment in the online shop
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

**After a timeout, retry with the same `idempotencyKey`**, never with a new one:
you then get the invoice that was already issued (`replayed: true`). The same
key with different data gives `idempotency_conflict`.

Validation errors arrive as `validation` with field paths
(`rechnungFeldFehler(error)` → `[{ field: 'items[0].vatRate', message }]`).
The contract itself ships as data (`RECHNUNG_ANFRAGEN`) and as a JSON Schema at
`@kreiseck/kasseneck-api/fixtures/rechnung-api.schema.json`; the backend
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

**Without the server.** `@kreiseck/kasseneck-api/rechnung/rechnen` is the pure
calculation core: no transport, no key, runs in the browser too. It calculates
with integers (BigInt) instead of floating point and rounds exactly once per
VAT rate. Prices are in micro-euros (`unitPriceMicros`), quantities in
thousandths (`quantityMilli`), discount and VAT rate in hundredths of a
percent (`discountBp`, `vatRateBp`):

```ts
import { rechnungRechnen, positionAusEuro } from '@kreiseck/kasseneck-api/rechnung/rechnen';

rechnungRechnen(
  [{ unitPriceMicros: 14_790_000, quantityMilli: 1000, vatRateBp: 2000 }],
  { priceMode: 'gross' },
);
// { netCents: 1233, vatCents: 246, grossCents: 1479, byRate: [{ rateBp: 2000, … }], lines: […] }

positionAusEuro({ unitPrice: 14.79, quantity: 1, vatRate: 20 });
// { ok: true, position: { unitPriceMicros: 14790000, quantityMilli: 1000, discountBp: 0, vatRateBp: 2000 } }
```

`positionAusEuro(item)` converts a euro line (`unitPrice`, `quantity`,
`vatRate`, `discountPct`) into this form without loss, or names the field and
the reason when that is not possible. Since 23 September 2026 the server
calculates every new invoice with this core. In **gross mode** the gross amount
per rate is the agreed price: net = round(gross × 100 / (100 + rate)),
VAT = gross − net. In **net mode** the VAT per rate is rounded from the net
sum. Rounding is commercial (half a cent rounds away from zero). Totals are
positive for credit notes too; the sign is in the document type
(`docType: 'GU'`). Test cases: `fixtures/rechnung-rechnen.json`,
`fixtures/rechnung-rechnen-zufall.json`, `fixtures/position-aus-euro.json`.

**`rechnungSummen` is deprecated.** The older helper in `…/rechnung` works on
`unitPriceCents` lines with the previous floating-point formula and does not
run through the core. At half-cent boundaries it can differ from an invoice
issued today by one cent per VAT rate, and by a few cents across several
rates. Example: € 21.35 net at 10 % gives € 23.48 gross with `rechnungSummen`,
but € 23.49 with the core and on the invoice. It stays unchanged for existing
callers; use `rechnungRechnen` or `previewInvoice` in new code. Test cases for
the old formula: `fixtures/rechnung-summen.json`.

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
when there is a function behind it, with
`{"status":"error","message":"Ungültiger Request: Authorization key erwartet."}`.
That is the proof: the call was accepted and authentication was checked. An
HTML page or a 404 proves that there is no function. That is why the script
looks for a `status` field and not for success.

It is deliberately outside `npm test` because it needs the network. Without a
network it says so and exits with 0. Calls that deliberately have no rewrite
under `/v1` (the register path via `kasse.kasseneck.at/api`, the calls with an
ID token) are listed with a reason in `scripts/erreichbarkeit-ausnahmen.json`.
If an exception becomes reachable, the check fails; otherwise the list would
never shrink.

## Contract files for the twin packages

This package is the source for the Dart package `kasseneck_api` and for
validators in the backend. Files in `fixtures/` ship in the tarball and state
in machine form what both sides agreed on, among them:

| File | Contents | Generated by |
|---|---|---|
| `kasse-settings-standard.json` | field names and defaults of the register settings | `npm run fixtures:kasse` |
| `oberflaeche.json` | call names, enum values, permission keys, key actions, partner lists | `npm run fixtures:oberflaeche` |
| `hobex-hps-codes.json` | measured HPS result codes, their meaning and whether they settle an outcome (the contract behind `isConclusive`) | `npm run fixtures:hobex-hps-codes` |
| `kasse-texte.json` | the register's message catalogue | `npm run fixtures:texte` |
| `rechnung-texte.json` | invoice texts in both languages | `npm run fixtures:rechnungstexte` |
| `rechnung-api.schema.json` | JSON Schema of the invoice API | `npm run fixtures:rechnung` |

They are generated and never edited by hand. CI regenerates the register
settings and `oberflaeche.json` and fails if they differ from the committed
files; the test suite checks the others against the code.

`oberflaeche.json`, `hobex-hps-codes.json`, `kasse-texte.json` and
`rechnung-texte.json` carry the package version. **After every `npm version`,
regenerate them and commit them along**, otherwise the tests fail.

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
