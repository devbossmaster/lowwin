# Local Home and browser sign-in repair

Read-only checks on November 13, 2026 found two independent configuration/schema blockers behind the reported localhost screenshots.

## Home data

The configured Supabase pooler is reachable. Its public Home read functions fail with `P2021` because `public.WinnerPresentation` and `public.ResultPublication` do not exist. `DepositBonusPolicy` and the new browser-login columns are also absent. The initial sandbox connection restriction was not the underlying application fault.

These objects are introduced by existing migrations, including `202610300001_result_publication`, `202610300003_winner_presentation`, `202611130001_deposit_bonus` and `202611130002_telegram_browser_login`. Later migrations depend on the older ones; use the normal migration history in order. Do not infer the complete pending list from these four missing objects.

The original connections used a restricted role that could not inspect `_prisma_migrations`. That is an intentional runtime boundary. An authorized migration job needs its separate schema-owner `DIRECT_URL` for the same intended database. Inspect and apply pending migrations there:

```sh
npx prisma migrate status
npm run db:migrate
```

Generate the Prisma client during the normal build (`npm run db:generate` locally if needed), then restart the updated application/services. On Windows, stop the dev server before generating if Prisma reports a locked engine file.

The user then identified `kgwjolbhtvfwuohrtjya` as the test project and explicitly authorized migrations. After privately updating its session-pooler owner connection, a target guard confirmed that both configured URLs belonged to that exact project. All 38 existing migration checksums matched. The three retired legacy tables were empty. A 369,991-byte custom-format backup of the public schema/data was saved under ignored `.local/test-project-backups/` before mutation.

All 15 pending migrations applied successfully in their existing order. The final read-only audit reports 53 applied migrations, zero pending, zero failed and zero checksum mismatches. No database reset, application seed, payment, broadcast or production deployment was performed. All six actual Home loaders now succeed: clock, categories, auctions, winners, content and experience. Actual localhost Home returns HTTP 200 and renders its sections without broken images or a page exception. Test inventory and clearly marked existing demo results remain test data.

Home now keeps its existing brand banner, instructions and footer visible when initial data fails, with explicit unavailable sections and Retry. Missing data is not presented as zero auctions, empty winners or an invented balance, and fallback data is not written to public caches. Existing cached Home data remains visible during a refresh failure. Server logs record a sanitized `home_data_unavailable` code/hint without SQL, credentials or customer records.

## Browser Telegram login

The local configuration is missing `TELEGRAM_LOGIN_CLIENT_ID` and `TELEGRAM_LOGIN_CLIENT_SECRET`; `TELEGRAM_LOGIN_ENABLED` is not true. Consequently the configuration endpoint truthfully returns `enabled:false` and `configured:false`. This endpoint does not query the database.

Obtain the existing bot's credentials from **BotFather → bot → Login Widget / OpenID Connect**, register the actual website origin and exact `/api/auth/callback/telegram-oidc`, and configure privately:

```dotenv
TELEGRAM_LOGIN_ENABLED=true
TELEGRAM_LOGIN_CLIENT_ID=<BotFather Client ID>
TELEGRAM_LOGIN_CLIENT_SECRET=<BotFather Client Secret>
```

The current canonical origin is HTTPS and differs from `http://localhost:3000`; the current `APP_ENV` also does not permit local HTTP authentication. For an actual local browser sign-in test, use a registered HTTPS development origin/tunnel consistently in `BETTER_AUTH_URL`, `MINI_APP_URL` and the address you open. Keep its callback registered separately from production. The ordinary localhost UI can still be previewed without enabling sign-in. Never paste the Client Secret, bot token or database credentials into chat.

See [browser login setup](telegram-browser-login.md) and [Telegram's official allowed-URL and OIDC instructions](https://core.telegram.org/bots/telegram-login).

The user chose to keep browser sign-in unavailable for now. Missing setup is displayed clearly with an **Open Lowwin in Telegram** action instead of an unusable sign-in button and repeated configuration retry. Readiness fetches are bounded to eight seconds, cancel when the sheet closes, and permit a clean retry after a transport failure. The public configuration route no longer imports the session/database login handler. Credentials and browser-login gates were not enabled or invented.

The Telegram Mini App retains native **Share contact**, with server-confirmed self-contact proof. A route-intercepted localhost check at 430px confirmed one native `requestContact` call, no OAuth/browser-login request, disabled repeat submission, truthful cancellation and working Close. That fixture made no server mutations or external Telegram calls; it does not replace physical-device consent testing.

## Responsive and visual repair

- The initial `detecting` state reserves browser layout through a separate presentation-only `data-app-layout` attribute. Authentication still uses the actual environment. Desktop Home skeletons fill the content width and use the catalog grid; phones and confirmed Mini Apps retain compact geometry.
- Winners content now matches its 860px desktop header. The general error fallback is a compact bilingual card, reports offline only when the browser reports it, retries the route and handles a missing logo gracefully. The earlier screenshot's exception no longer reproduced after migration; no unverified exception cause is claimed.
- Versioned 1840×800 blue-black banners show the family in front, packaged iPhone Pro Max and PS5 Slim products. The shared LW logo is blue. All four image assets return HTTP 200 with correct MIME types. Provenance is in `public/images/BLUE-BRAND-SOURCES.md`.
- Banner actions sit at the lower left within the banner; phones retain the full artwork above a compact dark action edge so controls do not cover the campaign copy. The Home logo and Lowwin name sit horizontally together.
- How bidding works is reduced to three short instructions, a compact example and fee-only clarification. Remaining dark interactive backgrounds use blue or neutral controls; informational dark surfaces retain their contrast.

Latest focused loading, public-login client/protocol, Home availability and proxy checks: **84 passed**. Full-project TypeScript and the final optimized webpack production build passed, including the last requested header, guide and banner-control refinements. The build emitted non-blocking dependency-cache snapshot warnings; compilation, type validation, static generation and build traces completed. Responsive fixture and localhost evidence remains under ignored `.local/` directories; credentials and database backups are not repository artifacts.

The latest responsive checks also passed 18 header combinations (320/360/430px, English/Amharic, guest/normal/long balance). The shortened guide is under 400px tall at 320px in both languages. Actual Home at 320px and 1280px has no dark interactive controls, page overflow or JavaScript errors. Banner controls remain inside the banner without obscuring its full image. Browser sign-in settles to the intentional unavailable state in roughly one second for the complete open/check/capture/close sequence; that is not a provider-login or API-latency benchmark. A deliberately stalled configuration request reached retry at approximately nine seconds including test observation, then one explicit retry recovered. Three requests were observed across that development test: two before retry, one after; no production remount cause is inferred.
