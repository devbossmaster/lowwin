-- Apply only after the legacy login retirement and a private backup of ALL
-- rows in these three obsolete tables. Historical User, StaffMember,
-- StaffSession and AdminAudit identities remain intact.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

-- The old trigger references the device table and must retire with it.
DROP TRIGGER IF EXISTS staff_devices_revoke ON "StaffMember";
DROP FUNCTION IF EXISTS revoke_staff_devices();

-- Retain the unused scalar temporarily for compatibility with historical
-- reset tooling, but remove its reference to the retired device table.
ALTER TABLE "StaffSession"
  DROP CONSTRAINT IF EXISTS "StaffSession_trustedDeviceHash_fkey";

-- No CASCADE: an unexpected remaining dependency must abort this migration.
DROP TABLE "StaffToken";
DROP TABLE "StaffTrustedDevice";
DROP TABLE "OwnerBootstrap";
COMMIT;
