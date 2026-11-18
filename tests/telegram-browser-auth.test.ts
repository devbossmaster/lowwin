import {generateKeyPairSync,randomInt,randomUUID,sign} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {TEST_TOKEN,signedLaunch} from './helpers';
import {verifyFixtureContact} from './contact-fixtures';
import {handleAuth} from '../src/modules/auth/handler';
import {getMiniSession} from '../src/modules/auth/mini-access';
import {creditDevelopmentPoints} from '../src/modules/wallet/ledger';
import {readWalletBalance} from '../src/modules/wallet/balance';
import {GET as readMe} from '../src/app/api/me/route';
import {getReferralOverview,recordBotReferralStart} from '../src/modules/referrals/service';
import {sealWebsiteReferral,WEBSITE_REFERRAL_COOKIE} from '../src/modules/referrals/website-cookie';
import {REFERRAL_BOT_RECOVERY_PARAMETER,botRegistrationReferralUrl} from '../src/lib/referral-invite';

const database=process.env.TELEGRAM_BROWSER_TEST_DATABASE_URL,origin='http://localhost:3000';
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'upstream-fixture',alg:'RS256',use:'sig'};
const issued=new Map<string,{token:string;verifier:string}>();
const provider=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=String(input);
 if(url==='https://oauth.telegram.org/.well-known/jwks.json')return Response.json({keys:[jwk]});
 if(url!=='https://oauth.telegram.org/token')throw Error('Unexpected fixture network request');
 const body=new URLSearchParams(String(init?.body)),code=body.get('code')!,entry=issued.get(code);
 expect(new Headers(init?.headers).get('authorization')).toMatch(/^Basic /);
 expect(body.get('client_id')).toBe('123456789');
 expect(body.has('client_secret')).toBe(false);
 expect(body.get('redirect_uri')).toBe(origin+'/api/auth/callback/telegram-oidc');
 if(!entry)return Response.json({error:'invalid_grant'});
 issued.delete(code);expect(body.get('code_verifier')).toBe(entry.verifier);
 return Response.json({id_token:entry.token,access_token:'fixture-provider-token-must-not-persist',token_type:'Bearer',expires_in:3600});
});

describe.skipIf(!database)('shared Better Auth Telegram browser and Mini App integration',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const target=new URL(database!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,APP_ENV:'local',NODE_ENV:'test',BETTER_AUTH_URL:origin,MINI_APP_URL:origin,BETTER_AUTH_SECRET:'fixture-browser-login-secret-at-least-thirty-two',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-browser-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'fixture-browser',PHONE_CONTACT_KEYS:JSON.stringify({'fixture-browser':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),TELEGRAM_LOGIN_ENABLED:'true',TELEGRAM_LOGIN_CLIENT_ID:'123456789',TELEGRAM_LOGIN_CLIENT_SECRET:'synthetic-client-secret-not-live',REFERRAL_REWARDS_SCHEMA_READY:'false',DEV_IDENTITY_ENABLED:'false',DEV_POINTS_ENABLED:'true'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient();vi.stubGlobal('fetch',provider);
 },60000);
 afterAll(async()=>{vi.unstubAllGlobals();await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect()});
 async function flow(overrides:Record<string,unknown>={},next='/my-bids?tab=live',browserCookie?:string){
  const error=new URL('/',origin);error.searchParams.set('login','1');error.searchParams.set('next',next);error.searchParams.set('lang','en');
  const headers=new Headers({origin,'content-type':'application/json','x-forwarded-for':`127.${randomInt(1,254)}.${randomInt(1,254)}.${randomInt(1,254)}`});
  if(browserCookie)headers.set('cookie',browserCookie);
  const start=await handleAuth(new Request(origin+'/api/auth/sign-in/social',{method:'POST',headers,body:JSON.stringify({provider:'telegram-oidc',callbackURL:next,errorCallbackURL:error.pathname+error.search,disableRedirect:true})}));
  expect(start.status,await start.clone().text()).toBe(200);
  expect(start.headers.get('server-timing')).toContain('oidc_start;dur=');
  const url=new URL((await start.json()).url),state=url.searchParams.get('state')!,cookie=start.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),now=Math.floor(Date.now()/1000),tid=randomInt(4000000000,5000000000);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('nonce')).toBeTruthy();
  const row=await db.verification.findFirstOrThrow({where:{value:{contains:state}}}),saved=JSON.parse(row.value);
  const claims={iss:'https://oauth.telegram.org',aud:'123456789',sub:'fixture-sub-'+randomUUID(),id:tid,name:'Synthetic browser player',iat:now,exp:now+3600,nonce:url.searchParams.get('nonce'),phone_number:'2519'+String(tid).slice(-8),phone_number_verified:true,...overrides};
  const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url'),payload=Buffer.from(JSON.stringify(claims)).toString('base64url'),code='fixture-'+randomUUID();
  issued.set(code,{token:header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),pair.privateKey).toString('base64url'),verifier:saved.codeVerifier});
  const request=(query=`state=${encodeURIComponent(state)}&code=${code}`,binding=[cookie,browserCookie].filter(Boolean).join('; '))=>new Request(origin+'/api/auth/callback/telegram-oidc?'+query,{headers:{cookie:binding}});
  return {state,cookie,claims,row,saved,code,request,finish:()=>handleAuth(request())};
 }
 function cookie(response:Response){const session=response.headers.getSetCookie().find(c=>c.startsWith('better-auth.session_token='));expect(session, response.headers.get('location')??'').toBeTruthy();return new Headers({cookie:session!.split(';')[0]})}
 it('reuses the upstream JWKS across independent callbacks while exchanging and validating each code',async()=>{
  const keyReads=()=>provider.mock.calls.filter(([url])=>String(url)==='https://oauth.telegram.org/.well-known/jwks.json').length;
  const tokenReads=()=>provider.mock.calls.filter(([url])=>String(url)==='https://oauth.telegram.org/token').length;
  const beforeKeys=keyReads(),beforeTokens=tokenReads(),first=await flow(),firstResponse=await first.finish();cookie(firstResponse);
  const afterFirst=keyReads(),second=await flow(),secondResponse=await second.finish();cookie(secondResponse);
  expect(afterFirst-beforeKeys).toBe(1);expect(keyReads()).toBe(afterFirst);expect(tokenReads()-beforeTokens).toBe(2);
  expect(firstResponse.headers.get('server-timing')).toContain('oidc_token;dur=');expect(secondResponse.headers.get('server-timing')).toContain('oidc_profile;dur=');
 });
 it('creates a verified browser account through the standard callback and issues the existing signed cookie',async()=>{
  const f=await flow(),response=await f.finish();expect(response.status).toBe(303);expect(response.headers.get('location')).toBe(origin+'/my-bids?tab=live');
  expect(response.headers.get('server-timing')).toContain('oidc_bindings;dur=');
  expect(response.headers.get('server-timing')).toMatch(/oidc_session;dur=.*oidc_callback;dur=.*oidc_redirect;dur=/);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(response.headers.getSetCookie()).toContain('lowwin-browser-restore=1; Path=/; Max-Age=300; HttpOnly; SameSite=Lax');
  const current=await getMiniSession(cookie(response),db);expect(current?.telegramId).toBe(String(f.claims.id));expect(current?.session.telegramAuthSource).toBe('TELEGRAM_OIDC');
  const contact=await db.telegramOwnContact.findUniqueOrThrow({where:{userId:current!.user.id}});expect(contact.verificationSource).toBe('TELEGRAM_OIDC');expect(contact.oidcSubject).toBe(f.claims.sub);expect(contact.phoneCipher).not.toContain(f.claims.phone_number);
  const account=await db.account.findUniqueOrThrow({where:{providerId_accountId:{providerId:'telegram-oidc',accountId:f.claims.sub}}});expect(account.userId).toBe(current!.user.id);expect(account.accessToken).toBeNull();expect(account.idToken).toBeNull();expect((await db.user.findUniqueOrThrow({where:{id:current!.user.id}})).telegramPhoneNumber).toBeNull();
 });
 it('inserts a fully bound Telegram session before any cookie can be issued',async()=>{
  await db.$executeRaw`CREATE FUNCTION require_bound_telegram_test_session() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
    IF NEW."telegramAuthSource"<>'TELEGRAM_OIDC' OR NEW."telegramLaunchId" IS NULL THEN RAISE EXCEPTION 'Expected an already bound session'; END IF;
    RETURN NEW;
   END $$`;
  await db.$executeRaw`CREATE TRIGGER require_bound_telegram_test_session BEFORE INSERT ON "session" FOR EACH ROW EXECUTE FUNCTION require_bound_telegram_test_session()`;
  try{
   const f=await flow(),response=await f.finish();
   expect((await getMiniSession(cookie(response),db))?.telegramId).toBe(String(f.claims.id));
  }finally{
   await db.$executeRaw`DROP TRIGGER require_bound_telegram_test_session ON "session"`;
   await db.$executeRaw`DROP FUNCTION require_bound_telegram_test_session()`;
  }
 });
 it('returns the joined private profile immediately after consent without loading wallet or unrelated data',async()=>{
  const f=await flow(),response=await f.finish(),headers=cookie(response),current=await getMiniSession(headers,db);
  await db.playerProfile.create({data:{userId:current!.user.id,displayName:'Owned display name'}});
  const me=await readMe(new Request(origin+'/api/me',{headers})),body=await me.json();
  expect(me.status).toBe(200);expect(me.headers.get('cache-control')).toContain('private');expect(me.headers.get('server-timing')).toContain('me_session;dur=');
  expect(body.user).toMatchObject({id:current!.user.id,name:'Owned display name'});expect(body.sessionKey).toMatch(/^[a-f0-9]{64}$/);
  for(const field of ['wallet','bids','notifications','phone_number','token','role'])expect(body).not.toHaveProperty(field);
  expect(response.headers.get('server-timing')).toContain('oidc_locks;dur=');expect(response.headers.get('server-timing')).toContain('oidc_lookup;dur=');
 });
 it('restores the existing bot account and wallet using signed numeric ID',async()=>{
  const tid=randomInt(4000000000,5000000000);await verifyFixtureContact(db,tid);const user=await db.user.findUniqueOrThrow({where:{telegramId:String(tid)}});await creditDevelopmentPoints(db,user.id,'83.25','upstream-retain-'+user.id);
  const f=await flow({id:tid,phone_number_verified:false}),current=await getMiniSession(cookie(await f.finish()),db);expect(current?.user.id).toBe(user.id);expect((await readWalletBalance(db,user.id)).available).toBe('83.25');expect(await db.user.count({where:{telegramId:String(tid)}})).toBe(1);
 });
 it('lets the same browser-created user continue through signed Mini App login',async()=>{
  const f=await flow(),current=await getMiniSession(cookie(await f.finish()),db);
  const response=await handleAuth(new Request(origin+'/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:f.claims.id,first_name:'Same fixture player'})})})}));
  expect(response.status,await response.clone().text()).toBe(200);expect((await getMiniSession(cookie(response),db))?.user.id).toBe(current!.user.id);
 });
 it('rejects callback replay before another exchange or session',async()=>{
  const f=await flow();await f.finish();const before=provider.mock.calls.length,count=await db.session.count();const replay=await f.finish();expect(replay.headers.get('location')).toContain('telegramLoginError=invalid');expect(provider.mock.calls.length).toBe(before);expect(await db.session.count()).toBe(count);
 });
 it('creates only one owned session when concurrent callbacks use one provider code',async()=>{
  const f=await flow(),results=await Promise.all([f.finish(),f.finish()]);
  expect(results.filter(r=>r.headers.get('location')===origin+'/my-bids?tab=live')).toHaveLength(1);
  const user=await db.user.findUniqueOrThrow({where:{telegramId:String(f.claims.id)}});expect(await db.session.count({where:{userId:user.id}})).toBe(1);
 });
 it('isolates verified identity and session binding across different concurrent callbacks on the reused provider',async()=>{
  const [first,second]=await Promise.all([flow(),flow()]),[firstResponse,secondResponse]=await Promise.all([first.finish(),second.finish()]);
  const [firstAccount,secondAccount]=await Promise.all([getMiniSession(cookie(firstResponse),db),getMiniSession(cookie(secondResponse),db)]);
  expect(firstAccount?.telegramId).toBe(String(first.claims.id));expect(secondAccount?.telegramId).toBe(String(second.claims.id));expect(firstAccount?.user.id).not.toBe(secondAccount?.user.id);expect(firstAccount?.session.id).not.toBe(secondAccount?.session.id);
 });
 it.each([{nonce:'wrong'},{iss:'https://evil.invalid'},{aud:'other-client'},{exp:1}])('rejects invalid signed token claims %j',async patch=>{
  const f=await flow(patch),response=await f.finish();expect(response.headers.get('location')).toContain('telegramLoginError=');expect(response.headers.getSetCookie().some(c=>c.startsWith('better-auth.session_token='))).toBe(false);expect(await db.user.count({where:{telegramId:String(f.claims.id)}})).toBe(0);
 });
 it('keeps cancellation in the sign-in sheet without exchanging a code',async()=>{
  const f=await flow({},'/auctions/power-bank#bid-review'),before=provider.mock.calls.length,response=await handleAuth(f.request(`state=${f.state}&error=access_denied&error_description=do-not-reflect-this`));
  expect(response.headers.get('location')).toContain('telegramLoginError=cancelled');expect(new URL(response.headers.get('location')!).searchParams.get('next')).toBe('/auctions/power-bank#bid-review');expect(response.headers.get('location')).not.toContain('do-not-reflect');expect(provider.mock.calls.length).toBe(before);
  expect(response.headers.getSetCookie().some(value=>value.startsWith('lowwin-browser-restore='))).toBe(false);
 });
 it('rejects a missing browser binding and expired state without creating an account',async()=>{
  const f=await flow(),before=provider.mock.calls.length;expect((await handleAuth(f.request(undefined,''))).headers.get('location')).toContain('telegramLoginError=invalid');
  await db.verification.update({where:{id:f.row.id},data:{value:JSON.stringify({...f.saved,expiresAt:Date.now()-1000})}});
  expect((await f.finish()).headers.get('location')).toContain('telegramLoginError=invalid');expect(provider.mock.calls.length).toBe(before);expect(await db.user.count({where:{telegramId:String(f.claims.id)}})).toBe(0);
 });
 it('rejects missing verified phone consent without manufacturing a session',async()=>{
  const f=await flow({phone_number_verified:false}),response=await f.finish();expect(response.headers.get('location')).toContain('telegramLoginError=');expect(await db.user.count({where:{telegramId:String(f.claims.id)}})).toBe(0);expect(response.headers.getSetCookie().some(c=>c.startsWith('better-auth.session_token='))).toBe(false);
 });
 it('rejects signature tampering and never trusts a browser-supplied ID token',async()=>{
  const f=await flow(),entry=issued.get(f.code)!;entry.token=entry.token.slice(0,-8)+'tampered';
  const response=await f.finish();expect(response.headers.getSetCookie().some(c=>c.startsWith('better-auth.session_token='))).toBe(false);expect(await db.user.count({where:{telegramId:String(f.claims.id)}})).toBe(0);
  const supplied=await handleAuth(new Request(origin+'/api/auth/sign-in/social',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({provider:'telegram-oidc',idToken:{token:entry.token}})}));expect(supplied.status).toBe(400);
 });
 it.each(['https://evil.invalid','//evil.invalid','/admin','/api/auth/sign-out'])('refuses unsafe destinations at the actual sign-in command: %s',async callbackURL=>{
  const response=await handleAuth(new Request(origin+'/api/auth/sign-in/social',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({provider:'telegram-oidc',callbackURL})}));expect(response.status).toBe(400);expect(response.headers.getSetCookie()).toEqual([]);
 });
 it('rejects cross-origin commands and disabled legacy login endpoints',async()=>{
  const response=await handleAuth(new Request(origin+'/api/auth/sign-in/social',{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'},body:'{}'}));expect(response.status).toBe(403);
  expect((await handleAuth(new Request(origin+'/api/auth/telegram/browser/start'))).status).toBe(404);
 });
 it.each([null,[],1,'invalid',true])('rejects malformed social command bodies without an exception: %j',async body=>{
  const response=await handleAuth(new Request(origin+'/api/auth/sign-in/social',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}));expect(response.status).toBe(400);
 });
 it('refuses an expired Better Auth session',async()=>{
  const f=await flow(),headers=cookie(await f.finish()),current=await getMiniSession(headers,db);await db.session.update({where:{id:current!.session.id},data:{expiresAt:new Date(Date.now()-1000)}});expect(await getMiniSession(headers,db)).toBeNull();
 });
 describe('website referral attribution',()=>{
  beforeAll(async()=>{
   process.env.REFERRAL_REWARDS_SCHEMA_READY='true';
   await db.referralPolicy.upsert({where:{id:'default'},create:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'local-fixture-owner'},update:{enabled:true}});
  });
  afterAll(()=>{process.env.REFERRAL_REWARDS_SCHEMA_READY='false'});
  async function invite(){
   const tid=randomInt(8000000000,8900000000);
   await verifyFixtureContact(db,tid);
   const sponsor=await db.user.findUniqueOrThrow({where:{telegramId:String(tid)}});
   const overview=await getReferralOverview(db,sponsor.id);
   const token=new URL(overview.webShareUrl!).searchParams.get('ref')!;
   const botPayload=new URL(overview.shareUrl!).searchParams.get('start')!;
   expect(botPayload).toBe('ref_'+token);
   return {sponsor,token,botPayload,browserCookie:`${WEBSITE_REFERRAL_COOKIE}=${sealWebsiteReferral(token)}`};
  }
  it('credits the verified new account once using the invite pinned to the original login',async()=>{
   const first=await invite(),second=await invite();
   const f=await flow({},'/?ref='+second.token+'&lang=en',first.browserCookie);
   expect(f.saved.serverContext?.lowwinWebsiteReferral).toBe(first.token);
   const response=await handleAuth(f.request(undefined,f.cookie+'; '+second.browserCookie));
   expect(response.headers.get('location')).toBe(origin+'/?lang=en');
   expect(response.headers.getSetCookie()).toContain(`${WEBSITE_REFERRAL_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
   const current=await getMiniSession(cookie(response),db);
   const referredUserId=current!.user.id;
   expect(await db.referralSignup.findUnique({where:{referredUserId}})).toMatchObject({referrerUserId:first.sponsor.id,firstBidId:null});
   const returning=await flow({id:f.claims.id,sub:f.claims.sub},'/',second.browserCookie);
   expect((await getMiniSession(cookie(await returning.finish()),db))?.user.id).toBe(referredUserId);
   expect(await db.referralSignup.count({where:{referredUserId}})).toBe(1);
   expect(await db.referralSignup.findUnique({where:{referredUserId}})).toMatchObject({referrerUserId:first.sponsor.id});
  });
  it('honors a prior verified bot start alongside the website invitation',async()=>{
   const telegram=await invite(),website=await invite(),f=await flow({},'/',website.browserCookie);
   expect(await recordBotReferralStart(db,String(f.claims.id),'123456789',telegram.botPayload)).toBe(true);
   const current=await getMiniSession(cookie(await f.finish()),db);
   expect(await db.referralSignup.findUnique({where:{referredUserId:current!.user.id}})).toMatchObject({referrerUserId:telegram.sponsor.id});
  });
  it('carries the same invite into bot contact registration when no verified phone claim is returned',async()=>{
   const first=await invite(),second=await invite(),f=await flow({phone_number_verified:false},'/',first.browserCookie);
   const response=await handleAuth(f.request(undefined,f.cookie+'; '+second.browserCookie)),target=new URL(response.headers.get('location')!);
   expect(target.searchParams.get('telegramLoginError')).toBe('contact_required');
   expect(target.searchParams.get(REFERRAL_BOT_RECOVERY_PARAMETER)).toBe(first.token);
   expect(await db.user.count({where:{telegramId:String(f.claims.id)}})).toBe(0);
   const botUrl=botRegistrationReferralUrl('https://t.me/lowin_fixture_bot?start=lowin',target.searchParams.get(REFERRAL_BOT_RECOVERY_PARAMETER));
   const start=new URL(botUrl!).searchParams.get('start')!;
   expect(await recordBotReferralStart(db,String(f.claims.id),'123456789',start)).toBe(true);
   await verifyFixtureContact(db,f.claims.id);
   const registered=await db.user.findUniqueOrThrow({where:{telegramId:String(f.claims.id)}});
   expect(await db.referralSignup.findUnique({where:{referredUserId:registered.id}})).toMatchObject({referrerUserId:first.sponsor.id});
  });
 });
});
