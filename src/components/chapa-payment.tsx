'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Check,Clock3,LoaderCircle} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {useMiniLocale} from './mini-locale';
import {confirmedChapaQueryScopes,invalidatePrivateQueries,isPrivateQueryIdentity,subscribePrivateQueries} from './private-query-cache';
import {clearChapaAttempts,chapaCheckoutUrl,chapaConfirmed,chapaRecoverable,chapaUuid,ChapaClientError,requestChapaJson,type ChapaAttempt,type ChapaCheckoutView,type ChapaIntent} from '@/lib/chapa-client';
import {formatEtb} from '@/lib/money';
import {prepareChapaNavigation} from '@/lib/chapa-navigation';
import styles from './bid-payment-sheet.module.css';

type Snapshot={identity:string|null;attempt:ChapaAttempt|null;order:ChapaCheckoutView|null;error:string;busy:boolean;restoring:boolean;paused:boolean;active:boolean;handoff:'idle'|'opening'|'opened'|'failed'};
/** Restores only an explicit, owned checkout ID from a return link. */
export function useChapaPayment(scope:string,initialId?:string){
 const {queryIdentity,refreshMe}=useTelegram(),{language}=useMiniLocale();
 const empty=():Snapshot=>({identity:queryIdentity,attempt:null,order:null,error:'',busy:false,restoring:!!initialId,paused:false,active:!!initialId,handoff:'idle'});
 const [snapshot,setSnapshot]=useState<Snapshot>(empty),state=snapshot.identity===queryIdentity?snapshot:empty(),stateRef=useRef(state);stateRef.current=state;
 const epoch=useRef(0),controllers=useRef(new Set<AbortController>()),locked=useRef(false),invalidated=useRef<string|null>(null);
 const current=useCallback((version:number)=>version===epoch.current&&isPrivateQueryIdentity(queryIdentity),[queryIdentity]);
 const update=useCallback((value:Partial<Snapshot>)=>{stateRef.current={...stateRef.current,...value};setSnapshot(s=>s.identity===queryIdentity?{...s,...value}:s)},[queryIdentity]);
 const receive=useCallback((order:ChapaCheckoutView)=>{
  if(scope==='topup'&&order.purpose!=='TOP_UP'||scope.startsWith('bid:')&&(order.purpose!=='BID'||order.auctionSlug!==scope.slice(4)))throw new ChapaClientError('Payment not found.',404,'NOT_FOUND');
  update({order,error:'',restoring:false});const scopes=confirmedChapaQueryScopes(order);
  if(queryIdentity&&scopes&&invalidated.current!==order.id){invalidated.current=order.id;invalidatePrivateQueries(queryIdentity,scopes);void refreshMe().catch(()=>{})}
 },[scope,update,queryIdentity,refreshMe]);
 const run=useCallback(async(url:string,options:RequestInit={})=>{
  const version=epoch.current,controller=new AbortController();controllers.current.add(controller);
  try{const order=await requestChapaJson<ChapaCheckoutView>(url,options,controller.signal);if(!current(version))return null;receive(order);return order}finally{controllers.current.delete(controller)}
 },[current,receive]);
 useEffect(()=>{
  try{clearChapaAttempts(window.sessionStorage)}catch{}
  const version=++epoch.current;locked.current=false;invalidated.current=null;const next=empty();stateRef.current=next;setSnapshot(next);
  if(queryIdentity&&initialId&&chapaUuid.test(initialId))void run(`/api/payments/chapa/checkouts/${initialId}`).catch(()=>{if(current(version))update({restoring:false,error:language==='am'?'የክፍያውን ሁኔታ ማምጣት አልተቻለም።':'Payment status could not load. Try again.'})});
  const unsubscribe=subscribePrivateQueries(event=>{if(event.kind==='authorization'||event.kind==='session'&&event.identity!==queryIdentity){epoch.current++;controllers.current.forEach(c=>c.abort())}});
  return()=>{epoch.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear();unsubscribe()};
 },[queryIdentity,scope,initialId]);
 const orderId=state.order?.id,confirmed=!!state.order&&chapaConfirmed(state.order),waiting=!!state.order&&chapaRecoverable(state.order);
 useEffect(()=>{
  if(!orderId||!queryIdentity||confirmed||!waiting)return;
  let active=true,inFlight=false,timer:ReturnType<typeof setTimeout>;const end=Date.now()+300000;
  const schedule=()=>{if(active&&document.visibilityState==='visible')timer=setTimeout(()=>void read(),5000)};
  const read=async()=>{if(!active||inFlight||document.visibilityState!=='visible')return;if(Date.now()>=end){update({paused:true});return}inFlight=true;try{await run(`/api/payments/chapa/checkouts/${orderId}`)}catch{/* A lost read changes no financial state. */}finally{inFlight=false;schedule()}};
  const visibility=()=>{clearTimeout(timer);if(document.visibilityState==='visible')void read()};document.addEventListener('visibilitychange',visibility);schedule();return()=>{active=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility)};
 },[orderId,queryIdentity,confirmed,waiting,run,update]);
 const create=useCallback(async(intent:ChapaIntent)=>{
  if(!queryIdentity||locked.current||!isPrivateQueryIdentity(queryIdentity))return;
  const version=epoch.current,next=stateRef.current.attempt??{version:1 as const,intent};locked.current=true;update({attempt:next,busy:true,active:true,error:'',paused:false,handoff:'opening'});const navigation=prepareChapaNavigation();
  try{const order=await run('/api/payments/chapa/checkouts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next.intent)});if(current(version)&&order){update({attempt:{...next,orderId:order.id}});const eligible=!chapaConfirmed(order)&&['SUBMITTING','PENDING','AUTH_NEEDED'].includes(order.status);update({handoff:eligible&&navigation.open(order.checkoutUrl)?'opened':eligible?'failed':'idle'});invalidatePrivateQueries(queryIdentity,['/api/payments/chapa/checkouts','/api/my-bids'])}}
  catch(cause){if(current(version))update({error:language==='am'?'ግንኙነቱ ተቋርጧል። ይህንኑ ጥያቄ እንደገና ይሞክሩ ወይም ግብይቶችን ይመልከቱ።':cause instanceof ChapaClientError?cause.message:'Connection interrupted. Retry this request or view Transactions.'})}
  finally{navigation.cancel();if(current(version)){locked.current=false;update({busy:false,handoff:stateRef.current.handoff==='opening'?'failed':stateRef.current.handoff})}}
 },[queryIdentity,current,update,run,language]);
 const check=useCallback(async()=>{
  const id=stateRef.current.order?.id??initialId;if(!id||locked.current||!queryIdentity||!isPrivateQueryIdentity(queryIdentity))return;
  const version=epoch.current;locked.current=true;update({busy:true,error:''});try{await run(`/api/payments/chapa/checkouts/${id}`,{method:'POST'})}catch{if(current(version))update({error:language==='am'?'ማረጋገጥ አልተቻለም። የመጨረሻው ሁኔታ ተጠብቋል።':'Verification is unavailable. The last known payment status is preserved.'})}finally{if(current(version)){locked.current=false;update({busy:false,restoring:false})}}
 },[queryIdentity,initialId,current,update,run,language]);
 const canStartAgain=!state.busy&&!state.restoring&&state.active&&(!state.order||!chapaConfirmed(state.order)||state.order.purpose==='TOP_UP'&&state.order.status==='CREDITED');
 const startAgain=()=>{if(!canStartAgain||locked.current)return;epoch.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear();invalidated.current=null;const next={...empty(),active:false,restoring:false};stateRef.current=next;setSnapshot(next)};
 return {...state,opening:state.handoff==='opening',started:state.active,create,check,canStartAgain,startAgain};
}
export function chapaStatusLabel(order:ChapaCheckoutView,am=false){
 const labels:Record<string,[string,string]>={CREDITED:['Wallet credited','ዋሌት ገብቷል'],BID_ACCEPTED:['Bid accepted','ጨረታው ተቀብሏል'],PENDING:['Pending','በመጠባበቅ ላይ'],SUBMITTING:['Initiating checkout','ክፍያ በመጀመር ላይ'],FAILED:['Payment failed','ክፍያው አልተሳካም'],CANCELLED:['Cancelled','ተሰርዟል'],INCOMPLETE:['Incomplete','አልተጠናቀቀም'],EXPIRED:['Not completed','አልተጠናቀቀም'],AUTH_NEEDED:['Authorization required','ፈቃድ ያስፈልጋል'],BLOCKED:['Payment blocked','ክፍያው ታግዷል']};
 if(order.fundsPreserved)return am?'ክፍያው ደርሷል — ጨረታው አልተቀበለም':'Payment received — bid not accepted';
 if(order.reason==='INITIALIZATION_REJECTED')return am?'ክፍያው ሊጀመር አልቻለም':'Checkout could not start';
 if(order.verificationState==='UNAVAILABLE'||order.status==='NEEDS_REVIEW')return am?'ማረጋገጥ ያስፈልጋል':'Needs verification';
 return (labels[order.status]??labels.PENDING)[am?1:0];
}
export function ChapaPaymentStatus({payment,onNavigate,readOnly=false}:{payment:ReturnType<typeof useChapaPayment>;onNavigate?:()=>void;readOnly?:boolean}){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en,order=payment.order,finished=!!order&&chapaConfirmed(order),checking=!!order&&!finished&&chapaRecoverable(order)&&!payment.paused,url=payment.attempt&&payment.handoff==='failed'?chapaCheckoutUrl(order?.checkoutUrl):null;
 return <section className={`${styles.paymentStatus} ${styles.simplePaymentStatus}`} aria-live="polite" aria-busy={payment.busy||payment.restoring||checking}>
  <div className={styles.paymentStatusIcon}>{finished?<Check size={24} aria-hidden="true"/>:payment.opening||payment.restoring||checking?<LoaderCircle className={styles.paymentSpinner} size={24} aria-hidden="true"/>:<Clock3 size={24} aria-hidden="true"/>}</div>
  <h3>{payment.opening?text('Opening Chapa…','Chapa በመክፈት ላይ…'):payment.restoring?text('Loading payment…','ክፍያ በመጫን ላይ…'):checking?text('Checking your payment…','ክፍያዎን በማረጋገጥ ላይ…'):order?chapaStatusLabel(order,am):text('Needs verification','ማረጋገጥ ያስፈልጋል')}</h3>
  {order&&<><p className={styles.paymentTotal}>{formatEtb(order.amount)}{order.mode==='test'&&<span>{text('Test payment','የሙከራ ክፍያ')}</span>}</p><p>{text(order.purpose==='TOP_UP'?'Wallet top-up':'Auction submission fee',order.purpose==='TOP_UP'?'የዋሌት ገቢ':'የጨረታ ማቅረቢያ ክፍያ')}{order.bidNumber&&<> · #{order.bidNumber}</>}</p>{order.auctionTitle&&<p>{am?order.auctionTitleAm||order.auctionTitle:order.auctionTitle}</p>}</>}
  <p>{finished?order?.fundsPreserved?text('The payment is in your wallet. This bid could not be accepted.','ክፍያው በዋሌትዎ ውስጥ ነው። ጨረታው አልተቀበለም።'):text('Your payment has been confirmed and applied.','ክፍያዎ ተረጋግጦ ተተግብሯል።'):order?.providerStatus&&['FAILED','CANCELLED','INCOMPLETE','BLOCKED'].includes(order.providerStatus)?text('Chapa reported this outcome. You can start a new checkout in Lowwin.','Chapa ይህን ሁኔታ አሳውቋል። በLowwin አዲስ ክፍያ መጀመር ይችላሉ።'):order?.reason==='INITIALIZATION_REJECTED'?text('Chapa rejected checkout initialization. You can start a new checkout.','Chapa የክፍያ መጀመሪያውን አልተቀበለም። አዲስ ክፍያ መጀመር ይችላሉ።'):text('Waiting for payment confirmation. Complete your payment in Chapa. You can close this window and view the result in Transactions.','የክፍያ ማረጋገጫ በመጠባበቅ ላይ። ክፍያዎን በChapa ያጠናቅቁ። ይህን መስኮት ዘግተው ውጤቱን በግብይቶች ማየት ይችላሉ።')}</p>
  {url&&<a className={styles.payButton} href={url} target="_blank" rel="noopener noreferrer" onClick={event=>{event.preventDefault();const nav=prepareChapaNavigation();try{nav.open(url)}finally{nav.cancel()}}}>{text('Open checkout','ክፍያውን ይክፈቱ')}</a>}
  {payment.error&&<p className={styles.error} role="alert">{payment.error}</p>}
  {!order&&payment.attempt&&!payment.busy&&<button type="button" className={styles.checkPayment} onClick={()=>void payment.create(payment.attempt!.intent)}>{text('Retry original request','የመጀመሪያውን ጥያቄ ይድገሙ')}</button>}
  {!readOnly&&payment.canStartAgain&&<><button type="button" className={styles.checkPayment} onClick={payment.startAgain}>{text(finished?'Top up again':'Start new checkout',finished?'እንደገና ገንዘብ ያስገቡ':'አዲስ ክፍያ ይጀምሩ')}</button>{!finished&&<small>{text('A previously processing payment may still complete.','ከዚህ በፊት በሂደት ላይ የነበረ ክፍያ አሁንም ሊጠናቀቅ ይችላል።')}</small>}</>}
  {order&&<details className={styles.paymentDetails}><summary>{text('Payment details','የክፍያ ዝርዝሮች')}</summary><small className={styles.paymentReference}>{order.merchantReference??order.id}</small>{order.paymentMethod&&<p>{text('Method','መንገድ')}: {order.paymentMethod}</p>}{order.initializationErrorCode&&<p>{text('Checkout error','የክፍያ መጀመሪያ ስህተት')}: {order.initializationErrorCode}</p>}</details>}
  <div className={styles.links}><Link href="/payments" prefetch={false} onClick={onNavigate}>{text('View Transactions','ግብይቶችን ይመልከቱ')}</Link>{order?.status==='BID_ACCEPTED'&&<Link href="/my-bids" onClick={onNavigate}>{text('My Bids','የእኔ ጨረታዎች')}</Link>}{onNavigate&&<button type="button" onClick={onNavigate}>{text('Close','ዝጋ')}</button>}</div>
 </section>;
}
