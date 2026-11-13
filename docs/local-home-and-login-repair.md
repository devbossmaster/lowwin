# Local Home and browser sign-in repair

Read-only checks on November 13, 2026 found two independent configuration/schema blockers behind the reported localhost screenshots.

## Home data

The configured Supabase pooler is reachable. Its public Home read functions fail with `P2021` because `public.WinnerPresentation` and `public.ResultPublication` do not exist. `DepositBonusPolicy` and the new browser-login columns are also absent. The initial sandbox connection restriction was not the underlying application fault.

These objects are introduced by existing migrations, including `202610300001_result_publication`, `202610300003_winner_presentation`, `202611130001_deposit_bonus` and `202611130002_telegram_browser_login`. Later migrations depend on the older ones; use the normal migration history in order. Do not infer the complete pending list from these four missing objects.

Both configured connections use a restricted role that cannot inspect `_prisma_migrations`. That is an intentional runtime boundary. An authorized migration job needs its separate schema-owner `DIRECT_URL` for the same intended database. Inspect and apply pending migrations there:

```sh
npx prisma migrate status
npm run db:migrate
```

Generate the Prisma client during the normal build (`npm run db:generate` locally if needed), then restart the updated application/services. On Windows, stop the dev server before generating if Prisma reports a locked engine file. No remote migrations, grants, seeds or data changes were performed during this diagnosis.

Home now keeps its existing brand banner, instructions and footer visible when initial data fails, with explicit unavailable sections and Retry. Missing data is not presented as zero auctions, empty winners or an invented balance, and fallback data is not written to public caches. Existing cached Home data remains visible during a refresh failure. Server logs record a sanitized `home_data_unavailable` code/hint without SQL, credentials or customer records.

## Browser Telegram login

The local configuration is missing `TELEGRAM_LOGIN_CLIENT_ID` and `TELEGRAM_LOGIN_CLIENT_SECRET`; `TELEGRAM_LOGIN_ENABLED` is not true. Consequently the configuration endpoint truthfully returns `enabled:false` and `configured:false`. This endpoint does not query the database.

Obtain the existing bot's credentials from **BotFather → bot → Login Widget**, register the actual website origin and exact `/api/auth/telegram/browser/callback`, and configure privately:

```dotenv
TELEGRAM_LOGIN_ENABLED=true
TELEGRAM_LOGIN_CLIENT_ID=<BotFather Client ID>
TELEGRAM_LOGIN_CLIENT_SECRET=<BotFather Client Secret>
```

The current canonical origin is HTTPS and differs from `http://localhost:3000`; the current `APP_ENV` also does not permit local HTTP authentication. For an actual local browser sign-in test, use a registered HTTPS development origin/tunnel consistently in `BETTER_AUTH_URL`, `MINI_APP_URL` and the address you open. Keep its callback registered separately from production. The ordinary localhost UI can still be previewed without enabling sign-in. Never paste the Client Secret, bot token or database credentials into chat.

See [browser login setup](telegram-browser-login.md) and [Telegram's official allowed-URL and OIDC instructions](https://core.telegram.org/bots/telegram-login).
