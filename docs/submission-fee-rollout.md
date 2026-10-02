# Submission-fee-only auctions

New auctions use `lowest-unique-v4`: the selected number starts at 1.00, has
0.01 precision and no configured maximum. Only the auction's displayed fee is
charged per accepted submission. There is no number-based hold or winning charge.
Accepted fees are retained on all cancellations, including insufficient participation.
The existing unique-number and earliest-lowest fallback selection stays in place.

Pause web bidding and the auction worker. Deploy the code and apply migrations
on the intended VPS project before starting
the updated web process and auction worker:

```sh
npm run db:migrate
npm run db:generate
npm run build
```

Create a new auction or set its submission fee in **Manage → Submission fee**.
There is no automatic 30 ETB default. Existing published V1–V3 auctions retain
their recorded payment rules until explicitly converted. Completed results are
never converted.

To convert a live V3 auction, run the following on the VPS using its table-owner
`DIRECT_URL`. Replace `LW-CODE` and `AMOUNT` with the exact auction code and its
chosen submission fee. The first command previews the target and released holds:

```sh
npm run auction:fee-only -- --auction LW-CODE --fee AMOUNT
npm run auction:fee-only -- --auction LW-CODE --fee AMOUNT --apply
```

The conversion preserves accepted bids and original receipts, releases existing
bid holds through ledger entries, adds a new fee revision and records the policy
change. It does not refund already charged fees. Under the converted policy,
those fees also remain non-refundable on cancellation. New submissions must
confirm the new fee quote. Announce the changed cancellation policy to affected
players before converting an auction with accepted bids.

The conversion is one transaction: errors roll back ledger entries, terms,
revisions and trigger changes together. It cannot convert an ended auction.
Pause web bidding and the auction worker during rollout; restart both on the
same code version afterward. Review one bid receipt and run
`npm run wallet:reconcile` after rollout.

No VPS migration or live conversion is performed by local development checks.
