import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {stagingDemoEnabled,stagingDemoUser} from '../src/modules/auctions/staging-demo';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const pinned={APP_ENV:'staging',NODE_ENV:'development',STAGING_DEMO_ENABLED:'true',DATABASE_URL:'postgresql://postgres.dzvltmdojkzofsmxfkob@aws-1-eu-west-1.pooler.supabase.com/postgres',DIRECT_URL:'postgresql://postgres@db.dzvltmdojkzofsmxfkob.supabase.co/postgres',MINI_APP_URL:'https://fixture.ngrok-free.dev',BETTER_AUTH_URL:'https://fixture.ngrok-free.dev',STAGING_DEMO_ORIGIN_HASH:hash('https://fixture.ngrok-free.dev'),TELEGRAM_BOT_TOKEN:'123:fixture',STAGING_DEMO_BOT_HASH:hash('123'),STAGING_DEMO_USER_IDS:'verified-fixture'};
describe('bounded staging DEMO capability',()=>{
 it('permits only pinned environment and explicit or synthetic participants',()=>{expect(stagingDemoEnabled(pinned)).toBe(true);expect(stagingDemoUser('verified-fixture',pinned)).toBe(true);expect(stagingDemoUser('demo-showcase-example-0',pinned)).toBe(true);expect(stagingDemoUser('arbitrary-player',pinned)).toBe(false)});
 it.each([{NODE_ENV:'production'},{APP_ENV:'production'},{VERCEL:'1'},{STAGING_DEMO_ENABLED:'false'},{MINI_APP_URL:'https://different.example'},{TELEGRAM_BOT_TOKEN:'456:other'},{DIRECT_URL:'postgresql://postgres@db.otherproject.supabase.co/postgres'},{DATABASE_URL:'postgresql://postgres.dzvltmdojkzofsmxfkob@localhost/postgres'},{DIRECT_URL:'postgresql://postgres@db.dzvltmdojkzofsmxfkob.supabase.co/production'}])('rejects drift %j',change=>expect(stagingDemoEnabled({...pinned,...change})).toBe(false));
 it('rejects oversized real-user allowlists',()=>expect(stagingDemoUser('verified-fixture',{...pinned,STAGING_DEMO_USER_IDS:['verified-fixture',...Array.from({length:20},(_,i)=>String(i))].join(',')})).toBe(false));
});
