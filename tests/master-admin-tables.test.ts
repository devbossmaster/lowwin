import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma,type PrismaClient} from '@prisma/client';
const state=vi.hoisted(()=>({role:'OWNER',decrypt:vi.fn(()=>'+251911000001')}));
vi.mock('../src/modules/admin/boundary',()=>({requireAdmin:vi.fn(async()=>({id:'admin',role:state.role,now:new Date('2026-10-28T10:00:00Z')}))}));
vi.mock('../src/modules/auth/own-contact',()=>({contactBotId:()=> 'fixture-bot',decryptPhone:state.decrypt,normalizePhone:(value:string)=>{if(!/^\+251\d{9}$/.test(value))throw Error('not phone');return value},phoneHash:(value:string)=>'private-hash:'+value}));
import {readChapaTable,readPlayerTable,readWinnerTable} from '../src/modules/admin/master-table-read';
import {workspaceRead} from '../src/modules/admin/workspace';
import {readOverview} from '../src/modules/admin/workspace-read';
const now=new Date('2026-10-28T10:00:00Z'),actor={id:'admin',role:'OWNER' as const,now};
const f={page:2,q:'',status:'',sort:'newest' as const};
const identity=(patch={})=>({id:'player',name:'Player',telegramId:'123456',telegramUsername:'player',createdAt:now,ownContact:{telegramId:'123456',botId:'fixture-bot',phoneCipher:'private-cipher',revokedAt:null},...patch});
function paymentDb(rows:unknown[]=[],walletRows:unknown[]=[],pageRows?:{id:string;source:'chapa'|'wallet'}[]){
 const ids=pageRows??[...rows.map(row=>({id:(row as {id:string}).id,source:'chapa' as const})),...walletRows.map(row=>({id:(row as {id:string}).id,source:'wallet' as const}))];
 return {$queryRaw:vi.fn(async(query:Prisma.Sql)=>query.text.includes('COUNT(*)::int AS count FROM payments')?[{count:ids.length}]:ids),chapaCheckout:{findMany:vi.fn(async(_query:Prisma.ChapaCheckoutFindManyArgs)=>rows),count:vi.fn()},bid:{findMany:vi.fn(async(_query:Prisma.BidFindManyArgs)=>walletRows)},adminAudit:{create:vi.fn()}};
}
beforeEach(()=>{state.role='OWNER';state.decrypt.mockClear();vi.stubEnv('CHAPA_SCHEMA_READY','true');vi.stubEnv('REFERRAL_REWARDS_SCHEMA_READY','false')});
afterEach(()=>vi.unstubAllEnvs());

describe('Master Guide Admin bounded tables',()=>{
 it('loads landing counts without ledger reconciliation, schema probes, category lists or winner pages',async()=>{
  const queries:Prisma.Sql[]=[];
  const db={$queryRaw:vi.fn(async(query:Prisma.Sql)=>{queries.push(query);return query.text.includes('AS live')?[{live:0,upcoming:0,drafts:0,completed:0,failed:0,pending:0}]:query.text.includes('AS total')?[{total:8,today:1,biddersToday:2}]:[{count:0}]}),auction:{findMany:vi.fn(async()=>[]),count:vi.fn(async()=>0)},chapaCheckout:{count:vi.fn(async()=>0)},category:{findMany:vi.fn()}};
  const result=await readOverview(db as unknown as PrismaClient,actor);
  expect(result).toMatchObject({auctions:{state:'ready'},closing:{state:'ready'},payments:{state:'ready',count:0},deliveries:{state:'ready',count:0},players:{state:'ready',total:8}});expect(result.fees).toBeUndefined();
  expect(db.category.findMany).not.toHaveBeenCalled();expect(queries).toHaveLength(3);
  expect(queries.map(query=>query.text).join('\n')).not.toMatch(/to_regclass|LedgerAccount|Posting|PaymentClaim|LIMIT 25/);
 });
 it('merges current player activity and exact balances without loading journals or optional referral tables',async()=>{
  const mock={$queryRaw:vi.fn(async(query:Prisma.Sql)=>query.text.includes('COUNT(*)')?[{count:26}]:[{id:'player',suspended:false}]),user:{findMany:vi.fn(async()=>[{...identity(),wallet:{accounts:[{kind:'AVAILABLE',balance:new Prisma.Decimal('9007199254740993.97')},{kind:'HELD',balance:new Prisma.Decimal('1.23')}]},_count:{bids:4,wonSettlements:1}}]),count:vi.fn(async()=>26)},adminAudit:{create:vi.fn()},referralSignup:{groupBy:vi.fn()},referralCoupon:{groupBy:vi.fn()}};
  const result=await readPlayerTable(mock as unknown as PrismaClient,actor,f);
  expect(result).toMatchObject({total:26,page:2,totalPages:2,referralsReady:false,items:[{available:'9007199254740993.97',held:'1.23',phone:'+251911000001',bidCount:4,winCount:1,referralCount:null,couponCount:null}]});
  expect(mock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:{in:['player']}}}));
  const sql=mock.$queryRaw.mock.calls[0][0];expect(sql.text).toContain('LIMIT 25 OFFSET');expect(sql.values).toContain(25);expect(sql.text).toContain('"StaffMember"');expect(sql.text).toContain('"TestRunActor"');
  expect(mock.referralSignup.groupBy).not.toHaveBeenCalled();expect(mock.referralCoupon.groupBy).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/private-cipher|phoneCipher|phoneHash|ownContact/);
  expect(mock.adminAudit.create).toHaveBeenCalledWith({data:expect.objectContaining({action:'MASTER_PLAYER_TABLE_READ',details:{count:1}})});
 });
 it('never reveals a revoked or mismatched Telegram contact',async()=>{
  const rows=[identity({ownContact:{telegramId:'123456',botId:'fixture-bot',phoneCipher:'private-cipher',revokedAt:now}}),identity({id:'other',ownContact:{telegramId:'123456',botId:'other-bot',phoneCipher:'private-cipher',revokedAt:null}})].map(user=>({...user,wallet:null,_count:{bids:0,wonSettlements:0}}));
  const db={$queryRaw:vi.fn(async(query:Prisma.Sql)=>query.text.includes('COUNT(*)')?[{count:2}]:rows.map(row=>({id:row.id,suspended:false}))),user:{findMany:vi.fn(async()=>rows)},adminAudit:{create:vi.fn()}};
  const result=await readPlayerTable(db as unknown as PrismaClient,actor,f);
  expect(result.items.map(row=>row.phone)).toEqual([null,null]);expect(state.decrypt).not.toHaveBeenCalled();
 });
 it('keeps wallet storage available without querying absent Chapa tables',async()=>{
  vi.stubEnv('CHAPA_SCHEMA_READY','false');const db=paymentDb();
  expect(await readChapaTable(db as unknown as PrismaClient,actor,f)).toMatchObject({configured:true,chapaConfigured:false,items:[],summary:[]});
  expect(db.$queryRaw.mock.calls.map(([query])=>query.text).join('\n')).toContain('BID_FEE');
  expect(db.$queryRaw.mock.calls.map(([query])=>query.text).join('\n')).not.toContain('ChapaCheckout');
  expect(db.chapaCheckout.findMany).not.toHaveBeenCalled();expect(db.chapaCheckout.count).not.toHaveBeenCalled();
 });
 it('keeps Chapa exact cents while resolving only the globally paginated IDs without provider credentials',async()=>{
  const db=paymentDb([{id:'payment',userId:'player',purpose:'TOP_UP',mode:'test',amountCents:900719925474099397n,currency:'ETB',status:'CREDITED',reason:null,creditJournalId:'journal',bidId:null,auctionId:null,paymentMethod:'telebirr',createdAt:now,user:identity()}]);
  const result=await readChapaTable(db as unknown as PrismaClient,actor,f);
  expect(result.items[0]).toMatchObject({provider:'Chapa',source:'chapa',amount:'9007199254740993.97',mode:'test',purpose:'TOP_UP',user:{name:'Player',telegramUsername:'player',phone:'+251911000001'}});
  const page=db.$queryRaw.mock.calls[0][0];expect(page.text).toContain('ORDER BY "createdAt" DESC,id ASC,source ASC LIMIT 25 OFFSET');expect(page.values).toContain(25);
  const query=db.chapaCheckout.findMany.mock.calls[0][0];expect(query).toMatchObject({take:25,where:{id:{in:['payment']}}});expect(JSON.stringify(query)).not.toMatch(/checkoutUrl|credentialFingerprint|initialization|merchantReference|processorReference|receipt/);
  expect(JSON.stringify(result)).not.toMatch(/private-cipher|phoneCipher|credentialFingerprint|checkoutUrl/);
 });
 it('defaults to committed completion and applies independent type/status filters before page and count queries',async()=>{
  const db=paymentDb();
  await readChapaTable(db as unknown as PrismaClient,actor,f);
  expect(db.$queryRaw.mock.calls[0][0].text).toContain("c.status IN ('CREDITED','BID_ACCEPTED') AND c.\"creditJournalId\" IS NOT NULL");
  for(const [view,condition] of [['unfinished',"c.status IN ('SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED')"],['review',"c.status='NEEDS_REVIEW'"],['failed',"c.status IN ('FAILED','CANCELLED','EXPIRED','INCOMPLETE','BLOCKED')"],['all','WHERE true']] as const){
   await readChapaTable(db as unknown as PrismaClient,actor,{...f,view,purpose:'BID',q:'Player'});
   const page=db.$queryRaw.mock.calls.at(-2)![0],count=db.$queryRaw.mock.calls.at(-1)![0];
   expect(page.text).toContain(condition);expect(count.text).toContain(condition);expect(page.values).toContain('BID');expect(page.values).toContain('%Player%');expect(page.values).toContain(25);
   expect(page.text.includes("'wallet'::text")).toBe(view==='all');
   expect(count.values).toEqual(page.values.slice(0,-1));
  }
 });
 it('keeps aged unconfirmed attempts pending without inventing expired sessions or changing committed review funds',async()=>{
  const row={id:'payment',userId:'player',purpose:'TOP_UP',mode:'live',amountCents:1000n,currency:'ETB',status:'PENDING',providerStatus:'PENDING',reason:null,creditJournalId:null,bidId:null,auctionId:null,paymentMethod:'telebirr',createdAt:new Date(now.getTime()-300000),expiresAt:new Date(now.getTime()+3600000),user:identity()};
  const rows=[row,{...row,id:'newer',createdAt:new Date(now.getTime()-299999)},{...row,id:'applying',providerStatus:'SUCCESS'},{...row,id:'review',purpose:'BID',status:'NEEDS_REVIEW',providerStatus:'SUCCESS',creditJournalId:'preserved-journal'},{...row,id:'paid',status:'CREDITED',creditJournalId:'journal'},{...row,id:'failed',purpose:'BID',status:'FAILED'}];
  const db=paymentDb(rows);
  const result=await readChapaTable(db as unknown as PrismaClient,{...actor,role:'SUPPORT'},{...f,view:'all'});
  expect(result.items[0]).toMatchObject({typeLabel:'Deposit attempt',status:'PENDING',providerStatus:'PENDING',creditApplied:false});
  for(const item of result.items)expect(item).not.toHaveProperty('sessionEnded');
  expect(result.items[1].status).toBe('PENDING');expect(result.items[2].providerStatus).toBe('SUCCESS');
  expect(result.items[3]).toMatchObject({typeLabel:'Bid payment',status:'NEEDS_REVIEW',review:'OPEN',creditApplied:true,journalId:null});
  expect(result.items[4]).toMatchObject({typeLabel:'Wallet deposit',creditApplied:true});
  expect(result.items[5]).toMatchObject({typeLabel:'Bid payment attempt',status:'FAILED'});
  expect(JSON.stringify(result)).not.toMatch(/preserved-journal|private-cipher|phoneCipher|initialization|checkoutUrl/);
  expect(db.chapaCheckout).not.toHaveProperty('update');
 });
 it('merges wallet fees into the same ordered page, shows net coupon fees and redacts Support journals',async()=>{
  const chapa={id:'payment',userId:'player',purpose:'BID',mode:'live',amountCents:5000n,currency:'ETB',status:'BID_ACCEPTED',providerStatus:'SUCCESS',reason:null,creditJournalId:'private-chapa-journal',bidId:'chapa-bid',auctionId:'auction',paymentMethod:'telebirr',createdAt:now,user:identity()};
  const wallet={id:'wallet-bid',userId:'player',auctionId:'auction',feePoints:new Prisma.Decimal('50'),acceptedAt:now,operation:{result:{charge:{netFeePoints:'45',discountPoints:'5'}},journal:{id:'private-wallet-journal'}},user:identity()};
  const db=paymentDb([chapa],[wallet],[{id:'wallet-bid',source:'wallet'},{id:'payment',source:'chapa'}]);
  const result=await readChapaTable(db as unknown as PrismaClient,{...actor,role:'SUPPORT'},{...f,sort:'amount'});
  expect(result.items.map(row=>[row.id,row.source,row.amount])).toEqual([['wallet-bid','wallet','45'],['payment','chapa','50.00']]);
  expect(result.items[0]).toMatchObject({provider:'Wallet',channel:'Wallet',status:'BID_ACCEPTED',creditApplied:true,typeLabel:'Bid payment',purpose:'BID',journalId:null});
  expect(db.bid.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:{in:['wallet-bid']}},take:25}));
  const sql=db.$queryRaw.mock.calls[0][0].text;
  expect(sql).toContain('UNION ALL');expect(sql).toContain('ORDER BY amount DESC,"createdAt" DESC,id ASC,source ASC');
  expect(sql).toContain('NOT EXISTS(SELECT 1 FROM "ChapaCheckout" c WHERE c."bidId"=b.id)');
  expect(sql).toContain("o.scope='BID'");expect(sql).toContain("j.kind='BID_FEE'");expect(sql).toContain('NOT a."isDemo" AND a."testRunId" IS NULL');
  expect(JSON.stringify(result)).not.toMatch(/private-.*journal|private-cipher|netFeePoints|phoneCipher/);
 });
 it('omits wallet bids from deposits, unfinished, review and failed views and parameterizes player searches',async()=>{
  const db=paymentDb();
  for(const filters of [{purpose:'TOP_UP' as const},{view:'unfinished' as const},{view:'review' as const},{view:'failed' as const},{status:'CREDITED'}]){
   await readChapaTable(db as unknown as PrismaClient,actor,{...f,...filters,q:"x' OR 1=1 --"});
   const query=db.$queryRaw.mock.calls.at(-2)![0];
   expect(query.text).not.toContain("'wallet'::text");expect(query.text).not.toContain("x' OR 1=1 --");expect(query.values).toContain("%x' OR 1=1 --%");
  }
 });
 it('reads wallet-only payments when Chapa storage is unavailable without parsing SQL naming its table',async()=>{
  vi.stubEnv('CHAPA_SCHEMA_READY','false');
  const wallet={id:'wallet-bid',userId:'player',auctionId:'auction',feePoints:new Prisma.Decimal('50'),acceptedAt:now,operation:{result:{},journal:{id:'journal'}},user:identity()};
  const db=paymentDb([],[wallet]);
  const result=await readChapaTable(db as unknown as PrismaClient,actor,{...f,page:1});
  expect(result).toMatchObject({configured:true,chapaConfigured:false,total:1,items:[{source:'wallet',amount:'50'}]});
  for(const [query] of db.$queryRaw.mock.calls)expect(query.text).not.toContain('ChapaCheckout');
  expect(db.chapaCheckout.findMany).not.toHaveBeenCalled();
 });
 it('rejects invalid payment view/type/status filters without touching payment storage',async()=>{
  const db={chapaCheckout:{findMany:vi.fn(),count:vi.fn()}};
  for(const [key,value] of [['view','other'],['purpose','OTHER'],['status','OTHER']])await expect(workspaceRead(db as unknown as PrismaClient,new Headers(),'transactions',new URLSearchParams([[key,value]]))).rejects.toThrow();
  expect(db.chapaCheckout.findMany).not.toHaveBeenCalled();expect(db.chapaCheckout.count).not.toHaveBeenCalled();
 });
 it('queries only one winner page and keeps missing delivery records as pending',async()=>{
  const queries:Prisma.Sql[]=[];
  const db={$queryRaw:vi.fn(async(query:Prisma.Sql)=>{queries.push(query);return query.text.includes('COUNT(*)')?[{count:1}]:[{auctionId:'auction',publicCode:1001,code:'LW-1',title:'Current product',presentation:{title:'Won product'},completedAt:now,winnerUserId:'player',winningAmount:null,ruleVersion:'lowest-unique-v4',state:'PENDING',version:0,tracking:'',note:'',assignedTo:null,deliveredAt:null}]}),user:{findMany:vi.fn(async()=>[identity()])},winnerPresentation:{findMany:vi.fn(async()=>[])},adminAudit:{create:vi.fn()}};
  const result=await readWinnerTable(db as unknown as PrismaClient,actor,{...f,status:'INCOMPLETE',q:"x' OR 1=1 --"});
  expect(result.items[0]).toMatchObject({title:'Won product',state:'PENDING',version:0,winner:{name:'Player'}});
  expect(queries).toHaveLength(2);expect(queries[0].text).toContain('LIMIT 25 OFFSET');expect(queries[0].values).toContain(25);expect(queries[0].text).toContain('NOT a."isDemo"');
  expect(queries[0].text).not.toContain("x' OR 1=1 --");expect(queries[0].values).toContain("%x' OR 1=1 --%");
  expect(JSON.stringify(result)).not.toMatch(/private-cipher|phoneCipher|contactCipher/);
 });
 it.each(['system','financials','refunds','referrals'])('removes %s from ordinary workspace reads without touching financial records',async section=>{
  await expect(workspaceRead({} as PrismaClient,new Headers(),section,new URLSearchParams())).rejects.toMatchObject({status:404});
 });
 it('rejects an unauthorized table role before reading player information',async()=>{
  state.role='CATALOG_MANAGER';const db={user:{findMany:vi.fn()}};
  await expect(workspaceRead(db as unknown as PrismaClient,new Headers(),'players',new URLSearchParams())).rejects.toMatchObject({status:403});expect(db.user.findMany).not.toHaveBeenCalled();
 });
});
