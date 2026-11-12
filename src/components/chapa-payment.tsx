'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,Clock3,LoaderCircle,TriangleAlert} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {useMiniLocale} from './mini-locale';
import {confirmedChapaQueryScopes,getMiniQueryClient,invalidatePrivateQueries,isPrivateQueryIdentity,loadPrivateJson,PrivateQueryError,subscribePrivateQueries} from './private-query-cache';
import {acceptChapaSnapshot,clearChapaAttempts,chapaCanResumeCheckout,chapaCheckoutUrl,chapaConfirmed,chapaDirectRequestRejected,chapaRecoverable,chapaPollingDeadline,chapaPollingPaused,chapaRestorePollingId,chapaUuid,ChapaClientError,requestChapaJson,type ChapaAttempt,type ChapaCheckoutView,type ChapaIntent} from '@/lib/chapa-client';
import {CHAPA_LONG_WAIT_MS,chapaLongWait,chapaPaymentPhase} from '@/lib/chapa-status';
import {chapaPaymentReasonMessage,chapaRequestReasonMessage} from '@/lib/chapa-payment-reason';
import {formatEtb} from '@/lib/money';
import {prepareChapaNavigation} from '@/lib/chapa-navigation';
import {startChapaPolling} from '@/lib/chapa-polling';
import {chapaStatusLabel} from '@/lib/chapa-status-label';
import {chapaDirectCreationRejected} from '@/lib/chapa-direct-request';
import {bidPaymentCanRetry} from '@/lib/bid-payment-progress';
import {clearChapaOriginalAttempt,readChapaOriginalAttempt,retainChapaOriginalAttempt} from '@/lib/chapa-original-attempt';
import {retainPaymentRetryDraft} from '@/lib/payment-retry-draft';
export {chapaStatusLabel} from '@/lib/chapa-status-label';
import type {BidBatchQuote,ChapaDirectIntent} from '@/lib/bid-batch-client';
import {beginPaymentUiTiming,type PaymentUiTiming} from '@/lib/payment-ui-timing';
import {startChapaV1Inline,type ChapaV1InlineConfig} from '@/lib/chapa-v1-inline';
import styles from './bid-payment-sheet.module.css';

type Snapshot={identity:string|null;attempt:ChapaAttempt|null;directAttempt:ChapaDirectIntent|null;recoveryId:string|null;order:ChapaCheckoutView|null;error:string;errorCode:string|null;busy:boolean;restoring:boolean;paused:boolean;active:boolean;handoff:'idle'|'opening'|'opened'|'failed'};
/** Restores only an explicit, owned checkout ID from a return link. */
export function useChapaPayment(scope:string,initialId?:string,{retainOriginal=false}:{retainOriginal?:boolean}={}){
 const {queryIdentity,refreshMe}=useTelegram(),{language}=useMiniLocale();
 const retained=()=>retainOriginal&&!initialId&&queryIdentity&&isPrivateQueryIdentity(queryIdentity)?readChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,scope):null;
 const empty=(restore=true):Snapshot=>{const saved=restore?retained():null,recoveryId=restore?initialId??saved?.orderId??null:null;return {identity:queryIdentity,attempt:null,directAttempt:saved?.intent??null,recoveryId,order:null,error:'',errorCode:null,busy:false,restoring:!!recoveryId,paused:false,active:!!recoveryId||!!saved,handoff:'idle'}};
 const [snapshot,setSnapshot]=useState<Snapshot>(()=>empty()),state=snapshot.identity===queryIdentity?snapshot:empty(),stateRef=useRef(state);stateRef.current=state;
 const epoch=useRef(0),controllers=useRef(new Set<AbortController>()),locked=useRef(false),invalidated=useRef<string|null>(null);
 const uiTiming=useRef<PaymentUiTiming|null>(null);
 const inlineInstance=useRef<{dispose:()=>void}|null>(null);
 const inlineLoad=useRef<{config:ChapaV1InlineConfig;orderId:string;version:number;failed:boolean}|null>(null);
 const beginTiming=useCallback((fresh=false)=>{if(fresh||!uiTiming.current)uiTiming.current=beginPaymentUiTiming()},[]);
 const markPresented=useCallback((stage:'feedback'|'authorization'|'confirmed')=>{uiTiming.current?.mark(stage);if(stage==='confirmed')uiTiming.current?.mark('code-confirmed')},[]);
 const current=useCallback((version:number)=>version===epoch.current&&isPrivateQueryIdentity(queryIdentity),[queryIdentity]);
 const update=useCallback((value:Partial<Snapshot>)=>{stateRef.current={...stateRef.current,...value};setSnapshot(s=>s.identity===queryIdentity?{...s,...value}:s)},[queryIdentity]);
 const receive=useCallback((order:ChapaCheckoutView)=>{
  if(scope==='topup'&&order.purpose!=='TOP_UP'||scope.startsWith('bid:')&&(order.purpose!=='BID'||order.auctionSlug!==scope.slice(4)))throw new ChapaClientError('Payment not found.',404,'NOT_FOUND');
  if(!acceptChapaSnapshot(stateRef.current.order,order))return;
  if(queryIdentity&&stateRef.current.directAttempt)retainPaymentRetryDraft(getMiniQueryClient(),queryIdentity,order.id,stateRef.current.directAttempt);
  if(retainOriginal&&queryIdentity){
   const intent=stateRef.current.directAttempt;
   if(chapaConfirmed(order))clearChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,scope,intent?{intentKey:intent.key}:{orderId:order.id});
   else if(intent)retainChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,scope,intent,order.id);
  }
  update({order,recoveryId:order.id,error:'',errorCode:null,restoring:false});const confirmedScopes=confirmedChapaQueryScopes(order),scopes=confirmedScopes??(!chapaRecoverable(order)?['/api/payments/chapa/checkouts','/api/my-bids','/api/transactions']:null),revision=`${order.id}:${confirmedScopes?'confirmed':order.status}`;
  if(queryIdentity&&scopes&&invalidated.current!==revision){invalidated.current=revision;invalidatePrivateQueries(queryIdentity,scopes);if(confirmedScopes)void refreshMe().catch(()=>{})}
 },[scope,update,queryIdentity,refreshMe,retainOriginal]);
 const run=useCallback(async(url:string,options:RequestInit={})=>{
  const version=epoch.current,controller=new AbortController();controllers.current.add(controller);
  try{const order=await requestChapaJson<ChapaCheckoutView>(url,options,controller.signal);if(!current(version))return null;receive(order);return order}finally{controllers.current.delete(controller)}
 },[current,receive]);
 // Manual recovery and the single observer share one owned status request.
 // This does not replay initialization or bypass the server verification lease.
 const statusRead=useRef<{id:string;request:Promise<ChapaCheckoutView|null>}|null>(null);
 const verifyOwned=useCallback((id:string)=>{
  if(statusRead.current?.id===id)return statusRead.current.request;
  const request=run(`/api/payments/chapa/checkouts/${id}`,{method:'POST'});
  const flight={id,request};statusRead.current=flight;
  void request.then(()=>{if(statusRead.current===flight)statusRead.current=null},()=>{if(statusRead.current===flight)statusRead.current=null});
  return request;
 },[run]);
 useEffect(()=>{
  try{clearChapaAttempts(window.sessionStorage)}catch{}
  const version=++epoch.current;locked.current=false;statusRead.current=null;invalidated.current=null;uiTiming.current=null;const next=empty();stateRef.current=next;setSnapshot(next);
  const restoreUrl=next.recoveryId&&chapaUuid.test(next.recoveryId)?`/api/payments/chapa/checkouts/${next.recoveryId.toLowerCase()}`:next.directAttempt?.apiVersion==='v1'?`/api/payments/chapa/v1?key=${encodeURIComponent(next.directAttempt.key)}`:null;
  if(queryIdentity&&restoreUrl)void loadPrivateJson<ChapaCheckoutView>(queryIdentity,restoreUrl,{freshnessMs:5000}).then(order=>{if(current(version))receive(order)}).catch(cause=>{if(current(version))update({restoring:false,errorCode:cause instanceof ChapaClientError?cause.code:cause instanceof PrivateQueryError?({401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND'}[cause.status]??'UNAVAILABLE'):'UNAVAILABLE',error:language==='am'?'የክፍያውን ሁኔታ ማምጣት አልተቻለም።':'Payment status could not load. Try again.'})});
  const unsubscribe=subscribePrivateQueries(event=>{if(event.kind==='authorization'||event.kind==='session'&&event.identity!==queryIdentity){epoch.current++;statusRead.current=null;inlineInstance.current?.dispose();inlineInstance.current=null;controllers.current.forEach(c=>c.abort())}});
  return()=>{epoch.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear();inlineInstance.current?.dispose();inlineInstance.current=null;unsubscribe()};
 },[queryIdentity,scope,initialId,retainOriginal]);
 const orderId=state.order?.id??chapaRestorePollingId(state),confirmed=!!state.order&&chapaConfirmed(state.order),waiting=state.order?chapaRecoverable(state.order)&&!chapaDirectRequestRejected(state.order):!!orderId;
 const observeDirect=state.order?.chargeType==='DIRECT'||state.order?.apiVersion==='v1'||state.directAttempt?.apiVersion==='v1';
 useEffect(()=>{if(state.order&&(confirmed||!waiting)){inlineInstance.current?.dispose();inlineInstance.current=null}},[orderId,confirmed,waiting]);
 const pollingDeadline=state.order?chapaPollingDeadline(state.order):null;
 useEffect(()=>{
  if(!orderId||!isPrivateQueryIdentity(queryIdentity)||confirmed||!waiting)return;
  // GET restores the owned order; POST asks our server to verify with Chapa.
  // The server's lease and nextCheckAt still control provider request frequency.
  return startChapaPolling(()=>verifyOwned(orderId),()=>update({paused:true}),document,{
   deadlineAt:pollingDeadline,
   observeDirect,
   onResume:()=>update({paused:false}),
   onError:cause=>update({error:cause instanceof ChapaClientError?cause.message:'Could not reach payment confirmation. We will retry automatically.',errorCode:cause instanceof ChapaClientError?cause.code:'UNAVAILABLE'}),
  });
 },[orderId,queryIdentity,confirmed,waiting,pollingDeadline,observeDirect,verifyOwned,update]);
 const create=useCallback(async(intent:ChapaIntent)=>{
  if(!queryIdentity||locked.current||!isPrivateQueryIdentity(queryIdentity))return;
  const version=epoch.current,next=stateRef.current.attempt??{version:1 as const,intent};locked.current=true;update({attempt:next,busy:true,active:true,error:'',errorCode:null,paused:false,handoff:'opening'});const navigation=prepareChapaNavigation();
  try{const order=await run('/api/payments/chapa/checkouts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next.intent)});if(current(version)&&order){update({attempt:{...next,orderId:order.id}});const eligible=!chapaConfirmed(order)&&order.providerStatus!=='SUCCESS'&&Date.parse(order.expiresAt)>Date.now()&&['SUBMITTING','PENDING','AUTH_NEEDED'].includes(order.status);update({handoff:eligible&&navigation.open(order.checkoutUrl)?'opened':eligible?'failed':'idle'});invalidatePrivateQueries(queryIdentity,['/api/payments/chapa/checkouts','/api/my-bids','/api/transactions'])}}
  catch(cause){if(current(version))update({errorCode:cause instanceof ChapaClientError?cause.code:'UNAVAILABLE',error:language==='am'?'ግንኙነቱ ተቋርጧል። ይህንኑ ጥያቄ እንደገና ይሞክሩ ወይም ግብይቶችን ይመልከቱ።':cause instanceof ChapaClientError?cause.message:'Connection interrupted. Retry this request or view Transactions.'})}
  finally{navigation.cancel();if(current(version)){locked.current=false;update({busy:false,handoff:stateRef.current.handoff==='opening'?'failed':stateRef.current.handoff})}}
 },[queryIdentity,current,update,run,language]);
 const connectInline=useCallback((config:ChapaV1InlineConfig,orderId:string,version:number)=>{
  inlineInstance.current?.dispose();const load={config,orderId,version,failed:false};inlineLoad.current=load;
  const reconcile=()=>{if(current(version))void verifyOwned(orderId).catch(()=>{if(current(version))update({error:language==='am'?'የመጀመሪያውን ክፍያ እየፈተሽን ነው።':'We are checking the original payment.',errorCode:'UNAVAILABLE'})})};
  inlineInstance.current=startChapaV1Inline(config,{onSignal:signal=>{if(!current(version))return;if(signal==='started'){load.failed=false;uiTiming.current?.mark('authorization');update({busy:false,error:'',errorCode:null})}else reconcile()},onFailure:reason=>{
   if(!current(version))return;
   if(reason==='load'){load.failed=true;update({busy:false,errorCode:'SDK_LOAD_FAILED',error:language==='am'?'የክፍያ ግንኙነቱ አልተጫነም። ያንኑ ጥያቄ ለመቀጠል ግንኙነቱን ይድገሙ።':'The payment connection could not load. Retry the connection to continue this same request.'})}else reconcile();
  }});
 },[current,verifyOwned,update,language]);
 const retryInlineConnection=useCallback(()=>{
  const saved=inlineLoad.current,order=stateRef.current.order;
  if(!saved?.failed||!current(saved.version)||!order||order.id!==saved.orderId||!!order.providerStatus||order.verificationState==='MISMATCH'||chapaConfirmed(order)||!chapaRecoverable(order)||locked.current)return;
  update({busy:true,error:'',errorCode:null});try{connectInline(saved.config,saved.orderId,saved.version)}catch{update({busy:false,errorCode:'UNAVAILABLE',error:language==='am'?'የመጀመሪያውን ክፍያ ያረጋግጡ።':'Check the original payment before trying again.'})}
 },[connectInline,current,update,language]);
 const createV1=useCallback(async(intent:ChapaDirectIntent)=>{
  if(!queryIdentity||locked.current||!isPrivateQueryIdentity(queryIdentity))return;
  const version=epoch.current,next=stateRef.current.directAttempt??{...intent,apiVersion:'v1' as const};
  if(next.apiVersion!=='v1'||next.purpose==='BID'&&!('batchId'in next))return;
  if(stateRef.current.order&&(chapaConfirmed(stateRef.current.order)||!chapaRecoverable(stateRef.current.order)))return;
  if(retainOriginal)retainChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,scope,next,stateRef.current.order?.id??stateRef.current.recoveryId??undefined);
  beginTiming(true);locked.current=true;update({directAttempt:next,busy:true,active:true,error:'',errorCode:null,paused:false});
  const navigation=next.flow==='HOSTED'?prepareChapaNavigation():null,controller=new AbortController();controllers.current.add(controller);
  try{
   const {apiVersion:_,...body}=next;
   uiTiming.current?.mark('request');
   const result=await requestChapaJson<{order:ChapaCheckoutView;inline?:ChapaV1InlineConfig}>('/api/payments/chapa/v1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},controller.signal);
   if(!current(version))return;
   receive(result.order);invalidatePrivateQueries(queryIdentity,['/api/payments/chapa/checkouts','/api/my-bids','/api/transactions']);
   if(result.inline&&!chapaConfirmed(result.order)&&chapaRecoverable(result.order)){
    connectInline(result.inline,result.order.id,version);
   }else if(navigation&&!chapaConfirmed(result.order)&&chapaRecoverable(result.order))update({handoff:navigation.open(result.order.checkoutUrl)?'opened':'failed'});
  }catch(cause){if(current(version)){
   const rejected=chapaDirectCreationRejected(cause);
   if(rejected&&retainOriginal)clearChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,scope,{intentKey:next.key});
   update({...(rejected?{active:false,directAttempt:null}:{}),errorCode:cause instanceof ChapaClientError?cause.code:'UNAVAILABLE',error:cause instanceof ChapaClientError?cause.message:language==='am'?'የመጀመሪያውን ክፍያ እየፈተሽን ነው። እንደገና አይክፈሉ።':'We are checking the original payment. Do not pay again.'});
  }}finally{navigation?.cancel();controllers.current.delete(controller);if(current(version)){locked.current=false;update({busy:false})}}
 },[queryIdentity,current,update,receive,scope,retainOriginal,beginTiming,connectInline,language]);
 // Historical direct charges retain their original operation and v2 endpoint.
 // before HTTP; an interrupted response must retry that same operation/key.
 const createDirect=useCallback(async(intent:ChapaDirectIntent)=>{
  if(intent.apiVersion==='v1')return createV1(intent);
  if(!queryIdentity||locked.current||!isPrivateQueryIdentity(queryIdentity))return;
  const version=epoch.current,next=stateRef.current.directAttempt??intent;
  if(stateRef.current.order&&(stateRef.current.order.authorizationReference||chapaConfirmed(stateRef.current.order)||!['SUBMITTING','PENDING'].includes(stateRef.current.order.status)))return;
  if(retainOriginal)retainChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,scope,next,stateRef.current.order?.id??stateRef.current.recoveryId??undefined);
  if(!stateRef.current.directAttempt)beginTiming(true);locked.current=true;update({directAttempt:next,busy:true,active:true,error:'',errorCode:null,paused:false});
  try{
   uiTiming.current?.mark('request');
   if(next.purpose==='BID'&&'auctionSlug'in next){
    const controller=new AbortController();controllers.current.add(controller);
    try{
     const result=await requestChapaJson<{kind:'payment';order:ChapaCheckoutView}|{kind:'quote';quote:BidBatchQuote}>('/api/payments/chapa/direct/bid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)},controller.signal);
     if(!current(version))return;
     if(result.kind==='quote'){
      if(result.quote.auctionSlug!==scope.slice(4))throw new ChapaClientError('Payment not found.',404,'NOT_FOUND');
      if(retainOriginal)clearChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,scope,{intentKey:next.key});update({active:false,directAttempt:null,error:'',errorCode:null});return result.quote;
     }
     receive(result.order);invalidatePrivateQueries(queryIdentity,['/api/payments/chapa/checkouts','/api/my-bids','/api/transactions']);
    }finally{controllers.current.delete(controller)}
   }else{const order=await run('/api/payments/chapa/direct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});if(current(version)&&order)invalidatePrivateQueries(queryIdentity,['/api/payments/chapa/checkouts','/api/my-bids','/api/transactions'])}
  }
  catch(cause){if(current(version)){const rejected=chapaDirectCreationRejected(cause);if(rejected&&retainOriginal)clearChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,scope,{intentKey:next.key});update({...(rejected?{active:false,directAttempt:null}:{}),errorCode:cause instanceof ChapaClientError?cause.code:'UNAVAILABLE',error:cause instanceof ChapaClientError?cause.message:language==='am'?'ይህ ክፍያ ገና አልተረጋገጠም። በግብይቶች ይመልከቱ።':"We haven't confirmed this payment yet. Retry the original request or check Transactions."})}}
  finally{if(current(version)){locked.current=false;update({busy:false})}}
 },[queryIdentity,current,update,run,language,beginTiming,receive,scope,retainOriginal,createV1]);
 const authorize=useCallback(async(otp?:string)=>{
  const order=stateRef.current.order;if(!order||order.chargeType!=='DIRECT'||locked.current||!queryIdentity||!isPrivateQueryIdentity(queryIdentity))return;
  if(order.authType==='OTP'&&(!otp||!/^\d{4,10}$/.test(otp)))return;
  const version=epoch.current;locked.current=true;update({busy:true,error:'',errorCode:null});
  if(order.authType==='OTP')uiTiming.current?.codeSubmitted();
  try{await run(`/api/payments/chapa/checkouts/${order.id}/authorize`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(order.authType==='OTP'?{otp}:{})})}
  catch(cause){if(current(version))update({errorCode:cause instanceof ChapaClientError?cause.code:'UNAVAILABLE',error:cause instanceof ChapaClientError?(chapaRequestReasonMessage(cause.code,language==='am')??cause.message):language==='am'?'ፈቃዱን ማረጋገጥ አልተቻለም። የክፍያውን ሁኔታ ይመልከቱ።':'Authorization could not be confirmed. Check the original payment status before trying again.'})}
  finally{if(current(version)){locked.current=false;update({busy:false})}}
 },[queryIdentity,current,update,run,language]);
 const check=useCallback(async()=>{
  const id=stateRef.current.order?.id??stateRef.current.recoveryId??initialId,original=stateRef.current.directAttempt;if((!id&&original?.apiVersion!=='v1')||locked.current||!queryIdentity||!isPrivateQueryIdentity(queryIdentity))return;
  const version=epoch.current;locked.current=true;update({busy:true,error:'',errorCode:null});try{return id?await verifyOwned(id):await run(`/api/payments/chapa/v1?key=${encodeURIComponent(original!.key)}`)}catch(cause){if(current(version))update({errorCode:cause instanceof ChapaClientError?cause.code:'UNAVAILABLE',error:language==='am'?'ማረጋገጥ አልተቻለም። የመጨረሻው ሁኔታ ተጠብቋል።':'Verification is unavailable. The last known payment status is preserved.'});return null}finally{if(current(version)){locked.current=false;update({busy:false,restoring:false})}}
 },[queryIdentity,initialId,current,update,verifyOwned,run,language]);
 // A failed read is not permission to drop an unresolved immutable command.
 const canStartAgain=!state.busy&&!state.restoring&&state.active&&!!state.order&&(bidPaymentCanRetry(state.order)||state.order.purpose==='TOP_UP'&&state.order.status==='CREDITED'&&chapaConfirmed(state.order));
 const startAgain=()=>{if(!canStartAgain||locked.current)return;if(retainOriginal&&queryIdentity)clearChapaOriginalAttempt(getMiniQueryClient(),queryIdentity,scope,stateRef.current.directAttempt?{intentKey:stateRef.current.directAttempt.key}:{orderId:stateRef.current.order?.id??stateRef.current.recoveryId??undefined});epoch.current++;inlineInstance.current?.dispose();inlineInstance.current=null;controllers.current.forEach(c=>c.abort());controllers.current.clear();invalidated.current=null;uiTiming.current=null;const next=empty(false);stateRef.current=next;setSnapshot(next)};
 return {...state,opening:state.handoff==='opening',started:state.active,create,createV1,createDirect,authorize,check,canStartAgain,startAgain,beginTiming,markPresented,retryInlineConnection,canRetryInlineConnection:!!inlineLoad.current?.failed&&current(inlineLoad.current.version)&&state.order?.id===inlineLoad.current.orderId&&!state.order?.providerStatus&&state.order?.verificationState!=='MISMATCH'&&!!state.order&&chapaRecoverable(state.order)};
}
/** One-shot health hints never change the accepted provider authorization. */
export function useChapaPaymentClock(order:ChapaCheckoutView|null){
 const [now,setNow]=useState(()=>Date.now()),deadline=order?chapaPollingDeadline(order):null;
 const waitingSince=order&&order.chargeType!=='DIRECT'&&order.apiVersion!=='v1'?Date.parse(order.createdAt)+CHAPA_LONG_WAIT_MS:NaN;
 useEffect(()=>{
  const refresh=()=>setNow(Date.now());refresh();
  const timers=[deadline,waitingSince].filter((value):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>Date.now()).map(value=>setTimeout(refresh,Math.max(0,value-Date.now()+1)));
  document.addEventListener('visibilitychange',refresh);window.addEventListener('focus',refresh);
  return()=>{timers.forEach(clearTimeout);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh)};
 },[order?.id,deadline,waitingSince]);
 return now;
}
export function ChapaPaymentStatus({payment,onNavigate,onStartAgain,readOnly=false}:{payment:ReturnType<typeof useChapaPayment>;onNavigate?:()=>void;onStartAgain?:()=>void;readOnly?:boolean}){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en,order=payment.order;
 const now=useChapaPaymentClock(order);
 const phase=chapaPaymentPhase({...payment,now}),finished=phase==='confirmed'||phase==='preserved',checkingPaused=!!order&&chapaPollingPaused(order,now);
 const providerReason=order?chapaPaymentReasonMessage(order,am):null;
 const initializationCopy={
  request:['Checkout could not start. Check the phone number, payment method and amount before trying again.','ክፍያው ሊጀመር አልቻለም። እንደገና ከመሞከርዎ በፊት የስልክ ቁጥሩን፣ የክፍያ መንገዱንና መጠኑን ያረጋግጡ።'],
  reference:['The original payment needs confirmation. Keep its reference and do not pay again if you were debited.','የመጀመሪያው ክፍያ ማረጋገጫ ይፈልጋል። ማጣቀሻውን ያስቀምጡ፤ ገንዘብ ከተቀነሰብዎ ድጋሚ አይክፈሉ።'],
  state:['The original payment needs confirmation. Keep its reference and do not pay again if you were debited.','የመጀመሪያው ክፍያ ማረጋገጫ ይፈልጋል። ማጣቀሻውን ያስቀምጡ፤ ገንዘብ ከተቀነሰብዎ ድጋሚ አይክፈሉ።'],
  configuration:['Checkout is currently unavailable. Keep this payment reference while we resolve it.','ክፍያ ለጊዜው አይገኝም። ችግሩ እስኪፈታ ድረስ የክፍያውን ማጣቀሻ ያስቀምጡ።'],
  temporary:['Checkout is temporarily unavailable. Retry the original request to continue the same payment.','ክፍያ ለጊዜው አይገኝም። ያንኑ ክፍያ ለመቀጠል የመጀመሪያውን ጥያቄ እንደገና ይሞክሩ።'],
 } as const;
 const initializationRejected=phase==='review'&&!!order&&(order.reason==='INITIALIZATION_REJECTED'||chapaDirectRequestRejected(order))&&order.providerStatus!=='SUCCESS';
 const initializationMessage=order&&!finished&&!order.checkoutUrl&&order.providerStatus!=='SUCCESS'&&(phase!=='review'||initializationRejected)&&order.verificationState!=='MISMATCH'&&['SUBMITTING','PENDING','NEEDS_REVIEW'].includes(order.status)&&order.initializationIssue?initializationCopy[order.initializationIssue]?.[am?1:0]:null;
 const longWait=!providerReason&&!initializationMessage&&chapaLongWait(order,now)&&['authorization','confirming','applying','pending','unavailable'].includes(phase);
 const spinning=!longWait&&['opening','restoring','confirming','applying'].includes(phase);
 const attention=['review','failed','unavailable','interrupted','preserved','access'].includes(phase);
 const headings:Record<typeof phase,[string,string]>={
  access:['Reopen your Lowwin account','የLowwin መለያዎን እንደገና ይክፈቱ'],
  opening:['Opening checkout…','ክፍያ በመክፈት ላይ…'],restoring:['Opening your payment…','ክፍያዎን በመክፈት ላይ…'],
  confirmed:[order?.purpose==='BID'?'Bid accepted':'Wallet credited',order?.purpose==='BID'?'ጨረታው ተቀብሏል':'ዋሌት ገብቷል'],
  preserved:['Payment saved to your wallet','ክፍያው በዋሌትዎ ገብቷል'],
  review:[initializationRejected?'Checkout could not start':'Payment needs review',initializationRejected?'ክፍያው ሊጀመር አልቻለም':'ክፍያው ማረጋገጥ ያስፈልገዋል'],
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
  <p className={styles.statusMessage}>{longWait?text(`Your payment has not been confirmed yet. You don’t need to wait here—check ${order?.purpose==='BID'?'My Bids':'Transactions'} in a moment. We’ll notify you when it’s confirmed. If you already paid, please don’t pay again.`,`ክፍያዎ ገና አልተረጋገጠም። እዚህ መጠበቅ አያስፈልግም፤ በጥቂት ጊዜ የጨረታዎን ወይም የግብይትዎን ሁኔታ ይመልከቱ። ሲረጋገጥ እናሳውቅዎታለን። ከከፈሉ ድጋሚ አይክፈሉ።`):providerReason??initializationMessage??messages[phase][am?1:0]}</p>
  {order&&<dl className={styles.paymentSummary}>{order.auctionTitle?<div><dt>{text('Auction','ጨረታ')}</dt><dd>{am?order.auctionTitleAm||order.auctionTitle:order.auctionTitle}</dd></div>:<div><dt>{text('For','ለ')}</dt><dd>{text(order.purpose==='TOP_UP'?'Wallet top-up':'Bid submission',order.purpose==='TOP_UP'?'የዋሌት ገቢ':'ጨረታ ማቅረቢያ')}</dd></div>}{order.bidNumber&&<div><dt>{text('Your bid amount','የጨረታ መጠንዎ')}</dt><dd>{order.bidNumber}</dd></div>}<div><dt>{text(order.purpose==='BID'?(finished?'Fee paid':'Submission fee'):'Top-up amount',order.purpose==='BID'?'የማስገቢያ ክፍያ':'የዋሌት ገቢ መጠን')}</dt><dd>{formatEtb(order.amount)}</dd></div><div><dt>{text(finished?'Paid with':'Payment method',finished?'የተከፈለበት':'የክፍያ መንገድ')}</dt><dd>{order.paymentMethod||text('Online payment','የመስመር ላይ ክፍያ')}</dd></div></dl>}
  {!finished&&payment.error&&<p className={styles.statusError} role="alert">{text('Payment confirmation is temporarily unavailable. Your last payment status is saved.','የክፍያ ማረጋገጫ ለጊዜው አይገኝም። የመጨረሻው የክፍያ ሁኔታ ተቀምጧል።')}</p>}
  <div className={styles.statusActions}>
   {longWait&&<><Link className={styles.payButton} href={order?.purpose==='BID'?'/my-bids':'/payments'} onClick={onNavigate}>{text(order?.purpose==='BID'?'Go to My Bids':'View Transactions',order?.purpose==='BID'?'የእኔ ጨረታዎች':'ግብይቶችን ይመልከቱ')}</Link>{onNavigate&&<button type="button" className={styles.checkPayment} onClick={onNavigate}>{text('Close','ዝጋ')}</button>}</>}
   {finished&&(onNavigate?<button type="button" className={styles.payButton} onClick={onNavigate}>{text('Done','ተጠናቋል')}</button>:<Link className={styles.payButton} href={order?.status==='BID_ACCEPTED'?'/my-bids':'/profile#wallet'}>{text(order?.status==='BID_ACCEPTED'?'View My Bids':'Back to wallet',order?.status==='BID_ACCEPTED'?'የእኔ ጨረታዎች':'ወደ ዋሌት')}</Link>)}
   {url&&<a className={longWait?styles.checkPayment:styles.payButton} href={url} target="_blank" rel="noopener noreferrer" onClick={event=>{event.preventDefault();const nav=prepareChapaNavigation();try{nav.open(url)}finally{nav.cancel()}}}>{text('Continue checkout','ክፍያውን ይቀጥሉ')}<ArrowUpRight size={16} aria-hidden="true"/></a>}
   {retryOriginal&&<button type="button" className={styles.checkPayment} onClick={()=>void payment.create(payment.attempt!.intent)}>{text('Retry original request','የመጀመሪያውን ጥያቄ ይድገሙ')}</button>}
   {!order&&!payment.attempt&&!payment.restoring&&!payment.busy&&<button type="button" className={styles.checkPayment} onClick={()=>void payment.check()}>{text('Try opening again','እንደገና ክፈት')}</button>}
   {!readOnly&&payment.canStartAgain&&(!longWait||checkingPaused)&&<button type="button" className={styles.checkPayment} onClick={onStartAgain??payment.startAgain}>{text(finished?'Top up again':'Start new checkout',finished?'እንደገና ገንዘብ ያስገቡ':'አዲስ ክፍያ ይጀምሩ')}</button>}
  </div>
  {!finished&&order&&phase!=='failed'&&(!longWait||checkingPaused)&&<small className={styles.savedPaymentNote}>{text('Starting another checkout does not cancel this payment.','ሌላ ክፍያ መጀመር ይህን ክፍያ አይሰርዝም።')}</small>}
  {order&&<details className={styles.paymentDetails}><summary>{text('Payment details','የክፍያ ዝርዝሮች')}</summary><small className={styles.paymentReference}>{order.merchantReference??order.id}</small><p>{text('Payment status','የክፍያ ሁኔታ')}: {chapaStatusLabel(order,am)}</p>{order.paymentMethod&&<p>{text('Method','መንገድ')}: {order.paymentMethod}</p>}{order.payerPhoneMasked&&<p>{text('Payment phone','የክፍያ ስልክ')}: {order.payerPhoneMasked}</p>}{!!order.batchNumbers?.length&&<p>{text('Bid amounts','የጨረታ መጠኖች')}: {order.batchNumbers.join(' · ')}</p>}{order.purpose==='BID'&&<p>{text('Fulfillment','የጨረታ ሁኔታ')}: {order.status==='BID_ACCEPTED'&&order.receipt?text('All selected bids accepted','ሁሉም የተመረጡ ጨረታዎች ተቀብለዋል'):order.fundsPreserved?text('Funds in wallet; bids not accepted','ገንዘቡ በዋሌት ገብቷል፤ ጨረታዎች አልተቀበሉም'):text('Bids not accepted yet','ጨረታዎች ገና አልተቀበሉም')}</p>}</details>}
  <div className={styles.links}><Link href="/payments" prefetch={false} onClick={onNavigate}>{text('View Transactions','ግብይቶችን ይመልከቱ')}</Link>{order?.status==='BID_ACCEPTED'&&<Link href="/my-bids" onClick={onNavigate}>{text('My Bids','የእኔ ጨረታዎች')}</Link>}</div>
 </section>;
}
