# Compact header, responsive banner and Telegram token request

The header presents the approved L-and-gavel symbol without its embedded wordmark, with LowWin alongside. The logo stays visually small while the Home link retains a 44px touch target. The original master remains intact. Built-in banners no longer repeat the logo; custom published banners are preserved.

Home keeps its 16:9 mobile artwork. Browser widths from 1024px use a separate 1840×800 export of the same glossy scene: at 1232px wide this reduces height from 693px to 536px. Actions remain over the artwork. The route skeleton uses identical aspect-ratio breakpoints, full desktop content width and blue hero/wallet surfaces. Product placeholders remain neutral.

## Browser sign-in investigation

Production operator checks returned database reachable and generated auth schema OK. These checks do not prove the token exchange, runtime grants, callback or credentials are correct.

The installed better-auth-telegram 3.2.2 calls Better Auth core 1.7.17's authorization-code helper with Basic authentication. That helper omits client_id from the request body in Basic mode. Telegram's [current token exchange example](https://core.telegram.org/bots/telegram-login#exchange-code-for-tokens) includes both Basic authentication and client_id in the form body. A regression test reproduces this installed-library behavior.

The narrow `telegramOIDCTokenRequest` compatibility plugin adds that public client ID through Better Auth's existing token helper. It preserves the upstream Telegram provider, signed token verification, PKCE, state, nonce, identity mapping and session handling. No independent OAuth implementation or global fetch override is introduced. HTTP 200 containing an OAuth error is still rejected. Mini App contact consent and signed initData validation are unchanged.

This corrects a documented request mismatch; a successful production login is still needed to establish whether it resolves the reported rejection. Authentication logs now retain allowlisted stages, OAuth rejection codes and database codes without printing messages, tokens or customer data.

Only WEB needs this code update. No new migration or new environment variable is introduced. BotFather must contain the callback reported by `scripts/check-telegram-browser-login.ts`: with the shared Better Auth integration it is `/api/auth/callback/telegram-oidc`, rather than the retired independent browser callback. Keep credentials private in WEB.

If sign-in still fails after WEB is updated, use its structured `authentication_operation_unavailable` event. The optional operator command `npx --no-install tsx scripts/check-auth-runtime.ts` checks the generated Prisma model, actual auth columns and necessary runtime grants without reading customer rows, writing sessions or contacting Telegram. It does not authenticate the client credentials.

## Actual validation

- 99 focused unit/render tests passed, including the installed-request omission, corrected token form, safe logging, banner localization/custom-media preservation, loading and navigation.
- 56 auth/security tests passed against a newly initialized loopback PostgreSQL fixture. These covered verified OIDC account creation, existing bot-account/wallet continuity, Mini App continuity, invalid signatures/claims, callback replay, cancellation and identity conflicts. The owned fixture database was dropped and its local server stopped afterward.
- 24 isolated header cases passed at 320, 360, 430 and 1280px, in English and Amharic, signed out and with ordinary/long balances. The balance and ETB remain horizontal; very long balances retain scrollable amount text and their full accessible label.
- 10 mobile/desktop banner cases passed, with one selected banner request per viewport, no extra bottom strip and working overlay actions. 20 skeleton cases passed, including desktop width, matching hero proportions and brand-blue hero/wallet surfaces.
- Typecheck and the optimized production webpack build passed. No production login, payment, migration, broadcast or deployment was performed.
