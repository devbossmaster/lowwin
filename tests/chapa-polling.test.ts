import {afterEach,describe,expect,it,vi} from 'vitest';
import {startChapaPolling} from '../src/lib/chapa-polling';
import {ChapaClientError,type ChapaCheckoutView} from '../src/lib/chapa-client';

const pending={status:'PENDING',purpose:'TOP_UP',fundsPreserved:false,receipt:null,pollAfterMs:15000} as ChapaCheckoutView;
function visibility(){
 const target=new EventTarget();return Object.assign(target,{visibilityState:'visible' as DocumentVisibilityState});
}
afterEach(()=>vi.useRealTimers());

describe('automatic server-owned Chapa verification',()=>{
 it('wakes on return from an external checkout and stops after authoritative credit',async()=>{
  vi.useFakeTimers();const source=visibility(),wake=new EventTarget();
  const verify=vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce({...pending,status:'CREDITED'});
  const stop=startChapaPolling(verify,vi.fn(),source,{wake});await vi.advanceTimersByTimeAsync(0);
  wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(0);
  expect(verify).toHaveBeenCalledTimes(2);wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(60000);
  expect(verify).toHaveBeenCalledTimes(2);stop();
 });
 it('shows connection errors, bounds checks, then resumes automatically on foreground',async()=>{
  vi.useFakeTimers();const source=visibility(),wake=new EventTarget(),pause=vi.fn(),resume=vi.fn(),error=vi.fn();
  const verify=vi.fn().mockRejectedValue(new Error('offline'));
  const stop=startChapaPolling(verify,pause,source,{wake,onError:error,onResume:resume});
  await vi.advanceTimersByTimeAsync(300000);expect(pause).toHaveBeenCalledOnce();expect(error).toHaveBeenCalled();
  const count=verify.mock.calls.length;await vi.advanceTimersByTimeAsync(60000);expect(verify).toHaveBeenCalledTimes(count);
  verify.mockResolvedValue({...pending,status:'CREDITED'});wake.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(0);
  expect(resume).toHaveBeenCalledOnce();expect(verify).toHaveBeenCalledTimes(count+1);stop();
 });
 it('stops failed ownership checks and removes foreground listeners',async()=>{
  vi.useFakeTimers();const wake=new EventTarget(),error=vi.fn(),verify=vi.fn().mockRejectedValue(new ChapaClientError('Not found',404,'NOT_FOUND'));
  const stop=startChapaPolling(verify,vi.fn(),visibility(),{wake,onError:error});await vi.advanceTimersByTimeAsync(0);
  wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(300000);
  expect(verify).toHaveBeenCalledOnce();expect(error).toHaveBeenCalledOnce();stop();
 });
 it('checks immediately, respects the server delay and stops after confirmed credit',async()=>{
  vi.useFakeTimers();const source=visibility(),verify=vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce({...pending,status:'CREDITED'});
  const stop=startChapaPolling(verify,vi.fn(),source);
  await vi.advanceTimersByTimeAsync(14999);expect(verify).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(verify).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60000);expect(verify).toHaveBeenCalledTimes(2);stop();
 });
 it('observes a server-confirmed bid on the five-second status hint rather than the provider cooldown',async()=>{
  vi.useFakeTimers();const waiting={...pending,purpose:'BID',pollAfterMs:5000} as ChapaCheckoutView;
  const verify=vi.fn().mockResolvedValueOnce(waiting).mockResolvedValueOnce({...waiting,status:'BID_ACCEPTED',receipt:{bid:{id:'accepted-on-server'}}});
  const stop=startChapaPolling(verify,vi.fn(),visibility());
  await vi.advanceTimersByTimeAsync(4999);expect(verify).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);expect(verify).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60000);expect(verify).toHaveBeenCalledTimes(2);stop();
 });
 it('waits while hidden and resumes without overlapping verification calls',async()=>{
  vi.useFakeTimers();const source=visibility();source.visibilityState='hidden';
  let resolve!:(order:ChapaCheckoutView)=>void;const verify=vi.fn(()=>new Promise<ChapaCheckoutView>(r=>{resolve=r}));
  const stop=startChapaPolling(verify,vi.fn(),source);expect(verify).not.toHaveBeenCalled();
  source.visibilityState='visible';source.dispatchEvent(new Event('visibilitychange'));source.dispatchEvent(new Event('visibilitychange'));expect(verify).toHaveBeenCalledTimes(1);
  source.visibilityState='hidden';source.dispatchEvent(new Event('visibilitychange'));resolve(pending);
  await vi.advanceTimersByTimeAsync(60000);expect(verify).toHaveBeenCalledTimes(1);stop();
  source.visibilityState='visible';source.dispatchEvent(new Event('visibilitychange'));expect(verify).toHaveBeenCalledTimes(1);
 });
 it.each(['FAILED','CANCELLED','INCOMPLETE','BLOCKED'])('stops at Chapa outcome %s',async status=>{
  vi.useFakeTimers();const verify=vi.fn().mockResolvedValue({...pending,status}),pause=vi.fn();
  const stop=startChapaPolling(verify,pause,visibility());await vi.advanceTimersByTimeAsync(300000);
  expect(verify).toHaveBeenCalledTimes(1);expect(pause).not.toHaveBeenCalled();stop();
 });
 it('bounds unavailable checks to five minutes without fabricating a payment result',async()=>{
  vi.useFakeTimers();const verify=vi.fn().mockRejectedValue(new Error('unavailable')),pause=vi.fn();
  const stop=startChapaPolling(verify,pause,visibility());await vi.advanceTimersByTimeAsync(300000);
  const count=verify.mock.calls.length;expect(pause).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);expect(verify).toHaveBeenCalledTimes(count);stop();
 });
 it('does not restart checking when an old account request settles after cleanup',async()=>{
  vi.useFakeTimers();let resolve!:(order:ChapaCheckoutView)=>void;
  const verify=vi.fn(()=>new Promise<ChapaCheckoutView>(r=>{resolve=r})),pause=vi.fn();
  const stop=startChapaPolling(verify,pause,visibility());stop();resolve(pending);
  await vi.advanceTimersByTimeAsync(300000);expect(verify).toHaveBeenCalledTimes(1);expect(pause).not.toHaveBeenCalled();
 });
 it('uses the saved deadline rather than granting another five minutes on reopen',async()=>{
  vi.useFakeTimers();const now=Date.now(),pause=vi.fn(),verify=vi.fn().mockResolvedValue(pending);
  const stop=startChapaPolling(verify,pause,visibility(),{deadlineAt:now+10000,wake:null});
  await vi.advanceTimersByTimeAsync(9999);expect(verify).toHaveBeenCalledTimes(1);expect(pause).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(pause).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(300000);expect(verify).toHaveBeenCalledTimes(1);stop();
  const reopenedPause=vi.fn(),reopened=startChapaPolling(verify,reopenedPause,visibility(),{deadlineAt:now+10000,wake:null});
  await vi.advanceTimersByTimeAsync(0);expect(verify).toHaveBeenCalledTimes(2);expect(reopenedPause).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(300000);expect(verify).toHaveBeenCalledTimes(2);reopened();
 });
 it('does one check after an ended session returns from background and accepts a late credit',async()=>{
  vi.useFakeTimers();const now=Date.now(),source=visibility(),wake=new EventTarget(),pause=vi.fn(),resume=vi.fn();
  const verify=vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce({...pending,status:'CREDITED'});
  const stop=startChapaPolling(verify,pause,source,{deadlineAt:now+60000,wake,onResume:resume});
  await vi.advanceTimersByTimeAsync(0);source.visibilityState='hidden';source.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(120000);expect(verify).toHaveBeenCalledTimes(1);
  source.visibilityState='visible';source.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);
  expect(verify).toHaveBeenCalledTimes(2);expect(pause).toHaveBeenCalledOnce();expect(resume).not.toHaveBeenCalled();
  wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(300000);expect(verify).toHaveBeenCalledTimes(2);stop();
 });
 it('does not extend an ended deadline when repeated foreground events find payment still pending',async()=>{
  vi.useFakeTimers();const source=visibility(),wake=new EventTarget(),pause=vi.fn(),verify=vi.fn().mockResolvedValue(pending);
  const stop=startChapaPolling(verify,pause,source,{deadlineAt:Date.now()-1,wake});
  await vi.advanceTimersByTimeAsync(0);expect(pause).toHaveBeenCalledOnce();expect(verify).toHaveBeenCalledTimes(1);
  wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(0);expect(verify).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(300000);expect(verify).toHaveBeenCalledTimes(2);expect(pause).toHaveBeenCalledOnce();stop();
 });
});
