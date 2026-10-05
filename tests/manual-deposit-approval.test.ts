import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient,type TopUpIntent} from '@prisma/client';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {AdminError} from '../src/modules/admin/errors';

const auth=vi.hoisted(()=>({role:'OWNER',fresh:true,enabled:true,eligible:true,now:new Date('2026-10-05T12:00:00Z')}));
vi.mock('@/modules/admin/boundary',()=>({requireAdmin:vi.fn(async(_tx,_headers,options)=>{
 if(options.fresh&&!auth.fresh)throw new AdminError(403,'Fresh MFA is required.');
 return {id:'owner',sessionId:'staff-session',role:auth.role,now:auth.now};
})}));
vi.mock('@/modules/payments/service',()=>({paymentHealth:()=>({enabled:auth.enabled}),assertDepositEligibility:async()=>{if(!auth.eligible)throw new AdminError(403,'Account unavailable')}}));
vi.mock('@/modules/wallet/ledger',()=>({ensureWallet:vi.fn(),seedPlatformAccounts:vi.fn()}));
vi.mock('@/modules/auctions/bids',()=>({demoBidAllowed:()=>false}));
vi.mock('@/modules/notifications/service',()=>({materializeAlert:vi.fn()}));
import {approveReviewedDeposit,canReviewDeposit} from '../src/modules/payments/manual-approval';
import {materializeAlert} from '../src/modules/notifications/service';

function fixture(){
 const initial:TopUpIntent={id:randomUUID(),userId:'player',key:randomUUID(),provider:'VERIFY_ET',providerIntentId:null,status:'NEEDS_REVIEW',points:new Prisma.Decimal(0),policyVersion:'policy',journalId:null,createdAt:new Date('2026-10-05T11:00:00Z'),channel:'mpesa',expectedCents:null,amountFromReceipt:true,receivingAccount:'0711111111',accountName:'Fixture receiver',quoteSnapshot:{minCents:'100',maxCents:'100000',earliestTransferAt:'2026-10-05T10:00:00Z'},requestHash:'fixture',expiresAt:new Date('2026-10-05T11:30:00Z'),reference:'MPESA123456',attempts:1,scanAttempts:0,nextAttemptAt:auth.now,leaseToken:null,leaseUntil:null,reasonCode:'INCOMPLETE_EVIDENCE',caseState:'OPEN',assignedTo:null};
 let state={t:initial,claims:[] as Record<string,any>[],aliases:[] as Record<string,any>[],operations:[] as Record<string,any>[],journals:[] as Record<string,any>[],audits:[] as Record<string,any>[],attempts:[] as Record<string,any>[],alerts:[] as Record<string,any>[],active:false,failAudit:false};
 const locks:string[]=[];
 const tx={
  $queryRaw:vi.fn(async()=>[]),$executeRaw:vi.fn(async(_query:unknown,...values:unknown[])=>{locks.push(String(values[0]));return 1}),
  topUpIntent:{findUnique:async()=>state.t,update:async({data}:any)=>{state.t={...state.t,...data};return state.t}},
  verifyRequest:{findFirst:async()=>state.active?{id:'running'}:null},
  paymentClaim:{findUnique:async()=>state.claims.find(c=>c.intentId===state.t.id)??null,findFirst:async({where}:any)=>state.claims.find(c=>c.channel===where.channel&&where.reference.in.includes(c.reference))??null,create:async({data}:any)=>{const c={id:randomUUID(),...data};state.claims.push(c);return c}},
  paymentTransferAlias:{findFirst:async({where}:any)=>state.aliases.find(a=>a.channel===where.channel&&where.alias.in.includes(a.alias))??null,createMany:async({data}:any)=>{state.aliases.push(...data);return {count:data.length}}},
  ledgerAccount:{findUniqueOrThrow:async({where}:any)=>({id:where.name})},
  operation:{create:async({data}:any)=>{const op={id:randomUUID(),...data};state.operations.push(op);return op}},
  journal:{create:async({data}:any)=>{const j={id:randomUUID(),...data};state.journals.push(j);return j}},
  adminAudit:{findUnique:async({where}:any)=>state.audits.find(a=>a.operationKey===where.operationKey)??null,create:async({data}:any)=>{if(state.failAudit)throw Error('Audit write failed');state.audits.push(data);return data}},
  paymentAttempt:{create:async({data}:any)=>{state.attempts.push(data);return data}},
  outbox:{create:async({data}:any)=>{const row={id:randomUUID(),...data};state.alerts.push(row);return row}},
 };
 const client={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{
  const snapshot={...state,t:{...state.t},claims:[...state.claims],aliases:[...state.aliases],operations:[...state.operations],journals:[...state.journals],audits:[...state.audits],attempts:[...state.attempts],alerts:[...state.alerts]};
  try{return await fn(tx)}catch(error){state=snapshot;throw error}
 }} as unknown as PrismaClient;
 const input={key:randomUUID(),id:initial.id,amountCents:'3027',reference:'mpesa123456',transferredAt:'2026-10-05T11:10:00Z',reason:'Checked the receiver account statement and receipt.',confirmed:true};
 return {client,input,get state(){return state},locks};
}
beforeEach(()=>{auth.role='OWNER';auth.fresh=true;auth.enabled=true;auth.eligible=true;vi.clearAllMocks()});

describe('manual deposit approval',()=>{
 it('credits the exact reviewed amount with a balanced journal, permanent claim, audit and alert',async()=>{
  const f=fixture();expect(await approveReviewedDeposit(f.client,new Headers(),f.input)).toEqual({recorded:true,status:'CREDITED',amountCents:'3027'});
  expect(f.state.t).toMatchObject({status:'CREDITED',reasonCode:'MANUALLY_APPROVED',expectedCents:3027n,reference:'MPESA123456',caseState:'RESOLVED',assignedTo:'owner'});
  expect(f.state.t.points.toString()).toBe('30.27');
  const postings=f.state.journals[0].postings.create;
  expect(postings.map((p:any)=>[p.accountId,p.delta.toString()])).toEqual([['platform:issuance','-30.27'],['user:player:available','30.27']]);
  expect(f.state.claims[0]).toMatchObject({reference:'MPESA123456',amountCents:3027n,journalId:f.state.t.journalId,intentId:f.input.id});
  expect(f.state.aliases).toEqual([{channel:'mpesa',alias:'MPESA123456',claimId:f.state.claims[0].id}]);
  expect(f.state.audits[0]).toMatchObject({actorId:'owner',action:'PAYMENT_APPROVE',operationKey:f.input.key,details:{source:'MANUAL_REVIEW',reason:f.input.reason,amountCents:'3027'}});
  expect(f.state.alerts).toHaveLength(1);expect(materializeAlert).toHaveBeenCalledOnce();
  expect(f.locks).toEqual(['transfer:mpesa:MPESA123456','wallet:player']);
 });
 it('replays an identical command and rejects changed amounts or another approval without a second credit',async()=>{
  const f=fixture();await approveReviewedDeposit(f.client,new Headers(),f.input);
  await approveReviewedDeposit(f.client,new Headers(),f.input);
  await expect(approveReviewedDeposit(f.client,new Headers(),{...f.input,amountCents:'5000'})).rejects.toMatchObject({status:409});
  await expect(approveReviewedDeposit(f.client,new Headers(),{...f.input,key:randomUUID()})).rejects.toMatchObject({status:409});
  expect(f.state.journals).toHaveLength(1);expect(f.state.claims).toHaveLength(1);expect(f.state.alerts).toHaveLength(1);
 });
 it.each(['SUPPORT','AUDITOR','CATALOG_MANAGER'])('rejects %s even with MFA',async role=>{const f=fixture();auth.role=role;await expect(approveReviewedDeposit(f.client,new Headers(),f.input)).rejects.toMatchObject({status:403});expect(f.state.journals).toHaveLength(0)});
 it('requires fresh MFA, enabled payments and an eligible player',async()=>{
  const f=fixture();auth.fresh=false;await expect(approveReviewedDeposit(f.client,new Headers(),f.input)).rejects.toMatchObject({status:403});
  auth.fresh=true;auth.enabled=false;await expect(approveReviewedDeposit(f.client,new Headers(),f.input)).rejects.toMatchObject({status:503});
  auth.enabled=true;auth.eligible=false;await expect(approveReviewedDeposit(f.client,new Headers(),f.input)).rejects.toMatchObject({status:403});expect(f.state.journals).toHaveLength(0);
 });
 it.each(['CREDITED','REJECTED','REVERSED','DUPLICATE_CONFLICT','FAILED','VERIFYING'])('blocks %s deposits',async status=>{const f=fixture();f.state.t.status=status;await expect(approveReviewedDeposit(f.client,new Headers(),f.input)).rejects.toMatchObject({status:409});expect(f.state.journals).toHaveLength(0)});
 it('blocks active verification, held leases and protected review states',async()=>{
  const f=fixture();f.state.active=true;await expect(approveReviewedDeposit(f.client,new Headers(),f.input)).rejects.toMatchObject({status:409});f.state.active=false;
  f.state.t.leaseUntil=new Date(auth.now.getTime()+1000);await expect(approveReviewedDeposit(f.client,new Headers(),f.input)).rejects.toMatchObject({status:409});f.state.t.leaseUntil=null;
  for(const caseState of ['ARCHIVED','ESCALATED','REVERSAL_REVIEW']){f.state.t.caseState=caseState;expect(canReviewDeposit(f.state.t,auth.now,false)).toBe(false)}
 });
 it.each([{amountCents:'99'},{amountCents:'100001'},{transferredAt:'2026-10-05T09:59:59Z'},{transferredAt:'2026-10-05T11:30:01Z'},{transferredAt:'2026-10-06T11:10:00Z'},{reference:'ANOTHER12345'}])('rejects invalid reviewed evidence %j',async change=>{const f=fixture();await expect(approveReviewedDeposit(f.client,new Headers(),{...f.input,...change})).rejects.toBeInstanceOf(Error);expect(f.state.journals).toHaveLength(0)});
 it.each([{confirmed:false},{reason:''},{amountCents:'30.27'},{amountCents:'0'},{amountCents:'-1'}])('rejects incomplete approval input %j',async change=>{const f=fixture();await expect(approveReviewedDeposit(f.client,new Headers(),{...f.input,...change})).rejects.toBeInstanceOf(Error);expect(f.state.journals).toHaveLength(0)});
 it('does not credit an already claimed transaction or alias',async()=>{
  for(const kind of ['claims','aliases'] as const){const f=fixture();f.state[kind].push(kind==='claims'?{channel:'mpesa',reference:'MPESA123456',intentId:'someone-else'}:{channel:'mpesa',alias:'MPESA123456',claimId:'someone-else'});await expect(approveReviewedDeposit(f.client,new Headers(),f.input)).rejects.toMatchObject({status:409});expect(f.state.journals).toHaveLength(0)}
 });
 it('records both CBE receipt and FT aliases to prevent either from being reused',async()=>{
  const f=fixture();f.state.t.channel='cbe';f.state.t.reference='AbCdReceipt12345';f.state.t.receivingAccount='1000303997441';
  await approveReviewedDeposit(f.client,new Headers(),{...f.input,reference:'AbCdReceipt12345',otherReference:'ft26example123'});
  expect(f.state.aliases.map(a=>a.alias)).toEqual(['AbCdReceipt12345','FT26EXAMPLE123']);
 });
 it('preserves the frozen amount of legacy deposits',async()=>{
  const f=fixture();f.state.t.amountFromReceipt=false;f.state.t.expectedCents=3000n;f.state.t.points=new Prisma.Decimal(30);
  await expect(approveReviewedDeposit(f.client,new Headers(),f.input)).rejects.toMatchObject({status:422});
  await approveReviewedDeposit(f.client,new Headers(),{...f.input,amountCents:'3000'});expect(f.state.t.points.toString()).toBe('30');
 });
 it('rolls back the journal, claim and receipt when the audit write fails',async()=>{
  const f=fixture();f.state.failAudit=true;await expect(approveReviewedDeposit(f.client,new Headers(),f.input)).rejects.toThrow('Audit write failed');
  expect(f.state.t.status).toBe('NEEDS_REVIEW');for(const key of ['claims','aliases','operations','journals','audits','attempts','alerts'] as const)expect(f.state[key]).toHaveLength(0);
 });
});
