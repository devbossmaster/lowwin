# Browser login and presentation validation

The earlier independent browser-OAuth implementation is superseded by the shared published Better Auth Telegram plugin. See [current setup and security boundaries](telegram-browser-login.md).

The operator's production diagnostics confirmed `invalid_client` after Telegram approval, despite settings/schema readiness. No successful live login has been verified. Configuration checks cannot establish that Telegram accepts the client credentials.

Current browser callback: `https://lowwin.shop/api/auth/callback/telegram-oidc`. BotFather must allow it before testing the updated WEB revision. Mini App login continues to use signed launch data and explicit native contact consent.

The application keeps canonical users, wallets, encrypted contact proof and legacy identity records. No account is merged by phone/name/username; the upstream opaque OIDC subject remains separate from numeric Telegram ID. The old standalone OAuth routes and private plugin fork are removed.

Existing mobile banner overlays and authorization typography refinements remain local changes. Their responsive rendering was checked at narrow phone and desktop widths in the previous UI pass. Auction imagery corrections and bidding/accounting rules are unchanged by the authentication migration.

Actual current authentication checks are recorded in [the focused validation report](telegram-shared-auth-validation.md). No merge, deployment or real provider payment was performed.
