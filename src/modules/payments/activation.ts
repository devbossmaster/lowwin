/** Server deployment switch. It does not replace provider or ledger verification. */
export function liveFundingConfigured(env:Record<string,string|undefined>=process.env){
 if(env.PAYMENTS_LIVE_ENABLED!=='true'||env.APP_ENV!=='production'||env.NODE_ENV!=='production'||env.CHECK_ET_MODE!=='live')return false;
 if(!env.CHECK_ET_LIVE_API_KEY||/REPLACE|CHANGE_ME|fixture/i.test(env.CHECK_ET_LIVE_API_KEY))return false;
 if(env.CHECK_ET_TEST_ENDPOINT||env.PAYMENTS_TEST_ENABLED==='true'||env.DEV_POINTS_ENABLED==='true'||env.DEV_IDENTITY_ENABLED==='true'||env.STAGING_DEMO_ENABLED==='true')return false;
 try{return new URL(env.BETTER_AUTH_URL??'').protocol==='https:'&&new URL(env.MINI_APP_URL??'').protocol==='https:'}catch{return false}
}
