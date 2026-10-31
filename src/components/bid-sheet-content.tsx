'use client';
import Link from 'next/link';
import {useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import {ChevronDown,Clock3,CreditCard,LoaderCircle,Plus,Ticket,Wallet} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import type {getOwnBidState} from '@/modules/auctions/bids';
import type {WalletBalance} from '@/modules/wallet/balance';
import {createsFourConsecutiveAmounts} from '@/modules/auctions/consecutive-bids';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import {AccountSheetFooter} from './account-sheet';
import {BidSheetPreview,isFullAuction,type BidSheetAuction} from './bid-sheet-preview';
import type {BidSheetPhase} from './bid-sheet';
import {AuctionCountdown} from './auction-countdown';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import {confirmedBidQueryScopes,invalidatePrivateQueries,isPrivateQueryIdentity} from './private-query-cache';
import {ChapaPaymentStatus,useChapaPayment} from './chapa-payment';
import {HostedPaymentLogos} from './hosted-payment-logos';
import {ChapaClientError,requestChapaJson,type ChapaAvailability} from '@/lib/chapa-client';
import type {BidReceipt} from '@/modules/auctions/bids';
import {IdentityState} from './identity-state';
import {WalletTopUpTrigger} from './wallet-top-up-trigger';
import type {getBidDiscountQuote} from '@/modules/referrals/service';
import {usableBidDiscount} from '@/lib/bid-discount-preview';
import {auctionDetailUrl} from './auction-query';
import styles from './bid-payment-sheet.module.css';
type BidState=Omit<Awaited<ReturnType<typeof getOwnBidState>>,'wallet'|'previousMax'>&{referralDiscountsAvailable?:boolean;couponAvailableCount?:number|null};
type DiscountQuote=Awaited<ReturnType<typeof getBidDiscountQuote>>;
type Props={auction:BidSheetAuction;serverNow:string;onClose:()=>void;onPhaseChange:(phase:BidSheetPhase)=>void;initialChapaId?:string};
export default function BidSheetContents({auction,serverNow,onClose,onPhaseChange,initialChapaId}:Props){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity,refreshMe}=useTelegram();
 const initialFull=isFullAuction(auction)?auction:null;
 const detailQuery=usePrivateQuery<CatalogAuction>(auctionDetailUrl(auction.slug),{initialData:initialFull??undefined});
 const full=(detailQuery.data?.slug===auction.slug?detailQuery.data:null)??initialFull,known=full??auction;
 const query=usePrivateQuery<BidState>(`/api/auctions/${auction.slug}/bids`),wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000});
 const refreshEnded=useCallback(()=>{query.reload();detailQuery.reload()},[query.reload,detailQuery.reload]);
 const availability=usePrivateQuery<ChapaAvailability>('/api/payments/chapa',{freshnessMs:15000}),payment=useChapaPayment('bid:'+auction.slug,initialChapaId);
 const [number,setNumber]=useState(''),[method,setMethod]=useState<'wallet'|'chapa'>('wallet'),id=useId(),state=query.data;
 const [walletBusy,setWalletBusy]=useState(false),[walletError,setWalletError]=useState(''),[receipt,setReceipt]=useState<BidReceipt|null>(null);
 const walletLock=useRef(false),walletAttempt=useRef<{fingerprint:string;key:string}|null>(null);
 const [applyDiscount,setApplyDiscount]=useState(false),[discountExpired,setDiscountExpired]=useState(false),[descriptionExpanded,setDescriptionExpanded]=useState(false);
 const description=full?(am?(full.product.descriptionAm||full.product.description):full.product.description):null;
 const preview=useMemo(()=>{if(!state||!number||!/^\d{1,16}(?:\.\d{1,2})?$/.test(number))return null;try{const value=etbToCents(number),min=etbToCents(state.terms.minPoints),max=state.terms.maxPoints===null?null:etbToCents(state.terms.maxPoints),step=etbToCents(state.terms.stepPoints);if(value<min||max!==null&&value>max||step<=0n||(value-min)%step!==0n)return null;return {duplicate:state.ownBids.some(b=>etbToCents(b.amount)===value),consecutive:createsFourConsecutiveAmounts(state.ownBids.map(b=>etbToCents(b.amount)),value)}}catch{return null}},[state,number]);
 const terms=state?.terms??known.terms,bounds=state?.terms??full?.terms,authenticated=query.status==='authenticated';
 const active=known.status==='live'&&(!state||state.open),current=isSubmissionFeeOnly(terms.ruleVersion);
 const showEntry=(authenticated||query.status==='loading')&&active&&current,couponCount=state?.couponAvailableCount??null;
 const canUseDiscount=authenticated&&active&&current&&!auction.isDemo&&!!state?.referralDiscountsAvailable&&etbToCents(terms.entryFeePoints)>0n;
 const discountQuery=usePrivateQuery<DiscountQuote>(`/api/auctions/${auction.slug}/discount-quote?feeVersion=${terms.version}`,{enabled:canUseDiscount&&applyDiscount});
 const applied=canUseDiscount&&applyDiscount?usableBidDiscount(discountQuery.data,terms.version,terms.entryFeePoints,discountQuery.updatedAt):null;
 const payable=applied?.netFeePoints??terms.entryFeePoints,fee=formatEtb(payable);
 let balance:string|null=null,insufficient=false;try{if(wallet.data){balance=centsToEtb(etbToCents(wallet.data.available));insufficient=etbToCents(wallet.data.available)<etbToCents(payable)}}catch{}
 useEffect(()=>{
  const quote=discountQuery.data;if(!applyDiscount||!quote?.coupon)return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const check=()=>{const left=Date.parse(quote.coupon!.expiresAt)-Date.parse(quote.serverNow)-Math.max(0,Date.now()-discountQuery.updatedAt);if(!Number.isFinite(left))return;if(left<=0){setApplyDiscount(false);setDiscountExpired(true)}else timer=setTimeout(check,Math.min(left,2147483647))};
  check();return()=>clearTimeout(timer);
 },[applyDiscount,discountQuery.data,discountQuery.updatedAt]);
 const valid=!!state&&!!preview&&!preview.duplicate&&!preview.consecutive&&state.remainingSubmissions>0&&!(applyDiscount&&discountQuery.fetching&&!applied);
 const enabled=method==='wallet'?!!availability.data?.walletBidsEnabled:!!availability.data?.enabled;
 const canPay=valid&&enabled&&!availability.error&&!walletBusy&&!payment.busy&&!payment.restoring&&!payment.started&&(method!=='wallet'||balance!==null&&!insufficient&&!wallet.error);
 const submit=async()=>{
  if(!canPay||!state||!queryIdentity||!isPrivateQueryIdentity(queryIdentity)||walletLock.current)return;
  const amount=centsToEtb(etbToCents(number)),couponId=applied?.coupon?.id;
  if(method==='chapa'){void payment.create({purpose:'BID',auctionSlug:auction.slug,amount,feeVersion:terms.version,key:crypto.randomUUID(),...(couponId?{couponId}:{})});return}
  const body={amount,feeVersion:terms.version,...(couponId?{couponId}:{})},fingerprint=JSON.stringify(body);
  if(walletAttempt.current?.fingerprint!==fingerprint)walletAttempt.current={fingerprint,key:crypto.randomUUID()};
  walletLock.current=true;setWalletBusy(true);setWalletError('');
  try{
   const accepted=await requestChapaJson<BidReceipt>(`/api/auctions/${auction.slug}/bids`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,key:walletAttempt.current.key})});
   if(!isPrivateQueryIdentity(queryIdentity))return;setReceipt(accepted);invalidatePrivateQueries(queryIdentity,confirmedBidQueryScopes(auction.slug));void refreshMe().catch(()=>{});
  }catch(cause){
   if(!isPrivateQueryIdentity(queryIdentity))return;
   if(cause instanceof ChapaClientError&&[401,403].includes(cause.status))void refreshMe().catch(()=>{});
   setWalletError(text(cause instanceof ChapaClientError?cause.message:'Connection interrupted. Retry with the same number and details; your request key is preserved.','ግንኙነቱ ተቋርጧል። በተመሳሳይ ቁጥር እና ዝርዝር እንደገና ይሞክሩ፤ የጥያቄዎ መለያ ተጠብቋል።'));query.reload();wallet.reload();
  }finally{walletLock.current=false;if(isPrivateQueryIdentity(queryIdentity))setWalletBusy(false)}
 };
 useEffect(()=>{onPhaseChange(receipt?'receipt':payment.started?'payment':'entry')},[receipt,payment.started,onPhaseChange]);
 if(receipt)return <section className={styles.paymentStatus}><h3 role="status" aria-live="polite">{text('Bid accepted','ጨረታው ተቀብሏል')}</h3><p className={styles.paymentTotal}>#{receipt.bid.amount}</p><p>{text('Only the disclosed submission fee was paid. Your chosen number is not charged.','የተከፈለው የተገለጸው የማስገቢያ ክፍያ ብቻ ነው። የመረጡት ቁጥር አይከፈልም።')}</p><dl className={styles.receiptFacts}><div><dt>{text('Submission fee paid','የተከፈለ የማስገቢያ ክፍያ')}</dt><dd>{formatEtb(receipt.charge.netFeePoints??receipt.charge.feePoints)}</dd></div><div><dt>{text('Bid ID','የጨረታ መለያ')}</dt><dd>{receipt.bid.id}</dd></div></dl><Link className={styles.payButton} href="/my-bids">{text('View My Bids','የእኔ ጨረታዎች')}</Link></section>;
 if(payment.started)return <ChapaPaymentStatus payment={payment} onNavigate={onClose}/>;
 return <><AccountSheetFooter>{showEntry?<><button className={`${styles.payButton} ${styles.bidPayButton}`} type="button" data-payment-action disabled={!canPay} aria-busy={walletBusy} aria-live="polite" onClick={()=>void submit()}>{walletBusy?<LoaderCircle size={17} className={styles.paymentSpinner} data-bid-submitting aria-hidden="true"/>:<Ticket size={17} aria-hidden="true"/>}{walletBusy?text('Submitting','በማስገባት ላይ'):text(`Pay ${fee} & bid`,`${fee} ${method==='wallet'?'ከዋሌት':'ላይ'} ይክፈሉ`)}</button>{availability.data&&!enabled&&<p className={`${styles.availability} ${styles.bidAvailability}`} role="status">{text('Payments are not available yet.','ክፍያዎች ገና አልተጀመሩም።')}</p>}</>:undefined}</AccountSheetFooter>
  <div className={styles.bidEntry} data-bid-entry>{!authenticated&&query.status!=='loading'&&<IdentityState/>}{query.error&&<p className={styles.error} role="alert">{text('Entry details could not refresh.','የጨረታውን ዝርዝር ማደስ አልተቻለም።')} <button className={styles.inlineRetry} onClick={query.reload}>{text('Retry','እንደገና')}</button></p>}<BidSheetPreview auction={known} publicDetailsReady={!!full} detailsReady={authenticated&&!!full&&!!state&&!!wallet.data} showStatus={false}/>
  <section data-bid-description className={styles.productDescription} aria-label={text('Product description','የዕቃው መግለጫ')} aria-busy={!full&&!detailQuery.error||undefined}><p id={id+'-description'} data-expanded={descriptionExpanded}>{description??(detailQuery.error?text('Product details are unavailable.','የዕቃው ዝርዝሮች አይገኙም።'):<span className={styles.fieldSkeleton} role="status" aria-label={text('Loading product description','የዕቃው መግለጫ በመጫን ላይ')}/>)}</p><button type="button" disabled={!description} aria-expanded={descriptionExpanded} aria-controls={id+'-description'} onClick={()=>setDescriptionExpanded(value=>!value)}>{text(descriptionExpanded?'Show less':'Show more',descriptionExpanded?'ያሳንሱ':'ተጨማሪ ያሳዩ')}<ChevronDown size={12} aria-hidden="true"/></button></section>
  {detailQuery.error&&<p className={styles.error} role="status">{text(full?'Showing saved auction details. Refresh failed.':'Auction details could not load.',full?'የተቀመጡ የጨረታ ዝርዝሮች ይታያሉ። ማደስ አልተሳካም።':'የጨረታውን ዝርዝር ማምጣት አልተቻለም።')} <button className={styles.inlineRetry} onClick={detailQuery.reload}>{text('Retry','እንደገና')}</button></p>}
  <div className={styles.feeStrip} data-discount-applied={applied?.coupon?.percent}><div><small>{text(applied?'To pay':'Bid fee',applied?'የሚከፈል':'የጨረታ ክፍያ')}{applied&&<> · <del>{formatEtb(terms.entryFeePoints)}</del></>}</small><strong>{fee}</strong>{applied&&<small className={styles.discountSaving}>−{formatEtb(applied.discountPoints)} · {applied.coupon!.percent}% {text('discount','ቅናሽ')}</small>}</div><span className={styles.bidCount} data-bid-count><Ticket size={15} aria-hidden="true"/><strong>{known.bidCount.toLocaleString()}</strong> {text('bids','ጨረታዎች')}</span><span className={styles.feeTiming}><Clock3 size={14} aria-hidden="true"/><AuctionCountdown target={known.endsAt} serverNow={state?.serverNow??serverNow} observedAt={state?query.updatedAt:undefined} label="Ends" showLabel={false} onElapsed={refreshEnded}/></span></div>
  {showEntry?<>
   <div className={styles.inputHeading}><label className={styles.inputLabel} htmlFor={id}>{text('Your bid amount','የጨረታ መጠንዎ')}</label><span className={styles.inlineBalance} data-bid-balance><Wallet size={13} aria-hidden="true"/>{balance!==null?<strong>{balance} ETB</strong>:wallet.error?text('Unavailable','አይገኝም'):<span className={styles.fieldSkeleton} role="status" aria-label={text('Loading wallet balance','የዋሌት ቀሪ ሂሳብ በመጫን ላይ')}/>}</span></div>
   <div className={styles.amountInput}><span aria-hidden="true">#</span><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} value={number} onChange={event=>{const value=event.target.value;if(/^\d{0,16}(?:\.\d{0,2})?$/.test(value))setNumber(value)}} disabled={!bounds||walletBusy} placeholder={text('Enter your bid amount…','የጨረታ መጠንዎን ያስገቡ…')} aria-describedby={`${id}-limits ${id}-rules`} aria-invalid={!!number&&!!state&&(!preview||preview.duplicate||preview.consecutive)||undefined}/></div>
   <div className={styles.entryMeta} id={`${id}-limits`}><p className={styles.range}>{bounds?<>{text('From','ከ')} {bounds.minPoints}{bounds.maxPoints!==null?` – ${bounds.maxPoints}`:''} · {text('Step','ልዩነት')} {bounds.stepPoints}</>:<span className={styles.fieldSkeleton} role="status" aria-label={text('Loading bid limits','የጨረታ ገደቦች በመጫን ላይ')}/>}</p><span className={styles.remaining} data-bid-remaining aria-label={state?text(`${state.remainingSubmissions} submissions left`,`${state.remainingSubmissions} ቀሪ ጨረታዎች`):undefined}>{state?text(`${state.remainingSubmissions} left`,`${state.remainingSubmissions} ቀሪ`):<span className={styles.fieldSkeleton}/>}</span></div>
   {state&&number&&!preview&&<p className={styles.error} role="alert">{text('Choose an amount within the displayed range and step.','በሚታየው ክልል እና ልዩነት ውስጥ መጠን ይምረጡ።')}</p>}{preview?.duplicate&&<p className={styles.error} role="alert">{text('You already submitted this amount.','ይህን መጠን አስቀድመው አቅርበዋል።')}</p>}{preview?.consecutive&&<p className={styles.error} role="alert">{text('Only 3 consecutive amounts. Skip at least one step.','ከሦስት ተከታታይ ቁጥር በኋላ ቢያንስ አንድ ልዩ መጠን የሆነ ያስገቡ።')}</p>}
   <div className={styles.earnedDiscount} data-active={applyDiscount||!!applied} data-bid-coupons><Ticket size={20} aria-hidden="true"/><div><strong>{text('Coupons','ኩፖኖች')} <span className={styles.couponCount} aria-label={couponCount===null?text('Coupon count unavailable','የኩፖን ብዛት አይገኝም'):text(`${couponCount} available coupons`,`${couponCount} የሚገኙ ኩፖኖች`)}>{couponCount??'—'}</span></strong>{(applied||discountQuery.fetching)&&<small role="status">{applied?text(`${applied.coupon!.percent}% off this fee`,`${applied.coupon!.percent}% ከዚህ ክፍያ ቅናሽ`):text('Checking coupon…','ኩፖኑን በመፈተሽ ላይ…')}</small>}</div><button type="button" disabled={!canUseDiscount||couponCount===null||couponCount===0||walletBusy||discountQuery.fetching&&!applied} aria-label={text(applied?'Remove coupon':'Apply coupon',applied?'ኩፖኑን ያስወግዱ':'ኩፖን ይተግብሩ')} onClick={()=>{setDiscountExpired(false);if(applied)setApplyDiscount(false);else{setApplyDiscount(true);discountQuery.reload()}}}>{text(applied?'Remove':'Apply',applied?'አስወግድ':'ተግብር')}</button></div>
   {discountExpired&&<p className={styles.error} role="status">{text('That coupon expired. Apply another available coupon.','የኩፖኑ ጊዜ አልፏል። ሌላ ያለ ኩፖን ይተግብሩ።')}</p>}{discountQuery.error&&<p className={styles.error} role="status">{text('Could not apply the coupon.','ኩፖኑን መተግበር አልተቻለም።')} <button className={styles.inlineRetry} type="button" onClick={()=>{query.reload();discountQuery.reload()}}>{text('Retry','እንደገና')}</button></p>}
   <fieldset className={styles.methods} disabled={walletBusy||!authenticated}><legend><CreditCard size={14} aria-hidden="true"/>{text('Select payment method','የክፍያ መንገድ ይምረጡ')}</legend><div className={styles.methodChoices}><label className={`${styles.method} ${method==='chapa'?styles.selected:''}`}><HostedPaymentLogos/><input type="radio" name={`${id}-method`} value="chapa" checked={method==='chapa'} onChange={()=>setMethod('chapa')} aria-label="Online payment"/></label><div className={styles.walletRow}><label className={`${styles.method} ${method==='wallet'?styles.selected:''}`}><span className={styles.methodIcon}><Wallet size={19} aria-hidden="true"/></span><span className={styles.methodText}><strong>{text('Wallet','ዋሌት')}</strong></span><input type="radio" name={`${id}-method`} value="wallet" checked={method==='wallet'} onChange={()=>setMethod('wallet')} aria-label={text('Wallet balance','የዋሌት ቀሪ ሂሳብ')}/></label><WalletTopUpTrigger disabled={walletBusy||!authenticated} className={styles.separateTopUp} ariaLabel={text('Top up wallet','ወደ ዋሌት ገንዘብ ያስገቡ')}><Plus size={19} aria-hidden="true"/></WalletTopUpTrigger></div></div></fieldset>
   {method==='wallet'&&insufficient&&<p className={styles.error} role="status">{text(availability.data?.enabled?'Insufficient balance. Tap + to top up or choose online payment.':'Insufficient balance. Top-ups are not available yet.',availability.data?.enabled?'ቀሪ ሂሳቡ አይበቃም። + ይጫኑ ወይም የመስመር ላይ ክፍያ ይምረጡ።':'የዋሌት ቀሪ ሂሳብዎ ከክፍያው ያነሰ ነው።')}</p>}
   <p className={styles.hint} id={`${id}-rules`}>{text('Your bid amount isn’t charged. The submission fee is non-refundable.','የመረጡት መጠን አይከፈልም። የማቅረቢያ ክፍያው አይመለስም።')}</p>
  </>:authenticated&&<p className={styles.availability}>{text(!active?'This auction is not open for bids.':'New entries are unavailable for this older auction. Its published terms remain unchanged.',!active?'ይህ ጨረታ ለጨረታ ክፍት አይደለም።':'ለዚህ የቆየ ጨረታ አዲስ ጨረታ ማቅረብ አይቻልም። የታተሙ ውሎቹ አልተለወጡም።')}</p>}
  {wallet.error&&<p className={styles.error} role="status">{text(balance?'Showing the saved balance. Refresh failed.':'Balance is unavailable.',balance?'የተቀመጠው ቀሪ ሂሳብ ይታያል። ማደስ አልተሳካም።':'ቀሪ ሂሳቡ አይገኝም።')} <button className={styles.inlineRetry} onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
  {(walletError||payment.error)&&<p className={styles.error} role="alert">{walletError||payment.error}</p>}{availability.error&&<p className={styles.error} role="status">{text('Payment options could not refresh.','የክፍያ አማራጮችን ማደስ አልተቻለም።')} <button className={styles.inlineRetry} onClick={availability.reload}>{text('Retry','እንደገና')}</button></p>}
  </div>
 </>;
}
