# Shared Telegram authentication validation — November 14, 2026

## Implementation

- Published `better-auth-telegram` 3.2.2 and aligned Better Auth/core 1.7.17 replace the private compatibility fork and standalone browser OAuth protocol.
- Standard Better Auth social start/callback own OAuth state, browser binding, S256 PKCE, nonce, code exchange, JWKS verification and session cookies. The application keeps only its HTTP boundary, safe destinations, identity/contact policy and session provenance.
- Bot-created users missing a canonical provider account are repaired only after a valid signed numeric Mini App launch, inside the existing identity lock. Staff/foreign bindings fail closed. OIDC prepares its raw-sub binding before upstream lookup, retaining legacy records and existing wallets.
- Access/ID tokens and plaintext contact phones are not persisted by the new flow. Password/staff authentication, encrypted contact proof, private-query isolation and server payment reauthorization remain enforced.
- Login drafts last at most 15 minutes, remain tab/account scoped, exclude payment/auth evidence and never submit automatically. A failed handoff retry retains the same draft without extending its lifetime.

## Executed checks

| Check | Actual result |
| --- | --- |
| Isolated local PostgreSQL auth/session/contact/security regression run | 17 files, 229 tests passed |
| Final standard callback suite, including concurrent callbacks using one provider code | 24 tests passed; covers signed-token tampering, issuer/audience/nonce/expiry, missing cookie, replay, cancellation, malformed bodies, unsafe destinations, new registration, existing wallet and Mini App continuity |
| Final client/native/routing/resume regressions | 7 files, 114 tests passed; includes preserved-draft retries, unchanged TTL, account isolation, bounded requests and explicit consent |
| Full TypeScript check | Passed after dependency and browser-test updates |
| Final optimized production build | Passed after the preserved-draft retry correction; isolated output `.next-ui-chapa` |
| Dependency registry audit | Exit 0, zero known vulnerabilities; no advisory suppression |
| Production browser UI | 8 scenarios passed, 4 intentional duplicate-project skips; English/Amharic at 360/430/1280, registered-account restore and cancellation |

The test runs overlap; their counts are not an aggregate. The final production build includes the preserved-draft retry correction. Owned local test databases and the dedicated browser/PostgreSQL processes were cleaned up; the user's development server was not stopped.

Browser checks assert one cached configuration GET, one social POST only after Continue, one mocked approval navigation, no automatic payment/native contact request, hidden guest navigation, retained browsing and focus restoration. Provider HTTP uses synthetic fixtures; it cannot prove real Telegram acceptance or phone behavior.

The initial dependency transition exposed bot-created users without canonical provider bindings; the repaired contact/race tests pass. A first build found a test-only Window type assertion, which was corrected. The final TypeScript check passes. Prior production `invalid_client` remains an external acceptance check, not a claimed local success.

## Required operator change

Register `https://lowwin.shop/api/auth/callback/telegram-oidc` in BotFather, with trusted origin `https://lowwin.shop`, and keep RS256. Retain WEB's existing `TELEGRAM_LOGIN_ENABLED`, `TELEGRAM_LOGIN_CLIENT_ID`, `TELEGRAM_LOGIN_CLIENT_SECRET`, bot token, Better Auth secret and encrypted-contact keys. The readiness command now reports the upstream integration and new callback. No new migration is introduced; existing contact/session-provenance migration remains required.

No live authentication, payment, broadcast, production database change, merge or deployment was performed. See [setup](telegram-browser-login.md).
