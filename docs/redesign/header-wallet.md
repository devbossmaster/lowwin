# Lowwin header and wallet connection · 24 October 2026

The latest owner instruction restores the wallet display and provides a deposit destination for a later Chapa top-up integration. This supersedes the earlier wallet-retirement UI. Existing bid charging and financial commands are unchanged.

The header uses the existing logo and palette, the exact **Lowwin** spelling in black DM Sans, a balance pill with a separate gold plus, My Bids, the real notification count, English/Amharic controls, and the authenticated account avatar/name. Missing or failed photos use initials. Long names truncate while the full name remains accessible.

At 430px the controls fit in one row. At 360px the wallet sits above the account shortcuts, preserving readable type and 44px targets. Telegram and device safe-area padding remain in place.

`GET /api/wallet` reads only the authenticated user's available/held ledger projections. It never initializes or changes a wallet. The header shares the existing private cache, financial mutation invalidation, visibility refresh and wallet-update event; errors show an unavailable value rather than a fabricated zero. Amounts use exact decimal/BigInt formatting with two digits and an ETB suffix.

`/wallet` shows the actual balance. `/wallet/deposit` provides an authenticated, explicitly disabled top-up page for the future Chapa connection. The server advertises top-ups as unavailable. No provider is enabled and no payment/credit command is added by this change.

Focused verification only: typecheck passed; 33 focused wallet/formatting/loading/retirement checks passed; the two header browser checks passed at 360px and 430px. Browser coverage uses real isolated local sessions and ledger balances, verifies balance refresh, notification counts, all header destinations, language keyboard controls, avatar failure, long names, unavailable balances and zero reconciliation drift. No full test suite or production deployment was run for this follow-up.

Screenshots: [360px](screenshots/header-wallet/header-360-en.png), [430px](screenshots/header-wallet/header-430-en.png), [Amharic](screenshots/header-wallet/header-360-am.png), [initials fallback](screenshots/header-wallet/header-430-fallback.png).
