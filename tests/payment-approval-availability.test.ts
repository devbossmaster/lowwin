import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma,type PrismaClient,type TopUpIntent} from '@prisma/client';

const access=vi.hoisted(()=>({role:'OWNER',enabled:true,now:new Date('2026-10-11T12:00:00Z')}));
vi.mock('@/modules/admin/boundary',()=>({requireAdmin:async()=>({id:'staff-fixture',role:access.role,now:access.now})}));
vi.mock('@/modules/admin/people',()=>({adminPlayerContacts:async()=>[],playerSearch:vi.fn()}));
vi.mock('@/modules/payments/service',()=>({paymentHealth:()=>({enabled:access.enabled}),assertDepositEligibility:vi.fn(),verifyIntent:vi.fn(),reconcilePayments:vi.fn()}));
import {paymentAdminCommand,paymentAdminRead} from '../src/modules/payments/admin';

function fixture(){
 const deposit={id:'deposit-fixture',userId:'player-fixture',status:'PROVIDER_OUTAGE',caseState:'OPEN',provider:'VERIFY_ET',channel:'telebirr',receivingAccount:'0911111111',journalId:null,leaseUntil:null,createdAt:access.now,expiresAt:new Date(access.now.getTime()+1800000),nextAttemptAt:access.now,points:new Prisma.Decimal(0),reference:null,attempts:0} as TopUpIntent;
 const state={active:false,claimed:false,outage:false};
 const db={adminWalletCredit:{findFirst:async()=>null},topUpIntent:{findUnique:async()=>deposit},adminAudit:{create:vi.fn(),findMany:async()=>[]},paymentClaim:{findUnique:async()=>state.claimed?{amountCents:1000n,points:new Prisma.Decimal(10),transferredAt:access.now}:null},paymentAttempt:{findMany:async()=>state.outage?[{code:'PROVIDER_OUTAGE',createdAt:access.now}]:[]},verifyRequest:{findFirst:async()=>state.active?{id:'active-fixture'}:null}} as unknown as PrismaClient;
 return {deposit,state,read:()=>paymentAdminRead(db,new Headers(),[deposit.id],new URLSearchParams()),command:(action:string)=>paymentAdminCommand(db,new Headers(),action,{})};
}
beforeEach(()=>{access.role='OWNER';access.enabled=true});
describe('retired manual crediting and verified recovery in deposit details',()=>{
 const retired={canApprove:false,canAddFunds:false,approvalBlockedReason:expect.stringContaining('Manual crediting is retired')};
 it.each([false,true])('keeps manual crediting retired with funding enabled=%s',async enabled=>{
  access.enabled=enabled;
  expect(await fixture().read()).toMatchObject(retired);
 });
 it.each(['OWNER','PAYMENTS_OPERATOR'])('does not allow %s to manually approve a provider outage',async role=>{
  access.role=role;
  const f=fixture();
  expect(await f.read()).toMatchObject({...retired,referenceFull:null,canRetry:false,canRecover:false});
  for(const action of ['approve','add-funds'])await expect(f.command(action)).rejects.toMatchObject({status:410});
 });
 it('blocks retries during active verification or a lease without ever enabling manual approval',async()=>{
  const f=fixture();f.deposit.reference='verified-provider-reference';f.state.outage=true;f.state.active=true;
  expect(await f.read()).toMatchObject({...retired,canRetry:false,canRecover:false});
  f.state.active=false;f.deposit.leaseUntil=new Date(access.now.getTime()+1000);
  expect(await f.read()).toMatchObject({...retired,canRetry:false});
  f.deposit.leaseUntil=access.now;
  expect(await f.read()).toMatchObject({...retired,canRetry:true,canRecover:true});
 });
 it('keeps already claimed and rejected deposits blocked even when funding is enabled',async()=>{
  const f=fixture();f.state.claimed=true;
  expect(await f.read()).toMatchObject(retired);
  f.state.claimed=false;f.deposit.status='REJECTED';
  expect(await f.read()).toMatchObject(retired);
 });
 it.each(['ARCHIVED','ESCALATED','REVERSAL_REVIEW'])('preserves the %s review restriction',async caseState=>{
  const f=fixture();f.deposit.caseState=caseState;f.deposit.reference='verified-provider-reference';f.state.outage=true;
  expect(await f.read()).toMatchObject({...retired,canRetry:false,canRecover:false});
 });
 it('does not offer manual crediting when receiving-account evidence is missing',async()=>{
  const f=fixture();f.deposit.receivingAccount=null;
  expect(await f.read()).toMatchObject(retired);
 });
 it('keeps auditor access read-only and support evidence redacted',async()=>{
  access.role='AUDITOR';const f=fixture();f.deposit.reference='sensitive-provider-reference';
  expect(await f.read()).toMatchObject(retired);expect(await f.read()).not.toHaveProperty('referenceFull');
  await expect(f.command('approve')).rejects.toMatchObject({status:403});
  access.role='SUPPORT';const result=await fixture().read();
  expect(result).not.toHaveProperty('canApprove');expect(result).not.toHaveProperty('approvalBlockedReason');expect(result).not.toHaveProperty('referenceFull');
 });
});
