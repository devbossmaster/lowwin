import {createHash} from 'node:crypto';
/** Temporary capability for the explicitly reset staging project. Never enables
 * local identity, payment mocks, receipt approval, or automatic point issuance. */
export function stagingDemoEnabled(raw:Record<string,string|undefined>=process.env){
 try{
  if(raw.APP_ENV!=='staging'||raw.NODE_ENV==='production'||raw.VERCEL||raw.STAGING_DEMO_ENABLED!=='true')return false;
  const project=(value:string|undefined)=>{const u=new URL(value??'');if(!['postgres:','postgresql:'].includes(u.protocol)||u.pathname!=='/postgres')return null;return u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1]??(/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname)?u.username.split('.')[1]:null)};
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  return project(raw.DATABASE_URL)==='dzvltmdojkzofsmxfkob'&&project(raw.DIRECT_URL)==='dzvltmdojkzofsmxfkob'
   &&new URL(raw.MINI_APP_URL!).protocol==='https:'&&new URL(raw.MINI_APP_URL!).origin===new URL(raw.BETTER_AUTH_URL!).origin
   &&hash(new URL(raw.MINI_APP_URL!).origin)===raw.STAGING_DEMO_ORIGIN_HASH
   &&hash(raw.TELEGRAM_BOT_TOKEN!.split(':')[0])===raw.STAGING_DEMO_BOT_HASH;
 }catch{return false}
}
export function stagingDemoUser(userId:string,raw:Record<string,string|undefined>=process.env){
 if(!stagingDemoEnabled(raw))return false;
 const allowed=(raw.STAGING_DEMO_USER_IDS??'').split(',').filter(Boolean);
 return /^demo-showcase-[a-z0-9-]{1,40}-[0-9]{1,2}$/.test(userId)||(allowed.length<=20&&allowed.includes(userId));
}
