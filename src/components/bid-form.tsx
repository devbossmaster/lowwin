'use client';
import {createsFourConsecutiveAmounts} from '@/modules/auctions/consecutive-bids';
import {isSubmissionFeeOnly,usesDecimalBids} from '@/modules/auctions/rules';
import {useMiniLocale} from './mini-locale';
import {useWalletCopy} from './wallet-copy';
import {BidConfirmDialog} from './bid-confirm-dialog';
import {LoadingSpinner} from '@/components/loading-spinner';

import { useCallback,useEffect,useMemo,useState } from 'react';
import Link from 'next/link';
import { ArrowRight,LockKeyhole,RefreshCw,ShieldCheck } from 'lucide-react';
import { useTelegram } from './telegram-provider';
import { IdentityState } from './identity-state';
import { formatEtb,etbToCents,centsToEtb } from '@/lib/money';
import {useMiniNotice} from './mini-notice';
import {useCelebration} from './celebration';
type OwnBid={id:string;amount:string;acceptedAt:string};
type BidState={auctionCode:string;open:boolean;serverNow:string;isDemo:boolean;terms:{ruleVersion:string;minParticipants:number;version:number;minPoints:string;maxPoints:string|null;stepPoints:string;entryFeePoints:string;maxDistinctBids:number};wallet:{available:string;held:string};previousMax:string;remainingSubmissions:number;ownBids:OwnBid[]};
type Receipt={bid:{id:string;auctionCode:string;auctionSlug:string;amount:string;acceptedAt:string;termsVersion:number;feePoints:string};hold:{previousMax:string;newMax:string;extraReserved:string};charge:{feePoints:string;newlyUnavailable:string};wallet:{available:string;held:string};remainingSubmissions:number;ownBids:OwnBid[]};
const integer=/^[1-9]\d{0,15}(?:\.\d{1,2})?$/;
type BidFormProps={slug:string;status:'live'|'upcoming'|'closing'|'closed'|'cancelled';isDemo:boolean;compact?:boolean};
export function BidForm(props:BidFormProps) {
  const {me}=useTelegram();
  return <div id="bid-review"><BidFormForIdentity key={me?.user.id??'guest'} {...props}/></div>;
}
function BidFormForIdentity({slug,status,isDemo,compact=false}:BidFormProps) {
  const {status:authStatus,refreshMe}=useTelegram();
  const w=useWalletCopy();const {language}=useMiniLocale();
  const notify=useMiniNotice();
  const celebrate=useCelebration();
  const [state,setState]=useState<BidState|null>(null),[loading,setLoading]=useState(false),[amount,setAmount]=useState(''),[key,setKey]=useState<string|null>(null),[confirm,setConfirm]=useState(false),[agreed,setAgreed]=useState(false),[submitting,setSubmitting]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<Receipt|null>(null);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');
    try {const response=await fetch(`/api/auctions/${slug}/bids`,{cache:'no-store',signal});if(!response.ok)throw new Error('Bid details are unavailable.');setState(await response.json())}
    catch(cause){if(!signal?.aborted)setError(cause instanceof Error?cause.message:'Bid details are unavailable.')}
    finally {if(!signal?.aborted)setLoading(false)}
  },[slug]);
  useEffect(()=>{if(authStatus!=='authenticated'){setState(null);setReceipt(null);return}const controller=new AbortController();void refresh(controller.signal);return()=>controller.abort()},[authStatus,refresh]);
  const feeOnly=isSubmissionFeeOnly(state?.terms.ruleVersion);
  const bidLabel=(value:string)=>feeOnly?centsToEtb(etbToCents(value)):formatEtb(value);
  const preview=useMemo(()=>{
    if(!state||!integer.test(amount))return null;
    const value=etbToCents(amount),terms=state.terms,minimum=etbToCents(terms.minPoints),maximum=terms.maxPoints===null?null:etbToCents(terms.maxPoints),step=etbToCents(terms.stepPoints),previous=etbToCents(state.previousMax),fee=etbToCents(terms.entryFeePoints);
    if(value<minimum||(maximum!==null&&value>maximum)||(value-minimum)%step!==0n)return null;
    const extra=isSubmissionFeeOnly(terms.ruleVersion)?0n:value>previous?value-previous:0n;
    return {amount:centsToEtb(value),previous:centsToEtb(previous),newMax:centsToEtb((previous+extra)),extra:centsToEtb(extra),fee:centsToEtb(fee),total:centsToEtb((extra+fee)),enough:etbToCents(state.wallet.available)>=extra+fee,consecutive:usesDecimalBids(state.terms.ruleVersion)&&createsFourConsecutiveAmounts(state.ownBids.map(b=>etbToCents(b.amount)),value),duplicate:state.ownBids.some(bid=>etbToCents(bid.amount)===value)};
  },[amount,state]);
  if(authStatus==='loading')return <LoadingSpinner/>;
  if(authStatus!=='authenticated')return <div className="bid-panel"><h2>{w("Ready when you are")}</h2><p>{w("Open Lowwin in Telegram and sign in before submitting an ETB bid.")}</p><IdentityState/></div>;
  if(loading&&!state)return <LoadingSpinner/>;
  if(!state)return <div className="bid-panel"><p role="alert">{w(error||'Bid details are unavailable.')}</p><button className="text-link" onClick={()=>void refresh()}><RefreshCw size={16}/> {w("Retry")}</button></div>;
  if(receipt)return <section className="bid-panel receipt-panel" aria-live="polite"><ShieldCheck size={26}/><h2>{bidLabel(receipt.bid.amount)} {w("bid accepted")}</h2><p>{w("Accepted")} {new Date(receipt.bid.acceptedAt).toLocaleString(language==='am'?'am-ET':'en-ET',{dateStyle:'medium',timeStyle:'medium',timeZone:'Africa/Addis_Ababa'})}. {w("This receipt records your bid; it does not predict a winner.")}</p><dl className="bid-preview-list">{!feeOnly&&<div><dt>{w("Extra ETB reserved")}</dt><dd>{formatEtb(receipt.hold.extraReserved)}</dd></div>}{(feeOnly||Number(receipt.charge.feePoints)>0)&&<div><dt>{w("Submission fee charged")}</dt><dd>{formatEtb(receipt.charge.feePoints)}</dd></div>}<div><dt>{w("Available now")}</dt><dd>{formatEtb(receipt.wallet.available)}</dd></div>{!feeOnly&&<div><dt>{w("Held now")}</dt><dd>{formatEtb(receipt.wallet.held)}</dd></div>}<div><dt>{w("Submissions left")}</dt><dd>{receipt.remainingSubmissions}</dd></div></dl><button className="secondary-button" onClick={()=>{setReceipt(null);setAmount('');setKey(null);setConfirm(false)}}>{w("Submit another amount")}</button><Link className="text-link" href="/wallet">{w("View wallet")} <ArrowRight size={16}/></Link></section>;
  if(!state.open||status!=='live')return <><div className="bid-unavailable"><LockKeyhole size={19}/><div><strong>{w(status==='closing'?'Auction ended':status==='cancelled'?'Auction cancelled':status==='upcoming'?'Bidding has not opened':status==='closed'?'Bidding has closed':isDemo?'DEMO bids unavailable here':'Bidding unavailable')}</strong>{status!=='closing'&&<p>{w(status==='cancelled'?(feeOnly?'Auction cancelled. Submission fees are non-refundable.':'Auction holds and charged entry fees have been returned.'):isDemo?'DEMO bidding requires an enrolled staging tester or isolated local test account.':'Your existing bids remain private to you.')}</p>}</div></div>{state.ownBids.length>0&&<div className="own-bids"><h3>{w("Your accepted amounts")}</h3><div>{state.ownBids.map(bid=><span key={bid.id}>{bidLabel(bid.amount)}</span>)}</div></div>}</>;
  const valid=!!preview&&!preview.consecutive&&!preview.duplicate&&preview.enough&&state.remainingSubmissions>0;
  const change=(value:string)=>{setAmount(value);setKey(null);setConfirm(false);setAgreed(false);setError('')};
  const stepAmount=(direction:1|-1)=>{
    const minimum=etbToCents(state.terms.minPoints),maximum=state.terms.maxPoints===null?null:etbToCents(state.terms.maxPoints),step=etbToCents(state.terms.stepPoints);
    const next=preview?etbToCents(preview.amount)+BigInt(direction)*step:minimum;
    change(centsToEtb((next<minimum?minimum:maximum!==null&&next>maximum?maximum:next)));
  };
  const submit=async()=>{
    if(!valid||submitting||!agreed)return;
    const requestKey=key??crypto.randomUUID();setKey(requestKey);setSubmitting(true);setError('');
    try {const response=await fetch(`/api/auctions/${slug}/bids`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount,key:requestKey,feeVersion:state.terms.version})});const body=await response.json();if(!response.ok){setError(body.error??'Bid was not accepted.');notify(body.error??'Bid was not accepted.','error');if(body.code==='AUCTION_CLOSED'||body.code==='RETRYABLE_CONFLICT'){setConfirm(false);setAgreed(false);setKey(null);void refresh()}return}const accepted=body as Receipt;setConfirm(false);setAgreed(false);setReceipt(accepted);notify(`${bidLabel(accepted.bid.amount)} ${w('bid accepted')}`,'success');setState(previous=>previous?{...previous,wallet:accepted.wallet,previousMax:accepted.hold.newMax,remainingSubmissions:accepted.remainingSubmissions,ownBids:accepted.ownBids}:previous);celebrate();void refreshMe().catch(()=>{});}
    catch {const message='Connection interrupted. Retry this same request; it cannot debit you twice.';setError(message);notify(message,'error')}
    finally {setSubmitting(false)}
  };
  return <section className={`bid-panel${compact?' bid-panel-compact':''}`}>{!compact&&<h2>{w("Choose a bid number")}</h2>}<p>{language==='am'?'ከ':'From'} {bidLabel(state.terms.minPoints)}{state.terms.maxPoints!==null?` – ${bidLabel(state.terms.maxPoints)}`:''} / {w("Step")} {bidLabel(state.terms.stepPoints)} / {w("Submissions left")}: {state.remainingSubmissions}</p>
    <label className={compact?'sr-only':'bid-input-label'} htmlFor="etb-bid">{w("Bid number")}</label><div className="bid-input-wrap">{compact&&<button type="button" className="bid-step" aria-label={w("Decrease bid amount")} disabled={submitting||!!preview&&etbToCents(preview.amount)<=etbToCents(state.terms.minPoints)} onClick={()=>stepAmount(-1)}>−</button>}<input id="etb-bid" inputMode="decimal" autoComplete="off" pattern="[1-9][0-9]*([.][0-9]{1,2})?" maxLength={19} value={amount} disabled={submitting} onChange={event=>change(event.target.value)} placeholder={w(compact?'Bid number':'Number, up to 2 decimals')}/>{compact?<button type="button" className="bid-step" aria-label={w("Increase bid amount")} disabled={submitting||state.terms.maxPoints!==null&&!!preview&&etbToCents(preview.amount)>=etbToCents(state.terms.maxPoints)} onClick={()=>stepAmount(1)}>+</button>:<span>{feeOnly?'#':'ETB'}</span>}</div>
    {amount&&!preview&&<p className="field-error">{state.terms.maxPoints!==null?`Enter ${bidLabel(state.terms.minPoints)}–${bidLabel(state.terms.maxPoints)} ETB in ${bidLabel(state.terms.stepPoints)} ETB steps.`:language==='am'?'ከ1.00 ብር ጀምሮ እስከ ሁለት የአስርዮሽ ቦታዎች ያለውን መጠን ያስገቡ።':'Enter at least 1.00 with up to two decimal places.'}</p>}{preview?.consecutive&&<p className="field-error">{w("Leave a gap after three consecutive cent amounts.")}</p>}{preview?.duplicate&&<p className="field-error">{w("You already submitted this amount.")}</p>}{preview&&!preview.enough&&<p className="field-error" role="alert">{language==='am'?(Number(preview.fee)>0?'ለዚህ ገንዘብ እና ክፍያ በቂ ቀሪ የለዎትም።':'ለዚህ ጨረታ በቂ ቀሪ የለዎትም።'):'Insufficient balance.'} {language==='am'?'የሚያስፈልግ':'Need'} {formatEtb(preview.total)} · {w("Available")} {formatEtb(state.wallet.available)}. <Link href="/wallet">{language==='am'?'ብር ይጨምሩ':'Add ETB'}</Link></p>}{state.remainingSubmissions===0&&<p className="field-error">{w("You have reached the 100 distinct-bid limit.")}</p>}
    <div className="bid-balance-line"><span>{w("Available")} {formatEtb(state.wallet.available)}</span>{!feeOnly&&<span>{w("Held")} {formatEtb(state.wallet.held)}</span>}</div>
    <button className="primary-bid-button" disabled={!valid} onClick={()=>{setAgreed(false);setConfirm(true)}}>{w("Review bid")} <ArrowRight size={18}/></button>
    {preview&&<BidConfirmDialog open={confirm} language={language} item={state.auctionCode} bidNumber={bidLabel(preview.amount)} submissionFee={formatEtb(preview.fee)} total={formatEtb(preview.total)} feeOnly={feeOnly} agreed={agreed} submitting={submitting} valid={valid} error={error} onAgreedChange={setAgreed} onClose={()=>{setConfirm(false);setAgreed(false)}} onConfirm={()=>void submit()}/>}
    {error&&<p className="field-error" role="alert">{w(error)}</p>}
    {state.ownBids.length>0&&<div className="own-bids"><h3>{w("Your amounts")}</h3><p>{w("Only you can see these while the auction is live.")}</p><div>{state.ownBids.map(bid=><span key={bid.id}>{bidLabel(bid.amount)}</span>)}</div></div>}
  </section>;
}
