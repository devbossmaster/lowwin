# Lowwin admin redesign evidence

Implemented on `redesign/admin-neutral-refund-reset`, based on the verified remote main `935f048`. The working checkout is `D:\lowin-redesign-qa\patched-deps\app`. The separate C: checkout and its protected environment file were not reset or overwritten. Production deployment, gateway selection and SQL execution remain separate review steps.

## Result

The warm-white, near-black and gold workspace has seven role-aware business groups, shallow task tabs, stable server search/filter/pagination, full totals and detail drawers. Navigation retains URL filters, page and scroll position. A separate staff TanStack Query client is keyed by the authenticated staff session, role and permission set; it deduplicates reads, clears on identity change/logout and invalidates affected query families after confirmed mutations. Authenticated HTTP responses retain private/no-store behavior.

Password plus authenticator is required at login with an eight-hour absolute credential cap. The previous remembered-device bypass and repeated in-panel fresh-MFA gates are removed from server commands, UI and assertions. Login, invitation, enrollment, recovery-code saving, logout and password recovery use the original protected server paths. Existing identities, passwords, MFA enrollment and recovery material were not changed in production. See [staff recovery](staff-recovery.md) for both supported recovery and the audited operator-assisted lost-both procedure.

Transactions, review, refunds, reconciliation, callback/storage status and reports are provider-neutral. ArifPay's existing adapter/history remain; Chapa is unimplemented and neither provider was selected or activated. Manual mark-paid/add-funds staff HTTP commands return 410. Historical transfer evidence, attributable staff credits, duplicate checks and unresolved recovery remain available through restricted links.

Financial reports separate accepted gross fees, referral discounts, compensation/refunds, net fees, deposits and AVAILABLE/HELD liabilities. Deposits and customer balances are not labeled profit. Finalized results/deliveries respect frozen terms; v4 winning numbers are not displayed as a payment due.

CMS controls publish optional banner images, accessible EN/AM copy, Learn More/video, social links, FAQ and legal documents through versioned, audited commands. Legal publication requires Owner settings permission. Existing approved media remain when overrides are empty. Managed subdocuments live inside the existing home content record because production permits only home/faq IDs; no schema migration is assumed. Writes preserve the previous body in immutable audit evidence and reject stale versions. Home's duplicate content read is deduplicated within its server render. Video remains poster-first, click-to-load and optional; no broken player is introduced.

The maintenance barrier protects bids, publication, new checkouts and natural settlement while preserving proven incoming payment evidence. The separate reset package uses actual net fee journals, canonical legacy hold releases and v4 reset-compensation journals. Published slugs and all relational/financial evidence remain; catalog archival does not disable financial triggers or delete customers.

## Local validation

| Check | Result |
| --- | --- |
| Typecheck | Passed |
| Optimized Next.js 16.4.2 Webpack build | Passed; existing external-parent lockfile warning only |
| Focused security/navigation/copy/payment-boundary checks | 122 passed |
| Financial, staff-auth and admin API regressions | 177 distinct assertions passed across the financial run and focused reruns |
| Final admin API/content/archival run | 37/37 passed |
| Final staff-auth/API/checkout rerun | 70/70 passed |
| Responsive browser flow | 3/3 passed: 360px, 430px, 1440px |
| Reset rehearsal | 15 checks across production-shaped 31-migration and current schemas |
| Dependency audit, including dev dependencies | Zero reported advisories |
| Production read-only reconciliation | Zero projection, journal or hold discrepancies |
| Diff whitespace check | Passed |

The initial broad financial run had one invalid synthetic receipt fixture; the database correctly rejected its missing frozen quote snapshot. After correcting that fixture, every affected API assertion passed in fresh isolated databases. An earlier development-server browser pass also exposed a 360px delivery-width conflict and selected-tab contrast; these were fixed. Final browser checks use the optimized build under an explicitly local fixture runtime. Production configuration correctly rejects fake HTTP credentials; no such guard was weakened to run the fixture.

Browser coverage uses actual password/TOTP endpoints and synthetic loopback records, with no test authorization headers or impersonation cookies. It checks an eight-hour issued session, valid access after 45 minutes without another code, private data projection, 25-row server pages and full 30-record totals, drawer Escape, restored filters/page, cache reuse, CMS publication, role-change isolation, logout revocation, no customer bid/payment POSTs and zero ledger drift. Dense tables contain their own horizontal scroll; deliveries become mobile rows. The visual review was bounded to one desktop/mobile batch and one confirmation pass.

The financial suites also cover restricted runtime privileges, every existing rule version, deadline/balance races, atomic rollback, idempotent bid/credit/refund behavior, provider evidence mismatch, referral redemption and wallet reconciliation. The reset rehearsal adds stale snapshot rejection, a durable halt after forced failure, canonical legacy hold/fee handling, untouched original v4 proofs, preserved settled winners, exact rerun no-op and a late verified credit that does not create a bid or get credited twice.

## Measured navigation

The following are local click/navigation observations against an optimized build and a loopback database, not production latency percentiles or physical Telegram measurements. First data includes full page navigation; warm data includes client navigation, with mobile drawer interaction. They are different navigation paths and should not be presented as a controlled network benchmark.

| Viewport | First Transactions data | Warm return data | Cached drawer visible | Additional data requests on warm return |
| --- | ---: | ---: | ---: | ---: |
| 360px | 595 ms | 438 ms | 73 ms | 0 |
| 430px | 600 ms | 313 ms | 71 ms | 0 |
| 1440px | 347 ms | 159 ms | 69 ms | 0 |

Before this change, the admin read hooks fetched on each mount and independent workspaces retained separate fetching paths. They now share one staff-scoped query client. The request-count improvement is directly asserted. No comparable pre-change timing sample was collected, so no percentage speedup or production p95 is claimed. Raw synthetic navigation evidence is alongside the screenshots.

## Screenshots

All new screenshots use synthetic local records and show no real customer contact, provider secret or MFA/recovery code. Existing `admin-direct` captures are historical before images from the earlier admin revision, not a new production session.

| Screen | Before | After |
| --- | --- | --- |
| Overview | [360px](../screenshots/admin-direct/overview-360.png) | [360px](../screenshots/admin-neutral/overview-360.png), [430px](../screenshots/admin-neutral/overview-430.png), [desktop](../screenshots/admin-neutral/overview-1440.png) |
| Transactions | [360px](../screenshots/admin-direct/payments-360.png) | [360px](../screenshots/admin-neutral/transactions-360.png), [430px](../screenshots/admin-neutral/transactions-430.png) |
| Players | [360px](../screenshots/admin-direct/players-360.png) | [360px](../screenshots/admin-neutral/players-360.png), [430px](../screenshots/admin-neutral/players-430.png) |
| Login | — | [360px](../screenshots/admin-neutral/login-360.png), [desktop](../screenshots/admin-neutral/login-1440.png) |
| Deliveries | — | [360px](../screenshots/admin-neutral/deliveries-360.png), [430px](../screenshots/admin-neutral/deliveries-430.png) |
| Content | — | [360px](../screenshots/admin-neutral/content-360.png), [desktop](../screenshots/admin-neutral/content-1440.png) |
| System/gateway status | — | [430px](../screenshots/admin-neutral/system-430.png) |

## Staging, canary and rollback

1. Keep provider and funding flags unchanged. Use a protected staging copy or isolated fixtures with compatible encryption keys and no outbound production messaging. Do not point the test runners at production; they require a loopback `_test` database and create fresh databases.
2. Run the dedicated `node scripts/run-db-tests.mjs admin` job plus the existing authentication/financial regressions. It compiles once, runs the three responsive flows and releases its owned server ports. Confirm every narrow staff role, password/TOTP, expiry, logout, recovery, readonly reporting and private cache isolation.
3. Verify public Home/banner/header and EN/AM fallback content with overrides empty. Review any CMS publication independently. Check actual Android/iOS Telegram, keyboard/safe areas and any configured local/YouTube video on staging; local Chromium screenshots do not establish those device results.
4. Establish actual deployed web/worker revisions, restorable backup and Owner review of the fresh private SQL packet before production maintenance. Follow [the exact SQL procedure](README.md). No migration deploy or reset is automatic in this branch.
5. Canary the admin with existing authorized staff before expanding access. Monitor authentication failures, stale query errors, callback/recovery backlog, account projections and worker retries. Existing users and the original Owner keep their identities and enrollment.
6. A pre-reset UI rollback can restore the prior build. After maintenance starts, retain maintenance-aware server and workers through any UI rollback. Do not undo committed journals or settlements by deleting them. Use the recovery limits in the reset procedure and a separately reviewed compensating operation where needed.

## Remaining release gates

The live web/worker commit cannot be attested from the public deployment endpoints. Physical Telegram device checks, slow mobile network testing, production email delivery and production p95 measurements remain unverified. Provider selection, merchant validation, gateway activation and all production SQL execution are pending Owner review. A pre-existing PUBLIC execution grant on the privileged demo cleanup routine also needs a separate access-hardening review; the redesign did not invoke it or change production privileges. The existing pending ACL migration is identified in the reset README. See the private audit and reset README for the concrete finding.
