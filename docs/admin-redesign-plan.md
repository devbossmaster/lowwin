# Admin workspace redesign

Review branch: `review/admin-workspace-20260930`. No deployment, production commands, financial policy changes, or migrations are part of this work.

## Direction and scope

Implement the supplied dashboard reference as an operational workspace: five primary areas, contextual task tabs, calm white panels on a pale green canvas, forest green actions. Preserve the player Mini App layout and behavior. Later user direction adds black text on white surfaces and white text on forest-green surfaces across both player and admin UI. Counts and records come from authorized server projections, never the sample reference.

## Architecture

- Shared route metadata resolves the longest matching task and the first permitted landing page for each staff role. The secure layout passes serializable access context; server reads and mutations independently reauthorize.
- Overview uses independently reported auction, deposit, delivery and support projections with database time. Missing permissions omit sections; failed reads remain unavailable. Ledger checks remain an explicit read-only task, not a repeated dashboard scan.
- Auction filters share time-aware predicates with Overview. Participation uses a bounded SQL aggregate for the displayed IDs. Published terms and settlement services are unchanged.
- Deposit review uses a union predicate shared with the queue. Amount inputs convert string ETB to integer cents. Failed writes retain input and an unchanged request keeps its idempotency key.
- Deliveries include settled winners without a case and enforce assignments before returning rows. Eligible staff selection is paginated and Owner-only. Contact remains a separate audited read.
- Existing inventory, publication, cancellation, support, funding, messaging and staff commands remain the mutation authority. Shared UI primitives supply headings, statuses, evidence disclosures, filters, pagination and errors.

## Verification

Use explicit disposable loopback `_test` databases, never the owner's `.env` database. Capture baseline and final laptop/tablet/360/430 views. Run domain, permission and aggregate tests, admin and payment browser suites, typecheck, build and diff checks. Report exact results and limitations in `docs/admin-redesign-report.md`.

## Historical documentation

Older PRODUCT/owner-runbook sections describe integer points, absent production email and earlier no-winner rules. Current v3 source and the cent-money release packet take precedence; historical release evidence is not rewritten.
