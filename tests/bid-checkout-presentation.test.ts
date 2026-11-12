import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';
import type {useChapaPayment} from '../src/components/chapa-payment';
import type {BidBatchReceipt} from '../src/lib/bid-batch-client';
vi.mock('../src/components/chapa-payment',()=>({useChapaPaymentClock:()=>Date.parse('2026-11-10T10:00:00Z'),ChapaPaymentStatus:()=>createElement('div',{'data-hosted-recovery':true})}));
vi.mock('../src/components/account-sheet',()=>({AccountSheetFooter:({children}:{children:ReactNode})=>createElement('footer',null,children)}));
import BidPaymentProgress from '../src/components/bid-payment-progress';
import {MiniLocaleProvider} from '../src/components/mini-locale';
const order={id:'owned-payment',purpose:'BID',chargeType:'DIRECT',status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED',authType:'USSD',authorizationReference:'accepted-request',createdAt:'2026-11-10T10:00:00Z',expiresAt:'2026-11-10T10:05:00Z',paymentMethod:'telebirr',amount:'20.00',fundsPreserved:false,receipt:null} as ChapaCheckoutView;
const base={order,busy:false,restoring:false,paused:false,error:'',started:true,canStartAgain:true,markPresented:()=>{}} as unknown as ReturnType<typeof useChapaPayment>;
const render=(payment=base,am=false)=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:am?'am':'en',children:createElement(BidPaymentProgress,{payment,summary:{auctionTitle:'Actual auction',numbers:['2.00','4.25'],total:'20.00',provider:'telebirr',phone:'0912345678'},onRetry:()=>{},onClose:()=>{}})}));
describe('compact bid payment presentation',()=>{
 it('keeps an unavailable restored total unknown instead of painting zero',()=>{const html=renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(BidPaymentProgress,{payment:{...base,order:null,restoring:true},summary:{auctionTitle:'Owned auction',numbers:[],total:null,provider:null,phone:null},onRetry:()=>{},onClose:()=>{}})}));expect(html).toContain('Total payable</dt><dd>—</dd>');expect(html).not.toContain('ETB 0.00');expect(html).not.toContain('>Coupon<')});
 it('uses one quiet status and activity line without a second approval action or stage rail',()=>{const html=render();expect(html).toContain('Waiting for authorization…');expect(html).toContain('data-direct-approval="phone"');expect(html).toContain('Total payable');expect(html).toContain('2 selected');expect(html).toContain('+251 ••• •• 5678');expect(html).not.toContain('<ol');expect(html).not.toContain('Confirm payment');expect(html).not.toContain('Confirm code');expect(html).not.toContain('<button');expect(html).not.toContain('0912345678');expect(html).not.toContain('%')});
 it('keeps received money in confirmation until accepted-bid receipt evidence arrives',()=>{const pending=render({...base,order:{...order,status:'PENDING',providerStatus:'SUCCESS'}});expect(pending).toContain('Confirming your payment');expect(pending).not.toContain('bids accepted');const accepted=render({...base,order:{...order,status:'BID_ACCEPTED',providerStatus:'SUCCESS',receipt:{bid:{id:'accepted'}} as ChapaCheckoutView['receipt']}});expect(accepted).toContain('2 bids accepted');expect(accepted).toContain('>Done</button>')});
 it('only requests an OTP after the provider explicitly requires it and localizes the result',()=>{const html=render({...base,order:{...order,authType:'OTP'}});expect(html).toContain('One-time code');expect(html).toContain('autoComplete="one-time-code"');expect(html).toContain('Confirm code');expect(render(base,true)).toContain('የክፍያ ፈቃድን በመጠባበቅ ላይ…')});
 it('preserves the established hosted recovery component',()=>{expect(render({...base,order:{...order,chargeType:'HOSTED'}})).toContain('data-hosted-recovery')});
 it('uses a verified provider reason once as the main error message with only retry and close',()=>{
  const failed={...base,order:{...order,status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED',providerReasonCode:'INVALID_PIN'}};
  const html=renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(BidPaymentProgress,{payment:failed,summary:{auctionTitle:'Actual auction',numbers:['2.00'],total:'20.00',provider:'telebirr',phone:'0912345678'},onRetry:()=>{},onChangePayment:()=>{},onClose:()=>{}})}));
  expect(html.match(/Chapa reports an incorrect payment PIN/g)).toHaveLength(1);expect(html).toContain('data-payment-reason="true"');expect(html).toContain('role="alert"');expect(html).not.toContain('Try again to review your bids');expect(html).not.toContain('Change payment');expect(html.match(/<button/g)).toHaveLength(2);expect(html).toContain('>Try again</button>');expect(html).toContain('>Close</button>');
 });
 it('keeps uncertain outcomes to one safe status check and close without a failure or extra navigation',()=>{
  const html=render({...base,order:{...order,status:'NEEDS_REVIEW',providerStatus:null,verificationState:'MISMATCH'},error:'Connection interrupted'});expect(html).toContain('Payment needs review');expect(html.match(/<button/g)).toHaveLength(2);expect(html).toContain('>Check payment</button>');expect(html).toContain('>Close</button>');expect(html).not.toContain('Transactions</a>');expect(html).not.toContain('Try again</button>');expect(html).not.toContain('Payment failed');
 });
});

describe('compact internal-wallet bid presentation',()=>{
 const summary={auctionTitle:'Owned auction',numbers:['2.00','4.25'],total:'20.00',provider:'wallet',phone:'0912345678'};
 const renderWallet=(extra:Partial<Parameters<typeof BidPaymentProgress>[0]>={},am=false)=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:am?'am':'en',children:createElement(BidPaymentProgress,{walletPayment:true,payment:{...base,order:null,started:false},summary,onRetryWallet:()=>{},onClose:()=>{},...extra})}));
 const receipt={batch:{status:'ACCEPTED',total:'20.00',lines:[{number:'2.00'},{number:'4.25'}]},receipts:[{bid:{id:'accepted-one'}},{bid:{id:'accepted-two'}}],wallet:{available:'5.00',held:'0.00'},payment:{method:'wallet',gateway:'INTERNAL_WALLET',total:'20.00',acceptedBidIds:['accepted-one','accepted-two']}} as BidBatchReceipt;
 it('uses a brief wallet state without external authorization, activity stages or detail rows',()=>{
  const html=renderWallet({preparing:true});
  expect(html).toContain('Paying from your wallet…');expect(html).toContain('data-wallet-bid-progress="paying"');
  for(const omitted of ['Total payable','Gateway','Auction</dt>','authorization','0912345678','data-direct-approval','bids accepted','Done</button>'])expect(html).not.toContain(omitted);
 });
 it('keeps an interrupted wallet request unresolved and only exposes original-operation recovery',()=>{
  const html=renderWallet({walletRetry:true});expect(html).toContain('data-wallet-bid-progress="uncertain"');expect(html).toContain('Retry original payment');expect(html).toContain('>Close</button>');expect(html).not.toContain('Payment failed');expect(html).not.toContain('Nothing was charged');expect(html).not.toContain('Paid from wallet');
 });
 it('shows accepted count, exact charged fee and committed balance only after an accepted receipt',()=>{
  const pending=renderWallet({payment:{...base,order:{...order,status:'PENDING',providerStatus:'SUCCESS'}}});expect(pending).not.toContain('bids accepted');
  const html=renderWallet({receipt});expect(html).toContain('2 bids accepted');expect(html).toContain('Paid from wallet');expect(html).toContain('ETB 20.00');expect(html).toContain('Available balance');expect(html).toContain('ETB 5.00');expect(html).toContain('>Done</button>');expect(html).not.toContain('Internal wallet');
 });
 it('does not invent an unavailable balance and supports the Amharic wallet state',()=>{
  const html=renderWallet({receipt:{...receipt,wallet:undefined}});expect(html).not.toContain('Available balance');expect(html).not.toContain('ETB 0.00');
  expect(renderWallet({preparing:true},true)).toContain('ከዋሌትዎ በመክፈል ላይ…');
 });
});
