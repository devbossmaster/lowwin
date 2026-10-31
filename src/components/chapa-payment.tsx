'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,Clock3,LoaderCircle,TriangleAlert} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {useMiniLocale} from './mini-locale';
import {confirmedChapaQueryScopes,invalidatePrivateQueries,isPrivateQueryIdentity,loadPrivateJson,PrivateQueryError,subscribePrivateQueries} from './private-query-cache';
import {clearChapaAttempts,chapaCanResumeCheckout,chapaCheckoutUrl,chapaConfirmed,chapaRecoverable,chapaPollingDeadline,chapaPollingPaused,chapaUuid,ChapaClientError,requestChapaJson,type ChapaAttempt,type ChapaCheckoutView,type ChapaIntent} from '@/lib/chapa-client';
import {CHAPA_LONG_WAIT_MS,chapaLongWait,chapaPaymentPhase} from '@/lib/chapa-status';
import {chapaPaymentReasonMessage} from '@/lib/chapa-payment-reason';
import {formatEtb} from '@/lib/money';
import {prepareChapaNavigation} from '@/lib/chapa-navigation';
import {startChapaPolling} from '@/lib/chapa-polling';
import styles from './bid-payment-sheet.module.css';

type Snapshot={identity:string|null;attempt:ChapaAttempt|null;order:ChapaCheckoutView|null;error:string;errorCode:string|null;busy:boolean;restoring:boolean;paused:boolean;active:boolean;handoff:'idle'|'opening'|'opened'|'failed'};
/** Restores only an explicit, owned checkout ID from a return link. */
export function useChapaPayment(scope:string,initialId?:string){
 const {queryIdentity,refreshMe}=useTelegram(),{language}=useMiniLocale();
 const empty=():Snapshot=>({identity:queryIdentity,attempt:null,order:null,error:'',errorCode:null,busy:false,restoring:!!initialId,paused:false,active:!!initialId,handoff:'idle'});
 const [snapshot,setSnapshot]=useState<Snapshot>(empty),state=snapshot.identity===queryIdentity?snapshot:empty(),stateRef=useRef(state);stateRef.current=state;
 const epoch=useRef(0),controllers=useRef(new Set<AbortController>()),locked=useRef(false),invalidated=useRef<string|null>(null);
 const current=useCallback((version:number)=>version===epoch.current&&isPrivateQueryIdentity(queryIdentity),[queryIdentity]);
 const update=useCallback((value:Partial<Snapshot>)=>{stateRef.current={...stateRef.current,...value};setSnapshot(s=>s.identity===queryIdentity?{...s,...value}:s)},[queryIdentity]);
 const receive=useCallback((order:ChapaCheckoutView)=>{
  if(scope==='topup'&&order.purpose!=='TOP_UP'||scope.startsWith('bid:')&&(order.purpose!=='BID'||order.auctionSlug!==scope.slice(4)))throw new ChapaClientError('Payment not found.',404,'NOT_FOUND');
  update({order,error:'',errorCode:null,restoring:false});const scopes=confirmedChapaQueryScopes(order);
  if(queryIdentity&&scopes&&invalidated.current!==order.id){invalidated.current=order.id;invalidatePrivateQueries(queryIdentity,scopes);void refreshMe().catch(()=>{})}
 },[scope,update,queryIdentity,refreshMe]);
 const run=useCallback(async(url:string,options:RequestInit={})=>{
  const version=epoch.current,controller=new AbortController();controllers.current.add(controller);
  try{const order=await requestChapaJson<ChapaCheckoutView>(url,options,controller.signal);if(!current(version))return null;receive(order);return order}finally{controllers.current.delete(controller)}
 },[current,receive]);
 useEffect(()=>{
  try{clearChapaAttempts(window.sessionStorage)}catch{}
  const version=++epoch.current;locked.current=false;invalidated.current=null;const next=empty();stateRef.current=next;setSnapshot(next);
  if(queryIdentity&&initialId&&chapaUuid.test(initialId))void loadPrivateJson<ChapaCheckoutView>(queryIdentity,`/api/payments/chapa/checkouts/${initialId.toLowerCase()}`,{freshnessMs:5000}).then(order=>{if(current(version))receive(order)}).catch(cause=>{if(current(version))update({restoring:false,errorCode:cause instanceof ChapaClientError?cause.code:cause instanceof PrivateQueryError?({401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND'}[cause.status]??'UNAVAILABLE'):'UNAVAILABLE',error:language==='am'?'የክፍያውን ሁኔታ ማምጣት አልተቻለም።':'Payment status could not load. Try again.'})});
  const unsubscribe=subscribePrivateQueries(event=>{if(event.kind==='authorization'||event.kind==='session'&&event.identity!==queryIdentity){epoch.current++;controllers.current.forEach(c=>c.abort())}});
  return()=>{epoch.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear();unsubscribe()};
 },[queryIdentity,scope,initialId]);
 const orderId=state.order?.id,confirmed=!!state.order&&chapaConfirmed(state.order),waiting=!!state.order&&chapaRecoverable(state.order);
 const pollingDeadline=state.order?chapaPollingDeadline(state.order):null;
 useEffect(()=>{
  if(!orderId||!queryIdentity||confirmed||!waiting)return;
  // GET restores the owned order; POST asks our server to verify with Chapa.
  // The server's lease and nextCheckAt still control provider request frequency.
  return startChapaPolling(()=>run(`/api/payments/chapa/checkouts/${orderId}`,{method:'POST'}),()=>update({paused:true}),document,{
   deadlineAt:pollingDeadline,
   onResume:()=>update({paused:false}),
   onError:cause=>update({error:cause instanceof ChapaClientError?cause.message:'Could not reach payment confirmation. We will retry automatically.',errorCode:cause instanceof ChapaClientError?cause.code:'UNAVAILABLE'}),
  });
 },[orderId,queryIdentity,confirmed,waiting,pollingDeadline,run,update]);
 const create=useCallback(async(intent:ChapaIntent)=>{
  if(!queryIdentity||locked.current||!isPrivateQueryIdentity(queryIdentity))return;
  const version=epoch.current,next=stateRef.current.attempt??{version:1 as const,intent};locked.current=true;update({attempt:next,busy:true,active:true,error:'',errorCode:null,paused:false,handoff:'opening'});const navigation=prepareChapaNavigation();
  try{const order=await run('/api/payments/chapa/checkouts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next.intent)});if(current(version)&&order){update({attempt:{...next,orderId:order.id}});const eligible=!chapaConfirmed(order)&&order.providerStatus!=='SUCCESS'&&Date.parse(order.expiresAt)>Date.now()&&['SUBMITTING','PENDING','AUTH_NEEDED'].includes(order.status);update({handoff:eligible&&navigation.open(order.checkoutUrl)?'opened':eligible?'failed':'idle'});invalidatePrivateQueries(queryIdentity,['/api/payments/chapa/checkouts','/api/my-bids'])}}
  catch(cause){if(current(version))update({errorCode:cause instanceof ChapaClientError?cause.code:'UNAVAILABLE',error:language==='am'?'ግንኙነቱ ተቋርጧል። ይህንኑ ጥያቄ እንደገና ይሞክሩ ወይም ግብይቶችን ይመልከቱ።':cause instanceof ChapaClientError?cause.message:'Connection interrupted. Retry this request or view Transactions.'})}
  finally{navigation.cancel();if(current(version)){locked.current=false;update({busy:false,handoff:stateRef.current.handoff==='opening'?'failed':stateRef.current.handoff})}}
 },[queryIdentity,current,update,run,language]);
 const check=useCallback(async()=>{
  const id=stateRef.current.order?.id??initialId;if(!id||locked.current||!queryIdentity||!isPrivateQueryIdentity(queryIdentity))return;
  const version=epoch.current;locked.current=true;update({busy:true,error:'',errorCode:null});try{await run(`/api/payments/chapa/checkouts/${id}`,{method:'POST'})}catch(cause){if(current(version))update({errorCode:cause instanceof ChapaClientError?cause.code:'UNAVAILABLE',error:language==='am'?'ማረጋገጥ አልተቻለም። የመጨረሻው ሁኔታ ተጠብቋል።':'Verification is unavailable. The last known payment status is preserved.'})}finally{if(current(version)){locked.current=false;update({busy:false,restoring:false})}}
 },[queryIdentity,initialId,current,update,run,language]);
 const canStartAgain=!state.busy&&!state.restoring&&state.active&&(!state.order||!chapaConfirmed(state.order)||state.order.purpose==='TOP_UP'&&state.order.status==='CREDITED');
 const startAgain=()=>{if(!canStartAgain||locked.current)return;epoch.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear();invalidated.current=null;const next={...empty(),active:false,restoring:false};stateRef.current=next;setSnapshot(next)};
 return {...state,opening:state.handoff==='opening',started:state.active,create,check,canStartAgain,startAgain};
}
export function chapaStatusLabel(order:ChapaCheckoutView,am=false){
 const labels:Record<string,[string,string]>={CREDITED:['Wallet credited','ዋሌት ገብቷል'],BID_ACCEPTED:['Bid accepted','ጨረታው ተቀብሏል'],PENDING:['Pending','በመጠባበቅ ላይ'],SUBMITTING:['Initiating checkout','ክፍያ በመጀመር ላይ'],FAILED:['Payment failed','ክፍያው አልተሳካም'],CANCELLED:['Cancelled','ተሰርዟል'],INCOMPLETE:['Incomplete','አልተጠናቀቀም'],EXPIRED:['Not completed','አልተጠናቀቀም'],AUTH_NEEDED:['Authorization required','ፈቃድ ያስፈልጋል'],BLOCKED:['Payment blocked','ክፍያው ታግዷል']};
 if(order.fundsPreserved)return am?'ክፍያው ደርሷል — ጨረታው አልተቀበለም':'Payment received — bid not accepted';
 if(order.reason==='INITIALIZATION_REJECTED')return am?'ክፍያው ሊጀመር አልቻለም':'Checkout could not start';
 if(order.verificationState==='MISMATCH'||order.status==='NEEDS_REVIEW')return am?'ማረጋገጥ ያስፈልጋል':'Needs verification';
 if(order.verificationState==='UNAVAILABLE')return am?'ማረጋገጥ ያስፈልጋል':'Needs verification';
 return (labels[order.status]??labels.PENDING)[am?1:0];
}
export function ChapaPaymentStatus({payment,onNavigate,readOnly=false}:{payment:ReturnType<typeof useChapaPayment>;onNavigate?:()=>void;readOnly?:boolean}){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en,order=payment.order;
 const [now,setNow]=useState(()=>Date.now()),deadline=order?chapaPollingDeadline(order):null;
 const waitingSince=order?Date.parse(order.createdAt)+CHAPA_LONG_WAIT_MS:NaN;
 useEffect(()=>{
  const refresh=()=>setNow(Date.now());refresh();
  const timers=[deadline,waitingSince].filter((value):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>Date.now()).map(value=>setTimeout(refresh,Math.max(0,value-Date.now()+1)));
  document.addEventListener('visibilitychange',refresh);window.addEventListener('focus',refresh);
  return()=>{timers.forEach(clearTimeout);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh)};
 },[order?.id,deadline,waitingSince]);
 const phase=chapaPaymentPhase({...payment,now}),finished=phase==='confirmed'||phase==='preserved',checkingPaused=!!order&&chapaPollingPaused(order,now);
 const providerReason=order?chapaPaymentReasonMessage(order,am):null;
 const longWait=!providerReason&&chapaLongWait(order,now)&&['confirming','applying','pending','unavailable'].includes(phase);
 const spinning=!longWait&&['opening','restoring','confirming','applying'].includes(phase);
 const attention=['review','failed','unavailable','interrupted','preserved','access'].includes(phase);
 const headings:Record<typeof phase,[string,string]>={
  access:['Reopen your Lowwin account','የLowwin መለያዎን እንደገና ይክፈቱ'],
  opening:['Opening checkout…','ክፍያ በመክፈት ላይ…'],restoring:['Opening your payment…','ክፍያዎን በመክፈት ላይ…'],
  confirmed:[order?.purpose==='BID'?'Bid accepted':'Wallet credited',order?.purpose==='BID'?'ጨረታው ተቀብሏል':'ዋሌት ገብቷል'],
  preserved:['Payment saved to your wallet','ክፍያው በዋሌትዎ ገብቷል'],
  review:['Payment needs review','ክፍያው ማረጋገጥ ያስፈልገዋል'],
  failed:[order?chapaStatusLabel(order):'Payment not completed',order?chapaStatusLabel(order,true):'ክፍያው አልተጠናቀቀም'],
  unavailable:['Confirmation delayed','ማረጋገጫው ዘግይቷል'],interrupted:['Checkout interrupted','ክፍያው ተቋርጧል'],
  pending:['Still waiting for confirmation','ማረጋገጫን በመጠባበቅ ላይ'],
  applying:['Applying your payment…','ክፍያዎ በመተግበር ላይ…'],
  authorization:['Complete your payment','ክፍያውን ያጠናቅቁ'],
  confirming:['Confirming your payment…','ክፍያዎን በማረጋገጥ ላይ…'],
 };
 const messages:Record<typeof phase,[string,string]>={
  access:['Open Lowwin from your Telegram bot using the account that started this checkout.','ክፍያውን በጀመሩበት መለያ ከTelegram ቦትዎ Lowwinን ይክፈቱ።'],
  opening:['Enter your details on the secure checkout page.','የክፍያ መረጃዎን በክፍያ ገጹ ያስገባሉ።'],
  restoring:['Restoring the original checkout.','የመጀመሪያውን ክፍያ በመክፈት ላይ።'],
  confirmed:[order?.purpose==='BID'?'Your bid is in My Bids.':'Your updated balance is ready to use.',order?.purpose==='BID'?'ጨረታዎን በእኔ ጨረታዎች ማየት ይችላሉ።':'የዘመነውን ቀሪ ሂሳብዎን መጠቀም ይችላሉ።'],
  preserved:['This bid could not be accepted. Your payment is available in your wallet.','ጨረታው አልተቀበለም። ክፍያዎ በዋሌትዎ ውስጥ ይገኛል።'],
  review:['We could not safely apply this payment yet. Keep its reference in Transactions. Please do not pay it again.','ይህን ክፍያ ማረጋገጥ አልተቻለም። ማጣቀሻው በግብይቶች ተቀምጧል። እባክዎ ድጋሚ አይክፈሉ።'],
  failed:[order?.status==='EXPIRED'?'This checkout was not completed. You can start a new one.':'The payment provider reports that this payment was not completed. You can start a new checkout.',order?.status==='EXPIRED'?'ይህ ክፍያ አልተጠናቀቀም። አዲስ መጀመር ይችላሉ።':'የክፍያ አቅራቢው ክፍያው እንዳልተጠናቀቀ አሳውቋል። አዲስ ክፍያ መጀመር ይችላሉ።'],
  unavailable:['We’ll retry automatically while this window is open. Your last payment status is saved. Please do not pay again.','ይህ መስኮት ክፍት ሆኖ በራሱ እንደገና ይሞክራል። የመጨረሻው ሁኔታ ተቀምጧል። ድጋሚ አይክፈሉ።'],
  interrupted:['Retry the same request to recover your checkout.','ክፍያዎን ለመቀጠል ያንኑ ጥያቄ እንደገና ይሞክሩ።'],
  pending:['This payment is still awaiting confirmation. Its status is saved in Transactions and refreshes when you return to Lowwin. If you already paid, please do not pay again.','ክፍያው በግብይቶች ተቀምጧል። ወደ Lowwin ሲመለሱ ማረጋገጡ ይቀጥላል። ከከፈሉ እባክዎ ድጋሚ አይክፈሉ።'],
  applying:['Your payment is confirmed. We’re updating your Lowwin account automatically.','ክፍያው ተረጋግጧል። የLowwin መለያዎ በራሱ በመዘመን ላይ ነው።'],
  authorization:['Finish the authorization on the checkout page. Your result will appear here automatically.','ፈቃዱን በክፍያ ገጹ ያጠናቅቁ። ውጤቱ እዚህ በራሱ ይታያል።'],
  confirming:['Waiting for payment confirmation. Your result updates automatically. If you already paid, please do not pay again.','የክፍያ ማረጋገጫ በመጠባበቅ ላይ። ውጤቱ እዚህ በራሱ ይታያል። ይህን መስኮት መዝጋት ይችላሉ።'],
 };
 const url=order&&!finished&&['PENDING','AUTH_NEEDED'].includes(order.status)&&!['review','unavailable','applying','access'].includes(phase)&&(payment.handoff==='failed'||!payment.attempt)&&Date.parse(order.expiresAt)>now?chapaCheckoutUrl(order.checkoutUrl):null;
 const retryOriginal=!payment.busy&&chapaCanResumeCheckout(payment.attempt,order);
 return <section className={`${styles.paymentStatus} ${styles.smoothPaymentStatus}${longWait?' '+styles.longPaymentWait:''}`} data-payment-state={phase} data-payment-long-wait={longWait||undefined}>
  <div className={styles.paymentStatusIcon} data-tone={attention?'attention':finished?'success':'pending'}>{longWait?<Clock3 size={32} aria-hidden="true"/>:spinning?<LoaderCircle className={styles.paymentSpinner} size={26} aria-hidden="true"/>:attention?<TriangleAlert size={25} aria-hidden="true"/>:finished?<Check size={26} aria-hidden="true"/>:<Clock3 size={26} aria-hidden="true"/>}</div>
  <div role="status" aria-live="polite" aria-atomic="true"><h3>{longWait?text('This is taking a bit longer','ይህ ትንሽ እየዘገየ ነው'):headings[phase][am?1:0]}</h3></div>
  {order&&!longWait&&<p className={styles.paymentTotal}>{formatEtb(order.amount)}{order.mode==='test'&&<span>{text('Test payment','የሙከራ ክፍያ')}</span>}</p>}
  <p className={styles.statusMessage}>{longWait?text(`Your payment has not been confirmed yet. You don’t need to wait here—check ${order?.purpose==='BID'?'My Bids':'Transactions'} in a moment. We’ll notify you when it’s confirmed. If you already paid, please don’t pay again.`,`ክፍያዎ ገና አልተረጋገጠም። እዚህ መጠበቅ አያስፈልግም፤ በጥቂት ጊዜ የጨረታዎን ወይም የግብይትዎን ሁኔታ ይመልከቱ። ሲረጋገጥ እናሳውቅዎታለን። ከከፈሉ ድጋሚ አይክፈሉ።`):providerReason??messages[phase][am?1:0]}</p>
  {order&&<dl className={styles.paymentSummary}>{order.auctionTitle?<div><dt>{text('Auction','ጨረታ')}</dt><dd>{am?order.auctionTitleAm||order.auctionTitle:order.auctionTitle}</dd></div>:<div><dt>{text('For','ለ')}</dt><dd>{text(order.purpose==='TOP_UP'?'Wallet top-up':'Bid submission',order.purpose==='TOP_UP'?'የዋሌት ገቢ':'ጨረታ ማቅረቢያ')}</dd></div>}{order.bidNumber&&<div><dt>{text('Your bid amount','የጨረታ መጠንዎ')}</dt><dd>{order.bidNumber}</dd></div>}<div><dt>{text(order.purpose==='BID'?(finished?'Fee paid':'Submission fee'):'Top-up amount',order.purpose==='BID'?'የማስገቢያ ክፍያ':'የዋሌት ገቢ መጠን')}</dt><dd>{formatEtb(order.amount)}</dd></div><div><dt>{text(finished?'Paid with':'Payment method',finished?'የተከፈለበት':'የክፍያ መንገድ')}</dt><dd>{order.paymentMethod||text('Online payment','የመስመር ላይ ክፍያ')}</dd></div></dl>}
  {payment.error&&<p className={styles.statusError} role="alert">{am?'የክፍያ ሁኔታውን ማግኘት አልተቻለም።':payment.error}</p>}
  <div className={styles.statusActions}>
   {longWait&&<><Link className={styles.payButton} href={order?.purpose==='BID'?'/my-bids':'/payments'} onClick={onNavigate}>{text(order?.purpose==='BID'?'Go to My Bids':'View Transactions',order?.purpose==='BID'?'የእኔ ጨረታዎች':'ግብይቶችን ይመልከቱ')}</Link>{onNavigate&&<button type="button" className={styles.checkPayment} onClick={onNavigate}>{text('Close','ዝጋ')}</button>}</>}
   {finished&&(onNavigate?<button type="button" className={styles.payButton} onClick={onNavigate}>{text('Done','ተጠናቋል')}</button>:<Link className={styles.payButton} href={order?.status==='BID_ACCEPTED'?'/my-bids':'/profile#wallet'}>{text(order?.status==='BID_ACCEPTED'?'View My Bids':'Back to wallet',order?.status==='BID_ACCEPTED'?'የእኔ ጨረታዎች':'ወደ ዋሌት')}</Link>)}
   {url&&<a className={longWait?styles.checkPayment:styles.payButton} href={url} target="_blank" rel="noopener noreferrer" onClick={event=>{event.preventDefault();const nav=prepareChapaNavigation();try{nav.open(url)}finally{nav.cancel()}}}>{text('Continue checkout','ክፍያውን ይቀጥሉ')}<ArrowUpRight size={16} aria-hidden="true"/></a>}
   {retryOriginal&&<button type="button" className={styles.checkPayment} onClick={()=>void payment.create(payment.attempt!.intent)}>{text('Retry original request','የመጀመሪያውን ጥያቄ ይድገሙ')}</button>}
   {!order&&!payment.attempt&&!payment.restoring&&!payment.busy&&<button type="button" className={styles.checkPayment} onClick={()=>void payment.check()}>{text('Try opening again','እንደገና ክፈት')}</button>}
   {!readOnly&&payment.canStartAgain&&(!longWait||checkingPaused)&&<button type="button" className={styles.checkPayment} onClick={payment.startAgain}>{text(finished?'Top up again':'Start new checkout',finished?'እንደገና ገንዘብ ያስገቡ':'አዲስ ክፍያ ይጀምሩ')}</button>}
  </div>
  {!finished&&order&&phase!=='failed'&&(!longWait||checkingPaused)&&<small className={styles.savedPaymentNote}>{text('Starting another checkout does not cancel this payment.','ሌላ ክፍያ መጀመር ይህን ክፍያ አይሰርዝም።')}</small>}
  {order&&<details className={styles.paymentDetails}><summary>{text('Payment details','የክፍያ ዝርዝሮች')}</summary><small className={styles.paymentReference}>{order.merchantReference??order.id}</small>{order.providerStatus&&<p>{text('Payment status','የክፍያ ሁኔታ')}: {order.providerStatus}</p>}{order.paymentMethod&&<p>{text('Method','መንገድ')}: {order.paymentMethod}</p>}{order.reason&&['review','unavailable'].includes(phase)&&<p>{text('Confirmation','ማረጋገጫ')}: {order.reason}</p>}{order.initializationErrorCode&&<p>{text('Checkout','ክፍያ')}: {order.initializationErrorCode}</p>}</details>}
  <div className={styles.links}><Link href="/payments" prefetch={false} onClick={onNavigate}>{text('View Transactions','ግብይቶችን ይመልከቱ')}</Link>{order?.status==='BID_ACCEPTED'&&<Link href="/my-bids" onClick={onNavigate}>{text('My Bids','የእኔ ጨረታዎች')}</Link>}</div>
 </section>;
}
