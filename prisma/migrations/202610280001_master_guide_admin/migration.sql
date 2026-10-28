-- Public registration creates pending members. Privilege is assigned only by
-- an operator in the database; existing Owner/MFA rows grant no new access.
ALTER TABLE "user" ADD COLUMN "role" text NOT NULL DEFAULT 'member';
ALTER TABLE "user" ADD CONSTRAINT "user_admin_role_check" CHECK ("role" IN ('member','admin'));
ALTER TABLE "StaffSession" ADD COLUMN "authMethod" text NOT NULL DEFAULT 'legacy';
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_auth_method_check" CHECK ("authMethod" IN ('legacy','email-password'));

-- A database role/email-verification change invalidates every current session.
-- The active role is also checked on each server-authorized admin operation.
CREATE FUNCTION revoke_master_admin_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."role" IS DISTINCT FROM NEW."role" OR OLD."emailVerified" IS DISTINCT FROM NEW."emailVerified" OR OLD.email IS DISTINCT FROM NEW.email THEN
  DELETE FROM "session" WHERE "userId"=NEW.id;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER master_admin_sessions_revoke AFTER UPDATE OF "role","emailVerified",email ON "user" FOR EACH ROW EXECUTE FUNCTION revoke_master_admin_sessions();
