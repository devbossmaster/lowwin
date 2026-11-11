import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';
import type {useChapaPayment} from '../src/components/chapa-payment';
const clock=vi.hoisted(()=>({now:Date.parse('2026-11-10T10:00:00Z')}));
vi.mock('../src/components/chapa-payment',()=>({useChapaPaymentClock:()=>clock.now,ChapaPaymentStatus:()=>createElement('div',{'data-hosted-recovery':true})}));
vi.mock('../src/components/account-sheet',()=>({AccountSheetFooter:({children}:{children:ReactNode})=>createElement('footer',null,children)}));
import PaymentProgress from '../src/components/payment-progress';
import {WalletTopUpProgress} from '../src/components/wallet-top-up-progress';
import {MiniLocaleProvider} from '../src/components/mini-locale';
const started=Date.parse('2026-11-10T10:00:00Z');
const order={id:'owned-progress',purpose:'BID',chargeType:'DIRECT',status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'UNAVAILABLE',verificationUnavailable:true,authType:'USSD',authorizationReference:'accepted-request',createdAt:new Date(started).toISOString(),expiresAt:new Date(started+300000).toISOString(),paymentMethod:'telebirr',amount:'35.00',fundsPreserved:false,receipt:null} as ChapaCheckoutView;
const base={order,busy:false,restoring:false,paused:false,error:'',started:true,canStartAgain:true,markPresented:()=>{}} as unknown as ReturnType<typeof useChapaPayment>;
function render(purpose:'BID'|'TOP_UP',payment=base,am=false){return renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:am?'am':'en',children:purpose==='TOP_UP'?createElement(WalletTopUpProgress,{payment:{...payment,order:payment.order?{...payment.order,purpose}:null},amount:'35.00',provider:'telebirr',phone:'0912345678',onRetry:()=>{},onClose:()=>{},footerPortal:true}):createElement(PaymentProgress,{payment,summary:{auctionTitle:'Owned auction',numbers:['4.25'],total:'35.00',provider:'telebirr',phone:'0912345678'},onRetry:()=>{},onClose:()=>{}})}))}
beforeEach(()=>{clock.now=started});
describe('shared bid and deposit status surface',()=>{
 it('uses a wallet-only paying state and committed internal-wallet receipt without phone authorization',()=>{
  const summary={auctionTitle:'Owned auction',numbers:['4.25'],total:'35.00',provider:'wallet',phone:null};
  const walletPayment={...base,order:null,started:false};
  const wrap=(children:ReactNode)=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children}));
  const preparing=wrap(createElement(PaymentProgress,{payment:walletPayment,summary,preparing:true,onClose:()=>{}}));
  expect(preparing).toContain('Paying from your wallet…');expect(preparing).toContain('Internal wallet');expect(preparing).not.toContain('phone');expect(preparing).not.toContain('authorization');expect(preparing).not.toContain('one-time-code');expect(preparing).not.toContain('Chapa');
  const receipt={batch:{total:'35.00',lines:[{number:'4.25'}]},receipts:[],payment:{method:'wallet',gateway:'INTERNAL_WALLET',total:'35.00',acceptedBidIds:['owned-bid']}} as unknown as import('../src/lib/bid-batch-client').BidBatchReceipt;
  const committed=wrap(createElement(PaymentProgress,{payment:walletPayment,summary,receipt,onClose:()=>{}}));
  expect(committed).toContain('Bid accepted');expect(committed).toContain('Lowwin Wallet');expect(committed).toContain('Internal wallet');expect(committed).toContain('>Paid</dt>');expect(committed).not.toContain('Chapa');
 });
 for(const purpose of ['BID','TOP_UP'] as const){
  it(`${purpose} keeps active authorization and fulfillment automatic after the display deadline`,()=>{
   clock.now=started+95000;
   for(const current of [order,{...order,providerStatus:'SUCCESS',verificationState:'VERIFIED',status:'PENDING'} as ChapaCheckoutView]){
    const html=render(purpose,{...base,order:current,error:'Temporary verification error',errorCode:'UNAVAILABLE'});
    expect(html).toContain('Total payable');expect(html).not.toContain('Check payment');expect(html).not.toContain('Try again');expect(html).not.toContain('Retry original');expect(html).not.toContain('Confirm code');
   }
  });
  it(`${purpose} keeps accepted authorization primary through transient verification errors, pauses and the old display deadline`,()=>{
   clock.now=started+95000;const html=render(purpose,{...base,paused:true,error:'Temporary verification error',errorCode:'UNAVAILABLE'});
   expect(html).toContain('Waiting for authorization…');expect(html).toContain('Approve the payment request on your phone.');expect(html).toContain('data-payment-progress="authorization"');expect(html).toContain('data-payment-connection');expect(html).toContain('Total payable');expect(html).toContain('Check payment');expect(html).not.toContain('Payment not confirmed yet');expect(html).not.toContain('Payment not completed');expect(html).not.toContain('Try again');expect(html).not.toContain('<ol');expect(html).not.toContain('Confirm code');expect(html).not.toContain('0912345678');
  });
  it(`${purpose} keeps a security mismatch ahead of authorization`,()=>{const html=render(purpose,{...base,order:{...order,verificationState:'MISMATCH'}});expect(html).toContain('Payment needs review');expect(html).not.toContain('Waiting for authorization');expect(html).not.toContain('Try again')});
  it(`${purpose} presents an actual safe terminal reason without claiming that nothing was charged`,()=>{const html=render(purpose,{...base,order:{...order,status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED',verificationUnavailable:false,providerReasonCode:'INSUFFICIENT_FUNDS'}});expect(html).toContain('Payment not completed');expect(html).toContain('insufficient funds');expect(html).toContain('Try again');expect(html).toContain('Close');expect(html).toContain('Total payable');expect(html).not.toContain('Nothing was charged');expect(html).not.toContain('<ol')});
 }
 it('does not call verified provider success a credited deposit until the wallet commit exists',()=>{const pending=render('TOP_UP',{...base,order:{...order,status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED'}});expect(pending).toContain('Confirming your payment');expect(pending).toContain('confirming your wallet credit');expect(pending).not.toContain('Wallet credited');expect(pending).not.toContain('>Paid</dt>');const credited=render('TOP_UP',{...base,order:{...order,status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'}});expect(credited).toContain('Wallet credited');expect(credited).toContain('>Paid</dt>');expect(credited).toContain('>Done</button>');expect(credited).not.toContain('Top up again')});
 it('only mounts the code field for an actual provider-requested OTP',()=>{const ussd=render('TOP_UP');expect(ussd).not.toContain('one-time-code');const otp=render('TOP_UP',{...base,order:{...order,authType:'OTP',verificationState:'VERIFIED'}});expect(otp).toContain('autoComplete="one-time-code"');expect(otp).toContain('Never enter your wallet PIN here');expect(otp).toContain('Confirm code');expect(otp).not.toContain('name="pin"')});
 it('uses the same compact surface and localized summary for deposits',()=>{const html=render('TOP_UP',base,true);expect(html).toContain('data-wallet-payment-progress="authorization"');expect(html).toContain('የዋሌት ገቢ');expect(html).toContain('የክፍያ ፈቃድን');expect(html).toContain('data-payment-progress');expect(html).not.toContain('data-bid-payment-progress');expect(html).not.toContain('Connect');expect(html).not.toContain('<ol')});
 it('retains the established hosted-payment recovery path',()=>{expect(render('TOP_UP',{...base,order:{...order,chargeType:'HOSTED'}})).toContain('data-hosted-recovery')});
 it.each(['BID','TOP_UP'] as const)('%s v1 Inline uses the shared processing view and never offers an invented OTP challenge or SDK retry',purpose=>{
  const html=render(purpose,{...base,error:'SDK response could not be checked',paused:true,order:{...order,apiVersion:'v1',chargeType:'INLINE',authType:'OTP',providerStatus:null}});
  expect(html).toContain('Processing payment…');expect(html).toContain('Check your phone for a payment request');expect(html).toContain('data-payment-connection');expect(html).toContain('Total payable');expect(html).not.toContain('data-hosted-recovery');expect(html).not.toContain('Confirm code');expect(html).not.toContain('one-time-code');expect(html).not.toContain('Retry original request');expect(html).not.toContain('Try again');
 });
 it('checks the original owned v1 key after a lost preparation response without offering to launch the SDK again',()=>{
  const html=render('TOP_UP',{...base,order:null,error:'Interrupted initialization',started:true,directAttempt:{apiVersion:'v1',flow:'INLINE',key:'owned-key',purpose:'TOP_UP',amount:'35.00',paymentMethod:'telebirr',phone:'0912345678'}});
  expect(html).toContain('Check payment');expect(html).toContain('Close');expect(html).not.toContain('Retry original request');expect(html).not.toContain('Try again');
 });
 it('v1 hosted uses the shared status view with the owned original URL recovery actions',()=>{
  const html=render('TOP_UP',{...base,order:{...order,apiVersion:'v1',chargeType:'HOSTED',status:'PENDING',providerStatus:null,checkoutUrl:'https://checkout.chapa.co/test-owned'}});
  expect(html).toContain('Processing payment…');expect(html).toContain('Open payment page');expect(html).toContain('Check payment status');expect(html).not.toContain('data-hosted-recovery');expect(html).not.toContain('Start new checkout');
  const injected=render('TOP_UP',{...base,order:{...order,apiVersion:'v1',chargeType:'HOSTED',status:'PENDING',providerStatus:null,checkoutUrl:'https://evil.test/pay'}});expect(injected).not.toContain('Open payment page');
 });
 it('only exposes Change payment for a safe terminal outcome and preserves the shared success requirement',()=>{
  const failed={...order,apiVersion:'v1' as const,chargeType:'INLINE' as const,paymentMethod:'ebirr',status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerReasonCode:'PAYMENT_CANCELLED'};
  const html=renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(PaymentProgress,{payment:{...base,order:failed},summary:{auctionTitle:'Owned auction',numbers:['4.25'],total:'35.00',provider:'ebirr',phone:'0912345678'},onRetry:()=>{},onChangePayment:()=>{},onClose:()=>{}})}));
  expect(html).toContain('Payment cancelled');expect(html).toContain('Change payment');expect(html).toContain('Try again');expect(html).toContain('Close');expect(html).toContain('/payments/ebirr.svg');expect(html).not.toContain('Nothing was charged');
  const pending=render('TOP_UP',{...base,order:{...failed,purpose:'TOP_UP',status:'PENDING',providerStatus:'SUCCESS'}});expect(pending).toContain('confirming your wallet credit');expect(pending).not.toContain('Wallet credited');
 });
});
