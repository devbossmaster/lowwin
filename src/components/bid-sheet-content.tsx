'use client';
import Link from 'next/link';
import {useEffect,useId,useRef,useState} from 'react';
import {ChevronDown,Clock3,Plus,Ticket,Wallet,X} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import type {getOwnBidState} from '@/modules/auctions/bids';
import type {WalletBalance} from '@/modules/wallet/balance';
import type {getBidDiscountQuote} from '@/modules/referrals/service';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {etbToCents,formatEtb} from '@/lib/money';
import {normalizeBidDraft,previewBidFees,validateBidDraft,type BidBatchQuote,type BidBatchReceipt,type BidDraftError} from '@/lib/bid-batch-client';
import {ChapaClientError,requestChapaJson,type ChapaAvailability} from '@/lib/chapa-client';
import {usableBidDiscount} from '@/lib/bid-discount-preview';
import {bidWalletSubmissionRejected,clearBidWalletRecovery,readBidWalletRecovery,retainBidWalletRecovery} from '@/lib/bid-wallet-recovery';
import {readHostedChapaAttempt,retainHostedChapaAttempt} from '@/lib/chapa-hosted-attempt';
import {AccountSheetFooter} from './account-sheet';
import {AuctionCountdown} from './auction-countdown';
import {BidSheetPreview,isFullAuction,type BidSheetAuction} from './bid-sheet-preview';
import type {BidSheetPhase} from './bid-sheet';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {usePublicQuery} from './public-query';
import {useTelegram} from './telegram-provider';
import {confirmedBidQueryScopes,getMiniQueryClient,invalidatePrivateQueries,isPrivateQueryIdentity} from './private-query-cache';
import {useChapaPayment} from './chapa-payment';
import {HostedCheckoutStatus} from './hosted-checkout-status';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {prepareChapaNavigation} from '@/lib/chapa-navigation';
import {auctionDetailUrl} from './auction-query';
import styles from './bid-payment-sheet.module.css';
import ui from './batch-checkout.module.css';
import simple from './simple-bid-checkout.module.css';

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
 const own=usePrivateQuery<BidState>('/api/auctions/'+auction.slug+'/bids');
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000});
 const availability=usePrivateQuery<ChapaAvailability>('/api/payments/chapa',{freshnessMs:15000});
 const payment=useChapaPayment('bid:'+auction.slug,initialChapaId,{retainOriginal:true}),state=own.data,terms=state?.terms??known.terms;
 const walletRecovery=queryIdentity?readBidWalletRecovery(getMiniQueryClient(),queryIdentity,auction.slug):null;
 const savedHosted=queryIdentity?readHostedChapaAttempt(getMiniQueryClient(),queryIdentity,'bid:'+auction.slug):null;
 const savedQuote=savedHosted?.bidQuote?.auctionSlug===auction.slug?savedHosted.bidQuote:null;
 const [input,setInput]=useState(''),[numbers,setNumbers]=useState<string[]>(initialDraft?.numbers??walletRecovery?.lines.map(line=>line.number)??savedQuote?.lines.map(line=>line.number)??[]),[editing,setEditing]=useState<number|null>(null);
 const [quote,setQuote]=useState<BidBatchQuote|null>(walletRecovery??savedQuote),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [receipt,setReceipt]=useState<BidBatchReceipt|null>(null),[applyCoupon,setApplyCoupon]=useState(false),[walletRetry,setWalletRetry]=useState(!!walletRecovery);
 const id=useId(),lock=useRef(false),generation=useRef(0),controllers=useRef(new Set<AbortController>());
 const quoteAttempt=useRef<{fingerprint:string;key:string;quote?:BidBatchQuote;paymentKey:string}|null>(walletRecovery?{fingerprint:'',key:walletRecovery.id,paymentKey:walletRecovery.id,quote:walletRecovery}:null);
 const authenticated=!!queryIdentity,active=known.status==='live'&&(!state||state.open),current=isSubmissionFeeOnly(terms.ruleVersion);
 const discount=usePrivateQuery<DiscountQuote>('/api/auctions/'+auction.slug+'/discount-quote?feeVersion='+terms.version,{enabled:authenticated&&!!state?.referralDiscountsAvailable&&applyCoupon});
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
 const total=priced?.total??preview.total,totalCents=etbToCents(total),zero=totalCents===0n,frozen=busy||walletRetry;
 const insufficient=!zero&&(!wallet.data||etbToCents(wallet.data.available)<totalCents);
 const canPrepare=!!bounds&&active&&current&&!frozen&&!!draft.numbers.length&&!draft.error&&(!authenticated||!!state)&&(!applyCoupon||!!coupon&&!discount.fetching);
 const hostedWithinLimits=zero||totalCents>=100n&&totalCents<=4320000n;
 const canHosted=canPrepare&&hostedWithinLimits&&(!authenticated||!!availability.data?.enabled||zero);
 const canWallet=canPrepare&&authenticated&&(!!availability.data?.walletBidsEnabled||zero)&&(!insufficient||zero)&&(!wallet.error||zero);
 const copy:Record<BidDraftError,[string,string]>={precision:['Enter a number with at most two decimals.','እስከ ሁለት አስርዮሽ ያለው ቁጥር ያስገቡ።'],range:['Choose an amount within the displayed range and step.','በሚታየው ክልል እና ልዩነት ውስጥ መጠን ይምረጡ።'],duplicate:['This amount is already selected or submitted.','ይህ መጠን ተመርጧል ወይም ቀድሞ ቀርቧል።'],consecutive:['Only 3 consecutive amounts. Skip at least one step.','ከሦስት በላይ ተከታታይ ቁጥሮች አይፈቀዱም።'],limit:['You have reached the remaining submission limit.','የቀሩትን የጨረታ ገደብ ደርሰዋል።']};
 useEffect(()=>{const version=++generation.current;return()=>{if(generation.current===version)generation.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear()}},[queryIdentity]);
 useEffect(()=>{onPhaseChange(receipt?'receipt':walletRetry||payment.started?'payment':'entry')},[receipt,walletRetry,payment.started,onPhaseChange]);
 useEffect(()=>{onDismissChange?.(null);return()=>onDismissChange?.(null)},[onDismissChange]);
 useEffect(()=>{
  if(!payment.started&&payment.errorCode&&['QUOTE_CHANGED','STALE_QUOTE','COUPON_UNAVAILABLE','TERMS_CHANGED'].includes(payment.errorCode)){setQuote(null);quoteAttempt.current=null;own.reload();if(payment.errorCode==='TERMS_CHANGED')detail.reload()}
 },[payment.started,payment.errorCode]);
 const add=()=>{if(frozen)return;if(draft.error){setError(text(...copy[draft.error]));return}if(!input)return;setNumbers(draft.numbers);setInput('');setEditing(null);setError('')};

 // The only external payment action freezes a server quote, then opens Chapa.
 // Wallet submissions keep their original quote/hash on uncertain responses.
 const pay=async(mode:'hosted'|'wallet')=>{
  if(lock.current)return;
  if(!queryIdentity){openRegistration();return}
  if(!recoveryQuote&&!(mode==='wallet'?canWallet:canHosted))return;
  const attempt=recoveryQuote?quoteAttempt.current:quoteAttempt.current?.fingerprint===fingerprint?quoteAttempt.current:{fingerprint,key:crypto.randomUUID(),paymentKey:crypto.randomUUID(),quote:undefined as BidBatchQuote|undefined};
  if(!attempt)return;
  quoteAttempt.current=attempt;
  const version=generation.current,controller=new AbortController(),navigation=mode==='hosted'&&!zero?prepareChapaNavigation():null;controllers.current.add(controller);
  lock.current=true;setBusy(true);setError('');let walletSubmitted=false;
  try{
   const confirmedQuote=attempt.quote??await requestChapaJson<BidBatchQuote>('/api/payments/chapa/batches/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,key:attempt.key})},controller.signal);
   if(generation.current!==version||!isPrivateQueryIdentity(queryIdentity))return;
   attempt.quote=confirmedQuote;setQuote(confirmedQuote);
   setNumbers(confirmedQuote.lines.map(line=>line.number));setInput('');setEditing(null);
   if(!recoveryQuote&&etbToCents(confirmedQuote.total)!==totalCents){setError(text('The fee changed. Review the updated total and tap Pay again.','ክፍያው ተቀይሯል። የዘመነውን ጠቅላላ ክፍያ ይመልከቱና እንደገና ይክፈሉ።'));return}
   if(recoveryQuote||etbToCents(confirmedQuote.total)===0n||mode==='wallet'){
    walletSubmitted=true;retainBidWalletRecovery(getMiniQueryClient(),queryIdentity,confirmedQuote);
    const accepted=await requestChapaJson<BidBatchReceipt>('/api/payments/chapa/batches/'+confirmedQuote.id+'/wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteHash:confirmedQuote.quoteHash})},controller.signal);
    if(generation.current===version&&isPrivateQueryIdentity(queryIdentity)){clearBidWalletRecovery(getMiniQueryClient(),queryIdentity,confirmedQuote);setReceipt(accepted);setWalletRetry(false);invalidatePrivateQueries(queryIdentity,confirmedBidQueryScopes(auction.slug));void refreshMe().catch(()=>{})}
   }else{
    const intent={key:attempt.paymentKey,purpose:'BID' as const,batchId:confirmedQuote.id,quoteHash:confirmedQuote.quoteHash};
    retainHostedChapaAttempt(getMiniQueryClient(),queryIdentity,'bid:'+auction.slug,{version:1,intent},confirmedQuote);
    await payment.create(intent,navigation??undefined);
   }
  }catch(cause){
   if(generation.current===version){
    const rejected=bidWalletSubmissionRejected(cause);
    if(walletSubmitted&&rejected&&attempt.quote){clearBidWalletRecovery(getMiniQueryClient(),queryIdentity,attempt.quote);setWalletRetry(false);setQuote(null);quoteAttempt.current=null}
    if(walletSubmitted&&!rejected)setWalletRetry(true);
    setError(cause instanceof ChapaClientError?cause.message:text(walletSubmitted?'Connection interrupted. Retry this same wallet submission.':'Could not prepare checkout. Please retry.','ግንኙነቱ ተቋርጧል። ይህንኑ ጥያቄ እንደገና ይሞክሩ።'));
    if(cause instanceof ChapaClientError&&['QUOTE_CHANGED','STALE_QUOTE','COUPON_UNAVAILABLE','RETRYABLE_CONFLICT','TERMS_CHANGED'].includes(cause.code)){setQuote(null);quoteAttempt.current=null;setWalletRetry(false)}
    own.reload();wallet.reload();if(applyCoupon)discount.reload();
   }
  }finally{navigation?.cancel();controllers.current.delete(controller);if(generation.current===version){lock.current=false;setBusy(false)}}
 };
 const startNewBidPayment=async()=>{
  if(!payment.canStartAgain||!bidPaymentCanRetry(payment.order))return;
  const reconciled=await payment.check();if(!reconciled||!bidPaymentCanRetry(reconciled))return;
  const selection=payment.order?.batch?.lines.map(line=>line.number)??quote?.lines.map(line=>line.number)??(payment.order?.bidNumber?[payment.order.bidNumber]:draft.numbers);
  payment.startAgain();setQuote(null);quoteAttempt.current=null;setWalletRetry(false);setNumbers(selection);setInput('');setEditing(null);setError('');own.reload();if(applyCoupon)discount.reload();
 };
 if(receipt)return <section className={styles.paymentStatus}><h3>{text('Bids accepted','ጨረታዎች ተቀብለዋል')}</h3><p className={styles.paymentTotal}>{formatEtb(receipt.batch.total)}</p><p>{receipt.batch.lines.map(line=>line.number).join(' · ')}</p><Link className={styles.payButton} href="/my-bids" onClick={onClose}>{text('View My Bids','የእኔ ጨረታዎች')}</Link></section>;
 if(payment.started)return <HostedCheckoutStatus payment={payment} onClose={onClose} onStartAgain={()=>void startNewBidPayment()}/>;
 if(walletRetry)return <section className={styles.paymentStatus}><h3>{text('Check your wallet submission','የዋሌት ጨረታዎን ያረጋግጡ')}</h3><p>{text('The original submission is saved. Retry it to confirm the outcome.','የመጀመሪያው ጥያቄ ተቀምጧል። ውጤቱን ለማረጋገጥ ያንኑ ይድገሙ።')}</p>{error&&<p role="alert" className={styles.error}>{error}</p>}<button className={styles.payButton} disabled={busy} onClick={()=>void pay('wallet')}>{text('Check submission','ጥያቄውን ያረጋግጡ')}</button><button className={styles.checkPayment} onClick={onClose}>{text('Close','ዝጋ')}</button></section>;
 return <>
  <AccountSheetFooter>
   <div className={simple.total} data-bid-total aria-live="polite"><span>{text(selectedNumbers.length+' bid'+(selectedNumbers.length===1?'':'s'),selectedNumbers.length+' ጨረታዎች')}{(priced?.discountTotal??preview.discountTotal)!=='0.00'&&<small>{text('Coupon applied','ኩፖን ተተግብሯል')}</small>}</span><strong>{formatEtb(total)}</strong></div>
   <button type="button" className={[styles.payButton,simple.pay].join(' ')} data-bid-continue disabled={!canHosted} onClick={()=>void pay('hosted')}>{text(busy?'Preparing checkout…':zero?'Submit bids':'Pay with Chapa',busy?'ክፍያ በማዘጋጀት ላይ…':zero?'ጨረታዎችን ያቅርቡ':'በChapa ይክፈሉ')}</button>
   {authenticated&&!zero&&availability.data?.walletBidsEnabled&&<button type="button" className={styles.checkPayment} disabled={!canWallet} onClick={()=>void pay('wallet')}><Wallet size={15} aria-hidden="true"/>{text('Pay '+formatEtb(total)+' from wallet','ከዋሌት '+formatEtb(total)+' ይክፈሉ')}</button>}
   {authenticated&&availability.data&&!availability.data.enabled&&!zero&&<p className={styles.availability}>{text('Chapa checkout is currently unavailable.','የChapa ክፍያ ለጊዜው አይገኝም።')}</p>}
   {!hostedWithinLimits&&<p className={styles.availability}>{text(totalCents<100n?'Use your wallet for a fee below ETB 1.00.':'Split this selection into a smaller order for Chapa.',totalCents<100n?'ከ1.00 ብር በታች ለሆነ ክፍያ ዋሌትዎን ይጠቀሙ።':'ለChapa ይህን ምርጫ ወደ ትንንሽ ትዕዛዞች ይክፈሉ።')}</p>}
   {busy&&<p role="status" className={styles.hint}>{text('Preparing your payment…','ክፍያዎን በማዘጋጀት ላይ…')}</p>}
  </AccountSheetFooter>
  <div className={`${styles.bidEntry} ${simple.entry}`} data-bid-entry data-bid-step="entry">
   <BidSheetPreview auction={known} publicDetailsReady={!!full} detailsReady={!!full&&!!state} showStatus={false}/>
   {description&&<details className={simple.description}><summary><span>{description}</span><b>{text('Product details','የዕቃው ዝርዝር')}<ChevronDown size={13} aria-hidden="true"/></b></summary><p>{description}</p></details>}
   <div className={simple.auctionFacts}><span><Ticket size={14} aria-hidden="true"/><strong>{known.bidCount}</strong> {text('bids','ጨረታዎች')}</span><span><Clock3 size={14} aria-hidden="true"/><AuctionCountdown target={known.endsAt} serverNow={serverNow} label="Ends" showLabel={false} onElapsed={()=>{detail.reload();if(authenticated)own.reload()}}/></span></div>
   {active&&current?<>
    <div className={styles.inputHeading}><label className={styles.inputLabel} htmlFor={id}>{text('Your bid amount','የጨረታ መጠንዎ')}</label></div>
    <div className={ui.addRow}><div className={`${styles.amountInput} ${simple.amount}`}><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} disabled={frozen} value={input} placeholder={text('Enter your bid amount…','የጨረታ መጠንዎን ያስገቡ…')} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value)){setInput(event.target.value);setError('')}}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();add()}}} aria-invalid={!!input&&!!draft.error||undefined}/></div><button className={`${ui.add} ${simple.add}`} type="button" disabled={frozen||!input||!!draft.error} aria-label={text(editing===null?'Add bid amount':'Save bid amount',editing===null?'የጨረታ መጠን ጨምር':'የጨረታ መጠን ያስቀምጡ')} onClick={add}><Plus size={16} aria-hidden="true"/>{text(editing===null?'Add':'Save',editing===null?'ጨምር':'አስቀምጥ')}</button></div>
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
