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
 it('shows an explicit unavailable storage state without querying absent Chapa tables',async()=>{
  vi.stubEnv('CHAPA_SCHEMA_READY','false');const db={chapaCheckout:{findMany:vi.fn(),count:vi.fn()}};
  expect(await readChapaTable(db as unknown as PrismaClient,actor,f)).toMatchObject({configured:false,items:[],summary:[]});
  expect(db.chapaCheckout.findMany).not.toHaveBeenCalled();expect(db.chapaCheckout.count).not.toHaveBeenCalled();
 });
 it('lists only Chapa with exact cents, bounded pagination and no checkout/provider credentials',async()=>{
  const db={chapaCheckout:{findMany:vi.fn(async(_query:Prisma.ChapaCheckoutFindManyArgs)=>[{id:'payment',userId:'player',purpose:'TOP_UP',mode:'test',amountCents:900719925474099397n,currency:'ETB',status:'CREDITED',reason:null,creditJournalId:'journal',bidId:null,auctionId:null,paymentMethod:'telebirr',createdAt:now,user:identity()}]),count:vi.fn(async()=>1)},adminAudit:{create:vi.fn()}};
  const result=await readChapaTable(db as unknown as PrismaClient,actor,f);
  expect(result.items[0]).toMatchObject({provider:'Chapa',amount:'9007199254740993.97',mode:'test',purpose:'TOP_UP',user:{name:'Player',telegramUsername:'player',phone:'+251911000001'}});
  const query=db.chapaCheckout.findMany.mock.calls[0][0];expect(query).toMatchObject({take:25,skip:25});expect(JSON.stringify(query)).not.toMatch(/checkoutUrl|credentialFingerprint|initialization|merchantReference|processorReference|receipt/);
  expect(JSON.stringify(result)).not.toMatch(/private-cipher|phoneCipher|credentialFingerprint|checkoutUrl/);
 });
 it('defaults to committed completion and applies independent type/status filters before page and count queries',async()=>{
  const db={chapaCheckout:{findMany:vi.fn(async(_query:Prisma.ChapaCheckoutFindManyArgs)=>[]),count:vi.fn(async()=>0)},adminAudit:{create:vi.fn()}};
  await readChapaTable(db as unknown as PrismaClient,actor,f);
  expect(db.chapaCheckout.findMany).toHaveBeenLastCalledWith(expect.objectContaining({where:{AND:[{status:{in:['CREDITED','BID_ACCEPTED']},creditJournalId:{not:null}}]},skip:25,take:25}));
  for(const [view,condition] of [['unfinished',{status:{in:['SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED']}}],['review',{status:'NEEDS_REVIEW'}],['failed',{status:{in:['FAILED','CANCELLED','EXPIRED','INCOMPLETE','BLOCKED']}}],['all',{}]] as const){
   await readChapaTable(db as unknown as PrismaClient,actor,{...f,view,purpose:'BID',q:'Player'});
   const query=db.chapaCheckout.findMany.mock.lastCall?.[0];
   expect(query).toMatchObject({where:{AND:[condition,{purpose:'BID'},expect.anything()]},skip:25,take:25});
   expect(db.chapaCheckout.count).toHaveBeenLastCalledWith({where:query?.where});
  }
 });
 it('labels unconfirmed records as attempts and derives ended sessions without altering provider status or committed review funds',async()=>{
  const row={id:'payment',userId:'player',purpose:'TOP_UP',mode:'live',amountCents:1000n,currency:'ETB',status:'PENDING',providerStatus:'PENDING',reason:null,creditJournalId:null,bidId:null,auctionId:null,paymentMethod:'telebirr',createdAt:new Date(now.getTime()-300000),expiresAt:new Date(now.getTime()+3600000),user:identity()};
  const rows=[row,{...row,id:'newer',createdAt:new Date(now.getTime()-299999)},{...row,id:'applying',providerStatus:'SUCCESS'},{...row,id:'review',purpose:'BID',status:'NEEDS_REVIEW',providerStatus:'SUCCESS',creditJournalId:'preserved-journal'},{...row,id:'paid',status:'CREDITED',creditJournalId:'journal'},{...row,id:'failed',purpose:'BID',status:'FAILED'}];
  const db={chapaCheckout:{findMany:vi.fn(async()=>rows),count:vi.fn(async()=>rows.length)},adminAudit:{create:vi.fn()}};
  const result=await readChapaTable(db as unknown as PrismaClient,{...actor,role:'SUPPORT'},{...f,view:'all'});
  expect(result.items[0]).toMatchObject({typeLabel:'Deposit attempt',status:'PENDING',providerStatus:'PENDING',sessionEnded:true,creditApplied:false});
  expect(result.items[1].sessionEnded).toBe(false);expect(result.items[2].sessionEnded).toBe(false);
  expect(result.items[3]).toMatchObject({typeLabel:'Bid payment',status:'NEEDS_REVIEW',review:'OPEN',creditApplied:true,sessionEnded:false,journalId:null});
  expect(result.items[4]).toMatchObject({typeLabel:'Wallet deposit',creditApplied:true,sessionEnded:false});
  expect(result.items[5]).toMatchObject({typeLabel:'Bid payment attempt',status:'FAILED',sessionEnded:false});
  expect(JSON.stringify(result)).not.toMatch(/preserved-journal|private-cipher|phoneCipher|initialization|checkoutUrl/);
  expect(db.chapaCheckout).not.toHaveProperty('update');
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
