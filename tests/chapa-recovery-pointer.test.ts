import {afterEach,describe,expect,it,vi} from 'vitest';
import {QueryClient} from '@tanstack/react-query';
import {chapaOriginalRecoveryUrl,ChapaClientError,type ChapaCheckoutView} from '../src/lib/chapa-client';
import {chapaRecoveryStorage,clearChapaRecoveryPointer,clearChapaRecoveryPointers,readChapaRecoveryPointer,retainChapaRecoveryPointer} from '../src/lib/chapa-recovery-pointer';
import {readChapaOriginalAttempt,retainChapaOriginalAttempt} from '../src/lib/chapa-original-attempt';
import {startChapaOriginalPolling} from '../src/lib/chapa-original-polling';

const key='a2345678-1234-4234-8234-123456789012',second='b2345678-1234-4234-8234-123456789012',orderId='c2345678-1234-4234-8234-123456789012';
const owner='verified-account',resource='topup',pointer={version:1 as const,key};
function storage(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)},key:(index:number)=>[...values.keys()][index]??null,get length(){return values.size},values}}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()});

describe('opaque account-scoped Inline reload recovery',()=>{
 it('survives a new query client without persisting phone, quote, amount or authentication data',()=>{
  const saved=storage(),first=new QueryClient(),intent={key,apiVersion:'v2' as const,kind:'inline' as const,flow:'INLINE' as const,purpose:'TOP_UP' as const,amount:'50.00',paymentMethod:'telebirr',phone:'251911000000'};
  retainChapaOriginalAttempt(first,'verified-account:session',resource,intent);
  expect(retainChapaRecoveryPointer(saved,owner,resource,pointer)).toBe(true);
  first.clear();const reloaded=new QueryClient();expect(readChapaOriginalAttempt(reloaded,'verified-account:session',resource)).toBeNull();
  expect(readChapaRecoveryPointer(saved,owner,resource)).toEqual(pointer);
  expect([...saved.values.values()]).toEqual([JSON.stringify(pointer)]);
  expect(chapaOriginalRecoveryUrl(readChapaRecoveryPointer(saved,owner,resource)!.key)).toBe(`/api/payments/chapa/inline?key=${key}`);
 });
 it('keeps the same key when the owned response supplies an order ID; competing controllers cannot overwrite it',()=>{
  const saved=storage();retainChapaRecoveryPointer(saved,owner,resource,pointer);
  expect(retainChapaRecoveryPointer(saved,owner,resource,{...pointer,key:second})).toBe(false);
  retainChapaRecoveryPointer(saved,owner,resource,{...pointer,orderId});retainChapaRecoveryPointer(saved,owner,resource,pointer);
  expect(readChapaRecoveryPointer(saved,owner,resource)).toEqual({...pointer,orderId});
 });
 it('isolates verified accounts and resource scopes, including separate auction drafts',()=>{
  const saved=storage();retainChapaRecoveryPointer(saved,owner,resource,pointer);
  for(const [account,scope] of [['other-account',resource],[owner,'bid:first-auction'],[owner,'bid:second-auction']])expect(readChapaRecoveryPointer(saved,account,scope)).toBeNull();
  retainChapaRecoveryPointer(saved,owner,'bid:first-auction',{...pointer,key:second});
  expect(readChapaRecoveryPointer(saved,owner,resource)).toEqual(pointer);expect(readChapaRecoveryPointer(saved,owner,'bid:first-auction')).toEqual({...pointer,key:second});
 });
 it('clears other accounts only after verified restoration, keeps the same owner on reload, and clears all on sign-out',()=>{
  const saved=storage();saved.setItem('unrelated','keep');retainChapaRecoveryPointer(saved,owner,resource,pointer);retainChapaRecoveryPointer(saved,'other-account',resource,{...pointer,key:second});
  clearChapaRecoveryPointers(saved,owner);expect(readChapaRecoveryPointer(saved,owner,resource)).toEqual(pointer);expect(readChapaRecoveryPointer(saved,'other-account',resource)).toBeNull();
  clearChapaRecoveryPointers(saved);expect(readChapaRecoveryPointer(saved,owner,resource)).toBeNull();expect([...saved.values.entries()]).toEqual([['unrelated','keep']]);
 });
 it('cannot release a newer original from an old response or a different owned order',()=>{
  const saved=storage();retainChapaRecoveryPointer(saved,owner,resource,{...pointer,orderId});
  for(const expected of [{key:second},{orderId:second},{}]){clearChapaRecoveryPointer(saved,owner,resource,expected);expect(readChapaRecoveryPointer(saved,owner,resource)).toEqual({...pointer,orderId})}
  clearChapaRecoveryPointer(saved,owner,resource,{orderId});expect(readChapaRecoveryPointer(saved,owner,resource)).toBeNull();
 });
 it.each([
  '{',JSON.stringify({...pointer,version:2}),JSON.stringify({...pointer,key:'not-an-operation'}),JSON.stringify({...pointer,key:[key]}),
  JSON.stringify({...pointer,orderId:''}),JSON.stringify({...pointer,orderId:[orderId]}),JSON.stringify({...pointer,phone:'251911000000'}),JSON.stringify({...pointer,amount:'50.00'}),' '.repeat(257),
 ])('rejects malformed or expanded browser data instead of treating it as a charge payload',raw=>{
  const saved=storage();retainChapaRecoveryPointer(saved,owner,resource,pointer);saved.setItem(saved.key(0)!,raw);expect(readChapaRecoveryPointer(saved,owner,resource)).toBeNull();
 });
 it('does not read or write a guest/unsafe owner or unsupported resource key',()=>{
  const saved=storage();for(const [account,scope] of [['',resource],['owner:session',resource],[owner,'bid:../other'],[owner,'arbitrary']]){retainChapaRecoveryPointer(saved,account,scope,pointer);expect(readChapaRecoveryPointer(saved,account,scope)).toBeNull()}
  expect(saved.length).toBe(0);
 });
 it('works in SSR and denied-storage environments without granting an outcome or another charge',()=>{
  expect(chapaRecoveryStorage()).toBeNull();const denied={getItem(){throw Error('denied')},setItem(){throw Error('denied')},removeItem(){throw Error('denied')},key(){throw Error('denied')},get length():number{throw Error('denied')}};
  expect(readChapaRecoveryPointer(denied,owner,resource)).toBeNull();expect(()=>retainChapaRecoveryPointer(denied,owner,resource,pointer)).not.toThrow();expect(()=>clearChapaRecoveryPointers(denied)).not.toThrow();
  vi.stubGlobal('window',{get sessionStorage(){throw Error('denied')}});expect(chapaRecoveryStorage()).toBeNull();
 });
 it('discovers the original by a bounded GET-only observer after reload; transient missing rows are not failure',async()=>{
  vi.useFakeTimers();const saved=storage();retainChapaRecoveryPointer(saved,owner,resource,pointer);const recovered=readChapaRecoveryPointer(saved,owner,resource)!;
  const read=vi.fn(async():Promise<ChapaCheckoutView>=>{if(read.mock.calls.length===1)throw new ChapaClientError('Not found yet',404,'NOT_FOUND');return {id:orderId,status:'AUTH_NEEDED'} as ChapaCheckoutView}),received=vi.fn(),errors=vi.fn();
  const visibility=Object.assign(new EventTarget(),{visibilityState:'visible' as const}),wake=new EventTarget(),stop=startChapaOriginalPolling(async()=>{expect(chapaOriginalRecoveryUrl(recovered.key)).toBe(`/api/payments/chapa/inline?key=${key}`);return read()},received,visibility,{isCurrent:()=>true,wake,onError:errors});
  await vi.advanceTimersByTimeAsync(1000);expect(read).toHaveBeenCalledTimes(2);expect(received).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:orderId}));expect(errors).not.toHaveBeenCalled();
  wake.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(30000);expect(read).toHaveBeenCalledTimes(2);expect(readChapaRecoveryPointer(saved,owner,resource)).toEqual(pointer);stop();
 });
 it('retains uncertainty and stops discovery on account denial without releasing or replacing the operation',async()=>{
  vi.useFakeTimers();const saved=storage();retainChapaRecoveryPointer(saved,owner,resource,pointer);const read=vi.fn(async()=>{throw new ChapaClientError('Not found',403,'FORBIDDEN')}),received=vi.fn(),errors=vi.fn();
  const visibility=Object.assign(new EventTarget(),{visibilityState:'visible' as const});startChapaOriginalPolling(read,received,visibility,{isCurrent:()=>true,wake:null,onError:errors});
  await vi.advanceTimersByTimeAsync(30000);expect(read).toHaveBeenCalledOnce();expect(received).not.toHaveBeenCalled();expect(errors).toHaveBeenCalledOnce();expect(readChapaRecoveryPointer(saved,owner,resource)).toEqual(pointer);
 });
});
