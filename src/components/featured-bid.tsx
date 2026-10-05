'use client';
import {createsFourConsecutiveAmounts} from '@/modules/auctions/consecutive-bids';
import {isSubmissionFeeOnly,usesDecimalBids} from '@/modules/auctions/rules';
import {BidConfirmDialog} from './bid-confirm-dialog';
import {LoadingSpinner} from './loading-spinner';
import Link from 'next/link';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {CheckCircle2,Minus,Plus} from 'lucide-react';
import {formatEtb,etbToCents,centsToEtb} from '@/lib/money';
import {useTelegram} from './telegram-provider';
import {useMiniLocale} from './mini-locale';
import {useMiniNotice} from './mini-notice';
import {useCelebration} from './celebration';
import styles from './featured-carousel.module.css';

type OwnBid={id:string;amount:string;acceptedAt:string};
type BidState={open:boolean;terms:{version:number;ruleVersion:string;minParticipants:number;minPoints:string;maxPoints:string|null;stepPoints:string;entryFeePoints:string;maxDistinctBids:number};wallet:{available:string;held:string};previousMax:string;remainingSubmissions:number;ownBids:OwnBid[]};
type Receipt={bid:{amount:string;acceptedAt:string};hold:{newMax:string;extraReserved:string};charge:{feePoints:string;newlyUnavailable:string};wallet:{available:string;held:string};remainingSubmissions:number;ownBids:OwnBid[]};
const whole=/^[1-9]\d{0,15}(?:\.\d{1,2})?$/;

type Props={slug:string;title:string;onInteractionChange?:(active:boolean)=>void};
export function FeaturedBid(props:Props){
  const {me}=useTelegram();
  return <FeaturedBidForIdentity key={`${props.slug}:${me?.user.id??'guest'}`} {...props}/>;
}
function FeaturedBidForIdentity({slug,title,onInteractionChange}:Props){
  const {status,refreshMe}=useTelegram();
  const {language}=useMiniLocale();
  const am=language==='am';
  const notify=useMiniNotice();
  const celebrate=useCelebration();
  const inFlight=useRef(false);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  const [state,setState]=useState<BidState|null>(null);
  const [loading,setLoading]=useState(false);
  const [loadError,setLoadError]=useState('');
  const [reload,setReload]=useState(0);
  const [amount,setAmount]=useState('');
  const [key,setKey]=useState<string|null>(null);
  const [confirm,setConfirm]=useState(false);
  const [agreed,setAgreed]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState('');
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  useEffect(()=>{onInteractionChange?.(Boolean(amount)||confirm||submitting)},[amount,confirm,submitting,onInteractionChange]);
  useEffect(()=>()=>onInteractionChange?.(false),[onInteractionChange]);

  useEffect(()=>{
    if(status!=='authenticated'){setState(null);return}
    const controller=new AbortController();
    setLoading(true);setLoadError('');
    fetch(`/api/auctions/${slug}/bids`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error??'Bid details are unavailable.');return body as BidState})
      .then(value=>{if(!controller.signal.aborted)setState(value)})
      .catch(cause=>{if(!controller.signal.aborted)setLoadError(cause instanceof Error?cause.message:'Bid details are unavailable.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[slug,status,reload]);
  const feeOnly=isSubmissionFeeOnly(state?.terms.ruleVersion);
  const bidLabel=(value:string)=>feeOnly?centsToEtb(etbToCents(value)):formatEtb(value);
  const preview=useMemo(()=>{
    if(!state||!whole.test(amount))return null;
    const bid=etbToCents(amount),min=etbToCents(state.terms.minPoints),max=state.terms.maxPoints===null?null:etbToCents(state.terms.maxPoints),step=etbToCents(state.terms.stepPoints),previous=etbToCents(state.previousMax),fee=etbToCents(state.terms.entryFeePoints);
    if(bid<min||(max!==null&&bid>max)||(bid-min)%step!==0n)return null;
    const extra=isSubmissionFeeOnly(state.terms.ruleVersion)?0n:bid>previous?bid-previous:0n,total=extra+fee;
    return {bid:centsToEtb(bid),previous:centsToEtb(previous),newMax:centsToEtb((previous+extra)),extra:centsToEtb(extra),fee:centsToEtb(fee),total:centsToEtb(total),after:centsToEtb((etbToCents(state.wallet.available)-total)),enough:etbToCents(state.wallet.available)>=total,consecutive:usesDecimalBids(state.terms.ruleVersion)&&createsFourConsecutiveAmounts(state.ownBids.map(b=>etbToCents(b.amount)),bid),duplicate:state.ownBids.some(own=>etbToCents(own.amount)===bid)};
  },[amount,state]);
  const valid=status==='authenticated'&&!loading&&!!state?.open&&!!preview&&preview.enough&&!preview.consecutive&&!preview.duplicate&&state.remainingSubmissions>0;
  const change=(value:string)=>{setAmount(value);setKey(null);setError('');setReceipt(null)};
  const step=(direction:1|-1)=>{
    if(!state)return;
    const min=etbToCents(state.terms.minPoints),max=state.terms.maxPoints===null?null:etbToCents(state.terms.maxPoints),stepSize=etbToCents(state.terms.stepPoints);
    if(!whole.test(amount)){change(centsToEtb(min));return}
    const current=etbToCents(amount);
    const next=current+BigInt(direction)*stepSize;
    change(centsToEtb((next<min?min:max!==null&&next>max?max:next)));
  };
  const submit=useCallback(async()=>{
    if(!valid||inFlight.current||!agreed||!preview)return;
    inFlight.current=true;
    const requestKey=key??crypto.randomUUID();setKey(requestKey);setSubmitting(true);setError('');
    try{
      const response=await fetch(`/api/auctions/${slug}/bids`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:preview.bid,key:requestKey,feeVersion:state?.terms.version}),signal:AbortSignal.timeout(20000)});
      const body=await response.json();
      if(!mounted.current)return;
      if(!response.ok){const message=body.error??'Bid was not accepted.';setError(message);notify(message,'error');if(body.code==='AUCTION_CLOSED'||body.code==='RETRYABLE_CONFLICT'){setConfirm(false);setAgreed(false);setKey(null);setReload(value=>value+1)}return}
      const accepted=body as Receipt;
      setReceipt(accepted);setState(previous=>previous?{...previous,wallet:accepted.wallet,previousMax:accepted.hold.newMax,remainingSubmissions:accepted.remainingSubmissions,ownBids:accepted.ownBids}:previous);
      setConfirm(false);setAmount('');setKey(null);setAgreed(false);
      notify(am?`${bidLabel(accepted.bid.amount)} ጨረታዎ ተቀብሏል።`:`${bidLabel(accepted.bid.amount)} bid accepted. Your wallet has been updated.`,'success');
      celebrate();
      void refreshMe().catch(()=>{});
    }catch{
      if(!mounted.current)return;
      const message=am?'ግንኙነቱ ተቋርጧል። በተመሳሳይ ጥያቄ እንደገና ይሞክሩ።':'Connection interrupted. Retry safely with the same request.';
      setError(message);notify(message,'error');
    }finally{inFlight.current=false;if(mounted.current)setSubmitting(false)}
  },[valid,submitting,agreed,preview,key,slug,notify,am,refreshMe,celebrate,state?.terms.version,feeOnly]);

  return <div className={styles.bidBox}><span className={styles.bidLabel}>{am?'የጨረታ ቁጥር':'Your bid number'}</span>
    <div className={styles.amountControl}>
      <button type="button" onClick={()=>step(-1)} disabled={!state?.open||loading} aria-label={am?'መጠኑን ቀንስ':'Decrease bid amount'}><Minus size={18}/></button>
      <label><span className="sr-only">{am?'የጨረታ ቁጥር':'Bid number'}</span><input inputMode="decimal" autoComplete="off" pattern="[1-9][0-9]*([.][0-9]{1,2})?" maxLength={19} value={amount} onChange={event=>change(event.target.value)} placeholder={am?'የጨረታ ቁጥር':'Bid number'} disabled={!state?.open||loading||status!=='authenticated'}/></label>
      <button type="button" onClick={()=>step(1)} disabled={!state?.open||loading} aria-label={am?'መጠኑን ጨምር':'Increase bid amount'}><Plus size={18}/></button>
    </div>
    {status==='authenticated'&&state?.open&&<p className={styles.range}>{am?'ከ':'From'} {bidLabel(state.terms.minPoints)} {state.terms.maxPoints!==null&&<>{am?'እስከ':'to'} {bidLabel(state.terms.maxPoints)}</>} · {am?'እርምጃ':'Step'} {bidLabel(state.terms.stepPoints)}</p>}
    {amount&&state&&(!preview||preview.consecutive||preview.duplicate||!preview.enough)&&<p className={styles.bidError} role="alert">{!preview?(am?'ከ1.00 ጀምሮ እስከ ሁለት የአስርዮሽ ቦታዎች ያለውን መጠን ያስገቡ።':'Enter at least 1.00 with up to two decimal places.'):preview.consecutive?(am?'ሦስት ተከታታይ የሳንቲም መጠኖችን ካቀረቡ በኋላ የሚቀጥለውን ሳንቲም ይዝለሉ።':'Leave a gap after three consecutive cent amounts.'):preview.duplicate?(am?'ይህን መጠን አስቀድመው አቅርበዋል።':'You already submitted this amount.'):(<>{am?'ለዚህ ጨረታ በቂ ቀሪ የለዎትም።':'Insufficient balance.'} {am?'የሚያስፈልግ':'Need'} {formatEtb(preview.total)} · {am?'ያለ ቀሪ':'Available'} {formatEtb(state.wallet.available)}. <Link href="/wallet">{am?'ብር ይጨምሩ':'Add ETB'}</Link></>)}</p>}
    {status==='authenticated'&&state?.open&&state.remainingSubmissions===0&&<p className={styles.bidError}>{am?'የ100 የተለያዩ ጨረታዎች ገደብ ደርሰዋል።':'You have reached the 100 distinct-bid limit.'}</p>}
    <button type="button" className={styles.submitBid} disabled={!valid} onClick={()=>{setAgreed(false);setConfirm(true)}}>{loading?<LoadingSpinner/>:status!=='authenticated'?(am?'ለመጫረት ይግቡ':'Sign in to bid'):state&&!state.open?(am?'ጨረታ አይገኝም':'Bidding unavailable'):(am?'ጨረታውን ይከልሱ':'Review bid')}</button>
    {loadError&&<p className={styles.bidError} role="alert">{loadError} <button type="button" onClick={()=>setReload(value=>value+1)}>{am?'እንደገና ይሞክሩ':'Retry'}</button></p>}
    {receipt&&<p className={styles.accepted} role="status"><CheckCircle2 size={17}/>{am?'ተቀብሏል':'Accepted'} {bidLabel(receipt.bid.amount)} · {am?'ያለ ቀሪ':'Available'} {formatEtb(receipt.wallet.available)}. {am?'ይህ የድል ዋስትና አይደለም።':'This does not predict a winner.'}</p>}
    {preview&&state&&<BidConfirmDialog open={confirm} language={language} item={title} bidNumber={bidLabel(preview.bid)} submissionFee={formatEtb(preview.fee)} total={formatEtb(preview.total)} feeOnly={feeOnly} agreed={agreed} submitting={submitting} valid={valid} error={error} onAgreedChange={setAgreed} onClose={()=>{setConfirm(false);setAgreed(false)}} onConfirm={()=>void submit()}/>}
  </div>;
}
