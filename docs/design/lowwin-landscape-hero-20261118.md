# Landscape hero on every screen — 18 November 2026

The Home hero now uses the existing wide family-at-home photograph on mobile, Telegram and desktop. Every layout uses 1840:880 proportions, making the banner 10% taller while retaining edge-to-edge image coverage. Compact layouts retain a left headline and a row of touch-friendly actions. The full family and packed PS5/iPhone remain visible. Desktop keeps its wide composition and visible explanation.

The approved short headline and supporting line are visibly overlaid in English and Amharic at every size. How it works? opens the tutorial sheet; Winners links to /winners. The complete number/refund explanation remains visible in How bidding works. Custom administrator artwork URLs are preserved. The prior portrait asset remains public for cached clients, and configured built-in portrait URLs resolve to the wide version.

The loading skeleton follows the same proportions. Explicit frame height, cover fitting and removal of the tablet mask prevent letterboxing at every width. Cover fitting crops a small amount of the quiet left background while preserving the family and gadgets. This change creates no new artwork and adds no migration or environment setting. Deployment scope is the web service.

39 focused unit tests and TypeScript checking passed. Fourteen Chromium composition checks covered English and Amharic at 320, 360, 430, 640, 1024 and 1280px plus a compact Mini App frame in a wide window. All were landscape with unclipped text and touch targets of at least 44px. Six checks in the running Next.js app passed image decoding, HTTP 200 artwork access, landscape geometry, both actions and focus restoration. The local runtime used an unreachable loopback fixture database and wrote no records.

Validation evidence is in docs/screenshots/landscape-family-hero-20261118, including [phone English](../screenshots/landscape-family-hero-20261118/live/430-en.png) and [phone Amharic](../screenshots/landscape-family-hero-20261118/live/320-am.png). No production deployment is established by these local checks.
