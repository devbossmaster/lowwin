import {afterEach,describe,expect,it,vi} from 'vitest';
import {retainChapaObserver,startChapaObserver,stopChapaObservers} from '../src/lib/chapa-observer';
import {ChapaClientError,type ChapaCheckoutView} from '../src/lib/chapa-client';

const id='00000000-0000-4000-8000-000000000001';
const pending={id,purpose:'TOP_UP',status:'PENDING',fundsPreserved:false,receipt:null,pollAfterMs:5000} as ChapaCheckoutView;
const currentDirect={...pending,apiVersion:'v2',flowVersion:5,chargeType:'DIRECT',pollAfterMs:2000} as ChapaCheckoutView;
class Source extends EventTarget{
 close=vi.fn();
 frame(order:ChapaCheckoutView){this.dispatchEvent(new MessageEvent('checkout',{data:JSON.stringify({checkout:order})}))}
}
function fixture(){
 const visibility=Object.assign(new EventTarget(),{visibilityState:'visible' as DocumentVisibilityState}),wake=new EventTarget(),sources:Source[]=[];
 const readSnapshot=vi.fn().mockResolvedValue(pending),verify=vi.fn().mockResolvedValue(pending),onSnapshot=vi.fn(),onError=vi.fn(),onPause=vi.fn(),onResume=vi.fn();
 const createSource=vi.fn(()=>{const source=new Source();sources.push(source);return source});
 const options={visibility,wake,telegram:null,createSource,readSnapshot,verify,onSnapshot,onError,onPause,onResume,observeDirect:true};
 return {visibility,wake,sources,options,readSnapshot,verify,onSnapshot,onError,createSource};
}
afterEach(()=>{stopChapaObservers();vi.useRealTimers();vi.restoreAllMocks()});
describe('one owned SSE and verification observer',()=>{
 it('starts a known owned Direct5 attempt with one verification POST and no GET or extra stream-open request',async()=>{
  vi.useFakeTimers();const f=fixture(),stop=startChapaObserver(id,{...f.options,initialOrder:currentDirect});await vi.advanceTimersByTimeAsync(0);
  expect(f.readSnapshot).not.toHaveBeenCalled();expect(f.verify).toHaveBeenCalledOnce();
  f.sources[0].dispatchEvent(new Event('open'));await vi.advanceTimersByTimeAsync(0);expect(f.readSnapshot).not.toHaveBeenCalled();expect(f.verify).toHaveBeenCalledOnce();stop();
 });
 it('verifies the known current attempt immediately on foreground without a serial snapshot read',async()=>{
  vi.useFakeTimers();const f=fixture(),stop=startChapaObserver(id,{...f.options,initialOrder:currentDirect});await vi.advanceTimersByTimeAsync(0);
  f.visibility.visibilityState='hidden';f.visibility.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(60000);expect(f.verify).toHaveBeenCalledOnce();
  f.verify.mockResolvedValue({...currentDirect,status:'CREDITED'});f.visibility.visibilityState='visible';f.visibility.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);
  expect(f.verify).toHaveBeenCalledTimes(2);expect(f.readSnapshot).not.toHaveBeenCalled();expect(f.sources[1].close).toHaveBeenCalledOnce();stop();
 });
 it.each([
  {apiVersion:'v2',flowVersion:4,chargeType:'INLINE'},
  {apiVersion:'v2',flowVersion:2,chargeType:'DIRECT'},
  {apiVersion:'legacy',flowVersion:1,chargeType:'DIRECT'},
 ])('keeps snapshot-first recovery for the historical protocol %j',async protocol=>{
  vi.useFakeTimers();const f=fixture(),stop=startChapaObserver(id,{...f.options,initialOrder:{...pending,...protocol} as ChapaCheckoutView});await vi.advanceTimersByTimeAsync(0);
  expect(f.readSnapshot).toHaveBeenCalledOnce();expect(f.verify).toHaveBeenCalledOnce();expect(f.readSnapshot.mock.invocationCallOrder[0]).toBeLessThan(f.verify.mock.invocationCallOrder[0]);stop();
 });
 it('uses an owned current snapshot to skip a GET queued by stream open during unknown-attempt recovery',async()=>{
  vi.useFakeTimers();const f=fixture();let finish!:(order:ChapaCheckoutView)=>void;f.readSnapshot.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
  const stop=startChapaObserver(id,f.options);f.sources[0].dispatchEvent(new Event('open'));expect(f.readSnapshot).toHaveBeenCalledOnce();expect(f.verify).not.toHaveBeenCalled();
  finish(currentDirect);await vi.advanceTimersByTimeAsync(0);expect(f.readSnapshot).toHaveBeenCalledOnce();expect(f.verify).toHaveBeenCalledOnce();stop();
 });
 it('renders a committed current push immediately while verification is held and ignores its later pending response',async()=>{
  vi.useFakeTimers();const f=fixture();let finish!:(order:ChapaCheckoutView)=>void;f.verify.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
  const stop=startChapaObserver(id,{...f.options,initialOrder:currentDirect});f.sources[0].dispatchEvent(new Event('open'));await vi.advanceTimersByTimeAsync(0);
  const confirmed={...currentDirect,status:'CREDITED'};f.sources[0].frame(confirmed);expect(f.onSnapshot).toHaveBeenLastCalledWith(confirmed);expect(f.sources[0].close).toHaveBeenCalledOnce();
  finish(currentDirect);await vi.advanceTimersByTimeAsync(60000);expect(f.onSnapshot).toHaveBeenCalledOnce();expect(f.readSnapshot).not.toHaveBeenCalled();expect(f.verify).toHaveBeenCalledOnce();stop();
 });
 it('backs off a failed current verification without falling back to a redundant GET or losing auth failures',async()=>{
  vi.useFakeTimers();const f=fixture();f.verify.mockRejectedValueOnce(new ChapaClientError('Temporary',503));
  const stop=startChapaObserver(id,{...f.options,initialOrder:currentDirect,createSource:null});await vi.advanceTimersByTimeAsync(3999);expect(f.verify).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);expect(f.verify).toHaveBeenCalledTimes(2);expect(f.readSnapshot).not.toHaveBeenCalled();stop();
  const unauthorized=fixture();unauthorized.verify.mockRejectedValue(new ChapaClientError('Expired',401));const release=startChapaObserver(id,{...unauthorized.options,initialOrder:currentDirect});await vi.advanceTimersByTimeAsync(60000);
  expect(unauthorized.verify).toHaveBeenCalledOnce();expect(unauthorized.readSnapshot).not.toHaveBeenCalled();expect(unauthorized.sources[0].close).toHaveBeenCalledOnce();release();
 });
 it('coalesces current wake events behind one in-flight verification without a GET from stream open',async()=>{
  vi.useFakeTimers();const f=fixture();let finish!:(order:ChapaCheckoutView)=>void;f.verify.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
  const stop=startChapaObserver(id,{...f.options,initialOrder:currentDirect});await vi.advanceTimersByTimeAsync(0);f.sources[0].dispatchEvent(new Event('open'));f.wake.dispatchEvent(new Event('focus'));f.wake.dispatchEvent(new Event('online'));expect(f.verify).toHaveBeenCalledOnce();
  finish(currentDirect);await vi.advanceTimersByTimeAsync(0);expect(f.verify).toHaveBeenCalledTimes(2);expect(f.readSnapshot).not.toHaveBeenCalled();stop();
 });
 it('keeps the current owned protocol and request fence when observation transfers to another surface',async()=>{
  vi.useFakeTimers();const f=fixture(),other=fixture();let finish!:(order:ChapaCheckoutView)=>void;f.verify.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
  const first=retainChapaObserver('account-a',id,{...f.options,initialOrder:currentDirect}),second=retainChapaObserver('account-a',id,other.options);await vi.advanceTimersByTimeAsync(0);first();await vi.advanceTimersByTimeAsync(0);
  expect(other.verify).not.toHaveBeenCalled();expect(other.readSnapshot).not.toHaveBeenCalled();finish(currentDirect);await vi.advanceTimersByTimeAsync(0);
  expect(other.verify).toHaveBeenCalledOnce();expect(other.readSnapshot).not.toHaveBeenCalled();expect(f.onSnapshot).not.toHaveBeenCalled();second();
 });
 it('does not stop current observation for a stale terminal push after privately confirmed provider success',async()=>{
  vi.useFakeTimers();const f=fixture(),known={...currentDirect,providerStatus:'SUCCESS',verificationState:'VERIFIED'};f.verify.mockResolvedValue(known);
  const stop=startChapaObserver(id,{...f.options,initialOrder:known});await vi.advanceTimersByTimeAsync(0);f.sources[0].frame({...currentDirect,status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED'});
  expect(f.onSnapshot).not.toHaveBeenCalled();expect(f.sources[0].close).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(2000);expect(f.verify).toHaveBeenCalledTimes(2);stop();
 });
 it('reads on open, pushes committed receipts immediately, and closes on confirmation',async()=>{
  vi.useFakeTimers();const f=fixture(),stop=startChapaObserver(id,f.options);await vi.advanceTimersByTimeAsync(0);
  expect(f.readSnapshot).toHaveBeenCalledOnce();expect(f.verify).toHaveBeenCalledOnce();expect(f.createSource).toHaveBeenCalledOnce();
  const source=f.sources[0];source.dispatchEvent(new Event('open'));await vi.advanceTimersByTimeAsync(0);
  expect(f.readSnapshot).toHaveBeenCalledTimes(2);
  const receipt={...pending,status:'CREDITED'};source.frame(receipt);
  expect(f.onSnapshot).toHaveBeenLastCalledWith(receipt);expect(source.close).toHaveBeenCalledOnce();
  source.frame(pending);await vi.advanceTimersByTimeAsync(60000);expect(f.verify).toHaveBeenCalledOnce();expect(f.onSnapshot).toHaveBeenCalledOnce();stop();
 });
 it('serializes snapshot and verification, coalescing open/resume reads',async()=>{
  vi.useFakeTimers();const f=fixture();let finish!:(order:ChapaCheckoutView)=>void;
  f.readSnapshot.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
  const stop=startChapaObserver(id,f.options);f.sources[0].dispatchEvent(new Event('open'));f.wake.dispatchEvent(new Event('focus'));f.wake.dispatchEvent(new Event('online'));
  expect(f.verify).not.toHaveBeenCalled();expect(f.readSnapshot).toHaveBeenCalledOnce();finish(pending);await vi.advanceTimersByTimeAsync(0);
  expect(f.readSnapshot).toHaveBeenCalledTimes(2);expect(f.verify).toHaveBeenCalledOnce();stop();
 });
 it('keeps active Inline validation cadence while streaming and polling on broker failure',async()=>{
  vi.useFakeTimers();const f=fixture(),stop=startChapaObserver(id,f.options);await vi.advanceTimersByTimeAsync(0);
  f.sources[0].dispatchEvent(new Event('open'));await vi.advanceTimersByTimeAsync(4999);expect(f.verify).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);expect(f.verify).toHaveBeenCalledTimes(2);
  f.sources[0].dispatchEvent(new Event('error'));await vi.advanceTimersByTimeAsync(5000);expect(f.verify).toHaveBeenCalledTimes(3);expect(f.createSource).toHaveBeenCalledTimes(2);stop();
 });
 it('bounds failed SSE reconnects and continues checking the original payment',async()=>{
  vi.useFakeTimers();const f=fixture(),stop=startChapaObserver(id,f.options);await vi.advanceTimersByTimeAsync(0);
  for(let count=0;count<6;count++){
   const source=f.sources.at(-1)!;source.dispatchEvent(new Event('open'));source.dispatchEvent(new Event('error'));await vi.advanceTimersByTimeAsync(31000);
  }
  expect(f.createSource).toHaveBeenCalledTimes(6);const count=f.verify.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);expect(f.createSource).toHaveBeenCalledTimes(6);expect(f.verify.mock.calls.length).toBeGreaterThan(count);stop();
 });
 it('reads immediately on Telegram activation and removes all handlers on cleanup',async()=>{
  vi.useFakeTimers();const f=fixture(),handlers=new Map<string,()=>void>(),telegram={onEvent:vi.fn((event:string,fn:()=>void)=>handlers.set(event,fn)),offEvent:vi.fn((event:string)=>handlers.delete(event))};
  const stop=startChapaObserver(id,{...f.options,telegram});await vi.advanceTimersByTimeAsync(0);
  handlers.get('activated')!();await vi.advanceTimersByTimeAsync(0);expect(f.readSnapshot).toHaveBeenCalledTimes(2);expect(f.verify).toHaveBeenCalledTimes(2);
  stop();expect(handlers.size).toBe(0);f.wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(60000);expect(f.readSnapshot).toHaveBeenCalledTimes(2);
 });
 it('closes while hidden and reads a missed success immediately on foreground',async()=>{
  vi.useFakeTimers();const f=fixture(),stop=startChapaObserver(id,f.options);await vi.advanceTimersByTimeAsync(0);
  f.visibility.visibilityState='hidden';f.visibility.dispatchEvent(new Event('visibilitychange'));expect(f.sources[0].close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60000);expect(f.verify).toHaveBeenCalledOnce();
  f.readSnapshot.mockResolvedValue({...pending,status:'CREDITED'});f.visibility.visibilityState='visible';f.visibility.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);
  expect(f.readSnapshot).toHaveBeenCalledTimes(2);expect(f.verify).toHaveBeenCalledOnce();expect(f.sources[1].close).toHaveBeenCalledOnce();stop();
 });
 it('ignores other attempts and obsolete accounts, including delayed frames after cleanup',async()=>{
  vi.useFakeTimers();const f=fixture();let current=true;
  const stop=startChapaObserver(id,{...f.options,isCurrent:()=>current});await vi.advanceTimersByTimeAsync(0);
  f.sources[0].frame({...pending,id:'00000000-0000-4000-8000-000000000002',status:'CREDITED'});expect(f.onSnapshot).not.toHaveBeenCalled();
  current=false;f.sources[0].frame({...pending,status:'CREDITED'});expect(f.onSnapshot).not.toHaveBeenCalled();expect(f.sources[0].close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60000);expect(f.verify).toHaveBeenCalledOnce();stop();
 });
 it('stops on session expiry or owned snapshot access failure',async()=>{
  vi.useFakeTimers();const f=fixture(),stop=startChapaObserver(id,f.options);await vi.advanceTimersByTimeAsync(0);
  f.sources[0].dispatchEvent(new Event('authorization'));expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({status:401,code:'UNAUTHORIZED'}));
  await vi.advanceTimersByTimeAsync(60000);expect(f.verify).toHaveBeenCalledOnce();stop();
  const other=fixture();other.readSnapshot.mockRejectedValue(new ChapaClientError('Not found',404));const cleanup=startChapaObserver(id,other.options);await vi.advanceTimersByTimeAsync(60000);
  expect(other.readSnapshot).toHaveBeenCalledOnce();expect(other.verify).not.toHaveBeenCalled();expect(other.createSource).toHaveBeenCalledOnce();cleanup();
 });
 it('keeps bounded fallback when EventSource is unavailable without starting a charge',async()=>{
  vi.useFakeTimers();const f=fixture(),stop=startChapaObserver(id,{...f.options,createSource:null});await vi.advanceTimersByTimeAsync(15000);
  expect(f.verify).toHaveBeenCalledTimes(4);expect(f.createSource).not.toHaveBeenCalled();stop();
 });
 it('shares one account-scoped stream/poller and fans snapshots out to both surfaces',async()=>{
  vi.useFakeTimers();const f=fixture(),other=fixture(),first=retainChapaObserver('account-a',id,f.options),second=retainChapaObserver('account-a',id,other.options);await vi.advanceTimersByTimeAsync(0);
  expect(f.createSource).toHaveBeenCalledOnce();expect(other.createSource).not.toHaveBeenCalled();expect(f.verify).toHaveBeenCalledOnce();expect(other.verify).not.toHaveBeenCalled();
  f.sources[0].frame({...pending,status:'AUTH_NEEDED'});expect(f.onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({status:'AUTH_NEEDED'}));expect(other.onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({status:'AUTH_NEEDED'}));
  second();await vi.advanceTimersByTimeAsync(5000);expect(f.sources[0].close).not.toHaveBeenCalled();expect(f.verify).toHaveBeenCalledTimes(2);first();expect(f.sources[0].close).toHaveBeenCalledOnce();
 });
 it('transfers observation when its first surface unmounts without dropping the other reader',async()=>{
  vi.useFakeTimers();const f=fixture(),other=fixture(),first=retainChapaObserver('account-a',id,f.options),second=retainChapaObserver('account-a',id,other.options);await vi.advanceTimersByTimeAsync(0);
  first();await vi.advanceTimersByTimeAsync(0);expect(f.sources[0].close).toHaveBeenCalledOnce();expect(other.createSource).toHaveBeenCalledOnce();expect(other.verify).toHaveBeenCalledOnce();
  other.sources[0].frame({...pending,status:'CREDITED'});expect(other.onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({status:'CREDITED'}));expect(f.onSnapshot).not.toHaveBeenLastCalledWith(expect.objectContaining({status:'CREDITED'}));second();
 });
 it('fences a primary handoff until the previous owner request has settled',async()=>{
  vi.useFakeTimers();const f=fixture(),other=fixture();let finish!:(order:ChapaCheckoutView)=>void;
  f.readSnapshot.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
  const first=retainChapaObserver('account-a',id,f.options),second=retainChapaObserver('account-a',id,other.options);await vi.advanceTimersByTimeAsync(0);
  first();await vi.advanceTimersByTimeAsync(0);expect(f.sources[0].close).toHaveBeenCalledOnce();expect(other.readSnapshot).not.toHaveBeenCalled();expect(other.verify).not.toHaveBeenCalled();
  finish(pending);await vi.advanceTimersByTimeAsync(0);expect(other.readSnapshot).toHaveBeenCalledOnce();expect(other.verify).toHaveBeenCalledOnce();expect(f.onSnapshot).not.toHaveBeenCalled();second();
 });
 it('retains the request fence when the last surface closes and immediately remounts',async()=>{
  vi.useFakeTimers();const f=fixture(),other=fixture();let finish!:(order:ChapaCheckoutView)=>void;
  f.verify.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const first=retainChapaObserver('account-a',id,f.options);await vi.advanceTimersByTimeAsync(0);
  expect(f.verify).toHaveBeenCalledOnce();first();const second=retainChapaObserver('account-a',id,other.options);await vi.advanceTimersByTimeAsync(0);expect(other.readSnapshot).not.toHaveBeenCalled();
  finish(pending);await vi.advanceTimersByTimeAsync(0);expect(other.readSnapshot).toHaveBeenCalledOnce();expect(other.verify).toHaveBeenCalledOnce();second();
 });
 it('stops old account streams before sharing another account and ignores their late frames',async()=>{
  vi.useFakeTimers();const f=fixture(),other=fixture(),first=retainChapaObserver('account-a',id,f.options);await vi.advanceTimersByTimeAsync(0);const count=f.onSnapshot.mock.calls.length;
  const second=retainChapaObserver('account-b',id,other.options);expect(f.sources[0].close).toHaveBeenCalledOnce();f.sources[0].frame({...pending,status:'CREDITED'});expect(f.onSnapshot).toHaveBeenCalledTimes(count);
  await vi.advanceTimersByTimeAsync(0);expect(other.createSource).toHaveBeenCalledOnce();first();expect(other.sources[0].close).not.toHaveBeenCalled();stopChapaObservers('account-b');expect(other.sources[0].close).toHaveBeenCalledOnce();second();
 });
});
