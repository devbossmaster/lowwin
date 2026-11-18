import {afterEach,describe,expect,it,vi} from 'vitest';
import {startChapaOriginalPolling} from '../src/lib/chapa-original-polling';
import {ChapaClientError,type ChapaCheckoutView} from '../src/lib/chapa-client';
const order={id:'a2345678-1234-4234-8234-123456789012',apiVersion:'v2',flowVersion:4,status:'AUTH_NEEDED',purpose:'TOP_UP',authorizationReference:'original-provider-reference',authType:'USSD',receipt:null} as ChapaCheckoutView;
const visibility=()=>Object.assign(new EventTarget(),{visibilityState:'visible' as DocumentVisibilityState});
afterEach(()=>vi.useRealTimers());
describe('read-only original Inline key discovery',()=>{
 it('delays discovery during a normal initialization response, then reads only the original key',async()=>{
  vi.useFakeTimers();const read=vi.fn().mockResolvedValue(order),received=vi.fn();
  const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>true,wake:null,initialDelayMs:5000});
  await vi.advanceTimersByTimeAsync(4999);expect(read).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(read).toHaveBeenCalledOnce();expect(received).toHaveBeenCalledExactlyOnceWith(order);
  await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledOnce();stop();
 });
 it('checks immediately on returning from the wallet app before the delayed discovery starts',async()=>{
  vi.useFakeTimers();const source=visibility(),wake=new EventTarget(),read=vi.fn().mockResolvedValue(order),received=vi.fn();
  const stop=startChapaOriginalPolling(read,received,source,{isCurrent:()=>true,wake,initialDelayMs:5000});
  await vi.advanceTimersByTimeAsync(100);source.visibilityState='hidden';source.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(100);source.visibilityState='visible';source.dispatchEvent(new Event('visibilitychange'));wake.dispatchEvent(new Event('focus'));wake.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledOnce();expect(received).toHaveBeenCalledExactlyOnceWith(order);
  await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledOnce();stop();
 });
 it('cancels the delayed discovery when the original response arrives normally',async()=>{
  vi.useFakeTimers();const read=vi.fn(),received=vi.fn(),wake=new EventTarget();
  const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>true,wake,initialDelayMs:5000});
  await vi.advanceTimersByTimeAsync(1000);stop();wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(60000);
  expect(read).not.toHaveBeenCalled();expect(received).not.toHaveBeenCalled();
 });
 it('keeps pre-commit404s nonterminal and bounded when initialization is still pending',async()=>{
  vi.useFakeTimers();const read=vi.fn().mockRejectedValue(new ChapaClientError('Not committed yet',404,'NOT_FOUND')),received=vi.fn(),error=vi.fn(),pause=vi.fn();
  const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>true,wake:null,initialDelayMs:5000,maximumReads:3,onError:error,onPause:pause});
  await vi.advanceTimersByTimeAsync(4999);expect(read).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(60000);
  expect(read).toHaveBeenCalledTimes(3);expect(error).not.toHaveBeenCalled();expect(received).not.toHaveBeenCalled();expect(pause).toHaveBeenCalledOnce();stop();
 });
 it('automatically discovers the original after pre-commit404s, then stops before the owned-ID observer takes over',async()=>{
  vi.useFakeTimers();const read=vi.fn().mockRejectedValueOnce(new ChapaClientError('Not found',404,'NOT_FOUND')).mockRejectedValueOnce(new ChapaClientError('Not found',404,'NOT_FOUND')).mockResolvedValue(order),received=vi.fn(),error=vi.fn(),pause=vi.fn();
  const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>true,onError:error,onPause:pause,wake:null});
  await vi.advanceTimersByTimeAsync(2999);expect(read).toHaveBeenCalledTimes(2);expect(received).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(read).toHaveBeenCalledTimes(3);expect(received).toHaveBeenCalledExactlyOnceWith(order);expect(error).not.toHaveBeenCalled();expect(pause).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledTimes(3);stop();
 });
 it('pauses while hidden and coalesces foreground events without overlapping reads',async()=>{
  vi.useFakeTimers();const source=visibility(),wake=new EventTarget(),received=vi.fn(),resume=vi.fn();source.visibilityState='hidden';let resolve!:(value:ChapaCheckoutView)=>void;
  const read=vi.fn(()=>new Promise<ChapaCheckoutView>(done=>{resolve=done}));
  const stop=startChapaOriginalPolling(read,received,source,{isCurrent:()=>true,wake,onResume:resume});
  await vi.advanceTimersByTimeAsync(60000);expect(read).not.toHaveBeenCalled();source.visibilityState='visible';source.dispatchEvent(new Event('visibilitychange'));wake.dispatchEvent(new Event('focus'));wake.dispatchEvent(new Event('online'));expect(read).toHaveBeenCalledOnce();
  resolve(order);await vi.advanceTimersByTimeAsync(0);expect(received).toHaveBeenCalledOnce();expect(resume).toHaveBeenCalledOnce();stop();
 });
 it('bounds missing-row reads and resumes the same read-only discovery after connectivity returns',async()=>{
  vi.useFakeTimers();const wake=new EventTarget(),read=vi.fn().mockRejectedValue(new ChapaClientError('Not found',404,'NOT_FOUND')),received=vi.fn(),error=vi.fn(),pause=vi.fn(),resume=vi.fn();
  const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>true,wake,maximumReads:3,onError:error,onPause:pause,onResume:resume});
  await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledTimes(3);expect(pause).toHaveBeenCalledOnce();expect(received).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
  read.mockResolvedValueOnce({...order,status:'CREDITED'});wake.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(4);expect(resume).toHaveBeenCalledOnce();expect(received).toHaveBeenCalledExactlyOnceWith({...order,status:'CREDITED'});
  wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledTimes(4);stop();
 });
 it('coalesces sequential resume events after a fast read while preserving its scheduled retry',async()=>{
  vi.useFakeTimers();const source=visibility(),wake=new EventTarget(),read=vi.fn().mockRejectedValue(new ChapaClientError('Not found',404)),received=vi.fn();source.visibilityState='hidden';
  const stop=startChapaOriginalPolling(read,received,source,{isCurrent:()=>true,wake});source.visibilityState='visible';source.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(100);wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(100);wake.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledOnce();
  read.mockResolvedValue(order);await vi.advanceTimersByTimeAsync(800);expect(read).toHaveBeenCalledTimes(2);expect(received).toHaveBeenCalledExactlyOnceWith(order);stop();
 });
 it('allows a genuine second return from background inside the resume coalescing window',async()=>{
  vi.useFakeTimers();const source=visibility(),wake=new EventTarget(),read=vi.fn().mockRejectedValue(new ChapaClientError('Not found',404)),received=vi.fn();source.visibilityState='hidden';
  const stop=startChapaOriginalPolling(read,received,source,{isCurrent:()=>true,wake});source.visibilityState='visible';source.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(100);source.visibilityState='hidden';source.dispatchEvent(new Event('visibilitychange'));read.mockResolvedValue(order);source.visibilityState='visible';source.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(2);expect(received).toHaveBeenCalledExactlyOnceWith(order);stop();
 });
 it.each([401,403])('stops on authoritative access denial %s while preserving the original operation',async status=>{
  vi.useFakeTimers();const wake=new EventTarget(),failure=new ChapaClientError('Access denied',status,'FORBIDDEN'),read=vi.fn().mockRejectedValue(failure),received=vi.fn(),error=vi.fn();
  const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>true,wake,onError:error});await vi.advanceTimersByTimeAsync(60000);wake.dispatchEvent(new Event('online'));expect(read).toHaveBeenCalledOnce();expect(error).toHaveBeenCalledExactlyOnceWith(failure);expect(received).not.toHaveBeenCalled();stop();
 });
 it('keeps transient errors secondary and accepts a later owned snapshot',async()=>{
  vi.useFakeTimers();const failure=new Error('Offline'),read=vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(order),error=vi.fn(),received=vi.fn();
  const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>true,wake:null,onError:error});await vi.advanceTimersByTimeAsync(1000);expect(error).toHaveBeenCalledExactlyOnceWith(failure);expect(received).toHaveBeenCalledExactlyOnceWith(order);stop();
 });
 it('discards an obsolete account response without receiving it or requesting again',async()=>{
  vi.useFakeTimers();let current=true,resolve!:(value:ChapaCheckoutView)=>void;const read=vi.fn(()=>new Promise<ChapaCheckoutView>(done=>{resolve=done})),received=vi.fn(),pause=vi.fn();
  const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>current,wake:null,onPause:pause});current=false;resolve(order);await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledOnce();expect(received).not.toHaveBeenCalled();expect(pause).not.toHaveBeenCalled();stop();
 });
 it('aborts the active owned read and removes wake handlers on cleanup',async()=>{
  vi.useFakeTimers();const wake=new EventTarget(),read=vi.fn((_signal:AbortSignal)=>new Promise<ChapaCheckoutView>(()=>{})),received=vi.fn();const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>true,wake});const signal=read.mock.calls[0][0];stop();expect(signal.aborted).toBe(true);wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledOnce();expect(received).not.toHaveBeenCalled();
 });
 it('does not spend its visible observation budget while hidden',async()=>{
  vi.useFakeTimers();const source=visibility(),read=vi.fn().mockRejectedValueOnce(new ChapaClientError('Not yet visible',404)).mockResolvedValue(order),received=vi.fn();const stop=startChapaOriginalPolling(read,received,source,{isCurrent:()=>true,wake:null,budgetMs:2000});await vi.advanceTimersByTimeAsync(500);source.visibilityState='hidden';source.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledOnce();source.visibilityState='visible';source.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);expect(received).toHaveBeenCalledExactlyOnceWith(order);stop();
 });
});
