'use client';
import Link from 'next/link';
import {useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import {ChevronDown,Clock3,CreditCard,Plus,Ticket,Wallet} from 'lucide-react';
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
import {ChapaLogo} from './chapa-logo';
import {ChapaClientError,requestChapaJson,type ChapaAvailability} from '@/lib/chapa-client';
import type {BidReceipt} from '@/modules/auctions/bids';
import {IdentityState} from './identity-state';
import {WalletTopUpTrigger} from './wallet-top-up-trigger';
import type {getBidDiscountQuote} from '@/modules/referrals/service';
import {usableBidDiscount} from '@/lib/bid-discount-preview';
import {auctionDetailUrl} from './auction-query';
import styles from './bid-payment-sheet.module.css';
type BidState=Omit<Awaited<ReturnType<typeof getOwnBidState>>,'wallet'|'previousMax'>&{referralDiscountsAvailable?:boolean};
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
 const [applyDiscount,setApplyDiscount]=useState(false),[discountExpired,setDiscountExpired]=useState(false);
 const description=full?(am?(full.product.descriptionAm||full.product.description):full.product.description):null;
 const preview=useMemo(()=>{if(!state||!number||!/^\d{1,16}(?:\.\d{1,2})?$/.test(number))return null;try{const value=etbToCents(number),min=etbToCents(state.terms.minPoints),max=state.terms.maxPoints===null?null:etbToCents(state.terms.maxPoints),step=etbToCents(state.terms.stepPoints);if(value<min||max!==null&&value>max||step<=0n||(value-min)%step!==0n)return null;return {duplicate:state.ownBids.some(b=>etbToCents(b.amount)===value),consecutive:createsFourConsecutiveAmounts(state.ownBids.map(b=>etbToCents(b.amount)),value)}}catch{return null}},[state,number]);
 const terms=state?.terms??known.terms,bounds=state?.terms??full?.terms,authenticated=query.status==='authenticated';
 const active=known.status==='live'&&(!state||state.open),current=isSubmissionFeeOnly(terms.ruleVersion);
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
 if(receipt)return <section className={styles.paymentStatus}><h3>{text('Bid accepted','ጨረታው ተቀብሏል')}</h3><p className={styles.paymentTotal}>#{receipt.bid.amount}</p><p>{text('Only the disclosed submission fee was paid. Your chosen number is not charged.','የተከፈለው የተገለጸው የማስገቢያ ክፍያ ብቻ ነው። የመረጡት ቁጥር አይከፈልም።')}</p><dl className={styles.receiptFacts}><div><dt>{text('Submission fee paid','የተከፈለ የማስገቢያ ክፍያ')}</dt><dd>{formatEtb(receipt.charge.netFeePoints??receipt.charge.feePoints)}</dd></div><div><dt>{text('Bid ID','የጨረታ መለያ')}</dt><dd>{receipt.bid.id}</dd></div></dl><Link className={styles.payButton} href="/my-bids">{text('View My Bids','የእኔ ጨረታዎች')}</Link></section>;
 if(payment.started)return <ChapaPaymentStatus payment={payment}/>;
 return <><AccountSheetFooter>{authenticated&&active&&current?<><button className={`${styles.payButton} ${styles.bidPayButton}`} type="button" data-payment-action disabled={!canPay} onClick={()=>void submit()}><Ticket size={16} aria-hidden="true"/>{walletBusy?text('Submitting…','በማስገባት ላይ…'):text(`Pay ${fee} ${method==='wallet'?'from Wallet':'with Chapa'}`,`${fee} ${method==='wallet'?'ከዋሌት':'በChapa'} ይክፈሉ`)}</button>{!enabled&&<p className={`${styles.availability} ${styles.bidAvailability}`} role="status">{text('Payments are not available yet.','ክፍያዎች ገና አልተጀመሩም።')}</p>}</>:undefined}</AccountSheetFooter>
  <div className={styles.bidEntry}>{!authenticated&&query.status!=='loading'&&<IdentityState/>}{query.error&&<p className={styles.error} role="alert">{text('Entry details could not refresh.','የጨረታውን ዝርዝር ማደስ አልተቻለም።')} <button className={styles.inlineRetry} onClick={query.reload}>{text('Retry','እንደገና')}</button></p>}<BidSheetPreview auction={known} publicDetailsReady={!!full} detailsReady={authenticated&&!!full&&!!state&&!!wallet.data}/>
  <details className={styles.description} aria-busy={!full&&!detailQuery.error||undefined}><summary><span>{description??(detailQuery.error?text('Auction details could not load.','የጨረታውን ዝርዝር ማምጣት አልተቻለም።'):<span className={styles.fieldSkeleton} role="status" aria-label={text('Loading published terms','የታተሙ ውሎች በመጫን ላይ')}/>)}</span><b>{text('Show more','ተጨማሪ ያሳዩ')}<ChevronDown size={12} aria-hidden="true"/></b></summary>{full&&<><p>{description}</p><p>{full.terms.noWinnerTerms}</p><p>{full.terms.cancellationTerms}</p></>}<small>{known.terms.ruleVersion} · v{known.terms.version}</small><p><Link href={`/auctions/${auction.code}`} prefetch={false}>{text('Full auction details','ሙሉ የጨረታ ዝርዝሮች')}</Link></p></details>
  {detailQuery.error&&<p className={styles.error} role="status">{text(full?'Showing saved auction details. Refresh failed.':'Auction details could not load.',full?'የተቀመጡ የጨረታ ዝርዝሮች ይታያሉ። ማደስ አልተሳካም።':'የጨረታውን ዝርዝር ማምጣት አልተቻለም።')} <button className={styles.inlineRetry} onClick={detailQuery.reload}>{text('Retry','እንደገና')}</button></p>}
  <div className={styles.feeStrip} data-discount-applied={applied?.coupon?.percent}><div><small>{text(applied?'To pay':'Bid fee',applied?'የሚከፈል':'የጨረታ ክፍያ')}{applied&&<> · <del>{formatEtb(terms.entryFeePoints)}</del></>}</small><strong>{fee}</strong>{applied&&<small className={styles.discountSaving}>−{formatEtb(applied.discountPoints)} · {applied.coupon!.percent}% {text('discount','ቅናሽ')}</small>}</div><span className={styles.bidCount}><Ticket size={11} aria-hidden="true"/>{known.bidCount.toLocaleString()} {text('bids','ጨረታዎች')}</span><span className={styles.feeTiming}><Clock3 size={14} aria-hidden="true"/><AuctionCountdown target={known.endsAt} serverNow={state?.serverNow??serverNow} observedAt={state?query.updatedAt:undefined} label="Ends" showLabel={false} onElapsed={refreshEnded}/></span></div>
  {authenticated&&active&&current?<>
   <div className={styles.inputHeading}><label className={styles.inputLabel} htmlFor={id}>{text('Your bid number','የጨረታ ቁጥርዎ')}</label><p className={styles.range}>{bounds?<>{text('From','ከ')} {bounds.minPoints}{bounds.maxPoints!==null?` – ${bounds.maxPoints}`:''} · {text('Step','ልዩነት')} {bounds.stepPoints}</>:<span className={styles.fieldSkeleton} role="status" aria-label={text('Loading bid limits','የጨረታ ገደቦች በመጫን ላይ')}/>}</p></div><div className={styles.amountInput}><span aria-hidden="true">#</span><input id={id} inputMode="decimal" autoComplete="off" maxLength={19} value={number} onChange={event=>setNumber(event.target.value)} disabled={!bounds||walletBusy} placeholder={text('Enter your bid number…','የጨረታ ቁጥርዎን ያስገቡ…')} aria-describedby={`${id}-rules`}/></div>
   <div className={styles.balanceNote}><Wallet size={15} aria-hidden="true"/><p>{text('Available:','ያለዎት፦')} {balance!==null?`${balance} ETB`:wallet.error?text('Unavailable','አይገኝም'):<span className={styles.fieldSkeleton} role="status" aria-label={text('Loading wallet balance','የዋሌት ቀሪ ሂሳብ በመጫን ላይ')}/>} · {text('Top up once and use your wallet for quick bidding.','ገንዘብ አንድ ጊዜ ያስገቡና በዋሌትዎ በቀላሉ ይጫረቱ።')} <WalletTopUpTrigger ariaLabel={text('Top up balance','ቀሪ ሂሳብ ይጨምሩ')}>{text('Top up','ገንዘብ ያስገቡ')}</WalletTopUpTrigger></p></div>
   {state&&state.remainingSubmissions<state.terms.maxDistinctBids&&<p className={styles.remaining}>{state.remainingSubmissions} {text('submissions left','ቀሪ ጨረታዎች')}</p>}
   {state&&number&&!preview&&<p className={styles.error}>{text('Choose a number within the displayed range and step.','በሚታየው ክልል እና ልዩነት ውስጥ ቁጥር ይምረጡ።')}</p>}{preview?.duplicate&&<p className={styles.error}>{text('You already submitted this number.','ይህን ቁጥር አስቀድመው አቅርበዋል።')}</p>}{preview?.consecutive&&<p className={styles.error}>{text('Leave a gap after three consecutive numbers.','ከሦስት ተከታታይ ቁጥሮች በኋላ ክፍተት ይተዉ።')}</p>}
   {canUseDiscount&&<><div className={styles.earnedDiscount} data-active={applyDiscount||!!applied}><Ticket size={17} aria-hidden="true"/><div><strong>{applied?text(`${applied.coupon!.percent}% discount applied`,`${applied.coupon!.percent}% ቅናሽ ተተግብሯል`):text('Referral reward','የግብዣ ሽልማት')}</strong><small role="status">{discountQuery.fetching&&!applied?text('Checking your rewards…','ሽልማቶችዎን በመፈተሽ ላይ…'):applied?text('One reward · applies to the fee only','አንድ ሽልማት · ለክፍያው ብቻ'):applyDiscount&&discountQuery.data&&!discountQuery.data.coupon?text('No available reward. Invite a friend from Profile.','የሚጠቀሙበት ሽልማት የለም። ከመገለጫዎ ጓደኛ ይጋብዙ።'):text('Use a reward earned by referring a friend','ጓደኛ በመጋበዝ ያገኙትን ሽልማት ይጠቀሙ')}</small></div><button type="button" disabled={walletBusy||discountQuery.fetching&&!applied} aria-label={text(applied?'Remove earned discount':'Apply earned discount',applied?'ያገኙትን ቅናሽ ያስወግዱ':'ያገኙትን ቅናሽ ይተግብሩ')} onClick={()=>{setDiscountExpired(false);if(applied)setApplyDiscount(false);else{setApplyDiscount(true);discountQuery.reload()}}}>{text(applied?'Remove':'Apply',applied?'አስወግድ':'ተግብር')}</button></div>{discountExpired&&<p className={styles.error} role="status">{text('That reward expired. Apply another available discount.','የሽልማቱ ጊዜ አልፏል። ሌላ ያለ ቅናሽ ይተግብሩ።')}</p>}{discountQuery.error&&<p className={styles.error} role="status">{text('Could not apply the discount.','ቅናሹን መተግበር አልተቻለም።')} <button className={styles.inlineRetry} type="button" onClick={()=>{query.reload();discountQuery.reload()}}>{text('Retry','እንደገና')}</button></p>}</>}
   <fieldset className={styles.methods} disabled={walletBusy}><legend><CreditCard size={14} aria-hidden="true"/>{text('Select payment method','የክፍያ መንገድ ይምረጡ')}</legend><div className={styles.methodChoices}><label className={`${styles.method} ${method==='chapa'?styles.selected:''}`}><span className={styles.providerLogo}><ChapaLogo/></span><span className="sr-only">Chapa</span><input type="radio" name={`${id}-method`} value="chapa" checked={method==='chapa'} onChange={()=>setMethod('chapa')} aria-label="Chapa"/></label><div className={styles.walletRow}><label className={`${styles.method} ${method==='wallet'?styles.selected:''}`}><span className={styles.methodIcon}><Wallet size={20} aria-hidden="true"/></span><span className={styles.methodText}><strong>{text('Wallet','ዋሌት')}</strong></span><input type="radio" name={`${id}-method`} value="wallet" checked={method==='wallet'} onChange={()=>setMethod('wallet')} aria-label={text('Wallet balance','የዋሌት ቀሪ ሂሳብ')}/></label><WalletTopUpTrigger className={styles.topUpLink} ariaLabel={text('Top up wallet','ወደ ዋሌት ገንዘብ ያስገቡ')}><Plus size={16} aria-hidden="true"/><span className="sr-only">{text('Top up','ገንዘብ ያስገቡ')}</span></WalletTopUpTrigger></div></div></fieldset>
   {method==='wallet'&&insufficient&&<p className={styles.error}>{text(availability.data?.enabled?'Your balance is below this submission fee. Top up or choose Chapa.':'Your balance is below this submission fee. Top-ups are not available yet.',availability.data?.enabled?'ቀሪ ሂሳቡ አይበቃም። ገንዘብ ያስገቡ ወይም Chapa ይምረጡ።':'የዋሌት ቀሪ ሂሳብዎ ከክፍያው ያነሰ ነው።')}</p>}
   <p className={styles.hint} id={`${id}-rules`}>{text('Your number isn’t charged. The submission fee is non-refundable.','የመረጡት ቁጥር አይከፈልም። የማቅረቢያ ክፍያው አይመለስም።')}</p>
  </>:authenticated&&<p className={styles.availability}>{text(!active?'This auction is not open for bids.':'New entries are unavailable for this older auction. Its published terms remain unchanged.',!active?'ይህ ጨረታ ለጨረታ ክፍት አይደለም።':'ለዚህ የቆየ ጨረታ አዲስ ጨረታ ማቅረብ አይቻልም። የታተሙ ውሎቹ አልተለወጡም።')}</p>}
  {wallet.error&&<p className={styles.error} role="status">{text(balance?'Showing the saved balance. Refresh failed.':'Balance is unavailable.',balance?'የተቀመጠው ቀሪ ሂሳብ ይታያል። ማደስ አልተሳካም።':'ቀሪ ሂሳቡ አይገኝም።')} <button className={styles.inlineRetry} onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
  {(walletError||payment.error)&&<p className={styles.error} role="alert">{walletError||payment.error}</p>}{availability.error&&<p className={styles.error} role="status">{text('Payment options could not refresh.','የክፍያ አማራጮችን ማደስ አልተቻለም።')} <button className={styles.inlineRetry} onClick={availability.reload}>{text('Retry','እንደገና')}</button></p>}
  <div className={styles.links}><Link href="/terms" prefetch={false}>{text('Terms','ውሎች')}</Link><Link href="/privacy" prefetch={false}>{text('Privacy','ግላዊነት')}</Link></div></div>
 </>;
}
