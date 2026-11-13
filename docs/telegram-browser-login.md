# Website and Mini App Telegram login

Lowwin supports ordinary mobile/desktop browsers alongside the Telegram Mini App. Both paths resolve the same numeric Telegram identity and existing account; they do not create a separate wallet or link accounts by phone, username or email.

## Customer flow

In a browser, Login opens a compact Lowwin card. Continue with Telegram sends the browser to Telegram's own approval page and returns to the requested Lowwin page. Lowwin does not collect Telegram passwords, codes or wallet PINs. Existing registered accounts restore automatically from a valid session. New accounts need Telegram's signed verified-phone consent; refused or missing phone proof cannot unlock paid actions.

Inside the Mini App, Login retains the existing signed launch and native self-contact-sharing flow. The browser layout indicator is presentation only; API authorization remains server-enforced. Tablet/desktop browsers use a wider catalog and desktop navigation, while phone browsers and Telegram keep compact touch layouts.

## Official protocol

This uses Telegram's current OpenID Connect Authorization Code flow with S256 PKCE, not the archived iframe widget. The backend validates one-time browser-bound state/nonce, Telegram signature/JWKS, issuer, audience and token times. Telegram's signed profile `id` maps to the existing numeric Telegram account; its `sub` is a separate OIDC subject. Phone claims cannot merge accounts or silently replace an existing contact. Mini App and OIDC contact/session provenance remain explicit.

References: [Telegram Login](https://core.telegram.org/bots/telegram-login) and [OIDC discovery](https://oauth.telegram.org/.well-known/openid-configuration). Provider login is separate from payment authorization; existing payment verification, ownership, revocation and ledger rules still apply.

## Operator setup

Open **BotFather → the existing Lowwin bot → Login Widget**. Register both:

1. Website origin: `https://lowwin.shop`.
2. Exact callback: `https://lowwin.shop/api/auth/telegram/browser/callback`.

Use the actual canonical origin from `BETTER_AUTH_URL`; do not add a trailing slash on the callback or substitute a different domain. Register staging separately. Keep Telegram's default **RS256** algorithm, because this flow needs profile and phone scopes.

Save the provided credentials in the **WEB service's server environment**:

```dotenv
TELEGRAM_LOGIN_ENABLED=true
TELEGRAM_LOGIN_CLIENT_ID=<Client ID from BotFather>
TELEGRAM_LOGIN_CLIENT_SECRET=<Client Secret from BotFather>
```

These are separate from the bot token and Chapa credentials. Never put the secret in a public frontend variable, repository, chat or URL. Existing bot and Better Auth configuration remains required. Private browser requests use the existing secure session cookie.

Actual Telegram approval requires the registered origin/callback and provider credentials. An unconfigured login displays a clear unavailable state and keeps public browsing accessible; it cannot manufacture a session.

## Release and validation

The additive migration `202611130002_telegram_browser_login` records session and contact-proof provenance. It retains the existing Mini App defaults and does not copy balances or create another customer account. Apply pending migrations with the authorized schema-owner connection before running the new WEB/worker revision:

```sh
npm run db:migrate
npm run db:generate
npx --no-install tsx scripts/check-telegram-browser-login.ts --schema
```

The redacted readiness command makes no Telegram request and reads no customer records. `--schema` uses `DIRECT_URL`, falling back to `DATABASE_URL`, in a read-only transaction. The runtime role intentionally cannot read migration history; `migration-connection-required` means to run that operator check with the authorized migration connection, not to widen runtime permissions.

Local validation passed 161 authentication/session/security tests, including real isolated PostgreSQL cases, and nine readiness-command cases. Browser handoff and responsive checks are recorded in [the validation notes](nov13-visual-and-browser-validation.md). Actual Telegram approval still requires BotFather configuration and a physical/browser check against the registered origin. No production migration, provider login, live payment, merge or deployment was performed during implementation.
