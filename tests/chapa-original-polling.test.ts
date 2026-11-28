import {afterEach,describe,expect,it,vi} from 'vitest';
import {CHAPA_DIRECT_DISCOVERY_DELAY_MS,startChapaOriginalPolling} from '../src/lib/chapa-original-polling';
import {ChapaClientError,type ChapaCheckoutView} from '../src/lib/chapa-client';
const order={id:'a2345678-1234-4234-8234-123456789012',apiVersion:'v2',flowVersion:4,status:'AUTH_NEEDED',purpose:'TOP_UP',authorizationReference:'original-provider-reference',authType:'USSD',receipt:null} as ChapaCheckoutView;
const visibility=()=>Object.assign(new EventTarget(),{visibilityState:'visible' as DocumentVisibilityState});
afterEach(()=>vi.useRealTimers());
describe('read-only original Chapa key discovery',()=>{
 it('starts Direct discovery at three seconds while initialization is still outstanding',async()=>{
  vi.useFakeTimers();const read=vi.fn().mockResolvedValue(order),received=vi.fn();
  const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>true,wake:null,initialDelayMs:CHAPA_DIRECT_DISCOVERY_DELAY_MS});
  await vi.advanceTimersByTimeAsync(2999);expect(read).not.toHaveBeenCalled();
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
 it('discovers the original on Telegram activation before the delayed read without a browser focus event',async()=>{
  vi.useFakeTimers();const read=vi.fn().mockResolvedValue(order),received=vi.fn();
  const telegram={onEvent:vi.fn(),offEvent:vi.fn()};
  const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>true,wake:null,telegram,initialDelayMs:5000});
  await vi.advanceTimersByTimeAsync(300);
  expect(read).not.toHaveBeenCalled();
  const [event,activate]=telegram.onEvent.mock.calls[0];expect(event).toBe('activated');activate();
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledOnce();expect(received).toHaveBeenCalledExactlyOnceWith(order);
  expect(telegram.offEvent).toHaveBeenCalledWith('activated',activate);
  activate();await vi.advanceTimersByTimeAsync(5000);expect(read).toHaveBeenCalledOnce();stop();
 });
 it('cancels the delayed discovery when the original response arrives normally',async()=>{
  vi.useFakeTimers();const read=vi.fn(),received=vi.fn(),wake=new EventTarget();
  const stop=startChapaOriginalPolling(read,received,visibility(),{isCurrent:()=>true,wake,initialDelayMs:5000});
  await vi.advanceTimersByTimeAsync(1000);stop();wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(60000);
  expect(read).not.toHaveBeenCalled();expect(received).not.toHaveBeenCalled();
 });
 it.each(['wallet return','reconnect'])('replaces one stalled creation lookup on %s and ignores its late response',async trigger=>{
  vi.useFakeTimers();
  const wake=new EventTarget(),source=visibility(),received=vi.fn(),error=vi.fn(),onWalletReturn=vi.fn();
  const handlers=new Map<string,()=>void>();
  const telegram={onEvent:(event:string,listener:()=>void)=>{handlers.set(event,listener)},offEvent:(event:string)=>{handlers.delete(event)}};
  let completeStale!:(result:ChapaCheckoutView)=>void;
  let completeFresh!:(result:ChapaCheckoutView)=>void;
  const read=vi.fn<(signal:AbortSignal)=>Promise<ChapaCheckoutView>>()
   .mockImplementationOnce(()=>new Promise(resolve=>{completeStale=resolve}))
   .mockImplementationOnce(()=>new Promise(resolve=>{completeFresh=resolve}));
  const stop=startChapaOriginalPolling(read,received,source,{isCurrent:()=>true,wake,telegram,onWalletReturn,onError:error});
  await vi.advanceTimersByTimeAsync(2500);
  if(trigger==='wallet return'){wake.dispatchEvent(new Event('blur'));wake.dispatchEvent(new Event('focus'))}
  else wake.dispatchEvent(new Event('online'));
  wake.dispatchEvent(new Event('focus'));
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[0][0].aborted).toBe(true);
  expect(read.mock.calls[1][0].aborted).toBe(false);
  expect(onWalletReturn).toHaveBeenCalledTimes(trigger==='wallet return'?1:0);
  handlers.get('activated')!();
  expect(read).toHaveBeenCalledTimes(2);
  expect(onWalletReturn).toHaveBeenCalledOnce();
  completeStale(order);
  await vi.advanceTimersByTimeAsync(0);
  expect(received).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  const credited={...order,status:'CREDITED'};
  completeFresh(credited);
  await vi.advanceTimersByTimeAsync(10000);
  expect(received).toHaveBeenCalledExactlyOnceWith(credited);
  expect(read).toHaveBeenCalledTimes(2);
  stop();
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
