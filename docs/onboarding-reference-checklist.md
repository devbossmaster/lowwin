# Post-Phase-6 mobile reference checklist

All 23 embedded screenshot pages in the supplied PDF were opened at native resolution. The ReportLab PDF's original RGB images were losslessly decoded into ignored `.local/ui-references/`; none are application assets or committed references.

| PDF pages | Route/component | Required adaptation |
|---|---|---|
| 1 | Home/header | Search before compact hero; visible Auctions, points, bell and profile; lowest-unique point example and lime browse action. |
| 2 | Home categories | Nine illustrated category targets directly after hero; compact horizontal rail; Animals honestly empty. |
| 3-5 | Category | Identity, Active/Upcoming/Closed counts, image-led sections and empty states. |
| 6-9 | Featured/list/detail | Large product image, status, fee, code, countdown, favorite, navigation to bid review; upcoming and closed cannot bid. |
| 10-11 | Home ending/results | Ending within 24 hours then actual outcomes; differentiated settled/pending/cancelled states. |
| 12-14 | Winners | Real result count, search/category/sort/pagination, image/code/date/points; anonymous winners, no phone fragments. |
| 15 | Home explanation/FAQ | Three real steps, rules and support; no copied testimonials. |
| 16-17 | Profile | Mobile activity counts, touch-friendly entries and safe display-name editing; no desktop sidebar or referrals. |
| 18 | My Bids | Own image-led activity, amount/status/date, current/history and detail links. |
| 19 | My Wins | Real settled wins and honest fulfillment state; useful empty alternative. |
| 20 | Alerts | Read/unread, timestamps, mark-one/all and real unread bell count. |
| 21-23 | Wallet | Large AVAILABLE/HELD points, funding choices, configured receiver/copy, separate ETB quote, input/upload/review/fallback, support and journal. No payable fixture accounts outside isolated tests. |

Direction: operate-first Telegram Mini App, white canvas, dark readable type, distinctly lime primary controls, restrained green accents, five bottom tabs and safe areas. Admin retains its separate existing design. Reference branding, assets, identities, currency wallet labels and live uniqueness/activity claims are excluded.

Baseline gaps observed in source: plain-text category grid; no main hero browse CTA or three-step block; auction cards omit fee/countdown/favorite/action; search placed after hero copy; dark-green buttons; wallet funding structure works but needs consistent lime treatment. Existing financial/domain behavior is the baseline, not an invitation to replace it.

Staging preflight: matching configured Supabase project fingerprint identified, but its three migration names belong to a different website-auth chain. No staging mutations are permitted while that conflict remains. Initial 503 configuration defect: MINI_APP_URL absent despite TELEGRAM_PUBLIC_URL being configured. Evidence and final outcomes will be recorded in the integrated report.
