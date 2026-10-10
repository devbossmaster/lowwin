// Keep the verification lease longer than both provider calls and the credit transaction.
export const PROVIDER_TIMEOUT_MS=45000;
export const PROVIDER_RECOVERY_TIMEOUT_MS=5000;
// Verification includes duplicate checks and in-transaction reauthorization.
// A remote database can exceed Prisma's default 5s before those reads finish.
// Provider HTTP calls must remain outside these bounded database transactions.
export const PAYMENT_TRANSACTION_OPTIONS={maxWait:10000,timeout:30000} as const;
export const VERIFICATION_LEASE_MS=PROVIDER_TIMEOUT_MS+PROVIDER_RECOVERY_TIMEOUT_MS+30000;
