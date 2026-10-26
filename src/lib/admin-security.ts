export const ADMIN_SESSION_HOURS=8;
export const ADMIN_SESSION_MS=ADMIN_SESSION_HOURS*60*60*1000;
export const ADMIN_CHALLENGE_MS=15*60*1000;

/** Only a TOTP-verified login grants staff access; a device cookie never does. */
export function adminSessionExpiry(grant:{credentialAt:Date;mfaAt:Date|null;expiresAt:Date},sessionExpiresAt:Date,now:Date){
 const credential=grant.credentialAt.getTime(),mfa=grant.mfaAt?.getTime();
 const end=Math.min(credential+ADMIN_SESSION_MS,grant.expiresAt.getTime(),sessionExpiresAt.getTime());
 return Number.isFinite(credential)&&mfa!==undefined&&Number.isFinite(mfa)&&mfa>=credential&&mfa<=now.getTime()&&end>now.getTime()?new Date(end):null;
}
