# Wallet and Chapa payment sheets: UI only

The user deferred merchant credentials and explicitly requested UI only. Bid sheets now show the real product, current server fee/range/step, bid count, countdown and remaining submissions. The Wallet option displays the authenticated available balance; Chapa is a separate radio choice. Top up sits beside Wallet and opens a nested sheet. The gold header plus opens the same sheet. The existing `/wallet/deposit` deep link remains a usable standalone form.

Top up has a decimal ETB input, 100/250/500/1,000 ETB presets, current balance and Chapa selection. Both payment actions are deliberately disabled with clear availability copy. No Chapa API adapter, payment initialization, wallet debit/credit, new bid command, schema migration, dependency or funding flag is added. Existing ArifPay/history/recovery services remain intact; the new visible bid sheet is not a production payment path.

The final sizing follows the user's latest correction: sheets fit their content rather than being fixed to half height. The collapsed bid and top-up forms show all primary controls without internal scrolling at 360×800 and 430×932 in both languages, retaining at least 48px of background. The bottom action stays visible. Long expanded terms and smaller keyboard viewports can scroll; an active-input viewport reduction adapts the available height and keeps the input visible. Other account/result/Learn More sheets retain their default sizing.

V4 input is a bid number, not an ETB charge. Only the disclosed submission fee is described as payable. Older terms remain read-only and their original details remain accessible. Unknown wallet values are not converted to a fake zero. No unsupported withdrawal policy, successful payment, winner, or configured payment channel is invented.

## Current verification

Both checkout typechecks and 19 focused loading/wallet checks pass. Four final development-browser scenarios pass across 360px/430px, including English/Amharic. They cover full form visibility, number/range feedback, payment selection, presets/custom amounts, nested Escape/Back/focus restoration, header plus, deposit deep link, avatar/unread/balance updates and simulated keyboard resizing. The UI checks record zero bid/payment POSTs, zero submitted bids and unchanged test balances; loopback reconciliation is clean. Four Learn More delayed-chunk cases also passed during this follow-up. A full build and physical Android/iOS Telegram checks were not rerun for this UI-only change.

## Review captures

| | 360px English | 360px Amharic | 430px English | 430px Amharic |
| --- | --- | --- | --- | --- |
| Bid | [View](screenshots/bid-wallet-chapa/bid-360-en.png) | [View](screenshots/bid-wallet-chapa/bid-360-am.png) | [View](screenshots/bid-wallet-chapa/bid-430-en.png) | [View](screenshots/bid-wallet-chapa/bid-430-am.png) |
| Top up | [View](screenshots/bid-wallet-chapa/top-up-360-en.png) | [View](screenshots/bid-wallet-chapa/top-up-360-am.png) | [View](screenshots/bid-wallet-chapa/top-up-430-en.png) | [View](screenshots/bid-wallet-chapa/top-up-430-am.png) |

## Later gateway connection

Use Lowwin's own selection/amount UI followed by Chapa's hosted checkout. The server should create the immutable payment reference and expected amount, then verify merchant-key status, amount, currency, reference and mode before any idempotent ledger action. A return URL or webhook alone must not credit funds. Merchant test credentials, an approved wallet-bid command path, verified webhook/recovery behavior, ledger tests and separate production activation review remain future work. [Initialize/hosted checkout](https://developer.chapa.co/integrations/accept-payments), [transaction verification](https://developer.chapa.co/integrations/verify-payments), [webhook verification and idempotency](https://developer.chapa.co/integrations/webhooks).

No production database, customer record, published auction term or deployment was changed.
