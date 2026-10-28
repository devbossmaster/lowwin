# Mini App launch checks — 2026-10-28

Launch now shows one accessible spinner and a short localized loading message, without a logo. The same indicator covers cold Home data and contact checking; actionable error/recovery messages remain available. Earlier measurements below predate this final loading preference.

The Telegram SDK starts downloading and executing from the initial customer response, independently of hydration. Readiness listeners handle both an SDK that finished early and a late load; an unavailable SDK shows retry/reload controls. Staff routes do not load the SDK. The fixed 800ms wait and two-frame authenticated handoff delay were removed. Signed launch, session binding, contact verification and private-cache identity checks remain authoritative.

Contact/recovery UI loads when needed. The Telegram entry's referenced client chunks decreased from 89,863 to 52,289 raw bytes (30,517 to 17,605 gzip bytes), approximately 42%. This is the entry chunk graph, not the entire application bundle. The existing logo was resized to a 96px WebP: 5,880 bytes instead of the 209,462-byte PNG, reused for the 48px launch mark and 28px Home header mark. A resumed launch reuses only its fresh server-validated contact snapshot, avoiding one duplicate database read.

## Measurements and limits

Optimized webpack build, isolated PostgreSQL fixture, HTTPS loopback, Chrome; synthetic signed Telegram SDK response delayed 250ms. Single observations per width/connection, not production benchmarks. Slow connection uses CDP 150ms latency, 125KB/s download and 64KB/s upload. Home readiness means the navigation is visible; font completion is recorded separately.

| Viewport | Normal before / after | Slow before / after |
| --- | --- | --- |
| 360 × 800 | 1,145 / 565 ms | 3,895 / 4,025 ms |
| 430 × 932 | 566 / 578 ms | 3,888 / 3,894 ms |

The first baseline included cold server work; its normal-connection drop is not proof of a repeatable latency improvement. Slow-network Home latency remains approximately unchanged. Download reductions are confirmed; a substantial end-to-end launch speedup is not established by these samples. Actual Telegram CDN, production database latency, cold starts and physical Android/iOS behavior need deployment measurements.

## Validation

- Production webpack build and TypeScript checks passed.
- 139 targeted tests passed, including real local database launch/session/contact-revocation checks and synthetic Chapa contract/readiness checks.
- 16 browser cases passed across both widths: delayed/failed/late SDK, one sign-in/document/script, safe destination preservation, small logo, no visible launch copy, reduced motion, contact timeout/retry, keyboard focus and staff isolation.
- Design detector reported no findings on the scoped launch files.

No deployment, real provider call, payment activation or production database mutation was performed. The default Chapa readiness command is offline: `npx.cmd tsx scripts/check-chapa.ts`. Merchant TEST key, signed-webhook configuration and a reviewed test target remain setup steps; see [Chapa v2 setup](payments/chapa-v2.md).
