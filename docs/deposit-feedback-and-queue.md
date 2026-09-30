# Deposit feedback and queue actions

A complete official provider match credits the wallet, records the immutable payment claim and journal, and creates the credit notification in one database transaction. The browser announces success only after that transaction returns CREDITED. A Check.et dashboard verification alone does not establish a Lowwin wallet credit.

This change reuses the same user's existing request for the same channel and reference, including concurrent submissions and references extracted from screenshots. Reviewed and rejected requests return their current outcome without calling the provider again. Existing successful claims return the original credit receipt. Redundant unused screenshot preparations are archived without deleting evidence. A different user's records are never returned.

Users see immediate top-right progress and outcome toasts in English or Amharic. Scanner failures now distinguish unavailable scanning, timeout, unreadable text and uncertain recognition. A single literal code can be extracted when OCR misses its label; low-confidence results are prefilled with a warning for the user to check; ambiguous codes, wrong-bank messages and invalid receipt URLs remain rejected. OCR only extracts a candidate; it never verifies or credits money.

Owner and Payments Operator can Reject an uncredited request directly in Deposits. Verification in progress cannot be rejected. Credited requests cannot be rejected or lose their financial evidence. Archive hides completed or rejected cases from the ordinary queue; the Archived investigation filter reveals them. Open disputes remain visible. Both actions are permission checked and audited. No permanent Delete action is introduced.

## Existing review cases

This update does not declare old mismatched or duplicate receipts paid. Open the original request, inspect its reason and verification evidence, and use the existing recovery action only for a correlated provider timeout. A frozen amount mismatch, unproven recipient, prior claim or uncorrelated external verification still requires investigation. Repeated new submissions do not resolve those conditions.

## Release and rollback

No schema migration, secrets or worker changes are required. Deploy the reviewed application revision to the web service after CI passes. Check that a fully matched test deposit shows CREDITED and an immutable balance receipt, updates the available balance, and produces one credit notification. Repeating that receipt must return the original result, not add money again. Run wallet:reconcile and inspect provider diagnostics if a request remains under review.

Rollback uses the previous application revision. Do not delete payment claims, journals, attempts or audit rows; credited funds use the existing audited reversal process if correction is needed. Archived records remain stored and can be inspected directly or reopened using case actions.

Local database/unit regression: 353 tests passed across 39 files with zero skipped (307.42 seconds), including automatic provider-derived credit, concurrent duplicate submission, retained evidence, permission checks, and real local OCR. Typecheck passed. All 18 payment-browser scenarios passed: 16 mobile scenarios plus the final 2 admin reruns with clean server shutdown. The first admin runs exposed an incomplete test fixture and an exact-label selector; both were corrected. The mobile checks assert top-right toast positioning, immediate progress, automatic wallet balance updates, OCR fallback and duplicate-request reuse. Production build and git diff --check passed. No live receipt, real transfer or production deployment has been validated by this patch.

Review captures: [mobile feedback](screenshots/deposit-feedback-mobile-360.png), [automatic credit](screenshots/simple-deposit-receipt-mobile-430.png), [archived evidence](screenshots/admin-redesign-deposit-archive-admin-laptop.png).

OCR follow-up: preserve the original upload instead of lossy browser JPEG compression, preserve tall screenshots, enlarge small text within the existing pixel budget, and use sparse receipt text layout. No character replacements or provider-validation changes. Runtime Logs on lowwin-web expose receipt_scan_completed / receipt_scan_failed with elapsed time and confidence/error status; no image, transaction reference, account, or credentials are logged.
