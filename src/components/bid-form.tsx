'use client';
import {createsFourConsecutiveAmounts} from '@/modules/auctions/consecutive-bids';
import {RULE_V3} from '@/modules/auctions/rules';
import {useMiniLocale} from './mini-locale';
import {useWalletCopy} from './wallet-copy';
import {AuctionRule} from './auction-rule';
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
type BidState={auctionCode:string;open:boolean;serverNow:string;isDemo:boolean;terms:{ruleVersion:string;minParticipants:number;version:number;minPoints:string;maxPoints:string;stepPoints:string;entryFeePoints:string;maxDistinctBids:number};wallet:{available:string;held:string};previousMax:string;remainingSubmissions:number;ownBids:OwnBid[]};
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
    const value=etbToCents(amount),terms=state.terms,minimum=etbToCents(terms.minPoints),maximum=etbToCents(terms.maxPoints),step=etbToCents(terms.stepPoints),previous=etbToCents(state.previousMax),fee=etbToCents(terms.entryFeePoints);
    if(value<minimum||value>maximum||(value-minimum)%step!==0n)return null;
    const extra=value>previous?value-previous:0n;
    return {amount:centsToEtb(value),previous:centsToEtb(previous),newMax:centsToEtb((previous+extra)),extra:centsToEtb(extra),fee:centsToEtb(fee),total:centsToEtb((extra+fee)),enough:etbToCents(state.wallet.available)>=extra+fee,consecutive:state.terms.ruleVersion===RULE_V3&&createsFourConsecutiveAmounts(state.ownBids.map(b=>etbToCents(b.amount)),value),duplicate:state.ownBids.some(bid=>etbToCents(bid.amount)===value)};
  },[amount,state]);
  if(authStatus==='loading')return <LoadingSpinner/>;
  if(authStatus!=='authenticated')return <div className="bid-panel"><h2>{w("Ready when you are")}</h2><p>{w("Open Lowwin in Telegram and sign in before submitting an ETB bid.")}</p><IdentityState/></div>;
  if(loading&&!state)return <LoadingSpinner/>;
  if(!state)return <div className="bid-panel"><p role="alert">{w(error||'Bid details are unavailable.')}</p><button className="text-link" onClick={()=>void refresh()}><RefreshCw size={16}/> {w("Retry")}</button></div>;
  if(receipt)return <section className="bid-panel receipt-panel" aria-live="polite"><ShieldCheck size={26}/><h2>{formatEtb(receipt.bid.amount)} {w("bid accepted")}</h2><p>{w("Accepted")} {new Date(receipt.bid.acceptedAt).toLocaleString(language==='am'?'am-ET':'en-ET',{dateStyle:'medium',timeStyle:'medium',timeZone:'Africa/Addis_Ababa'})}. {w("This receipt records your bid; it does not predict a winner.")}</p><dl className="bid-preview-list"><div><dt>{w("Extra ETB reserved")}</dt><dd>{formatEtb(receipt.hold.extraReserved)}</dd></div><div><dt>{w("Entry fee charged")}</dt><dd>{formatEtb(receipt.charge.feePoints)}</dd></div><div><dt>{w("Available now")}</dt><dd>{formatEtb(receipt.wallet.available)}</dd></div><div><dt>{w("Held now")}</dt><dd>{formatEtb(receipt.wallet.held)}</dd></div><div><dt>{w("Submissions left")}</dt><dd>{receipt.remainingSubmissions}</dd></div></dl><button className="secondary-button" onClick={()=>{setReceipt(null);setAmount('');setKey(null);setConfirm(false)}}>{w("Submit another amount")}</button><Link className="text-link" href="/wallet">{w("View wallet")} <ArrowRight size={16}/></Link></section>;
  if(!state.open||status!=='live')return <><div className="bid-unavailable"><LockKeyhole size={19}/><div><strong>{w(status==='closing'?'Closing / result pending':status==='cancelled'?'Auction cancelled':status==='upcoming'?'Bidding has not opened':status==='closed'?'Bidding has closed':isDemo?'DEMO bids unavailable here':'Bidding unavailable')}</strong><p>{w(status==='closing'?'Bidding has ended. Settlement is pending.':status==='cancelled'?'Auction holds and charged entry fees have been returned.':isDemo?'DEMO bidding requires an enrolled staging tester or isolated local test account.':'Your existing bids remain private to you.')}</p></div></div>{state.ownBids.length>0&&<div className="own-bids"><h3>{w("Your accepted amounts")}</h3><div>{state.ownBids.map(bid=><span key={bid.id}>{formatEtb(bid.amount)}</span>)}</div></div>}</>;
  const valid=!!preview&&!preview.consecutive&&!preview.duplicate&&preview.enough&&state.remainingSubmissions>0;
  const change=(value:string)=>{setAmount(value);setKey(null);setConfirm(false);setError('')};
  const stepAmount=(direction:1|-1)=>{
    const minimum=etbToCents(state.terms.minPoints),maximum=etbToCents(state.terms.maxPoints),step=etbToCents(state.terms.stepPoints);
    const next=preview?etbToCents(preview.amount)+BigInt(direction)*step:minimum;
    change(centsToEtb((next<minimum?minimum:next>maximum?maximum:next)));
  };
  const submit=async()=>{
    if(!valid||submitting)return;
    const requestKey=key??crypto.randomUUID();setKey(requestKey);setSubmitting(true);setError('');
    try {const response=await fetch(`/api/auctions/${slug}/bids`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount,key:requestKey})});const body=await response.json();if(!response.ok){setError(body.error??'Bid was not accepted.');notify(body.error??'Bid was not accepted.','error');if(body.code==='AUCTION_CLOSED')void refresh();return}const accepted=body as Receipt;setReceipt(accepted);celebrate();notify(`${formatEtb(accepted.bid.amount)} ${w('bid accepted')}`,'success');setState(previous=>previous?{...previous,wallet:accepted.wallet,previousMax:accepted.hold.newMax,remainingSubmissions:accepted.remainingSubmissions,ownBids:accepted.ownBids}:previous);void refreshMe().catch(()=>{});}
    catch {const message='Connection interrupted. Retry this same request; it cannot debit you twice.';setError(message);notify(message,'error')}
    finally {setSubmitting(false)}
  };
  return <section className={`bid-panel${compact?' bid-panel-compact':''}`}>{!compact&&<h2>{w("Choose an ETB amount")}</h2>}<p>{formatEtb(state.terms.minPoints)} - {formatEtb(state.terms.maxPoints)} / {w("Step")} {formatEtb(state.terms.stepPoints)} / {w("Submissions left")}: {state.remainingSubmissions}</p>
    <label className={compact?'sr-only':'bid-input-label'} htmlFor="etb-bid">{w("ETB amount")}</label><div className="bid-input-wrap">{compact&&<button type="button" className="bid-step" aria-label={w("Decrease bid amount")} disabled={submitting||!!preview&&etbToCents(preview.amount)<=etbToCents(state.terms.minPoints)} onClick={()=>stepAmount(-1)}>−</button>}<input id="etb-bid" inputMode="decimal" autoComplete="off" pattern="[1-9][0-9]*([.][0-9]{1,2})?" maxLength={19} value={amount} disabled={submitting} onChange={event=>change(event.target.value)} placeholder={w(compact?'Bid amount (ETB)':'ETB, up to 2 decimals')}/>{compact?<button type="button" className="bid-step" aria-label={w("Increase bid amount")} disabled={submitting||!!preview&&etbToCents(preview.amount)>=etbToCents(state.terms.maxPoints)} onClick={()=>stepAmount(1)}>+</button>:<span>ETB</span>}</div>
    {amount&&!preview&&<p className="field-error">{w("Choose a ETB amount that matches the range and step.")}</p>}{preview?.consecutive&&<p className="field-error">{w("Leave a gap after three consecutive cent amounts.")}</p>}{preview?.duplicate&&<p className="field-error">{w("You already submitted this amount.")}</p>}{preview&&!preview.enough&&<p className="field-error">{w("Required available balance for the added hold and fee")}: {formatEtb(preview.total)}</p>}{state.remainingSubmissions===0&&<p className="field-error">{w("You have reached the 100 distinct-bid limit.")}</p>}
    <div className="bid-balance-line"><span>{w("Available")} {formatEtb(state.wallet.available)}</span><span>{w("Held")} {formatEtb(state.wallet.held)}</span></div>
    {!confirm?<button className="primary-bid-button" disabled={!valid} onClick={()=>setConfirm(true)}>{w("Review ETB bid")} <ArrowRight size={18}/></button>:<div className="bid-confirm" aria-labelledby="bid-confirm-title"><h3 id="bid-confirm-title">{w("Confirm bid")} / {formatEtb(preview!.amount)}</h3><dl className="bid-preview-list"><div><dt>{w("Previous maximum hold")}</dt><dd>{formatEtb(preview!.previous)}</dd></div><div><dt>{w("New maximum hold")}</dt><dd>{formatEtb(preview!.newMax)}</dd></div><div><dt>{w("Extra ETB reserved")}</dt><dd>{formatEtb(preview!.extra)}</dd></div><div><dt>{w("Entry fee")}</dt><dd>{formatEtb(preview!.fee)}</dd></div><div className="preview-total"><dt>{w("Total newly unavailable")}</dt><dd>{formatEtb(preview!.total)}</dd></div><div><dt>{w("Submissions after this")}</dt><dd>{state.remainingSubmissions-1}</dd></div></dl><p>{w("These values are a preview. The server rechecks your balance, the auction clock and frozen terms before acceptance.")}</p><AuctionRule ruleVersion={state.terms.ruleVersion}/><div className="bid-confirm-actions"><button className="secondary-button" onClick={()=>setConfirm(false)} disabled={submitting}>{w("Edit")}</button><button className="primary-bid-button" onClick={()=>void submit()} disabled={submitting||!valid}>{submitting?<LoadingSpinner/>:w('Confirm bid')}</button></div></div>}
    {error&&<p className="field-error" role="alert">{w(error)}</p>}
    {state.ownBids.length>0&&<div className="own-bids"><h3>{w("Your amounts")}</h3><p>{w("Only you can see these while the auction is live.")}</p><div>{state.ownBids.map(bid=><span key={bid.id}>{formatEtb(bid.amount)}</span>)}</div></div>}
  </section>;
}
