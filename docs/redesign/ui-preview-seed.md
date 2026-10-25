# Staging UI preview data

The preview seed is restricted to the owner's current disposable staging project, matching Mini App/auth origins, the pinned bot hash and an explicit batch. Production, Vercel, other projects and enabled live funding are rejected. It does not migrate a schema, delete records, replace customer identities or contact Telegram users.

Run from the local staging checkout with its protected environment already configured:

```powershell
node.exe node_modules/tsx/dist/cli.mjs scripts/grant-staging-demo.ts --batch ui-v4-20261024
node.exe node_modules/tsx/dist/cli.mjs scripts/seed-ui-preview.ts --project kgwjolbhtvfwuohrtjya --batch ui-v4-20261024
node.exe node_modules/tsx/dist/cli.mjs scripts/seed-ui-preview.ts --project kgwjolbhtvfwuohrtjya --batch ui-v4-20261024 --apply
```

Without `--apply`, the preview script reports its plan and performs no writes. Reusing a completed batch returns its recorded result. Individual credits and bids use deterministic idempotency keys. Every listing is labeled DEMO, carries `isDemo` and belongs to a test run; every synthetic participant is labeled and has no Telegram account. Existing registered users receive only explicitly recorded demo ledger credits and sample activity. Their identity/contact/profile records are preserved, with an identity hash checked after the seed.

The completed batch provides twelve live listings with varied fees, three upcoming listings, a canceled listing and a result-pending listing, plus finalized test winners. Existing verified staging testers receive active and won/lost bid examples, Favorites, wallet demo credits and in-app notification examples. The rich settled result contains twenty-three distinct numbers and twenty-one participants to exercise both pagination controls. Original project illustrations are used for products; no winner portrait or delivery claim is invented.

V4 bids and settlements go through the existing server commands and immutable ledger checks. Numbers are never charged or reserved. The script waits for the published deadlines before settlement; on a distant staging database this can take several minutes. It does not shorten a published deadline to make a preview appear complete sooner.

Pending/review payment examples are **labeled notifications only**. There are no fabricated provider sessions, terminal payment results, receipt approvals or credited-payment records. Funding providers stay disabled. Outbox records inherit the test-run ID, which suppresses external Telegram delivery; global scheduling also excludes test-run auctions.

Production still excludes all demo results. Only the pinned local staging capability admits demo auctions marked as settlement fixtures, and they must have a genuinely committed final settlement. Cards say “Demo winner” in English and Amharic. Live/upcoming bid amounts remain private. No auth/contact gate is bypassed for registered users.

Verification for this capability: 36 focused checks pass with no skips on a disposable loopback database, covering staging target restrictions, tagged catalog visibility, finality, masking, pagination, contact revocation and ledger reconciliation. Typecheck passes including the seed script. The final staging audit records all three registered identities preserved and zero ledger discrepancies. The operator reconnects after the published wait and retries transient connection failures; production transaction settings remain unchanged.

The completed staging read on 24 October shows eleven currently live listings (one of the original twelve has reached its deadline), three upcoming listings and four finalized demo winners. The rich result has 43 accepted bids, 23 distinct numbers and 21 players; actual page sizes are 20+3 amounts and 20+1 participants. Live/upcoming breakdown reads remain denied. Only masked contact displays are returned, and the test run has sent zero Telegram messages. [Sanitized verification](timings/ui-preview/staging-verification.json).

Tagged test-run data stays excluded in normal environments. The staging-only catalog predicate must be used by ordinary reads, category counts and raw SQL sorts alike; result visibility still additionally requires a committed settlement and a settlement-fixture marker. Test-run tags are retained to suppress external delivery.

To review the current UI, close and reopen the staging Telegram Mini App after completion. Use Home sorting/Load More, Recent winners, result number/participant pagination, the hammer's Upcoming tab, My Bids, Favorites, Wallet and the notification filters. Real checkout remains disabled. Physical Android/iOS behavior still needs device review; populated data alone does not establish a perfect layout.

Keep preview records isolated from any production migration. No automatic cleanup is performed. Reversing test ledger activity or cleaning up a test run must use the existing reviewed recovery/cleanup procedure, retaining audit evidence and all registered customers.
