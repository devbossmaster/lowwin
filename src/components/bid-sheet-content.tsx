'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {ArrowLeft,Check,CreditCard,Plus,ShieldCheck,Ticket,Wallet,X} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import type {getOwnBidState} from '@/modules/auctions/bids';
import type {WalletBalance} from '@/modules/wallet/balance';
import type {getBidDiscountQuote} from '@/modules/referrals/service';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {etbToCents,formatEtb} from '@/lib/money';
import {normalizeBidDraft,normalizePaymentPhone,previewBidFees,validateBidDraft,type BidBatchQuote,type BidBatchReceipt,type BidDraftError,type DirectPaymentMethods} from '@/lib/bid-batch-client';
import {ChapaClientError,requestChapaJson,type ChapaAvailability} from '@/lib/chapa-client';
import {usableBidDiscount} from '@/lib/bid-discount-preview';
import {paymentPhoneProblem,paymentPhoneProblemMessage} from '@/lib/payment-phone';
import {clearBidWalletRecovery,readBidWalletRecovery,retainBidWalletRecovery} from '@/lib/bid-wallet-recovery';
import {readChapaOriginalAttempt,retainChapaOriginalAttempt} from '@/lib/chapa-original-attempt';
import {AccountSheetFooter} from './account-sheet';
import {CatalogImage} from './catalog-image';
import {BidSheetPreview,isFullAuction,type BidSheetAuction} from './bid-sheet-preview';
import type {BidSheetPhase} from './bid-sheet';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {usePublicQuery} from './public-query';
import {useTelegram} from './telegram-provider';
import {confirmedBidQueryScopes,getMiniQueryClient,invalidatePrivateQueries,isPrivateQueryIdentity} from './private-query-cache';
import {useChapaPayment} from './chapa-payment';
import BidPaymentProgress from './bid-payment-progress';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {auctionDetailUrl} from './auction-query';
import styles from './bid-payment-sheet.module.css';
import ui from './batch-checkout.module.css';
import simple from './simple-bid-checkout.module.css';
const providers=[
 {slug:'telebirr',name:'telebirr',image:'/icons/payments/telebirr.jpg'},
 {slug:'cbebirr',name:'CBE Birr',image:'/icons/payments/cbebirr.svg'},
 {slug:'mpesa',name:'M-Pesa',image:'/icons/payments/mpesa.png'},
] as const;
type Method='wallet'|typeof providers[number]['slug'];
export type BidCheckoutDraft={numbers:string[];method?:string|null;phone?:string|null};
type BidState=Omit<Awaited<ReturnType<typeof getOwnBidState>>,'wallet'|'previousMax'>&{referralDiscountsAvailable?:boolean;couponAvailableCount?:number|null};
type DiscountQuote=Awaited<ReturnType<typeof getBidDiscountQuote>>;
type Props={auction:BidSheetAuction;serverNow:string;onClose:()=>void;onPhaseChange:(phase:BidSheetPhase)=>void;initialChapaId?:string;initialDraft?:BidCheckoutDraft;onDismissChange?:(handler:(()=>void)|null)=>void};

export default function BidSheetContents({auction,onClose,onPhaseChange,initialChapaId,initialDraft,onDismissChange}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity,refreshMe,openRegistration}=useTelegram(),initialFull=isFullAuction(auction)?auction:undefined;
 const detail=usePublicQuery<CatalogAuction>(auctionDetailUrl(auction.slug),{initialData:initialFull});
 const full=(detail.data?.slug===auction.slug?detail.data:undefined)??initialFull,known=full??auction;
 const own=usePrivateQuery<BidState>(`/api/auctions/${auction.slug}/bids`);
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000});
 const availability=usePrivateQuery<ChapaAvailability>('/api/payments/chapa',{freshnessMs:15000});
 const payment=useChapaPayment('bid:'+auction.slug,initialChapaId,{retainOriginal:true}),state=own.data,terms=state?.terms??known.terms;
 const walletRecovery=queryIdentity?readBidWalletRecovery(getMiniQueryClient(),queryIdentity,auction.slug):null;
 const original=queryIdentity?readChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,'bid:'+auction.slug):null;
 const directDraft=payment.directAttempt?.purpose==='BID'?payment.directAttempt:null,originalQuote=original?.intent.purpose==='BID'&&original.bidQuote?.auctionSlug===auction.slug?original.bidQuote:null;
 const restoredMethod=initialDraft?.method??directDraft?.paymentMethod,restoredPhone=initialDraft?.phone??directDraft?.phone??'';
 const [step,setStep]=useState<'entry'|'review'>(initialDraft?'review':'entry');
 const [input,setInput]=useState(''),[numbers,setNumbers]=useState<string[]>(initialDraft?.numbers??walletRecovery?.lines.map(line=>line.number)??originalQuote?.lines.map(line=>line.number)??(directDraft&&'numbers'in directDraft?directDraft.numbers:[])),[editing,setEditing]=useState<number|null>(null);
 const [method,setMethod]=useState<Method|null>(walletRecovery?'wallet':restoredMethod&&['wallet','telebirr','mpesa','cbebirr'].includes(restoredMethod)?restoredMethod as Method:null),[phone,setPhone]=useState(normalizePaymentPhone(restoredPhone)?.slice(3)??'');
 const [quote,setQuote]=useState<BidBatchQuote|null>(walletRecovery??originalQuote),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [receipt,setReceipt]=useState<BidBatchReceipt|null>(null),[applyCoupon,setApplyCoupon]=useState(false),[walletRetry,setWalletRetry]=useState(!!walletRecovery),[quoteBusy,setQuoteBusy]=useState(false),[quoteRetry,setQuoteRetry]=useState(0);
 const id=useId(),lock=useRef(false),phoneEdited=useRef(!!normalizePaymentPhone(restoredPhone)),generation=useRef(0),controllers=useRef(new Set<AbortController>());
 const quoteAttempt=useRef<{fingerprint:string;key:string;quote?:BidBatchQuote;paymentKey:string}|null>(walletRecovery?{fingerprint:'',key:walletRecovery.id,paymentKey:walletRecovery.id,quote:walletRecovery}:null);
 const authenticated=!!queryIdentity,active=known.status==='live'&&(!state||state.open),current=isSubmissionFeeOnly(terms.ruleVersion);
 const methods=usePrivateQuery<DirectPaymentMethods>('/api/payments/chapa/methods',{enabled:authenticated&&active&&!payment.started,freshnessMs:60000});
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
  const item=methods.data?.methods.find(item=>item.slug===slug);
  const amount=draft.numbers.length?totalCents:etbToCents(terms.entryFeePoints);
  return !!item&&(!item.minAmountCents||amount>=BigInt(item.minAmountCents))&&(!item.maxAmountCents||amount<=BigInt(item.maxAmountCents));
 };
 const insufficient=!zero&&(!wallet.data||etbToCents(wallet.data.available)<totalCents);
 const enabled=method!==null&&(zero||(method==='wallet'?!!availability.data?.walletBidsEnabled:!!availability.data?.enabled&&methodAvailable(method)));
 const supportedProviders=availability.data?.enabled?providers.filter(provider=>methods.data?.methods.some(item=>item.slug===provider.slug)):[];
 const walletEnabled=!!availability.data?.walletBidsEnabled||zero&&selectedNumbers.length>0;
 const copy:Record<BidDraftError,[string,string]>={precision:['Enter a number with at most two decimals.','እስከ ሁለት አስርዮሽ ያለው ቁጥር ያስገቡ።'],range:['Choose an amount within the displayed range and step.','በሚታየው ክልል እና ልዩነት ውስጥ መጠን ይምረጡ።'],duplicate:['This amount is already selected or submitted.','ይህ መጠን ተመርጧል ወይም ቀድሞ ቀርቧል።'],consecutive:['Only 3 consecutive amounts. Skip at least one step.','ከሦስት በላይ ተከታታይ ቁጥሮች አይፈቀዱም።'],limit:['You have reached the remaining submission limit.','የቀሩትን የጨረታ ገደብ ደርሰዋል።']};
 useEffect(()=>{const version=++generation.current;return()=>{if(generation.current===version)generation.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear()}},[queryIdentity]);
 useEffect(()=>{onPhaseChange(receipt?'receipt':busy||walletRetry||payment.started?'payment':step==='review'?'review':'entry')},[receipt,busy,walletRetry,payment.started,step,onPhaseChange]);
 useEffect(()=>{if(!phoneEdited.current){const registered=normalizePaymentPhone(methods.data?.paymentPhone??'');if(registered)setPhone(registered.slice(3))}},[methods.data?.paymentPhone]);
 // Review creates only an immutable server quote. Providers and the wallet are
 // contacted solely by the final Pay action below; moving between steps keeps readers mounted.
 useEffect(()=>{
  if(step!=='review'||!queryIdentity||!state||!active||!current||draft.error||!draft.numbers.length||payment.started)return;
  if(quoteAttempt.current?.fingerprint===fingerprint&&quoteAttempt.current.quote)return;
  const attempt=quoteAttempt.current?.fingerprint===fingerprint?quoteAttempt.current:{fingerprint,key:crypto.randomUUID(),paymentKey:crypto.randomUUID(),quote:undefined as BidBatchQuote|undefined};quoteAttempt.current=attempt;
  const version=generation.current,controller=new AbortController();controllers.current.add(controller);let mounted=true;setQuoteBusy(true);setQuote(null);setError('');
  void requestChapaJson<BidBatchQuote>('/api/payments/chapa/batches/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(fingerprint),key:attempt.key})},controller.signal).then(next=>{
   if(!mounted||version!==generation.current||!isPrivateQueryIdentity(queryIdentity)||quoteAttempt.current!==attempt)return;
   attempt.quote=next;setQuote(next);
   if(etbToCents(next.total)!==etbToCents(preview.total))setError(text('The total changed. Review the amount before paying.','ጠቅላላ ክፍያው ተቀይሯል። ከመክፈልዎ በፊት መጠኑን ይመልከቱ።'));
  }).catch(cause=>{if(mounted&&version===generation.current)setError(cause instanceof ChapaClientError?cause.message:text('Could not confirm the total. Please retry.','ጠቅላላ ክፍያውን ማረጋገጥ አልተቻለም። እንደገና ይሞክሩ።'))}).finally(()=>{controllers.current.delete(controller);if(mounted)setQuoteBusy(false)});
  return()=>{mounted=false;controller.abort();controllers.current.delete(controller);setQuoteBusy(false)};
 },[step,fingerprint,queryIdentity,!!state,active,current,payment.started,quoteRetry]);
 // These codes are definitive pre-creation rejections, not uncertain charges.
 // The hook preserves all transport/server ambiguities on their original key.
 useEffect(()=>{
  if(payment.started||!['TERMS_CHANGED','COUPON_UNAVAILABLE'].includes(payment.errorCode??''))return;
  setQuote(null);quoteAttempt.current=null;own.reload();if(applyCoupon)discount.reload();
 },[payment.errorCode,payment.started,own.reload,discount.reload,applyCoupon]);
 const add=()=>{if(frozen)return;if(draft.error){setError(text(...copy[draft.error]));return}if(!input)return;setNumbers(draft.numbers);setInput('');setEditing(null);setError('')};
 const continueToPayment=()=>{if(frozen)return;if(!queryIdentity){openRegistration();return}if(draft.error||!draft.numbers.length){setError(draft.error?text(...copy[draft.error]):text('Add at least one bid amount.','ቢያንስ አንድ የጨረታ መጠን ያስገቡ።'));return}setNumbers(draft.numbers);setInput('');setEditing(null);setError('');setStep('review')};
 const editBids=()=>{setStep('entry');setError('');requestAnimationFrame(()=>document.getElementById(id)?.focus())};
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
   if(!state||!priced||quoteBusy||step!=='review'||method===null||!enabled||!active||!current||!zero&&(method==='wallet'?insufficient||!!wallet.error:!normalizedPhone))return;
   if(quoteAttempt.current?.fingerprint!==fingerprint)quoteAttempt.current={fingerprint,key:crypto.randomUUID(),paymentKey:crypto.randomUUID()};
  }
  if(!quoteAttempt.current)return;
  const attempt=quoteAttempt.current,version=generation.current,controller=new AbortController();controllers.current.add(controller);
  if(!recoveryQuote)payment.beginTiming(true);lock.current=true;setBusy(true);setError('');let walletSubmitted=false;
  try{
   // One authenticated server command validates the approved display total,
   // persists the immutable quote/intent, then dispatches outside DB locks.
   if(!attempt.quote&&!recoveryQuote&&!zero&&external){
    setNumbers(draft.numbers);setInput('');setEditing(null);
    const changedQuote=await payment.createDirect({...body,key:attempt.paymentKey,purpose:'BID',approvedTotal:total,paymentMethod:method!,phone:normalizedPhone!});
    if(generation.current!==version||!isPrivateQueryIdentity(queryIdentity))return;
    if(changedQuote)reviewChangedQuote(changedQuote);
    return;
   }
   const confirmedQuote=attempt.quote??await requestChapaJson<BidBatchQuote>('/api/payments/chapa/batches/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,key:attempt.key})},controller.signal);
   if(generation.current!==version||!isPrivateQueryIdentity(queryIdentity))return;
   attempt.quote=confirmedQuote;setQuote(confirmedQuote);
   if(!recoveryQuote&&etbToCents(confirmedQuote.total)!==totalCents){setError(text('The total was updated. Check the amount below, then tap Pay to confirm.','ጠቅላላ ክፍያው ተቀይሯል። ከታች ያለውን መጠን ይመልከቱና ለማረጋገጥ ይክፈሉ።'));return}
   setNumbers(confirmedQuote.lines.map(line=>line.number));setInput('');setEditing(null);
   if(recoveryQuote||zero||method==='wallet'){
    walletSubmitted=true;
    retainBidWalletRecovery(getMiniQueryClient(),queryIdentity,confirmedQuote);
    const accepted=await requestChapaJson<BidBatchReceipt>(`/api/payments/chapa/batches/${confirmedQuote.id}/wallet`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteHash:confirmedQuote.quoteHash})},controller.signal);
    if(generation.current===version&&isPrivateQueryIdentity(queryIdentity)){clearBidWalletRecovery(getMiniQueryClient(),queryIdentity,confirmedQuote);setReceipt(accepted);setWalletRetry(false);invalidatePrivateQueries(queryIdentity,confirmedBidQueryScopes(auction.slug));void refreshMe().catch(()=>{})}
   }else{
    const intent={key:attempt.paymentKey,purpose:'BID' as const,batchId:confirmedQuote.id,quoteHash:confirmedQuote.quoteHash,paymentMethod:method!,phone:normalizedPhone!};
    retainChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,'bid:'+auction.slug,intent,undefined,confirmedQuote);
    await payment.createDirect(intent);
   }
  }catch(cause){
   if(generation.current===version){
    const rejected=cause instanceof ChapaClientError&&cause.status>=400&&cause.status<500;
    if(walletSubmitted&&rejected&&attempt.quote)clearBidWalletRecovery(getMiniQueryClient(),queryIdentity!,attempt.quote);
    if(walletSubmitted&&!rejected)setWalletRetry(true);
    setError(cause instanceof ChapaClientError?cause.message:text(walletSubmitted?'Connection interrupted. Retry this same payment to confirm the result.':'Could not prepare your bids. Please retry.','ግንኙነቱ ተቋርጧል። ይህንኑ ጥያቄ እንደገና ይሞክሩ።'));
    if(cause instanceof ChapaClientError&&['QUOTE_CHANGED','STALE_QUOTE','COUPON_UNAVAILABLE','RETRYABLE_CONFLICT','TERMS_CHANGED'].includes(cause.code)){setQuote(null);quoteAttempt.current=null;setWalletRetry(false)}
    own.reload();wallet.reload();discount.reload();
   }
  }finally{controllers.current.delete(controller);if(generation.current===version){lock.current=false;setBusy(false)}}
 };
 const startNewBidPayment=async()=>{
  if(!payment.canStartAgain||!bidPaymentCanRetry(payment.order))return;
  const reconciled=await payment.check();if(!reconciled||!bidPaymentCanRetry(reconciled))return;
  const previous=quote??payment.order?.batch;
  const selection=previous?.lines.map(line=>line.number)??(payment.order?.bidNumber?[payment.order.bidNumber]:draft.numbers);
  payment.startAgain();setQuote(null);quoteAttempt.current=null;setWalletRetry(false);
  setNumbers(selection);setInput('');setEditing(null);setError('');setStep('review');own.reload();if(applyCoupon)discount.reload();
 };
 useEffect(()=>{onDismissChange?.(null)},[onDismissChange]);
 if(receipt||busy||walletRetry||payment.started)return <BidPaymentProgress payment={payment} preparing={busy} walletRetry={walletRetry} receipt={receipt} error={error} summary={{auctionTitle:known.product.title,auctionTitleAm:known.product.titleAm,numbers:quote?.lines.map(line=>line.number)??selectedNumbers,total:quote?.total??(directDraft&&'approvedTotal'in directDraft?directDraft.approvedTotal:payment.started?null:total),provider:directDraft?.paymentMethod??(payment.started&&!quote?null:zero?'coupon':method),phone:directDraft?.phone??(external?phone:null)}} onRetry={()=>void startNewBidPayment()} onRetryWallet={()=>void pay()} onRetryOriginal={()=>void retryOriginalDirect()} onClose={onClose}/>;

 return <>
  <AccountSheetFooter>
   <div className={simple.total} data-bid-total aria-live="polite"><span>{text(`${selectedNumbers.length} bid${selectedNumbers.length===1?'':'s'}`,`${selectedNumbers.length} ጨረታዎች`)}{(priced?.discountTotal??preview.discountTotal)!=='0.00'&&<small>{text('Coupon applied','ኩፖን ተተግብሯል')}</small>}</span><strong>{formatEtb(total)}</strong></div>
   {step==='entry'?<button type="button" className={`${styles.payButton} ${simple.pay}`} data-bid-continue disabled={!bounds||!active||!current||frozen||!draft.numbers.length||!!draft.error||authenticated&&!state||applyCoupon&&(!coupon||discount.fetching)} onClick={continueToPayment}>{text('Continue to payment','ወደ ክፍያ ቀጥል')}</button>:<div className={simple.footerActions}><button type="button" className={simple.back} onClick={editBids}><ArrowLeft size={16}/>{text('Back','ተመለስ')}</button><button type="button" className={`${styles.payButton} ${simple.pay}`} data-payment-action disabled={!bounds||!active||!current||!draft.numbers.length||!!draft.error||!priced||quoteBusy||!state||!enabled||!zero&&(method==='wallet'?insufficient||!!wallet.error:!normalizedPhone)||applyCoupon&&(!coupon||discount.fetching)} onClick={()=>void pay()}>{busy?text('Processing…','በማስኬድ ላይ…'):text(zero?'Submit bids':`Pay ${formatEtb(total)} & bid`,zero?'ጨረታዎችን ያቅርቡ':`${formatEtb(total)} ይክፈሉና ይጫረቱ`)}</button></div>}
  </AccountSheetFooter>
  <div className={`${styles.bidEntry} ${simple.entry}`} data-bid-entry data-bid-step={step}>
   <ol className={simple.steps} aria-label={text('Bid checkout steps','የጨረታ ክፍያ ደረጃዎች')}><li aria-current={step==='entry'?'step':undefined}><span>1</span>{text('Your bids','ጨረታዎችዎ')}</li><li aria-current={step==='review'?'step':undefined}><span>2</span>{text('Payment','ክፍያ')}</li></ol>
   {step==='entry'?<>
    <BidSheetPreview auction={known} publicDetailsReady={!!full} detailsReady={!!full&&!!state} showStatus={false}/>
    {active&&current?<>
     <div className={styles.inputHeading}><label className={styles.inputLabel} htmlFor={id}>{text('Your bid amount','የጨረታ መጠንዎ')}</label></div>
     <div className={ui.addRow}><div className={`${styles.amountInput} ${simple.amount}`}><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} disabled={frozen} value={input} placeholder={text('Enter your bid amount…','የጨረታ መጠንዎን ያስገቡ…')} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value)){setInput(event.target.value);setError('')}}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();add()}}} aria-invalid={!!input&&!!draft.error||undefined}/></div><button className={`${ui.add} ${simple.add}`} type="button" disabled={frozen||!input||!!draft.error} aria-label={text(editing===null?'Add bid amount':'Save bid amount',editing===null?'የጨረታ መጠን ጨምር':'የጨረታ መጠን ያስቀምጡ')} onClick={add}><Plus size={16} aria-hidden="true"/>{text(editing===null?'Add':'Save',editing===null?'ጨምር':'አስቀምጥ')}</button></div>
     <div className={styles.entryMeta}><p className={styles.range}>{text('From','ከ')} {bounds?.minPoints??'—'}{bounds?.maxPoints!==null?` – ${bounds?.maxPoints??'—'}`:''} · {text('Step','ልዩነት')} {bounds?.stepPoints??'—'}</p><span className={styles.remaining}>{Math.max(0,(rules?.remainingSubmissions??0)-selectedNumbers.length)} {text('left','ቀሪ')}</span></div>
     {!!numbers.length&&<div className={`${ui.chips} ${simple.chips}`} aria-label={text('Selected bid amounts','የተመረጡ የጨረታ መጠኖች')}>{numbers.map((number,index)=><span key={index} className={ui.chip}><button disabled={frozen} type="button" aria-label={text(`Edit ${number}`,`${number} ያስተካክሉ`)} onClick={()=>{setEditing(index);setInput(number);setError('')}}>{number}</button><button disabled={frozen} type="button" aria-label={text(`Remove ${number}`,`${number} ያስወግዱ`)} onClick={()=>{setNumbers(values=>values.filter((_,i)=>i!==index));setEditing(null);setInput('');setError('')}}><X size={13}/></button></span>)}</div>}
     <dl className={simple.draftSummary}><div><dt>{text('Bids selected','የተመረጡ ጨረታዎች')}</dt><dd>{selectedNumbers.length}</dd></div><div><dt>{text('Fee per bid','የአንድ ጨረታ ክፍያ')}</dt><dd>{formatEtb(terms.entryFeePoints)}</dd></div></dl>
     <div className={styles.earnedDiscount} data-active={applyCoupon} data-bid-coupons><Ticket size={18}/><strong>{text('Coupons','ኩፖኖች')} <span className={styles.couponCount}>{couponCount??'—'}</span></strong><button type="button" disabled={frozen||!applyCoupon&&(!state?.referralDiscountsAvailable||!couponCount)} onClick={()=>setApplyCoupon(value=>!value)}>{text(applyCoupon?'Remove':'Apply',applyCoupon?'አስወግድ':'ተግብር')}</button></div>
     {applyCoupon&&<p className={ui.draftNote}>{coupon?text(`${coupon.coupon!.percent}% off one bid fee.`,`${coupon.coupon!.percent}% ቅናሽ በአንድ ጨረታ ክፍያ።`):text(discount.fetching?'Checking coupon…':'No eligible coupon. Remove it or retry.',discount.fetching?'ኩፖን በመፈተሽ ላይ…':'ተስማሚ ኩፖን የለም። ያስወግዱ ወይም ይድገሙ።')}</p>}
    </>:<p className={ui.empty}>{text('This auction is not open for new bids.','ይህ ጨረታ ለአዲስ ጨረታዎች ክፍት አይደለም።')}</p>}
   </>:<>
    <div className={simple.reviewHeading}><div className={simple.reviewProduct}><div className={simple.reviewPhoto}><CatalogImage src={known.product.images[0]?.path} alt="" variant="thumbnail" sizes="48px"/></div><h3>{am?known.product.titleAm||known.product.title:known.product.title}</h3></div><button type="button" onClick={editBids}>{text('Edit bids','ጨረታዎችን ያስተካክሉ')}</button></div>

    <div className={simple.reviewNumbers} data-review-bids>{selectedNumbers.join(' · ')}</div>
    <dl className={simple.draftSummary}><div><dt>{text('Bids selected','የተመረጡ ጨረታዎች')}</dt><dd>{selectedNumbers.length}</dd></div><div><dt>{text('Fee per bid','የአንድ ጨረታ ክፍያ')}</dt><dd>{formatEtb(priced?.lines[0]?.grossFee??terms.entryFeePoints)}</dd></div>{priced&&priced.discountTotal!=='0.00'&&<div><dt>{text('Coupon discount','የኩፖን ቅናሽ')}</dt><dd>−{formatEtb(priced.discountTotal)}</dd></div>}</dl>
    {quoteBusy?<p className={simple.selectionHint} role="status">{text('Confirming your total…','ጠቅላላ ክፍያውን በማረጋገጥ ላይ…')}</p>:!priced&&<button type="button" className={styles.inlineRetry} onClick={()=>setQuoteRetry(value=>value+1)}>{text('Retry total','ጠቅላላ ክፍያውን ደግመው ይመልከቱ')}</button>}
    <fieldset className={simple.methods} disabled={frozen} data-funding-selector><legend><CreditCard size={14}/>{text('Select payment method','የክፍያ መንገድ ይምረጡ')}</legend><div className={simple.methodGrid}>
     {walletEnabled&&<label className={simple.method} data-selected={method==='wallet'} data-unavailable={insufficient||!!wallet.error} data-provider="wallet"><input type="radio" name={`${id}-method`} value="wallet" checked={method==='wallet'} disabled={insufficient||!!wallet.error} onChange={()=>{setMethod('wallet');setError('')}} aria-label={text('Wallet','ዋሌት')}/><Wallet size={22} aria-hidden="true"/><span><strong>{text('Wallet','ዋሌት')}</strong><small>{wallet.data?formatEtb(wallet.data.available):text('Loading…','በመጫን ላይ…')}</small></span>{method==='wallet'&&<Check className={simple.methodCheck} size={16} strokeWidth={2.5} aria-hidden="true"/>}</label>}
     {supportedProviders.map(provider=><label key={provider.slug} className={simple.method} data-selected={method===provider.slug} data-provider={provider.slug} data-unavailable={!zero&&!methodAvailable(provider.slug)}><input type="radio" name={`${id}-method`} value={provider.slug} checked={method===provider.slug} onChange={()=>{setMethod(provider.slug);setError('')}} disabled={!zero&&!methodAvailable(provider.slug)} aria-label={provider.name}/><img src={provider.image} alt="" width={32} height={27}/><strong>{provider.name}</strong>{method===provider.slug&&<Check className={simple.methodCheck} size={16} strokeWidth={2.5} aria-hidden="true"/>}</label>)}
    </div></fieldset>
    {external&&!zero&&<div className={simple.phone}><label htmlFor={`${id}-phone`}>{text('Payment phone number','የክፍያ ስልክ ቁጥር')}</label><div><span aria-hidden="true">+251</span><input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={18} disabled={frozen} value={phone} onChange={event=>{phoneEdited.current=true;setPhone(normalizePaymentPhone(event.target.value)?.slice(3)??event.target.value);setError('')}} placeholder="7•• / 9•• ••• •••" aria-invalid={!!phone&&!!phoneProblem||undefined} aria-describedby={phone&&phoneProblem?`${id}-phone-error`:`${id}-phone-note`}/></div>{phone&&phoneProblem?<p id={`${id}-phone-error`} className={styles.error} data-payment-phone-error role="alert">{paymentPhoneProblemMessage(phoneProblem,am)}</p>:<p id={`${id}-phone-note`} className={simple.selectionHint}>{text('You can use a different number for this payment.','ለዚህ ክፍያ ሌላ የስልክ ቁጥር መጠቀም ይችላሉ።')}</p>}</div>}
    {!method&&<p className={simple.selectionHint} role="status">{methods.error||availability.error?text('Payment methods could not load.','የክፍያ መንገዶችን ማምጣት አልተቻለም።'):!methods.data||!availability.data?text('Loading payment methods…','የክፍያ መንገዶች በመጫን ላይ…'):!supportedProviders.length&&!walletEnabled?text('Payments are currently unavailable.','ክፍያዎች ለጊዜው አይገኙም።'):text('Choose how to pay.','የክፍያ መንገድ ይምረጡ።')}{(methods.error||availability.error)&&<button className={styles.inlineRetry} type="button" onClick={()=>{methods.reload();availability.reload()}}>{text('Retry','እንደገና')}</button>}</p>}
    {method==='wallet'&&<p className={simple.selectionHint}>{insufficient?text('Your wallet balance is insufficient. Choose another method.','የዋሌት ቀሪ ሂሳብዎ በቂ አይደለም። ሌላ መንገድ ይምረጡ።'):text('The total will be paid from your Lowwin wallet.','ጠቅላላ ክፍያው ከLowwin ዋሌትዎ ይከፈላል።')}</p>}
    {method&&!enabled&&!zero&&<p className={styles.availability} role="status">{text('This method is unavailable for this total. Choose another.','ለዚህ ጠቅላላ ክፍያ ይህ መንገድ አይገኝም። ሌላ ይምረጡ።')}</p>}
    <p className={simple.security}><ShieldCheck size={14}/>{text('Only the submission fees are charged.','የሚከፈለው የማስገቢያ ክፍያው ብቻ ነው።')}</p>
   </>}
   <p className={styles.hint}>{text('Submission fees are non-refundable.','የማስገቢያ ክፍያዎች አይመለሱም።')}</p>
   {(error||payment.error||draft.error&&(!!input||step==='review'))&&<p className={styles.error} role="alert">{error||payment.error||(draft.error?text(...copy[draft.error]):'')}</p>}
   {own.error&&authenticated&&<p className={styles.error}>{text('Your bid limits could not load.','የጨረታ ገደቦችዎ መጫን አልተቻለም።')} <button className={styles.inlineRetry} onClick={own.reload}>{text('Retry','እንደገና')}</button></p>}
   {detail.error&&<p className={styles.error}>{text('Product details could not refresh.','የዕቃውን ዝርዝር ማደስ አልተቻለም።')} <button className={styles.inlineRetry} onClick={detail.reload}>{text('Retry','እንደገና')}</button></p>}
   {step==='review'&&wallet.error&&<p className={styles.error} role="status">{text('Balance could not refresh.','ቀሪ ሂሳቡን ማደስ አልተቻለም።')} <button className={styles.inlineRetry} type="button" onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
  </div>
 </>;
}
