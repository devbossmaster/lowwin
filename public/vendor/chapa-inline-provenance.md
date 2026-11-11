# Chapa Inline v1 artifact

`chapa-inline-v1.c9e7f64f.js` is the unmodified browser script downloaded from
<https://js.chapa.co/v1/inline.js> on 2026-11-11, 13,912 bytes.

SHA-256: `c9e7f64f4f443bfa068cfc8d93bda9d160f5cb89bdb3501c74c3d66eacd1f27d`.
License: MIT, retained in `chapa-inline-LICENSE.txt`.

The inspected official source is <https://github.com/Chapa-Et/inline.js/blob/main/lib/inline.js>.
The CDN artifact exposes `window.ChapaCheckout`; it is not an ES-module default export.
The constructor supports `tx_ref`, `mobile`, `amount`, `currency`, and
`availablePaymentMethods`. `initialize(containerId)` renders the SDK's own Pay
button; the adapter clicks that button after the user's final explicit Pay.

The SDK has no `destroy` or abort API. It uses fixed document IDs and an internal
three-second validation loop. Lowwin runs one SDK instance in an isolated iframe
browsing context and removes that context on disposal, rather than inventing a
cleanup method. Callback hints trigger owned server reconciliation. Neither
success nor failure callback is authoritative payment evidence.

The downloaded artifact has no OTP collection flow. If a merchant requires a
provider flow not supported by this artifact, use the supported hosted branch;
do not implement undocumented private authorization requests or collect PINs.

Phone prefixes in the official source: telebirr 9; M-PESA 7; CBE Birr/eBirr 7 or 9.
An inconsistent M-PESA regex in the SDK accepts `2519` but rejects `2517`.
Lowwin validates the selected provider first and passes a normalized nine-digit
national number, avoiding that SDK bug and doubled country prefixes.
