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

### Contact-worker recovery

During the operator's real Telegram contact test, authenticated webhook delivery succeeded but the command worker was no longer running. Five updates remained pending with zero attempts, including four encrypted, valid same-user contact messages for the configured staging bot. A read-only check confirmed the existing contact keys could decrypt them and the restricted runtime had the required grants. No contact or identity was manually marked verified.

The authorized staging worker was restarted as a hidden, independent Windows process using `node.exe --import tsx scripts/worker.ts`. It processed all five queued updates: one contact was verified and three repeat contact messages were recognized as already verified. The queue then had zero pending updates and zero recorded errors. The linked contact matched the current bot and customer identity. The worker was still running at the follow-up check. The earlier process exit's exact cause was not established; its preceding database errors are caught by the worker loop and do not by themselves prove why it stopped.

The command worker must run alongside the web server; an HTTP 200 from the webhook means the update was stored, not that verification has completed. For local testing, run `npm.cmd run worker` in a separate terminal, or start the direct Node command above as an independent hidden process with separate output/error logs. Check for an existing worker first. A deployed environment requires a supervised command-worker service with restart and pending-queue monitoring; a local background process is not evidence of production supervision.

The operator can now reopen the staging Mini App or use Retry to read the committed contact status. Backend processing of the genuine contact is verified; the final handset screen still needs confirmation. Real merchant validation, Android/iOS checks and the separately approved production release remain outstanding.
