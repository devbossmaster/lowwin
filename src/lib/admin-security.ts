export const ADMIN_FRESH_MFA_MINUTES=30;
export const ADMIN_FRESH_MFA_MS=ADMIN_FRESH_MFA_MINUTES*60*1000;

export function isFreshAdminMfa(mfaAt:Date|null|undefined,now:Date){
 return !!mfaAt&&now.getTime()-mfaAt.getTime()<=ADMIN_FRESH_MFA_MS;
}
