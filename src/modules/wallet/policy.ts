/** Internal-wallet availability is independent of every external gateway. */
export function walletBidsEnabled(raw:Record<string,string|undefined>=process.env){
 if(raw.WALLET_BIDS_ENABLED!=='true'||raw.DEV_IDENTITY_ENABLED==='true'||raw.STAGING_DEMO_ENABLED==='true')return false;
 return raw.APP_ENV==='production'||raw.VERCEL_ENV==='production'?raw.NODE_ENV==='production'&&raw.WALLET_BIDS_LIVE_ENABLED==='true'&&raw.DEV_POINTS_ENABLED!=='true':['local','test','staging'].includes(raw.APP_ENV??'');
}
