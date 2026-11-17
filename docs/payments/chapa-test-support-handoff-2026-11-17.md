# Chapa TEST Inline support handoff

Prepared for operator review; no support message has been sent.

**Subsequent key update:** both dedicated TEST keys changed after the same-row attestation, screenshot and service checks described below. Those observations belong to the earlier pair. The updated pair also passed private method discovery and public service access, then a separate, newly committed v2 Inline Telebirr operation returned the same `400 INVALID_VALUE` / `payable not found`. It produced no authorization reference, receipt, credit or webhook. The original operation and the separate new-key diagnostic record are both retained. Confirm business ownership and operational Inline TEST availability for the **currently configured pair**, using Chapa's authenticated merchant channel without sharing keys here. See [new-key evidence](evidence/chapa-newpair-inline-test-2026-11-17.json).

The operator confirmed that `CHAPA_TEST_VALIDATION_PRIVATE_KEY` and `CHAPA_TEST_VALIDATION_PUBLIC_KEY` came from the same dashboard API-key row. The business name/ID has not been supplied. Both supported browser inventories returned no connected apps or browsers, so that relationship and TEST Inline activation could not be independently inspected.

Before the key update, the operator supplied a dashboard screenshot showing an Active row named `test` and an Inactive row named `Lowwin Test`. A local boolean-only comparison confirmed that the then-configured public key matched the Active row's visible prefix and not the Inactive row. The private value had TEST-private shape; both values had no surrounding whitespace. The screenshot masks private keys and does not identify the business, so private-pair ownership remained operator-attested. That read-only check performed no rotation or initialization. A later key update and separate operation are recorded above; changing keys alone has not resolved the missing Inline prerequisite.

New read-only evidence: the documented public-key `GET /v2/payments/html` returned HTTP 200, `HTML Checkout is running` (948.9 ms complete, one sample). The same GET without Authorization returned HTTP 401 `UNAUTHORIZED`, `Authorization header is required` (918.5 ms, one sample). The successful response exposes only service version/stage. This demonstrates configured-public-key service access and header enforcement; no invalid-key control, business identity or Inline availability is established. Its `production` stage describes the service, not a LIVE payment.

The retained original Telebirr TEST operation has two initialization HTTP calls: its original dispatch and one identical body/reference/idempotency diagnostic replay. Both returned HTTP 400 `INVALID_VALUE`; the replay supplied the safe message `payable not found`, null details and no available request ID. Private lookup returned HTTP 404 `NOT_FOUND`. It was not replayed with the updated keys. The explicitly separate updated-key operation has one rejected initialization; neither operation produced accepted payments, credits or webhooks. No LIVE request or real phone was used.

The payload matches the published Inline contract and API Playground collection. Private-key method discovery reports Telebirr, CBE Birr and M-Pesa enabled; the saved amount is within their limits. This proves discovery access, not operational Inline initialization.

Ask Chapa to return these explicit fields through its authenticated merchant support channel:

| Required reply | What would resolve the uncertainty |
| --- | --- |
| Business ID/name and TEST key-pair ownership | Confirm both configured key entries belong to that business; share no key values. |
| `Inline TEST enabled: yes/no` per method | Confirm actual TEST initialization availability for Telebirr, CBE Birr and M-Pesa. |
| `Payable prerequisite required: yes/no` | Explain exactly which business resource or configuration produces `payable not found`, and identify its documented setup requirement. |
| Documented simulator per method and Inline flow | Supply non-real test fixtures and any OTP/polling instructions. The published success simulator has a `09` prefix, while Lowwin's M-Pesa input requires `07`; no compatible documented substitute was found. |
| Original-reference recovery instruction | Confirm whether the original unaccepted operation can be reconciled/retried with its unchanged payload and key after the provider fix. Preserve its record. |

The merchant dashboard can show the selected business, TEST mode and paired API-key entries at **Settings → API Keys**. A visible enabled-method toggle establishes configuration only; Chapa must confirm any backend payable prerequisite and operational Inline TEST support. Keep keys masked and compare them to the dedicated local configuration privately. Share the retained merchant reference and timestamps only through the authenticated merchant channel; local references are in `.local/chapa-test-e2e-20261117-state.json`.

Evidence: [original diagnosis](evidence/chapa-test-inline-diagnosis-2026-11-17.json), [new binding/service checks](evidence/chapa-test-binding-availability-2026-11-17.json). Contracts: [dashboard/API-key setup](https://docs.chapa.global/docs/v2/getting-started), [HTML service check](https://docs.chapa.global/docs/v2/integrations/html-checkout), [Inline](https://docs.chapa.global/docs/v2/integrations/inline-js), [mobile TEST fixtures](https://docs.chapa.global/docs/v2/testing/testing-mobile).
