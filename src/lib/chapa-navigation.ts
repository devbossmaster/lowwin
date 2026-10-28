import {chapaCheckoutUrl} from './chapa-client';

/** Reserve a browser tab during the Pay click so an asynchronous response is
 * not blocked as a popup. Telegram uses its own external-browser handoff. */
export function prepareChapaNavigation(){
 const telegram=window.Telegram?.WebApp;
 let popup:Window|null=null;
 if(!telegram?.openLink)try{popup=window.open('about:blank','_blank')}catch{/* Same-tab fallback remains available. */}
 if(popup)popup.opener=null;
 let opened=false;
 return {
  open(value:string|null|undefined){
   const url=chapaCheckoutUrl(value);if(!url)return false;
   if(telegram?.openLink)telegram.openLink(url);
   else if(popup&&!popup.closed)popup.location.replace(url);
   else window.location.assign(url);
   opened=true;return true;
  },
  cancel(){if(!opened&&popup&&!popup.closed)popup.close()},
 };
}
