'use client';
import {useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import {CheckCircle2,Gavel,Minus,Plus,X} from 'lucide-react';
import {formatEtb} from '@/lib/money';
import {useTelegram} from './telegram-provider';
import {useMiniLocale} from './mini-locale';
import {useMiniNotice} from './mini-notice';
import styles from './featured-carousel.module.css';

type OwnBid={id:string;amount:string;acceptedAt:string};
type BidState={open:boolean;terms:{minPoints:string;maxPoints:string;stepPoints:string;entryFeePoints:string;maxDistinctBids:number};wallet:{available:string;held:string};previousMax:string;remainingSubmissions:number;ownBids:OwnBid[]};
type Receipt={bid:{amount:string;acceptedAt:string};hold:{newMax:string;extraReserved:string};charge:{feePoints:string;newlyUnavailable:string};wallet:{available:string;held:string};remainingSubmissions:number;ownBids:OwnBid[]};
const whole=/^[1-9]\d{0,15}$/;

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
  const dialog=useRef<HTMLDialogElement>(null);
  const titleId=useId();
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
  useEffect(()=>{
    if(confirm&&!dialog.current?.open)dialog.current?.showModal();
    if(!confirm&&dialog.current?.open)dialog.current.close();
  },[confirm]);
  const preview=useMemo(()=>{
    if(!state||!whole.test(amount))return null;
    const bid=BigInt(amount),min=BigInt(state.terms.minPoints),max=BigInt(state.terms.maxPoints),step=BigInt(state.terms.stepPoints),previous=BigInt(state.previousMax),fee=BigInt(state.terms.entryFeePoints);
    if(bid<min||bid>max||(bid-min)%step!==0n)return null;
    const extra=bid>previous?bid-previous:0n,total=extra+fee;
    return {bid:bid.toString(),previous:previous.toString(),newMax:(previous+extra).toString(),extra:extra.toString(),fee:fee.toString(),total:total.toString(),after:(BigInt(state.wallet.available)-total).toString(),enough:BigInt(state.wallet.available)>=total,duplicate:state.ownBids.some(own=>own.amount===amount)};
  },[amount,state]);
  const valid=status==='authenticated'&&!loading&&!!state?.open&&!!preview&&preview.enough&&!preview.duplicate&&state.remainingSubmissions>0;
  const change=(value:string)=>{setAmount(value);setKey(null);setError('');setReceipt(null)};
  const step=(direction:1|-1)=>{
    if(!state)return;
    const min=BigInt(state.terms.minPoints),max=BigInt(state.terms.maxPoints),stepSize=BigInt(state.terms.stepPoints);
    if(!whole.test(amount)){change(min.toString());return}
    const current=BigInt(amount);
    const next=current+BigInt(direction)*stepSize;
    change((next<min?min:next>max?max:next).toString());
  };
  const submit=useCallback(async()=>{
    if(!valid||inFlight.current||!agreed||!preview)return;
    inFlight.current=true;
    const requestKey=key??crypto.randomUUID();setKey(requestKey);setSubmitting(true);setError('');
    try{
      const response=await fetch(`/api/auctions/${slug}/bids`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:preview.bid,key:requestKey}),signal:AbortSignal.timeout(20000)});
      const body=await response.json();
      if(!mounted.current)return;
      if(!response.ok){const message=body.error??'Bid was not accepted.';setError(message);notify(message,'error');if(body.code==='AUCTION_CLOSED')setReload(value=>value+1);return}
      const accepted=body as Receipt;
      setReceipt(accepted);setState(previous=>previous?{...previous,wallet:accepted.wallet,previousMax:accepted.hold.newMax,remainingSubmissions:accepted.remainingSubmissions,ownBids:accepted.ownBids}:previous);
      setConfirm(false);setAmount('');setKey(null);setAgreed(false);
      notify(am?`${formatEtb(accepted.bid.amount)} ጨረታዎ ተቀብሏል።`:`${formatEtb(accepted.bid.amount)} bid accepted. Your wallet has been updated.`,'success');
      void refreshMe().catch(()=>{});
    }catch{
      if(!mounted.current)return;
      const message=am?'ግንኙነቱ ተቋርጧል። በተመሳሳይ ጥያቄ እንደገና ይሞክሩ።':'Connection interrupted. Retry safely with the same request.';
      setError(message);notify(message,'error');
    }finally{inFlight.current=false;if(mounted.current)setSubmitting(false)}
  },[valid,submitting,agreed,preview,key,slug,notify,am,refreshMe]);

  return <div className={styles.bidBox}>
    <div className={styles.amountControl}>
      <button type="button" onClick={()=>step(-1)} disabled={!state?.open||loading} aria-label={am?'መጠኑን ቀንስ':'Decrease bid amount'}><Minus size={18}/></button>
      <label><span className="sr-only">{am?'የጨረታ መጠን በ ETB':'Bid amount in ETB'}</span><input inputMode="numeric" autoComplete="off" pattern="[1-9][0-9]*" maxLength={16} value={amount} onChange={event=>change(event.target.value)} placeholder={am?'የጨረታ መጠን · ETB':'Bid amount · ETB'} disabled={!state?.open||loading||status!=='authenticated'}/></label>
      <button type="button" onClick={()=>step(1)} disabled={!state?.open||loading} aria-label={am?'መጠኑን ጨምር':'Increase bid amount'}><Plus size={18}/></button>
    </div>
    {status==='authenticated'&&state?.open&&<p className={styles.range}>{am?'ከ':'From'} {formatEtb(state.terms.minPoints)} {am?'እስከ':'to'} {formatEtb(state.terms.maxPoints)} · {am?'እርምጃ':'Step'} {formatEtb(state.terms.stepPoints)}</p>}
    {amount&&state&&(!preview||preview.duplicate||!preview.enough)&&<p className={styles.bidError} role="alert">{!preview?(am?'በተፈቀደው ክልልና እርምጃ ያለ ሙሉ ETB ይምረጡ።':'Choose a whole ETB amount within the range and step.'):preview.duplicate?(am?'ይህን መጠን አስቀድመው አቅርበዋል።':'You already submitted this amount.'):(am?'ለተጨማሪ የተያዘ መጠንና ክፍያ በቂ ያለ ቀሪ የለዎትም።':`You need ${formatEtb(preview.total)} available for the hold and fee.`)}</p>}
    {status==='authenticated'&&state?.open&&state.remainingSubmissions===0&&<p className={styles.bidError}>{am?'የ100 የተለያዩ ጨረታዎች ገደብ ደርሰዋል።':'You have reached the 100 distinct-bid limit.'}</p>}
    <button type="button" className={styles.submitBid} disabled={!valid} onClick={()=>{setAgreed(false);setConfirm(true)}}>{loading?(am?'በመጫን ላይ…':'Loading bid details…'):status!=='authenticated'?(am?'ለመጫረት ይግቡ':'Sign in to bid'):state&&!state.open?(am?'ጨረታ አይገኝም':'Bidding unavailable'):(am?'የጨረታ መጠን ያስገቡ':'Submit a bid amount')}</button>
    {loadError&&<p className={styles.bidError} role="alert">{loadError} <button type="button" onClick={()=>setReload(value=>value+1)}>{am?'እንደገና ይሞክሩ':'Retry'}</button></p>}
    {receipt&&<p className={styles.accepted} role="status"><CheckCircle2 size={17}/>{am?'ተቀብሏል':'Accepted'} {formatEtb(receipt.bid.amount)} · {am?'ያለ ቀሪ':'Available'} {formatEtb(receipt.wallet.available)}. {am?'ይህ የድል ዋስትና አይደለም።':'This does not predict a winner.'}</p>}
    <dialog ref={dialog} className={styles.dialog} onCancel={event=>{if(submitting)event.preventDefault();else setConfirm(false)}} onClose={()=>setConfirm(false)} aria-labelledby={titleId}>
      {preview&&state&&<><header><span className={styles.dialogIcon}><Gavel size={19}/></span><h2 id={titleId}>{am?'ጨረታዎን ያረጋግጡ':'Confirm your bid'}</h2><button type="button" onClick={()=>setConfirm(false)} disabled={submitting} aria-label={am?'ዝጋ':'Close'}><X size={19}/></button></header>
      <div className={styles.dialogBody}><dl><div><dt>{am?'ዕቃ':'Item'}</dt><dd>{title}</dd></div><div><dt>{am?'የጨረታ መጠን':'Your bid'}</dt><dd>{formatEtb(preview.bid)}</dd></div><div><dt>{am?'የቀድሞ ከፍተኛ የተያዘ':'Previous maximum hold'}</dt><dd>{formatEtb(preview.previous)}</dd></div><div><dt>{am?'አዲስ ከፍተኛ የተያዘ':'New maximum hold'}</dt><dd>{formatEtb(preview.newMax)}</dd></div><div><dt>{am?'ተጨማሪ የሚያዝ':'Extra reserved'}</dt><dd>{formatEtb(preview.extra)}</dd></div><div><dt>{am?'የመግቢያ ክፍያ':'Entry fee'}</dt><dd>{formatEtb(preview.fee)}</dd></div><div className={styles.dialogTotal}><dt>{am?'አሁን የማይገኝ ጠቅላላ':'Total newly unavailable'}</dt><dd>{formatEtb(preview.total)}</dd></div><div><dt>{am?'ከዚህ በኋላ ያለ ቀሪ':'Available after acceptance'}</dt><dd>{formatEtb(preview.after)}</dd></div><div><dt>{am?'የሚቀሩ ጨረታዎች':'Submissions left'}</dt><dd>{state.remainingSubmissions-1}</dd></div></dl>
      <p className={styles.dialogNote}>{am?'የጨረታው መጠን አሁን ይያዛል፤ አሸናፊው ሲወሰን ብቻ ይከፈላል። ሕጋዊ ጨረታ ሲያበቃ የመግቢያ ክፍያ ይቀራል፤ ከተሰረዘ ይመለሳል።':'The bid amount is held now and charged only if it wins at settlement. The entry fee is retained after a valid close and refunded if the auction is cancelled.'} {am?'ሰርቨሩ ቀሪዎን፣ የመዝጊያ ሰዓትንና ውሎቹን እንደገና ያረጋግጣል።':'The server rechecks your balance, closing time and terms before acceptance.'}</p></div>
      <label className={styles.agreement}><input type="checkbox" checked={agreed} onChange={event=>setAgreed(event.target.checked)}/><span>{am?'ውሎቹንና ክፍያውን ተረድቻለሁ':'I understand the hold and fee'}</span></label>
      {error&&<p className={styles.bidError} role="alert">{error}</p>}
      <button type="button" className={styles.confirmButton} disabled={!agreed||submitting||!valid} onClick={()=>void submit()}>{submitting?(am?'በመላክ ላይ…':'Submitting…'):(am?'አረጋግጥና ጨረታ አቅርብ':'Confirm & submit bid')}</button></>}
    </dialog>
  </div>;
}
