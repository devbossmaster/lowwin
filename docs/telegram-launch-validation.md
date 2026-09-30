# Telegram launch bootstrap — 2026-09-28

Telegram startup now returns contact status and the minimal account payload in the sign-in response, replacing the sequential sign-in, contact and account requests. A fresh signed launch for the same live Telegram-bound session reuses that session. Account refresh retains its route-level authorization and avoids repeating it in the proxy.

Raw initData signature, freshness, origin, stored Telegram identity, staff exclusion and contact revocation checks remain enforced. Private responses are not cached; session tokens stay in HttpOnly cookies. Concurrent client sign-ins are suppressed. The browser timeout now covers the server's existing pool-wait and transaction limits instead of aborting after 12 seconds.

## Focused validation

- `node node_modules/typescript/bin/tsc --noEmit` passed.
- `tests/security.test.ts` and `tests/mini-auth-client.test.ts`: 28 passed, including a delayed response beyond the former 12-second timeout and no automatic retry loops.
- `tests/telegram-entry.test.ts`, `tests/own-contact.test.ts` and `tests/local-identity.test.ts`: 45 passed against an isolated loopback PostgreSQL database. Cases cover forged/stale data, cookie identity mismatch, unbound/revoked sessions, revoked contacts and secure-cookie behavior. Test quotas are isolated without changing production rate limits.
- The pinned-plugin concurrency case in `tests/database.test.ts` passed; the other 13 cases were deliberately excluded from this focused run.

No real Telegram WebView launch or production latency measurement is included in these results. Database and tunnel connectivity remain external prerequisites.

## Recovery controls — 2026-10-01

Rejected launches now explain that reopening from the bot is required, without offering another sign-in using the same rejected launch. Temporary failures retain Retry connection and add Reload app, which reloads the document while preserving its query and Telegram launch fragment. Reloading cannot renew expired signed launch data. Server authentication and session rules are unchanged.

Bot links use Telegram's `openTelegramLink` followed by `close` from the user click. [Telegram's API](https://core.telegram.org/bots/webapps#initializing-mini-apps) no longer closes Mini Apps when opening a Telegram link. Ordinary browsers retain the normal link; the recovery screen explains manual closing if the native client leaves it visible. SDK presentation failures cannot leave sign-in locked, and a late SDK launch is checked after an earlier request finishes.

Focused regression commands: `node node_modules/vitest/vitest.mjs run tests/mini-auth-client.test.ts tests/telegram-recovery.test.ts` and `node node_modules/@playwright/test/cli.js test --config=playwright.recovery.config.ts`. The browser suite uses mocked Telegram/auth responses and an unavailable loopback test database; it makes no real bot requests. Native Android/iOS handoff still requires a device check after deployment.
