export const TELEGRAM_SDK_URL='https://telegram.org/js/telegram-web-app.js';

/** Observe the eagerly loaded script without delaying an already available SDK.
 * Keep observing after a timeout so a late SDK can still recover the launch. */
export function observeTelegramSdk(onReady:()=>void,onUnavailable:()=>void,timeoutMs=8000){
 let disposed=false,ready=false,unavailable=false;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const check=()=>{
  if(disposed||ready||!window.Telegram?.WebApp)return false;
  ready=true;clearTimeout(timer);onReady();return true;
 };
 const fail=()=>{if(!disposed&&!ready&&!unavailable){unavailable=true;onUnavailable()}};
 const isSdk=(event:Event)=>{
  const script=event.target as HTMLScriptElement|null;
  return script?.tagName==='SCRIPT'&&script.src===TELEGRAM_SDK_URL;
 };
 const loaded=(event:Event)=>{if(isSdk(event)&&!check())fail()};
 const failed=(event:Event)=>{if(isSdk(event))fail()};
 // Capture listeners also observe parser-inserted async scripts. Register them
 // before checking the global to cover a load racing hydration.
 document.addEventListener('load',loaded,true);
 document.addEventListener('error',failed,true);
 if(!check())timer=setTimeout(()=>{if(!check())fail()},timeoutMs);
 return()=>{disposed=true;clearTimeout(timer);document.removeEventListener('load',loaded,true);document.removeEventListener('error',failed,true)};
}
