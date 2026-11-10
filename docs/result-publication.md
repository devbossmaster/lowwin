# Result publication

Results now publish automatically after the server commits financial settlement and validates its immutable accepted-bid proof. No administrator approval, winner override, unpublish or reroll action is available. An ended auction leaves Live at its original deadline. Winner banners are optional later presentation edits; they never delay settlement, repeat notifications or change a winner.

The auction worker recovers settled-but-unpublished results after a restart. Publication and durable notification intents commit together. Invalid evidence remains unpublished with a safe diagnostic and retry time; the worker never guesses a result. Each iteration bounds recovery to one item while still servicing one newly due auction, so old history cannot postpone financial settlement.

The additive `202611100001_auto_winner_presentation` migration records an immutable database-clock announcement cutover. Genuine pre-cutover results are validated and backfilled silently; already-published records keep their original publication date. New results announce through the existing notification worker using the frozen product image. Later complete Winners banners remain separate from product images and queued Telegram media.

See [Automatic result publication](automatic-result-publication.md) for version-specific rule guarantees, rollout services, historical diagnostics/backfill commands and privacy limits. Migration `202610300001_result_publication` remains immutable historical migration history; its old manual approval workflow is superseded by this release.

Local verification does not apply production migrations or send real winner announcements. Deploy WEB, the auction worker and notification worker from the same reviewed revision after applying the additive migration.
