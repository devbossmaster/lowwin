'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {ChevronDown,Clock3,CreditCard,LoaderCircle,Plus,Ticket,Wallet,X} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import type {getOwnBidState} from '@/modules/auctions/bids';
import type {WalletBalance} from '@/modules/wallet/balance';
import type {getBidDiscountQuote} from '@/modules/referrals/service';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {etbToCents,formatEtb} from '@/lib/money';
import {normalizeBidDraft,normalizePaymentPhone,previewBidFees,validateBidDraft,type BidBatchQuote,type BidBatchReceipt,type BidDraftError,type DirectPaymentMethods} from '@/lib/bid-batch-client';
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
import {WalletTopUpTrigger} from './wallet-top-up-trigger';
import {auctionDetailUrl} from './auction-query';
import styles from './bid-payment-sheet.module.css';
import ui from './batch-checkout.module.css';
import simple from './simple-bid-checkout.module.css';
const DirectCheckout=dynamic(()=>import('./direct-checkout'),{ssr:false});
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
 const [method,setMethod]=useState<Method>('telebirr'),[phone,setPhone]=useState('');
 const [quote,setQuote]=useState<BidBatchQuote|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [receipt,setReceipt]=useState<BidBatchReceipt|null>(null),[expanded,setExpanded]=useState(false),[applyCoupon,setApplyCoupon]=useState(false),[walletRetry,setWalletRetry]=useState(false);
 const id=useId(),lock=useRef(false),generation=useRef(0),phoneEdited=useRef(false),controllers=useRef(new Set<AbortController>());
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
 const preview=previewBidFees(draft.numbers.length,terms.entryFeePoints,coupon?.discountPoints??'0');
 const total=priced?.total??preview.total,totalCents=etbToCents(total),zero=totalCents===0n;
 const normalizedPhone=normalizePaymentPhone(phone),frozen=busy||walletRetry;
 const methodAvailable=(slug:string)=>{
  const item=methods.data?.methods.find(item=>item.slug===slug);
  const amount=draft.numbers.length?totalCents:etbToCents(terms.entryFeePoints);
  return !!item&&(!item.minAmountCents||amount>=BigInt(item.minAmountCents))&&(!item.maxAmountCents||amount<=BigInt(item.maxAmountCents));
 };
 const insufficient=!zero&&(!wallet.data||etbToCents(wallet.data.available)<totalCents);
 const enabled=zero||(method==='wallet'?!!availability.data?.walletBidsEnabled:!!availability.data?.enabled&&methodAvailable(method));
 const copy:Record<BidDraftError,[string,string]>={precision:['Enter a number with at most two decimals.','እስከ ሁለት አስርዮሽ ያለው ቁጥር ያስገቡ።'],range:['Choose an amount within the displayed range and step.','በሚታየው ክልል እና ልዩነት ውስጥ መጠን ይምረጡ።'],duplicate:['This amount is already selected or submitted.','ይህ መጠን ተመርጧል ወይም ቀድሞ ቀርቧል።'],consecutive:['Only 3 consecutive amounts. Skip at least one step.','ከሦስት በላይ ተከታታይ ቁጥሮች አይፈቀዱም።'],limit:['You have reached the remaining submission limit.','የቀሩትን የጨረታ ገደብ ደርሰዋል።']};
 const description=full?(am?full.product.descriptionAm||full.product.description:full.product.description):null;
 const refreshEnded=useCallback(()=>{own.reload();detail.reload()},[own.reload,detail.reload]);
 useEffect(()=>{if(!phoneEdited.current&&methods.data?.paymentPhone)setPhone(normalizePaymentPhone(methods.data.paymentPhone)?.slice(3)??'')},[methods.data?.paymentPhone]);
 useEffect(()=>{const version=++generation.current;return()=>{if(generation.current===version)generation.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear()}},[queryIdentity]);
 useEffect(()=>{onPhaseChange(receipt?'receipt':payment.started?'payment':'entry')},[receipt,payment.started,onPhaseChange]);
 const add=()=>{if(frozen)return;if(draft.error){setError(text(...copy[draft.error]));return}if(!input)return;setNumbers(draft.numbers);setInput('');setEditing(null);setError('')};

 // One explicit Pay action obtains an immutable quote before any debit/request.
 // An unexpected server total is shown first and needs another explicit tap.
 const pay=async()=>{
  if(lock.current)return;
  if(!queryIdentity){openRegistration();return}
  if(!recoveryQuote){
   if(draft.error||!draft.numbers.length){setError(draft.error?text(...copy[draft.error]):text('Add at least one bid amount.','ቢያንስ አንድ የጨረታ መጠን ያስገቡ።'));return}
   if(!state||!enabled||!active||!current||!zero&&(method==='wallet'?insufficient||!!wallet.error:!normalizedPhone))return;
   if(quoteAttempt.current?.fingerprint!==fingerprint)quoteAttempt.current={fingerprint,key:crypto.randomUUID(),paymentKey:crypto.randomUUID()};
  }
  if(!quoteAttempt.current)return;
  const attempt=quoteAttempt.current,version=generation.current,controller=new AbortController();controllers.current.add(controller);
  lock.current=true;setBusy(true);setError('');let walletSubmitted=false;
  try{
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
    await payment.createDirect({key:attempt.paymentKey,purpose:'BID',batchId:confirmedQuote.id,quoteHash:confirmedQuote.quoteHash,paymentMethod:method,phone:normalizedPhone!});
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
  if(!payment.canStartAgain)return;
  const previous=quote??payment.order?.batch;
  const selection=previous?.lines.map(line=>line.number)??(payment.order?.bidNumber?[payment.order.bidNumber]:draft.numbers);
  payment.startAgain();setQuote(null);quoteAttempt.current=null;setWalletRetry(false);
  setNumbers(selection);setInput('');setEditing(null);setError('');
 };
 if(receipt)return <section className={styles.paymentStatus}><h3 role="status">{text(receipt.receipts.length===1?'Bid accepted':`${receipt.receipts.length} bids accepted`,`${receipt.receipts.length} ጨረታዎች ተቀብለዋል`)}</h3><div className={ui.receiptNumbers}>{receipt.receipts.map(item=><span key={item.bid.id}>{item.bid.amount}</span>)}</div><dl className={ui.facts}><div><dt>{text('Submission fees paid','የተከፈለ ማስገቢያ ክፍያ')}</dt><dd>{formatEtb(receipt.batch.total)}</dd></div></dl><Link className={styles.payButton} href="/my-bids" onClick={onClose}>{text('View My Bids','የእኔ ጨረታዎች')}</Link></section>;
 if(payment.started){if(initialChapaId&&!quote&&!payment.order?.batch)return <ChapaPaymentStatus payment={payment} onNavigate={onClose} onStartAgain={startNewBidPayment}/>;return <DirectCheckout payment={payment} purpose="BID" batch={quote??payment.order?.batch??undefined} onStartAgain={startNewBidPayment} amount={quote?.total??payment.order?.amount??'0.00'} onClose={onClose}/>}

 return <>
  <AccountSheetFooter><div className={simple.total} data-bid-total aria-live="polite"><span>{text(`${draft.numbers.length} bid${draft.numbers.length===1?'':'s'}`,`${draft.numbers.length} ጨረታዎች`)}{(priced?.discountTotal??preview.discountTotal)!=='0.00'&&<small>{text(' · coupon applied',' · ኩፖን ተተግብሯል')}</small>}</span><strong>{formatEtb(total)}</strong></div><button className={`${styles.payButton} ${simple.pay}`} data-payment-action disabled={busy||!walletRetry&&(!bounds||!active||!current||!draft.numbers.length||!!draft.error||authenticated&&(!state||!enabled||!zero&&(method==='wallet'?insufficient||!!wallet.error:!normalizedPhone))||applyCoupon&&(!coupon||discount.fetching))} onClick={()=>void pay()}>{busy&&<LoaderCircle size={18} className={ui.spin} data-bid-submitting aria-hidden="true"/>}{busy?text('Submitting bids','ጨረታዎችን በማስገባት ላይ'):walletRetry?text('Retry original payment','የመጀመሪያውን ክፍያ ይድገሙ'):!authenticated?text('Log in to bid','ለመጫረት ይግቡ'):text(zero?'Submit bids':`Pay ${formatEtb(total)} & bid`,zero?'ጨረታዎችን ያቅርቡ':`${formatEtb(total)} ይክፈሉና ይጫረቱ`)}</button></AccountSheetFooter>
  <div className={`${styles.bidEntry} ${simple.entry}`} data-bid-entry>
   <BidSheetPreview auction={known} publicDetailsReady={!!full} detailsReady={!!full&&!!state} showStatus={false}/>
   <section className={`${styles.productDescription} ${simple.description}`} data-bid-description aria-label={text('Product description','የዕቃው መግለጫ')}><p data-expanded={expanded}>{description??text('Loading description…','መግለጫው በመጫን ላይ…')}</p><button type="button" disabled={!description} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{text(expanded?'Show less':'Show more',expanded?'ያሳንሱ':'ተጨማሪ ያሳዩ')}<ChevronDown size={12}/></button></section>
   <div className={`${styles.feeStrip} ${simple.fee}`}><div><small>{text('Bid fee','የጨረታ ክፍያ')}</small><strong>{formatEtb(terms.entryFeePoints)}</strong></div><span className={styles.bidCount} data-bid-count><Ticket size={15}/><strong>{known.bidCount.toLocaleString()}</strong> {text('bids','ጨረታዎች')}</span><span className={styles.feeTiming}><Clock3 size={14}/><AuctionCountdown target={known.endsAt} serverNow={state?.serverNow??serverNow} observedAt={state?own.updatedAt:undefined} label="Ends" showLabel={false} onElapsed={refreshEnded}/></span></div>
   {active&&current?<>
    <div className={styles.inputHeading}><label className={styles.inputLabel} htmlFor={id}>{text('Your bid amount','የጨረታ መጠንዎ')}</label>{wallet.data&&<span className={styles.inlineBalance} data-bid-balance><Wallet size={13}/><strong>{wallet.data.available} ETB</strong></span>}</div>
    <div className={ui.addRow}><div className={styles.amountInput}><span aria-hidden="true">ETB</span><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} disabled={frozen} value={input} placeholder={text('Enter your bid amount…','የጨረታ መጠንዎን ያስገቡ…')} onChange={event=>{if(/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value)){setInput(event.target.value);setError('')}}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();add()}}} aria-invalid={!!input&&!!draft.error||undefined}/></div><button className={ui.add} type="button" disabled={frozen||!input||!!draft.error} aria-label={text(editing===null?'Add bid amount':'Save bid amount',editing===null?'የጨረታ መጠን ጨምር':'የጨረታ መጠን ያስቀምጡ')} onClick={add}><Plus size={21}/></button></div>
    <div className={styles.entryMeta}><p className={styles.range}>{text('From','ከ')} {bounds?.minPoints??'—'}{bounds?.maxPoints!==null?` – ${bounds?.maxPoints??'—'}`:''} · {text('Step','ልዩነት')} {bounds?.stepPoints??'—'}</p><span className={styles.remaining} data-bid-remaining>{Math.max(0,(rules?.remainingSubmissions??0)-draft.numbers.length)} {text('left','ቀሪ')}</span></div>
    {!!numbers.length&&<div className={`${ui.chips} ${simple.chips}`} aria-label={text('Selected bid amounts','የተመረጡ የጨረታ መጠኖች')}>{numbers.map((number,index)=><span key={index} className={ui.chip}><button disabled={frozen} type="button" aria-label={text(`Edit ${number}`,`${number} ያስተካክሉ`)} onClick={()=>{setEditing(index);setInput(number);setError('')}}>{number}</button><button disabled={frozen} type="button" aria-label={text(`Remove ${number}`,`${number} ያስወግዱ`)} onClick={()=>{setNumbers(values=>values.filter((_,i)=>i!==index));setEditing(null);setInput('');setError('')}}><X size={13}/></button></span>)}</div>}
    <div className={styles.earnedDiscount} data-active={applyCoupon} data-bid-coupons><Ticket size={20}/><strong>{text('Coupons','ኩፖኖች')} <span className={styles.couponCount}>{couponCount??'—'}</span></strong><button type="button" disabled={frozen||!applyCoupon&&(!state?.referralDiscountsAvailable||!couponCount)} onClick={()=>setApplyCoupon(value=>!value)}>{text(applyCoupon?'Remove':'Apply',applyCoupon?'አስወግድ':'ተግብር')}</button></div>
    {applyCoupon&&<p className={ui.draftNote}>{coupon?text(`${coupon.coupon!.percent}% off one bid fee.`,`${coupon.coupon!.percent}% ቅናሽ በአንድ ጨረታ ክፍያ።`):text(discount.fetching?'Checking coupon…':'No eligible coupon. Remove it or retry.',discount.fetching?'ኩፖን በመፈተሽ ላይ…':'ተስማሚ ኩፖን የለም። ያስወግዱ ወይም ይድገሙ።')}</p>}
    <fieldset className={simple.methods} disabled={frozen} data-funding-selector><legend><CreditCard size={14}/>{text('Select payment method','የክፍያ መንገድ ይምረጡ')}</legend><div className={simple.methodGrid}>
     {providers.map(provider=><label key={provider.slug} className={simple.method} data-selected={method===provider.slug} data-provider={provider.slug} data-unavailable={authenticated&&!methodAvailable(provider.slug)}><input type="radio" name={`${id}-method`} value={provider.slug} checked={method===provider.slug} onChange={()=>{setMethod(provider.slug);setError('')}} disabled={authenticated&&!!methods.data&&!methodAvailable(provider.slug)} aria-label={provider.name}/><img src={provider.image} alt="" width={32} height={27}/><strong>{provider.name}</strong></label>)}
     <label className={simple.method} data-selected={method==='wallet'} data-provider="wallet"><input type="radio" name={`${id}-method`} value="wallet" checked={method==='wallet'} onChange={()=>{setMethod('wallet');setError('')}} aria-label={text('Wallet','ዋሌት')}/><Wallet size={22} aria-hidden="true"/><strong>{text('Wallet','ዋሌት')}</strong></label>
    </div></fieldset>
    {method!=='wallet'&&!zero&&<div className={simple.phone}><label htmlFor={`${id}-phone`}>{text('Payment phone number','የክፍያ ስልክ ቁጥር')}</label><div><span aria-hidden="true">+251</span><input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={18} disabled={frozen} value={phone} onChange={event=>{phoneEdited.current=true;setPhone(normalizePaymentPhone(event.target.value)?.slice(3)??event.target.value);setError('')}} placeholder="9•• ••• ••••" aria-invalid={!!phone&&!normalizedPhone||undefined}/></div></div>}
    {method==='wallet'&&authenticated&&<p className={simple.walletHelp}>{insufficient?text('Need more balance?','ተጨማሪ ቀሪ ሂሳብ ይፈልጋሉ?'):text('Pay with your Lowwin balance.','በLowwin ቀሪ ሂሳብዎ ይክፈሉ።')} <WalletTopUpTrigger disabled={frozen} ariaLabel={text('Top up wallet','ወደ ዋሌት ገንዘብ ያስገቡ')}>{text('Top up','ገንዘብ ያስገቡ')} <Plus size={14}/></WalletTopUpTrigger></p>}
    <p className={styles.hint}>{text('Only the bid fee is charged. Submission fees are non-refundable.','የሚከፈለው የጨረታ ክፍያ ብቻ ነው። የማስገቢያ ክፍያዎች አይመለሱም።')}</p>
    {authenticated&&!enabled&&!zero&&<p className={styles.availability} role="status">{method!=='wallet'&&availability.data?.enabled?text(methods.data?'This method is unavailable for this total. Choose another.':'Loading payment methods…',methods.data?'ለዚህ ጠቅላላ ክፍያ ይህ መንገድ አይገኝም። ሌላ ይምረጡ።':'የክፍያ መንገዶች በመጫን ላይ…'):text('Payments are currently unavailable.','ክፍያዎች በአሁኑ ጊዜ አይገኙም።')}{(methods.error||availability.error)&&<button type="button" className={styles.inlineRetry} onClick={()=>{methods.reload();availability.reload()}}>{text('Retry','እንደገና')}</button>}</p>}
   </>:<p className={ui.empty}>{text('This auction is not open for new bids.','ይህ ጨረታ ለአዲስ ጨረታዎች ክፍት አይደለም።')}</p>}
   {(error||payment.error||input&&draft.error)&&<p className={styles.error} role="alert">{error||payment.error||(draft.error?text(...copy[draft.error]):'')}</p>}
   {own.error&&authenticated&&<p className={styles.error}>{text('Your bid limits could not load.','የጨረታ ገደቦችዎ መጫን አልተቻለም።')} <button className={styles.inlineRetry} onClick={own.reload}>{text('Retry','እንደገና')}</button></p>}
   {detail.error&&<p className={styles.error}>{text('Product details could not refresh.','የዕቃውን ዝርዝር ማደስ አልተቻለም።')} <button className={styles.inlineRetry} onClick={detail.reload}>{text('Retry','እንደገና')}</button></p>}
   {wallet.error&&<p className={styles.error} role="status">{text('Balance could not refresh.','ቀሪ ሂሳቡን ማደስ አልተቻለም።')} <button className={styles.inlineRetry} type="button" onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
  </div>
 </>;
}
