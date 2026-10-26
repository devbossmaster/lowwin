import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
const f=vi.hoisted(()=>({role:'OWNER',authenticated:true,revoked:false,limited:false,read:vi.fn(),routeDb:{} as Record<string,unknown>}));
vi.mock('../src/lib/db',()=>({db:f.routeDb}));
vi.mock('../src/modules/referrals/service',()=>({getReferralPolicy:f.read}));
vi.mock('../src/lib/rate-limit',()=>({allowIdentityRequest:vi.fn(async()=>!f.limited)}));
vi.mock('../src/modules/admin/boundary',async original=>({...await original<typeof import('../src/modules/admin/boundary')>(),requireAdmin:vi.fn(async(_db,_headers,options:{lock?:boolean;permission?:import('../src/modules/admin/permissions').Permission}={})=>{
 const {AdminError}=await import('../src/modules/admin/errors');
 if(!f.authenticated)throw new AdminError(401,'Staff credentials required.');
 if(options.lock&&f.revoked)throw new AdminError(403,'Staff access was revoked.');

 if(options.permission){const {assertPermission}=await import('../src/modules/admin/permissions');assertPermission(f.role,options.permission)}
 return {id:'owner-fixture',role:f.role,now:new Date('2026-10-26T00:00:00Z')};
})}));
import {readReferralAdmin,saveReferralAdmin,referralPolicyInput} from '../src/modules/admin/referrals';
import {requireAdmin} from '../src/modules/admin/boundary';
import {GET,POST} from '../src/app/api/admin/referrals/route';
import {activeTask,allowedTasks} from '../src/modules/admin/navigation';

type Policy={id:string;enabled:boolean;discountPercent:number;expiryDays:number;version:number;updatedAt:Date;updatedBy:string|null};
const headers=new Headers(),now=new Date('2026-10-26T00:00:00Z');
const input=(patch:Record<string,unknown>={})=>({key:randomUUID(),version:1,discountPercent:10,expiryDays:30,enabled:false,reason:'Review referral reward policy',...patch});
function fixture(initial:Policy|null={id:'default',enabled:false,discountPercent:10,expiryDays:30,version:1,updatedAt:now,updatedBy:null}){
 let row=initial;const audits=new Map<string,unknown>();
 const mock={
  referralPolicy:{findUnique:vi.fn(async()=>row),create:vi.fn(async({data}:{data:Policy})=>{row=data;return row}),update:vi.fn(async({data}:{data:Omit<Policy,'id'|'version'>&{version:{increment:number}}})=>{row={...row!,...data,version:row!.version+data.version.increment};return row})},
  adminAudit:{findUnique:vi.fn(async({where}:{where:{operationKey:string}})=>audits.get(where.operationKey)??null),create:vi.fn(async({data}:{data:{operationKey:string}})=>{audits.set(data.operationKey,data);return data})},
  $executeRaw:vi.fn(async()=>0),$transaction:vi.fn(),
 };
 mock.$transaction.mockImplementation(async callback=>callback(mock));return {mock,db:mock as unknown as PrismaClient,audits,current:()=>row};
}
beforeEach(()=>{
 vi.clearAllMocks();Object.assign(f,{role:'OWNER',authenticated:true,revoked:false,limited:false});
 vi.stubEnv('REFERRAL_REWARDS_SCHEMA_READY','true');vi.stubEnv('BETTER_AUTH_URL','https://lowwin.example');
 f.read.mockResolvedValue({configured:false,enabled:false,discountPercent:10,expiryDays:30,version:0,updatedAt:null});
});

describe('referral reward administration boundary',()=>{
 it('exposes the task only to settings-authorized staff and matches its own route',()=>{
  expect(allowedTasks('OWNER').some(task=>task.href==='/admin/settings/referrals')).toBe(true);
  for(const role of ['CATALOG_MANAGER','SUPPORT','FULFILLMENT','PAYMENTS_OPERATOR','AUDITOR'] as const)expect(allowedTasks(role).some(task=>task.href==='/admin/settings/referrals')).toBe(false);
  expect(activeTask('/admin/settings/referrals')).toMatchObject({label:'Referral policy',area:'Reports and Settings'});
 });
 it('requires a staff session and settings permission before reading policy',async()=>{
  const {db}=fixture();f.authenticated=false;await expect(readReferralAdmin(db,headers)).rejects.toMatchObject({status:401});expect(f.read).not.toHaveBeenCalled();
  f.authenticated=true;f.role='AUDITOR';await expect(readReferralAdmin(db,headers)).rejects.toMatchObject({status:403});expect(f.read).not.toHaveBeenCalled();
 });
 it('returns an explicit unconfigured schema and draft policy without writing it',async()=>{
  const {db,mock}=fixture();vi.stubEnv('REFERRAL_REWARDS_SCHEMA_READY','false');expect(await readReferralAdmin(db,headers)).toMatchObject({schemaReady:false,policy:{configured:false,enabled:false,discountPercent:10,expiryDays:30,version:0}});expect(mock.referralPolicy.create).not.toHaveBeenCalled();
  await expect(saveReferralAdmin(db,headers,input())).rejects.toMatchObject({status:503});expect(mock.$transaction).not.toHaveBeenCalled();
 });
 it.each(['CATALOG_MANAGER','SUPPORT','FULFILLMENT','PAYMENTS_OPERATOR','AUDITOR'])('denies %s a policy write',async role=>{const {db,mock}=fixture();f.role=role;await expect(saveReferralAdmin(db,headers,input())).rejects.toMatchObject({status:403});expect(mock.$transaction).not.toHaveBeenCalled()});
 it('requires login authorization and durable rate capacity before entering the write transaction',async()=>{
  const {db,mock}=fixture();f.authenticated=false;await expect(saveReferralAdmin(db,headers,input())).rejects.toMatchObject({status:401});f.authenticated=true;f.limited=true;await expect(saveReferralAdmin(db,headers,input())).rejects.toMatchObject({status:429});expect(mock.$transaction).not.toHaveBeenCalled();
 });
 it('reauthorizes the login session with a staff lock inside the transaction before changing the policy',async()=>{
  const {db,mock}=fixture();f.revoked=true;await expect(saveReferralAdmin(db,headers,input())).rejects.toMatchObject({status:403});expect(requireAdmin).toHaveBeenCalledWith(db,headers,{permission:'settings',lock:true});expect(mock.referralPolicy.update).not.toHaveBeenCalled();expect(mock.adminAudit.create).not.toHaveBeenCalled();
 });
 it.each([{discountPercent:4},{discountPercent:16},{discountPercent:5.5},{expiryDays:14},{expiryDays:31},{expiryDays:20.5},{enabled:'true'},{reason:'x'},{providerEnabled:true}])('rejects unsupported policy values %j',async patch=>{
  const {db,mock}=fixture();expect(referralPolicyInput.safeParse(input(patch)).success).toBe(false);await expect(saveReferralAdmin(db,headers,input(patch))).rejects.toThrow();expect(mock.$transaction).not.toHaveBeenCalled();
 });
 it('accepts boundary values, audits prior/next settings and changes no payment flag',async()=>{
  const {db,mock,current}=fixture();vi.stubEnv('PAYMENTS_LIVE_ENABLED','false');vi.stubEnv('CHAPA_ENABLED','false');
  const saved=await saveReferralAdmin(db,headers,input({discountPercent:5,expiryDays:15,enabled:true}));expect(saved).toMatchObject({configured:true,version:2,discountPercent:5,expiryDays:15,enabled:true,updatedAt:now.toISOString()});
  expect(current()?.updatedBy).toBe('owner-fixture');expect(mock.adminAudit.create).toHaveBeenCalledWith({data:expect.objectContaining({action:'REFERRAL_POLICY_UPDATED',target:'default',details:expect.objectContaining({reason:'Review referral reward policy',previous:{enabled:false,discountPercent:10,expiryDays:30,version:1},receipt:saved})})});expect(process.env.PAYMENTS_LIVE_ENABLED).toBe('false');expect(process.env.CHAPA_ENABLED).toBe('false');
  expect(await saveReferralAdmin(db,headers,input({version:2,discountPercent:15,expiryDays:30,enabled:false}))).toMatchObject({version:3,discountPercent:15,expiryDays:30,enabled:false});
 });
 it('creates a draft only from expected version zero and never enables rewards implicitly',async()=>{
  const {db,mock}=fixture(null);await expect(saveReferralAdmin(db,headers,input())).rejects.toMatchObject({status:409});expect(mock.referralPolicy.create).not.toHaveBeenCalled();expect(await saveReferralAdmin(db,headers,input({version:0}))).toMatchObject({version:1,enabled:false});
 });
 it('replays the same audited receipt without a second write and rejects changed-input key reuse',async()=>{
  const {db,mock}=fixture(),command=input();const first=await saveReferralAdmin(db,headers,command);expect(await saveReferralAdmin(db,headers,command)).toEqual(first);expect(mock.referralPolicy.update).toHaveBeenCalledTimes(1);expect(mock.adminAudit.create).toHaveBeenCalledTimes(1);
  await expect(saveReferralAdmin(db,headers,{...command,discountPercent:15})).rejects.toMatchObject({status:409});expect(mock.referralPolicy.update).toHaveBeenCalledTimes(1);
 });
 it('rejects a stale expected version without changing any setting',async()=>{
  const {db,mock}=fixture();await expect(saveReferralAdmin(db,headers,input({version:0}))).rejects.toMatchObject({status:409});expect(mock.referralPolicy.update).not.toHaveBeenCalled();expect(mock.adminAudit.create).not.toHaveBeenCalled();
 });
});

describe('referral policy HTTP transport',()=>{
 it('keeps success and authorization errors private/no-store',async()=>{
  let response=await GET(new Request('https://lowwin.example/api/admin/referrals'));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('private, no-store');expect(response.headers.get('vary')).toBe('Cookie');
  f.authenticated=false;response=await GET(new Request('https://lowwin.example/api/admin/referrals'));expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toContain('no-store');
 });
 it('rejects a cross-origin mutation before staff or policy access',async()=>{
  const response=await POST(new Request('https://lowwin.example/api/admin/referrals',{method:'POST',headers:{origin:'https://outside.example','content-type':'application/json'},body:JSON.stringify({action:'save-policy',input:input()})}));expect(response.status).toBe(403);expect(requireAdmin).not.toHaveBeenCalled();
 });
 it('rejects unsupported commands and bounds inputs on same-origin requests',async()=>{
  for(const body of [{action:'enable-provider',input:input()},{action:'save-policy',input:input({discountPercent:100})}]){
   const response=await POST(new Request('https://lowwin.example/api/admin/referrals',{method:'POST',headers:{origin:'https://lowwin.example','content-type':'application/json'},body:JSON.stringify(body)}));expect(response.status).toBe(422);expect(response.headers.get('cache-control')).toContain('private, no-store');
  }
 });
});
