# Compact controls and full-bleed product photos

Category and sorting pills now look 34px tall while retaining 44px tap targets and readable 12px labels. Reduced row padding, heading margins and sorting-to-card spacing move the first live card about 45px higher. Horizontal scrolling and active-chip visibility are preserved.

The product photo fills the entire card width without the previous 10px inset. Titles, exact fees and actions retain their own interior padding. The image frame remains 2.3:1 with `object-fit: cover`.

Measured initial card visibility above the fixed navigation, using a two-line English title and loaded fonts:

| Browser viewport | Language | Before | After |
| --- | --- | --- | --- |
| 360 × 800 | English | 71.7% | 84.6% |
| 360 × 800 | Amharic | 73.6% | 87.1% |
| 430 × 932 | English | 100% | 100% |
| 430 × 932 | Amharic | 100% | 100% |

These are viewport-specific layout measurements; shorter WebViews and unusually long content can change the visible fraction. Safe-area clearance and existing header/banner content are retained.

## Product-image specification

Generate **1840 × 800px**, aspect ratio **2.3:1**. Keep the complete product in the central 80% and leave background around it for cropping. Export WebP, with no baked-in title, fee, countdown, badge or border. The generated headphones preview is approximately 125KB.

The shared photo is rendered across existing demo product placeholders by a server-enabled, read-only staging preview context. It applies to cards, galleries, result sheets, quick lists and wins without overwriting stored images or registered accounts. Uploaded media retains its own source; banner, logo and Telegram avatar are unaffected. The existing pinned staging capability excludes production and hosted deployments. The generated asset is on the exact public static-image allowlist, with private API authorization retained.

## Verification

Sixteen focused image-preview/staging-capability checks pass. Four optimized browser scenarios pass at 360px/430px, including both languages, at least 75% initial card visibility, image dimensions/coverage, 44px controls, authenticated navigation and the existing Learn More/bid/result flows. Anonymous image access returns 200; anonymous account access still returns 401. Typecheck passes in both checkouts and the optimized webpack build passes. No dependency or financial-rule change is included.

Screenshots: [360px before](screenshots/home-density/before-360-en.png), [360px after](screenshots/home-density/after-360-en.png), [430px English](screenshots/home-density/after-430-en.png), [430px Amharic](screenshots/home-density/after-430-am.png). [Raw geometry](timings/home-density).

## Separate local database interruption

The reported sign-in 503 spent 15 seconds in a failed Supabase connection attempt (`P1001`). PC-side probes found two shared-pooler IPv4 addresses reachable in roughly 240ms and a third timing out on both pooler ports. Independent DNS resolvers returned the same three addresses. Subsequent real queries succeeded on both ports: approximately 3.0–3.4 seconds for a cold read, and 1.37 seconds for a warm Session count. The project HTTP service responded and credentials matched; direct IPv6 was unavailable from this PC.

No database URL, credential, connection timeout, authentication gate or production configuration was changed. The intermittent network path remains an external issue if 503s recur. Both shared modes use the pooler hostname, so simply changing ports does not avoid the unreachable address. [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).
