import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';

const f=vi.hoisted(()=>({enabled:true,verify:vi.fn()}));
vi.mock('../src/modules/payments/chapa-provider',()=>({chapaAvailability:()=>({recoveryEnabled:f.enabled,mode:'test'}),chapaTransport:{create:vi.fn(),lookup:vi.fn(),methods:vi.fn()}}));
vi.mock('../src/modules/payments/chapa',()=>({verifyChapaCheckout:f.verify}));
import {processChapaEvent,processChapaEvents} from '../src/modules/payments/chapa-events';

const start=new Date('2026-10-29T12:00:00Z');
function fixture(attempts=0){
 const event={id:'durable-event',checkoutId:'owned-checkout',mode:'test',status:'QUEUED',attempts,nextAttemptAt:new Date(0),leaseUntil:null as Date|null,completedAt:null as Date|null,receivedAt:new Date(start.getTime()-120000),event:'payment.success'};
 const checkout={id:'owned-checkout',creditJournalId:null as string|null,leaseUntil:null as Date|null,providerStatus:'PENDING',verificationState:'UNVERIFIED',status:'PENDING'};
 const updateMany=vi.fn(async({where,data}:any)=>{
  if(where.status!==event.status)return {count:0};
  if(data.attempts){
   if(event.attempts>=where.attempts.lt||event.nextAttemptAt>new Date()||event.leaseUntil&&event.leaseUntil>new Date())return {count:0};
   event.attempts+=data.attempts.increment;event.leaseUntil=data.leaseUntil;return {count:1};
  }
  if(where.leaseUntil?.getTime()!==event.leaseUntil?.getTime())return {count:0};
  if(where.nextAttemptAt&&where.nextAttemptAt.getTime()!==event.nextAttemptAt.getTime())return {count:0};
  Object.assign(event,data);return {count:1};
 });
 const findMany=vi.fn(async()=>[{id:event.id}]);
 const readEvent=vi.fn(async()=>({...event}));
 const client={chapaWebhookEvent:{updateMany,findUniqueOrThrow:readEvent,findMany},chapaCheckout:{findUniqueOrThrow:vi.fn(async()=>({...checkout}))}};
 return {event,checkout,updateMany,findMany,readEvent,client:client as unknown as PrismaClient};
}

beforeEach(()=>{f.enabled=true;vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(start);f.verify.mockResolvedValue(undefined)});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()});

describe('durable Chapa event confirmation',()=>{
 it.each(['PENDING','FAILED','SUCCESS'])('uses merchant verification rather than a combined failure hint for authoritative %s',async status=>{
  const state=fixture();state.event.event='payment.failed_or_cancelled';
  f.verify.mockImplementation(async()=>{Object.assign(state.checkout,{providerStatus:status,verificationState:'VERIFIED',status:status==='SUCCESS'?'CREDITED':status,...(status==='SUCCESS'?{creditJournalId:'canonical-credit'}:{})})});
  expect(await processChapaEvent(state.client,state.event.id)).toBe(status!=='PENDING');
  expect(state.event.status).toBe(status==='PENDING'?'QUEUED':'PROCESSED');
  expect(state.checkout.creditJournalId).toBe(status==='SUCCESS'?'canonical-credit':null);
  expect(f.verify).toHaveBeenCalledOnce();
  if(status!=='PENDING'){expect(await processChapaEvent(state.client,state.event.id)).toBe(false);expect(f.verify).toHaveBeenCalledOnce()}
 });
 it.each(['PENDING','AUTH_NEEDED'])('keeps verified %s responses queued until a final result instead of trusting the success hint',async status=>{
  const state=fixture();f.verify.mockImplementation(async()=>{Object.assign(state.checkout,{providerStatus:status,verificationState:'VERIFIED',status})});
  expect(await processChapaEvent(state.client,state.event.id)).toBe(false);
  expect(f.verify).toHaveBeenCalledWith(state.client,state.checkout.id,undefined,undefined,expect.anything(),true);
  expect(state.checkout.creditJournalId).toBeNull();expect(state.event).toMatchObject({status:'QUEUED',attempts:1,completedAt:null,leaseUntil:null});
  expect(state.event.nextAttemptAt.getTime()).toBeGreaterThan(start.getTime());
  expect(await processChapaEvent(state.client,state.event.id)).toBe(false);expect(f.verify).toHaveBeenCalledTimes(1);
 });
 it('retries a due pending result and processes its later committed credit once',async()=>{
  const state=fixture();let calls=0;
  f.verify.mockImplementation(async()=>{calls++;Object.assign(state.checkout,calls===1?{providerStatus:'PENDING',verificationState:'VERIFIED'}:{providerStatus:'SUCCESS',verificationState:'VERIFIED',status:'CREDITED',creditJournalId:'canonical-credit'})});
  expect(await processChapaEvent(state.client,state.event.id)).toBe(false);
  vi.setSystemTime(state.event.nextAttemptAt);
  expect(await processChapaEvent(state.client,state.event.id)).toBe(true);expect(f.verify).toHaveBeenCalledTimes(2);
  expect(state.event).toMatchObject({status:'PROCESSED',attempts:2,leaseUntil:null,completedAt:expect.any(Date)});
  expect(await processChapaEvent(state.client,state.event.id)).toBe(false);expect(f.verify).toHaveBeenCalledTimes(2);
 });
 it('retains a hint that arrived during provider HTTP even when the earlier lookup returns a verified failure',async()=>{
  const state=fixture(),deferred=new Date(start.getTime()+60000);
  f.verify.mockImplementation(async()=>{
   // A new legacy delivery coalesced into the claimed canonical job.
   state.event.nextAttemptAt=deferred;
   Object.assign(state.checkout,{providerStatus:'FAILED',verificationState:'VERIFIED',status:'FAILED'});
  });
  expect(await processChapaEvent(state.client,state.event.id)).toBe(true);
  expect(state.event).toMatchObject({status:'QUEUED',attempts:0,nextAttemptAt:deferred,leaseUntil:null,completedAt:null});
  expect(state.updateMany.mock.calls).toEqual(expect.arrayContaining([[expect.objectContaining({where:expect.objectContaining({nextAttemptAt:new Date(0)}),data:expect.objectContaining({status:'PROCESSED'})})]]));
  expect(state.checkout.creditJournalId).toBeNull();
  vi.setSystemTime(deferred);
  f.verify.mockImplementation(async()=>{Object.assign(state.checkout,{providerStatus:'SUCCESS',verificationState:'VERIFIED',status:'CREDITED',creditJournalId:'later-canonical-credit'})});
  expect(await processChapaEvent(state.client,state.event.id)).toBe(true);expect(state.event.status).toBe('PROCESSED');expect(f.verify).toHaveBeenCalledTimes(2);
 });
 it('preserves a deferred hint that arrives after lease claim but before the worker reads the event',async()=>{
  const state=fixture(4),deferred=new Date(start.getTime()+60000);
  state.readEvent.mockImplementationOnce(async()=>{state.event.nextAttemptAt=deferred;return {...state.event}});
  f.verify.mockImplementation(async()=>{Object.assign(state.checkout,{providerStatus:'FAILED',verificationState:'VERIFIED',status:'FAILED'})});
  expect(await processChapaEvent(state.client,state.event.id)).toBe(true);
  expect(state.event).toMatchObject({status:'QUEUED',attempts:0,nextAttemptAt:deferred,leaseUntil:null,completedAt:null});
  expect(state.checkout.creditJournalId).toBeNull();
 });
 it('finishes a committed credit despite a concurrent later hint so no duplicate fulfillment is scheduled',async()=>{
  const state=fixture();
  f.verify.mockImplementation(async()=>{
   state.event.nextAttemptAt=new Date(start.getTime()+60000);
   Object.assign(state.checkout,{providerStatus:'SUCCESS',verificationState:'VERIFIED',status:'CREDITED',creditJournalId:'canonical-credit'});
  });
  expect(await processChapaEvent(state.client,state.event.id)).toBe(true);
  expect(state.event).toMatchObject({status:'PROCESSED',attempts:1,leaseUntil:null,completedAt:expect.any(Date)});
  expect(await processChapaEvent(state.client,state.event.id)).toBe(false);expect(f.verify).toHaveBeenCalledTimes(1);
 });
 it('allows only one concurrent worker to verify a claimed canonical event',async()=>{
  const state=fixture();let finish=()=>{};
  f.verify.mockImplementation(()=>new Promise<void>(resolve=>{finish=()=>{Object.assign(state.checkout,{providerStatus:'SUCCESS',verificationState:'VERIFIED',status:'CREDITED',creditJournalId:'canonical-credit'});resolve()}}));
  const first=processChapaEvent(state.client,state.event.id);
  await vi.waitFor(()=>expect(f.verify).toHaveBeenCalledTimes(1));
  expect(await processChapaEvent(state.client,state.event.id)).toBe(false);
  finish();expect(await first).toBe(true);expect(f.verify).toHaveBeenCalledTimes(1);expect(state.event.status).toBe('PROCESSED');
 });
 it.each(['FAILED','CANCELLED','INCOMPLETE','BLOCKED'])('completes a server-verified terminal %s without claiming a credit',async status=>{
  const state=fixture();f.verify.mockImplementation(async()=>{Object.assign(state.checkout,{providerStatus:status,verificationState:'VERIFIED',status})});
  expect(await processChapaEvent(state.client,state.event.id)).toBe(true);
  expect(state.event.status).toBe('PROCESSED');expect(state.checkout.creditJournalId).toBeNull();
 });
 it('finishes a late paid bid with preserved wallet funds without pretending the bid was accepted',async()=>{
  const state=fixture();Object.assign(state.checkout,{status:'NEEDS_REVIEW',providerStatus:'SUCCESS',verificationState:'VERIFIED',creditJournalId:'existing-credit'});
  expect(await processChapaEvent(state.client,state.event.id)).toBe(true);expect(f.verify).not.toHaveBeenCalled();expect(state.checkout.status).toBe('NEEDS_REVIEW');expect(state.event.status).toBe('PROCESSED');
 });
 it('keeps provider failures retryable and stops at the existing bounded attempt limit',async()=>{
  for(const attempts of [0,4]){
   const state=fixture(attempts);f.verify.mockRejectedValueOnce(Error('private provider failure'));
   expect(await processChapaEvent(state.client,state.event.id)).toBe(false);
   expect(state.event).toMatchObject({status:attempts===4?'NEEDS_VERIFICATION':'QUEUED',attempts:attempts+1,completedAt:null,leaseUntil:null});
   expect(state.checkout.creditJournalId).toBeNull();
  }
  const state=fixture(5);const prior=f.verify.mock.calls.length;
  expect(await processChapaEvent(state.client,state.event.id)).toBe(false);expect(f.verify).toHaveBeenCalledTimes(prior);
 });
 it('does not complete mismatched evidence solely because the webhook claimed success',async()=>{
  const state=fixture();f.verify.mockImplementation(async()=>{Object.assign(state.checkout,{providerStatus:'SUCCESS',verificationState:'MISMATCH',status:'NEEDS_REVIEW'})});
  expect(await processChapaEvent(state.client,state.event.id)).toBe(false);expect(state.event.status).toBe('QUEUED');expect(state.checkout.creditJournalId).toBeNull();
 });
 it('never races an active checkout lease or queries a disabled recovery worker',async()=>{
  const state=fixture();state.checkout.leaseUntil=new Date(start.getTime()+20000);
  expect(await processChapaEvent(state.client,state.event.id)).toBe(false);expect(f.verify).not.toHaveBeenCalled();expect(state.event.status).toBe('QUEUED');
  f.enabled=false;
  expect(await processChapaEvents(state.client)).toEqual({checked:0});expect(state.findMany).not.toHaveBeenCalled();
 });
 it('keeps batch processing limited to due queued events and at most twenty jobs',async()=>{
  const state=fixture();Object.assign(state.checkout,{creditJournalId:'existing-credit'});
  expect(await processChapaEvents(state.client,1000)).toEqual({checked:1});
  expect(state.findMany).toHaveBeenCalledWith({where:{mode:'test',status:'QUEUED',attempts:{lt:5},nextAttemptAt:{lte:expect.any(Date)},OR:[{leaseUntil:null},{leaseUntil:{lte:expect.any(Date)}}]},orderBy:[{nextAttemptAt:'asc'},{id:'asc'}],take:20,select:{id:true}});
 });
});
