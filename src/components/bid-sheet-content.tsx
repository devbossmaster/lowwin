'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {Check,ChevronDown,Clock3,CreditCard,Plus,Ticket,Wallet,X} from 'lucide-react';
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
import {AccountSheetFooter} from './account-sheet';
import {BidSheetPreview,isFullAuction,type BidSheetAuction} from './bid-sheet-preview';
import type {BidSheetPhase} from './bid-sheet';
import {AuctionCountdown} from './auction-countdown';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {usePublicQuery} from './public-query';
import {useTelegram} from './telegram-provider';
import {confirmedBidQueryScopes,invalidatePrivateQueries,isPrivateQueryIdentity} from './private-query-cache';
import {useChapaPayment} from './chapa-payment';
import BidPaymentProgress from './bid-payment-progress';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {WalletTopUpTrigger} from './wallet-top-up-trigger';
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
type BidState=Omit<Awaited<ReturnType<typeof getOwnBidState>>,'wallet'|'previousMax'>&{referralDiscountsAvailable?:boolean;couponAvailableCount?:number|null};
type DiscountQuote=Awaited<ReturnType<typeof getBidDiscountQuote>>;
type Props={auction:BidSheetAuction;serverNow:string;onClose:()=>void;onPhaseChange:(phase:BidSheetPhase)=>void;initialChapaId?:string};

export default function BidSheetContents({auction,serverNow,onClose,onPhaseChange,initialChapaId}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity,refreshMe,openRegistration}=useTelegram(),initialFull=isFullAuction(auction)?auction:undefined;
 const detail=usePublicQuery<CatalogAuction>(auctionDetailUrl(auction.slug),{initialData:initialFull});
 const full=(detail.data?.slug===auction.slug?detail.data:undefined)??initialFull,known=full??auction;
 const own=usePrivateQuery<BidState>(`/api/auctions/${auction.slug}/bids`);
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000});
 const availability=usePrivateQuery<ChapaAvailability>('/api/payments/chapa',{freshnessMs:15000});
 const payment=useChapaPayment('bid:'+auction.slug,initialChapaId),state=own.data,terms=state?.terms??known.terms;
 const [input,setInput]=useState(''),[numbers,setNumbers]=useState<string[]>([]),[editing,setEditing]=useState<number|null>(null);
 const [method,setMethod]=useState<Method|null>(null),[phone,setPhone]=useState('');
 const [quote,setQuote]=useState<BidBatchQuote|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [receipt,setReceipt]=useState<BidBatchReceipt|null>(null),[expanded,setExpanded]=useState(false),[applyCoupon,setApplyCoupon]=useState(false),[walletRetry,setWalletRetry]=useState(false);
 const id=useId(),lock=useRef(false),generation=useRef(0),controllers=useRef(new Set<AbortController>());
 const quoteAttempt=useRef<{fingerprint:string;key:string;quote?:BidBatchQuote;paymentKey:string}|null>(null);
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
 const description=full?(am?full.product.descriptionAm||full.product.description:full.product.description):null;
 const refreshEnded=useCallback(()=>{own.reload();detail.reload()},[own.reload,detail.reload]);
 useEffect(()=>{const version=++generation.current;return()=>{if(generation.current===version)generation.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear()}},[queryIdentity]);
 useEffect(()=>{onPhaseChange(receipt?'receipt':busy||walletRetry||payment.started?'payment':'entry')},[receipt,busy,walletRetry,payment.started,onPhaseChange]);
 // These codes are definitive pre-creation rejections, not uncertain charges.
 // The hook preserves all transport/server ambiguities on their original key.
 useEffect(()=>{
  if(payment.started||!['TERMS_CHANGED','COUPON_UNAVAILABLE'].includes(payment.errorCode??''))return;
  setQuote(null);quoteAttempt.current=null;own.reload();if(applyCoupon)discount.reload();
 },[payment.errorCode,payment.started,own.reload,discount.reload,applyCoupon]);
 const add=()=>{if(frozen)return;if(draft.error){setError(text(...copy[draft.error]));return}if(!input)return;setNumbers(draft.numbers);setInput('');setEditing(null);setError('')};
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

 // One explicit Pay action obtains an immutable quote before any debit/request.
 // An unexpected server total is shown first and needs another explicit tap.
 const pay=async()=>{
  if(lock.current)return;
  if(!queryIdentity){openRegistration();return}
  if(!recoveryQuote){
   if(draft.error||!draft.numbers.length){setError(draft.error?text(...copy[draft.error]):text('Add at least one bid amount.','ቢያንስ አንድ የጨረታ መጠን ያስገቡ።'));return}
   if(!state||method===null||!enabled||!active||!current||!zero&&(method==='wallet'?insufficient||!!wallet.error:!normalizedPhone))return;
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
    const accepted=await requestChapaJson<BidBatchReceipt>(`/api/payments/chapa/batches/${confirmedQuote.id}/wallet`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteHash:confirmedQuote.quoteHash})},controller.signal);
    if(generation.current===version&&isPrivateQueryIdentity(queryIdentity)){setReceipt(accepted);setWalletRetry(false);invalidatePrivateQueries(queryIdentity,confirmedBidQueryScopes(auction.slug));void refreshMe().catch(()=>{})}
   }else{
    await payment.createDirect({key:attempt.paymentKey,purpose:'BID',batchId:confirmedQuote.id,quoteHash:confirmedQuote.quoteHash,paymentMethod:method!,phone:normalizedPhone!});
   }
  }catch(cause){
   if(generation.current===version){
    const rejected=cause instanceof ChapaClientError&&cause.status>=400&&cause.status<500;
    if(walletSubmitted&&!rejected)setWalletRetry(true);
    setError(cause instanceof ChapaClientError?cause.message:text(walletSubmitted?'Connection interrupted. Retry this same payment to confirm the result.':'Could not prepare your bids. Please retry.','ግንኙነቱ ተቋርጧል። ይህንኑ ጥያቄ እንደገና ይሞክሩ።'));
    if(cause instanceof ChapaClientError&&['QUOTE_CHANGED','STALE_QUOTE','COUPON_UNAVAILABLE','RETRYABLE_CONFLICT','TERMS_CHANGED'].includes(cause.code)){setQuote(null);quoteAttempt.current=null;setWalletRetry(false)}
    own.reload();wallet.reload();discount.reload();
   }
  }finally{controllers.current.delete(controller);if(generation.current===version){lock.current=false;setBusy(false)}}
 };
 const startNewBidPayment=()=>{
  if(!payment.canStartAgain||!bidPaymentCanRetry(payment.order))return;
  const previous=quote??payment.order?.batch;
  const selection=previous?.lines.map(line=>line.number)??(payment.order?.bidNumber?[payment.order.bidNumber]:draft.numbers);
  payment.startAgain();setQuote(null);quoteAttempt.current=null;setWalletRetry(false);
  setNumbers(selection);setInput('');setEditing(null);setError('');own.reload();if(applyCoupon)discount.reload();
 };
 if(receipt||busy||walletRetry||payment.started)return <BidPaymentProgress payment={payment} preparing={busy} walletRetry={walletRetry} receipt={receipt} error={error} summary={{auctionTitle:known.product.title,auctionTitleAm:known.product.titleAm,numbers:quote?.lines.map(line=>line.number)??selectedNumbers,total:quote?.total??total,provider:zero?'coupon':method,phone:external?phone:null}} onRetry={startNewBidPayment} onRetryWallet={()=>void pay()} onRetryOriginal={()=>void retryOriginalDirect()} onClose={onClose}/>;

 return <>
  <AccountSheetFooter><div className={simple.total} data-bid-total aria-live="polite"><span>{text(`${selectedNumbers.length} bid${selectedNumbers.length===1?'':'s'}`,`${selectedNumbers.length} ጨረታዎች`)}{(priced?.discountTotal??preview.discountTotal)!=='0.00'&&<small>{text(' · coupon applied',' · ኩፖን ተተግብሯል')}</small>}</span><strong>{formatEtb(total)}</strong></div><button className={`${styles.payButton} ${simple.pay}`} data-payment-action disabled={!bounds||!active||!current||!draft.numbers.length||!!draft.error||authenticated&&(!state||!enabled||!zero&&(method==='wallet'?insufficient||!!wallet.error:!normalizedPhone))||applyCoupon&&(!coupon||discount.fetching)} onClick={()=>void pay()}>{!authenticated?text('Log in to bid','ለመጫረት ይግቡ'):text(zero&&selectedNumbers.length?'Submit bids':`Pay ${formatEtb(total)} & bid`,zero&&selectedNumbers.length?'ጨረታዎችን ያቅርቡ':`${formatEtb(total)} ይክፈሉና ይጫረቱ`)}</button></AccountSheetFooter>
  <div className={`${styles.bidEntry} ${simple.entry}`} data-bid-entry>
   <BidSheetPreview auction={known} publicDetailsReady={!!full} detailsReady={!!full&&!!state} showStatus={false}/>
   <section className={`${styles.productDescription} ${simple.description}`} data-bid-description aria-label={text('Product description','የዕቃው መግለጫ')}><p data-expanded={expanded}>{description??text('Loading description…','መግለጫው በመጫን ላይ…')}</p><button type="button" disabled={!description} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{text(expanded?'Show less':'Show more',expanded?'ያሳንሱ':'ተጨማሪ ያሳዩ')}<ChevronDown size={12}/></button></section>
   <div className={`${styles.feeStrip} ${simple.fee}`} data-bid-fee-summary><div data-bid-fee><small>{text('Submission fee · each bid','የማስገቢያ ክፍያ · በአንድ ጨረታ')}</small><strong>{formatEtb(terms.entryFeePoints)}</strong></div><span className={styles.bidCount} data-bid-count><Ticket size={15}/><strong>{known.bidCount.toLocaleString()}</strong> {text('bids','ጨረታዎች')}</span><span className={styles.feeTiming} data-bid-timer><span className={simple.timerLabel}><Clock3 size={14}/>{text('Closes in','የቀረው ጊዜ')}</span><AuctionCountdown target={known.endsAt} serverNow={state?.serverNow??serverNow} observedAt={state?own.updatedAt:undefined} label="Ends" showLabel={false} onElapsed={refreshEnded}/></span></div>
   {active&&current?<>
    <div className={styles.inputHeading}><label className={styles.inputLabel} htmlFor={id}>{text('Your bid amount','የጨረታ መጠንዎ')}</label>{wallet.data&&<span className={styles.inlineBalance} data-bid-balance><Wallet size={13}/><strong>{wallet.data.available} ETB</strong></span>}</div>
    <div className={ui.addRow}><div className={styles.amountInput}><span aria-hidden="true">ETB</span><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} disabled={frozen} value={input} placeholder={text('Enter your bid amount…','የጨረታ መጠንዎን ያስገቡ…')} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value)){setInput(event.target.value);setError('')}}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();add()}}} aria-invalid={!!input&&!!draft.error||undefined}/></div><button className={`${ui.add} ${simple.add}`} type="button" disabled={frozen||!input||!!draft.error} aria-label={text(editing===null?'Add bid amount':'Save bid amount',editing===null?'የጨረታ መጠን ጨምር':'የጨረታ መጠን ያስቀምጡ')} onClick={add}><Plus size={16} aria-hidden="true"/>{text(editing===null?'Add':'Save',editing===null?'ጨምር':'አስቀምጥ')}</button></div>
    <div className={styles.entryMeta}><p className={styles.range}>{text('From','ከ')} {bounds?.minPoints??'—'}{bounds?.maxPoints!==null?` – ${bounds?.maxPoints??'—'}`:''} · {text('Step','ልዩነት')} {bounds?.stepPoints??'—'}</p><span className={styles.remaining} data-bid-remaining>{Math.max(0,(rules?.remainingSubmissions??0)-selectedNumbers.length)} {text('left','ቀሪ')}</span></div>
    {!!numbers.length&&<div className={`${ui.chips} ${simple.chips}`} aria-label={text('Selected bid amounts','የተመረጡ የጨረታ መጠኖች')}>{numbers.map((number,index)=><span key={index} className={ui.chip}><button disabled={frozen} type="button" aria-label={text(`Edit ${number}`,`${number} ያስተካክሉ`)} onClick={()=>{setEditing(index);setInput(number);setError('')}}>{number}</button><button disabled={frozen} type="button" aria-label={text(`Remove ${number}`,`${number} ያስወግዱ`)} onClick={()=>{setNumbers(values=>values.filter((_,i)=>i!==index));setEditing(null);setInput('');setError('')}}><X size={13}/></button></span>)}</div>}
    <div className={styles.earnedDiscount} data-active={applyCoupon} data-bid-coupons><Ticket size={20}/><strong>{text('Coupons','ኩፖኖች')} <span className={styles.couponCount}>{couponCount??'—'}</span></strong><button type="button" disabled={frozen||!applyCoupon&&(!state?.referralDiscountsAvailable||!couponCount)} onClick={()=>setApplyCoupon(value=>!value)}>{text(applyCoupon?'Remove':'Apply',applyCoupon?'አስወግድ':'ተግብር')}</button></div>
    {applyCoupon&&<p className={ui.draftNote}>{coupon?text(`${coupon.coupon!.percent}% off one bid fee.`,`${coupon.coupon!.percent}% ቅናሽ በአንድ ጨረታ ክፍያ።`):text(discount.fetching?'Checking coupon…':'No eligible coupon. Remove it or retry.',discount.fetching?'ኩፖን በመፈተሽ ላይ…':'ተስማሚ ኩፖን የለም። ያስወግዱ ወይም ይድገሙ።')}</p>}

    <fieldset className={simple.methods} disabled={frozen} data-funding-selector><legend><CreditCard size={14}/>{text('Select payment method','የክፍያ መንገድ ይምረጡ')}</legend><div className={simple.methodGrid}>
     {supportedProviders.map(provider=><label key={provider.slug} className={simple.method} data-selected={method===provider.slug} data-provider={provider.slug} data-unavailable={!zero&&!methodAvailable(provider.slug)}><input type="radio" name={`${id}-method`} value={provider.slug} checked={method===provider.slug} onChange={()=>{setMethod(provider.slug);setError('')}} disabled={!zero&&!methodAvailable(provider.slug)} aria-label={provider.name}/><img src={provider.image} alt="" width={32} height={27}/><strong>{provider.name}</strong>{method===provider.slug&&<Check className={simple.methodCheck} size={16} strokeWidth={2.5} aria-hidden="true"/>}</label>)}
     {walletEnabled&&<label className={simple.method} data-selected={method==='wallet'} data-provider="wallet"><input type="radio" name={`${id}-method`} value="wallet" checked={method==='wallet'} onChange={()=>{setMethod('wallet');setError('')}} aria-label={text('Wallet','ዋሌት')}/><Wallet size={22} aria-hidden="true"/><strong>{text('Wallet','ዋሌት')}</strong>{method==='wallet'&&<Check className={simple.methodCheck} size={16} strokeWidth={2.5} aria-hidden="true"/>}</label>}
    </div></fieldset>
    {external&&(!selectedNumbers.length||!zero)&&<div className={simple.phone}><label htmlFor={`${id}-phone`}>{text('Payment phone number','የክፍያ ስልክ ቁጥር')}</label><div><span aria-hidden="true">+251</span><input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="off" maxLength={18} disabled={frozen} value={phone} onChange={event=>{setPhone(normalizePaymentPhone(event.target.value)?.slice(3)??event.target.value);setError('')}} placeholder="7•• / 9•• ••• •••" aria-invalid={!!phone&&!!phoneProblem||undefined} aria-describedby={phone&&phoneProblem?`${id}-phone-error`:undefined}/></div>{phone&&phoneProblem&&<p id={`${id}-phone-error`} className={styles.error} data-payment-phone-error role="alert">{paymentPhoneProblemMessage(phoneProblem,am)}</p>}</div>}
    {!method&&<p className={simple.selectionHint} role="status">{!authenticated?text('Log in to choose a payment method.','የክፍያ መንገድ ለመምረጥ ይግቡ።'):methods.error||availability.error?text('Payment methods could not load.','የክፍያ መንገዶችን ማምጣት አልተቻለም።'):!methods.data||!availability.data?text('Loading payment methods…','የክፍያ መንገዶች በመጫን ላይ…'):!supportedProviders.length&&!walletEnabled?text('Payments are currently unavailable.','ክፍያዎች ለጊዜው አይገኙም።'):text('Choose how to pay.','የክፍያ መንገድ ይምረጡ።')}{(methods.error||availability.error)&&<button className={styles.inlineRetry} type="button" onClick={()=>{methods.reload();availability.reload()}}>{text('Retry','እንደገና')}</button>}</p>}
    {method==='wallet'&&authenticated&&<p className={simple.walletHelp}>{insufficient?text('Need more balance?','ተጨማሪ ቀሪ ሂሳብ ይፈልጋሉ?'):text('Pay with your Lowwin balance.','በLowwin ቀሪ ሂሳብዎ ይክፈሉ።')} <WalletTopUpTrigger disabled={frozen} ariaLabel={text('Top up wallet','ወደ ዋሌት ገንዘብ ያስገቡ')}>{text('Top up','ገንዘብ ያስገቡ')} <Plus size={14}/></WalletTopUpTrigger></p>}
    <p className={styles.hint}>{text('Only the bid fee is charged. Submission fees are non-refundable.','የሚከፈለው የጨረታ ክፍያ ብቻ ነው። የማስገቢያ ክፍያዎች አይመለሱም።')}</p>
    {authenticated&&method&&!enabled&&!zero&&<p className={styles.availability} role="status">{external&&availability.data?.enabled?text(methods.data?'This method is unavailable for this total. Choose another.':'Loading payment methods…',methods.data?'ለዚህ ጠቅላላ ክፍያ ይህ መንገድ አይገኝም። ሌላ ይምረጡ።':'የክፍያ መንገዶች በመጫን ላይ…'):text('Payments are currently unavailable.','ክፍያዎች በአሁኑ ጊዜ አይገኙም።')}{(methods.error||availability.error)&&<button type="button" className={styles.inlineRetry} onClick={()=>{methods.reload();availability.reload()}}>{text('Retry','እንደገና')}</button>}</p>}
   </>:<p className={ui.empty}>{text('This auction is not open for new bids.','ይህ ጨረታ ለአዲስ ጨረታዎች ክፍት አይደለም።')}</p>}
   {(error||payment.error||input&&draft.error)&&<p className={styles.error} role="alert">{error||payment.error||(draft.error?text(...copy[draft.error]):'')}</p>}
   {own.error&&authenticated&&<p className={styles.error}>{text('Your bid limits could not load.','የጨረታ ገደቦችዎ መጫን አልተቻለም።')} <button className={styles.inlineRetry} onClick={own.reload}>{text('Retry','እንደገና')}</button></p>}
   {detail.error&&<p className={styles.error}>{text('Product details could not refresh.','የዕቃውን ዝርዝር ማደስ አልተቻለም።')} <button className={styles.inlineRetry} onClick={detail.reload}>{text('Retry','እንደገና')}</button></p>}
   {wallet.error&&<p className={styles.error} role="status">{text('Balance could not refresh.','ቀሪ ሂሳቡን ማደስ አልተቻለም።')} <button className={styles.inlineRetry} type="button" onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
  </div>
 </>;
}
