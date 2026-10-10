---
name: Lowwin player and administration system
description: Separate player and staff layouts with black text on light surfaces and white text on solid forest green.
colors:
  background: "#FFFFFF"
  foreground: "#000000"
  primary: "#184d3a"
  primary-hover: "#123d2e"
  support-green: "#184d3a"
  mini-focus: "#184d3a"
  mini-disabled: "#dce8df"
  mini-disabled-ink: "#000000"
  mini-nav-selected: "#eef5f0"
  mini-nav-ink: "#000000"
  forest: "#184d3a"
  mint: "#E5F4EB"
  border: "#DBE7DE"
  muted: "#000000"
  outer-canvas: "#FFFFFF"
  white: "#FFFFFF"
  admin-green: "#184D3A"
  admin-ink: "#000000"
  admin-muted: "#000000"
  admin-line: "#E1E8E4"
  admin-canvas: "#F6F8F7"SSSASSS
  admin-selected: "#EAF3EE"
  admin-field-border: "#B7C7BE"
  admin-sidebar: "#FFFFFF"
  admin-nav-hover: "#F4F8F5"
  admin-table-head: "#F9FBFA"
  admin-focus: "#184D3A"
  admin-danger: "#953C30"
  admin-error-bg: "#FFF1EE"
  admin-error-text: "#000000"
  admin-notice-bg: "#EAF3EE"
  admin-notice-text: "#000000"
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
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  admin-body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "15px"
    lineHeight: 1.55
rounded:
  admin-control: "9px"
  admin-field: "8px"
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
    textColor: "{colors.white}"
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
    textColor: "{colors.foreground}"
    rounded: "{rounded.account-row}"
    padding: "15px"
  personal-tab-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
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
    backgroundColor: "{colors.white}"
    textColor: "{colors.admin-ink}"
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
    padding: "24px"
  admin-field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.admin-ink}"
    rounded: "{rounded.admin-field}"
    padding: "10px 12px"
  profile-wallet:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.white}"
    rounded: "{rounded.identity}"
    padding: "22px 20px"
  payment-method-selected:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.identity}"
    padding: "16px"
  payment-details:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.identity}"
    padding: "20px"
---

# Design System: Lowwin player and administration system

## Overview

The current Mini App direction is pure white, flat surfaces, forest green primary actions with white labels, and quiet pale-green gradients on selected feature panels. Black text applies to white and pale surfaces, including links, metadata and status labels; white text applies to solid forest surfaces. Player primary stays #184d3a and administration keeps its separate #184d3a. Check.et is a structural reference for clear sections and practical controls, not an additional palette or component source. This refresh records the implementation in the player and administration stylesheets; it supersedes the original off-white canvas direction.

The interface uses compact typography, restrained borders and clear account states. The lowercase text wordmark is replaceable. The Phase 1 foundation needed no product imagery; later catalog surfaces use inventory imagery and explicitly labelled original DEMO illustrations. No surface needs invented inventory or decorative live statistics.

**Key characteristics:**
- Pure-white canvas and flat, quietly bordered surfaces.
- Forest green actions with white labels, pale selected states and restrained green supporting accents.
- A phone-width player experience and a separate operational staff workspace.

Phase 4B extends this incumbent system with public results and private account activity. It reuses catalog imagery and the existing mobile shell; it does not establish a new visual identity. The Phase 1 statements above remain historical foundation context.

The full administration redesign implements the supplied `Lowwin_Admin_Dashboard_Concept.png` as a separate operational workspace. Its contract is `docs/admin-redesign-plan.md`; the scoped brief is `.impeccable/admin-brief.md`. White panels sit on a pale green canvas, with five primary business areas and separate Settings. Source, authorized records and current access determine content; the reference image supplies direction, never sample business data. Historical phase notes below retain their original scope and are not current release assurances.

## Colors

### Primary

Forest green primary marks Mini App actions, selected catalog/personal tabs and the winning example; its label is white. Both scoped `--mini-action` and Tailwind `--color-primary` use #184d3a. Shared buttons, links, icons and payment selections use the same forest green palette. Forest anchors the wordmark, result summary and profile balance. Mint remains on verified identity, favorites and selected payment methods. Bottom navigation uses its distinct pale selected fill with black text. The home rule demonstration and wallet balance use the pale gradients recorded in the sidecar.

### Neutral

Pure white is the application surface, bottom navigation and outer canvas. Black is the text color on white and pale surfaces, including secondary copy; hierarchy comes from size, weight and spacing. Soft borders separate rows and containers. The phone layout remains centered on wider screens without a contrasting off-white surround.

Keep the palette light. Dark mode is deferred. Forest green fills the header, hero, primary actions and selected states; use white text on solid forest green and black text on pale mint. Gold is not a new brand accent.

Administration uses its own forest action token, white sidebar and panels, pale canvas and selected navigation. Black text remains legible on every pale status and notice surface; white labels remain on forest and destructive solid actions. Focus uses the administration green. Status and consequence always have text labels.

## Typography

Use self-hosted DM Sans with a sans-serif fallback throughout. The 36px display role is for the home headline, limited to 13ch; other page titles use 34px. Standard section headings use the headline role, catalog headings use 22px and the How it works heading uses 25px. Auction titles use 19px at weight 600; compact item headings retain 15px.

Body copy uses the body role. Supporting copy generally uses 13–14px; small labels use 10–12px. Home introductory copy is limited to 32ch with a 1.6 line height. Point amounts and balances use tabular numerals. The header wordmark is 29px, weight 700, with tight tracking and a supporting-green terminal dot; entry and generic wordmarks retain their own sizes.

In the Phase 4B extension, result-row titles use 16px and outcome summaries use 27px. Profile names use 23px and wrap long values; available and held balances use 26px with tabular numerals. Personal bid amounts use 22px bold type, and linked account counts use 24px. These component roles supplement the existing hierarchy.

Administration uses DM Sans with Lowwin Ethiopic and sans-serif fallbacks. Titles are 32px/1.2, reducing to 28px at 700px. Section headings are 20px/1.35; body is 15px/1.55; buttons are 14px semibold; table cells are 13px, with 12px headers and metadata. Main metrics use 34px tabular numerals, reducing to 30px at 1200px. Sidebar wordmark is 40px and desktop sign-in wordmark is 64px.

## Layout

Center a single mobile canvas with a maximum width of 480px and minimum height of 100dvh. Preserve that phone layout on wide displays and profile subpages. Page insets normally use 24px, reducing to 20px at widths up to 370px. Home intro and catalog sections use 20px; the top bar uses 18px.

The existing Mini App Home is the in-Telegram landing surface. Keep its introductory content, catalog sections and actions within this shell. Outside Telegram, the domain presents the separate Continue with the bot entry screen; staff administration remains separate. Home section headings lead directly, without redundant decorative eyebrow labels.

The top bar contains the home wordmark, a compact Auctions link, wallet chip, alerts and profile. Persistent bottom navigation uses six equal columns and stays aligned with the canvas. Reserve the implemented 104px plus browser/Telegram bottom safe-area clearance. Home sets its app-frame bottom padding to zero and places that clearance inside the green footer, so no extra white gap follows the footer. Top and bottom padding respect the larger of the browser safe-area inset and Telegram content-safe-area inset.

Utility links, pagination and icon targets generally use 44px, with explicit accessible labels on icon-only controls. Primary buttons and bottom-navigation targets have at least 48px height. Home starts with search, its short heading and rule example, followed by a full-width Browse auctions action and How it works link. Mobile checks cover 360px and 430px widths; these are validation sizes, not CSS breakpoints.

Categories form a horizontal, scroll-snapping strip of 112px-wide illustrated tiles. Auction lists are a single column with 20px gaps and full-width 1.5-ratio artwork. Result status links wrap within the mobile canvas. Result rows pair a fixed thumbnail (88px by 112px) with a shrinking text column; rows are separated by 12px. Personal bid rows use a 10px gap, favorites use a single column with 20px gaps, and profile counts use three equal columns. The private Live/History controls and full favorite toggle have a 46px minimum height; compact card favorites use a 44px width with the inherited 46px minimum height; pagination retains 44px targets. Journal rows keep signed point deltas aligned to the right.

### Administration supplement

The desktop shell uses a 236px sticky, full-height white sidebar and a shrinking workspace. The 72px top bar contains breadcrumbs; contextual task tabs follow on white. Main content has a 1384px maximum width and 32px/32px/56px padding. The four-column metric row leads into a 1.75:1 overview queue and attention layout. Forms have an 800px maximum width and 20px field gaps. The editor uses a 1.5:1 form/preview split with a 24px gap.

At 1200px the overview columns stack and main padding becomes 28px by 24px. At 1000px the sidebar is 210px, metrics become two columns, and editor/preview stack; the preview is then at most 460px. At 700px the sidebar becomes a fixed drawer up to min(300px,88vw), metrics and paired forms stack, and main padding becomes 24px/16px/40px. The drawer moves focus inside, traps Tab, closes on Escape, close button, backdrop or route change, and restores trigger focus for explicit dismissal. It locks body scrolling while open.

Tables scroll inside their bordered container. At 700px and below they retain a 640px minimum width, normal cell wrapping and unbroken action labels; long first-column identifiers may wrap anywhere within a 170px minimum cell. Context tabs scroll horizontally. Controls, inline text actions and language buttons have at least 44px targets. The compact top bar reserves 155px for language controls. The independent sign-in composition collapses at 700px. None of these staff layouts replaces the player phone shell.

## Elevation & Depth

Surfaces are flat, without decorative shadows. Tonal contrast, thin borders and spacing define groups. Pale green gradients on the home rule demonstration and wallet summary softly group content; forest green identifies the winning example and key actions. These selected gradients do not establish a gradient treatment for every card. Featured auctions reuse the image-led catalog card, with carousel controls below. The illustrative winning tile rises by 5px to reinforce its distinction.

Administration also stays flat: tinted navigation, table headers, thin borders and white panels provide separation without shadows. The mobile drawer uses a 160ms ease transform; reduced-motion preferences disable transitions.

## Shapes

Controls and active navigation use gently rounded corners from the control token. Identity panels use the identity radius, while feature and wallet panels use the feature radius. Small demonstration tiles use 10px corners. Wallet chips are pill-shaped; avatar and icon targets are circular. Borders are thin and quiet.

Administration panels reuse the control radius, with smaller admin-control corners for buttons, navigation and notices and admin-field corners for fields. Table containers use 10px corners and saved player previews use 12px. These scoped control proportions support the denser operational shell.

## Components

Mini App primary actions use forest green with white labels, a 48px minimum height, 12px radius, 12px by 20px padding, a semibold label and an 8px gap. Hover uses primary-hover; disabled actions use the muted disabled fill/ink and a not-allowed cursor. Bid actions retain their 11px radius and 13px bold label. Outline/shared Button variants retain soft borders, ink and mint hover; the shared Button utility still uses supporting green with white text for its default variant. This scoped distinction preserves existing identity and staff controls.

Mini App and Telegram entry focus uses a 2px mini-focus outline offset by 3px; the legacy shared utility has its own 4px offset. Mini App inputs and textareas use a mini-focus caret. Preserve the skip link and accessible names on icon-only controls. Motion is restrained: the loading indicator alternates over 1.2 seconds, and reduced-motion preferences disable animation and transitions.

The wallet chip shows ETB for guests and the authenticated available balance when present; staging labels it DEMO. Bottom navigation combines icons with labels: Home, Auctions, Winners, My Bids, Wallet and Profile. The current route uses mini-nav-ink on mini-nav-selected and exposes its current-page state. Catalog and personal tabs use forest green with white labels for their selected states.

Identity panels distinguish loading, guest, reconnect/error and unavailable launch configuration. Verified identity appears in a compact mint line. Retry and Telegram launch actions appear only when applicable. Features outside Phase 1 use honest not-open states rather than populated mock content.

The home rule demonstration presents six amounts, 1 / 1 / 2 / 3 / 3 / 4, in equal columns and is explicitly labelled EXAMPLE ONLY. The unique minimum, 2, has forest green fill and a check; duplicated amounts have crosses, and 4 is marked unique but higher. Supporting text explains the result so color alone does not convey the rule. This is an illustration, never a live auction statistic.

### Telegram onboarding and catalog refinement

The contact gate precedes Mini App navigation and content. It uses the white 440px entry column, wordmark, shield, short heading, privacy explanation and full-width forest green Share my contact action. Native Telegram contact sharing is preferred; Share through the bot instead and Open the bot provide the fallback. Pending verification disables share actions and announces status. Cancellation closes the Mini App when supported and leaves an explanatory state; no ETB is promised for sharing contact. Only a verified own-contact response continues into Home. The launch loader uses a restrained 1.2-second progress indicator and a static reduced-motion state.

The app shell and standalone entry/contact layout preserve browser and Telegram safe-area clearance. Entry/contact uses 32px base vertical and 24px horizontal padding plus the current safe-area variables.

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

The ETB wallet begins directly with its page title. Its pale-green-gradient balance panel with dark ink leads into paginated journal rows with available and held deltas, timestamps and refresh/error states. Funding availability is described by the Phase 6 state below. Account counts, bid histories, favorites and wallet entries are private, server-derived content; notification and fulfillment copy must describe the actual recorded, unavailable or pending state.

### Phase 6 wallet funding and Telegram entry

The enabled test flow retains the two-column Telebirr/CBE selection with pressed-state semantics, green borders, mint fill and a selected check. TEST ONLY and Do not send real money remain visible. Receiving details use the existing white, quietly bordered panel and copy-status message. If funding is disabled, the Phase 5B preview remains: unconfigured or synthetic non-payable details, with disabled receipt controls.

The quote section shows an ETB amount, whole-ETB result, version, limits and terms before Accept quote & create request. Terms and supporting paragraphs are left-aligned with a readable 14px line; the amount field is at least 48px high. After request creation, the chosen method and amount are locked and the saved quote remains visible.

Receipt input offers text/reference/official URL/SMS or an available screenshot scan. The dashed image area is an active file control in the test flow, followed by an editable extracted reference and explicit review checkbox. Upload/scan progress is visible. A failed scan returns to manual reference entry with an explanatory status; editing the reference clears its reviewed state. The accepted receipt keeps the returned reference visible and disables input, upload, review and submission controls. Start another request resets the entry flow. The confirmed response refreshes the wallet and header balance; a failed header refresh has an explicit message. These are interface states, not evidence of production financial execution.

Funding activity uses the existing separated rows with textual verification and investigation states, method, amount, wallet ETB, a short request identifier and support link. Eligible unfinished requests expose Continue. Empty, error and pagination states stay explicit.

The ordinary-domain entry is a white, vertically centered column, at most 440px wide, with 24px horizontal padding, the text wordmark, a compact headline and a full-width Continue with the bot action. Missing-link, loading and retry states use plain text. It does not present the player navigation or a browsable marketing/catalog shell. This entry screen is outside the Phase 6 payment finish-review scope.

### Phase 5B alerts

Your alerts uses dated, separated inbox rows with linked titles, bodies and explicit Mark read actions. Read titles use lighter weight; unread count and Mark all read remain separate from the list. Empty, loading and retryable error states use the existing private-page patterns. Notification preferences use labelled green checkboxes with comfortable row targets. The bell combines an accessible unread count with a compact badge, capped visually at 99+. Bot-message preferences explain the opt-in and private-chat requirement; a visual inbox does not prove external delivery.

### Administration workspace components

Navigation has five primary areas: Overview, Auctions, Payments, People and Reports. Settings sits separately above staff identity and Sign out. Each area links to its first authorized task; permitted contextual tabs expose the detailed workflows. Auctions groups auctions, products/images, categories, Home & FAQ and results. Payments groups deposits, bank statements, player balances and receiving accounts. People groups players, deliveries and messages. Reports groups business summary, balance checks, staff activity and message delivery. Settings groups workspace information and team access. Longest matching task metadata supplies breadcrumbs and active state; selected rail links use pale green, black text and `aria-current`. The secure layout provides access context, while server operations independently reauthorize.

Overview uses independently available auction, deposit and delivery projections with database time. Unauthorized sections are omitted and failed reads remain explicitly unavailable. Compact metrics, auction summaries, attention rows and disclosure-based help display authorized server data. Balance checks remain a deliberate read-only task.

Buttons use 9px corners, 44px minimum height, 14px semibold labels and 10px by 18px padding. Primary forest actions and their #123d2e hover state have white labels. Secondary controls are white with black labels and pale selected hover; destructive actions use rust with white labels. Disabled actions reduce opacity. Focus is a 3px administration-green outline offset by 3px. Fields use 8px corners, white fill, black text and a green caret. Errors and confirmed notices retain persistent alert/status semantics. Sign-in retains separate credential, authenticator, recovery and reset forms; appearance does not establish external email delivery.


Work queues use semantic tables, explicit headings and a truthful empty state. Product and category editors pair inventory tables with labelled forms. Image attachment explains validation and attribution; Home & FAQ uses plain text fields and additional FAQ fieldsets. Reconciliation remains a read-only table, not a balance editor. These surfaces display server-derived data rather than decorative statistics.

Draft publication separates Save draft, publication preflight and Publish scheduled auction. Changing a draft clears the previous preflight and disables both preflight and publication until the changed draft is saved; an inline status explains this requirement. The saved phone-width preview remains labelled as unpublished, with bidding unavailable. Published inventory, schedules and point terms are presented as immutable facts rather than editable controls.

Cancellation first exposes affected participants, held ETB and fee refunds in a summary and table, followed by a reason, typed auction-code confirmation and fresh MFA step-up. The destructive action describes its refund consequence. Completed auctions offer participant movements, current wallet balances, balanced journal postings and expandable private decision proof. Financial success messages appear after the server confirms a change. Fulfillment remains explicitly pending when applicable.

Phase 5B operational lists retain semantic tables with explicit status/scope, details and actions, plus search, relevant status filters, record counts, pagination and truthful empty states. Filters wrap at smaller widths and table containers scroll horizontally. Team pairs its table with a labelled role/reason form and fresh-MFA control. Point-wallet inspection remains read-only, with journal links. Phase 6 payment investigation is a separate workspace described below. Private contacts, actions and notices must reflect server-authorized state.

The current redesign documents shared navigation, Overview, auction queues/editors, deposits and payment review, deliveries, players, reporting, team/settings and existing staff forms. This is source coverage, not a claim that every route has a new screenshot. Current checks and limitations belong to `docs/admin-redesign-report.md`; the final visual review is recorded in `.impeccable/review/admin-finish-review.md` with a ship disposition limited to its scored fixes.

The following earlier review evidence is historical, not validation of this redesign. This supplement records the implemented visual system and interaction labels. The Phase 5A visual review's ship disposition is limited to its scored fix scope, including the dirty-draft publication guard. Its ten baseline laptop/tablet captures and two dirty-editor captures are stored as `.impeccable/review/phase5a-*.png`. Phase 5B visual references are `docs/screenshots/phase5b-home-viewport-mobile-360.png`, `phase5b-home-viewport-mobile-430.png`, `phase5b-wallet-cbe-mobile-430.png`, `phase5b-alerts-mobile-360.png`, `phase5b-team-admin-laptop.png` and `phase5b-wallets-admin-tablet.png` in the same directory. Screenshots are visual evidence, not proof of production authentication, external delivery, receipt intake or financial execution. PRODUCT.md retains the historical Phase 1 scope with dated visual-direction and Telegram-only platform updates.

### Phase 6 payment administration

Top-ups reuses the staff shell, labelled search and status/case filters, semantic tables, record counts and pagination. Incident links use a responsive grid of quiet bordered items with prominent counts. Queue rows show short request IDs, method, verification, case and assigned operator; empty results say that no requests match.

Investigation detail separates the frozen quote, issuance record, redacted reference and verification timeline from case notes and actions. Text explains that resolving a case does not change its receipt or ETB balance. Configuration uses the existing labelled staff form, followed by a Setting / Current / Proposed review table and Publish reviewed version. Editing the form clears the review. The current/proposed table keeps changes readable at both laptop and tablet widths. Statement reconciliation includes the explicit No statement evidence recorded empty row and an appropriate next-step explanation.

The payment finish-review handoff records a ship disposition, all three requested fixes resolved and all sixteen payment captures valid. This is a visual-review disposition limited to those payment surfaces. References are the paired 360px/430px `phase6-wallet-quote`, `phase6-wallet-scan`, `phase6-wallet-fallback` and `phase6-wallet-receipt` captures, plus paired laptop/tablet `phase6-top-ups`, `phase6-payment-detail`, `phase6-payment-settings` and `phase6-payment-statements` captures under `docs/screenshots/`. The Telegram entry is outside that review. No financial, provider, security or production-release assurance follows from these captures.

## Do's and Don'ts

- Do use black text on white/pale surfaces and white text on forest solid surfaces across both layouts.
- Do preserve the player #184d3a and separate staff #184d3a action tokens, visible focus, comfortable targets and Telegram safe areas.
- Do keep Home ending in its green footer with only fixed-navigation clearance inside it.
- Do preserve the exact allowed `?v=forest-1` query on `/logo.png` and `/banner1.png`; arbitrary image queries are not allowed.
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

### Historical ETB unit transition (2026-09-28)

One immutable historical point maps to ETB 1.00. The ledger, hold, bid, fee and settlement integers remain unchanged; the migration records the 1:1 conversion rather than rewriting journals or frozen terms. New bids use whole ETB increments. Legacy public terms are translated on display. The six-tab player navigation includes Wallet. DEMO ETB credits are synthetic test grants with no cash value and are never presented as verified Telebirr, CBE or Check.et payments. Funding quote publication and creation require ETB 1.00 per ETB 1.00 transferred; production funding stays disabled until reviewed.


### Winner cards and result detail update (2026-10-02)

The owner supplied mobile references for clear completed-auction results. Home and Winners now share product imagery, a left-aligned title, winner/amount/masked-phone rows and a forest-green View results action (#184D3A). Winning amounts use #184d3a, supporting text uses #4B6257, and the trophy uses a restrained gold accent. These scoped colors supersede the earlier all-black supporting-text rule on these result surfaces. Titles use 21–23px, winner names 20–26px and amounts 23–30px; supporting labels remain comfortably readable.

Completed, cancelled and pending auction detail routes share the gallery-first result layout with a short outcome, end dates in Gregorian and Ethiopian calendars, aggregate views and bid count, and product details. Repeated rules, fulfillment placeholders and anonymity notices are removed from result pages. Active-auction bidding and its terms disclosure retain their existing behavior. Both product and auction-presentation editors have one plain-text description field per language. Label: value lines render as specification rows; other lines render as paragraphs. No HTML is accepted.

Real settled results show the stored Telegram winner name and only the final two digits of a verified, non-revoked contact. Illustrative records are explicitly labeled and never acquire invented names, contacts or bid counts. View my bid history opens the player's existing private History tab.

### Personal bid cards and auction navigation (2026-10-02)

My Bids and Winning Bids share image-first vertical cards, readable wrapping titles and numbered pagination. Bid amounts use forest green, auction codes blue, view counts warm orange, and outcome labels green or rose. A blue copy control shows `BID_` followed by 12 characters from the original bid ID; this is a compact display reference, while stored bid IDs remain unchanged. Copying shows a status message and keeps the current page open. The rest of each card links to the numeric `/auctions/{code}` detail URL.

Winning Bids is at `/winning-bids`; `/profile/wins` redirects there. Existing `/winners/{code}` and slug-based auction links redirect to the numeric auction detail. Winners lists remain at `/winners/all`. Live details use the product gallery, service fee, existing bid review and confirmation, countdown, aggregate activity and product specifications. Ended details use the winner/result layout above. Fulfillment placeholders are omitted from personal cards and result pages. Supporting colors on these scoped surfaces supersede the historical all-black text rule.

### Brand color and live activity update (2026-10-02)

The owner confirmed standard green #008000 with white text on solid green backgrounds. This direction supersedes earlier greens. Primary controls, headers and selected accents use #008000; hover uses #006600. Green text may appear on white or neutral surfaces. Blue, gold and rose keep their informational roles.

Visible products share one batched activity request every two seconds; hidden tabs pause requests. Views record after one second with at least half the card visible (or one second on the auction detail), once per signed-in person and auction in a rolling 24-hour window. The database deduplicates tabs and devices; reads never increment views. Existing totals are preserved. The activity response contains aggregate counts and public auction phases only. At the deadline the canonical detail switches to a short ended state, then refreshes to show the authoritative winner and Completed once settlement commits. Player pages omit result and fulfillment pending jargon. The existing VPS worker remains responsible for settlement and invalidates public caches after completion.

The top-bar hammer opens a full-screen native modal that enters from the left. Close, Escape and focus restoration remain available; the list scrolls independently. Its header shows the actual available-auction count and refresh, followed by image, title, live bid count, countdown and numeric-detail actions. Reduced motion disables the entrance animation.

## Player home refresh - 2026-10-05

The owner selected standard green #008000. Home now leads with large white copy on solid brand green and a small composition of real published auction images. It preserves Owner-managed bilingual copy. White and quiet pale-green surfaces carry most content; green is reserved for the hero, actions and key counters. Featured cards distinguish countdowns from larger bid totals. Motion slides auction items from right to left, pauses for interaction and honors reduced-motion preferences. Categories appear once and require at least one publicly published auction. The smaller header circles retain 44px tap targets. Profile green panels use explicit white text. All player support actions open @lowwinsupport on Telegram.

The English home headline uses locally served Sora ExtraBold (800), with balanced
wrapping and white text on brand green. Amharic keeps the existing Ethiopic font.
Supporting copy and the rest of the app retain Poppins.

Built-in support case pages, admin inbox/replies and overview counters are retired. All customer help uses direct Telegram @lowwinsupport. Historical case/audit records remain stored. Existing player-care staff keep read access to players and deposit status; only the Owner changes bidding access.
