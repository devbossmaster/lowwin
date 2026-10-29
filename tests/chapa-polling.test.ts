import {afterEach,describe,expect,it,vi} from 'vitest';
import {startChapaPolling} from '../src/lib/chapa-polling';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';

const pending={status:'PENDING',purpose:'TOP_UP',fundsPreserved:false,receipt:null,pollAfterMs:15000} as ChapaCheckoutView;
function visibility(){
 const target=new EventTarget();return Object.assign(target,{visibilityState:'visible' as DocumentVisibilityState});
}
afterEach(()=>vi.useRealTimers());

describe('automatic server-owned Chapa verification',()=>{
 it('checks immediately, respects the server delay and stops after confirmed credit',async()=>{
  vi.useFakeTimers();const source=visibility(),verify=vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce({...pending,status:'CREDITED'});
  const stop=startChapaPolling(verify,vi.fn(),source);
  await vi.advanceTimersByTimeAsync(14999);expect(verify).toHaveBeenCalledTimes(1);
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
});
