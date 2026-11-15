# Mobile navigation, bid review and Telegram sign-in

15 November 2026.

- Mobile navigation is Home → My Bids → raised blue Bid → Winners → Me. Bid opens the existing auction picker. LowWin fonts, blue actions, registered-account visibility, private-route checks and desktop navigation are preserved.
- Multiple chosen numbers now open a compact review before payment choices: selected numbers, count, fee per bid, submission fees, applicable discount and total payable. A single number goes directly to payment choices. Review uses the same native dialog, preserving focus and avoiding stacked modals.
- Continue includes a valid number still typed in the input. Edit and Back preserve the numbers, payment method and payer phone. The review performs no charge or quote request. Only the final explicit Pay can submit payment; double-click fall-through from Continue is ignored.
- Telegram now requests native fullscreen when the real launch SDK is ready on supported API 8+ clients. Older/unsupported clients fall back to expanded height. Resume and late SDK loading are handled, explicit fullscreen exit is respected, and normal browsers are unaffected. Content widths and component sizing are unchanged. This presentation signal never substitutes for server authentication.

## Validation

- 39 focused navigation/SDK tests passed.
- Production build and its TypeScript check passed in 80.9 seconds.
- Final production-mode browser run: 4/4 passed in 16.7 seconds, English/Amharic at 360px and 430px. Checked centered raised Bid, touch targets, picker opening, single-number bypass, typed second number, review fee total, Edit/Back preservation, no pre-Pay charge and one explicit wallet debit.
- The first browser run had a fixture failure: switching an uncharged external quote to Wallet used the existing-batch endpoint, which the fixture incorrectly returned as 404. The fixture was updated to support that owned quote; the full four-case run then passed. No application change was required for that failure.
- Layout detector returned no findings; current screenshots were visually inspected.

Physical fullscreen behavior remains a Telegram-device check. No deployment, live payment or production database change was performed.

## Browser sign-in latency

The authentication factory rebuilt Better Auth and its Telegram OIDC provider on every request. The installed Telegram provider creates its remote signing-key cache when the provider is constructed. Rebuilding it discarded that cache, adding an avoidable signing-key HTTP request after approval even for warm sign-ins.

The factory now retains one configuration-matched instance per full Prisma client. It does not retain interactive transaction clients, authentication responses, sessions, user records or verified claims. Credential, origin and other configuration changes replace the instance. Request-local identity proof and secure database-backed sessions remain separate for every request; session-cookie caching remains disabled.

Callbacks expose duration-only `Server-Timing` measurements for token exchange, profile verification, identity preparation, session binding and total handling. They contain no credentials or identities. Telegram approval, token exchange, first-use signing-key retrieval and database latency still apply; no production end-to-end timing or speed guarantee was measured locally.

Validation: 65/65 focused authentication tests passed. The local PostgreSQL/RSA integration suite passed 26/26 in 4.56 seconds, including separate concurrent identities, existing account/wallet continuity, callback replay, cancellation, unsafe redirects, invalid signature/nonce/issuer/audience/expiry and expired sessions. Two independent callbacks made two code exchanges but only one signing-key fetch. Multiple Set-Cookie headers survived the timing wrapper unchanged.

Final validation after the auth changes: standalone typecheck passed and the production build passed in 66.3 seconds. This supersedes the earlier 80.9-second UI-only build. The mobile UI checks did not require another run because only server authentication and its tests changed afterward.
