# LowWin new VPS recovery

Use a fresh Ubuntu 24.04 LTS KVM with 4 vCPU, 8 GB RAM, at least 80 GB NVMe,
and a public IPv4 address. This recovery uses a new Supabase production project
and intentionally starts with no old application data.

## 1. Provider firewall

Open TCP 22, 80, 443, 8000, 6001, and 6002. Restrict 22 to the operator IP when
possible. After the Coolify dashboard has its own HTTPS domain, close public
8000, 6001, and 6002.

## 2. Install Coolify

SSH to the fresh server as root and run:

```sh
apt update && apt upgrade -y
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Immediately open `http://SERVER_IP:8000`, create the first administrator, and
back up `/data/coolify/source/.env` off-server.

## 3. Create resources

Create project `Low Win`, then create these five resources in order:

1. `lowwin-redis`
2. `lowwin-web`
3. `lowwin-bot`
4. `lowwin-auctions`
5. `lowwin-notifications`

Use repository `devbossmaster/lowwin`, branch `main`, base directory `/`,
Railpack, install command `npm ci --include=dev`, and auto-deploy off during
recovery.

| Resource | Build command | Start command |
| --- | --- | --- |
| lowwin-web | `npm run build` | `npm start -- --hostname 0.0.0.0 --port 3000` |
| lowwin-bot | `npm run db:generate` | `npm run worker` |
| lowwin-auctions | `npm run db:generate` | `npm run worker:auctions` |
| lowwin-notifications | `npm run db:generate` | `npm run worker:notifications` |

Add a named volume `lowwin-media-cache` to `lowwin-web`, mounted at
`/srv/lowwin/shared/media-cache`. Expose port 3000 only through Coolify; do not
add a host port mapping. Workers have no domain or health check.

## 4. Fresh Supabase database

Create the new Supabase project and save its database password privately. Copy
both connection strings from **Connect**:

- direct or session URL on port 5432 for migrations;
- transaction-pool URL on port 6543 for application runtime.

From a trusted terminal with the repository installed, apply every committed
migration to the empty project:

Apply migrations once with the separate migration URL:

```sh
DIRECT_URL='<MIGRATION_OR_SESSION_URL>' DATABASE_URL='<RUNTIME_URL>' npm run db:migrate
```

Apply `deploy/runtime-role.sql` as the schema owner. Generate a new runtime
password and create the restricted login:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
MIGRATION_DIRECT_URL='<MIGRATION_OR_SESSION_URL>' LOWWIN_APP_PASSWORD='<NEW_PASSWORD>' npm run db:create-runtime-login
```

Construct the runtime transaction-pool URL for the new `lowwin_app` login using
the exact host and project-specific username format from Supabase. Store only
that restricted URL in normal resources. Do not save the migration password in
Coolify applications.

## 5. Startup

Start Redis and web first. In the web terminal run:

```sh
node --version
npm run db:check
npm run redis:check
npm run wallet:reconcile
```

Only after all checks succeed, start the bot, auction, and notification workers.
Then run this once from the web terminal:

```sh
npm run bot:setup
```

Update the BotFather Mini App URL to `https://lowwin.shop/telegram`, point the
`@` and `www` DNS A records at the new IPv4 address, and validate HTTPS before
enabling payments.

## 6. First Owner and catalog

With Resend configured and verified, run once in the web terminal:

```sh
ADMIN_BOOTSTRAP_ENABLED=true npm run admin:bootstrap -- --email <OWNER_EMAIL>
```

Accept the invitation, enroll MFA, save recovery codes, and leave
`ADMIN_BOOTSTRAP_ENABLED=false` in the normal resource. Create production
categories, products, images, receiving accounts, and auctions through the
admin interface. Never run the DEMO catalog seed against this project.
