/** Server deployment switch. It does not replace provider or ledger verification. */
export function liveFundingConfigured(env:Record<string,string|undefined>=process.env){
 // An existing Coolify main-branch webhook can deploy before the additive migration.
 // Keep both web submissions and the verification worker off until the schema is ready.
 if(env.PAYMENTS_LIVE_ENABLED!=='true'||env.VERIFY_ET_SCHEMA_READY!=='true'||env.APP_ENV!=='production'||env.NODE_ENV!=='production')return false;
 if(!env.VERIFY_ET_API_KEY||!env.VERIFY_ET_WEBHOOK_SECRET||/REPLACE|CHANGE_ME|fixture/i.test(env.VERIFY_ET_API_KEY))return false;
 if(env.VERIFY_ET_TEST_ENDPOINT||env.PAYMENTS_TEST_ENABLED==='true'||env.DEV_POINTS_ENABLED==='true'||env.DEV_IDENTITY_ENABLED==='true'||env.STAGING_DEMO_ENABLED==='true')return false;
 try{return new URL(env.BETTER_AUTH_URL??'').protocol==='https:'&&new URL(env.MINI_APP_URL??'').protocol==='https:'}catch{return false}
}
