-- Database-managed User.role replaces the obsolete last-Owner bootstrap rule.
-- Historical staff/audit rows and financial foreign keys remain intact.
DROP TRIGGER IF EXISTS protect_last_owner ON "StaffMember";
