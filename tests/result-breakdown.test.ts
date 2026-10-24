import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {richFinalResult} from './result-fixtures';
import {bidAuction} from './bid-fixtures';
import {breakdownQuery,getResultBreakdown,maskResultPhone} from '../src/modules/auctions/result-breakdown';
import {listCompletedWinners} from '../src/modules/auctions/results';
import {reconcile} from '../src/modules/wallet/ledger';
import {resolveLearnMoreMedia} from '../src/lib/learn-more-media';
const auth=vi.hoisted(()=>vi.fn());
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:auth}));
import {GET} from '../src/app/api/results/[auctionCode]/breakdown/route';

describe('result privacy and media validation',()=>{
 it('masks exactly three middle national digits and rejects non-phone values',()=>{expect(maskResultPhone('+251911652904')).toBe('+251911***904');expect(maskResultPhone('0911652904')).toBeNull();expect(maskResultPhone('unsafe')).toBeNull()});
 it('bounds pages and accepts only supported sorts and exact amounts',()=>{for(const input of [{page:0},{page:10001},{pageSize:1000},{sort:'random'},{amount:'1e3'},{amount:'1.234'}])expect(breakdownQuery.safeParse(input).success).toBe(false)});
 it('allows only configured YouTube or local video sources',()=>{
  expect(resolveLearnMoreMedia({})).toBeNull();expect(resolveLearnMoreMedia({youtube:'https://youtu.be/abcdefghijk'})).toMatchObject({kind:'youtube',id:'abcdefghijk'});
  expect(resolveLearnMoreMedia({local:'/videos/how-lowwin-works.mp4'})).toMatchObject({kind:'local',src:'/videos/how-lowwin-works.mp4'});
  for(const local of ['https://other.test/video.mp4','/videos/../private.mp4','javascript:alert(1)'])expect(resolveLearnMoreMedia({local})).toBeNull();
  expect(resolveLearnMoreMedia({youtube:'https://youtube.com.evil.test/watch?v=abcdefghijk'})).toBeNull();
 });
});
describe.skipIf(!process.env.TEST_DATABASE_URL)('final result API on disposable PostgreSQL',()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});let fixture:Awaited<ReturnType<typeof richFinalResult>>;
 beforeAll(async()=>{fixture=await richFinalResult(db);auth.mockResolvedValue({user:{id:fixture.users[0]}})},60000);
 afterAll(async()=>{await db.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect()});
 const read=(input:Record<string,unknown>={})=>getResultBreakdown(db,fixture.code,breakdownQuery.parse(input));
 it('paginates 20 distinct numeric amounts with global counts and no duplicates',async()=>{
  const first=await read(),second=await read({page:2});expect(first?.kind).toBe('amounts');expect(second?.kind).toBe('amounts');if(first?.kind!=='amounts'||second?.kind!=='amounts')throw Error('No final result');
  expect(first.amounts).toHaveLength(20);expect(second.amounts).toHaveLength(3);expect(first.amounts.slice(0,5).map(row=>row.amount)).toEqual(['2','4','6','8','10']);
  for(const page of [first,second])expect(page).toMatchObject({totalBids:64,totalPlayers:21,totalAmounts:23,pageSize:20,totalPages:2,entryFee:'1'});
  expect(new Set([...first.amounts,...second.amounts].map(row=>row.amount)).size).toBe(23);expect(second.amounts.at(-1)).toMatchObject({amount:'100',winner:true,unique:true,bidCount:1});
 });
 it('sorts by count with stable numeric ties and jumps to the winning page',async()=>{
  const picked=await read({sort:'picked'}),winner=await read({sort:'picked',jump:'winner'});
  if(picked?.kind!=='amounts'||winner?.kind!=='amounts')throw Error('No final result');
  expect(picked.amounts[0]).toMatchObject({amount:'50',bidCount:21,unique:false});expect(picked.amounts[1].amount).toBe('2');expect(winner.page).toBe(2);expect(winner.amounts.some(row=>row.winner&&row.amount==='100')).toBe(true);
 });
 it('paginates participants without returning phones, names, user IDs, ciphers or proofs',async()=>{
  const first=await read({amount:'50'}),second=await read({amount:'50',page:2});
  if(first?.kind!=='participants'||second?.kind!=='participants')throw Error('No participant page');
  expect(first).toMatchObject({bidCount:21,playerCount:21,unique:false,totalBids:64,totalPlayers:21});expect(first.participants).toHaveLength(20);expect(second.participants).toHaveLength(1);
  expect(await read({amount:'2'})).toMatchObject({bidCount:2,playerCount:2,totalBids:64,totalPlayers:21});
  const serialized=JSON.stringify([first,second]);for(const phone of fixture.phones)expect(serialized).not.toContain(phone);expect(serialized).not.toMatch(/phoneCipher|phoneHash|telegramId|userId|winnerUserId|proof|requestHash/);expect(serialized).toContain(maskResultPhone(fixture.phone)!);
  const result=await read();expect(result?.auction.result?.winnerPhoneMasked).toBe(maskResultPhone(fixture.phone));
 });
 it('never reveals live, upcoming, uncommitted or illustrative results',async()=>{
  const live=await bidAuction(db,{ruleVersion:'lowest-unique-v4',isDemo:false}),upcoming=await bidAuction(db,{ruleVersion:'lowest-unique-v4',isDemo:false,startOffsetMs:60000});
  for(const auction of [live,upcoming])for(const input of [{},{amount:'2'},{jump:'winner'}])expect(await getResultBreakdown(db,String(auction.publicCode),breakdownQuery.parse(input))).toBeNull();
  expect((await listCompletedWinners(db,1,96)).items.some(row=>row.code===fixture.code)).toBe(true);
  expect((await listCompletedWinners(db,1,96)).items.every(row=>row.status==='closed'&&!row.isDemo&&row.result?.source==='SETTLED'&&row.result.outcome==='WINNER')).toBe(true);
 });
 it('requires authenticated access, validates paging, and sends private no-store headers',async()=>{
  const request=(suffix='')=>new Request(`http://localhost/api/results/${fixture.code}/breakdown${suffix}`),params={params:Promise.resolve({auctionCode:fixture.code})};
  auth.mockResolvedValueOnce(null);expect((await GET(request(),params)).status).toBe(401);
  expect((await GET(request('?pageSize=200'),params)).status).toBe(422);
  const response=await GET(request(),params);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');
 });
 it('preserves submission-fee-only settlement and ledger reconciliation',async()=>{
  const wallet=await db.wallet.findUniqueOrThrow({where:{userId:fixture.users[0]},include:{accounts:true}});
  expect(wallet.accounts.find(row=>row.kind==='AVAILABLE')?.balance.toString()).toBe('977');expect(wallet.accounts.find(row=>row.kind==='HELD')?.balance.toString()).toBe('0');expect(await reconcile(db)).toEqual([]);
 });
 it('uses anonymous display values immediately after contact revocation',async()=>{
  await db.telegramOwnContact.update({where:{userId:fixture.users[0]},data:{revokedAt:new Date()}});
  expect((await read())?.auction.result?.winnerPhoneMasked).toBeNull();
  const page=await read({amount:'100'});if(page?.kind!=='participants')throw Error('No participant page');expect(page.participants[0].phoneMasked).toBeNull();
 });
});
