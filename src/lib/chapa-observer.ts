import {acceptChapaSnapshot,ChapaClientError,chapaConfirmed,chapaRecoverable,chapaUuid,type ChapaCheckoutView} from './chapa-client';

type Events=Pick<EventTarget,'addEventListener'|'removeEventListener'>;
type Visibility=Events&Pick<Document,'visibilityState'>;
type Source=Pick<EventTarget,'addEventListener'>&{close:()=>void};
type Telegram={onEvent?:(event:string,listener:()=>void)=>void;offEvent?:(event:string,listener:()=>void)=>void};
export type ChapaVerificationTrigger='wallet-return';
type Options={
 initialOrder?:ChapaCheckoutView|null;
 readSnapshot:()=>Promise<ChapaCheckoutView|null>;
 verify:(trigger?:ChapaVerificationTrigger)=>Promise<ChapaCheckoutView|null>;
 onSnapshot:(order:ChapaCheckoutView)=>void;
 onPause:()=>void;
 onResume?:()=>void;
 onError?:(error:unknown)=>void;
 isCurrent?:()=>boolean;
 deadlineAt?:number|null;
 observeDirect?:boolean;
 initialWalletReturnAt?:number;
 visibility?:Visibility;
 wake?:Events|null;
 telegram?:Telegram|null;
 createSource?:((url:string)=>Source)|null;
};

type SharedObserver={identity:string;id:string;owners:Set<Options>;primary:Options;generation:number;stop:()=>void;latest:ChapaCheckoutView|null};
const observers=new Map<string,SharedObserver>();
// A surface can hand ownership to another component while its old request is
// still settling. Keep the flight fence across observer restarts/remounts.
const ownedRequests=new Map<string,Promise<ChapaCheckoutView|null>>();
const walletReturnLifetimeMs=10000;
let observerIdentity:string|null=null;
/** Explicit account scope is mandatory for sharing. Tests can use the local
 * startChapaObserver primitive without creating an unscoped shared resource. */
export function retainChapaObserver(identity:string,id:string,options:Options){
 if(!identity||!chapaUuid.test(id)||options.isCurrent?.()===false)return ()=>{};
 if(observerIdentity!==identity){stopChapaObservers();observerIdentity=identity}
 const key=JSON.stringify([identity,id]);let entry=observers.get(key);
 const valid=(owner:Options)=>owner.isCurrent?.()??true;
 const fanout=(owned:SharedObserver,callback:(owner:Options)=>void)=>{
  for(const owner of owned.owners)if(valid(owner)){try{callback(owner)}catch{/* A removed surface cannot break another reader. */}}
 };
 const start=(owned:SharedObserver)=>{
  owned.stop();const generation=++owned.generation,primary=owned.primary;
  const current=()=>observers.get(key)===owned&&owned.generation===generation;
  const receive=(order:ChapaCheckoutView)=>{
   if(!current()||!acceptChapaSnapshot(owned.latest,order))return;owned.latest=order;fanout(owned,owner=>owner.onSnapshot(order));
  };
  const request=async(kind:'readSnapshot'|'verify',trigger?:ChapaVerificationTrigger)=>{
   const previous=ownedRequests.get(key);if(previous)try{await previous}catch{/* A new owner can recover after the old request aborts. */}
   if(!current()||!valid(primary))return null;
   const flight=Promise.resolve().then(()=>kind==='verify'&&trigger?primary.verify(trigger):primary[kind]());ownedRequests.set(key,flight);
   try{const order=await flight;if(current()&&order)receive(order);return order}
   finally{if(ownedRequests.get(key)===flight)ownedRequests.delete(key)}
  };
  const initialWalletReturnAt=primary.initialWalletReturnAt;
  owned.stop=startChapaObserver(id,{
   ...primary,initialOrder:owned.latest??primary.initialOrder,readSnapshot:()=>request('readSnapshot'),verify:trigger=>request('verify',trigger),onSnapshot:receive,
   initialWalletReturnAt:generation===1?initialWalletReturnAt:undefined,
   isCurrent:()=>current()&&[...owned.owners].some(valid),
   onPause:()=>fanout(owned,owner=>owner.onPause()),onResume:()=>fanout(owned,owner=>owner.onResume?.()),
   onError:error=>fanout(owned,owner=>owner.onError?.(error)),
  });
 };
 if(!entry){
  entry={identity,id,owners:new Set([options]),primary:options,generation:0,stop:()=>{},latest:options.initialOrder?.id===id?options.initialOrder:null};observers.set(key,entry);start(entry);
 }else{
  entry.owners.add(options);if(entry.latest&&valid(options))options.onSnapshot(entry.latest);
 }
 const owned=entry;
 return()=>{
  owned.owners.delete(options);if(observers.get(key)!==owned)return;
  for(const owner of owned.owners)if(!valid(owner))owned.owners.delete(owner);
  if(!owned.owners.size){owned.generation++;owned.stop();observers.delete(key);return}
  if(owned.primary===options||!valid(owned.primary)){owned.primary=owned.owners.values().next().value!;start(owned)}
 };
}
/** Authorization and identity changes synchronously release every old socket. */
export function stopChapaObservers(identity?:string){
 for(const [key,entry] of observers)if(!identity||entry.identity===identity){entry.generation++;entry.stop();observers.delete(key)}
 if(!identity||observerIdentity===identity)observerIdentity=null;
}

/** One observer for an owned attempt: SSE delivers committed DTOs, while a
 * serialized, bounded verification timer remains the recovery path. Opening or
 * resuming only reads/checks the original payment; it never initializes it. */
export function startChapaObserver(id:string,options:Options){
 if(!chapaUuid.test(id))return ()=>{};
 const visibility=options.visibility??document,wake=options.wake===undefined?(typeof window==='undefined'?null:window):options.wake;
 const telegram=options.telegram===undefined?(typeof window==='undefined'?null:window.Telegram?.WebApp):options.telegram;
 const factory=options.createSource===undefined?(typeof EventSource==='undefined'?null:(url:string)=>new EventSource(url)):options.createSource;
 const fixedDeadline=typeof options.deadlineAt==='number'&&Number.isFinite(options.deadlineAt)?options.deadlineAt:null;
 let deadline=options.observeDirect?fixedDeadline??Infinity:Math.min(Date.now()+300000,fixedDeadline??Infinity);
 let active=true,paused=false,inFlight=false,snapshotWanted=false,verifyWanted=false,walletReturnWanted=false,healthy=false,delay=5000,failures=0;
 let latest=options.initialOrder?.id===id?options.initialOrder:null;
 const currentDirect=(order:ChapaCheckoutView|null)=>!!order&&order.apiVersion==='v2'&&order.flowVersion===5&&order.chargeType==='DIRECT'&&!order.unsupportedLegacy;
 let verificationFirst=currentDirect(latest);
 if(latest)delay=Number.isFinite(latest.pollAfterMs)?Math.min(60000,Math.max(2000,latest.pollAfterMs)):5000;
 let wasHidden=visibility.visibilityState!=='visible',away=wasHidden,lastWakeAt=-Infinity,lastWalletReturnAt=-Infinity,fastUntil=Date.now()+30000;
 let pendingWalletReturnUntil=0;
 let usedSlowVerificationRetry=false;
 let source:Source|null=null,timer:ReturnType<typeof setTimeout>|undefined,reconnect:ReturnType<typeof setTimeout>|undefined;
 const live=()=>active&&(options.isCurrent?.()??true);
 const foreground=()=>live()&&visibility.visibilityState==='visible';
 const pause=()=>{if(!paused){paused=true;options.onPause()}};
 const disconnect=()=>{healthy=false;source?.close();source=null;clearTimeout(reconnect)};
 const queueWalletReturn=(now:number)=>{
  if(now-lastWalletReturnAt<750||!currentDirect(latest)||latest?.authType!=='USSD'||!latest.authorizationReference)return false;
  lastWalletReturnAt=now;pendingWalletReturnUntil=0;walletReturnWanted=true;verifyWanted=true;
  return true;
 };
 const rememberWalletReturn=(returnedAt:number)=>{
  const now=Date.now();
  if(returnedAt>now||now-returnedAt>=walletReturnLifetimeMs||!currentDirect(latest))return false;
  const queued=queueWalletReturn(now);
  // A carrier can show and close its prompt before initialization saves
  // the reference. Keep the hint briefly for this same owned payment.
  if(!queued&&!latest?.authorizationReference)pendingWalletReturnUntil=returnedAt+walletReturnLifetimeMs;
  return queued;
 };
 const accept=(order:ChapaCheckoutView|null,pushed=false)=>{
  if(!live()||!order||order.id!==id||!acceptChapaSnapshot(latest,order))return false;
  const authorizationReady=order.authType==='USSD'&&!!order.authorizationReference&&order.authorizationReference!==latest?.authorizationReference;
  const completionReady=order.completionSignalPending&&!latest?.completionSignalPending;
  latest=order;verificationFirst||=currentDirect(order);
  if(pushed)options.onSnapshot(order);
  if(chapaConfirmed(order)||!chapaRecoverable(order)){stop();return false}
  delay=Number.isFinite(order.pollAfterMs)?Math.min(60000,Math.max(2000,order.pollAfterMs)):5000;
  // Recovery can discover the immutable intent before Chapa returns its USSD
  // reference. Use that committed change (or a new completion hint) to bring
  // forward the next owned check, without waiting for the ordinary poll timer.
  const now=Date.now();
  const resumedBeforeReference=authorizationReady&&now<pendingWalletReturnUntil&&queueWalletReturn(now);
  if(resumedBeforeReference||pushed&&currentDirect(order)&&(authorizationReady||completionReady)){verifyWanted=true;void drain()}
  return true;
 };
 const schedule=()=>{
  clearTimeout(timer);
  if(!foreground()||paused)return;
  // An open stream does not prove Chapa delivered a webhook. Preserve active
  // Inline validation cadence; only non-active hosted observation can relax.
  const interval=Math.max(delay,healthy&&!options.observeDirect?30000:options.observeDirect&&Date.now()>=deadline?30000:Date.now()<fastUntil?2000:5000);
  const untilExpiry=deadline-Date.now();
  timer=setTimeout(()=>{verifyWanted=true;void drain()},options.observeDirect&&untilExpiry<=0?interval:Math.min(interval,Math.max(0,untilExpiry)));
 };
 const drain=async()=>{
  if(!foreground()||inFlight)return;
  inFlight=true;clearTimeout(timer);
  try{
   while(foreground()&&(snapshotWanted||verifyWanted)){
    // Once an owned current Direct response exists, verification itself returns
    // the fresh owned snapshot. Do not serialize another GET ahead of it.
    if(verificationFirst){snapshotWanted=false;if(!verifyWanted)break}
    const snapshot=snapshotWanted,trigger=!snapshot&&walletReturnWanted?'wallet-return':undefined;
    if(snapshot)snapshotWanted=false;else{verifyWanted=false;walletReturnWanted=false}
    const startedAt=Date.now();
    try{
     const order=await(snapshot?options.readSnapshot():trigger?options.verify(trigger):options.verify());
     const accepted=accept(order);
     const now=Date.now();
     // The phone prompt can hold delivery of a nonterminal response without
     // firing a lifecycle event. Use one already-due check in the same queue.
     if(!snapshot&&accepted&&foreground()&&!verifyWanted&&!usedSlowVerificationRetry&&now<fastUntil&&now<deadline&&now-startedAt>=delay&&
      currentDirect(order)&&order?.paymentMethod==='telebirr'&&order.authType==='USSD'&&order.authorizationReference&&
      (order.status==='AUTH_NEEDED'||order.status==='PENDING')&&!order.verificationUnavailable&&order.verificationState!=='UNAVAILABLE'){
      usedSlowVerificationRetry=true;verifyWanted=true;
     }
    }
    catch(error){
     if(!live())return;
     options.onError?.(error);
     if(error instanceof ChapaClientError&&[401,403,404].includes(error.status)){stop();return}
     delay=Math.min(30000,delay*2);
     // Back off unless a separate wallet return arrived during this request.
     if(!walletReturnWanted){verifyWanted=false;break}
    }
   }
  }finally{
   inFlight=false;
   if(live()&&!options.observeDirect&&Date.now()>=deadline)pause();
   schedule();
  }
 };
 const connect=()=>{
  if(!foreground()||paused||source||!factory||failures>=6)return;
  try{
   const owned=factory(`/api/payments/chapa/checkouts/${id}/events`);source=owned;
   owned.addEventListener('open',()=>{
    if(!live()){stop();return}
    if(!foreground()||source!==owned)return;
    healthy=true;clearTimeout(reconnect);
    // Older/unknown attempts retain snapshot-first recovery. Current Direct's
    // startup/wake POST and bounded fallback already recover delayed frames;
    // opening the stream must not queue an extra GET or verification request.
    if(!verificationFirst){snapshotWanted=true;void drain()}
   });
   owned.addEventListener('checkout',event=>{
    if(!live()){stop();return}
    if(!foreground()||source!==owned)return;
    try{
     const order=JSON.parse((event as MessageEvent<string>).data)?.checkout as ChapaCheckoutView|undefined;
     if(!order||order.id!==id||typeof order.status!=='string'||!['TOP_UP','BID'].includes(order.purpose))return;
     failures=0;
     accept(order,true);
    }catch{/* Malformed frames are never payment evidence. */}
   });
   owned.addEventListener('authorization',()=>{
    if(!live()){stop();return}if(source!==owned)return;
    options.onError?.(new ChapaClientError('Reopen your Lowwin account.',401,'UNAUTHORIZED'));stop();
   });
   owned.addEventListener('error',()=>{
    if(!live()){stop();return}if(source!==owned)return;
    disconnect();failures++;
    // Native automatic retries are closed; only this bounded schedule retries.
    if(foreground()&&failures<6)reconnect=setTimeout(connect,Math.min(30000,1000*2**(failures-1)));
    // Active authorization polls already have their own cadence. Repeated
    // stream reconnect failures must not keep pushing their deadline back.
    if(!options.observeDirect)schedule();
   });
  }catch{
   failures++;
   if(foreground()&&failures<6)reconnect=setTimeout(connect,Math.min(30000,1000*2**(failures-1)));
  }
 };
 const onWake=(resuming:boolean,telegramActivated=false)=>{
  if(!live()){stop();return}
  if(visibility.visibilityState!=='visible'){wasHidden=true;away=true;clearTimeout(timer);disconnect();return}
  const now=Date.now();
  const returned=resuming&&(away||telegramActivated);
  const walletReturn=returned&&rememberWalletReturn(now);
  if(resuming)away=false;
  if(!wasHidden&&!walletReturn&&now-lastWakeAt<750)return;
  wasHidden=false;lastWakeAt=now;
  fastUntil=now+30000;failures=0;snapshotWanted=!verificationFirst;verifyWanted=true;
  if(!options.observeDirect&&fixedDeadline!==null&&now>=deadline){pause();void drain();return}
  if(paused){paused=false;deadline=now+300000;options.onResume?.()}
  connect();void drain();
 };
 const onReturn=()=>onWake(true);
 const onReconnect=()=>onWake(false);
 const onActivated=()=>onWake(true,true);
 // Android's native phone window can cover the Mini App without changing
 // document visibility. Still only send the stronger hint on a real return.
 const onAway=()=>{away=true};
 function stop(){
  if(!active)return;active=false;clearTimeout(timer);disconnect();
  visibility.removeEventListener('visibilitychange',onReturn);wake?.removeEventListener('focus',onReturn);wake?.removeEventListener('blur',onAway);wake?.removeEventListener('online',onReconnect);
  try{telegram?.offEvent?.('activated',onActivated);telegram?.offEvent?.('deactivated',onAway)}catch{/* Older Telegram clients use visibility/focus. */}
 }
 visibility.addEventListener('visibilitychange',onReturn);wake?.addEventListener('focus',onReturn);wake?.addEventListener('blur',onAway);wake?.addEventListener('online',onReconnect);
 try{telegram?.onEvent?.('activated',onActivated);telegram?.onEvent?.('deactivated',onAway)}catch{/* Older Telegram clients use visibility/focus. */}
 if(options.initialWalletReturnAt!==undefined)rememberWalletReturn(options.initialWalletReturnAt);
 snapshotWanted=!verificationFirst;verifyWanted=true;connect();void drain();
 return stop;
}
