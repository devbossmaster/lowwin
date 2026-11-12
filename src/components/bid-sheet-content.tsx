'use client';
import dynamic from 'next/dynamic';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {ChevronDown,Clock3,Plus,Ticket,X} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import type {getOwnBidState} from '@/modules/auctions/bids';
import type {WalletBalance} from '@/modules/wallet/balance';
import type {getBidDiscountQuote} from '@/modules/referrals/service';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {etbToCents,formatEtb} from '@/lib/money';
import {normalizeBidDraft,normalizePaymentPhone,previewBidFees,validateBidDraft,type BidBatchQuote,type BidBatchReceipt,type BidDraftError} from '@/lib/bid-batch-client';
import {ChapaClientError,requestChapaJson,type ChapaCheckoutConfig,type WalletPaymentShortfall} from '@/lib/chapa-client';
import {usableBidDiscount} from '@/lib/bid-discount-preview';
import {paymentPhoneProblem} from '@/lib/payment-phone';
import {clearBidWalletRecovery,readBidWalletRecovery,retainBidWalletRecovery} from '@/lib/bid-wallet-recovery';
import {clearBidFundingDraft,readBidFundingDraft,retainBidFundingDraft} from '@/lib/bid-funding-draft';
import {readChapaOriginalAttempt,retainChapaOriginalAttempt} from '@/lib/chapa-original-attempt';
import {AccountSheetFooter} from './account-sheet';
import {CatalogImage} from './catalog-image';
import {AuctionCountdown} from './auction-countdown';
import {BidSheetPreview,isFullAuction,type BidSheetAuction} from './bid-sheet-preview';
import type {BidSheetPhase} from './bid-sheet';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {usePublicQuery} from './public-query';
import {useTelegram} from './telegram-provider';
import {confirmedBidQueryScopes,getMiniQueryClient,invalidatePrivateQueries,isPrivateQueryIdentity} from './private-query-cache';
import {useChapaPayment} from './chapa-payment';
import BidPaymentProgress from './bid-payment-progress';
import PaymentMethodForm from './payment-method-form';
import CbeBankGuide from './cbe-bank-guide';
import {usePaymentCheckoutFlow} from './payment-checkout-flow';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {publishWalletBidReceipt} from './wallet-bid-cache';
import {auctionDetailUrl} from './auction-query';
import styles from './bid-payment-sheet.module.css';
import ui from './batch-checkout.module.css';
import simple from './simple-bid-checkout.module.css';
const providers=[
 {slug:'telebirr',name:'telebirr',image:'/icons/payments/telebirr.jpg'},
 {slug:'cbebirr',name:'CBE Birr',image:'/icons/payments/cbebirr.svg'},
 {slug:'mpesa',name:'M-Pesa',image:'/icons/payments/mpesa.png'},
 {slug:'ebirr',name:'eBirr',image:'/payments/ebirr.svg'},
 {slug:'cbe-bank',name:'CBE Bank',image:'/icons/payments/cbe.png'},
] as const;
const WalletTopUp=dynamic(()=>import('./wallet-top-up'),{ssr:false});
type Method='wallet'|typeof providers[number]['slug'];
export type BidCheckoutDraft={numbers:string[];method?:string|null;phone?:string|null};
type BidState=Omit<Awaited<ReturnType<typeof getOwnBidState>>,'wallet'|'previousMax'>&{referralDiscountsAvailable?:boolean;couponAvailableCount?:number|null};
type DiscountQuote=Awaited<ReturnType<typeof getBidDiscountQuote>>;
type Props={auction:BidSheetAuction;serverNow:string;onClose:()=>void;onPhaseChange:(phase:BidSheetPhase)=>void;initialChapaId?:string;initialDraft?:BidCheckoutDraft;onDismissChange?:(handler:(()=>void)|null)=>void};

export default function BidSheetContents({auction,serverNow,onClose,onPhaseChange,initialChapaId,initialDraft,onDismissChange}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity,refreshMe,openRegistration}=useTelegram(),initialFull=isFullAuction(auction)?auction:undefined;
 const detail=usePublicQuery<CatalogAuction>(auctionDetailUrl(auction.slug),{initialData:initialFull});
 const full=(detail.data?.slug===auction.slug?detail.data:undefined)??initialFull,known=full??auction;
 const description=full?(am?full.product.descriptionAm||full.product.description:full.product.description):'';
 const own=usePrivateQuery<BidState>(`/api/auctions/${auction.slug}/bids`);
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000});
 const payment=useChapaPayment('bid:'+auction.slug,initialChapaId,{retainOriginal:true}),state=own.data,terms=state?.terms??known.terms;
 const walletRecovery=queryIdentity?readBidWalletRecovery(getMiniQueryClient(),queryIdentity,auction.slug):null;
 const fundingDraft=queryIdentity?readBidFundingDraft(getMiniQueryClient(),queryIdentity,auction.slug):null;
 const original=queryIdentity?readChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,'bid:'+auction.slug):null;
 const directDraft=payment.directAttempt?.purpose==='BID'?payment.directAttempt:null,originalQuote=original?.intent.purpose==='BID'&&original.bidQuote?.auctionSlug===auction.slug?original.bidQuote:null;
 const restoredMethod=initialDraft?.method??directDraft?.paymentMethod??fundingDraft?.method,restoredPhone=initialDraft?.phone??directDraft?.phone??fundingDraft?.phone??'';
 const flow=usePaymentCheckoutFlow(),step=flow.step;
 const [input,setInput]=useState(''),[numbers,setNumbers]=useState<string[]>(initialDraft?.numbers??walletRecovery?.lines.map(line=>line.number)??originalQuote?.lines.map(line=>line.number)??(directDraft&&'numbers'in directDraft?directDraft.numbers:fundingDraft?.numbers??[])),[editing,setEditing]=useState<number|null>(null);
 const [method,setMethod]=useState<Method|null>(walletRecovery?'wallet':restoredMethod&&['wallet','telebirr','mpesa','cbebirr','ebirr','cbe-bank'].includes(restoredMethod)?restoredMethod as Method:null),[phone,setPhone]=useState(normalizePaymentPhone(restoredPhone)?.slice(3)??'');
 const [quote,setQuote]=useState<BidBatchQuote|null>(walletRecovery??originalQuote),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [receipt,setReceipt]=useState<BidBatchReceipt|null>(null),[applyCoupon,setApplyCoupon]=useState(fundingDraft?.applyCoupon??false),[walletRetry,setWalletRetry]=useState(!!walletRecovery),[quoteBusy,setQuoteBusy]=useState(false),[quoteRetry,setQuoteRetry]=useState(0);
 const [toppingUp,setToppingUp]=useState(false),[fundingNotice,setFundingNotice]=useState(''),[walletFailure,setWalletFailure]=useState<WalletPaymentShortfall|null>(null),fundingRetained=useRef(!!fundingDraft),fundingOpen=useRef(false);fundingOpen.current=toppingUp;
 const id=useId(),lock=useRef(false),phoneEdited=useRef(!!normalizePaymentPhone(restoredPhone)),generation=useRef(0),controllers=useRef(new Set<AbortController>());
 const quoteAttempt=useRef<{fingerprint:string;key:string;quote?:BidBatchQuote;paymentKey:string}|null>(walletRecovery?{fingerprint:'',key:walletRecovery.id,paymentKey:walletRecovery.id,quote:walletRecovery}:null);
 const authenticated=!!queryIdentity,active=known.status==='live'&&(!state||state.open),current=isSubmissionFeeOnly(terms.ruleVersion);
 const methods=usePrivateQuery<ChapaCheckoutConfig>('/api/payments/chapa/inline/config',{enabled:authenticated&&active&&!payment.started,freshnessMs:60000});
 const enabledMethods=methods.data?.enabled?[...methods.data.methods,...(methods.data.cbeBankEnabled?[{slug:'cbe-bank',name:'CBE Bank'}]:[])]:[];
 const discount=usePrivateQuery<DiscountQuote>(`/api/auctions/${auction.slug}/discount-quote?feeVersion=${terms.version}`,{enabled:authenticated&&!!state?.referralDiscountsAvailable&&applyCoupon});
 const coupon=applyCoupon?usableBidDiscount(discount.data,terms.version,terms.entryFeePoints,discount.updatedAt):null;
 const bounds=state?.terms??full?.terms,rules=bounds?{...bounds,remainingSubmissions:state?.remainingSubmissions??bounds.maxDistinctBids,ownBids:state?.ownBids??[]}:null;
 const values=editing===null?[...numbers,...(input?[input]:[])]:numbers.map((value,index)=>index===editing?input:value);
 const recoveryQuote=walletRetry?quoteAttempt.current?.quote:null;
 const draft=recoveryQuote?{numbers:recoveryQuote.lines.map(line=>line.number),error:null}:rules?validateBidDraft(values,rules):{numbers:values.map(normalizeBidDraft).filter((value):value is string=>value!==null),error:null};
 const couponCount=state?.couponAvailableCount??null;
 const body={auctionSlug:auction.slug,numbers:draft.numbers,feeVersion:terms.version,...(coupon?.coupon?.id?{couponId:coupon.coupon.id}:{})};
 const fingerprint=JSON.stringify(body),priced=recoveryQuote??(quoteAttempt.current?.fingerprint===fingerprint?quote:null);
 const selectedNumbers=draft.error?(rules?validateBidDraft(numbers,rules).numbers:numbers):draft.numbers;
 const preview=previewBidFees(selectedNumbers.length,terms.entryFeePoints,coupon?.discountPoints??'0');
 const total=priced?.total??preview.total,totalCents=etbToCents(total),zero=totalCents===0n;
 const external=method!==null&&method!=='wallet';
 const phoneProblem=paymentPhoneProblem(phone,method??''),normalizedPhone=phoneProblem?null:normalizePaymentPhone(phone),frozen=busy||walletRetry;
 const methodAvailable=(slug:string)=>{
  const item=enabledMethods.find(item=>item.slug===slug);
  const amount=draft.numbers.length?totalCents:etbToCents(terms.entryFeePoints);
  return !!item&&(!item.minAmountCents||amount>=BigInt(item.minAmountCents))&&(!item.maxAmountCents||amount<=BigInt(item.maxAmountCents));
 };
 const walletAvailable=walletFailure?.available??wallet.data?.available??null;
 const insufficient=!zero&&(walletAvailable===null||etbToCents(walletAvailable)<totalCents);
 const enabled=method!==null&&(zero||(method==='wallet'?!!wallet.data?.bidsEnabled:!!methods.data?.enabled&&methodAvailable(method)));
 const walletEnabled=!!wallet.data?.bidsEnabled||zero&&selectedNumbers.length>0;
 const copy:Record<BidDraftError,[string,string]>={precision:['Enter a number with at most two decimals.','እስከ ሁለት አስርዮሽ ያለው ቁጥር ያስገቡ።'],range:['Choose an amount within the displayed range and step.','በሚታየው ክልል እና ልዩነት ውስጥ መጠን ይምረጡ።'],duplicate:['This amount is already selected or submitted.','ይህ መጠን ተመርጧል ወይም ቀድሞ ቀርቧል።'],consecutive:['Only 3 consecutive amounts. Skip at least one step.','ከሦስት በላይ ተከታታይ ቁጥሮች አይፈቀዱም።'],limit:['You have reached the remaining submission limit.','የቀሩትን የጨረታ ገደብ ደርሰዋል።']};
 useEffect(()=>{const version=++generation.current;return()=>{if(generation.current===version)generation.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear()}},[queryIdentity]);
 useEffect(()=>{if(!toppingUp)onPhaseChange(receipt?'receipt':busy||walletRetry||payment.started?'payment':step==='entry'?'entry':step==='review'?'review':'checkout')},[toppingUp,receipt,busy,walletRetry,payment.started,step,onPhaseChange]);
 useEffect(()=>{setWalletFailure(null)},[wallet.updatedAt,fingerprint]);
 useEffect(()=>{if(fundingRetained.current&&queryIdentity&&!receipt&&!payment.started)retainBidFundingDraft(getMiniQueryClient(),queryIdentity,auction.slug,{numbers:draft.error?numbers:draft.numbers,method:method??'wallet',phone,applyCoupon})},[queryIdentity,auction.slug,fingerprint,numbers,method,phone,applyCoupon,receipt,payment.started]);
 useEffect(()=>{if(queryIdentity&&payment.order?.purpose==='BID'&&payment.order.status==='BID_ACCEPTED'&&payment.order.receipt){clearBidFundingDraft(getMiniQueryClient(),queryIdentity,auction.slug);fundingRetained.current=false}},[queryIdentity,auction.slug,payment.order?.purpose,payment.order?.status,payment.order?.receipt]);
 useEffect(()=>{if(!phoneEdited.current){const registered=normalizePaymentPhone(methods.data?.phone??'');if(registered)setPhone(registered.slice(3))}},[methods.data?.phone]);
 // Review creates only an immutable server quote. Providers and the wallet are
 // contacted solely by the final Pay action below; moving between steps keeps readers mounted.
 useEffect(()=>{
  if(step==='entry'||busy||!queryIdentity||!state||!active||!current||draft.error||!draft.numbers.length||payment.started)return;
  if(quoteAttempt.current?.fingerprint===fingerprint&&quoteAttempt.current.quote)return;
  const attempt=quoteAttempt.current?.fingerprint===fingerprint?quoteAttempt.current:{fingerprint,key:crypto.randomUUID(),paymentKey:crypto.randomUUID(),quote:undefined as BidBatchQuote|undefined};quoteAttempt.current=attempt;
  const version=generation.current,controller=new AbortController();controllers.current.add(controller);let mounted=true;setQuoteBusy(true);setQuote(null);setError('');
  void requestChapaJson<BidBatchQuote>('/api/payments/chapa/batches/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(fingerprint),key:attempt.key})},controller.signal).then(next=>{
   if(!mounted||version!==generation.current||!isPrivateQueryIdentity(queryIdentity)||quoteAttempt.current!==attempt)return;
   attempt.quote=next;setQuote(next);
   if(etbToCents(next.total)!==etbToCents(preview.total))setError(text('The total changed. Review the amount before paying.','ጠቅላላ ክፍያው ተቀይሯል። ከመክፈልዎ በፊት መጠኑን ይመልከቱ።'));
  }).catch(cause=>{if(mounted&&version===generation.current)setError(cause instanceof ChapaClientError?cause.message:text('Could not confirm the total. Please retry.','ጠቅላላ ክፍያውን ማረጋገጥ አልተቻለም። እንደገና ይሞክሩ።'))}).finally(()=>{controllers.current.delete(controller);if(mounted)setQuoteBusy(false)});
  return()=>{mounted=false;controller.abort();controllers.current.delete(controller);setQuoteBusy(false)};
 },[step,busy,fingerprint,queryIdentity,!!state,active,current,payment.started,quoteRetry]);
 // These codes are definitive pre-creation rejections, not uncertain charges.
 // The hook preserves all transport/server ambiguities on their original key.
 useEffect(()=>{
  if(payment.started||!['TERMS_CHANGED','COUPON_UNAVAILABLE'].includes(payment.errorCode??''))return;
  setQuote(null);quoteAttempt.current=null;own.reload();if(applyCoupon)discount.reload();
 },[payment.errorCode,payment.started,own.reload,discount.reload,applyCoupon]);
 const add=()=>{if(frozen)return;if(draft.error){setError(text(...copy[draft.error]));return}if(!input)return;setNumbers(draft.numbers);setInput('');setEditing(null);setError('')};
 const continueToPayment=()=>{if(frozen)return;if(!queryIdentity){openRegistration();return}if(draft.error||!draft.numbers.length){setError(draft.error?text(...copy[draft.error]):text('Add at least one bid amount.','ቢያንስ አንድ የጨረታ መጠን ያስገቡ።'));return}setNumbers(draft.numbers);setInput('');setEditing(null);setError('');flow.continueToPayment(draft.numbers.length>1)};
 const editBids=()=>{flow.editDraft();setError('');requestAnimationFrame(()=>document.getElementById(id)?.focus())};
 const reviewChangedQuote=(changedQuote:BidBatchQuote)=>{
  if(!quoteAttempt.current)return;
  quoteAttempt.current.quote=changedQuote;setQuote(changedQuote);setNumbers(changedQuote.lines.map(line=>line.number));setInput('');setEditing(null);
  setError(text('The total was updated. Check the amount below, then tap Pay to confirm.','ጠቅላላ ክፍያው ተቀይሯል። ከታች ያለውን መጠን ይመልከቱና ለማረጋገጥ ይክፈሉ።'));
 };
 const retryOriginalDirect=async()=>{
  if(!payment.directAttempt)return;
  const version=generation.current,changedQuote=await payment.createDirect(payment.directAttempt);
  if(generation.current===version&&isPrivateQueryIdentity(queryIdentity)&&changedQuote)reviewChangedQuote(changedQuote);
 };

 // Only final Pay submits the reviewed immutable quote to the existing wallet
 // or direct-charge integration. Its original keys survive ambiguous replies.
 const pay=async()=>{
  if(lock.current)return;
  if(!queryIdentity){openRegistration();return}
  if(!recoveryQuote){
   if(draft.error||!draft.numbers.length){setError(draft.error?text(...copy[draft.error]):text('Add at least one bid amount.','ቢያንስ አንድ የጨረታ መጠን ያስገቡ።'));return}
   if(!state||!priced||quoteBusy||!['payment','guide'].includes(step)||method===null||!enabled||!active||!current||!zero&&(method==='wallet'?insufficient||!!wallet.error:!normalizedPhone))return;
   if(quoteAttempt.current?.fingerprint!==fingerprint)quoteAttempt.current={fingerprint,key:crypto.randomUUID(),paymentKey:crypto.randomUUID()};
  }
  if(!quoteAttempt.current)return;
  const attempt=quoteAttempt.current,version=generation.current,controller=new AbortController();controllers.current.add(controller);
  if(!recoveryQuote)payment.beginTiming(true);lock.current=true;setBusy(true);setError('');let walletSubmitted=false;
  try{
   // Quote is immutable and server-priced; only explicit Pay persists the
   // owned v2 Inline intent or commits the existing internal-wallet command.
   const confirmedQuote=attempt.quote??await requestChapaJson<BidBatchQuote>('/api/payments/chapa/batches/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,key:attempt.key})},controller.signal);
   if(generation.current!==version||!isPrivateQueryIdentity(queryIdentity))return;
   attempt.quote=confirmedQuote;setQuote(confirmedQuote);
   if(!recoveryQuote&&etbToCents(confirmedQuote.total)!==totalCents){setError(text('The total was updated. Check the amount below, then tap Pay to confirm.','ጠቅላላ ክፍያው ተቀይሯል። ከታች ያለውን መጠን ይመልከቱና ለማረጋገጥ ይክፈሉ።'));return}
   setNumbers(confirmedQuote.lines.map(line=>line.number));setInput('');setEditing(null);
   if(recoveryQuote||zero||method==='wallet'){
    walletSubmitted=true;
    retainBidWalletRecovery(getMiniQueryClient(),queryIdentity,confirmedQuote);
    const accepted=await requestChapaJson<BidBatchReceipt>(`/api/payments/chapa/batches/${confirmedQuote.id}/wallet`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteHash:confirmedQuote.quoteHash})},controller.signal);
    if(generation.current===version&&isPrivateQueryIdentity(queryIdentity)){clearBidWalletRecovery(getMiniQueryClient(),queryIdentity,confirmedQuote);clearBidFundingDraft(getMiniQueryClient(),queryIdentity,auction.slug);fundingRetained.current=false;setReceipt(accepted);setWalletRetry(false);publishWalletBidReceipt(queryIdentity,accepted,known);void refreshMe().catch(()=>{})}
   }else{
    const intent={key:attempt.paymentKey,purpose:'BID' as const,batchId:confirmedQuote.id,quoteHash:confirmedQuote.quoteHash,paymentMethod:method!,phone:normalizedPhone!,apiVersion:'v2' as const,kind:'inline' as const,flow:method==='cbe-bank'?'HOSTED' as const:'INLINE' as const};
    retainChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,'bid:'+auction.slug,intent,undefined,confirmedQuote);
    await payment.createInline(intent);
   }
  }catch(cause){
   if(generation.current===version){
    const rejected=cause instanceof ChapaClientError&&cause.status>=400&&cause.status<500;
    if(walletSubmitted&&rejected&&attempt.quote)clearBidWalletRecovery(getMiniQueryClient(),queryIdentity!,attempt.quote);
    if(walletSubmitted&&!rejected)setWalletRetry(true);
    if(cause instanceof ChapaClientError&&cause.wallet){setWalletFailure(cause.wallet);setError('')}else setError(cause instanceof ChapaClientError?cause.message:text(walletSubmitted?'Connection interrupted. Retry this same payment to confirm the result.':'Could not prepare your bids. Please retry.','ግንኙነቱ ተቋርጧል። ይህንኑ ጥያቄ እንደገና ይሞክሩ።'));
    if(cause instanceof ChapaClientError&&['QUOTE_CHANGED','STALE_QUOTE','COUPON_UNAVAILABLE','RETRYABLE_CONFLICT','TERMS_CHANGED'].includes(cause.code)){setQuote(null);quoteAttempt.current=null;setWalletRetry(false)}
    own.reload();wallet.reload();discount.reload();
   }
  }finally{controllers.current.delete(controller);if(generation.current===version){lock.current=false;setBusy(false)}}
 };
 const startNewBidPayment=async(changePayment=false)=>{
  if(!payment.canStartAgain||!bidPaymentCanRetry(payment.order))return;
  const reconciled=await payment.check();if(!reconciled||!bidPaymentCanRetry(reconciled))return;
  const previous=quote??payment.order?.batch;
  const selection=previous?.lines.map(line=>line.number)??(payment.order?.bidNumber?[payment.order.bidNumber]:draft.numbers);
  payment.startAgain();setQuote(null);quoteAttempt.current=null;setWalletRetry(false);
  setNumbers(selection);setInput('');setEditing(null);setError('');flow.openPayment();own.reload();if(applyCoupon)discount.reload();
  if(changePayment)return;
  const version=generation.current,key=crypto.randomUUID(),paymentKey=crypto.randomUUID();setBusy(true);
  try{
   const nextBody={...body,numbers:selection,key};
   const refreshed=await requestChapaJson<BidBatchQuote>('/api/payments/chapa/batches/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(nextBody)});
   if(version!==generation.current||!isPrivateQueryIdentity(queryIdentity))return;
   const nextFingerprint=JSON.stringify({...body,numbers:selection});quoteAttempt.current={fingerprint:nextFingerprint,key,paymentKey,quote:refreshed};setQuote(refreshed);
   if(etbToCents(refreshed.total)!==etbToCents(reconciled.amount)||!method||method==='wallet'||etbToCents(refreshed.total)===0n){
    flow.continueToPayment(true);setError(text('Review the updated total before paying.','ከመክፈልዎ በፊት የዘመነውን ጠቅላላ ክፍያ ይመልከቱ።'));return;
   }
   if(!normalizedPhone){flow.openPayment();return}
   const intent={key:paymentKey,purpose:'BID' as const,batchId:refreshed.id,quoteHash:refreshed.quoteHash,paymentMethod:method,phone:normalizedPhone,apiVersion:'v2' as const,kind:'inline' as const,flow:method==='cbe-bank'?'HOSTED' as const:'INLINE' as const};
   retainChapaOriginalAttempt(getMiniQueryClient(),queryIdentity!, 'bid:'+auction.slug,intent,undefined,refreshed);await payment.createInline(intent);
  }catch(cause){if(version===generation.current){flow.continueToPayment(true);setError(cause instanceof ChapaClientError?cause.message:text('Review your bids before trying again.','እንደገና ከመሞከርዎ በፊት ጨረታዎችዎን ይመልከቱ።'))}}
  finally{if(version===generation.current)setBusy(false)}
 };
 const backInCheckout=step==='guide'?flow.openPayment:step==='payment'&&numbers.length>1?()=>flow.continueToPayment(true):flow.editDraft;
 const returnFromTopUp=useCallback(()=>{setToppingUp(false);flow.openPayment()},[flow.openPayment]);
 const topUpProgress=useCallback((active:boolean)=>{if(fundingOpen.current)onPhaseChange(active?'payment':'topup')},[onPhaseChange]);
 const topUpBack=useCallback((handler:(()=>void)|null)=>{if(fundingOpen.current)onDismissChange?.(handler??returnFromTopUp)},[onDismissChange,returnFromTopUp]);
 const topUpCredited=useCallback(()=>{setToppingUp(false);flow.openPayment();setQuote(null);quoteAttempt.current=null;setQuoteRetry(value=>value+1);setWalletFailure(null);setFundingNotice(text('Wallet topped up. Review your bids, then confirm payment from your wallet.','ዋሌትዎ ተሞልቷል። ጨረታዎችዎን ይመልከቱና ከዋሌት ለመክፈል ያረጋግጡ።'));own.reload();wallet.reload();if(applyCoupon)discount.reload()},[flow.openPayment,own.reload,wallet.reload,discount.reload,applyCoupon,language]);
 const openTopUp=()=>{if(!queryIdentity||busy||walletRetry||payment.started)return;fundingRetained.current=true;retainBidFundingDraft(getMiniQueryClient(),queryIdentity,auction.slug,{numbers:selectedNumbers,method:'wallet',phone,applyCoupon});setNumbers(selectedNumbers);setInput('');setEditing(null);setMethod('wallet');setToppingUp(true)};
 useEffect(()=>{if(toppingUp)return;onDismissChange?.(step!=='entry'&&!receipt&&!busy&&!walletRetry&&!payment.started?backInCheckout:null);return()=>onDismissChange?.(null)},[toppingUp,step,numbers.length,receipt,busy,walletRetry,payment.started,flow.editDraft,flow.openPayment,flow.continueToPayment,onDismissChange]);
 if(toppingUp)return <WalletTopUp embedded onClose={returnFromTopUp} onCredited={topUpCredited} onProgressChange={topUpProgress} onDismissChange={topUpBack}/>;
 if(receipt||busy||walletRetry||payment.started)return <BidPaymentProgress payment={payment} preparing={busy} walletRetry={walletRetry} receipt={receipt} error={error} summary={{auctionTitle:known.product.title,auctionTitleAm:known.product.titleAm,numbers:quote?.lines.map(line=>line.number)??selectedNumbers,total:quote?.total??(directDraft&&'approvedTotal'in directDraft?directDraft.approvedTotal:payment.started?null:total),provider:directDraft?.paymentMethod??(payment.started&&!quote?null:zero?'coupon':method),phone:directDraft?.phone??(external?phone:null)}} onRetry={()=>void startNewBidPayment()} onChangePayment={()=>void startNewBidPayment(true)} onRetryWallet={()=>void pay()} onRetryOriginal={()=>void retryOriginalDirect()} onClose={onClose}/>;

 if(step==='review')return <div className={simple.payment} data-bid-step="review">
  <div className={simple.reviewHeading}><h3>{text(`${selectedNumbers.length} bids selected`,`${selectedNumbers.length} ጨረታዎች ተመርጠዋል`)}</h3><button type="button" onClick={editBids}>{text('Edit amounts','መጠኖችን ያስተካክሉ')}</button></div>
  <p className={simple.reviewTitle}>{am?known.product.titleAm||known.product.title:known.product.title}</p>
  <div className={simple.reviewChips} data-review-bids>{selectedNumbers.map(number=><span key={number}>{number}</span>)}</div>
  <dl className={simple.reviewTotals}><div><dt>{text('Total bid fees','ጠቅላላ የጨረታ ክፍያ')}</dt><dd>{formatEtb(priced?.grossTotal??preview.grossTotal)}</dd></div>{(priced?.discountTotal??preview.discountTotal)!=='0.00'&&<div><dt>{text('Coupon discount','የኩፖን ቅናሽ')}</dt><dd>−{formatEtb(priced?.discountTotal??preview.discountTotal)}</dd></div>}<div><dt>{text('Available wallet','ያለ የዋሌት ቀሪ ሂሳብ')}</dt><dd>{wallet.data?formatEtb(wallet.data.available):'—'}</dd></div><div><dt>{text('Total required','ጠቅላላ ክፍያ')}</dt><dd>{formatEtb(total)}</dd></div></dl>
  {quoteBusy&&<p className={simple.selectionHint} role="status">{text('Confirming your total…','ጠቅላላ ክፍያውን በማረጋገጥ ላይ…')}</p>}
  {error&&<p className={styles.error} role="alert">{error}</p>}
  {!quoteBusy&&!priced&&<button type="button" className={styles.inlineRetry} onClick={()=>setQuoteRetry(value=>value+1)}>{text('Retry total','ጠቅላላ ክፍያውን ይድገሙ')}</button>}
  <AccountSheetFooter><button type="button" className={`${styles.payButton} ${simple.pay}`} disabled={!priced||quoteBusy||!!draft.error||!active} onClick={flow.openPayment}>{text('Pay securely','በደህና ይክፈሉ')}</button></AccountSheetFooter>
 </div>;
 if(step==='guide')return <CbeBankGuide total={total} video={methods.data?.cbeGuideUrl??null} onBack={flow.openPayment} disabled={!priced||quoteBusy||!active} onContinue={()=>{if(!normalizedPhone){flow.openPayment();setError(text('Enter your payment phone number first.','መጀመሪያ የክፍያ ስልክ ቁጥርዎን ያስገቡ።'));return}void pay()}}/>;

 if(step==='payment')return <div className={simple.payment} data-bid-entry data-bid-step="payment">
  {fundingNotice&&<p className={simple.selectionHint} role="status" data-bid-funding-notice>{fundingNotice}</p>}
  <PaymentMethodForm total={total} method={method} phone={phone} onMethodChange={value=>{setMethod(value as Method);setError('');if(value==='cbe-bank'&&!zero)flow.showGuide()}} onPhoneChange={value=>{phoneEdited.current=true;setPhone(value);setError('')}} methods={enabledMethods} wallet={walletEnabled?{available:zero?'0.00':walletAvailable,unavailable:!zero&&!!wallet.error}:undefined} onTopUp={openTopUp} busy={frozen} payDisabled={!bounds||!active||!current||!draft.numbers.length||!!draft.error||!priced||quoteBusy||!state||!enabled||!zero&&(method==='wallet'?insufficient||!!wallet.error:!normalizedPhone)||applyCoupon&&(!coupon||discount.fetching)} payLabel={text(zero?'Submit bids':`Pay ${formatEtb(total)} & bid`,zero?'ጨረታዎችን ያቅርቡ':`${formatEtb(total)} ይክፈሉና ይጫረቱ`)} onPay={()=>method==='cbe-bank'&&!zero?flow.showGuide():void pay()} onBack={backInCheckout} phoneRequired={!zero} methodsLoading={!methods.data&&!methods.error} methodsError={!!methods.error} onReloadMethods={methods.reload} error={error||payment.error||(draft.error?text(...copy[draft.error]):'')} summary={<>
   <div className={simple.reviewHeading}><div className={simple.reviewProduct}><div className={simple.reviewPhoto}><CatalogImage src={known.product.images[0]?.path} alt="" variant="thumbnail" sizes="48px"/></div><h3>{am?known.product.titleAm||known.product.title:known.product.title}</h3></div><button type="button" onClick={editBids}>{text('Edit bids','ጨረታዎችን ያስተካክሉ')}</button></div>
   <div className={simple.reviewNumbers}>{selectedNumbers.join(' · ')}</div>
   <dl className={simple.paymentSummary}><div><dt>{text('Bids selected','የተመረጡ ጨረታዎች')}</dt><dd>{selectedNumbers.length}</dd></div><div><dt>{text('Fee per bid','የአንድ ጨረታ ክፍያ')}</dt><dd>{formatEtb(priced?.lines[0]?.grossFee??terms.entryFeePoints)}</dd></div>{priced&&priced.discountTotal!=='0.00'&&<div><dt>{text('Coupon discount','የኩፖን ቅናሽ')}</dt><dd>−{formatEtb(priced.discountTotal)}</dd></div>}</dl>
   {quoteBusy?<p className={simple.selectionHint} role="status">{text('Confirming your total…','ጠቅላላ ክፍያውን በማረጋገጥ ላይ…')}</p>:!priced&&<button type="button" className={styles.inlineRetry} onClick={()=>setQuoteRetry(value=>value+1)}>{text('Retry total','ጠቅላላ ክፍያውን ደግመው ይመልከቱ')}</button>}
  </>}/>
  <p className={styles.hint}>{text('Only submission fees are charged. Fees are non-refundable.','የሚከፈለው የማስገቢያ ክፍያው ብቻ ነው። ክፍያዎች አይመለሱም።')}</p>
  {wallet.error&&<p className={styles.error} role="status">{text('Balance could not refresh.','ቀሪ ሂሳቡን ማደስ አልተቻለም።')} <button className={styles.inlineRetry} type="button" onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
 </div>;
 return <>
  <AccountSheetFooter><div className={simple.total} data-bid-total aria-live="polite"><span>{text(`${selectedNumbers.length} bid${selectedNumbers.length===1?'':'s'}`,`${selectedNumbers.length} ጨረታዎች`)}{(priced?.discountTotal??preview.discountTotal)!=='0.00'&&<small>{text('Coupon applied','ኩፖን ተተግብሯል')}</small>}</span><strong>{formatEtb(total)}</strong></div><button type="button" className={`${styles.payButton} ${simple.pay}`} data-bid-continue disabled={!bounds||!active||!current||frozen||!draft.numbers.length||!!draft.error||authenticated&&!state||applyCoupon&&(!coupon||discount.fetching)} onClick={continueToPayment}>{text('Continue to payment','ወደ ክፍያ ቀጥል')}</button></AccountSheetFooter>
  <div className={`${styles.bidEntry} ${simple.entry}`} data-bid-entry data-bid-step="entry">
   <BidSheetPreview auction={known} publicDetailsReady={!!full} detailsReady={!!full&&!!state} showStatus={false}/>
   {description&&<details className={simple.description}><summary><span>{description}</span><b>{text('Show more','ተጨማሪ ያሳዩ')}<ChevronDown size={13} aria-hidden="true"/></b></summary><p>{description}</p></details>}
   <div className={simple.auctionFacts}><span><strong>{formatEtb(terms.entryFeePoints)}</strong><small>{text('per bid','ለአንድ ጨረታ')}</small></span><span><Ticket size={14} aria-hidden="true"/><strong>{known.bidCount}</strong> {text('bids','ጨረታዎች')}</span><span><Clock3 size={14} aria-hidden="true"/><AuctionCountdown target={known.endsAt} serverNow={serverNow} label="Ends" showLabel={false} variant="inline" onElapsed={()=>{detail.reload();if(authenticated)own.reload()}}/></span></div>
   {active&&current?<>
    <div className={styles.inputHeading}><label className={styles.inputLabel} htmlFor={id}>{text('Your bid amount','የጨረታ መጠንዎ')}</label></div>
    <div className={ui.addRow}><div className={`${styles.amountInput} ${simple.amount}`}><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} disabled={frozen} value={input} placeholder={text('Enter your bid amount…','የጨረታ መጠንዎን ያስገቡ…')} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value)){setInput(event.target.value);setError('')}}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();add()}}} aria-invalid={!!input&&!!draft.error||undefined}/><span aria-hidden="true">ETB</span></div><button className={`${ui.add} ${simple.add}`} type="button" disabled={frozen||!input||!!draft.error} aria-label={text(editing===null?'Add bid amount':'Save bid amount',editing===null?'የጨረታ መጠን ጨምር':'የጨረታ መጠን ያስቀምጡ')} onClick={add}><Plus size={16} aria-hidden="true"/>{text(editing===null?'Add':'Save',editing===null?'ጨምር':'አስቀምጥ')}</button></div>
    <div className={styles.entryMeta}><p className={styles.range}>{text('From','ከ')} {bounds?.minPoints??'—'}{bounds?.maxPoints!==null?` – ${bounds?.maxPoints??'—'}`:''} · {text('Step','ልዩነት')} {bounds?.stepPoints??'—'}</p><span className={styles.remaining}>{Math.max(0,(rules?.remainingSubmissions??0)-selectedNumbers.length)} {text('left','ቀሪ')}</span></div>
    {!!numbers.length&&<><div className={simple.selectionHeading}><span>{text(`${numbers.length} selected`,`${numbers.length} ተመርጠዋል`)}</span><button type="button" disabled={frozen} onClick={()=>{setNumbers([]);setInput('');setEditing(null);setError('')}}>{text('Clear all','ሁሉንም አጽዳ')}</button></div><div className={`${ui.chips} ${simple.chips}`} aria-label={text('Selected bid amounts','የተመረጡ የጨረታ መጠኖች')}>{numbers.map((number,index)=><span key={number} className={ui.chip}><button disabled={frozen} type="button" aria-label={text(`Edit ${number}`,`${number} ያስተካክሉ`)} onClick={()=>{setEditing(index);setInput(number);setError('')}}>{number}</button><button disabled={frozen} type="button" aria-label={text(`Remove ${number}`,`${number} ያስወግዱ`)} onClick={()=>{setNumbers(values=>values.filter((_,i)=>i!==index));setEditing(null);setInput('');setError('')}}><X size={13}/></button></span>)}</div></>}
    <dl className={simple.draftSummary}><div><dt>{text('Bids selected','የተመረጡ ጨረታዎች')}</dt><dd>{selectedNumbers.length}</dd></div><div><dt>{text('Fee per bid','የአንድ ጨረታ ክፍያ')}</dt><dd>{formatEtb(terms.entryFeePoints)}</dd></div></dl>
    <div className={styles.earnedDiscount} data-active={applyCoupon} data-bid-coupons><Ticket size={18}/><strong>{text('Coupons','ኩፖኖች')} <span className={styles.couponCount}>{couponCount??'—'}</span></strong><button type="button" disabled={frozen||!applyCoupon&&(!state?.referralDiscountsAvailable||!couponCount)} onClick={()=>setApplyCoupon(value=>!value)}>{text(applyCoupon?'Remove':'Apply',applyCoupon?'አስወግድ':'ተግብር')}</button></div>
    {applyCoupon&&<p className={ui.draftNote}>{coupon?text(`${coupon.coupon!.percent}% off one bid fee.`,`${coupon.coupon!.percent}% ቅናሽ በአንድ ጨረታ ክፍያ።`):text(discount.fetching?'Checking coupon…':'No eligible coupon. Remove it or retry.',discount.fetching?'ኩፖን በመፈተሽ ላይ…':'ተስማሚ ኩፖን የለም። ያስወግዱ ወይም ይድገሙ።')}</p>}
   </>:<p className={ui.empty}>{text('This auction is not open for new bids.','ይህ ጨረታ ለአዲስ ጨረታዎች ክፍት አይደለም።')}</p>}
   <p className={styles.hint}>{text('Submission fees are non-refundable.','የማስገቢያ ክፍያዎች አይመለሱም።')}</p>
   {(error||payment.error||draft.error&&!!input)&&<p className={styles.error} role="alert">{error||payment.error||(draft.error?text(...copy[draft.error]):'')}</p>}
   {own.error&&authenticated&&<p className={styles.error}>{text('Your bid limits could not load.','የጨረታ ገደቦችዎ መጫን አልተቻለም።')} <button className={styles.inlineRetry} onClick={own.reload}>{text('Retry','እንደገና')}</button></p>}
   {detail.error&&<p className={styles.error}>{text('Product details could not refresh.','የዕቃውን ዝርዝር ማደስ አልተቻለም።')} <button className={styles.inlineRetry} onClick={detail.reload}>{text('Retry','እንደገና')}</button></p>}
  </div>
 </>;
}
