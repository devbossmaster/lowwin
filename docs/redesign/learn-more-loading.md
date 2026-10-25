# Learn More without a page-loading flash

Both Home entry points retain an explicit local empty loading boundary for the dynamically imported Learn More sheet. While its JavaScript downloads, the existing Home content, controls and navigation remain visible. Once ready, the existing bottom-sheet animation opens the complete explanation. Video stays behind Play and no loading spinner is inserted.

The installed Next.js dynamic loader only creates its own Suspense boundary when a loading callback is provided (or SSR is disabled). Previously, suspension reached the route's loading boundary. A `loading: () => null` callback isolates the sheet while preserving code splitting and SSR defaults.

Verification: typecheck passes in both checkouts; all 14 existing customer-loading tests pass. Four focused Chromium cases pass at 360×800 and 430×932 using English for the banner button and Amharic for the guide button. Each case holds the real on-demand script request, waits through React's delayed fallback, verifies Home stays visible with no spinner or dialog, releases the request, then verifies the explanation, no unsolicited player, Escape/Back dismissal, focus restoration and no horizontal overflow.

The first browser attempt was blocked because the disposable loopback PostgreSQL instance was stopped. After its normal recovery completed, all four cases passed. No hosted database, auth settings, dependencies or production configuration changed. This is a development-browser regression check; a production build and physical Telegram device checks were not rerun for this two-line behavior change.
