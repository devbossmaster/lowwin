import {afterEach,describe,expect,it,vi} from 'vitest';
import {ChapaClientError,chapaRestorePollingId,type ChapaCheckoutView} from '../src/lib/chapa-client';
import {startChapaPolling} from '../src/lib/chapa-polling';

const id='0f55aaab-2222-4444-8888-123456789012';
const restored={order:null,recoveryId:id,restoring:false,errorCode:'UNAVAILABLE'};
afterEach(()=>vi.useRealTimers());

describe('owned checkout restoration after an interrupted read',()=>{
 it('continues checking the retained ID after transport failure without an order snapshot',()=>{
  expect(chapaRestorePollingId(restored)).toBe(id);
  expect(chapaRestorePollingId({...restored,recoveryId:id.toUpperCase()})).toBe(id);
 });
 it('waits for the initial restore and leaves a loaded order to the normal observer',()=>{
  expect(chapaRestorePollingId({...restored,restoring:true})).toBeNull();
  expect(chapaRestorePollingId({...restored,order:{id,status:'PENDING'} as ChapaCheckoutView})).toBeNull();
 });
 it.each(['UNAUTHORIZED','FORBIDDEN','NOT_FOUND'])('does not automatically recover after %s',errorCode=>{
  expect(chapaRestorePollingId({...restored,errorCode})).toBeNull();
 });
 it.each([null,'invalid','../other-order'])('does not invent a status target for %s',recoveryId=>{
  expect(chapaRestorePollingId({...restored,recoveryId})).toBeNull();
 });
 it('uses one same-attempt observer, resumes after transient errors and stops at verified cancellation',async()=>{
  vi.useFakeTimers();const visibility=Object.assign(new EventTarget(),{visibilityState:'visible' as DocumentVisibilityState}),wake=new EventTarget();
  let release:((order:ChapaCheckoutView)=>void)|undefined;
  const requests:string[]=[],check=vi.fn().mockRejectedValueOnce(new ChapaClientError('Temporary interruption',503,'UNAVAILABLE')).mockImplementationOnce(()=>new Promise<ChapaCheckoutView>(resolve=>{release=resolve}));
  const target=chapaRestorePollingId(restored)!;
  const stop=startChapaPolling(()=>{requests.push(target);return check()},vi.fn(),visibility,{observeDirect:true,wake});
  await vi.advanceTimersByTimeAsync(0);expect(check).toHaveBeenCalledOnce();
  visibility.visibilityState='hidden';visibility.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(30000);expect(check).toHaveBeenCalledOnce();
  visibility.visibilityState='visible';visibility.dispatchEvent(new Event('visibilitychange'));wake.dispatchEvent(new Event('focus'));wake.dispatchEvent(new Event('online'));
  expect(check).toHaveBeenCalledTimes(2);
  release!({id,status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',fundsPreserved:false} as ChapaCheckoutView);
  await vi.advanceTimersByTimeAsync(0);wake.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(60000);
  expect(check).toHaveBeenCalledTimes(2);expect(requests).toEqual([id,id]);stop();
 });
});
