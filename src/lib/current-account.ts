import type {MiniAccount} from './mini-auth-client';

export const CURRENT_ACCOUNT_PATH='/api/me';
export const CURRENT_ACCOUNT_QUERY_KEY=['lowwin-session','current-account'] as const;
export const CURRENT_ACCOUNT_STALE_MS=60_000;

/** A render-time projection of the live session. It carries no credential. */
export type BrowserAccountBootstrap=
 | {kind:'verified';account:MiniAccount}
 | {kind:'guest'|'client-check'|'unavailable'};
