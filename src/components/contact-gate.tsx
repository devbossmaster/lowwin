'use client';
import {useEffect,useRef,useState} from 'react';
import {useTelegram} from './telegram-provider';
import {LaunchSplash} from './launch-splash';
import {CONTACT_ACTION} from '@/modules/bot/onboarding-copy';

export function ContactGate(){
 const {finishContact,botUrl}=useTelegram();
 const [error,setError]=useState('');
 const [retryBotPrompt,setRetryBotPrompt]=useState(false);
 const alive=useRef(true),started=useRef(false),cancelled=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{
  alive.current=true;
  if(!started.current){started.current=true;void requestPermission()}
  return()=>{alive.current=false;if(timer.current)clearTimeout(timer.current)};
 },[]);
 function close(){cancelled.current=true;if(timer.current)clearTimeout(timer.current);window.Telegram?.WebApp?.close?.()}
 async function promptBotAndClose(){
  cancelled.current=true;if(timer.current)clearTimeout(timer.current);setError('');setRetryBotPrompt(true);
  try{
   const response=await fetch('/api/onboarding/contact',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(!alive.current)return;
   if(!response.ok&&response.status!==429)throw Error((await response.json()).error??'Could not open the bot contact button.');
   window.Telegram?.WebApp?.close?.();
   if(!window.Telegram?.WebApp?.close)setError(`Open the bot and tap “${CONTACT_ACTION}”, then reopen Lowwin.`);
  }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'Could not reach the bot. Try again.')}
 }
 async function poll(attempt=0){
  if(!alive.current||cancelled.current)return;
  try{
   const response=await fetch('/api/onboarding/contact',{cache:'no-store',signal:AbortSignal.timeout(6000)});
   if(!alive.current||cancelled.current)return;
   if(response.status===401)throw Error('Your session expired. Reopen Lowwin from the bot.');
   if(response.ok&&(await response.json()).verified){void finishContact();return}
   if(attempt>=14)throw Error('Telegram has not confirmed your contact yet. Check the bot, then retry.');
   timer.current=setTimeout(()=>void poll(attempt+1),Math.min(1500,250+attempt*250));
  }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'Connection interrupted. Please retry.')}
 }
 async function requestPermission(){
  cancelled.current=false;setError('');setRetryBotPrompt(false);
  const app=window.Telegram?.WebApp;
  if(app?.requestContact&&(!app.isVersionAtLeast||app.isVersionAtLeast('6.9'))){
   try{
    // This opens Telegram's own approval popup. It never shares a contact silently.
    app.requestContact(shared=>{if(!alive.current||cancelled.current)return;if(!shared){void promptBotAndClose();return}void poll()});
    return;
   }catch{/* Older clients use the private-chat reply keyboard. */}
  }
  await promptBotAndClose();
 }
 if(!error)return <LaunchSplash/>;
 return <main id="main" className="telegram-entry contact-gate"><p role="alert">{error}</p><button className="primary-button" onClick={()=>void (retryBotPrompt?promptBotAndClose():requestPermission())}>Try again</button>{botUrl&&<a className="text-link" href={botUrl}>Open the bot</a>}<button className="text-link" onClick={close}>Cancel & close</button></main>;
}
