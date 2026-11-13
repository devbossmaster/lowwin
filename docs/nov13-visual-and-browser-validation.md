# November 13 visual and browser update

The latest design uses white `#FFFFFF`, gray `#F2F2F7`, ink `#16202C` and secondary `#657181`. Primary buttons use blue `#2563EB`, hover `#1D4ED8`, pressed `#1E40AF` and white labels. Violet remains Lowwin's brand accent; selection, navigation and deposit-offer colors retain their meaning. Secondary controls are neutral and destructive actions remain red. The reference site rendered blank in automated preview; the user's explicit specification supplied the design authority.

Shared tokens and component styles cover the catalog, How bidding works, account pages, sheets, checkout, progress, administration and browser login. Primary actions use a 48px minimum height, pill radius, 24px horizontal padding, 8px gap and 15px/600 labels. Body text uses Inter 400 with the existing Ethiopic font for Amharic. English headings use restrained tracking; Amharic retains natural spacing and line height. Focus, disabled states, 150ms transitions and reduced motion remain supported.

Inter is self-hosted as one 48,256-byte Latin variable WOFF2, weights 100–900. Its OFL license and source/hash provenance are in `public/fonts/`. No external font request is needed. Banners retain 1840×800 WebP composition. White text on blue measures 5.17:1. Secondary text on white measures 4.96:1; the darker secondary-on-gray token measures 4.86:1.

Ordinary browsers support the same account and wallet through [official Telegram login](telegram-browser-login.md). Browser catalogs use two columns from 640px and three from 1280px. The latest requested layout removes the desktop sidebar: a horizontal top navigation appears from 1024px only after server-confirmed registration, a confirmed account and its scoped query identity. Guests, loading/error states and unverified contacts do not mount those navigation links. Actual Telegram WebViews retain the compact Mini App layout and native self-contact sharing. The main account header remains Home-only.

## Local validation

- 28 isolated responsive and interaction cases across Home, Wallet, Profile and Admin: 320/360/430px, English/Amharic, plus representative 1280px screens. No document overflow, clipped text, broken visible images, page errors or unexpected requests in those cases. An existing compact admin breadcrumb remains below 44px; primary controls meet the requested height.
- Twelve additional actual-component cases covered My Bids, Transactions and Winners at 320/430px in English/Amharic, with representative live/finished outcomes, published winners and credit/debit/checking/failed activity. No page overflow, clipped text, broken visible images, page errors or unexpected requests. Small transaction-chevron and long-balance action wrapping findings were corrected in CSS. An old admin primary-hover gold override and top-up placeholder contrast were also corrected.
- Inter 400/600/700 and Ethiopic glyph loading passed; only two local font files were requested.
- 57 modified/new CSS files parsed successfully; banner dimensions and embedded provenance checked.
- Impeccable component detector found no issues. The global detector reported the explicitly requested Inter font as overused; the user's pinned typography requirement takes precedence.
- Authentication/session/security: 161 tests passed. Payment/bonus regression: 711 tests across 38 files passed. Final proxy/client checks: 24 tests passed.

- One bounded correction pass fixed the wrapped hero action at 320px Amharic. Confirmation at 320px Amharic and 430px English passed; both hero actions fit without clipping.
- Focused transaction confirmation at 320px Amharic and 430px English passed after the CSS corrections: no row overhang, clipping, page overflow or image failures. The long-balance Top up action remained on one line and at least 48px tall.
- Enabled admin Save hover settled to the specified `#1D4ED8` with white text after the 150ms transition.
- Final full TypeScript check passed. Final optimized Next.js webpack production build passed. The build emitted non-blocking dependency-cache snapshot warnings; compilation, type validation and route generation completed.
- Production website suite: 14 passed, zero failed. Ten duplicate viewport executions of the same security cases were intentionally skipped; responsive/login checks ran in both languages at 320/360/430/768/1024/1280px. Account restoration and cancelled approval were also checked. An initial test assertion compared two equivalent URL encodings; it was corrected to validate the parsed same-origin destination, and the suite then passed.
- Production Mini App suite at 360px: all 15 passed, including bilingual method selection and top-up, truthful authorization beyond 90 seconds, interrupted initialization, preserved original attempts, cancellation, OTP, wallet-only payments, insufficient balance and Close/retry behavior.
- Redacted readiness command: nine cases passed against the isolated database. Read-only owner checks and sanitized runtime-role permission failure were both verified.

These checks use isolated local data and intercepted provider requests; they cannot establish live Telegram approval, USSD arrival, provider latency or production readiness. No merge, deploy or live payment was performed.

## Follow-up: authenticated top navigation and card counts

The sidebar gutter is removed for both guests and signed-in desktop browsers. The Home logo remains visible for guests; registered desktop accounts use the logo in the new navigation bar. Banner responsive-image sizes and Home skeleton geometry follow the wider content area. Main navigation keeps account-scoped remembered routes and intent-only prefetching. The server's signed session, expiry, Mini App/OIDC provenance, same-bot unrevoked contact and staff exclusion remain independent authorization checks; this presentation change does not grant account access.

Auction cards show the accepted bid total beside the submission fee using existing catalog/activity data, without an extra request. A valid zero is displayed as zero; an invalid/unavailable count is displayed as unavailable. The existing animated server-relative countdown is retained.

Latest focused check: **131 tests across nine files passed**; full-project TypeScript passed. Twenty bilingual guest/registered navigation-and-Home-header combinations passed at 320/430/1024/1280/1908px with actual self-hosted fonts and logo, without overlap, clipping, overflow or unexpected requests. Sixteen actual auction-card layouts passed at 320/360/430px and a representative desktop card width, including large fees and counts. These fixture checks do not prove production identity-provider configuration. The production website suite was not rerun for this follow-up.

The guide now uses three concise illustrated panels inspired by the user's supplied examples. Official unDraw Choose Card, Mobile Payments and Winner SVGs are self-hosted, recolored blue, lazy-loaded and decorative; they are not payment/winner evidence. Combined SVG size is 22,610 bytes. License and source hashes are in `public/images/how-it-works/`. A single viewport-triggered entrance disconnects its observer after entry and is disabled for reduced motion. Public asset access is limited to those three exact GET/HEAD paths; nearby private paths remain protected, with a proxy regression check.

Eight illustrated-guide layouts passed at 320/430/1024/1280px in English/Amharic, with no overflow, clipped text, broken illustrations, page errors or unexpected requests. Reduced-motion checks confirmed all three illustration animations disabled. The final optimized webpack production build passed, including compilation, TypeScript, page generation and traces; only the existing non-blocking dependency-cache snapshot warnings remained.

The user subsequently requested enabling browser OAuth. The local readiness check still reports missing BotFather Client ID/Client Secret; credentials and exact callback registration must be configured privately on WEB before enabling. No credentials, provider approval, production environment change or deployment was performed by the agent.
