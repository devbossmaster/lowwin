# Onebid client-loading observations

Captured 25 October 2026 with the installed REA browser-scenario provider. This is an original analysis of previously captured public browser behavior; no additional competitor requests were made for this report. No third-party source code or assets were added to Lowwin.

## Evidence and limits

The complete flow is scenario `ev_d3e6baccbc6635d5eca33e3009baa938607518fc8a6345c5c418544b0d132251` in the local evidence file `D:/lowin-redesign-qa/onebid-client-20261025-full-evidence.json`. Its 315 retained events have no reported omissions. The earlier Home/script captures report incomplete event coverage and are used only for retained-script fingerprints. Script provenance is recorded in `D:/lowin-redesign-qa/onebid-client-scripts-20261025/manifest.json`.

The controlled flow used Chromium 155, a 390 × 844 viewport, English, reduced motion, blocked service workers, and an empty account/browser-storage state. It was a guest session: auction-entry buttons opened registration, and My Bids/Profile opened login. Authenticated auction details, accepted bids, wallet behavior and private navigation caching were therefore **not observed**. No authenticated recording was available in this task. No bids, payments, registrations or login forms were submitted.

## Observed requests and reuse

Four business API GETs occurred once each during the initial page step:

| Endpoint on `api.onebid.et` | Captured requests |
| --- | ---: |
| `/api/payment-methods/` | 1 |
| `/api/tenant/` | 1 |
| `/api/auctions/?status=open` | 1 |
| `/api/auctions/past/` | 1 |

Closing/reopening auction entry, visiting Draws, opening/dismissing the My Bids and Profile gates, and returning Home/Draws did not repeat those GETs or add a business API request. The final 2.5-second idle window also contained no requests. This is evidence of reuse within the captured short guest session; it does not establish cache lifetime, authenticated refetch policy, long-idle polling, or which caching mechanism served each view.

The first Draws navigation requested three route JavaScript chunks, followed by eight images. Repeat Draws navigation requested neither those chunks nor images again. Auction entry requested one image on its first opening; reopening did not repeat it. These observations support loading some route resources on demand and reusing them afterward. They do not prove a general image-lazy-loading or intent-prefetch policy.

There were nine automatic `POST /cdn-cgi/rum` requests across the flow, including ping/beacon traffic. These are analytics traffic and are counted separately from business API reads. Their presence is not evidence of bid/payment submissions or duplicate application fetching.

## Timing interpretation

| Captured action | Provider action duration |
| --- | ---: |
| First auction-entry click → registration gate capture | 177 ms |
| Repeat auction-entry click → gate capture | 64 ms |
| First Draws navigation action | 56 ms |
| Repeat Draws navigation action | 87 ms |
| My Bids login-gate action | 46 ms |
| Profile login-gate action | 52 ms |
| Return Home action | 107 ms |

These are REA action/capture durations, **not** instrumented click-to-first-paint, click-to-visible-sheet, or click-to-complete-data measurements. Snapshot collection and automation overhead are included; deliberate waits were separate steps. The complete scenario's initial page step took 3,118 ms, which likewise is not LCP, interactive readiness, or Telegram launch time. One short desktop run cannot establish mobile p95 latency or a speed advantage over Lowwin.

## Library evidence

The retained `queries-Y3yBN1XK.js` contains `QueryClientProvider`, `getQueryCache`, `queryKey`, `staleTime`, `gcTime`, and the distinctive missing-QueryClient diagnostic. Together these are strong evidence of TanStack Query client code. The retained main bundle also contains `prefetchQuery` and the `__TSR_ROUTER__` fingerprint, consistent with TanStack Router. No exact library version was established. Bundle presence alone does not prove execution of every feature, use of prefetching in this particular flow, or that every request uses the same library.

## Patterns applied to Lowwin

Lowwin reuses its existing TanStack-backed private query layer: deduplicated reads, bounded intent warming, retained visible content during refresh, and cached sheet reopen. Sheet structure and known card/row fields render immediately; missing fields load independently. My Bids receipts open from the accepted list record without a detail GET. Navigation preserves filters, page batches and scroll position. Countdown updates remain local, anchored to server time and receipt age.

These are Lowwin implementation choices informed by the observed reuse, not claims about Onebid's private implementation. Private payloads remain scoped to the authenticated user and session, clear at authorization boundaries, and use no-store responses. Confirmed financial changes invalidate affected data; server decisions still control money, eligibility and bid acceptance. No competitor financial rules, checkout behavior, wording or winner material was copied.
