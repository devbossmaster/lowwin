# Lowin customer design system

The 22 October 2026 customer redesign replaces the prior green visual world. The user's 18 ordered references establish compact mobile rhythm, clear sheets and quiet surfaces; branding and product claims stay original to Lowin. The existing logo remains unchanged. Staff administration retains its separate operational styling and permissions.

## Direction

Mode: Operate. A customer should be able to find an auction, understand the real fee, submit a private number and return to an authoritative result. Use an image-led Home, compact horizontal category chips, single-column auction cards and native modal bottom sheets. The supplied reference direction takes precedence over Impeccable's generated alternate concepts. Code-led implementation; no design approval pause is required by the user's explicit authorization.

## Tokens

| Role | Value |
| --- | --- |
| Canvas | `#f5f4ef` |
| Panel | `#ffffff` |
| Ink / payment action | `#181815` |
| Standard primary action | `#c9a227` |
| Primary action label / icon | `#181815` |
| Primary action hover | `#b48e1d` |
| Secondary text | `#68665e` |
| Gold text | `#715719` |
| Gold accent / focus | `#987522` |
| Selected gold surface | `#e9e3d1` |
| Quiet line | `#e5e1d6` |
| Error | `#a03928` |

The 23 October 2026 user override makes ordinary customer primary actions muted gold with near-black labels and icons. Use `--mini-action: #c9a227`, `--mini-action-ink: #181815` and hover `#b48e1d`; contrast is 7.35:1 normally and 5.78:1 on hover. Gold continues to support focus, fees and result details. Quiet secondary controls and selected filters remain neutral. Payment initiation, fee confirmation and payment-status primary actions retain near-black with white labels (17.79:1). Mark shared payment buttons with `data-payment-action`; ArifPay primary buttons and the final bid confirmation keep their explicit payment styling. Status labels always include text. Cards have 16px corners, sheets 24px upper corners, compact controls pill-shaped. Avoid decorative shadows; the photographic banner carries the visual richness.

## Type

Self-host DM Sans Latin at 400/500/600/700 and a single variable Noto Sans Ethiopic WOFF2 covering 100–900. Both use swap. Ethiopic is unicode-ranged so an English view does not download an unused script. English body is 14px with 1.55–1.65 line height; Amharic uses approximately 1.65 for legibility. Page headings are 25–27px at 600–650; product titles 16–18px, supporting copy 12–13px, occasional secondary metadata 10–11px. Display/heading tracking stops at -.035em; Amharic tracking is zero. Monetary values and countdowns use tabular numerals. The included existing bold-only TTF and Poppins/Sora files remain for historical references but are not requested by the new customer font declarations.

## Layout and interaction

A centered 480px maximum canvas serves mobile WebViews and ordinary preview widths. Check 360px and 430px. Insets are 16–20px, list gaps 12–16px, section separation 22–28px. The white header contains the existing logo, hammer shortcut, notification bell and language control. The bottom bar contains Home, Draws, Auctions, My Bids and Profile; gold centered Auctions replaces the superseded Deposit action. All primary and icon controls provide at least 44px targets.

Browser and Telegram safe-area insets are respected at the top and bottom. Native dialog sheets provide focus containment, Escape/backdrop dismissal and focus restoration; sheet body scrolling remains independent. Keyboard/device behavior still requires physical Telegram validation. Motion is subtle and reduced-motion-aware. Learn More and bid sheets are code split; an optional configured YouTube player is mounted only after an explicit Watch action. The family banner is a 104KB original generated photographic asset with HTML copy and an illustrative label.

## Truth and safety

Each auction displays its frozen terms. V4 bid numbers have no currency charge; older auctions retain their own financial policy. No winner is inferred from an elapsed timer. Draws excludes illustrative/test announcements and uses finalized settlements for winners, with masked identity. No winning photos or stories are fabricated.

Private query snapshots are scoped to the authenticated session identity and invalidated after financial mutations. Direct ArifPay checkout is off until reviewed configuration is complete. Pending/needs-review states remain visible in wallet payment history. No optimistic acceptance or credit exists. Customer deposit creation is retired; historical evidence, verification workers and staff operations remain.

## Verification evidence

See `docs/redesign/` for screenshots, local measurements, comparison notes and release limitations. `docs/arifpay-checkout.md` specifies the provider contract, activation and recovery safeguards. These documents distinguish local verification from production and physical WebView evidence.
