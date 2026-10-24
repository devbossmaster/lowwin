# Lowwin header and wallet connection · 24 October 2026

The latest owner instruction restores the wallet display and provides a deposit destination for a later Chapa top-up integration. This supersedes the earlier wallet-retirement UI. Existing bid charging and financial commands are unchanged.

The header uses the existing logo and palette, compact DM Sans controls, a balance pill with a separate gold plus, My Bids, the real notification count, English/Amharic controls, and the authenticated account avatar/name. Telegram’s signed `photo_url` is retained after HMAC verification and synchronized for the same contact-verified user on first and resumed launches. Missing, invalid or failed photos use initials; a later launch without a photo clears the old stored image. Account identities, display names and session binding are preserved. See [Telegram’s photo and validation contract](https://core.telegram.org/bots/webapps#webappuser). Long names truncate while the full name remains accessible.

The header is a single horizontal row at both 360px and 430px, with the logo only and 44px targets. Icon centers share the same baseline; the small profile name sits below its avatar. Telegram and device safe-area padding remain in place.

`GET /api/wallet` reads only the authenticated user's available/held ledger projections. It never initializes or changes a wallet. The header shares the existing private cache, financial mutation invalidation, visibility refresh and wallet-update event; errors show an unavailable value rather than a fabricated zero. Amounts use exact decimal/BigInt formatting with two digits and an ETB suffix.

`/wallet` shows the actual balance. `/wallet/deposit` provides an authenticated, explicitly disabled top-up page for the future Chapa connection. The server advertises top-ups as unavailable. No provider is enabled and no payment/credit command is added by this change.

Latest focused verification: typecheck passed; 57 focused unit checks and 8 real-database Telegram entry checks passed; the two header browser checks passed at 360px and 430px. The browser check asserts that every control is centered on one row and the avatar reaches the database from signed launch data, without manually seeding a stored image. Browser coverage uses real isolated local sessions and ledger balances, verifies balance refresh, notification counts, all header destinations, language keyboard controls, avatar failure, long names, unavailable balances and zero reconciliation drift. No full test suite or production deployment was run for this follow-up.

The avatar URLs and images in the captures are synthetic local fixtures; no real customer photo was accessed.

Screenshots: [360px](screenshots/header-wallet/header-360-en.png), [430px](screenshots/header-wallet/header-430-en.png), [Amharic](screenshots/header-wallet/header-360-am.png), [initials fallback](screenshots/header-wallet/header-430-fallback.png).
