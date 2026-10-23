# Dedicated staging readiness

The operator selected a new, separate database for local/staging testing. The retained production database was not replaced, migrated, seeded or cleaned up during this setup.

## Database

- Both connection strings were checked against the same new project and excluded the retained projects before any write.
- The application schema was confirmed empty before initialization. All 33 versioned migrations are applied; migration history was checked on resume. No fixture or catalog seed was run.
- The runtime login has no superuser, BYPASSRLS, database creation, role creation, replication, schema-object creation or migration-history read privilege. It inherits the reviewed runtime group.
- All 83 custom triggers are enabled. Browser roles cannot execute privileged cleanup; the server runtime retains its existing permission. No cleanup function was invoked.
- Read-only ledger and payment reconciliation returned zero drift. The initial staging snapshot had zero customers, auctions, bids and payment intents.
- Normal application connections use the restricted login. The schema-owner connection is encrypted with Windows user-scoped DPAPI outside the checkout, with restoration verified. It is not retained in the normal application environment. A reviewed future migration job must separately obtain that protected credential.
- Funding and development-credit switches remain disabled.

Provisioning uses the tested order: migrations, `deploy/runtime-role.sql`, then a separate runtime login. The role script also supports a group created before migrations. Five PostgreSQL regressions cover provisioning order, exact grants, RLS, denied operations and rollback. Ten additional CLI regressions cover safe creation, credential rotation, unsafe-role rejection and redacted diagnostics. The local non-superuser test reproduced a privileged-attribute ALTER rejection; this is not proof of the earlier managed-provider failure's cause.

## Local application and Telegram

The local Next development server was restarted against the restricted staging configuration. The dedicated staging command worker was started after explicit operator authorization for its automatic Telegram replies. No production service was restarted.

Read-only Bot API inspection confirmed the configured staging bot identity, webhook address and Mini App menu. The public HTTPS liveness route returned 204; unauthenticated contact/catalog requests returned 401; an empty launch input returned 401; invalid webhook-secret requests returned 403 through both local and public routes. No synthetic customer was registered remotely for these checks.

After compilation, the local `/telegram` request observed 167 ms. The initial development compilation request took about 47 seconds. Neither is a physical Telegram launch measurement or production API p95. Before initialization, workstation-to-staging warm database reads observed about 1.2–1.3 seconds. These values do not establish provider payment latency.

The operator must reopen the staging Mini App with a genuine Telegram launch and share their own contact to verify the complete real-device flow. New staging data starts empty. Real merchant validation, Android/iOS checks and the separately approved production release remain outstanding.
