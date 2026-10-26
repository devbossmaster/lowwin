-- Run with the schema owner on the dedicated Lowwin database after migrations.
-- No passwords or login creation here. Grant this group to a separate server login.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN CREATE ROLE lowwin_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN RAISE EXCEPTION 'Unsafe pre-existing lowwin_runtime role'; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,lowwin_runtime;
GRANT USAGE ON SCHEMA public TO lowwin_runtime;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['user','session','account','verification','rateLimit','VerifiedPhoneIdentity','TelegramOwnContact','ContactEvent','Wallet','CurrencyConversion','WalletHoldGuard','LedgerAccount','Journal','Posting','Operation','Category','Product','ProductImage','Auction','AuctionTerms','PublicAuctionResult','AuctionHold','Bid','TopUpIntent','PaymentPolicy','PaymentClaim','PaymentAttempt','PaymentStatementEntry','ExternalEvent','BotUpdate','Outbox','AuctionSettlement','SettlementMovement','PlayerProfile','AuctionFavorite','StaffMember','StaffSession','StaffTrustedDevice','StaffToken','OwnerBootstrap','AdminAudit','AuctionDraft','ManagedMedia','SiteContent','UserRestriction','SupportCase','FulfillmentCase','NotificationPreference','NotificationInbox','BotChat','TestRun','TestRunActor','TelegramMessage'] LOOP
  IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t AND tableowner='lowwin_runtime') THEN RAISE EXCEPTION 'Runtime must not own tables'; END IF;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO lowwin_runtime',t);
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='lowwin_server_access') THEN
   EXECUTE format('CREATE POLICY lowwin_server_access ON public.%I TO lowwin_runtime USING (true) WITH CHECK (true)',t);
  END IF;
 END LOOP;
END $$;
-- These tables were added after the original runtime-role inventory. Keep the
-- role useful when it is created after migrations, without granting mutations
-- on immutable revision and transfer-alias rows.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['AuctionFeeRevision','AuctionControlRevision','PaymentTransferAlias','AdminWalletCredit','ReferralInvite','ReferralCoupon','ReferralRedemption','ReferralRegistrationProof'] LOOP
  IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
   IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t AND tableowner='lowwin_runtime') THEN RAISE EXCEPTION 'Runtime must not own tables'; END IF;
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('GRANT SELECT,INSERT ON public.%I TO lowwin_runtime',t);
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='lowwin_server_access') THEN
    EXECUTE format('CREATE POLICY lowwin_server_access ON public.%I TO lowwin_runtime USING (true) WITH CHECK (true)',t);
   END IF;
  END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['VerifyRequest','VerifyWebhookEvent','ArifPayCheckout','ReferralPolicy','ReferralPendingSignup','ReferralSignup'] LOOP
  IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
   IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t AND tableowner='lowwin_runtime') THEN RAISE EXCEPTION 'Runtime must not own tables'; END IF;
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO lowwin_runtime',t);
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='lowwin_server_access') THEN
    EXECUTE format('CREATE POLICY lowwin_server_access ON public.%I TO lowwin_runtime USING (true) WITH CHECK (true)',t);
   END IF;
  END IF;
 END LOOP;
END $$;
-- Hosted Chapa storage is optional until its additive migration is reviewed.
-- Clear any default grants on these new tables before issuing minimal rights.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ChapaCheckout','ChapaWebhookEvent'] LOOP
  IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
   IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t AND tableowner='lowwin_runtime') THEN RAISE EXCEPTION 'Runtime must not own tables'; END IF;
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON public.%I FROM lowwin_runtime',t);
   EXECUTE format('GRANT SELECT,INSERT ON public.%I TO lowwin_runtime',t);
   IF t='ChapaCheckout' THEN EXECUTE format('GRANT UPDATE ON public.%I TO lowwin_runtime',t); END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='lowwin_server_access') THEN
    EXECUTE format('CREATE POLICY lowwin_server_access ON public.%I TO lowwin_runtime USING (true) WITH CHECK (true)',t);
   END IF;
  END IF;
 END LOOP;
END $$;
-- Migrations can run before this group exists. Restore its intended function
-- access explicitly, while keeping privileged cleanup unavailable to browsers.
GRANT EXECUTE ON FUNCTION public.cleanup_test_run(text) TO lowwin_runtime;
DO $$ DECLARE browser_role text; BEGIN
 REVOKE EXECUTE ON FUNCTION public.cleanup_test_run(text) FROM PUBLIC;
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE EXECUTE ON FUNCTION public.cleanup_test_run(text) FROM %I',browser_role);
   IF has_function_privilege(browser_role,'public.cleanup_test_run(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Browser role still has privileged cleanup access' USING ERRCODE='42501';
   END IF;
  END IF;
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO lowwin_runtime;
REVOKE ALL ON TABLE public."_prisma_migrations" FROM lowwin_runtime;
COMMIT;
