'use client';
import {useEffect,useRef,useState} from 'react';
import {LoaderCircle,Phone} from 'lucide-react';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import {useTelegram} from './telegram-provider';
import {LaunchSplash} from './launch-splash';
import {TelegramBotLink} from './telegram-bot-link';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {watchContactApproval} from '@/lib/contact-approval';
import styles from './contact-gate.module.css';

/** Gate the Mini App until the bot has verified contact for this signed launch. */
export function ContactGate(){
 const {status,finishContact,botUrl,retry,needsReopen,error:identityError}=useTelegram();
 const {language}=useMiniLocale(),am=language==='am';
 const [phase,setPhase]=useState<'ready'|'approval'|'confirming'|'declined'|'unsupported'|'error'>('ready');
 const [error,setError]=useState('');
 const alive=useRef(true),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null),approval=useRef<ReturnType<typeof watchContactApproval>|null>(null),controller=useRef<AbortController|null>(null);
 const automaticLaunch=useRef<string|null>(null);
 function clear(){if(timer.current)clearTimeout(timer.current);timer.current=null;approval.current?.cancel();approval.current=null;controller.current?.abort();controller.current=null}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;clear()}},[]);
 useEffect(()=>{if(status==='error'){generation.current++;clear();setPhase('error')}},[status]);
 function current(attempt:number){return alive.current&&attempt===generation.current}
 async function poll(attempt:number,initData:string,count=0):Promise<void>{
  if(!current(attempt))return;
  controller.current=new AbortController();
  try{
   const response=await fetch('/api/onboarding/contact',{
    method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData}),
    signal:AbortSignal.any([controller.current.signal,AbortSignal.timeout(6000)]),
   });
   if(!current(attempt)||window.Telegram?.WebApp?.initData!==initData)return;
   if(response.status===401||response.status===403)throw Error(am?'ከTelegram መለያዎ እንደገና Lowwinን ይክፈቱ።':'Reopen Lowwin from your Telegram account.');
   if(!response.ok)throw Error(am?'ማረጋገጥ አልተቻለም። እንደገና ይሞክሩ።':'Could not confirm your contact. Please retry.');
   const result=await response.json();if(!current(attempt)||window.Telegram?.WebApp?.initData!==initData)return;
   if(result.verified===true){setPhase('ready');await finishContact();return}
   if(count>=14)throw Error(am?'የTelegram ማረጋገጫ ገና አልደረሰም። ትንሽ ቆይተው እንደገና ይሞክሩ።':'Telegram has not confirmed your contact yet. Wait a moment and try again.');
   timer.current=setTimeout(()=>void poll(attempt,initData,count+1),Math.min(1500,250+count*250));
  }catch(cause){if(current(attempt)){setPhase('error');setError(cause instanceof Error?cause.message:'Please retry.')}}
 }
 function shareContact(){
  if(approval.current||phase==='confirming'||status!=='contact-required')return;
  const app=window.Telegram?.WebApp;
  const initData=app?.initData;
  if(!initData)return;
  automaticLaunch.current=initData;
  const attempt=++generation.current;clear();setError('');
  if(!app?.requestContact||app.isVersionAtLeast&&!app.isVersionAtLeast('6.9')){setPhase('unsupported');return}
  setPhase('approval');
  approval.current=watchContactApproval(shared=>{
   if(!current(attempt))return;approval.current=null;
   if(!shared){setPhase('declined');return}
   setPhase('confirming');void poll(attempt,initData);
  },()=>{if(current(attempt)){approval.current=null;setPhase('error');setError(am?'ማረጋገጫው ዘግይቷል። እንደገና ይሞክሩ።':'Telegram confirmation timed out. Please retry.')}});
  try{app.requestContact(approval.current.respond)}catch{approval.current?.cancel();approval.current=null;setPhase('unsupported')}
 }
 useEffect(()=>{
  const launch=window.Telegram?.WebApp?.initData;
  if(!launch||status!=='contact-required'||automaticLaunch.current===launch)return;
  // Wait for the contact screen to commit. Cleanup cancels React's replay.
  const request=setTimeout(()=>{if(!alive.current||automaticLaunch.current===launch)return;automaticLaunch.current=launch;shareContact()},0);
  return()=>clearTimeout(request);
 },[status]);
 if(status==='loading')return <LaunchSplash/>;
 const busy=phase==='approval'||phase==='confirming';
 return <main id="main" className={`telegram-entry ${styles.screen}`} aria-labelledby="contact-heading">
  <img src={LOWWIN_LOGO_SRC} alt="Lowwin" width={56} height={56} data-lowwin-logo/>
  <h1 id="contact-heading"><MiniPhrase en="Share your Telegram contact" am="የTelegram ስልክ ቁጥርዎን ያጋሩ"/></h1>
  <p><MiniPhrase en="Share your own number through Telegram to finish registration and open Lowwin." am="ምዝገባዎን ለማጠናቀቅ እና Lowwinን ለመክፈት የራስዎን ስልክ ቁጥር በTelegram ያጋሩ።"/></p>
  {phase==='declined'&&<p role="status"><MiniPhrase en="Contact sharing was cancelled. Tap Share contact to try again." am="ስልክ ቁጥር ማጋራት ተሰርዟል። እንደገና ለመሞከር የማጋራት ቁልፉን ይጫኑ።"/></p>}
  {(error||status==='error')&&<p className={styles.error} role="alert">{error||identityError}</p>}
  {phase==='unsupported'&&<p role="status"><MiniPhrase en="Update Telegram, then open Lowwin from the bot to share your contact." am="Telegramን ያዘምኑ፣ ከዚያ ስልክ ቁጥርዎን ለማጋራት Lowwinን ከቦቱ ይክፈቱ።"/></p>}
  {status==='contact-required'&&phase!=='unsupported'&&<button type="button" className="primary-button" onClick={shareContact} disabled={busy} aria-live="polite">{busy?<LoaderCircle aria-hidden="true" className={styles.spin} size={18}/>:<Phone aria-hidden="true" size={18}/>}<MiniPhrase en={phase==='confirming'?'Confirming your contact':phase==='approval'?'Approve in Telegram':'Share contact'} am={phase==='confirming'?'ስልክ ቁጥርዎ በማረጋገጥ ላይ':phase==='approval'?'በTelegram ያጽድቁ':'ስልክ ቁጥርዎን ያጋሩ'}/></button>}
  {status==='error'&&!busy&&!needsReopen&&<button className="primary-button" onClick={retry}><MiniPhrase en="Reconnect" am="እንደገና ይገናኙ"/></button>}
  {botUrl&&(phase==='unsupported'||status==='guest'||status==='error')&&<TelegramBotLink className="primary-button" href={botUrl}><MiniPhrase en="Open in Telegram" am="በTelegram ይክፈቱ"/></TelegramBotLink>}
 </main>;
}
