import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {stagingDemoEnabled,stagingDemoUser,finalizedDemoFilter,previewTestRunFilter} from '../src/modules/auctions/staging-demo';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const pinned={APP_ENV:'staging',NODE_ENV:'development',STAGING_DEMO_ENABLED:'true',DATABASE_URL:'postgresql://postgres.kgwjolbhtvfwuohrtjya@aws-1-eu-west-1.pooler.supabase.com/postgres',DIRECT_URL:'postgresql://postgres@db.kgwjolbhtvfwuohrtjya.supabase.co/postgres',MINI_APP_URL:'https://fixture.ngrok-free.dev',BETTER_AUTH_URL:'https://fixture.ngrok-free.dev',STAGING_DEMO_ORIGIN_HASH:hash('https://fixture.ngrok-free.dev'),TELEGRAM_BOT_TOKEN:'123:fixture',STAGING_DEMO_BOT_HASH:hash('123'),STAGING_DEMO_USER_IDS:'verified-fixture'};
describe('bounded staging DEMO capability',()=>{
 it('permits only pinned environment and explicit or synthetic participants',()=>{expect(stagingDemoEnabled(pinned)).toBe(true);expect(stagingDemoUser('verified-fixture',pinned)).toBe(true);expect(stagingDemoUser('demo-showcase-example-0',pinned)).toBe(true);expect(stagingDemoUser('arbitrary-player',pinned)).toBe(false)});
 it.each([{NODE_ENV:'production'},{APP_ENV:'production'},{VERCEL:'1'},{STAGING_DEMO_ENABLED:'false'},{MINI_APP_URL:'https://different.example'},{TELEGRAM_BOT_TOKEN:'456:other'},{DIRECT_URL:'postgresql://postgres@db.otherproject.supabase.co/postgres'},{DATABASE_URL:'postgresql://postgres.kgwjolbhtvfwuohrtjya@localhost/postgres'},{DIRECT_URL:'postgresql://postgres@db.kgwjolbhtvfwuohrtjya.supabase.co/production'}])('rejects drift %j',change=>expect(stagingDemoEnabled({...pinned,...change})).toBe(false));
 it('rejects oversized real-user allowlists',()=>expect(stagingDemoUser('verified-fixture',{...pinned,STAGING_DEMO_USER_IDS:['verified-fixture',...Array.from({length:20},(_,i)=>String(i))].join(',')})).toBe(false));
 it('admits only settlement fixtures in the pinned staging preview',()=>{
  expect(finalizedDemoFilter(pinned)).toEqual({OR:[{isDemo:false},{isDemo:true,isSettlementFixture:true}]});
  expect(previewTestRunFilter(pinned)).toEqual({OR:[{testRunId:null},{isDemo:true,testRunId:{not:null}}]});
  for(const change of [{APP_ENV:'production'},{NODE_ENV:'production'},{VERCEL:'1'},{STAGING_DEMO_ENABLED:'false'},{MINI_APP_URL:'https://unapproved.example'},{TELEGRAM_BOT_TOKEN:'456:other'},{DATABASE_URL:'postgresql://postgres.dzvltmdojkzofsmxfkob@aws-1-eu-west-1.pooler.supabase.com/postgres',DIRECT_URL:'postgresql://postgres@db.dzvltmdojkzofsmxfkob.supabase.co/postgres'},{DATABASE_URL:'postgresql://postgres.qpiesbgyvokzgqqnhbqa@aws-0-ap-south-1.pooler.supabase.com/postgres',DIRECT_URL:'postgresql://postgres@db.qpiesbgyvokzgqqnhbqa.supabase.co/postgres'}]){
   expect(stagingDemoEnabled({...pinned,...change})).toBe(false);expect(finalizedDemoFilter({...pinned,...change})).toEqual({isDemo:false});expect(previewTestRunFilter({...pinned,...change})).toEqual({testRunId:null});
  }
 });
});
