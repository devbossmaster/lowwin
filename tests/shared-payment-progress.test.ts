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
function expectSteadyAuthorization(html:string){
 expect(html).toContain('data-payment-view="authorization"');expect(html).toContain('data-payment-activity="true"');expect(html).toContain('lucide-loader-circle');
 for(const absent of ['data-payment-result-actions','data-payment-support-reference','data-payment-connection','Check payment','Retry original request','>Try again</button>'])expect(html).not.toContain(absent);
}
describe('shared bid and deposit status surface',()=>{
 it('uses the updated checkout title before a stale localized auction summary',()=>{
  const revised={...order,auctionTitle:'Soundcore R50i NC',auctionTitleAm:null};
  const html=renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'am',children:createElement(PaymentProgress,{
   payment:{...base,order:revised},
   summary:{auctionTitle:'TECNO Buds 3',auctionTitleAm:'TECNO የጆሮ ማዳመጫ',numbers:['4.25'],total:'35.00',provider:'telebirr',phone:null},
  })}));
  expect(html).toContain('Soundcore R50i NC');
  expect(html).not.toContain('TECNO');
 });
 it.each(['BID','TOP_UP'] as const)('%s keeps one pending heading and spinner across dispatch, authorization and private fulfillment',purpose=>{
  const stages=[{...base,order:null,busy:true},{...base,order:{...order,status:'SUBMITTING',providerStatus:null,authorizationReference:null} as ChapaCheckoutView},base,{...base,order:{...order,authType:'OTP'} as ChapaCheckoutView},{...base,order:{...order,status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED'} as ChapaCheckoutView}];
  for(const payment of stages){const html=render(purpose,payment);expect(html.match(/data-payment-panel="persistent"/g)).toHaveLength(1);expect(html.match(/Waiting for authorization…/g)).toHaveLength(1);expectSteadyAuthorization(html);expect(html).not.toContain('Confirming your payment');expect(html).not.toContain('Wallet credited');expect(html).not.toContain('bids accepted');expect(html).not.toContain('role="progressbar"')}
 });
 it('only offers editing after a definite pre-creation rejection, preserving ambiguous originals',()=>{
  const show=(started:boolean)=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(PaymentProgress,{payment:{...base,order:null,busy:false,started,error:'Payment details changed.',errorCode:'DEPOSIT_BONUS_CHANGED'},summary:{auctionTitle:'Owned auction',numbers:['4.25'],total:'35.00',provider:'telebirr',phone:null},onEditPayment:()=>{},onClose:()=>{}})}));
  const rejected=show(false);expect(rejected).toContain('data-payment-inline-error="true"');expect(rejected).toContain('data-payment-view="result"');expect(rejected).toContain('Payment could not start');expect(rejected.match(/<button/g)).toHaveLength(2);expect(rejected).toContain('>Try again</button>');expect(rejected).toContain('>Close</button>');expect(rejected).not.toContain('data-payment-activity');
  const ambiguous=show(true);expectSteadyAuthorization(ambiguous);expect(ambiguous).not.toContain('Review payment details');expect(ambiguous).not.toContain('Try again</button>');expect(ambiguous).not.toContain('<button');
 });
 it.each(['BID','TOP_UP'] as const)('%s suppresses terminal retry, stale reasons and OTP entry until a retained completion signal is reconciled',purpose=>{
  const pending={...order,status:'NEEDS_REVIEW',providerStatus:'FAILED',verificationState:'VERIFIED',completionSignalPending:true,providerReasonCode:'INVALID_PIN',initializationReasonCode:'INSUFFICIENT_FUNDS',authorizationReasonCode:'INVALID_OTP',authType:'OTP' as const,merchantReference:'LWretained-signal'};
  const html=render(purpose,{...base,order:pending});expect(html).toContain('data-payment-progress="confirming"');expect(html).toContain('Waiting for authorization…');expectSteadyAuthorization(html);expect(html).not.toContain('LWretained-signal');
  for(const absent of ['Try again','Retry original request','Confirm code','one-time-code','incorrect payment PIN','insufficient funds','Payment not completed'])expect(html).not.toContain(absent);
  expect(render(purpose,{...base,order:pending},true)).toContain('የክፍያ ፈቃድ በመጠባበቅ ላይ');
 });
 it.each(['BID','TOP_UP'] as const)('%s keeps cancellation attribution exact and generic failure free of guessed PIN reasons',purpose=>{
  const cancelled={...order,status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',verificationUnavailable:false};
  for(const am of [false,true]){
   const message=am?'እርስዎ ይህን ክፍያ ሰርዘዋል።':'You cancelled this payment.',user=render(purpose,{...base,order:{...cancelled,providerCancelledBy:'USER'}},am);
   expect(user.split(message)).toHaveLength(2);expect(user.match(/data-payment-reason="true"/g)).toHaveLength(1);expect(user).not.toContain('data-payment-inline-error');
   for(const providerCancelledBy of ['SYSTEM',null] as const)expect(render(purpose,{...base,order:{...cancelled,providerCancelledBy}},am)).not.toContain(message);
   const unverified=render(purpose,{...base,order:{...cancelled,providerCancelledBy:'USER',verificationState:'UNVERIFIED'}},am);expectSteadyAuthorization(unverified);expect(unverified).not.toContain(message);expect(unverified).not.toContain('data-payment-reason');
  }
  const failed=render(purpose,{...base,order:{...cancelled,status:'FAILED',providerStatus:'FAILED',providerReasonCode:'arbitrary bank text'}});
  expect(failed.split('Your provider could not complete this payment.')).toHaveLength(2);expect(failed).not.toContain('PIN');expect(failed).not.toContain('arbitrary bank text');
 });
 it.each(['BID','TOP_UP'] as const)('%s presents the exact verified provider reason once in either language without a second generic error',purpose=>{
  const reasons=[{code:'INVALID_PIN',en:'Chapa reports an incorrect payment PIN.',am:'Chapa የክፍያ PIN ትክክል እንዳልሆነ አሳውቋል።'},{code:'INSUFFICIENT_FUNDS',en:'Chapa reports insufficient funds in your selected provider account.',am:'Chapa በመረጡት የክፍያ አቅራቢ መለያ ውስጥ ያለው ገንዘብ እንደማይበቃ አሳውቋል።'}];
  for(const reason of reasons)for(const am of [false,true]){
   const html=render(purpose,{...base,order:{...order,status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED',providerReasonCode:reason.code}},am);
   expect(html.split(am?reason.am:reason.en)).toHaveLength(2);expect(html.match(/data-payment-reason="true"/g)).toHaveLength(1);expect(html).toContain('role="alert"');expect(html).toContain('data-payment-view="result"');expect(html).not.toContain('data-payment-inline-error');expect(html).not.toContain('Your provider could not complete this payment.');expect(html).not.toContain('የክፍያ አቅራቢዎ ይህን ክፍያ ማጠናቀቅ አልቻለም።');expect(html.match(/<button/g)).toHaveLength(2);
  }
 });
 it.each(['BID','TOP_UP'] as const)('%s shows the owned payment reference only on an unsuccessful result',purpose=>{
  const merchantReference='LWowned-support';
  const pending={...order,merchantReference};
  const failed={...pending,status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED',verificationUnavailable:false};
  const credited:ChapaCheckoutView={...pending,status:purpose==='TOP_UP'?'CREDITED':'BID_ACCEPTED',providerStatus:'SUCCESS',verificationState:'VERIFIED',receipt:purpose==='TOP_UP'?null:{
   bid:{id:'owned-bid',auctionCode:'5',auctionSlug:'owned-auction',amount:'4.25',acceptedAt:order.createdAt,termsVersion:1,feePoints:'35.00'},
   hold:{previousMax:'0.00',newMax:'0.00',extraReserved:'0.00'},
   charge:{feePoints:'35.00',newlyUnavailable:'35.00'},
   wallet:{available:'0.00',held:'0.00'},remainingSubmissions:99,ownBids:[],
  }};
  for(const [am,label] of [[false,'Payment reference'],[true,'የክፍያ መለያ']] as const){
   const html=render(purpose,{...base,order:failed},am);
   expect(html).toContain(`<dt>${label}</dt>`);
   expect(html).toContain(`<dd dir="ltr">${merchantReference}</dd>`);
   expect(html.match(/data-payment-support-reference="true"/g)).toHaveLength(1);
   expect(html).not.toContain('accepted-request');
   expect(render(purpose,{...base,order:pending},am)).not.toContain(merchantReference);
   const successful=render(purpose,{...base,order:credited},am);
   expect(successful).toContain('data-payment-progress="success"');
   expect(successful).not.toContain(merchantReference);
  }
 });
 it('keeps the original attempt and steady authorization through local expiry without exposing support diagnostics',()=>{
  clock.now=started+600000;
  const html=render('TOP_UP',{...base,order:{...order,merchantReference:'LWowned-support'},error:'private raw diagnostic'});
  expectSteadyAuthorization(html);expect(html).toContain('Approve the request on your phone when it appears.');expect(html).not.toContain('LWowned-support');expect(html).not.toContain('private raw diagnostic');expect(html).not.toContain('Payment expired');expect(html).not.toContain('<button');
  const am=render('TOP_UP',{...base,order:{...order,merchantReference:'LWowned-support'},error:'offline'},true);expectSteadyAuthorization(am);expect(am).toContain('የክፍያ ፈቃድ በመጠባበቅ ላይ…');expect(am).not.toContain('የእርዳታ መለያ');
 });
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
   expectSteadyAuthorization(html);expect(html).toContain('Waiting for authorization…');expect(html).toContain('Approve the request on your phone when it appears.');expect(html).toContain('data-payment-progress="authorization"');expect(html).toContain('Total payable');expect(html).not.toContain('Payment not confirmed yet');expect(html).not.toContain('Payment not completed');expect(html).not.toContain('Try again');expect(html).not.toContain('<button');expect(html).not.toContain('<ol');expect(html).not.toContain('Confirm code');expect(html).not.toContain('0912345678');
  });
  it(`${purpose} retains an unresolved security mismatch without presenting a result or another charge action`,()=>{const html=render(purpose,{...base,order:{...order,verificationState:'MISMATCH'}});expect(html).toContain('data-payment-progress="uncertain"');expect(html).toContain('data-payment-state="pending"');expectSteadyAuthorization(html);expect(html).not.toContain('Payment not completed');expect(html).not.toContain('<button')});
  it(`${purpose} presents an actual safe terminal reason without claiming that nothing was charged`,()=>{const html=render(purpose,{...base,order:{...order,status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED',verificationUnavailable:false,providerReasonCode:'INSUFFICIENT_FUNDS'}});expect(html).toContain('Payment not completed');expect(html).toContain('insufficient funds');expect(html).toContain('Try again');expect(html).toContain('Close');expect(html).toContain('Total payable');expect(html).not.toContain('Nothing was charged');expect(html).not.toContain('<ol')});
  it(`${purpose} keeps bound authorization feedback pending without a terminal result or extra action`,()=>{
   const html=render(purpose,{...base,order:{...order,status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED',authorizationReasonCode:'INVALID_PIN'}});
   expectSteadyAuthorization(html);expect(html).toContain('Waiting for authorization…');expect(html).toContain('data-payment-authorization-error="INVALID_PIN"');expect(html).toContain('data-payment-state="pending"');expect(html).not.toContain('data-payment-inline-error');expect(html).not.toContain('incorrect payment PIN');expect(html).not.toContain('<button');expect(html).not.toContain('Payment not completed');expect(html).not.toContain('Nothing was charged');
  });
 }
 it('does not call verified provider success a credited deposit until the wallet commit exists',()=>{const pending=render('TOP_UP',{...base,order:{...order,status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED'}});expect(pending).toContain('Waiting for authorization…');expect(pending).toContain('data-payment-panel="persistent"');expect(pending).not.toContain('Wallet credited');expect(pending).not.toContain('>Paid</dt>');const credited=render('TOP_UP',{...base,order:{...order,status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'}});expect(credited).toContain('Wallet credited');expect(credited).toContain('>Paid</dt>');expect(credited).toContain('>Close</button>');expect(credited).not.toContain('Top up again')});
 it('shows bonus credit only after the verified wallet commit and preserves the separate principal',()=>{
  const quote={amount:'10.10',totalCredit:'111.11',policyVersion:2,validityDays:7,credited:false};
  const pending=render('TOP_UP',{...base,order:{...order,amount:'101.01',status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED',depositBonus:quote}});
  expect(pending).not.toContain('data-deposit-bonus-credited');expect(pending).not.toContain('111.11');
  const credited=render('TOP_UP',{...base,order:{...order,amount:'101.01',status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',depositBonus:{...quote,credited:true}}});
  expect(credited).toContain('Bidding bonus credited');expect(credited).toContain('ETB 10.10');expect(credited).toContain('ETB 101.01');expect(credited).toContain('ETB 111.11');
 });
 it('retains uncertain originals before authorization without offering manual initialization or another charge',()=>{
  const intent={key:'00000000-0000-4000-8000-000000000001',purpose:'TOP_UP' as const,amount:'35.00',paymentMethod:'telebirr',phone:'251911000000',apiVersion:'v2' as const,kind:'inline' as const,flow:'INLINE' as const};
  const unknown=render('TOP_UP',{...base,order:null,directAttempt:intent,error:'Interrupted',errorCode:'UNAVAILABLE'});
  expectSteadyAuthorization(unknown);expect(unknown).not.toContain('<button');expect(unknown).not.toContain('Payment could not start');
  const outstanding=render('TOP_UP',{...base,directAttempt:intent,error:'Interrupted',errorCode:'UNAVAILABLE',paused:true});
  expectSteadyAuthorization(outstanding);expect(outstanding).not.toContain('<button');expect(outstanding).not.toContain('Payment could not start');
 });
 it('only mounts the code field for an actual provider-requested OTP',()=>{const ussd=render('TOP_UP');expect(ussd).not.toContain('one-time-code');const otp=render('TOP_UP',{...base,order:{...order,authType:'OTP',verificationState:'VERIFIED'}});expect(otp).toContain('autoComplete="one-time-code"');expect(otp).toContain('Never enter your wallet PIN here');expect(otp).toContain('Confirm code');expect(otp).not.toContain('name="pin"')});
 it('retains the original provider OTP field when that code is rejected and hides stale authorization errors after verified success',()=>{
  const rejected=render('TOP_UP',{...base,order:{...order,authType:'OTP',authorizationReasonCode:'INVALID_OTP'}});
  expect(rejected).toContain('That code was not accepted');expect(rejected).toContain('autoComplete="one-time-code"');expect(rejected).toContain('Confirm code');expect(rejected).not.toContain('Try again');
  const confirming=render('TOP_UP',{...base,order:{...order,status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED',authorizationReasonCode:'INVALID_PIN'}});
  expect(confirming).toContain('Waiting for authorization…');expect(confirming).not.toContain('incorrect payment PIN');expect(confirming).not.toContain('Payment authorization stopped');
 });
 it('uses the same compact surface and localized summary for deposits',()=>{const html=render('TOP_UP',base,true);expect(html).toContain('data-wallet-payment-progress="authorization"');expect(html).toContain('የዋሌት ገቢ');expect(html).toContain('የክፍያ ፈቃድ በመጠባበቅ ላይ');expect(html).toContain('data-payment-progress');expect(html).not.toContain('data-bid-payment-progress');expect(html).not.toContain('Connect');expect(html).not.toContain('<ol')});
 it('retains the established hosted-payment recovery path',()=>{expect(render('TOP_UP',{...base,order:{...order,chargeType:'HOSTED'}})).toContain('data-hosted-recovery')});
 it.each(['BID','TOP_UP'] as const)('%s enabled original-version recovery checks the owned attempt without offering old authorization or initialization',purpose=>{
  const legacy={...order,apiVersion:'legacy' as const,unsupportedLegacy:false,legacyRecoveryAvailable:true,chargeType:'INLINE' as const,authType:'OTP' as const,providerStatus:null};
  const html=render(purpose,{...base,order:legacy});
  expect(html).toContain('Checking your previous payment');expect(html).toContain('Check payment');expect(html).toContain('Close');
  expect(html).not.toContain('Confirm code');expect(html).not.toContain('one-time-code');expect(html).not.toContain('Try again');expect(html).not.toContain('Retry original request');expect(html).not.toContain('data-hosted-recovery');
  const failed=render(purpose,{...base,order:{...legacy,status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED'}});
  expect(failed).toContain('Try again');expect(failed).toContain('Close');expect(failed).not.toContain('Confirm code');expect(failed).not.toContain('Retry original request');
 });
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
  const pending=render('TOP_UP',{...base,order:{...failed,purpose:'TOP_UP',status:'PENDING',providerStatus:'SUCCESS'}});expect(pending).toContain('Waiting for authorization…');expect(pending).not.toContain('Wallet credited');
 });
});
