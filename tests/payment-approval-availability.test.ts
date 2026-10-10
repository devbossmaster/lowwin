import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma,type PrismaClient,type TopUpIntent} from '@prisma/client';

const access=vi.hoisted(()=>({role:'OWNER',enabled:true,now:new Date('2026-10-11T12:00:00Z')}));
vi.mock('@/modules/admin/boundary',()=>({requireAdmin:async()=>({id:'staff-fixture',role:access.role,now:access.now})}));
vi.mock('@/modules/admin/people',()=>({adminPlayerContacts:async()=>[],playerSearch:vi.fn()}));
vi.mock('@/modules/payments/service',()=>({paymentHealth:()=>({enabled:access.enabled}),assertDepositEligibility:vi.fn(),verifyIntent:vi.fn(),reconcilePayments:vi.fn()}));
import {paymentAdminRead} from '../src/modules/payments/admin';

function fixture(){
 const deposit={id:'deposit-fixture',userId:'player-fixture',status:'PROVIDER_OUTAGE',caseState:'OPEN',provider:'VERIFY_ET',channel:'telebirr',receivingAccount:'0911111111',journalId:null,leaseUntil:null,createdAt:access.now,expiresAt:new Date(access.now.getTime()+1800000),nextAttemptAt:access.now,points:new Prisma.Decimal(0),reference:null,attempts:0} as TopUpIntent;
 const state={active:false,claimed:false};
 const db={adminWalletCredit:{findFirst:async()=>null},topUpIntent:{findUnique:async()=>deposit},adminAudit:{create:vi.fn(),findMany:async()=>[]},paymentClaim:{findUnique:async()=>state.claimed?{amountCents:1000n,points:new Prisma.Decimal(10),transferredAt:access.now}:null},paymentAttempt:{findMany:async()=>[]},verifyRequest:{findFirst:async()=>state.active?{id:'active-fixture'}:null}} as unknown as PrismaClient;
 return {deposit,state,read:()=>paymentAdminRead(db,new Headers(),[deposit.id],new URLSearchParams())};
}
beforeEach(()=>{access.role='OWNER';access.enabled=true});
describe('manual approval availability in deposit details',()=>{
 it('explains paused funding instead of silently hiding an otherwise eligible approval',async()=>{
  access.enabled=false;
  expect(await fixture().read()).toMatchObject({canApprove:false,approvalBlockedReason:expect.stringContaining('crediting is paused')});
 });
 it.each(['OWNER','PAYMENTS_OPERATOR'])('allows %s to enter verified evidence for an uncredited provider outage with no submitted reference',async role=>{
  access.role=role;
  expect(await fixture().read()).toMatchObject({canApprove:true,approvalBlockedReason:null,referenceFull:null});
 });
 it('explains an active request or lease and permits approval only after both clear',async()=>{
  const f=fixture();f.state.active=true;
  expect(await f.read()).toMatchObject({canApprove:false,approvalBlockedReason:expect.stringContaining('verification is still in progress')});
  f.state.active=false;f.deposit.leaseUntil=new Date(access.now.getTime()+1000);
  expect(await f.read()).toMatchObject({canApprove:false,approvalBlockedReason:expect.stringContaining('verification is still in progress')});
  f.deposit.leaseUntil=access.now;
  expect(await f.read()).toMatchObject({canApprove:true,approvalBlockedReason:null});
 });
 it('keeps already claimed and rejected deposits blocked even when funding is enabled',async()=>{
  const f=fixture();f.state.claimed=true;
  expect(await f.read()).toMatchObject({canApprove:false,approvalBlockedReason:expect.stringContaining('already been credited')});
  f.state.claimed=false;f.deposit.status='REJECTED';
  expect(await f.read()).toMatchObject({canApprove:false,approvalBlockedReason:expect.stringContaining('rejected')});
 });
 it.each(['ARCHIVED','ESCALATED','REVERSAL_REVIEW'])('preserves the %s review restriction',async caseState=>{
  const f=fixture();f.deposit.caseState=caseState;
  expect(await f.read()).toMatchObject({canApprove:false,approvalBlockedReason:expect.stringContaining('protected or archived')});
 });
 it('explains missing receiving-account evidence',async()=>{
  const f=fixture();f.deposit.receivingAccount=null;
  expect(await f.read()).toMatchObject({canApprove:false,approvalBlockedReason:expect.stringContaining('no receiving account')});
 });
 it('keeps auditor access read-only and support evidence redacted',async()=>{
  access.role='AUDITOR';expect(await fixture().read()).toMatchObject({canApprove:false,approvalBlockedReason:expect.stringContaining('Only an Owner or Payments Operator')});
  access.role='SUPPORT';const result=await fixture().read();
  expect(result).not.toHaveProperty('canApprove');expect(result).not.toHaveProperty('approvalBlockedReason');expect(result).not.toHaveProperty('referenceFull');
 });
});
