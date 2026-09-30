// Keep the verification lease longer than both provider calls and the credit transaction.
export const PROVIDER_TIMEOUT_MS=45000;
export const PROVIDER_RECOVERY_TIMEOUT_MS=5000;
export const VERIFICATION_LEASE_MS=PROVIDER_TIMEOUT_MS+PROVIDER_RECOVERY_TIMEOUT_MS+30000;
