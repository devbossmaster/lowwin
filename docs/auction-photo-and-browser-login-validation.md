# Auction photos, Bid dock and browser sign-in

## Changes

- The auction Bid dock now uses the visible customer navigation height. Guests and desktop browsers have no reserved mobile-navigation gap; registered mobile users retain the existing navigation and safe areas.
- Public catalog media authorization now recognizes images saved in an auction's public presentation, as well as original product images. This fixes an uploaded correction being visible to staff but returning 404 for visitors. Winner photos and banners retain their separate consent checks and private caching.
- The presentation editor keeps staged images through background query updates. Upload is followed by explicit **Save public corrections**; **Use as cover** moves an image to the first position. Removing the currently selected gallery image resets the gallery safely.
- Open auction details observe the existing batched activity revision and reload product details once when a newer correction appears. There is no new polling loop or per-second product request.
- Browser-login rejection logs identify the failing boundary using fixed codes. Logs contain no authorization codes, state, cookies, tokens, profile claims, phone numbers or raw provider/database errors. User-facing errors remain generic; state, nonce, PKCE, RS256, ownership and single-use challenge validation remain enforced.

## Local verification

- Authentication: 167 tests passed in 13 files against a separate disposable loopback PostgreSQL database; includes official browser-flow fixtures, Mini App contact sharing, account isolation and payment-session authorization.
- Browser protocol/request/client tests: 80 passed, including rejection diagnostics and sensitive-data exclusion.
- Media: 27 tests passed for public replacement renditions, warm caching, private previews, consent and winner-media rejection.
- Auction activity, correction refresh, catalog preview and winner privacy: 43 tests passed against a separate disposable loopback PostgreSQL database.
- Actual-component Chrome fixtures: 320/360/430/1280px, guest/account states; eight dock/gallery cases passed without page overflow. Replacement images decoded and the selected gallery item reset after removal.
- Actual AdminWorkspace/AdminImageUpload fixture: upload alone did not publish; staging survived a query update; cover ordering and one explicit save used the correct image order.
- Actual AuctionDetail correction fixture: one newer revision produced one reload and the new image; repeated revisions and failed reloads produced no request loop, and a later revision recovered. No browser errors occurred.
- TypeScript, whitespace validation and the isolated production build passed. The build reported a webpack pack-cache snapshot warning but completed successfully; no live payment services were enabled for it.
- Browser checks use intercepted fixture requests and synthetic images. They do not prove a deployed edit or physical Telegram webview behavior.

## Production browser-login status

The operator's read-only report confirms configuration and migration `202611130002_telegram_browser_login` are ready, including both session/contact constraints. This rules out missing settings or that migration as the reported cause. It does **not** prove a successful callback.

After the updated WEB is deployed, reproduce one fresh browser login and inspect the WEB log event `telegram_browser_login_rejected`. Share only that event's `stage`, `code`, `diagnostic` and `databaseCode`. Do not share callback URLs containing codes/state, tokens or cookies. The current production rejection cannot be identified from the generic screenshot alone; no validation has been weakened to bypass it.

This update adds no database migration or new environment variable. It was not merged or deployed and made no live payments or notification sends.

## Current notification inventory

Source inventory: **9 Telegram bot notification kinds** and **12 Mini App notification kinds**. This is implementation coverage, not a production-delivery or preference check.

| Notification | Bot | Mini App |
| --- | --- | --- |
| New auction published | Yes | Yes |
| Opens within 24 hours | Yes | Yes |
| Opens within 1 hour | Yes | Yes |
| Ends within 24 hours | Yes | Yes |
| Result published | Yes | Yes |
| Legacy/manual/admin deposit credited | Yes | Hidden |
| Verified Chapa payment receipt | Yes | Separate credit notice below |
| Contact registration confirmed | Yes | No |
| Admin broadcast | Yes | No |
| Bid accepted | No | Yes |
| Participant result ready | No | Yes |
| Winning result | No | Yes |
| First-accepted-lowest fallback win | No | Yes |
| No-winner result under applicable older rules | No | Yes |
| Delivery updated | No | Yes |
| Verified Chapa wallet credit/preserved funds | Receipt above | Yes |

The optional merchant payment alert is a recipient variant of the Chapa receipt. `/start` welcome and `/help` are interactive replies, excluded from the nine. Template-only legacy kinds are excluded. Sources: notifications/campaigns.ts, dispatch.ts, service.ts, chapa-receipt.ts, participant-results.ts, payments/chapa.ts and api/alerts/route.ts.
