'use client';
import {useEffect,useRef,useState} from 'react';
import {LoaderCircle,Phone,ShieldCheck} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {AccountSheet} from './account-sheet';
import {TelegramBotLink} from './telegram-bot-link';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {watchContactApproval} from '@/lib/contact-approval';
import styles from './contact-gate.module.css';

/** Native consent is opened only by Share contact. Dismissal leaves the app and
 * any bid draft mounted; SDK approval never substitutes for server proof. */
export function ContactGate(){
 const {status,finishContact,botUrl,closeRegistration,retry,error:identityError}=useTelegram();
 const {language}=useMiniLocale(),am=language==='am';
 const [phase,setPhase]=useState<'ready'|'approval'|'confirming'|'declined'|'unsupported'|'error'>('ready');
 const [error,setError]=useState('');
 const alive=useRef(true),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null),approval=useRef<ReturnType<typeof watchContactApproval>|null>(null),controller=useRef<AbortController|null>(null);
 function clear(){if(timer.current)clearTimeout(timer.current);timer.current=null;approval.current?.cancel();approval.current=null;controller.current?.abort();controller.current=null}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;clear()}},[]);
 useEffect(()=>{if(status==='error'){generation.current++;clear();setPhase('error')}},[status]);
 function current(attempt:number){return alive.current&&attempt===generation.current}
 function close(){generation.current++;clear();closeRegistration()}
 async function poll(attempt:number,count=0):Promise<void>{
  if(!current(attempt))return;
  controller.current=new AbortController();
  try{
   const response=await fetch('/api/onboarding/contact',{cache:'no-store',signal:AbortSignal.any([controller.current.signal,AbortSignal.timeout(6000)])});
   if(!current(attempt))return;
   if(response.status===401||response.status===403)throw Error(am?'ከTelegram መለያዎ እንደገና Lowwinን ይክፈቱ።':'Reopen Lowwin from your Telegram account.');
   if(!response.ok)throw Error(am?'ማረጋገጥ አልተቻለም። እንደገና ይሞክሩ።':'Could not confirm your contact. Please retry.');
   const result=await response.json();if(!current(attempt))return;
   if(result.verified){await finishContact();return}
   if(count>=14)throw Error(am?'የTelegram ማረጋገጫ ገና አልደረሰም። ትንሽ ቆይተው እንደገና ይሞክሩ።':'Telegram has not confirmed your contact yet. Wait a moment and try again.');
   timer.current=setTimeout(()=>void poll(attempt,count+1),Math.min(1500,250+count*250));
  }catch(cause){if(current(attempt)){setPhase('error');setError(cause instanceof Error?cause.message:'Please retry.')}}
 }
 function shareContact(){
  if(phase==='approval'||phase==='confirming'||status==='loading')return;
  const attempt=++generation.current;clear();setError('');
  const app=window.Telegram?.WebApp;
  if(!app?.requestContact||app.isVersionAtLeast&&!app.isVersionAtLeast('6.9')){setPhase('unsupported');return}
  if(status!=='contact-required'){setPhase('error');setError(am?'ከTelegram ውስጥ Lowwinን ይክፈቱ።':'Open Lowwin inside Telegram to log in.');return}
  setPhase('approval');
  approval.current=watchContactApproval(shared=>{
   if(!current(attempt))return;approval.current=null;
   if(!shared){setPhase('declined');return}
   setPhase('confirming');void poll(attempt);
  },()=>{if(current(attempt)){approval.current=null;setPhase('error');setError(am?'ማረጋገጫው ዘግይቷል። እንደገና ይሞክሩ።':'Telegram confirmation timed out. Please retry.')}});
  try{app.requestContact(approval.current.respond)}catch{approval.current?.cancel();approval.current=null;setPhase('unsupported')}
 }
 const busy=phase==='approval'||phase==='confirming'||status==='loading';
 return <AccountSheet title={<MiniPhrase en="Log in to Lowwin" am="ወደ Lowwin ይግቡ"/>} onClose={close}>
  <div className={styles.content}><span className={styles.icon}><ShieldCheck size={28}/></span><h3><MiniPhrase en="Your account, securely connected" am="መለያዎን በደህንነት ያገናኙ"/></h3><p><MiniPhrase en="Share your own Telegram contact to bid and use your wallet. Browsing is always available." am="ለመጫረት እና ዋሌትዎን ለመጠቀም የራስዎን የTelegram ስልክ ቁጥር ያጋሩ። ጨረታዎችን ያለምዝገባ ማየት ይችላሉ።"/></p>
  {phase==='declined'&&<p role="status"><MiniPhrase en="Contact sharing was cancelled. You can keep browsing or try again." am="ስልክ ቁጥር ማጋራት ተሰርዟል። መመልከት መቀጠል ወይም እንደገና መሞከር ይችላሉ።"/></p>}
  {(error||status==='error')&&<p className={styles.error} role="alert">{error||identityError}</p>}
  {phase==='unsupported'&&<p role="status"><MiniPhrase en="Update Telegram, then open Lowwin from the bot to share your contact." am="Telegramን ያዘምኑ፣ ከዚያ ስልክ ቁጥርዎን ለማጋራት Lowwinን ከቦቱ ይክፈቱ።"/></p>}
  {(status==='contact-required'||status==='loading')&&phase!=='unsupported'&&<button className="primary-button" onClick={shareContact} disabled={busy}>{busy?<LoaderCircle className={styles.spin} size={18}/>:<Phone size={18}/>}<MiniPhrase en={phase==='confirming'?'Confirming your contact':phase==='approval'?'Approve in Telegram':status==='loading'?'Connecting to Telegram':'Share contact'} am={phase==='confirming'?'ስልክ ቁጥርዎ በማረጋገጥ ላይ':phase==='approval'?'በTelegram ያጽድቁ':status==='loading'?'ከTelegram በመገናኘት ላይ':'ስልክ ቁጥርዎን ያጋሩ'}/></button>}
  {status==='error'&&!busy&&<button className="primary-button" onClick={retry}><MiniPhrase en="Reconnect" am="እንደገና ይገናኙ"/></button>}
  {botUrl&&(phase==='unsupported'||status==='guest'||status==='error')&&<TelegramBotLink className="primary-button" href={botUrl}><MiniPhrase en="Open in Telegram" am="በTelegram ይክፈቱ"/></TelegramBotLink>}
  <button className="text-link" onClick={close}><MiniPhrase en="Keep browsing" am="መመልከት ይቀጥሉ"/></button></div>
 </AccountSheet>;
}
