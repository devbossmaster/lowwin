import {afterEach,describe,expect,it,vi} from 'vitest';
import {startChapaHistoryClock} from '../src/components/chapa-payment-history';
import {chapaSessionEnded,type ChapaCheckoutView} from '../src/lib/chapa-client';

const pending=(createdAt:number)=>({purpose:'TOP_UP',status:'PENDING',providerStatus:'PENDING',fundsPreserved:false,receipt:null,createdAt:new Date(createdAt).toISOString(),expiresAt:new Date(createdAt+86400000).toISOString()}) as ChapaCheckoutView;
const visibility=()=>Object.assign(new EventTarget(),{visibilityState:'visible' as DocumentVisibilityState});
afterEach(()=>vi.useRealTimers());

describe('saved transaction checkout-window labels',()=>{
 it('updates each idle deadline once without changing saved payment data',async()=>{
  vi.useFakeTimers();const now=Date.now(),orders=[pending(now-290000),pending(now-280000)],original=structuredClone(orders),refresh=vi.fn(),source=visibility();
  const stop=startChapaHistoryClock(orders,refresh,source,new EventTarget());
  await vi.advanceTimersByTimeAsync(10000);expect(refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(refresh).toHaveBeenCalledTimes(1);expect(chapaSessionEnded(orders[0])).toBe(true);expect(chapaSessionEnded(orders[1])).toBe(false);
  await vi.advanceTimersByTimeAsync(10000);expect(refresh).toHaveBeenCalledTimes(2);expect(chapaSessionEnded(orders[1])).toBe(true);
  await vi.advanceTimersByTimeAsync(300000);expect(refresh).toHaveBeenCalledTimes(2);expect(orders).toEqual(original);stop();
 });
 it('refreshes elapsed rows on foreground without restarting their windows',async()=>{
  vi.useFakeTimers();const order=pending(Date.now()-290000),source=visibility(),refresh=vi.fn();source.visibilityState='hidden';
  const stop=startChapaHistoryClock([order],refresh,source,new EventTarget());
  await vi.advanceTimersByTimeAsync(60000);expect(refresh).not.toHaveBeenCalled();
  source.visibilityState='visible';source.dispatchEvent(new Event('visibilitychange'));expect(refresh).toHaveBeenCalledOnce();expect(chapaSessionEnded(order)).toBe(true);
  await vi.advanceTimersByTimeAsync(300000);expect(refresh).toHaveBeenCalledOnce();stop();
 });
 it('never schedules confirmed, applying or reviewed payments and removes old-account clocks',async()=>{
  vi.useFakeTimers();const order=pending(Date.now()),refresh=vi.fn(),source=visibility(),wake=new EventTarget();
  const stop=startChapaHistoryClock([{...order,status:'CREDITED'},{...order,providerStatus:'SUCCESS'},{...order,status:'NEEDS_REVIEW'}],refresh,source,wake);
  await vi.advanceTimersByTimeAsync(300001);expect(refresh).not.toHaveBeenCalled();stop();
  const release=startChapaHistoryClock([pending(Date.now())],refresh,source,wake);release();
  wake.dispatchEvent(new Event('focus'));source.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(300001);expect(refresh).not.toHaveBeenCalled();
 });
});
