-- READ ONLY staging inventory. Run with the migration reviewer, save redacted output.
-- This is NOT a grant script and was NOT run on remote Supabase.
SELECT current_database(), current_user, version();
SELECT n.nspname, c.relname, r.rolname AS owner, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname;
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' ORDER BY tablename,policyname;
SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' ORDER BY grantee,table_name,privilege_type;
SELECT p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' ORDER BY p.proname;
SELECT event_object_table,trigger_name,event_manipulation,action_timing
FROM information_schema.triggers WHERE trigger_schema='public'
ORDER BY event_object_table,trigger_name;
SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolcanlogin
FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','lowin_runtime','lowin_migration');
SELECT r.rolname,c.relname,has_table_privilege(r.oid,c.oid,'SELECT') AS can_read,
 has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
 has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,
 has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete,
 has_table_privilege(r.oid,c.oid,'TRUNCATE') AS can_truncate
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE r.rolname IN ('anon','authenticated','lowin_runtime') AND n.nspname='public' AND c.relkind='r';

-- Review before producing environment-specific grants:
-- 1. Runtime must not own tables, alter schema/triggers, TRUNCATE, BYPASSRLS,
--    create roles/databases, or inherit the migration role. Use a separate login.
-- 2. RLS policies must name only the reviewed server runtime role. Never grant
--    generic anon/authenticated policies over identity, financial or payment data.
-- 3. Append-only facts need SELECT/INSERT; avoid UPDATE/DELETE grants. Prisma
--    upsert behavior and each immutable trigger must be exercised with that role.
-- 4. Projection triggers run with invoker rights. LedgerAccount balance update
--    privilege and WalletHoldGuard INSERT/UPDATE are necessary; account_guard must
--    still reject direct balance changes. Do not make triggers SECURITY DEFINER
--    as an unreviewed shortcut. Review function EXECUTE and search_path explicitly.
-- 5. Better Auth needs scoped session/token/account changes, including session
--    deletion for revocation. Content/drafts and job metadata need scoped writes.
-- 6. Run real signed-session, staff MFA, hold/bid/settlement/payment integration
--    checks via the runtime role. Test denial through direct REST anon/authenticated
--    access and direct UPDATE/DELETE/TRUNCATE of immutable tables.
-- 7. Pooled runtime vs direct migration connections must be tested separately.
