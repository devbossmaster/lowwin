-- Redacted provider-attempt correlation uses immutable Operation records.
CREATE INDEX "Operation_scope_requestHash_createdAt_idx" ON "Operation"("scope", "requestHash", "createdAt");
