import {Prisma as MoneyPrisma} from '@prisma/client';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {createServer,type Server} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {bootstrapOwner} from '../src/modules/admin/bootstrap';
import {totp,digest} from '../src/modules/admin/crypto';
import {emailAdapter} from '../src/modules/admin/email';
import {bidAuction,bidUser} from './bid-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {reconcile} from '../src/modules/wallet/ledger';
import {TEST_TOKEN,signedLaunch} from './helpers';
const url=process.env.ADMIN_TEST_DATABASE_URL;
describe.skipIf(!url)('Phase 5A invite-only Owner operations',()=>{
 let client:PrismaClient,sink:Server,handleAuth:typeof import('../src/modules/auth/handler').handleAuth,admin:typeof import('../src/app/api/admin/[...path]/route'),cookie='',incomplete='',secret='',codes:string[]=[],ownerId='',auction:Awaited<ReturnType<typeof bidAuction>>,productId='',draftId='',inviteToken='';
 const messages:{to:string;text:string}[]=[],password='Fixture-only-password-12345',email='owner@lowin.test';
 const request=(path:string,body?:unknown,session=cookie)=>new Request(`http://localhost:3000${path}`,{method:body===undefined?'GET':'POST',headers:{origin:'http://localhost:3000','content-type':'application/json',...(session?{cookie:session}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 async function auth(action:string,body:unknown,session=cookie){return handleAuth(request(`/api/auth/lowin/staff/${action}`,body,session))}
 function takeCookie(r:Response){return r.headers.get('set-cookie')!.split(';')[0]}
 async function get(path:string,session=cookie){return admin.GET(request(`/api/admin/${path}`,undefined,session),{params:Promise.resolve({path:path.split('/')})})}
 async function cmd(action:string,input:unknown,session=cookie){return admin.POST(request('/api/admin/command',{action,input},session),{params:Promise.resolve({path:['command']})})}
 async function okay(response:Response){const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(200);return body}
 beforeAll(async()=>{
  const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Loopback disposable DB required');
  sink=createServer(async(req,res)=>{let data='';for await(const part of req)data+=part;messages.push(JSON.parse(data));res.writeHead(204);res.end()});await new Promise<void>(resolve=>sink.listen(0,'127.0.0.1',resolve));
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two',ADMIN_BOOTSTRAP_ENABLED:'true',ADMIN_MFA_KEY:'a'.repeat(64),EMAIL_TRANSPORT:'local-sink',EMAIL_SINK_URL:`http://127.0.0.1:${(sink.address() as {port:number}).port}`});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});client=new PrismaClient();({handleAuth}=await import('../src/modules/auth/handler'));admin=await import('../src/app/api/admin/[...path]/route');
 },60000);
 afterAll(async()=>{await client?.$disconnect();const {db}=await import('../src/lib/db');await db.$disconnect();await new Promise<void>(resolve=>sink?.close(()=>resolve()))});
 it('delivers one audited Owner invitation to a real local HTTP sink and denies bootstrap replay',async()=>{
  await bootstrapOwner(client,email);expect(messages).toHaveLength(1);const link=messages[0].text.match(/http[^\s]+/)![0];inviteToken=new URLSearchParams(new URL(link).hash.slice(1)).get('invite')!;
  expect(await client.staffToken.findUnique({where:{tokenHash:digest(inviteToken)}})).not.toBeNull();expect(await client.staffMember.count()).toBe(0);await expect(bootstrapOwner(client,'other@lowin.test')).rejects.toThrow('already');expect(await client.adminAudit.count({where:{action:'OWNER_INVITED'}})).toBe(1);
 });
 it('denies public signup and privileged Better Auth routes',async()=>{
  for(const path of ['sign-up/email','sign-in/email','set-password','admin/set-role','admin/impersonate-user','admin/remove-user','two-factor/disable'])expect((await handleAuth(request(`/api/auth/${path}`,{email,password,role:'OWNER'},''))).status).toBe(404);
 });
 it('accepts the verified invite once but gives an enrollment session no admin permissions',async()=>{
  const response=await auth('accept-invite',{token:inviteToken,password},'');expect(await okay(response)).toEqual({mode:'enroll'});cookie=incomplete=takeCookie(response);ownerId=(await client.user.findUniqueOrThrow({where:{email}})).id;expect((await get('dashboard')).status).toBe(403);expect((await cmd('category',{role:'OWNER'})).status).not.toBe(200);expect((await auth('accept-invite',{token:inviteToken,password},'')).status).toBe(400);
 });
 it('enrolls RFC6238 TOTP, rotates the exact session and returns recovery codes once',async()=>{
  const enrollment=await okay(await auth('enroll',{}));secret=enrollment.secret;expect(secret).toHaveLength(32);expect((await auth('mfa',{code:'000000'})).status).toBe(401);
  const r=await auth('mfa',{code:totp(secret,BigInt(Math.floor(Date.now()/30000)))});const body=await okay(r);cookie=takeCookie(r);codes=body.recoveryCodes;expect(codes).toHaveLength(10);expect(cookie).not.toBe(incomplete);expect((await get('dashboard',incomplete)).status).toBe(401);expect((await get('dashboard')).status).toBe(200);
  const member=await client.staffMember.findUniqueOrThrow({where:{userId:ownerId}});expect(member.secret).not.toContain(secret);expect(member.recoveryHashes).not.toContain(codes[0]);expect((await auth('enroll',{})).status).toBe(409);
 });
 it('denies guest, Telegram, forged role, and password-only sessions through direct APIs',async()=>{
  expect((await get('dashboard','')).status).toBe(401);const telegram=await handleAuth(request('/api/auth/telegram/miniapp/signin',{initData:signedLaunch()},''));expect(telegram.status).toBe(200);expect((await get('dashboard',takeCookie(telegram))).status).toBe(403);
  const login=await auth('login',{email,password,role:'OWNER'},'');expect(login.status).toBe(400);const plain=await auth('login',{email,password},'');await okay(plain);expect((await get('dashboard',takeCookie(plain))).status).toBe(403);
 });
 it('creates real inventory, validates and sanitizes images, rejects SVG and untrusted input',async()=>{
  const category=await okay(await cmd('category',{key:randomUUID(),version:0,name:'Admin test category',slug:`admin-${randomUUID()}`,description:'DEMO category',visible:true,requiresEligibilityReview:false}));
  const bad=await cmd('media',{key:randomUUID(),mime:'image/png',data:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),sourceType:'SUPPLIED',sourceCredit:'test',rightsConfirmed:true});expect(bad.status).toBe(422);
  const png=await sharp({create:{width:50,height:50,channels:3,background:'#184d3a'}}).png().toBuffer();const image=await okay(await cmd('media',{key:randomUUID(),mime:'image/png',data:png.toString('base64'),sourceType:'ORIGINAL',sourceCredit:'Original test pixels',rightsConfirmed:true}));
  const product=await okay(await cmd('product',{key:randomUUID(),version:0,title:'DEMO admin item',slug:`admin-${randomUUID()}`,description:'Isolated test inventory',condition:'New',categoryId:category.id,isDemo:true,visible:true,imageIds:[image.id]}));productId=product.id;
 });
 it('saves draft terms and serializes concurrent publication exactly once',async()=>{
  const draft=await okay(await cmd('draft',{key:randomUUID(),version:0,body:{productId,startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),minPoints:'1',maxPoints:'100',stepPoints:'0.01',entryFeePoints:'2',fulfillmentSummary:'DEMO only',fulfillmentRegion:'Local',featured:false}}));draftId=draft.auctionId;
  const preview=await okay(await get(`auctions/${draftId}/preflight`));expect(preview.ready).toBe(true);const input={key:randomUUID(),auctionId:draftId,version:1};const results=await Promise.all([cmd('publish',input),cmd('publish',input)]);expect(await okay(results[0])).toEqual(await okay(results[1]));expect(await client.auctionTerms.count({where:{auctionId:draftId}})).toBe(1);expect(await client.adminAudit.count({where:{action:'PUBLISH',target:draftId}})).toBe(1);
 });
 it('preserves frozen published terms, inventory and DEMO identity',async()=>{
  await expect(client.auction.update({where:{id:draftId},data:{endsAt:new Date(Date.now()+200000)}})).rejects.toThrow();await expect(client.auctionTerms.update({where:{auctionId:draftId},data:{entryFeePoints:new MoneyPrisma.Decimal("99")}})).rejects.toThrow();await expect(client.auctionDraft.update({where:{auctionId:draftId},data:{version:99}})).rejects.toThrow();
  const p=await client.product.findUniqueOrThrow({where:{id:productId}});expect((await cmd('product',{key:randomUUID(),id:p.id,version:p.version,title:p.title,slug:p.slug,description:p.description,condition:p.condition,categoryId:p.categoryId,isDemo:false,visible:true,imageIds:[]})).status).toBe(409);
 });
 it('reports exact cancellation impact, rejects stale impact and requires fresh MFA',async()=>{
  auction=await bidAuction(client,{fee:3});const a=await bidUser(client),b=await bidUser(client);await submitBid(client,{userId:a,auctionSlug:auction.slug!,amount:'4',key:randomUUID()});await submitBid(client,{userId:b,auctionSlug:auction.slug!,amount:'9',key:randomUUID()});
  const impact=await okay(await get(`auctions/${auction.id}/impact`));expect(impact).toMatchObject({affectedBidders:2,heldPoints:'13',feeRefund:'6'});expect(impact.participants.map((p:{feeRefund:string})=>p.feeRefund)).toEqual(['3','3']);expect(JSON.stringify(impact)).not.toMatch(/amountFrequencies|winningBid|telegram/);
  expect((await get(`auctions/${auction.id}/proof`)).status).toBe(409);
  expect((await cmd('cancel',{key:randomUUID(),auctionId:auction.id,reason:'DEMO cancellation',confirmation:auction.code,impactHash:'0'.repeat(64)})).status).toBe(409);
  const grant=await client.staffSession.findFirstOrThrow({where:{mfaAt:{not:null},session:{userId:ownerId}}});await client.staffSession.update({where:{sessionId:grant.sessionId},data:{credentialAt:new Date(Date.now()-600000),mfaAt:new Date(Date.now()-360000)}});
  expect((await cmd('cancel',{key:randomUUID(),auctionId:auction.id,reason:'DEMO cancellation',confirmation:auction.code,impactHash:impact.impactHash})).status).toBe(403);
  const fresh=await auth('step-up',{code:totp(secret,BigInt(Math.floor(Date.now()/30000)+1))});await okay(fresh);
 });
 it('rolls cancellation back if its immutable audit cannot commit',async()=>{
  const impact=await okay(await get(`auctions/${auction.id}/impact`));
  await client.$executeRawUnsafe(`CREATE FUNCTION test_admin_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CANCEL' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$`);
  await client.$executeRawUnsafe(`CREATE TRIGGER test_admin_failure BEFORE INSERT ON "AdminAudit" FOR EACH ROW EXECUTE FUNCTION test_admin_failure()`);
  try{expect((await cmd('cancel',{key:randomUUID(),auctionId:auction.id,reason:'DEMO rollback',confirmation:auction.code,impactHash:impact.impactHash})).status).toBe(503);expect(await client.auctionSettlement.count({where:{auctionId:auction.id}})).toBe(0);expect((await okay(await get(`auctions/${auction.id}/impact`))).heldPoints).toBe('13');expect(await reconcile(client)).toEqual([])}finally{await client.$executeRawUnsafe('DROP TRIGGER test_admin_failure ON "AdminAudit"');await client.$executeRawUnsafe('DROP FUNCTION test_admin_failure()')}
 });
 it('refunds fees and releases holds exactly once under concurrent cancellation retries',async()=>{
  const impact=await okay(await get(`auctions/${auction.id}/impact`)),input={key:randomUUID(),auctionId:auction.id,reason:'DEMO cancellation',confirmation:auction.code,impactHash:impact.impactHash};
  const responses=await Promise.all([cmd('cancel',input),cmd('cancel',input)]);expect(await okay(responses[0])).toEqual(await okay(responses[1]));expect((await cmd('cancel',{...input,reason:'changed'})).status).toBe(409);expect(await client.auctionSettlement.count({where:{auctionId:auction.id}})).toBe(1);expect(await reconcile(client)).toEqual([]);
  const proof=await okay(await get(`auctions/${auction.id}/proof`));expect(proof.settlement.outcome).toBe('CANCELLED');expect(proof.journals.length).toBeGreaterThan(0);
 });
 it('keeps audit evidence immutable and rejects cross-origin mutation',async()=>{
  const row=await client.adminAudit.findFirstOrThrow();await expect(client.adminAudit.update({where:{id:row.id},data:{actorId:'forged'}})).rejects.toThrow();await expect(client.adminAudit.delete({where:{id:row.id}})).rejects.toThrow();await expect(client.$executeRawUnsafe('TRUNCATE "AdminAudit"')).rejects.toThrow();
  const r=new Request('http://localhost:3000/api/admin/command',{method:'POST',headers:{cookie,origin:'https://attacker.example','content-type':'application/json'},body:'{}'});expect((await admin.POST(r,{params:Promise.resolve({path:['command']})})).status).toBe(403);
 });
 it('persists Home and FAQ plain text through audited idempotent commands',async()=>{
  const input={key:randomUUID(),id:'home',version:0,body:{headline:'DEMO home',lead:'Database content'}};expect(await okay(await cmd('content',input))).toEqual(await okay(await cmd('content',input)));expect((await cmd('content',{...input,body:{headline:'Changed',lead:'Changed'}})).status).toBe(409);
  expect((await okay(await get('content')))[0].body.headline).toBe('DEMO home');
 });
 it('serializes publish and cancel on the auction row with no partial final state',async()=>{
  const source=await client.auctionDraft.findUniqueOrThrow({where:{auctionId:draftId}});const draft=await okay(await cmd('draft',{key:randomUUID(),version:0,body:source.body}));const row=await client.auction.findUniqueOrThrow({where:{id:draft.auctionId}});
  const impact={auctionId:row.id,code:row.code,affectedBidders:0,acceptedBids:0,heldPoints:'0',feeRefund:'0',participants:[]};
  const responses=await Promise.all([cmd('publish',{key:randomUUID(),auctionId:row.id,version:1}),cmd('cancel',{key:randomUUID(),auctionId:row.id,reason:'DEMO race',confirmation:row.code,impactHash:digest(JSON.stringify(impact))})]);expect(responses[0].status).toBe(200);expect([200,409]).toContain(responses[1].status);const final=await client.auction.findUniqueOrThrow({where:{id:row.id},include:{settlement:true}});expect(final.status).toBe(final.settlement?'CANCELLED':'SCHEDULED');expect(await reconcile(client)).toEqual([]);
 });
 it('expires session assurance and verifies a fresh credential-plus-TOTP challenge',async()=>{
  const grant=await client.staffSession.findFirstOrThrow({where:{mfaAt:{not:null},session:{userId:ownerId}}});await client.staffSession.update({where:{sessionId:grant.sessionId},data:{expiresAt:new Date(Date.now()-1000)}});expect((await get('dashboard')).status).toBe(403);
  const login=await auth('login',{email,password},'');await okay(login);cookie=takeCookie(login);const member=await client.staffMember.findUniqueOrThrow({where:{userId:ownerId}});const next=member.lastCounter+1n;
  const wait=Math.max(0,(Number(next)-1)*30000-Date.now()+100);if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  const response=await auth('mfa',{code:totp(secret,next)});await okay(response);cookie=takeCookie(response);expect((await get('dashboard')).status).toBe(200);
 },40000);
 it('uses generic forgot responses, one-time reset tokens and revokes all sessions',async()=>{
  const known=await okay(await auth('forgot',{email},'')),unknown=await okay(await auth('forgot',{email:'missing@lowin.test'},''));expect(known).toEqual(unknown);
  const link=messages.at(-1)!.text.match(/http[^\s]+/)![0],reset=new URLSearchParams(new URL(link).hash.slice(1)).get('reset')!;
  await okay(await auth('reset',{token:reset,password:'Replacement-password-12345'},''));expect((await get('dashboard')).status).toBe(401);expect(await client.session.count({where:{userId:ownerId}})).toBe(0);expect((await auth('reset',{token:reset,password},'')).status).toBe(400);expect((await auth('login',{email,password},'')).status).toBe(401);
 });
 it('recovery codes revoke sessions and require enrollment again before any permission',async()=>{
  const login=await auth('login',{email,password:'Replacement-password-12345'},'');await okay(login);cookie=takeCookie(login);const recovery=await auth('mfa',{code:codes[0]});expect(await okay(recovery)).toMatchObject({mode:'enroll'});cookie=takeCookie(recovery);expect((await get('dashboard')).status).toBe(403);expect((await client.staffMember.findUniqueOrThrow({where:{userId:ownerId}})).recoveryHashes).toEqual([]);expect((await auth('mfa',{code:codes[0]})).status).not.toBe(200);
 });
 it('fails closed for production email and reconciles all account/hold projections',async()=>{
  expect(()=>emailAdapter({...process.env,NODE_ENV:'production'})).toThrow();expect(()=>emailAdapter({...process.env,DATABASE_URL:'postgresql://u:secret@remote.example/prod'})).toThrow();expect(await reconcile(client)).toEqual([]);
 });
 it('cannot bypass MFA throttling by appending browser-controlled cookies',async()=>{
  for(let i=0;i<12;i++)await auth('mfa',{code:'000000'},`${cookie}; noise=${i}`);
  expect((await auth('mfa',{code:'111111'},`${cookie}; noise=fresh`)).status).toBe(429);
 });
});
