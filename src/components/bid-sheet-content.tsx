'use client';
import dynamic from 'next/dynamic';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {ChevronDown,Clock3,Layers,LoaderCircle,Plus,Ticket,Wallet,X} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import type {getOwnBidState} from '@/modules/auctions/bids';
import type {WalletBalance} from '@/modules/wallet/balance';
import type {getBidDiscountQuote} from '@/modules/referrals/service';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import {normalizeBidDraft,normalizePaymentPhone,previewBidFees,validateBidDraft,type BidBatchQuote,type BidBatchReceipt,type BidDraftError} from '@/lib/bid-batch-client';
import {ChapaClientError,requestChapaJson,type ChapaCheckoutConfig,type WalletPaymentShortfall} from '@/lib/chapa-client';
import {usableBidDiscount} from '@/lib/bid-discount-preview';
import {paymentPhoneProblem,paymentPhoneProblemMessage} from '@/lib/payment-phone';
import {defaultBidRangeStep,previewBidRange,type BidRangeError} from '@/lib/bid-range';
import {clearBidWalletRecovery,readBidWalletRecovery,retainBidWalletRecovery} from '@/lib/bid-wallet-recovery';
import {clearWalletBidCommand,readWalletBidCommand,recoverWalletBidCommand,retainWalletBidCommand,submitWalletBidCommand,walletBidDefinitiveRejection,type WalletBidCommand,type WalletBidTarget} from '@/lib/wallet-bid-command';
import {clearBidFundingDraft,readBidFundingDraft,retainBidFundingDraft} from '@/lib/bid-funding-draft';
import {readChapaOriginalAttempt,retainChapaOriginalAttempt} from '@/lib/chapa-original-attempt';
import {readPaymentRetryDraft} from '@/lib/payment-retry-draft';
import {AccountSheetFooter} from './account-sheet';
import {AuctionCountdown} from './auction-countdown';
import {isFullAuction,type BidSheetAuction} from './bid-sheet-preview';
import type {BidSheetPhase} from './bid-sheet';
import {useMiniLocale} from './mini-locale';
import {useMiniNotice} from './mini-notice';
import {usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import {confirmedBidQueryScopes,getMiniQueryClient,invalidatePrivateQueries,isPrivateQueryIdentity,loadPrivateJson,readPrivateQuery} from './private-query-cache';
import {TOP_UP_CONFIG_URL,topUpConfigFreshness} from './top-up-prefetch';
import {useChapaPayment} from './chapa-payment';
import BidPaymentProgress from './bid-payment-progress';
import {usePaymentCheckoutFlow} from './payment-checkout-flow';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {publishWalletBidReceipt} from './wallet-bid-cache';
import {auctionDetailUrl} from './auction-query';
import styles from './bid-payment-sheet.module.css';
import reference from './reference-bid-checkout.module.css';
import {ReferencePaymentMethods,referencePaymentProviders as providers} from './reference-payment-methods';
import {BidCouponControl} from './bid-coupon-control';
const WalletTopUp=dynamic(()=>import('./wallet-top-up'),{ssr:false});
type Method='wallet'|typeof providers[number]['slug']|'ebirr'|'cbe-bank';
export type BidCheckoutDraft={numbers:string[];method?:string|null;phone?:string|null};
type BidState=Omit<Awaited<ReturnType<typeof getOwnBidState>>,'wallet'|'previousMax'>&{referralDiscountsAvailable?:boolean;couponAvailableCount?:number|null};
type DiscountQuote=Awaited<ReturnType<typeof getBidDiscountQuote>>;
type Props={auction:BidSheetAuction;serverNow:string;onClose:()=>void;onPhaseChange:(phase:BidSheetPhase)=>void;initialChapaId?:string;initialDraft?:BidCheckoutDraft;onDismissChange?:(handler:(()=>void)|null)=>void};

export default function BidSheetContents({auction,serverNow,onClose,onPhaseChange,initialChapaId,initialDraft,onDismissChange}:Props){
 const notice=useMiniNotice();
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {status,me,queryIdentity,refreshMe,openRegistration}=useTelegram(),initialFull=isFullAuction(auction)?auction:undefined;
 const detail=usePrivateQuery<CatalogAuction>(auctionDetailUrl(auction.slug),{initialData:initialFull});
 const full=(detail.data?.slug===auction.slug?detail.data:undefined)??initialFull,known=full??auction;
 const description=full?(am?full.product.descriptionAm||full.product.description:full.product.description):'';
 const own=usePrivateQuery<BidState>(`/api/auctions/${auction.slug}/bids`);
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000});
 const payment=useChapaPayment('bid:'+auction.slug,initialChapaId,{retainOriginal:true}),state=own.data,terms=state?.terms??known.terms;
 const walletRecovery=queryIdentity?readBidWalletRecovery(getMiniQueryClient(),queryIdentity,auction.slug):null;
 const savedWalletCommand=queryIdentity?readWalletBidCommand(getMiniQueryClient(),queryIdentity,auction.slug):null;
 const fundingDraft=queryIdentity?readBidFundingDraft(getMiniQueryClient(),queryIdentity,auction.slug):null;
 const original=queryIdentity?readChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,'bid:'+auction.slug):null;
 const directDraft=payment.directAttempt?.purpose==='BID'?payment.directAttempt:null,originalQuote=original?.intent.purpose==='BID'&&original.bidQuote?.auctionSlug===auction.slug?original.bidQuote:null;
 const restoredMethod=initialDraft?.method??fundingDraft?.method,restoredPhone=initialDraft?.phone??fundingDraft?.phone??'';
 const flow=usePaymentCheckoutFlow(),step=flow.step;
 const restoredReview=useRef(false);
 useEffect(()=>{if(!restoredReview.current&&initialDraft?.numbers.length){restoredReview.current=true;flow.openPayment()}},[initialDraft,flow.openPayment]);
 const [input,setInput]=useState(''),[numbers,setNumbers]=useState<string[]>(initialDraft?.numbers??fundingDraft?.numbers??[]),[editing,setEditing]=useState<number|null>(null);
 const [multiple,setMultiple]=useState((initialDraft?.numbers??fundingDraft?.numbers??[]).length>1),[numberMode,setNumberMode]=useState<'individual'|'range'>('individual'),[rangeFrom,setRangeFrom]=useState(''),[rangeTo,setRangeTo]=useState(''),[rangeStep,setRangeStep]=useState<string|null>(null);
 const [method,setMethod]=useState<Method|null>(restoredMethod&&['wallet','telebirr','mpesa','cbebirr'].includes(restoredMethod)?restoredMethod as Method:null),[phone,setPhone]=useState(normalizePaymentPhone(restoredPhone)?.slice(3)??'');
 const [quote,setQuote]=useState<BidBatchQuote|null>(initialChapaId?walletRecovery??originalQuote:null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [receipt,setReceipt]=useState<BidBatchReceipt|null>(null),[applyCoupon,setApplyCoupon]=useState(fundingDraft?.applyCoupon??false),[walletRetry,setWalletRetry]=useState(!!walletRecovery||!!savedWalletCommand),[quoteBusy,setQuoteBusy]=useState(false),[quoteRetry,setQuoteRetry]=useState(0);
 const [walletCommand,setWalletCommand]=useState<WalletBidCommand|null>(savedWalletCommand),[walletObserving,setWalletObserving]=useState(false),[showProgress,setShowProgress]=useState(!!initialChapaId),showProgressRef=useRef(showProgress);showProgressRef.current=showProgress;
 const initialWalletRecovery=useRef<WalletBidTarget|null>(savedWalletCommand?{command:savedWalletCommand}:walletRecovery?{quote:walletRecovery}:null);
 const [toppingUp,setToppingUp]=useState(false),[fundingNotice,setFundingNotice]=useState(''),[walletFailure,setWalletFailure]=useState<WalletPaymentShortfall|null>(null),fundingRetained=useRef(!!fundingDraft),fundingOpen=useRef(false);fundingOpen.current=toppingUp;
 const id=useId(),lock=useRef(false),phoneEdited=useRef(!!normalizePaymentPhone(restoredPhone)),generation=useRef(0),controllers=useRef(new Set<AbortController>());
 const quoteAttempt=useRef<{fingerprint:string;key:string;quote?:BidBatchQuote;paymentKey:string}|null>(walletRecovery?{fingerprint:'',key:walletRecovery.id,paymentKey:walletRecovery.id,quote:walletRecovery}:null);
 const reportError=useCallback((message:string)=>{setError(message);if(message)notice(message,'error',{id:`bid-validation:${id}`,duration:6000})},[notice,id]);
 useEffect(()=>{if(!payment.started&&payment.error)notice(payment.error,'error',{id:`bid-validation:${id}`,duration:6000})},[payment.started,payment.error,notice,id]);
 // Dismissing the complete checkout clears its editable draft, never an unknown payment.
 useEffect(()=>()=>{if(queryIdentity)clearBidFundingDraft(getMiniQueryClient(),queryIdentity,auction.slug)},[queryIdentity,auction.slug]);
 const authenticated=status==='authenticated'&&!!me?.user?.id&&!!queryIdentity,active=known.status==='live'&&(!state||state.open),current=isSubmissionFeeOnly(terms.ruleVersion);
 const savedSettings=queryIdentity?readPrivateQuery<ChapaCheckoutConfig>(queryIdentity,TOP_UP_CONFIG_URL,{freshnessMs:60000})?.value:null;
 const methods=usePrivateQuery<ChapaCheckoutConfig>(TOP_UP_CONFIG_URL,{enabled:authenticated&&active,freshnessMs:topUpConfigFreshness(savedSettings)});
 const enabledMethods=methods.data?.enabled?methods.data.methods.filter(item=>providers.some(provider=>provider.slug===item.slug)):[];
 const discount=usePrivateQuery<DiscountQuote>(`/api/auctions/${auction.slug}/discount-quote?feeVersion=${terms.version}`,{enabled:authenticated&&!!state?.referralDiscountsAvailable&&applyCoupon});
 const coupon=applyCoupon?usableBidDiscount(discount.data,terms.version,terms.entryFeePoints,discount.updatedAt):null;
 const bounds=state?.terms??full?.terms,rules=bounds?{...bounds,remainingSubmissions:state?.remainingSubmissions??bounds.maxDistinctBids,ownBids:state?.ownBids??[]}:null;
 const selectedRangeStep=rangeStep??defaultBidRangeStep(bounds?.stepPoints??'0.01'),rangeDraft=rules?previewBidRange(rangeFrom,rangeTo,selectedRangeStep,numbers,rules):null;
 const values=!multiple?(input?[input]:numbers.slice(0,1)):editing===null?[...numbers,...(input?[input]:[])]:numbers.map((value,index)=>index===editing?input:value);
 const recoveryQuote=walletRetry&&showProgress?quoteAttempt.current?.quote:null;
 const draft=recoveryQuote?{numbers:recoveryQuote.lines.map(line=>line.number),error:null}:rules?validateBidDraft(values,rules):{numbers:values.map(normalizeBidDraft).filter((value):value is string=>value!==null),error:null};
 const body={auctionSlug:auction.slug,numbers:draft.numbers,feeVersion:terms.version,...(coupon?.coupon?.id?{couponId:coupon.coupon.id}:{})};
 const fingerprint=JSON.stringify(body),priced=recoveryQuote??(quoteAttempt.current?.fingerprint===fingerprint?quote:null);
 const selectedNumbers=draft.error?(rules?validateBidDraft(numbers,rules).numbers:numbers):draft.numbers;
 const preview=previewBidFees(selectedNumbers.length,terms.entryFeePoints,coupon?.discountPoints??'0');
 const total=priced?.total??preview.total,totalCents=etbToCents(total),zero=totalCents===0n;
 const external=method!==null&&method!=='wallet';
 const phoneProblem=paymentPhoneProblem(phone,method??''),normalizedPhone=phoneProblem?null:normalizePaymentPhone(phone),frozen=busy;
 const methodAvailable=(slug:string)=>{
  const item=enabledMethods.find(item=>item.slug===slug);
  const amount=draft.numbers.length?totalCents:etbToCents(terms.entryFeePoints);
  return !!item&&(!item.minAmountCents||amount>=BigInt(item.minAmountCents))&&(!item.maxAmountCents||amount<=BigInt(item.maxAmountCents));
 };
 const walletAvailable=walletFailure?.available??(current&&!known.isDemo?wallet.data?.available:wallet.data?.cashAvailable??wallet.data?.available)??null;
 const insufficient=!zero&&(walletAvailable===null||etbToCents(walletAvailable)<totalCents);
 const enabled=method!==null&&(method==='wallet'||providers.some(provider=>provider.slug===method))&&(zero||(method==='wallet'?!!wallet.data?.bidsEnabled:!!methods.data?.enabled&&methodAvailable(method)));
 const walletEnabled=!!wallet.data?.bidsEnabled||zero&&selectedNumbers.length>0;
 const copy:Record<BidDraftError,[string,string]>={precision:['Enter a number with at most two decimals.','እስከ ሁለት አስርዮሽ ያለው ቁጥር ያስገቡ።'],range:['Choose an amount within the displayed range and step.','በሚታየው ክልል እና ልዩነት ውስጥ መጠን ይምረጡ።'],duplicate:['This amount is already selected or submitted.','ይህ መጠን ተመርጧል ወይም ቀድሞ ቀርቧል።'],consecutive:['Only 3 consecutive amounts. Skip at least one step.','ከሦስት በላይ ተከታታይ ቁጥሮች አይፈቀዱም።'],limit:['You have reached the remaining submission limit.','የቀሩትን የጨረታ ገደብ ደርሰዋል።']};
 const rangeError=(problem:BidRangeError)=>problem==='step'?text(`Use a positive step that is a multiple of ${bounds?.stepPoints??'0.01'}.`,`ከዜሮ በላይ የሆነና የ ${bounds?.stepPoints??'0.01'} ብዜት የሆነ ልዩነት ያስገቡ።`):problem==='alignment'?text('The range must end exactly on your chosen step.','የክልሉ መጨረሻ ከተመረጠው ልዩነት ጋር መጣጣም አለበት።'):text(...copy[problem]);
 useEffect(()=>{const version=++generation.current;return()=>{if(generation.current===version)generation.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear()}},[queryIdentity]);
 useEffect(()=>{if(!toppingUp)onPhaseChange(showProgress&&receipt?'receipt':showProgress&&(busy||walletRetry||payment.started)?'payment':step==='payment'?'checkout':'entry')},[toppingUp,showProgress,receipt,busy,walletRetry,payment.started,step,onPhaseChange]);
 useEffect(()=>{setWalletFailure(null)},[wallet.updatedAt,fingerprint]);
 useEffect(()=>{if(fundingRetained.current&&queryIdentity&&!receipt&&!payment.started)retainBidFundingDraft(getMiniQueryClient(),queryIdentity,auction.slug,{numbers:draft.error?numbers:draft.numbers,method:method??'wallet',phone,applyCoupon})},[queryIdentity,auction.slug,fingerprint,numbers,method,phone,applyCoupon,receipt,payment.started]);
 useEffect(()=>{if(queryIdentity&&payment.order?.purpose==='BID'&&payment.order.status==='BID_ACCEPTED'&&payment.order.receipt){clearBidFundingDraft(getMiniQueryClient(),queryIdentity,auction.slug);fundingRetained.current=false}},[queryIdentity,auction.slug,payment.order?.purpose,payment.order?.status,payment.order?.receipt]);
 useEffect(()=>{if(!phoneEdited.current){const registered=normalizePaymentPhone(methods.data?.phone??'');if(registered)setPhone(registered.slice(3))}},[methods.data?.phone]);
 // Review creates only an immutable server quote. Providers and the wallet are
 // contacted solely by the final Pay action below; moving between steps keeps readers mounted.
 useEffect(()=>{
  if(step==='entry'||method===null||method==='wallet'||zero||busy||!queryIdentity||!state||!active||!current||draft.error||!draft.numbers.length||payment.started)return;
  if(quoteAttempt.current?.fingerprint===fingerprint&&quoteAttempt.current.quote)return;
  const attempt=quoteAttempt.current?.fingerprint===fingerprint?quoteAttempt.current:{fingerprint,key:crypto.randomUUID(),paymentKey:crypto.randomUUID(),quote:undefined as BidBatchQuote|undefined};quoteAttempt.current=attempt;
  const version=generation.current,controller=new AbortController();controllers.current.add(controller);let mounted=true;setQuoteBusy(true);setQuote(null);reportError('');
  void requestChapaJson<BidBatchQuote>('/api/payments/chapa/batches/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(fingerprint),key:attempt.key})},controller.signal).then(next=>{
   if(!mounted||version!==generation.current||!isPrivateQueryIdentity(queryIdentity)||quoteAttempt.current!==attempt)return;
   attempt.quote=next;setQuote(next);
   if(etbToCents(next.total)!==etbToCents(preview.total))reportError(text('The total changed. Review the amount before paying.','ጠቅላላ ክፍያው ተቀይሯል። ከመክፈልዎ በፊት መጠኑን ይመልከቱ።'));
  }).catch(cause=>{if(mounted&&version===generation.current)reportError(cause instanceof ChapaClientError?cause.message:text('Could not confirm the total. Please retry.','ጠቅላላ ክፍያውን ማረጋገጥ አልተቻለም። እንደገና ይሞክሩ።'))}).finally(()=>{controllers.current.delete(controller);if(mounted)setQuoteBusy(false)});
  return()=>{mounted=false;controller.abort();controllers.current.delete(controller);setQuoteBusy(false)};
 },[step,method,zero,busy,fingerprint,queryIdentity,!!state,active,current,payment.started,quoteRetry]);
 // These codes are definitive pre-creation rejections, not uncertain charges.
 // The hook preserves all transport/server ambiguities on their original key.
 useEffect(()=>{
  if(payment.started||!['TERMS_CHANGED','COUPON_UNAVAILABLE'].includes(payment.errorCode??''))return;
  setQuote(null);quoteAttempt.current=null;own.reload();if(applyCoupon)discount.reload();
 },[payment.errorCode,payment.started,own.reload,discount.reload,applyCoupon]);
 const add=()=>{if(frozen)return;if(draft.error){reportError(text(...copy[draft.error]));return}if(!input)return;setNumbers(draft.numbers);setInput('');setEditing(null);reportError('')};
 const addRange=()=>{
  if(frozen)return;if(!rangeDraft?.complete){reportError(text('Enter both ends of the bid range.','የጨረታ ክልሉን መጀመሪያና መጨረሻ ያስገቡ።'));return}
  if(rangeDraft.error){reportError(rangeError(rangeDraft.error));return}
  setNumbers(rangeDraft.numbers);setInput('');setEditing(null);setRangeFrom('');setRangeTo('');reportError('');
 };
 const reviewChangedQuote=(changedQuote:BidBatchQuote)=>{
  if(!quoteAttempt.current)return;
  quoteAttempt.current.quote=changedQuote;setQuote(changedQuote);setNumbers(changedQuote.lines.map(line=>line.number));setInput('');setEditing(null);
  reportError(text('The total was updated. Check the amount below, then tap Pay to confirm.','ጠቅላላ ክፍያው ተቀይሯል። ከታች ያለውን መጠን ይመልከቱና ለማረጋገጥ ይክፈሉ።'));
 };
 const retryOriginalDirect=async()=>{
  if(!payment.directAttempt)return;
  const version=generation.current,changedQuote=await payment.createDirect(payment.directAttempt);
  if(generation.current===version&&isPrivateQueryIdentity(queryIdentity)&&changedQuote)reviewChangedQuote(changedQuote);
 };

 const presentPayment=()=>{showProgressRef.current=true;setShowProgress(true)};
 const walletTarget:WalletBidTarget|null=walletCommand?{command:walletCommand}:walletRetry&&quoteAttempt.current?.quote?{quote:quoteAttempt.current.quote}:null;
 const walletObservation=useRef(false);
 const executeWallet=async(target:WalletBidTarget,{readOnly=false,background=false}:{readOnly?:boolean;background?:boolean}={})=>{
  if(!queryIdentity||walletObservation.current||lock.current)return;
  const version=generation.current,controller=new AbortController();controllers.current.add(controller);walletObservation.current=true;setWalletObserving(true);
  if(!background){lock.current=true;setBusy(true);reportError('');presentPayment()}
  try{
   const options={signal:controller.signal,isCurrent:()=>generation.current===version&&isPrivateQueryIdentity(queryIdentity)};
   const result=await (readOnly?recoverWalletBidCommand(target,options):submitWalletBidCommand(target,options));
   if(!options.isCurrent())return;
   if('command'in target)clearWalletBidCommand(getMiniQueryClient(),queryIdentity,target.command);
   if(result.kind==='quote'){
    const next=result.quote,command='command'in target?target.command:null;
    if(command)quoteAttempt.current={fingerprint:JSON.stringify({auctionSlug:command.auctionSlug,numbers:command.numbers,feeVersion:command.feeVersion,...(command.couponId?{couponId:command.couponId}:{})}),key:command.key,paymentKey:crypto.randomUUID(),quote:next};
    setQuote(next);setNumbers(next.lines.map(line=>line.number));setInput('');setEditing(null);setWalletRetry(false);setWalletCommand(null);showProgressRef.current=false;setShowProgress(false);
    reportError(text('The total was updated. Check the amount below, then tap Pay to confirm.','ጠቅላላ ክፍያው ተቀይሯል። ከታች ያለውን መጠን ይመልከቱና ለማረጋገጥ ይክፈሉ።'));return;
   }
   const accepted=result.receipt;clearBidWalletRecovery(getMiniQueryClient(),queryIdentity,accepted.batch);clearBidFundingDraft(getMiniQueryClient(),queryIdentity,auction.slug);fundingRetained.current=false;
   setQuote(accepted.batch);quoteAttempt.current=null;setReceipt(accepted);setWalletRetry(false);setWalletCommand(null);setWalletFailure(null);reportError('');publishWalletBidReceipt(queryIdentity,accepted,known);void refreshMe().catch(()=>{});
  }catch(cause){
   if(generation.current!==version||!isPrivateQueryIdentity(queryIdentity)||controller.signal.aborted)return;
   const rejected=!readOnly&&walletBidDefinitiveRejection(cause);
   if(rejected){
    if('command'in target)clearWalletBidCommand(getMiniQueryClient(),queryIdentity,target.command);else clearBidWalletRecovery(getMiniQueryClient(),queryIdentity,target.quote);
    setWalletCommand(null);setWalletRetry(false);showProgressRef.current=false;setShowProgress(false);
   }else setWalletRetry(true);
   if(cause instanceof ChapaClientError&&cause.wallet){
    const funds=cause.wallet;setWalletFailure(funds);
    reportError(text(`Your LowWin Wallet has ${funds.available} ETB. You need ${funds.required} ETB; top up ${funds.shortfall} ETB or choose another method.`,`በዋሌትዎ ${funds.available} ብር አለ። ${funds.required} ብር ያስፈልጋል። ${funds.shortfall} ብር ይሙሉ ወይም ሌላ መንገድ ይምረጡ።`));
   }else reportError(cause instanceof ChapaClientError?cause.message:text('The wallet payment is not confirmed yet. The original request is preserved.','የዋሌት ክፍያው ገና አልተረጋገጠም። የመጀመሪያው ጥያቄ ተጠብቋል።'));
   if(rejected){own.reload();wallet.reload();if(applyCoupon)discount.reload()}
  }finally{
   controllers.current.delete(controller);walletObservation.current=false;
   if(generation.current===version){lock.current=false;setBusy(false);setWalletObserving(false)}
  }
 };
 useEffect(()=>{
  let mounted=true;const target=initialWalletRecovery.current;
  if(target&&queryIdentity)queueMicrotask(()=>{if(mounted)void executeWallet(target,{readOnly:true,background:true})});
  return()=>{mounted=false};
 },[queryIdentity]);
 const viewPaymentStatus=()=>{
  presentPayment();
  if(walletTarget){if(walletObservation.current){setBusy(true);return}void executeWallet(walletTarget,{readOnly:true});return}
  if(payment.started)void payment.check();
 };

 // Final Pay is one internal command for wallet bids. Existing unresolved
 // operations are observed before another financial action is possible.
 const pay=async(retryOriginalWallet=false)=>{
  if(lock.current)return;
  if(!authenticated||!queryIdentity){openRegistration();return}
  if(walletTarget){presentPayment();if(walletObservation.current){setBusy(true);return}await executeWallet(walletTarget,{readOnly:!retryOriginalWallet});return}
  if(payment.started){viewPaymentStatus();return}
  if(multiple&&numberMode==='range'&&(rangeFrom||rangeTo)){reportError(rangeDraft?.error?rangeError(rangeDraft.error):text('Add the range before paying.','ከመክፈልዎ በፊት ክልሉን ይጨምሩ።'));return}
  if(draft.error||!draft.numbers.length){reportError(draft.error?text(...copy[draft.error]):text('Add at least one bid amount.','ቢያንስ አንድ የጨረታ መጠን ያስገቡ።'));return}
  if(!active||!current){reportError(text('This auction is not accepting bids.','ይህ ጨረታ አዲስ ጨረታ አይቀበልም።'));return}
  if(step==='entry'){
   const version=generation.current;lock.current=true;setBusy(true);reportError('');
   try{
    // Join the existing owned read if the customer continues before it arrives.
    // This validates the draft only; no wallet command or provider initialization.
    const currentState=state??await loadPrivateJson<BidState>(queryIdentity,`/api/auctions/${auction.slug}/bids`);
    if(version!==generation.current||!isPrivateQueryIdentity(queryIdentity))return;
    if(!currentState.open){reportError(text('This auction is not accepting bids.','ይህ ጨረታ አዲስ ጨረታ አይቀበልም።'));return}
    const checked=validateBidDraft(values,{...currentState.terms,remainingSubmissions:currentState.remainingSubmissions,ownBids:currentState.ownBids});
    if(checked.error){reportError(text(...copy[checked.error]));return}
    if(applyCoupon){
     const discountUrl=`/api/auctions/${auction.slug}/discount-quote?feeVersion=${currentState.terms.version}`;
     const offer=discount.data??await loadPrivateJson<DiscountQuote>(queryIdentity,discountUrl);
     if(version!==generation.current||!isPrivateQueryIdentity(queryIdentity))return;
     const receivedAt=readPrivateQuery<DiscountQuote>(queryIdentity,discountUrl)?.updatedAt??discount.updatedAt;
     if(!usableBidDiscount(offer,currentState.terms.version,currentState.terms.entryFeePoints,receivedAt)){reportError(text('This coupon is unavailable. Remove it or choose another.','ይህ ኩፖን አይገኝም። ያስወግዱት ወይም ሌላ ይምረጡ።'));return}
    }
    setNumbers(checked.numbers);setInput('');setEditing(null);flow.openPayment();
   }catch(cause){if(version===generation.current)reportError(cause instanceof ChapaClientError?cause.message:text('Could not load your bid details. Check your connection and try again.','የጨረታ ዝርዝሮችዎን መጫን አልቻልንም። ግንኙነትዎን ያረጋግጡና እንደገና ይሞክሩ።'))}
   finally{if(version===generation.current){lock.current=false;setBusy(false)}}
   return;
  }
  if(!state||quoteBusy)return;
  if(method===null){reportError(text('Choose a payment method.','የክፍያ መንገድ ይምረጡ።'));return}
  if(!enabled){reportError(text('This payment method is unavailable for this total. Choose another method.','ይህ የክፍያ መንገድ ለዚህ መጠን አይገኝም። ሌላ ይምረጡ።'));return}
  if(applyCoupon&&(!coupon||discount.fetching)){reportError(text(discount.fetching?'Your coupon is still loading. Please try again in a moment.':'This coupon is unavailable. Remove it or select another coupon.','ኩፖኑን ያረጋግጡ ወይም ያስወግዱት።'));return}
  if(!zero&&method==='wallet'&&walletAvailable===null){reportError(text('Your wallet balance could not be confirmed. Refresh it before paying.','ከመክፈልዎ በፊት የዋሌት ቀሪ ሂሳብዎን ያድሱ።'));wallet.reload();return}
  if(!zero&&method==='wallet'&&insufficient){reportError(text(`Your LowWin Wallet has ${walletAvailable} ETB. You need ${total} ETB; top up ${centsToEtb(totalCents-etbToCents(walletAvailable!))} ETB or choose another method.`,`በዋሌትዎ ${walletAvailable} ብር አለ። ${total} ብር ያስፈልጋል። ዋሌትዎን ይሙሉ ወይም ሌላ መንገድ ይምረጡ።`));return}
  if(!zero&&method!=='wallet'&&!normalizedPhone){reportError(paymentPhoneProblemMessage(phoneProblem??'invalid',am));return}
  if(quoteAttempt.current?.fingerprint!==fingerprint)quoteAttempt.current={fingerprint,key:crypto.randomUUID(),paymentKey:crypto.randomUUID()};
  const attempt=quoteAttempt.current;setReceipt(null);payment.beginTiming(true);
  if(zero||method==='wallet'){
   if(attempt.quote){retainBidWalletRecovery(getMiniQueryClient(),queryIdentity,attempt.quote);setWalletCommand(null);setWalletRetry(false);await executeWallet({quote:attempt.quote});return}
   const command:WalletBidCommand={...body,key:attempt.key,approvedTotal:total};
   retainWalletBidCommand(getMiniQueryClient(),queryIdentity,command);setWalletCommand(command);setWalletRetry(false);await executeWallet({command});return;
  }
  const version=generation.current,controller=new AbortController();controllers.current.add(controller);lock.current=true;setBusy(true);reportError('');presentPayment();
  try{
   const confirmedQuote=attempt.quote??await requestChapaJson<BidBatchQuote>('/api/payments/chapa/batches/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,key:attempt.key})},controller.signal);
   if(generation.current!==version||!isPrivateQueryIdentity(queryIdentity))return;
   attempt.quote=confirmedQuote;setQuote(confirmedQuote);
   if(etbToCents(confirmedQuote.total)!==totalCents){showProgressRef.current=false;setShowProgress(false);reportError(text('The total was updated. Check the amount below, then tap Pay to confirm.','ጠቅላላ ክፍያው ተቀይሯል። ከታች ያለውን መጠን ይመልከቱና ለማረጋገጥ ይክፈሉ።'));return}
   setNumbers(confirmedQuote.lines.map(line=>line.number));setInput('');setEditing(null);
   const intent={key:attempt.paymentKey,purpose:'BID' as const,batchId:confirmedQuote.id,quoteHash:confirmedQuote.quoteHash,paymentMethod:method,phone:normalizedPhone!,apiVersion:'v2' as const,kind:'inline' as const,flow:method==='cbe-bank'?'HOSTED' as const:'INLINE' as const};
   retainChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,'bid:'+auction.slug,intent,undefined,confirmedQuote);await payment.createInline(intent);
  }catch(cause){
   if(generation.current===version){showProgressRef.current=false;setShowProgress(false);reportError(cause instanceof ChapaClientError?cause.message:text('Could not prepare your bids. Please retry.','ጨረታዎችዎን ማዘጋጀት አልተቻለም። እንደገና ይሞክሩ።'));if(cause instanceof ChapaClientError&&['QUOTE_CHANGED','STALE_QUOTE','COUPON_UNAVAILABLE','RETRYABLE_CONFLICT','TERMS_CHANGED'].includes(cause.code)){setQuote(null);quoteAttempt.current=null}own.reload();wallet.reload();if(applyCoupon)discount.reload()}
  }finally{controllers.current.delete(controller);if(generation.current===version){lock.current=false;setBusy(false)}}
 };

 const startNewBidPayment=async()=>{
  if(!payment.canStartAgain||!bidPaymentCanRetry(payment.order)||busy)return;
  setBusy(true);
  try{
   const reconciled=await payment.check();if(!reconciled||!bidPaymentCanRetry(reconciled))return;
   const previous=quote??reconciled.batch,selection=previous?.lines.map(line=>line.number)??(reconciled.bidNumber?[reconciled.bidNumber]:draft.numbers);
   const saved=queryIdentity?readPaymentRetryDraft(getMiniQueryClient(),queryIdentity,reconciled.id):null;
   const nextMethod=reconciled.paymentMethod??saved?.paymentMethod??directDraft?.paymentMethod??method;
   const nextPhone=normalizePaymentPhone(saved?.phone??directDraft?.phone??phone);
   if(!payment.startAgain())return;
   setMethod(nextMethod&&providers.some(provider=>provider.slug===nextMethod)?nextMethod as Method:null);
   if(nextPhone){phoneEdited.current=true;setPhone(nextPhone.slice(3))}
   setMultiple(selection.length>1);
   setQuote(null);quoteAttempt.current=null;setWalletRetry(false);setWalletCommand(null);setReceipt(null);
   setNumbers(selection);setInput('');setEditing(null);reportError('');showProgressRef.current=false;setShowProgress(false);flow.openPayment();own.reload();if(applyCoupon)discount.reload();
  }catch{reportError(text('Could not check the original payment. Its status is preserved.','የመጀመሪያውን ክፍያ ማረጋገጥ አልተቻለም። ሁኔታው ተጠብቋል።'))}finally{setBusy(false)}
 };
 const backInCheckout=step==='payment'&&!showProgress?flow.editDraft:null;
 const returnFromTopUp=useCallback(()=>{setToppingUp(false);flow.openPayment()},[flow.openPayment]);
 const topUpProgress=useCallback((active:boolean)=>{if(fundingOpen.current)onPhaseChange(active?'payment':'topup')},[onPhaseChange]);
 const topUpBack=useCallback((handler:(()=>void)|null)=>{if(fundingOpen.current)onDismissChange?.(handler??returnFromTopUp)},[onDismissChange,returnFromTopUp]);
 const topUpCredited=useCallback(()=>{setToppingUp(false);flow.openPayment();setQuote(null);quoteAttempt.current=null;setQuoteRetry(value=>value+1);setWalletFailure(null);setFundingNotice(text('Wallet topped up. Review your bids, then confirm payment from your wallet.','ዋሌትዎ ተሞልቷል። ጨረታዎችዎን ይመልከቱና ከዋሌት ለመክፈል ያረጋግጡ።'));own.reload();wallet.reload();if(applyCoupon)discount.reload()},[flow.openPayment,own.reload,wallet.reload,discount.reload,applyCoupon,language]);
 const openTopUp=()=>{if(!queryIdentity||busy||walletRetry||payment.started)return;fundingRetained.current=true;retainBidFundingDraft(getMiniQueryClient(),queryIdentity,auction.slug,{numbers:selectedNumbers,method:'wallet',phone,applyCoupon});setNumbers(selectedNumbers);setInput('');setEditing(null);setMethod('wallet');setToppingUp(true)};
 useEffect(()=>{if(toppingUp)return;onDismissChange?.(backInCheckout);return()=>onDismissChange?.(null)},[toppingUp,step,numbers.length,receipt,busy,walletRetry,payment.started,flow.editDraft,flow.openPayment,flow.continueToPayment,onDismissChange]);
 if(toppingUp)return <WalletTopUp embedded onClose={onClose} onCredited={topUpCredited} onProgressChange={topUpProgress} onDismissChange={topUpBack}/>;
 if(showProgress&&(receipt||busy||walletRetry||payment.started))return <BidPaymentProgress walletPayment={!!receipt||walletRetry||busy&&(zero||method==='wallet')} payment={payment} preparing={busy} walletRetry={walletRetry} receipt={receipt} error={error} summary={{auctionTitle:known.product.title,auctionTitleAm:known.product.titleAm,numbers:quote?.lines.map(line=>line.number)??selectedNumbers,total:quote?.total??(directDraft&&'approvedTotal'in directDraft?directDraft.approvedTotal:payment.started?null:total),provider:directDraft?.paymentMethod??(payment.started&&!quote?null:zero?'coupon':method),phone:directDraft?.phone??(external?phone:null)}} onRetry={()=>void startNewBidPayment()} onChangePayment={()=>void startNewBidPayment()} onRetryWallet={()=>void pay(true)} onRetryOriginal={()=>void retryOriginalDirect()} onClose={onClose}/>;

 const invalidDraft=!!draft.error&&!!input;
 const footerTotal=!multiple&&!selectedNumbers.length?terms.entryFeePoints:total;
 const pendingOriginal=!!walletTarget||payment.started;
 const payDisabled=busy;
 const fieldHelp=text(`Enter an amount from ${bounds?.minPoints??'—'}${bounds?.maxPoints?` to ${bounds.maxPoints}`:''}. Step ${bounds?.stepPoints??'—'}.`,`ከ ${bounds?.minPoints??'—'}${bounds?.maxPoints?` እስከ ${bounds.maxPoints}`:''} መጠን ያስገቡ። ልዩነት ${bounds?.stepPoints??'—'}።`);
 const setDecimal=(value:string,setter:(value:string)=>void)=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(value)){setter(value);reportError('')}else reportError(text(...copy.precision))};
 const rangePresentation=<>{rangeDraft?.complete&&!rangeDraft.error&&<p className={reference.rangePreview} data-bid-range-preview role="status">{text(`${rangeDraft.count} amounts · Step ${rangeDraft.step}`,`${rangeDraft.count} መጠኖች · ልዩነት ${rangeDraft.step}`)}</p>}{rangeDraft?.error&&<p className={reference.error} data-bid-range-error role="alert">{rangeError(rangeDraft.error)}</p>}</>;
 if(step==='payment')return <>
  <AccountSheetFooter><div className={reference.footer}>
   <div className={reference.total} data-bid-total><span>{text('Total payable','ጠቅላላ ክፍያ')}</span><strong>{formatEtb(total)}</strong></div>
   <button type="button" className={reference.pay} data-payment-action data-bid-pay disabled={busy||quoteBusy} aria-busy={busy||quoteBusy} onClick={()=>void pay()}>{(busy||quoteBusy)&&<LoaderCircle size={17} className={reference.spin} aria-hidden="true"/>}{pendingOriginal?text('View payment status','የክፍያ ሁኔታ ይመልከቱ'):text(zero?'Submit bids':method==='wallet'?`Pay ${formatEtb(total)} from wallet`:`Pay ${formatEtb(total)} & bid`,zero?'ጨረታዎችን ያቅርቡ':`${formatEtb(total)} ከፍለው ይጫረቱ`)}</button>
  </div></AccountSheetFooter>
  <div className={reference.checkout} data-bid-step="payment" data-payment-method-form>
   <div className={reference.reviewHeading}><div><h3>{text('Your bids are ready','ጨረታዎችዎ ዝግጁ ናቸው')}</h3><p>{am?known.product.titleAm||known.product.title:known.product.title}</p></div><button type="button" className={reference.edit} onClick={flow.editDraft}>{text('Edit','ያስተካክሉ')}</button></div>
   <dl className={reference.reviewSummary}><div><dt>{text('Bid numbers','የጨረታ ቁጥሮች')}</dt><dd>{selectedNumbers.length<=4?selectedNumbers.join(', '):text(`${selectedNumbers.length} selected`,`${selectedNumbers.length} ተመርጠዋል`)}</dd></div><div><dt>{text('Submission fees','የማቅረቢያ ክፍያ')}</dt><dd>{formatEtb(total)}</dd></div></dl>
   <p className={reference.paymentNote}>{text('Only the submission fee is charged. Your bid number is not a payment.','የሚከፈለው የማቅረቢያ ክፍያ ብቻ ነው። የጨረታ ቁጥርዎ ክፍያ አይደለም።')}</p>
   {fundingNotice&&<p className={reference.notice} role="status" data-bid-funding-notice>{fundingNotice}</p>}
   <ReferencePaymentMethods name={`${id}-method`} method={method} onChange={value=>{setMethod(value as Method);reportError('')}} available={enabledMethods.map(item=>item.slug)} allowed={methodAvailable} disabled={frozen} wallet={{enabled:walletEnabled&&(walletAvailable!==null||zero),balance:walletAvailable}}>
    {method!=='wallet'&&!zero&&<div className={reference.phone} data-payment-phone><label htmlFor={`${id}-phone`}>{text('Payment phone number','የክፍያ ስልክ ቁጥር')}</label><div className={reference.phoneField}><span aria-hidden="true">+251</span><input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={18} value={phone} onChange={event=>{phoneEdited.current=true;setPhone(normalizePaymentPhone(event.target.value)?.slice(3)??event.target.value);reportError('')}} aria-invalid={!!phone&&!!phoneProblem||undefined} aria-describedby={`${id}-phone-note`}/></div><p id={`${id}-phone-note`} className={reference.inputHint}>{text('Use the number registered with your provider.','በክፍያ አቅራቢዎ የተመዘገበውን ቁጥር ይጠቀሙ።')}</p></div>}
   </ReferencePaymentMethods>
   {method==='wallet'&&<div className={reference.balanceNote}><Wallet size={15} aria-hidden="true"/><p>{text('Pay from your LowWin balance.','ከLowWin ቀሪ ሂሳብዎ ይክፈሉ።')}</p><button type="button" onClick={openTopUp}>{text('Add funds','ገንዘብ ያስገቡ')}</button></div>}
   {method==='wallet'&&insufficient&&!zero&&<p className={reference.error} role="status" data-wallet-insufficient>{text(`${formatEtb(total)} is required. Add funds or choose another method.`,`${formatEtb(total)} ያስፈልጋል። ገንዘብ ያስገቡ ወይም ሌላ መንገድ ይምረጡ።`)}</p>}
   {methods.fetching&&!methods.data&&<p className={reference.notice} role="status">{text('Loading payment methods…','የክፍያ መንገዶች በመጫን ላይ…')}</p>}
   {!methods.fetching&&!enabledMethods.length&&(methods.error||methods.data)&&<p className={reference.notice} role="status">{text('External payments are unavailable.','የውጭ ክፍያዎች አይገኙም።')} <button type="button" onClick={methods.reload}>{text('Retry','እንደገና')}</button></p>}
   {quoteBusy&&<p className={reference.notice} role="status">{text('Confirming your total…','ጠቅላላ ክፍያዎን በማረጋገጥ ላይ…')}</p>}
   {error&&<p className={reference.error} role="alert">{error}</p>}
  </div>
 </>;
 return <>
  <AccountSheetFooter><div className={reference.footer}>
   {multiple&&<div className={reference.total} data-bid-total aria-live="polite"><span>{text(`${selectedNumbers.length} selected`,`${selectedNumbers.length} ተመርጠዋል`)}</span><strong>{formatEtb(total)}</strong></div>}
   <button type="button" className={reference.pay} data-payment-action data-bid-pay data-bid-total={!multiple?'':undefined} disabled={payDisabled} aria-busy={busy} onClick={()=>void pay()}>{busy&&<LoaderCircle size={16} className={reference.spin} aria-hidden="true"/>}{pendingOriginal?text('View payment status','የክፍያ ሁኔታ ይመልከቱ'):!authenticated?text('Log in to bid','ለመጫረት ይግቡ'):text('Continue to payment','ወደ ክፍያ ይቀጥሉ')}</button>
  </div></AccountSheetFooter>
  <div className={reference.checkout} data-bid-entry data-bid-step="entry" data-payment-method-form={undefined}>
   <h3 className={reference.productTitle}>{am?known.product.titleAm||known.product.title:known.product.title}</h3>
   {description&&<details className={reference.description}><summary><span className={reference.excerpt}>{description}</span><b><span className={reference.more}>{text('Show more','ተጨማሪ ያሳዩ')}</span><span className={reference.less}>{text('Show less','ያሳንሱ')}</span><ChevronDown size={12} aria-hidden="true"/></b></summary><p>{description}</p></details>}
   <div className={reference.feeStrip}><div className={reference.fee}><small>{text('Bid fee','የጨረታ ክፍያ')}</small><strong>{formatEtb(terms.entryFeePoints)}</strong></div><span className={reference.bidCount}><Ticket size={12} aria-hidden="true"/>{known.bidCount.toLocaleString('en-US')} {text('bids','ጨረታዎች')}</span><span className={reference.timer}><Clock3 size={15} aria-hidden="true"/><AuctionCountdown target={known.endsAt} serverNow={serverNow} label="Ends" showLabel={false} variant="inline" onElapsed={()=>{detail.reload();if(authenticated)own.reload()}}/></span></div>
   {active&&current&&<div className={reference.couponArea}>
    <BidCouponControl applyCoupon={applyCoupon} disabled={frozen} onChange={setApplyCoupon}/>
    {applyCoupon&&<p className={reference.couponHint}>{coupon?text(`${coupon.coupon!.percent}% off one bid fee.`,`${coupon.coupon!.percent}% ቅናሽ በአንድ ጨረታ ክፍያ።`):text(discount.fetching?'Checking coupon…':'No eligible coupon. Remove it or retry.',discount.fetching?'ኩፖን በመፈተሽ ላይ…':'ተስማሚ ኩፖን የለም። ያስወግዱ ወይም ይድገሙ።')}</p>}
   </div>}
   {pendingOriginal&&<p className={reference.notice} role="status" data-bid-pending-payment>{text(walletObserving?'Checking your previous payment. Your draft stays editable.':'A previous payment is still open. Check its status before paying again.',walletObserving?'የቀደመውን ክፍያ በማረጋገጥ ላይ ነን። መጠኖችዎን ማስተካከል ይችላሉ።':'የቀደመ ክፍያ ገና አለ። ደግመው ከመክፈልዎ በፊት ሁኔታውን ይመልከቱ።')} <button type="button" onClick={viewPaymentStatus}>{text('View payment status','የክፍያ ሁኔታ ይመልከቱ')}</button></p>}
   {!pendingOriginal&&receipt&&<p className={reference.notice} role="status">{text('Your previous wallet payment was confirmed.','የቀደመው የዋሌት ክፍያዎ ተረጋግጧል።')} <button type="button" onClick={presentPayment}>{text('View receipt','ደረሰኝ ይመልከቱ')}</button></p>}
   {fundingNotice&&<p className={reference.notice} role="status" data-bid-funding-notice>{fundingNotice}</p>}
   {active&&current?<>
    <div className={reference.multiRow}><span><Layers size={15} aria-hidden="true"/>{text('Bid on several amounts','በብዙ መጠኖች ይጫረቱ')}</span><button type="button" role="switch" aria-checked={multiple} aria-label={text('Bid on several amounts','በብዙ መጠኖች ይጫረቱ')} data-bid-multi-toggle data-bid-mode-toggle disabled={frozen} onClick={()=>{if(multiple&&(numbers.length>1||editing===null&&numbers.length>0&&input!=='')){reportError(text('Remove extra amounts before switching to a single bid.','ወደ አንድ ጨረታ ከመቀየርዎ በፊት ተጨማሪ መጠኖችን ያስወግዱ።'));return}if(multiple&&numbers.length===1){setInput(editing===null?numbers[0]:input);setNumbers([]);setEditing(null)}setMultiple(!multiple);setNumberMode('individual');reportError('')}}><span/></button></div>
    <div className={reference.inputHeading}><label htmlFor={id}>{text('Your bid number','የጨረታ ቁጥርዎ')}</label>{multiple&&<span>{selectedNumbers.length} / {rules?.remainingSubmissions??'—'} {text('numbers','ቁጥሮች')}</span>}</div>
    {multiple&&<div className={reference.tabs} role="tablist" aria-label={text('Add bid amounts','የጨረታ መጠኖች ይጨምሩ')} data-bid-range-tabs><button type="button" role="tab" aria-selected={numberMode==='individual'} disabled={frozen} onClick={()=>{setNumberMode('individual');reportError('')}}>{text('One by one','አንድ በአንድ')}</button><button type="button" role="tab" aria-selected={numberMode==='range'} disabled={frozen} onClick={()=>{setNumberMode('range');setInput('');setEditing(null);reportError('')}}>{text('Range','ክልል')}</button></div>}
    {multiple&&numberMode==='range'?<><div className={reference.rangeRow}>
     <label><span>{text('From','ከ')}</span><input aria-label={text('From amount','የመጀመሪያ መጠን')} data-bid-range-from inputMode="decimal" autoComplete="off" maxLength={19} value={rangeFrom} placeholder={bounds?.minPoints??'0.00'} disabled={frozen} onChange={event=>setDecimal(event.target.value,setRangeFrom)}/></label>
     <label><span>{text('To','እስከ')}</span><input aria-label={text('To amount','የመጨረሻ መጠን')} data-bid-range-to inputMode="decimal" autoComplete="off" maxLength={19} value={rangeTo} placeholder="0.00" disabled={frozen} onChange={event=>setDecimal(event.target.value,setRangeTo)}/></label>
     <label><span>{text('Step','ልዩነት')}</span><input aria-label={text('Step amount','ልዩነት')} data-bid-range-step inputMode="decimal" autoComplete="off" maxLength={19} value={selectedRangeStep} disabled={frozen} onChange={event=>setDecimal(event.target.value,setRangeStep)} aria-invalid={rangeDraft?.error==='step'||undefined}/></label>
     <button type="button" className={reference.add} data-bid-add disabled={frozen||!rangeFrom&&!rangeTo} aria-label={text('Add bid range','የጨረታ ክልል ጨምር')} onClick={addRange}><Plus size={16} aria-hidden="true"/>{text('Add','ጨምር')}</button>
    </div>{rangePresentation}</>:<div className={reference.inputRow}><div className={reference.amountField}><span aria-hidden="true">#</span><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} disabled={frozen} value={input} placeholder={text('Enter your bid amount…','የጨረታ መጠንዎን ያስገቡ…')} onChange={event=>setDecimal(event.target.value,setInput)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(multiple)add()}}} aria-invalid={invalidDraft||undefined} aria-describedby={`${id}-help`}/></div>{multiple&&<button className={reference.add} type="button" data-bid-add disabled={frozen||!input} aria-label={text(editing===null?'Add bid amount':'Save bid amount',editing===null?'የጨረታ መጠን ጨምር':'የጨረታ መጠን ያስቀምጡ')} onClick={add}><Plus size={16} aria-hidden="true"/>{text(editing===null?'Add':'Save',editing===null?'ጨምር':'አስቀምጥ')}</button>}</div>}
    <p id={`${id}-help`} className={reference.inputHint}>{fieldHelp}</p>
    {!!numbers.length&&<><div className={reference.chips} aria-label={text('Selected bid amounts','የተመረጡ የጨረታ መጠኖች')}>{numbers.map((number,index)=><span key={number}><button disabled={frozen} type="button" aria-label={text(`Edit ${number}`,`${number} ያስተካክሉ`)} onClick={()=>{setEditing(index);setInput(number);setNumberMode('individual');reportError('')}}>{number}</button><button disabled={frozen} type="button" aria-label={text(`Remove ${number}`,`${number} ያስወግዱ`)} onClick={()=>{setNumbers(values=>values.filter((_,i)=>i!==index));setEditing(null);setInput('');reportError('')}}><X size={12} aria-hidden="true"/></button></span>)}</div><div className={reference.selectionSummary}><span>{text(`${numbers.length} numbers × ${formatEtb(terms.entryFeePoints)}`,`${numbers.length} ቁጥሮች × ${formatEtb(terms.entryFeePoints)}`)}</span><button type="button" disabled={frozen} onClick={()=>{setNumbers([]);setInput('');setEditing(null);reportError('')}}>{text('Clear all','ሁሉንም አጽዳ')}</button></div></>}
   </>:<p className={reference.notice}>{text('This auction is not open for new bids.','ይህ ጨረታ ለአዲስ ጨረታዎች ክፍት አይደለም።')}</p>}

   {own.error&&authenticated&&<p className={reference.error}>{text('Your bid limits could not load.','የጨረታ ገደቦችዎ መጫን አልተቻለም።')} <button type="button" onClick={own.reload}>{text('Retry','እንደገና')}</button></p>}
   {detail.error&&<p className={reference.error}>{text('Product details could not refresh.','የዕቃውን ዝርዝር ማደስ አልተቻለም።')} <button type="button" onClick={detail.reload}>{text('Retry','እንደገና')}</button></p>}
  </div>
 </>;
}
