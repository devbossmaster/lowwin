import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';
import type {useChapaPayment} from '../src/components/chapa-payment';
const clock=vi.hoisted(()=>({now:Date.parse('2026-11-10T10:00:00Z')}));
vi.mock('../src/components/chapa-payment',()=>({useChapaPaymentClock:()=>clock.now,ChapaPaymentStatus:()=>createElement('div',{'data-hosted-recovery':true})}));
vi.mock('../src/components/account-sheet',()=>({AccountSheetFooter:({children}:{children:ReactNode})=>createElement('footer',null,children)}));
import PaymentProgress from '../src/components/payment-progress';
import BidPaymentProgress from '../src/components/bid-payment-progress';
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
  const preparing=wrap(createElement(BidPaymentProgress,{walletPayment:true,payment:walletPayment,summary,preparing:true,onClose:()=>{}}));
  expect(preparing).toContain('Paying from your wallet…');expect(preparing).toContain('data-wallet-bid-progress="paying"');expect(preparing).not.toContain('Internal wallet');expect(preparing).not.toContain('phone');expect(preparing).not.toContain('authorization');expect(preparing).not.toContain('one-time-code');expect(preparing).not.toContain('Chapa');
  const receipt={batch:{status:'ACCEPTED',total:'35.00',lines:[{number:'4.25'}]},receipts:[{bid:{id:'owned-bid'}}],payment:{method:'wallet',gateway:'INTERNAL_WALLET',total:'35.00',acceptedBidIds:['owned-bid']}} as unknown as import('../src/lib/bid-batch-client').BidBatchReceipt;
  const committed=wrap(createElement(BidPaymentProgress,{walletPayment:true,payment:walletPayment,summary,receipt,onClose:()=>{}}));
  expect(committed).toContain('Bid accepted');expect(committed).toContain('data-wallet-bid-progress="success"');expect(committed).toContain('Paid from wallet');expect(committed).toContain('ETB 35.00');expect(committed).not.toContain('Internal wallet');expect(committed).not.toContain('Chapa');
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
  it(`${purpose} displays a bound authorization error without pretending it is a terminal payment outcome`,()=>{
   const html=render(purpose,{...base,order:{...order,status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED',authorizationReasonCode:'INVALID_PIN'}});
   expect(html).toContain('Payment authorization stopped');expect(html).toContain('incorrect payment PIN');expect(html).toContain('data-payment-authorization-error="INVALID_PIN"');expect(html).toContain('data-payment-state="pending"');expect(html).toContain('lucide-triangle-alert');expect(html).toContain('Check payment');expect(html).toContain('Close');expect(html.match(/<button/g)).toHaveLength(2);
   expect(html).not.toContain('Try again');expect(html).not.toContain('Retry original');expect(html).not.toContain('lucide-loader-circle');expect(html).not.toContain('Waiting for authorization');expect(html).not.toContain('data-payment-connection');expect(html).not.toContain('Nothing was charged');
  });
 }
 it('does not call verified provider success a credited deposit until the wallet commit exists',()=>{const pending=render('TOP_UP',{...base,order:{...order,status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED'}});expect(pending).toContain('Confirming your payment');expect(pending).toContain('confirming your wallet credit');expect(pending).not.toContain('Wallet credited');expect(pending).not.toContain('>Paid</dt>');const credited=render('TOP_UP',{...base,order:{...order,status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'}});expect(credited).toContain('Wallet credited');expect(credited).toContain('>Paid</dt>');expect(credited).toContain('>Done</button>');expect(credited).not.toContain('Top up again')});
 it('shows bonus credit only after the verified wallet commit and preserves the separate principal',()=>{
  const quote={amount:'10.10',totalCredit:'111.11',policyVersion:2,validityDays:7,credited:false};
  const pending=render('TOP_UP',{...base,order:{...order,amount:'101.01',status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED',depositBonus:quote}});
  expect(pending).not.toContain('data-deposit-bonus-credited');expect(pending).not.toContain('111.11');
  const credited=render('TOP_UP',{...base,order:{...order,amount:'101.01',status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',depositBonus:{...quote,credited:true}}});
  expect(credited).toContain('Bidding bonus credited');expect(credited).toContain('ETB 10.10');expect(credited).toContain('ETB 101.01');expect(credited).toContain('ETB 111.11');
 });
 it('keeps Check primary and only offers explicit same-key recovery before authorization exists',()=>{
  const intent={key:'00000000-0000-4000-8000-000000000001',purpose:'TOP_UP' as const,amount:'35.00',paymentMethod:'telebirr',phone:'251911000000',apiVersion:'v2' as const,kind:'inline' as const,flow:'INLINE' as const};
  const unknown=render('TOP_UP',{...base,order:null,directAttempt:intent,error:'Interrupted',errorCode:'UNAVAILABLE'});
  expect(unknown).toContain('Check payment');expect(unknown).toContain('Retry original request');expect(unknown).toContain('Close');expect(unknown).not.toContain('Try again');
  const outstanding=render('TOP_UP',{...base,directAttempt:intent,error:'Interrupted',errorCode:'UNAVAILABLE',paused:true});
  expect(outstanding).toContain('Check payment');expect(outstanding).not.toContain('Retry original request');expect(outstanding).not.toContain('Try again');
 });
 it('only mounts the code field for an actual provider-requested OTP',()=>{const ussd=render('TOP_UP');expect(ussd).not.toContain('one-time-code');const otp=render('TOP_UP',{...base,order:{...order,authType:'OTP',verificationState:'VERIFIED'}});expect(otp).toContain('autoComplete="one-time-code"');expect(otp).toContain('Never enter your wallet PIN here');expect(otp).toContain('Confirm code');expect(otp).not.toContain('name="pin"')});
 it('retains the original provider OTP field when that code is rejected and hides stale authorization errors after verified success',()=>{
  const rejected=render('TOP_UP',{...base,order:{...order,authType:'OTP',authorizationReasonCode:'INVALID_OTP'}});
  expect(rejected).toContain('That code was not accepted');expect(rejected).toContain('autoComplete="one-time-code"');expect(rejected).toContain('Confirm code');expect(rejected).not.toContain('Try again');
  const confirming=render('TOP_UP',{...base,order:{...order,status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED',authorizationReasonCode:'INVALID_PIN'}});
  expect(confirming).toContain('Confirming your payment');expect(confirming).not.toContain('incorrect payment PIN');expect(confirming).not.toContain('Payment authorization stopped');
 });
 it('uses the same compact surface and localized summary for deposits',()=>{const html=render('TOP_UP',base,true);expect(html).toContain('data-wallet-payment-progress="authorization"');expect(html).toContain('የዋሌት ገቢ');expect(html).toContain('የክፍያ ፈቃድን');expect(html).toContain('data-payment-progress');expect(html).not.toContain('data-bid-payment-progress');expect(html).not.toContain('Connect');expect(html).not.toContain('<ol')});
 it('retains the established hosted-payment recovery path',()=>{expect(render('TOP_UP',{...base,order:{...order,chargeType:'HOSTED'}})).toContain('data-hosted-recovery')});
 it.each(['BID','TOP_UP'] as const)('%s retired payments show read-only history and no authorization or retry',purpose=>{
  const html=render(purpose,{...base,order:{...order,apiVersion:'legacy',unsupportedLegacy:true,chargeType:'INLINE',authType:'OTP',providerStatus:null}});
  expect(html).toContain('Historical payment');expect(html).toContain('read-only');expect(html).toContain('Transactions');expect(html).toContain('Close');expect(html).not.toContain('Confirm code');expect(html).not.toContain('one-time-code');expect(html).not.toContain('Try again');expect(html).not.toContain('Open payment page');
 });
 it('a retired cached command without an owned response cannot restart a charge',()=>{
  const html=render('TOP_UP',{...base,order:null,errorCode:'LEGACY_PAYMENT_UNSUPPORTED',error:'Historical payment',started:true,directAttempt:null});
  expect(html).toContain('Historical payment');expect(html).not.toContain('Retry original request');expect(html).not.toContain('Try again');
 });
 it('v2 hosted offers one status action while uncertain and never opens an injected host',()=>{
  const hosted={...order,apiVersion:'v2' as const,flowVersion:4,chargeType:'HOSTED' as const,status:'PENDING',providerStatus:null,checkoutUrl:'https://checkout.chapa.global/test-owned'};
  const html=render('TOP_UP',{...base,order:hosted});
  expect(html).not.toContain('Open payment page');expect(html).toContain('Check payment status');expect(html).toContain('>Close</button>');expect(html.match(/<button/g)).toHaveLength(2);expect(html).not.toContain('Start new checkout');
  const ready={...hosted,verificationState:'VERIFIED',verificationUnavailable:false,authorizationReference:null};
  expect(render('TOP_UP',{...base,order:ready})).toContain('Open payment page');
  const injected=render('TOP_UP',{...base,order:{...ready,checkoutUrl:'https://evil.test/pay'}});expect(injected).not.toContain('Open payment page');
 });
 it('only exposes Try again and Close for a safe terminal outcome and preserves the shared success requirement',()=>{
  const failed={...order,apiVersion:'v2' as const,flowVersion:4,chargeType:'INLINE' as const,paymentMethod:'ebirr',status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerReasonCode:'PAYMENT_CANCELLED'};
  const html=renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(PaymentProgress,{payment:{...base,order:failed},summary:{auctionTitle:'Owned auction',numbers:['4.25'],total:'35.00',provider:'ebirr',phone:'0912345678'},onRetry:()=>{},onChangePayment:()=>{},onClose:()=>{}})}));
  expect(html).toContain('Payment cancelled');expect(html).not.toContain('Change payment');expect(html).toContain('Try again');expect(html).toContain('Close');expect(html.match(/<button/g)).toHaveLength(2);expect(html).toContain('/payments/ebirr.svg');expect(html).not.toContain('Nothing was charged');
  const pending=render('TOP_UP',{...base,order:{...failed,purpose:'TOP_UP',status:'PENDING',providerStatus:'SUCCESS'}});expect(pending).toContain('confirming your wallet credit');expect(pending).not.toContain('Wallet credited');
 });
});
