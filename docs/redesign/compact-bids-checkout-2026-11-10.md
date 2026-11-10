# Compact My Bids and bid checkout

## My Bids countdown

My Bids explicitly selects the plain inline countdown variant. English uses `2d04:18:09`; Amharic uses `2ቀ04:18:09`. A small existing clock icon accompanies one text node with tabular numerals, a reserved minimum width and no wrapping. The accessible timer label spells out the units. No flap, tile, unit-label or animation elements mount in this variant. Other countdown callers retain their original four-unit variants.

The server receipt anchor, monotonic elapsed clock, visibility/offscreen pause, immediate foreground recovery and one elapsed callback per target remain in use. Zero produces the localized ended state. The timer never submits a bid or infers a winner. Duplicate rows share the existing batched private-list invalidation.

### Local before/after evidence

Production builds were compared in installed Microsoft Edge with the same synthetic two-day deadline, two rows, viewport sizes and locale. Each sample lasted 5.2 seconds after fonts were ready. Measurements are in `test-results/inline-countdown/{before,after}/`; screenshots cover English and Amharic at 320, 360 and 430 pixels.

| Measurement | Before | After |
| --- | ---: | ---: |
| Descendant elements per timer | 32 | 0 |
| Timer DOM mutations per sample | 35 | 10 |
| English timer height | 28.80 px | 15.39 px |
| Amharic timer height | 33.19 px | 15.39 px |
| Style recalculations per sample | 89–96 | 5–7 |
| API requests during sample | 0 | 0 |
| Countdown layout shifts | 0 | 0 |

Every after sample kept identical timer width and height across ticks. Row height fell by 13.41 pixels in English and 17.79 pixels in Amharic. Script duration was 15.28–24.12 ms before and 4.51–11.94 ms after; these individual local CPU samples are indicative, not a production performance guarantee.

Seven browser cases passed: all six width/locale combinations and a mocked-clock lifecycle covering device wall-clock skew, hidden-tab pause, foreground recovery, nonnegative expiry and one batched expiry refresh across duplicate rows. Two additional viewport copies of that shared lifecycle were intentionally skipped.

## Two-step bid checkout

The same native dialog stays mounted through draft entry, payment selection and payment progress. Step 1 keeps the product thumbnail/title, amount field, Add control, removable numbers, count, per-bid fee and total. Continue commits a valid still-typed value through the existing whole-draft validator exactly once. It cannot debit the wallet or initialize a provider payment.

Step 2 prepares an immutable server quote, displays any changed total before Pay, and requires an explicit supported method. Wallet displays the real available balance and is disabled when insufficient. External methods use the existing registered-contact response as editable payment-only prefill, retain provider-specific phone validation and make no registration-verification claim. Back and Edit preserve numbers, method and phone. The original query readers stay mounted while changing steps.

Only the final Pay action calls the existing wallet or Chapa direct integration. The existing native focus trap changes presentation to a compact centered status modal. It retains the provider-requested OTP form, truthful connecting/authorization/confirmation/accepted states and the original shared polling loop. Provider success alone remains confirming until accepted-bid receipt evidence arrives.

Dismissal preserves an unresolved direct operation and its reviewed quote in the account-scoped memory cache, including a response lost before an order ID exists. Unknown restoration data stays unknown instead of displaying a zero total. Interrupted wallet results preserve the same immutable quote ID/hash for reconciliation through the existing wallet endpoint. These private mementos clear with the account cache; no new browser storage or financial endpoint was added. Terminal retry checks the owned order again before returning to the preserved payment selection.

The checkout browser round and final optimized-build confirmation each passed nine cases, with six intentional copies skipped outside 360 pixels: all six width/locale combinations, authoritative quote changes and terminal retry, a lost direct response with same-key recovery, and interrupted wallet recovery with the same quote ID/hash. Confirmation also checks the explicit Continue to payment / Pay total and bid copy, and changed-quote arithmetic: two bids at the authoritative ETB 12.00 per-bid fee display ETB 24.00 before Pay. Screenshots are under `test-results/checkout-steps/`. Seventy-eight focused unit cases passed across countdown, draft validation, phone rules, receipt-driven progress and account-scoped recovery.

All evidence is local, with disposable loopback database fixtures and mocked payment responses. It does not establish production deployment, a real Chapa charge or physical Telegram keyboard behavior.
