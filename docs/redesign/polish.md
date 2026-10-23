# Header, action color and loading refinement

The 23 October follow-up uses the customer's final muted-gold reference for ordinary primary actions. The intermediate orange direction was superseded. Payment initiation, fee confirmation and payment-status primary actions remain near-black with white labels. Standard actions use `#c9a227` with dark labels; hover uses `#b48e1d`. The measured text contrast is 7.35:1 and 5.78:1 respectively.

The header retains the existing Lowin logo and functional auction, notification and language controls. Smaller 15–18px icons sit within 44px minimum touch targets. The auction shortcut is a compact labeled pill; notification counts stay inside the target. The language menu shows full language names, supports arrow/Home/End keys and Escape, and restores focus after selection. The notification sheet restores focus to the bell.

Customer skeletons are replaced by one conventional spinner and concise English/Amharic loading text. Private request errors still show Retry, background refresh keeps existing readable data, and Telegram/contact deadlines remain bounded. Admin loading is unchanged. Route fallbacks no longer import or mount inert copies of private pages.

The running workstation checkout had an older static-asset allowlist: the new hero and fonts redirected to Telegram. Its exact allowlist was aligned with the reviewed branch without opening protected API prefixes. The hero requests the supported image quality. The actual local server then returned 200 for the hero, optimized image and all five new font files. The optimized 640px response observed 31,921 bytes; the original hero is 103,880 bytes. These are asset-response observations, not production launch or p95 measurements.

## Captures

All captures use a disposable loopback database, synthetic Telegram identity and an explicitly mocked unread count of seven. They contain no real customer or payment data.

| View | 360px | 430px |
| --- | --- | --- |
| Home and header, English | [Capture](screenshots/polish/home-360-en.png) | [Capture](screenshots/polish/home-430-en.png) |
| Home and header, Amharic | [Capture](screenshots/polish/home-360-am.png) | [Capture](screenshots/polish/home-430-am.png) |
| Language menu and keyboard focus | [Capture](screenshots/polish/language-360-en.png) | [Capture](screenshots/polish/language-430-en.png) |
| Plain profile loading | [Capture](screenshots/polish/profile-loading-360-en.png) | [Capture](screenshots/polish/profile-loading-430-en.png) |

Compare the preceding [360px header](screenshots/after/home-360-en-viewport.png) and [430px header](screenshots/after/home-430-en-viewport.png). The current captures retain an empty auction catalog rather than inventing customer inventory.

## Verification

- Both final mobile browser checks passed: actual banner/font responses, 44px targets, no horizontal overflow, language keyboard selection, auction drawer, notification-sheet focus restoration and plain profile loading. Browser page errors were empty.
- The focused proxy, loading, private-cache, authentication-client and native-contact watchdog checks passed (44 tests). The final loading suite separately passed all 13 cases, including failure/retry, existing-data refresh, localization and verification gating.
- Computed Chromium styles confirmed three ordinary actions use gold/dark colors and five payment actions use black/white colors (17.79:1 payment contrast).
- Impeccable's header and loading detector checks returned no findings. TypeScript passed in both checkouts, and the optimized Next.js 16.4.2 webpack build passed.

Physical Android/iOS Telegram WebView behavior remains a device-verification boundary. No production deployment, database change, payment activation or real charge was performed for this refinement.
