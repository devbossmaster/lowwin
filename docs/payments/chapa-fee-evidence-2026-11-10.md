# Principal amount and Chapa fee evidence

## 35.00 ETB versus 35.88 ETB

The merchant confirmed that the extra amount is Chapa's 2.5% charge. The arithmetic is consistent: 35.00 × 2.5% = 0.875 ETB, which is 0.88 ETB rounded to the nearest cent; 35.00 + 0.88 = 35.88 ETB. That confirmation comes from the user, not a production account-settings or transaction lookup performed during this change. No live charge was initiated to reproduce it.

The inspected code sends **35.00 ETB as exactly 3500 cents**. `createDirectCheckout` persists that immutable principal. `dispatchDirectCheckout` passes the saved amount to `createChapaTransport.direct`, which serializes `amount: 3500` with ETB, merchant reference, selected payment method and payer phone. It does not add 88 cents, a fee rate, a fee-payer override or any PIN field.

This follows the [v2 direct initialization contract](https://docs.chapa.global/docs/v2/direct-charge/initiate-payment): its amount is integer cents. The [verification contract](https://docs.chapa.global/docs/v2/integrations/verify-payment) distinguishes the principal amount from Chapa's separately reported `service_fee`, also in cents. The documented direct response and payment-method catalog do not provide an authoritative pre-charge fee-payer/total quote. The [receipt guide](https://docs.chapa.global/docs/v2/integrations/payment-receipt) likewise lists amount and service fee separately. No rate or payer total is inferred from those APIs in the checkout UI.

Lowwin's payable amount remains the bid submission fee or requested wallet deposit. A provider-imposed payer surcharge must not become an extra Lowwin wallet credit. `verifyChapaCheckout` still requires its principal to equal the saved 3500 cents and stores the independently reported service fee for reconciliation. The ledger credit uses `order.amountCents`; there is no fee subtraction or relaxed amount comparison.

## Focused validation

`tests/chapa-fee-evidence.test.ts` passed all four cases with an isolated loopback PostgreSQL database and intercepted providers:

- The exact wire body contains 3500 cents and the same original idempotency key on retries, with no gross-up or PIN field.
- Diagnostic formatting separates principal, service fee and their arithmetic sum and omits payer/contact/secret fields. Their sum is not labelled as proven payer debit.
- Successful verification with principal 3500 and service fee 88 credits exactly 35.00 ETB. A second verification creates no second credit, and the fee remains separately recorded as 88 cents.
- Verification principal 3588 against the original 3500 intent remains `EVIDENCE_MISMATCH`, applies no credit and is never repaired by subtracting an assumed fee.

The existing read-only `scripts/check-chapa-checkout.ts` can now report these separate amount fields when used for a future diagnostic. Its optional provider operation remains a GET lookup; it does not initialize, authorize, fulfill, process webhooks or change balances. No production command was run here.
