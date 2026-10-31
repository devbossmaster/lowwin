# Payment speed and notification audit

Confirmed payments reuse complete wallet accounts under the existing wallet/projection locks. Missing or incomplete wallets still use the original initialization path. Wallet bids read the existing immutable fee account instead of repeating account initialization. Provider HTTP stays outside financial transactions; authentication, ownership, maintenance barriers, idempotency, evidence matching, late-bid handling, referral redemption and ledger guards remain enforced.

The customer briefly observes server payment status every two seconds after opening or returning to a checkout, then returns to at least five-second intervals after 30 seconds. Hidden pages do not poll. Existing payment deadlines, failure backoff, non-overlap and terminal-state stopping remain. The server's provider lease/cooldown still controls actual Chapa requests. No balance or accepted bid is inferred from a redirect or timer. This retains [Chapa v2 server verification](https://docs.chapa.global/docs/v2/integrations/verify-payment).

## Local measurements

Disposable loopback PostgreSQL; three recorded warm samples after one warm-up. The mocked provider deliberately waits 40 ms to initialize and 30 ms to verify. These service measurements exclude HTTP authentication, real provider latency and production network round trips.

| Path | Database statements before → after | Local median before → after |
| --- | --- | --- |
| Wallet bid | 33 → 32 | 21.5 → 19.9 ms |
| Confirm wallet top-up | 33 → 24 | 57.6 → 52.4 ms |
| Confirm paid bid | 66 → 56 | 79.9 → 72.0 ms |
| Initialize top-up | 17 → 17 | 60.0 → 53.9 ms |
| Initialize bid payment | 22 → 22 | 67.5 → 68.9 ms |

Initialization was not optimized; its timing variation is not an improvement claim. Existing `Server-Timing` separates authentication, database work, initialization and verification for deployment measurements. The foreground status interval changes from five to two seconds briefly; this is not a promise that Chapa confirms a payment within two seconds.

## Telegram notification inventory

There are eight allowed delivery kinds, including five auction notices:

| Kind | Trigger |
| --- | --- |
| `AUCTION_PUBLISHED` | Admin publishes a listing, including an upcoming auction. Saving a draft does not announce it. |
| `AUCTION_UPCOMING` | More than one hour and less than 24 hours before bidding opens. |
| `AUCTION_STARTING_SOON` | At most one hour before bidding opens. |
| `AUCTION_ENDING` | A running auction has less than 24 hours left; deduplicated per schedule version. |
| `AUCTION_RESULT` | The settled result is manually published by an admin. |
| `DEPOSIT_CREDITED` | A verified legacy deposit or authorized admin wallet credit. |
| `CHAPA_PAYMENT_CONFIRMED` | Committed online top-up, accepted paid bid, or verified funds preserved in the wallet. The optional protected merchant recipient receives its own alert. |
| `BROADCAST` | An explicitly sent admin broadcast. |

Welcome/contact messages are separate bot flows. Private bid receipts and participant outcomes can remain in the Mini App inbox without creating additional Telegram categories.

Campaigns target eligible non-staff Telegram users at the recorded event cutoff. Delivery requires an existing, unblocked private bot chat. Unique campaign/recipient keys prevent duplicate jobs on scheduler or batch retries. The notification worker schedules once per minute and honors Telegram rate limits; delivery can take longer for large audiences. Telegram sends are not exactly-once across a send/commit crash ambiguity.

Auction photos now upload from approved immutable media bytes or a local product asset. They are prepared as JPEG without cropping, preserving the canonical 1840 × 800 banner ratio. Workers reuse prepared photos and bot-scoped Telegram file IDs. Missing/corrupt images fall back to the same readable text and Mini App button. Unsafe/private/unrelated image paths are rejected. Captions retain the actual product title, EAT schedule and one action; no generic banner substitutes for a product photo.

No migration or new environment variable is required. Deploy the same revision to WEB, Chapa and notification workers. Local financial and mocked Telegram checks do not establish actual production provider latency or phone delivery.
