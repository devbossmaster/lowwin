# Automatic result publication

The auction worker settles an ended auction using its frozen server rules, then validates the committed accepted-bid proof before publishing. Publication and logical outbox intents commit atomically in a separate transaction. Financial settlement is not rolled back or changed by announcement failure. The worker retries genuine unpublished settlements after restart, including interruption between settlement and publication.

V2–V4 preserve lowest accepted number submitted exactly once; only when none is unique, the first immutable acceptance at the lowest number wins. Fewer than two accepted participants cancels under the original version's fee/refund rules. V1 keeps its original no-unique/no-winner behavior. Bids are filtered strictly before the original cutoff and at the saved acceptance-order boundary. A mismatch remains unpublished with a safe `Auction.publicationErrorCode` and bounded retry time; no winner is guessed or repaired.

## Operations

Apply the additive `202611100001_auto_winner_presentation` migration and deploy the same application revision to WEB, the auction worker and notification worker. Existing authentication, ledger and payment recovery configuration remains required. The migration records one immutable database-clock `ResultPublicationPolicy.automaticFrom` cutover. Missing policy fails closed with `PUBLICATION_POLICY_NOT_READY`; a restart never invents a new cutover.

Genuine settlements completed at or after cutover create the public result campaign and appropriate private participant intents. Older genuine settlements are validated and published silently. Already-published results remain unchanged, including their original announcement timestamp. Announcement HTTP delivery runs outside all settlement/publication transactions using the existing durable fan-out worker.

Each worker iteration processes at most one recovery item with an auction row lock and `SKIP LOCKED`, then still services at most one due financial settlement. Failed recovery items are postponed by 30 seconds; neither an integrity failure nor a historical backlog can starve current auctions. Public cache generations are invalidated after publication; the existing maximum five-second server TTL also bounds stale data after an interruption between commit and invalidation.

## Historical audit and safe backfill

The following command is read-only by default. It reports the observed immutable selection decisions and a bounded count of unpublished pre-cutover candidates, without payer/contact details:

```sh
npx --no-install tsx scripts/result-publication-audit.ts
```

An authorized database operator can explicitly run a bounded **silent** backfill. The shared proof validator is still required; no broadcast opt-in, winner override, reroll or financial mutation exists in this command:

```sh
npx --no-install tsx scripts/result-publication-audit.ts --apply-silent --limit=25
```

The observed no-unique rate includes only genuine V2–V4 winner settlements with at least two participants and a known `LOWEST_UNIQUE` or `FIRST_ACCEPTED_LOWEST` decision. It excludes cancellations, illustrative/demo/test records and V1; it is a sample observation, not a universal future probability. No production history was accessed for this implementation, so no real historical rate is asserted.

## Presentation and privacy

Winner DTOs expose only validated public display name/handle, the existing server-masked contact, immutable result fields and the actual publication timestamp. Phone/email-looking display names are omitted. Public cards and the result modal use the same masking helper; private participant drilldown retains its existing authentication and pagination boundary. Distinct submitted numbers and numbers submitted exactly once are reported separately from the committed cutoff snapshot.

The original product and frozen auction images remain independent from optional Winners presentation media. Historical photograph overrides retain their original composition semantics; a newly uploaded complete banner has a distinct media purpose and presentation mode. Presentation edits never republish a result, repeat announcement intents or change settlement/ledger data.
