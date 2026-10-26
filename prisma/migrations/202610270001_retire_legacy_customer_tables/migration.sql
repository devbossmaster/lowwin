-- Apply only after the reviewed clean-start procedure. An application redesign
-- is not permission for a migration to discard unreviewed legacy records.
BEGIN;
DO $$ DECLARE legacy text; occupied boolean; BEGIN
 FOREACH legacy IN ARRAY ARRAY['VerifiedPhoneIdentity','ExternalEvent','SupportCase'] LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I)',legacy) INTO occupied;
  IF occupied THEN RAISE EXCEPTION 'Legacy table % still has records: complete the reviewed cleanup before this migration',legacy; END IF;
 END LOOP;
END $$;
DROP TABLE "VerifiedPhoneIdentity";
DROP TABLE "ExternalEvent";
DROP TABLE "SupportCase";
COMMIT;
