// Server-only contract for a future reviewed provider. No provider is registered,
// no public funding endpoint exists, and verification alone does not issue points.
export type VerifiedFundingEvent = Readonly<{
  provider: string; externalId: string; intentId: string; payloadHash: string;
  state: 'CONFIRMED' | 'FAILED' | 'REVERSED'; verifiedAt: Date;
}>;
export interface FundingProvider {
  createIntent(input: { intentId: string; userId: string; policyVersion: string }): Promise<{ providerIntentId: string; checkoutUrl: string }>;
  verifyEvent(rawBody: Uint8Array, headers: Headers): Promise<VerifiedFundingEvent>;
}
export function getFundingProvider(): never { throw new Error('Top-ups are not enabled. Provider and issuance policy require owner review.'); }
