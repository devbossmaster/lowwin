# Telegram token exchange audit — 15 November 2026

Production reported `AUTH_PROVIDER`, `TOKEN_EXCHANGE`, `invalid_client`. The owner confirmed the current Better Auth callback `https://lowwin.shop/api/auth/callback/telegram-oidc` is registered. Earlier database/schema readiness checks cannot establish Telegram client acceptance.

Read the complete supplied Telegram Login guide, the current [official guide](https://core.telegram.org/bots/telegram-login), the [upstream OIDC source](https://github.com/vcode-sh/better-auth-telegram/blob/main/src/oidc.ts), its OIDC/troubleshooting documentation and the installed Better Auth 1.7.17 / plugin 3.2.2 source. The existing adapter already supplies the documented body `client_id`; plugin initialization order correctly preserves that adapter.

The remaining request compatibility edge case is Basic credential encoding. Better Auth's generic strategy form-encodes each credential component before Base64, including `~`. Telegram documents Base64 of the raw `client_id:client_secret` pair. Updated the narrow request adapter to use that exact UTF-8 pair and a single authorization header through the existing core request helper. Ordinary URL-safe secrets are unchanged. This is a compatibility correction, not a demonstrated explanation for every prior production `invalid_client`.

Added `--request` to the operator check, reusing the exact request builder with synthetic code/PKCE and no HTTP. It exposes only versions, a public client ID/callback, a fixed profile and booleans. Optional `--compare-secret` reads the current BotFather secret through a non-echoing, history-free terminal prompt and compares it to WEB without displaying either value. It refuses noninteractive shells. The production rejection log can identify `telegram-basic-raw-v2` without printing secret request data. No authentication fallback, automatic second exchange, new OAuth implementation, schema migration, dependency update or account merge was introduced. Mini App signed launch/contact consent and all ID-token validation remain intact.

Actual verification:

- 109 tests passed across six focused suites, including the full disposable-PostgreSQL browser callback suite, signed Mini App continuity, existing wallet ownership, invalid tokens, callback replay, unsafe redirects and cancellation.
- Exact raw Basic request cases cover ordinary and special-character secrets, a single authorization header, required form fields and no automatic second exchange. Offline diagnostics were verified to make no fetch and expose no header/code/secret.
- Hidden prompt verified in a real local PTY with synthetic values: matching input returned `secretMatchesBotFather: true`; mismatched input returned false/exit 1; no entered characters were displayed. A piped/noninteractive invocation refused input.
- The diagnostic CLI was exercised with synthetic environment settings; package versions resolved to plugin 3.2.2 and Better Auth/core 1.7.17, all expected request booleans passed, secret absent from output.
- Typecheck and optimized production build passed. Build compiled in 52s, TypeScript completed in 35.9s and generated 38 static pages in 3.7s.

All provider responses in local tests are synthetic. Production login remains unconfirmed until a fresh real approval succeeds on the updated WEB revision. No live Telegram authentication request was made, and the isolated test database was removed.

Release this auth change on **WEB**. OIDC client credentials are needed only there; auction, notification and Chapa workers do not exchange browser login codes. Previous uncommitted notification changes are separate work and were retained.
