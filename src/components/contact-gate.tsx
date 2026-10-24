'use client';
import {useEffect,useRef,useState} from 'react';
import {useTelegram} from './telegram-provider';
import {LaunchSplash} from './launch-splash';
import {CONTACT_ACTION} from '@/modules/bot/onboarding-copy';
import {TelegramBotLink} from './telegram-bot-link';
import {miniAuthError} from '@/lib/mini-auth-client';
import {watchContactApproval} from '@/lib/contact-approval';

export function ContactGate(){
 const {finishContact,botUrl}=useTelegram();
 const [error,setError]=useState('');
 const [retryBotPrompt,setRetryBotPrompt]=useState(false);
 const alive=useRef(true),started=useRef(false),cancelled=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const generation=useRef(0),approval=useRef<ReturnType<typeof watchContactApproval>|null>(null);
 useEffect(()=>{
  alive.current=true;
  if(!started.current){started.current=true;void requestPermission()}
  return()=>{alive.current=false;started.current=false;generation.current++;clearTimers()};
 },[]);
 function clearTimers(){if(timer.current)clearTimeout(timer.current);timer.current=null;approval.current?.cancel();approval.current=null}
 function current(attempt:number){return alive.current&&!cancelled.current&&attempt===generation.current}
 function close(){cancelled.current=true;generation.current++;clearTimers();window.Telegram?.WebApp?.close?.()}
 async function promptBotAndClose(){
  const attempt=++generation.current;
  cancelled.current=true;clearTimers();setError('');setRetryBotPrompt(true);
  try{
   const response=await fetch('/api/onboarding/contact',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(!alive.current||attempt!==generation.current)return;
   if(!response.ok&&response.status!==429)throw Error((await response.json()).error??'Could not open the bot contact button.');
   window.Telegram?.WebApp?.close?.();
   if(!window.Telegram?.WebApp?.close)setError(`Open the bot and tap “${CONTACT_ACTION}”, then reopen Lowwin.`);
  }catch(cause){if(alive.current&&attempt===generation.current)setError(miniAuthError(cause))}
 }
 async function poll(attempt=0,request=generation.current){
  if(!current(request))return;
  try{
   const response=await fetch('/api/onboarding/contact',{cache:'no-store',signal:AbortSignal.timeout(6000)});
   if(!current(request))return;
   if(response.status===401)throw Error('Your session expired. Reopen Lowwin from the bot.');
   if(response.ok){const result=await response.json();if(!current(request))return;if(result.verified){void finishContact();return}}
   if(attempt>=14)throw Error('Telegram has not confirmed your contact yet. Check the bot, then retry.');
   timer.current=setTimeout(()=>void poll(attempt+1,request),Math.min(1500,250+attempt*250));
  }catch(cause){if(current(request))setError(miniAuthError(cause))}
 }
 async function requestPermission(){
  const attempt=++generation.current;
  cancelled.current=false;clearTimers();setError('');setRetryBotPrompt(false);
  try{
   const response=await fetch('/api/onboarding/contact',{cache:'no-store',signal:AbortSignal.timeout(6000)});
   if(!current(attempt))return;
   if(!response.ok)throw Error('Could not check your contact. Please retry.');
   const result=await response.json();if(!current(attempt))return;
   if(result.verified){await finishContact();return}
  }catch(cause){if(current(attempt))setError(miniAuthError(cause));return}
  const app=window.Telegram?.WebApp;
  if(app?.requestContact&&(!app.isVersionAtLeast||app.isVersionAtLeast('6.9'))){
   try{
    // This opens Telegram's own approval popup. It never shares a contact silently.
    approval.current=watchContactApproval(shared=>{
     if(!current(attempt))return;approval.current=null;
     if(!shared){void promptBotAndClose();return}void poll(0,attempt);
    },()=>{
     if(!current(attempt))return;generation.current++;approval.current=null;
     setError('Telegram contact confirmation took too long. Check the bot, then try again.');
    });
    app.requestContact(approval.current.respond);
    return;
   }catch{approval.current?.cancel();approval.current=null;/* Older clients use the private-chat reply keyboard. */}
  }
  await promptBotAndClose();
 }
 if(!error)return <LaunchSplash/>;
 return <main id="main" className="telegram-entry contact-gate"><p role="alert">{error}</p><button className="primary-button" onClick={()=>void (retryBotPrompt?promptBotAndClose():requestPermission())}>Try again</button>{botUrl&&<TelegramBotLink className="text-link" href={botUrl}>Open the bot</TelegramBotLink>}<button className="text-link" onClick={close}>Cancel & close</button></main>;
}
