'use client';
import dynamic from 'next/dynamic';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {ChevronDown,Clock3,Layers,LoaderCircle,Plus,Send,Ticket,Wallet,X} from 'lucide-react';
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
import {clearBidWalletRecovery,readBidWalletRecovery,retainBidWalletRecovery} from '@/lib/bid-wallet-recovery';
import {clearBidFundingDraft,readBidFundingDraft,retainBidFundingDraft} from '@/lib/bid-funding-draft';
import {readChapaOriginalAttempt,retainChapaOriginalAttempt} from '@/lib/chapa-original-attempt';
import {AccountSheetFooter} from './account-sheet';
import {AuctionCountdown} from './auction-countdown';
import {isFullAuction,type BidSheetAuction} from './bid-sheet-preview';
import type {BidSheetPhase} from './bid-sheet';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {usePublicQuery} from './public-query';
import {useTelegram} from './telegram-provider';
import {confirmedBidQueryScopes,getMiniQueryClient,invalidatePrivateQueries,isPrivateQueryIdentity} from './private-query-cache';
import {useChapaPayment} from './chapa-payment';
import BidPaymentProgress from './bid-payment-progress';
import {usePaymentCheckoutFlow} from './payment-checkout-flow';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {publishWalletBidReceipt} from './wallet-bid-cache';
import {auctionDetailUrl} from './auction-query';
import styles from './bid-payment-sheet.module.css';
import reference from './reference-bid-checkout.module.css';
import {ReferencePaymentMethods,referencePaymentProviders as providers} from './reference-payment-methods';
const WalletTopUp=dynamic(()=>import('./wallet-top-up'),{ssr:false});
type Method='wallet'|typeof providers[number]['slug']|'ebirr'|'cbe-bank';
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
 const [multiple,setMultiple]=useState((initialDraft?.numbers??walletRecovery?.lines??originalQuote?.lines??fundingDraft?.numbers??[]).length>1),[numberMode,setNumberMode]=useState<'individual'|'range'>('individual'),[rangeFrom,setRangeFrom]=useState(''),[rangeTo,setRangeTo]=useState('');
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
 const values=!multiple?(input?[input]:numbers.slice(0,1)):editing===null?[...numbers,...(input?[input]:[])]:numbers.map((value,index)=>index===editing?input:value);
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
 const enabled=method!==null&&(method==='wallet'||providers.some(provider=>provider.slug===method))&&(zero||(method==='wallet'?!!wallet.data?.bidsEnabled:!!methods.data?.enabled&&methodAvailable(method)));
 const walletEnabled=!!wallet.data?.bidsEnabled||zero&&selectedNumbers.length>0;
 const copy:Record<BidDraftError,[string,string]>={precision:['Enter a number with at most two decimals.','እስከ ሁለት አስርዮሽ ያለው ቁጥር ያስገቡ።'],range:['Choose an amount within the displayed range and step.','በሚታየው ክልል እና ልዩነት ውስጥ መጠን ይምረጡ።'],duplicate:['This amount is already selected or submitted.','ይህ መጠን ተመርጧል ወይም ቀድሞ ቀርቧል።'],consecutive:['Only 3 consecutive amounts. Skip at least one step.','ከሦስት በላይ ተከታታይ ቁጥሮች አይፈቀዱም።'],limit:['You have reached the remaining submission limit.','የቀሩትን የጨረታ ገደብ ደርሰዋል።']};
 useEffect(()=>{const version=++generation.current;return()=>{if(generation.current===version)generation.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear()}},[queryIdentity]);
 useEffect(()=>{if(!toppingUp)onPhaseChange(receipt?'receipt':busy||walletRetry||payment.started?'payment':'entry')},[toppingUp,receipt,busy,walletRetry,payment.started,onPhaseChange]);
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
 const addRange=()=>{
  if(frozen||!rules)return;
  const from=normalizeBidDraft(rangeFrom),to=normalizeBidDraft(rangeTo);
  if(!from||!to){setError(text(...copy.precision));return}
  const start=etbToCents(from),end=etbToCents(to),increment=etbToCents(rules.stepPoints);
  if(start>end||increment<=0n||(end-start)%increment!==0n){setError(text(...copy.range));return}
  const count=(end-start)/increment+1n;
  if(count>BigInt(Math.max(0,rules.remainingSubmissions-numbers.length))||count>100n){setError(text(...copy.limit));return}
  const additions:string[]=[];for(let value=start;value<=end;value+=increment)additions.push(centsToEtb(value));
  const checked=validateBidDraft([...numbers,...additions],rules);
  if(checked.error){setError(text(...copy[checked.error]));return}
  setNumbers(checked.numbers);setInput('');setEditing(null);setRangeFrom('');setRangeTo('');setError('');
 };
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
   if(!state||quoteBusy||method===null||!enabled||!active||!current||!zero&&(method==='wallet'?insufficient||!!wallet.error:!normalizedPhone))return;
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
 useEffect(()=>{if(toppingUp)return;onDismissChange?.(null);return()=>onDismissChange?.(null)},[toppingUp,step,numbers.length,receipt,busy,walletRetry,payment.started,flow.editDraft,flow.openPayment,flow.continueToPayment,onDismissChange]);
 if(toppingUp)return <WalletTopUp embedded onClose={returnFromTopUp} onCredited={topUpCredited} onProgressChange={topUpProgress} onDismissChange={topUpBack}/>;
 if(receipt||busy||walletRetry||payment.started)return <BidPaymentProgress payment={payment} preparing={busy} walletRetry={walletRetry} receipt={receipt} error={error} summary={{auctionTitle:known.product.title,auctionTitleAm:known.product.titleAm,numbers:quote?.lines.map(line=>line.number)??selectedNumbers,total:quote?.total??(directDraft&&'approvedTotal'in directDraft?directDraft.approvedTotal:payment.started?null:total),provider:directDraft?.paymentMethod??(payment.started&&!quote?null:zero?'coupon':method),phone:directDraft?.phone??(external?phone:null)}} onRetry={()=>void startNewBidPayment()} onChangePayment={()=>void startNewBidPayment(true)} onRetryWallet={()=>void pay()} onRetryOriginal={()=>void retryOriginalDirect()} onClose={onClose}/>;

 const invalidDraft=!!draft.error&&!!input;
 const footerTotal=!multiple&&!selectedNumbers.length?terms.entryFeePoints:total;
 const payDisabled=!bounds||!active||!current||frozen||!draft.numbers.length||!!draft.error||authenticated&&(!state||!enabled||!zero&&(method==='wallet'?insufficient||!!wallet.error:!normalizedPhone)||applyCoupon&&(!coupon||discount.fetching));
 const fieldHelp=text(`Enter an amount from ${bounds?.minPoints??'—'}${bounds?.maxPoints?` to ${bounds.maxPoints}`:''}. Step ${bounds?.stepPoints??'—'}.`,`ከ ${bounds?.minPoints??'—'}${bounds?.maxPoints?` እስከ ${bounds.maxPoints}`:''} መጠን ያስገቡ። ልዩነት ${bounds?.stepPoints??'—'}።`);
 const setDecimal=(value:string,setter:(value:string)=>void)=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(value)){setter(value);setError('')}};
 return <>
  <AccountSheetFooter><div className={reference.footer}>
   {multiple&&<div className={reference.total} data-bid-total aria-live="polite"><span>{text(`${selectedNumbers.length} selected`,`${selectedNumbers.length} ተመርጠዋል`)}</span><strong>{formatEtb(total)}</strong></div>}
   <button type="button" className={reference.pay} data-payment-action data-bid-pay data-bid-total={!multiple?'':undefined} disabled={payDisabled} aria-busy={busy} onClick={()=>void pay()}>{busy&&<LoaderCircle size={16} className={reference.spin} aria-hidden="true"/>}{!authenticated?text('Log in to bid','ለመጫረት ይግቡ'):text(zero&&selectedNumbers.length?'Submit bids':`PAY ${formatEtb(footerTotal)} & BID`,zero&&selectedNumbers.length?'ጨረታዎችን ያቅርቡ':`${formatEtb(footerTotal)} ይክፈሉና ይጫረቱ`)}</button>
  </div></AccountSheetFooter>
  <div className={reference.checkout} data-bid-entry data-bid-step="entry" data-payment-method-form>
   <div className={reference.socials}><p>{text('FOLLOW US','ይከተሉን')}</p><nav aria-label={text('Lowwin social pages','የLowwin ማህበራዊ ገጾች')}>
    <a href="https://t.me/lowwin23" target="_blank" rel="noopener noreferrer" aria-label="Lowwin on Telegram"><span><Send size={16} aria-hidden="true"/></span></a>
    <a href="https://www.tiktok.com/@lowwinet" target="_blank" rel="noopener noreferrer" aria-label="Lowwin on TikTok"><span><svg viewBox="0 0 24 24" fill="currentColor" width="17" height="17" aria-hidden="true"><path d="M16.7 2h-3.4v13.5a3 3 0 1 1-2.6-3V9a6.5 6.5 0 1 0 6 6.5V8.6a8.1 8.1 0 0 0 4.8 1.6V6.8A4.9 4.9 0 0 1 16.7 2Z"/></svg></span></a>
   </nav></div>
   <h3 className={reference.productTitle}>{am?known.product.titleAm||known.product.title:known.product.title}</h3>
   {description&&<details className={reference.description}><summary><span className={reference.descriptionTitle}>{am?known.product.titleAm||known.product.title:known.product.title}</span><span className={reference.excerpt}>{description}</span><b><span className={reference.more}>{text('Show more','ተጨማሪ ያሳዩ')}</span><span className={reference.less}>{text('Show less','ያሳንሱ')}</span><ChevronDown size={12} aria-hidden="true"/></b></summary><p>{description}</p></details>}
   <div className={reference.feeStrip}><div className={reference.fee}><small>{text('Bid fee','የጨረታ ክፍያ')}</small><strong>{formatEtb(terms.entryFeePoints)}</strong></div><span className={reference.bidCount}><Ticket size={12} aria-hidden="true"/>{known.bidCount.toLocaleString('en-US')} {text('bids','ጨረታዎች')}</span><span className={reference.timer}><Clock3 size={15} aria-hidden="true"/><AuctionCountdown target={known.endsAt} serverNow={serverNow} label="Ends" showLabel={false} variant="inline" onElapsed={()=>{detail.reload();if(authenticated)own.reload()}}/></span></div>
   {fundingNotice&&<p className={reference.notice} role="status" data-bid-funding-notice>{fundingNotice}</p>}
   {active&&current?<>
    <div className={reference.multiRow}><span><Layers size={15} aria-hidden="true"/>{text('Bid on several amounts','በብዙ መጠኖች ይጫረቱ')}</span><button type="button" role="switch" aria-checked={multiple} aria-label={text('Bid on several amounts','በብዙ መጠኖች ይጫረቱ')} data-bid-multi-toggle data-bid-mode-toggle disabled={frozen} onClick={()=>{if(multiple&&(numbers.length>1||editing===null&&numbers.length>0&&input!=='')){setError(text('Remove extra amounts before switching to a single bid.','ወደ አንድ ጨረታ ከመቀየርዎ በፊት ተጨማሪ መጠኖችን ያስወግዱ።'));return}if(multiple&&numbers.length===1){setInput(editing===null?numbers[0]:input);setNumbers([]);setEditing(null)}setMultiple(!multiple);setNumberMode('individual');setError('')}}><span/></button></div>
    <div className={reference.inputHeading}><label htmlFor={id}>{text('Your bid amount','የጨረታ መጠንዎ')}</label>{multiple&&<span>{selectedNumbers.length} / {rules?.remainingSubmissions??'—'} {text('numbers','ቁጥሮች')}</span>}</div>
    {multiple&&<div className={reference.tabs} role="tablist" aria-label={text('Add bid amounts','የጨረታ መጠኖች ይጨምሩ')} data-bid-range-tabs><button type="button" role="tab" aria-selected={numberMode==='individual'} disabled={frozen} onClick={()=>{setNumberMode('individual');setError('')}}>{text('One by one','አንድ በአንድ')}</button><button type="button" role="tab" aria-selected={numberMode==='range'} disabled={frozen} onClick={()=>{setNumberMode('range');setInput('');setEditing(null);setError('')}}>{text('Range','ክልል')}</button></div>}
    {multiple&&numberMode==='range'?<div className={reference.rangeRow}>
     <label><span>{text('From','ከ')}</span><input aria-label={text('From amount','የመጀመሪያ መጠን')} data-bid-range-from inputMode="decimal" autoComplete="off" maxLength={19} value={rangeFrom} placeholder={bounds?.minPoints??'0.00'} disabled={frozen} onChange={event=>setDecimal(event.target.value,setRangeFrom)}/></label>
     <label><span>{text('To','እስከ')}</span><input aria-label={text('To amount','የመጨረሻ መጠን')} data-bid-range-to inputMode="decimal" autoComplete="off" maxLength={19} value={rangeTo} placeholder="0.00" disabled={frozen} onChange={event=>setDecimal(event.target.value,setRangeTo)}/></label>
     <button type="button" className={reference.add} data-bid-add disabled={frozen||!rangeFrom||!rangeTo||!rules} aria-label={text('Add bid range','የጨረታ ክልል ጨምር')} onClick={addRange}><Plus size={16} aria-hidden="true"/>{text('Add','ጨምር')}</button>
    </div>:<div className={reference.inputRow}><div className={reference.amountField}><span aria-hidden="true">ETB</span><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} disabled={frozen} value={input} placeholder={text('Enter your bid amount…','የጨረታ መጠንዎን ያስገቡ…')} onChange={event=>setDecimal(event.target.value,setInput)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(multiple)add()}}} aria-invalid={invalidDraft||undefined} aria-describedby={`${id}-help`}/></div>{multiple&&<button className={reference.add} type="button" data-bid-add disabled={frozen||!input||!!draft.error} aria-label={text(editing===null?'Add bid amount':'Save bid amount',editing===null?'የጨረታ መጠን ጨምር':'የጨረታ መጠን ያስቀምጡ')} onClick={add}><Plus size={16} aria-hidden="true"/>{text(editing===null?'Add':'Save',editing===null?'ጨምር':'አስቀምጥ')}</button>}</div>}
    <p id={`${id}-help`} className={reference.inputHint}>{fieldHelp}</p>
    {!!numbers.length&&<><div className={reference.chips} aria-label={text('Selected bid amounts','የተመረጡ የጨረታ መጠኖች')}>{numbers.map((number,index)=><span key={number}><button disabled={frozen} type="button" aria-label={text(`Edit ${number}`,`${number} ያስተካክሉ`)} onClick={()=>{setEditing(index);setInput(number);setNumberMode('individual');setError('')}}>{number}</button><button disabled={frozen} type="button" aria-label={text(`Remove ${number}`,`${number} ያስወግዱ`)} onClick={()=>{setNumbers(values=>values.filter((_,i)=>i!==index));setEditing(null);setInput('');setError('')}}><X size={12} aria-hidden="true"/></button></span>)}</div><div className={reference.selectionSummary}><span>{text(`${numbers.length} numbers × ${formatEtb(terms.entryFeePoints)}`,`${numbers.length} ቁጥሮች × ${formatEtb(terms.entryFeePoints)}`)}</span><button type="button" disabled={frozen} onClick={()=>{setNumbers([]);setInput('');setEditing(null);setError('')}}>{text('Clear all','ሁሉንም አጽዳ')}</button></div></>}
    {state?.referralDiscountsAvailable&&<div className={reference.coupons} data-bid-coupons><Ticket size={14} aria-hidden="true"/><span>{text('Coupons','ኩፖኖች')} <b>{couponCount??'—'}</b></span><button type="button" disabled={frozen||!applyCoupon&&(!couponCount)} onClick={()=>setApplyCoupon(value=>!value)}>{text(applyCoupon?'Remove':'Apply',applyCoupon?'አስወግድ':'ተግብር')}</button></div>}
    {applyCoupon&&<p className={reference.inputHint}>{coupon?text(`${coupon.coupon!.percent}% off one bid fee.`,`${coupon.coupon!.percent}% ቅናሽ በአንድ ጨረታ ክፍያ።`):text(discount.fetching?'Checking coupon…':'No eligible coupon. Remove it or retry.',discount.fetching?'ኩፖን በመፈተሽ ላይ…':'ተስማሚ ኩፖን የለም። ያስወግዱ ወይም ይድገሙ።')}</p>}
    <div className={reference.balanceNote}><Wallet size={15} aria-hidden="true"/><p>{text('Available:','ያለ፦')} <strong>{walletAvailable===null?'—':`${walletAvailable} ETB`}</strong> · {text('Top up once — use your wallet for quick bidding.','አንድ ጊዜ ይሙሉና በዋሌትዎ በፍጥነት ይጫረቱ።')} <button type="button" onClick={authenticated?openTopUp:openRegistration}>{text('Top up','ይሙሉ')}</button></p></div>
    <ReferencePaymentMethods name={`${id}-method`} method={method} onChange={value=>{setMethod(value as Method);setError('')}} allowed={methodAvailable} disabled={frozen} wallet={{enabled:walletEnabled&&(walletAvailable!==null||zero)}}>
    {external&&!zero&&<div className={reference.phone} data-payment-phone><label htmlFor={`${id}-phone`}>{text('Payment phone number','የክፍያ ስልክ ቁጥር')}</label><div className={reference.phoneField}><span aria-hidden="true">+251</span><input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={18} value={phone} onChange={event=>{phoneEdited.current=true;setPhone(normalizePaymentPhone(event.target.value)?.slice(3)??event.target.value);setError('')}} aria-invalid={!!phone&&!!phoneProblem||undefined} aria-describedby={`${id}-phone-note`}/></div><p id={`${id}-phone-note`} className={phone&&phoneProblem?reference.error:reference.inputHint}>{phone&&phoneProblem?paymentPhoneProblemMessage(phoneProblem,am):text('Use the phone registered with your payment provider.','በክፍያ አቅራቢዎ የተመዘገበውን ስልክ ይጠቀሙ።')}</p></div>}
    </ReferencePaymentMethods>
    {methods.fetching&&!methods.data&&<p className={reference.notice} role="status">{text('Loading payment methods…','የክፍያ መንገዶች በመጫን ላይ…')}</p>}
    {(methods.error||methods.data&&!methods.data.enabled)&&<p className={reference.notice} role="status">{text('External payments are unavailable.','የውጭ ክፍያዎች ለጊዜው አይገኙም።')} <button type="button" onClick={methods.reload}>{text('Retry','እንደገና')}</button></p>}
    {method==='wallet'&&insufficient&&!zero&&<p className={reference.error} role="status" data-wallet-insufficient>{text(`Your balance is ${walletAvailable??'—'} ETB. ${formatEtb(total)} is required.`, `ቀሪ ሂሳብዎ ${walletAvailable??'—'} ብር ነው። ${formatEtb(total)} ያስፈልጋል።`)} <button type="button" onClick={openTopUp}>{text('Top up','ይሙሉ')}</button></p>}
   </>:<p className={reference.notice}>{text('This auction is not open for new bids.','ይህ ጨረታ ለአዲስ ጨረታዎች ክፍት አይደለም።')}</p>}
   {(error||payment.error||invalidDraft)&&<p className={reference.error} role="alert">{error||payment.error||(draft.error?text(...copy[draft.error]):'')}</p>}
   {own.error&&authenticated&&<p className={reference.error}>{text('Your bid limits could not load.','የጨረታ ገደቦችዎ መጫን አልተቻለም።')} <button type="button" onClick={own.reload}>{text('Retry','እንደገና')}</button></p>}
   {detail.error&&<p className={reference.error}>{text('Product details could not refresh.','የዕቃውን ዝርዝር ማደስ አልተቻለም።')} <button type="button" onClick={detail.reload}>{text('Retry','እንደገና')}</button></p>}
  </div>
 </>;
}
