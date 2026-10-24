import {afterEach,describe,expect,it,vi} from 'vitest';
import {arifPayPaymentPhone,arifPayRecoverable,clearArifPayAttempt,readArifPayAttempt,requestArifPayJson,writeArifPayAttempt,type ArifPayAttempt} from '../src/lib/arifpay-recovery';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()});
const attempt:ArifPayAttempt={version:1,fee:'30',intent:{auctionSlug:'test-auction',amount:'3.6',feeVersion:1,key:'0f55aaab-2222-4444-8888-123456789012',channel:'TELEBIRR',phone:'251911111111'}};
const storage=()=>{const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}}};
describe('ArifPay interrupted-request recovery',()=>{
 it('preserves the complete original consent and request across a reload, scoped to the authenticated identity',()=>{
  const s=storage(),key='checkout:session-one:test-auction:3.6';writeArifPayAttempt(s,key,attempt);
  expect(readArifPayAttempt(s,key)).toEqual(attempt);expect(readArifPayAttempt(s,'checkout:session-two:test-auction:3.6')).toBeNull();
  const restored=readArifPayAttempt(s,key)!;restored.intent.phone='251922222222';expect(readArifPayAttempt(s,key)!.intent.phone).toBe('251911111111');
 });
 it('clears both the saved order/intent and legacy idempotency key on a terminal outcome',()=>{
  const s=storage();writeArifPayAttempt(s,'checkout',attempt);s.setItem('checkout:key','old-request-key');clearArifPayAttempt(s,'checkout');expect(s.getItem('checkout')).toBeNull();expect(s.getItem('checkout:key')).toBeNull();
 });
 it('rejects incomplete/corrupt saved requests and handles disabled browser storage',()=>{
  const s=storage();s.setItem('checkout','{');expect(readArifPayAttempt(s,'checkout')).toBeNull();s.setItem('checkout',JSON.stringify({version:1,intent:{key:attempt.intent.key}}));expect(readArifPayAttempt(s,'checkout')).toBeNull();
  expect(()=>writeArifPayAttempt({getItem:()=>null,setItem:()=>{throw Error('storage denied')},removeItem:()=>{}},'checkout',attempt)).not.toThrow();
 });
 it('normalizes payer numbers for the selected payment method without switching it silently',()=>{
  expect(arifPayPaymentPhone('+251 911 111 111','TELEBIRR')).toBe('251911111111');expect(arifPayPaymentPhone('0711111111','MPESA')).toBe('251711111111');expect(arifPayPaymentPhone('0911111111','MPESA')).toBeNull();
 });
 it('aborts stalled availability/restoration requests after twelve seconds',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>new Promise((_resolve,reject)=>options.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))));
  const request=requestArifPayJson('/api/payments/arifpay');const outcome=expect(request).rejects.toMatchObject({name:'AbortError'});await vi.advanceTimersByTimeAsync(12000);await outcome;
 });
 it('rejects a late successful response belonging to a disposed request even if its transport ignored cancellation',async()=>{
  const controller=new AbortController();let resolve!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{resolve=r})));
  const request=requestArifPayJson('/api/payments/arifpay/checkouts/saved',{},controller.signal),outcome=expect(request).rejects.toMatchObject({name:'AbortError'});controller.abort();resolve(Response.json({status:'BID_ACCEPTED'}));await outcome;
 });
 it('keeps provider-review cases recoverable while verified-credit review and terminal failures stop polling',()=>{
  expect(arifPayRecoverable({status:'NEEDS_REVIEW',reason:'PROVIDER_CONFIRMATION_REQUIRED',fundsPreserved:false})).toBe(true);
  for(const status of ['BID_ACCEPTED','FAILED','CANCELLED','EXPIRED'])expect(arifPayRecoverable({status,reason:null,fundsPreserved:false})).toBe(false);
  expect(arifPayRecoverable({status:'NEEDS_REVIEW',reason:'AUCTION_CLOSED',fundsPreserved:true})).toBe(false);
 });
});
