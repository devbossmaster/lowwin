# My Bids sections and referral validation

My Bids defaults to Accepted bids, with All, Active and Completed views. Payment attempts has its own All, Pending, Failed, Cancelled and Needs review filters. Changing sections or filters clears their pagination. URL state survives refresh and Back. Accepted-bid totals never include checkout attempts.

The owned payment API applies each filter before pagination. Pending contains in-progress/authorization states; Failed contains verified failure, incomplete, expired and blocked states; Cancelled contains cancellation; Needs review also retains verified payments whose funds were preserved without an accepted bid. Closing a checkout or reaching a customer-window deadline does not invent a provider failure.

Customer payment controls use the telebirr, M-Pesa and CBE Birr icons as one online payment choice. Customer prompts say checkout/online payment rather than Chapa. Provider endpoints, persisted attempts, verification, receipts and admin diagnostics retain their existing integration names and behavior.

Referral validation uses disposable PostgreSQL databases and synthetic Telegram identities. Coverage includes the full invitation URL, trusted bot start, signed Mini App launch, new-account attribution, first accepted bid, failed bids, duplicate/competing starts, one coupon per qualifying friend, concurrent redemption, expiry, policy pauses and account isolation. Browser checks verify copying/sharing the complete link, configured reward values, coupon controls and logout isolation in English and Amharic. Screen truncation does not truncate the copied link.

This change adds no migrations or environment variables. Existing referral configuration must remain aligned on WEB and relevant workers: `REFERRAL_REWARDS_SCHEMA_READY=true`, the correct `TELEGRAM_BOT_USERNAME`, and an enabled policy in Admin → Players → Referral rewards setup. Existing users cannot become new referrals retroactively. Production invitation acceptance still requires a genuinely new Telegram user; local checks do not claim that a real production invitation or payment was performed.
