import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {paymentPollRetryAfter,startDepositPolling} from '../src/components/deposit-polling';
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());
describe('bounded local deposit polling',()=>{
 it('checks at two seconds and never overlaps a slow request',async()=>{
  let resolve!:(value:{done:boolean})=>void;
  const check=vi.fn(()=>new Promise<{done:boolean}>(r=>{resolve=r}));
  const stop=startDepositPolling(check,()=>true,vi.fn());
  await vi.advanceTimersByTimeAsync(2000);expect(check).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(8000);expect(check).toHaveBeenCalledTimes(1);
  resolve({done:true});await vi.advanceTimersByTimeAsync(10000);expect(check).toHaveBeenCalledTimes(1);stop();
 });
 it('backs off, honors retry-after and stops after five minutes',async()=>{
  const check=vi.fn().mockResolvedValueOnce({retryAfterMs:30000}).mockResolvedValue({}),expired=vi.fn();
  const stop=startDepositPolling(check,()=>true,expired);
  await vi.advanceTimersByTimeAsync(2000);await vi.advanceTimersByTimeAsync(29000);expect(check).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);expect(check).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(300000);expect(expired).toHaveBeenCalledOnce();expect(check.mock.calls.length).toBeLessThan(45);stop();
 });
 it('pauses hidden screens and aborts obsolete checks on cleanup',async()=>{
  let visible=false;const check=vi.fn().mockResolvedValue({});const stop=startDepositPolling(check,()=>visible,vi.fn());
  await vi.advanceTimersByTimeAsync(10000);expect(check).not.toHaveBeenCalled();
  visible=true;await vi.advanceTimersByTimeAsync(2000);expect(check).toHaveBeenCalledOnce();
  const signal=check.mock.calls[0][0] as AbortSignal;stop();expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(10000);expect(check).toHaveBeenCalledOnce();
 });
 it('recovers a failed read without inventing a payment outcome',async()=>{
  const check=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue({done:true});
  const stop=startDepositPolling(check,()=>true,vi.fn());await vi.advanceTimersByTimeAsync(6000);expect(check).toHaveBeenCalledTimes(2);stop();
 });
 it('parses numeric and date retry headers',()=>{
  expect(paymentPollRetryAfter('30')).toBe(30000);
  expect(paymentPollRetryAfter(new Date(Date.now()+30000).toUTCString())).toBeGreaterThanOrEqual(29000);
  expect(paymentPollRetryAfter('invalid')).toBeUndefined();
 });
});
