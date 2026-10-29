import {chapaCheckoutUrl} from './chapa-client';
import {chapaBotReturnLink} from './chapa-return-link';

/** This opens only an opaque attempt link. The Mini App still verifies ownership
 * and payment on its server after Telegram launches it. */
export function returnChapaToBot(botUrl:string|null|undefined,id:string|null|undefined){
 const url=chapaBotReturnLink(botUrl,id);
 if(!url||window.Telegram?.WebApp?.initData)return false;
 try{window.location.replace(url);return true}catch{return false}
}

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
