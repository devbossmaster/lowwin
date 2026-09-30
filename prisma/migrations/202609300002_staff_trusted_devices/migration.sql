BEGIN;
CREATE TABLE "StaffTrustedDevice" (
 "tokenHash" text PRIMARY KEY,
 "userId" text NOT NULL REFERENCES "StaffMember"("userId") ON DELETE CASCADE,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" timestamp(3) NOT NULL,
 CHECK ("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '30 days')
);
CREATE INDEX "StaffTrustedDevice_userId_idx" ON "StaffTrustedDevice"("userId");
ALTER TABLE "StaffSession" ADD COLUMN "trustedDeviceHash" text REFERENCES "StaffTrustedDevice"("tokenHash") ON DELETE SET NULL;
ALTER TABLE "StaffTrustedDevice" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "StaffTrustedDevice" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "StaffTrustedDevice" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "StaffTrustedDevice" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON "StaffTrustedDevice" TO lowwin_runtime;
  CREATE POLICY lowwin_server_access ON "StaffTrustedDevice" TO lowwin_runtime USING (true) WITH CHECK (true);
 END IF;
END $$;
-- Role changes, suspension, and authenticator replacement revoke every device.
CREATE FUNCTION revoke_staff_devices() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.active IS DISTINCT FROM OLD.active OR NEW.role IS DISTINCT FROM OLD.role OR NEW.secret IS DISTINCT FROM OLD.secret THEN
  DELETE FROM "StaffTrustedDevice" WHERE "userId"=OLD."userId";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_devices_revoke AFTER UPDATE ON "StaffMember" FOR EACH ROW EXECUTE FUNCTION revoke_staff_devices();
COMMIT;
