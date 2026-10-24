-- Supabase default privileges can grant EXECUTE directly to these browser roles.
-- Revoking PUBLIC alone does not remove those grants. Keep the existing owner,
-- lowwin_runtime, service and staff grants; do not change the cleanup routine.
-- One DO statement makes the revocations and effective-access check atomic.
DO $cleanup_acl$
DECLARE
  browser_role text;
BEGIN
  REVOKE EXECUTE ON FUNCTION public.cleanup_test_run(text) FROM PUBLIC;

  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION public.cleanup_test_run(text) FROM %I',
        browser_role
      );

      -- A direct revoke cannot cancel access inherited from another role.
      -- Stop for explicit review rather than revoke server-role membership or
      -- accidentally remove a legitimate service/staff grant with CASCADE.
      IF has_function_privilege(browser_role, 'public.cleanup_test_run(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Browser role % still has cleanup_test_run(text) execution access', browser_role
          USING ERRCODE = '42501',
                HINT = 'Review inherited privileges and the function owner before retrying this migration. Do not grant browser roles server-role membership.';
      END IF;
    END IF;
  END LOOP;
END
$cleanup_acl$;
