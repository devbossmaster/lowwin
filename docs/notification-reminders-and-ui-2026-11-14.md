# Notification reminders and compact Home UI — 14 November 2026

Implemented locally. No deployment, merge, live broadcast or live payment was performed.

## Notification behavior

- Auction closing reminders: 3 days, 2 days, 1 day and 12 hours. Their delivery windows do not overlap, so a delayed worker does not send four catch-up reminders together. The existing one-day delivery key is preserved.
- Upcoming auctions receive the one-day announcement. The former additional starting-soon delivery is retired.
- Published winner announcements contain the product title, winner name, phone masked with three middle asterisks, winning number, approved photo and result button. Unpublished settlement information stays private.
- Removed deliveries are suppressed at creation, expansion and dispatch; historical outbox and financial records remain intact. This includes the old Telegram Chapa payment/admin receipts and redundant no-winner, fallback, fulfillment and participant-result notices.
- Live auction rows have an owner-authorized Broadcast action. The compact composer requires Review then explicit Send. Reviewing never sends. Stop remains available; Repeat is removed.

## Delivery safety and preparation

Immutable broadcast preparation is cached for 60 seconds across worker batches; persistent Telegram file IDs remain reusable. Each actual HTTP attempt retains a fresh authoritative gate for ownership, lease, Stop, maintenance, recipient eligibility and relevant auction/result state. HTTP remains outside database transactions.

Concurrency remains four, including one personal lane; shared bot/bulk limits and Telegram retry-after handling remain in effect. Ambiguous HTTP outcomes retain uncertain acknowledgement evidence rather than claiming exactly-once delivery.

A deterministic 60-second model completed 720 mocked deliveries using one campaign-content read and 720 final gates. At cache expiry the next delivery performed a second content read and its own gate. This measures preparation reuse, not production sends per second or Telegram latency. No live throughput improvement is claimed.

## Ethiopian time

Visible auction, winner, notification, wallet and admin dates use `Africa/Addis_Ababa` (UTC+3). Countdown durations still use server-relative time.

Testing exposed a separate database-time issue: Prisma UTC values in timestamp-without-time-zone columns were being compared with session-local `clock_timestamp()` values. On an East African database session this shifted notification lease calculations by three hours. Lease writes/comparisons, final gates, media-upload leases and queue diagnostics now explicitly use UTC. Native timezone-aware activity timestamps retain their appropriate comparisons.

The database regression suite runs with `TimeZone=Africa/Addis_Ababa` and verifies claim expiry, renewal, queue counts, competing workers and uncertain send handling. No schema migration is needed.

## Visual changes

- Flat blue LowWin mark and versioned light-blue English/Amharic 1840×800 WebP banners; no satin background. Family, bicycle, luggage, boxed illustrative iPhone 18 Pro Max and PS5 Slim composition remains. Custom configured imagery is preserved.
- Banner actions stay small and overlay the bottom-left of the image without an extra background panel.
- The hammer shortcut uses full-width 1840×800 product images instead of tiny thumbnails, and opens the existing bidding sheet.
- Recent winners show the image, a single-line title and announcement date; full result details remain in Winners. Existing slow scrolling, pause and reduced-motion support remain.
- The wallet pill uses a blue background, white text and a horizontal amount/ETB/plus layout.
- The optional first-visit sheet invites users to `https://t.me/lowwinet` on the website and in Telegram. It does not grant account access or require channel membership.

## Validation actually completed

- 214 focused unit and behavior tests passed, zero failed.
- 24 isolated PostgreSQL delivery/lease and Telegram rate tests passed, zero failed. No production database was used.
- Production build passed: `node node_modules/next/dist/bin/next build --webpack`.
- TypeScript passed: `node node_modules/typescript/bin/tsc --noEmit --pretty false`. `git diff --check` passed (Windows line-ending warnings only).
- Browser component fixtures passed at 320, 360, 430 and 1280 pixels in English/Amharic for the compact Home components and auction shortcut. Banner overlays additionally passed at 640 pixels. Checks covered visible images, aspect ratio, overflow, touch targets, wallet actions, result navigation, channel link, Escape/close focus behavior and runtime errors.
- Admin composer fixtures passed at 360 and 1280 pixels for generic and auction promotions. Review produced no send; double-clicking Send produced one intercepted command. These were isolated fixtures, not live broadcasts.
- Local artifacts: `.local/nov14-unit-final.json`, `.local/nov14-delivery-final.json`, `.local/nov14-production-build-final.log`, and the `checks.json` files under `.local/compact-home-ui`, `.local/admin-broadcast-review`, `.local/banner-overlay-check`, `.local/auction-banner-layout` and `.local/brand-header-review`.

## Remaining external verification

The production authentication-operation failure is not established as fixed. Safe structured diagnostic codes were added without logging credentials, tokens, phone numbers, SQL or raw error messages. The corresponding production event is still needed to establish its cause.

Production worker revision/settings/replicas and real delivery latency were not reverified from this local workspace. When releasing, update WEB and the notification worker together; update any separate bot service serving the welcome/banner code. This update adds no required environment variable or database migration. Physical Telegram behavior and actual delivery throughput require a subsequent authorized production check.
