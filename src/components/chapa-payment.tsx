'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,LoaderCircle,RefreshCw,ShieldCheck} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {useMiniLocale} from './mini-locale';
import {confirmedBidQueryScopes,invalidatePrivateQueries,isPrivateQueryIdentity,subscribePrivateQueries,PAYMENT_QUERY_SCOPES} from './private-query-cache';
import {chapaCheckoutUrl,chapaConfirmed,chapaRecoverable,chapaUuid,ChapaClientError,clearChapaAttempt,clearChapaAttempts,readChapaAttempt,requestChapaJson,writeChapaAttempt,type ChapaAttempt,type ChapaCheckoutView,type ChapaIntent} from '@/lib/chapa-client';
import {formatEtb} from '@/lib/money';
import {prepareChapaNavigation} from '@/lib/chapa-navigation';
import styles from './bid-payment-sheet.module.css';

const deterministic=new Set(['INVALID_INPUT','INVALID_AMOUNT','CONTACT_REQUIRED','BIDDING_RESTRICTED','TERMS_CHANGED','LEGACY_TERMS','CAP_REACHED','CONSECUTIVE_LIMIT','OWN_DUPLICATE','AUCTION_CLOSED','AUCTIONS_PAUSED','PAYMENT_UNAVAILABLE','COUPON_UNAVAILABLE','SCHEMA_NOT_READY']);
// This listener outlives individual sheets, so a closed pending sheet is also
// removed from tab recovery storage on logout or an authenticated account change.
subscribePrivateQueries(event=>{if((event.kind==='session'||event.kind==='authorization')&&typeof window!=='undefined')try{clearChapaAttempts(window.sessionStorage,event.kind==='authorization'?null:event.identity)}catch{}});
type Snapshot={identity:string|null;attempt:ChapaAttempt|null;order:ChapaCheckoutView|null;error:string;busy:boolean;restoring:boolean;paused:boolean};
export function useChapaPayment(scope:string,initialId?:string){
 const {queryIdentity,refreshMe}=useTelegram(),{language}=useMiniLocale(),am=language==='am';
 const empty=()=>({identity:queryIdentity,attempt:null,order:null,error:'',busy:false,restoring:!!initialId,paused:false});
 const [snapshot,setSnapshot]=useState<Snapshot>(empty),state=snapshot.identity===queryIdentity?snapshot:empty();
 const stateRef=useRef(state);stateRef.current=state;const epoch=useRef(0),controllers=useRef(new Set<AbortController>()),locked=useRef(false),started=useRef(0),invalidated=useRef<string|null>(null);
 const storageKey=queryIdentity?`lowwin:chapa:${queryIdentity}:${scope}`:null;
 const current=useCallback((version:number)=>version===epoch.current&&isPrivateQueryIdentity(queryIdentity),[queryIdentity]);
 const persist=useCallback((value:ChapaAttempt|null)=>{if(storageKey&&typeof window!=='undefined'){try{value?writeChapaAttempt(window.sessionStorage,storageKey,value):clearChapaAttempt(window.sessionStorage,storageKey)}catch{}}stateRef.current={...stateRef.current,attempt:value};setSnapshot(s=>s.identity===queryIdentity?{...s,attempt:value}:s)},[storageKey,queryIdentity]);
 const receive=useCallback((order:ChapaCheckoutView)=>{
  setSnapshot(s=>s.identity===queryIdentity?{...s,order,error:'',restoring:false}:s);const a=stateRef.current.attempt;if(a)persist({...a,orderId:order.id});
  if(queryIdentity&&chapaConfirmed(order)&&invalidated.current!==order.id){invalidated.current=order.id;invalidatePrivateQueries(queryIdentity,scope.startsWith('bid:')?confirmedBidQueryScopes(scope.slice(4)):PAYMENT_QUERY_SCOPES);void refreshMe().catch(()=>{});persist(null)}
 },[persist,queryIdentity,refreshMe]);
 const run=useCallback(async(url:string,options:RequestInit={})=>{
  const version=epoch.current,controller=new AbortController();controllers.current.add(controller);
  try{const result=await requestChapaJson<ChapaCheckoutView>(url,options,controller.signal);if(current(version))receive(result);return current(version)?result:null}
  catch(cause){if(current(version)&&cause instanceof ChapaClientError&&[401,403].includes(cause.status))void refreshMe().catch(()=>{});throw cause}
  finally{controllers.current.delete(controller)}
 },[current,receive,refreshMe]);
 const check=useCallback(async()=>{
  const value=stateRef.current;if(!queryIdentity||locked.current)return;locked.current=true;started.current=Date.now();setSnapshot(s=>s.identity===queryIdentity?{...s,busy:true,paused:false,error:''}:s);
  try{
   const id=value.order?.id??value.attempt?.orderId??initialId;
   if(id)await run(`/api/payments/chapa/checkouts/${id}`,{method:'POST'});
   else if(value.attempt)await run('/api/payments/chapa/checkouts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value.attempt.intent)});
  }catch(cause){if(isPrivateQueryIdentity(queryIdentity))setSnapshot(s=>s.identity===queryIdentity?{...s,error:am?'የክፍያውን ሁኔታ ማረጋገጥ አልተቻለም። በተመሳሳይ ክፍያ እንደገና ይሞክሩ።':'Payment status could not be checked. Retry this same payment; do not pay again.'}:s)}
  finally{locked.current=false;if(isPrivateQueryIdentity(queryIdentity))setSnapshot(s=>s.identity===queryIdentity?{...s,busy:false,restoring:false}:s)}
 },[queryIdentity,initialId,run,am]);
 useEffect(()=>{
  const version=++epoch.current;let saved:ChapaAttempt|null=null;try{if(storageKey)saved=readChapaAttempt(window.sessionStorage,storageKey)}catch{}
  const restored={identity:queryIdentity,attempt:saved,order:null,error:'',busy:false,restoring:!!(saved?.orderId||initialId),paused:false};stateRef.current=restored;setSnapshot(restored);started.current=Date.now();invalidated.current=null;
  const id=initialId??saved?.orderId;
  if(queryIdentity&&id&&chapaUuid.test(id))void run(`/api/payments/chapa/checkouts/${id}`).catch(()=>{if(current(version))setSnapshot(s=>({...s,restoring:false,error:am?'የክፍያውን ሁኔታ ማምጣት አልተቻለም። ይህንኑ ክፍያ ያረጋግጡ።':'Saved payment status could not load. Check this same payment.'}))});
  const unsubscribe=subscribePrivateQueries(event=>{if((event.kind==='session'&&event.identity!==queryIdentity)||event.kind==='authorization'){if(storageKey)try{clearChapaAttempt(window.sessionStorage,storageKey)}catch{}epoch.current++;controllers.current.forEach(c=>c.abort())}});
  return()=>{epoch.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear();unsubscribe()};
 // Restore once for this identity and surface; copy changes must not restart a payment.
 },[queryIdentity,storageKey,initialId]);
 useEffect(()=>{
  const order=state.order;if(!order||!chapaRecoverable(order)||!queryIdentity)return;let timer:ReturnType<typeof setTimeout>|undefined,active=true;
  const refresh=async()=>{
   if(!active||document.visibilityState!=='visible'||locked.current)return;
   if(Date.now()-started.current>120000){setSnapshot(s=>s.identity===queryIdentity?{...s,paused:true}:s);return}
   locked.current=true;try{await run(`/api/payments/chapa/checkouts/${order.id}`,{method:'POST'})}catch{if(isPrivateQueryIdentity(queryIdentity))setSnapshot(s=>s.identity===queryIdentity?{...s,paused:true}:s)}finally{locked.current=false}
  };
  timer=setTimeout(()=>void refresh(),Math.max(2000,Math.min(15000,order.pollAfterMs||5000)));
  const foreground=()=>{if(document.visibilityState==='visible'){started.current=Date.now();void refresh()}};document.addEventListener('visibilitychange',foreground);window.addEventListener('focus',foreground);
  return()=>{active=false;clearTimeout(timer);document.removeEventListener('visibilitychange',foreground);window.removeEventListener('focus',foreground)};
 },[state.order,queryIdentity,run]);
 const create=async(intent:ChapaIntent)=>{
  if(!queryIdentity||locked.current||!isPrivateQueryIdentity(queryIdentity))return;const version=epoch.current,existing=stateRef.current.attempt;
  const next=existing??{version:1 as const,intent};locked.current=true;started.current=Date.now();persist(next);setSnapshot(s=>s.identity===queryIdentity?{...s,busy:true,error:'',paused:false}:s);
  const navigation=prepareChapaNavigation();
  try{const order=await run('/api/payments/chapa/checkouts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next.intent)});if(current(version)&&order&&!chapaConfirmed(order)&&['SUBMITTING','PENDING','AUTH_NEEDED'].includes(order.status))navigation.open(order.checkoutUrl)}
  catch(cause){if(current(version)){if(!existing&&cause instanceof ChapaClientError&&deterministic.has(cause.code))persist(null);setSnapshot(s=>s.identity===queryIdentity?{...s,error:am?'ክፍያው ሊጀመር አልቻለም። ዝርዝሩን ያረጋግጡና ይህንኑ ጥያቄ እንደገና ይሞክሩ።':cause instanceof ChapaClientError?cause.message:'Connection interrupted. Retry this same payment request; do not start another payment.'}:s)}}
  finally{navigation.cancel();locked.current=false;if(current(version))setSnapshot(s=>s.identity===queryIdentity?{...s,busy:false}:s)}
 };
 const canStartAgain=!!state.order&&!initialId&&!state.busy&&(state.order.purpose==='TOP_UP'&&state.order.status==='CREDITED'||!chapaConfirmed(state.order)&&['FAILED','CANCELLED','EXPIRED','BLOCKED','INCOMPLETE'].includes(state.order.status));
 const startAgain=()=>{if(!canStartAgain||locked.current)return;epoch.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear();persist(null);invalidated.current=null;const next=empty();stateRef.current=next;setSnapshot(next)};
 return {...state,started:!!(state.attempt||state.order||initialId),create,check,canStartAgain,startAgain};
}

export function ChapaPaymentStatus({payment}:{payment:ReturnType<typeof useChapaPayment>}){
 const {language}=useMiniLocale(),text=(en:string,am:string)=>language==='am'?am:en,order=payment.order,url=chapaCheckoutUrl(order?.checkoutUrl);
 const accepted=order?.purpose==='BID'&&order.status==='BID_ACCEPTED'&&!!order.receipt,credited=order?.purpose==='TOP_UP'&&order.status==='CREDITED',preserved=!!order?.fundsPreserved;
 const finished=accepted||credited||preserved,failed=!!order&&['FAILED','CANCELLED','EXPIRED','INCOMPLETE','BLOCKED'].includes(order.status),review=order?.status==='NEEDS_REVIEW';
 const title=accepted?text('Bid accepted','ጨረታው ተቀብሏል'):credited?text('Wallet credited','ገንዘቡ ወደ ዋሌት ገብቷል'):preserved?text('Payment received','ክፍያው ደርሷል'):failed?text('Payment not completed','ክፍያው አልተጠናቀቀም'):review?text('Checking your payment','ክፍያዎን በማረጋገጥ ላይ'):text('Complete payment in Chapa','ክፍያዎን በChapa ያጠናቅቁ');
 return <section className={`${styles.paymentStatus} ${styles.simplePaymentStatus}`} aria-live="polite">
  <div className={styles.paymentStatusIcon}>{finished?<Check size={24}/>:review?<ShieldCheck size={24}/>:<LoaderCircle size={24} className={!failed&&!payment.paused?styles.paymentSpinner:undefined}/>}</div>
  <h3>{title}</h3>
  {order&&<p className={styles.paymentTotal}>{formatEtb(order.amount)}{order.mode==='test'&&<span>{text('Test payment','የሙከራ ክፍያ')}</span>}</p>}
  <p>{accepted?text('Your bid is confirmed.','ጨረታዎ ተረጋግጧል።'):credited?text('Your wallet balance has been updated.','የዋሌት ቀሪ ሂሳብዎ ተዘምኗል።'):preserved?text('The funds are in your wallet. Your bid could not be accepted.','ገንዘቡ በዋሌትዎ ውስጥ ነው። ጨረታዎን መቀበል አልተቻለም።'):failed?text('No payment was confirmed. You can try again.','ክፍያ አልተረጋገጠም። እንደገና መሞከር ይችላሉ።'):review?text('We are confirming this payment. Please do not pay again.','ይህን ክፍያ በማረጋገጥ ላይ ነን። እባክዎ እንደገና አይክፈሉ።'):text('Return here after payment. Your balance updates automatically.','ክፍያውን ካጠናቀቁ በኋላ ወደዚህ ይመለሱ። ቀሪ ሂሳብዎ በራሱ ይዘምናል።')}</p>
  {url&&!finished&&!failed&&!review&&<a className={styles.payButton} href={url} target="_blank" rel="noopener noreferrer" onClick={event=>{const app=window.Telegram?.WebApp;if(app?.openLink){event.preventDefault();app.openLink(url)}}}>{text('Continue to Chapa','ወደ Chapa ይቀጥሉ')}<ArrowUpRight size={16}/></a>}
  {payment.error&&<p className={styles.error} role="alert">{payment.error}</p>}
  {!finished&&(payment.paused||payment.error||review)&&<button type="button" className={styles.checkPayment} disabled={payment.busy||payment.restoring} onClick={()=>void payment.check()}><RefreshCw size={15}/>{text(payment.busy?'Checking…':'Check payment',payment.busy?'በማረጋገጥ ላይ…':'ክፍያ ያረጋግጡ')}</button>}
  {payment.canStartAgain&&<button type="button" className={styles.checkPayment} onClick={payment.startAgain}>{credited?text('Top up again','እንደገና ገንዘብ ያስገቡ'):text('Try again','እንደገና ይሞክሩ')}</button>}
  {order&&<details className={styles.paymentDetails}><summary>{text('Payment details','የክፍያ ዝርዝሮች')}</summary><small className={styles.paymentReference}>{text('Payment ID','የክፍያ መለያ')}: {order.id}</small>{accepted&&order.receipt&&<p>{text('Bid number','የጨረታ ቁጥር')}: {order.receipt.bid.amount}</p>}</details>}
  {finished&&<div className={styles.links}><Link href={accepted?'/my-bids':'/profile#wallet'}>{accepted?text('View My Bids','የእኔ ጨረታዎች'):text('Open Wallet','ዋሌት ይክፈቱ')}</Link></div>}
 </section>;
}