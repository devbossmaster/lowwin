# Shared Telegram authentication

LowWin uses the published `better-auth-telegram@3.2.2` plugin with exact `better-auth` and `@better-auth/core` 1.7.17. This replaces the private Mini App compatibility fork and the separate browser OAuth implementation. Next.js, TanStack Query, the existing user/wallet tables and Better Auth sessions remain.

## Customer behavior

- Browse Home and auction details without sharing a contact. Protected actions open the compact sign-in sheet.
- Inside Telegram, the existing signed Mini App launch and explicit self-contact consent remain. The server validates the signature and five-minute launch age; SDK globals do not prove identity.
- In a website browser, Continue with Telegram calls Better Auth's `POST /api/auth/sign-in/social` with `provider: telegram-oidc`. Telegram returns to `GET /api/auth/callback/telegram-oidc`.
- Better Auth owns database-backed state, browser-binding cookies, S256 PKCE, nonce, code exchange and signed session cookies. The upstream plugin verifies Telegram's JWKS, issuer, audience, expiry and nonce. Browser-supplied ID-token login and manual account linking are disabled.
- Verified numeric Telegram ID identifies the existing user; opaque OIDC `sub` is stored separately as its provider account ID. The application mapper preserves encrypted contact proof and existing balances. It never merges accounts using phone, name or username. New users must consent to a verified phone; revoked contacts and conflicting/staff accounts are rejected.
- Editable bid/top-up drafts and a safe internal destination may survive the handoff for 15 minutes in tab-scoped storage. Phones, login credentials, provider tokens, quotes and payment keys are excluded. Restoration never submits a bid or payment.
- Cancellation and errors return to the sheet. No raw provider description is reflected. Closing keeps public browsing available.

The old `/api/auth/telegram/browser/start` and `/callback` routes, custom JWT verifier, custom OAuth challenge/cookie implementation and token-auth-method setting have been removed. Expired old callbacks must start a new login.

## BotFather and WEB settings

In **BotFather → the existing LowWin bot → Login Widget / OpenID Connect**, register:

1. Trusted origin: `https://lowwin.shop`
2. Redirect URI: `https://lowwin.shop/api/auth/callback/telegram-oidc`

The redirect changed. Register this exact new URI before testing the new WEB revision. Keep **RS256** selected so profile and phone claims are available. Mini App native contact sharing is independent of the retired iframe Login Widget.

Set these privately on **WEB only**:

```dotenv
BETTER_AUTH_URL=https://lowwin.shop
TELEGRAM_LOGIN_ENABLED=true
TELEGRAM_LOGIN_CLIENT_ID=<BotFather Client ID for the same bot>
TELEGRAM_LOGIN_CLIENT_SECRET=<BotFather OIDC Client Secret>
```

Retain the existing `BETTER_AUTH_SECRET`, `TELEGRAM_BOT_TOKEN`, bot username and encrypted-contact key configuration. Do not rotate the Better Auth secret as part of this update. The OIDC secret is separate from the bot token and payment keys. Workers do not perform browser OAuth. Remove the obsolete `TELEGRAM_LOGIN_TOKEN_AUTH_METHOD` setting if it was added.

The upstream provider uses the documented server-side Basic token exchange, with the installed Better Auth OAuth helper. No fallback exchanges or user credentials are sent from the browser. Provider access/ID tokens are not persisted: the verified mapper creates the owned identity binding before Better Auth's lookup, with account token updates disabled.

Readiness remains a redacted configuration/schema check, not a credential test:

```sh
npx --no-install tsx scripts/check-telegram-browser-login.ts --schema
```

Expected callback: `https://lowwin.shop/api/auth/callback/telegram-oidc`; expected integration: `better-auth-telegram`. Schema requires the existing `202611130002_telegram_browser_login` migration. This update adds no migration and never copies wallets. Apply pending migrations through the existing authorized migration connection only.

Keep canonical public Host routing at the reverse proxy and overwrite forwarded headers at the trusted edge. Conflicting Host/protocol headers and external callback destinations are rejected. Sessions remain HttpOnly, SameSite=Lax and Secure on HTTPS; private routes still perform server-side ownership/contact/expiry checks.

## Validation boundary

Local tests use disposable loopback PostgreSQL and synthetic signed JWTs; Telegram HTTP is mocked. No production migration, live provider login, payment, merge or deployment is performed. The previous production `invalid_client` means Telegram rejected the client credentials; switching libraries alone does not prove it is resolved. Test one fresh approval after the new callback and WEB revision are configured.

References: [official Telegram Login](https://core.telegram.org/bots/telegram-login), [Better Auth Telegram repository](https://github.com/vcode-sh/better-auth-telegram).
