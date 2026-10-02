import {verifyFixtureContact} from './contact-fixtures';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomInt,randomUUID } from 'node:crypto';
import { bidAuction } from './bid-fixtures';
import { signedLaunch,TEST_TOKEN } from './helpers';
import { seedCatalog } from '../scripts/seed-catalog';
import { submitBid } from '../src/modules/auctions/bids';
import { closeAuction,cancelAuction } from '../src/modules/auctions/settlement';
import { creditDevelopmentPoints,reconcile } from '../src/modules/wallet/ledger';
let listPublicResults:typeof import('../src/modules/auctions/results').listPublicResults, getPublicResult:typeof import('../src/modules/auctions/results').getPublicResult;
let getPersonalBids:typeof import('../src/modules/profile/personal').getPersonalBids, getPlayerProfile:typeof import('../src/modules/profile/personal').getPlayerProfile, getPersonalWins:typeof import('../src/modules/profile/personal').getPersonalWins;

const url=process.env.PERSONAL_TEST_DATABASE_URL;
describe.skipIf(!url)('Phase 4B public outcomes and private pages on PostgreSQL',()=>{
  let client:PrismaClient,first:{id:string;cookie:string;telegramId:number},second:typeof first;
  let winner:Awaited<ReturnType<typeof bidAuction>>,noWinner:typeof winner,cancelled:typeof winner,pending:typeof winner,live:typeof winner;
  let examples:string;
  const request=(path:string,cookie?:string,method='GET',body?:unknown,origin='http://localhost:3000')=>new Request(`http://localhost:3000${path}`,{method,headers:{...(cookie?{cookie}:{}),origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  async function signIn(telegramId=randomInt(4000000000,5000000000)) {
    await verifyFixtureContact(client,telegramId);
    const {handleAuth}=await import('../src/modules/auth/handler');
    const response=await handleAuth(request('/api/auth/telegram/miniapp/signin',undefined,'POST',{initData:signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Private secret name'})})}));
    expect(response.status).toBe(200);
    const user=await client.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});
    return {id:user.id,cookie:response.headers.get('set-cookie')!.split(';')[0],telegramId};
  }
  const bid=(userId:string,auction:typeof winner,amount:number)=>submitBid(client,{userId,auctionSlug:auction.slug!,amount:String(amount),key:randomUUID()});
  const publicCode=(auction:typeof winner)=>auction.publicCode.toString();
  beforeAll(async()=>{
    const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw new Error('Disposable loopback _test database required');
    Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two'});
    ({listPublicResults,getPublicResult}=await import('../src/modules/auctions/results'));({getPersonalBids,getPlayerProfile,getPersonalWins}=await import('../src/modules/profile/personal'));
    execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});client=new PrismaClient();await seedCatalog(client);
    examples=JSON.stringify(await client.publicAuctionResult.findMany({orderBy:{auctionId:'asc'}}),(_key,value)=>typeof value==='bigint'?value.toString():value);
    first=await signIn();second=await signIn();
    await client.user.update({where:{id:first.id},data:{name:'Elias Winner'}});
    await client.user.update({where:{id:second.id},data:{name:'Other bidder private'}});
    for(const user of [first,second])await creditDevelopmentPoints(client,user.id,'1000',randomUUID());
    winner=await bidAuction(client,{fee:2,endDelayMs:1800});noWinner=await bidAuction(client,{fee:3,endDelayMs:1800});cancelled=await bidAuction(client,{fee:4});pending=await bidAuction(client,{endDelayMs:-1000});live=await bidAuction(client,{fee:1});
    await bid(first.id,winner,2);await bid(first.id,winner,20);await bid(second.id,winner,10);
    await bid(first.id,noWinner,5);await bid(second.id,noWinner,5);
    await bid(first.id,cancelled,8);await bid(second.id,cancelled,8);await bid(first.id,live,30);
    await cancelAuction(client,{auctionId:cancelled.id,actor:{id:'fixture-owner',permission:'auction:cancel'},reason:'DEMO private page test',key:randomUUID()});
    const [{now}]=await client.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,noWinner.endsAt!.getTime()-now.getTime()+40)));
    await closeAuction(client,winner.id);await closeAuction(client,noWinner.id);
  },60000);
  afterAll(async()=>{await client?.$disconnect();const {db}=await import('../src/lib/db');await db.$disconnect()});
  it('projects settled, cancelled, no-winner and pending outcomes without guessing',async()=>{
    expect((await getPublicResult(client,publicCode(winner)))?.result).toMatchObject({outcome:'WINNER',winningPoints:'2',source:'SETTLED',winnerDisplay:'Elias Winner',winnerPhoneMasked:`********${String(first.telegramId).slice(-2)}`,demoLabel:'DEMO · settled test'});
    expect((await getPublicResult(client,noWinner.code))?.result).toMatchObject({outcome:'NO_WINNER',winningPoints:null});
    expect((await getPublicResult(client,cancelled.code))?.result).toMatchObject({outcome:'CANCELLED',winningPoints:null});
    expect(await getPublicResult(client,pending.code)).toMatchObject({status:'closing',result:null});
    expect(await getPublicResult(client,live.code)).toBeNull();
  });
  it('retains illustrative records unchanged and distinguishes both DEMO sources',async()=>{
    const row=await client.publicAuctionResult.findFirstOrThrow({include:{auction:{select:{code:true}}}});
    expect((await getPublicResult(client,row.auction.code))?.result).toMatchObject({source:'ILLUSTRATIVE',demoLabel:'DEMO example',winnerDisplay:null,winnerPhoneMasked:null});
    expect(JSON.stringify(await client.publicAuctionResult.findMany({orderBy:{auctionId:'asc'}}),(_key,value)=>typeof value==='bigint'?value.toString():value)).toBe(examples);
  });
  it('shows only the winner name and masked phone, without private proof or other bidders',async()=>{
    const route=await import('../src/app/api/results/[auctionCode]/route');
    const response=await route.GET(request(`/api/results/${publicCode(winner)}`),{params:Promise.resolve({auctionCode:publicCode(winner)})});
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');const body=await response.json();
    expect(Object.keys(body).sort()).toEqual(['slug','code','status','featured','isDemo','startsAt','endsAt','bidCount','viewCount','product','category','fulfillment','terms','result'].sort());
    expect(Object.keys(body.result).sort()).toEqual(['decision','outcome','winningPoints','explanation','isDemo','closedAt','source','demoLabel','winnerDisplay','winnerPhoneMasked','acceptedBidCount'].sort());
    const settlement=await client.auctionSettlement.findUniqueOrThrow({where:{auctionId:winner.id},include:{movements:true}});
    expect(settlement.proof).toHaveProperty('amountFrequencies');
    const serialized=JSON.stringify(body);
    expect(body.result.winnerDisplay).toBe('Elias Winner');
    expect(body.result.winnerPhoneMasked).toMatch(/^\*{8}\d{2}$/);
    for(const secret of ['Other bidder private',first.id,second.id,String(first.telegramId),'Private secret name',settlement.id,settlement.winningBidId!,...settlement.movements.map(m=>m.id)])expect(serialized).not.toContain(secret);
    expect(serialized).not.toMatch(/amountFrequencies|acceptedCount|winnerUserId|winningBidId|proof|transactionId|settlementId|telegramId|phoneCipher|lastFour|contact|operationId|journalId|movements/);
    const catalog=await import('../src/modules/auctions/catalog');
    expect(JSON.stringify(await catalog.getAuction(winner.slug!))).not.toMatch(/amountFrequencies|winnerUserId|winningBidId|proof|movements/);
  });
  it('hides revoked or malformed contact suffixes',async()=>{
    const before=await client.telegramOwnContact.findUniqueOrThrow({where:{userId:first.id}});
    try{
      await client.telegramOwnContact.update({where:{userId:first.id},data:{revokedAt:new Date()}});
      expect((await getPublicResult(client,publicCode(winner)))?.result).toMatchObject({winnerDisplay:'Elias Winner',winnerPhoneMasked:null});
      await expect(client.telegramOwnContact.update({where:{userId:first.id},data:{revokedAt:null,lastFour:'bad!'}})).rejects.toThrow('TelegramOwnContact_lastFour_check');
    }finally{
      await client.telegramOwnContact.update({where:{userId:first.id},data:{revokedAt:before.revokedAt,lastFour:before.lastFour}});
    }
  });
  it('records aggregate views without accepting or storing viewer identity',async()=>{
    const route=await import('../src/app/api/catalog/auctions/[slug]/view/route');
    const before=await client.auction.findUniqueOrThrow({where:{id:winner.id},select:{publicViewCount:true}});
    const response=await route.POST(request(`/api/catalog/auctions/${winner.slug}/view`,undefined,'POST',{viewer:'ignored'}),{params:Promise.resolve({slug:winner.slug!})});
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({views:(before.publicViewCount+1n).toString()});
    const after=await client.auction.findUniqueOrThrow({where:{id:winner.id},select:{publicViewCount:true}});
    expect(after.publicViewCount).toBe(before.publicViewCount+1n);
  });
  it('searches, filters and paginates outcomes deterministically',async()=>{
    for(let i=0;i<7;i++)await bidAuction(client,{endDelayMs:-1000});
    const firstPage=await listPublicResults(client,{q:'TEST-BID-',status:'pending'}),secondPage=await listPublicResults(client,{q:'TEST-BID-',status:'pending',page:2});
    expect(firstPage.total).toBe(8);expect(firstPage.items).toHaveLength(6);expect(secondPage.items).toHaveLength(2);expect(new Set([...firstPage.items,...secondPage.items].map(a=>a.code)).size).toBe(8);
    for(const [status,auction] of [['winner',winner],['no_winner',noWinner],['cancelled',cancelled]] as const)expect((await listPublicResults(client,{q:publicCode(auction),status})).items.map(a=>a.code)).toEqual([publicCode(auction)]);
    const route=await import('../src/app/api/results/route');expect((await route.GET(request('/api/results?page=-1'))).status).toBe(422);
      expect((await listPublicResults(client,{q:'nothing-matches'})).total).toBe(0);
      const filtered=await listPublicResults(client,{category:'accessories',sort:'title'});
      expect(filtered.items.length).toBeGreaterThan(0);expect(filtered.items.every(a=>a.category.slug==='accessories')).toBe(true);
      expect((await listPublicResults(client,{category:'animals'})).total).toBe(0);
      const oldest=await listPublicResults(client,{sort:'oldest'});expect(oldest.items.map(a=>a.endsAt)).toEqual(oldest.items.map(a=>a.endsAt).sort());
  });
  it('isolates two users own bid histories and exposes only their final outcomes',async()=>{
    const a=await getPersonalBids(client,first.id),b=await getPersonalBids(client,second.id);
    expect(a.total).toBe(5);expect(b.total).toBe(3);expect(a.counts).toEqual({live:1,history:4});
    expect(a.items.filter(row=>row.auction.code===publicCode(winner)).map(row=>[row.amount,row.outcome]).sort()).toEqual([['2','WON'],['20','LOST']]);
    expect(b.items.find(row=>row.auction.code===publicCode(winner))?.outcome).toBe('LOST');
    expect(a.items.find(row=>row.auction.code===publicCode(cancelled))).toMatchObject({feePoints:'4',feeRefunded:'4',outcome:'CANCELLED'});
    expect((await getPersonalBids(client,first.id,{view:'live'})).items.map(row=>row.amount)).toEqual(['30']);
    expect((await getPersonalBids(client,first.id,{view:'history'})).total).toBe(4);
    expect(JSON.stringify(a)).not.toContain(second.id);expect(a.items.every(row=>!b.items.some(other=>other.id===row.id))).toBe(true);
    const route=await import('../src/app/api/my-bids/route');
    const response=await route.GET(request('/api/my-bids?view=history',second.cookie));expect(response.headers.get('cache-control')).toContain('no-store');expect((await response.json()).items.map((row:{id:string})=>row.id).sort()).toEqual(b.items.map(row=>row.id).sort());
    expect((await route.GET(request(`/api/my-bids?userId=${first.id}`,second.cookie))).status).toBe(422);
  });
  it('returns real profile, wins and reconciled wallet counts with pending fulfillment',async()=>{
    expect(await getPlayerProfile(client,first.id)).toMatchObject({counts:{bids:5,liveBids:1,historyBids:4,wins:1,favorites:0},wallet:{available:'960',held:'30'}});
    const wins=await getPersonalWins(client,first.id);expect(wins.total).toBe(1);expect(wins.items[0]).toMatchObject({code:publicCode(winner),winningPoints:'2',fulfillment:'Pending',isDemo:true});expect((await getPersonalWins(client,second.id)).total).toBe(0);
    const winningBid=(await getPersonalBids(client,first.id)).items.find(item=>item.outcome==='WON')!;
    expect(wins.items[0]).toMatchObject({bidId:winningBid.id,views:winningBid.auction.views,titleAm:winningBid.auction.titleAm});
    const route=await import('../src/app/api/wallet/route');const response=await route.GET(request('/api/wallet',first.cookie)),wallet=await response.json();expect(wallet.wallet).toEqual({available:'960',held:'30'});expect(wallet.activity.find((row:{kind:string})=>row.kind==='AUCTION_FEE_REFUND')).toMatchObject({availableDelta:'4',heldDelta:'0'});
    expect(await reconcile(client)).toEqual([]);
  });
  it('requires sessions and no-store on every private API, including failures',async()=>{
    const routes=await Promise.all([import('../src/app/api/profile/route'),import('../src/app/api/profile/wins/route'),import('../src/app/api/favorites/route'),import('../src/app/api/my-bids/route'),import('../src/app/api/wallet/route')]);
    for(const route of routes){
      const response=await route.GET(request('/api/private'));expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toContain('no-store');
    }
    const favorite=await import('../src/app/api/favorites/[slug]/route');const context={params:Promise.resolve({slug:live.slug!})};
    expect((await favorite.GET(request(`/api/favorites/${live.slug}`),context)).status).toBe(401);
    expect((await favorite.PUT(request(`/api/favorites/${live.slug}`,undefined,'PUT',{saved:true}),context)).status).toBe(401);
    const profile=await import('../src/app/api/profile/route');expect((await profile.PATCH(request('/api/profile',undefined,'PATCH',{displayName:'Guest',bio:''}))).status).toBe(401);
  });
  it('persists idempotent favorites across signed sessions without cross-user access',async()=>{
    const route=await import('../src/app/api/favorites/[slug]/route'),list=await import('../src/app/api/favorites/route'),context={params:Promise.resolve({slug:live.slug!})};
    for(let i=0;i<2;i++)expect((await route.PUT(request(`/api/favorites/${live.slug}`,first.cookie,'PUT',{saved:true}),context)).status).toBe(200);
    expect(await client.auctionFavorite.count({where:{userId:first.id}})).toBe(1);
    const renewed=await signIn(first.telegramId);expect((await (await route.GET(request(`/api/favorites/${live.slug}`,renewed.cookie),context)).json()).saved).toBe(true);
    expect((await (await list.GET(request('/api/favorites',renewed.cookie))).json()).items[0].code).toBe(publicCode(live));
    expect((await (await list.GET(request('/api/favorites',second.cookie))).json()).total).toBe(0);
    await route.PUT(request(`/api/favorites/${live.slug}`,second.cookie,'PUT',{saved:false}),context);expect(await client.auctionFavorite.count({where:{userId:first.id}})).toBe(1);
    expect((await route.PUT(request(`/api/favorites/${live.slug}`,first.cookie,'PUT',{saved:true},'https://evil.invalid'),context)).status).toBe(403);
    await route.PUT(request(`/api/favorites/${live.slug}`,first.cookie,'PUT',{saved:false}),context);expect(await client.auctionFavorite.count({where:{userId:first.id}})).toBe(0);
  });
  it('edits only separate display fields and preserves verified identity and other profiles',async()=>{
    const route=await import('../src/app/api/profile/route');const identity=await client.user.findUniqueOrThrow({where:{id:first.id}}),secondBefore=await getPlayerProfile(client,second.id);
    const response=await route.PATCH(request('/api/profile',first.cookie,'PATCH',{displayName:'My display name',bio:'I like furniture.'}));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await client.user.findUniqueOrThrow({where:{id:first.id}})).toEqual(identity);
    expect(await getPlayerProfile(client,first.id)).toMatchObject({displayName:'My display name',bio:'I like furniture.'});expect((await getPlayerProfile(client,second.id)).displayName).toBe(secondBefore.displayName);
    for(const extra of [{telegramId:'1'},{email:'other@example.com'},{phone:'123'},{userId:second.id},{name:'Changed identity'},{accountId:'other'}])expect((await route.PATCH(request('/api/profile',first.cookie,'PATCH',{displayName:'Safe',bio:'',...extra}))).status).toBe(422);
    for(const displayName of ['', 'a'.repeat(61),'Hidden\u202ename','Line\nname'])expect((await route.PATCH(request('/api/profile',first.cookie,'PATCH',{displayName,bio:''}))).status).toBe(422);
    expect((await route.PATCH(request('/api/profile',first.cookie,'PATCH',{displayName:'Safe',bio:''},'https://evil.invalid'))).status).toBe(403);
    expect(JSON.stringify(await getPublicResult(client,winner.code))).not.toContain('My display name');
    expect(await reconcile(client)).toEqual([]);
  });
});
