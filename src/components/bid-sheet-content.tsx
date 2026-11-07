'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {ArrowLeft,ChevronDown,Clock3,CreditCard,LoaderCircle,Plus,Ticket,Wallet,X} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import type {getOwnBidState} from '@/modules/auctions/bids';
import type {WalletBalance} from '@/modules/wallet/balance';
import type {getBidDiscountQuote} from '@/modules/referrals/service';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {etbToCents,formatEtb} from '@/lib/money';
import {normalizeBidDraft,validateBidDraft,type BidBatchQuote,type BidBatchReceipt,type BidDraftError} from '@/lib/bid-batch-client';
import {ChapaClientError,requestChapaJson,type ChapaAvailability} from '@/lib/chapa-client';
import {usableBidDiscount} from '@/lib/bid-discount-preview';
import {AccountSheetFooter} from './account-sheet';
import {BidSheetPreview,isFullAuction,type BidSheetAuction} from './bid-sheet-preview';
import type {BidSheetPhase} from './bid-sheet';
import {AuctionCountdown} from './auction-countdown';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {usePublicQuery} from './public-query';
import {useTelegram} from './telegram-provider';
import {confirmedBidQueryScopes,invalidatePrivateQueries,isPrivateQueryIdentity} from './private-query-cache';
import {ChapaPaymentStatus,useChapaPayment} from './chapa-payment';
import {HostedPaymentLogos} from './hosted-payment-logos';
import {WalletTopUpTrigger} from './wallet-top-up-trigger';
import {auctionDetailUrl} from './auction-query';
import styles from './bid-payment-sheet.module.css';
import ui from './batch-checkout.module.css';
const DirectCheckout=dynamic(()=>import('./direct-checkout'),{ssr:false});
type BidState=Omit<Awaited<ReturnType<typeof getOwnBidState>>,'wallet'|'previousMax'>&{referralDiscountsAvailable?:boolean;couponAvailableCount?:number|null};
type DiscountQuote=Awaited<ReturnType<typeof getBidDiscountQuote>>;
type Props={auction:BidSheetAuction;serverNow:string;onClose:()=>void;onPhaseChange:(phase:BidSheetPhase)=>void;initialChapaId?:string};
export default function BidSheetContents({auction,serverNow,onClose,onPhaseChange,initialChapaId}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity,refreshMe,openRegistration}=useTelegram(),initialFull=isFullAuction(auction)?auction:undefined;
 const detail=usePublicQuery<CatalogAuction>(auctionDetailUrl(auction.slug),{initialData:initialFull});
 const full=(detail.data?.slug===auction.slug?detail.data:undefined)??initialFull,known=full??auction;
 const own=usePrivateQuery<BidState>(`/api/auctions/${auction.slug}/bids`),wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000}),availability=usePrivateQuery<ChapaAvailability>('/api/payments/chapa',{freshnessMs:15000});
 const payment=useChapaPayment('bid:'+auction.slug,initialChapaId),state=own.data,terms=state?.terms??known.terms;
 const [input,setInput]=useState(''),[numbers,setNumbers]=useState<string[]>([]),[editing,setEditing]=useState<number|null>(null),[method,setMethod]=useState<'wallet'|'online'>('wallet');
 const [quote,setQuote]=useState<BidBatchQuote|null>(null),[checkout,setCheckout]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<BidBatchReceipt|null>(null),[expanded,setExpanded]=useState(false),[applyCoupon,setApplyCoupon]=useState(false);
 const id=useId(),lock=useRef(false),generation=useRef(0),controllers=useRef(new Set<AbortController>()),quoteAttempt=useRef<{fingerprint:string;key:string}|null>(null);
 const authenticated=!!queryIdentity,active=known.status==='live'&&(!state||state.open),current=isSubmissionFeeOnly(terms.ruleVersion);
 const discount=usePrivateQuery<DiscountQuote>(`/api/auctions/${auction.slug}/discount-quote?feeVersion=${terms.version}`,{enabled:authenticated&&!!state?.referralDiscountsAvailable&&applyCoupon});
 const coupon=applyCoupon?usableBidDiscount(discount.data,terms.version,terms.entryFeePoints,discount.updatedAt):null;
 const bounds=state?.terms??full?.terms,rules=bounds?{...bounds,remainingSubmissions:state?.remainingSubmissions??bounds.maxDistinctBids,ownBids:state?.ownBids??[]}:null;
 const values=editing===null?[...numbers,...(input?[input]:[])]:numbers.map((value,index)=>index===editing?input:value),draft=rules?validateBidDraft(values,rules):{numbers:values.map(normalizeBidDraft).filter((value):value is string=>value!==null),error:null},couponCount=state?.couponAvailableCount??null;
 const copy:Record<BidDraftError,[string,string]>={precision:['Enter a number with at most two decimals.','እስከ ሁለት አስርዮሽ ያለው ቁጥር ያስገቡ።'],range:['Choose an amount within the displayed range and step.','በሚታየው ክልል እና ልዩነት ውስጥ መጠን ይምረጡ።'],duplicate:['This amount is already selected or submitted.','ይህ መጠን ተመርጧል ወይም ቀድሞ ቀርቧል።'],consecutive:['Only 3 consecutive amounts. Skip at least one step.','ከሦስት በላይ ተከታታይ ቁጥሮች አይፈቀዱም።'],limit:['You have reached the remaining submission limit.','የቀሩትን የጨረታ ገደብ ደርሰዋል።']};
 const description=full?(am?full.product.descriptionAm||full.product.description:full.product.description):null;
 const walletFeedback=wallet.error?<p className={styles.error} role="status">{text(wallet.data?'Showing the saved balance. Refresh failed.':'Balance is unavailable.',wallet.data?'የተቀመጠው ቀሪ ሂሳብ ይታያል። ማደስ አልተሳካም።':'ቀሪ ሂሳቡ አይገኝም።')} <button className={styles.inlineRetry} type="button" onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>:null;
 const refreshEnded=useCallback(()=>{own.reload();detail.reload()},[own.reload,detail.reload]);
 useEffect(()=>{const version=++generation.current;return()=>{if(generation.current===version)generation.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear()}},[queryIdentity]);
 useEffect(()=>{onPhaseChange(receipt?'receipt':checkout||payment.started?'payment':quote?'review':'entry')},[receipt,checkout,payment.started,quote,onPhaseChange]);
 const add=()=>{if(draft.error){setError(text(...copy[draft.error]));return}if(!input)return;setNumbers(draft.numbers);setInput('');setEditing(null);setError('')};
 const review=async()=>{
  if(lock.current)return;if(draft.error||!draft.numbers.length){setError(draft.error?text(...copy[draft.error]):text('Add at least one bid amount.','ቢያንስ አንድ የጨረታ መጠን ያስገቡ።'));return}
  setNumbers(draft.numbers);setInput('');setEditing(null);setError('');if(!queryIdentity){openRegistration();return}if(!state)return;
  const body={auctionSlug:auction.slug,numbers:draft.numbers,feeVersion:state.terms.version,...(coupon?.coupon?.id?{couponId:coupon.coupon.id}:{})},fingerprint=JSON.stringify(body);
  if(quoteAttempt.current?.fingerprint!==fingerprint)quoteAttempt.current={fingerprint,key:crypto.randomUUID()};
  const version=generation.current,controller=new AbortController();controllers.current.add(controller);lock.current=true;setBusy(true);
  try{const priced=await requestChapaJson<BidBatchQuote>('/api/payments/chapa/batches/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,key:quoteAttempt.current.key})},controller.signal);if(generation.current===version&&isPrivateQueryIdentity(queryIdentity))setQuote(priced)}
  catch(cause){if(generation.current===version){setError(cause instanceof ChapaClientError?cause.message:text('Could not prepare the order. Retry to review it.','ጥያቄውን ማዘጋጀት አልተቻለም።'));own.reload();discount.reload()}}
  finally{controllers.current.delete(controller);if(generation.current===version){lock.current=false;setBusy(false)}}
 };
 const payWallet=async()=>{
  if(!quote||!queryIdentity||lock.current||!isPrivateQueryIdentity(queryIdentity))return;
  const version=generation.current,controller=new AbortController();controllers.current.add(controller);lock.current=true;setBusy(true);setError('');
  try{const accepted=await requestChapaJson<BidBatchReceipt>(`/api/payments/chapa/batches/${quote.id}/wallet`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteHash:quote.quoteHash})},controller.signal);if(generation.current===version&&isPrivateQueryIdentity(queryIdentity)){setReceipt(accepted);invalidatePrivateQueries(queryIdentity,confirmedBidQueryScopes(auction.slug));void refreshMe().catch(()=>{})}}
  catch(cause){if(generation.current===version){setError(cause instanceof ChapaClientError?cause.message:text('Connection interrupted. Retry this same order; do not create another payment if debited.','ግንኙነቱ ተቋርጧል። ይህንኑ ጥያቄ ይድገሙ።'));if(cause instanceof ChapaClientError&&['QUOTE_CHANGED','STALE_QUOTE','COUPON_UNAVAILABLE','RETRYABLE_CONFLICT','TERMS_CHANGED'].includes(cause.code)){setQuote(null);quoteAttempt.current=null}own.reload();wallet.reload()}}
  finally{controllers.current.delete(controller);if(generation.current===version){lock.current=false;setBusy(false)}}
 };
 const funding=<fieldset className={styles.methods} disabled={busy}><legend><CreditCard size={14}/>{text('Select payment method','የክፍያ መንገድ ይምረጡ')}</legend><div className={styles.methodChoices}><label className={`${styles.method} ${method==='online'?styles.selected:''}`}><HostedPaymentLogos/><input type="radio" name={`${id}-method`} checked={method==='online'} onChange={()=>setMethod('online')} aria-label={text('Online payment','የመስመር ላይ ክፍያ')}/></label><div className={styles.walletRow}><label className={`${styles.method} ${method==='wallet'?styles.selected:''}`}><Wallet size={18}/><strong>{text('Wallet','ዋሌት')}</strong><input type="radio" name={`${id}-method`} checked={method==='wallet'} onChange={()=>setMethod('wallet')} aria-label={text('Wallet balance','የዋሌት ቀሪ ሂሳብ')}/></label><WalletTopUpTrigger className={styles.separateTopUp} disabled={busy||!authenticated} ariaLabel={text('Top up wallet','ወደ ዋሌት ገንዘብ ያስገቡ')}><Plus size={19}/></WalletTopUpTrigger></div></div></fieldset>;
 if(receipt)return <section className={styles.paymentStatus}><h3 role="status">{text(receipt.receipts.length===1?'Bid accepted':`${receipt.receipts.length} bids accepted`,`${receipt.receipts.length} ጨረታዎች ተቀብለዋል`)}</h3><div className={ui.receiptNumbers}>{receipt.receipts.map(item=><span key={item.bid.id}>{item.bid.amount}</span>)}</div><dl className={ui.facts}><div><dt>{text('Submission fees paid','የተከፈለ ማስገቢያ ክፍያ')}</dt><dd>{formatEtb(receipt.batch.total)}</dd></div></dl><Link className={styles.payButton} href="/my-bids" onClick={onClose}>{text('View My Bids','የእኔ ጨረታዎች')}</Link></section>;
 if(checkout||payment.started){if(initialChapaId&&!quote&&!payment.order?.batch)return <ChapaPaymentStatus payment={payment} onNavigate={onClose}/>;return <DirectCheckout payment={payment} purpose="BID" batch={quote??payment.order?.batch??undefined} amount={quote?.total??payment.order?.amount??'0.00'} onClose={onClose} onBack={()=>{setCheckout(false);if(payment.errorCode==='TERMS_CHANGED'){setQuote(null);quoteAttempt.current=null}}}/>}
 if(quote){
  const zero=etbToCents(quote.total)===0n,insufficient=!zero&&(!wallet.data||etbToCents(wallet.data.available)<etbToCents(quote.total));
  const enabled=zero||(method==='wallet'?!!availability.data?.walletBidsEnabled:!!availability.data?.enabled);
  return <section className={ui.review} data-bid-review><button className={ui.back} disabled={busy} onClick={()=>{setQuote(null);setError('')}}><ArrowLeft size={16}/>{text('Edit bid amounts','የጨረታ መጠኖችን ያስተካክሉ')}</button><h3>{am?known.product.titleAm||known.product.title:known.product.title}</h3><ul className={ui.lines}>{quote.lines.map(line=><li key={line.position}><span><strong>{line.number}</strong>{etbToCents(line.discount)>0n&&<small>{text('Coupon applied','ኩፖን ተተግብሯል')} −{formatEtb(line.discount)}</small>}</span><strong>{formatEtb(line.netFee)}</strong></li>)}</ul><dl className={ui.facts}><div><dt>{text('Entries','ጨረታዎች')}</dt><dd>{quote.entryCount}</dd></div><div><dt>{text('Fee per entry','የአንድ ጨረታ ክፍያ')}</dt><dd>{formatEtb(quote.lines[0]?.grossFee??terms.entryFeePoints)}</dd></div><div><dt>{text('Coupon savings','የኩፖን ቅናሽ')}</dt><dd>−{formatEtb(quote.discountTotal)}</dd></div><div><dt>{text('Total to pay','ጠቅላላ ክፍያ')}</dt><dd>{formatEtb(quote.total)}</dd></div></dl>{!zero&&funding}{!enabled&&<p className={styles.availability} role="status">{text(availability.data?'Payments are not available yet.':'Loading payment options…',availability.data?'ክፍያዎች ገና አልተጀመሩም።':'የክፍያ አማራጮች በመጫን ላይ…')}{availability.error&&<button className={styles.inlineRetry} type="button" onClick={availability.reload}>{text('Retry','እንደገና')}</button>}</p>}{walletFeedback}{!zero&&method==='wallet'&&insufficient&&<p className={styles.error}>{text('Insufficient Lowwin wallet balance. Top up or choose online payment.','የLowwin ዋሌት ቀሪ ሂሳብ አይበቃም። ገንዘብ ያስገቡ ወይም ሌላ መንገድ ይምረጡ።')}</p>}<p className={ui.note}>{text('Only submission fees are charged. Your selected bid amounts are not charged. One coupon discounts one entry.','የሚከፈለው የማስገቢያ ክፍያ ብቻ ነው። አንድ ኩፖን ለአንድ ጨረታ ብቻ ይተገበራል።')}</p>{error&&<p className={styles.error} role="alert">{error}</p>}<AccountSheetFooter><button className={styles.payButton} data-payment-action disabled={busy||!enabled||!zero&&method==='wallet'&&(insufficient||!!wallet.error)} onClick={()=>{if(zero||method==='wallet')void payWallet();else setCheckout(true)}}>{busy&&<LoaderCircle size={18} className={ui.spin} data-bid-submitting aria-hidden="true"/>} {busy?text('Submitting bids','ጨረታዎችን በማስገባት ላይ'):zero?text('Submit bids','ጨረታዎችን ያቅርቡ'):method==='wallet'?text(`Pay ${formatEtb(quote.total)} from wallet`,`${formatEtb(quote.total)} ከዋሌት ይክፈሉ`):text('Continue to payment','ወደ ክፍያ ይቀጥሉ')}</button></AccountSheetFooter></section>;
 }
 return <><AccountSheetFooter><button className={`${styles.payButton} ${styles.bidPayButton}`} data-payment-action disabled={busy||!bounds||!active||!current||!draft.numbers.length||!!draft.error||authenticated&&!state||applyCoupon&&(!coupon||discount.fetching)} onClick={()=>void review()}>{busy?<LoaderCircle size={17} className={ui.spin}/>:<Ticket size={17}/>} {busy?text('Preparing review','ግምገማ በማዘጋጀት ላይ'):text(authenticated?'View bids':'Log in to review bids',authenticated?'ጨረታዎችን ይመልከቱ':'ጨረታዎችን ለማየት ይግቡ')}</button></AccountSheetFooter><div className={styles.bidEntry} data-bid-entry>
  <BidSheetPreview auction={known} publicDetailsReady={!!full} detailsReady={!!full&&!!state} showStatus={false}/>
  <section className={styles.productDescription} aria-label={text('Product description','የዕቃው መግለጫ')}><p data-expanded={expanded}>{description??text('Loading description…','መግለጫው በመጫን ላይ…')}</p><button type="button" disabled={!description} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{text(expanded?'Show less':'Show more',expanded?'ያሳንሱ':'ተጨማሪ ያሳዩ')}<ChevronDown size={12}/></button></section>
  {detail.error&&<p className={styles.error}>{text('Product details could not refresh.','የዕቃውን ዝርዝር ማደስ አልተቻለም።')} <button className={styles.inlineRetry} onClick={detail.reload}>{text('Retry','እንደገና')}</button></p>}
  <div className={styles.feeStrip}><div><small>{text('Fee per entry','የአንድ ጨረታ ክፍያ')}</small><strong>{formatEtb(terms.entryFeePoints)}</strong></div><span className={styles.bidCount} data-bid-count><Ticket size={15}/><strong>{known.bidCount.toLocaleString()}</strong> {text('bids','ጨረታዎች')}</span><span className={styles.feeTiming}><Clock3 size={14}/><AuctionCountdown target={known.endsAt} serverNow={state?.serverNow??serverNow} observedAt={state?own.updatedAt:undefined} label="Ends" showLabel={false} onElapsed={refreshEnded}/></span></div>
  {active&&current?<><div className={styles.inputHeading}><label className={styles.inputLabel} htmlFor={id}>{text('Your bid amount','የጨረታ መጠንዎ')}</label>{wallet.data&&<span className={styles.inlineBalance} data-bid-balance><Wallet size={13}/><strong>{wallet.data.available} ETB</strong></span>}</div><div className={ui.addRow}><div className={styles.amountInput}><span aria-hidden="true">#</span><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} value={input} placeholder={text('Enter your bid amount…','የጨረታ መጠንዎን ያስገቡ…')} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value)){setInput(event.target.value);setError('')}}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();add()}}} aria-invalid={!!input&&!!draft.error||undefined}/></div><button className={ui.add} type="button" disabled={!input||!!draft.error} aria-label={text(editing===null?'Add bid amount':'Save bid amount',editing===null?'የጨረታ መጠን ጨምር':'የጨረታ መጠን ያስቀምጡ')} onClick={add}><Plus size={21}/></button></div><div className={styles.entryMeta}><p className={styles.range}>{text('From','ከ')} {bounds?.minPoints??'—'}{bounds?.maxPoints!==null?` – ${bounds?.maxPoints}`:''} · {text('Step','ልዩነት')} {bounds?.stepPoints??'—'}</p><span className={styles.remaining} data-bid-remaining>{Math.max(0,(rules?.remainingSubmissions??0)-numbers.length)} {text('left','ቀሪ')}</span></div>
   {!!numbers.length&&<div className={ui.chips} aria-label={text('Selected bid amounts','የተመረጡ የጨረታ መጠኖች')}>{numbers.map((number,index)=><span key={index} className={ui.chip}><button type="button" aria-label={text(`Edit ${number}`,`${number} ያስተካክሉ`)} onClick={()=>{setEditing(index);setInput(number);setError('')}}>{number}</button><button type="button" aria-label={text(`Remove ${number}`,`${number} ያስወግዱ`)} onClick={()=>{setNumbers(values=>values.filter((_,i)=>i!==index));setEditing(null);setInput('');setError('')}}><X size={13}/></button></span>)}</div>}
   <p className={ui.draftNote}>{text('Add more amounts with +. View bids includes the amount still in the field.','በ+ ተጨማሪ መጠኖችን ያስገቡ። በመስኩ ያለው መጠንም በግምገማ ይካተታል።')}</p>
   <div className={styles.earnedDiscount} data-active={applyCoupon} data-bid-coupons><Ticket size={20}/><strong>{text('Coupons','ኩፖኖች')} <span className={styles.couponCount}>{couponCount??'—'}</span></strong><button type="button" disabled={!state?.referralDiscountsAvailable||!couponCount} onClick={()=>setApplyCoupon(value=>!value)}>{text(applyCoupon?'Remove':'Apply',applyCoupon?'አስወግድ':'ተግብር')}</button></div>
   {applyCoupon&&<p className={ui.draftNote}>{coupon?text(`${coupon.coupon!.percent}% discount on one entry, shown in review.`,`በአንድ ጨረታ ${coupon.coupon!.percent}% ቅናሽ በግምገማ ይታያል።`):text(discount.fetching?'Checking an available coupon…':'No eligible coupon could be applied. Remove it or retry.',discount.fetching?'የሚገኝ ኩፖን በመፈተሽ ላይ…':'ተስማሚ ኩፖን ሊተገበር አልቻለም። ያስወግዱ ወይም እንደገና ይሞክሩ።')}</p>}
   {funding}<p className={styles.hint}>{text('Your bid amounts are not charged. Submission fees are non-refundable.','የጨረታ መጠኖችዎ አይከፈሉም። የማስገቢያ ክፍያዎች አይመለሱም።')}</p>
  </>:<p className={ui.empty}>{text('This auction is not open for new bids.','ይህ ጨረታ ለአዲስ ጨረታዎች ክፍት አይደለም።')}</p>}
  {(error||input&&draft.error)&&<p className={styles.error} role="alert">{error||(draft.error?text(...copy[draft.error]):'')}</p>}
  {own.error&&authenticated&&<p className={styles.error}>{text('Your bid limits could not load.','የጨረታ ገደቦችዎ መጫን አልተቻለም።')} <button className={styles.inlineRetry} onClick={own.reload}>{text('Retry','እንደገና')}</button></p>}
  {walletFeedback}
 </div></>;
}
