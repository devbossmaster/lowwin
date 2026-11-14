import {describe,expect,it} from 'vitest';
import {clearTelegramAuthResume,consumeTelegramResumeDraft,projectTelegramResumeDraft,readTelegramAuthResume,registerTelegramResumeDraft,rememberTelegramAuthResume,telegramAuthResumeDestination,TELEGRAM_AUTH_RESUME_TTL_MS,type TelegramBidResumeDraft} from '../src/lib/telegram-auth-resume';
function storage(){const entries=new Map<string,string>();return {getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>{entries.set(key,value)},removeItem:(key:string)=>{entries.delete(key)},entries}}
const bid:TelegramBidResumeDraft={kind:'bid',auctionSlug:'power-bank',auctionCode:'LW-PB',numbers:['4.25','8.50'],input:'9.2',multiple:true,numberMode:'range',rangeFrom:'11',rangeTo:'13',rangeStep:'1',method:'telebirr',applyCoupon:false};
describe('bounded Telegram authentication resume',()=>{
 it('stores only safe internal screen coordinates, never callback or payment credentials',()=>{
  expect(telegramAuthResumeDestination('/my-bids?view=finished&code=oauth-code&access_token=secret&state=nonce#results')).toBe('/my-bids?view=finished#results');
  for(const next of ['https://evil.example/','//evil.example','/api/auth/sign-out','/admin','/\\evil.example'])expect(telegramAuthResumeDestination(next)).toBe('/');
  expect(telegramAuthResumeDestination('/payments/chapa/return?checkout=11111111-1111-4111-a111-111111111111')).toBe('/payments/chapa/return');
 });
 it('projects editable values and discards all unrelated sensitive or financial evidence',()=>{
  expect(projectTelegramResumeDraft({...bid,phone:'251911652904',idToken:'secret',initData:'secret',intentKey:'secret',quote:{total:'50'},paymentOutcome:'success'})).toEqual(bid);
  expect(projectTelegramResumeDraft({kind:'topup',amount:'100.00',method:'mpesa',stage:'payment',phone:'251711223344'})).toEqual({kind:'topup',amount:'100.00',method:'mpesa',stage:'payment'});
  expect(projectTelegramResumeDraft({kind:'topup',amount:'100',method:'wallet',stage:'payment'})).toBeNull();
  expect(projectTelegramResumeDraft({...bid,numbers:Array(51).fill('1')})).toBeNull();
  expect(projectTelegramResumeDraft({...bid,input:'<script>'})).toBeNull();
 });
 it('expires at fifteen minutes and rejects malformed or future records',()=>{
  const target=storage();rememberTelegramAuthResume('/my-bids',null,{storage:target,now:1000});
  expect(readTelegramAuthResume('alice',{storage:target,now:1000+TELEGRAM_AUTH_RESUME_TTL_MS-1})?.destination).toBe('/my-bids');
  expect(readTelegramAuthResume('alice',{storage:target,now:1000+TELEGRAM_AUTH_RESUME_TTL_MS})).toBeNull();expect(target.entries.size).toBe(0);
  rememberTelegramAuthResume('/profile','alice',{storage:target,now:1000});expect(readTelegramAuthResume('alice',{storage:target,now:999})).toBeNull();
  target.setItem('lowwin:telegram-auth-resume:v1','{');expect(readTelegramAuthResume('alice',{storage:target})).toBeNull();
 });
 it('allows a guest draft to bind only after server-confirmed login and rejects a different signed-in owner',()=>{
  const target=storage(),remove=registerTelegramResumeDraft('alice',()=>bid);
  rememberTelegramAuthResume('/', 'alice',{storage:target,now:1000});
  expect(readTelegramAuthResume(null,{storage:target,now:1001})).toBeNull();
  rememberTelegramAuthResume('/', 'alice',{storage:target,now:1000});expect(consumeTelegramResumeDraft('bob','bid','power-bank',{storage:target,now:1001})).toBeNull();remove();
  const removeGuest=registerTelegramResumeDraft(null,()=>bid);rememberTelegramAuthResume('/',null,{storage:target,now:1000});
  expect(consumeTelegramResumeDraft('alice','bid','different-auction',{storage:target,now:1001})).toBeNull();
  expect(consumeTelegramResumeDraft('alice','bid','power-bank',{storage:target,now:1001})).toEqual(bid);
  expect(consumeTelegramResumeDraft('alice','bid','power-bank',{storage:target,now:1001})).toBeNull();removeGuest();
 });
 it('resumes the existing bid sheet with only editable inputs and no payment command',()=>{
  const target=storage(),remove=registerTelegramResumeDraft(null,()=>bid);
  const record=rememberTelegramAuthResume('/',null,{storage:target,now:1000});
  expect(record?.destination).toBe('/auctions/LW-PB#bid-review');expect(consumeTelegramResumeDraft('alice','bid','power-bank',{storage:target,now:1001})).toEqual(bid);expect(record?.draft).not.toHaveProperty('intentKey');expect(record?.draft).not.toHaveProperty('quote');remove();
 });
 it('handles nested top-up forms and restores the parent registration when they unmount',()=>{
  const target=storage(),removeBid=registerTelegramResumeDraft(null,()=>bid),removeTopup=registerTelegramResumeDraft(null,()=>({kind:'topup',amount:'50',method:'cbebirr',stage:'payment'}));
  expect(rememberTelegramAuthResume('/',null,{storage:target,now:1000})?.destination).toBe('/profile?topup=1');removeTopup();
  expect(rememberTelegramAuthResume('/',null,{storage:target,now:1001})?.draft).toEqual(bid);removeBid();
 });
 it('keeps the same anonymous draft after a failed OAuth return without restarting its retention clock',()=>{
  const target=storage(),remove=registerTelegramResumeDraft(null,()=>bid);
  const original=rememberTelegramAuthResume('/',null,{storage:target,now:1000,scrollY:400})!;remove();
  const retried=rememberTelegramAuthResume(original.destination,null,{storage:target,now:100_000,scrollY:0});
  expect(retried?.draft).toEqual(bid);expect(retried?.createdAt).toBe(1000);expect(retried?.scrollY).toBe(400);
  expect(readTelegramAuthResume('alice',{storage:target,now:1000+TELEGRAM_AUTH_RESUME_TTL_MS})).toBeNull();
 });
 it('does not revive a previous selection when a mounted form reports an active payment',()=>{
  const target=storage(),remove=registerTelegramResumeDraft(null,()=>bid);
  const original=rememberTelegramAuthResume('/',null,{storage:target,now:1000})!;remove();
  const busy=registerTelegramResumeDraft(null,()=>null);
  expect(rememberTelegramAuthResume(original.destination,null,{storage:target,now:2000})?.draft).toBeNull();busy();
 });
 it('does not carry an old draft into another destination or another account',()=>{
  const target=storage(),remove=registerTelegramResumeDraft('alice',()=>bid);
  const original=rememberTelegramAuthResume('/','alice',{storage:target,now:1000})!;remove();
  expect(rememberTelegramAuthResume('/profile','alice',{storage:target,now:2000})?.draft).toBeNull();
  const again=registerTelegramResumeDraft('alice',()=>bid);rememberTelegramAuthResume('/','alice',{storage:target,now:3000});again();
  expect(rememberTelegramAuthResume(original.destination,'bob',{storage:target,now:4000})?.draft).toBeNull();
 });
 it('does not interrupt login when storage is blocked',()=>{
  const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
  expect(rememberTelegramAuthResume('/profile',null,{storage:blocked})).toBeNull();expect(readTelegramAuthResume('alice',{storage:blocked})).toBeNull();expect(()=>clearTelegramAuthResume(blocked)).not.toThrow();
 });
});
