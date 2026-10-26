# Bid sheet reference layout

The bid sheet now follows the supplied compact reference: centered product title; a two-line preview in a rounded gray description panel; one gray fee/count/countdown strip; a rounded input; a real available-balance note; and a gray payment panel containing two equal white pills for Chapa and Wallet. The Wallet pill retains a separate plus action that opens the existing top-up sheet. Chapa uses its official self-hosted wordmark. Existing Lowwin payment action styling is retained.

The chosen bid number remains distinct from the actual submission fee. Published limits, fee versions, local countdowns, earned-discount controls, server-authoritative acceptance, idempotency and private query behavior are unchanged. Unknown wallet balances retain field-level loading/unavailable states. Receipt, pending-payment and top-up layouts remain independent of the scoped bid-entry styles.

## Focused verification

Full typecheck passed. The payment-client, discount-preview and exact-reset-review unit checks passed (28 tests). The reset approval change also passed both the 31-migration and current-schema isolated financial rehearsals; no production SQL was executed.

The final local Chromium run passed both 360 × 800 and 430 × 932 cases, each in English and Amharic. It checked equal horizontal payment pills, complete initial content without internal body scrolling, a real zero wallet balance, disabled insufficient-wallet submission, Chapa selection, plus-to-top-up, Escape dismissal, preserved bid input, keyboard visibility and absence of horizontal overflow. No bid or payment was submitted; no wallet was created for the fixture user; the ledger reconciled without drift. Final browser page-error arrays were empty.

These screenshots use synthetic auction/account records in an isolated loopback PostgreSQL database. Only the payment-capability GET response was mocked to display the ready payment choices; actual backend payment switches stayed disabled. The test did not contact Chapa, create a payment or establish production readiness. A preceding development run encountered a transient Next.js chunk-load error; a fresh-server rerun passed with the error assertion retained.

- [Chapa, English, 360px](bid-entry-polish/chapa-en-360.png)
- [Wallet at zero, Amharic, 360px](bid-entry-polish/wallet-zero-am-360.png)
- [Chapa, English, 430px](bid-entry-polish/chapa-en-430.png)
- [Chapa, Amharic, 430px](bid-entry-polish/chapa-am-430.png)
- [360px assertions](bid-entry-polish/evidence-360.json), [430px assertions](bid-entry-polish/evidence-430.json)

Run with a migrated disposable loopback `TEST_DATABASE_URL` ending in `_test`:

```powershell
npx.cmd playwright test --config playwright.bid-modal.config.ts
```
