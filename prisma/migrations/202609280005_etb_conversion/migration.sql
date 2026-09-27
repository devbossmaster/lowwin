-- One historical point maps to one whole Ethiopian birr. Posted integers,
-- accepted bids, published auction terms and result proofs remain immutable.
CREATE TABLE "CurrencyConversion" (
  id text PRIMARY KEY,
  "fromUnit" text NOT NULL CHECK ("fromUnit" = 'POINT'),
  "toUnit" text NOT NULL CHECK ("toUnit" = 'ETB'),
  numerator bigint NOT NULL CHECK (numerator = 1),
  denominator bigint NOT NULL CHECK (denominator = 1),
  "effectiveAt" timestamp(6) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  "reason" text NOT NULL
);
INSERT INTO "CurrencyConversion" (id,"fromUnit","toUnit",numerator,denominator,"reason")
VALUES ('legacy-points-etb-v1','POINT','ETB',1,1,'Owner-directed 1 legacy integer point = ETB 1.00. No ledger or published-term rewrite.');
CREATE TRIGGER immutable_currency_conversion BEFORE UPDATE OR DELETE ON "CurrencyConversion"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
ALTER TABLE "CurrencyConversion" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "CurrencyConversion" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "CurrencyConversion" FROM authenticated; END IF;
END $$;
