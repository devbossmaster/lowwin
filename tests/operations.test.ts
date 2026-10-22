import {verifyFixtureContact} from './contact-fixtures';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {createServer,type Server} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Bot,InputFile} from 'grammy';
import {bootstrapOwner,reissueInitialOwner} from '../src/modules/admin/bootstrap';
import {totp,digest} from '../src/modules/admin/crypto';
import {bidAuction,bidUser} from './bid-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {closeAuction,cancelAuction} from '../src/modules/auctions/settlement';
import {queueGlobal,expandCampaign} from '../src/modules/notifications/campaigns';
import sharp from 'sharp';
import {dispatchOne,scheduleAlerts,enqueueAlert} from '../src/modules/notifications/service';
import {reconcile} from '../src/modules/wallet/ledger';
import {processOneUpdate} from '../src/modules/bot/worker';
import {TEST_TOKEN,signedLaunch} from './helpers';
const url=process.env.OPS_TEST_DATABASE_URL;
describe.skipIf(!url)('Phase 5B scoped operations and private alerts',()=>{
 let db:PrismaClient,sink:Server,auth:typeof import('../src/modules/auth/handler').handleAuth,admin:typeof import('../src/app/api/admin/[...path]/route'),alerts:typeof import('../src/app/api/alerts/route'),fulfillment:typeof import('../src/app/api/fulfillment/route'),owner='',ownerId='',initial='',winner:Awaited<ReturnType<typeof bidAuction>>,player='',playerId='',player2='',player2Id='';
 const messages:{to:string;text:string}[]=[],roles:Record<string,{cookie:string;id:string}>={},password='Ops-test-password-12345';
 const req=(path:string,body?:unknown,cookie=owner)=>new Request(`https://lowin.ngrok-free.app/api/${path}`,{method:body===undefined?'GET':'POST',headers:{origin:'https://lowin.ngrok-free.app','content-type':'application/json',cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const get=(path:string,cookie=owner)=>admin.GET(req(`admin/${path}`,undefined,cookie),{params:Promise.resolve({path:path.split('?')[0].split('/')})});
 const cmd=(action:string,input:unknown,cookie=owner)=>admin.POST(req('admin/command',{action,input},cookie),{params:Promise.resolve({path:['command']})});
 const staff=(action:string,body:unknown,cookie=owner)=>auth(req(`auth/lowin/staff/${action}`,body,cookie));
 const okay=async(r:Response)=>{const b=await r.json();expect(r.status,JSON.stringify(b)).toBe(200);return b};
 const cookie=(r:Response)=>r.headers.get('set-cookie')!.split(';')[0];
 const invitation=(email:string)=>new URLSearchParams(new URL(messages.filter(m=>m.to===email).at(-1)!.text.match(/http[^\s]+/)![0]).hash.slice(1)).get('invite')!;
 async function enroll(email:string){const c=cookie(await staff('accept-invite',{token:invitation(email),password},'')),secret=(await okay(await staff('enroll',{},c))).secret,r=await staff('mfa',{code:totp(secret,BigInt(Math.floor(Date.now()/30000)))},c);await okay(r);return {cookie:cookie(r),id:(await db.user.findUniqueOrThrow({where:{email}})).id}}
 async function sign(id:number){await verifyFixtureContact(db,id);const r=await auth(req('auth/telegram/miniapp/signin',{initData:signedLaunch({user:JSON.stringify({id,first_name:'Private test player'})})},''));await okay(r);return {cookie:cookie(r),id:(await db.user.findUniqueOrThrow({where:{telegramId:String(id)}})).id}}
 beforeAll(async()=>{
  const target=new URL(url!);if(!['localhost','127.0.0.1'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback DB required');
  sink=createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;messages.push(JSON.parse(body));res.writeHead(204).end()});await new Promise<void>(resolve=>sink.listen(0,'127.0.0.1',resolve));
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',BETTER_AUTH_URL:'https://lowin.ngrok-free.app',MINI_APP_URL:'https://lowin.ngrok-free.app',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two',ADMIN_BOOTSTRAP_ENABLED:'true',ADMIN_MFA_KEY:'a'.repeat(64),EMAIL_TRANSPORT:'local-sink',EMAIL_SINK_URL:`http://127.0.0.1:${(sink.address() as {port:number}).port}`});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient();({handleAuth:auth}=await import('../src/modules/auth/handler'));admin=await import('../src/app/api/admin/[...path]/route');alerts=await import('../src/app/api/alerts/route');fulfillment=await import('../src/app/api/fulfillment/route');
 },60000);
 afterAll(async()=>{await db?.$disconnect();await (await import('../src/lib/db')).db.$disconnect();await new Promise<void>(resolve=>sink?.close(()=>resolve()))});
 it('rotates an expired unclaimed initial Owner invitation exactly once with audit',async()=>{
  await bootstrapOwner(db,'ops-owner@lowin.test');initial=invitation('ops-owner@lowin.test');await expect(reissueInitialOwner(db,'Premature recovery')).rejects.toThrow('expired');await db.staffToken.update({where:{tokenHash:digest(initial)},data:{expiresAt:new Date(Date.now()-1000)}});await reissueInitialOwner(db,'Expired initial invitation','replacement-owner@lowin.test');expect(invitation('replacement-owner@lowin.test')).not.toBe(initial);await expect(reissueInitialOwner(db,'Second recovery attempt')).rejects.toThrow('unavailable');expect((await staff('accept-invite',{token:initial,password},'')).status).toBe(400);const result=await enroll('replacement-owner@lowin.test');owner=result.cookie;ownerId=result.id;expect(await db.staffMember.count({where:{role:'OWNER'}})).toBe(1);
 });
 it('invites five narrow roles through verified email and mandatory MFA',async()=>{for(const role of ['CATALOG_MANAGER','SUPPORT','FULFILLMENT','PAYMENTS_OPERATOR','AUDITOR']){const email=`${role.toLowerCase()}@lowin.test`;await okay(await cmd('invite',{key:randomUUID(),email,role,reason:'Scoped test invitation'}));roles[role]=await enroll(email);expect((await get('me',roles[role].cookie)).status).toBe(200)}});
 it('denies direct cross-role APIs and browser-derived roles',async()=>{expect((await cmd('publish',{key:randomUUID(),auctionId:randomUUID(),version:1},roles.CATALOG_MANAGER.cookie)).status).toBe(403);expect((await get('team',roles.SUPPORT.cookie)).status).toBe(403);expect((await get('support',roles.CATALOG_MANAGER.cookie)).status).toBe(404);expect((await get('users',roles.CATALOG_MANAGER.cookie)).status).toBe(403);expect((await get('wallets',roles.PAYMENTS_OPERATOR.cookie)).status).toBe(200);expect((await get('fulfillment',roles.AUDITOR.cookie)).status).toBe(403);expect((await cmd('invite',{key:randomUUID(),email:'evil@lowin.test',role:'OWNER',reason:'Escalation attempt'},roles.SUPPORT.cookie)).status).toBe(403);expect((await cmd('staff',{key:randomUUID(),userId:ownerId,active:false,role:'SUPPORT',reason:'Self demotion'})).status).toBe(403);await expect(db.staffMember.update({where:{userId:ownerId},data:{active:false}})).rejects.toThrow('last active Owner')});
 it('revokes already-open sessions immediately and blocks every staff identity from bidding',async()=>{const a=await bidAuction(db);await expect(submitBid(db,{userId:roles.SUPPORT.id,auctionSlug:a.slug!,amount:'2',key:randomUUID()})).rejects.toMatchObject({code:'BIDDING_RESTRICTED'});await okay(await cmd('staff',{key:randomUUID(),userId:roles.PAYMENTS_OPERATOR.id,active:false,role:'PAYMENTS_OPERATOR',reason:'Access no longer required'}));expect((await get('wallets',roles.PAYMENTS_OPERATOR.cookie)).status).toBe(401);expect(await db.session.count({where:{userId:roles.PAYMENTS_OPERATOR.id}})).toBe(0)});
 it('returns real page counts and records beyond the old 200 cap',async()=>{const c=await db.category.create({data:{name:'Pagination test',slug:'pagination-test',description:'Test'}});await db.product.createMany({data:Array.from({length:211},(_,i)=>({title:`Page item ${String(i).padStart(3,'0')}`,slug:`page-item-${i}`,description:'Test',condition:'New',categoryId:c.id,isDemo:true}))});const first=await okay(await get('products?q=Page%20item')),last=await okay(await get('products?q=Page%20item&page=9'));expect(first.total).toBe(211);expect(first.items).toHaveLength(25);expect(last.items).toHaveLength(11);expect(last.items[0].title).toBe('Page item 200');await db.auction.createMany({data:Array.from({length:211},(_,i)=>({code:`PAGE-${i}`,slug:`page-auction-${i}`}))});expect((await okay(await get('auctions?q=PAGE-&page=9'))).items).toHaveLength(11)});
 it('counts distinct participants and classifies published schedules using database time',async()=>{
  const a=await bidAuction(db,{ruleVersion:'lowest-unique-v3'}),u=await bidUser(db),v=await bidUser(db);
  for(const [userId,amount] of [[u,'1.01'],[u,'2.34'],[v,'3.45']])await submitBid(db,{userId,auctionSlug:a.slug!,amount,key:randomUUID()});
  const row=(await okay(await get(`auctions?q=${a.code}&status=LIVE`))).items[0];expect(row.participants).toBe(2);expect(row.acceptedBids).toBe(3);expect(row.displayStatus).toBe('LIVE');
  const upcoming=await bidAuction(db,{startOffsetMs:120000});expect((await okay(await get(`auctions?q=${upcoming.code}&status=LIVE`))).total).toBe(0);expect((await okay(await get(`auctions?q=${upcoming.code}&status=UPCOMING`))).total).toBe(1);
  const closing=await bidAuction(db,{endDelayMs:-1});expect((await okay(await get(`auctions?q=${closing.code}&status=CLOSING`))).total).toBe(1);
  expect((await get('auctions?status=INVENTED')).status).toBe(422);
 });
 it('scopes Overview per role and avoids reconciliation scans',async()=>{
  const support=await okay(await get('dashboard',roles.SUPPORT.cookie));expect(support.auctions).toBeUndefined();expect(support.deliveries).toBeUndefined();expect(support.payments.state).toBe('ready');expect(support.support).toBeUndefined();expect(support.reconciliation).toBeUndefined();
  const catalog=await okay(await get('dashboard',roles.CATALOG_MANAGER.cookie));expect(catalog.auctions.state).toBe('ready');expect(catalog.payments).toBeUndefined();expect(catalog.support).toBeUndefined();
  const delivery=await okay(await get('dashboard',roles.FULFILLMENT.cookie));expect(delivery.deliveries).toEqual({state:'ready',count:0});expect(delivery.payments).toBeUndefined();expect((await get('fulfillment/staff',roles.FULFILLMENT.cookie)).status).toBe(403);
  const staff=await okay(await get('fulfillment/staff'));expect(staff.items.some((r:any)=>r.userId===roles.FULFILLMENT.id)).toBe(true);expect(staff.items.some((r:any)=>r.userId===roles.SUPPORT.id)).toBe(false);
 });
 it('isolates signed-in inboxes, supports read actions, and keeps bids private',async()=>{const a=await sign(910000001),b=await sign(910000002);player=a.cookie;playerId=a.id;player2=b.cookie;player2Id=b.id;const {creditDevelopmentPoints}=await import('../src/modules/wallet/ledger');await creditDevelopmentPoints(db,playerId,'1000',randomUUID());winner=await bidAuction(db,{fee:2,endDelayMs:1800});const input={userId:playerId,auctionSlug:winner.slug!,amount:'5',key:randomUUID()};await submitBid(db,input);await submitBid(db,input);const one=await okay(await alerts.GET(req('alerts',undefined,player))),two=await okay(await alerts.GET(req('alerts',undefined,player2)));expect(one.items).toHaveLength(1);expect(two.items).toHaveLength(0);expect(JSON.stringify(one)).not.toMatch(/recipientUserId|amountFrequencies|telegramId|walletId/);await okay(await alerts.POST(req('alerts',{action:'read',id:one.items[0].id},player2)));expect((await okay(await alerts.GET(req('alerts',undefined,player)))).unread).toBe(1);await okay(await alerts.POST(req('alerts',{action:'read'},player)));expect((await okay(await alerts.GET(req('alerts',undefined,player)))).unread).toBe(0);expect((await alerts.GET(req('alerts',undefined,''))).status).toBe(401)});
 it('suspends only new bids, preserves accepted outcomes and refunds on cancellation',async()=>{expect((await cmd('suspend',{key:randomUUID(),userId:playerId,suspended:true,reason:'Investigate player report'},roles.SUPPORT.cookie)).status).toBe(403);await okay(await cmd('suspend',{key:randomUUID(),userId:playerId,suspended:true,reason:'Owner reviewed player report'}));const a=await bidAuction(db);await expect(submitBid(db,{userId:playerId,auctionSlug:a.slug!,amount:'4',key:randomUUID()})).rejects.toMatchObject({code:'BIDDING_RESTRICTED'});await new Promise(r=>setTimeout(r,1900));const s=await closeAuction(db,winner.id);expect(s.winnerUserId).toBe(playerId);expect(await reconcile(db)).toEqual([]);const u=await bidUser(db),c=await bidAuction(db,{fee:3});await submitBid(db,{userId:u,auctionSlug:c.slug!,amount:'4',key:randomUUID()});await cancelAuction(db,{auctionId:c.id,actor:{id:ownerId,permission:'auction:cancel'},reason:'Test cancellation',key:randomUUID()});expect(await reconcile(db)).toEqual([])});
 it('includes a settled winner without a delivery case and omits the retired inbox',async()=>{
  const queue=await okay(await get('fulfillment?status=INCOMPLETE'));expect(queue.items.find((r:any)=>r.auctionId===winner.id)).toMatchObject({state:'PENDING',version:0});
  await db.supportCase.createMany({data:[{userId:playerId,subject:'Overview fixture open',message:'DEMO',status:'OPEN'},{userId:playerId,subject:'Overview fixture investigating',message:'DEMO',status:'INVESTIGATING'},{userId:playerId,subject:'Overview fixture resolved',message:'DEMO',status:'RESOLVED'}]});
  expect((await get('support?status=ACTIVE&q=Overview%20fixture')).status).toBe(404);
  const dash=await okay(await get('dashboard'));expect(dash.deliveries.state).toBe('ready');expect(dash.deliveries.count).toBe(queue.total);
 });
 it('protects delivery contacts by ownership and assignment without changing immutable proof',async()=>{const before=JSON.stringify(await db.auctionSettlement.findUnique({where:{auctionId:winner.id}}),(_,v)=>typeof v==='bigint'?v.toString():v);expect((await fulfillment.POST(req('fulfillment',{auctionId:winner.id,action:'claim',name:'Test receiver',phone:'TEST ONLY',address:'Test address'},player2))).status).toBe(404);await okay(await fulfillment.POST(req('fulfillment',{auctionId:winner.id,action:'claim',name:'Test receiver',phone:'TEST ONLY',address:'Test address'},player)));expect((await get(`fulfillment/${winner.id}`,roles.FULFILLMENT.cookie)).status).toBe(404);expect((await get(`fulfillment/${winner.id}`,roles.SUPPORT.cookie)).status).toBe(403);await okay(await cmd('fulfillment',{key:randomUUID(),auctionId:winner.id,version:1,state:'CLAIMED',tracking:'',assignedTo:roles.FULFILLMENT.id,reason:'Assign fulfillment specialist'}));const contact=await okay(await get(`fulfillment/${winner.id}`,roles.FULFILLMENT.cookie));expect(contact.contact.phone).toBe('TEST ONLY');expect(contact.contactCipher).toBeUndefined();await okay(await cmd('fulfillment',{key:randomUUID(),auctionId:winner.id,version:2,state:'PACKING',tracking:'',reason:'Test packing confirmed'},roles.FULFILLMENT.cookie));expect(JSON.stringify(await db.auctionSettlement.findUnique({where:{auctionId:winner.id}}),(_,v)=>typeof v==='bigint'?v.toString():v)).toBe(before);expect((await db.user.findUniqueOrThrow({where:{id:playerId}})).telegramPhoneNumber).toBeNull();expect(JSON.stringify(await okay(await fulfillment.GET(req('fulfillment',undefined,player2))))).not.toContain(winner.id)});
 it('schedules an upcoming reminder once and deduplicates recipient jobs in the database',async()=>{
  const a=await bidAuction(db,{startOffsetMs:6*3600000,endDelayMs:7*3600000});
  await scheduleAlerts(db);await scheduleAlerts(db);
  const key=`global:upcoming:${a.id}`,root=await db.outbox.findUniqueOrThrow({where:{key}});
  expect(root.payload).toMatchObject({deliveryKind:'AUCTION_UPCOMING',auctionId:a.id});
  await db.$transaction(tx=>expandCampaign(tx,root));await db.$transaction(tx=>expandCampaign(tx,root));
  expect(await db.outbox.count({where:{key:`${key}:user:${playerId}`}})).toBe(1);
  expect(await db.outbox.count({where:{key:`${key}:user:${player2Id}`}})).toBe(1);
 });
 it('schedules global closing alerts once and suppresses stale future events',async()=>{const a=await bidAuction(db,{endDelayMs:600000});await scheduleAlerts(db);await scheduleAlerts(db);expect(await db.outbox.count({where:{key:`global:ending:${a.id}:v0`}})).toBe(1);await db.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED'}});const future=await bidAuction(db,{startOffsetMs:120000,endDelayMs:600000});const row=await db.outbox.create({data:{key:randomUUID(),kind:'AUCTION_ENDING',payload:{auctionId:future.id,recipientUserId:player2Id}}});const bot=new Bot(TEST_TOKEN);let sent=0;bot.api.config.use(async()=>{sent++;return {ok:true,result:{message_id:1}} as any});await dispatchOne(db,bot);expect(sent).toBe(0);expect((await db.outbox.findUniqueOrThrow({where:{id:row.id}})).state).toBe('SKIPPED')});
 it('uses intercepted grammY transport, respects 429 and blocked chats with bounded retries',async()=>{await db.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED'}});await db.notificationPreference.upsert({where:{userId:playerId},create:{userId:playerId,telegram:true},update:{telegram:true}});await db.botChat.create({data:{telegramId:'910000001',chatId:'910000001'}});const row=await db.$transaction(tx=>enqueueAlert(tx,{key:randomUUID(),kind:'AUCTION_RESULT',auctionId:winner.id,userId:playerId}));const bot=new Bot(TEST_TOKEN);let mode=429,calls=0;bot.api.config.use(async(_prev,method,payload)=>{calls++;expect(method).toBe('sendPhoto');expect(JSON.stringify((payload as {caption?:string}).caption)).not.toMatch(/TEST ONLY|Test address|5 points|1000/);return {ok:false,error_code:mode,description:'Test failure',parameters:mode===429?{retry_after:9}:undefined} as any});await dispatchOne(db,bot);let current=await db.outbox.findUniqueOrThrow({where:{id:row.id}});expect(current.lastError).toBe('RATE_LIMIT');expect(current.nextAttemptAt.getTime()-Date.now()).toBeGreaterThan(7000);await db.outbox.update({where:{id:row.id},data:{nextAttemptAt:new Date()}});mode=403;await dispatchOne(db,bot);expect((await db.botChat.findUniqueOrThrow({where:{telegramId:'910000001'}})).blocked).toBe(true);expect((await db.outbox.findUniqueOrThrow({where:{id:row.id}})).state).toBe('FAILED');expect(calls).toBe(2)});
 it('never accepts a browser chat ID and confirms only private bot /start',async()=>{expect((await alerts.POST(req('alerts',{action:'preferences',inApp:true,telegram:true,auctionStart:true,favoriteEnding:true,fulfillment:true,chatId:'123'},player))).status).toBe(422);const bot=new Bot(TEST_TOKEN,{botInfo:{id:123,is_bot:true,first_name:'test',username:'test_bot',can_join_groups:true,can_read_all_group_messages:false,supports_inline_queries:false,can_connect_to_business:false,has_main_web_app:false,has_topics_enabled:false,allows_users_to_create_topics:false}});await db.botUpdate.create({data:{updateId:910001n,payload:{update_id:910001,message:{message_id:1,date:1,chat:{id:910000001,type:'private'},from:{id:910000001,is_bot:false,first_name:'test'},text:'/start',entities:[{type:'bot_command',offset:0,length:6}]}}}});await processOneUpdate(db,bot);expect((await db.botChat.findUniqueOrThrow({where:{telegramId:'910000001'}})).blocked).toBe(false)});
 it('documents and tests crash-after-send replay without repeating points or inbox entries',async()=>{await db.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED'}});const row=await db.$transaction(tx=>enqueueAlert(tx,{key:randomUUID(),kind:'AUCTION_RESULT',auctionId:winner.id,userId:playerId})),before=await db.journal.count();let sent=0;const bot=new Bot(TEST_TOKEN);bot.api.config.use(async()=>{sent++;return {ok:true,result:{message_id:sent}} as any});await db.$executeRawUnsafe(`CREATE FUNCTION fail_delivery_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='SENT' THEN RAISE EXCEPTION 'test crash after send'; END IF; RETURN NEW; END $$`);await db.$executeRawUnsafe('CREATE TRIGGER fail_delivery_commit BEFORE UPDATE ON "Outbox" FOR EACH ROW EXECUTE FUNCTION fail_delivery_commit()');try{await expect(dispatchOne(db,bot)).rejects.toThrow()}finally{await db.$executeRawUnsafe('DROP TRIGGER fail_delivery_commit ON "Outbox"');await db.$executeRawUnsafe('DROP FUNCTION fail_delivery_commit()')}await dispatchOne(db,bot);expect(sent).toBe(2);expect(await db.notificationInbox.count({where:{key:row.key}})).toBe(1);expect(await db.journal.count()).toBe(before);expect(await reconcile(db)).toEqual([])});
 it('queues an Owner-only image broadcast idempotently with a personalized Bid button',async()=>{
  await db.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED'}});
  const image=await sharp({create:{width:240,height:240,channels:3,background:'#15803d'}}).png().toBuffer();
  const media=await okay(await cmd('media',{key:randomUUID(),mime:'image/png',data:image.toString('base64'),sourceType:'SUPPLIED',sourceCredit:'DEMO broadcast test',rightsConfirmed:true}));
  const auction=await bidAuction(db),input={key:randomUUID(),reason:'DEMO broadcast test',text:'Hello {name}, see the new auction.',auctionCode:String(auction.publicCode),imageId:media.id,confirmation:'SEND'};
  expect((await cmd('broadcast',input,roles.SUPPORT.cookie)).status).toBe(403);
  expect((await cmd('broadcast',{...input,imageId:randomUUID()})).status).toBe(422);
  const receipt=await okay(await cmd('broadcast',input));expect(await okay(await cmd('broadcast',input))).toEqual(receipt);
  expect((await cmd('broadcast',{...input,text:'Changed content'})).status).toBe(409);
  const root=await db.outbox.findUniqueOrThrow({where:{id:receipt.id}});await db.$transaction(tx=>expandCampaign(tx,root));
  await db.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED'}});
  const row=await db.outbox.findUniqueOrThrow({where:{key:`${root.key}:user:${playerId}`}});
  await db.outbox.update({where:{id:row.id},data:{state:'PENDING'}});
  await db.notificationPreference.upsert({where:{userId:playerId},create:{userId:playerId,telegram:false,inApp:false},update:{telegram:false,inApp:false}});
  const sent:any[]=[];const bot=new Bot(TEST_TOKEN);bot.api.config.use(async(_prev,method,payload)=>{sent.push({method,payload});return {ok:true,result:{message_id:1}} as any});await dispatchOne(db,bot);
  expect(sent).toHaveLength(1);expect(sent[0].method).toBe('sendPhoto');expect(sent[0].payload.photo).toBeInstanceOf(InputFile);
  expect(sent[0].payload.caption).toContain(`Hello ${(await db.user.findUniqueOrThrow({where:{id:playerId}})).name}`);expect(sent[0].payload.caption).not.toContain('{name}');
  expect(sent[0].payload.reply_markup.inline_keyboard[0][0]).toEqual({text:'Bid',web_app:{url:`https://lowin.ngrok-free.app/auctions/${auction.publicCode}`}});
  expect(await db.notificationInbox.count({where:{key:row.key}})).toBe(1);
  expect(await db.adminAudit.count({where:{action:'OPS_BROADCAST',target:root.id}})).toBe(1);
 });
 it('fans global events past 500 users without duplicate recipients or post-event signups',async()=>{
  const users=Array.from({length:601},(_,i)=>({id:randomUUID(),name:'DEMO campaign fixture',telegramId:String(920000000+i)}));await db.user.createMany({data:users});
  const root=await db.$transaction(tx=>queueGlobal(tx,`test:campaign:${randomUUID()}`,'BROADCAST',{body:'DEMO notice',href:'/auctions/all'}));
  const expected=await db.user.count({where:{telegramId:{not:null},staffMember:{is:null},createdAt:{lte:new Date((root.payload as any).audienceBefore)}}});
  const late=await db.user.create({data:{id:randomUUID(),name:'DEMO later signup',telegramId:'930000001',createdAt:new Date(Date.now()+10000)}});
  await db.$transaction(tx=>expandCampaign(tx,root));await db.$transaction(tx=>expandCampaign(tx,root));
  for(;;){const next=await db.outbox.findFirst({where:{kind:'GLOBAL_CAMPAIGN',state:'PENDING',key:{startsWith:root.key}}});if(!next)break;await db.$transaction(tx=>expandCampaign(tx,next))}
  const rows=await db.outbox.findMany({where:{kind:'BROADCAST',key:{startsWith:root.key}}});expect(rows).toHaveLength(expected);expect(rows.some(r=>(r.payload as any).recipientUserId===late.id)).toBe(false);
  expect(new Set(rows.map(r=>(r.payload as any).recipientUserId)).size).toBe(expected);
 });
 it('keeps ordinary bid receipts in the inbox without sending an extra Telegram category',async()=>{
  await db.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED'}});const row=await db.$transaction(tx=>enqueueAlert(tx,{key:randomUUID(),kind:'BID_ACCEPTED',auctionId:winner.id,userId:playerId}));
  const bot=new Bot(TEST_TOKEN);let sends=0;bot.api.config.use(async()=>{sends++;return {ok:true,result:true} as any});await dispatchOne(db,bot);expect(sends).toBe(0);expect(await db.notificationInbox.count({where:{key:row.key}})).toBe(1);
 });
 it('finds players by verified phone, username and IDs with scoped balance details',async()=>{
  await db.user.update({where:{id:playerId},data:{telegramUsername:'people_fixture'}});
  for(const q of ['@people_fixture',playerId,'910000001','+99900910000001']){
   const result=await okay(await get(`users?q=${encodeURIComponent(q)}`,roles.SUPPORT.cookie));expect(result.items.some((p:any)=>p.id===playerId)).toBe(true);
  }
  const detail=await okay(await get(`users/${playerId}`,roles.SUPPORT.cookie));expect(detail).toMatchObject({telegramUsername:'people_fixture',phone:'+99900910000001',bidCount:1,winCount:1});expect(detail.available).toBeDefined();expect(detail.held).toBeDefined();expect(JSON.stringify(detail)).not.toMatch(/phoneCipher|phoneHash|sourceUpdateId|password|accounts|session/);
  expect((await get(`users/${playerId}`,roles.CATALOG_MANAGER.cookie)).status).toBe(403);expect((await get(`users/${ownerId}`,roles.SUPPORT.cookie)).status).toBe(404);
 });
 it('retires support reads and writes while retaining historical records',async()=>{
  const route=await import('../src/app/api/support/route');
  const c=await db.supportCase.create({data:{userId:playerId,subject:'Historical reply fixture',message:'Please help with my request.',resolution:'Historical response',status:'RESOLVED'}});
  expect((await get('support',roles.SUPPORT.cookie)).status).toBe(404);
  for(const action of ['support','supportWithdraw'])expect((await cmd(action,{key:randomUUID(),id:c.id,status:'OPEN',reason:'Retired command test',expectedUpdatedAt:c.updatedAt.toISOString()},roles.SUPPORT.cookie)).status).toBe(422);
  expect(await db.supportCase.findUniqueOrThrow({where:{id:c.id}})).toEqual(c);
  expect((await route.GET(req('support',undefined,player))).status).toBe(410);
  expect(await (await route.POST(req('support',{},player2))).json()).toMatchObject({supportUrl:'https://t.me/lowwinsupport'});
 });
 it('completes internal delivery without customer alerts or changes to settlement proof',async()=>{
  const before=JSON.stringify(await db.auctionSettlement.findUnique({where:{auctionId:winner.id}}),(_,v)=>typeof v==='bigint'?v.toString():v),outbox=await db.outbox.count(),inbox=await db.notificationInbox.count(),row=await db.fulfillmentCase.findUniqueOrThrow({where:{auctionId:winner.id}});
  const input={key:randomUUID(),auctionId:winner.id,version:row.version,reason:'Winner called and item delivered'};
  expect((await cmd('deliveryDone',input,roles.SUPPORT.cookie)).status).toBe(403);expect((await cmd('deliveryDone',{...input,version:0},roles.FULFILLMENT.cookie)).status).toBe(409);
  const receipt=await okay(await cmd('deliveryDone',input,roles.FULFILLMENT.cookie));expect(receipt.state).toBe('DELIVERED');expect(await okay(await cmd('deliveryDone',input,roles.FULFILLMENT.cookie))).toEqual(receipt);
  expect(await db.outbox.count()).toBe(outbox);expect(await db.notificationInbox.count()).toBe(inbox);expect(JSON.stringify(await db.auctionSettlement.findUnique({where:{auctionId:winner.id}}),(_,v)=>typeof v==='bigint'?v.toString():v)).toBe(before);
  const queue=await okay(await get('fulfillment?status=DELIVERED',roles.FULFILLMENT.cookie));expect(queue.items.find((r:any)=>r.auctionId===winner.id)).toMatchObject({state:'DELIVERED',winner:{phone:'+99900910000001'}});
  const a=await bidAuction(db,{endDelayMs:2000}),u=await bidUser(db),v=await bidUser(db);await submitBid(db,{userId:u,auctionSlug:a.slug!,amount:'1',key:randomUUID()});await submitBid(db,{userId:v,auctionSlug:a.slug!,amount:'2',key:randomUUID()});await new Promise(resolve=>setTimeout(resolve,2100));await closeAuction(db,a.id);
  expect((await cmd('deliveryDone',{key:randomUUID(),auctionId:a.id,version:0,reason:'Unassigned attempt'},roles.FULFILLMENT.cookie)).status).toBe(403);
  expect((await okay(await cmd('deliveryDone',{key:randomUUID(),auctionId:a.id,version:0,reason:'Owner confirmed direct delivery'}))).state).toBe('DELIVERED');
 });
 it('stops broadcasts before expansion with fresh Owner MFA and immutable history',async()=>{
  const receipt=await okay(await cmd('broadcast',{key:randomUUID(),text:'Stop before sending fixture',reason:'Local stopped campaign test',confirmation:'SEND'})),input={key:randomUUID(),id:receipt.id,reason:'Stop local fixture broadcast'};
  expect((await cmd('broadcastStop',input,roles.SUPPORT.cookie)).status).toBe(403);
  const grant=await db.staffSession.findFirstOrThrow({where:{session:{userId:ownerId}}});await db.staffSession.update({where:{sessionId:grant.sessionId},data:{credentialAt:new Date(Date.now()-32*60000),mfaAt:new Date(Date.now()-31*60000)}});
  try{expect((await cmd('broadcastStop',input)).status).toBe(403)}finally{await db.staffSession.update({where:{sessionId:grant.sessionId},data:{credentialAt:grant.credentialAt,mfaAt:grant.mfaAt}})}
  expect((await okay(await cmd('broadcastStop',input))).stopped).toBe(true);expect((await okay(await cmd('broadcastStop',input))).stopped).toBe(true);
  const root=await db.outbox.findUniqueOrThrow({where:{id:receipt.id}});expect(await db.$transaction(tx=>expandCampaign(tx,root))).toBe(0);expect(await db.outbox.count({where:{key:{startsWith:root.key+':'}}})).toBe(0);
  const history=await okay(await get('notifications?q=Stop%20before'));expect(history.items[0]).toMatchObject({text:'Stop before sending fixture',state:'STOPPED',canStop:false,sent:0});
 });
 it('stops remaining batches and retries after an in-flight broadcast send finishes',async()=>{
  await db.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED'}});
  const receipt=await okay(await cmd('broadcast',{key:randomUUID(),text:'Concurrent stop fixture',reason:'Local concurrency fixture',confirmation:'SEND'})),root=await db.outbox.findUniqueOrThrow({where:{id:receipt.id}});await db.$transaction(tx=>expandCampaign(tx,root));for(;;){const next=await db.outbox.findFirst({where:{kind:'GLOBAL_CAMPAIGN',state:'PENDING',key:{startsWith:root.key+':'}}});if(!next)break;await db.$transaction(tx=>expandCampaign(tx,next))}
  const first=await db.outbox.findUniqueOrThrow({where:{key:`${root.key}:user:${playerId}`}});await db.outbox.updateMany({where:{state:'PENDING',id:{not:first.id}},data:{nextAttemptAt:new Date(Date.now()+60000)}});
  const bot=new Bot(TEST_TOKEN);let release!:()=>void,started!:()=>void;const begun=new Promise<void>(resolve=>started=resolve),finish=new Promise<void>(resolve=>release=resolve);let calls=0;bot.api.config.use(async()=>{calls++;started();await finish;return {ok:true,result:{message_id:9876}} as any});
  const dispatch=dispatchOne(db,bot);await begun;const stop=cmd('broadcastStop',{key:randomUUID(),id:root.id,reason:'Stop concurrent fixture broadcast'});release();await dispatch;await okay(await stop);
  expect(calls).toBe(1);expect((await db.outbox.findUniqueOrThrow({where:{id:first.id}})).state).toBe('SENT');expect(await db.outbox.count({where:{key:{startsWith:root.key+':'},state:'PENDING'}})).toBe(0);
  const skipped=await db.outbox.findFirstOrThrow({where:{kind:'BROADCAST',key:{startsWith:root.key+':'},state:'SKIPPED'}});await db.outbox.update({where:{id:skipped.id},data:{state:'PENDING',nextAttemptAt:new Date()}});await dispatchOne(db,bot);expect(calls).toBe(1);expect((await db.outbox.findUniqueOrThrow({where:{id:skipped.id}})).lastError).toBe('CAMPAIGN_STOPPED');
  const history=await okay(await get('notifications?q=Concurrent%20stop'));expect(history.items[0]).toMatchObject({state:'STOPPED',sent:1,canStop:false});
 });
 it('keeps audit and outbox content immutable',async()=>{const a=await db.adminAudit.findFirstOrThrow(),o=await db.outbox.findFirstOrThrow();await expect(db.adminAudit.delete({where:{id:a.id}})).rejects.toThrow();await expect(db.outbox.update({where:{id:o.id},data:{payload:{spoofed:true}}})).rejects.toThrow()});
 it('shows deposit player identity and searches by verified phone without exposing protected evidence',async()=>{
  const {paymentAdminRead}=await import('../src/modules/payments/admin');
  const t=await db.topUpIntent.create({data:{userId:playerId,key:randomUUID(),provider:'VERIFY_ET',channel:'telebirr',status:'NEEDS_REVIEW',reasonCode:'INCOMPLETE_EVIDENCE',policyVersion:'money-fixture',expectedCents:1000n,points:10,reference:'PRIVATEDEPOSIT123',receivingAccount:'0911111111',expiresAt:new Date(Date.now()+1800000)}});
  const headers=(c=owner)=>req('admin/payments',undefined,c).headers;
  for(const q of [playerId,'+99900910000001','@people_fixture']){
   const result:any=await paymentAdminRead(db,headers(),[],new URLSearchParams({q,view:'attention'}));
   expect(result.items.find((p:any)=>p.id===t.id)).toMatchObject({player:{name:(await db.user.findUniqueOrThrow({where:{id:playerId}})).name,phone:'+99900910000001',telegramUsername:'people_fixture'},reference:'••••T123'});
  }
  const detail:any=await paymentAdminRead(db,headers(roles.SUPPORT.cookie),[t.id],new URLSearchParams());expect(detail.player.phone).toBe('+99900910000001');expect(detail.expectedCents).toBeUndefined();expect(detail.attempts).toBeUndefined();
  expect(JSON.stringify(detail)).not.toMatch(/phoneCipher|phoneHash|sourceUpdateId|password/);
  await expect(paymentAdminRead(db,headers(roles.CATALOG_MANAGER.cookie),[t.id],new URLSearchParams())).rejects.toMatchObject({status:403});
  await db.topUpIntent.update({where:{id:t.id},data:{status:'REJECTED',reasonCode:'NOT_FOUND',caseState:'RESOLVED'}});
  const filtered:any=await paymentAdminRead(db,headers(),[],new URLSearchParams({q:playerId,view:'attention'}));expect(filtered.items.some((p:any)=>p.id===t.id)).toBe(false);
 });
 it('credits reviewed M-Pesa receipts once under concurrent approvals and blocks reused IDs and late webhooks',async()=>{
  const {paymentAdminCommand}=await import('../src/modules/payments/admin'),{completeVerifyWebhook,reconcilePayments}=await import('../src/modules/payments/service');
  const names=['VERIFY_ET_API_KEY','VERIFY_ET_TEST_ENDPOINT','PAYMENTS_TEST_ENABLED'] as const,previous=names.map(name=>process.env[name]);
  Object.assign(process.env,{VERIFY_ET_API_KEY:'fixture-only',VERIFY_ET_TEST_ENDPOINT:'http://127.0.0.1:9/api/verify',PAYMENTS_TEST_ENABLED:'true'});
  try{
   const userId=await bidUser(db,'0'),otherUser=await bidUser(db,'0'),reference=`MP${randomUUID().replaceAll('-','').slice(0,20).toUpperCase()}`,now=new Date(),date=new Date(now.getTime()-1000);
   const deposit=(userId:string)=>db.topUpIntent.create({data:{userId,key:randomUUID(),provider:'VERIFY_ET',channel:'mpesa',status:'NEEDS_REVIEW',reasonCode:'INCOMPLETE_EVIDENCE',policyVersion:'money-fixture',amountFromReceipt:true,expectedCents:null,points:0,reference,receivingAccount:'0711111111',accountName:'Fixture receiver',quoteSnapshot:{minCents:'100',maxCents:'100000',earliestTransferAt:new Date(now.getTime()-86400000).toISOString()},expiresAt:new Date(now.getTime()+1800000)}});
   const t=await deposit(userId),requestId=randomUUID();await db.verifyRequest.create({data:{intentId:t.id,key:randomUUID(),reference,requestId,state:'DONE',code:'INCOMPLETE_EVIDENCE'}});
   const input={key:randomUUID(),id:t.id,amountCents:'3027',reference,transferredAt:date.toISOString(),reason:'Checked the fixture receipt against the receiver statement.',confirmed:true},headers=req('admin/payments').headers;
   const results=await Promise.all([paymentAdminCommand(db,headers,'approve',input),paymentAdminCommand(db,headers,'approve',input)]);expect(results).toEqual([{recorded:true,status:'CREDITED',amountCents:'3027'},{recorded:true,status:'CREDITED',amountCents:'3027'}]);
   const claim=await db.paymentClaim.findUniqueOrThrow({where:{intentId:t.id}});expect(claim.amountCents).toBe(3027n);expect(claim.points.toString()).toBe('30.27');expect(await db.journal.count({where:{reference:`topup:${t.id}`}})).toBe(1);
   expect(await completeVerifyWebhook(db,requestId,{processingStatus:'completed',bank:'mpesa',status:'success',verified:true,amount:'30.27',transactionNumber:reference,receiverAccount:'251711111111',timestamp:date.toISOString()})).toBe(true);
   await expect(paymentAdminCommand(db,headers,'approve',{...input,key:randomUUID()})).rejects.toMatchObject({status:409});
   const other=await deposit(otherUser);await expect(paymentAdminCommand(db,headers,'approve',{...input,key:randomUUID(),id:other.id})).rejects.toMatchObject({status:409});
   expect(await db.outbox.count({where:{key:`deposit:${t.id}:credited`}})).toBe(1);expect(await db.paymentClaim.count({where:{channel:'mpesa',reference}})).toBe(1);expect(await reconcile(db)).toEqual([]);expect(await reconcilePayments(db)).toEqual([]);
  }finally{names.forEach((name,index)=>{if(previous[index]===undefined)delete process.env[name];else process.env[name]=previous[index]})}
 });
 it('records deposit actions with optional reasons, private audit and idempotency',async()=>{
  const {paymentAdminCommand}=await import('../src/modules/payments/admin'),headers=req('admin/payments').headers;
  const t=await db.topUpIntent.create({data:{userId:playerId,key:randomUUID(),provider:'VERIFY_ET',channel:'telebirr',status:'NEEDS_REVIEW',reasonCode:'INCOMPLETE_EVIDENCE',policyVersion:'money-fixture',expectedCents:1000n,points:10,expiresAt:new Date(Date.now()+1800000)}}),input={key:randomUUID(),id:t.id};
  await expect(paymentAdminCommand(db,req('admin/payments',undefined,roles.SUPPORT.cookie).headers,'reject',input)).rejects.toMatchObject({status:403});
  const running=await db.verifyRequest.create({data:{intentId:t.id,key:randomUUID(),reference:'DEMOSECURE123',state:'SUBMITTING'}});
  await expect(paymentAdminCommand(db,headers,'reject',input)).rejects.toThrow('Verification is running');
  expect((await db.topUpIntent.findUniqueOrThrow({where:{id:t.id}})).status).toBe('NEEDS_REVIEW');
  await db.verifyRequest.update({where:{id:running.id},data:{state:'DONE'}});
  expect(await paymentAdminCommand(db,headers,'reject',input)).toEqual({recorded:true});expect(await paymentAdminCommand(db,headers,'reject',input)).toEqual({recorded:true});
  expect(await db.topUpIntent.findUniqueOrThrow({where:{id:t.id}})).toMatchObject({status:'REJECTED',caseState:'RESOLVED'});
  expect((await db.adminAudit.findUniqueOrThrow({where:{operationKey:input.key}})).details).toMatchObject({reason:'Deposit reject recorded by staff'});
  await expect(paymentAdminCommand(db,headers,'note',{key:randomUUID(),id:t.id})).rejects.toThrow('Write a note');
  expect(await paymentAdminCommand(db,headers,'archive',{key:randomUUID(),id:t.id})).toEqual({recorded:true});
 });
 it('saves a compact receiving account only after exact review and fresh Owner authentication',async()=>{
  const {paymentAdminCommand}=await import('../src/modules/payments/admin'),headers=req('admin/payments').headers;
  const input={key:randomUUID(),channel:'telebirr',version:0,enabled:false,account:'0911111111',accountName:'Local fixture receiver',pointsNumerator:'1',centsDenominator:'100',minCents:'1000',maxCents:'1000000',accountConfirmed:true};
  await expect(paymentAdminCommand(db,headers,'preview-policy',{...input,accountConfirmed:false})).rejects.toThrow('Confirm that');
  await expect(paymentAdminCommand(db,req('admin/payments',undefined,roles.SUPPORT.cookie).headers,'preview-policy',input)).rejects.toMatchObject({status:403});
  const grant=await db.staffSession.findFirstOrThrow({where:{session:{userId:ownerId}}});await db.staffSession.update({where:{sessionId:grant.sessionId},data:{credentialAt:new Date(Date.now()-32*60000),mfaAt:new Date(Date.now()-31*60000)}});
  try{await expect(paymentAdminCommand(db,headers,'preview-policy',input)).rejects.toMatchObject({status:403})}finally{await db.staffSession.update({where:{sessionId:grant.sessionId},data:{credentialAt:grant.credentialAt,mfaAt:grant.mfaAt}})}
  const preview=await paymentAdminCommand(db,headers,'preview-policy',input) as any;
  await expect(paymentAdminCommand(db,headers,'publish-policy',{...input,account:'0922222222',confirmation:preview.confirmation})).rejects.toThrow('exact configuration');
  expect(await paymentAdminCommand(db,headers,'publish-policy',{...input,confirmation:preview.confirmation})).toMatchObject({saved:true,version:1});
  const row=await db.paymentPolicy.findFirstOrThrow({where:{channel:'telebirr'}});expect(row.terms).toContain('credited once');expect(row.reviewReference).toBe('Owner confirmed receiving account details');
  const changed={...input,key:randomUUID(),version:1,accountName:'Updated fixture receiver'},next=await paymentAdminCommand(db,headers,'preview-policy',changed) as any;
  expect(await paymentAdminCommand(db,headers,'publish-policy',{...changed,confirmation:next.confirmation})).toMatchObject({version:2});
  await expect(paymentAdminCommand(db,headers,'publish-policy',{...changed,key:randomUUID(),confirmation:next.confirmation})).rejects.toThrow('Configuration changed');
 });

 it('removes a receiving account without changing frozen deposits and permits adding it again',async()=>{
  const {paymentAdminCommand,paymentAdminRead}=await import('../src/modules/payments/admin');
  const headers=req('admin/payments').headers,original=await db.paymentPolicy.findFirstOrThrow({where:{channel:'telebirr'},orderBy:{version:'desc'}});
  const t=await db.topUpIntent.create({data:{userId:player2Id,key:randomUUID(),provider:'VERIFY_ET',channel:'telebirr',status:'NEEDS_REVIEW',policyVersion:original.id,expectedCents:1000n,points:10,receivingAccount:original.account,accountName:original.accountName,expiresAt:new Date(Date.now()+1800000)}});
  const input={key:randomUUID(),id:original.id,channel:'telebirr',version:original.version};
  expect(await paymentAdminCommand(db,headers,'remove-policy',input)).toMatchObject({removed:true,version:original.version+1});
  expect(await paymentAdminCommand(db,headers,'remove-policy',input)).toMatchObject({removed:true,version:original.version+1});
  expect(await db.paymentPolicy.findUniqueOrThrow({where:{id:original.id}})).toEqual(original);
  expect(await db.topUpIntent.findUniqueOrThrow({where:{id:t.id}})).toEqual(t);
  const settings=await paymentAdminRead(db,headers,['settings'],new URLSearchParams()) as any,removed=settings.policies.find((p:any)=>p?.channel==='telebirr');expect(removed).toMatchObject({enabled:false,removed:true,version:original.version+1});
  const replacement={key:randomUUID(),channel:'telebirr',version:removed.version,enabled:false,account:original.account,accountName:original.accountName,pointsNumerator:'1',centsDenominator:'100',minCents:original.minCents.toString(),maxCents:original.maxCents.toString(),accountConfirmed:true};
  const preview=await paymentAdminCommand(db,headers,'preview-policy',replacement) as any;await paymentAdminCommand(db,headers,'publish-policy',{...replacement,confirmation:preview.confirmation});
  const restored=await paymentAdminRead(db,headers,['settings'],new URLSearchParams()) as any;expect(restored.policies.find((p:any)=>p?.channel==='telebirr')).toMatchObject({removed:false,version:original.version+2});
 });
 it('accepts simple photo uploads but keeps byte validation and unpublished media authorization',async()=>{
  const png=await sharp({create:{width:48,height:32,channels:4,background:'#0bda51'}}).png().toBuffer();
  const image=await okay(await cmd('media',{key:randomUUID(),mime:'image/png',data:png.toString('base64')}));
  expect(image.sourceCredit).toBe('');expect(image.path).toBe(`/api/media/${image.id}`);
  const route=await import('../src/app/api/media/[id]/route');
  const load=(session:string)=>route.GET(req(`media/${image.id}`,undefined,session),{params:Promise.resolve({id:image.id})});
  const response=await load(owner);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
  const metadata=await sharp(Buffer.from(await response.arrayBuffer())).metadata();expect(metadata).toMatchObject({format:'png',width:48,height:32});
  expect((await load('')).status).toBe(404);expect((await load(roles.SUPPORT.cookie)).status).toBe(404);expect((await load(roles.CATALOG_MANAGER.cookie)).status).toBe(200);
  expect((await cmd('media',{key:randomUUID(),mime:'image/png',data:Buffer.from('<svg onload="bad()"/>').toString('base64')})).status).toBe(422);
 });
 it('combines auction category and text filters and returns named post-close results without changing settlement',async()=>{
  const {adminRead}=await import('../src/modules/admin/operations');const headers=new Headers({cookie:owner});
  const a=await db.auction.findUniqueOrThrow({where:{id:winner.id}}),before=JSON.stringify(await db.auctionSettlement.findUnique({where:{auctionId:winner.id}}),(_,v)=>typeof v==='bigint'?v.toString():v);
  const list=await adminRead(db,headers,['auctions'],new URLSearchParams({category:a.categoryId!,q:a.code})) as any;
  expect(list.items.map((r:any)=>r.id)).toEqual([winner.id]);expect(list.categories.some((r:any)=>r.id===a.categoryId)).toBe(true);
  const other=await db.category.findFirstOrThrow({where:{id:{not:a.categoryId!}}});
  expect((await adminRead(db,headers,['auctions'],new URLSearchParams({category:other.id,q:a.code})) as any).items).toEqual([]);
  const proof=await okay(await get(`auctions/${winner.id}/proof`,roles.AUDITOR.cookie));expect(proof.settlement.winner.name).toBeTruthy();expect(proof.participants.every((p:any)=>typeof p.name==='string')).toBe(true);expect(proof.settlement.auction.product.title).toBeTruthy();expect(proof.settlement.movements.length).toBe(1);
  expect((await get(`auctions/${winner.id}/proof`,roles.CATALOG_MANAGER.cookie)).status).toBe(403);
  expect(JSON.stringify(await db.auctionSettlement.findUnique({where:{auctionId:winner.id}}),(_,v)=>typeof v==='bigint'?v.toString():v)).toBe(before);
 });

});
