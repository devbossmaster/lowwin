# Checkout continuation: OTP feedback and USSD fixtures

Resumed the interrupted `Redesign Lowin Telegram Mini App` conversation on 17 November 2026. The recovered chat stopped after a connection failure with the OTP status race and USSD browser fixture changes still uncommitted on `feat/responsive-chapa-confirmation-20261117`, based on `19b5de240a80e44ed82d28870b0885f6f8db9929`.

## Result

A delayed status response for the same pending OTP challenge no longer erases `INVALID_OTP` feedback. The message and invalid-field state remain visible until another explicit submission, a changed checkout/challenge, or authoritative progress. Existing account isolation, stale-snapshot guards and server fulfillment requirements still apply.

The browser regression holds an owned status response, rejects an OTP, then releases that response and waits for its distinct title to render before asserting that the rejection remains. It then submits another code and requires accepted bid receipts before showing completion. The USSD fixture waits for settled requests around fake-clock advances and checks that a failed foreground snapshot read backs off without immediately dispatching a verification POST.

## Verification

- 58 focused tests passed across OTP feedback, Chapa client, observer, Inline client and status suites; no failures or skips.
- `npm.cmd run typecheck` passed.
- A fresh Next.js 16.4.6 production build from this workspace passed. The earlier cross-drive dependency-junction build had failed before testing the fix.
- The deterministic OTP browser regression passed once at 360px against that rebuilt bundle. The saved baseline run had failed when the delayed response removed the rejection message.
- Existing USSD before/after browser runs each passed once at 360px. Those results are separate runs, not a new full browser-suite aggregate.
- Impeccable's mechanical check for `src/components/chapa-payment.tsx` returned no findings; `git diff --check` passed.

All browser payment responses were fixtures; provider calls and real charges were disabled. The fresh loopback test database was dropped. Local evidence is under `.local/resume-otp-unit-20261117.*`, `.local/resume-otp-typecheck-20261117.log`, `.local/chapa-otp-race-after-20261117-*` and `.local/ussd-ci-review-{before,after}-summary.json`.

## CI and release limits

GitHub run [44055116347](https://github.com/devbossmaster/lowwin/actions/runs/44055116347) for the base commit completed: foundation (including unit tests, TypeScript and production build), security, static/secrets, admin browser and payment-stream broker passed. Payment browser failed on the two cases addressed here (82 passed, two failed, 11 intentional skips). The separate redesign browser job was cancelled. These local focused passes do not establish a green hosted run for the uncommitted changes or close the [redesign gate](evidence/chapa-redesign-ci-gates-2026-11-17.json).

No merge, production migration, deployment or payment-provider activation was performed.

## Inline versus Direct

Keep the current v2 Inline REST flow. Fresh review of Chapa's [Direct initialization](https://docs.chapa.global/docs/v2/direct-charge/initiate-payment) and [authorization](https://docs.chapa.global/docs/v2/direct-charge/authorize-payment) contracts confirms that Direct can support the same USSD/OTP UI. Current Direct transport already matches the documented payload, while new Direct creation is deliberately retired and historical recovery remains supported.

Earlier Direct TEST probes returned the same `400 INVALID_VALUE` / `payable not found` rejection as Inline. They used earlier credentials; a Direct comparison with the updated TEST pair has not been run. There is no demonstrated provider benefit from switching. Resolve business/key binding, operational TEST availability and the provider's payable prerequisite using the [support handoff](chapa-test-support-handoff-2026-11-17.md), then prove initialization, authorization, private verification and exactly-once fulfillment. Documentation review and fixture tests do not establish provider acceptance.
