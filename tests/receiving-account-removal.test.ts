import {randomUUID} from 'node:crypto';
import {type PaymentPolicy,type PrismaClient} from '@prisma/client';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {AdminError} from '../src/modules/admin/errors';
const auth=vi.hoisted(()=>({role:'OWNER',fresh:true}));
vi.mock('@/modules/admin/boundary',()=>({requireAdmin:async(_tx:unknown,_headers:unknown,options:{fresh:boolean})=>{
 if(options.fresh&&!auth.fresh)throw new AdminError(403,'Fresh MFA is required.');
 return {id:'owner',sessionId:'fixture-session',role:auth.role};
}}));
vi.mock('@/modules/auctions/bids',()=>({demoBidAllowed:()=>false}));
import {receivingAccountStates,removeReceivingAccount} from '../src/modules/payments/account-removal';
function fixture(){
 const original:PaymentPolicy={id:randomUUID(),channel:'mpesa',version:1,enabled:true,account:'0711111111',accountName:'Fixture receiver',pointsNumerator:1n,centsDenominator:100n,minCents:100n,maxCents:100000n,terms:'Fixture deposit terms',reviewReference:'Fixture review',actorId:'owner',createdAt:new Date()};
 let policies=[original],audits:Record<string,any>[]=[],failAudit=false;
 const locks:string[]=[];
 const tx={
  $executeRaw:async(_query:unknown,...args:unknown[])=>{locks.push(String(args[0]));return 1},
  paymentPolicy:{findFirst:async()=>policies.at(-1),create:async({data}:{data:Omit<PaymentPolicy,'id'|'createdAt'>})=>{const p={id:randomUUID(),createdAt:new Date(),...data};policies.push(p);return p}},
  adminAudit:{findUnique:async({where}:any)=>audits.find(a=>a.operationKey===where.operationKey),findFirst:async({where}:any)=>audits.find(a=>a.action===where.action&&a.target===where.target),findMany:async({where}:any)=>audits.filter(a=>a.action===where.action&&where.target.in.includes(a.target)),create:async({data}:any)=>{if(failAudit)throw Error('Audit unavailable');audits.push(data);return data}},
 };
 const client={...tx,$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{const beforePolicies=[...policies],beforeAudits=[...audits];try{return await fn(tx)}catch(error){policies=beforePolicies;audits=beforeAudits;throw error}}} as unknown as PrismaClient;
 const input={key:randomUUID(),id:original.id,channel:'mpesa',version:1};
 return {client,input,original,locks,get policies(){return policies},get audits(){return audits},failAudit(){failAudit=true}};
}
beforeEach(()=>{auth.role='OWNER';auth.fresh=true});
describe('receiving account removal',()=>{
 it('creates a disabled successor and removal audit without modifying the historical account',async()=>{
  const f=fixture();expect(await removeReceivingAccount(f.client,new Headers(),f.input)).toEqual({removed:true,version:2});
  expect(f.policies).toHaveLength(2);expect(f.policies[0]).toEqual(f.original);expect(f.original.enabled).toBe(true);
  expect(f.policies[1]).toMatchObject({enabled:false,version:2,account:f.original.account,actorId:'owner'});
  expect(f.audits[0]).toMatchObject({actorId:'owner',action:'PAYMENT_POLICY_REMOVE',target:f.policies[1].id,details:{sessionId:'fixture-session',previousPolicyId:f.original.id}});
  expect(f.locks).toEqual(['payment-policy:mpesa']);
  expect(await receivingAccountStates(f.client,[null,f.policies[1]])).toEqual([null,{...f.policies[1],removed:true}]);
 });
 it('replays the same removal exactly once and rejects a changed command',async()=>{
  const f=fixture();await removeReceivingAccount(f.client,new Headers(),f.input);await removeReceivingAccount(f.client,new Headers(),f.input);
  await expect(removeReceivingAccount(f.client,new Headers(),{...f.input,version:2})).rejects.toMatchObject({status:409});expect(f.policies).toHaveLength(2);expect(f.audits).toHaveLength(1);
 });
 it.each(['PAYMENTS_OPERATOR','SUPPORT','AUDITOR','CATALOG_MANAGER'])('rejects %s account removal',async role=>{const f=fixture();auth.role=role;await expect(removeReceivingAccount(f.client,new Headers(),f.input)).rejects.toMatchObject({status:403});expect(f.policies).toHaveLength(1)});
 it('requires fresh MFA',async()=>{const f=fixture();auth.fresh=false;await expect(removeReceivingAccount(f.client,new Headers(),f.input)).rejects.toMatchObject({status:403});expect(f.audits).toHaveLength(0)});
 it.each([{id:randomUUID()},{version:2}])('rejects stale or mismatched account identity %j',async change=>{const f=fixture();await expect(removeReceivingAccount(f.client,new Headers(),{...f.input,...change})).rejects.toMatchObject({status:409});expect(f.policies).toHaveLength(1)});
 it('blocks removal of an already removed account using another key',async()=>{const f=fixture();await removeReceivingAccount(f.client,new Headers(),f.input);await expect(removeReceivingAccount(f.client,new Headers(),{...f.input,key:randomUUID(),id:f.policies[1].id,version:2})).rejects.toMatchObject({status:409});expect(f.policies).toHaveLength(2)});
 it('distinguishes paused accounts from removed accounts and permits adding a later version',async()=>{const f=fixture();f.original.enabled=false;expect(await receivingAccountStates(f.client,[f.original])).toEqual([{...f.original,removed:false}]);await removeReceivingAccount(f.client,new Headers(),f.input);const replacement={...f.original,id:randomUUID(),version:3,enabled:true};expect(await receivingAccountStates(f.client,[replacement])).toEqual([{...replacement,removed:false}])});
 it('rolls back the successor when audit recording fails',async()=>{const f=fixture();f.failAudit();await expect(removeReceivingAccount(f.client,new Headers(),f.input)).rejects.toThrow('Audit unavailable');expect(f.policies).toHaveLength(1);expect(f.audits).toHaveLength(0)});
});
