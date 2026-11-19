import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {createServer,type Server} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {makeSignature} from 'better-auth/crypto';
import {TEST_TOKEN} from './helpers';
import {bidAuction,bidUser} from './bid-fixtures';
import {formatAddisDateTimeLocal,parseAddisDateTimeLocal} from '../src/lib/addis-time';
const database=process.env.MASTER_ADMIN_TEST_DATABASE_URL;
describe.skipIf(!database)('Master Guide Admin on disposable PostgreSQL',()=>{
 let db:PrismaClient,sink:Server,auth:typeof import('../src/modules/auth/handler').handleAuth,requireAdmin:typeof import('../src/modules/admin/boundary').requireAdmin,cookie='',userId='';
 const messages:{to:string;text:string}[]=[];
 const origin='http://localhost:3000';
 const email=`master-${randomUUID()}@lowin.test`;
 const password='Fixture-master-password-12345';
 const request=(path:string,body?:unknown,session='')=>new Request(origin+'/api/auth/'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':'198.18.72.91',...(session?{cookie:session}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const post=(path:string,body:unknown,session='')=>auth(request(path,body,session));
 const latestLink=()=>messages.at(-1)!.text.match(/https?:[^\s]+/)![0];
 const credentials=()=>({email,password});
 async function fundedBidUser(){
  process.env.DEV_POINTS_ENABLED='true';
  try{return await bidUser(db)}finally{process.env.DEV_POINTS_ENABLED='false'}
 }
 beforeAll(async()=>{
  const url=new URL(database!);if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
  sink=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;messages.push(JSON.parse(body));res.writeHead(204);res.end()});await new Promise<void>(resolve=>sink.listen(0,'127.0.0.1',resolve));
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',BETTER_AUTH_URL:origin,MINI_APP_URL:origin,BETTER_AUTH_SECRET:'fixture-master-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-master-webhook-secret-at-least-thirty-two',DEV_IDENTITY_ENABLED:'false',DEV_POINTS_ENABLED:'false',EMAIL_TRANSPORT:'local-sink',EMAIL_SINK_URL:`http://127.0.0.1:${(sink.address() as {port:number}).port}`});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});db=new PrismaClient({datasourceUrl:database});({handleAuth:auth}=await import('../src/modules/auth/handler'));({requireAdmin}=await import('../src/modules/admin/boundary'));
 },60000);
 beforeEach(async()=>{await db.rateLimit.deleteMany()});
 afterAll(async()=>{await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect();await new Promise<void>(resolve=>sink?.close(()=>resolve()))});
 it('registers a member, sends an email, and issues no session or administrator row',async()=>{
  const response=await post('sign-up/email',{...credentials(),name:'Master fixture',callbackURL:origin+'/admin/login?verified=1'});expect(response.status,await response.clone().text()).toBe(200);
  const user=await db.user.findUniqueOrThrow({where:{email}});userId=user.id;expect(user).toMatchObject({role:'member',emailVerified:false,telegramId:null});expect(response.headers.getSetCookie().some(value=>value.includes('session_token='))).toBe(false);expect(await db.staffMember.findUnique({where:{userId}})).toBeNull();expect(messages).toHaveLength(1);
 });
 it('rejects role claims and wrong origins, and retires invitation/MFA endpoints',async()=>{
  const forbidden=await post('sign-up/email',{...credentials(),email:'forged-'+email,name:'Forged',role:'admin',emailVerified:true});expect(forbidden.status).toBe(400);expect(await db.user.findUnique({where:{email:'forged-'+email}})).toBeNull();
  for(const path of ['lowin/staff/login','lowin/staff/mfa','lowin/staff/enroll','lowin/staff/accept-invite','admin/set-role'])expect((await post(path,credentials())).status).toBe(404);
  expect((await auth(new Request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin:'https://untrusted.invalid','content-type':'application/json'},body:JSON.stringify(credentials())}))).status).toBe(403);
 });
 it('requires actual email verification and refuses a verified member sign-in',async()=>{
  expect((await post('sign-in/email',credentials())).status).toBe(403);
  const verification=new URL(latestLink());expect(verification.pathname).toBe('/api/auth/verify-email');expect((await auth(new Request(verification))).status).toBeLessThan(400);
  expect((await db.user.findUniqueOrThrow({where:{id:userId}})).emailVerified).toBe(true);
  expect((await post('sign-in/email',credentials())).status).toBe(403);expect(await db.session.count({where:{userId}})).toBe(0);
 });
 it('grants password-only access after manual database approval and marks the exact new session',async()=>{
  await db.user.update({where:{id:userId},data:{role:'admin'}});
  const response=await post('sign-in/email',{...credentials(),rememberMe:false});expect(response.status,await response.clone().text()).toBe(200);
  const body=await response.json();expect(body).not.toHaveProperty('token');cookie=response.headers.getSetCookie().find(value=>value.includes('session_token='))!.split(';')[0];
  const actor=await requireAdmin(db,new Headers({cookie}));expect(actor).toMatchObject({id:userId,role:'OWNER',mfaAt:null});
  const grant=await db.staffSession.findUniqueOrThrow({where:{sessionId:actor.sessionId}});expect(grant.authMethod).toBe('email-password');expect(grant.mfaAt).toBeNull();expect(grant.expiresAt.getTime()-grant.credentialAt.getTime()).toBeLessThanOrEqual(8*3600000);
  expect((await db.staffMember.findUniqueOrThrow({where:{userId}})).secret).toBeNull();
 });
 it('refuses legacy assurance records even when an account has admin role',async()=>{
  const actor=await requireAdmin(db,new Headers({cookie}));await db.staffSession.update({where:{sessionId:actor.sessionId},data:{authMethod:'legacy',mfaAt:new Date()}});await expect(requireAdmin(db,new Headers({cookie}))).rejects.toMatchObject({status:403});await db.staffSession.update({where:{sessionId:actor.sessionId},data:{authMethod:'email-password',mfaAt:null}});
 });
 it('looks up the fresh admin grant in one query and keeps the staff lock before mutation authorization',async()=>{
  const traced=new PrismaClient({datasourceUrl:database,log:[{level:'query',emit:'event'}]});
  const queries:string[]=[];
  traced.$on('query',event=>{if(event.query.trimStart().startsWith('SELECT'))queries.push(event.query)});
  try{
   const headers=new Headers({cookie});
   await expect(requireAdmin(traced,headers,{permission:'catalog'})).resolves.toMatchObject({id:userId,role:'OWNER'});
   expect(queries).toHaveLength(1);
   queries.length=0;
   await expect(traced.$transaction(tx=>requireAdmin(tx,headers,{lock:true,permission:'cancel'}))).resolves.toMatchObject({id:userId,role:'OWNER'});
   expect(queries).toHaveLength(2);
   expect(queries[0]).toContain('FOR UPDATE OF u,m');
   expect(queries[1]).toContain('"StaffSession"');
  }finally {await traced.$disconnect()}
 });
 it('moves a deadline in both directions and requires an audited override after accepted bids',async()=>{
  const {POST,GET}=await import('../src/app/api/admin/[...path]/route');
  const auction=await bidAuction(db,{ruleVersion:'lowest-unique-v5',fee:1,endDelayMs:3600000});
  const reminder=await db.outbox.create({data:{key:`test-ending:${auction.id}`,kind:'AUCTION_ENDING_1_HOUR',payload:{auctionId:auction.id}}});
  const next=new Date((Math.floor(auction.endsAt!.getTime()/60000)+30)*60000);
  const input={key:randomUUID(),auctionId:auction.id,version:auction.controlVersion,endsAt:parseAddisDateTimeLocal(formatAddisDateTimeLocal(next)).toISOString(),reason:'Extend fixture auction'};
  const submit=(fields:typeof input&{overrideConfirmation?:string}=input,session=cookie)=>POST(new Request(origin+'/api/admin/command',{method:'POST',headers:{cookie:session,origin,'content-type':'application/json'},body:JSON.stringify({action:'deadline',input:fields})}),{params:Promise.resolve({path:['command']})});
  const response=await submit();
  expect(response.status,await response.clone().text()).toBe(200);
  expect(response.headers.get('Server-Timing')).toContain('admin_transaction;dur=');
  expect(response.headers.get('Server-Timing')).toContain('admin_deadline_write;dur=');
  const receipt=await response.json();
  expect(receipt).toMatchObject({auctionId:auction.id,endsAt:next.toISOString(),controlVersion:auction.controlVersion+1,endingAlertsRetired:1});
  expect(await (await submit()).json()).toEqual(receipt);

  const refreshed=await GET(new Request(origin+`/api/admin/auctions/${auction.id}`,{headers:{cookie}}),{params:Promise.resolve({path:['auctions',auction.id]})});
  expect(refreshed.status).toBe(200);
  expect(await refreshed.json()).toMatchObject({endsAt:next.toISOString(),controlVersion:auction.controlVersion+1,terms:{publishedEndsAt:auction.endsAt!.toISOString()},controlRevisions:[{kind:'DEADLINE',reason:input.reason}]});
  expect(await db.outbox.findUnique({where:{id:reminder.id}})).toMatchObject({state:'SKIPPED',lastError:'SUPERSEDED_BY_DEADLINE_CHANGE'});

  const shorter=new Date(next.getTime()-45*60000);
  const shortened=await submit({...input,key:randomUUID(),version:receipt.controlVersion,endsAt:parseAddisDateTimeLocal(formatAddisDateTimeLocal(shorter)).toISOString(),reason:'Shorten fixture auction'});
  expect(shortened.status,await shortened.clone().text()).toBe(200);
  expect(await shortened.json()).toMatchObject({endsAt:shorter.toISOString(),controlVersion:receipt.controlVersion+1});

  const {submitBid}=await import('../src/modules/auctions/bids');
  const bidder=await fundedBidUser();
  await submitBid(db,{userId:bidder,auctionSlug:auction.slug!,amount:'1.02',key:randomUUID(),feeVersion:1});
  const endsAt=new Date(shorter.getTime()-60000).toISOString();
  const requested={...input,key:randomUUID(),version:receipt.controlVersion+1,endsAt,reason:'Owner confirmed one deadline change'};
  const denied=await submit(requested);
  expect(denied.status).toBe(422);
  expect(await denied.json()).toMatchObject({code:'DEADLINE_OVERRIDE_REQUIRED'});
  const incorrect=await submit({...requested,overrideConfirmation:'wrong-code'});
  expect(incorrect.status).toBe(422);
  expect(await incorrect.json()).toMatchObject({code:'DEADLINE_OVERRIDE_CONFIRMATION'});
  expect(await db.auctionControlRevision.count({where:{auctionId:auction.id,kind:'DEADLINE'}})).toBe(2);

  const confirmed={...requested,overrideConfirmation:auction.code};
  expect((await submit(confirmed,'')).status).toBe(401);
  const tooSoon=await submit({...confirmed,endsAt:new Date(Date.now()+3*60000).toISOString()});
  expect(tooSoon.status).toBe(422);
  expect(await tooSoon.json()).toMatchObject({error:'The new deadline must be at least five minutes in the future.'});
  // A matching timestamp alone still cannot authorize a paid shortening.
  for(const [actorId,after] of [
   [userId,{endsAt}],
   [userId,{endsAt,paidShorteningOverride:true,overrideConfirmation:'wrong-code'}],
   [bidder,{endsAt,paidShorteningOverride:true,overrideConfirmation:auction.code}],
  ] as const){
   await expect(db.$transaction(async tx=>{
    await tx.auctionControlRevision.create({data:{auctionId:auction.id,version:requested.version+1,kind:'DEADLINE',before:{endsAt:shorter.toISOString()},after,actorId,reason:requested.reason,operationKey:randomUUID()}});
    await tx.auction.update({where:{id:auction.id},data:{endsAt,controlVersion:requested.version+1}});
   })).rejects.toThrow('Published auction deadline requires a matching control revision');
  }

  const saved=await submit(confirmed);
  expect(saved.status,await saved.clone().text()).toBe(200);
  const overrideReceipt=await saved.json();
  expect(overrideReceipt).toMatchObject({endsAt,controlVersion:requested.version+1,paidShorteningOverride:true});
  expect(await (await submit(confirmed)).json()).toEqual(overrideReceipt);
  expect((await submit({...confirmed,endsAt:new Date(shorter.getTime()-120000).toISOString()})).status).toBe(409);
  const committed=await db.auction.findUniqueOrThrow({where:{id:auction.id},include:{terms:true,controlRevisions:{orderBy:{version:'desc'},take:1}}});
  expect(committed).toMatchObject({endsAt:new Date(endsAt),terms:{allowPaidShortening:false,shortenNoticeMinutes:1440,publishedEndsAt:auction.endsAt},controlRevisions:[{kind:'DEADLINE',before:{endsAt:shorter.toISOString()},after:{endsAt,paidShorteningOverride:true,overrideConfirmation:auction.code},actorId:userId,reason:requested.reason}]});
  const audit=await db.adminAudit.findUniqueOrThrow({where:{operationKey:`${userId}:${requested.key}`}});
  expect(audit.details).toMatchObject({receipt:overrideReceipt});
 });
 it('preserves the required notice on an auction published with shortening allowed',async()=>{
  const {POST}=await import('../src/app/api/admin/[...path]/route');
  const {submitBid}=await import('../src/modules/auctions/bids');
  const auction=await bidAuction(db,{ruleVersion:'lowest-unique-v5',fee:1,endDelayMs:2*3600000,allowPaidShortening:true,shortenNoticeMinutes:30});
  await submitBid(db,{userId:await fundedBidUser(),auctionSlug:auction.slug!,amount:'1.02',key:randomUUID(),feeVersion:1});
  const input={key:randomUUID(),auctionId:auction.id,version:auction.controlVersion,endsAt:new Date(Date.now()+15*60000).toISOString(),reason:'Retain published bidder notice'};
  const submit=(fields:typeof input&{overrideConfirmation?:string})=>POST(new Request(origin+'/api/admin/command',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({action:'deadline',input:fields})}),{params:Promise.resolve({path:['command']})});
  const early=await submit(input);
  expect(early.status).toBe(422);
  expect(await early.json()).toMatchObject({error:'Bidders must retain at least 30 minutes of notice.'});
  expect((await submit({...input,overrideConfirmation:auction.code})).status).toBe(422);
  const withinPolicy=await submit({...input,endsAt:new Date(Date.now()+3600000).toISOString()});
  expect(withinPolicy.status,await withinPolicy.clone().text()).toBe(200);
  expect(await withinPolicy.json()).not.toHaveProperty('paidShorteningOverride');
 });
 it('fails a contested deadline promptly and saves the same operation after its lock clears',async()=>{
  const {POST}=await import('../src/app/api/admin/[...path]/route');
  const auction=await bidAuction(db,{ruleVersion:'lowest-unique-v5',endDelayMs:3600000});
  const endsAt=new Date(auction.endsAt!.getTime()+600000).toISOString();
  const input={key:randomUUID(),auctionId:auction.id,version:auction.controlVersion,endsAt,reason:'Contested fixture deadline'};
  const submit=()=>POST(new Request(origin+'/api/admin/command',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({action:'deadline',input})}),{params:Promise.resolve({path:['command']})});

  let release!:()=>void,locked!:()=>void;
  const released=new Promise<void>(resolve=>{release=resolve});
  const ready=new Promise<void>(resolve=>{locked=resolve});
  const hold=db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${auction.id} FOR UPDATE`;
   locked();
   await released;
  },{timeout:10000});
  try {
   await Promise.race([ready,hold]);
   const started=performance.now();
   const blocked=await submit();
   expect(blocked.status,await blocked.clone().text()).toBe(409);
   expect(await blocked.json()).toMatchObject({code:'DEADLINE_BUSY'});
   expect(performance.now()-started).toBeLessThan(5000);
  } finally {
   release();
   await hold;
  }

  const saved=await submit();
  expect(saved.status,await saved.clone().text()).toBe(200);
  expect(await saved.json()).toMatchObject({endsAt,controlVersion:auction.controlVersion+1});
  expect(await db.auctionControlRevision.count({where:{auctionId:auction.id,kind:'DEADLINE'}})).toBe(1);
 });
 it('rejects unsigned and altered cookies without consulting the database',async()=>{
  const [name,encoded]=cookie.split(/=(.*)/s),value=decodeURIComponent(encoded);
  const separator=value.lastIndexOf('.'),token=value.slice(0,separator);
  const altered=value.slice(0,separator+1)+(value[separator+1]==='A'?'B':'A')+value.slice(separator+2);
  for(const candidate of [token,altered]){
   await expect(requireAdmin({} as PrismaClient,new Headers({cookie:`${name}=${encodeURIComponent(candidate)}`}),{lock:true})).rejects.toMatchObject({status:401,code:'ADMIN_LOGIN_REQUIRED'});
  }
 });
 it('checks staff status and both expirations on the locked path',async()=>{
  const headers=new Headers({cookie}),actor=await requireAdmin(db,headers);
  await db.$transaction(async tx=>{
   await tx.staffMember.update({where:{userId},data:{active:false}});
   await expect(requireAdmin(tx,headers,{lock:true})).rejects.toMatchObject({status:403});
   await tx.staffMember.update({where:{userId},data:{active:true}});
   const grant=await tx.staffSession.findUniqueOrThrow({where:{sessionId:actor.sessionId}});
   await tx.staffSession.update({where:{sessionId:actor.sessionId},data:{credentialAt:new Date(Date.now()-60_000),expiresAt:new Date(Date.now()-1_000)}});
   await expect(requireAdmin(tx,headers,{lock:true})).rejects.toMatchObject({status:403});
   await tx.staffSession.update({where:{sessionId:actor.sessionId},data:{credentialAt:grant.credentialAt,expiresAt:grant.expiresAt}});
   const session=await tx.session.findUniqueOrThrow({where:{id:actor.sessionId}});
   await tx.$executeRaw`SET LOCAL TIME ZONE 'Africa/Addis_Ababa'`;
   await tx.session.update({where:{id:actor.sessionId},data:{expiresAt:new Date(Date.now()+60_000)}});
   await expect(requireAdmin(tx,headers,{lock:true})).resolves.toMatchObject({id:userId});
   await tx.session.update({where:{id:actor.sessionId},data:{expiresAt:new Date(Date.now()-1_000)}});
   await expect(requireAdmin(tx,headers,{lock:true})).rejects.toMatchObject({status:401});
   await tx.session.update({where:{id:actor.sessionId},data:{expiresAt:session.expiresAt}});
  });
 });
 it('rejects a signed Telegram session even on an approved account with a grant',async()=>{
  const token=randomUUID(),sessionId=randomUUID(),telegramId='1234567',expiresAt=new Date(Date.now()+60_000);
  await db.$transaction(async tx=>{
   await tx.session.create({data:{id:sessionId,token,userId,expiresAt,telegramAuthSource:'TELEGRAM_OIDC',telegramLaunchId:telegramId}});
   await tx.staffSession.create({data:{sessionId,credentialAt:new Date(),expiresAt,authMethod:'email-password'}});
   const signed=encodeURIComponent(token+'.'+await makeSignature(token,process.env.BETTER_AUTH_SECRET!));
   const headers=new Headers({cookie:cookie.split('=',1)[0]+'='+signed});
   // Verify the fixture reaches the session checks with a valid signature.
   const {signedSessionToken}=await import('../src/modules/auth/signed-session');
   expect(await signedSessionToken(headers)===token).toBe(true);
   await expect(requireAdmin(tx,headers,{lock:true,permission:'cancel'})).rejects.toMatchObject({status:403});
   await tx.session.delete({where:{id:sessionId}});
  });
 });
 it('revokes sessions immediately on role demotion, including direct API authorization',async()=>{
  await db.user.update({where:{id:userId},data:{role:'member'}});expect(await db.session.count({where:{userId}})).toBe(0);await expect(requireAdmin(db,new Headers({cookie}))).rejects.toMatchObject({status:401});await db.user.update({where:{id:userId},data:{role:'admin'}});
 });
 it('resets with a single-use Better Auth token and revokes existing sessions',async()=>{
  const login=await post('sign-in/email',credentials());expect(login.status).toBe(200);const oldCookie=login.headers.getSetCookie().find(value=>value.includes('session_token='))!.split(';')[0];
  expect((await post('request-password-reset',{email,redirectTo:origin+'/admin/login'})).status).toBe(200);
  const link=new URL(latestLink()),resetToken=link.pathname.split('/').at(-1)!;expect(link.pathname).toContain('/api/auth/reset-password/');
  expect((await post('reset-password',{token:resetToken,newPassword:'Fixture-replacement-password-12345'})).status).toBe(200);expect((await post('reset-password',{token:resetToken,newPassword:'Fixture-replay-password-12345'})).status).toBe(400);
  expect(await db.session.count({where:{userId}})).toBe(0);await expect(requireAdmin(db,new Headers({cookie:oldCookie}))).rejects.toMatchObject({status:401});
  expect((await post('sign-in/email',{email,password:'Fixture-replacement-password-12345'})).status).toBe(200);
 });
 it('logs out and revokes the issued server session',async()=>{
  const response=await post('sign-in/email',{email,password:'Fixture-replacement-password-12345'});const active=response.headers.getSetCookie().find(value=>value.includes('session_token='))!.split(';')[0];
  expect((await post('sign-out',{},active)).status).toBe(200);await expect(requireAdmin(db,new Headers({cookie:active}))).rejects.toMatchObject({status:401});
 });
});
