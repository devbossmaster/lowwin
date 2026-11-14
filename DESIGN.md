# Lowwin design system

The latest 13 November 2026 direction uses white/soft-gray surfaces and blue primary buttons, with self-hosted Inter variable for English and the existing Ethiopic font for Amharic. Preserve the Lowwin logo and banners. Current shared tokens live in [lowwin-brand.css](src/components/lowwin-brand.css). Historical release notes describe earlier designs, not the current visual specification.

## Visual direction

Use white cards, soft-gray surfaces, charcoal text and compact layouts with natural height. Blue is scoped to primary buttons; violet remains the brand accent for identity, selection and illustrations. Yellow/gold highlights deposit offers. Neutral secondary and red destructive actions remain distinct. The reference URL was blank in automated preview, so the user's explicit visual specification is the authority.

| Role | Value |
| --- | --- |
| Canvas / panel | #F2F2F7 / #FFFFFF |
| Action / hover / pressed / label | #2563EB / #1D4ED8 / #1E40AF / #FFFFFF |
| Retained brand accent | #6D4CFD |
| Ink / secondary text | #16202C / #657181 |
| Secondary text on gray | #5F6B7A |
| Quiet surface / line | #F2F2F7 / #E4E7EC |
| Disabled action / label | #DBE7FB / #52647F |
| Bonus accent / surface / ink | #FFCF66 / #FFF3C4 / #4B320D |

White on action blue is 5.17:1; secondary #657181 on white is 4.96:1. Gray surfaces use the slightly darker secondary token for 4.86:1. Selection needs an outline and checkmark, not color alone. Errors use concise text and a small icon; avoid decorative red frames. Keep visible focus.

## Typography and layout

Self-host Inter Latin variable (weights 100–900; body 400, actions/labels 600, headings 600–700) with existing unicode-ranged Noto Sans Ethiopic. Body text is 14–16px; action labels are 15px. Use tabular money/countdowns, slightly tighter English headings, normal Amharic tracking and sufficient Ethiopic line height. Compact navigation/metadata retain smaller readable sizes where necessary. Do not shrink text to force a layout.

Use the 4/8/12/16/24/32px spacing scale. Primary actions have a 48px minimum height, pill radius, 24px horizontal padding and an 8px icon gap. Keep icon-only controls practically touchable at 44px. Use 150ms transitions, subtle pressed feedback and reduced-motion support. Preserve rounded inputs, scrollable categories and readable wrapping at 320/360/430px. Keep safe-area padding, contained scrolling and keyboard-accessible actions.

Ordinary browsers additionally adapt to tablets and desktops: two catalog columns from 640px, persistent side navigation from 1024px, and three columns from 1280px within a bounded canvas. Telegram WebViews keep the compact Mini App layout even in a wide window. Desktop login is a compact centered card leading to Telegram's official approval page; Mini App Login retains self-contact sharing. Layout detection never supplies authentication proof.

Home uses a logo-free 16:9 mobile banner (1600×900), with the family and prizes against a deeper blue, glossy curved backdrop. Browser widths from 1024px use the matching, shallower 1840×800 composition. The Home skeleton follows the same breakpoints and uses brand-blue hero/wallet surfaces with neutral content placeholders. Keep the compact actions over the bottom-left of the image. Auction and other wide product imagery retain 1840×800 proportions. Preserve genuinely custom administrator banners. Home artwork is illustrative; its source and dimensions are recorded in [the provenance manifest](public/images/lowwin-home-16x9-20261114.provenance.json).

The official LowWin identity is the user-approved white folded L and white LOWWIN wordmark on royal blue, with blue bands and a blue handle tip on the white auction gavel. Use [the canonical master](docs/design/lowwin-ribbon-l-blue-20261114.webp); current optimized image URLs are centralized in `src/lib/brand.ts`. Compact headers show the L-and-gavel symbol at 22–30px, with “LowWin” beside it. Preserve the master by cropping its presentation through the shared BrandMark component. Do not repeat the logo in the banner. Compact painted controls keep 44px touch targets; balance and ETB stay horizontal. Home retains the illustrated How it works guide; Learn more opens the video-only sheet. Fit the vertical 9:16 video to the available viewport without cropping, and keep the unconfigured slot ready for a later upload. Load hosted video or the privacy-enhanced YouTube embed only after Play. Existing admin video settings accept a YouTube URL or an approved local hosted-video path.

## Shared checkout

Bid entry is a short first step: numbers, validation, chips, coupon/range tools and accurate submission-fee total. Continue prepares the authoritative quote without charging. Payment shows the summary, editable payer phone and supported external methods. Keep internal Lowwin Wallet separate. Only final explicit Pay may create a provider operation or debit the wallet.

Top-up uses an amount step with presets and a qualifying deposit-offer preview, then the same external selection/status presentation. Explain continuing below the bonus minimum inside the same sheet. Wallet cannot fund itself.

Use one compact processing/result surface. Show authorization only when accepted by the provider. Never collect a wallet PIN. Confirm success only after verified payment and completed bid acceptance or wallet credit. Unknown transport outcomes keep the original attempt. Terminal retry reconciles the original and restores the draft without charging automatically. Closing dismisses the UI without cancelling a provider request.

Bonus and deposited funds remain distinct. Show principal, actual bonus and total credit explicitly. Percent, minimum, cap, validity and offer end are server-configured. Do not promise a disabled, expired or unavailable offer.

## Interaction and administration

Reuse AccountSheet focus containment, Escape/Telegram Back, safe areas and focus restoration. Motion is purposeful and reduced-motion-aware. Lazy-load sheets, retain cached content and scope private queries to the account. Physical Telegram keyboard/USSD behavior remains a device check.

Follow [Master Guide Admin](docs/master-guide-admin.md): verified staff email plus current database-assigned admin role on pages and APIs. Retain compact tables, audit evidence, contained horizontal table scrolling, cache isolation and existing sidebar structure. Colors follow current tokens; authority and financial rules remain unchanged. Deposit controls live at /admin/bonus; enabling requires an explicit audited save.

## Truth and release boundary

Preserve frozen auction economics, ledger accounting, idempotency, verification and private result settlement until explicit publication. Never invent balances, payments, winner photos or provider-specific failures. Local checks do not prove deployment, production migrations or physical-phone delivery. See [November 13 release notes](docs/nov13-checkout-and-bonus-release.md).
