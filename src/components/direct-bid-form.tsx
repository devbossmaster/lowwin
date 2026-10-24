'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {ArrowRight,LockKeyhole,RefreshCw,ShieldCheck} from 'lucide-react';
import {createsFourConsecutiveAmounts} from '@/modules/auctions/consecutive-bids';
import {isSubmissionFeeOnly,usesDecimalBids} from '@/modules/auctions/rules';
import {formatEtb,etbToCents,centsToEtb} from '@/lib/money';
import {useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {IdentityState} from './identity-state';
import {BidPanelSkeleton} from './mini-route-skeleton';
import {invalidatePrivateQueries,loadPrivateJson,readPrivateQuery,subscribePrivateQueries} from './private-query-cache';
import type {DirectBidReceipt} from '@/modules/auctions/bids';

const ArifPayCheckout=dynamic(()=>import('./arifpay-checkout'));
type OwnBid={id:string;amount:string;acceptedAt:string};
type BidState={auctionCode:string;open:boolean;paymentMode:'ARIFPAY'|'LEGACY_READ_ONLY';terms:{ruleVersion:string;version:number;minPoints:string;maxPoints:string|null;stepPoints:string;entryFeePoints:string};remainingSubmissions:number;ownBids:OwnBid[]};
type Props={slug:string;title?:string;status:'live'|'upcoming'|'closing'|'closed'|'cancelled';isDemo:boolean;compact?:boolean};
const numberPattern=/^[1-9]\d{0,15}(?:\.\d{1,2})?$/;

export function BidForm(props:Props){
 const {queryIdentity}=useTelegram();
 return <div id="bid-review"><DirectBidForm key={`${queryIdentity??'guest'}:${props.slug}`} {...props}/></div>;
}
function DirectBidForm({slug,status,compact=false}:Props){
 const {status:authStatus,queryIdentity,refreshMe}=useTelegram(),{language}=useMiniLocale();
 const text=(en:string,am:string)=>language==='am'?am:en,url=`/api/auctions/${slug}/bids`;
 const [state,setState]=useState<BidState|null>(()=>queryIdentity?readPrivateQuery<BidState>(queryIdentity,url)?.value??null:null);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[amount,setAmount]=useState('');
 const [checkout,setCheckout]=useState<{amount:string;feeVersion:number;fee:string}|null>(null),[receipt,setReceipt]=useState<DirectBidReceipt|null>(null);
 const refresh=useCallback(async(signal?:AbortSignal,force=false)=>{
  if(!queryIdentity)return;setLoading(true);setError('');
  try{const value=await loadPrivateJson<BidState>(queryIdentity,url,{force});if(!signal?.aborted)setState(value)}
  catch(cause){if(!signal?.aborted&&!(cause instanceof Error&&cause.name==='ObsoletePrivateQueryError'))setError('Could not load bid details.')}
  finally{if(!signal?.aborted)setLoading(false)}
 },[queryIdentity,url]);
 useEffect(()=>{
  if(authStatus!=='authenticated'){setState(null);setReceipt(null);return}
  const controller=new AbortController();void refresh(controller.signal);
  const unsubscribe=subscribePrivateQueries(event=>{if(event.kind==='mutation'&&event.identity===queryIdentity)void refresh(controller.signal)});
  return()=>{controller.abort();unsubscribe()};
 },[authStatus,queryIdentity,refresh]);
 const preview=useMemo(()=>{
  if(!state||!numberPattern.test(amount))return null;
  const value=etbToCents(amount),minimum=etbToCents(state.terms.minPoints),maximum=state.terms.maxPoints===null?null:etbToCents(state.terms.maxPoints),step=etbToCents(state.terms.stepPoints);
  if(value<minimum||maximum!==null&&value>maximum||step<=0n||(value-minimum)%step!==0n)return null;
  return {amount:centsToEtb(value),duplicate:state.ownBids.some(bid=>etbToCents(bid.amount)===value),consecutive:usesDecimalBids(state.terms.ruleVersion)&&createsFourConsecutiveAmounts(state.ownBids.map(bid=>etbToCents(bid.amount)),value)};
 },[state,amount]);
 if(authStatus==='loading'||loading&&!state)return <BidPanelSkeleton/>;
 if(authStatus!=='authenticated')return <div className="bid-panel"><h2>{text('Ready when you are','ዝግጁ ሲሆኑ ይጀምሩ')}</h2><IdentityState/></div>;
 if(!state)return <div className="bid-panel"><p role="alert">{text('Bid details could not load. Please retry.','የጨረታውን ዝርዝር ማምጣት አልተቻለም። እንደገና ይሞክሩ።')}</p><button className="text-link" onClick={()=>void refresh(undefined,true)}><RefreshCw size={16}/>{text('Retry','እንደገና')}</button></div>;
 if(receipt)return <section className="bid-panel receipt-panel" aria-live="polite"><ShieldCheck size={26} aria-hidden="true"/><h2>{receipt.bid.amount} {text('bid accepted','ጨረታዎ ተቀብሏል')}</h2><p>{text('This receipt records your accepted bid. It does not predict a winner.','ይህ ደረሰኝ የተቀበለውን ጨረታዎን ይመዘግባል። አሸናፊነትን አያረጋግጥም።')}</p><dl className="bid-preview-list"><div><dt>{text('Submission fee paid','የተከፈለ የማቅረቢያ ክፍያ')}</dt><dd>{formatEtb(receipt.charge.feePoints)}</dd></div><div><dt>{text('Submissions left','የሚቀሩ ጨረታዎች')}</dt><dd>{receipt.remainingSubmissions}</dd></div></dl><Link className="text-link" href="/my-bids">{text('View my bids','የእኔ ጨረታዎች')}<ArrowRight size={16}/></Link><Link className="text-link" href="/payments">{text('Bid payments','የጨረታ ክፍያዎች')}</Link><button className="secondary-button" onClick={()=>{setReceipt(null);setAmount('');void refresh(undefined,true)}}>{text('Choose another number','ሌላ ቁጥር ይምረጡ')}</button></section>;
 if(!state.open||status!=='live')return <div className="bid-unavailable"><LockKeyhole size={19}/><strong>{text(status==='upcoming'?'Bidding has not opened':status==='cancelled'?'Auction cancelled':'Bidding has closed',status==='upcoming'?'ጨረታው ገና አልተጀመረም':status==='cancelled'?'ጨረታው ተሰርዟል':'ጨረታው ተዘግቷል')}</strong></div>;
 if(state.paymentMode!=='ARIFPAY'||!isSubmissionFeeOnly(state.terms.ruleVersion))return <div className="bid-unavailable"><LockKeyhole size={19}/><p>{text('New entries are unavailable for this older auction. Its published terms and existing results remain available.','ለዚህ የቆየ ጨረታ አዲስ ጨረታ ማቅረብ አይቻልም። የታተሙት ውሎች እና ነባር ውጤቶች ይታያሉ።')}</p></div>;
 if(checkout)return <ArifPayCheckout slug={slug} {...checkout} onAccepted={accepted=>{setReceipt(accepted);setCheckout(null);if(queryIdentity)invalidatePrivateQueries(queryIdentity);void refreshMe().catch(()=>{})}}/>;
 const valid=!!preview&&!preview.duplicate&&!preview.consecutive&&state.remainingSubmissions>0;
 const stepAmount=(direction:1|-1)=>{
  const min=etbToCents(state.terms.minPoints),max=state.terms.maxPoints===null?null:etbToCents(state.terms.maxPoints),step=etbToCents(state.terms.stepPoints),next=preview?etbToCents(preview.amount)+BigInt(direction)*step:min;
  setAmount(centsToEtb(next<min?min:max!==null&&next>max?max:next));
 };
 return <section className={`bid-panel${compact?' bid-panel-compact':''}`}>
  <div className="bid-panel-heading"><h2>{text('Choose a bid number','የጨረታ ቁጥር ይምረጡ')}</h2><span className="bid-remaining"><strong>{state.remainingSubmissions}</strong> {text('left','ቀሪ')}</span></div>
  <div className="bid-fee-row"><span>{text('Submission fee','የማቅረቢያ ክፍያ')}</span><strong>{formatEtb(state.terms.entryFeePoints)}</strong></div>
  <p className="bid-fee-hint">{text('Pay this entry’s fee through ArifPay using Telebirr or M-PESA. Your chosen number is not charged.','የዚህን ጨረታ ክፍያ በArifPay በኩል በTelebirr ወይም M-PESA ይክፈሉ። የመረጡት ቁጥር አይከፈልም።')}</p>
  <div className="bid-limits"><span>{text('From','ከ')} <strong>{state.terms.minPoints}{state.terms.maxPoints!==null?` – ${state.terms.maxPoints}`:''}</strong></span><span>{text('Step','ልዩነት')} <strong>{state.terms.stepPoints}</strong></span></div>
  <label className="bid-input-label" htmlFor="etb-bid">{text('Bid number','የጨረታ ቁጥር')}</label><div className="bid-input-wrap">{compact&&<button className="bid-step" type="button" aria-label={text('Decrease bid amount','የጨረታ መጠኑን ቀንስ')} onClick={()=>stepAmount(-1)}>−</button>}<input id="etb-bid" inputMode="decimal" autoComplete="off" maxLength={19} value={amount} onChange={event=>setAmount(event.target.value)} placeholder={text('Your number','የእርስዎ ቁጥር')}/>{compact&&<button className="bid-step" type="button" aria-label={text('Increase bid amount','የጨረታ መጠኑን ጨምር')} onClick={()=>stepAmount(1)}>+</button>}</div>
  {amount&&!preview&&<p className="field-error">{text('Choose a number within the displayed range and step.','በሚታየው ክልል እና ልዩነት ውስጥ ቁጥር ይምረጡ።')}</p>}
  {preview?.duplicate&&<p className="field-error">{text('You already submitted this number.','ይህን ቁጥር አስቀድመው አቅርበዋል።')}</p>}{preview?.consecutive&&<p className="field-error">{text('Leave a gap after three consecutive numbers.','ከሦስት ተከታታይ ቁጥሮች በኋላ ክፍተት ይተዉ።')}</p>}
  {state.remainingSubmissions===0&&<p className="field-error">{text('You reached this auction’s entry limit.','የዚህ ጨረታ የማቅረቢያ ገደብ ላይ ደርሰዋል።')}</p>}
  <button className="primary-bid-button" data-payment-action disabled={!valid} onClick={()=>{if(preview)setCheckout({amount:preview.amount,feeVersion:state.terms.version,fee:state.terms.entryFeePoints})}}>{text('Continue to payment','ወደ ክፍያ ይቀጥሉ')}<ArrowRight size={18}/></button>
  {error&&<p className="field-error" role="alert">{text('Could not refresh bid details. Please retry.','የጨረታ ዝርዝሮችን ማደስ አልተቻለም። እንደገና ይሞክሩ።')}</p>}
  {state.ownBids.length>0&&<div className="own-bids"><h3>{text('Your entries','ያቀረቧቸው ጨረታዎች')}</h3><div>{state.ownBids.map(bid=><span key={bid.id}>{bid.amount}</span>)}</div></div>}
 </section>;
}
