---
name: Lowin mobile system
description: A pure-white Telegram Mini App with lime actions, dark ink and quiet green gradients.
colors:
  background: "#FFFFFF"
  foreground: "#172720"
  primary: "#A3E635"
  primary-hover: "#92D427"
  support-green: "#157A55"
  mini-focus: "#416C0D"
  mini-disabled: "#E6ECDF"
  mini-disabled-ink: "#53604C"
  mini-nav-selected: "#EFF8E4"
  mini-nav-ink: "#315711"
  forest: "#103C30"
  mint: "#E5F4EB"
  border: "#DBE7DE"
  muted: "#54665C"
  outer-canvas: "#FFFFFF"
  white: "#FFFFFF"
  admin-green: "#184D3A"
  admin-ink: "#20392E"
  admin-muted: "#526257"
  admin-line: "#DCE2D9"
  admin-field-border: "#A5B5A8"
  admin-sidebar: "#EAF0E7"
  admin-nav-hover: "#DBE6D7"
  admin-table-head: "#EDF2E9"
  admin-focus: "#BC8B34"
  admin-danger: "#953C30"
  admin-error-bg: "#FFF3ED"
  admin-error-text: "#7E3025"
  admin-notice-bg: "#EEF4E8"
  admin-notice-text: "#284A32"
typography:
  display:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.13
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "15px"
    lineHeight: 1.6
  admin-title:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "32px"
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  admin-body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "15px"
    lineHeight: 1.55
rounded:
  admin-control: "8px"
  admin-field: "7px"
  control: "12px"
  identity: "14px"
  feature: "16px"
  account-row: "13px"
  saved-control: "10px"
  profile-field: "8px"
spacing:
  small: "8px"
  medium: "16px"
  inset-compact: "20px"
  inset: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.mini-disabled}"
    textColor: "{colors.mini-disabled-ink}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
  button-outline-hover:
    backgroundColor: "{colors.mint}"
  result-card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.identity}"
    padding: "10px"
  result-summary:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.white}"
    rounded: "{rounded.identity}"
    padding: "23px"
  personal-bid-row:
    backgroundColor: "{colors.white}"
    textColor: "{colors.forest}"
    rounded: "{rounded.account-row}"
    padding: "15px"
  personal-tab-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.saved-control}"
  favorite-saved:
    backgroundColor: "{colors.mint}"
    rounded: "{rounded.saved-control}"
    padding: "9px 14px"
  admin-button:
    backgroundColor: "{colors.admin-green}"
    textColor: "{colors.white}"
    rounded: "{rounded.admin-control}"
    padding: "10px 18px"
  admin-button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.admin-green}"
    rounded: "{rounded.admin-control}"
    padding: "10px 18px"
  admin-button-danger:
    backgroundColor: "{colors.admin-danger}"
    textColor: "{colors.white}"
    rounded: "{rounded.admin-control}"
    padding: "10px 18px"
  admin-panel:
    backgroundColor: "{colors.white}"
    textColor: "{colors.admin-ink}"
    rounded: "{rounded.control}"
    padding: "25px"
  admin-field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.admin-ink}"
    rounded: "{rounded.admin-field}"
    padding: "11px 12px"
  profile-wallet:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.white}"
    rounded: "{rounded.identity}"
    padding: "22px 20px"
  payment-method-selected:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.forest}"
    rounded: "{rounded.identity}"
    padding: "16px"
  payment-details:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.identity}"
    padding: "20px"
---

# Design System: Lowin mobile system

## Overview

The current Mini App direction is pure white, flat surfaces, lime primary actions with dark ink, and quiet pale-green gradients on selected feature panels. Forest and supporting green remain in text, links, status accents and selected account panels; administration retains its separate forest-green system. Check.et is a structural reference for clear sections and practical controls, not an additional palette or component source. This refresh records the implementation in the player and administration stylesheets; it supersedes the original off-white canvas direction.

The interface uses compact typography, restrained borders and clear account states. The lowercase text wordmark is replaceable. The Phase 1 foundation needed no product imagery; later catalog surfaces use inventory imagery and explicitly labelled original DEMO illustrations. No surface needs invented inventory or decorative live statistics.

**Key characteristics:**
- Pure-white canvas and flat, quietly bordered surfaces.
- Lime actions with dark ink, pale selected states and restrained green supporting accents.
- A phone-width player experience and a separate operational staff workspace.

Phase 4B extends this incumbent system with public results and private account activity. It reuses catalog imagery and the existing mobile shell; it does not establish a new visual identity. The Phase 1 statements above remain historical foundation context.

Phase 5A added a separate administration surface in Operate mode, with denser work queues and explicit forms. It now shares the pure-white canvas while retaining its scoped navigation, table and status colors. The mobile player guidance remains in force for player routes; the administration layout below is a scoped supplement, not a replacement identity. Its contract is `.impeccable/admin-brief.md`, with implementation in `src/app/admin/admin.css`, `admin-shell.tsx`, `admin-workspace.tsx` and `staff-login.tsx`. Phase 5B extended these patterns with a wallet funding preview, private alerts and operational tables. Phase 6 retains the same visual system for test-only funding and payment operations; its current behavior is recorded below.

## Colors

### Primary

Lime primary marks Mini App actions, selected catalog/personal tabs and the winning example; its label is dark ink. The semantic primary in this document maps to scoped `--mini-action`, not the legacy global `--color-primary`. Supporting green maps to that incumbent global token and remains on links, icons, payment selections and the shared Button utility. Forest anchors the wordmark, result summary and profile balance. Mint remains on verified identity, favorites and selected payment methods. Bottom navigation uses its distinct pale selected fill and darker green text. The home rule demonstration and wallet balance use the pale gradients recorded in the sidecar.

### Neutral

Pure white is the application surface, bottom navigation and outer canvas. Ink is the main text color, muted green-gray supports secondary copy, and soft borders separate rows and containers. The phone layout remains centered on wider screens without a contrasting off-white surround.

Keep the palette light. Dark mode is deferred. Lime is an action and selected-state accent, not the page background; retain dark ink on it. Gold is not a new brand accent.

Administration uses the admin-prefixed green and ink roles on the shared pure-white canvas. Pale green navigation and table headers separate operational areas; white panels and quiet borders retain the incumbent flat treatment. Rust identifies the cancellation action and errors, while restrained green notices report confirmed changes. Amber is reserved for the administration keyboard-focus outline, not a new brand accent. Status and consequence always have text labels.

## Typography

Use self-hosted DM Sans with a sans-serif fallback throughout. The 36px display role is for the home headline, limited to 13ch; other page titles use 34px. Standard section headings use the headline role, catalog headings use 22px and the How it works heading uses 25px. Auction titles use 19px at weight 600; compact item headings retain 15px.

Body copy uses the body role. Supporting copy generally uses 13–14px; small labels use 10–12px. Home introductory copy is limited to 32ch with a 1.6 line height. Point amounts and balances use tabular numerals. The header wordmark is 29px, weight 700, with tight tracking and a supporting-green terminal dot; entry and generic wordmarks retain their own sizes.

In the Phase 4B extension, result-row titles use 16px and outcome summaries use 27px. Profile names use 23px and wrap long values; available and held balances use 26px with tabular numerals. Personal bid amounts use 22px bold type, and linked account counts use 24px. These component roles supplement the existing hierarchy.

Administration uses the admin-title and admin-body roles. Section headings use 21px with 1.3 line height; table cells use 14px, headers and metadata 12px. Work-queue counts use 24px and tabular numerals; tables also use tabular numerals. The sidebar wordmark is 42px, while the desktop sign-in wordmark is 72px. Admin page titles reduce to 27px at the compact breakpoint.

## Layout

Center a single mobile canvas with a maximum width of 480px and minimum height of 100dvh. Preserve that phone layout on wide displays and profile subpages. Page insets normally use 24px, reducing to 20px at widths up to 370px. Home intro and catalog sections use 20px; the top bar uses 18px.

The existing Mini App Home is the in-Telegram landing surface. Keep its introductory content, catalog sections and actions within this shell. Outside Telegram, the domain presents the separate Continue with the bot entry screen; staff administration remains separate. Home section headings lead directly, without redundant decorative eyebrow labels.

The top bar contains the home wordmark, a compact Auctions link, wallet chip, alerts and profile. Persistent bottom navigation uses five equal columns and stays aligned with the canvas. Reserve 82px plus the bottom safe-area inset in the page so content can scroll clear of it. Top and bottom padding respect the larger of the browser safe-area inset and Telegram content-safe-area inset.

Utility links, pagination and icon targets generally use 44px, with explicit accessible labels on icon-only controls. Primary buttons and bottom-navigation targets have at least 48px height. Home starts with search, its short heading and rule example, followed by a full-width Browse auctions action and How it works link. Mobile checks cover 360px and 430px widths; these are validation sizes, not CSS breakpoints.

Categories form a horizontal, scroll-snapping strip of 112px-wide illustrated tiles. Auction lists are a single column with 20px gaps and full-width 1.5-ratio artwork. Result status links wrap within the mobile canvas. Result rows pair a fixed thumbnail (88px by 112px) with a shrinking text column; rows are separated by 12px. Personal bid rows use a 10px gap, favorites use a single column with 20px gaps, and profile counts use three equal columns. The private Live/History controls and full favorite toggle have a 46px minimum height; compact card favorites use a 44px width with the inherited 46px minimum height; pagination retains 44px targets. Journal rows keep signed point deltas aligned to the right.

### Administration supplement

The desktop shell is a two-column grid with a sticky, full-height navigation rail (226px) and a shrinking content column. Main content is centered within a maximum width of 1480px, with 42px top, 40px horizontal and 72px bottom padding. Panels group forms and reports; table containers scroll horizontally when needed. Forms use an 18px field gap and a 720px maximum width.

The saved draft editor places its form beside a 280–390px preview column with a 28px gap. At 1100px and below, the rail becomes 190px, main padding becomes 30px by 24px, and preview stacks below the editor. The preview itself remains at most 390px wide; it represents the saved draft and keeps bidding disabled.

At 650px and below, navigation becomes a normal-flow two-column link grid, main padding becomes 24px by 16px, paired fields and MFA step-up forms stack, and the sidebar footer is hidden. This is a compact fallback, not the player bottom-navigation shell. Sign-in uses a separate two-column composition up to 1100px wide, then collapses to one column at 650px. Administration controls generally have 44px minimum heights; inline text buttons have a 36px minimum height.

## Elevation & Depth

Surfaces are flat, without decorative shadows. Tonal contrast, thin borders and spacing define groups. Pale green gradients on the home rule demonstration and wallet summary softly group content; lime identifies the winning example and key actions. These selected gradients do not establish a gradient treatment for every card. Featured auctions reuse the image-led catalog card, with carousel controls below. The illustrative winning tile rises by 5px to reinforce its distinction.

Administration also stays flat: tinted navigation, table headers, thin borders and white panels provide separation without shadows. No additional motion vocabulary is established by the administration stylesheet.

## Shapes

Controls and active navigation use gently rounded corners from the control token. Identity panels use the identity radius, while feature and wallet panels use the feature radius. Small demonstration tiles use 10px corners. Wallet chips are pill-shaped; avatar and icon targets are circular. Borders are thin and quiet.

Administration panels reuse the control radius, with smaller admin-control corners for buttons, navigation and notices and admin-field corners for fields. Table containers use 10px corners and saved player previews use 16px. These scoped control proportions support the denser operational shell.

## Components

Mini App primary actions use lime with dark ink, a 48px minimum height, 12px radius, 12px by 20px padding, a semibold label and an 8px gap. Hover uses primary-hover; disabled actions use the muted disabled fill/ink and a not-allowed cursor. Bid actions retain their 11px radius and 13px bold label. Outline/shared Button variants retain soft borders, ink and mint hover; the shared Button utility still uses supporting green with white text for its default variant. This scoped distinction preserves existing identity and staff controls.

Mini App and Telegram entry focus uses a 2px mini-focus outline offset by 3px; the legacy shared utility has its own 4px offset. Mini App inputs and textareas use a mini-focus caret. Preserve the skip link and accessible names on icon-only controls. Motion is restrained: the loading indicator alternates over 1.2 seconds, and reduced-motion preferences disable animation and transitions.

The wallet chip shows a neutral Points label for guests and the authenticated available balance when present. Bottom navigation combines icons with labels: Home, Auctions, Winners, My Bids and Profile. The current route uses mini-nav-ink on mini-nav-selected and exposes its current-page state. Catalog and personal tabs use lime with dark ink for their selected states.

Identity panels distinguish loading, guest, reconnect/error and unavailable launch configuration. Verified identity appears in a compact mint line. Retry and Telegram launch actions appear only when applicable. Features outside Phase 1 use honest not-open states rather than populated mock content.

The home rule demonstration presents six amounts, 1 / 1 / 2 / 3 / 3 / 4, in equal columns and is explicitly labelled EXAMPLE ONLY. The unique minimum, 2, has lime fill and a check; duplicated amounts have crosses, and 4 is marked unique but higher. Supporting text explains the result so color alone does not convey the rule. This is an illustration, never a live auction statistic.

### Telegram onboarding and catalog refinement

The contact gate precedes Mini App navigation and content. It uses the white 440px entry column, wordmark, shield, short heading, privacy explanation and full-width lime Share my contact action. Native Telegram contact sharing is preferred; Share through the bot instead and Open the bot provide the fallback. Pending verification disables share actions and announces status. Cancellation closes the Mini App when supported and leaves an explanatory state; no points are promised for sharing contact. Only a verified own-contact response continues into Home. The launch loader uses a restrained 1.2-second progress indicator and a static reduced-motion state.

The app shell reserves the larger browser/Telegram top and bottom safe areas. The standalone entry/contact layout currently uses 32px vertical and 24px horizontal padding with the browser bottom safe-area inset; it does not inherit the shell's Telegram inset calculation.

Catalog cards are semantic articles with separate image/title links, readable category/status, code, entry fee, favorite control and timing. Live cards expose Place a bid; upcoming, pending and final states have their corresponding review links. The bid form has a labelled 55px-high amount row, inline errors, available balance, and a review step disclosing the entry fee and highest-bid hold before confirmation. The accepted private receipt is distinct from a public result. Detail headings lead directly without decorative category/result eyebrows; meaningful DEMO and status labels remain.

Auctions and Winners combine search, status tabs, labelled Category and Sort selects and Apply. Winners supports newest, oldest and item-name ordering, preserving search/status in its GET filter form. Fields wrap inside a quietly bordered 13px-radius filter group; outcomes retain anonymous identities, explicit pending/final status and truthful empty states. Search remains labelled independently of its placeholder. Forms and filters reuse white fields, readable labels and visible focus; do not infer authorization or successful financial execution from their appearance.

### Artwork and raster provenance

The catalog's local SVG illustrations are original Lowin DEMO assets, not product photography or evidence of prize ownership. `public/catalog/notebook.svg` depicts a notebook computer and `public/catalog/tote.svg` depicts a tote, matching the existing item titles. Category illustrations remain distinct from those product-specific images. Preserve DEMO labels and descriptive alt text; do not substitute unrelated art for an item's title.

The welcome graphic is authored in `public/catalog/lowin-welcome.svg` and rasterized with Sharp into the 1200 by 720 `public/catalog/lowin-welcome.png`. Its embedded PNG `tEXt` key `impeccable:prompt` records the original SVG source, white/lime treatment, six-number example, lowest unique 2, and absence of third-party assets or payment claims. It is a deterministic vector-to-raster export, not an image-model output; retain that truthful provenance when replacing or exporting it. These files are illustration sources, not supplied licensed product photographs.

### Phase 4B results and account components

Result cards are white, quietly bordered rows with catalog imagery, title, explicit outcome, EAT timestamp and a View outcome link. Result detail places a cropped image above a forest summary. Pending, winner, no-winner and cancelled outcomes use words, not color alone. An ended auction remains pending until settlement completes. Public results keep winners anonymous and omit participant histories. DEMO example and DEMO · settled test labels retain their distinct meanings.

The profile pairs a display name and optional bio with an Edit control, followed by a forest balance link and three linked counts. The white editor uses labelled fields with 16px input text and the profile-field radius; only private display name and bio are editable. Identity and contact information are separate. My Bids uses pressed-state Live/History controls and rows that distinguish the accepted amount, finality and fee treatment. My wins reuses result rows and states fulfillment pending; illustrative examples do not become personal wins.

The full favorite control combines a heart with explicit Save to favorites, Saved to favorites or Saving… text. Catalog cards use a compact heart button with Save to favorites / Remove from favorites accessible names. Saved state uses mint fill and a filled heart with aria-pressed; guest users get a sign-in link. Disable the control while saving and show a retryable error when persistence fails. Favorites reuse the catalog card with a wider image crop.

Private pages reuse identity, loading, empty and retry states. Personal query content is scoped to the current authenticated user and requested view; do not keep another user's content visible during identity or page changes. Empty states explain the next relevant action rather than inventing activity.

The point wallet begins directly with its page title. Its pale-green-gradient balance panel with dark ink leads into paginated journal rows with available and held deltas, timestamps and refresh/error states. Funding availability is described by the Phase 6 state below. Account counts, bid histories, favorites and wallet entries are private, server-derived content; notification and fulfillment copy must describe the actual recorded, unavailable or pending state.

### Phase 6 wallet funding and Telegram entry

The enabled test flow retains the two-column Telebirr/CBE selection with pressed-state semantics, green borders, mint fill and a selected check. TEST ONLY and Do not send real money remain visible. Receiving details use the existing white, quietly bordered panel and copy-status message. If funding is disabled, the Phase 5B preview remains: unconfigured or synthetic non-payable details, with disabled receipt controls.

The quote section shows an ETB amount, whole-point result, version, limits and terms before Accept quote & create request. Terms and supporting paragraphs are left-aligned with a readable 14px line; the amount field is at least 48px high. After request creation, the chosen method and amount are locked and the saved quote remains visible.

Receipt input offers text/reference/official URL/SMS or an available screenshot scan. The dashed image area is an active file control in the test flow, followed by an editable extracted reference and explicit review checkbox. Upload/scan progress is visible. A failed scan returns to manual reference entry with an explanatory status; editing the reference clears its reviewed state. The accepted receipt keeps the returned reference visible and disables input, upload, review and submission controls. Start another request resets the entry flow. The confirmed response refreshes the wallet and header balance; a failed header refresh has an explicit message. These are interface states, not evidence of production financial execution.

Funding activity uses the existing separated rows with textual verification and investigation states, method, amount, points, a short request identifier and support link. Eligible unfinished requests expose Continue. Empty, error and pagination states stay explicit.

The ordinary-domain entry is a white, vertically centered column, at most 440px wide, with 24px horizontal padding, the text wordmark, a compact headline and a full-width Continue with the bot action. Missing-link, loading and retry states use plain text. It does not present the player navigation or a browsable marketing/catalog shell. This entry screen is outside the Phase 6 payment finish-review scope.

### Phase 5B alerts

Your alerts uses dated, separated inbox rows with linked titles, bodies and explicit Mark read actions. Read titles use lighter weight; unread count and Mark all read remain separate from the list. Empty, loading and retryable error states use the existing private-page patterns. Notification preferences use labelled green checkboxes with comfortable row targets. The bell combines an accessible unread count with a compact badge, capped visually at 99+. Bot-message preferences explain the opt-in and private-chat requirement; a visual inbox does not prove external delivery.

### Phase 5A administration components

Navigation exposes Overview, Auctions, Products, Categories, Home & FAQ and Reconciliation, extended in Phase 5B with Users, Support, Results, Fulfillment, Wallets, Notifications, Jobs, Analytics, Audit, Team and Settings. The rail scrolls when its links exceed the viewport. The active route uses solid administration green with white text and `aria-current`; inactive links gain a pale green hover background. Sign-in and workspace are independent from the player shell. The sign-in form presents credentials, authenticator enrollment/challenge, recovery codes and reset states with visible labels and persistent inline messages. Its copy states that production email delivery is unavailable until configured.

Administration buttons use the admin-body size with semibold labels. Secondary actions have a quiet border and transparent background; destructive cancellation uses rust. Disabled actions reduce opacity and use a not-allowed cursor. Keyboard focus uses a 3px amber outline offset by 3px. The source establishes no distinct button hover color or animated button state. Inputs use white fill, a visible border and green caret; errors use `role="alert"` and confirmed notices use `role="status"`.

Work queues use semantic tables, explicit headings and a truthful empty state. Product and category editors pair inventory tables with labelled forms. Image attachment explains validation and attribution; Home & FAQ uses plain text fields and additional FAQ fieldsets. Reconciliation remains a read-only table, not a balance editor. These surfaces display server-derived data rather than decorative statistics.

Draft publication separates Save draft, publication preflight and Publish scheduled auction. Changing a draft clears the previous preflight and disables both preflight and publication until the changed draft is saved; an inline status explains this requirement. The saved phone-width preview remains labelled as unpublished, with bidding unavailable. Published inventory, schedules and point terms are presented as immutable facts rather than editable controls.

Cancellation first exposes affected participants, held points and fee refunds in a summary and table, followed by a reason, typed auction-code confirmation and fresh MFA step-up. The destructive action describes its refund consequence. Completed auctions offer participant movements, current wallet balances, balanced journal postings and expandable private decision proof. Financial success messages appear after the server confirms a change. Fulfillment remains explicitly pending when applicable.

Phase 5B operational lists retain semantic tables with explicit status/scope, details and actions, plus search, relevant status filters, record counts, pagination and truthful empty states. Filters wrap at smaller widths and table containers scroll horizontally. Team pairs its table with a labelled role/reason form and fresh-MFA control. Point-wallet inspection remains read-only, with journal links. Phase 6 payment investigation is a separate workspace described below. Private contacts, actions and notices must reflect server-authorized state.

This supplement records the implemented visual system and interaction labels. The Phase 5A visual review's ship disposition is limited to its scored fix scope, including the dirty-draft publication guard. Its ten baseline laptop/tablet captures and two dirty-editor captures are stored as `.impeccable/review/phase5a-*.png`. Phase 5B visual references are `docs/screenshots/phase5b-home-viewport-mobile-360.png`, `phase5b-home-viewport-mobile-430.png`, `phase5b-wallet-cbe-mobile-430.png`, `phase5b-alerts-mobile-360.png`, `phase5b-team-admin-laptop.png` and `phase5b-wallets-admin-tablet.png` in the same directory. Screenshots are visual evidence, not proof of production authentication, external delivery, receipt intake or financial execution. PRODUCT.md retains the historical Phase 1 scope with dated visual-direction and Telegram-only platform updates.

### Phase 6 payment administration

Top-ups reuses the staff shell, labelled search and status/case filters, semantic tables, record counts and pagination. Incident links use a responsive grid of quiet bordered items with prominent counts. Queue rows show short request IDs, method, verification, case and assigned operator; empty results say that no requests match.

Investigation detail separates the frozen quote, issuance record, redacted reference and verification timeline from case notes and actions. Text explains that resolving a case does not change its receipt or points. Configuration uses the existing labelled staff form, followed by a Setting / Current / Proposed review table and Publish reviewed version. Editing the form clears the review. The current/proposed table keeps changes readable at both laptop and tablet widths. Statement reconciliation includes the explicit No statement evidence recorded empty row and an appropriate next-step explanation.

The payment finish-review handoff records a ship disposition, all three requested fixes resolved and all sixteen payment captures valid. This is a visual-review disposition limited to those payment surfaces. References are the paired 360px/430px `phase6-wallet-quote`, `phase6-wallet-scan`, `phase6-wallet-fallback` and `phase6-wallet-receipt` captures, plus paired laptop/tablet `phase6-top-ups`, `phase6-payment-detail`, `phase6-payment-settings` and `phase6-payment-statements` captures under `docs/screenshots/`. The Telegram entry is outside that review. No financial, provider, security or production-release assurance follows from these captures.

## Do's and Don'ts

- Do preserve the pure-white canvas, lime Mini App actions with dark ink, visible focus, comfortable tap targets and Telegram safe areas.
- Do use typography, spacing and borders to establish hierarchy.
- Do keep authenticated balance displays tied to server data.
- Do label examples clearly and keep account and feature states truthful.
- Don't fabricate inventory, wallet activity or live counts to fill empty surfaces.
- Don't replace the phone canvas with a desktop dashboard layout.
- Don't treat the temporary text wordmark as a supplied final logo.
- Do distinguish pending results, final outcomes and the two DEMO provenance labels in result and account components.
- Do keep private display-profile edits separate from verified identity and contact details.
- Don't imply shipment, prize fulfillment, notification delivery or point funding through decorative status copy.
- Do keep Home as the Mini App landing surface and use its section headings without redundant decorative eyebrows.
- Do reserve green gradients for the selected implemented feature panels and keep surrounding surfaces flat.
- Do keep test-only funding labels, saved quotes, explicit reference review and accepted receipt states visible.
- Don't describe a preview, scan result or recorded test receipt as production payment availability.

- Do apply the administration supplement only to the separate staff workspace; preserve the player phone canvas.
- Do label saved previews, unsaved changes, immutable published terms and cancellation consequences explicitly.
- Do retain readable operational tables, labelled fields, persistent messages and visible administration keyboard focus.
- Don't imply production email delivery, financial success or fulfillment beyond the confirmed state.
