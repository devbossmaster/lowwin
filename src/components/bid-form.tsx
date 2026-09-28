'use client';
import { useCallback,useEffect,useMemo,useState } from 'react';
import Link from 'next/link';
import { ArrowRight,LockKeyhole,RefreshCw,ShieldCheck } from 'lucide-react';
import { useTelegram } from './telegram-provider';
import { IdentityState } from './identity-state';
import { formatEtb } from '@/lib/money';
import {useMiniNotice} from './mini-notice';
type OwnBid={id:string;amount:string;acceptedAt:string};
type BidState={auctionCode:string;open:boolean;serverNow:string;isDemo:boolean;terms:{version:number;minPoints:string;maxPoints:string;stepPoints:string;entryFeePoints:string;maxDistinctBids:number};wallet:{available:string;held:string};previousMax:string;remainingSubmissions:number;ownBids:OwnBid[]};
type Receipt={bid:{id:string;auctionCode:string;auctionSlug:string;amount:string;acceptedAt:string;termsVersion:number;feePoints:string};hold:{previousMax:string;newMax:string;extraReserved:string};charge:{feePoints:string;newlyUnavailable:string};wallet:{available:string;held:string};remainingSubmissions:number;ownBids:OwnBid[]};
const integer=/^[1-9]\d{0,15}$/;
type BidFormProps={slug:string;status:'live'|'upcoming'|'closing'|'closed'|'cancelled';isDemo:boolean};
export function BidForm(props:BidFormProps) {
  const {me}=useTelegram();
  return <div id="bid-review"><BidFormForIdentity key={me?.user.id??'guest'} {...props}/></div>;
}
function BidFormForIdentity({slug,status,isDemo}:BidFormProps) {
  const {status:authStatus,refreshMe}=useTelegram();
  const notify=useMiniNotice();
  const [state,setState]=useState<BidState|null>(null),[loading,setLoading]=useState(false),[amount,setAmount]=useState(''),[key,setKey]=useState<string|null>(null),[confirm,setConfirm]=useState(false),[submitting,setSubmitting]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<Receipt|null>(null);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');
    try {const response=await fetch(`/api/auctions/${slug}/bids`,{cache:'no-store',signal});if(!response.ok)throw new Error('Bid details are unavailable.');setState(await response.json())}
    catch(cause){if(!signal?.aborted)setError(cause instanceof Error?cause.message:'Bid details are unavailable.')}
    finally {if(!signal?.aborted)setLoading(false)}
  },[slug]);
  useEffect(()=>{if(authStatus!=='authenticated'){setState(null);setReceipt(null);return}const controller=new AbortController();void refresh(controller.signal);return()=>controller.abort()},[authStatus,refresh]);
  const preview=useMemo(()=>{
    if(!state||!integer.test(amount))return null;
    const value=BigInt(amount),terms=state.terms,minimum=BigInt(terms.minPoints),maximum=BigInt(terms.maxPoints),step=BigInt(terms.stepPoints),previous=BigInt(state.previousMax),fee=BigInt(terms.entryFeePoints);
    if(value<minimum||value>maximum||(value-minimum)%step!==0n)return null;
    const extra=value>previous?value-previous:0n;
    return {amount:value.toString(),previous:previous.toString(),newMax:(previous+extra).toString(),extra:extra.toString(),fee:fee.toString(),total:(extra+fee).toString(),enough:BigInt(state.wallet.available)>=extra+fee,duplicate:state.ownBids.some(bid=>bid.amount===amount)};
  },[amount,state]);
  if(authStatus==='loading')return <div className="bid-panel" role="status">Checking your session…</div>;
  if(authStatus!=='authenticated')return <div className="bid-panel"><h2>Ready when you are</h2><p>Open Lowwin in Telegram and sign in before submitting an ETB bid.</p><IdentityState/></div>;
  if(loading&&!state)return <div className="bid-panel" role="status">Loading your ETB balance and bid terms…</div>;
  if(!state)return <div className="bid-panel"><p role="alert">{error||'Bid details are unavailable.'}</p><button className="text-link" onClick={()=>void refresh()}><RefreshCw size={16}/> Retry</button></div>;
  if(receipt)return <section className="bid-panel receipt-panel" aria-live="polite"><ShieldCheck size={26}/><h2>{formatEtb(receipt.bid.amount)} bid accepted</h2><p>Accepted {new Date(receipt.bid.acceptedAt).toLocaleString('en',{dateStyle:'medium',timeStyle:'medium'})}. This receipt records your bid; it does not predict a winner.</p><dl className="bid-preview-list"><div><dt>Extra ETB reserved</dt><dd>{formatEtb(receipt.hold.extraReserved)}</dd></div><div><dt>Entry fee charged</dt><dd>{formatEtb(receipt.charge.feePoints)}</dd></div><div><dt>Available now</dt><dd>{formatEtb(receipt.wallet.available)}</dd></div><div><dt>Held now</dt><dd>{formatEtb(receipt.wallet.held)}</dd></div><div><dt>Submissions left</dt><dd>{receipt.remainingSubmissions}</dd></div></dl><button className="secondary-button" onClick={()=>{setReceipt(null);setAmount('');setKey(null);setConfirm(false)}}>Submit another amount</button><Link className="text-link" href="/wallet">View wallet <ArrowRight size={16}/></Link></section>;
  if(!state.open||status!=='live')return <><div className="bid-unavailable"><LockKeyhole size={19}/><div><strong>{status==='closing'?'Closing / result pending':status==='cancelled'?'Auction cancelled':status==='upcoming'?'Bidding has not opened':status==='closed'?'Bidding has closed':isDemo?'DEMO bids unavailable here':'Bidding unavailable'}</strong><p>{status==='closing'?'Bidding has ended. Settlement is pending.':status==='cancelled'?'Auction holds and charged entry fees have been returned.':isDemo?'DEMO bidding requires an enrolled staging tester or isolated local test account.':'Your existing bids remain private to you.'}</p></div></div>{state.ownBids.length>0&&<div className="own-bids"><h3>Your accepted amounts</h3><div>{state.ownBids.map(bid=><span key={bid.id}>{formatEtb(bid.amount)}</span>)}</div></div>}</>;
  const valid=!!preview&&!preview.duplicate&&preview.enough&&state.remainingSubmissions>0;
  const change=(value:string)=>{setAmount(value);setKey(null);setConfirm(false);setError('')};
  const submit=async()=>{
    if(!valid||submitting)return;
    const requestKey=key??crypto.randomUUID();setKey(requestKey);setSubmitting(true);setError('');
    try {const response=await fetch(`/api/auctions/${slug}/bids`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount,key:requestKey})});const body=await response.json();if(!response.ok){setError(body.error??'Bid was not accepted.');notify(body.error??'Bid was not accepted.','error');if(body.code==='AUCTION_CLOSED')void refresh();return}const accepted=body as Receipt;setReceipt(accepted);notify(`${formatEtb(accepted.bid.amount)} bid accepted.`,'success');setState(previous=>previous?{...previous,wallet:accepted.wallet,previousMax:accepted.hold.newMax,remainingSubmissions:accepted.remainingSubmissions,ownBids:accepted.ownBids}:previous);void refreshMe().catch(()=>{});}
    catch {const message='Connection interrupted. Retry this same request; it cannot debit you twice.';setError(message);notify(message,'error')}
    finally {setSubmitting(false)}
  };
  return <section className="bid-panel"><h2>Choose an ETB amount</h2><p>From {formatEtb(state.terms.minPoints)} to {formatEtb(state.terms.maxPoints)}, in steps of {formatEtb(state.terms.stepPoints)}. You have {state.remainingSubmissions} of {state.terms.maxDistinctBids} submissions left.</p>
    <label className="bid-input-label" htmlFor="etb-bid">ETB amount</label><div className="bid-input-wrap"><input id="etb-bid" inputMode="numeric" autoComplete="off" pattern="[1-9][0-9]*" maxLength={16} value={amount} onChange={event=>change(event.target.value)} placeholder="Whole ETB"/><span>ETB</span></div>
    {amount&&!preview&&<p className="field-error">Choose a whole ETB amount that matches the range and step.</p>}{preview?.duplicate&&<p className="field-error">You already submitted this amount.</p>}{preview&&!preview.enough&&<p className="field-error">You need {formatEtb(preview.total)} available for the added hold and fee.</p>}{state.remainingSubmissions===0&&<p className="field-error">You have reached the 100 distinct-bid limit.</p>}
    <div className="bid-balance-line"><span>Available {formatEtb(state.wallet.available)}</span><span>Held {formatEtb(state.wallet.held)}</span></div>
    {!confirm?<button className="primary-bid-button" disabled={!valid} onClick={()=>setConfirm(true)}>Review ETB bid <ArrowRight size={18}/></button>:<div className="bid-confirm" aria-labelledby="bid-confirm-title"><h3 id="bid-confirm-title">Confirm {formatEtb(preview!.amount)} bid</h3><dl className="bid-preview-list"><div><dt>Previous maximum hold</dt><dd>{formatEtb(preview!.previous)}</dd></div><div><dt>New maximum hold</dt><dd>{formatEtb(preview!.newMax)}</dd></div><div><dt>Extra ETB reserved</dt><dd>{formatEtb(preview!.extra)}</dd></div><div><dt>Entry fee</dt><dd>{formatEtb(preview!.fee)}</dd></div><div className="preview-total"><dt>Total newly unavailable</dt><dd>{formatEtb(preview!.total)}</dd></div><div><dt>Submissions after this</dt><dd>{state.remainingSubmissions-1}</dd></div></dl><p>These values are a preview. The server rechecks your balance, the auction clock and frozen terms before acceptance.</p><div className="bid-confirm-actions"><button className="secondary-button" onClick={()=>setConfirm(false)} disabled={submitting}>Edit</button><button className="primary-bid-button" onClick={()=>void submit()} disabled={submitting||!valid}>{submitting?'Submitting…':'Confirm bid'}</button></div></div>}
    {error&&<p className="field-error" role="alert">{error}</p>}
    {state.ownBids.length>0&&<div className="own-bids"><h3>Your amounts</h3><p>Only you can see these while the auction is live.</p><div>{state.ownBids.map(bid=><span key={bid.id}>{formatEtb(bid.amount)}</span>)}</div></div>}
  </section>;
}
