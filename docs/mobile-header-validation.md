# Mobile top navigation — 2026-09-28

Scope: only the Mini App top navigation. The bottom navigation, loading screen, identity/session checks, API routes and funding permissions were not changed.

## Implementation

- `src/components/mini-header.tsx`: the verified account's Telegram photo appears as a circular Profile link; a profile icon appears when no usable photo exists. Server account context supplies AVAILABLE ETB; separate plus links `/wallet#add-etb`; alerts links `/profile/alerts`; gavel links `/auctions`. Uses existing shadcn-style `Button` with `asChild`, Next links and Lucide icons. ETB remains the current ledger/display unit.
- `src/components/mini-header.module.css`: scoped emerald `#087F5B`, dark `#063D32`, highlight `#37C58B`, white surface, 44px targets, numeric alignment, focus states and Telegram/device safe areas. Large balances retain their complete accessible name/title while the visible number truncates to fit.
- `src/components/app-shell.tsx`: replaces only the header markup with `MiniHeader`.
- `src/components/alert-bell.tsx`: unread dot derives from `/api/alerts`, binds to the current user, clears on failed/invalid reads, aborts outstanding reads on user change, and retains existing refresh event and polling.
- `playwright.header.config.ts`, `tests/header-browser/header.spec.ts`: isolated focused browser checks.

Loading shows `Loading…`; guests show `Sign in`; missing balances show `Unavailable`. None substitutes zero. A real zero is shown as `0.00`. DEMO balances keep their label and display the amount. The plus only navigates; existing funding controls still decide availability.

The header has no logo. `/api/me` exposes only the signed-in user's stored image URL with its existing private no-store headers. The client accepts HTTPS photo URLs and falls back to the icon when missing or broken.

## Results

- `npm.cmd run typecheck`: passed.
- `npx.cmd playwright test --config=playwright.header.config.ts`: **8 passed, 0 skipped, 29.0 seconds**, clean exit, installed Chrome. Both 360×800 and 430×932.
- Current focused rerun: `npx.cmd playwright test tests/header-browser/header.spec.ts --config=playwright.header.config.ts` — **10 passed** at 360px and 430px. Assertions cover all five links, photo and fallback, keyboard focus, AVAILABLE rather than HELD, zero/DEMO/large/missing balances, loading/guest states, unread/zero/error notification responses, 44px targets, header overflow and Telegram safe-area spacing. The existing funding preview remains disabled after navigating from the plus.
- Browser account/alert/wallet responses are explicit deterministic fixtures; they are not live account or payment evidence. Real route transitions were exercised against an isolated local Next server on port 3112 with disposable loopback PostgreSQL. No staging migration or data change was made.
- Impeccable detector: five advisory findings (scoped mint colors, compact font sizes, pill radius versus older DESIGN.md). These are intentional header-only choices under the requested emerald/compact-pill brief; global design tokens remain untouched.
- `git diff --check` for changed tracked header sources: passed.

Impeccable context, polish and craft-floor guidance were applied. Taste was not found after searching installed skill and plugin folders; it was not used. Real Telegram phone/WebView verification and production build were not rerun for this scoped change.

## Screenshots

`docs/screenshots/header-{360,430}.png` — header close-up.

`docs/screenshots/header-context-{360,430}.png` — surrounding existing page.

`docs/screenshots/header-{loading,guest,unavailable,long-safe}-{360,430}.png` — state and safe-area captures. Main, long and unavailable captures were visually inspected at both representative widths/state combinations.
