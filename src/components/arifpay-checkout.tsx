'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {LoadingSpinner} from './loading-spinner';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {invalidatePrivateQueries} from './private-query-cache';
import type {BidReceipt} from '@/modules/auctions/bids';
import type {ArifPayCheckoutView} from '@/modules/payments/arifpay';
import {formatEtb} from '@/lib/money';
import {ArifPayClientError,arifPayPaymentPhone,arifPayRecoverable,clearArifPayAttempt,readArifPayAttempt,requestArifPayJson,writeArifPayAttempt,type ArifPayAttempt} from '@/lib/arifpay-recovery';

type Props={slug:string;amount:string;feeVersion:number;fee:string;onAccepted:(receipt:BidReceipt)=>void;initialOrder?:ArifPayCheckoutView};
const terminal=new Set(['BID_ACCEPTED','NEEDS_REVIEW','FAILED','CANCELLED','EXPIRED']);
const deterministicErrors=new Set(['INVALID_INPUT','INVALID_PHONE','CONTACT_REQUIRED','BIDDING_RESTRICTED','TERMS_CHANGED','LEGACY_TERMS','CAP_REACHED','CONSECUTIVE_LIMIT','INVALID_AMOUNT','AUCTION_CLOSED','PAYMENT_UNAVAILABLE']);
export default function ArifPayCheckout(props:Props){
 const {queryIdentity}=useTelegram();
 // A changed session or bid number destroys every previous callback scope.
 return <CheckoutForIdentity key={`${queryIdentity}:${props.slug}:${props.amount}:${props.initialOrder?.id??''}`} {...props}/>;
}
function CheckoutForIdentity({slug,amount,feeVersion,fee,onAccepted,initialOrder}:Props){
 const {queryIdentity,refreshMe}=useTelegram(),{language}=useMiniLocale(),am=language==='am';
 const [availability,setAvailability]=useState<{enabled:boolean;reason:string|null}|null>(null);
 const [channel,setChannel]=useState<'TELEBIRR'|'MPESA'>('TELEBIRR'),[phone,setPhone]=useState(''),[agreed,setAgreed]=useState(false);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[order,setOrder]=useState<ArifPayCheckoutView|null>(initialOrder??null);
 const [attempt,setAttempt]=useState<ArifPayAttempt|null>(null),[restoreId,setRestoreId]=useState<string|null>(null),[paused,setPaused]=useState(false),[reload,setReload]=useState(0),[pollCycle,setPollCycle]=useState(0);
 const callback=useRef(onAccepted),accepted=useRef(false),invalidated=useRef<string|null>(null),creating=useRef(false),alive=useRef(false),generation=useRef(0),started=useRef(Date.now());
 const controllers=useRef(new Set<AbortController>()),attemptRef=useRef<ArifPayAttempt|null>(null),amRef=useRef(am);
 callback.current=onAccepted;amRef.current=am;
 const storageKey=`lowin-checkout:${queryIdentity}:${slug}:${amount}`;
 const current=useCallback((epoch:number)=>alive.current&&generation.current===epoch,[]);
 const persist=useCallback((value:ArifPayAttempt|null)=>{
  attemptRef.current=value;setAttempt(value);
  try{if(value)writeArifPayAttempt(sessionStorage,storageKey,value);else clearArifPayAttempt(sessionStorage,storageKey)}catch{}
 },[storageKey]);
 const displayOrder=useCallback((next:ArifPayCheckoutView)=>{
  if(!alive.current)return;
  setOrder(next);setError('');setRestoreId(null);
  if(attemptRef.current){const saved={...attemptRef.current,orderId:next.id};attemptRef.current=saved;setAttempt(saved);try{writeArifPayAttempt(sessionStorage,storageKey,saved)}catch{}}
  if(terminal.has(next.status)){try{clearArifPayAttempt(sessionStorage,storageKey)}catch{};attemptRef.current=null;setAttempt(null)}
  if((next.status==='BID_ACCEPTED'||next.fundsPreserved)&&invalidated.current!==next.id){invalidated.current=next.id;if(queryIdentity)invalidatePrivateQueries(queryIdentity);void refreshMe().catch(()=>{})}
  if(next.status==='BID_ACCEPTED'&&next.receipt&&!accepted.current){accepted.current=true;callback.current(next.receipt as unknown as BidReceipt)}
 },[queryIdentity,refreshMe,storageKey]);
 useEffect(()=>{
  alive.current=true;generation.current++;
  return()=>{alive.current=false;generation.current++;for(const controller of controllers.current)controller.abort();controllers.current.clear()};
 },[]);
 useEffect(()=>{
  if(!queryIdentity){setLoading(false);return}
  const epoch=generation.current,controller=new AbortController();controllers.current.add(controller);let disposed=false;
  const valid=()=>!disposed&&current(epoch);
  setLoading(true);setBusy(true);setError('');
  let saved:ArifPayAttempt|null=null,legacyId:string|null=null,legacyKey=false;
  try{saved=readArifPayAttempt(sessionStorage,storageKey);const raw=sessionStorage.getItem(storageKey);if(!saved&&raw&&/^[0-9a-f-]{36}$/i.test(raw))legacyId=raw;legacyKey=!!sessionStorage.getItem(`${storageKey}:key`)}catch{}
  if(saved){attemptRef.current=saved;setAttempt(saved);setChannel(saved.intent.channel);setPhone(saved.intent.phone);setAgreed(true)}
  const savedId=initialOrder?null:saved?.orderId??legacyId;if(savedId)setRestoreId(savedId);
  const availabilityRequest=requestArifPayJson<{enabled:boolean;reason:string|null}>('/api/payments/arifpay',{},controller.signal)
   .then(value=>{if(valid())setAvailability(value)})
   .catch(()=>{if(valid())setError(amRef.current?'ክፍያን መጫን አልተቻለም። እንደገና ይሞክሩ።':'Payment options could not load. Try again.')});
  const restoreRequest=(async()=>{
   try{
    if(initialOrder){if(valid())displayOrder(initialOrder)}
    else if(savedId){const next=await requestArifPayJson<ArifPayCheckoutView>(`/api/payments/arifpay/checkouts/${savedId}`,{},controller.signal);if(valid())displayOrder(next)}
    else if(legacyKey){
     const recent=await requestArifPayJson<{items:ArifPayCheckoutView[]}>('/api/payments/arifpay/checkouts',{},controller.signal);
     const previous=recent.items.find(item=>item.auctionSlug===slug&&Number(item.amount)===Number(amount));
     if(valid()){if(previous)displayOrder(previous);else{setRestoreId('history');setError(amRef.current?'እንደገና ከመክፈልዎ በፊት የክፍያ ታሪክዎን ይፈትሹ።':'Check your payment history before starting another payment.')}}
    }
   }catch{if(valid())setError(amRef.current?'ያለፈውን ክፍያ መፈተሽ አልተቻለም።':'Could not load your previous payment. Retry before starting another.')}
  })();
  void Promise.allSettled([availabilityRequest,restoreRequest]).finally(()=>{controllers.current.delete(controller);if(valid()){setLoading(false);setBusy(false)}});
  return()=>{disposed=true;controller.abort();controllers.current.delete(controller)};
 },[queryIdentity,storageKey,slug,amount,displayOrder,current,reload,initialOrder]);
 useEffect(()=>{
  if(!order||!arifPayRecoverable(order))return;
  if(order.status==='NEEDS_REVIEW'&&pollCycle===0){setPaused(true);return}
  const epoch=generation.current,controller=new AbortController();controllers.current.add(controller);
  let stopped=false,inFlight=false,timer:ReturnType<typeof setTimeout>|undefined,nextDelay=order.pollAfterMs;
  const valid=()=>!stopped&&current(epoch);
  const schedule=()=>{
   if(!valid()||document.hidden)return;
   const remaining=300000-(Date.now()-started.current);if(remaining<=0){setPaused(true);return}
   timer=setTimeout(()=>void poll(),Math.min(remaining,Math.max(2000,nextDelay)));
  };
  const poll=async()=>{
   if(!valid()||inFlight||document.hidden)return;
   if(Date.now()-started.current>=300000){setPaused(true);return}
   inFlight=true;
   try{
    const next=await requestArifPayJson<ArifPayCheckoutView>(`/api/payments/arifpay/checkouts/${order.id}`,{method:'POST'},controller.signal);
    if(valid()){nextDelay=Math.max(2000,next.pollAfterMs);displayOrder(next);if(!arifPayRecoverable(next))return}
   }catch{if(valid()){nextDelay=Math.min(60000,Math.max(5000,nextDelay*2));setError(amRef.current?'ግንኙነቱ ተቋርጧል። ክፍያዎ እየተፈተሸ ነው።':'Connection interrupted. Your payment remains pending. Keep this payment ID.')}}
   finally{inFlight=false;if(valid())schedule()}
  };
  const visible=()=>{if(timer)clearTimeout(timer);if(!document.hidden)schedule()};
  if(pollCycle>0)void poll();else schedule();document.addEventListener('visibilitychange',visible);
  return()=>{stopped=true;if(timer)clearTimeout(timer);controller.abort();controllers.current.delete(controller);document.removeEventListener('visibilitychange',visible)};
 },[order?.id,order?.status,order?.reason,displayOrder,current,pollCycle]);
 const begin=async()=>{
  if(busy||creating.current||!queryIdentity||!agreed||!availability?.enabled||restoreId)return;
  const normalized=arifPayPaymentPhone(phone,channel);
  if(!attemptRef.current&&!normalized){setError(am?'ትክክለኛ የክፍያ ስልክ ቁጥር ያስገቡ።':'Enter a valid phone number for this payment method.');return}
  const epoch=generation.current,controller=new AbortController();controllers.current.add(controller);creating.current=true;setBusy(true);setError('');
  const hadPendingAttempt=!!attemptRef.current;
  if(!hadPendingAttempt){started.current=Date.now();setPaused(false)}
  const saved=attemptRef.current??{version:1 as const,fee,intent:{auctionSlug:slug,amount,feeVersion,key:crypto.randomUUID(),channel,phone:normalized!}};
  // Store the exact intent before sending. An uncertain request freezes edits.
  persist(saved);
  try{
   const next=await requestArifPayJson<ArifPayCheckoutView>('/api/payments/arifpay/checkouts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(saved.intent)},controller.signal);
   if(current(epoch))displayOrder(next);
  }catch(cause){
   if(current(epoch)){
    if(!hadPendingAttempt&&cause instanceof ArifPayClientError&&deterministicErrors.has(cause.code)){persist(null);setAgreed(false)}
    setError(cause instanceof ArifPayClientError?cause.message:amRef.current?'ግንኙነቱ ተቋርጧል። በተመሳሳይ መረጃ እንደገና ይሞክሩ።':'Connection interrupted. Retry this original request with the same details; do not start another payment.');
   }
  }finally{controllers.current.delete(controller);if(current(epoch)){creating.current=false;setBusy(false)}}
 };
 const check=()=>{started.current=Date.now();setPaused(false);if(order)setPollCycle(value=>value+1);else setReload(value=>value+1)};
 const locked=!!attempt||!!restoreId;
 const shownFee=attempt?.fee??fee;
 const help=<p><Link href="/wallet"><MiniPhrase en="Payment history" am="የክፍያ ታሪክ"/></Link> · <Link href="/profile/support"><MiniPhrase en="Get help" am="እርዳታ ያግኙ"/></Link></p>;
 if(order)return <section className="arif-checkout" aria-live="polite"><div className="arif-status">
  <strong><MiniPhrase en={order.status==='BID_ACCEPTED'?'Bid accepted':order.status==='NEEDS_REVIEW'?'Needs review':order.status==='FAILED'?'Payment failed':order.status==='CANCELLED'?'Payment cancelled':order.status==='EXPIRED'?'Payment expired':'Confirm on your phone'} am={order.status==='BID_ACCEPTED'?'ጨረታው ተቀብሏል':order.status==='NEEDS_REVIEW'?'ግምገማ ያስፈልጋል':order.status==='FAILED'?'ክፍያው አልተሳካም':order.status==='CANCELLED'?'ክፍያው ተሰርዟል':order.status==='EXPIRED'?'የክፍያ ጊዜው አልፏል':'በስልክዎ ያረጋግጡ'}/></strong>
  <p>{formatEtb(order.fee)} · {order.channel==='MPESA'?'M-PESA':'Telebirr'}</p>
  {!terminal.has(order.status)&&<p><MiniPhrase en="Approve the request on your phone. Your bid is accepted only after payment verification. Do not pay again while this request is pending." am="በስልክዎ የመጣውን ጥያቄ ያረጋግጡ። ክፍያው ከተረጋገጠ በኋላ ጨረታዎ ይረጋገጣል። ጥያቄው በመጠባበቅ ላይ እያለ እንደገና አይክፈሉ።"/></p>}
  {order.status==='NEEDS_REVIEW'&&<p><MiniPhrase en={order.fundsPreserved?'Your payment was verified but the bid could not be accepted. Your funds are preserved in your account. Contact support with this payment ID.':'We need to review this payment. This is not an accepted bid. Keep this payment ID and contact support.'} am={order.fundsPreserved?'ክፍያዎ ተረጋግጧል፣ ግን ጨረታዎ አልተቀበለም። ገንዘብዎ በመለያዎ ውስጥ ተጠብቋል። በዚህ የክፍያ መለያ ድጋፍ ያግኙ።':'ይህ ክፍያ ግምገማ ያስፈልገዋል። ጨረታዎ ገና አልተቀበለም። ድጋፍ ያግኙ።'}/></p>}
  <small style={{overflowWrap:'anywhere'}}>ID: {order.id}</small>
  {paused&&<p><MiniPhrase en="Automatic checking is paused. Your payment remains saved for server verification." am="ራስ-ሰር ማረጋገጥ ቆሟል። ክፍያዎ ለማረጋገጥ ተቀምጧል።"/></p>}
  {error&&<p role="alert">{error}</p>}
  {arifPayRecoverable(order)&&<button className="secondary-button" onClick={check}><MiniPhrase en={paused?'Check payment again':'Check status'} am="ክፍያውን እንደገና ይፈትሹ"/></button>}
  {['FAILED','CANCELLED','EXPIRED'].includes(order.status)&&<button className="secondary-button" onClick={()=>{persist(null);setOrder(null);setAgreed(false);setPollCycle(0);setPaused(false)}}><MiniPhrase en="Start a new payment" am="አዲስ ክፍያ ይጀምሩ"/></button>}{help}
 </div></section>;
 return <section className="arif-checkout"><h3><MiniPhrase en="Pay the submission fee" am="የማስገቢያ ክፍያውን ይክፈሉ"/></h3><p><MiniPhrase en="Pay directly from your phone." am="በቀጥታ ከስልክዎ ይክፈሉ።"/></p>
  {loading?<LoadingSpinner/>:restoreId?<><p><MiniPhrase en="Check your earlier payment before starting another." am="ሌላ ክፍያ ከመጀመርዎ በፊት ያለፈውን ክፍያዎን ይፈትሹ።"/></p><button className="secondary-button" onClick={check}><MiniPhrase en="Retry status check" am="እንደገና ይፈትሹ"/></button></>:availability?.enabled?<>
   <div className="arif-channels">{(['TELEBIRR','MPESA'] as const).map(value=><button key={value} type="button" disabled={busy||locked} aria-pressed={channel===value} onClick={()=>setChannel(value)}><img alt="" src={value==='MPESA'?'/icons/payments/mpesa.png':'/icons/payments/telebirr.jpg'}/>{value==='MPESA'?'M-PESA':'Telebirr'}</button>)}</div>
   <label htmlFor="checkout-phone"><MiniPhrase en="Payment phone number" am="የክፍያ ስልክ ቁጥር"/></label><input id="checkout-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={16} disabled={busy||locked} placeholder={channel==='MPESA'?'07…':'09…'} onChange={event=>setPhone(event.target.value)}/>
   <label className="arif-agreement"><input type="checkbox" checked={agreed} onChange={event=>setAgreed(event.target.checked)} disabled={busy||locked}/><span><MiniPhrase en={`I agree to pay the non-refundable ${formatEtb(shownFee)} fee for bid number ${amount}.`} am={`ለጨረታ ቁጥር ${amount} ተመላሽ የማይሆን ${formatEtb(shownFee)} ክፍያ ለመክፈል ተስማምቻለሁ።`}/></span></label>
   {attempt&&<p><MiniPhrase en="Your original request is saved. Retry uses the same number, payment method, phone and request key." am="የመጀመሪያ ጥያቄዎ ተቀምጧል። ድጋሚ ሲሞክሩ ተመሳሳይ መረጃ ይጠቀማል።"/></p>}
   <button className="primary-bid-button" data-payment-action disabled={!agreed||busy||!phone.trim()} onClick={()=>void begin()}>{busy?<LoadingSpinner/>:<MiniPhrase en={attempt?'Retry original request':`Pay ${formatEtb(fee)} & bid`} am={attempt?'የመጀመሪያውን ጥያቄ እንደገና ይሞክሩ':`${formatEtb(fee)} ይክፈሉ እና ይጫረቱ`}/>}</button>
  </>:<p><MiniPhrase en="Direct checkout is not available yet. Your existing balance and records are safe. Try again later or contact support." am="ቀጥታ ክፍያ ገና አልተዘጋጀም። ያለዎት ቀሪ ሂሳብ እና መዝገቦች ተጠብቀዋል። ቆይተው ይሞክሩ ወይም ድጋፍ ያግኙ።"/></p>}
  {error&&<p className="field-error" role="alert">{error}</p>}{!loading&&!availability&&<button className="secondary-button" onClick={check}><MiniPhrase en="Retry" am="እንደገና"/></button>}{locked&&help}
 </section>;
}
