# Isolated Lowwin deployment beside Gojo

Templates are prepared for review. No SSH alias or production hostname is configured in this workspace; no Hostinger service was installed or traffic changed. Verify the existing proxy, ports, memory and Gojo processes before applying anything. Never replace their configuration wholesale.

## Layout and resource budget

Create a dedicated unprivileged `lowwin` user. Use `/srv/lowwin/releases/<commit>`, an atomic `/srv/lowwin/current` symlink and `/srv/lowwin/shared`. Put secrets in `/etc/lowwin/runtime.env` (root-owned, group lowwin, mode 0640), never in a release or Git. Next listens only on `127.0.0.1:3210`. Confirm that port is free first. Reuse the current TLS proxy's port 443 rather than starting a competing proxy.

Build using Node 24 and the lockfile (`npm ci`, `npm run build`). Keep the required worker/OCR dependencies. Create `.next/cache` and `shared` before starting the services. Install `deploy/lowwin@.service` and `deploy/service.mjs`; create per-service `/etc/lowwin/{web,bot,auctions,notifications}.env` even when empty. These files can narrow database/application settings without duplicating secrets in command lines. Enable only the named Lowwin units after the release gate, never a wildcard restart of all services.

Budget one web pool of 5 connections plus 1 each for bot, auction and notification workers: 8 runtime connections, plus migration/backup headroom and the staging budget. Worker entrypoints cap their pools independently. Supabase transaction-pool URLs require the documented Prisma options. Do not solve network failures by opening unlimited connections.

The template caps each service at 1.5 GiB and one CPU core. Add systemd overrides of `MemoryMax=384M` and `CPUQuota=25%` for the three workers, and a parent Lowwin slice capped at 3 GiB / 200% CPU after checking Gojo's measured demand. Keep database-host connections separate from VPS RAM budgeting. Configure journald retention and disk alerts; logs must never contain receipts, signed Telegram data, contact values or credentials.

## Restricted database login

The current staging audit found `postgres` with `BYPASSRLS` and table ownership. Do not reuse that login for production runtime. Use a dedicated Lowwin database/project, not Gojo's database.

1. With the schema owner, deploy migrations then review/apply `deploy/runtime-role.sql`. It creates a non-login, non-owner, non-BYPASSRLS server group with access only to Lowwin tables. RLS policies explicitly permit this trusted **server** group; they do not replace per-user authorization in the app. Never grant it to Supabase `anon` or `authenticated`.
2. Create a separate `lowwin_app` login with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, set its generated password using a secure database console, and grant `lowwin_runtime` to it. Do not put the password in SQL history, terminal arguments or this repository.
3. Point web/workers' `DATABASE_URL` to that login. The migration job alone receives the schema-owner `DIRECT_URL`. Confirm the login is not a table/schema owner and cannot create tables, disable triggers, truncate financial tables or read `_prisma_migrations`.
4. Rehearse contact, sign-in, bid, v1/v2 close, funding test and reconciliation with the runtime login. Run the role grant script again after future additive migrations to cover new tables. Do not silently grant all future schema objects.

## TLS, uploads and request limits

Merge `deploy/nginx-lowwin.conf.example` into the existing nginx configuration only if nginx is the installed TLS proxy. Substitute the confirmed domain/certificate paths and run `nginx -t` before reload. Its zone declarations belong in `http {}`. Retain Gojo vhosts. For a different proxy, translate the same limits and test them before traffic.

The template overwrites forwarding headers, limits auth/API request rates, bounds request bodies and allows the authenticated receipt/admin image routes their documented sizes. The app applies tighter decoding/stream deadlines and identity limits. Test real TLS 413/429 responses, host routing, Telegram frame embedding and HTTP-to-HTTPS redirects. Add the existing proxy's certificate renewal and expiration monitoring; this template does not obtain a certificate.

## Backups and restore

Use a separate protected PostgreSQL service/password file and `deploy/backup.sh`. Install `age` and PostgreSQL 17 client tools; supply the age **public** recipient through `LOWWIN_BACKUP_RECIPIENT`. Keep the decryption key off the VPS and backed up separately with phone/MFA/delivery encryption keys. The script streams an encrypted custom-format dump to a protected directory; it never prints credentials or deletes old backups. Schedule it daily, replicate encrypted backups off-host, alert on failure or age over 26 hours, and apply an explicit retention policy only after verified replication.

Rehearse restore into a fresh isolated database with `age --decrypt | pg_restore --no-owner --no-acl --dbname=service=lowwin_restore`. The restore service must name a disposable database. Apply runtime grants there, compare migration/history/financial row counts, and run ledger/payment reconciliation. A successful dump alone is not a restore test. Record duration and recovery point. No production reseed or reset is permitted.

## Monitoring and rollback

Monitor HTTPS uptime, 5xx/auth failures, pool timeouts, queue age, failed jobs, closing delays, provider failures, backup age, certificate expiry and zero reconciliation drift. Alert delivery needs a named operator and tested destination. Run `npm run wallet:reconcile` with the restricted server role; any nonzero drift stops activation. The admin Jobs/Top-ups/Reconciliation pages provide investigation details without a balance editor or winner override.

Keep the last two compatible release directories. Drain only Lowwin, switch `current` to a known compatible release and restart only its units. After publishing a v2 auction, never roll back to a v1-only settlement worker. Keep the additive migration and financial rows. Disabling `PAYMENTS_LIVE_ENABLED` stops new credit attempts; use audited compensating operations for already committed credits.
